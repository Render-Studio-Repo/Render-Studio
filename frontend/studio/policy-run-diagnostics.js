export const POLICY_RUN_LOG_SCHEMA = "render3d.policy-run-log/v1";
export const MAX_POLICY_RUN_EVENTS = 80;

const TERMINAL = new Set(["passed", "failed", "stopped"]);

function iso(now) {
  const value = typeof now === "function" ? now() : new Date();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function runId() {
  return `policy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cameraSummary(cameras = null) {
  const rows = cameras?.cameras && typeof cameras.cameras === "object" ? cameras.cameras : {};
  const expected = ["left", "right", "zed"];
  const live = expected.filter((name) => rows[name]?.live === true);
  return {
    live: live.length,
    expected: expected.length,
    label: cameras ? `${live.length}/${expected.length} LIVE` : "CHECKING",
    sources: expected.map((name) => `${name}=${rows[name]?.live === true ? "live" : rows[name]?.reason || "offline"}`),
  };
}

export function createPolicyRunDiagnostics({ now = () => new Date(), makeRunId = runId } = {}) {
  let session = null;

  const add = (stage, state, message, details = {}) => {
    if (!session) return null;
    const at = iso(now);
    session.updatedAt = at;
    session.events.push({ at, stage: String(stage), state: String(state), message: String(message), details });
    if (session.events.length > MAX_POLICY_RUN_EVENTS) session.events.splice(0, session.events.length - MAX_POLICY_RUN_EVENTS);
    return snapshot();
  };

  const start = ({ policy, scene, mode = "simulation" } = {}) => {
    const at = iso(now);
    session = {
      schema: POLICY_RUN_LOG_SCHEMA,
      id: makeRunId(),
      status: "starting",
      policy: String(policy || "unknown policy"),
      scene: String(scene || "unknown scene"),
      mode: String(mode),
      startedAt: at,
      updatedAt: at,
      simulationRunId: "",
      cameras: cameraSummary(),
      stats: {},
      events: [],
    };
    add("trigger", "START", `Run requested for ${session.policy}`);
    return snapshot();
  };

  const setRun = (id) => {
    if (!session) return null;
    session.simulationRunId = String(id || "");
    session.status = "running";
    return add("simulation", "PASS", session.simulationRunId ? `MuJoCo run ${session.simulationRunId} started` : "Simulation started");
  };

  const setCameras = (cameras) => {
    if (!session) return null;
    session.cameras = cameraSummary(cameras);
    return add("cameras", session.cameras.live === session.cameras.expected ? "PASS" : "WARN", session.cameras.label, { sources: session.cameras.sources });
  };

  const skipCameras = (reason = "Simulation run does not open hardware cameras") => {
    if (!session) return null;
    session.cameras = { live: 0, expected: 0, label: "SIMULATION ONLY", sources: [] };
    return add("cameras", "SKIP", reason);
  };

  const finish = (status, stats = {}, message = "") => {
    if (!session) return null;
    const normalized = TERMINAL.has(status) ? status : "failed";
    session.status = normalized;
    session.stats = { ...stats };
    add("outcome", normalized === "passed" ? "PASS" : normalized === "stopped" ? "STOP" : "FAIL", message || normalized);
    return snapshot();
  };

  const snapshot = () => session ? structuredClone(session) : null;

  const text = () => {
    if (!session) return "No policy run has been triggered yet.";
    const lines = [
      `schema=${session.schema}`,
      `run_id=${session.id}`,
      `status=${session.status}`,
      `policy=${session.policy}`,
      `scene=${session.scene}`,
      `mode=${session.mode}`,
      `simulation_run_id=${session.simulationRunId || "not_created"}`,
      `started_at=${session.startedAt}`,
      `updated_at=${session.updatedAt}`,
      `cameras=${session.cameras.label}`,
      ...session.cameras.sources.map((source) => `camera_${source}`),
      ...Object.entries(session.stats).map(([key, value]) => `stat_${key}=${value}`),
      "events:",
      ...session.events.map((event) => `${event.at} [${event.state}] ${event.stage}: ${event.message}`),
    ];
    return lines.join("\n");
  };

  return { add, finish, setCameras, setRun, skipCameras, snapshot, start, text };
}
