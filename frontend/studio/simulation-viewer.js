/**
 * Robotics MuJoCo tab — browser WASM sim (or your own URL). Not Quest / not DimOS.
 * One instance via adoptLive; MCP reads openarm-mujoco/runs/latest.json at end-of-run.
 */

import {
  adoptLive,
  parkLive,
  postToLive,
  ensureLive,
  MUJOCO_EMBED_SRC,
} from "../sandbox/sandbox-live-instances.js?v=sblive1&teleop-y=20260922-poseconnect1&dimos-viser-local1&vrrobot=20260927-2";
import {
  SIMULATION_FRAME_EVENT,
  appendSimulationRunLog,
  applySimulationRunSample,
  createSimulationRun,
  readActiveSimulationRun,
  saveActiveSimulationRun,
} from "./simulation-run-session.js?v=20260923-active-run1&vrrobot=20260927-2";

export const SIMULATION_STORAGE_KEY = "render3d:simulationPrefs";
export const SIMULATION_TAB_ID = "simulation:open";
export const SIMULATION_EMBED_SRC = MUJOCO_EMBED_SRC;
export const SIMULATION_FEED_PATH = "openarm-mujoco/runs/latest.json";
export const SIMULATION_FEED_EVENT = "render3d:simulation-feed";
export const SIMULATION_APPROVED_EVENT = "render3d:simulation-approved";
export const DEPLOYMENT_DRAFT_STORAGE_KEY = "render3d:roboticsDeploymentDraft";
export const SIMULATION_DEFAULT_SCENE = "openarm_bimanual.xml";
export const CUBE_ACT_SCENE = "cell/demo.xml";
/** @deprecated table placement removed — kept for persisted prefs migration */
export const PEDESTAL_MOUNT_MM = 698;
export const TABLE_HEIGHT_DEFAULT_MM = 720;
export const LIFTER_MAX_M = 0.3;
export const STANDSTILL_QVEL_MAX = 0.08;
export const SIMULATION_SCENES = Object.freeze([
  "openarm_bimanual.xml",
  "cell/cell.xml",
  "cell/demo.xml",
  "cell/articulated_cell_scene.xml",
  "cell/bottle_cell_scene.xml",
  "cell/move_puck_cell_scene.xml",
  "cell/peg_socket_cell_scene.xml",
  "cell/tool_cell_scene.xml",
  "cell/valve_cell_scene.xml",
  "pedestal/pedestal.xml",
  "pedestal/articulated_scene.xml",
  "pedestal/balance_scene.xml",
  "pedestal/bottle_scene.xml",
  "pedestal/catch_scene.xml",
  "pedestal/move_puck_scene.xml",
  "pedestal/peg_socket_scene.xml",
  "pedestal/throw_scene.xml",
  "pedestal/throw_multi_scene.xml",
  "pedestal/tool_scene.xml",
  "pedestal/valve_scene.xml",
]);

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function studioUserId(user) {
  return String(user?.id || user?.email || "anon").trim() || "anon";
}

export function simulationPrefsKey(user = null, projectId = "") {
  const base = `${SIMULATION_STORAGE_KEY}:${studioUserId(user)}`;
  const pid = String(projectId || "").trim();
  return pid ? `${base}:project:${pid}` : base;
}

export function normalizeScene(raw) {
  const s = String(raw || "").trim();
  return SIMULATION_SCENES.includes(s) ? s : SIMULATION_DEFAULT_SCENE;
}

export function cubeActSceneCompatible(scene) {
  return normalizeScene(scene) === CUBE_ACT_SCENE;
}

function asNumber(value, fallback, { min = -100, max = 100 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** User-owned MuJoCo page — local Mac dev server or hosted embed. Must allow iframe + postMessage. */
export function normalizeSimUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return SIMULATION_EMBED_SRC;
  try {
    const u = new URL(s, globalThis.location?.origin || "https://render3d.app");
    if (!/^https?:$/i.test(u.protocol)) return SIMULATION_EMBED_SRC;
    if (/^https?:\/\//i.test(s)) return u.href;
    return u.pathname + u.search;
  } catch {
    return SIMULATION_EMBED_SRC;
  }
}

export function simUrlWithScene(baseUrl, scene) {
  const base = normalizeSimUrl(baseUrl);
  const u = new URL(base, globalThis.location?.origin || "https://render3d.app");
  if (!u.searchParams.has("embed")) u.searchParams.set("embed", "1");
  u.searchParams.set("scene", normalizeScene(scene));
  if (/^https?:\/\//i.test(base)) return u.href;
  return u.pathname + u.search;
}

export function tableHeightMm(raw) {
  return asNumber(raw, TABLE_HEIGHT_DEFAULT_MM, { min: 400, max: 1100 });
}

export function lifterHeightM(tableMm) {
  return Math.min(LIFTER_MAX_M, Math.max(0, tableHeightMm(tableMm) / 1000 - PEDESTAL_MOUNT_MM / 1000));
}

/** @deprecated watchdog removed from MuJoCo tab */
export function evaluateSimulationWatchdog() {
  return { ok: true, code: "off", detail: "MuJoCo tab no longer uses table watchdog." };
}

export function defaultSimulationPrefs() {
  return {
    engine: "mujoco",
    scene: SIMULATION_DEFAULT_SCENE,
    simUrl: SIMULATION_EMBED_SRC,
    gravity: -9.81,
    timestep: 0.002,
  };
}

export function normalizeSimulationPrefs(raw) {
  const base = defaultSimulationPrefs();
  if (!raw || typeof raw !== "object") return base;
  return {
    engine: "mujoco",
    scene: normalizeScene(raw.scene),
    simUrl: normalizeSimUrl(raw.simUrl || raw.embedSrc),
    gravity: asNumber(raw.gravity, base.gravity, { min: -40, max: 0 }),
    timestep: asNumber(raw.timestep, base.timestep, { min: 0.0001, max: 0.05 }),
  };
}

export function readSimulationPrefs(user = null, projectId = "") {
  const store = storage();
  const key = simulationPrefsKey(user, projectId);
  try {
    return normalizeSimulationPrefs(JSON.parse(store?.getItem(key) || "null"));
  } catch {
    return defaultSimulationPrefs();
  }
}

export function persistSimulationPrefs(partial = {}, user = null, projectId = "") {
  const prev = readSimulationPrefs(user, projectId);
  const next = normalizeSimulationPrefs({ ...prev, ...partial });
  try {
    storage()?.setItem(simulationPrefsKey(user, projectId), JSON.stringify(next));
  } catch { /* private mode */ }
  return next;
}

export function normalizeDeploymentDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  const scene = normalizeScene(raw.scene);
  const sourcePath = String(raw.sourcePath || "").trim();
  if (raw.engine !== "mujoco" || !sourcePath) return null;
  return {
    engine: "mujoco",
    scene,
    label: String(raw.label || scene).trim() || scene,
    sourcePath,
    projectId: String(raw.projectId || "").trim(),
    hardwareTarget: String(raw.hardwareTarget || "").trim(),
    ...(raw.policyCheckpoint ? { policyCheckpoint: String(raw.policyCheckpoint).trim() } : {}),
    ...(raw.policyDataset ? { policyDataset: String(raw.policyDataset).trim() } : {}),
  };
}

export function readDeploymentDraft() {
  try {
    return normalizeDeploymentDraft(JSON.parse(storage()?.getItem(DEPLOYMENT_DRAFT_STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

export function persistDeploymentDraft(raw) {
  const draft = normalizeDeploymentDraft(raw);
  if (!draft) return null;
  try { storage()?.setItem(DEPLOYMENT_DRAFT_STORAGE_KEY, JSON.stringify(draft)); } catch { /* private mode */ }
  return draft;
}

export function createSimulationDeploymentDraft(prefs, projectId = "") {
  const current = normalizeSimulationPrefs(prefs);
  const prior = readDeploymentDraft();
  return persistDeploymentDraft({
    engine: "mujoco",
    scene: current.scene,
    label: current.scene,
    sourcePath: current.scene,
    projectId,
    hardwareTarget: prior?.scene === current.scene && prior?.projectId === String(projectId || "").trim()
      ? prior.hardwareTarget : "",
  });
}

export function simulationSettingsPayload(prefs) {
  const p = normalizeSimulationPrefs(prefs);
  return {
    engine: p.engine,
    scene: p.scene,
    simUrl: p.simUrl,
    gravity: p.gravity,
    timestep: p.timestep,
  };
}

export function simulationPrefsForActiveRun(fallback, run) {
  if (!run?.runId || !["starting", "running"].includes(run.status)) return normalizeSimulationPrefs(fallback);
  return normalizeSimulationPrefs({ ...fallback, scene: run.scene, simUrl: run.simUrl });
}

export function headlessEvaluationView(evaluation, nowMs = Date.now()) {
  const raw = evaluation && typeof evaluation === "object" ? evaluation : {};
  const result = raw.result && typeof raw.result === "object" ? raw.result : {};
  const status = String(raw.status || "idle").toLowerCase();
  const startedMs = Date.parse(raw.startedAt || "");
  const runningSeconds = status === "running" && Number.isFinite(startedMs)
    ? Math.max(0, (nowMs - startedMs) / 1000) : 0;
  const simSeconds = Number(result.sim_seconds);
  const wallSeconds = Number(result.wall_seconds);
  const lift = Number(result.peak_cube_z) - Number(result.initial_cube_z);
  const steps = Number(result.steps);
  const jointChange = Number(result.max_abs_joint_change);
  const passed = raw.simulationPassed === true || result.success === true;
  const completed = status === "completed";
  const failed = status === "failed";
  const officialReplay = raw.source === "official-replay";
  const state = status === "running" ? "RUNNING" : status === "stopped" ? "STOPPED" : completed ? (passed ? "PASS" : "FAIL") : failed ? "ERROR" : status === "unavailable" ? "UNAVAILABLE" : "NOT RUN";
  const reason = status === "running"
    ? officialReplay ? "A verified recorded episode is replaying in this MuJoCo scene." : "Policy inference is running in headless MuJoCo."
    : String(result.reason || raw.error || (completed ? "Evaluation completed." : "No policy evaluation has run yet."));
  const progress = status === "running"
    ? officialReplay && Number(result.steps) >= 0 && Number(raw.totalSteps) > 0
      ? Math.min(99, Math.round((Number(result.steps) / Number(raw.totalSteps)) * 100))
      : Math.min(99, Math.round((runningSeconds / 20) * 100))
    : completed || failed ? 100 : 0;
  return {
    state,
    stateKey: state.toLowerCase().replace(/\s+/g, "-"),
    reason,
    progress,
    steps: Number.isFinite(steps) ? `${steps} steps` : status === "running" ? `${runningSeconds.toFixed(1)} s elapsed` : "—",
    lift: Number.isFinite(lift) ? `${Math.max(0, lift).toFixed(4)} m / 0.060 m` : "— / 0.060 m",
    time: `${Number.isFinite(simSeconds) ? `${simSeconds.toFixed(2)} s` : "—"} / ${Number.isFinite(wallSeconds) ? `${wallSeconds.toFixed(2)} s` : status === "running" ? `${runningSeconds.toFixed(1)} s` : "—"}`,
    joint: Number.isFinite(jointChange) ? `${jointChange.toFixed(4)} rad max` : "—",
    device: String(result.device || (status === "running" ? "Starting policy runtime" : "—")),
  };
}

export function officialReplayEvaluation({ episode = 0, index = 0, total = 0, liftM = 0, fps = 30 } = {}) {
  const steps = Math.max(0, Number(index) || 0);
  const frameCount = Math.max(0, Number(total) || 0);
  const complete = frameCount > 0 && steps >= frameCount;
  return {
    status: complete ? "completed" : "running",
    simulationPassed: complete,
    source: "official-replay",
    totalSteps: frameCount,
    result: {
      success: complete,
      reason: complete ? `Verified Episode ${episode} replay completed.` : `Verified Episode ${episode} is replaying.`,
      steps,
      initial_cube_z: 0,
      peak_cube_z: Math.max(0, Number(liftM) || 0),
      sim_seconds: frameCount ? frameCount / Math.max(1, Number(fps) || 30) : 0,
      device: "Verified replay",
    },
  };
}

export function simulationCalibrationReport(evaluation = null, diagnostics = null) {
  const result = evaluation?.result || {};
  const hasClosestFrame = Number.isFinite(Number(result.closest_tool_distance_m));
  const cube = (hasClosestFrame ? result.closest_cube_xyz_m : diagnostics?.cube_xyz_m) || [];
  const closestTool = hasClosestFrame ? String(result.closest_tool_side || "unknown") : (() => {
    const left = Number(diagnostics?.left_tool_distance_m);
    const right = Number(diagnostics?.right_tool_distance_m);
    return left <= right ? "left" : "right";
  })();
  const tool = hasClosestFrame ? result.closest_tool_xyz_m : diagnostics?.[`${closestTool}_tool_xyz_m`];
  const leftDistance = Number(diagnostics?.left_tool_distance_m);
  const rightDistance = Number(diagnostics?.right_tool_distance_m);
  const closestDistance = Math.min(leftDistance, rightDistance);
  const distance = hasClosestFrame ? Number(result.closest_tool_distance_m) : closestDistance;
  const verticalOffset = hasClosestFrame
    ? Number(result.closest_tool_vertical_offset_m)
    : Array.isArray(cube) && cube.length >= 3 && Array.isArray(tool) && tool.length >= 3 ? Number(tool[2]) - Number(cube[2]) : NaN;
  // A completed result stores the peak contact count, while live diagnostics
  // normally contain only the latest frame (often zero after the arm leaves).
  const contacts = Math.max(
    Number(result.max_cube_contacts) || 0,
    Number(diagnostics?.cube_gripper_contacts) || 0,
  );
  const failedWithoutContact = result.success === false && contacts === 0;
  const completedWithoutLift = result.success === false;
  const running = evaluation?.status === "running";
  const verdict = running
    ? "EVALUATION RUNNING"
    : failedWithoutContact && Number.isFinite(distance) && distance > 0.08
    ? "FRAME / REACH CALIBRATION NEEDED"
    : failedWithoutContact
      ? "GRASP CALIBRATION NEEDED"
      : completedWithoutLift && contacts > 0
        ? "GRIPPER CONTACT WITHOUT LIFT"
      : result.success === true ? "CALIBRATION PASSED THIS ATTEMPT" : "RUN AN EVALUATION FIRST";
  const recommendation = running
    ? "Wait for the completed closest-approach and lift measurements before changing calibration."
    : failedWithoutContact && Number.isFinite(verticalOffset) && verticalOffset > 0.04
    ? `The ${closestTool} tool stayed ${(verticalOffset * 100).toFixed(1)} cm above the cube center. Validate the reset pose and camera/frame correspondence before applying a simulator-only Z correction.`
    : failedWithoutContact
      ? "The policy never made gripper contact. Validate actuator order, training reset pose, camera alignment, and cube coordinates before changing height."
      : completedWithoutLift && contacts > 0
        ? "The fingers reached the cube, but the cube was not lifted. Check jaw alignment and closure timing; do not treat wrist-site distance as grasp distance."
      : result.success === true
        ? "Keep this scene calibration and repeat on held-out simulation trials."
        : "Run the ACT evaluation, then check calibration again.";
  return {
    verdict,
    closestTool,
    closestDistanceM: Number.isFinite(distance) ? distance : null,
    verticalOffsetM: Number.isFinite(verticalOffset) ? verticalOffset : null,
    sampleFrame: hasClosestFrame ? "closest approach" : "latest frame",
    contacts,
    recommendation,
  };
}

export function simulationFailureDebugText({ evaluation = null, diagnostics = null, prefs = null, activeRun = null } = {}) {
  const result = evaluation?.result || {};
  const calibration = simulationCalibrationReport(evaluation, diagnostics);
  const line = (key, value) => `${key}=${value ?? "unknown"}`;
  return [
    "Render Studio ACT failure debug",
    line("captured_at", new Date().toISOString()),
    line("scene", evaluation?.scene || prefs?.scene),
    line("checkpoint", evaluation?.checkpoint),
    line("run_id", evaluation?.runId || activeRun?.runId || "none"),
    line("status", evaluation?.status),
    line("success", result.success),
    line("reason", result.reason || evaluation?.error),
    line("steps", result.steps),
    line("initial_cube_z_m", result.initial_cube_z),
    line("peak_cube_z_m", result.peak_cube_z),
    line("min_left_tool_distance_m", result.min_left_tool_distance_m),
    line("min_right_tool_distance_m", result.min_right_tool_distance_m),
    line("closest_tool_side", result.closest_tool_side),
    line("closest_tool_distance_m", result.closest_tool_distance_m),
    line("closest_tool_vertical_offset_m", result.closest_tool_vertical_offset_m),
    line("cube_gripper_contacts", calibration.contacts),
    line("cube_xyz_m", Array.isArray(diagnostics?.cube_xyz_m) ? diagnostics.cube_xyz_m.join(",") : null),
    line("left_tool_xyz_m", Array.isArray(diagnostics?.left_tool_xyz_m) ? diagnostics.left_tool_xyz_m.join(",") : null),
    line("right_tool_xyz_m", Array.isArray(diagnostics?.right_tool_xyz_m) ? diagnostics.right_tool_xyz_m.join(",") : null),
    line("calibration_verdict", calibration.verdict),
    line("vertical_offset_m", calibration.verticalOffsetM),
    line("recommendation", calibration.recommendation),
    "hardware_motion=none",
  ].join("\n");
}

export function emitSimulationFeed(prefs, run = null) {
  const detail = { ...simulationSettingsPayload(prefs), ...(run ? { runId: run.runId, run } : {}) };
  try {
    window.dispatchEvent(new CustomEvent(SIMULATION_FEED_EVENT, { detail }));
  } catch { /* ignore */ }
  return detail;
}

export function createSimulationViewer({
  viewerEl,
  docTabs,
  getUser,
  getProjectId,
  onStatus,
  onLoadToHome,
  apiFn,
} = {}) {
  let activatingTab = false;
  function currentUser() {
    try { return getUser?.() || null; } catch { return null; }
  }

  function projectId() {
    try { return String(getProjectId?.() || "").trim(); } catch { return ""; }
  }

  function prefs() {
    return readSimulationPrefs(currentUser(), projectId());
  }

  function mainCol() {
    return document.querySelector(".main-column");
  }

  function liveSlot() {
    return viewerEl?.querySelector("[data-simulation-live-slot]") || null;
  }

  function bootStateEl() {
    return viewerEl?.querySelector("[data-simulation-boot-state]") || null;
  }

  function runSummaryEl() {
    return viewerEl?.querySelector("[data-simulation-run-summary]") || null;
  }

  function runJsonEl() {
    return viewerEl?.querySelector("[data-simulation-run-json]") || null;
  }

  function runLogsEl() {
    return viewerEl?.querySelector("[data-simulation-run-logs]") || null;
  }

  let activeRun = readActiveSimulationRun(currentUser(), projectId());
  let lastRunPersistAt = 0;
  let lastNetworkPublishAt = 0;
  let networkPublishIntervalMs = 500;
  let evaluationTimer = 0;
  let latestEvaluation = null;
  let replayWhenReady = false;
  let mujocoReadyScene = "";
  let simulatorBootTimer = 0;
  let pendingOfficialReplay = null;
  let activeOfficialReplay = null;
  let lastMirroredEvaluationStep = -1;
  let lastCameraThumbnails = {};
  let lastPolicyDiagnostics = null;

  function paintPolicyDiagnostics(diagnostics) {
    const panel = viewerEl?.querySelector("[data-simulation-policy-diagnostics]");
    if (!panel || !diagnostics) return;
    lastPolicyDiagnostics = diagnostics;
    const number = (value, digits = 3) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
    const cube = Array.isArray(diagnostics.cube_xyz_m) ? diagnostics.cube_xyz_m : [];
    const leftDistance = Number(diagnostics.left_tool_distance_m);
    const rightDistance = Number(diagnostics.right_tool_distance_m);
    const contacts = Number(diagnostics.cube_gripper_contacts) || 0;
    const environmentContacts = Number(diagnostics.cube_environment_contacts) || 0;
    const values = {
      "[data-simulation-cube-xyz]": cube.length >= 3 ? cube.map((value) => number(value)).join(", ") + " m" : "—",
      "[data-simulation-tool-distance]": `${number(leftDistance)} / ${number(rightDistance)} m`,
      "[data-simulation-gripper-state]": `${number(diagnostics.left_gripper)} / ${number(diagnostics.right_gripper)}`,
      "[data-simulation-cube-contacts]": `${contacts} gripper · ${environmentContacts} total`,
    };
    for (const [selector, value] of Object.entries(values)) {
      const el = panel.querySelector(selector);
      if (el) el.textContent = value;
    }
    const closest = Math.min(leftDistance, rightDistance);
    const verdict = panel.querySelector("[data-simulation-diagnostic-verdict]");
    if (verdict) verdict.textContent = contacts > 0
      ? `${contacts} cube contact${contacts === 1 ? "" : "s"} detected`
      : Number.isFinite(closest) ? `Closest tool is ${(closest * 100).toFixed(1)} cm from cube` : "Waiting for policy frames…";
    if (diagnostics.camera_thumbnails && typeof diagnostics.camera_thumbnails === "object") {
      lastCameraThumbnails = { ...lastCameraThumbnails, ...diagnostics.camera_thumbnails };
    }
    const grid = panel.querySelector("[data-simulation-camera-grid]");
    if (grid && Object.keys(lastCameraThumbnails).length) {
      grid.innerHTML = ["ceiling", "head_left", "head_right", "wrist_left", "wrist_right"]
        .filter((name) => lastCameraThumbnails[name])
        .map((name) => `<figure><img src="${lastCameraThumbnails[name]}" alt="${name.replaceAll("_", " ")} ACT input" /><figcaption>${name.replaceAll("_", " ")}</figcaption></figure>`)
        .join("");
    }
  }

  function showCalibrationReport() {
    const report = simulationCalibrationReport(latestEvaluation, lastPolicyDiagnostics);
    const el = viewerEl?.querySelector("[data-simulation-calibration-report]");
    if (el) {
      el.dataset.state = report.verdict.includes("PASSED") ? "pass" : "warning";
      el.textContent = [
        report.verdict,
        `Measurement frame: ${report.sampleFrame}`,
        report.closestDistanceM == null ? "Tool distance: unknown" : `Tool distance: ${(report.closestDistanceM * 100).toFixed(1)} cm`,
        report.verticalOffsetM == null ? "Vertical offset: rerun once to capture closest-approach XYZ" : `Tool height above cube center: ${(report.verticalOffsetM * 100).toFixed(1)} cm`,
        `Cube contacts: ${report.contacts}`,
        report.recommendation,
      ].join("\n");
    }
    setStatus(report.verdict.includes("PASSED") ? "ok" : "error", report.recommendation);
    return report;
  }

  async function copyFailureDebug() {
    const text = simulationFailureDebugText({ evaluation: latestEvaluation, diagnostics: lastPolicyDiagnostics, prefs: prefs(), activeRun });
    try {
      await navigator.clipboard.writeText(text);
      setStatus("ok", "Failure debug copied. Paste it into chat after the run fails.");
      return true;
    } catch {
      const el = viewerEl?.querySelector("[data-simulation-calibration-report]");
      if (el) {
        el.dataset.state = "warning";
        el.textContent = text;
        el.focus?.();
      }
      setStatus("error", "Clipboard access was blocked. The debug text is shown below for manual copy.");
      return false;
    }
  }

  async function rerunHeadlessEvaluation() {
    activeOfficialReplay = null;
    latestEvaluation = latestEvaluation ? { ...latestEvaluation, trajectoryAvailable: false } : null;
    return replayHeadlessEvaluation();
  }

  function paintHeadlessEvaluation(evaluation) {
    latestEvaluation = evaluation;
    const view = headlessEvaluationView(evaluation);
    const panel = viewerEl?.querySelector("[data-simulation-headless-eval]");
    if (!panel) return view;
    const source = panel.querySelector("[data-simulation-eval-source]");
    if (source) source.textContent = evaluation?.source === "official-replay" ? "VERIFIED EPISODE REPLAY" : "HEADLESS ACT EVALUATION";
    panel.dataset.state = view.stateKey;
    const values = {
      "[data-simulation-eval-state]": view.state,
      "[data-simulation-eval-reason]": view.reason,
      "[data-simulation-eval-steps]": view.steps,
      "[data-simulation-eval-lift]": view.lift,
      "[data-simulation-eval-time]": view.time,
      "[data-simulation-eval-joint]": view.joint,
      "[data-simulation-eval-device]": view.device,
    };
    for (const [selector, value] of Object.entries(values)) {
      const el = panel.querySelector(selector);
      if (el) el.textContent = value;
    }
    const progress = panel.querySelector("[data-simulation-eval-progress]");
    if (progress) progress.style.width = `${view.progress}%`;
    const stop = panel.querySelector("[data-simulation-stop-eval]");
    const canReplay = ["PASS", "FAIL"].includes(view.state) && evaluation?.trajectoryAvailable === true;
    if (stop) stop.disabled = view.state !== "RUNNING";
    const help = panel.querySelector("[data-simulation-eval-help]");
    if (help) help.textContent = canReplay
      ? "Replay shows the recorded headless attempt in this viewport. PASS requires 6 cm of cube lift held for 8 policy steps."
      : ["PASS", "FAIL"].includes(view.state)
        ? "This result predates trajectory recording. Run the ACT test again to enable visual replay."
        : "PASS requires 6 cm of cube lift held for 8 policy steps. New evaluations record a trajectory you can replay here.";
    return view;
  }

  async function replayHeadlessEvaluation() {
    if (latestEvaluation?.trajectoryAvailable !== true) {
      try {
        if (!cubeActSceneCompatible(prefs().scene)) {
          throw new Error(`The cube-pick ACT policy requires ${CUBE_ACT_SCENE}. Choose Cube pick demo, or load a policy trained for ${prefs().scene}.`);
        }
        replayWhenReady = true;
        const evaluation = await apiFn("/api/robotics/policy/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            checkpoint: "enactic/act-openarm-2-cell-pick_up_cube_mujoco",
            revision: "27cbd9a205d2e006aef518a54a3c53cf8e421a13",
            dataset: "enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot",
            scene: CUBE_ACT_SCENE,
            runId: activeRun?.runId || "",
          }),
        });
        paintHeadlessEvaluation(evaluation);
        setStatus("ok", "Rerunning the ACT evaluation and recording a replay. It will play automatically when complete.");
        void refreshHeadlessEvaluation();
        return true;
      } catch (error) {
        replayWhenReady = false;
        setStatus("error", `Could not start replay recording: ${error?.message || error}`);
        return false;
      }
    }
    try {
      const response = await fetch("/sandbox/openarm-mujoco/runs/lerobot-latest.trajectory.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Replay file returned ${response.status}`);
      const trajectory = await response.json();
      const frames = Array.isArray(trajectory?.frames) ? trajectory.frames : [];
      if (!frames.length) throw new Error("Replay contains no frames");
      connectSim();
      postToLive("mujoco", { type: "openarm-mujoco-replay", frames, intervalMs: 33 });
      setStatus("ok", `Replaying ${frames.length} recorded policy steps in MuJoCo.`);
      return true;
    } catch (error) {
      setStatus("error", `Could not replay evaluation: ${error?.message || error}`);
      return false;
    }
  }

  async function replayOfficialEpisode(episodeIndex) {
    const episode = Number(episodeIndex);
    if (![0, 3].includes(episode)) {
      setStatus("error", `Official episode ${episodeIndex} has no verified scene reset state.`);
      return false;
    }
    try {
      const response = await fetch(`/sandbox/openarm-mujoco/runs/official/episode-${episode}.trajectory.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Replay file returned ${response.status}`);
      const trajectory = await response.json();
      if (trajectory?.success !== true || !Array.isArray(trajectory.frames) || !trajectory.frames.length) {
        throw new Error("Replay is missing verified frames");
      }
      const selected = persistSimulationPrefs({ scene: trajectory.scene || "cell/demo.xml" }, currentUser(), projectId());
      revealPanel();
      pendingOfficialReplay = {
        episode,
        scene: selected.scene,
        frames: trajectory.frames,
        intervalMs: Math.round(1000 / Number(trajectory.fps || 30)),
        liftM: Number(trajectory.liftM),
        fps: Number(trajectory.fps || 30),
      };
      hookupSimulator(selected);
      activateSimulator({ taskView: true });
      if (!flushPendingOfficialReplay()) {
        setStatus("ok", `Loading MuJoCo for verified Episode ${episode}…`);
      }
      return true;
    } catch (error) {
      setStatus("error", `Could not replay official Episode ${episode}: ${error?.message || error}`);
      return false;
    }
  }

  function flushPendingOfficialReplay() {
    const replay = pendingOfficialReplay;
    if (!replay || mujocoReadyScene !== replay.scene) return false;
    pendingOfficialReplay = null;
    activeOfficialReplay = { ...replay, index: 0, total: replay.frames.length };
    paintHeadlessEvaluation(officialReplayEvaluation(activeOfficialReplay));
    activateSimulator({ taskView: true });
    postToLive("mujoco", {
      type: "openarm-mujoco-replay",
      frames: replay.frames,
      intervalMs: replay.intervalMs,
    });
    setStatus("ok", `Replaying official successful Episode ${replay.episode} · ${(replay.liftM * 100).toFixed(1)} cm verified cube lift.`);
    return true;
  }

  async function refreshHeadlessEvaluation({ schedule = true } = {}) {
    if (activeOfficialReplay) return latestEvaluation;
    if (!apiFn) return paintHeadlessEvaluation(null);
    let evaluation;
    try {
      evaluation = await apiFn("/api/robotics/policy/evaluate");
      if (evaluation?.status === "completed" && evaluation?.trajectoryAvailable !== true) {
        try {
          const replay = await fetch("/sandbox/openarm-mujoco/runs/lerobot-latest.trajectory.json", { cache: "no-store" });
          evaluation.trajectoryAvailable = replay.ok;
        } catch { /* the previous evaluator result may not have a replay */ }
      }
    } catch (error) {
      evaluation = { status: "unavailable", error: error?.message || "Sign in to read evaluator status." };
    }
    const view = paintHeadlessEvaluation(evaluation);
    const liveStep = Number(evaluation?.liveFrame?.step);
    if (view.state === "RUNNING" && Number.isFinite(liveStep) && liveStep !== lastMirroredEvaluationStep) {
      lastMirroredEvaluationStep = liveStep;
      postToLive("mujoco", { type: "openarm-mujoco-live-frame", frame: evaluation.liveFrame });
    }
    if (replayWhenReady && ["PASS", "FAIL"].includes(view.state) && evaluation?.trajectoryAvailable === true) {
      replayWhenReady = false;
      window.setTimeout(() => { void replayHeadlessEvaluation(); }, 100);
    }
    if (evaluationTimer) window.clearTimeout(evaluationTimer);
    evaluationTimer = 0;
    if (schedule && viewerEl && !viewerEl.classList.contains("hidden")) {
      evaluationTimer = window.setTimeout(() => { void refreshHeadlessEvaluation(); }, view.state === "RUNNING" ? 250 : 5000);
    }
    return evaluation;
  }

  async function stopHeadlessEvaluation({ sceneChange = false } = {}) {
    if (!apiFn) return null;
    replayWhenReady = false;
    activeOfficialReplay = null;
    if (evaluationTimer) window.clearTimeout(evaluationTimer);
    evaluationTimer = 0;
    const stopped = await apiFn("/api/robotics/policy/evaluate", { method: "DELETE" });
    paintHeadlessEvaluation(stopped);
    setStatus("ok", sceneChange
      ? "Previous ACT policy stopped. The next Start will use the newly selected scene."
      : "ACT policy stopped. Start or rerun to create a fresh scene-bound session.");
    return stopped;
  }

  async function switchSimulationScene(scene) {
    activeOfficialReplay = null;
    if (latestEvaluation?.status === "running") await stopHeadlessEvaluation({ sceneChange: true });
    else paintHeadlessEvaluation({ status: "idle", scene: String(scene || "") });
    const next = persistSimulationPrefs({ scene }, currentUser(), projectId());
    if (viewerEl && !viewerEl.classList.contains("hidden")) {
      hookupSimulator(next);
      emitSimulationFeed(next);
    }
  }

  function publishRunToViserRoom(run) {
    if (!apiFn || !run?.sample || Date.now() - lastNetworkPublishAt < networkPublishIntervalMs) return;
    lastNetworkPublishAt = Date.now();
    void apiFn('/api/robotics/live/simulation-frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run }),
    }).then((result) => {
      networkPublishIntervalMs = result?.connected ? 500 : 5000;
      if (activeRun?.runId === run.runId) activeRun = {
        ...activeRun,
        viser: {
          transport: "studio-event+viser-room",
          status: result?.connected ? "connected" : "local",
          ...(result?.scene_id ? { sceneId: String(result.scene_id) } : {}),
        },
      };
    }).catch(() => {
      networkPublishIntervalMs = 5000;
    });
  }

  function paintRunLogs(run = activeRun) {
    const el = runLogsEl();
    if (!el) return;
    if (!run) {
      el.textContent = "No active run.";
      return;
    }
    el.textContent = (run.logs || []).slice(-24).map((row) => {
      const time = row.at ? new Date(row.at).toLocaleTimeString() : "";
      return `${time} ${String(row.level || "info").toUpperCase()} ${row.message}`.trim();
    }).join("\n");
  }

  function publishRun(run, { persist = true, frame = false } = {}) {
    activeRun = run;
    if (persist) {
      lastRunPersistAt = Date.now();
      saveActiveSimulationRun(run, currentUser(), projectId());
    }
    paintRunLogs(run);
    emitSimulationFeed(prefs(), run);
    if (frame) {
      try { window.dispatchEvent(new CustomEvent(SIMULATION_FRAME_EVENT, { detail: run })); } catch { /* ignore */ }
      publishRunToViserRoom(run);
    }
    return run;
  }

  async function fetchMcpRunFeed() {
    const res = await fetch(`/mcp/sandbox/file?path=${encodeURIComponent(SIMULATION_FEED_PATH)}&t=${Date.now()}`).catch(() => null);
    if (!res?.ok) return { ok: false, sample: null, raw: "" };
    const data = await res.json().catch(() => ({}));
    const raw = String(data.text || "");
    if (!raw.trim()) return { ok: false, sample: null, raw };
    try {
      return { ok: true, sample: JSON.parse(raw), raw };
    } catch {
      return { ok: false, sample: null, raw };
    }
  }

  function paintRunFeed(sample, { fromMcp = false } = {}) {
    const summary = runSummaryEl();
    const json = runJsonEl();
    if (!sample) {
      if (summary) {
        summary.textContent = fromMcp
          ? `No run yet — open the sim, interact, then Snapshot. MCP: ${SIMULATION_FEED_PATH}`
          : "Waiting for end-of-run sample…";
      }
      if (json) json.textContent = "";
      return null;
    }
    const ik = sample.ik_errors || {};
    const left = ik.left?.pos_mm != null ? `${Math.round(ik.left.pos_mm)} mm` : "—";
    const right = ik.right?.pos_mm != null ? `${Math.round(ik.right.pos_mm)} mm` : "—";
    const checks = sample.feature_checks || {};
    const broken = Object.entries(checks).filter(([, v]) => v === "broken").map(([k]) => k);
    if (summary) {
      summary.textContent = [
        sample.run_reason || "run",
        sample.scene || "scene",
        `IK L ${left} · R ${right}`,
        `q̇max ${Number(sample.qvel_max || 0).toFixed(3)}`,
        broken.length ? `⚠ ${broken.join(", ")}` : "checks ok",
        sample.observed_at ? new Date(sample.observed_at).toLocaleTimeString() : "",
      ].filter(Boolean).join(" · ");
    }
    if (json) {
      try {
        json.textContent = JSON.stringify(sample, null, 2).slice(0, 12_000);
      } catch {
        json.textContent = String(sample);
      }
    }
    paintRunLogs();
    return sample;
  }

  async function refreshFeed({ fromMcp = true } = {}) {
    if (fromMcp) {
      const feed = await fetchMcpRunFeed();
      if (feed.sample) {
        lastAnalysis = { at: Date.now(), qvelMax: Number(feed.sample.qvel_max) || 0, sample: feed.sample };
        paintRunFeed(feed.sample, { fromMcp: true });
        return feed.sample;
      }
      paintRunFeed(null, { fromMcp: true });
      return null;
    }
    postToLive("mujoco", { type: "openarm-mujoco-end-run", reason: "viewer-refresh" });
    return null;
  }

  function snapshotRun() {
    postToLive("mujoco", { type: "openarm-mujoco-end-run", reason: "snapshot", force: true });
    setStatus("ok", "Snapshot requested — feed updates when the sim posts end-of-run.");
  }

  function statusEl() {
    return viewerEl?.querySelector("[data-simulation-status]") || null;
  }

  function setStatus(kind, text) {
    const el = statusEl();
    if (el) el.textContent = text || "";
    onStatus?.(kind || "ok", text || "");
  }

  function syncForm() {
    const p = prefs();
    const scene = viewerEl?.querySelector("[data-simulation-scene]");
    if (scene && document.activeElement !== scene) scene.value = p.scene;
    const gravity = viewerEl?.querySelector("[data-simulation-gravity]");
    if (gravity && document.activeElement !== gravity) gravity.value = String(p.gravity);
    const step = viewerEl?.querySelector("[data-simulation-timestep]");
    if (step && document.activeElement !== step) step.value = String(p.timestep);
    const url = viewerEl?.querySelector("[data-simulation-url]");
    if (url && document.activeElement !== url) url.value = p.simUrl;
    const hint = viewerEl?.querySelector("[data-simulation-embed]");
    if (hint) hint.textContent = `${p.simUrl} · MCP ${SIMULATION_FEED_PATH}`;
    const feedPath = viewerEl?.querySelector("[data-simulation-feed-path]");
    if (feedPath) feedPath.textContent = SIMULATION_FEED_PATH;
    return p;
  }

  function revealPanel() {
    docTabs?.upsert({ id: SIMULATION_TAB_ID, label: "MuJoCo", kind: "simulation" });
    // A changed tab routes through the shared activation handler. Guard its
    // re-entry while still letting the handler hide the previous surface.
    if (activatingTab) docTabs?.setActive(SIMULATION_TAB_ID, { notify: false });
    else {
      activatingTab = true;
      try { docTabs?.setActive(SIMULATION_TAB_ID); }
      finally { activatingTab = false; }
    }
    const col = mainCol();
    col?.classList.add("sim-layout-sim");
    col?.classList.remove("viser-layout-split", "viser-layout-viser", "viser-layout-cad", "teleop-layout-teleop");
    viewerEl?.classList.remove("hidden");
    viewerEl?.setAttribute("aria-hidden", "false");
    syncForm();
    activeRun = readActiveSimulationRun(currentUser(), projectId()) || activeRun;
    paintRunLogs(activeRun);
    void refreshFeed();
    void refreshHeadlessEvaluation();
    return prefs();
  }

  let lastAnalysis = { at: 0, qvelMax: 0, sample: null };

  function hideViewerOnly() {
    if (evaluationTimer) window.clearTimeout(evaluationTimer);
    evaluationTimer = 0;
    postToLive("mujoco", { type: "openarm-mujoco-pause", on: true });
    parkLive("mujoco", { keepSrc: true });
    viewerEl?.classList.add("hidden");
    viewerEl?.setAttribute("aria-hidden", "true");
    mainCol()?.classList.remove("sim-layout-sim");
  }

  function hideSimulatorBoot() {
    if (simulatorBootTimer) window.clearTimeout(simulatorBootTimer);
    simulatorBootTimer = 0;
    const state = bootStateEl();
    if (state) state.hidden = true;
  }

  function showSimulatorBoot(scene) {
    if (simulatorBootTimer) window.clearTimeout(simulatorBootTimer);
    const state = bootStateEl();
    if (!state) return;
    const title = state.querySelector("[data-simulation-boot-title]");
    const detail = state.querySelector("[data-simulation-boot-detail]");
    state.hidden = false;
    state.dataset.state = "loading";
    if (title) title.textContent = "Loading MuJoCo";
    if (detail) detail.textContent = `Starting ${scene || "the selected scene"}…`;
    simulatorBootTimer = window.setTimeout(() => {
      state.dataset.state = "slow";
      if (title) title.textContent = "MuJoCo is still starting";
      if (detail) detail.textContent = "Browser physics has not reported ready yet.";
    }, 15000);
  }

  function closeTab() {
    parkLive("mujoco", { keepSrc: false });
    hideViewerOnly();
    docTabs?.remove(SIMULATION_TAB_ID);
  }

  function simFramePath(src) {
    try {
      return new URL(src, globalThis.location?.origin || "https://render3d.app").pathname;
    } catch {
      return String(src || "");
    }
  }

  function simFrameScene(src) {
    try {
      return new URL(src, globalThis.location?.origin || "https://render3d.app").searchParams.get("scene") || "";
    } catch {
      return "";
    }
  }

  function hookupSimulator(p, { adopt = true } = {}) {
    const want = simUrlWithScene(p.simUrl, p.scene);
    const rec = ensureLive("mujoco");
    const frame = rec?.el;
    const cur = frame?.getAttribute("src") || "";
    if (frame) frame.setAttribute("data-src", want);
    if (adopt) adoptLive("mujoco", liveSlot(), { live: true });
    if (!frame || !rec.live) return;

    const samePage = cur && cur !== "about:blank" && simFramePath(cur) === simFramePath(want);
    const sameScene = samePage && simFrameScene(cur) === p.scene;

    if (sameScene) {
      if (mujocoReadyScene !== p.scene) showSimulatorBoot(p.scene);
      postToLive("mujoco", { type: "studio-simulation-settings", settings: simulationSettingsPayload(p) });
      postToLive("mujoco", { type: "openarm-mujoco-pause", on: false });
      return;
    }
    if (samePage) {
      mujocoReadyScene = "";
      showSimulatorBoot(p.scene);
      postToLive("mujoco", { type: "openarm-mujoco-load-model", scene: p.scene });
      postToLive("mujoco", { type: "studio-simulation-settings", settings: simulationSettingsPayload(p) });
      postToLive("mujoco", { type: "openarm-mujoco-pause", on: false });
      return;
    }
    if (cur !== want) {
      mujocoReadyScene = "";
      showSimulatorBoot(p.scene);
      frame.setAttribute("src", want);
    }
  }

  function activateSimulator({ taskView = false } = {}) {
    postToLive("mujoco", { type: "openarm-mujoco-activate", taskView });
  }

  function setPaused(on) {
    postToLive("mujoco", { type: "openarm-mujoco-pause", on: on === true });
  }

  function connectSim() {
    const urlInput = viewerEl?.querySelector("[data-simulation-url]");
    const next = persistSimulationPrefs({ simUrl: urlInput?.value || SIMULATION_EMBED_SRC }, currentUser(), projectId());
    revealPanel();
    hookupSimulator(next);
    emitSimulationFeed(next);
    setStatus("ok", `MuJoCo connected — ${next.scene}. Use keyboard in the sim pane (not Quest Y).`);
    syncForm();
    return next;
  }

  function start({ source = "simulation-viewer", draft = null } = {}) {
    const selected = draft?.scene
      ? persistSimulationPrefs({ scene: draft.scene }, currentUser(), projectId())
      : prefs();
    revealPanel();
    hookupSimulator(selected);
    const run = createSimulationRun({ projectId: projectId(), prefs: selected, source });
    publishRun(run);
    postToLive("mujoco", { type: "studio-simulation-settings", settings: simulationSettingsPayload(selected) });
    postToLive("mujoco", { type: "openarm-mujoco-run-start", run });
    postToLive("mujoco", { type: "openarm-mujoco-pause", on: false });
    setStatus("ok", `Simulation started · ${run.scene} · run ${run.runId}. Live samples are routed to recording and any connected Viser/VR room.`);
    return run;
  }

  function openActiveRun() {
    const stored = readActiveSimulationRun(currentUser(), projectId());
    if (!stored?.runId) return start({ source: "simulation-viewer" });
    activeRun = stored;
    const selected = simulationPrefsForActiveRun(prefs(), stored);
    persistSimulationPrefs(selected, currentUser(), projectId());
    revealPanel();
    hookupSimulator(selected);
    postToLive("mujoco", { type: "openarm-mujoco-run-start", run: stored });
    postToLive("mujoco", { type: "openarm-mujoco-pause", on: false });
    publishRun(appendSimulationRunLog(stored, "info", `Live view opened for ${stored.scene}`));
    setStatus("ok", `Live run ${stored.runId} · ${stored.scene}.`);
    return stored;
  }

  function open() {
    revealPanel();
    const p = prefs();
    hookupSimulator(p);
    emitSimulationFeed(p);
    setStatus("ok", `MuJoCo · ${p.scene}. Connect your own URL below, or use the bundled WASM. Quest Y does not start this sim.`);
    return p;
  }

  function home() {
    const p = open();
    postToLive("mujoco", { type: "openarm-mujoco-home" });
    setStatus("ok", `MuJoCo reset to the configured home pose in ${p.scene}.`);
    return true;
  }

  function loadToRoboticsHome() {
    const draft = createSimulationDeploymentDraft(prefs(), projectId());
    onLoadToHome?.(draft);
    setStatus("ok", `${draft.label} loaded to Robotics Home as a simulation-only scene.`);
    return draft;
  }

  function activateFromShared() {
    open();
  }

  /** @deprecated approve flow removed — open() loads sim directly */
  function approve() {
    return connectSim();
  }

  /** @deprecated */
  function startCalibration() {
    snapshotRun();
    return prefs();
  }

  viewerEl?.addEventListener("click", (e) => {
    if (e.target?.closest?.("[data-simulation-connect]")) {
      connectSim();
      return;
    }
    if (e.target?.closest?.("[data-simulation-open-live]")) {
      openActiveRun();
      return;
    }
    if (e.target?.closest?.("[data-simulation-snapshot]")) {
      snapshotRun();
      return;
    }
    if (e.target?.closest?.("[data-simulation-refresh-feed]")) {
      void refreshFeed();
      return;
    }
    if (e.target?.closest?.("[data-simulation-refresh-eval]")) {
      void refreshHeadlessEvaluation();
      return;
    }
    if (e.target?.closest?.("[data-simulation-rerun-eval]")) {
      void rerunHeadlessEvaluation();
      return;
    }
    if (e.target?.closest?.("[data-simulation-stop-eval]")) {
      void stopHeadlessEvaluation();
      return;
    }
    if (e.target?.closest?.("[data-simulation-calibration-check]")) {
      showCalibrationReport();
      return;
    }
    if (e.target?.closest?.("[data-simulation-copy-debug]")) {
      void copyFailureDebug();
      return;
    }
    if (e.target?.closest?.("[data-simulation-load-home]")) {
      loadToRoboticsHome();
    }
  });

  viewerEl?.addEventListener("change", (e) => {
    const scene = e.target?.closest?.("[data-simulation-scene], [data-simulation-ribbon-scene]");
    if (scene) {
      void switchSimulationScene(scene.value);
      return;
    }
    const gravity = e.target?.closest?.("[data-simulation-gravity]");
    if (gravity) persistSimulationPrefs({ gravity: gravity.value }, currentUser(), projectId());
    const step = e.target?.closest?.("[data-simulation-timestep]");
    if (step) persistSimulationPrefs({ timestep: step.value }, currentUser(), projectId());
    const url = e.target?.closest?.("[data-simulation-url]");
    if (url) persistSimulationPrefs({ simUrl: url.value }, currentUser(), projectId());
    const next = syncForm();
    if (viewerEl && !viewerEl.classList.contains("hidden")) {
      hookupSimulator(next);
      emitSimulationFeed(next);
    }
  });

  window.addEventListener("message", (e) => {
    const data = e?.data;
    const frame = ensureLive("mujoco")?.el;
    if (frame?.contentWindow && e.source && e.source !== frame.contentWindow) return;
    if (data?.type === "openarm-mujoco-live-sample" && data.sample) {
      if (data.runId && activeRun?.runId && data.runId !== activeRun.runId) return;
      if (!activeRun) return;
      const run = applySimulationRunSample(activeRun, data.sample);
      publishRun(run, { persist: Date.now() - lastRunPersistAt >= 1000, frame: true });
      paintRunFeed(data.sample);
    }
    if (data?.type === "openarm-mujoco-ready") {
      mujocoReadyScene = String(data.scene || prefs().scene || "");
      hideSimulatorBoot();
      activateSimulator({ taskView: activeRun?.status === "running" || !!pendingOfficialReplay });
      flushPendingOfficialReplay();
    }
    if (data?.type === "openarm-mujoco-analysis" && data.sample) {
      lastAnalysis = { at: Date.now(), qvelMax: Number(data.sample?.qvel_max) || 0, sample: data.sample };
      if (activeRun && (!data.runId || data.runId === activeRun.runId)) {
        publishRun(applySimulationRunSample(activeRun, data.sample, { live: false }), { frame: true });
      }
      paintRunFeed(data.sample);
    }
    if (data?.type === "openarm-mujoco-replay-progress") {
      paintPolicyDiagnostics(data.diagnostics);
      const index = Number(data.index) + 1;
      const total = Number(data.total) || 0;
      if (activeOfficialReplay) {
        activeOfficialReplay = { ...activeOfficialReplay, index, total };
        paintHeadlessEvaluation(officialReplayEvaluation(activeOfficialReplay));
      }
      if (index === 1 || index === total || index % 30 === 0) {
        setStatus("ok", index >= total
          ? `Replay complete · ${total} recorded policy steps.`
          : `Replaying recorded attempt · step ${index} of ${total}.`);
      }
    }
    if (data?.type === "openarm-mujoco-live-frame-applied" && data.applied) {
      paintPolicyDiagnostics(data.diagnostics);
      setStatus("ok", `Live evaluation mirror · policy step ${Number(data.step) || 0} · ${Number(data.simSeconds || 0).toFixed(2)} sim s.`);
    }
    if (data?.type === "openarm-mujoco-end-run") {
      if (activeRun) publishRun(appendSimulationRunLog(activeRun, "info", `${data.reason || "end-run"} · requesting persisted snapshot`));
      if (activeRun) postToLive("mujoco", { type: "openarm-mujoco-run-start", run: activeRun });
      postToLive("mujoco", { type: "openarm-mujoco-end-run", reason: data.reason || "end-run", force: true });
      window.setTimeout(() => { void refreshFeed(); }, 400);
    }
  });

  document.addEventListener("render3d:robotics-workflow-example", (event) => {
    const match = String(event?.detail?.id || "").match(/^openarm-official-success-(\d+)$/);
    if (match) void replayOfficialEpisode(Number(match[1]));
  });

  syncForm();

  return {
    open,
    home,
    connect: connectSim,
    start,
    openActiveRun,
    approve,
    startCalibration,
    hideViewerOnly,
    closeTab,
    activateFromShared,
    activateViewport: activateSimulator,
    setPaused,
    replayOfficialEpisode,
    loadToRoboticsHome,
    diagnostics: () => ({
      prefs: prefs(),
      activeRun: readActiveSimulationRun(currentUser(), projectId()) || activeRun || null,
      lastAnalysis,
      feedPath: SIMULATION_FEED_PATH,
    }),
    syncList: syncForm,
    isOpen: () => !viewerEl?.classList.contains("hidden"),
  };
}
