/** Analysis bridge for OpenArm MuJoCo Web → live UI, recording, and MCP feed. Token mujoco1.
 * Live samples stay in memory; end-of-run snapshots persist to the MCP feed.
 */

export const MUJOCO1_TOKEN = "mujoco1";
export const FEED_PATH = "openarm-mujoco/runs/latest.json";
const MCP_CONNECT_KEY = "render3d:sandboxMcpConnect";

function mcpWritesEnabled() {
  try {
    const v = localStorage.getItem(MCP_CONNECT_KEY);
    return v !== "0";
  } catch {
    return true;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function asView(buf) {
  if (!buf) return null;
  if (typeof buf.getView === "function") return buf.getView();
  return buf;
}

function sampleApp(app, reason = "manual") {
  if (!app?.mjModel || !app?.mjData) return null;
  const qpos = asView(app.mjData.qpos);
  const nq = app.mjModel.nq || (qpos ? qpos.length : 0);
  let qvelMax = 0;
  try {
    const qvel = asView(app.mjData.qvel);
    if (qvel) {
      for (let i = 0; i < qvel.length; i++) qvelMax = Math.max(qvelMax, Math.abs(Number(qvel[i]) || 0));
    }
  } catch { /* optional */ }
  const joints = [];
  try {
    for (const side of ["left", "right"]) {
      const arm = app.controller?.arms?.[side];
      if (!arm?.qposIds || !qpos) continue;
      arm.qposIds.forEach((adr, i) => {
        joints.push({
          name: `openarm_${side}_joint${i + 1}`,
          qpos: Number(qpos[adr]) || 0,
        });
      });
    }
  } catch {
    /* joint names optional */
  }

  const errors = {};
  for (const side of ["left", "right"]) {
    try {
      const t = app.targets?.[side];
      if (!t || !app.controller?.arms?.[side]) continue;
      const { errorP, errorR } = app.controller.arms[side].poseError(app.mjData, t.pos, t.quat);
      errors[side] = {
        pos_mm: Math.hypot(...errorP) * 1000,
        rot_deg: (Math.hypot(...errorR) * 180) / Math.PI,
      };
    } catch {
      errors[side] = null;
    }
  }

  const scene = app.sceneSelect?.value || app.currentScene || app.scenePath || "unknown";
  const statusText = app.statusElement?.textContent || app.lastStatus || "";
  const maxErr = Math.max(
    errors.left?.pos_mm || 0,
    errors.right?.pos_mm || 0,
  );

  return {
    kind: "openarm_mujoco_analysis",
    token: MUJOCO1_TOKEN,
    source: "enactic/openarm_mujoco",
    docs: "https://docs.openarm.dev/simulation/mujoco/",
    run_reason: reason,
    observed_at: nowIso(),
    scene,
    nq,
    qvel_max: qvelMax,
    standstill: !!app.standstill,
    lifter_height_m: Number(app.lifterHeight) || 0,
    joint_count: joints.length,
    joints: joints.slice(0, 32),
    ik_errors: errors,
    status_text: String(statusText).slice(0, 400),
    feature_checks: {
      "openarm.mujoco_web": "ok",
      "openarm.rig_2_0": joints.some((j) => /openarm_(left|right)_joint/.test(j.name)) ? "ok" : "unknown",
      "openarm.ik_converged": maxErr < 25 ? "ok" : maxErr < 80 ? "unknown" : "broken",
      "viewport.boot": "ok",
      "viewport.models": app.meshes?.length ? "ok" : "unknown",
    },
  };
}

async function persist(sample) {
  if (mcpWritesEnabled()) {
    try {
      await fetch("/mcp/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "write",
          agent: "sam",
          path: FEED_PATH,
          text: JSON.stringify(sample).slice(0, 110_000),
        }),
      });
    } catch { /* optional */ }
  }
  try {
    window.parent?.postMessage({ type: "openarm-mujoco-analysis", token: MUJOCO1_TOKEN, sample }, "*");
  } catch { /* optional */ }
}

export function startAnalysisBridge() {
  let lastHash = "";
  let lastPersistAt = 0;
  let activeRun = null;
  let replayTimer = 0;

  const tagRun = (sample) => !sample ? null : activeRun ? {
    ...sample,
    run_id: activeRun.runId,
    project_id: activeRun.projectId,
    recording_root: activeRun.recordingRoot,
  } : sample;

  const endRun = async (reason = "end-run", { force = false } = {}) => {
    const app = window.__app;
    if (!app || (app.paused && !force)) return null;
    const sample = tagRun(sampleApp(app, reason));
    if (!sample) return null;
    const hash = `${reason}:${sample.scene}:${sample.joint_count}:${Math.round(sample.ik_errors?.left?.pos_mm || 0)}:${(sample.joints?.[3]?.qpos || 0).toFixed(2)}`;
    const now = Date.now();
    if (!force && hash === lastHash && now - lastPersistAt < 3000) return sample;
    lastHash = hash;
    lastPersistAt = now;
    await persist(sample);
    return sample;
  };

  window.addEventListener("message", (ev) => {
    const data = ev?.data;
    if (!data) return;
    if (data.type === "openarm-mujoco-run-start") {
      activeRun = data.run?.runId ? data.run : null;
    }
    if (data.type === "openarm-mujoco-request" || data.type === "openarm-mujoco-end-run") {
      void endRun(String(data.reason || data.type), { force: true });
    }
    if (data.type === "openarm-train-hot") {
      if (!data.on) void endRun("train-stop", { force: true });
    }
    if (data.type === "openarm-mujoco-pause") {
      if (window.__app) window.__app.paused = !!data.on;
    }
    if (data.type === "openarm-mujoco-home") {
      window.__app?.reset?.();
    }
    if (data.type === "openarm-mujoco-replay") {
      window.clearInterval(replayTimer);
      const frames = Array.isArray(data.frames) ? data.frames : [];
      const app = window.__app;
      if (!app || !frames.length || typeof window.__mujocoApplyQpos !== "function") return;
      app.paused = true;
      let index = 0;
      const show = () => {
        const frame = frames[index];
        if (!frame || !window.__mujocoApplyQpos(frame.qpos)) {
          window.clearInterval(replayTimer);
          return;
        }
        window.parent?.postMessage({
          type: "openarm-mujoco-replay-progress", token: MUJOCO1_TOKEN,
          index, total: frames.length, step: frame.step, diagnostics: frame.diagnostics,
        }, "*");
        index += 1;
        if (index >= frames.length) window.clearInterval(replayTimer);
      };
      show();
      replayTimer = window.setInterval(show, Math.max(16, Number(data.intervalMs) || 33));
    }
    if (data.type === "openarm-mujoco-live-frame") {
      const frame = data.frame;
      const app = window.__app;
      if (!app || !Array.isArray(frame?.qpos) || typeof window.__mujocoApplyQpos !== "function") return;
      app.paused = true;
      const applied = window.__mujocoApplyQpos(frame.qpos);
      window.parent?.postMessage({
        type: "openarm-mujoco-live-frame-applied", token: MUJOCO1_TOKEN,
        applied, step: frame.step, simSeconds: frame.sim_seconds, diagnostics: frame.diagnostics,
      }, "*");
    }
    if (data.type === "openarm-mcp-connect") {
      try {
        localStorage.setItem(MCP_CONNECT_KEY, data.on ? "1" : "0");
      } catch { /* optional */ }
    }
    if (data.type === "studio-simulation-settings") {
      const app = window.__app;
      const settings = data.settings || {};
      const scene = String(settings.scene || "").trim();
      if (scene && scene !== app?.scenePath && typeof window.__mujocoLoadScene === "function") {
        void window.__mujocoLoadScene(scene);
      }
      const g = Number(settings.gravity);
      try {
        if (Number.isFinite(g) && app?.mjModel?.opt?.gravity) app.mjModel.opt.gravity[2] = g;
      } catch { /* optional */ }
      const lift = Number(settings.lifterHeightM);
      if (app && Number.isFinite(lift)) app.lifterHeight = lift;
      if (app && settings.standstill != null) {
        app.standstill = settings.standstill !== false;
        if (app.standstill && app.reset) app.reset();
      }
    }
  });

  window.__mujocoEndRun = (reason = "api") => endRun(reason, { force: true });

  const liveTimer = window.setInterval(() => {
    const app = window.__app;
    if (!activeRun || !app || app.paused) return;
    const sample = tagRun(sampleApp(app, "live"));
    if (!sample) return;
    try {
      window.parent?.postMessage({
        type: "openarm-mujoco-live-sample",
        token: MUJOCO1_TOKEN,
        runId: activeRun.runId,
        sample,
      }, "*");
    } catch { /* optional */ }
  }, 250);

  return { token: MUJOCO1_TOKEN, feed: FEED_PATH, endRun, liveTimer };
}

if (typeof window !== "undefined") {
  startAnalysisBridge();
}
