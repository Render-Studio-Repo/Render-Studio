export const HARDWARE_REVIEW_SCHEMA = "render3d.hardware-run-review/v1";
export const HARDWARE_REVIEW_STORAGE_KEY = "render3d:hardware-run-reviews";
export const RESET_CHECKS = Object.freeze([
  ["workspaceClear", "Workspace and E-stop clear"],
  ["objectReset", "Cube returned to the marked start"],
  ["camerasReady", "All required cameras live"],
]);

const RESULTS = new Set(["pass", "fail", "uncertain", "discard"]);

function clean(value, limit = 240) {
  return String(value ?? "").trim().slice(0, limit);
}

function freshChecks() {
  return Object.fromEntries(RESET_CHECKS.map(([key]) => [key, false]));
}

export function createHardwareRunReview({ now = () => new Date(), storage = globalThis.localStorage, storageKey = HARDWARE_REVIEW_STORAGE_KEY } = {}) {
  let state = {
    schema: HARDWARE_REVIEW_SCHEMA,
    phase: "idle",
    runId: "",
    startingPosition: "",
    target: "",
    policy: "",
    startedAt: "",
    endedAt: "",
    automatic: { result: "uncertain", confidence: 0, reason: "No outcome evaluated", evidence: [] },
    operatorResult: "",
    finalResult: "",
    failureReason: "",
    episodeSaved: false,
    faultLatched: false,
    resetChecks: freshChecks(),
  };

  const snapshot = () => structuredClone(state);
  const persist = () => {
    if (!state.finalResult) return;
    let rows = [];
    try { rows = JSON.parse(storage?.getItem?.(storageKey) || "[]"); } catch { rows = []; }
    if (!Array.isArray(rows)) rows = [];
    rows.push(snapshot());
    storage?.setItem?.(storageKey, JSON.stringify(rows.slice(-100)));
  };
  const stage = ({ startingPosition, target, policy } = {}) => {
    state = { ...state, phase: "staged", startingPosition: clean(startingPosition), target: clean(target), policy: clean(policy), resetChecks: freshChecks(), operatorResult: "", finalResult: "", failureReason: "", episodeSaved: false, faultLatched: false };
    return snapshot();
  };
  const start = ({ runId } = {}) => {
    if (state.phase !== "staged") return snapshot();
    state = { ...state, phase: "running", runId: clean(runId || `hardware-${Date.now().toString(36)}`), startedAt: now().toISOString(), endedAt: "", automatic: { result: "uncertain", confidence: 0, reason: "Run in progress", evidence: [] } };
    return snapshot();
  };
  const complete = ({ result = "uncertain", confidence = 0, reason = "", evidence = [], fault = false } = {}) => {
    if (state.phase !== "running") return snapshot();
    const normalized = RESULTS.has(result) ? result : "uncertain";
    state = { ...state, phase: "review", endedAt: now().toISOString(), automatic: { result: normalized, confidence: Math.max(0, Math.min(1, Number(confidence) || 0)), reason: clean(reason), evidence: (Array.isArray(evidence) ? evidence : []).map((item) => clean(item, 160)).slice(0, 12) }, faultLatched: fault === true };
    return snapshot();
  };
  const review = ({ result, failureReason = "" } = {}) => {
    if (state.phase !== "review" || !RESULTS.has(result)) return snapshot();
    state = { ...state, operatorResult: result, finalResult: result, failureReason: result === "fail" ? clean(failureReason || state.automatic.reason || "operator_marked_failure") : "", episodeSaved: false };
    return snapshot();
  };
  const markEpisodeSaved = (saved = true) => {
    if (state.phase !== "review" || !state.finalResult) return snapshot();
    state = { ...state, episodeSaved: saved === true };
    if (state.episodeSaved) persist();
    return snapshot();
  };
  const setResetCheck = (key, value) => {
    if (!(key in state.resetChecks)) return snapshot();
    state = { ...state, resetChecks: { ...state.resetChecks, [key]: value === true } };
    return snapshot();
  };
  const canReset = () => state.phase === "review" && !!state.finalResult && state.episodeSaved && !state.faultLatched && Object.values(state.resetChecks).every(Boolean);
  const beginReset = () => {
    if (!canReset()) return snapshot();
    state = { ...state, phase: "resetting" };
    return snapshot();
  };
  const resetComplete = () => {
    if (state.phase !== "resetting") return snapshot();
    const retained = { startingPosition: state.startingPosition, target: state.target, policy: state.policy };
    state = { ...createHardwareRunReview({ now, storage, storageKey }).snapshot(), ...retained, phase: "staged" };
    return snapshot();
  };
  const latchFault = (reason = "Safety fault") => {
    state = { ...state, phase: "review", endedAt: state.endedAt || now().toISOString(), automatic: { result: "fail", confidence: 1, reason: clean(reason), evidence: ["Safety fault latched"] }, faultLatched: true };
    return snapshot();
  };
  const clearFaultAfterRecovery = () => {
    if (state.phase === "review" && state.faultLatched) state = { ...state, faultLatched: false };
    return snapshot();
  };
  return { beginReset, canReset, clearFaultAfterRecovery, complete, latchFault, markEpisodeSaved, resetComplete, review, setResetCheck, snapshot, stage, start };
}

export function hardwareReviewMarkup(state) {
  const result = state.finalResult || state.automatic.result || "uncertain";
  const confidence = `${Math.round((Number(state.automatic.confidence) || 0) * 100)}%`;
  return `<section class="robotics-hardware-review" data-hardware-review data-phase="${state.phase}">
    <div class="robotics-section-head"><div><span class="robotics-dashboard-kicker">LEROBOT · PHYSICAL EPISODE</span><strong>Hardware PASS / FAIL review</strong><small>Recording pauses after every episode. Confirm the result before reset or the next run.</small></div><span data-hardware-review-state>${state.phase.toUpperCase()}</span></div>
    <div class="robotics-policy-stats"><div><small>AUTO RESULT</small><strong data-hardware-review-auto>${result.toUpperCase()}</strong></div><div><small>CONFIDENCE</small><strong>${confidence}</strong></div><div><small>START</small><strong>${state.startingPosition || "Not staged"}</strong></div><div><small>POLICY</small><strong>${state.policy || "Not selected"}</strong></div></div>
    <p class="muted small" data-hardware-review-reason>${state.automatic.reason || "Select a starting position to stage hardware."}</p>
    <div class="robotics-policy-actions" data-hardware-review-actions>
      <button type="button" class="btn accent btn-compact" data-hardware-review-result="accept"${state.phase !== "review" ? " disabled" : ""}>Accept ${state.automatic.result.toUpperCase()}</button>
      <button type="button" class="btn secondary btn-compact" data-hardware-review-result="pass"${state.phase !== "review" ? " disabled" : ""}>Mark PASS</button>
      <button type="button" class="btn secondary btn-compact" data-hardware-review-result="fail"${state.phase !== "review" ? " disabled" : ""}>Mark FAIL</button>
      <button type="button" class="btn secondary btn-compact" data-hardware-review-result="uncertain"${state.phase !== "review" ? " disabled" : ""}>Uncertain</button>
      <button type="button" class="btn secondary btn-compact" data-hardware-review-result="discard"${state.phase !== "review" ? " disabled" : ""}>Exclude from training</button>
    </div>
    <label class="muted small">Failure reason <input class="profile-pretty-input" data-hardware-review-failure placeholder="no_grasp, drop, timeout, camera_loss…" /></label>
    <fieldset data-hardware-reset-checks><legend>Reset checklist</legend>${RESET_CHECKS.map(([key, label]) => `<label><input type="checkbox" data-hardware-reset-check="${key}"${state.resetChecks[key] ? " checked" : ""} /> ${label}</label>`).join("")}</fieldset>
    <button type="button" class="btn accent btn-compact" data-hardware-review-reset${state.phase !== "review" || !state.finalResult || !state.episodeSaved || state.faultLatched || !Object.values(state.resetChecks).every(Boolean) ? " disabled" : ""}>Guarded reset for next run</button>
    ${state.faultLatched ? '<p class="robotics-hardware-fault">Safety fault latched. Recover through the existing guarded controls before resetting.</p>' : ""}
  </section>`;
}
