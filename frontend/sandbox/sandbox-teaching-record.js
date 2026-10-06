/**
 * Record what Sam does so a named AI trainee can mimic + run MuJoCo unattended.
 * Uses existing train loop, context log, and MCP sandbox-sessions/. Token teach1.
 */

import { postContextEvent } from "./sandbox-context-log.js?v=ctxlog1";
import { getSharedTrainingLoop, TRAIN1_TOKEN } from "./openarm-training-loop.js?v=20260923-draw-recordings1&simrun=20260923-1";
import { postToLive, adoptLive } from "./sandbox-live-instances.js?v=sblive1&teleop-y=20260922-poseconnect1&dimos-viser-local1&vrrobot=20260927-2";

export const TEACH1_TOKEN = "teach1";
export const TEACH_DIR = "sandbox-sessions/teaching";
export const LATEST_TEACH = `${TEACH_DIR}/latest.json`;
export const LATEST_TEACH_RUN = `${TEACH_DIR}/latest-run.json`;

function nid() {
  return (globalThis.crypto?.randomUUID?.() || `t${Date.now()}`).replace(/-/g, "").slice(0, 14);
}

function nowIso() {
  return new Date().toISOString();
}

async function mcpWrite(path, obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", agent: "sam", path, text: text.slice(0, 110_000) }),
  }).catch(() => null);
  return !!(res && res.ok);
}

async function mcpRead(path) {
  const res = await fetch(`/mcp/sandbox/file?path=${encodeURIComponent(path)}&t=${Date.now()}`).catch(() => null);
  if (!res || !res.ok) return { ok: false, text: "" };
  const data = await res.json().catch(() => ({}));
  return { ok: true, text: String(data.text || "") };
}

/**
 * Send calculated CAD / remix MJCF into the existing MuJoCo iframe (no second physics loop).
 */
export async function sendGeneratedModelToSim({
  scene = "",
  mjcf = "",
  remixId = "",
  path = "",
} = {}) {
  let scenePath = String(scene || "").trim();
  if (mjcf) {
    scenePath = scenePath || "sandbox_generated.xml";
    await mcpWrite(`openarm-mujoco/v2/${scenePath.replace(/^v2\//, "")}`, mjcf);
  }
  const payload = {
    type: "openarm-mujoco-load-model",
    token: TEACH1_TOKEN,
    scene: scenePath || "cell/demo.xml",
    remix_id: remixId || "",
    path: path || "",
  };
  adoptLive("mujoco", globalThis.document?.querySelector?.("[data-sbvp-stage='mujoco'] [data-sb-live-slot='mujoco']") || null, { live: true });
  const ok = postToLive("mujoco", payload);
  void postContextEvent({
    source: "sandbox-teach",
    feature_id: "sandbox.sim.send_model",
    event_kind: "send_to_sim",
    target_id: scenePath || "mujoco",
    context: { remix: String(remixId || "").slice(0, 40), ok: String(ok) },
  });
  return { ok, scene: payload.scene, token: TEACH1_TOKEN };
}

export function createTeachingRecorder({ speak, onStatus = () => {} } = {}) {
  const train = getSharedTrainingLoop({ onStatus, speak });
  let session = null;
  let actions = [];
  let pageCapture = null;

  const setStatus = (msg) => onStatus(msg);

  const onWorkshop = (ev) => {
    if (!session) return;
    const d = ev?.detail || {};
    const kind = ev.type === "render3d-sandbox-draw" ? "draw" : ev.type;
    if (kind === "draw") session.draw_strokes = (session.draw_strokes || 0) + 1;
    actions.push({
      at: nowIso(),
      kind,
      mode: d.mode || d.id || "",
      source: d.source || "",
      x: Number(d.x) || 0,
      y: Number(d.y) || 0,
    });
    if (actions.length > 400) actions = actions.slice(-400);
  };

  const bind = () => {
    const w = globalThis.window;
    if (!w?.addEventListener) return;
    w.addEventListener("render3d-sandbox-nw-mode", onWorkshop);
    w.addEventListener("render3d-sandbox-live", onWorkshop);
    w.addEventListener("render3d-sandbox-draw", onWorkshop);
  };
  bind();

  async function start({ trainee = "astra", task = "" } = {}) {
    session = {
      kind: "sandbox_teaching_session",
      token: TEACH1_TOKEN,
      session_id: `teach_${nid()}`,
      trainee: String(trainee || "astra").slice(0, 40),
      task: String(task || "Watch Sam draw and render it").slice(0, 200),
      started_at: nowIso(),
      train_token: TRAIN1_TOKEN,
      actions: [],
      draw_strokes: 0,
      episode_id: null,
    };
    actions = [];
    try {
      const { createSandboxContextCapture } = await import("./sandbox-context-log.js?v=ctxlog1");
      pageCapture = createSandboxContextCapture({ source: "sandbox-teach", onStatus: setStatus });
      pageCapture.start();
    } catch { pageCapture = null; }
    await train.startDemo({ astraTask: session.task });
    session.episode_id = train.getState().episodeId;
    setStatus(`Recording teaching · trainee ${session.trainee}`);
    if (typeof speak === "function") {
      await speak("astra", `Watching Sam. ${session.trainee} will replay in sim.`);
    }
    void postContextEvent({
      source: "sandbox-teach",
      feature_id: "sandbox.teach.record",
      event_kind: "teach_start",
      target_id: session.session_id,
      context: { trainee: session.trainee },
    });
    return session;
  }

  async function stop() {
    if (!session) return { ok: false, reason: "no_session" };
    pageCapture?.stop?.();
    const savedTrain = await train.markSuccess();
    session.ended_at = nowIso();
    session.actions = actions.slice();
    session.episode_id = savedTrain?.episode?.episode_id || session.episode_id;
    session.sample_count = savedTrain?.episode?.sample_count || 0;
    session.gauge = {
      draw_strokes: session.draw_strokes || 0,
      render_attempted: (session.draw_strokes || 0) > 0,
      mimic: (session.draw_strokes || 0) >= 8 ? "enough_ink_to_score" : "need_more_drawing",
    };
    session.paths = {
      session: `${TEACH_DIR}/${session.session_id}.json`,
      latest: LATEST_TEACH,
      draw: `${TEACH_DIR}/latest-draw.json`,
      episode: "openarm-mujoco/episodes/latest.json",
    };
    const ink = actions.filter((a) => a.kind === "draw").slice(-200);
    await mcpWrite(`${TEACH_DIR}/latest-draw.json`, {
      token: TEACH1_TOKEN,
      session_id: session.session_id,
      trainee: session.trainee,
      strokes: ink,
      gauge: session.gauge,
    });
    await mcpWrite(`${TEACH_DIR}/${session.session_id}.json`, session);
    await mcpWrite(LATEST_TEACH, session);
    void postContextEvent({
      source: "sandbox-teach",
      feature_id: "sandbox.teach.record",
      event_kind: "teach_stop",
      target_id: session.session_id,
      context: { samples: String(session.sample_count), trainee: session.trainee },
    });
    const out = { ok: true, session, token: TEACH1_TOKEN };
    setStatus(`Saved teaching ${session.session_id.slice(0, 10)} · ${session.trainee}`);
    session = null;
    return out;
  }

  /**
   * Named trainee consumes the recording and runs the existing MuJoCo policy try
   * without Sam sitting on the controls.
   */
  async function runUnattended({ trainee = "", sessionId = "" } = {}) {
    let rec = null;
    if (sessionId) {
      const raw = await mcpRead(`${TEACH_DIR}/${sessionId}.json`);
      try { rec = raw.ok ? JSON.parse(raw.text) : null; } catch { rec = null; }
    }
    if (!rec) {
      const raw = await mcpRead(LATEST_TEACH);
      try { rec = raw.ok ? JSON.parse(raw.text) : null; } catch { rec = null; }
    }
    if (!rec?.session_id) return { ok: false, reason: "no_teaching_session" };
    const who = String(trainee || rec.trainee || "astra").slice(0, 40);
    adoptLive("mujoco", globalThis.document?.querySelector?.("[data-sb-live-slot='mujoco']") || null, { live: true });
    postToLive("mujoco", { type: "openarm-train-hot", on: true, token: TRAIN1_TOKEN });
    postToLive("mujoco", { type: "openarm-teach-replay", token: TEACH1_TOKEN, session: rec });
    train.setTask(rec.task || "Replay Sam teaching session");
    await train.startPolicyTry({ astraTask: rec.task });
    const run = {
      kind: "sandbox_teaching_run",
      token: TEACH1_TOKEN,
      run_id: `run_${nid()}`,
      session_id: rec.session_id,
      trainee: who,
      started_at: nowIso(),
      unattended: true,
      note: "Policy try on recorded demo — Sam not required. Sim only.",
    };
    await mcpWrite(LATEST_TEACH_RUN, run);
    setStatus(`${who} running sim from ${rec.session_id.slice(0, 10)} (unattended)`);
    void postContextEvent({
      source: "sandbox-teach",
      feature_id: "sandbox.teach.run",
      event_kind: "unattended_start",
      target_id: rec.session_id,
      context: { trainee: who },
    });
    return { ok: true, run, session: rec, token: TEACH1_TOKEN };
  }

  return {
    token: TEACH1_TOKEN,
    train,
    getSession: () => session,
    start,
    stop,
    runUnattended,
  };
}

export function teachingMarkup() {
  return `
    <div class="sb-teach" data-sb-teach data-token="${TEACH1_TOKEN}">
      <p class="sb-teleop-copy">
        Sam explains in any workshop while the collab viewport stays on screen.
        Teach basic character moves, then watch more → self-learn new moves.
        cook-like procedures (prep → do → plate). Quiet unless they need Sam. Same live instance.
      </p>
      <div data-sb-teach-charmove></div>
      <label class="sb-dimos-field">
        <span>Procedure (cook sequence)</span>
        <input type="text" data-sb-teach-cook value="prep bench → show the cut → plate the part" maxlength="200" />
      </label>
      <label class="sb-dimos-field">
        <span>AI trainee</span>
        <input type="text" data-sb-teach-trainee value="astra" maxlength="40" autocomplete="off" />
      </label>
      <label class="sb-dimos-field">
        <span>Task</span>
        <input type="text" data-sb-teach-task value="Mimic Sam: pick and place in OpenArm sim" maxlength="200" />
      </label>
      <div class="sb-dimos-actions">
        <button type="button" class="sb-agent-btn sb-agent-btn--astra" data-sb-teach-record>Record teaching session</button>
        <button type="button" class="sb-agent-btn" data-sb-teach-stop>Stop &amp; save</button>
        <button type="button" class="sb-agent-btn" data-sb-teach-run>Run sim unattended</button>
        <button type="button" class="sb-agent-btn" data-sb-teach-send>Send CAD → sim</button>
        <button type="button" class="sb-agent-btn" data-sb-teach-moves>Generate new moves</button>
        <button type="button" class="sb-agent-btn" data-sb-teach-mail>Queue speed emails</button>
      </div>
      <p class="sb-dimos-status" data-sb-teach-status role="status">Idle · writes ${LATEST_TEACH}</p>
    </div>
  `;
}

export function bindTeachingPanel(root, { speak } = {}) {
  if (!root) return null;
  const statusEl = root.querySelector("[data-sb-teach-status]");
  const setStatus = (msg) => { if (statusEl && msg) statusEl.textContent = msg; };
  const rec = createTeachingRecorder({ speak, onStatus: setStatus });
  const trainee = () => root.querySelector("[data-sb-teach-trainee]")?.value?.trim() || "astra";
  const task = () => {
    const cook = root.querySelector("[data-sb-teach-cook]")?.value?.trim() || "";
    const base = root.querySelector("[data-sb-teach-task]")?.value?.trim() || "";
    return [base, cook && `Cook: ${cook}`].filter(Boolean).join(" · ");
  };

  root.querySelector("[data-sb-teach-record]")?.addEventListener("click", async () => {
    await rec.start({ trainee: trainee(), task: task() });
  });
  root.querySelector("[data-sb-teach-stop]")?.addEventListener("click", async () => {
    await rec.stop();
  });
  root.querySelector("[data-sb-teach-run]")?.addEventListener("click", async () => {
    await rec.runUnattended({ trainee: trainee() });
  });
  root.querySelector("[data-sb-teach-send]")?.addEventListener("click", async () => {
    setStatus("Sending latest remix / generated path to MuJoCo…");
    let remixId = "";
    try {
      remixId = JSON.parse(sessionStorage.getItem("sb-active-remix") || "null")?.remixId || "";
    } catch { remixId = ""; }
    const out = await sendGeneratedModelToSim({
      scene: "cell/demo.xml",
      remixId,
      path: remixId ? `remixes/${remixId}/tree.json` : "",
    });
    setStatus(out.ok ? `Posted ${out.scene} to MuJoCo instance` : "MuJoCo instance not live — open MuJoCo tab");
  });
  const cmHost = root.querySelector("[data-sb-teach-charmove]");
  if (cmHost) {
    import("./character-moves.js?v=charmove1").then(({ characterMoveMarkup, bindCharacterMoves }) => {
      cmHost.innerHTML = characterMoveMarkup();
      bindCharacterMoves(cmHost.querySelector("[data-sb-charmove]"));
    }).catch(() => { /* optional */ });
  }

  root.querySelector("[data-sb-teach-moves]")?.addEventListener("click", async () => {
    const { assignTask } = await import("./agent-tasks.js?v=20260923-draw-recordings1");
    const { proposeSelfLearnedMoves, persistMovesBook, buildMovesPayload, MOVES_PATH } = await import("./character-moves.js?v=charmove1");
    const learned = proposeSelfLearnedMoves([{ move: "approach_desk" }, { move: "speak_pose" }, { move: "return_home" }]);
    await persistMovesBook(buildMovesPayload([], learned));
    assignTask("vibe-rnd", `Self-learn character moves from teaching cook: ${task()}`.slice(0, 160), { from: "teach-watch" });
    assignTask("cursor-engineer", `Wire self-learned moves into ${MOVES_PATH} (same viewport, not DIMOS)`, { from: "teach-watch" });
    setStatus("Queued self-learn proposals — crew stays quiet until they find a miss");
  });
  root.querySelector("[data-sb-teach-mail]")?.addEventListener("click", async () => {
    const { assignTask } = await import("./agent-tasks.js?v=20260923-draw-recordings1");
    assignTask("comms", "Draft emails that speed the teaching cook sequence", { from: "teach-watch" });
    assignTask("vibe-marketing", "Shoot files + pick music so the cook procedure can be shared", { from: "teach-watch" });
    setStatus("Queued speed emails + video pack — no extra talk bar");
  });
  return rec;
}
