/**
 * Desktop debugger session: Record overlay (same chrome as screen record),
 * click + RAM/CPU samples, spike traces, upload as *-desk-dbg.jsonl.
 */

import { xrDebuggerLogFilename } from "./xr-hot-path.js?v=deskdbg1";
import {
  debuggerLogTag,
  debuggerSpikeTraceText,
  openXrDebuggerLogPopup,
  recentManualDebuggerLogs,
} from "./xr-debugger-popup.js?v=deskdbg1";

export const DESK_DBG_SLUG = "desk-dbg";
export const DESK_HITCH_MS = 50;
export const DESK_HEAP_JUMP_MB = 24;
export const DESK_DEBUG_OVERLAY_ID = "r3d-debug-record-overlay";

let currentScope = "";

export function setDesktopPerfScope(scope) {
  currentScope = String(scope || "").slice(0, 80);
  if (typeof window !== "undefined") {
    try { window.__r3dPerfScope = currentScope; } catch { /* ignore */ }
  }
}

export function desktopPerfScope() {
  if (currentScope) return currentScope;
  try {
    return String((typeof window !== "undefined" && window.__r3dPerfScope) || "");
  } catch {
    return "";
  }
}

export function clickPathFromEvent(ev) {
  const node = ev?.target;
  if (!node || typeof node !== "object") return "document";
  const tag = String(node.tagName || node.nodeName || "node").toLowerCase();
  const id = node.id ? `#${String(node.id).slice(0, 48)}` : "";
  const cls = typeof node.className === "string"
    ? `.${node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".")}`
    : "";
  const label = String(node.getAttribute?.("aria-label") || node.dataset?.r3dRec || node.dataset?.vtlTool || "").slice(0, 40);
  return `${tag}${id}${cls}${label ? ` ${label}` : ""}`.slice(0, 160);
}

export function shouldStampHeapJump(prevMb, memMb, jumpMb = DESK_HEAP_JUMP_MB) {
  return memMb != null && prevMb != null && (Number(memMb) - Number(prevMb)) >= (Number(jumpMb) || DESK_HEAP_JUMP_MB);
}

export function heapMbNow() {
  try {
    const n = performance.memory?.usedJSHeapSize;
    if (!Number.isFinite(n)) return null;
    return Math.round((n / (1024 * 1024)) * 10) / 10;
  } catch {
    return null;
  }
}

export function capturePerfStack(limit = 6) {
  try {
    const lines = String(new Error().stack || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(2, 2 + Math.max(1, Number(limit) || 6));
    return lines.join(" | ").slice(0, 400);
  } catch {
    return "";
  }
}

export function summarizeDesktopSpikes(samples = [], {
  hitchMs = DESK_HITCH_MS,
  heapJumpMb = DESK_HEAP_JUMP_MB,
  maxSpikes = 40,
} = {}) {
  const threshold = Number(hitchMs) > 0 ? Number(hitchMs) : DESK_HITCH_MS;
  const heapNeed = Number(heapJumpMb) > 0 ? Number(heapJumpMb) : DESK_HEAP_JUMP_MB;
  const spikes = [];
  let prevMem = null;
  let maxDt = 0;
  for (const row of samples || []) {
    const dt = Number(row?.dt);
    if (Number.isFinite(dt) && dt > maxDt) maxDt = dt;
    const mem = Number(row?.memMb);
    const memJump = Number.isFinite(mem) && prevMem != null && (mem - prevMem) >= heapNeed;
    if (Number.isFinite(mem)) prevMem = mem;
    if ((Number.isFinite(dt) && dt >= threshold) || memJump || row?.spike) {
      const item = {
        t: Math.round(Number(row?.t) || 0),
        dt: Math.round((Number.isFinite(dt) ? dt : 0) * 10) / 10,
        fps: Math.round((Number(row?.fps) || 0) * 10) / 10,
      };
      if (Number.isFinite(mem)) item.memMb = Math.round(mem * 10) / 10;
      if (Number.isFinite(Number(row?.cpu))) item.cpu = Math.round(Number(row.cpu));
      if (memJump) item.heap = 1;
      if (row?.where) item.where = String(row.where).slice(0, 160);
      if (row?.stack) item.stack = String(row.stack).slice(0, 400);
      if (row?.lastClick) item.lastClick = String(row.lastClick).slice(0, 160);
      spikes.push(item);
    }
  }
  return {
    hitchCount: spikes.length,
    hitchMs: threshold,
    maxDt: Math.round(maxDt * 10) / 10,
    tag: spikes.length ? "spike" : "normal",
    spikes: spikes.slice(-(Number(maxSpikes) > 0 ? Number(maxSpikes) : 40)),
  };
}

export function desktopDebuggerPayload({
  samples = [],
  clicks = [],
  actions = [],
  spikes = null,
  startedAt = 0,
  durationMs = 0,
} = {}) {
  const hitches = spikes && typeof spikes === "object" && Array.isArray(spikes.spikes)
    ? spikes
    : summarizeDesktopSpikes(samples);
  const last = samples[samples.length - 1] || {};
  const when = new Date();
  const n = samples.length;
  const description = `Desktop debugger session${n ? ` · ${n} samples` : ""}${hitches.hitchCount ? ` · ${hitches.hitchCount} spikes` : ""}`;
  return {
    v: 3,
    kind: "desktop-perf",
    filename: xrDebuggerLogFilename(when, DESK_DBG_SLUG),
    timestamp: when.toISOString(),
    description,
    auto: false,
    manual: true,
    startedAt,
    durationMs: Math.round(Number(durationMs) || 0),
    n,
    memMb: last.memMb,
    hitchCount: hitches.hitchCount,
    hitchMs: hitches.hitchMs,
    maxDt: hitches.maxDt,
    tag: hitches.tag,
    spikeTrace: debuggerSpikeTraceText({ spikes: hitches.spikes }),
    samples,
    clicks: Array.isArray(clicks) ? clicks.slice(-240) : [],
    actions: Array.isArray(actions) ? actions.slice(-80) : [],
    spikes: hitches.spikes,
  };
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function overlayHtml() {
  return `
    <span class="r3d-record-overlay-grip" aria-hidden="true">
      <span class="r3d-record-overlay-live"></span>
      <span class="r3d-record-overlay-kicker">DEBUG</span>
      <span class="r3d-record-overlay-time" data-desk-dbg-clock>0:00</span>
    </span>
    <div class="r3d-record-overlay-meters" aria-live="polite">
      <span data-desk-dbg-ram>RAM —</span>
      <span data-desk-dbg-cpu>CPU —</span>
      <span class="dbg-log-tag dbg-log-tag--normal" data-desk-dbg-tag>normal</span>
    </div>
    <button type="button" class="r3d-record-overlay-btn r3d-record-overlay-btn--stop" data-desk-dbg="stop" title="Stop debugger record" aria-label="Stop debugger record"><span aria-hidden="true">■</span><span>Stop</span></button>
  `;
}

export function createDesktopDebuggerSession({
  authHeaders = () => ({}),
  listLogs,
  readLog,
} = {}) {
  let recording = false;
  let startedAt = 0;
  let lastFrameAt = 0;
  let lastKeepAt = 0;
  let lastCpuAt = 0;
  let frameWork = 0;
  let cpuPct = 0;
  let raf = 0;
  let clockTimer = 0;
  let overlayEl = null;
  let overlayDrag = null;
  let lastClick = "";
  let lastMem = null;
  let observer = null;
  const samples = [];
  const clicks = [];
  const actions = [];
  const extraSpikes = [];

  function headers() {
    try {
      return typeof authHeaders === "function" ? (authHeaders() || {}) : {};
    } catch {
      return {};
    }
  }

  function noteSpike(row) {
    const item = {
      t: Math.round(performance.now() - startedAt),
      dt: Math.round((Number(row?.dt) || 0) * 10) / 10,
      fps: Math.round((Number(row?.fps) || 0) * 10) / 10,
      cpu: Math.round(Number.isFinite(Number(row?.cpu)) ? Number(row.cpu) : cpuPct),
      where: String(row?.where || desktopPerfScope() || lastClick || "main-thread").slice(0, 160),
      lastClick: lastClick,
      stack: String(row?.stack || capturePerfStack()).slice(0, 400),
      spike: 1,
    };
    const mem = heapMbNow();
    if (mem != null) item.memMb = mem;
    extraSpikes.push(item);
    samples.push({ ...item });
    if (extraSpikes.length > 40) extraSpikes.splice(0, extraSpikes.length - 40);
    paintOverlay();
  }

  function onClick(ev) {
    if (!recording) return;
    if (ev.target?.closest?.(`#${DESK_DEBUG_OVERLAY_ID}`)) return;
    const path = clickPathFromEvent(ev);
    lastClick = path;
    clicks.push({
      t: Math.round(performance.now() - startedAt),
      path,
      x: Math.round(Number(ev.clientX) || 0),
      y: Math.round(Number(ev.clientY) || 0),
      type: String(ev.type || "click").slice(0, 12),
    });
    if (clicks.length > 240) clicks.splice(0, clicks.length - 240);
    actions.push({ t: Math.round(performance.now() - startedAt), tool: path.slice(0, 40) });
    if (actions.length > 80) actions.splice(0, actions.length - 80);
  }

  function tick(now) {
    if (!recording) return;
    const t = Number(now) || performance.now();
    const dt = lastFrameAt ? Math.max(0.1, t - lastFrameAt) : 16.7;
    lastFrameAt = t;
    frameWork += dt;
    if (!lastCpuAt) lastCpuAt = t;
    if (t - lastCpuAt >= 500) {
      const span = Math.max(1, t - lastCpuAt);
      cpuPct = Math.min(100, Math.round((Math.max(0, frameWork - (span * 0.55)) / span) * 100));
      frameWork = 0;
      lastCpuAt = t;
    }
    const fps = dt > 0 ? 1000 / dt : 0;
    const mem = heapMbNow();
    const elapsed = Math.round(t - startedAt);
    const memJump = mem != null && lastMem != null && (mem - lastMem) >= DESK_HEAP_JUMP_MB;
    if (memJump) {
      try {
        globalThis.dispatchEvent?.(new CustomEvent("studio-credit-incident", {
          detail: {
            eventType: "heap.jump",
            memMb: mem,
            prevMb: lastMem,
            scope: desktopPerfScope(),
            note: desktopPerfScope() ? `Heap jump in ${desktopPerfScope()}` : "Desktop heap jump",
          },
        }));
      } catch { /* stamp is best-effort */ }
    }
    if (mem != null) lastMem = mem;
    const hitch = dt >= DESK_HITCH_MS || memJump;
    const due = !lastKeepAt || t - lastKeepAt >= 250;
    if (due || hitch) {
      const row = {
        t: elapsed,
        fps: Math.round(fps * 10) / 10,
        dt: Math.round(dt * 10) / 10,
        cpu: cpuPct,
      };
      if (mem != null) row.memMb = mem;
      if (hitch) {
        row.where = desktopPerfScope() || lastClick || "raf";
        row.lastClick = lastClick;
        row.stack = capturePerfStack();
        row.spike = 1;
      }
      samples.push(row);
      if (due) lastKeepAt = t;
      if (samples.length > 1200) samples.splice(0, samples.length - 1200);
    }
    raf = requestAnimationFrame(tick);
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.id = DESK_DEBUG_OVERLAY_ID;
    overlayEl.className = "r3d-record-overlay r3d-record-overlay--debug r3d-record-overlay--off";
    overlayEl.setAttribute("role", "toolbar");
    overlayEl.setAttribute("aria-label", "Debugger recording");
    overlayEl.innerHTML = overlayHtml();
    overlayEl.addEventListener("click", (e) => {
      const action = e.target.closest("[data-desk-dbg]")?.dataset.deskDbg;
      if (action === "stop") {
        e.preventDefault();
        e.stopPropagation();
        void stopRecording();
      }
    });
    overlayEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("[data-desk-dbg]")) return;
      const rect = overlayEl.getBoundingClientRect();
      overlayDrag = { pointerId: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      overlayEl.classList.add("is-dragging");
      try { overlayEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });
    overlayEl.addEventListener("pointermove", (e) => {
      if (!overlayDrag || overlayDrag.pointerId !== e.pointerId) return;
      overlayEl.style.left = `${Math.max(8, e.clientX - overlayDrag.dx)}px`;
      overlayEl.style.top = `${Math.max(8, e.clientY - overlayDrag.dy)}px`;
      overlayEl.style.right = "auto";
      overlayEl.style.transform = "none";
    });
    const endDrag = (e) => {
      if (!overlayDrag || overlayDrag.pointerId !== e.pointerId) return;
      overlayEl.classList.remove("is-dragging");
      overlayDrag = null;
    };
    overlayEl.addEventListener("pointerup", endDrag);
    overlayEl.addEventListener("pointercancel", endDrag);
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function paintOverlay() {
    const el = overlayEl;
    if (!el) return;
    const clock = el.querySelector("[data-desk-dbg-clock]");
    const ram = el.querySelector("[data-desk-dbg-ram]");
    const cpu = el.querySelector("[data-desk-dbg-cpu]");
    const tagEl = el.querySelector("[data-desk-dbg-tag]");
    if (clock) clock.textContent = formatClock(performance.now() - startedAt);
    const mem = heapMbNow();
    if (ram) ram.textContent = mem != null ? `RAM ${mem} MB` : "RAM —";
    if (cpu) cpu.textContent = `CPU ${cpuPct}% · ${Math.round((samples[samples.length - 1]?.dt) || 0) || "—"}ms`;
    const spiked = extraSpikes.length > 0 || samples.some((row) => row.spike);
    if (tagEl) {
      tagEl.textContent = spiked ? "spike" : "normal";
      tagEl.className = `dbg-log-tag dbg-log-tag--${spiked ? "spike" : "normal"}`;
    }
  }

  function showOverlay(on) {
    const el = ensureOverlay();
    document.documentElement.classList.toggle("r3d-is-debug-recording", !!on);
    document.body.classList.toggle("r3d-is-debug-recording", !!on);
    el.classList.toggle("r3d-record-overlay--off", !on);
    el.setAttribute("aria-hidden", on ? "false" : "true");
    if (on) {
      const vw = window.visualViewport?.width || window.innerWidth;
      const vh = window.visualViewport?.height || window.innerHeight;
      el.style.left = `${Math.max(8, vw - 96)}px`;
      el.style.top = `${Math.max(8, Math.round(vh * 0.38))}px`;
      el.style.right = "auto";
      el.style.transform = "none";
      paintOverlay();
    }
  }

  function startLongtaskObserver() {
    try {
      observer?.disconnect?.();
    } catch { /* ignore */ }
    observer = null;
    if (typeof PerformanceObserver !== "function") return;
    try {
      observer = new PerformanceObserver((list) => {
        if (!recording) return;
        for (const entry of list.getEntries()) {
          if (Number(entry.duration) >= DESK_HITCH_MS) {
            noteSpike({
              dt: entry.duration,
              where: `${desktopPerfScope() || "longtask"}:${entry.name || "task"}`.slice(0, 160),
              stack: capturePerfStack(),
            });
          }
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      observer = null;
    }
  }

  function startRecording() {
    if (recording) return true;
    recording = true;
    startedAt = performance.now();
    lastFrameAt = startedAt;
    lastKeepAt = 0;
    lastCpuAt = startedAt;
    frameWork = 0;
    cpuPct = 0;
    lastClick = "";
    lastMem = heapMbNow();
    samples.length = 0;
    clicks.length = 0;
    actions.length = 0;
    extraSpikes.length = 0;
    document.addEventListener("click", onClick, true);
    startLongtaskObserver();
    showOverlay(true);
    raf = requestAnimationFrame(tick);
    clockTimer = window.setInterval(paintOverlay, 250);
    return true;
  }

  async function uploadPayload(payload) {
    const res = await fetch("/api/xr/debugger/logs", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      const detail = data.detail;
      throw new Error(typeof detail === "string" ? detail : (res.statusText || "Could not save debugger log"));
    }
    return data;
  }

  async function stopRecording() {
    if (!recording) return null;
    recording = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = 0;
    }
    document.removeEventListener("click", onClick, true);
    try { observer?.disconnect?.(); } catch { /* ignore */ }
    observer = null;
    showOverlay(false);
    const durationMs = Math.round(performance.now() - startedAt);
    const mergedSamples = samples.slice();
    for (const spike of extraSpikes) {
      if (!mergedSamples.some((row) => row.t === spike.t && row.dt === spike.dt)) {
        mergedSamples.push(spike);
      }
    }
    mergedSamples.sort((a, b) => (a.t || 0) - (b.t || 0));
    const payload = desktopDebuggerPayload({
      samples: mergedSamples,
      clicks,
      actions,
      startedAt,
      durationMs,
    });
    let name = payload.filename;
    try {
      const data = await uploadPayload(payload);
      name = data.name || name;
    } catch {
      /* still offer a local download */
    }
    const recent = typeof listLogs === "function" ? await listLogs().catch(() => []) : [];
    const text = JSON.stringify(payload);
    openXrDebuggerLogPopup({
      name,
      text,
      recent: recentManualDebuggerLogs(recent, 5),
      payload,
      title: "Debugger session",
    });
    return { name, payload };
  }

  return {
    startRecording,
    stopRecording,
    isRecording: () => recording,
    overlayEl: () => overlayEl,
    payloadPreview: () => desktopDebuggerPayload({ samples, clicks, actions, startedAt, durationMs: performance.now() - startedAt }),
  };
}

let singleton = null;

export function getDesktopDebuggerSession(opts = {}) {
  if (!singleton) singleton = createDesktopDebuggerSession(opts);
  return singleton;
}

export function bindDesktopDebuggerRecordButton(btn, opts = {}) {
  if (!btn) return null;
  const session = getDesktopDebuggerSession(opts);
  const sync = () => {
    const on = session.isRecording();
    btn.textContent = on ? "Stop record" : "Record";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.classList.toggle("is-on", on);
  };
  if (btn.dataset.deskDbgBound === "1") {
    sync();
    return session;
  }
  btn.dataset.deskDbgBound = "1";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    if (session.isRecording()) {
      void session.stopRecording().then(sync);
      return;
    }
    session.startRecording();
    sync();
  });
  sync();
  return session;
}
