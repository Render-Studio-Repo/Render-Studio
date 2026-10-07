export const SIMULATION_RUN_SCHEMA = "render3d.simulation-run/v1";
export const SIMULATION_RUN_STORAGE_KEY = "render3d:activeSimulationRun";
export const SIMULATION_RUN_EVENT = "render3d:simulation-run";
export const SIMULATION_FRAME_EVENT = "render3d:simulation-frame";
export const SIMULATION_RUN_FEED = "openarm-mujoco/runs/latest.json";
export const MAX_SIMULATION_RUN_LOGS = 80;

function userId(user) {
  return String(user?.id || user?.email || "anon").trim() || "anon";
}

function iso(value = new Date()) {
  return typeof value === "string" ? value : value.toISOString();
}

function generatedRunId() {
  return (globalThis.crypto?.randomUUID?.() || `run-${Date.now()}`).replaceAll("-", "").slice(0, 20);
}

export function simulationRunStorageKey(user = null, projectId = "") {
  const project = String(projectId || "").trim() || "none";
  return `${SIMULATION_RUN_STORAGE_KEY}:${userId(user)}:project:${project}`;
}

export function createSimulationRun({ projectId = "", prefs = {}, source = "simulation-viewer", runId = generatedRunId(), now = new Date() } = {}) {
  const at = iso(now);
  const scene = String(prefs.scene || "openarm_bimanual.xml").trim() || "openarm_bimanual.xml";
  const label = source === "robotics-home" ? "Robotics Home" : "MuJoCo";
  return {
    schema: SIMULATION_RUN_SCHEMA,
    runId: String(runId),
    projectId: String(projectId || ""),
    engine: "mujoco",
    scene,
    simUrl: String(prefs.simUrl || "/sandbox/openarm-mujoco/index.html?embed=1"),
    source: String(source || "simulation-viewer"),
    status: "starting",
    startedAt: at,
    updatedAt: at,
    runFeed: SIMULATION_RUN_FEED,
    recordingRoot: `openarm-mujoco/episodes/${String(runId)}`,
    viser: { transport: "studio-event+viser-room", status: "local" },
    vrVisible: true,
    sample: null,
    logs: [{ at, level: "info", message: `Starting ${scene} from ${label}` }],
  };
}

export function appendSimulationRunLog(run, level, message, now = new Date()) {
  if (!run) return null;
  const logs = [...(Array.isArray(run.logs) ? run.logs : []), {
    at: iso(now),
    level: String(level || "info"),
    message: String(message || "").slice(0, 500),
  }].slice(-MAX_SIMULATION_RUN_LOGS);
  return { ...run, updatedAt: iso(now), logs };
}

export function applySimulationRunSample(run, sample, { live = true } = {}) {
  if (!run || !sample || typeof sample !== "object") return run || null;
  const at = String(sample.observed_at || new Date().toISOString());
  const next = {
    ...run,
    scene: String(sample.scene || run.scene),
    status: live ? "running" : run.status,
    updatedAt: at,
    sample,
  };
  return appendSimulationRunLog(next, live ? "live" : "snapshot", `${live ? "Live sample" : "Snapshot"} · ${Number(sample.joint_count ?? sample.joints?.length ?? 0)} joints`, at);
}

export function readActiveSimulationRun(user = null, projectId = "") {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(simulationRunStorageKey(user, projectId)) || "null");
    if (parsed?.schema !== SIMULATION_RUN_SCHEMA || parsed?.engine !== "mujoco" || !parsed?.runId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveActiveSimulationRun(run, user = null, projectId = "") {
  if (!run) return null;
  try {
    globalThis.localStorage?.setItem(simulationRunStorageKey(user, projectId || run.projectId), JSON.stringify(run));
  } catch { /* private mode */ }
  try {
    globalThis.window?.dispatchEvent?.(new CustomEvent(SIMULATION_RUN_EVENT, { detail: run }));
  } catch { /* non-browser tests */ }
  return run;
}
