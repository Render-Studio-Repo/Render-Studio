/**
 * Built-in clip editor for viewport recordings — audio keep/hide,
 * quick effects, and a natural-language prompt that maps to those tools.
 * All processing stays in the browser (canvas + MediaRecorder).
 */

import { setDesktopPerfScope, heapMbNow, shouldStampHeapJump } from "../xr/debugger-session.js?v=deskdbg1&leakobs1";

export const VIDEO_LOOK_GRADES = {
  none: { filter: "none", label: "Original" },
  warm: { filter: "sepia(0.28) saturate(1.2) contrast(1.05) brightness(1.03)", label: "Warm" },
  cool: { filter: "hue-rotate(195deg) saturate(1.15) brightness(1.02)", label: "Cool" },
  vivid: { filter: "saturate(1.45) contrast(1.12) brightness(1.04)", label: "Vivid" },
  noir: { filter: "grayscale(1) contrast(1.2) brightness(0.95)", label: "Noir" },
};
const GRADES = VIDEO_LOOK_GRADES;

export function cssFilterForGrade(grade) {
  return GRADES[grade]?.filter || "none";
}

const HISTORY_MAX = 40;
export const VIDEO_BAKE_MAX_EDGE = 1280;
export const VIDEO_BAKE_FPS = 30;
export const VIDEO_BAKE_BITS = 8_000_000;

/** Cap bake canvas so 4K/60fps encodes cannot pin the tab. */
export function videoBakeOutputSize(width, height, maxEdge = VIDEO_BAKE_MAX_EDGE) {
  const srcW = Math.max(2, Number(width) || 1280);
  const srcH = Math.max(2, Number(height) || 720);
  const cap = Number(maxEdge) > 0 ? Number(maxEdge) : VIDEO_BAKE_MAX_EDGE;
  const scale = Math.min(1, cap / Math.max(srcW, srcH));
  return {
    w: Math.max(2, Math.round(srcW * scale)),
    h: Math.max(2, Math.round(srcH * scale)),
  };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

export function trackObjectUrl(blob, created) {
  if (!blob || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return "";
  const url = URL.createObjectURL(blob);
  if (Array.isArray(created)) created.push(url);
  return url;
}

export function triggerTrackedBlobDownload(blob, filename, created) {
  // Download click via trackObjectUrl. Revoke previous; keep latest until replace/destroy.
  if (!(blob instanceof Blob) || !(blob.size > 0)) return "";
  revokeTrackedObjectUrls(created);
  const url = trackObjectUrl(blob, created);
  if (!url) return "";
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = filename || "render3d-download";
    link.rel = "noopener";
    if (typeof document !== "undefined" && document.body) document.body.appendChild(link);
    link.click();
  } finally {
    try { link.remove(); } catch (_) { /* ignore */ }
  }
  return url;
}

export function revokeTrackedObjectUrls(created) {
  if (!Array.isArray(created) || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return 0;
  let n = 0;
  while (created.length) {
    const url = created.pop();
    try {
      URL.revokeObjectURL(url);
      n += 1;
    } catch (_) { /* ignore */ }
  }
  return n;
}

const previewDropHandlers = new WeakMap();

export function attachPreviewObjectUrl(el, blob, created) {
  if (!el) return "";
  const prev = previewDropHandlers.get(el);
  if (prev && typeof el.removeEventListener === "function") {
    try { el.removeEventListener("error", prev); } catch (_) { /* ignore */ }
    try { el.removeEventListener("abort", prev); } catch (_) { /* ignore */ }
    previewDropHandlers.delete(el);
  }
  revokeTrackedObjectUrls(created);
  const url = trackObjectUrl(blob, created);
  if (!url) return "";
  const drop = () => revokeTrackedObjectUrls(created);
  previewDropHandlers.set(el, drop);
  if (typeof el.addEventListener === "function") {
    el.addEventListener("error", drop, { once: true });
    el.addEventListener("abort", drop, { once: true });
  }
  try { el.src = url; } catch (_) { /* ignore */ }
  return url;
}

function defaultState() {
  return {
    keepAudio: true,
    grade: "none",
    effects: { fade: false, vignette: false, slow: false, title: false },
    titleText: "loading Render Studio",
    music: null,
    stills: [],
    baking: false,
  };
}

function cloneEditorState(state) {
  return {
    keepAudio: !!state.keepAudio,
    grade: state.grade || "none",
    effects: {
      fade: !!state.effects?.fade,
      vignette: !!state.effects?.vignette,
      slow: !!state.effects?.slow,
      title: !!state.effects?.title,
    },
    titleText: String(state.titleText || "loading Render Studio").slice(0, 80),
  };
}

function statesEqual(a, b) {
  if (!a || !b) return false;
  return a.keepAudio === b.keepAudio
    && a.grade === b.grade
    && a.titleText === b.titleText
    && a.effects.fade === b.effects.fade
    && a.effects.vignette === b.effects.vignette
    && a.effects.slow === b.effects.slow
    && a.effects.title === b.effects.title;
}

/** Map a freeform prompt to editor settings (local, instant). */
export function parseVideoEditPrompt(raw = "") {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  const plan = {
    keepAudio: null,
    grade: null,
    effects: {},
    titleText: null,
    music: null,
    summary: [],
  };
  if (!text) return plan;

  if (/\b(mute|silent|no audio|hide audio|without (audio|sound)|strip audio)\b/.test(lower)) {
    plan.keepAudio = false;
    plan.summary.push("hide audio");
  } else if (/\b(keep audio|with audio|with sound|unmute)\b/.test(lower)) {
    plan.keepAudio = true;
    plan.summary.push("keep audio");
  }

  if (/\b(warm|golden|sunset|amber)\b/.test(lower)) {
    plan.grade = "warm";
    plan.summary.push("warm grade");
  } else if (/\b(cool|blue|icy|cold)\b/.test(lower)) {
    plan.grade = "cool";
    plan.summary.push("cool grade");
  } else if (/\b(vivid|punchy|saturated|pop)\b/.test(lower)) {
    plan.grade = "vivid";
    plan.summary.push("vivid grade");
  } else if (/\b(noir|bw|b&w|black and white|monochrome|desaturat)\b/.test(lower)) {
    plan.grade = "noir";
    plan.summary.push("noir grade");
  } else if (/\b(original|reset color|no grade|natural)\b/.test(lower)) {
    plan.grade = "none";
    plan.summary.push("original color");
  }

  if (/\bfade\b/.test(lower)) {
    plan.effects.fade = true;
    plan.summary.push("fade");
  }
  if (/\bvignette\b/.test(lower)) {
    plan.effects.vignette = true;
    plan.summary.push("vignette");
  }
  if (/\b(slow[\s-]?mo|slow motion|slower|0\.5x|half speed)\b/.test(lower)) {
    plan.effects.slow = true;
    plan.summary.push("slow‑mo");
  }
  if (/\b(normal speed|1x|full speed)\b/.test(lower)) {
    plan.effects.slow = false;
    plan.summary.push("normal speed");
  }

  const titleQuoted = text.match(/\btitle\s*[:=]\s*["“']([^"”']+)["”']/i)
    || text.match(/\b(?:add|with)\s+title\s+["“']([^"”']+)["”']/i)
    || text.match(/\btitle\s*[:=]\s*([^,"”'\n]+)/i)
    || text.match(/\btitle\s+(.+)$/i);
  if (titleQuoted?.[1]) {
    plan.effects.title = true;
    plan.titleText = titleQuoted[1].trim().slice(0, 80);
    plan.summary.push(`title “${plan.titleText}”`);
  } else if (/\b(title card|add title|opening title)\b/.test(lower)) {
    plan.effects.title = true;
    plan.titleText = "loading Render Studio";
    plan.summary.push("title card");
  }

  if (/\b(cinematic|film look)\b/.test(lower)) {
    plan.grade = plan.grade || "warm";
    plan.effects.fade = true;
    plan.effects.vignette = true;
    plan.summary.push("cinematic");
  }

  if (/\b(add music|with music|music bed|soundtrack|drop audio)\b/.test(lower)) {
    plan.music = "enable";
    plan.summary.push("add music");
  } else if (/\b(no music|remove music|without music|mute music)\b/.test(lower)) {
    plan.music = "disable";
    plan.summary.push("remove music");
  }

  return plan;
}

function cssFilterForState(state) {
  return cssFilterForGrade(state.grade);
}

function stateNeedsBake(state = {}) {
  const effects = state.effects || {};
  return !state.keepAudio
    || (state.grade && state.grade !== "none")
    || Object.values(effects).some(Boolean)
    || !!state.music?.blob
    || (Array.isArray(state.stills) && state.stills.length > 0);
}

async function decodeStillImages(stills = []) {
  const out = [];
  const createdUrls = [];
  for (const still of stills || []) {
    if (still?.image) {
      out.push(still);
      continue;
    }
    const src = still?.url || trackObjectUrl(still?.blob, createdUrls);
    if (!src) continue;
    const image = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    if (image) out.push({ ...still, image, url: src });
  }
  return { images: out, createdUrls };
}

/**
 * Re-encode a blob through canvas with optional audio strip, music bed, stills, and looks.
 */
export async function renderEditedClip(sourceBlob, state = {}, { onProgress } = {}) {
  if (!sourceBlob) throw new Error("No clip to edit.");
  const keepAudio = state.keepAudio !== false;
  const grade = state.grade || "none";
  const effects = state.effects || {};
  const titleText = String(state.titleText || "loading Render Studio").slice(0, 80);
  const music = state.music || null;
  const decoded = await decodeStillImages(state.stills || []);
  const stills = decoded.images;
  const createdUrls = [...(decoded.createdUrls || [])];

  if (!stateNeedsBake({ ...state, stills })) {
    revokeTrackedObjectUrls(createdUrls);
    return sourceBlob;
  }

  const bakeStartHeap = heapMbNow();
  setDesktopPerfScope("video-editor-bake");
  const url = trackObjectUrl(sourceBlob, createdUrls);
  const video = document.createElement("video");
  video.src = url;
  video.playsInline = true;
  video.muted = true;
  video.preload = "auto";

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Could not load clip for editing."));
    });
  } catch (err) {
    revokeTrackedObjectUrls(createdUrls);
    setDesktopPerfScope("");
    throw err;
  }

  const size = videoBakeOutputSize(video.videoWidth || 1280, video.videoHeight || 720);
  const w = size.w;
  const h = size.h;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) {
    revokeTrackedObjectUrls(createdUrls);
    setDesktopPerfScope("");
    throw new Error("Canvas unavailable for video edit.");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";

  const playbackRate = effects.slow ? 0.6 : 1;
  video.playbackRate = playbackRate;

  const fps = VIDEO_BAKE_FPS;
  const outStream = canvas.captureStream(fps);
  const tracks = [...outStream.getVideoTracks()];
  let audioCtx = null;
  let musicSource = null;
  let capturedMedia = null;

  if (keepAudio && !music?.blob) {
    try {
      capturedMedia = typeof video.captureStream === "function"
        ? video.captureStream()
        : (typeof video.mozCaptureStream === "function" ? video.mozCaptureStream() : null);
      const audioTracks = capturedMedia?.getAudioTracks?.() || [];
      for (const t of audioTracks) tracks.push(t);
    } catch {
      capturedMedia = null;
    }
  } else if (keepAudio || music?.blob) {
    try {
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      if (keepAudio) {
        const elSrc = audioCtx.createMediaElementSource(video);
        elSrc.connect(dest);
      }
      if (music?.blob) {
        const buf = await audioCtx.decodeAudioData(await music.blob.arrayBuffer());
        musicSource = audioCtx.createBufferSource();
        musicSource.buffer = buf;
        const gain = audioCtx.createGain();
        gain.gain.value = clamp01(music.volume ?? 0.35);
        musicSource.connect(gain).connect(dest);
      }
      for (const t of dest.stream.getAudioTracks()) tracks.push(t);
    } catch {
      /* keep video-only if Web Audio mix fails */
    }
  }

  const mimeCandidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  const mimeType = mimeCandidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
  const mixed = new MediaStream(tracks);
  const recorder = mimeType
    ? new MediaRecorder(mixed, { mimeType, videoBitsPerSecond: VIDEO_BAKE_BITS })
    : new MediaRecorder(mixed, { videoBitsPerSecond: VIDEO_BAKE_BITS });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const filter = cssFilterForState({ grade });
  const vignetteFill = effects.vignette
    ? (() => {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.55)");
      return g;
    })()
    : null;

  const drawFrame = () => {
    const t = video.currentTime || 0;
    const dur = duration || Math.max(t, 0.001);
    ctx.filter = filter;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.filter = "none";

    if (vignetteFill) {
      ctx.fillStyle = vignetteFill;
      ctx.fillRect(0, 0, w, h);
    }

    if (effects.fade) {
      const fadeSecs = Math.min(0.85, dur * 0.12);
      let alpha = 0;
      if (t < fadeSecs) alpha = 1 - t / fadeSecs;
      else if (t > dur - fadeSecs) alpha = (t - (dur - fadeSecs)) / fadeSecs;
      if (alpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${clamp01(alpha)})`;
        ctx.fillRect(0, 0, w, h);
      }
    }

    if (effects.title && t < Math.min(2.2, dur * 0.35)) {
      const titleAlpha = t < 0.25 ? t / 0.25 : t > 1.7 ? clamp01((2.2 - t) / 0.5) : 1;
      ctx.fillStyle = `rgba(0,0,0,${0.42 * titleAlpha})`;
      ctx.fillRect(0, h * 0.62, w, h * 0.28);
      ctx.fillStyle = `rgba(255,255,255,${0.95 * titleAlpha})`;
      const px = Math.max(28, Math.round(h * 0.07));
      ctx.font = `700 ${px}px "Segoe UI", system-ui, -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillText(titleText, w / 2, h * 0.76, w * 0.86);
    }

    for (const still of stills) {
      const start = Number(still.start) || 0;
      const hold = Number(still.duration) > 0 ? Number(still.duration) : Math.max(2.4, dur * 0.35);
      if (t < start || t > start + hold) continue;
      const img = still.image;
      if (!img) continue;
      const pad = Math.round(Math.min(w, h) * 0.04);
      const maxW = still.mode === "full" ? w : Math.round(w * 0.28);
      const maxH = still.mode === "full" ? h : Math.round(h * 0.28);
      const scale = Math.min(maxW / Math.max(1, img.naturalWidth || img.width), maxH / Math.max(1, img.naturalHeight || img.height));
      const dw = Math.max(2, Math.round((img.naturalWidth || img.width) * scale));
      const dh = Math.max(2, Math.round((img.naturalHeight || img.height) * scale));
      const dx = still.mode === "full" ? (w - dw) / 2 : w - dw - pad;
      const dy = still.mode === "full" ? (h - dh) / 2 : h - dh - pad;
      ctx.save();
      ctx.globalAlpha = 0.96;
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    }

    if (duration) onProgress?.(clamp01(t / duration));
  };

  const done = new Promise((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Could not encode edited clip."));
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || "video/webm";
      resolve(new Blob(chunks, { type }));
    };
  });

  recorder.start(200);
  video.currentTime = 0;
  const startOffset = Math.max(0, Number(music?.trimIn) || Number(music?.start) || 0);
  try { musicSource?.start(0, startOffset); } catch (_) {}
  await video.play().catch(() => {});

  await new Promise((resolve) => {
    let raf = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resolve();
    };
    const tick = () => {
      if (settled) return;
      if (video.ended || video.paused) {
        drawFrame();
        finish();
        return;
      }
      drawFrame();
      raf = requestAnimationFrame(tick);
    };
    video.onended = finish;
    raf = requestAnimationFrame(tick);
    const ms = ((duration || 30) / playbackRate) * 1000 + 4000;
    setTimeout(finish, ms);
  });

  try {
    video.pause();
  } catch (_) {}
  try { video.removeAttribute("src"); video.load(); } catch (_) {}
  try { musicSource?.stop?.(); } catch (_) {}
  try { await audioCtx?.close?.(); } catch (_) {}
  if (recorder.state !== "inactive") recorder.stop();
  const out = await done;
  revokeTrackedObjectUrls(createdUrls);
  outStream.getTracks().forEach((t) => t.stop());
  capturedMedia?.getTracks?.().forEach((t) => { try { t.stop(); } catch (_) {} });
  mixed.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
  const bakeEndHeap = heapMbNow();
  if (shouldStampHeapJump(bakeStartHeap, bakeEndHeap)) {
    try {
      globalThis.dispatchEvent?.(new CustomEvent("studio-credit-incident", {
        detail: {
          eventType: "heap.jump",
          memMb: bakeEndHeap,
          prevMb: bakeStartHeap,
          scope: "video-editor-bake",
          note: `Video editor bake heap ${bakeStartHeap}→${bakeEndHeap} MB`,
        },
      }));
    } catch (_) { /* stamp is best-effort */ }
  }
  setDesktopPerfScope("");
  onProgress?.(1);
  if (!out.size) throw new Error("Edited clip was empty.");
  return out;
}

/**
 * Mount the editor UI into the share modal host element.
 */
export function mountViewportVideoEditor(host, {
  getPreviewEl,
  getSourceBlob,
  onOutputBlob,
  onStatus,
} = {}) {
  if (!host) return { destroy() {}, getState() { return null; }, bake() { return Promise.resolve(null); } };

  let state = defaultState();
  let sourceBlob = getSourceBlob?.() || null;
  let outputBlob = sourceBlob;
  const undoStack = [];
  const redoStack = [];
  const previewCreated = [];

  host.innerHTML = `
    <section class="vve" aria-label="Clip editor">
      <div class="vve-head">
        <div>
          <p class="vve-eyebrow">Clip editor</p>
          <h3 class="vve-title">Looks apply live</h3>
        </div>
        <div class="vve-head-actions">
          <div class="vve-history" role="group" aria-label="History">
            <button type="button" class="vve-history-btn" data-vve-undo title="Undo (Ctrl/⌘Z)" disabled>Undo</button>
            <button type="button" class="vve-history-btn" data-vve-redo title="Redo (Ctrl/⌘⇧Z)" disabled>Redo</button>
          </div>
          <span class="vve-live" data-vve-live>Live preview</span>
        </div>
      </div>

      <div class="vve-audio" role="group" aria-label="Audio">
        <span class="vve-label">Audio</span>
        <div class="vve-seg">
          <button type="button" class="vve-seg-btn is-active" data-vve-audio="keep">Keep audio</button>
          <button type="button" class="vve-seg-btn" data-vve-audio="hide">Hide audio</button>
        </div>
      </div>

      <div class="vve-block">
        <span class="vve-label">Look</span>
        <div class="vve-chips" data-vve-grades>
          ${Object.entries(GRADES).map(([id, meta]) => `
            <button type="button" class="vve-chip${id === "none" ? " is-active" : ""}" data-vve-grade="${id}">${meta.label}</button>
          `).join("")}
        </div>
      </div>

      <div class="vve-block vve-music" data-vve-music-drop>
        <span class="vve-label">Music</span>
        <p class="vve-music-hint muted small" data-vve-music-hint>Drop an audio file onto the editor to add a second track.</p>
        <audio class="hidden" data-vve-music-el preload="auto"></audio>
      </div>

      <div class="vve-block vve-stills hidden" data-vve-stills-wrap>
        <span class="vve-label">Stills</span>
        <div class="vve-chips" data-vve-stills></div>
      </div>

      <div class="vve-progress hidden" data-vve-progress>
        <div class="vve-progress-bar" data-vve-progress-bar></div>
      </div>
    </section>
  `;

  const preview = () => getPreviewEl?.() || null;

  function syncHistoryUi() {
    const undoBtn = host.querySelector("[data-vve-undo]");
    const redoBtn = host.querySelector("[data-vve-redo]");
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function pushHistory() {
    const snap = cloneEditorState(state);
    const last = undoStack[undoStack.length - 1];
    if (last && statesEqual(last, snap)) return;
    undoStack.push(snap);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack.length = 0;
    syncHistoryUi();
  }

  function restoreSnapshot(snap) {
    if (!snap) return;
    state.keepAudio = !!snap.keepAudio;
    state.grade = snap.grade || "none";
    state.effects = {
      fade: !!snap.effects?.fade,
      vignette: !!snap.effects?.vignette,
      slow: !!snap.effects?.slow,
      title: !!snap.effects?.title,
    };
    state.titleText = String(snap.titleText || "loading Render Studio").slice(0, 80);
    syncUi();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(cloneEditorState(state));
    restoreSnapshot(undoStack.pop());
    syncHistoryUi();
    onStatus?.("Undid clip edit.");
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(cloneEditorState(state));
    restoreSnapshot(redoStack.pop());
    syncHistoryUi();
    onStatus?.("Redid clip edit.");
  }

  function syncPreview() {
    const el = preview();
    if (!el) return;
    el.style.filter = cssFilterForState(state);
    el.muted = !state.keepAudio;
    el.playbackRate = state.effects.slow ? 0.6 : 1;
    el.classList.toggle("vve-preview-vignette", !!state.effects.vignette);
    el.classList.toggle("vve-preview-fade", !!state.effects.fade);
    syncMusicPreview();
    syncStillLayer();
  }

  function syncMusicPreview() {
    const audio = host.querySelector("[data-vve-music-el]");
    const hint = host.querySelector("[data-vve-music-hint]");
    const video = preview();
    if (hint) {
      hint.textContent = state.music?.name
        ? `${state.music.name} · ${Math.round((state.music.volume ?? 0.35) * 100)}% — drop another file to replace.`
        : "Drop an audio file onto the editor to add a second track.";
    }
    if (!audio) return;
    if (!state.music?.url) {
      audio.removeAttribute("src");
      audio.pause?.();
      return;
    }
    if (audio.dataset.src !== state.music.url) {
      audio.src = state.music.url;
      audio.dataset.src = state.music.url;
    }
    audio.volume = clamp01(state.music.volume ?? 0.35);
    if (video && !video.paused && !video.ended) {
      try { audio.currentTime = video.currentTime || 0; } catch (_) {}
      audio.play?.().catch(() => {});
    }
  }

  function syncStillLayer() {
    const wrap = host.querySelector("[data-vve-stills-wrap]");
    const chips = host.querySelector("[data-vve-stills]");
    wrap?.classList.toggle("hidden", !(state.stills || []).length);
    if (chips) {
      chips.innerHTML = (state.stills || []).map((s, i) => (
        `<button type="button" class="vve-chip" data-vve-still-remove="${i}" title="Remove still">${escapeChip(s.name || "Still")} ×</button>`
      )).join("");
    }
    const layer = preview()?.closest("[data-video-preview-wrap]")?.querySelector("[data-video-stills]");
    if (!layer) return;
    layer.innerHTML = (state.stills || []).map((s) => (
      `<img src="${escapeChip(s.url || "")}" alt="" class="video-editor-still" />`
    )).join("");
  }

  function escapeChip(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function syncUi() {
    host.querySelectorAll("[data-vve-audio]").forEach((btn) => {
      const keep = btn.dataset.vveAudio === "keep";
      btn.classList.toggle("is-active", keep ? state.keepAudio : !state.keepAudio);
    });
    host.querySelectorAll("[data-vve-grade]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.vveGrade === state.grade);
    });
    syncPreview();
    syncHistoryUi();
  }

  function setOutput(blob) {
    outputBlob = blob;
    onOutputBlob?.(blob);
  }

  function applyPlan(plan, { recordHistory = true } = {}) {
    if (recordHistory) pushHistory();
    if (plan.keepAudio != null) state.keepAudio = !!plan.keepAudio;
    if (plan.grade) state.grade = plan.grade === "original" ? "none" : plan.grade;
    if (plan.effects) {
      for (const [k, v] of Object.entries(plan.effects)) {
        if (v == null) continue;
        state.effects[k] = !!v;
      }
    }
    if (plan.titleText) state.titleText = plan.titleText;
    if (plan.music === "disable") clearMusic();
    syncUi();
    if (plan.music === "enable" && !state.music) {
      onStatus?.("Drop an audio file onto the editor to add music.");
    } else if (plan.summary?.length) {
      onStatus?.(`Applied: ${plan.summary.join(" · ")}`);
    }
  }

  function setMusicFromFile(file) {
    if (!file) return;
    if (state.music?.url) {
      try { URL.revokeObjectURL(state.music.url); } catch (_) {}
    }
    state.music = {
      blob: file,
      url: URL.createObjectURL(file),
      name: String(file.name || "Music").slice(0, 80),
      volume: state.music?.volume ?? 0.35,
    };
    syncUi();
    onStatus?.(`Music: ${state.music.name}`);
  }

  function clearMusic() {
    if (state.music?.url) {
      try { URL.revokeObjectURL(state.music.url); } catch (_) {}
    }
    state.music = null;
    syncUi();
  }

  function addStill({ blob, url, name, mode } = {}) {
    if (!blob && !url) return null;
    const stillUrl = url || URL.createObjectURL(blob);
    const still = {
      id: `still_${Math.random().toString(36).slice(2, 8)}`,
      blob: blob || null,
      url: stillUrl,
      name: String(name || "Still").replace(/\.[^.]+$/, "").slice(0, 48),
      start: 0,
      duration: 3,
      mode: mode === "full" ? "full" : "pip",
    };
    state.stills = [...(state.stills || []), still];
    syncUi();
    onStatus?.(`Added still “${still.name}”`);
    return still;
  }

  function bindPreviewTransport() {
    const el = preview();
    if (!el || el.dataset.vveTransport === "1") return;
    el.dataset.vveTransport = "1";
    el.addEventListener("play", () => syncMusicPreview());
    el.addEventListener("pause", () => host.querySelector("[data-vve-music-el]")?.pause?.());
    el.addEventListener("seeked", () => {
      const audio = host.querySelector("[data-vve-music-el]");
      if (!audio || !state.music) return;
      try { audio.currentTime = el.currentTime || 0; } catch (_) {}
    });
  }

  async function bake() {
    sourceBlob = getSourceBlob?.() || sourceBlob;
    if (!sourceBlob) {
      onStatus?.("Record a clip first.", true);
      return null;
    }
    if (state.baking) return null;
    state.baking = true;
    const progress = host.querySelector("[data-vve-progress]");
    const bar = host.querySelector("[data-vve-progress-bar]");
    progress?.classList.remove("hidden");
    if (bar) bar.style.width = "4%";
    onStatus?.("Preparing clip…");
    try {
      const blob = await renderEditedClip(sourceBlob, state, {
        onProgress: (p) => {
          if (bar) bar.style.width = `${Math.round(clamp01(p) * 100)}%`;
        },
      });
      setOutput(blob);
      const el = preview();
      if (el) {
        attachPreviewObjectUrl(el, blob, previewCreated);
        el.style.filter = "none";
        el.classList.remove("vve-preview-vignette", "vve-preview-fade");
        el.muted = !state.keepAudio;
        el.playbackRate = 1;
      }
      pushHistory();
      sourceBlob = blob;
      state.grade = "none";
      state.effects = { fade: false, vignette: false, slow: false, title: false };
      if (state.music?.url) {
        try { URL.revokeObjectURL(state.music.url); } catch (_) {}
      }
      state.music = null;
      for (const still of state.stills || []) {
        if (still.url && still.blob) {
          try { URL.revokeObjectURL(still.url); } catch (_) {}
        }
      }
      state.stills = [];
      if (!state.keepAudio) state.keepAudio = true;
      syncUi();
      onStatus?.("Clip ready.");
      return blob;
    } catch (err) {
      onStatus?.(err?.message || "Could not apply edit.", true);
      return null;
    } finally {
      state.baking = false;
      progress?.classList.add("hidden");
    }
  }

  host.addEventListener("click", (e) => {
    if (e.target.closest("[data-vve-undo]")) {
      undo();
      return;
    }
    if (e.target.closest("[data-vve-redo]")) {
      redo();
      return;
    }
    const removeStill = e.target.closest("[data-vve-still-remove]");
    if (removeStill) {
      const idx = Number(removeStill.dataset.vveStillRemove);
      const copy = [...(state.stills || [])];
      const [gone] = copy.splice(idx, 1);
      if (gone?.url && gone.blob) {
        try { URL.revokeObjectURL(gone.url); } catch (_) {}
      }
      state.stills = copy;
      syncUi();
      return;
    }
    const audioBtn = e.target.closest("[data-vve-audio]");
    if (audioBtn) {
      const next = audioBtn.dataset.vveAudio === "keep";
      if (next === state.keepAudio) return;
      pushHistory();
      state.keepAudio = next;
      syncUi();
      onStatus?.(state.keepAudio ? "Audio on." : "Audio hidden.");
      return;
    }
    const gradeBtn = e.target.closest("[data-vve-grade]");
    if (gradeBtn) {
      const next = gradeBtn.dataset.vveGrade || "none";
      if (next === state.grade) return;
      pushHistory();
      state.grade = next;
      syncUi();
      const label = GRADES[next]?.label || "Original";
      onStatus?.(`${label} look applied.`);
    }
  });

  host.addEventListener("dragover", (e) => {
    const files = [...(e.dataTransfer?.items || [])];
    if (!files.some((item) => String(item.type || "").startsWith("audio/") || String(item.type || "").startsWith("image/"))) return;
    e.preventDefault();
    host.classList.add("is-drop-target");
  });
  host.addEventListener("dragleave", (e) => {
    if (!host.contains(e.relatedTarget)) host.classList.remove("is-drop-target");
  });
  host.addEventListener("drop", (e) => {
    host.classList.remove("is-drop-target");
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    for (const file of files) {
      if ((file.type || "").startsWith("audio/")) setMusicFromFile(file);
      else if ((file.type || "").startsWith("image/")) addStill({ blob: file, name: file.name });
    }
  });

  let titleDebounce = 0;

  function onKeyDown(e) {
    if (host.closest(".hidden")) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const target = e.target;
    if (target instanceof HTMLTextAreaElement) return;
    const key = String(e.key || "").toLowerCase();
    if (key === "z" && e.shiftKey) {
      e.preventDefault();
      redo();
      return;
    }
    if (key === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (key === "y") {
      e.preventDefault();
      redo();
    }
  }
  document.addEventListener("keydown", onKeyDown);

  bindPreviewTransport();
  syncUi();

  return {
    setSource(blob) {
      revokeTrackedObjectUrls(previewCreated);
      if (state.music?.url) {
        try { URL.revokeObjectURL(state.music.url); } catch (_) {}
      }
      for (const still of state.stills || []) {
        if (still.url && still.blob) {
          try { URL.revokeObjectURL(still.url); } catch (_) {}
        }
      }
      sourceBlob = blob;
      outputBlob = blob;
      state = defaultState();
      undoStack.length = 0;
      redoStack.length = 0;
      bindPreviewTransport();
      syncUi();
    },
    getState: () => ({
      ...state,
      effects: { ...state.effects },
      stills: [...(state.stills || [])],
      music: state.music ? { name: state.music.name, volume: state.music.volume } : null,
    }),
    getOutputBlob: () => outputBlob,
    needsBake() {
      return stateNeedsBake(state);
    },
    async ensureBaked() {
      if (!this.needsBake()) return outputBlob || sourceBlob;
      return bake();
    },
    bake,
    undo,
    redo,
    applyPlan,
    setMusicFromFile,
    clearMusic,
    addStill,
    destroy() {
      document.removeEventListener("keydown", onKeyDown);
      clearTimeout(titleDebounce);
      revokeTrackedObjectUrls(previewCreated);
      clearMusic();
      for (const still of state.stills || []) {
        if (still.url && still.blob) {
          try { URL.revokeObjectURL(still.url); } catch (_) {}
        }
      }
      host.innerHTML = "";
    },
  };
}
