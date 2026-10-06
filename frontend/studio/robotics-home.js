import {
  buildStartPositions,
  readStartPosition,
  runGuardedStartSequence,
  saveStartPosition,
  startPositionValue,
} from "./robot-start-positions.js?v=20260923-real-run1";
import { checklistCanRun, createRobotRunDiagnostics, robotRunChecklist } from "./robot-run-diagnostics.js?v=20260923-home-default1";
import { createPolicyRunDiagnostics } from "./policy-run-diagnostics.js?v=20260928-run-console1";
import { createHardwareRunReview, hardwareReviewMarkup } from "./hardware-run-review.js?v=20260929-lerobot-review1";
import { createDatasetFolder, datasetDestinationStorageKey, datasetFolderStorageKey, normalizeDatasetLibrary, recordingLibraryMarkup, recordingLibrarySummary, selectDatasetDestination } from "./robotics-recording-library.js?v=20260929-dataset-folders2";

function proxyBase(iframe) {
  const match = String(iframe || "").match(/^(\/api\/teleop\/p\/[^/]+\/\d+)/);
  return match?.[1] || "";
}

export function emotePickerItems(emotes = {}, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const seen = new Set();
  return [...(Array.isArray(emotes?.recordings) ? emotes.recordings : []), ...(Array.isArray(emotes?.loops) ? emotes.loops : [])]
    .map((item) => ({
      id: String(item?.id || "").trim(),
      name: String(item?.name || item?.label || item?.id || "").trim(),
      pinned: item?.pinned === true || item?.favorite === true || item?.is_pinned === true,
    }))
    .filter((item) => item.id && !seen.has(item.id) && (seen.add(item.id), true))
    .filter((item) => !needle || `${item.name} ${item.id}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
}

// Successful VR-teleoperated demonstrations published with the official
// OpenArm MuJoCo cube-pick dataset. These are reference/training examples,
// never physical-hardware commands.
export const CURATED_OPENARM_SUCCESS_EXAMPLES = Object.freeze([
  { id: "openarm-official-success-0", name: "Official cube pick · Episode 0", episode_index: 0, samples: 263 },
  { id: "openarm-official-success-3", name: "Official cube pick · Episode 3", episode_index: 3, samples: 264 },
].map((row) => Object.freeze({
  ...row,
  pinned: true,
  official: true,
  training_ready: true,
  success: true,
  outcome: "success",
  joint_count: 16,
  camera_count: 5,
  fps: 30,
  calibrated: true,
  calibration_id: "enactic-openarm-mujoco-cell-demo-v3",
  dataset_repo: "enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot",
  source_url: "https://huggingface.co/datasets/enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot",
})));

export function teleopExampleItems(emotes = {}, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const recordings = [...CURATED_OPENARM_SUCCESS_EXAMPLES, ...(emotes?.recordings || [])];
  const source = { ...emotes, recordings };
  return emotePickerItems(source).map((item) => {
    const raw = [...recordings, ...(emotes?.loops || [])]
      .find((row) => String(row?.id || "") === item.id) || {};
    const jointCount = Array.isArray(raw.joint_names) ? raw.joint_names.length : Math.max(0, Number(raw.joint_count) || 0);
    const samples = Array.isArray(raw.positions) ? raw.positions.length : Math.max(0, Number(raw.samples) || 0);
    const cameraCount = Array.isArray(raw.camera_streams) ? raw.camera_streams.length
      : Array.isArray(raw.cameras) ? raw.cameras.length
      : Math.max(0, Number(raw.camera_count) || 0);
    const hasTiming = (Array.isArray(raw.times) && raw.times.length > 1) || Number(raw.duration_s) > 0 || Number(raw.fps) > 0;
    const hasCalibration = !!(raw.calibration_id || raw.calibration_version || raw.calibrated === true);
    const hasOutcome = typeof raw.success === "boolean" || ["success", "failure"].includes(String(raw.outcome || "").toLowerCase());
    const trainingReady = raw.training_ready === true || (jointCount >= 16 && samples > 1 && cameraCount >= 1 && hasTiming && hasCalibration && hasOutcome);
    return { ...item, official: raw.official === true, episodeIndex: raw.episode_index, jointCount, samples, cameraCount, hasTiming, hasCalibration, hasOutcome, trainingReady };
  }).filter((item) => !needle || `${item.name} ${item.id} ${item.trainingReady ? "training ready" : "motion only"}`.toLowerCase().includes(needle));
}

export function guardedHomeVerified(snapshot) {
  return snapshot?.home_reached === true
    && snapshot?.home_safe_hold === true
    && typeof snapshot?.home_max_error_rad === "number"
    && Number.isFinite(snapshot.home_max_error_rad)
    && Number(snapshot.home_target_joint_count) > 0
    && Number(snapshot.home_feedback_joint_count) === Number(snapshot.home_target_joint_count);
}

export function policyPrograms(snapshot = {}) {
  const rows = Array.isArray(snapshot?.programs) ? snapshot.programs : [];
  const current = snapshot?.program?.id ? [snapshot.program] : [];
  const seen = new Set();
  return [...current, ...rows]
    .map((program) => ({
      id: String(program?.id || "").trim(),
      name: String(program?.name || program?.id || "").trim(),
      validated: program?.validated === true,
      scene: String(program?.scene || snapshot?.deployment?.scene || "").trim(),
      source: String(program?.source || "").trim(),
      samples: Math.max(0, Number(program?.samples) || 0),
      kind: String(program?.kind || "joint_trajectory").trim(),
      checkpoint: String(program?.checkpoint || "").trim(),
      actionSchema: String(program?.action_schema || "").trim(),
      requiredCameras: Array.isArray(program?.required_cameras) ? program.required_cameras.map(String) : [],
      blockers: Array.isArray(program?.blockers) ? program.blockers.map(String) : [],
    }))
    .filter((program) => program.id && !seen.has(program.id) && (seen.add(program.id), true));
}

export const CURATED_OPENARM_CATALOG = Object.freeze([
  {
    key: "verified-replay:openarm-official-success-0",
    id: "openarm-official-success-0",
    name: "Verified cube pick · Episode 0",
    kind: "replay",
    location: "Official OpenArm demonstration",
    runnable: true,
    validated: true,
    scene: "cell/demo.xml",
    episodeIndex: 0,
    samples: 263,
    liftMeters: 0.100436,
    dataset: "enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot",
  },
  {
    key: "verified-replay:openarm-official-success-3",
    id: "openarm-official-success-3",
    name: "Verified cube pick · Episode 3",
    kind: "replay",
    location: "Official OpenArm demonstration",
    runnable: true,
    validated: true,
    scene: "cell/demo.xml",
    episodeIndex: 3,
    samples: 264,
    liftMeters: 0.125354,
    dataset: "enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot",
  },
  {
    key: "hf-model:enactic/act-openarm-2-cell-pick_up_cube_mujoco",
    id: "enactic/act-openarm-2-cell-pick_up_cube_mujoco",
    name: "Validated cube pick · ACT checkpoint",
    kind: "checkpoint",
    location: "Hugging Face",
    runnable: true,
    validated: true,
    validationScope: "simulation",
    scene: "cell/demo.xml",
    source: "enactic/act-openarm-2-cell-pick_up_cube_mujoco",
    samples: 0,
    dataset: "enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot",
    revision: "main",
    url: "https://huggingface.co/enactic/act-openarm-2-cell-pick_up_cube_mujoco",
  },
  {
    key: "hf-dataset:enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot",
    id: "enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot",
    name: "OpenArm MuJoCo Cube Pick · 30 episodes",
    kind: "dataset",
    location: "Hugging Face",
    runnable: false,
    dataset: "enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot",
    source: "MuJoCo · bimanual · five cameras",
    url: "https://huggingface.co/datasets/enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot",
  },
  {
    key: "training-recipe:lerobot/high_quality_folding:act",
    id: "folding-act-training-recipe",
    name: "OpenArms folding · ACT training recipe",
    kind: "recipe",
    location: "DGX Cloud / LeRobot",
    runnable: false,
    validated: false,
    scene: "",
    source: "OpenArms follower · 1,200 episodes · 30 fps",
    samples: 3254196,
    dataset: "lerobot/high_quality_folding",
    revision: "main",
    url: "https://huggingface.co/datasets/lerobot/high_quality_folding",
  },
  {
    key: "hf-dataset:lerobot/high_quality_folding",
    id: "lerobot/high_quality_folding",
    name: "High Quality Folding · 1,200 episodes",
    kind: "dataset",
    location: "Hugging Face",
    runnable: false,
    validated: false,
    dataset: "lerobot/high_quality_folding",
    source: "LeRobot v3 · OpenArms follower · video and joint actions",
    url: "https://huggingface.co/datasets/lerobot/high_quality_folding",
  },
  {
    key: "hf-dataset:qualia-robotics/openarm-cube-in-box-v1",
    id: "qualia-robotics/openarm-cube-in-box-v1",
    name: "OpenArm Cube in Box v1",
    kind: "dataset",
    location: "Hugging Face",
    runnable: false,
    dataset: "qualia-robotics/openarm-cube-in-box-v1",
    source: "MuJoCo · pick and place",
    url: "https://huggingface.co/datasets/qualia-robotics/openarm-cube-in-box-v1",
  },
  {
    key: "hf-dataset:qualia-robotics/openarm-cube-in-box-v2",
    id: "qualia-robotics/openarm-cube-in-box-v2",
    name: "OpenArm Cube in Box v2",
    kind: "dataset",
    location: "Hugging Face",
    runnable: false,
    dataset: "qualia-robotics/openarm-cube-in-box-v2",
    source: "MuJoCo · pick and place",
    url: "https://huggingface.co/datasets/qualia-robotics/openarm-cube-in-box-v2",
  },
  {
    key: "hf-dataset:qualia-robotics/openarm-cube-distractor-lang-v3",
    id: "qualia-robotics/openarm-cube-distractor-lang-v3",
    name: "OpenArm Cube Distractor · Language v3",
    kind: "dataset",
    location: "Hugging Face",
    runnable: false,
    dataset: "qualia-robotics/openarm-cube-distractor-lang-v3",
    source: "MuJoCo · language conditioned",
    url: "https://huggingface.co/datasets/qualia-robotics/openarm-cube-distractor-lang-v3",
  },
]);

export function policyDebugText({ draft = null, selection = null, evaluator = null, simulation = null } = {}) {
  const active = simulation?.activeRun || null;
  const analysis = simulation?.lastAnalysis?.sample || active?.latestSample || null;
  const lines = [
    "Render Studio policy evaluation debug",
    `captured_at=${new Date().toISOString()}`,
    `selected_policy=${selection?.id || draft?.policyCheckpoint || "none"}`,
    `selected_scene=${selection?.scene || draft?.scene || "none"}`,
    `browser_scene=${simulation?.prefs?.scene || active?.scene || "unknown"}`,
    `browser_run_id=${active?.runId || "none"}`,
    `browser_run_status=${active?.status || "unknown"}`,
    `browser_joint_count=${analysis?.joint_count ?? analysis?.joints?.length ?? "unknown"}`,
    `browser_qvel_max=${analysis?.qvel_max ?? "unknown"}`,
    `browser_standstill=${analysis?.standstill ?? "unknown"}`,
    `browser_lifter_height_m=${analysis?.lifter_height_m ?? "unknown"}`,
    `feed_path=${simulation?.feedPath || "unknown"}`,
    `evaluator_status=${evaluator?.status || "unknown"}`,
    `evaluator_checkpoint=${evaluator?.checkpoint || selection?.id || "unknown"}`,
    `evaluator_scene=${evaluator?.scene || selection?.scene || "unknown"}`,
    `evaluator_run_id=${evaluator?.runId || "none"}`,
    `evaluator_started_at=${evaluator?.startedAt || "unknown"}`,
    `evaluator_finished_at=${evaluator?.finishedAt || "unknown"}`,
    `evaluator_exit_code=${evaluator?.exitCode ?? "unknown"}`,
    `evaluator_success=${evaluator?.result?.success ?? "unknown"}`,
    `evaluator_reason=${evaluator?.result?.reason || evaluator?.error || "unknown"}`,
    `evaluator_steps=${evaluator?.result?.steps ?? "unknown"}`,
    `evaluator_peak_cube_z=${evaluator?.result?.peak_cube_z ?? "unknown"}`,
    `evaluator_max_abs_joint_change=${evaluator?.result?.max_abs_joint_change ?? "unknown"}`,
    "visible_motion_bridge=not_connected",
    "physical_runner=locked_unvalidated_checkpoint",
    "note=The browser MuJoCo feed and headless ACT evaluator are separate processes. Browser live samples do not prove policy actions are applied.",
  ];
  return lines.join("\n");
}

export function policyEvaluationStats(evaluation = null) {
  const result = evaluation?.result || {};
  const terminal = evaluation?.status === "completed" || evaluation?.status === "failed";
  const passed = terminal && result.success === true;
  return {
    state: !evaluation || evaluation.status === "idle" ? "NOT RUN" : evaluation.status === "running" ? "RUNNING" : evaluation.status === "stopped" ? "STOPPED" : passed ? "PASS" : "FAIL",
    reason: result.reason || evaluation?.error || (evaluation?.status === "running" ? "Evaluation in progress" : evaluation?.status === "stopped" ? "Stopped by user" : "No evaluation result"),
    steps: result.steps ?? "—",
    simSeconds: Number.isFinite(Number(result.sim_seconds)) ? Number(result.sim_seconds).toFixed(2) : "—",
    wallSeconds: Number.isFinite(Number(result.wall_seconds)) ? Number(result.wall_seconds).toFixed(2) : "—",
    liftMeters: Number.isFinite(Number(result.peak_cube_z)) && Number.isFinite(Number(result.initial_cube_z)) ? (Number(result.peak_cube_z) - Number(result.initial_cube_z)).toFixed(4) : "—",
    requiredLiftMeters: Number.isFinite(Number(result.success_threshold_z)) && Number.isFinite(Number(result.initial_cube_z)) ? (Number(result.success_threshold_z) - Number(result.initial_cube_z)).toFixed(4) : "0.0600",
    jointChange: Number.isFinite(Number(result.max_abs_joint_change)) ? Number(result.max_abs_joint_change).toFixed(4) : "—",
    hardwareValidated: evaluation?.hardwareValidated === true,
    blockers: Array.isArray(evaluation?.hardwareBlockers) ? evaluation.hardwareBlockers : [],
  };
}

export function policyCatalogItems(snapshot = {}, profiles = [], query = "") {
  const runnable = policyPrograms(snapshot).map((program) => ({
    ...program,
    key: `pi:${program.id}`,
    kind: "program",
    location: "Raspberry Pi",
    runnable: snapshot?.ok !== false && program.validated && program.blockers.length === 0,
    dataset: "",
    root: "",
  }));
  const remote = [];
  const seen = new Set(CURATED_OPENARM_CATALOG.filter((item) => item.kind === "checkpoint").map((item) => item.id));
  for (const row of Array.isArray(profiles) ? profiles : []) {
    const profile = row?.profile || {};
    const model = profile?.model || {};
    const repoId = String(model.repo_id || "").trim();
    if (!repoId) continue;
    const revision = String(model.revision || "main").trim();
    if (seen.has(repoId)) continue;
    seen.add(repoId);
    const key = `hf:${repoId}@${revision}`;
    remote.push({
      key,
      id: repoId,
      name: String(model.name || repoId.split("/").at(-1) || repoId),
      kind: "checkpoint",
      location: "Hugging Face",
      runnable: false,
      validated: false,
      scene: String(profile?.simulation?.scene || ""),
      source: repoId,
      samples: 0,
      dataset: String(profile?.dataset?.repo_id || profile?.dataset?.root || ""),
      root: String(row?.root || ""),
      installed: model.installed === true,
      revision,
      url: `https://huggingface.co/${repoId}`,
    });
  }
  const needle = String(query || "").trim().toLowerCase();
  return [...runnable, ...remote, ...CURATED_OPENARM_CATALOG].filter((item) => !needle || [item.name, item.id, item.source, item.dataset, item.scene, item.location, item.kind].join(" ").toLowerCase().includes(needle));
}

export function mountRoboticsHome({ root, api, getProjectId, readDeploymentDraft, saveDeploymentDraft, onOpenSimulation, onStartSimulation, onSetSimulationPaused, onEvaluatePolicy, onPrepareHardwareCandidate, onStopPolicy, onGetPolicyDebug, onReplayExample, onOpenTeleop, onOpenViser, onOpenSplitView, onOpenHardwareWorkspace, onOpenIde, onOpenDatasets, onActivateCameras, onCloseCameras, onStartEvaluationRecording, onPauseEvaluationRecording, onFinishEvaluationRecording, onHardwareReady, onStatus, autoHydrateSavedTarget = false, hardwareRunJournal = null } = {}) {
  if (!root) return null;
  const runLog = root.querySelector("[data-robotics-policy-debug]");
  const runLogDetails = runLog?.closest?.("details");
  const runLogSummary = runLogDetails?.querySelector?.("summary");
  const runLogButton = root.querySelector("[data-robotics-policy-copy-debug]");
  if (runLogSummary) runLogSummary.textContent = "Live run event log";
  if (runLogDetails) runLogDetails.open = true;
  if (runLogButton) runLogButton.textContent = "Copy run log";
  if (runLog) {
    runLog.setAttribute?.("aria-live", "polite");
    runLog.textContent = "No policy run has been triggered yet.";
  }
  const state = {
    connection: "offline",
    safety: "clear",
    hardwareReady: false,
    preflightActive: false,
    mode: "simulation",
    teleopBase: "",
    connectedTarget: "",
    deploymentDraft: null,
    startPositions: buildStartPositions(),
    selectedStart: readStartPosition(),
    policy: null,
    selectedPolicyId: String(readDeploymentDraft?.()?.programId || ""),
    selectedCatalogKey: "",
    policyLiveView: "viser",
    policySearch: "",
    viserWorkspace: {},
    emotes: {},
    selectedExampleIds: new Set(),
    realRunActive: false,
    startPositionsRequest: 0,
    runChecks: { macReachable: null, piReachable: null, piStatus: null, emoteAvailable: false, guardedHomeSupported: null },
    demoPoll: null,
    demoRoot: "references/Robots/OpenArm 2.0/Demos/Demo OpenArm",
    activeDatasetRoot: "",
    activeProjectProfileRoot: "",
    projectProfiles: [],
    lastPolicyEvaluation: null,
    policyCameras: null,
    connectionError: "",
  };
  const q = (selector) => root.querySelector(selector);
  const connected = () => state.connection === "online";
  const killed = () => state.safety === "killed";
  const focus = (selector) => q(selector)?.focus?.();
  const status = (message, kind = "ok") => {
    const el = q("[data-robotics-home-status]");
    if (el) el.textContent = message;
    onStatus?.(kind, message);
  };
  const runDiagnostics = createRobotRunDiagnostics();
  const policyRunDiagnostics = createPolicyRunDiagnostics();
  const hardwareReview = createHardwareRunReview();
  const reviewParent = q("[data-robotics-hardware-review-host]") || q(".robotics-start-position");
  if (reviewParent?.insertAdjacentHTML && !q("[data-hardware-review]")) reviewParent.insertAdjacentHTML("beforeend", hardwareReviewMarkup(hardwareReview.snapshot()));
  const paintHardwareReview = () => {
    const current = q("[data-hardware-review]");
    if (current) current.outerHTML = hardwareReviewMarkup(hardwareReview.snapshot());
  };
  const revealHardwareReview = () => {
    q("[data-hardware-review]")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };
  const selectedPolicyName = () => {
    const selected = policyCatalogItems(state.policy, state.projectProfiles).find((item) => item.key === state.selectedCatalogKey);
    const program = policyPrograms(state.policy).find((item) => item.id === state.selectedPolicyId);
    return selected?.name || program?.name || state.policy?.program?.name || "No physical policy selected";
  };
  const stageHardwareReview = ({ openMonitor = false } = {}) => {
    const position = positionByValue(startPositionValue(state.selectedStart)) || state.startPositions[0];
    hardwareReview.stage({ startingPosition: position?.name || "Home · arms down", target: selectedTarget(), policy: selectedPolicyName() });
    paintHardwareReview();
    if (openMonitor && position?.type !== "viser") {
      void Promise.resolve().then(() => onOpenSplitView?.("viser")).catch(() => {});
      void Promise.resolve().then(() => onActivateCameras?.()).catch(() => {});
    }
  };
  let hardwareWorkspaceOpenPromise = null;
  const openHardwareRunSurfaces = () => {
    if (hardwareWorkspaceOpenPromise) return hardwareWorkspaceOpenPromise;
    hardwareWorkspaceOpenPromise = (async () => {
    onOpenHardwareWorkspace?.();
    hardwareRunJournal?.add?.("live view", "START", "Opening Robotics Home + Viser review surface");
    try {
      const opened = await onOpenSplitView?.("viser");
      hardwareRunJournal?.add?.("live view", opened === false ? "WARN" : "PASS", opened === false ? "Viser split did not open" : "Viser review surface opened");
    } catch (error) {
      hardwareRunJournal?.add?.("live view", "FAIL", "Viser review surface failed", error?.message || error);
    }
    hardwareRunJournal?.add?.("cameras", "START", "Opening unified real-robot camera wall");
    try {
      const opened = await onActivateCameras?.();
      hardwareRunJournal?.add?.("cameras", opened === false ? "WARN" : "PASS", opened === false ? "Camera wall did not open" : "Camera wall opened");
    } catch (error) {
      hardwareRunJournal?.add?.("cameras", "FAIL", "Camera wall failed to open", error?.message || error);
    }
    })().finally(() => { hardwareWorkspaceOpenPromise = null; });
    return hardwareWorkspaceOpenPromise;
  };
  const physicalRunBlockedByReview = () => ["review", "resetting", "running"].includes(hardwareReview.snapshot().phase);
  const startEvaluationRecording = async (context) => {
    if (!onStartEvaluationRecording) return { ok: true };
    try {
      const result = await onStartEvaluationRecording(context);
      if (result?.ok === false) throw new Error(result?.error || "the previous take still needs to be saved");
      return result || { ok: true };
    } catch (error) {
      status(`Physical run blocked because synchronized recording could not start: ${error?.message || "recording unavailable"}.`, "error");
      return { ok: false };
    }
  };
  const selectedTarget = () => String(state.deploymentDraft?.hardwareTarget || q("[data-robotics-home-config]")?.value || "").trim();
  const guardedHomeSupported = (snapshot) => snapshot?.home_supported === true
    || snapshot?.guarded_home === true
    || (Array.isArray(snapshot?.capabilities) && snapshot.capabilities.includes("guarded_home"));
  function currentRunChecklist() {
    const position = positionByValue(startPositionValue(state.selectedStart)) || state.startPositions[0];
    return robotRunChecklist({
      demoLoaded: !!state.deploymentDraft,
      target: selectedTarget(),
      selectionType: position?.type,
      selectionName: position?.name,
      macReachable: state.runChecks.macReachable,
      piReachable: state.runChecks.piReachable,
      piStatus: state.runChecks.piStatus,
      emoteAvailable: state.runChecks.emoteAvailable,
      guardedHomeSupported: state.runChecks.guardedHomeSupported,
    });
  }
  function paintRunDiagnostics() {
    const list = q("[data-robotics-run-checklist]");
    if (list) list.innerHTML = currentRunChecklist().map((row) => `<li data-state="${esc(row.state)}"><span>${row.state === "pass" ? "✓" : row.state === "fail" ? "×" : row.state === "manual" ? "!" : "·"}</span><div><strong>${esc(row.label)}</strong><small>${esc(row.detail)}</small></div></li>`).join("");
    const output = q("[data-robotics-run-debug]");
    if (output) output.textContent = runDiagnostics.text({ target: selectedTarget(), selection: state.selectedStart?.name });
  }
  async function diagnoseRealRun() {
    runDiagnostics.clear();
    state.runChecks = { macReachable: null, piReachable: null, piStatus: null, emoteAvailable: false, guardedHomeSupported: null };
    status("Checking the Mac, Pi, guarded Home program, and selected recording…");
    try {
      const health = await api("/api/health");
      state.runChecks.macReachable = health?.ok !== false;
      runDiagnostics.add("Mac API ping", "PASS", "Render Studio answered");
    } catch (error) {
      state.runChecks.macReachable = false;
      runDiagnostics.add("Mac API ping", "FAIL", error?.message || "health request failed");
    }
    if (!connected()) {
      runDiagnostics.add("Pi connection", "START", selectedTarget() || "target missing");
      if (!await connect()) {
        state.runChecks.piReachable = false;
        runDiagnostics.add("Pi connection", "FAIL", "discovery or teleop ticket failed");
        paintRunDiagnostics();
        return currentRunChecklist();
      }
    }
    try {
      const snapshot = await piStatus();
      state.runChecks.piReachable = true;
      state.runChecks.piStatus = snapshot;
      state.runChecks.guardedHomeSupported = guardedHomeSupported(snapshot);
      runDiagnostics.add("Pi status ping", "PASS", `version=${snapshot.version || snapshot.service_version || "unknown"}; guarded_home=${state.runChecks.guardedHomeSupported}`);
    } catch (error) {
      state.runChecks.piReachable = false;
      state.runChecks.guardedHomeSupported = false;
      runDiagnostics.add("Pi status ping", "FAIL", error?.message || "status request failed");
    }
    if (state.selectedStart?.type === "emote") {
      try {
        const emotes = await piRead("/emotes");
        const ids = new Set([...(emotes.recordings || []), ...(emotes.loops || [])].map((row) => String(row?.id || "")));
        state.runChecks.emoteAvailable = ids.has(String(state.selectedStart.id));
        runDiagnostics.add("VR recording lookup", state.runChecks.emoteAvailable ? "PASS" : "FAIL", state.selectedStart.name);
      } catch (error) {
        state.runChecks.emoteAvailable = false;
        runDiagnostics.add("VR recording lookup", "FAIL", error?.message || "recordings request failed");
      }
    } else {
      runDiagnostics.add("Start action", "PASS", "default guarded arms-down Home only");
    }
    paintRunDiagnostics();
    return currentRunChecklist();
  }
  const bytesLabel = (value) => {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const positionByValue = (value) => state.startPositions.find((position) => startPositionValue(position) === value);
  function paintStartPositions() {
    const select = q("[data-robotics-start-position]");
    const detail = q("[data-robotics-start-detail]");
    if (!select) return;
    const groups = [
      ["Safe default", state.startPositions.filter((position) => position.type === "home")],
      ["Saved Viser positions · planning only", state.startPositions.filter((position) => position.type === "viser")],
      ["VR recordings / Emotes · runnable", state.startPositions.filter((position) => position.type === "emote")],
    ];
    select.innerHTML = groups.filter(([, positions]) => positions.length).map(([label, positions]) => `<optgroup label="${esc(label)}">${positions.map((position) => `<option value="${esc(startPositionValue(position))}">${esc(position.name)}${position.role ? ` · ${esc(position.role)}` : ""}</option>`).join("")}</optgroup>`).join("");
    const selectedValue = startPositionValue(state.selectedStart);
    const selected = positionByValue(selectedValue) || state.startPositions[0];
    state.selectedStart = selected;
    select.value = startPositionValue(selected);
    if (detail) detail.textContent = selected.type === "viser"
      ? "Planning target only. Open it in Viser; it cannot move the real robot until a validated trajectory is attached."
      : selected.type === "emote"
        ? "Real run order: stop all motion → guarded arms-down Home → verify stopped → replay this VR recording."
        : "Home only: stop all motion, then reset both arms to the guarded arms-down pose.";
    const runButton = q("[data-robotics-run-real]");
    if (runButton) runButton.textContent = selected.type === "emote"
      ? `Home, then run “${selected.name}”`
      : selected.type === "viser" ? "Viser target cannot run" : "Run guarded Home";
    paintPolicyRun();
    paintRunDiagnostics();
  }
  function paintEmotePicker(query = q("[data-robotics-emote-search]")?.value || "") {
    const list = q("[data-robotics-emote-list]");
    if (!list) return;
    const items = emotePickerItems(state.emotes, query);
    const selectedValue = startPositionValue(state.selectedStart);
    const group = (folder, rows, active) => `<section><button type="button" class="btn secondary btn-compact" data-robotics-dataset-destination="${esc(folder.id)}" aria-pressed="${folder.id === active.id}">${folder.id === active.id ? "✓ " : ""}📁 ${esc(folder.name)}</button>${rows.map((item) => {
      const selected = selectedValue === `emote:${item.id}`;
      return `<button type="button" class="robotics-emote-file${selected ? " is-selected" : ""}" data-robotics-emote-id="${esc(item.id)}"><span aria-hidden="true">${item.pinned ? "★" : "▤"}</span><strong>${esc(item.name)}</strong>${selected ? "<small>Selected</small>" : ""}</button>`;
    }).join("")}</section>`;
    let savedFolders = [];
    const projectId = String(getProjectId?.() || "global");
    try { savedFolders = JSON.parse(globalThis.localStorage?.getItem(datasetFolderStorageKey(projectId)) || "[]"); } catch { savedFolders = []; }
    const library = normalizeDatasetLibrary(state.emotes, savedFolders);
    const active = selectDatasetDestination(library, globalThis.localStorage?.getItem(datasetDestinationStorageKey(projectId)) || "emotes");
    const folderByRecording = new Map(library.recordings.map((item) => [String(item.id), item.folderId]));
    list.innerHTML = library.folders.map((folder) => group(folder, items.filter((item) => folderByRecording.get(String(item.id)) === folder.id), active)).join("")
      + (!items.length ? `<p class="robotics-emote-empty">${connected() ? "No matching recordings. Choose a folder for the next take." : "Choose a destination now; connect the Pi to load recordings."}</p>` : "");
  }
  function createRecordingFolder() {
    const name = globalThis.prompt?.("Folder name", "Cube test");
    if (!name) return;
    const projectId = String(getProjectId?.() || "global");
    let folders = [];
    try { folders = JSON.parse(globalThis.localStorage?.getItem(datasetFolderStorageKey(projectId)) || "[]"); } catch { folders = []; }
    const library = normalizeDatasetLibrary(state.emotes, folders);
    const folder = createDatasetFolder(name, library.folders);
    if (!folder) return;
    try {
      globalThis.localStorage?.setItem(datasetFolderStorageKey(projectId), JSON.stringify([...folders, folder]));
      globalThis.localStorage?.setItem(datasetDestinationStorageKey(projectId), folder.id);
    } catch { /* optional local preference */ }
    paintEmotePicker();
    status(`${folder.name} created and selected as the recording destination.`);
  }
  function selectRecordingDestination(id) {
    const projectId = String(getProjectId?.() || "global");
    try { globalThis.localStorage?.setItem(datasetDestinationStorageKey(projectId), String(id || "emotes")); } catch { /* optional local preference */ }
    paintEmotePicker();
  }
  async function openEmotePicker() {
    await refreshStartPositions({ includeEmotes: connected() });
    const dialog = q("[data-robotics-emote-picker]");
    const search = q("[data-robotics-emote-search]");
    if (search) search.value = "";
    paintEmotePicker();
    dialog?.showModal?.();
    search?.focus?.();
  }
  function selectEmote(id) {
    const selected = positionByValue(`emote:${String(id || "")}`);
    if (!selected) return;
    state.selectedStart = selected;
    saveStartPosition(selected);
    paintStartPositions();
    q("[data-robotics-emote-picker]")?.close?.();
    status(`${selected.name} saved as the starting position for Robotics Home and VR.`);
  }
  const exampleStorageKey = () => `render3d:robotics:teleop-examples:${String(getProjectId?.() || "global")}`;
  function readSelectedExamples() {
    try {
      const value = JSON.parse(globalThis.localStorage?.getItem(exampleStorageKey()) || "[]");
      state.selectedExampleIds = new Set(Array.isArray(value) ? value.map(String) : []);
    } catch { state.selectedExampleIds = new Set(); }
  }
  function saveSelectedExamples() {
    try { globalThis.localStorage?.setItem(exampleStorageKey(), JSON.stringify([...state.selectedExampleIds])); } catch { /* optional preference */ }
  }
  function paintRecordingLibrary() {
    const list = q("[data-robotics-library-list]");
    const summary = q("[data-robotics-library-summary]");
    if (!list) return;
    const items = teleopExampleItems(state.emotes);
    list.innerHTML = recordingLibraryMarkup({
      items,
      selectedIds: state.selectedExampleIds,
      query: q("[data-robotics-library-search]")?.value || "",
      filter: q("[data-robotics-library-filter]")?.value || "all",
      connected: connected(),
    });
    if (summary) summary.textContent = recordingLibrarySummary(items, state.selectedExampleIds);
  }
  function paintExamplePicker(query = q("[data-robotics-example-search]")?.value || "") {
    const list = q("[data-robotics-example-list]");
    const summary = q("[data-robotics-example-summary]");
    if (!list) return;
    const items = teleopExampleItems(state.emotes, query);
    const readySelected = items.filter((item) => state.selectedExampleIds.has(item.id) && item.trainingReady).length;
    if (summary) summary.textContent = `${state.selectedExampleIds.size} selected · ${readySelected} training-ready. Motion-only Emotes can replay, but need synchronized cameras, calibration, and an outcome before training.`;
    list.innerHTML = items.length ? items.map((item) => {
      const selected = state.selectedExampleIds.has(item.id);
      const detail = item.trainingReady
        ? `${item.samples} samples · ${item.cameraCount} camera${item.cameraCount === 1 ? "" : "s"} · ${item.official ? "official successful demo" : "outcome labeled"}`
        : `${item.samples || "unknown"} joint samples · ${item.cameraCount} cameras · missing training metadata`;
      return `<button type="button" class="robotics-emote-file${selected ? " is-selected" : ""}" data-robotics-example-id="${esc(item.id)}" aria-pressed="${selected}"><span aria-hidden="true">${selected ? "✓" : item.trainingReady ? "●" : "◌"}</span><strong>${esc(item.name)}<br><small>${esc(detail)}</small></strong><small>${item.trainingReady ? "TRAINING READY" : "MOTION ONLY"}</small></button>`;
    }).join("") : `<p class="robotics-emote-empty">${connected() ? "No matching teleop examples." : "Connect the Pi to load teleop examples."}</p>`;
  }
  async function openExamplePicker() {
    await refreshStartPositions({ includeEmotes: connected() });
    readSelectedExamples();
    const search = q("[data-robotics-example-search]");
    if (search) search.value = "";
    paintExamplePicker();
    q("[data-robotics-example-picker]")?.showModal?.();
    search?.focus?.();
  }
  function toggleExample(id) {
    const key = String(id || "");
    if (!key) return;
    if (state.selectedExampleIds.has(key)) state.selectedExampleIds.delete(key);
    else state.selectedExampleIds.add(key);
    saveSelectedExamples();
    paintExamplePicker();
    paintRecordingLibrary();
  }
  async function refreshStartPositions({ includeEmotes = connected() } = {}) {
    const request = ++state.startPositionsRequest;
    let viserWorkspace = {};
    let emotes = {};
    try { viserWorkspace = await api("/api/robotics/workspace") || {}; } catch { viserWorkspace = {}; }
    if (includeEmotes) {
      try { emotes = await piRead("/emotes"); }
      catch (error) {
        if (request === state.startPositionsRequest) {
          status(`Viser positions loaded, but VR recordings could not be read from the Pi: ${error?.message || "unavailable"}.`, "error");
        }
      }
    }
    if (request !== state.startPositionsRequest) return state.startPositions;
    state.viserWorkspace = viserWorkspace;
    state.emotes = emotes;
    state.startPositions = buildStartPositions(state.viserWorkspace, state.emotes);
    const saved = readStartPosition();
    state.selectedStart = positionByValue(startPositionValue(saved)) || state.startPositions[0];
    paintStartPositions();
    paintRecordingLibrary();
    return state.startPositions;
  }
  async function refreshProjectProfiles(selectedRoot = "") {
    const pid = getProjectId?.();
    const select = q("[data-robotics-profile-select]");
    if (!pid || !select) return [];
    const data = await api(`/api/projects/${encodeURIComponent(pid)}/robotics/profiles`);
    const profiles = data?.profiles || [];
    state.projectProfiles = profiles;
    const preferredRoot = selectedRoot || state.activeProjectProfileRoot;
    select.innerHTML = profiles.length
      ? profiles.slice(0, 8).map((row, index) => `<option value="${esc(row.root)}"${row.root === preferredRoot ? " selected" : ""}>${index < 3 ? "Recent · " : ""}${esc(row.name)}</option>`).join("")
      : '<option value="">No project profile found</option>';
    if (preferredRoot && profiles.some((row) => row.root === preferredRoot)) select.value = preferredRoot;
    else if (profiles[0]) select.value = profiles[0].root;
    paintPolicyExplorer();
    return profiles;
  }
  function paintDemo(demo) {
    if (demo?.root) state.demoRoot = String(demo.root);
    const stateEl = q("[data-robotics-demo-state]");
    const message = q("[data-robotics-demo-message]");
    const log = q("[data-robotics-demo-log]");
    const install = q("[data-robotics-demo-install]");
    if (stateEl) stateEl.textContent = `Demo OpenArm · ${String(demo?.state || "not installed").replace("_", " ")}`;
    if (message) message.textContent = demo?.message || "30 LeRobot v3 cube-pick episodes · MuJoCo · five camera streams";
    if (log) log.textContent = (demo?.logs || []).join("\n") || "Install logs will appear here.";
    if (install) {
      install.disabled = demo?.state === "installing";
      install.textContent = demo?.state === "ready" ? "Reinstall Demo OpenArm" : demo?.state === "installing" ? `Installing… ${demo?.progress || 0}%` : "Install Demo OpenArm";
    }
  }
  async function refreshDemo({ poll = false } = {}) {
    const pid = getProjectId?.();
    if (!pid) return null;
    try {
      const data = await api(`/api/projects/${encodeURIComponent(pid)}/robotics/demo/openarm/status`);
      const demo = data?.demo || {};
      paintDemo(demo);
      if (demo.state === "ready") await refreshProjectProfiles(demo.root);
      if (poll && demo.state === "installing") {
        clearTimeout(state.demoPoll);
        state.demoPoll = setTimeout(() => void refreshDemo({ poll: true }), 1200);
      }
      return demo;
    } catch (error) {
      paintDemo({ state: "error", message: error?.message || "Could not read demo install status.", logs: [] });
      return null;
    }
  }
  async function installDemo() {
    const pid = getProjectId?.();
    if (!pid) {
      const error = "Open a project before installing Demo OpenArm.";
      status(error, "error");
      return { ok: false, error };
    }
    status("Creating Demo OpenArm, indexing Hugging Face sources, and copying the MuJoCo bundle in the background…");
    try {
      const data = await api(`/api/projects/${encodeURIComponent(pid)}/robotics/demo/openarm/install`, { method: "POST" });
      paintDemo(data?.demo || { state: "installing", message: "Demo install queued.", logs: [] });
      void refreshDemo({ poll: true });
      return { ok: true, demo: data?.demo || null, message: "Demo OpenArm installation started." };
    } catch (error) {
      status(error?.message || "Could not start the Demo OpenArm install.", "error");
      return { ok: false, error: error?.message || "Could not start the Demo OpenArm install." };
    }
  }
  async function activateProjectProfile() {
    const pid = getProjectId?.();
    const rootPath = String(q("[data-robotics-profile-select]")?.value || "");
    if (!pid || !rootPath) {
      const error = "Choose a project robotics profile first.";
      status(error, "error");
      return { ok: false, error };
    }
    try {
      const data = await api(`/api/projects/${encodeURIComponent(pid)}/robotics/profiles/activate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root: rootPath }) });
      const profile = data?.selected?.profile || {};
      const home = profile.home || {};
      state.activeProjectProfileRoot = rootPath;
      state.activeDatasetRoot = String(profile.dataset?.root || state.activeDatasetRoot || "");
      const scene = String(profile.simulation?.scene || "").trim();
      const checkpoint = String(profile.model?.repo_id || "").trim();
      const matchingCheckpoint = CURATED_OPENARM_CATALOG.find((item) => item.kind === "checkpoint" && item.id === checkpoint);
      if (scene) {
        state.deploymentDraft = saveDeploymentDraft?.({
          ...state.deploymentDraft,
          engine: "mujoco",
          scene,
          label: String(data?.selected?.name || profile.name || "Robotics profile"),
          sourcePath: scene,
          policyCheckpoint: checkpoint,
          policyDataset: String(profile.dataset?.repo_id || profile.dataset?.root || ""),
        }) || state.deploymentDraft;
        refreshDeploymentDraft(state.deploymentDraft);
      }
      if (matchingCheckpoint) {
        state.selectedCatalogKey = matchingCheckpoint.key;
        state.selectedPolicyId = "";
        paintPolicyRun();
      }
      if (home.config_url && q("[data-robotics-home-config]")) q("[data-robotics-home-config]").value = home.config_url;
      if (home.hardware_target && q("[data-robotics-hardware-target]")) q("[data-robotics-hardware-target]").value = home.hardware_target;
      if (home.start_position) {
        const position = positionByValue(home.start_position);
        if (position) { state.selectedStart = position; saveStartPosition(position); paintStartPositions(); }
      }
      await api("/api/users/me/robotics-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeDatasetRoot: state.activeDatasetRoot, activeProjectProfileRoot: rootPath }),
      });
      status(`${data?.selected?.name || "Project profile"} loaded: ${profile.dataset?.format || "dataset"} · ${profile.task || "robotics task"}. The profile ACT checkpoint is selected for simulation evaluation. Hardware remains disconnected.`);
      await refreshDatasets();
      return { ok: true, selected: data?.selected || null, hardware: "disconnected" };
    } catch (error) {
      status(error?.message || "Could not load the project robotics profile.", "error");
      return { ok: false, error: error?.message || "Could not load the project robotics profile." };
    }
  }
  async function saveProjectProfile() {
    const pid = getProjectId?.();
    const nameInput = q("[data-robotics-profile-name]");
    const name = String(nameInput?.value || "").trim();
    if (!pid || !name) {
      status(pid ? "Enter a profile name, then choose Save as new." : "Open a project before saving a robotics profile.", "error");
      nameInput?.focus?.();
      return { ok: false };
    }
    try {
      const data = await api(`/api/projects/${encodeURIComponent(pid)}/robotics/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          base_root: String(q("[data-robotics-profile-select]")?.value || ""),
          settings: {
            dataset_root: state.activeDatasetRoot,
            config_url: String(q("[data-robotics-home-config]")?.value || ""),
            hardware_target: selectedTarget(),
            start_position: startPositionValue(state.selectedStart),
          },
        }),
      });
      const saved = data?.saved || {};
      state.activeProjectProfileRoot = String(saved.root || "");
      if (nameInput) nameInput.value = "";
      await api("/api/users/me/robotics-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeProjectProfileRoot: state.activeProjectProfileRoot }),
      });
      await refreshProjectProfiles(state.activeProjectProfileRoot);
      status(`${saved.name || name} saved in Project Explorer at ${saved.root || "references/Robots/Saved Profiles"}.`);
      if (saved.root) onOpenDatasets?.(saved.root);
      return { ok: true, saved };
    } catch (error) {
      status(error?.message || "Could not save the robotics profile.", "error");
      return { ok: false, error: error?.message || "Could not save the robotics profile." };
    }
  }
  async function refreshDatasets() {
    const pid = getProjectId?.();
    const list = q("[data-robotics-dataset-list]");
    if (!pid) {
      if (list) list.innerHTML = '<p class="muted small">Open a project to load robot-learning datasets.</p>';
      return [];
    }
    try {
      const data = await api(`/api/projects/${encodeURIComponent(pid)}/robotics/datasets`);
      const datasets = data?.datasets || [];
      const picker = q("[data-robotics-dataset-select]");
      const roots = new Set(datasets.map((row) => String(row.root || "")));
      if (!roots.has(state.activeDatasetRoot)) state.activeDatasetRoot = String(datasets[0]?.root || "");
      if (picker) {
        picker.innerHTML = datasets.length
          ? datasets.map((row) => `<option value="${esc(row.root)}">${esc(row.name)}</option>`).join("")
          : '<option value="">No dataset folders loaded</option>';
        picker.value = state.activeDatasetRoot;
      }
      const totals = datasets.reduce((out, row) => ({ bytes: out.bytes + Number(row.bytes || 0), episodes: out.episodes + Number(row.episodes || 0), successes: out.successes + Number(row.successes || 0), failures: out.failures + Number(row.failures || 0) }), { bytes: 0, episodes: 0, successes: 0, failures: 0 });
      if (q("[data-robotics-stat-datasets]")) q("[data-robotics-stat-datasets]").textContent = String(datasets.length);
      if (q("[data-robotics-stat-episodes]")) q("[data-robotics-stat-episodes]").textContent = String(totals.episodes);
      if (q("[data-robotics-stat-storage]")) q("[data-robotics-stat-storage]").textContent = bytesLabel(totals.bytes);
      const labeled = totals.successes + totals.failures;
      if (q("[data-robotics-stat-success]")) q("[data-robotics-stat-success]").textContent = labeled ? `${Math.round(100 * totals.successes / labeled)}%` : "—";
      if (list) list.innerHTML = datasets.length ? datasets.map((row) => `<button type="button" class="robotics-dataset-row" data-dataset-root="${esc(row.root)}"><span><strong>${esc(row.name)}</strong><small>${row.episodes || 0} episodes · ${row.videos || 0} camera streams · ${row.storage === "hub_stream" ? "Hub streaming" : `${row.files || 0} local files`}</small></span><b>${row.storage === "hub_stream" ? `REMOTE · ${bytesLabel(row.remote_bytes)}` : bytesLabel(row.bytes)}</b></button>`).join("") : '<p class="muted small">No training datasets loaded in this project.</p>';
      return datasets;
    } catch (error) {
      if (list) list.innerHTML = `<p class="status error small">${esc(error?.message || "Could not load datasets.")}</p>`;
      return [];
    }
  }

  async function saveActiveDatasetRoot(rootPath, { open = false } = {}) {
    const rootValue = String(rootPath || "").trim();
    if (!rootValue) return false;
    state.activeDatasetRoot = rootValue;
    const picker = q("[data-robotics-dataset-select]");
    if (picker) picker.value = rootValue;
    try {
      await api("/api/users/me/robotics-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeDatasetRoot: rootValue }),
      });
    } catch (error) {
      status(error?.message || "Could not save the selected dataset folder.", "error");
      return false;
    }
    if (open) onOpenDatasets?.(rootValue);
    return true;
  }

  async function hydrateDatasets() {
    try {
      const prefs = (await api("/api/users/me/robotics-prefs"))?.prefs || {};
      state.activeDatasetRoot = String(prefs.activeDatasetRoot || "");
      state.activeProjectProfileRoot = String(prefs.activeProjectProfileRoot || "");
    } catch { /* Dataset discovery still works when preferences are unavailable. */ }
    return refreshDatasets();
  }

  async function inspectSetup() {
    const pid = getProjectId?.();
    if (!pid) return { project_open: false, demo: { state: "unavailable" }, datasets: [], profiles: [], simulation_mode: state.mode };
    const demo = await refreshDemo();
    const profiles = await refreshProjectProfiles(demo?.root || "").catch(() => []);
    const datasets = await refreshDatasets();
    return {
      project_open: true,
      project_id: pid,
      demo: demo || { state: "unknown" },
      datasets: datasets || [],
      profiles: (profiles || []).map((row) => ({ name: row.name, root: row.root })),
      selected_profile_root: String(q("[data-robotics-profile-select]")?.value || ""),
      simulation_mode: state.mode,
      hardware_connected: connected(),
      hardware_motion_available_by_voice: false,
    };
  }
  async function importDataset(files) {
    const pid = getProjectId?.();
    if (!pid || !files?.length) return;
    const paths = files.map((file) => file.webkitRelativePath || file.name);
    const first = paths[0] || "dataset";
    const name = first.includes("/") ? first.split("/")[0] : first.replace(/\.(zip|parquet|jsonl?|mp4|mcap|db3|hdf5|h5)$/i, "");
    const body = new FormData();
    files.forEach((file) => body.append("uploads", file));
    body.append("paths", JSON.stringify(paths));
    body.append("name", name || "dataset");
    status(`Importing ${files.length} dataset file${files.length === 1 ? "" : "s"}…`);
    try {
      const result = await api(`/api/projects/${encodeURIComponent(pid)}/robotics/datasets/upload`, { method: "POST", body });
      state.activeDatasetRoot = String(result.root || "");
      await api("/api/users/me/robotics-prefs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activeDatasetRoot: result.root }) });
      status(`Dataset ${result.name} imported · ${result.files} files · ${bytesLabel(result.bytes)}.`);
      await refreshDatasets();
    } catch (error) {
      status(error?.message || "Dataset import failed.", "error");
    }
  }
  const refreshDeploymentDraft = (draft = readDeploymentDraft?.() || null) => {
    state.deploymentDraft = draft;
    const card = q("[data-robotics-deployment]");
    const label = q("[data-robotics-deployment-label]");
    const source = q("[data-robotics-deployment-source]");
    const target = q("[data-robotics-hardware-target]");
    card?.classList.toggle("is-empty", !draft);
    if (label) label.textContent = draft?.label || "No demo loaded";
    if (source) source.textContent = draft ? `${draft.sourcePath} · Simulation scene only` : "Load a scene from the MuJoCo tab.";
    if (target) target.value = draft?.hardwareTarget || "";
    return draft;
  };
  const paint = () => {
    root.dataset.roboticsConnection = state.connection;
    root.dataset.roboticsSafety = state.safety;
    root.dataset.roboticsHardwareReady = String(state.hardwareReady);
    const label = q("[data-robotics-home-state]");
    if (label) label.textContent = killed() ? "FAULT · KILL LATCHED" : connected() ? `${state.mode.toUpperCase()} · PI ONLINE` : "DISCONNECTED";
    root.querySelectorAll("[data-robotics-mode]").forEach((button) => {
      const mode = button.dataset.roboticsMode;
      button.classList.toggle("is-active", mode === state.mode);
      button.setAttribute("aria-pressed", String(mode === state.mode));
      button.removeAttribute("disabled");
    });
    q("[data-robotics-home-sync]")?.removeAttribute("disabled");
    q("[data-robotics-home-pose]")?.removeAttribute("disabled");
    q("[data-robotics-home-recover]")?.removeAttribute("disabled");
    const robotTask = q("[data-robotics-task-robot]");
    if (robotTask) robotTask.textContent = `${connected() ? "Connected" : "Disconnected"} · ${state.mode} mode`;
    const source = q("[data-robotics-stat-source]");
    if (source) source.textContent = state.mode === "hardware" ? "REAL" : state.mode === "shadow" ? "SHADOW" : "SIM";
    paintPolicyRun();
  };

  function paintPolicyRun() {
    const button = q("[data-robotics-run-policy]");
    const detail = q("[data-robotics-policy-detail]");
    const select = q("[data-robotics-policy-select]");
    const hardwareSelect = q("[data-robotics-hardware-policy-select]");
    const current = q("[data-robotics-policy-current]");
    const badge = q("[data-robotics-policy-state]");
    const stopButton = q("[data-robotics-stop-policy]");
    if (!button) return;
    const programs = policyPrograms(state.policy);
    const availableCheckpoints = policyCatalogItems(state.policy, state.projectProfiles).filter((item) => ["replay", "checkpoint"].includes(item.kind) && item.validated === true);
    const catalogSelection = availableCheckpoints.find((item) => item.key === state.selectedCatalogKey) || null;
    const selectedId = state.selectedPolicyId || String(state.policy?.program?.id || "");
    const program = programs.find((item) => item.id === selectedId) || programs[0] || null;
    if (!catalogSelection) state.selectedPolicyId = program?.id || "";
    const runnable = state.policy?.runnable === true && !!program?.id && program.validated === true && program.blockers.length === 0;
    const replaying = catalogSelection?.kind === "replay";
    const evaluating = catalogSelection?.kind === "checkpoint";
    if (select) {
      const choices = availableCheckpoints.map((item) => `<option value="${esc(item.key)}">${esc(item.name)} · ${esc(item.scene || "scene not assigned")}</option>`);
      select.innerHTML = choices.length
        ? choices.join("")
        : '<option value="">No simulation policy available</option>';
      select.value = catalogSelection?.key || "";
      select.disabled = !choices.length || state.realRunActive;
    }
    if (hardwareSelect) {
      const choices = programs.map((item) => {
        const executable = item.validated === true && item.blockers.length === 0;
        const stateLabel = executable ? "READY" : `BLOCKED${item.blockers[0] ? ` · ${item.blockers[0]}` : ""}`;
        return `<option value="${esc(item.id)}"${executable ? "" : " disabled"}>${esc(item.name)} · ${stateLabel}</option>`;
      });
      hardwareSelect.innerHTML = choices.length
        ? `<option value="">Choose a Pi executable policy</option>${choices.join("")}`
        : `<option value="">${connected() ? "No Pi hardware policies installed" : "Connect the Pi to load hardware policies"}</option>`;
      hardwareSelect.value = program?.id || "";
      hardwareSelect.disabled = !connected() || !choices.length || state.realRunActive;
    }
    button.disabled = replaying || evaluating ? state.realRunActive : (!connected() || !runnable || state.realRunActive);
    button.textContent = state.realRunActive ? (evaluating ? "ACT running…" : "Example running…") : replaying ? "Run example" : evaluating ? "Run ACT evaluation" : "Run selected policy";
    if (stopButton) stopButton.disabled = !state.realRunActive && state.lastPolicyEvaluation?.status !== "running";
    if (current) current.textContent = catalogSelection
      ? `${catalogSelection.name} · ${replaying ? "verified demonstration" : "simulation validated"}`
      : program ? `${program.name} · ${program.samples} samples${program.validated ? "" : " · blocked candidate"}` : "No policy selected";
    if (badge) {
      badge.textContent = replaying ? "VERIFIED" : evaluating ? "SIM READY" : runnable ? "READY" : "NOT READY";
      badge.dataset.state = replaying || evaluating || runnable ? "ready" : "blocked";
    }
    if (detail) detail.textContent = replaying
      ? `${catalogSelection.scene} · verified example · measured ${(catalogSelection.liftMeters * 100).toFixed(1)} cm cube lift.`
      : evaluating
      ? `${catalogSelection.scene} · validated ACT simulation. The evaluator measures a sustained cube lift; physical deployment remains blocked.`
      : runnable
      ? `${program.scene || "MuJoCo scene"} · ${program.source || "Pi-hosted program"}. Run opens cameras and ${state.policyLiveView === "viser" ? "Viser telemetry" : "the MuJoCo reference"}, then performs KILL → guarded Home → policy.`
      : program?.blockers?.length
      ? `Hardware candidate is stored on the Pi but cannot run. ${program.blockers[0]}.`
      : "Connect the Pi and bind a validated joint policy before physical execution.";
    const stats = policyEvaluationStats(state.lastPolicyEvaluation);
    const setStat = (name, value) => { const el = q(`[data-robotics-policy-stat-${name}]`); if (el) el.textContent = String(value); };
    setStat("state", stats.state);
    setStat("reason", stats.reason);
    setStat("steps", stats.steps);
    setStat("sim", stats.simSeconds);
    setStat("wall", stats.wallSeconds);
    setStat("lift", `${stats.liftMeters} m / ${stats.requiredLiftMeters} m required`);
    setStat("joint", `${stats.jointChange} rad`);
    setStat("hardware", stats.hardwareValidated ? "READY" : "BLOCKED");
    const runSnapshot = policyRunDiagnostics.snapshot();
    setStat("run-id", runSnapshot?.id || "—");
    setStat("cameras", runSnapshot?.cameras?.label || "NOT CHECKED");
    const runLog = q("[data-robotics-policy-debug]");
    if (runLog) runLog.textContent = policyRunDiagnostics.text();
    const validate = q("[data-robotics-policy-validate]");
    if (validate) validate.disabled = !state.lastPolicyEvaluation || state.lastPolicyEvaluation.status === "running";
    paintPolicyExplorer();
  }

  function monitorPolicyRun(kind = "mujoco", { cameras = false } = {}) {
    policyRunDiagnostics.add("layout", "START", `Opening Robotics Home + ${kind === "mujoco" ? "MuJoCo" : "Viser"} split`);
    paintPolicyRun();
    void Promise.resolve().then(() => onOpenSplitView?.(kind)).then((opened) => {
      policyRunDiagnostics.add("layout", opened === false ? "WARN" : "PASS", opened === false ? "Split view did not open" : "Right-side live view opened");
      paintPolicyRun();
    }).catch((error) => {
      policyRunDiagnostics.add("layout", "WARN", error?.message || "Split view failed");
      paintPolicyRun();
    });
    if (!cameras) {
      onCloseCameras?.();
      policyRunDiagnostics.skipCameras();
      paintPolicyRun();
      return;
    }
    void Promise.resolve().then(() => onActivateCameras?.()).then(async () => {
      policyRunDiagnostics.add("cameras", "START", "Unified robot camera view opened");
      try {
        const cameras = await api("/api/robotics/camera-wall/status");
        if (cameras) policyRunDiagnostics.setCameras(cameras);
      } catch (error) {
        policyRunDiagnostics.add("cameras", "WARN", error?.message || "Camera readiness check failed");
      }
      paintPolicyRun();
    }).catch((error) => {
      policyRunDiagnostics.add("cameras", "WARN", error?.message || "Camera view failed to open");
      paintPolicyRun();
    });
  }

  function paintPolicyExplorer() {
    const list = q("[data-robotics-policy-list]");
    if (!list) return;
    const items = policyCatalogItems(state.policy, state.projectProfiles, state.policySearch).filter((item) => (["replay", "checkpoint"].includes(item.kind) && item.validated === true) || ["program", "recipe", "dataset"].includes(item.kind));
    list.innerHTML = items.length ? items.map((item) => `
      <div class="robotics-policy-row-wrap">
      <button type="button" class="robotics-policy-row${state.selectedCatalogKey === item.key ? " is-selected" : ""}" data-policy-key="${esc(item.key)}"${item.kind === "program" ? ` data-policy-program-id="${esc(item.id)}"` : ""}${item.root ? ` data-policy-root="${esc(item.root)}"` : ""}>
        <span><strong>${esc(item.name)}</strong><small>${esc(item.location)} · ${item.kind === "program" ? `${item.samples} command frames` : item.kind === "replay" ? `${item.samples} recorded frames · ${(item.liftMeters * 100).toFixed(1)} cm lift` : item.kind === "dataset" ? esc(item.source) : `checkpoint ${String(item.revision || "main").slice(0, 12)}`}${item.dataset && item.kind !== "dataset" ? ` · dataset ${esc(item.dataset)}` : ""}</small></span>
        <b data-state="${item.kind === "replay" || item.runnable ? "ready" : item.kind === "dataset" ? "dataset" : "evaluate"}">${item.kind === "replay" ? "VERIFIED" : item.kind === "checkpoint" && item.validated ? "SIM VALIDATED" : item.runnable ? "RUNNABLE" : item.kind === "program" ? "BLOCKED" : item.kind === "dataset" ? "DATASET" : item.kind === "recipe" ? "TRAIN FIRST" : "EXPERIMENTAL"}</b>
      </button>${item.url ? `<a class="robotics-policy-source" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" title="View source on Hugging Face">↗</a>` : ""}</div>`).join("") : `<p class="robotics-policy-empty">${state.policySearch ? "No policies match this search." : "Connect the Pi or install Demo OpenArm to discover policies."}</p>`;
  }

  function selectCatalogItem(key) {
    const item = policyCatalogItems(state.policy, state.projectProfiles).find((row) => row.key === String(key || ""));
    if (!item) return;
    if (item.kind === "recipe") {
      status(`${item.name} is ready as a cloud training recipe. It is not a checkpoint yet. Train it, map OpenArms follower joints to OpenArm 2.0, then validate it in a folding scene before running.`);
      globalThis.__openRoboticsCloud?.();
      return;
    }
    if (item.kind === "dataset") {
      status(`${item.name} is demonstration data, not an executable policy. Opening its training-data context.`);
      onOpenDatasets?.(state.demoRoot);
      return;
    }
    state.selectedCatalogKey = item.key;
    state.selectedPolicyId = "";
    state.deploymentDraft = saveDeploymentDraft?.({ ...state.deploymentDraft, engine: "mujoco", scene: item.scene, label: item.name, sourcePath: item.scene, policyCheckpoint: item.id, policyDataset: item.dataset }) || state.deploymentDraft;
    paintPolicyRun();
    status(`${item.name} selected. Run Example loads its matched MuJoCo scene and does not move hardware.`);
  }

  async function selectPolicyProgram(programId) {
    state.selectedCatalogKey = "";
    state.selectedPolicyId = String(programId || "");
    state.deploymentDraft = saveDeploymentDraft?.({ ...state.deploymentDraft, programId: state.selectedPolicyId }) || {
      ...state.deploymentDraft,
      programId: state.selectedPolicyId,
    };
    status("Binding the selected policy to this robot…");
    try {
      await refreshSimulationPolicy({ bindDraft: true });
      status(`Selected policy ready: ${state.policy?.program?.name || state.selectedPolicyId}.`);
    } catch (error) {
      status(`Policy could not be bound: ${error?.message || "Pi unavailable"}.`, "error");
    }
  }

  function openPolicyLiveView() {
    onActivateCameras?.();
    if (state.policyLiveView === "mujoco") onOpenSimulation?.();
    else onOpenViser?.();
  }

  async function evaluateSelectedPolicy() {
    const selection = policyCatalogItems(state.policy, state.projectProfiles).find((item) => item.key === state.selectedCatalogKey && ["checkpoint", "replay"].includes(item.kind));
    if (selection?.kind === "replay") {
      policyRunDiagnostics.start({ policy: selection.name, scene: selection.scene, mode: "verified-replay" });
      state.realRunActive = true;
      state.policyLiveView = "mujoco";
      paintPolicyRun();
      status(`Loading ${selection.name}…`);
      monitorPolicyRun("mujoco");
      try {
        // Stop only a run that this view knows is active. An idle local replay
        // must not depend on the authenticated headless-evaluator endpoint.
        if (state.lastPolicyEvaluation?.status === "running") {
          try { await onStopPolicy?.(); } catch { /* the local replay remains usable */ }
        }
        policyRunDiagnostics.setRun(`official-episode-${selection.episodeIndex}`);
        paintPolicyRun();
        const replayed = await onReplayExample?.(selection.episodeIndex);
        if (!replayed) throw new Error("verified example did not start");
        state.lastPolicyEvaluation = {
          status: "completed",
          simulationPassed: true,
          checkpoint: selection.id,
          scene: selection.scene,
          result: {
            success: true,
            reason: "verified_demonstration_replay",
            steps: selection.samples,
            sim_seconds: selection.samples / 30,
            initial_cube_z: 1.05,
            peak_cube_z: 1.05 + selection.liftMeters,
            success_threshold_z: 1.11,
            max_abs_joint_change: 0,
          },
        };
        policyRunDiagnostics.finish("passed", {
          steps: selection.samples,
          sim_s: (selection.samples / 30).toFixed(2),
          lift_m: selection.liftMeters.toFixed(4),
          required_lift_m: "0.0600",
        }, "Verified demonstration met the cube-lift pass rule");
        status(`${selection.name} PASS · ${(selection.liftMeters * 100).toFixed(1)} cm measured cube lift.`);
      } catch (error) {
        state.lastPolicyEvaluation = { status: "failed", error: error?.message || String(error) };
        policyRunDiagnostics.finish("failed", {}, error?.message || String(error));
        status(`Verified example could not start: ${error?.message || error}`, "error");
      } finally {
        state.realRunActive = false;
        paintPolicyRun();
      }
      return;
    }
    const checkpoint = selection?.kind === "checkpoint" ? selection : null;
    if (!checkpoint) return;
    policyRunDiagnostics.start({ policy: checkpoint.name, scene: checkpoint.scene, mode: "act-evaluation" });
    const draft = saveDeploymentDraft?.({
      ...state.deploymentDraft,
      engine: "mujoco",
      scene: checkpoint.scene,
      label: checkpoint.name,
      sourcePath: checkpoint.scene,
      policyCheckpoint: checkpoint.id,
      policyDataset: checkpoint.dataset,
    }) || state.deploymentDraft;
    state.deploymentDraft = draft;
    state.realRunActive = true;
    state.policyLiveView = "mujoco";
    paintPolicyRun();
    status(`Starting ${checkpoint.name} in ${checkpoint.scene}…`);
    monitorPolicyRun("mujoco");
    try {
      const run = await onStartSimulation?.(draft);
      if (!run?.runId) throw new Error("MuJoCo did not create an active run");
      onSetSimulationPaused?.(true);
      policyRunDiagnostics.setRun(run.runId);
      paintPolicyRun();
      const evaluation = await onEvaluatePolicy?.({
        checkpoint: checkpoint.id,
        revision: checkpoint.revision,
        dataset: checkpoint.dataset,
        scene: checkpoint.scene,
        runId: run.runId,
      });
      state.lastPolicyEvaluation = evaluation || null;
      paintPolicyRun();
      if (evaluation?.status === "running" && onGetPolicyDebug) {
        for (let attempt = 0; attempt < 300 && state.lastPolicyEvaluation?.status === "running"; attempt += 1) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 1000));
          const diagnostic = await onGetPolicyDebug();
          state.lastPolicyEvaluation = diagnostic?.evaluator || state.lastPolicyEvaluation;
          paintPolicyRun();
        }
      }
      const finalEvaluation = state.lastPolicyEvaluation;
      if (onEvaluatePolicy && finalEvaluation?.status !== "running" && finalEvaluation?.status !== "completed") {
        throw new Error(finalEvaluation?.error || "Policy evaluator did not start");
      }
      const stats = policyEvaluationStats(finalEvaluation);
      policyRunDiagnostics.finish(stats.state === "PASS" ? "passed" : "failed", {
        steps: stats.steps,
        sim_s: stats.simSeconds,
        wall_s: stats.wallSeconds,
        lift_m: stats.liftMeters,
        required_lift_m: stats.requiredLiftMeters,
        max_joint_change_rad: stats.jointChange,
      }, stats.reason);
      status(`${checkpoint.name} evaluation ${stats.state} · ${stats.reason} · lift ${stats.liftMeters} m. Simulation only; no hardware command was sent.`, stats.state === "PASS" ? "ok" : "error");
    } catch (error) {
      policyRunDiagnostics.finish("failed", {}, error?.message || "MuJoCo evaluator unavailable");
      status(`Policy evaluation could not start: ${error?.message || "MuJoCo evaluator unavailable"}.`, "error");
    } finally {
      onSetSimulationPaused?.(false);
      state.realRunActive = false;
      paintPolicyRun();
    }
  }

  async function stopSelectedPolicy() {
    try {
      const stopped = await onStopPolicy?.();
      state.realRunActive = false;
      state.lastPolicyEvaluation = stopped || { status: "stopped" };
      policyRunDiagnostics.finish("stopped", {}, "Stopped by operator");
      paintPolicyRun();
      status("ACT policy stopped. Start will bind a fresh policy session to the currently selected scene.");
    } catch (error) {
      status(`Policy could not stop: ${error?.message || "evaluator unavailable"}.`, "error");
    }
  }

  async function copyPolicyDebug() {
    const selection = policyCatalogItems(state.policy, state.projectProfiles).find((item) => item.key === state.selectedCatalogKey) || null;
    status("Collecting policy evaluator and MuJoCo diagnostics…");
    try {
      const diagnostic = await onGetPolicyDebug?.() || {};
      const backendText = policyDebugText({
        draft: state.deploymentDraft,
        selection,
        evaluator: diagnostic.evaluator || state.lastPolicyEvaluation,
        simulation: diagnostic.simulation,
      });
      const text = `${policyRunDiagnostics.text()}\n\nbackend_diagnostics:\n${backendText}`;
      const output = q("[data-robotics-policy-debug]");
      if (output) output.textContent = text;
      await globalThis.navigator?.clipboard?.writeText?.(text);
      status("Policy debug log copied. Paste it into chat so the evaluator and motion bridge can be diagnosed.");
      return text;
    } catch (error) {
      status(`Could not copy policy debug: ${error?.message || "clipboard unavailable"}. Open the debug panel and copy it manually.`, "error");
      return "";
    }
  }

  async function validatePolicyDeployment() {
    const stats = policyEvaluationStats(state.lastPolicyEvaluation);
    if (stats.hardwareValidated) {
      status("All deployment gates passed. The validated Pi program is ready for guarded Home and Run.");
      return true;
    }
    const selection = policyCatalogItems(state.policy, state.projectProfiles).find((item) => item.key === state.selectedCatalogKey) || null;
    const canPrepare = connected()
      && selection?.kind === "checkpoint"
      && selection.id === state.lastPolicyEvaluation?.checkpoint
      && state.lastPolicyEvaluation?.simulationPassed === true;
    let candidate = null;
    let cameras = null;
    if (canPrepare) {
      status("Preparing the simulation-passed policy as a locked Pi candidate and checking its cameras…");
      try {
        candidate = await onPrepareHardwareCandidate?.();
        if (!candidate?.id) throw new Error("Render did not produce a hardware candidate");
        state.policy = await piAction("/robotics/policy/program", candidate);
        cameras = await piRead("/robotics/policy/cameras");
        state.policyCameras = cameras;
        state.selectedCatalogKey = "";
        state.selectedPolicyId = candidate.id;
        paintPolicyRun();
      } catch (error) {
        status(`Pi candidate could not be prepared: ${error?.message || error}. No motion was sent.`, "error");
        return false;
      }
    }
    const prepared = candidate?.id
      ? policyPrograms(state.policy).find((program) => program.id === candidate.id)
      : null;
    if (prepared?.validated === true && prepared.blockers.length === 0 && cameras?.ready === true) {
      state.lastPolicyEvaluation = { ...state.lastPolicyEvaluation, hardwareValidated: true, hardwareBlockers: [] };
      status("Hardware program ready. Its timing is velocity-limited; guarded Home, workspace confirmation, live cameras, and the Pi run gate remain required.");
      paintPolicyRun();
      return true;
    }
    const blockers = [...new Set([
      ...(candidate?.blockers || []),
      ...(cameras?.missing?.length ? [`Missing live policy cameras: ${cameras.missing.join(", ")}`] : []),
      ...(!candidate ? (stats.blockers || []) : []),
      ...(!state.lastPolicyEvaluation ? ["Run the MuJoCo evaluation first"] : []),
    ])];
    if (!blockers.length) blockers.push("Physical calibration and operator-confirmation gates have not passed");
    status(`Physical deployment blocked: ${blockers.join("; ")}.`, "error");
    const output = q("[data-robotics-policy-debug]");
    if (output) output.textContent = `${output.textContent}\n\ndeployment_gate=BLOCKED\npi_candidate=${candidate?.id || "not_prepared"}\ncameras_ready=${cameras?.ready === true}\n${blockers.map((item, index) => `blocker_${index + 1}=${item}`).join("\n")}`.trim();
    return false;
  }

  async function openTeleopTicket(configUrl = state.connectedTarget) {
    const target = new URL(configUrl || String(q("[data-robotics-home-config]")?.value || ""));
    if (!/^https?:$/.test(target.protocol) || target.username || target.password) throw new Error("Select a valid Pi configuration URL");
    target.protocol = "https:";
    target.port = "8443";
    target.pathname = "/teleop";
    target.search = "";
    target.hash = "";
    const url = target.href;
    const opened = await api("/api/teleop/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    if (opened?.ok !== true) throw new Error(opened?.error || opened?.detail || "Pi teleop session was not opened");
    state.teleopBase = proxyBase(opened?.iframe);
    if (!state.teleopBase) throw new Error("Teleop proxy did not return a usable Pi route");
    return state.teleopBase;
  }

  async function connect() {
    if (state.preflightActive) return false;
    const url = String(state.deploymentDraft?.hardwareTarget || q("[data-robotics-home-config]")?.value || "").trim();
    status("Connecting to the Pi…");
    try {
      const selection = await api("/api/robotics/config/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      await api("/api/users/me/robotics-prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roboticsProfile: selection }) });
      await openTeleopTicket(url);
      state.connectedTarget = url;
      state.connection = "online";
      state.connectionError = "";
      state.hardwareReady = false;
      state.mode = killed() ? "simulation" : "shadow";
      await refreshSimulationPolicy({ bindDraft: true });
      status("Pi connected. Shadow is ready, and any validated MuJoCo policy is available through its separate guarded run button.");
      paint();
      void refreshStartPositions({ includeEmotes: true });
      return true;
    } catch (error) {
      state.connection = "offline";
      state.connectionError = error?.message || "Could not reach the Pi";
      state.connectedTarget = "";
      state.teleopBase = "";
      state.hardwareReady = false;
      state.mode = "simulation";
      status(`${error?.message || "Could not reach the Pi."} Verify the Pi is powered, this computer is on the same LAN, and port 8450 is listening.`, "error");
      paint();
      return false;
    }
  }

  async function hydrateSavedTarget() {
    try {
      const prefs = (await api("/api/users/me/robotics-prefs"))?.prefs || {};
      let configUrl = String(prefs.roboticsProfile?.configUrl || prefs.roboticsProfile?.profile?.paste_url || "").trim();
      if (!configUrl && prefs.teleopActive) {
        const teleop = new URL(prefs.teleopActive);
        teleop.protocol = "http:";
        teleop.port = "8450";
        teleop.pathname = "/robotics/config";
        teleop.search = "";
        teleop.hash = "";
        configUrl = teleop.href;
      }
      if (configUrl) {
        const input = q("[data-robotics-home-config]");
        if (input) input.value = configUrl;
      }
    } catch { /* Keep the visible LAN default when no saved profile is available. */ }
  }

  async function piAction(path, body) {
    hardwareRunJournal?.add?.("Pi request", "START", `POST ${path}`);
    const base = state.teleopBase || await openTeleopTicket();
    try {
      const result = await api(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      if (result?.ok !== true) throw new Error(result?.error || result?.detail || "Pi did not acknowledge the action");
      hardwareRunJournal?.add?.("Pi response", "PASS", `POST ${path}`, "ok=true");
      return result;
    } catch (error) {
      hardwareRunJournal?.add?.("Pi response", "FAIL", `POST ${path}`, error?.message || error);
      throw error;
    }
  }

  async function piRead(path) {
    hardwareRunJournal?.add?.("Pi request", "START", `GET ${path}`);
    const base = state.teleopBase || await openTeleopTicket();
    try {
      const result = await api(`${base}${path}`);
      if (result?.ok === false) throw new Error(result?.error || result?.detail || "Pi request failed");
      hardwareRunJournal?.add?.("Pi response", "PASS", `GET ${path}`);
      return result || {};
    } catch (error) {
      hardwareRunJournal?.add?.("Pi response", "FAIL", `GET ${path}`, error?.message || error);
      throw error;
    }
  }

  async function piStatus() {
    const base = state.teleopBase || await openTeleopTicket();
    const result = await api(`${base}/robotics/status`);
    if (result?.ok !== true) throw new Error(result?.error || result?.detail || "Pi status was unavailable");
    return result;
  }

  async function refreshSimulationPolicy({ bindDraft = false, run = null } = {}) {
    let snapshot = await piRead("/robotics/policy");
    if (bindDraft && state.deploymentDraft) {
      const sameScene = String(snapshot?.deployment?.scene || "") === String(state.deploymentDraft.scene || state.deploymentDraft.sourcePath || "");
      const programId = String(state.deploymentDraft.programId || (sameScene ? snapshot?.deployment?.programId : "") || "");
      snapshot = await piAction("/robotics/policy/bind", {
        ...state.deploymentDraft,
        runId: run?.runId || state.deploymentDraft.runId || "",
        programId,
        macHost: globalThis.location?.hostname || "",
      });
    }
    state.policy = snapshot;
    state.selectedPolicyId = String(snapshot?.program?.id || state.selectedPolicyId || "");
    paintPolicyRun();
    return snapshot;
  }

  const motionStopped = (result) => result?.armed === false
    && result?.homing === false
    && result?.pending_arm === false
    && result?.playing === false;

  async function waitForHomeComplete(timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await piStatus();
      if (result.homing === false) {
        if (!motionStopped(result)) throw new Error("Pi left another motion producer active after homing");
        if (result.home_failure) throw new Error(`Guarded Home failed: ${result.home_failure}`);
        if (!guardedHomeVerified(result)) {
          throw new Error("Pi stopped without verifying arms-down convergence and actuator safe hold");
        }
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Pi did not verify the arms-down pose before the safety timeout");
  }

  async function waitForEmoteComplete(initial, timeoutMs = 120000) {
    if (initial?.completed === true && motionStopped(initial)) return initial;
    let sawPlayback = initial?.playing === true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await piStatus();
      if (result.playing === true) sawPlayback = true;
      if (sawPlayback && motionStopped(result)) return result;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(sawPlayback ? "VR recording did not finish before the safety timeout" : "Pi never confirmed that VR recording playback started");
  }

  async function runOnRealRobot() {
    if (physicalRunBlockedByReview()) {
      hardwareRunJournal?.add?.("run", "BLOCKED", "Physical policy blocked", "Finish the current PASS / FAIL review and guarded reset");
      return status("Finish the current PASS / FAIL review and guarded reset before starting another physical run.", "error");
    }
    if (state.realRunActive) {
      hardwareRunJournal?.add?.("run", "BLOCKED", "Physical policy blocked", "A guarded physical run is already active");
      return status("A guarded physical run is already active. Keep the workspace clear.");
    }
    const position = positionByValue(startPositionValue(state.selectedStart)) || state.startPositions[0];
    if (position.type === "viser") {
      status("This Viser position is a visual planning target only. Open Viser to review it, then select a VR Emote with a validated physical recording.", "error");
      focus("[data-robotics-open-start-viser]");
      return;
    }
    if (!selectedTarget()) {
      status("Select the OpenArm Pi before running on the real robot.", "error");
      focus("[data-robotics-hardware-target]");
      return;
    }
    const checks = await diagnoseRealRun();
    if (!checklistCanRun(checks)) {
      const first = checks.find((row) => row.state === "fail");
      status(`Real run blocked: ${first?.detail || "readiness checks failed"} Open the checklist and copy the debug log.`, "error");
      return;
    }
    if (state.connectedTarget !== selectedTarget()) {
      status("Connect the selected demo hardware target before running on the real robot.", "error");
      focus("[data-robotics-home-connect]");
      return;
    }
    const action = position.type === "emote" ? `home both arms, then replay “${position.name}”` : "home both arms only";
    if (!globalThis.confirm(`Workspace clear and physical E-stop reachable? This will stop every motion source, ${action}.`)) {
      runDiagnostics.add("Operator confirmation", "CANCEL", "No hardware command sent");
      status("Real run canceled. No hardware command was sent.");
      paintRunDiagnostics();
      return;
    }
    runDiagnostics.add("Operator confirmation", "PASS", "Workspace clear and E-stop reachable");
    if (hardwareReview.snapshot().phase !== "staged") stageHardwareReview();
    const recording = await startEvaluationRecording({ task: selectedPolicyName(), source: "dimos", startingPosition: position.name });
    if (recording?.ok === false) return;
    hardwareReview.start();
    paintHardwareReview();
    revealHardwareReview();
    state.realRunActive = true;
    state.hardwareReady = false;
    try {
      await runGuardedStartSequence({
        position,
        stopAll: async () => {
          status("Real run 1/3: stopping teleop, homing, queued engagement, and Emote playback…");
          const stopped = await piAction("/robotics/kill", { source: "robotics_home_real_run" });
          if (!motionStopped(stopped)) throw new Error("Pi did not confirm every motion producer stopped");
          runDiagnostics.add("Stop all motion", "PASS", "Pi confirmed stopped");
          state.safety = "killed"; state.mode = "simulation"; paint();
        },
        home: async () => {
          status("Real run 2/3: validating robot state and moving slowly to arms-down Home…");
          const accepted = await piAction("/robotics/home", {
            action: "home", pose: "arms_down", orientation: "canonical", both_arms: true,
            require_clear: true, require_calibrated: true, require_controller_poses: false,
            verify_joint_limits: true, speed_scale: 0.15,
          });
          if (accepted.homing !== true) throw new Error("Pi did not start the guarded home trajectory");
          runDiagnostics.add("Guarded Home", "START", "Pi accepted arms-down trajectory");
          state.mode = "hardware"; paint();
        },
        waitForHome: async () => {
          const result = await waitForHomeComplete();
          runDiagnostics.add("Guarded Home", "PASS", `arms down, max error ${Number(result.home_max_error_rad).toFixed(3)} rad, actuator hold active`);
          return result;
        },
        playEmote: async (id) => {
          state.safety = "clear"; state.hardwareReady = true; state.mode = "hardware"; paint();
          status(`Real run 3/3: Home verified; replaying VR Emote “${position.name}”…`);
          const result = await piAction("/emote/play", { id });
          runDiagnostics.add("VR recording", "START", position.name);
          return result;
        },
        waitForEmote: async (initial) => {
          const result = await waitForEmoteComplete(initial);
          runDiagnostics.add("VR recording", "PASS", `${position.name} completed`);
          return result;
        },
      });
      state.safety = "clear"; state.hardwareReady = true; state.mode = "hardware"; paint();
      if (position.type === "emote") status(`Real run complete: Home was verified before “${position.name}”, and all motion producers are stopped.`);
      else status("Home verified. The robot is stopped and ready; the downloaded MuJoCo policy was not run because it has no validated hardware runner.");
      hardwareReview.complete({ result: "uncertain", confidence: 0, reason: "Physical run complete. Confirm the observed outcome before reset.", evidence: ["Guarded Home verified", "All motion producers stopped"] });
      onPauseEvaluationRecording?.();
      paintHardwareReview();
      revealHardwareReview();
      onHardwareReady?.();
      paintRunDiagnostics();
    } catch (error) {
      state.safety = "killed"; state.hardwareReady = false; state.mode = "simulation"; paint();
      runDiagnostics.add("Real run", "FAIL", error?.message || "Pi did not acknowledge every safety step");
      try {
        await piAction("/robotics/kill", { source: "robotics_home_real_run_failure" });
        runDiagnostics.add("Failure KILL", "PASS", "Pi acknowledged stop");
      } catch (killError) {
        runDiagnostics.add("Failure KILL", "FAIL", killError?.message || "Pi unreachable; use physical E-stop");
      }
      status(`Real run stopped; KILL remains latched: ${error?.message || "Pi did not acknowledge every safety step"}.`, "error");
      hardwareReview.latchFault(error?.message || "Pi did not acknowledge every safety step");
      onPauseEvaluationRecording?.();
      paintHardwareReview();
      revealHardwareReview();
      paintRunDiagnostics();
    } finally {
      state.realRunActive = false;
      paint();
    }
  }

  let policyRunRequestPromise = null;
  async function executeSimulationPolicyOnRobot() {
    const loadedExample = policyCatalogItems(state.policy, state.projectProfiles).find((item) => item.key === state.selectedCatalogKey) || null;
    const requestedProgramId = String(state.selectedPolicyId || state.deploymentDraft?.programId || "");
    const preparedProgram = policyPrograms(state.policy).find((item) => item.id === requestedProgramId) || null;
    const deploymentProgramId = String(state.policy?.deployment?.programId || "");
    const deploymentScene = String(state.policy?.deployment?.scene || "");
    const loadedScene = String(state.deploymentDraft?.scene || state.deploymentDraft?.sourcePath || loadedExample?.scene || "");
    const preparedForLoadedScene = preparedProgram?.validated === true
      && preparedProgram.blockers.length === 0
      && deploymentProgramId === preparedProgram.id
      && (!loadedScene || !deploymentScene || loadedScene === deploymentScene);
    hardwareRunJournal?.add?.("run", "START", "Run loaded policy requested", preparedForLoadedScene ? preparedProgram.name : selectedPolicyName());
    if (physicalRunBlockedByReview()) {
      hardwareRunJournal?.add?.("run", "BLOCKED", "Physical policy blocked", "Finish the current PASS / FAIL review and guarded reset");
      return status("Finish the current PASS / FAIL review and guarded reset before starting another physical run.", "error");
    }
    if (state.realRunActive) {
      hardwareRunJournal?.add?.("run", "BLOCKED", "Physical policy blocked", "A guarded physical run is already active");
      return status("A guarded physical run is already active. Keep the workspace clear.");
    }
    if (!state.deploymentDraft) {
      status("Start or load a MuJoCo simulation before running a policy on the robot.", "error");
      focus("[data-robotics-start-sim]");
      return;
    }
    if (loadedExample && !preparedForLoadedScene) {
      hardwareRunJournal?.add?.("run", "BLOCKED", "Physical policy blocked", `${loadedExample.name} is simulation-only; no Pi command sent`);
      status(`“${loadedExample.name}” is loaded from Step 2 but is not yet a Pi hardware program. In Step 4, press Prepare Pi + check gates first; then Run loaded policy on hardware.`, "error");
      return;
    }
    if (!connected() && !await connect()) return;
    let policy;
    try {
      policy = await refreshSimulationPolicy({ bindDraft: true });
    } catch (error) {
      status(`Could not bind the MuJoCo policy to the Pi: ${error?.message || "Pi unavailable"}.`, "error");
      return;
    }
    const programs = policyPrograms(policy);
    const program = programs.find((item) => item.id === requestedProgramId)
      || (!requestedProgramId ? programs.find((item) => item.id === String(policy?.program?.id || "")) : null);
    if (!program?.id || program.validated !== true || program.blockers.length) {
      status(requestedProgramId
        ? `The exact policy selected in Step 2/Step 4 (${requestedProgramId}) is not a validated Pi program. Prepare that policy and pass its gates before running hardware.`
        : "This simulation has no validated joint policy. Prepare the loaded Step 2 policy before physical execution.", "error");
      return;
    }
    await openHardwareRunSurfaces();
    hardwareRunJournal?.add?.("safety gate", "WAIT", "Workspace-clear confirmation requested", program.name || program.id);
    if (!globalThis.confirm(`Workspace clear and physical E-stop reachable? This will stop all motion, Home both arms, then run the validated simulation policy “${program.name || program.id}”.`)) {
      hardwareRunJournal?.add?.("safety gate", "CANCEL", "Operator canceled. No hardware command sent");
      return;
    }
    hardwareRunJournal?.add?.("safety gate", "PASS", "Operator confirmed workspace clear and E-stop reachable");
    if (hardwareReview.snapshot().phase !== "staged") stageHardwareReview();
    const recording = await startEvaluationRecording({ task: program.name || program.id, source: "viser", startingPosition: state.selectedStart?.name || "Home · arms down", policyId: program.id });
    if (recording?.ok === false) return;
    hardwareReview.start();
    paintHardwareReview();
    revealHardwareReview();
    state.realRunActive = true;
    state.hardwareReady = false;
    paint();
    try {
      status("Simulation policy 1/3: stopping every motion source…");
      const stopped = await piAction("/robotics/kill", { source: "robotics_home_policy_run" });
      if (!motionStopped(stopped)) throw new Error("Pi did not confirm every motion producer stopped");
      runDiagnostics.add("Policy stop all motion", "PASS", "Pi confirmed stopped");
      state.safety = "killed"; state.mode = "simulation"; paint();

      status("Simulation policy 2/3: moving slowly to guarded arms-down Home…");
      const accepted = await piAction("/robotics/home", {
        action: "home", pose: "arms_down", orientation: "canonical", both_arms: true,
        require_clear: true, require_calibrated: true, require_controller_poses: false,
        verify_joint_limits: true, speed_scale: 0.15,
      });
      if (accepted.homing !== true) throw new Error("Pi did not start the guarded Home trajectory");
      const home = await waitForHomeComplete();
      runDiagnostics.add("Policy guarded Home", "PASS", `max error ${Number(home.home_max_error_rad).toFixed(3)} rad; actuator hold active`);

      state.safety = "clear"; state.mode = "hardware"; paint();
      status(`Simulation policy 3/3: running “${program.name || program.id}” on OpenArm…`);
      const started = await piAction("/robotics/policy/run", {
        id: program.id,
        require_clear: true,
        source: "render_studio_mujoco",
      });
      runDiagnostics.add("Simulation policy", "START", `${program.name || program.id} · ${program.samples || 0} samples`);
      await waitForEmoteComplete(started);
      runDiagnostics.add("Simulation policy", "PASS", `${program.name || program.id} completed`);
      state.hardwareReady = true;
      status(`Simulation policy complete: “${program.name || program.id}”. Robot playback stopped.`);
      hardwareReview.complete({ result: "uncertain", confidence: 0, reason: "Policy playback complete. Camera evaluator is not calibrated yet; operator review required.", evidence: [`${program.samples || 0} command frames completed`, "Robot playback stopped"] });
      hardwareRunJournal?.add?.("run", "PASS", "Policy playback complete. PASS / FAIL review is ready", program.name || program.id);
      onPauseEvaluationRecording?.();
      paintHardwareReview();
      revealHardwareReview();
      onHardwareReady?.();
    } catch (error) {
      state.safety = "killed"; state.hardwareReady = false; state.mode = "simulation";
      runDiagnostics.add("Simulation policy", "FAIL", error?.message || "Pi rejected the run");
      try {
        await piAction("/robotics/kill", { source: "robotics_home_policy_failure" });
        runDiagnostics.add("Policy failure KILL", "PASS", "Pi acknowledged stop");
      } catch (killError) {
        runDiagnostics.add("Policy failure KILL", "FAIL", killError?.message || "Pi unreachable; use physical E-stop");
      }
      status(`Simulation policy stopped; KILL remains latched: ${error?.message || "Pi rejected the run"}.`, "error");
      hardwareReview.latchFault(error?.message || "Pi rejected the run");
      hardwareRunJournal?.add?.("run", "FAIL", "Policy run stopped and review fault latched", error?.message || error);
      onPauseEvaluationRecording?.();
      paintHardwareReview();
      revealHardwareReview();
    } finally {
      state.realRunActive = false;
      paint();
      paintRunDiagnostics();
    }
  }

  function runSimulationPolicyOnRobot() {
    if (policyRunRequestPromise) return policyRunRequestPromise;
    policyRunRequestPromise = executeSimulationPolicyOnRobot().finally(() => { policyRunRequestPromise = null; });
    return policyRunRequestPromise;
  }

  async function runLoadedPolicyHardwareWorkflow() {
    hardwareRunJournal?.add?.("sequence", "START", "Automatic hardware sequence requested", "Select Pi → prepare gates → guarded Home → run policy");
    const target = q("[data-robotics-hardware-target]");
    if (!selectedTarget()) {
      const first = [...(target?.options || [])].find((option) => option.value);
      if (!first || !target) {
        hardwareRunJournal?.add?.("sequence", "BLOCKED", "Step 1 · Select OpenArm Pi", "No hardware target is configured");
        status("Hardware sequence blocked at Step 1: no OpenArm Pi target is configured.", "error");
        return false;
      }
      target.value = first.value;
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
    hardwareRunJournal?.add?.("sequence", "PASS", "Step 1 · Select OpenArm Pi", selectedTarget());
    if (!connected() && !await connect()) {
      hardwareRunJournal?.add?.("sequence", "BLOCKED", "Step 2 · Connect and prepare Pi", state.connectionError || "Pi connection failed");
      return false;
    }
    const requestedProgramId = String(state.selectedPolicyId || state.deploymentDraft?.programId || "");
    const readyProgram = policyPrograms(state.policy).find((program) => program.id === requestedProgramId && program.validated && !program.blockers.length);
    if (!readyProgram && !await validatePolicyDeployment()) {
      hardwareRunJournal?.add?.("sequence", "BLOCKED", "Step 2 · Prepare Pi + check gates", "ACT evaluation PASS or deployment gate is missing");
      return false;
    }
    hardwareRunJournal?.add?.("sequence", "PASS", "Step 2 · Prepare Pi + check gates");
    hardwareRunJournal?.add?.("sequence", "START", "Steps 3–4 · Guarded Home then policy", "Waiting for workspace-clear confirmation");
    await runSimulationPolicyOnRobot();
    return true;
  }

  async function copyRobotRunDebug() {
    const text = runDiagnostics.text({ target: selectedTarget(), selection: state.selectedStart?.name });
    try {
      await globalThis.navigator?.clipboard?.writeText?.(text);
      status("Robot run debug log copied.");
    } catch {
      status("Could not access the clipboard. Select the debug log and copy it manually.", "error");
    }
  }

  function ingestVrDebug(detail = {}) {
    const bits = [
      `status=${detail.status || "error"}`,
      `transport=${detail.transport || "unknown"}`,
      `socket=${detail.socketState || "unknown"}`,
      `profile=${detail.profileVersion || "unknown"}`,
      `y_map=${detail.yMap || "unknown"}`,
      detail.source ? `source=${detail.source}` : "",
      detail.stage ? `stage=${detail.stage}` : "",
      detail.trace ? `trace=${detail.trace}` : "",
      detail.closeCode ? `close=${detail.closeCode}` : "",
      detail.target ? `target=${detail.target}` : "",
    ].filter(Boolean).join("; ");
    runDiagnostics.add("VR enable", "FAIL", `${detail.message || "Could not load live robot"}; ${bits}`);
    const panel = q("[data-robotics-run-debug]")?.closest?.("details");
    if (panel) panel.open = true;
    paintRunDiagnostics();
    status("VR robot enable failed. The debug bundle is ready to copy below.", "error");
  }
  globalThis.addEventListener?.("render3d:robotics-debug", (event) => ingestVrDebug(event?.detail || {}));
  const recordingSavedHandler = (event) => {
    const detail = event?.detail || {};
    status(`${detail.name || "Robot take"} saved to ${detail.folderName || "Data Sets"}. Refreshing recent recordings…`);
    void refreshStartPositions({ includeEmotes: true });
    void refreshDatasets();
  };
  if (root.__roboticsRecordingSavedHandler) {
    globalThis.removeEventListener?.("render3d:robotics-recording-saved", root.__roboticsRecordingSavedHandler);
  }
  root.__roboticsRecordingSavedHandler = recordingSavedHandler;
  globalThis.addEventListener?.("render3d:robotics-recording-saved", recordingSavedHandler);

  async function kill() {
    state.safety = "killed"; state.hardwareReady = false; state.mode = "simulation"; paint();
    globalThis.dispatchEvent?.(new CustomEvent("robotics-emergency-stop", { detail: { source: "robotics-home" } }));
    status("KILL latched locally; canceling teleop, homing, queued engagement, and emote playback on the Pi.", "error");
    try {
      const result = await piAction("/robotics/kill", { source: "robotics_home" });
      if (!motionStopped(result)) throw new Error("Pi did not confirm every motion producer stopped");
      status("KILL confirmed: teleop, homing, engagement, and emote playback are OFF. Motors remain in the driver safe-hold; use the physical E-stop to remove actuator power.", "error");
    } catch (error) {
      status(`KILL remains latched locally; Pi acknowledgement failed: ${error?.message || "unreachable"}. Use the physical E-stop.`, "error");
    }
  }

  async function recoverHome() {
    if (!connected()) {
      status("Connect the Pi before recovery.", "error");
      focus("[data-robotics-home-connect]");
      return;
    }
    if (!killed()) {
      status("Recovery is only needed after KILL. The robot is already clear.");
      return;
    }
    if (!globalThis.confirm("Workspace clear? This re-enables controlled motion and moves OpenArm to its configured home pose.")) return;
    status("Requesting guarded homing motion…");
    try {
      const accepted = await piAction("/robotics/recover-home", {
        action: "home",
        pose: "arms_down",
        orientation: "canonical",
        both_arms: true,
        require_clear: true,
        require_controller_poses: false,
        verify_joint_limits: true,
        speed_scale: 0.15,
      });
      if (accepted.homing !== true) throw new Error("Pi did not start the guarded home trajectory");
      state.mode = "hardware"; paint();
      status("Physical homing is in progress. Teleop and emotes remain disabled…");
      await waitForHomeComplete();
      state.safety = "clear"; state.hardwareReady = false; state.mode = "hardware";
      hardwareReview.clearFaultAfterRecovery();
      paintHardwareReview();
      status("Physical arms-down home verified. Teleop remains OFF; run Hardware preflight before control.");
    } catch (error) {
      status(`Homing was not accepted: ${error?.message || "Pi bridge must implement POST /robotics/recover-home"}.`, "error");
    }
    paint();
  }

  async function homeRobot() {
    if (!connected()) {
      status("Connecting to the Pi before physical homing…");
      if (!await connect()) return false;
    }
    if (killed()) {
      await recoverHome();
      return false;
    }
    if (!globalThis.confirm("Workspace clear? Move both arms slowly to the configured arms-down home pose with canonical joint orientation?")) return false;
    status("Moving both arms to the guarded arms-down home pose…");
    try {
      const accepted = await piAction("/robotics/home", {
        action: "home",
        pose: "arms_down",
        orientation: "canonical",
        both_arms: true,
        require_clear: true,
        require_calibrated: true,
        require_controller_poses: false,
        verify_joint_limits: true,
        speed_scale: 0.15,
      });
      if (accepted.homing !== true) throw new Error("Pi did not start the guarded home trajectory");
      state.hardwareReady = false;
      state.mode = "hardware"; paint();
      status("Physical homing is in progress. Teleop and emotes are disabled…");
      await waitForHomeComplete();
      status("Physical arms-down home verified. Teleop is OFF; the robot will not follow controllers until Hardware preflight.");
      paint();
      return true;
    } catch (error) {
      status(`Home Robot was rejected: ${error?.message || "Pi must support the guarded arms_down home pose"}.`, "error");
      paint();
      return false;
    }
  }

  async function reviewHardwareRun(action) {
    const snapshot = hardwareReview.snapshot();
    if (snapshot.phase !== "review") return;
    const failureReason = String(q("[data-hardware-review-failure]")?.value || "").trim();
    const result = action === "accept" ? snapshot.automatic.result : action;
    hardwareReview.review({ result, failureReason });
    hardwareRunJournal?.add?.("operator review", "PASS", `Marked ${String(result).toUpperCase()}`, failureReason);
    const saved = await onFinishEvaluationRecording?.({ result, reason: failureReason || snapshot.automatic.reason });
    hardwareReview.markEpisodeSaved(saved?.ok !== false);
    paintHardwareReview();
    status(saved?.ok === false ? "Outcome was recorded locally, but the training episode could not be saved. Retry before the next run." : `Physical episode labeled ${String(result).toUpperCase()}. Complete the reset checklist to enable the next run.`, saved?.ok === false ? "error" : "ok");
  }

  async function resetReviewedHardwareRun() {
    if (!hardwareReview.canReset()) return status("Accept or correct the result and complete every reset check first.", "error");
    hardwareReview.beginReset();
    paintHardwareReview();
    const homed = await homeRobot();
    if (!homed) {
      hardwareReview.latchFault("Guarded reset did not complete");
      paintHardwareReview();
      return;
    }
    hardwareReview.resetComplete();
    paintHardwareReview();
    status("Guarded reset complete. The next physical run is staged and still requires an explicit Run click.");
  }

  async function enableResumeRobot() {
    if (!connected()) {
      status("Connecting to the Pi before sending the controller Y action…");
      if (!await connect()) return;
    }
    if (killed()) {
      status("KILL is latched in Robotics Home. Use Recover → Home before enabling controller follow.", "error");
      focus("[data-robotics-home-recover]");
      return;
    }
    if (!globalThis.confirm("Workspace clear and physical E-stop reachable? This sends the same Y tap as the controller: enable/resume follow from the current pose. It does not home the arms.")) return;
    status("Sending controller Y tap to enable or resume robot follow…");
    try {
      const result = await piAction("/teleop/y", { action: "tap" });
      state.mode = "hardware";
      state.hardwareReady = Boolean(result.armed);
      if (result.armed) {
        status("Robot follow enabled from the current pose. Controller Y is active.");
      } else if (result.pending_arm) {
        status("Y accepted. The Pi is waiting for fresh left and right controller poses before enabling the arms.");
      } else if (result.holding) {
        status("Robot paused in safe hold. Press Enable / Resume Robot again to resume from the current pose.");
      } else {
        status("Y was acknowledged, but robot follow remains off. Open Teleop and verify both controller poses.", "error");
      }
    } catch (error) {
      state.hardwareReady = false;
      status(`Controller Y action was rejected: ${error?.message || "Pi unavailable"}.`, "error");
    }
    paint();
  }

  async function preflightHardwareRun() {
    if (state.preflightActive) {
      status("Hardware preflight is already running. Keep the workspace clear.");
      return;
    }
    if (!state.deploymentDraft) {
      status("Load a MuJoCo demo to Robotics Home before running Hardware preflight.", "error");
      focus("[data-robotics-home-sim]");
      return;
    }
    if (!state.deploymentDraft.hardwareTarget) {
      status("Select a hardware target before running Hardware preflight.", "error");
      focus("[data-robotics-hardware-target]");
      return;
    }
    if (!connected()) {
      status("Hardware needs a Pi connection. Connect the Pi, then choose Hardware again.", "error");
      focus("[data-robotics-home-connect]");
      return;
    }
    if (state.connectedTarget !== state.deploymentDraft.hardwareTarget) {
      status("Connect the selected demo hardware target before running preflight.", "error");
      focus("[data-robotics-home-connect]");
      return;
    }
    if (!globalThis.confirm("Workspace clear and physical E-stop reachable? This will reset the control session, validate the robot during guarded homing, and move both arms slowly to home before enabling sync.")) return;
    const sync = q("[data-robotics-home-sync]");
    if (sync) sync.disabled = true;
    state.preflightActive = true;
    try {
      status("Preflight 1/2: disabling motion and resetting the Pi session…");
      await piAction("/robotics/kill", { source: "robotics_home_preflight" });
      state.safety = "killed"; state.hardwareReady = false; state.mode = "simulation"; paint();
      status("Preflight 2/2: validating robot state and requesting slow, guarded home…");
      const accepted = await piAction("/robotics/home", {
        action: "home",
        pose: "arms_down",
        orientation: "canonical",
        both_arms: true,
        require_clear: true,
        require_calibrated: true,
        require_controller_poses: false,
        verify_joint_limits: true,
        speed_scale: 0.15,
      });
      if (accepted.homing !== true) throw new Error("Pi did not start the guarded home trajectory");
      state.mode = "hardware"; paint();
      status("Physical homing is in progress. Teleop and emotes remain disabled…");
      await waitForHomeComplete();
      state.safety = "clear"; state.hardwareReady = true; state.mode = "hardware"; paint();
      status("Hardware ready. This downloaded MuJoCo scene has no validated hardware program, so it cannot be run on the robot.");
      onHardwareReady?.();
    } catch (error) {
      state.safety = "killed"; state.hardwareReady = false; state.mode = "simulation"; paint();
      status(`Preflight failed; physical run blocked and KILL remains latched: ${error?.message || "Pi did not acknowledge every step"}.`, "error");
    } finally {
      state.preflightActive = false;
      paint();
    }
  }

  async function startSimulation() {
    if (!state.deploymentDraft) {
      status("Load a MuJoCo demo before starting Simulation.", "error");
      focus("[data-robotics-home-sim]");
      return null;
    }
    try {
      const run = await onStartSimulation?.(state.deploymentDraft);
      if (!run?.runId) throw new Error("MuJoCo did not create an active run");
      state.mode = "simulation";
      if (connected()) await refreshSimulationPolicy({ bindDraft: true, run });
      paint();
      status(`Simulation started · ${run.scene || state.deploymentDraft.scene} · run ${run.runId}. Use the separate policy button for a guarded physical run.`);
      return run;
    } catch (error) {
      status(`Simulation could not start: ${error?.message || "MuJoCo unavailable"}.`, "error");
      return null;
    }
  }

  root.addEventListener("click", (event) => {
    const target = event.target;
    const reviewResult = target.closest("[data-hardware-review-result]")?.dataset.hardwareReviewResult;
    if (reviewResult) void reviewHardwareRun(reviewResult);
    else if (target.closest("[data-hardware-review-reset]")) void resetReviewedHardwareRun();
    else if (target.closest("[data-robotics-home-connect]")) void connect();
    else if (target.closest("[data-robotics-home-sync]")) void preflightHardwareRun();
    else if (target.closest("[data-robotics-run-real]")) void runOnRealRobot();
    else if (target.closest("[data-robotics-run-policy]")) {
      if (state.selectedCatalogKey) void evaluateSelectedPolicy();
      else void runSimulationPolicyOnRobot();
    }
    else if (target.closest("[data-robotics-stop-policy]")) void stopSelectedPolicy();
    else if (target.closest("[data-robotics-policy-open-live]")) openPolicyLiveView();
    else if (target.closest("[data-robotics-policy-copy-debug]")) void copyPolicyDebug();
    else if (target.closest("[data-robotics-policy-validate]")) void validatePolicyDeployment();
    else if (target.closest("[data-robotics-split-live]")) onOpenSplitView?.(target.closest("[data-robotics-split-live]").dataset.roboticsSplitLive);
    else if (target.closest("[data-policy-program-id]")) void selectPolicyProgram(target.closest("[data-policy-program-id]").dataset.policyProgramId);
    else if (target.closest("[data-policy-key]")) selectCatalogItem(target.closest("[data-policy-key]").dataset.policyKey);
    else if (target.closest("[data-policy-root]")) {
      const row = target.closest("[data-policy-root]");
      status("This Hugging Face checkpoint is indexed with its training dataset, but it must pass simulation evaluation and a Pi deployment adapter before Run is enabled.");
      onOpenDatasets?.(row.dataset.policyRoot);
    }
    else if (target.closest("[data-robotics-run-diagnose]")) void diagnoseRealRun();
    else if (target.closest("[data-robotics-run-copy]")) void copyRobotRunDebug();
    else if (target.closest("[data-robotics-start-refresh]")) void refreshStartPositions({ includeEmotes: connected() });
    else if (target.closest("[data-robotics-open-start-viser]")) onOpenViser?.();
    else if (target.closest("[data-robotics-open-start-emotes]")) void openEmotePicker();
    else if (target.closest("[data-robotics-dataset-folder-add]")) createRecordingFolder();
    else if (target.closest("[data-robotics-dataset-destination]")) selectRecordingDestination(target.closest("[data-robotics-dataset-destination]").dataset.roboticsDatasetDestination);
    else if (target.closest("[data-robotics-emote-close]")) q("[data-robotics-emote-picker]")?.close?.();
    else if (target.closest("[data-robotics-emote-id]")) selectEmote(target.closest("[data-robotics-emote-id]").dataset.roboticsEmoteId);
    else if (target.closest("[data-robotics-open-examples]")) void openExamplePicker();
    else if (target.closest("[data-robotics-example-close], [data-robotics-example-done]")) q("[data-robotics-example-picker]")?.close?.();
    else if (target.closest("[data-robotics-example-id]")) toggleExample(target.closest("[data-robotics-example-id]").dataset.roboticsExampleId);
    else if (target.closest("[data-robotics-library-refresh]")) void refreshStartPositions({ includeEmotes: true });
    else if (target.closest("[data-robotics-library-select]")) toggleExample(target.closest("[data-robotics-library-select]").dataset.roboticsLibrarySelect);
    else if (target.closest("[data-robotics-library-start]")) selectEmote(target.closest("[data-robotics-library-start]").dataset.roboticsLibraryStart);
    else if (target.closest("[data-robotics-library-files]")) onOpenDatasets?.();
    else if (target.closest("[data-robotics-start-sim]")) void startSimulation();
    else if (target.closest("[data-robotics-home-sim]")) onOpenSimulation?.();
    else if (target.closest("[data-robotics-open-teleop]")) onOpenTeleop?.();
    else if (target.closest("[data-robotics-open-viser]")) onOpenViser?.();
    else if (target.closest("[data-robotics-open-ide]")) onOpenIde?.();
    else if (target.closest("[data-robotics-open-datasets]")) onOpenDatasets?.();
    else if (target.closest("[data-robotics-demo-install]")) void installDemo();
    else if (target.closest("[data-robotics-profile-load]")) void activateProjectProfile();
    else if (target.closest("[data-robotics-profile-save]")) void saveProjectProfile();
    else if (target.closest("[data-robotics-demo-folder]")) void saveActiveDatasetRoot(q("[data-robotics-dataset-select]")?.value || state.activeDatasetRoot || state.demoRoot, { open: true });
    else if (target.closest("[data-robotics-dataset-files]")) q("[data-robotics-dataset-files-input]")?.click();
    else if (target.closest("[data-robotics-dataset-folder]")) q("[data-robotics-dataset-folder-input]")?.click();
    else if (target.closest("[data-robotics-datasets-refresh]")) void refreshDatasets();
    else if (target.closest("[data-dataset-root]")) void saveActiveDatasetRoot(target.closest("[data-dataset-root]").dataset.datasetRoot, { open: true });
    else if (target.closest("[data-robotics-camera-activate]")) {
      void Promise.resolve(onActivateCameras?.()).catch((error) => status(error?.message || "Could not open the camera window.", "error"));
    }
    else if (target.closest("[data-robotics-tasks-refresh]")) void connect();
    else if (target.closest("[data-robotics-kill]")) void kill();
    else if (target.closest("[data-robotics-y-tap]")) void enableResumeRobot();
    else if (target.closest("[data-robotics-home-pose]")) void homeRobot();
    else if (target.closest("[data-robotics-home-recover]")) void recoverHome();
    else {
      const mode = target.closest("[data-robotics-mode]")?.dataset.roboticsMode;
      if (mode === "simulation") {
        state.mode = "simulation";
        status("Simulation selected. MuJoCo runs locally and cannot move the robot.");
        paint();
      } else if (mode === "shadow") {
        if (!connected()) {
          status("Shadow needs a Pi connection for live telemetry. Connect the Pi first.", "error");
          focus("[data-robotics-home-connect]");
        } else if (killed()) {
          status("KILL is latched. Recover before entering Shadow mode.", "error");
          focus("[data-robotics-home-recover]");
        } else {
          state.mode = "shadow";
          status("Shadow selected. Commands are mirrored for comparison; hardware does not move.");
          paint();
        }
      } else if (mode === "hardware") {
        void preflightHardwareRun();
      }
    }
  });
  for (const selector of ["[data-robotics-dataset-files-input]", "[data-robotics-dataset-folder-input]"]) {
    q(selector)?.addEventListener("change", (event) => {
      void importDataset([...event.target.files]);
      event.target.value = "";
    });
  }
  root.addEventListener("change", (event) => {
    const datasetTarget = event.target?.closest?.("[data-robotics-dataset-select]");
    if (datasetTarget) {
      void saveActiveDatasetRoot(datasetTarget.value);
      return;
    }
    const startTarget = event.target?.closest?.("[data-robotics-start-position]");
    if (startTarget) {
      const selected = positionByValue(String(startTarget.value || ""));
      if (!selected) return;
      state.selectedStart = selected;
      saveStartPosition(selected);
      paintStartPositions();
      stageHardwareReview({ openMonitor: true });
      status(selected.type === "viser"
        ? `${selected.name} selected from Viser. It is planning-only and will not move hardware.`
        : `${selected.name} saved as the starting position for Robotics Home and VR.`);
      return;
    }
    const resetCheck = event.target?.closest?.("[data-hardware-reset-check]");
    if (resetCheck) {
      hardwareReview.setResetCheck(resetCheck.dataset.hardwareResetCheck, resetCheck.checked === true);
      paintHardwareReview();
      return;
    }
    const policyTarget = event.target?.closest?.("[data-robotics-policy-select]");
    if (policyTarget) {
      selectCatalogItem(policyTarget.value);
      return;
    }
    const hardwarePolicyTarget = event.target?.closest?.("[data-robotics-hardware-policy-select]");
    if (hardwarePolicyTarget) {
      void selectPolicyProgram(String(hardwarePolicyTarget.value || ""));
      return;
    }
    const liveViewTarget = event.target?.closest?.("[data-robotics-policy-live-view]");
    if (liveViewTarget) {
      state.policyLiveView = liveViewTarget.value === "mujoco" ? "mujoco" : "viser";
      paintPolicyRun();
      return;
    }
    if (event.target?.closest?.("[data-robotics-library-filter]")) {
      paintRecordingLibrary();
      return;
    }
    const target = event.target?.closest?.("[data-robotics-hardware-target]");
    if (!target || !state.deploymentDraft) return;
    if (state.preflightActive) {
      target.value = state.deploymentDraft.hardwareTarget;
      status("Wait for the active preflight to finish before changing hardware targets.", "error");
      return;
    }
    state.deploymentDraft = saveDeploymentDraft?.({ ...state.deploymentDraft, hardwareTarget: String(target.value || "").trim() }) || {
      ...state.deploymentDraft,
      hardwareTarget: String(target.value || "").trim(),
    };
    state.hardwareReady = false;
    state.mode = "simulation";
    if (state.connectedTarget !== state.deploymentDraft.hardwareTarget) state.connection = "offline";
    status(state.deploymentDraft.hardwareTarget
      ? "Hardware target assigned. No motion was sent. Connect the Pi when you are ready to run preflight."
      : "Hardware target cleared. No motion was sent.");
    paint();
  });
  root.addEventListener("input", (event) => {
    if (event.target?.closest?.("[data-robotics-emote-search]")) paintEmotePicker(event.target.value);
    if (event.target?.closest?.("[data-robotics-example-search]")) paintExamplePicker(event.target.value);
    if (event.target?.closest?.("[data-robotics-policy-search]")) {
      state.policySearch = String(event.target.value || "");
      paintPolicyExplorer();
    }
    if (event.target?.closest?.("[data-robotics-library-search]")) paintRecordingLibrary();
  });
  const workflowExampleHandler = (event) => {
    const id = String(event?.detail?.id || "");
    const example = CURATED_OPENARM_SUCCESS_EXAMPLES.find((item) => item.id === id);
    if (!example) return;
    state.selectedExampleIds = new Set([id]);
    saveSelectedExamples();
    paintExamplePicker();
    paintRecordingLibrary();
    status(`${example.name} selected as the official successful demonstration for the simulation and training workflow.`);
  };
  const workflowDocument = globalThis.document;
  if (workflowDocument?.addEventListener) {
    if (root.__roboticsWorkflowExampleHandler) workflowDocument.removeEventListener("render3d:robotics-workflow-example", root.__roboticsWorkflowExampleHandler);
    root.__roboticsWorkflowExampleHandler = workflowExampleHandler;
    workflowDocument.addEventListener("render3d:robotics-workflow-example", workflowExampleHandler);
  }
  refreshDeploymentDraft();
  readSelectedExamples();
  paintRecordingLibrary();
  paint();
  paintStartPositions();
  paintRunDiagnostics();
  stageHardwareReview();
  void refreshStartPositions({ includeEmotes: false });
  void hydrateDatasets();
  if (autoHydrateSavedTarget) void hydrateSavedTarget();
  void refreshDemo().then(() => refreshProjectProfiles()).catch(() => {});
  return {
    connect, kill, enableResumeRobot, homeRobot, recoverHome, preflightHardwareRun, runOnRealRobot, runSimulationPolicyOnRobot, runLoadedPolicyHardwareWorkflow,
    refreshStartPositions, refreshDeploymentDraft, refreshDatasets, refreshDemo, inspectSetup,
    installDemo, activateProjectProfile, saveProjectProfile,
    diagnoseRealRun, copyRobotRunDebug, copyPolicyDebug, ingestVrDebug,
    openDataExplorer: () => { onOpenDatasets?.(); return { ok: true, opened: "data_explorer" }; },
    openProjectFiles: () => { onOpenIde?.(); return { ok: true, opened: "project_files" }; },
  };
}
