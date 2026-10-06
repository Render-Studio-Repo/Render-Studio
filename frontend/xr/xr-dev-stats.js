/**
 * Cheap XR developer HUD: 4 Hz FPS label + one reused sparkline canvas.
 * Position follows the head each frame; canvases are never rebuilt per tick.
 */

import {
  developerModeEnabled,
  summarizeXrFrameTimes,
  summarizeXrHitchSpikes,
  xrDebuggerLogFilename,
  XR_FRAMEBUFFER_SCALE,
  XR_FOVEATION,
  XR_HUD_CANVAS_SCALE,
  XR_HITCH_MS,
} from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5&deskdbg1";
import {
  createXrControlsRecorder,
  capXrControlsPayload,
  XR_CONTROLS_SLUG,
} from "./xr-controls-debug.js?v=xrctl1-20260915-xrctl1-20260915-xrdbg1-20260915-xrdbg2-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1&inputfix=20260916-1&teleop-y=20260922-poseconnect1";

const HUD_MS = 250;
const SAMPLE_MS = 250;
const MAX_SAMPLES = 600;
const MAX_ACTIONS = 80;
const HUD_W = 160;
const HUD_H = 48;
const STATS_W = 320;
const STATS_H = 180;

function heapMb() {
  try {
    const n = performance.memory?.usedJSHeapSize;
    if (!Number.isFinite(n)) return null;
    return n / (1024 * 1024);
  } catch {
    return null;
  }
}

export function createXrDevStats({ THREE, parent } = {}) {
  let enabled = false;
  let statsOpen = false;
  let recording = false;
  let lastPaint = 0;
  let lastFrameAt = 0;
  let lastKeepAt = 0;
  let fps = 0;
  let dtMs = 0;
  const samples = [];
  const actions = [];
  let recordStartedAt = 0;
  let lastWhere = "xr-frame";
  const controls = createXrControlsRecorder();

  const fpsCanvas = document.createElement("canvas");
  fpsCanvas.width = HUD_W;
  fpsCanvas.height = HUD_H;
  const fpsCtx = fpsCanvas.getContext("2d");
  const fpsTex = new THREE.CanvasTexture(fpsCanvas);
  fpsTex.colorSpace = THREE.SRGBColorSpace;
  const fpsMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.11, 0.033),
    new THREE.MeshBasicMaterial({
      map: fpsTex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  fpsMesh.renderOrder = 22000;
  fpsMesh.frustumCulled = false;
  fpsMesh.visible = false;
  const fpsGroup = new THREE.Group();
  fpsGroup.name = "xrDevFpsHud";
  fpsGroup.add(fpsMesh);
  parent?.add?.(fpsGroup);

  const statsCanvas = document.createElement("canvas");
  statsCanvas.width = STATS_W;
  statsCanvas.height = STATS_H;
  const statsCtx = statsCanvas.getContext("2d");
  const statsTex = new THREE.CanvasTexture(statsCanvas);
  statsTex.colorSpace = THREE.SRGBColorSpace;
  const statsMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.158),
    new THREE.MeshBasicMaterial({
      map: statsTex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  statsMesh.renderOrder = 22010;
  statsMesh.frustumCulled = false;
  const statsGroup = new THREE.Group();
  statsGroup.name = "xrDevStatsPopup";
  statsGroup.visible = false;
  statsGroup.add(statsMesh);
  parent?.add?.(statsGroup);
  const _fwd = new THREE.Vector3();

  function paintHud() {
    const ctx = fpsCtx;
    ctx.clearRect(0, 0, HUD_W, HUD_H);
    ctx.fillStyle = "rgba(15,23,42,0.72)";
    ctx.fillRect(0, 0, HUD_W, HUD_H);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "700 28px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(fps)} fps`, 10, HUD_H / 2);
    fpsTex.needsUpdate = true;
  }

  function paintStats() {
    const ctx = statsCtx;
    ctx.clearRect(0, 0, STATS_W, STATS_H);
    ctx.fillStyle = "#1c2229";
    ctx.fillRect(0, 0, STATS_W, STATS_H);
    ctx.strokeStyle = "#94a3b8";
    ctx.strokeRect(1, 1, STATS_W - 2, STATS_H - 2);
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "700 16px Arial,sans-serif";
    ctx.textAlign = "left";
    const mem = heapMb();
    const memTxt = mem != null ? ` · ${mem.toFixed(0)} MB` : "";
    ctx.fillText(`${Math.round(fps)} fps · ${dtMs.toFixed(1)} ms${memTxt}`, 12, 22);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 12px Arial,sans-serif";
    ctx.fillText(recording ? "Recording XR perf…" : "Sparkline · 4 Hz", 12, 40);
    const pts = samples.slice(-MAX_SAMPLES);
    if (pts.length > 1) {
      const maxF = Math.max(90, ...pts.map((s) => s.fps || 0));
      ctx.beginPath();
      pts.forEach((s, i) => {
        const x = 12 + (i / (pts.length - 1)) * (STATS_W - 24);
        const y = STATS_H - 16 - ((s.fps || 0) / maxF) * (STATS_H - 70);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    statsTex.needsUpdate = true;
  }

  function setEnabled(on) {
    enabled = developerModeEnabled(on);
    fpsGroup.visible = enabled;
    if (!enabled) {
      statsOpen = false;
      statsGroup.visible = false;
      recording = false;
    } else {
      paintHud();
    }
  }

  function setStatsOpen(on) {
    statsOpen = !!on && enabled;
    statsGroup.visible = statsOpen;
    if (statsOpen) paintStats();
  }

  function startRecording() {
    if (!enabled) return false;
    recording = true;
    if (!recordStartedAt) recordStartedAt = performance.now();
    // Never reset the ring here — Send after startRecording() wiped controls.rows (0707).
    return true;
  }

  function stopRecording() {
    recording = false;
    return snapshot();
  }

  function noteAction(tool) {
    if (!recording) return;
    const id = String(tool || "").slice(0, 40);
    if (!id) return;
    lastWhere = id;
    actions.push({ t: Math.round(performance.now() - recordStartedAt), tool: id });
    if (actions.length > MAX_ACTIONS) actions.splice(0, actions.length - MAX_ACTIONS);
  }

  function snapshot({
    auto = false,
    presenting = false,
    laser = false,
    framebufferScale = XR_FRAMEBUFFER_SCALE,
    foveation = XR_FOVEATION,
    hudScale = XR_HUD_CANVAS_SCALE,
  } = {}) {
    const stats = summarizeXrFrameTimes(samples);
    const hitches = summarizeXrHitchSpikes(samples, { hitchMs: XR_HITCH_MS });
    const when = new Date();
    const n = stats.n;
    const ctl = controls.snapshot();
    const ctlN = Array.isArray(ctl.rows) ? ctl.rows.length : 0;
    const mem = heapMb();
    const now = performance.now();
    const durationMs = recordStartedAt ? Math.round(now - recordStartedAt) : (ctl.durationMs || 0);
    const description = `XR debugger session${n ? ` · ${n} frames` : ""}${ctlN ? ` · ${ctlN} ctl` : ""}${hitches.hitchCount ? ` · ${hitches.hitchCount} hitches` : ""}`;
    const spikeTrace = hitches.spikes.map((row) => {
      const where = String(row?.where || "").trim();
      const stack = String(row?.stack || "").trim();
      return [`${row.t}ms`, `dt=${row.dt}`, where, stack].filter(Boolean).join(" ");
    }).filter(Boolean).join(" | ").slice(0, 500);
    const raw = {
      v: 3,
      kind: "xr-perf",
      filename: xrDebuggerLogFilename(when, XR_CONTROLS_SLUG),
      startedAt: recordStartedAt,
      timestamp: when.toISOString(),
      description,
      auto: false,
      manual: true,
      tag: hitches.hitchCount ? "spike" : "normal",
      spikeTrace,
      avgMs: stats.avgMs,
      p95Ms: stats.p95Ms,
      n,
      memMb: mem != null ? Math.round(mem * 10) / 10 : undefined,
      hitchCount: hitches.hitchCount,
      hitchMs: hitches.hitchMs,
      maxDt: hitches.maxDt,
      spikes: hitches.spikes,
      framebufferScale,
      foveation,
      hudScale,
      presenting: presenting ? 1 : 0,
      laser: laser ? 1 : (ctl?.ov?.l ? 1 : 0),
      durationMs,
      samples: samples.slice(),
      actions: actions.slice(),
      controls: ctl,
    };
    if (auto) raw.skippedAuto = 1;
    return capXrControlsPayload(raw);
  }

  function followHead(headPos, headQuat) {
    if (!enabled || !headPos) return;
    _fwd.set(0, 0, -1).applyQuaternion(headQuat);
    fpsGroup.position.copy(headPos).addScaledVector(_fwd, 0.55);
    fpsGroup.position.y += 0.16;
    fpsGroup.quaternion.copy(headQuat);
    if (statsOpen) {
      statsGroup.position.copy(headPos).addScaledVector(_fwd, 0.55);
      statsGroup.position.y += 0.02;
      statsGroup.quaternion.copy(headQuat);
    }
  }

  function tick(now) {
    const t = Number(now) || performance.now();
    if (!recordStartedAt) recordStartedAt = t;
    if (lastFrameAt) dtMs = Math.max(0.1, t - lastFrameAt);
    lastFrameAt = t;
    fps = dtMs > 0 ? 1000 / dtMs : 0;
    const row = { t: Math.round(t), fps: Math.round(fps * 10) / 10, dt: Math.round(dtMs * 10) / 10 };
    const mem = heapMb();
    if (mem != null) row.memMb = Math.round(mem * 10) / 10;
    const hitch = dtMs >= XR_HITCH_MS;
    const due = !lastKeepAt || t - lastKeepAt >= SAMPLE_MS;
    if (due || hitch) {
      if (hitch) {
        row.where = lastWhere || "xr-frame";
        try {
          row.stack = String(new Error().stack || "")
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(2, 8)
            .join(" | ")
            .slice(0, 400);
        } catch { /* ignore */ }
      }
      samples.push(row);
      if (due) lastKeepAt = t;
      if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
    }
    if (!enabled) return;
    if (t - lastPaint < HUD_MS) return;
    lastPaint = t;
    paintHud();
    if (statsOpen) paintStats();
  }

  return {
    setEnabled,
    isEnabled: () => enabled,
    setStatsOpen,
    isStatsOpen: () => statsOpen,
    toggleStats: () => { setStatsOpen(!statsOpen); return statsOpen; },
    startRecording,
    stopRecording,
    isRecording: () => recording,
    noteAction,
    snapshot,
    followHead,
    tick,
    noteSession: (meta) => controls.noteSession(meta),
    noteSources: (list) => controls.noteSources(list),
    noteEvent: (ev, extra) => {
      const hit = extra?.hit || extra?.c || extra?.tool || ev;
      if (hit) lastWhere = String(hit).slice(0, 80);
      return controls.noteEvent(ev, extra);
    },
    noteControlsFrame: (extra) => controls.noteFrame({
      fps,
      dt: dtMs,
      ...extra,
    }),
    keepRecording: () => { recording = true; if (!recordStartedAt) recordStartedAt = performance.now(); },
    fps: () => fps,
    dtMs: () => dtMs,
    logFilename: () => xrDebuggerLogFilename(new Date(), XR_CONTROLS_SLUG),
  };
}
