/** AI Round Table in the existing XR scene (one WebGLRenderer). Token roundtbl1 + roundtbl2 + roundtbl3. */

import { XR_TEAM_AGENTS } from "./xr-agent-join.js?v=agentjoin1&roundtbl1=1&voice1=1";
import { uniqueSeatVoices, uniqueVoiceForAgent, enqueueSpeak, bargeIn, isTooMuchTalkVoice, shouldSpeakNow, isTurnTaking } from "../sandbox/tts-mutex.js?v=sandbox1&ttsturn1=1&voice1=1&va1=1&singlevoice1";
import { buildDecisionBrief, SANDBOX4_TOKEN } from "../sandbox/decision-brief.js?v=sandbox4";
import { GROW_SOCIAL_DECK, MKTPRES1_TOKEN, pointSlide, renderSlidePage, slidePage, uvToSlideStep } from "../sandbox/marketing-slides.js?v=mktpres1-mktpitch1";
import { MKTPITCH1_TOKEN } from "../sandbox/pitch-deck.js?v=mktpitch1";
import {
  VOICE_BENCH_DECK,
  RNDDEMO1_TOKEN,
  applySamSuggestion,
  isSamSuggestionVoice,
  startVoiceBenchWalkthrough,
} from "../sandbox/rnd-voice-bench.js?v=rnddemo1&singlevoice1";
import { snapshot as taskSnapshot } from "../sandbox/agent-tasks.js?v=20260923-draw-recordings1";
import { cloudSpeechSplit, prefFor } from "../components/voice-agent-roster.js?v=va1";
import { applySamSandboxCorrection, isSamCorrectionVoice, HARNESS1_TOKEN } from "../sandbox/sam-correct.js?v=harness1";

export const ROUNDTBL1_CACHE = "roundtbl1";
export const ROUNDTBL2_CACHE = "roundtbl2";
export const ROUNDTBL3_CACHE = "roundtbl3";
export const ROUND_TABLE_REQUEST_ID = "d9c98119-007";
export const TABLE_RADIUS_M = 0.62;
export const SEAT_RADIUS_M = 0.92;
export const TABLE_HEIGHT_M = 0.78;
export const TABLE_MOVE_MAX_M = 2.4;
export const TABLE_MOVE_MIN_M = 0.5;

export { isTooMuchTalkVoice, bargeIn as applyTooMuchTalk, isSamSuggestionVoice, applySamSuggestion, isSamCorrectionVoice, applySamSandboxCorrection, RNDDEMO1_TOKEN, HARNESS1_TOKEN };

export function applyTooMuchTalkAtTable(reason = "") {
  const out = bargeIn(reason || "talking too much");
  return { ...out, dotted: true };
}

export function isEnableSandboxVoice(text = "") {
  const s = String(text || "").toLowerCase().replace(/[.!?]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return false;
  if (/\b(don'?t|do not|never|close|hide|disable)\b.{0,16}\bsandbox\b/.test(s)) return false;
  return (
    /\b(enable|open|show|start|launch|turn on)\b.{0,16}\bsandbox\b/.test(s)
    || /\bsandbox\b.{0,12}\b(please|now)\b/.test(s)
    || /\bsimulate sandbox\b/.test(s)
  );
}

export function topPromptSlotMode({ tableOn = false } = {}) {
  return tableOn ? "sandbox" : "round_table";
}

export function syncTopPromptSlot({ tableOn = false, sandboxOn = false } = {}) {
  try {
    document.documentElement.dataset.rtSlot = "round_table";
    const slots = document.querySelectorAll("#btn-round-table, #btn-round-table-gen, #btn-round-table-mobile");
    for (const btn of slots) {
      btn.dataset.slotMode = "round_table";
      btn.classList.remove("is-sandbox-slot");
      btn.textContent = "Round Table";
      btn.title = "Show or hide the AI round table";
      btn.setAttribute("aria-pressed", tableOn ? "true" : "false");
    }
  } catch { /* node / no prompt pane */ }
  return { mode: "round_table", token: ROUNDTBL3_CACHE, tableOn: !!tableOn, sandboxOn: !!sandboxOn };
}

export function toggleSandboxFromSlot() {
  const api = typeof window !== "undefined" ? window.Render3DSandbox : null;
  const next = api?.toggle?.() || api?.open?.();
  const open = next?.visible === true || api?.isOpen?.() === true;
  return { ok: true, visible: !!open, token: ROUNDTBL3_CACHE };
}

export function enableSandboxFromVoice() {
  const api = typeof window !== "undefined" ? window.Render3DSandbox : null;
  const next = api?.open?.() || api?.toggle?.();
  const open = next?.visible === true || api?.isOpen?.() === true;
  return { ok: true, visible: !!open, token: ROUNDTBL3_CACHE };
}

export function isMoveTableVoice(text = "") {
  const s = String(text || "").toLowerCase().replace(/[.!?]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return false;
  if (/\b(don'?t|do not|never)\b.{0,24}\b(move|put|place)\b.{0,20}\btable\b/.test(s)) return false;
  return (
    /\bmove (the )?(round )?table\b/.test(s)
    || /\b(put|place|bring|relocate) (the )?(round )?table\b/.test(s)
    || /\btable (over )?(here|there)\b/.test(s)
  );
}

export function floorHitFromRay(origin, direction, floorY = 0) {
  const oy = Number(origin?.y);
  const dy = Number(direction?.y);
  if (!Number.isFinite(oy) || !Number.isFinite(dy) || Math.abs(dy) < 1e-4) return null;
  const t = (Number(floorY) - oy) / dy;
  if (!(t > 0.05) || t > 12) return null;
  return {
    x: Number(origin.x) + Number(direction.x) * t,
    y: Number(floorY),
    z: Number(origin.z) + Number(direction.z) * t,
    distance: t,
    kind: "floor",
  };
}

function isUiLaserKind(kind = "") {
  return /^(ai|menu|hud|grid|explorer|wheel|color|tool|settings|studio|invite|share|howto|place|avatar|workspace)/i.test(String(kind || ""));
}

/** Laser hit on floor/scene, clamped so the table stays in reach. No extra renderer. */
export function laserTablePose({
  hit = null,
  origin = null,
  direction = null,
  head = null,
  floorY = 0,
  maxM = TABLE_MOVE_MAX_M,
  minM = TABLE_MOVE_MIN_M,
} = {}) {
  const hx = Number(head?.x ?? head?.[0]);
  const hy = Number(head?.y ?? head?.[1]);
  const hz = Number(head?.z ?? head?.[2]);
  const eyeY = Number.isFinite(hy) ? hy : 1.55;
  const floor = Number.isFinite(Number(floorY)) ? Number(floorY) : Math.max(-0.05, eyeY - 1.55);
  const hxOk = Number.isFinite(hx) && Number.isFinite(hz);
  const px = Number(hit?.x ?? hit?.point?.x);
  const py = Number(hit?.y ?? hit?.point?.y);
  const pz = Number(hit?.z ?? hit?.point?.z);
  let raw = null;
  if (Number.isFinite(px) && Number.isFinite(pz) && !isUiLaserKind(hit?.kind)) {
    raw = { x: px, y: Number.isFinite(py) ? py : floor, z: pz, kind: String(hit?.kind || "scene") };
  }
  if (!raw) raw = floorHitFromRay(origin, direction, floor);
  if (!raw && origin && direction) {
    const ox = Number(origin.x);
    const oz = Number(origin.z);
    const dx = Number(direction.x);
    const dz = Number(direction.z);
    const fl = Math.hypot(dx, dz) || 1;
    raw = {
      x: ox + (dx / fl) * 1.4,
      y: floor,
      z: oz + (dz / fl) * 1.4,
      kind: "aim",
    };
  }
  if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.z)) return null;
  const onFloor = raw.kind === "floor" || raw.kind === "board" || raw.y < eyeY - 0.75;
  let y = onFloor ? Math.max(0.02, floor + 0.02) : Math.min(Math.max(0.02, raw.y), eyeY - 0.35);
  let x = raw.x;
  let z = raw.z;
  if (hxOk) {
    const ddx = x - hx;
    const ddz = z - hz;
    const len = Math.hypot(ddx, ddz);
    const cap = Math.max(0.4, Number(maxM) || TABLE_MOVE_MAX_M);
    const near = Math.max(0.35, Number(minM) || TABLE_MOVE_MIN_M);
    if (len < 1e-3) {
      x = hx;
      z = hz - near;
    } else {
      const scale = len > cap ? cap / len : (len < near ? near / len : 1);
      x = hx + ddx * scale;
      z = hz + ddz * scale;
    }
  }
  return { x, y, z, kind: raw.kind || "scene", token: ROUNDTBL2_CACHE, reachable: true };
}

export function roundTableRoster(extra = []) {
  const astra = { id: "astra", name: "Astra", role: "Voice host", avatar: "orb", voice: uniqueVoiceForAgent("astra"), nation: "US" };
  const seen = new Set(["astra"]);
  const rows = [astra];
  for (const row of [...XR_TEAM_AGENTS, ...extra]) {
    const id = String(row?.id || "").trim();
    if (!id || seen.has(id) || id === "sam") continue;
    seen.add(id);
    rows.push({
      id,
      name: String(row.name || id).slice(0, 32),
      role: String(row.role || "Teammate").slice(0, 48),
      avatar: row.avatar || "orb",
      voice: uniqueVoiceForAgent(id) || row.voice || "echo",
    });
  }
  return uniqueSeatVoices(rows);
}

export function tableSeatLayout({ center = [0, TABLE_HEIGHT_M, -0.85], count = 8, radius = SEAT_RADIUS_M } = {}) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const [cx, cy, cz] = [Number(center[0]) || 0, Number(center[1]) || TABLE_HEIGHT_M, Number(center[2]) || 0];
  const seats = [];
  for (let i = 0; i < n; i += 1) {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(ang) * radius;
    const z = cz + Math.sin(ang) * radius;
    const yaw = Math.atan2(cx - x, cz - z);
    seats.push({ index: i, p: [x, cy, z], yaw, ang });
  }
  return seats;
}

/** Reply must name the prior speaker — discussion loop, not one-shot. */
export function nextIdeaTurn(history = [], roster = [], topic = "") {
  const agents = roster.length ? roster : roundTableRoster();
  const used = history.length;
  const speaker = agents[used % agents.length];
  const prior = history[history.length - 1];
  const subject = String(topic || prior?.text || "the headset problem").slice(0, 80);
  const text = prior
    ? `${speaker.name} to ${prior.agent_name}: building on that — ${subject}`
    : `${speaker.name} opens: ${subject}. Who takes the next angle?`;
  return {
    turn: used,
    agent_id: speaker.id,
    agent_name: speaker.name,
    reply_to: prior?.agent_id || "",
    text: text.slice(0, 180),
    one_shot: false,
  };
}

export function ideaTossLoop(topic = "", { rounds = 3, roster = [] } = {}) {
  const agents = roster.length ? roster : roundTableRoster();
  const n = Math.max(2, Math.min(8, Number(rounds) || 3));
  const history = [];
  for (let i = 0; i < n * Math.min(agents.length, 4); i += 1) {
    history.push(nextIdeaTurn(history, agents, topic));
  }
  const topicText = String(topic || "").slice(0, 120);
  const plan = cloudSpeechSplit(history, { utterance: topicText, roster: agents });
  const spoken = new Set(plan.speak.map((row) => `${row.agent_id || row.agentId}|${row.text}`));
  for (const turn of history) {
    turn.cloud = "one";
    turn.listener = turn.agent_id;
    turn.queue = true;
    turn.silent = turn.silent || !spoken.has(`${turn.agent_id}|${turn.text}`);
  }
  if (isTurnTaking()) {
    for (const turn of history) {
      if (!turn.silent) turn.silent = !shouldSpeakNow(turn.agent_id, turn.text, topicText);
    }
  }
  return { topic: topicText, turns: history, loop: true, cloud: "one", addressed: plan.addressed, token: ROUNDTBL1_CACHE };
}

export function approachTargetFromUser(head, seatHome, dist = 0.58) {
  const hx = Number(head?.x ?? head?.[0]) || 0;
  const hy = Number(head?.y ?? head?.[1]) || 1.55;
  const hz = Number(head?.z ?? head?.[2]) || 0;
  const sx = Number(seatHome?.[0] ?? seatHome?.x) || 0;
  const sz = Number(seatHome?.[2] ?? seatHome?.z) || 0;
  const dx = hx - sx;
  const dz = hz - sz;
  const len = Math.hypot(dx, dz) || 1;
  const stop = Math.max(0.22, Math.min(dist, Math.max(0.22, len - 0.12)));
  return {
    p: [hx - (dx / len) * stop, Math.max(0.02, hy - 1.35), hz - (dz / len) * stop],
    yaw: Math.atan2(dx, dz),
  };
}

export function calloutEndpoints(seat, center, lift = 0.22) {
  const sx = Number(seat?.[0] ?? seat?.x) || 0;
  const sy = Number(seat?.[1] ?? seat?.y) || TABLE_HEIGHT_M;
  const sz = Number(seat?.[2] ?? seat?.z) || 0;
  const cx = Number(center?.[0] ?? center?.x) || sx;
  const cz = Number(center?.[2] ?? center?.z) || sz;
  const mx = (sx + cx) / 2;
  const mz = (sz + cz) / 2;
  return {
    from: [sx, sy + 0.12, sz],
    to: [mx, sy + lift, mz],
  };
}

export const ROUND_TABLE_LAST3 = "d9c98119-005|d9c98119-006|d9c98119-007";
export const XRCTRL2_CACHE = "xrctrl2";

export function debuggerFixSuggestions(notes = []) {
  const rows = Array.isArray(notes) ? notes : [];
  const ok = rows.filter((r) => r?.ok);
  const fail = rows.filter((r) => !r?.ok);
  const out = [];
  for (const row of ok.slice(-6)) {
    out.push({
      agent_id: "vibe-rnd",
      agent_name: "Vibe R&D",
      text: `Keep ${row.feature}: ${row.attempt || row.note || "worked"}`.slice(0, 180),
      keep: true,
      feature: row.feature,
    });
  }
  for (const row of fail.slice(-4)) {
    out.push({
      agent_id: "analytics",
      agent_name: "Analytics",
      text: `Retry ${row.feature}: ${row.attempt || row.note || "failed"}`.slice(0, 180),
      keep: false,
      feature: row.feature,
    });
  }
  if (!out.length) {
    out.push({
      agent_id: "astra",
      agent_name: "Astra",
      text: "Poll trigger, UI over DimOS, squeeze-or-trigger grab, nearer windows.",
      keep: true,
      feature: "trigger",
    });
  }
  return out.slice(0, 10);
}

export function wireToScenePayload(config = {}) {
  return {
    action: "wire_scene",
    apply: false,
    auto_apply: false,
    status: "pending_approval",
    privilege: "xr.controls.wire_scene",
    token: XRCTRL2_CACHE,
    round_table: ROUNDTBL1_CACHE,
    config,
  };
}

/** Same debug packet for VR speech + AI chat. Forward while talking — never wait for hangup. */
export function mergeVoiceChatDebugPacket({
  voice = "",
  chat = [],
  draft = "",
  feed = null,
  last3 = ROUND_TABLE_LAST3,
} = {}) {
  const lines = (Array.isArray(chat) ? chat : [])
    .map((row) => ({
      who: String(row.who || row.role || row.agent_id || "chat").slice(0, 24),
      text: String(row.text || row.line || "").slice(0, 180),
    }))
    .filter((row) => row.text)
    .slice(-10);
  const speech = String(voice || "").trim().slice(0, 400);
  const prompt = String(draft || "").trim().slice(0, 240);
  return {
    v: 1,
    kind: "round-table",
    live: true,
    wait_for_end: false,
    voice: speech,
    draft: prompt,
    chat: lines,
    merged: [speech, prompt, ...lines.map((r) => `${r.who}: ${r.text}`)].filter(Boolean).join(" · ").slice(0, 700),
    feed: feed && typeof feed === "object" ? feed : null,
    last3,
    token: ROUNDTBL1_CACHE,
    request_id: ROUND_TABLE_REQUEST_ID,
  };
}

export function shouldPassLiveLogs({
  tableVisible = false,
  listening = false,
  talking = false,
  newVoice = false,
  newChat = false,
} = {}) {
  if (!tableVisible) return false;
  if (!(listening || talking)) return false;
  return newVoice === true || newChat === true;
}

export function collectAiChatLines({ mold = null, agentHistory = [], draft = "", tableChat = [] } = {}) {
  const out = [];
  const moldLines = Array.isArray(mold?.chat) ? mold.chat : Array.isArray(mold?.log) ? mold.log : [];
  for (const row of moldLines.slice(-10)) {
    const text = String(row.text || row.line || "").trim();
    if (text) out.push({ who: row.role === "user" || row.who === "you" ? "sam" : (row.who || "astra"), text });
  }
  for (const row of (agentHistory || []).slice(-6)) {
    const text = String(row.text || row.prompt || "").trim();
    if (text) out.push({ who: row.role || row.type || "agent", text });
  }
  for (const row of (tableChat || []).slice(-8)) {
    const text = String(row.text || "").trim();
    if (text) out.push({ who: row.agent_id || row.agent_name || "seat", text });
  }
  const d = String(draft || "").trim();
  if (d) out.push({ who: "prompt", text: d });
  return out.slice(-12);
}

export function harnessCedePayload({ filename = "", code = "", agent = "astra" } = {}) {
  return {
    action: "cede_harness",
    filename: String(filename || "round-table-example.js").slice(0, 80),
    code: String(code || "").slice(0, 8000),
    agent: String(agent || "astra").slice(0, 40),
    apply: false,
    auto_apply: false,
    status: "pending_approval",
    token: ROUNDTBL1_CACHE,
    request_id: ROUND_TABLE_REQUEST_ID,
  };
}

function paintLabel(THREE, text, { w = 256, h = 96, fill = "#0f172a", accent = "#7dd3fc" } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 28px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(text || "").slice(0, 22), w / 2, h / 2);
  const texture = new THREE.CanvasTexture(c);
  texture.needsUpdate = true;
  return { canvas: c, texture };
}

export function createXrAiRoundTable(THREE, { scene, onAction } = {}) {
  const root = new THREE.Group();
  root.name = "xrAiRoundTable";
  root.visible = false;
  root.userData.xrUi = true;
  try { scene?.add(root); } catch { /* tests */ }

  const roster = roundTableRoster([
    { id: "ledger", name: "Ledger", role: "Status", avatar: "orb", voice: "shimmer" },
  ]);
  let surfaceMode = "chat";
  let slideIndex = 0;
  let benchIndex = 0;
  let slidePointed = "";
  let slideCircle = null;
  let focused = "";
  let listening = false;
  let chatLines = [];
  let editor = { filename: "round-table-example.js", text: "// agents write examples here\n", dirty: false, pending: false, wirePending: false };
  let suggestions = [];
  const callouts = new Map();

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE_RADIUS_M, TABLE_RADIUS_M, 0.04, 32),
    new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.92 }),
  );
  top.userData.xrUi = true;
  root.add(top);

  const listen = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.03, 24),
    new THREE.MeshBasicMaterial({ color: 0x22c55e }),
  );
  listen.position.y = 0.04;
  listen.userData.xrTool = "round-table:listen";
  listen.userData.xrUi = true;
  listen.name = "xrRoundTableListen";
  root.add(listen);

  const listenLbl = paintLabel(THREE, "Listen", { w: 192, h: 64 });
  const listenPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.06),
    new THREE.MeshBasicMaterial({ map: listenLbl.texture, transparent: true, depthWrite: false }),
  );
  listenPlane.position.set(0, 0.09, 0);
  listenPlane.userData.xrTool = "round-table:listen";
  listenPlane.userData.xrUi = true;
  root.add(listenPlane);

  const seats = [];
  const layout = tableSeatLayout({ center: [0, 0, 0], count: roster.length });
  roster.forEach((agent, i) => {
    const pose = layout[i];
    const chair = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.08, 0.05, 16),
      new THREE.MeshBasicMaterial({ color: 0x334155 }),
    );
    chair.position.set(pose.p[0], 0.02, pose.p[2]);
    chair.userData.xrTool = `round-table:seat:${agent.id}`;
    chair.userData.xrUi = true;
    chair.userData.agentId = agent.id;
    root.add(chair);
    const tag = paintLabel(THREE, agent.name);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.08),
      new THREE.MeshBasicMaterial({ map: tag.texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    plane.position.set(pose.p[0], 0.42, pose.p[2]);
    plane.userData.xrTool = `round-table:seat:${agent.id}`;
    plane.userData.xrUi = true;
    plane.userData.agentId = agent.id;
    root.add(plane);
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x7dd3fc }),
    );
    body.position.set(pose.p[0], 0.28, pose.p[2]);
    body.userData.xrUi = true;
    body.userData.agentId = agent.id;
    body.visible = prefFor(agent.id).form === "avatar";
    root.add(body);
    seats.push({ agent, chair, plane, body, pose });
  });

  const dashGeo = new THREE.BufferGeometry();
  dashGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(roster.length * 6), 3));
  const dash = new THREE.LineSegments(
    dashGeo,
    new THREE.LineDashedMaterial({ color: 0x7dd3fc, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.9 }),
  );
  dash.userData.xrUi = true;
  dash.visible = false;
  root.add(dash);

  const surface = new THREE.Group();
  surface.position.set(0, 0.28, 0.02);
  surface.userData.xrUi = true;
  root.add(surface);
  const surfCanvas = document.createElement("canvas");
  surfCanvas.width = 768;
  surfCanvas.height = 512;
  const surfTex = new THREE.CanvasTexture(surfCanvas);
  const surfFace = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 0.34),
    new THREE.MeshBasicMaterial({ map: surfTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  surfFace.userData.xrTool = "round-table:surface";
  surfFace.userData.xrUi = true;
  surface.add(surfFace);
  let surfRects = [];

  function paintSurface() {
    const ctx = surfCanvas.getContext("2d");
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, 768, 512);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, 768, 72);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 28px system-ui,sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      surfaceMode === "editor" ? "VR editor"
        : surfaceMode === "debug" ? "Debugger"
          : surfaceMode === "slides" ? "Marketing slides"
            : surfaceMode === "bench" ? "Voice bench"
              : surfaceMode === "tasks" ? "Agent tasks"
                : "AI chat",
      24,
      46,
    );
    surfRects = [];
    function btn(id, label, x, on, w = 110, y = 16) {
      ctx.fillStyle = on ? "#38bdf8" : "#334155";
      ctx.fillRect(x, y, w, 44);
      ctx.fillStyle = on ? "#0f172a" : "#e2e8f0";
      ctx.font = "700 16px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x + w / 2, y + 29);
      surfRects.push({ id, x, y, w, h: 44 });
    }
    btn("round-table:chat", "Chat", 128, surfaceMode === "chat", 56);
    btn("round-table:slides", "Slides", 188, surfaceMode === "slides", 62);
    btn("round-table:bench", "Bench", 254, surfaceMode === "bench", 62);
    btn("round-table:tasks", "Tasks", 320, surfaceMode === "tasks", 58);
    btn("round-table:debug", "Debug", 382, surfaceMode === "debug", 58);
    btn("round-table:editor", "Edit", 444, surfaceMode === "editor", 48);
    btn("round-table:wire", editor.wirePending ? "Queued" : "Wire", 496, editor.wirePending, 58);
    ctx.textAlign = "left";
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "22px system-ui,sans-serif";
    if (surfaceMode === "slides" || surfaceMode === "bench") {
      const deck = surfaceMode === "bench" ? VOICE_BENCH_DECK : GROW_SOCIAL_DECK;
      const idx = surfaceMode === "bench" ? benchIndex : slideIndex;
      const page = slidePage(deck, idx);
      renderSlidePage(ctx, page, {
        w: 768,
        h: 512,
        pointedId: slidePointed,
        circle: slideCircle,
        pageNo: idx + 1,
        pageCount: deck.pages.length,
      });
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, 768, 72);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 18px system-ui,sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(surfaceMode === "bench" ? "Voice bench rnddemo1" : "Marketing slides", 8, 46);
      surfRects = [];
      btn("round-table:chat", "Chat", 128, false, 56);
      btn("round-table:slides", "Slides", 188, surfaceMode === "slides", 62);
      btn("round-table:bench", "Bench", 254, surfaceMode === "bench", 62);
      btn("round-table:tasks", "Tasks", 320, false, 58);
      btn("round-table:debug", "Debug", 382, false, 58);
      btn("round-table:editor", "Edit", 444, false, 48);
      btn("round-table:wire", editor.wirePending ? "Queued" : "Wire", 496, editor.wirePending, 58);
      btn("round-table:slide-prev", "◀", 8, false, 36);
      btn("round-table:slide-next", "▶", 48, false, 36);
      surfTex.needsUpdate = true;
      return;
    }
    if (surfaceMode === "tasks") {
      const snap = taskSnapshot();
      ctx.fillStyle = "#f8fafc";
      ctx.font = "600 18px system-ui,sans-serif";
      ctx.fillText("Sam assigns in sandbox Tasks. Ledger speaks when done.", 24, 110);
      roster.slice(0, 10).forEach((row, i) => {
        const info = snap.byAgent?.[row.id] || { queued: 0, done: 0 };
        ctx.fillStyle = "#86efac";
        ctx.fillText(`${row.name}: ${info.queued} open / ${info.done} done`, 24, 148 + i * 28);
      });
      surfTex.needsUpdate = true;
      return;
    }
    if (surfaceMode === "editor") {
      ctx.fillStyle = "#7dd3fc";
      ctx.fillText(editor.filename, 24, 110);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "18px ui-monospace,monospace";
      String(editor.text || "").split("\n").slice(0, 14).forEach((line, i) => {
        ctx.fillText(line.slice(0, 72), 24, 142 + i * 24);
      });
    } else if (surfaceMode === "debug") {
      ctx.fillStyle = "#facc15";
      ctx.fillText("Control notes — accept Wire scene (queued, not auto)", 24, 110);
      const rows = suggestions.length ? suggestions : chatLines.slice(-10);
      rows.forEach((row, i) => {
        ctx.fillStyle = row.keep === false ? "#fb7185" : "#86efac";
        ctx.fillText(`${row.agent_name || row.agent_id}: ${String(row.text || "").slice(0, 52)}`, 24, 148 + i * 28);
      });
    } else {
      const rows = chatLines.slice(-10);
      if (!rows.length) ctx.fillText("Middle Listen starts the idea toss. Seats talk.", 24, 120);
      rows.forEach((row, i) => {
        ctx.fillStyle = row.agent_id === focused ? "#7dd3fc" : "#e2e8f0";
        ctx.fillText(`${row.agent_name}: ${String(row.text || "").slice(0, 52)}`, 24, 120 + i * 30);
      });
      btn("round-table:fix-wheels", "Fix wheels", 24, false, 128, 456);
      btn("round-table:qc-rig", "QC rig", 164, false, 96, 456);
    }
    surfTex.needsUpdate = true;
  }
  paintSurface();

  function setCallout(agentId, english) {
    const text = String(english || "").trim().slice(0, 120);
    if (!text) {
      callouts.delete(agentId);
      return;
    }
    callouts.set(agentId, text);
    const seat = seats.find((s) => s.agent.id === agentId);
    if (!seat) return;
    if (!seat.callout) {
      const painted = paintLabel(THREE, text, { w: 512, h: 96, fill: "#082f49" });
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.36, 0.07),
        new THREE.MeshBasicMaterial({ map: painted.texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      );
      plane.userData.xrUi = true;
      root.add(plane);
      seat.callout = { plane, painted };
    }
    const ctx = seat.callout.painted.canvas.getContext("2d");
    ctx.fillStyle = "#082f49";
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = "#e0f2fe";
    ctx.font = "600 26px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 48);
    seat.callout.painted.texture.needsUpdate = true;
    const ends = calloutEndpoints(seat.pose.p, [0, 0, 0]);
    seat.callout.plane.position.set(ends.to[0], ends.to[1], ends.to[2]);
    syncDashes();
  }

  function syncDashes() {
    const pos = dash.geometry.getAttribute("position");
    let i = 0;
    for (const seat of seats) {
      const line = callouts.get(seat.agent.id);
      const ends = calloutEndpoints(seat.pose.p, [0, 0, 0]);
      const a = line ? ends.from : [0, 0, 0];
      const b = line ? ends.to : [0, 0, 0];
      pos.setXYZ(i, a[0], a[1], a[2]);
      pos.setXYZ(i + 1, b[0], b[1], b[2]);
      i += 2;
    }
    pos.needsUpdate = true;
    dash.computeLineDistances?.();
    dash.visible = callouts.size > 0;
  }

  function placeInFront(head = { x: 0, y: 1.55, z: 0 }, forward = { x: 0, y: 0, z: -1 }) {
    const fx = Number(forward.x) || 0;
    const fz = Number(forward.z) || -1;
    const fl = Math.hypot(fx, fz) || 1;
    root.position.set(
      (Number(head.x) || 0) + (fx / fl) * 1.05,
      Math.max(0.02, (Number(head.y) || 1.55) - 0.78),
      (Number(head.z) || 0) + (fz / fl) * 1.05,
    );
  }

  function placeAt(x, y, z) {
    root.position.set(Number(x) || 0, Math.max(0.02, Number(y) || 0.02), Number(z) || 0);
    return {
      ok: true,
      p: [root.position.x, root.position.y, root.position.z],
      token: ROUNDTBL2_CACHE,
    };
  }

  function moveToLaser(hit, opts = {}) {
    const pose = laserTablePose({ hit, ...opts });
    if (!pose) return { ok: false, error: "no laser aim", token: ROUNDTBL2_CACHE };
    root.visible = true;
    return { ...placeAt(pose.x, pose.y, pose.z), pose, token: ROUNDTBL2_CACHE };
  }

  function setVisible(on) {
    root.visible = !!on;
    if (root.visible) paintSurface();
    return { ok: true, visible: root.visible, token: ROUNDTBL1_CACHE };
  }

  function pickSurface(uv) {
    const pointing = surfaceMode === "slides" || surfaceMode === "bench";
    if (!uv) return pointing ? "round-table:slide-point" : "round-table:surface";
    const x = uv.x * 768;
    const y = (1 - uv.y) * 512;
    const hit = surfRects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    return hit?.id || (pointing ? "round-table:slide-point" : "round-table:surface");
  }

  return {
    root,
    token: ROUNDTBL1_CACHE,
    token2: ROUNDTBL2_CACHE,
    roster: () => roster.map((r) => ({ ...r })),
    isVisible: () => root.visible,
    surfaceMode: () => surfaceMode,
    editorState: () => ({ ...editor }),
    chatLines: () => chatLines.slice(),
    focused: () => focused,
    listening: () => listening,
    setVisible,
    toggle() {
      return setVisible(!root.visible);
    },
    placeInFront,
    placeAt,
    moveToLaser,
    setSurfaceMode(mode) {
      surfaceMode = mode === "editor" ? "editor"
        : mode === "debug" ? "debug"
          : mode === "slides" ? "slides"
            : mode === "bench" ? "bench"
              : mode === "tasks" ? "tasks"
                : "chat";
      paintSurface();
      return { ok: true, mode: surfaceMode };
    },
    toggleSurface() {
      return this.setSurfaceMode(surfaceMode === "chat" ? "editor" : "chat");
    },
    setFocused(id) {
      focused = String(id || "");
      paintSurface();
    },
    applyVoiceLooks() {
      for (const seat of seats) {
        const pref = prefFor(seat.agent.id);
        if (seat.body) seat.body.visible = pref.form === "avatar";
      }
      return { ok: true };
    },
    setListening(on) {
      listening = !!on;
      listen.material.color.setHex(listening ? 0x4ade80 : 0x22c55e);
    },
    pushChat(row) {
      if (!row?.text) return;
      chatLines.push({
        agent_id: String(row.agent_id || "astra"),
        agent_name: String(row.agent_name || row.agent_id || "Astra"),
        text: String(row.text).slice(0, 180),
      });
      if (chatLines.length > 40) chatLines = chatLines.slice(-40);
      setCallout(row.agent_id, row.text);
      paintSurface();
      if (!row.silent) {
        enqueueSpeak(row.agent_id || "astra", row.text, {
          topic: row.topic || "",
          queue: row.queue !== false,
          listener: row.listener || row.agent_id,
        });
      }
    },
    applyCodeExample({ filename, text, agent } = {}) {
      if (filename) editor.filename = String(filename).slice(0, 80);
      if (text != null) editor.text = String(text).slice(0, 8000);
      editor.dirty = true;
      editor.pending = false;
      surfaceMode = "editor";
      if (agent) setCallout(agent, `Wrote ${editor.filename}`);
      paintSurface();
      try { globalThis.Render3DProjectCode?.applyDraft?.(editor.filename, editor.text); } catch { /* optional Studio editor */ }
      return { ok: true, filename: editor.filename, applied: false, studio: true };
    },
    markHarnessQueued() {
      editor.pending = true;
      editor.dirty = false;
      paintSurface();
      return harnessCedePayload({ filename: editor.filename, code: editor.text });
    },
    setSuggestions(rows = []) {
      suggestions = Array.isArray(rows) ? rows.slice(-10) : [];
      surfaceMode = "debug";
      paintSurface();
      return { ok: true, n: suggestions.length, mode: "debug", token: XRCTRL2_CACHE };
    },
    markWireQueued() {
      editor.wirePending = true;
      paintSurface();
      return wireToScenePayload();
    },
    setCallout,
    pick(raycaster) {
      if (!root.visible) return null;
      root.updateMatrixWorld(true);
      const meshes = [listen, listenPlane, surfFace, ...seats.map((s) => s.chair), ...seats.map((s) => s.plane)];
      const hits = raycaster.intersectObjects(meshes, false);
      for (const hit of hits) {
        let id = hit.object.userData.xrTool;
        if (hit.object === surfFace) id = pickSurface(hit.uv);
        if (!id) continue;
        return { kind: "tool", tool: id, distance: hit.distance, point: hit.point, uv: hit.uv, source: "round-table" };
      }
      return null;
    },
    action(id) {
      const raw = String(id || "");
      if (raw === "round-table:listen") {
        onAction?.("listen");
        return true;
      }
      if (raw.startsWith("round-table:seat:")) {
        onAction?.("seat", raw.slice("round-table:seat:".length));
        return true;
      }
      if (raw === "round-table:chat") {
        this.setSurfaceMode("chat");
        onAction?.("chat");
        return true;
      }
      if (raw === "round-table:slides") {
        this.setSurfaceMode("slides");
        onAction?.("slides");
        return true;
      }
      if (raw === "round-table:bench") {
        this.setSurfaceMode("bench");
        onAction?.("bench");
        enqueueSpeak("vibe-rnd", "Rick presenting the VR Voice Bench. Point the laser like a person.", { topic: "rnd bench" });
        return true;
      }
      if (raw === "round-table:tasks") {
        this.setSurfaceMode("tasks");
        onAction?.("tasks");
        return true;
      }
      if (raw === "round-table:slide-prev") {
        if (surfaceMode === "bench") {
          benchIndex = (benchIndex - 1 + VOICE_BENCH_DECK.pages.length) % VOICE_BENCH_DECK.pages.length;
        } else {
          slideIndex = (slideIndex - 1 + GROW_SOCIAL_DECK.pages.length) % GROW_SOCIAL_DECK.pages.length;
        }
        slidePointed = "";
        slideCircle = null;
        paintSurface();
        return true;
      }
      if (raw === "round-table:slide-next") {
        if (surfaceMode === "bench") {
          benchIndex = (benchIndex + 1) % VOICE_BENCH_DECK.pages.length;
        } else {
          slideIndex = (slideIndex + 1) % GROW_SOCIAL_DECK.pages.length;
        }
        slidePointed = "";
        slideCircle = null;
        paintSurface();
        return true;
      }
      if (raw === "round-table:slide-point") {
        return true;
      }
      if (raw === "round-table:editor") {
        this.setSurfaceMode("editor");
        onAction?.("editor");
        return true;
      }
      if (raw === "round-table:debug") {
        this.setSurfaceMode("debug");
        onAction?.("debugger");
        return true;
      }
      if (raw === "round-table:wire") {
        onAction?.("wire", this.markWireQueued());
        return true;
      }
      if (raw === "round-table:fix-wheels") {
        onAction?.("fix_wheels");
        return true;
      }
      if (raw === "round-table:qc-rig") {
        onAction?.("qc_rig");
        return true;
      }
      if (raw === "round-table:cede") {
        onAction?.("cede", this.markHarnessQueued());
        return true;
      }
      return false;
    },
    pointAtSlide(uv) {
      if (surfaceMode === "bench") return this.pointAtBench(uv);
      this.setSurfaceMode("slides");
      const step = uvToSlideStep(uv);
      if (step) {
        slideIndex = (slideIndex + step + GROW_SOCIAL_DECK.pages.length) % GROW_SOCIAL_DECK.pages.length;
        slidePointed = "";
        slideCircle = null;
        paintSurface();
        onAction?.("slide-point", { stepped: step, index: slideIndex, token: MKTPITCH1_TOKEN });
        return { ok: true, stepped: step, index: slideIndex, token: MKTPITCH1_TOKEN, keep: MKTPRES1_TOKEN };
      }
      const page = slidePage(GROW_SOCIAL_DECK, slideIndex);
      const result = pointSlide(page, uv);
      slideCircle = result.circle;
      slidePointed = result.pointed?.id || "";
      paintSurface();
      if (result.pointed) {
        setCallout("vibe-marketing", result.pointed.text);
        enqueueSpeak("vibe-marketing", result.pointed.text);
      }
      onAction?.("slide-point", { ...result, page: page.id, index: slideIndex });
      return { ok: true, ...result, page: page.id, token: MKTPRES1_TOKEN, pitch: MKTPITCH1_TOKEN };
    },
    pointAtBench(uv) {
      this.setSurfaceMode("bench");
      const step = uvToSlideStep(uv);
      if (step) {
        benchIndex = (benchIndex + step + VOICE_BENCH_DECK.pages.length) % VOICE_BENCH_DECK.pages.length;
        slidePointed = "";
        slideCircle = null;
        paintSurface();
        onAction?.("slide-point", { stepped: step, index: benchIndex, token: RNDDEMO1_TOKEN, keep: ["mktpres1", "rndbench1"] });
        return { ok: true, stepped: step, index: benchIndex, token: RNDDEMO1_TOKEN, keep: ["mktpres1", "rndbench1"] };
      }
      const page = slidePage(VOICE_BENCH_DECK, benchIndex);
      const result = { ...pointSlide(page, uv), token: RNDDEMO1_TOKEN };
      slideCircle = result.circle;
      slidePointed = result.pointed?.id || "";
      paintSurface();
      if (result.pointed) {
        setCallout("vibe-rnd", result.pointed.text);
        enqueueSpeak("vibe-rnd", result.pointed.text, { topic: "rnd bench" });
      }
      onAction?.("slide-point", { ...result, page: page.id, index: benchIndex });
      return { ok: true, ...result, page: page.id, token: RNDDEMO1_TOKEN, keep: ["mktpres1", "rndbench1"] };
    },
    startVoiceBench() {
      this.setSurfaceMode("bench");
      return startVoiceBenchWalkthrough({
        go: (i) => {
          benchIndex = i;
          slidePointed = "";
          slideCircle = null;
          paintSurface();
        },
      });
    },
    samSuggest(text) {
      return applySamSuggestion(text);
    },
    samCorrect(text) {
      try {
        window.dispatchEvent(new CustomEvent("render3d-sandbox-voice-step", { detail: { text, kind: "corrective" } }));
      } catch { /* optional */ }
      return applySamSandboxCorrection(text);
    },
    sandboxVoice(text) {
      return window.Render3DSandboxVoice?.handle?.(text);
    },
    slideState() {
      return {
        index: surfaceMode === "bench" ? benchIndex : slideIndex,
        pointed: slidePointed,
        token: surfaceMode === "bench" ? RNDDEMO1_TOKEN : MKTPRES1_TOKEN,
        pitch: MKTPITCH1_TOKEN,
        keep: ["mktpres1", "rndbench1"],
        deck: surfaceMode === "bench" ? VOICE_BENCH_DECK.id : GROW_SOCIAL_DECK.id,
      };
    },
    approach(id, head) {
      const seat = seats.find((s) => s.agent.id === String(id || ""));
      if (!seat) return { ok: false, agent: id };
      seat.approaching = true;
      seat.head = head || seat.head;
      focused = String(id || "");
      setCallout(id, "Coming over");
      enqueueSpeak(id, `${seat.agent.name} coming over.`, { topic: id });
      paintSurface();
      return { ok: true, agent: id, approach: true, token: SANDBOX4_TOKEN };
    },
    sitDown(id) {
      if (id) {
        const seat = seats.find((s) => s.agent.id === String(id));
        if (seat) seat.approaching = false;
      } else {
        seats.forEach((s) => { s.approaching = false; });
      }
      return { ok: true };
    },
    tooMuchTalk(reason = "") {
      const out = applyTooMuchTalkAtTable(reason);
      this.pushChat({
        agent_id: "astra",
        agent_name: "Astra",
        text: "Taking turns. Only the expert on this topic will speak.",
        topic: "host risk reward",
      });
      return out;
    },
    speakDecision(topic, kind = "debug") {
      const brief = buildDecisionBrief(topic, { kind });
      enqueueSpeak("astra", brief.script, { topic: "host risk reward" });
      for (const row of brief.suggestions) {
        setCallout(row.agent_id, row.text);
        this.pushChat({ ...row, silent: true });
      }
      return brief;
    },
    update(head) {
      if (!root.visible) return;
      const t = performance.now() / 1000;
      listen.scale.setScalar(listening ? 1 + Math.sin(t * 6) * 0.08 : 1);
      for (const seat of seats) {
        if (head && seat.approaching) seat.head = { x: head.x ?? head[0], y: head.y ?? head[1], z: head.z ?? head[2] };
        const dest = seat.approaching
          ? approachTargetFromUser(seat.head || { x: 0, y: 1.55, z: 0 }, seat.pose.p).p
          : [seat.pose.p[0], 0.02, seat.pose.p[2]];
        const planeY = seat.approaching ? dest[1] + 0.14 : 0.16;
        seat.chair.position.x += (dest[0] - seat.chair.position.x) * 0.12;
        seat.chair.position.y += (dest[1] - seat.chair.position.y) * 0.12;
        seat.chair.position.z += (dest[2] - seat.chair.position.z) * 0.12;
        seat.plane.position.x = seat.chair.position.x;
        seat.plane.position.z = seat.chair.position.z;
        seat.plane.position.y += (planeY - seat.plane.position.y) * 0.12;
        if (seat.callout?.plane) {
          seat.callout.plane.position.set(seat.plane.position.x, seat.plane.position.y + 0.12, seat.plane.position.z);
        }
      }
    },
  };
}

function makeRoundTableButton(id) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = id;
  btn.dataset.roundTableToggle = "1";
  btn.setAttribute("aria-pressed", "false");
  btn.textContent = "Round Table";
  btn.title = "Show or hide the AI round table";
  return btn;
}

export function ensureRoundTablePromptButton() {
  // Round Table is VR / workspace only — not CAD Prompt and not Render Agent chat.
  document.querySelectorAll(
    "#prompt-pane-compose #btn-round-table, #prompt-pane-compose #btn-round-table-gen, #prompt-pane-compose [data-round-table-toggle], #render-agent-form #btn-round-table-agent, #render-agent-form [data-round-table-toggle]",
  ).forEach((btn) => btn.remove());
  return !document.querySelector("#prompt-pane-compose [data-round-table-toggle]")
    && !document.querySelector("#render-agent-form [data-round-table-toggle]");
}

export function bindRoundTablePromptButtons(toggle) {
  ensureRoundTablePromptButton();
  const nodes = [
    ...document.querySelectorAll("#btn-round-table, #btn-round-table-gen, #btn-round-table-agent, [data-round-table-toggle]"),
  ];
  for (const btn of nodes) {
    if (!btn || btn.dataset.roundtblBound) continue;
    btn.dataset.roundtblBound = "1";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const next = toggle?.();
      const on = next?.visible === true;
      document.querySelectorAll("#btn-round-table, #btn-round-table-agent, [data-round-table-toggle]").forEach((el) => {
        el.setAttribute("aria-pressed", on ? "true" : "false");
        el.classList.toggle("is-active", on);
      });
      const sandboxOn = typeof window !== "undefined" && window.Render3DSandbox?.isOpen?.() === true;
      syncTopPromptSlot({ tableOn: on, sandboxOn });
    });
  }
  return nodes.length;
}
