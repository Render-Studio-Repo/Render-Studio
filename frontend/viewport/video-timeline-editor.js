/**
 * Simple video timeline under the VID tab player.
 * Drag-drop clips, reorder, trim in/out, cut/fade/dissolve, AI film-edit prompt.
 */

import {
  waveformBarsHtml,
  amplitudePeaksFromSamples,
  placeholderAmplitudePeaks,
  decodeAudioAmplitudePeaks,
} from "./share-video-waveform.js?v=clipperf1";
import { setDesktopPerfScope, heapMbNow, shouldStampHeapJump } from "../xr/debugger-session.js?v=deskdbg1&leakobs1";
import { attachPreviewObjectUrl, revokeTrackedObjectUrls } from "./viewport-video-editor.js?v=leakfix4";

export function uid(prefix = "clip") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function reorderClips(clips, fromIndex, toIndex) {
  const copy = Array.isArray(clips) ? clips.slice() : [];
  const from = Number(fromIndex);
  const to = Number(toIndex);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return copy;
  if (from < 0 || to < 0 || from >= copy.length || to >= copy.length) return copy;
  if (from === to) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

const SUB_KEY_ORDER = ["chatgpt:subscription", "cursor:subscription", "claude:subscription"];

/** Keep the actually selected key; only default to a subscription when none is picked. */
export function defaultVideoAiKeyValue(options = [], selected = "") {
  const values = (Array.isArray(options) ? options : [])
    .map((opt) => (typeof opt === "string" ? opt : opt?.value))
    .filter(Boolean);
  if (selected && values.includes(selected)) return selected;
  for (const key of SUB_KEY_ORDER) {
    if (values.includes(key)) return key;
  }
  return values[0] || "";
}

export function keyFieldsFromPickerValue(value) {
  const raw = String(value || "").trim();
  if (!raw || !raw.includes(":")) return {};
  const [source, ...rest] = raw.split(":");
  const keyId = rest.join(":");
  if (!source || !keyId) return {};
  if (source === "chatgpt" || source === "subscription") {
    return { ai_key_source: "chatgpt" };
  }
  if (source === "cursor" || source === "claude") {
    return { ai_key_source: source };
  }
  return { ai_key_id: keyId, ai_key_source: source };
}

const SPOTIFY_URL_RE = /https?:\/\/(?:open\.)?spotify\.(?:com|link)\/[^\s]+/gi;

export function extractSpotifyMusicUrls(text = "") {
  return String(text || "").match(SPOTIFY_URL_RE) || [];
}

export function filmEditHasSpotifyUrl(text = "") {
  return extractSpotifyMusicUrls(text).length > 0;
}

/** Prompt used for local film-edit planning — Spotify links stay on the request, not the plan. */
export function filmEditPromptForGenerate(text = "") {
  return String(text || "").replace(SPOTIFY_URL_RE, " ").replace(/\s+/g, " ").trim();
}

export function filmKeyPillLabel(value = "") {
  const raw = String(value || "").trim();
  if (raw.startsWith("cursor:")) return "Cursor subscription";
  if (raw.startsWith("claude:")) return "Claude subscription";
  if (raw.startsWith("personal:")) return "API key";
  if (raw.startsWith("team:")) return "Shared key";
  if (raw.startsWith("platform:")) return "Render key";
  return "ChatGPT subscription";
}

export function filmModelPillLabel(model = "", provider = "") {
  const raw = String(model || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("astra-pro")) return "GPT-6 Astra Pro";
  if (lower.includes("astra")) return "GPT-6 Astra";
  if (lower.includes("5.6-sol") || lower.includes("gpt-5.6-sol")) return "GPT-5.6 Sol";
  if (lower.includes("5.6-terra")) return "GPT-5.6 Terra";
  if (lower.includes("5.6-luna")) return "GPT-5.6 Luna";
  if (lower.includes("fable-5-1") || lower.includes("fable 5.1")) return "Fable 5.1";
  if (lower.includes("fable")) return "Fable 5";
  if (lower.startsWith("gpt-")) return raw.replace(/^gpt-/i, "GPT-").replace(/-/g, " ");
  if (lower.startsWith("claude-")) return raw.replace(/^claude-/i, "").replace(/-/g, " ");
  if (provider) return raw;
  return raw;
}

export function resolveFilmKeyDisplay(state = {}, fields = {}, selected = "") {
  const value = String(selected || state.selected || "").trim();
  const options = Array.isArray(state.options) ? state.options : [];
  const opt = options.find((o) => (o.value || o) === value);
  const keyName = opt?.label || filmKeyPillLabel(value);
  const model = String(fields.model || "").trim();
  const modelLabel = filmModelPillLabel(model, fields.provider) || "";
  return { value, keyName, model, modelLabel, provider: String(fields.provider || "") };
}

export function isVideoGenerationKind(gen = {}) {
  const kind = String(gen?.kind || "").toLowerCase();
  return kind === "video" || kind === "film_edit" || kind === "film-edit" || kind === "video_edit";
}

export function videoJobFromGeneration(gen = {}, traceId = "") {
  const jobs = [
    ...(Array.isArray(gen?.running_jobs) ? gen.running_jobs : []),
    ...(Array.isArray(gen?.jobs) ? gen.jobs : []),
    gen,
  ];
  if (traceId) return jobs.find((job) => job && isVideoGenerationKind(job) && String(job.trace_id || job.id || "") === String(traceId)) || null;
  return jobs.find((job) => job && isVideoGenerationKind(job) && String(job.status || "") === "running")
    || [...jobs].reverse().find((job) => job && isVideoGenerationKind(job))
    || null;
}

/** Cache-bust a project file URL so the player picks up a just-written film edit. */
export function filmResultPlaybackUrl(href, { bust = true } = {}) {
  const url = String(href || "").trim();
  if (!url) return "";
  if (!bust) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${Date.now()}`;
}

export function filmJobIsReady(job = {}) {
  const status = String(job?.status || "").toLowerCase();
  if (["running", "pending", "queued", "failed", "canceled"].includes(status)) return false;
  if (status === "complete") return true;
  return !!(job?.url || job?.filename || job?.path);
}

export function localImproveVideoPrompt(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return "";
  const alreadyPro = /\b(dissolve|crossfade|motivated zoom|hold on|pacing|master clip)\b/i.test(text);
  if (alreadyPro && text.length > 80) return text;
  return `${text}. Pro film edit: assemble into one continuous master, use motivated zooms on the subject, dissolve or fade between clips instead of abrupt jumps unless a hard cut is asked, keep pacing tight, hold on key beats, preserve source audio unless muted, export a share-ready clip.`;
}

export function parseFilmEditPrompt(raw = "") {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  const plan = {
    transition: null,
    zoom: null,
    fadeDuration: null,
    assemble: true,
    summary: [],
  };
  if (!text) return plan;

  if (/\b(cross[\s-]?fade|dissolve)\b/.test(lower)) {
    plan.transition = "dissolve";
    plan.summary.push("dissolve");
  } else if (/\b(fade in|transition in|fade between|fade to black)\b/.test(lower)) {
    plan.transition = "fade";
    plan.summary.push("fade");
  } else if (/\b(hard cut|straight cut|cut only)\b/.test(lower)) {
    plan.transition = "cut";
    plan.summary.push("hard cuts");
  } else if (/\btransition/.test(lower) || /\bfades?\b/.test(lower)) {
    plan.transition = "fade";
    plan.summary.push("fade");
  }

  if (/\bzoom[\s-]?out\b/.test(lower)) {
    plan.zoom = "out";
    plan.summary.push("zoom out");
  } else if (/\b(zooms?|ken burns|punch in|push in)\b/.test(lower)) {
    plan.zoom = "in";
    plan.summary.push("zoom in");
  }

  const dur = lower.match(/(?:fade|transition)\s*(?:for|of|=|:)?\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds|ms)?/);
  if (dur) {
    let n = Number(dur[1]);
    if ((dur[2] || "s") === "ms") n /= 1000;
    if (Number.isFinite(n) && n > 0) {
      plan.fadeDuration = Math.min(5, Math.max(0.1, n));
      plan.summary.push(`${plan.fadeDuration}s fades`);
    }
  }
  return plan;
}

/** Chrome WebM often reports Infinity; a 1e10 probe seek can then become a 1e10s ruler. */
export const MAX_CLIP_DURATION_SEC = 60 * 60 * 4;
export const STILL_PREVIEW_MAX_EDGE = 1280;
export const RULER_TICK_MAX = 80;

export function finiteMediaDuration(el) {
  if (!el) return 0;
  const d = Number(el.duration);
  if (Number.isFinite(d) && d > 0 && d <= MAX_CLIP_DURATION_SEC) return d;
  try {
    if (el.seekable && el.seekable.length) {
      const end = Number(el.seekable.end(el.seekable.length - 1));
      if (Number.isFinite(end) && end > 0 && end <= MAX_CLIP_DURATION_SEC) return end;
    }
  } catch (_) { /* seekable not ready */ }
  return 0;
}

/** Adopt only real, bounded lengths. Infinity / 1e10 probe seeks must not become clip.duration. */
export function finiteAdoptDuration(seconds) {
  const d = Number(seconds);
  if (!Number.isFinite(d) || d <= 0.05 || d > MAX_CLIP_DURATION_SEC) return 0;
  return d;
}

/** One metadata probe seek is enough. Repeating it on every durationchange kills Chrome. */
export function shouldSeekUnknownMediaDuration(duration, { tried = false } = {}) {
  if (tried) return false;
  const d = Number(duration);
  if (Number.isFinite(d) && d > 0 && d <= MAX_CLIP_DURATION_SEC) return false;
  return true;
}

export function stillPreviewSize(width, height, maxEdge = STILL_PREVIEW_MAX_EDGE) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const edge = Math.max(64, Number(maxEdge) || STILL_PREVIEW_MAX_EDGE);
  const scale = Math.min(1, edge / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  };
}

/** Pause every other media node so only the playhead preview keeps a decoder hot. */
export function pauseOffscreenEditorMedia(root, keepEl) {
  if (!root || typeof root.querySelectorAll !== "function") return 0;
  let n = 0;
  for (const el of root.querySelectorAll("video, audio")) {
    if (el === keepEl) continue;
    try { el.pause?.(); } catch (_) { /* ignore */ }
    n += 1;
  }
  return n;
}

export function editorPageIsHidden() {
  try {
    return typeof document !== "undefined" && !!document.hidden;
  } catch (_) {
    return false;
  }
}

/** Decoder `load()` on the close click freezes Chrome on large clips. */
export function shouldLoadMediaElementOnDetachTick() {
  return false;
}

/** Timeline `innerHTML` wipe, waveform decode, and blob revoke on the close click. */
export function shouldHeavyTeardownVideoEditorOnCloseTick() {
  return false;
}

/** CAD resize / grid rebuild / file-tree scan on the video-editor close click. */
export function shouldRebuildCadOnVideoEditorCloseTick() {
  return false;
}

/** Yield the close click so the tab strip can switch before leftover GPU/DOM work. */
export function scheduleVideoEditorIdle(fn, afterMs = 0) {
  if (typeof fn !== "function") return 0;
  const run = () => {
    try { fn(); } catch (_) { /* ignore */ }
  };
  const delay = Math.max(0, Number(afterMs) || 0);
  if (delay > 0 && typeof setTimeout === "function") return setTimeout(run, delay);
  if (typeof document !== "undefined" && typeof requestIdleCallback === "function") {
    return requestIdleCallback(run, { timeout: 240 });
  }
  if (typeof document !== "undefined" && typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(() => {
      if (typeof setTimeout === "function") setTimeout(run, 0);
      else run();
    });
  }
  return setTimeout(run, 0);
}

/** Pause and drop src immediately. Defer `load()` so Chrome can release the decoder off the click tick. */
export function pauseAndDetachMedia(el) {
  if (!el) return;
  try { el.pause?.(); } catch (_) { /* ignore */ }
  try { el.removeAttribute?.("src"); } catch (_) { /* ignore */ }
  try {
    if ("srcObject" in el && el.srcObject) el.srcObject = null;
  } catch (_) { /* ignore */ }
  try {
    if ("src" in el) el.src = "";
  } catch (_) { /* ignore */ }
  try { el.removeAttribute?.("poster"); } catch (_) { /* ignore */ }
  const load = () => {
    try { el.load?.(); } catch (_) { /* ignore */ }
  };
  if (shouldLoadMediaElementOnDetachTick()) load();
  else scheduleVideoEditorIdle(load);
}

export function scheduleRevokeObjectURL(url, afterMs = 0) {
  if (!url || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  const href = String(url);
  if (!href.startsWith("blob:")) return;
  const run = () => {
    try { URL.revokeObjectURL(href); } catch (_) { /* ignore */ }
  };
  setTimeout(run, Math.max(0, Number(afterMs) || 0));
}

async function probeDuration(blob) {
  if (!blob) return 0;
  if (mediaKindFromFile(blob) === "image") return STILL_DURATION_SEC;
  const url = URL.createObjectURL(blob);
  const el = document.createElement(mediaKindFromFile(blob) === "audio" ? "audio" : "video");
  try {
    el.preload = "metadata";
    el.src = url;
    await new Promise((resolve) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => resolve();
      setTimeout(resolve, 2500);
    });
    let d = finiteMediaDuration(el);
    if (!(d > 0) && shouldSeekUnknownMediaDuration(el.duration, { tried: false })) {
      // Chrome WebM/MediaRecorder often reports Infinity until a single probe seek.
      await new Promise((resolve) => {
        const done = () => resolve();
        el.ontimeupdate = done;
        el.onseeked = done;
        el.ondurationchange = done;
        try { el.currentTime = 1e10; } catch (_) { done(); }
        setTimeout(done, 2500);
      });
      d = finiteMediaDuration(el);
    }
    return d > 0 ? d : 0;
  } finally {
    pauseAndDetachMedia(el);
    scheduleRevokeObjectURL(url);
  }
}

export function clipSourceDuration(clip) {
  const d = Number(clip?.duration);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export function clipEffectiveDuration(clip) {
  const full = Math.max(0.1, clipSourceDuration(clip) || 1);
  const tin = Math.max(0, Number(clip?.trimIn) || 0);
  const tout = clip?.trimOut != null && Number.isFinite(Number(clip.trimOut))
    ? Math.min(full, Number(clip.trimOut))
    : full;
  return Math.max(0.1, tout - tin);
}

export function clipTrimStatsText(clip) {
  const used = clipEffectiveDuration(clip);
  const full = clipSourceDuration(clip);
  if (!(full > 0)) return `${used.toFixed(2)}s used`;
  return `${used.toFixed(2)}s used of ${full.toFixed(2)}s`;
}

/** Project ruler length: full song and/or video, never a 4s cap when media is longer. */
export function timelineSpanSec(clips = [], music = null, { emptyMin = 4 } = {}) {
  const video = (Array.isArray(clips) ? clips : []).reduce((sum, c) => sum + clipEffectiveDuration(c), 0);
  const audio = music ? clipEffectiveDuration(music) : 0;
  const span = Math.max(video, audio);
  return span > 0.05 ? span : emptyMin;
}

/** iMovie-style edge trim. `nextSec` is the absolute in or out time on the source. */
export function applyEdgeTrim(target, edge, nextSec, { minLen = 0.1 } = {}) {
  if (!target || typeof target !== "object") return target;
  const full = Math.max(minLen, clipSourceDuration(target) || 1);
  const tin = Math.max(0, Number(target.trimIn) || 0);
  const tout = target.trimOut != null && Number.isFinite(Number(target.trimOut))
    ? Math.min(full, Number(target.trimOut))
    : full;
  if (edge === "in") {
    target.trimIn = Math.max(0, Math.min(tout - minLen, Number(nextSec) || 0));
  } else {
    const next = Math.min(full, Math.max(tin + minLen, Number(nextSec) || 0));
    target.trimOut = next >= full - 1e-4 ? null : next;
  }
  return target;
}

export const CLIP_SPLIT_SHORTCUT = "S";
export const CLIP_TRIM_SHORTCUT = "T";
export const CLIP_MUTE_SHORTCUT = "M";
export const CLIP_COPY_SHORTCUT = "⌘C";
export const CLIP_PASTE_SHORTCUT = "⌘V";
export const TIMELINE_UNDO_LIMIT = 80;

/** Inclusive clip ids between two nodes on the video row (timeline order). */
export function clipRangeIds(clips, fromId, toId) {
  const ids = (Array.isArray(clips) ? clips : []).map((c) => String(c?.id || "")).filter(Boolean);
  const a = ids.indexOf(String(fromId || ""));
  const b = ids.indexOf(String(toId || ""));
  if (a < 0 && b < 0) return [];
  if (a < 0) return b >= 0 ? [ids[b]] : [];
  if (b < 0) return [ids[a]];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return ids.slice(lo, hi + 1);
}

export function rectsIntersect(a, b) {
  const al = Number(a?.left) || 0;
  const at = Number(a?.top) || 0;
  const ar = Number(a?.right ?? (al + (Number(a?.width) || 0)));
  const abtm = Number(a?.bottom ?? (at + (Number(a?.height) || 0)));
  const bl = Number(b?.left) || 0;
  const bt = Number(b?.top) || 0;
  const br = Number(b?.right ?? (bl + (Number(b?.width) || 0)));
  const bbtm = Number(b?.bottom ?? (bt + (Number(b?.height) || 0)));
  return al < br && ar > bl && at < bbtm && abtm > bt;
}

export function normalizeMarqueeRect(from, to) {
  const x1 = Number(from?.x ?? from?.left) || 0;
  const y1 = Number(from?.y ?? from?.top) || 0;
  const x2 = Number(to?.x ?? to?.left) || 0;
  const y2 = Number(to?.y ?? to?.top) || 0;
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const right = Math.max(x1, x2);
  const bottom = Math.max(y1, y2);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function clipIdsIntersectingMarquee(clipRects, marquee) {
  return (Array.isArray(clipRects) ? clipRects : [])
    .filter((c) => c?.id && rectsIntersect(c, marquee))
    .map((c) => c.id);
}

export function isEditorPageZoomKey(e) {
  if (!e || !(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const key = String(e.key || "");
  const code = String(e.code || "");
  return key === "+" || key === "=" || key === "-" || key === "_" || key === "0"
    || code === "Equal" || code === "Minus" || code === "Digit0"
    || code === "NumpadAdd" || code === "NumpadSubtract" || code === "Numpad0";
}

export function isEditorPageZoomWheel(e) {
  return !!(e && (e.ctrlKey || e.metaKey));
}

export function isEditorUndoKey(e) {
  const key = String(e?.key || "").toLowerCase();
  return !!(e && (e.metaKey || e.ctrlKey) && !e.altKey && key === "z" && !e.shiftKey);
}

export function isEditorRedoKey(e) {
  const key = String(e?.key || "").toLowerCase();
  return !!(e && (e.metaKey || e.ctrlKey) && !e.altKey && ((key === "z" && e.shiftKey) || key === "y"));
}

export function isEditorCopyKey(e) {
  const key = String(e?.key || "").toLowerCase();
  return !!(e && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (key === "c" || e.code === "KeyC"));
}

export function isEditorPasteKey(e) {
  const key = String(e?.key || "").toLowerCase();
  return !!(e && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (key === "v" || e.code === "KeyV"));
}

export function snapshotTimelineState(state = {}) {
  return {
    clips: (state.clips || []).map((c) => ({ ...c })),
    music: state.music ? { ...state.music } : null,
    selectedIds: [...(state.selectedIds || [])],
    selectedId: state.selectedId || null,
    selectedAudio: !!state.selectedAudio,
    playheadSec: Number(state.playheadSec) || 0,
    transitionMode: state.transitionMode || "cut",
    fadeDuration: state.fadeDuration ?? 0.6,
    zoomMode: state.zoomMode || "none",
  };
}
export const CLIP_DOWNLOAD_FORMATS = ["mp4", "webm", "gif"];
export const TIMELINE_CLIP_LOADING_STATUS = "Loading clip onto timeline…";
export const TIMELINE_LOADING_MAX_MS = 1500;

export function clipNeedsTimelineSpinner(clip) {
  return !!(clip && clip.pending);
}

export function previewPlayerHasSrc(preview) {
  return !!(preview && (preview.currentSrc || preview.getAttribute?.("src") || preview.src));
}

export function mediaSeekIsAtTarget(currentTime, targetTime, { ended = false } = {}) {
  if (ended) return false;
  return Math.abs((Number(currentTime) || 0) - Math.max(0, Number(targetTime) || 0)) < 0.04;
}

export function timelineLoadingShouldHide({
  clipExists = false,
  previewHasSrc = false,
  previewError = false,
  elapsedMs = 0,
} = {}) {
  if (previewError) return true;
  if (clipExists && previewHasSrc) return true;
  return Number(elapsedMs) >= TIMELINE_LOADING_MAX_MS;
}

export function projectMediaPlaybackUrl(projectId, filename) {
  const pid = String(projectId || "").trim();
  const path = normalizeVideoEditorSourcePath(filename);
  if (!pid || !path) return "";
  return `/api/projects/${encodeURIComponent(pid)}/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function shouldShowVideoLaneEmpty(clips, { hydrating = false } = {}) {
  if (hydrating) return false;
  return !(Array.isArray(clips) && clips.length);
}

/** Space: pause while playing; restart only when the playhead is at the end; otherwise play from the playhead.
 * A stale media `ended` flag after a backward scrub must not force restart or no-op. */
export function playheadPlaybackIntent(playheadSec, spanSec, { playing = false, ended = false, slop = 0.08 } = {}) {
  if (playing && !ended) return "pause";
  const t = Number(playheadSec) || 0;
  const span = Number(spanSec) || 0;
  const atEnd = span > 0.05 && t >= span - slop;
  if (atEnd) return "restart";
  return "play";
}

/** Timeline / loop in-point for Restart. Clip trim-in is applied by seekTimelineTo(0). */
export function previewLoopRestartSec() {
  return 0;
}

const MOTION_LOOP_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8 2.4a5.6 5.6 0 1 1-5 2.6l1.15.7A4.25 4.25 0 1 0 8 3.75V5.6L11.2 3 8 .4Z"/></svg>`;
const RESTART_LOOP_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M2.6 2.4h1.5v11.2H2.6Zm2.9 5.6 8 4.7V3.3Z"/></svg>`;

export function previewPlaybackChromeMarkup() {
  return `<div class="video-editor-preview-chrome" data-video-preview-chrome>
      <button type="button" class="video-editor-chrome-circle is-on" data-video-motion title="Motion" aria-label="Motion" aria-pressed="true">${MOTION_LOOP_ICON}</button>
      <button type="button" class="video-editor-chrome-circle" data-video-restart-loop title="Restart loop" aria-label="To start">${RESTART_LOOP_ICON}</button>
    </div>`;
}

export function trimEdgeForPlayhead(playheadSec, startAbs, duration) {
  const rel = (Number(playheadSec) || 0) - (Number(startAbs) || 0);
  const dur = Math.max(0.1, Number(duration) || 0);
  if (rel <= 0.04 || rel >= dur - 0.04) return null;
  return rel < dur / 2 ? "in" : "out";
}

export const SHORTEN_AUDIO_TO_CLIP_LABEL = "Shorten auto length to clip";
export const TRIM_AUDIO_LABEL = "Trim audio";
export const AUDIO_TRIM_UPDATE_LABEL = "Update";
export const AUDIO_TRIM_DONE_LABEL = "Trim length";
export const AUDIO_TRIM_DONE_TITLE = "Set the song start, then cut the audio to the video length.";

/** Keep ruler labels from stacking when the timeline is zoomed out. */
export function rulerTickStepSec(pxPerSec, spanSec) {
  const minPx = 48;
  const px = Math.max(0.01, Number(pxPerSec) || 1);
  const span = Math.max(0.1, Math.min(MAX_CLIP_DURATION_SEC, Number(spanSec) || 1));
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const s of candidates) {
    if (s * px >= minPx && span / s <= RULER_TICK_MAX) return s;
  }
  return Math.max(600, Math.ceil(span / RULER_TICK_MAX), Math.ceil(minPx / px));
}

export function audioTrimBounds(track) {
  const full = Math.max(0.1, clipSourceDuration(track) || clipEffectiveDuration(track) || 1);
  const tin = Math.max(0, Math.min(full - 0.08, Number(track?.trimIn) || 0));
  const toutRaw = track?.trimOut != null && Number.isFinite(Number(track.trimOut))
    ? Number(track.trimOut)
    : full;
  const tout = Math.max(tin + 0.08, Math.min(full, toutRaw));
  return { full, tin, tout };
}

export function audioTrimTimeFromClientX(clientX, rect, fullSec) {
  const w = Math.max(1, Number(rect?.width) || 1);
  const left = Number(rect?.left) || 0;
  const full = Math.max(0.1, Number(fullSec) || 1);
  return Math.max(0, Math.min(full, ((Number(clientX) - left) / w) * full));
}

/** When the source clock reaches Out, restart at In. */
export function audioTrimLoopRestart(sourceSec, bounds) {
  const tin = Number(bounds?.tin) || 0;
  const tout = Math.max(tin + 0.08, Number(bounds?.tout) || tin + 0.08);
  const t = Number(sourceSec) || 0;
  if (t >= tout - 0.04) return tin;
  if (t < tin) return tin;
  return t;
}

/** Slide the In/Out window along the source without changing its length. */
export function slideAudioTrimWindow(track, deltaSec, { minLen = 0.08 } = {}) {
  if (!track || typeof track !== "object") return track;
  const { full, tin, tout } = audioTrimBounds(track);
  const len = Math.max(minLen, tout - tin);
  const nextIn = Math.max(0, Math.min(full - len, tin + (Number(deltaSec) || 0)));
  track.trimIn = nextIn;
  const nextOut = nextIn + len;
  track.trimOut = nextOut >= full - 1e-4 ? null : nextOut;
  return track;
}

/** Viewport-fixed menu: flip above the pointer when it would clip the window. */
export function clampMenuPosition({
  pointerX = 0,
  pointerY = 0,
  menuWidth = 196,
  menuHeight = 240,
  viewWidth = 800,
  viewHeight = 600,
  pad = 8,
} = {}) {
  const mw = Math.max(1, Number(menuWidth) || 196);
  const mh = Math.max(1, Number(menuHeight) || 240);
  const vw = Math.max(mw + pad * 2, Number(viewWidth) || 800);
  const vh = Math.max(mh + pad * 2, Number(viewHeight) || 600);
  let left = Number(pointerX) || 0;
  let top = Number(pointerY) || 0;
  if (left + mw > vw - pad) left = Math.max(pad, vw - mw - pad);
  if (left < pad) left = pad;
  if (top + mh > vh - pad) top = (Number(pointerY) || 0) - mh;
  if (top + mh > vh - pad) top = Math.max(pad, vh - mh - pad);
  if (top < pad) top = pad;
  return { left, top, flipped: top + 4 < (Number(pointerY) || 0) };
}

export function videoClipsEndSec(clips = []) {
  return (Array.isArray(clips) ? clips : []).reduce((sum, c) => sum + clipEffectiveDuration(c), 0);
}

/** Trim the audio bed so it ends where the video clips end. */
export function shortenAudioToClipEnd(music, videoEndSec) {
  if (!music || typeof music !== "object") return music;
  const tin = Math.max(0, Number(music.trimIn) || 0);
  const full = Math.max(0.1, clipSourceDuration(music) || 1);
  const want = Math.max(0.1, Number(videoEndSec) || 0);
  const nextOut = Math.min(full, tin + want);
  music.trimOut = nextOut >= full - 1e-4 ? null : nextOut;
  return music;
}

export function followPlayheadScrollLeft(playheadPx, viewWidth, scrollLeft, { padding = 56 } = {}) {
  const view = Math.max(1, Number(viewWidth) || 0);
  const x = Number(playheadPx) || 0;
  const left = Number(scrollLeft) || 0;
  if (x > left + view - padding) return Math.max(0, x - view + padding);
  if (x < left + 8) return Math.max(0, x - 8);
  return left;
}

export function fitTimelinePxPerSec(durationSec, viewWidth, { min = 6, max = 56, pad = 72 } = {}) {
  const dur = Math.max(0.5, Number(durationSec) || 1);
  const view = Math.max(160, Number(viewWidth) || 480);
  return Math.max(min, Math.min(max, (view - pad) / dur));
}

export function editorAudioUploadName(file) {
  const raw = String(file?.name || "audio.mp3");
  const m = raw.match(/\.(mp3|wav|m4a|aac|ogg|opus|flac|aiff?|wma|weba)$/i);
  const ext = m ? m[0].toLowerCase() : ".mp3";
  const stem = prettyAudioLabel(raw).replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").slice(0, 48) || "audio";
  return `${stem}${ext.startsWith(".") ? ext : `.${ext}`}`;
}

export function audioPersistKey(file) {
  if (!file) return "";
  return `${file.name || ""}|${file.size || 0}|${file.lastModified || 0}`;
}

export function editorSessionStorageKey(projectId) {
  return `render3d:video-editor-session:${String(projectId || "").trim() || "none"}`;
}

export function mediaFileBasename(value) {
  return String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
}

export function matchListedMediaFile(files, needle) {
  const list = Array.isArray(files) ? files : [];
  const want = String(needle || "").replace(/\\/g, "/");
  const base = mediaFileBasename(want);
  if (!base && !want) return null;
  return list.find((row) => {
    const fn = String(row?.filename || row?.name || "").replace(/\\/g, "/");
    const name = String(row?.name || "");
    return (want && (fn === want || fn.endsWith(`/${base}`))) || (base && (name === base || mediaFileBasename(fn) === base));
  }) || null;
}

export function musicTrackSnapshot(track) {
  if (!track) return null;
  return {
    filename: String(track.filename || ""),
    name: String(track.name || ""),
    label: String(track.label || ""),
    volume: Math.max(0, Number(track.volume) || 0.35),
    muted: !!track.muted,
    trimIn: Math.max(0, Number(track.trimIn) || 0),
    trimOut: track.trimOut == null ? null : Number(track.trimOut),
    startSec: Math.max(0, Number(track.startSec) || 0),
    persistKey: String(track.persistKey || audioPersistKey(track.blob) || ""),
    duration: Number(track.duration) || 0,
  };
}

export function serializeEditorTimeline({
  clips = [],
  music = null,
  playheadSec = 0,
  transitionMode = "cut",
  zoomMode = "none",
  filmHistory = [],
} = {}) {
  return {
    v: 1,
    playheadSec: Math.max(0, Number(playheadSec) || 0),
    transition: String(transitionMode || "cut"),
    zoom: String(zoomMode || "none"),
    clips: (Array.isArray(clips) ? clips : []).map((clip, i) => ({
      id: clip?.id || "",
      label: String(clip?.label || ""),
      filename: String(clip?.filename || ""),
      name: String(clip?.blob?.name || clip?.name || clip?.label || ""),
      trimIn: Math.max(0, Number(clip?.trimIn) || 0),
      trimOut: clip?.trimOut == null ? null : Number(clip.trimOut),
      muted: !!clip?.muted,
      volume: clipMixVolume(clip),
      source: String(clip?.source || ""),
      order: i,
    })),
    music: musicTrackSnapshot(music),
    filmHistory: slimFilmEditHistory(filmHistory),
  };
}

function timelineMediaKeys(value) {
  const full = String(value || "").replace(/\\/g, "/").trim().toLowerCase();
  const base = mediaFileBasename(full).toLowerCase();
  return new Set([full, base].filter(Boolean));
}

export function hydrateTimelineClips(loadedClips = [], draftClips = []) {
  const loaded = Array.isArray(loadedClips) ? loadedClips : [];
  const draft = (Array.isArray(draftClips) ? draftClips : [])
    .slice()
    .sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0));
  if (!draft.length || !loaded.length) return loaded.slice();
  const useCount = new Map();
  const restored = [];
  for (const snap of draft) {
    const wanted = new Set([
      ...timelineMediaKeys(snap?.filename),
      ...timelineMediaKeys(snap?.name),
    ]);
    const source = loaded.find((clip) => {
      const have = new Set([
        ...timelineMediaKeys(clip?.sourcePath),
        ...timelineMediaKeys(clip?.filename),
        ...timelineMediaKeys(clip?.blob?.name),
      ]);
      return [...wanted].some((key) => have.has(key));
    });
    if (!source) continue;
    const used = useCount.get(source) || 0;
    useCount.set(source, used + 1);
    restored.push({
      ...source,
      id: snap?.id || source.id,
      label: String(snap?.label || source.label || "Clip"),
      source: String(snap?.source || source.source || "upload"),
      trimIn: Math.max(0, Number(snap?.trimIn) || 0),
      trimOut: snap?.trimOut == null ? null : Number(snap.trimOut),
      muted: !!snap?.muted,
      volume: Math.max(0, Math.min(1, Number(snap?.volume ?? source.volume ?? 1))),
      ownedUrl: used === 0 ? source.ownedUrl : false,
    });
  }
  const usedSources = new Set(restored.map((clip) => clip.sourcePath || clip.filename || clip.blob?.name || ""));
  for (const clip of loaded) {
    const key = clip.sourcePath || clip.filename || clip.blob?.name || "";
    if (!usedSources.has(key)) restored.push(clip);
  }
  return restored.length ? restored : loaded.slice();
}

/** Persist film-edit generates (prompt + mix) — blobs stay in-session. */
export function makeFilmEditHistoryEntry({
  id,
  prompt = "",
  at = Date.now(),
  transition = "cut",
  zoom = "none",
  fadeDuration = 0.6,
} = {}) {
  return {
    id: id || uid("film"),
    prompt: String(prompt || ""),
    at: Number(at) || Date.now(),
    transition: String(transition || "cut"),
    zoom: String(zoom || "none"),
    fadeDuration: Number(fadeDuration) || 0.6,
  };
}

export function slimFilmEditHistory(list, { max = 24 } = {}) {
  return (Array.isArray(list) ? list : []).slice(-Math.max(1, Number(max) || 24)).map((row) => ({
    id: row?.id || uid("film"),
    prompt: String(row?.prompt || ""),
    at: Number(row?.at) || Date.now(),
    transition: String(row?.transition || "cut"),
    zoom: String(row?.zoom || "none"),
    fadeDuration: Number(row?.fadeDuration) || 0.6,
  }));
}

export function appendFilmEditHistory(list, entry, { max = 24 } = {}) {
  const next = Array.isArray(list) ? list.slice() : [];
  if (entry) next.push(entry);
  return next.slice(-Math.max(1, Number(max) || 24));
}

export function filmEditHistoryById(list, id) {
  const key = String(id || "");
  return (Array.isArray(list) ? list : []).find((row) => String(row?.id || "") === key) || null;
}

export function applyMusicSnapshotOpts(snap) {
  if (!snap || typeof snap !== "object") return {};
  return {
    filename: snap.filename || "",
    label: snap.label || "",
    volume: snap.volume,
    muted: snap.muted,
    trimIn: snap.trimIn,
    trimOut: snap.trimOut,
    startSec: snap.startSec,
    persistKey: snap.persistKey || "",
    folder: snap.folder || "",
  };
}

export function clipPasteIndex(clips, playheadSec) {
  const list = Array.isArray(clips) ? clips : [];
  if (!list.length) return 0;
  const tHead = Number(playheadSec) || 0;
  if (tHead <= 0.08) return 0;
  let t = 0;
  for (let i = 0; i < list.length; i += 1) {
    const dur = clipEffectiveDuration(list[i]);
    if (tHead < t + dur - 0.02) return i + 1;
    t += dur;
  }
  return list.length;
}

/** Flip a clip or audio-track muted flag. Returns the new muted state. */
export function toggleMutedFlag(target) {
  if (!target || typeof target !== "object") return false;
  target.muted = !target.muted;
  return !!target.muted;
}

/** Preview mixer: dropped audio is attached when a blob/url exists. */
export function musicTrackPlaybackState(track) {
  if (!track || (!track.url && !track.blob)) {
    return { attached: false, muted: false, volume: 0, url: "" };
  }
  const muted = !!track.muted;
  const volume = muted ? 0 : Math.max(0, Number(track.volume) || 0.35);
  return { attached: true, muted, volume, url: String(track.url || "") };
}

/** User Play/Space must not mute the soundtrack unless the clip mute flag is on. */
export function previewMuteShouldBe(clip) {
  return !!clip?.muted;
}

/** V-clip mix level. Mute is a per-clip flag — never implied by A-track music. */
export function clipMixVolume(clip) {
  const v = Number(clip?.volume);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

export function clipPreviewVolume(clip) {
  if (previewMuteShouldBe(clip)) return 0;
  return clipMixVolume(clip);
}

/** Dropping A-track audio must not mute the preview or every V clip. */
export function audioDropShouldMutePreview() {
  return false;
}

/** Preview may use a different blob: URL than the clip node for the same file. */
export function previewShowsTimelineClip(preview, clip) {
  if (!preview || !clip) return false;
  const src = String(preview.currentSrc || preview.getAttribute?.("src") || preview.src || "");
  if (!src || src === "about:blank") return false;
  const clipUrl = String(clip.url || "");
  if (clipUrl && src === clipUrl) return true;
  if (src.startsWith("blob:") && (clip.blob || clipUrl.startsWith("blob:"))) return true;
  const path = String(clip.sourcePath || clip.filename || "");
  const base = path.replace(/^.*\//, "").split("#")[0];
  return !!(base && src.includes(base));
}

/** A-track bed plays on real playback when the track is attached and not muted.
 * Video-clip mute (previewMuted / clipMuted) must not skip the bed. */
export function shouldStartBedAudio({
  attached = false,
  musicMuted = false,
  previewShowsClip = false,
  previewPaused = false,
  autoplayKick = false,
} = {}) {
  if (autoplayKick) return false;
  if (previewPaused || !attached || musicMuted || !previewShowsClip) return false;
  return true;
}

export function clipRangeOnTimeline(clips, clipId) {
  let t = 0;
  for (const c of clips || []) {
    const dur = clipEffectiveDuration(c);
    if (c.id === clipId) return { start: t, end: t + dur, duration: dur };
    t += dur;
  }
  return null;
}

export function playheadHitsClip(clips, clipId, playheadSec, slop = 0.04) {
  const range = clipRangeOnTimeline(clips, clipId);
  if (!range) return false;
  const t = Number(playheadSec) || 0;
  return t > range.start + slop && t < range.end - slop;
}

export function splitClipAtPlayhead(clips, playheadSec, { makeId = uid } = {}) {
  const copy = Array.isArray(clips) ? clips.map((c) => ({ ...c })) : [];
  let t = 0;
  for (let i = 0; i < copy.length; i += 1) {
    const c = copy[i];
    const dur = clipEffectiveDuration(c);
    const start = t;
    const end = t + dur;
    if (playheadSec > start + 0.08 && playheadSec < end - 0.08) {
      const tin = Math.max(0, Number(c.trimIn) || 0);
      const local = tin + (playheadSec - start);
      const left = { ...c, trimOut: local };
      const right = {
        ...c,
        id: typeof makeId === "function" ? makeId("clip") : uid("clip"),
        trimIn: local,
        trimOut: c.trimOut,
        transitionIn: "cut",
      };
      copy.splice(i, 1, left, right);
      return copy;
    }
    t += dur;
  }
  return copy;
}

export function setClipEdgeTransition(clip, edge, mode) {
  if (!clip) return clip;
  const next = ["cut", "fade", "dissolve"].includes(mode) ? mode : "cut";
  if (edge === "end" || edge === "out") clip.transitionOut = next;
  else clip.transitionIn = next;
  return clip;
}

export function clipContextMenuModel({ clip, playheadHits = false, formats = CLIP_DOWNLOAD_FORMATS, kind = "clip" } = {}) {
  const audio = kind === "audio";
  return {
    hasClip: !!clip,
    kind: audio ? "audio" : "clip",
    mute: true,
    muted: !!clip?.muted,
    muteLabel: clip?.muted
      ? (audio ? "Unmute audio" : "Unmute clip")
      : (audio ? "Mute audio" : "Mute clip"),
    remove: true,
    removeLabel: audio ? "Remove audio" : "Remove clip",
    duplicate: !audio && !!clip,
    transitionStart: audio ? [] : ["cut", "fade", "dissolve"],
    transitionEnd: audio ? [] : ["cut", "fade", "dissolve"],
    split: !audio && !!playheadHits,
    splitLabel: `Split clip (${CLIP_SPLIT_SHORTCUT})`,
    copy: true,
    paste: true,
    copyLabel: audio ? "Copy audio" : "Copy",
    pasteLabel: "Paste",
    shortenAudio: true,
    shortenAudioLabel: SHORTEN_AUDIO_TO_CLIP_LABEL,
    trimAudio: true,
    trimAudioLabel: TRIM_AUDIO_LABEL,
    downloadFormats: Array.isArray(formats) && formats.length ? formats : CLIP_DOWNLOAD_FORMATS.slice(),
  };
}

function muteIconSvg(muted) {
  if (muted) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
}

export function muteButtonMarkup({ muted = false, kind = "clip" } = {}) {
  const pressed = muted ? "true" : "false";
  const title = muted
    ? (kind === "audio" ? "Unmute audio track" : "Unmute clip audio")
    : (kind === "audio" ? "Mute audio track" : "Mute clip audio");
  const attr = kind === "audio" ? "audio" : "clip";
  return `<button type="button" class="vtl-mute${muted ? " is-muted" : ""}" data-vtl-mute="${attr}" aria-pressed="${pressed}" title="${escapeHtml(title)}">${muteIconSvg(muted)}</button>`;
}

export function removeButtonMarkup({ kind = "clip" } = {}) {
  const audio = kind === "audio";
  const title = audio ? "Remove audio" : "Remove clip";
  const extra = audio ? " vtl-music-clear" : "";
  const audioAttr = audio ? ' data-vtl-music-clear' : "";
  return `<button type="button" class="vtl-clip-clear${extra}" data-vtl-clear="${audio ? "audio" : "clip"}"${audioAttr} title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">×</button>`;
}

function sourceLabel(source) {
  if (source === "viewport") return "3D";
  if (source === "audio") return "Audio";
  if (source === "still" || source === "image") return "Photo";
  if (source === "upload") return "File";
  return "Clip";
}

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|opus|flac|aiff?|wma|weba|caf)$/i;
const VIDEO_EXT = /\.(webm|mp4|mov|m4v|mkv|avi)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|tiff?)$/i;
const STILL_DURATION_SEC = 3;

/** Strip Safari Music picker suffixes before classifying by extension. */
export function mediaFilenameForKind(file) {
  let name = String(file?.name || file?.label || "");
  name = name.replace(/\.part$/i, "");
  name = name.replace(/\.[0-9a-f]{4,}(?:-[0-9a-f]{4,}){2,}\.?$/i, "");
  return name;
}

/** Classify a dropped File/Blob by MIME, then filename, so empty Safari types still work. */
export function mediaKindFromFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const raw = String(file?.name || file?.label || "");
  const name = mediaFilenameForKind(file);
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  if (AUDIO_EXT.test(name) || AUDIO_EXT.test(raw)) return "audio";
  if (VIDEO_EXT.test(name) || VIDEO_EXT.test(raw)) return "video";
  if (IMAGE_EXT.test(name) || IMAGE_EXT.test(raw)) return "image";
  return "";
}

export function isMediaFileDrag(e) {
  const types = e?.dataTransfer?.types;
  if (types) {
    try {
      if (typeof types.includes === "function" && types.includes("Files")) return true;
      if (typeof types.contains === "function" && types.contains("Files")) return true;
    } catch (_) { /* DOMStringList */ }
    try {
      for (let i = 0; i < types.length; i += 1) {
        if (String(types[i]) === "Files") return true;
      }
    } catch (_) { /* ignore */ }
  }
  const items = e?.dataTransfer?.items;
  if (items?.length) {
    for (let i = 0; i < items.length; i += 1) {
      if (items[i]?.kind === "file") return true;
    }
  }
  return false;
}

export function filesFromDropEvent(e) {
  const dt = e?.dataTransfer;
  const out = [];
  const seen = new Set();
  const push = (file) => {
    if (!file) return;
    const key = `${file.name || ""}|${file.size || 0}|${file.lastModified || 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  const files = dt?.files;
  if (files?.length) {
    for (let i = 0; i < files.length; i += 1) push(files[i]);
  }
  const items = dt?.items;
  if (items?.length) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item?.kind === "file") push(item.getAsFile?.());
    }
  }
  return out;
}

export function dropIsOverAudioLane(e) {
  return !!e?.target?.closest?.("[data-vtl-audio-lane], [data-vtl-music], [data-vtl-music-empty]");
}

/** Strip Safari/temp suffixes like LoveSickness.mp3.c4ea-8399-1941-41f2.part */
export function prettyAudioLabel(name) {
  let s = String(name || "Audio").trim();
  s = s.replace(/\.part$/i, "");
  s = s.replace(/\.[0-9a-f]{4,}(?:-[0-9a-f]{4,}){2,}\.?$/i, "");
  s = s.replace(/\.(mp3|wav|m4a|aac|ogg|opus|flac|aiff?|wma|weba)(?:\.[^.]+)*$/i, "");
  s = s.replace(/\s+/g, " ").trim();
  return s || "Audio";
}

export function isEditorTypingTarget(el) {
  return !!el?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable=''], [data-video-x-caption]");
}

export function isVideoPlaybackShortcutBlockedTarget(el) {
  return !!el?.closest?.([
    "input",
    "textarea",
    "select",
    "button",
    "a[href]",
    "summary",
    "[contenteditable='true']",
    "[contenteditable='']",
    "[role='button']",
    "[role='menuitem']",
    "[role='option']",
    "[data-video-x-caption]",
    "[data-prompt-design-chat]",
    ".project-chat-panel",
    ".render-agent-panel",
  ].join(", "));
}

export function videoPlaybackShortcutIntent({
  key = "",
  code = "",
  repeat = false,
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  editorVisible = false,
  editorSelected = false,
  blockedTarget = false,
} = {}) {
  if (key !== " " && code !== "Space") return null;
  if (repeat || metaKey || ctrlKey || altKey) return null;
  if (!editorVisible || !editorSelected || blockedTarget) return null;
  return "toggle";
}

export function isVideoEditorShortcutSurface(el) {
  return !!el?.closest?.([
    "[data-video-editor-card]",
    ".clip-editor-panel",
    ".clip-editor-workspace",
    ".clip-editor-studio",
    ".video-editor-window",
    "[data-vtl-host]",
    ".vtl-host",
    ".vtl",
  ].join(", "));
}

export function sanitizeVideoEditorProjectName(name, fallback = "Video Editor") {
  const cleaned = String(name || "").replace(/[^\w\s\-_.]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 80);
}

export function defaultVideoEditorProjectName({ prompt = "", label = "", source = "" } = {}) {
  const fromPrompt = String(prompt || "").trim().split(/[\n.!?]/)[0].replace(/\s+/g, " ").trim().slice(0, 48);
  if (fromPrompt.length >= 3) return sanitizeVideoEditorProjectName(fromPrompt, "Video Editor");
  const lab = String(label || "").replace(/\.[^.]+$/, "").trim();
  if (lab && !/^(clip|untitled)$/i.test(lab)) return sanitizeVideoEditorProjectName(lab, "Video Editor");
  if (source === "viewport") return "Viewport clip";
  return "Video Editor";
}

export function videoEditorFolderKey(name = "Video Editor") {
  return `Video Editor/${sanitizeVideoEditorProjectName(name, "Video Editor")}`;
}

export function normalizeVideoEditorSourcePath(path = "") {
  let cleaned = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").split("#")[0].trim();
  cleaned = cleaned.replace(/^api\/projects\/[^/]+\/files\//i, "");
  if (cleaned.startsWith("references/")) cleaned = cleaned.slice("references/".length);
  const parts = cleaned.split("/").filter((p) => p && p !== "." && p !== "..");
  return parts.join("/");
}

export function stripVideoEditorEditedStem(name = "") {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_ ]edited(?:[-_ ]?\d+)?$/i, "")
    .trim();
}

export function videoEditorProjectNameFromSource(filename = "", fallback = "Video Editor") {
  const path = normalizeVideoEditorSourcePath(filename);
  const leaf = path.split("/").pop() || path;
  const stem = stripVideoEditorEditedStem(leaf);
  return sanitizeVideoEditorProjectName(stem, fallback);
}

export function videoEditorProjectNameFromFolder(folder = "") {
  const parts = String(folder || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts[0] && /^video editor$/i.test(parts[0]) && parts[1]) return parts[1];
  return "";
}

export function isVideoEditorFolderKey(folder = "") {
  const top = String(folder || "").replace(/\\/g, "/").split("/").filter(Boolean)[0] || "";
  return /^video editor$/i.test(top);
}

export function videoEditorSourceRefFromPath(path = "", { kind = "" } = {}) {
  const cleaned = normalizeVideoEditorSourcePath(path);
  const name = cleaned.split("/").pop() || cleaned;
  if (!cleaned || !name) return null;
  const suffix = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  let inferred = String(kind || "").toLowerCase();
  if (!["video", "audio", "image"].includes(inferred)) {
    if (/\.(mp3|wav|m4a|aac|ogg|opus|flac|aiff?|wma|weba)$/i.test(suffix)) inferred = "audio";
    else if (/\.(png|jpe?g|webp|gif)$/i.test(suffix)) inferred = "image";
    else inferred = "video";
  }
  return { path: cleaned, name, kind: inferred };
}

/** One V node per path-ref. Refresh/hydrate must reuse, not append. */
export function clipSourceIdentityKey(clip = {}) {
  const path = normalizeVideoEditorSourcePath(
    clip.sourcePath || clip.source_path || clip.filename || clip.path || "",
  );
  return path ? path.toLowerCase() : "";
}

export function findClipBySourceKey(clips, incoming = {}) {
  const key = clipSourceIdentityKey(incoming);
  if (!key) return null;
  return (Array.isArray(clips) ? clips : []).find((c) => clipSourceIdentityKey(c) === key) || null;
}

export function clipsAfterOpenSource(existing, incoming) {
  const list = Array.isArray(existing) ? existing.map((c) => ({ ...c })) : [];
  if (!incoming) return list;
  if (findClipBySourceKey(list, incoming)) return list;
  list.push({ ...incoming });
  return list;
}

export function mergeVideoEditorSourceRefs(...groups) {
  const out = [];
  const seen = new Set();
  for (const group of groups) {
    const rows = Array.isArray(group) ? group : group ? [group] : [];
    for (const row of rows) {
      const ref = typeof row === "string"
        ? videoEditorSourceRefFromPath(row)
        : videoEditorSourceRefFromPath(row?.path || row?.source_path || row?.filename, { kind: row?.kind });
      if (!ref) continue;
      const key = ref.path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

/** Existing project recordings stay as path refs. Only brand-new blobs need a write. */
export function shouldCopyBytesIntoVideoEditorFolder({ kind = "video", sourcePath = "" } = {}) {
  if (normalizeVideoEditorSourcePath(sourcePath)) return false;
  const k = String(kind || "").toLowerCase();
  return k === "audio" || k === "image";
}

export function videoEditorOpenLockKey(entry = {}, { addStill = false } = {}) {
  const path = normalizeVideoEditorSourcePath(entry?.source_path || entry?.filename || entry?.name);
  const pid = String(entry?.projectId || "");
  return `${pid}:${path}:${addStill ? "still" : "open"}`;
}

export function isVideoEditorProjectFolder(entry = {}) {
  if (!entry?.virtual_folder) return false;
  const folder = String(entry.folder || "");
  return /^Video Editor\/.+/i.test(folder);
}

const VTL_NAME_ADJ = ["Amber", "Cedar", "Drift", "Ember", "Frost", "Harbor", "Ivory", "Juniper", "Lumen", "Moss", "North", "Opal", "Pine", "Quartz", "Ridge", "Slate", "Tide", "Vesper"];
const VTL_NAME_NOUN = ["Cut", "Reel", "Take", "Scene", "Roll", "Mix", "Pass", "Cutdown"];

export function randomVideoEditorProjectName(existing = []) {
  const taken = new Set((Array.isArray(existing) ? existing : []).map((n) => String(n || "").toLowerCase()));
  for (let i = 0; i < 28; i += 1) {
    const name = `${VTL_NAME_ADJ[Math.floor(Math.random() * VTL_NAME_ADJ.length)]} ${VTL_NAME_NOUN[Math.floor(Math.random() * VTL_NAME_NOUN.length)]}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
  return `Cut ${100 + Math.floor(Math.random() * 900)}`;
}

export const VIDEO_EDITOR_PROMPT_EXAMPLES = [
  "Make it transition in with a 0.6s fade between clips, then hold on the last beat.",
  "Assemble these takes into one master clip with motivated zooms on the subject and dissolve between cuts.",
  "Hard cuts only — keep pacing tight, punch in on the hero shot, preserve source audio.",
  "Crossfade every clip, slow zoom out on the first take, fade to black at the end.",
  "Ken Burns pan-and-zoom across the stills, 0.8s dissolve between photos, keep the music bed low.",
  "Jump-cut the B-roll, then a 1s dissolve into the product close-up and fade in from black.",
  "Match-cut similar frames, then a 0.4s dissolve into the wide and hold two seconds on the logo.",
  "Cut on action between clips, fade the audio under the last shot, zoom in on the highlight.",
];

export const VIDEO_EDITOR_AGENT_QUESTION = [
  "I'm in the Render Studio video editor (timeline with Cut / Fade / Dissolve, Improve prompt, and Generate).",
  "I want more in-depth example prompts for this editor — transitions, zooms, hard cuts, dissolves, pacing, assembling clips, and audio.",
  "Offer several strong example prompts I can paste into the editor.",
  "Then ask if I want further questions or more examples.",
].join(" ");

/** Next editor example prompt. Never repeats the previous example. */
export function nextVideoEditorPromptExample(last = "", { random = Math.random } = {}) {
  const list = VIDEO_EDITOR_PROMPT_EXAMPLES;
  const prev = String(last || "").trim();
  const pool = list.filter((ex) => ex !== prev);
  const pick = pool.length ? pool : list;
  if (!pick.length) return "";
  const n = Number(typeof random === "function" ? random() : 0);
  const idx = Math.min(pick.length - 1, Math.max(0, Math.floor((Number.isFinite(n) ? n : 0) * pick.length)));
  return pick[idx];
}

export function clipAuthorFromUser(user) {
  if (!user || typeof user !== "object") return null;
  const id = String(user.id || user.by_user_id || "").trim();
  if (!id) return null;
  return {
    id,
    display_name: String(user.display_name || user.by_user_name || user.email || "User").trim() || "User",
    avatar_url: String(user.avatar_url || user.by_avatar_url || "").trim(),
  };
}

/** Split dropped files onto the A track vs V track. */
export function planDroppedMedia(files, { overAudio = false, forceAudio = false } = {}) {
  const audio = [];
  const video = [];
  const image = [];
  for (const file of files || []) {
    const kind = mediaKindFromFile(file);
    if (forceAudio && kind !== "image") {
      audio.push(file);
      continue;
    }
    const resolved = kind || (overAudio ? "audio" : "");
    if (resolved === "audio") audio.push(file);
    else if (resolved === "image") image.push(file);
    else if (resolved === "video") video.push(file);
    else if (overAudio) audio.push(file);
  }
  return { audio, video, image };
}

function allowMediaDrop(e) {
  if (!isMediaFileDrag(e) && !filesFromDropEvent(e).length) return false;
  // Always cancel file dragover so the browser cannot navigate to the file
  // (that looks like an editor refresh and drops the unsaved audio).
  // Do not stopPropagation — WebKit/Chromium empty dataTransfer.files when a
  // capture ancestor stops the actual target's dragover.
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  return true;
}

/**
 * Capture-phase file drop so <video controls> cannot swallow OS files.
 * Returns an unbind function.
 */
export function bindMediaDropTarget(el, { onFiles, onDragState, isActive } = {}) {
  if (!el) return () => {};
  let lastDropAt = 0;
  const active = () => typeof isActive !== "function" || isActive();
  const enterOrOver = (e) => {
    if (!allowMediaDrop(e)) return;
    if (!active()) return;
    onDragState?.(true, e);
  };
  const leave = (e) => {
    if (el.contains?.(e.relatedTarget)) return;
    onDragState?.(false, e);
  };
  const drop = (e) => {
    onDragState?.(false, e);
    const files = filesFromDropEvent(e);
    const isFiles = files.length > 0 || isMediaFileDrag(e);
    if (isFiles) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!active() || !isFiles || !files.length) return;
    const now = Date.now();
    if (now - lastDropAt < 80) return;
    lastDropAt = now;
    onFiles?.(files, e);
  };
  const opts = { capture: true };
  el.addEventListener("dragenter", enterOrOver, opts);
  el.addEventListener("dragover", enterOrOver, opts);
  el.addEventListener("dragleave", leave);
  el.addEventListener("drop", drop, opts);
  el.addEventListener("drop", drop);
  return () => {
    el.removeEventListener("dragenter", enterOrOver, opts);
    el.removeEventListener("dragover", enterOrOver, opts);
    el.removeEventListener("dragleave", leave);
    el.removeEventListener("drop", drop, opts);
    el.removeEventListener("drop", drop);
  };
}

/**
 * @param {HTMLElement} host
 */
export function mountVideoTimelineEditor(host, {
  getPreviewEl,
  getToken,
  getProjectId,
  getAiKeyBodyFields,
  getAiKeyPickerState,
  setAiKeyPickerValue,
  onOpenAiKeyPicker,
  onOutputBlob,
  onStatus,
  onRequestViewportRecord,
  onSendToChat,
  onProjectNameChange,
  initialProjectName = "",
  getCurrentUser,
  getRemoteUsers,
  sendCollab,
  onOpenProfile,
  onClipAuthored,
  onDownloadClip,
  onAskRenderAgent,
  onPersistMedia,
  onCacheMedia,
  onTimelineChange,
  onFilmGenerating,
  getAiKeyDisplay,
  isEditorSelected,
} = {}) {
  if (!host) {
    return {
      destroy() {},
      park() {},
      unpark() {},
      setPrimaryClip() {},
      getOutputBlob() { return null; },
      needsBake() { return false; },
      ensureBaked: async () => null,
    };
  }

  /** @type {Array<object>} */
  let clips = [];
  let selectedId = null;
  /** @type {Set<string>} */
  let selectedIds = new Set();
  let selectedAudio = false;
  /** @type {Array<object>} */
  let undoStack = [];
  /** @type {Array<object>} */
  let redoStack = [];
  let marqueeDrag = null;
  let musicTrack = null;
  let transitionMode = "cut";
  let fadeDuration = 0.6;
  let zoomMode = "none";
  let playheadSec = 0;
  let pxPerSec = 56;
  let draggingClipId = null;
  let trimDrag = null;
  let clipClipboard = null;
  let selectionAnchor = null;
  let ignoreBoardSeek = false;
  let lastPersistedAudioKey = "";
  let timelineEmitTimer = 0;
  /** @type {Array<object>} */
  let filmHistory = [];
  let videoMixVolume = 1;
  let pendingMusicVolume = 0.35;

  function captureTimelineDraft() {
    return serializeEditorTimeline({
      clips,
      music: musicTrack,
      playheadSec,
      transitionMode,
      zoomMode,
      filmHistory,
    });
  }

  function emitTimelineDraft({ immediate = false } = {}) {
    if (typeof onTimelineChange !== "function" || destroyed) return;
    const fire = () => {
      timelineEmitTimer = 0;
      try { onTimelineChange(captureTimelineDraft()); } catch (_) {}
    };
    if (immediate) {
      if (timelineEmitTimer) window.clearTimeout(timelineEmitTimer);
      fire();
      return;
    }
    if (timelineEmitTimer) window.clearTimeout(timelineEmitTimer);
    timelineEmitTimer = window.setTimeout(fire, 220);
  }
  let previewLoopOn = true;
  let loopRestarting = false;
  let followPlayhead = true;
  let applyingFollowScroll = false;
  let audioTrimMode = false;
  let audioTrimSec = 0;
  let audioTrimLooping = false;
  let audioTrimOnTime = null;
  let trimBarDrag = null;
  let lastMenuPoint = { x: 0, y: 0 };
  let savedPxPerSec = 56;
  let zoomRaf = 0;
  let pendingZoom = null;
  let pinchBasePx = 0;
  const ZOOM_STEP = 1.15;
  const PX_PER_SEC_MIN = 6;
  const PX_PER_SEC_MAX = 220;
  let outputBlob = null;
  let timelineHydrating = false;
  let timelineHydrateMsg = TIMELINE_CLIP_LOADING_STATUS;
  let timelineHydrateStartedAt = 0;
  let timelineHydrateTimer = 0;
  let busy = false;
  let improvingForGenerate = false;
  let destroyed = false;
  const filmHistoryPreviewCreated = [];
  let mediaParked = false;
  /** @type {AbortController | null} */
  let generateAbort = null;
  /** @type {AbortController | null} */
  let decodeAbort = null;
  /** @type {HTMLElement | null} */
  let previewPlaybackEl = null;
  /** @type {Record<string, EventListener> | null} */
  let previewPlaybackHandlers = null;
  let localKeyValue = "";
  let projectName = sanitizeVideoEditorProjectName(initialProjectName, "Video Editor");

  host.classList.add("vtl-host");
  setDesktopPerfScope("video-timeline-editor");
  host.setAttribute("data-no-feedback-drop", "1");
  if (!host.hasAttribute("tabindex")) host.setAttribute("tabindex", "0");
  host.innerHTML = `
    <section class="vtl" aria-label="Timeline editor">
      <div class="vtl-audio-trim hidden" data-vtl-audio-trim hidden>
        <div class="vtl-audio-trim-head">
          <strong>Trim audio</strong>
          <span class="muted small" data-vtl-audio-trim-clock>0.0s</span>
          <label class="vtl-trim-field">In <input type="number" min="0" step="0.05" data-vtl-audio-in /></label>
          <label class="vtl-trim-field">Out <input type="number" min="0" step="0.05" data-vtl-audio-out /></label>
          <button type="button" class="vtl-tool" data-vtl-audio-trim-play>Listen</button>
          <button type="button" class="vtl-tool" data-vtl-audio-trim-update>${AUDIO_TRIM_UPDATE_LABEL}</button>
        </div>
        <p class="muted small">Click the bar to skip. Drag the green window or In / Out. Loops until Update.</p>
        <div class="vtl-audio-trim-board" data-vtl-audio-trim-board>
          <div class="vtl-audio-trim-wave" data-vtl-audio-trim-wave aria-hidden="true"></div>
          <div class="vtl-audio-trim-span" data-vtl-audio-trim-span title="Drag to slide the listen range"></div>
          <span class="vtl-audio-trim-playhead" data-vtl-audio-trim-playhead></span>
          <span class="vtl-trim vtl-trim--in" data-vtl-audio-trim-edge="in" title="In"></span>
          <span class="vtl-trim vtl-trim--out" data-vtl-audio-trim-edge="out" title="Out"></span>
        </div>
        <div class="vtl-audio-trim-foot">
          <button type="button" class="vtl-tool vtl-tool--audio-done" data-vtl-audio-trim-done title="${AUDIO_TRIM_DONE_TITLE}">${AUDIO_TRIM_DONE_LABEL}</button>
        </div>
      </div>
      <div class="vtl-toolbar vtl-toolbelt" data-vtl-toolbelt>
        <div class="vtl-history" role="group" aria-label="Undo">
          <button type="button" class="vtl-tool" data-vtl-undo title="Undo (⌘Z)" disabled>Undo</button>
          <button type="button" class="vtl-tool" data-vtl-redo title="Redo (⇧⌘Z)" disabled>Redo</button>
        </div>
        <div class="vtl-tools" role="group" aria-label="Edit">
          <button type="button" class="vtl-tool" data-vtl-tool="split" title="Split at playhead (S)">Split</button>
          <button type="button" class="vtl-tool" data-vtl-tool="trim" title="Trim at playhead (T)">Trim</button>
          <button type="button" class="vtl-tool vtl-tool--add" data-vtl-tool="add" title="Add video, photo, or audio">+</button>
          <input type="file" class="vtl-file-input" data-vtl-file accept="video/*,audio/*,image/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.png,.jpg,.jpeg,.gif,.webp,.webm,.mp4,.mov,.m4v" multiple />
        </div>
        <div class="vtl-trans-wrap" data-vtl-trans-wrap>
          <button type="button" class="vtl-tool" data-vtl-trans-toggle aria-haspopup="true" aria-expanded="false">Transitions ▾</button>
          <div class="vtl-trans-pop hidden" data-vtl-trans-pop hidden role="dialog" aria-label="Transitions">
            <table class="vtl-trans-table">
              <thead><tr><th></th><th>Start</th><th>End</th></tr></thead>
              <tbody>
                <tr>
                  <th>Cut</th>
                  <td><button type="button" data-vtl-trans-apply="start" data-vtl-mode="cut">Apply</button></td>
                  <td><button type="button" data-vtl-trans-apply="end" data-vtl-mode="cut">Apply</button></td>
                </tr>
                <tr>
                  <th>Fade</th>
                  <td><button type="button" data-vtl-trans-apply="start" data-vtl-mode="fade">Apply</button></td>
                  <td><button type="button" data-vtl-trans-apply="end" data-vtl-mode="fade">Apply</button></td>
                </tr>
                <tr>
                  <th>Dissolve</th>
                  <td><button type="button" data-vtl-trans-apply="start" data-vtl-mode="dissolve">Apply</button></td>
                  <td><button type="button" data-vtl-trans-apply="end" data-vtl-mode="dissolve">Apply</button></td>
                </tr>
              </tbody>
            </table>
            <p class="muted small">Default for new cuts</p>
            <div class="vtl-transitions" role="group" aria-label="Default transition">
              <button type="button" class="vtl-chip is-active" data-vtl-transition="cut">Cut</button>
              <button type="button" class="vtl-chip" data-vtl-transition="fade">Fade</button>
              <button type="button" class="vtl-chip" data-vtl-transition="dissolve">Dissolve</button>
            </div>
          </div>
        </div>
        <label class="vtl-mix" title="Video clip soundtrack">Video <input type="range" min="0" max="100" value="100" data-vtl-video-vol aria-label="Video audio" /></label>
        <label class="vtl-mix" title="A-track music">Music <input type="range" min="0" max="100" value="35" data-vtl-music-vol aria-label="Music audio" /></label>
        <p class="muted small vtl-meta" data-vtl-meta>Drop video, photos, or audio</p>
        <div class="vtl-zoom" role="group" aria-label="Timeline zoom">
          <button type="button" class="vtl-tool" data-vtl-zoom="out" title="Zoom timeline out">−</button>
          <input type="range" class="vtl-zoom-slider" min="6" max="220" step="1" value="56" data-vtl-zoom-slider aria-label="Timeline zoom slider" />
          <button type="button" class="vtl-tool" data-vtl-zoom="in" title="Zoom timeline in">+</button>
          <button type="button" class="vtl-tool" data-vtl-zoom="fit" title="Resize to length of the total clips">Fit</button>
        </div>
      </div>
      <div class="vtl-gen-spin hidden" data-vtl-gen-spin hidden role="status">
        <span class="vtl-spin" aria-hidden="true"></span>
        <span>Generating film edit…</span>
        <span class="vtl-gen-model" data-vtl-gen-model hidden></span>
      </div>
      <div class="vtl-board" data-vtl-board>
        <div class="vtl-marquee hidden" data-vtl-marquee hidden></div>
        <div class="vtl-ruler" data-vtl-ruler></div>
        <div class="vtl-lane vtl-lane--video" data-vtl-video-lane>
          <span class="vtl-lane-label">V</span>
          <div class="vtl-clips" data-vtl-timeline></div>
          <div class="vtl-lane-loading hidden" data-vtl-lane-loading hidden>
            <span class="vtl-spin" aria-hidden="true"></span>
            <span data-vtl-lane-loading-msg>${TIMELINE_CLIP_LOADING_STATUS}</span>
          </div>
        </div>
        <div class="vtl-lane vtl-lane--audio" data-vtl-audio-lane>
          <span class="vtl-lane-label">A</span>
          <div class="vtl-music" data-vtl-music>
            <button type="button" class="vtl-music-empty muted small" data-vtl-music-empty data-vtl-tool="add-audio">Drop audio here</button>
            <div class="vtl-music-block hidden" data-vtl-music-block>
              <span data-vtl-music-name>Audio</span>
              <button type="button" class="vtl-music-clear" data-vtl-music-clear title="Remove audio">×</button>
            </div>
          </div>
        </div>
        <div class="vtl-playhead" data-vtl-playhead></div>
      </div>
      <div class="vtl-menu hidden" data-vtl-menu role="menu" hidden></div>
      <div class="vtl-selected hidden" data-vtl-selected>
        <label class="vtl-trim-field">In <input type="number" min="0" step="0.05" data-vtl-in /></label>
        <label class="vtl-trim-field">Out <input type="number" min="0" step="0.05" data-vtl-out /></label>
        <span class="vtl-clip-stats muted small" data-vtl-clip-stats></span>
      </div>
      <div class="vtl-progress hidden" data-vtl-progress><div class="vtl-progress-bar" data-vtl-progress-bar></div></div>
      <p class="muted small vtl-status" data-vtl-status role="status"></p>
      <div class="vtl-prompt" data-vtl-prompt-bar>
        <div class="vtl-prompt-head">
          <span class="vtl-prompt-kicker">AI film edit</span>
          <button type="button" class="vtl-tool" data-vtl-film-history aria-expanded="false">History</button>
          <span class="vtl-prompt-help-wrap">
            <button type="button" class="vtl-prompt-help" data-vtl-prompt-help aria-label="What this prompt does">?</button>
            <div class="vtl-prompt-tip" role="tooltip">
              <strong>What this prompt does</strong>
              <p>Describe how to edit this timeline — fades, dissolves, hard cuts, zooms, pacing, and audio. Generate applies that to your clips. Improve prompt rewrites it as a stronger film-edit brief.</p>
            </div>
          </span>
        </div>
        <div data-vtl-prompt-compose>
        <textarea data-vtl-prompt rows="2" maxlength="800" placeholder="make it transition in — or take these videos and make a single clip with cool video editing and zooms"></textarea>
        <div class="vtl-prompt-actions">
          <label class="vtl-auto-improve"><input type="checkbox" data-vtl-auto-improve checked /> Improve prompt automatically</label>
          <button type="button" class="btn secondary btn-compact vtl-example" data-vtl-example title="Fill a new editor example prompt">Show me a random example</button>
          <button type="button" class="btn secondary btn-compact vtl-ask-agent" data-vtl-ask-agent title="Ask Render Agent for deeper editor prompt examples">Ask Render Agent</button>
          <button type="button" class="btn secondary vtl-improve" data-vtl-improve title="Rewrite this as a stronger video-edit prompt">Improve prompt</button>
          <button type="button" class="btn accent vtl-generate" data-vtl-generate>Generate</button>
          <button type="button" class="prompt-key-pill vtl-gear" data-vtl-gear data-vtl-key-pill aria-haspopup="dialog" aria-expanded="false" title="Select AI key or ChatGPT subscription for film edit">
            <span class="prompt-key-pill-kw">Key</span>
            <span class="prompt-key-pill-name" data-vtl-key-name>ChatGPT subscription</span>
            <span class="prompt-key-pill-model" data-vtl-key-model></span>
            <svg class="prompt-key-pill-arrow" viewBox="0 0 10 6" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M1 1l4 4 4-4" />
            </svg>
          </button>
        </div>
        </div>
        <div class="vtl-film-history-pop hidden" data-vtl-film-history-pop hidden role="region" aria-label="Film-edit history"></div>
      </div>
      <div class="vtl-updates hidden" data-vtl-updates>
        <button type="button" class="vtl-updates-toggle" data-vtl-updates-toggle aria-expanded="false">Updates</button>
        <ol class="vtl-updates-list hidden" data-vtl-updates-list></ol>
      </div>
    </section>
  `;

  let lastPromptExample = "";
  let remoteActivity = [];
  let collabPollTimer = 0;
  let updatesOpen = false;

  function localAuthor() {
    try { return clipAuthorFromUser(getCurrentUser?.()); } catch { return null; }
  }

  function remotePeople() {
    try { return getRemoteUsers?.() || []; } catch { return []; }
  }

  function collabActive() {
    return remotePeople().length > 0;
  }

  function avatarMarkup(person) {
    if (!collabActive() || !person?.id) return "";
    const name = person.display_name || "User";
    const url = person.avatar_url || `/api/users/${encodeURIComponent(person.id)}/avatar`;
    const initial = name.trim().charAt(0).toUpperCase() || "?";
    return `<span class="vtl-clip-avatar" data-vtl-avatar="${escapeHtml(person.id)}" data-vtl-avatar-name="${escapeHtml(name)}" title="${escapeHtml(name)}" role="button" tabindex="0"><img src="${escapeHtml(url)}" alt="" onerror="this.replaceWith(document.createTextNode('${escapeHtml(initial)}'))"></span>`;
  }

  function hideAvatarPop() {
    host.querySelector("[data-vtl-avatar-pop]")?.remove();
  }

  function showAvatarPop(anchor) {
    hideAvatarPop();
    const id = anchor?.dataset?.vtlAvatar;
    const name = anchor?.dataset?.vtlAvatarName || "User";
    if (!id) return;
    const pop = document.createElement("div");
    pop.className = "vtl-avatar-pop";
    pop.dataset.vtlAvatarPop = "";
    pop.innerHTML = `<strong>${escapeHtml(name)}</strong><button type="button" class="vtl-avatar-pop-link" data-vtl-view-profile="${escapeHtml(id)}">View profile</button>`;
    host.appendChild(pop);
    const hostRect = host.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, rect.left - hostRect.left)}px`;
    pop.style.top = `${Math.max(8, rect.bottom - hostRect.top + 6)}px`;
  }

  function renderUpdates() {
    const wrap = host.querySelector("[data-vtl-updates]");
    const list = host.querySelector("[data-vtl-updates-list]");
    const toggle = host.querySelector("[data-vtl-updates-toggle]");
    if (!wrap || !list) return;
    const show = collabActive() && remoteActivity.length > 0;
    wrap.classList.toggle("hidden", !show);
    if (toggle) {
      toggle.textContent = `Updates${remoteActivity.length ? ` · ${remoteActivity.length}` : ""}`;
      toggle.setAttribute("aria-expanded", updatesOpen ? "true" : "false");
    }
    list.classList.toggle("hidden", !updatesOpen);
    list.innerHTML = remoteActivity.slice(0, 20).map((ev) => {
      const who = ev.display_name || "Someone";
      const what = ev.label ? `added ${ev.kind === "audio" ? "audio" : "a clip"} “${ev.label}”` : (ev.summary || "updated the timeline");
      return `<li><span class="vtl-updates-who">${escapeHtml(who)}</span> ${escapeHtml(what)}</li>`;
    }).join("");
  }

  function pushRemoteActivity(msg) {
    if (!msg || msg.user_id && localAuthor()?.id && String(msg.user_id) === localAuthor().id) return;
    const name = msg.display_name || msg.user_name || "Someone";
    remoteActivity = [
      {
        id: `${msg.clip_id || msg.action || "edit"}_${Date.now()}`,
        display_name: name,
        label: msg.label || "",
        kind: msg.kind || "video",
        summary: msg.summary || "",
        at: Date.now(),
      },
      ...remoteActivity,
    ].slice(0, 24);
    renderUpdates();
  }

  function broadcastClip(clip, kind) {
    const author = clip?.addedBy || localAuthor();
    try {
      sendCollab?.({
        type: "video.editor",
        action: "clip.add",
        clip_id: clip?.id || "",
        label: clip?.label || clip?.name || "",
        kind: kind || "video",
      });
    } catch (_) {}
    try { onClipAuthored?.(author, { kind: kind || "video", label: clip?.label || "" }); } catch (_) {}
  }

  let lastCollabActive = false;

  function syncCollabUi() {
    const active = collabActive();
    if (active !== lastCollabActive) {
      lastCollabActive = active;
      renderTimeline();
    }
    renderUpdates();
    if (active && !collabPollTimer) {
      collabPollTimer = window.setInterval(() => {
        if (!collabActive()) {
          stopCollabWatch();
          lastCollabActive = false;
          renderTimeline();
          renderUpdates();
          return;
        }
        renderUpdates();
      }, 3500);
    }
    if (!active) stopCollabWatch();
  }

  function stopCollabWatch() {
    if (collabPollTimer) {
      window.clearInterval(collabPollTimer);
      collabPollTimer = 0;
    }
  }

  function onPresenceChanged() {
    syncCollabUi();
  }

  function onRemoteEditorEvent(ev) {
    const msg = ev?.detail;
    if (!msg) return;
    if (msg.type && msg.type !== "video.editor") return;
    pushRemoteActivity(msg);
  }

  window.addEventListener("render3d:presence-changed", onPresenceChanged);
  window.addEventListener("render3d:video-editor", onRemoteEditorEvent);

  function setLocalStatus(msg, isError = false) {
    const el = host.querySelector("[data-vtl-status]");
    if (el) {
      el.textContent = msg || "";
      el.classList.toggle("is-error", !!isError && !!msg);
    }
    onStatus?.(msg, isError);
  }

  function liveFilmKeyDisplay() {
    const state = getAiKeyPickerState?.() || { options: [], selected: localKeyValue };
    const fields = typeof getAiKeyBodyFields === "function" ? (getAiKeyBodyFields() || {}) : {};
    const extra = typeof getAiKeyDisplay === "function" ? (getAiKeyDisplay() || {}) : {};
    const selected = extra.keyValue || state.selected || localKeyValue || "";
    const resolved = resolveFilmKeyDisplay(state, { ...fields, ...extra }, selected);
    if (extra.keyName) resolved.keyName = extra.keyName;
    if (extra.modelLabel) resolved.modelLabel = extra.modelLabel;
    if (extra.model && !resolved.model) resolved.model = extra.model;
    return resolved;
  }

  function syncKeyDefault() {
    const state = getAiKeyPickerState?.() || { options: [], selected: "" };
    localKeyValue = state.selected
      || defaultVideoAiKeyValue(state.options, state.selected)
      || localKeyValue
      || "chatgpt:subscription";
    if (!state.selected && localKeyValue) {
      try { setAiKeyPickerValue?.(localKeyValue); } catch (_) {}
    }
    syncFilmKeyPill();
  }

  function syncFilmKeyPill() {
    const display = liveFilmKeyDisplay();
    localKeyValue = display.value || localKeyValue;
    const nameEl = host.querySelector("[data-vtl-key-name]");
    const modelEl = host.querySelector("[data-vtl-key-model]");
    if (nameEl) nameEl.textContent = display.keyName || filmKeyPillLabel(display.value);
    if (modelEl) {
      modelEl.textContent = display.modelLabel || "";
      modelEl.hidden = !display.modelLabel;
    }
  }

  function resolveKeyFields() {
    const state = getAiKeyPickerState?.() || { options: [], selected: "" };
    const chosen = state.selected || localKeyValue;
    localKeyValue = chosen || defaultVideoAiKeyValue(state.options, chosen) || "chatgpt:subscription";
    const fromLocal = keyFieldsFromPickerValue(localKeyValue);
    const fromShared = typeof getAiKeyBodyFields === "function" ? (getAiKeyBodyFields() || {}) : {};
    const extra = typeof getAiKeyDisplay === "function" ? (getAiKeyDisplay() || {}) : {};
    const merged = { ...fromShared, ...fromLocal };
    if (extra.model) merged.model = extra.model;
    else if (fromShared.model) merged.model = fromShared.model;
    if (extra.provider) merged.provider = extra.provider;
    if (!merged.ai_key_source && !merged.ai_key_id) merged.ai_key_source = "chatgpt";
    return merged;
  }

  async function clipBytesForGenerate(clip) {
    if (isFormBlob(clip?.blob)) return clip.blob;
    if (isFormBlob(clip?.file)) {
      clip.blob = clip.file;
      return clip.file;
    }
    const href = String(clip?.url || "").trim();
    const fetched = await blobFromHref(href);
    if (fetched) {
      clip.blob = fetched;
      return fetched;
    }
    return null;
  }

  function timelineTotalSec() {
    return clips.reduce((sum, c) => sum + clipEffectiveDuration(c), 0);
  }

  function projectSpanSec() {
    return timelineSpanSec(clips, musicTrack);
  }

  function clipPixelWidth(clip) {
    return Math.max(24, clipEffectiveDuration(clip) * pxPerSec);
  }

  function selected() {
    return clips.find((c) => c.id === selectedId) || clips.find((c) => selectedIds.has(c.id)) || null;
  }

  function selectedClipList() {
    const ids = selectedIds.size ? [...selectedIds] : (selectedId ? [selectedId] : []);
    return clips.filter((c) => ids.includes(c.id));
  }

  function setSelection(ids, primary = null, { audio = false, anchor = null } = {}) {
    selectedAudio = !!audio;
    selectedIds = new Set(audio ? [] : (ids || []).filter(Boolean).map(String));
    selectedId = audio
      ? null
      : (primary && selectedIds.has(String(primary)) ? String(primary) : ([...selectedIds][0] || null));
    if (audio) selectionAnchor = null;
    else if (anchor) selectionAnchor = String(anchor);
    else if (selectedId && !selectionAnchor) selectionAnchor = selectedId;
  }

  function snapshotNow() {
    return snapshotTimelineState({
      clips,
      music: musicTrack,
      selectedIds: [...selectedIds],
      selectedId,
      selectedAudio,
      playheadSec,
      transitionMode,
      fadeDuration,
      zoomMode,
    });
  }

  function applySnapshot(snap) {
    if (!snap) return;
    clips = (snap.clips || []).map((c) => ({ ...c }));
    musicTrack = snap.music ? { ...snap.music } : null;
    setSelection(snap.selectedIds || [], snap.selectedId, { audio: !!snap.selectedAudio });
    playheadSec = Number(snap.playheadSec) || 0;
    transitionMode = snap.transitionMode || "cut";
    fadeDuration = snap.fadeDuration ?? 0.6;
    zoomMode = snap.zoomMode || "none";
    renderTimeline();
    syncTransitionUi();
    attachMusicToPlayback();
    const clip = selected() || clips[0];
    if (clip) previewClip(clip);
  }

  function syncHistoryButtons() {
    const undoBtn = host.querySelector("[data-vtl-undo]");
    const redoBtn = host.querySelector("[data-vtl-redo]");
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function ownedUrlsFromSnap(snap) { // leakfix30
    const urls = [];
    if (!snap) return urls;
    for (const c of snap.clips || []) {
      if (c?.url && c.ownedUrl !== false && String(c.url).startsWith("blob:")) urls.push(c.url);
    }
    if (snap.music?.url && String(snap.music.url).startsWith("blob:")) urls.push(snap.music.url);
    return urls;
  }

  function collectHistoryOwnedUrls() { // leakfix30
    const urls = [];
    for (const snap of undoStack) urls.push(...ownedUrlsFromSnap(snap));
    for (const snap of redoStack) urls.push(...ownedUrlsFromSnap(snap));
    return urls;
  }

  function revokeDroppedTimelineUrls(droppedSnaps) { // leakfix30
    const keep = new Set();
    for (const c of clips) if (c?.url) keep.add(c.url);
    if (musicTrack?.url) keep.add(musicTrack.url);
    for (const snap of undoStack) for (const u of ownedUrlsFromSnap(snap)) keep.add(u);
    for (const snap of redoStack) for (const u of ownedUrlsFromSnap(snap)) keep.add(u);
    const seen = new Set();
    for (const snap of droppedSnaps || []) {
      for (const u of ownedUrlsFromSnap(snap)) {
        if (!u || keep.has(u) || seen.has(u)) continue;
        seen.add(u);
        scheduleRevokeObjectURL(u);
      }
    }
  }

  function pushUndo() {
    undoStack.push(snapshotNow());
    const dropped = [];
    if (undoStack.length > TIMELINE_UNDO_LIMIT) dropped.push(undoStack.shift());
    dropped.push(...redoStack);
    redoStack.length = 0;
    revokeDroppedTimelineUrls(dropped); // leakfix30
    syncHistoryButtons();
  }

  function undoTimeline() {
    if (!undoStack.length) return false;
    redoStack.push(snapshotNow());
    applySnapshot(undoStack.pop());
    syncHistoryButtons();
    setLocalStatus("Undo.");
    emitTimelineDraft();
    return true;
  }

  function redoTimeline() {
    if (!redoStack.length) return false;
    undoStack.push(snapshotNow());
    applySnapshot(redoStack.pop());
    syncHistoryButtons();
    setLocalStatus("Redo.");
    emitTimelineDraft();
    return true;
  }

  function selectedTarget() {
    if (selectedAudio && musicTrack) return musicTrack;
    return selected();
  }

  function adoptMediaDuration(target, seconds) {
    const d = finiteAdoptDuration(seconds);
    if (!target || !d) return false;
    const prev = clipSourceDuration(target);
    if (d <= prev + 0.04) return false;
    target.duration = d;
    return true;
  }

  function isFormBlob(value) {
    return typeof Blob !== "undefined" && value instanceof Blob && Number(value.size) > 0;
  }

  async function blobFromHref(href) {
    const url = String(href || "").trim();
    if (!url) return null;
    try {
      const token = typeof getToken === "function" ? getToken() : null;
      const res = await fetch(url, {
        credentials: "same-origin",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return isFormBlob(blob) ? blob : null;
    } catch (_) {
      return null;
    }
  }

  function appendFormBlob(form, key, value, filename) {
    if (!isFormBlob(value)) return false;
    const name = String(filename || "clip.bin").replace(/[^\w.\-]+/g, "_").slice(0, 180) || "clip.bin";
    form.append(key, value, name);
    return true;
  }

  function clipUploadName(clip, i) {
    const type = String(clip?.blob?.type || "");
    const kind = mediaKindFromFile({ type, name: clip?.label || clip?.blob?.name || "" });
    if (kind === "image" || clip?.source === "still" || clip?.source === "image") {
      let ext = (type.split("/")[1] || "").replace("jpeg", "jpg");
      if (!ext || ext.length > 5) {
        const m = String(clip?.label || clip?.blob?.name || "").match(/\.([a-z0-9]+)$/i);
        ext = m ? m[1].toLowerCase() : "png";
      }
      return `${clip.id || `clip${i}`}.${ext}`;
    }
    const ext = type.includes("mp4") ? "mp4" : "webm";
    return `${clip.id || `clip${i}`}.${ext}`;
  }

  function previewClip(clip) {
    if (destroyed || mediaParked) return;
    const el = getPreviewEl?.();
    if (!el || !clip?.url) return;
    const kind = mediaKindFromFile({ type: clip.blob?.type, name: clip.label || clip.blob?.name || "" });
    const isStill = clip.source === "still" || clip.source === "image" || kind === "image";
    const wrap = el.closest("[data-video-preview-wrap], .ref-viewer-stage-wrap--video, .clip-editor-workspace, .video-editor-window");
    const layer = wrap?.querySelector("[data-video-stills]");
    bindPreviewPlayback(el);
    pauseOffscreenEditorMedia(wrap || host, el);
    if (isStill) {
      if (el.tagName === "VIDEO") pauseAndDetachMedia(el);
      if (layer) {
        void paintStillPreview(layer, clip);
      } else if (el.tagName === "VIDEO") {
        el.poster = clip.url;
      }
      applyPreviewMute(clip);
      return;
    }
    if (layer) layer.innerHTML = "";
    if (el.src !== clip.url) el.src = clip.url;
    const tin = Number(clip.trimIn) || 0;
    try { el.currentTime = tin; } catch (_) {}
    applyPreviewMute(clip);
    attachMusicToPlayback();
  }

  async function paintStillPreview(layer, clip) {
    if (!layer || !clip) return;
    const url = clip.url;
    const blob = clip.blob;
    if (blob && typeof createImageBitmap === "function") {
      try {
        const bmp = await createImageBitmap(blob, {
          resizeWidth: STILL_PREVIEW_MAX_EDGE,
          resizeQuality: "low",
        });
        const canvas = layer.querySelector("canvas") || document.createElement("canvas");
        canvas.className = "video-editor-still video-editor-still--full";
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext("2d", { alpha: true });
        ctx?.drawImage(bmp, 0, 0);
        try { bmp.close?.(); } catch (_) { /* ignore */ }
        if (canvas.parentElement !== layer) {
          layer.innerHTML = "";
          layer.appendChild(canvas);
        }
        return;
      } catch (_) { /* fall through to img */ }
    }
    if (url) layer.innerHTML = `<img src="${escapeHtml(url)}" alt="" class="video-editor-still video-editor-still--full" />`;
  }

  function syncMeta() {
    const meta = host.querySelector("[data-vtl-meta]");
    if (meta) {
      const parts = [];
      if (clips.length) parts.push(`${clips.length} clip${clips.length === 1 ? "" : "s"} · ${timelineTotalSec().toFixed(1)}s`);
      if (musicTrack) {
        const song = clipSourceDuration(musicTrack) || clipEffectiveDuration(musicTrack);
        parts.push(`audio ${song.toFixed(1)}s`);
      }
      if (clips.length || musicTrack) parts.push(transitionMode);
      meta.textContent = parts.length ? parts.join(" · ") : "Drop video, photos, or audio onto the timeline";
    }
  }

  function syncProjectNameButton() {
    const btn = host.querySelector("[data-vtl-project-name]");
    if (btn && btn.tagName === "BUTTON") btn.textContent = projectName;
  }

  function setProjectName(next, { persist = true } = {}) {
    const cleaned = sanitizeVideoEditorProjectName(next, projectName || "Video Editor");
    const prev = projectName;
    projectName = cleaned;
    syncProjectNameButton();
    if (persist && cleaned !== prev) {
      try { onProjectNameChange?.(cleaned, prev); } catch (_) {}
    }
  }

  function beginProjectRename() {
    const btn = host.querySelector("[data-vtl-project-name]");
    const lead = host.querySelector(".vtl-toolbar-lead");
    if (!btn || !lead || btn.tagName !== "BUTTON") return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "vtl-project-name vtl-project-name-input";
    input.value = projectName;
    input.maxLength = 80;
    input.setAttribute("aria-label", "Timeline name");
    btn.replaceWith(input);
    input.focus();
    input.select();
    const finish = (commit) => {
      const next = commit ? sanitizeVideoEditorProjectName(input.value, projectName) : projectName;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vtl-project-name";
      button.dataset.vtlProjectName = "";
      button.title = "Click to rename";
      button.textContent = next;
      input.replaceWith(button);
      if (commit) setProjectName(next);
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        ev.preventDefault();
        finish(true);
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  function syncMusic() {
    const el = host.querySelector("[data-vtl-music]");
    if (!el) return;
    if (!musicTrack) {
      el.innerHTML = `<button type="button" class="vtl-music-empty muted small" data-vtl-music-empty data-vtl-tool="add-audio">Drop audio here</button>`;
      el.style.minWidth = "";
      return;
    }
    const dur = clipEffectiveDuration(musicTrack);
    const w = Math.max(24, dur * pxPerSec);
    const span = projectSpanSec();
    const label = prettyAudioLabel(musicTrack.label || musicTrack.name);
    const selectedClass = selectedAudio ? " is-selected" : "";
    const startPx = Math.max(0, (Number(musicTrack.startSec) || 0) * pxPerSec);
    el.style.minWidth = `${Math.max(w + 40 + startPx, 36 + span * pxPerSec + 40)}px`;
    el.innerHTML = `
      <div class="vtl-music-block${selectedClass}" data-vtl-music-block style="width:${w}px;margin-left:${startPx}px" title="${escapeHtml(label)} · ${dur.toFixed(1)}s">
        <span class="vtl-trim vtl-trim--in" data-vtl-trim="in" data-vtl-trim-target="audio"></span>
        ${avatarMarkup(musicTrack.addedBy)}
        <span class="vtl-music-wave" aria-hidden="true"></span>
        <span class="vtl-music-icon" data-vtl-music-icon aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
            <path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
          </svg>
        </span>
        ${muteButtonMarkup({ muted: !!musicTrack.muted, kind: "audio" })}
        ${removeButtonMarkup({ kind: "audio" })}
        <span class="vtl-trim vtl-trim--out" data-vtl-trim="out" data-vtl-trim-target="audio"></span>
      </div>`;
  }

  function syncPlayhead() {
    const head = host.querySelector("[data-vtl-playhead]");
    if (head) head.style.left = `${36 + Math.max(0, playheadSec) * pxPerSec}px`;
    const trimHead = host.querySelector("[data-vtl-audio-trim-playhead]");
    if (trimHead && audioTrimMode && musicTrack) {
      const { full } = audioTrimBounds(musicTrack);
      const t = Math.min(full, Math.max(0, audioTrimSec));
      trimHead.style.left = `${(t / full) * 100}%`;
    }
    const clock = host.querySelector("[data-vtl-audio-trim-clock]");
    if (clock) {
      const shown = audioTrimMode ? audioTrimSec : playheadSec;
      clock.textContent = `${Math.max(0, shown).toFixed(1)}s`;
    }
    followPlayheadIntoView();
  }

  function followPlayheadIntoView() {
    if (!followPlayhead || applyingFollowScroll) return;
    const preview = getPreviewEl?.();
    if (!preview || preview.paused) return;
    const board = host.querySelector("[data-vtl-board]");
    if (!board) return;
    const x = 36 + Math.max(0, playheadSec) * pxPerSec;
    const next = followPlayheadScrollLeft(x, board.clientWidth, board.scrollLeft);
    if (Math.abs(next - board.scrollLeft) < 1) return;
    applyingFollowScroll = true;
    board.scrollLeft = next;
    requestAnimationFrame(() => { applyingFollowScroll = false; });
  }

  function renderRuler(total) {
    const ruler = host.querySelector("[data-vtl-ruler]");
    if (!ruler) return;
    const t = Math.min(MAX_CLIP_DURATION_SEC, Math.max(total, 0.1));
    const step = rulerTickStepSec(pxPerSec, t);
    const marks = [];
    let ticks = 0;
    for (let s = 0; s <= t + 0.01 && ticks < RULER_TICK_MAX; s += step) {
      marks.push(`<span class="vtl-ruler-mark" style="left:${36 + s * pxPerSec}px">${s}s</span>`);
      ticks += 1;
    }
    ruler.innerHTML = marks.join("");
    ruler.style.minWidth = `${36 + t * pxPerSec + 40}px`;
  }

  function syncAudioTrimUi() {
    if (!musicTrack) return;
    const { full, tin, tout } = audioTrimBounds(musicTrack);
    const span = host.querySelector("[data-vtl-audio-trim-span]");
    if (span) {
      span.style.left = `${(tin / full) * 100}%`;
      span.style.width = `${((tout - tin) / full) * 100}%`;
    }
    const inH = host.querySelector("[data-vtl-audio-trim-edge='in']");
    const outH = host.querySelector("[data-vtl-audio-trim-edge='out']");
    if (inH) inH.style.left = `${(tin / full) * 100}%`;
    if (outH) outH.style.left = `${(tout / full) * 100}%`;
    const inEl = host.querySelector("[data-vtl-audio-in]");
    const outEl = host.querySelector("[data-vtl-audio-out]");
    if (inEl && document.activeElement !== inEl) inEl.value = tin.toFixed(2);
    if (outEl && document.activeElement !== outEl) outEl.value = tout.toFixed(2);
    syncPlayhead();
  }

  function setAudioTrimChrome(on) {
    const active = !!on;
    host.classList.toggle("is-audio-trim", active);
    host.closest(".clip-editor-studio, .clip-editor-workspace, [data-clip-studio], [data-video-editor-card]")
      ?.classList.toggle("is-audio-trim", active);
    const preview = getPreviewEl?.();
    preview?.classList.toggle("is-audio-trim", active);
    preview?.closest("[data-video-preview-wrap], .video-editor-preview-wrap, .ref-viewer-stage-wrap--video")
      ?.classList.toggle("is-audio-trim", active);
  }

  function layoutClipsLive({ live = false } = {}) {
    const total = projectSpanSec();
    const el = host.querySelector("[data-vtl-timeline]");
    let x = 0;
    for (const c of clips) {
      const dur = clipEffectiveDuration(c);
      const w = clipPixelWidth(c);
      const node = el?.querySelector(`[data-vtl-clip="${c.id}"]`);
      if (node) {
        node.style.left = `${x}px`;
        node.style.width = `${w}px`;
        const d = node.querySelector(".vtl-clip-dur");
        if (d) d.textContent = `${dur.toFixed(1)}s`;
      }
      x += w + (transitionMode === "cut" ? 4 : 2);
    }
    if (el) el.style.minWidth = `${Math.max(x + 40, 36 + total * pxPerSec + 40)}px`;
    const musicEl = host.querySelector("[data-vtl-music]");
    const block = host.querySelector("[data-vtl-music-block]");
    if (musicTrack && block) {
      const w = Math.max(24, clipEffectiveDuration(musicTrack) * pxPerSec);
      block.style.width = `${w}px`;
      if (musicEl) musicEl.style.minWidth = `${Math.max(w + 40, 36 + total * pxPerSec + 40)}px`;
    }
    if (live) {
      const ruler = host.querySelector("[data-vtl-ruler]");
      if (ruler) ruler.style.minWidth = `${36 + total * pxPerSec + 40}px`;
    } else {
      renderRuler(total);
    }
    syncPlayhead();
    if (audioTrimMode) syncAudioTrimUi();
  }

  function anyClipPending() {
    return clips.some((c) => clipNeedsTimelineSpinner(c));
  }

  function ensurePreviewHydrateOverlay() {
    const preview = getPreviewEl?.();
    const wrap = preview?.closest?.(
      "[data-video-preview-wrap], .video-editor-preview-wrap, .ref-viewer-stage--video, .ref-viewer-stage-wrap--video",
    );
    if (!wrap) return null;
    let overlay = wrap.querySelector("[data-vtl-preview-loading]");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "vtl-preview-loading hidden";
      overlay.dataset.vtlPreviewLoading = "";
      overlay.innerHTML = `<span class="vtl-spin" aria-hidden="true"></span><span data-vtl-preview-loading-msg>${escapeHtml(TIMELINE_CLIP_LOADING_STATUS)}</span>`;
      wrap.appendChild(overlay);
    }
    return overlay;
  }

  function setTimelineLoading(on, msg) {
    timelineHydrating = !!on;
    if (msg) timelineHydrateMsg = String(msg);
    if (on) {
      if (!timelineHydrateStartedAt) timelineHydrateStartedAt = Date.now();
      if (timelineHydrateTimer) clearTimeout(timelineHydrateTimer);
      timelineHydrateTimer = setTimeout(() => {
        timelineHydrateTimer = 0;
        for (const c of clips) c.pending = false;
        timelineHydrating = false;
        timelineHydrateStartedAt = 0;
        syncTimelineLoading();
        renderTimeline();
      }, TIMELINE_LOADING_MAX_MS);
    } else {
      if (timelineHydrateTimer) {
        clearTimeout(timelineHydrateTimer);
        timelineHydrateTimer = 0;
      }
      timelineHydrateStartedAt = 0;
    }
    syncTimelineLoading();
    if (!clips.length) renderTimeline();
  }

  function syncTimelineLoading() {
    const preview = getPreviewEl?.();
    const elapsed = timelineHydrateStartedAt ? Date.now() - timelineHydrateStartedAt : 0;
    const hide = timelineLoadingShouldHide({
      clipExists: clips.length > 0,
      previewHasSrc: previewPlayerHasSrc(preview),
      previewError: !!(preview && preview.error),
      elapsedMs: elapsed,
    });
    if (hide) {
      timelineHydrating = false;
      for (const c of clips) c.pending = false;
    }
    const pending = !hide && (timelineHydrating || anyClipPending());
    const msg = timelineHydrateMsg || TIMELINE_CLIP_LOADING_STATUS;
    host.classList.toggle("is-hydrating", pending);
    const lane = host.querySelector("[data-vtl-lane-loading]");
    const laneMsg = host.querySelector("[data-vtl-lane-loading-msg]");
    if (laneMsg) laneMsg.textContent = msg;
    if (lane) {
      const showLane = pending && !clips.length;
      lane.hidden = !showLane;
      lane.classList.toggle("hidden", !showLane);
    }
    const overlay = ensurePreviewHydrateOverlay();
    const overlayMsg = overlay?.querySelector("[data-vtl-preview-loading-msg]");
    if (overlayMsg) overlayMsg.textContent = msg;
    if (overlay) {
      overlay.hidden = !pending;
      overlay.classList.toggle("hidden", !pending);
    }
    const wrap = preview?.closest?.(
      "[data-video-preview-wrap], .video-editor-preview-wrap, .ref-viewer-stage--video, .ref-viewer-stage-wrap--video",
    );
    wrap?.classList?.toggle("is-clip-hydrating", pending);
    preview?.classList?.toggle("is-clip-hydrating", pending);
    preview?.classList?.toggle("is-loading", false);
  }

  function renderTimeline() {
    if (destroyed) return;
    const el = host.querySelector("[data-vtl-timeline]");
    const total = projectSpanSec();
    renderRuler(total);
    syncPlayhead();
    syncMusic();
    if (audioTrimMode) syncAudioTrimUi();
    syncMeta();
    syncSelected();
    syncTimelineLoading();
    if (!el) return;
    if (shouldShowVideoLaneEmpty(clips, { hydrating: timelineHydrating })) {
      el.innerHTML = `<button type="button" class="vtl-empty" data-vtl-tool="add">Drop videos here, then trim and generate.</button>`;
      el.style.minWidth = `${36 + total * pxPerSec + 40}px`;
      return;
    }
    if (!clips.length) {
      el.innerHTML = "";
      el.style.minWidth = `${36 + total * pxPerSec + 40}px`;
      return;
    }
    let x = 0;
    el.innerHTML = clips.map((c) => {
      const dur = clipEffectiveDuration(c);
      const w = clipPixelWidth(c);
      const left = x;
      x += w + (transitionMode === "cut" ? 4 : 2);
      const tinMode = c.transitionIn || "cut";
      const toutMode = c.transitionOut || "cut";
      const pending = clipNeedsTimelineSpinner(c);
      const edgeClass = [
        !selectedAudio && (selectedIds.has(c.id) || c.id === selectedId) ? "is-selected" : "",
        c.muted ? "is-muted" : "",
        pending ? "is-pending" : "",
        tinMode !== "cut" ? `is-trans-in-${tinMode}` : "",
        toutMode !== "cut" ? `is-trans-out-${toutMode}` : "",
      ].filter(Boolean).join(" ");
      return `
        <div class="vtl-clip${edgeClass ? ` ${edgeClass}` : ""}" role="button" tabindex="0" data-vtl-clip="${escapeHtml(c.id)}" draggable="true" style="left:${left}px;width:${w}px" title="${escapeHtml(c.label || "Untitled")}">
          <span class="vtl-trim vtl-trim--in" data-vtl-trim="in"></span>
          ${avatarMarkup(c.addedBy)}
          ${pending ? `<span class="vtl-spin vtl-clip-spin" aria-hidden="true"></span>` : ""}
          <span class="vtl-clip-src">${escapeHtml(sourceLabel(c.source))}</span>
          <span class="vtl-clip-label">${escapeHtml(c.label || "Untitled")}</span>
          <span class="vtl-clip-dur">${pending ? "…" : `${dur.toFixed(1)}s`}</span>
          ${muteButtonMarkup({ muted: !!c.muted, kind: "clip" })}
          ${removeButtonMarkup({ kind: "clip" })}
          <span class="vtl-trim vtl-trim--out" data-vtl-trim="out"></span>
        </div>`;
    }).join("");
    el.style.minWidth = `${Math.max(x + 40, 36 + total * pxPerSec + 40)}px`;
  }

  function syncSelected() {
    const panel = host.querySelector("[data-vtl-selected]");
    const clip = selectedTarget();
    if (!panel) return;
    if (audioTrimMode) {
      panel.classList.add("hidden");
      syncAudioTrimUi();
      return;
    }
    if (!clip) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    const full = clipSourceDuration(clip);
    const tin = Number(clip.trimIn) || 0;
    const tout = clip.trimOut != null && Number.isFinite(Number(clip.trimOut)) ? Number(clip.trimOut) : full;
    const inEl = panel.querySelector("[data-vtl-in]");
    const outEl = panel.querySelector("[data-vtl-out]");
    if (inEl && document.activeElement !== inEl) inEl.value = tin.toFixed(2);
    if (outEl && document.activeElement !== outEl) outEl.value = (tout || 0).toFixed(2);
    const stats = panel.querySelector("[data-vtl-clip-stats]");
    if (stats) stats.textContent = clipTrimStatsText(clip);
  }

  function syncTransitionUi() {
    host.querySelectorAll("[data-vtl-transition]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.vtlTransition === transitionMode);
    });
  }

  function previewAlreadyHasMedia(preview) {
    return !!(preview && finiteMediaDuration(preview) > 0.05 && (preview.currentSrc || preview.src));
  }

  async function waitPreviewDuration(preview, timeoutMs = 900) {
    const now = finiteMediaDuration(preview);
    if (now > 0.05) return now;
    if (!preview) return 0;
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        preview.removeEventListener("loadedmetadata", finish);
        preview.removeEventListener("durationchange", finish);
        preview.removeEventListener("loadeddata", finish);
        clearTimeout(tid);
        resolve(finiteMediaDuration(preview));
      };
      preview.addEventListener("loadedmetadata", finish);
      preview.addEventListener("durationchange", finish);
      preview.addEventListener("loadeddata", finish);
      const tid = setTimeout(finish, Math.max(120, Number(timeoutMs) || 900));
    });
  }

  async function settleClipMedia(clip) {
    if (!clip || destroyed) return clip;
    const preview = getPreviewEl?.();
    const hasSrc = previewPlayerHasSrc(preview) || !!clip.url;
    clip.pending = false;
    if (hasSrc || preview?.error) setTimelineLoading(false);
    let d = finiteMediaDuration(preview);
    if (!(d > 0.05) && hasSrc) d = await waitPreviewDuration(preview, TIMELINE_LOADING_MAX_MS);
    if (!(d > 0.05) && clip.blob) d = await probeDuration(clip.blob);
    if (destroyed) return clip;
    if (d > 0.05) adoptMediaDuration(clip, d);
    clip.pending = false;
    setTimelineLoading(false);
    renderTimeline();
    emitTimelineDraft();
    return clip;
  }

  async function addClip({ blob, url, source, label, sourcePath, duration: knownDur, attachPreview = true } = {}) {
    if (!blob && !url) return null;
    const kind = mediaKindFromFile({ type: blob?.type, name: blob?.name || label || url || "" });
    if ((kind === "audio" || source === "audio") && blob) {
      setMusicFromFile(blob);
      return null;
    }
    const preview = getPreviewEl?.();
    const keepPreview = previewAlreadyHasMedia(preview);
    const isStill = kind === "image" || source === "still" || source === "image";
    let duration = Number(knownDur) > 0.05 ? Number(knownDur) : finiteMediaDuration(preview);
    if (isStill && !(duration > 0.2)) duration = STILL_DURATION_SEC;
    const existing = findClipBySourceKey(clips, { sourcePath, filename: sourcePath });
    if (existing) {
      if (blob && !existing.blob) existing.blob = blob;
      if (!existing.url) {
        existing.url = url || (keepPreview ? (preview.currentSrc || preview.src) : "") || (blob ? URL.createObjectURL(blob) : "");
      }
      // leakfix32: do not createObjectURL when the clip already has a url
      if (sourcePath) {
        existing.sourcePath = existing.sourcePath || sourcePath;
        existing.filename = existing.filename || sourcePath;
      }
      if (duration > 0.05) adoptMediaDuration(existing, duration);
      existing.pending = false;
      setSelection([existing.id], existing.id, { anchor: existing.id });
      setTimelineLoading(false);
      renderTimeline();
      if (!(Number(existing.duration) > 0.05)) void settleClipMedia(existing);
      return existing;
    }
    const objectUrl = url || (keepPreview ? (preview.currentSrc || preview.src) : "") || (blob ? URL.createObjectURL(blob) : "");
    const reusedPreviewUrl = !!(keepPreview && objectUrl && (preview.currentSrc === objectUrl || preview.src === objectUrl));
    const clip = {
      id: uid(),
      source: source || (isStill ? "still" : "upload"),
      label: String(label || "Clip").replace(/\.[^.]+$/, "").slice(0, 80),
      blob: blob || null,
      url: objectUrl,
      filename: sourcePath || "",
      sourcePath: sourcePath || "",
      ownedUrl: !!objectUrl && !reusedPreviewUrl && !!blob && objectUrl !== (preview?.currentSrc || preview?.src || ""),
      duration,
      pending: !isStill && !(duration > 0.05) && !objectUrl,
      trimIn: 0,
      trimOut: null,
      muted: false,
      transitionIn: null,
      transitionOut: null,
      addedBy: localAuthor(),
    };
    if (clips.length) pushUndo();
    clips.push(clip);
    setSelection([clip.id], clip.id, { anchor: clip.id });
    if (clips.length === 1 && blob) {
      outputBlob = blob;
      onOutputBlob?.(blob);
    }
    if (clip.pending) setTimelineLoading(true, TIMELINE_CLIP_LOADING_STATUS);
    else setTimelineLoading(false);
    renderTimeline();
    if (attachPreview !== false && !reusedPreviewUrl) previewClip(clip);
    if (previewPlayerHasSrc(getPreviewEl?.()) || clip.url) {
      clip.pending = false;
      setTimelineLoading(false);
    }
    setLocalStatus(clip.pending
      ? TIMELINE_CLIP_LOADING_STATUS
      : `Added “${clip.label}”${clip.duration > 0 ? ` · ${clip.duration.toFixed(1)}s` : ""}`);
    broadcastClip(clip, isStill ? "image" : "video");
    emitTimelineDraft();
    if (clip.pending) await settleClipMedia(clip);
    else if (!(clip.duration > 0.05)) {
      const fromPreview = finiteMediaDuration(getPreviewEl?.());
      if (adoptMediaDuration(clip, fromPreview)) renderTimeline();
      else void settleClipMedia(clip);
    }
    return clip;
  }

  function persistMusicOnce(file, { persist = true } = {}) {
    if (!persist || !file || typeof onPersistMedia !== "function") return;
    const key = audioPersistKey(file);
    if (file.__vtlPersisted || (key && key === lastPersistedAudioKey)) return;
    lastPersistedAudioKey = key;
    Promise.resolve(onPersistMedia(file, {
      kind: "audio",
      label: file.name || musicTrack?.label || "audio",
      filename: editorAudioUploadName(file),
    })).then((saved) => {
      if (!saved || !musicTrack || musicTrack.blob !== file) return;
      file.__vtlPersisted = true;
      musicTrack.filename = saved.filename || musicTrack.filename;
      musicTrack.folder = saved.folder || musicTrack.folder;
      emitTimelineDraft({ immediate: true });
    }).catch(() => {
      if (lastPersistedAudioKey === key) lastPersistedAudioKey = "";
    });
  }

  function setMusicFromFile(file, opts = {}) {
    if (!file) return;
    if (opts.history !== false && (musicTrack || clips.length)) pushUndo();
    if (musicTrack?.url) {
      const prev = musicTrack.url;
      pauseAndDetachMedia(host.querySelector("[data-vtl-bed]"));
      scheduleRevokeObjectURL(prev);
    }
    const volume = opts.volume != null && Number.isFinite(Number(opts.volume))
      ? Math.max(0, Number(opts.volume))
      : pendingMusicVolume;
    musicTrack = {
      blob: file,
      url: URL.createObjectURL(file),
      name: String(opts.filename || file.name || "music.mp3").slice(0, 120),
      label: prettyAudioLabel(opts.label || opts.filename || file.name),
      volume,
      muted: !!opts.muted,
      duration: Number(opts.duration) || 0,
      trimIn: Math.max(0, Number(opts.trimIn) || 0),
      trimOut: opts.trimOut == null || opts.trimOut === "" ? null : Number(opts.trimOut),
      startSec: Math.max(0, Number(opts.startSec) || 0),
      filename: opts.filename || "",
      folder: opts.folder || "",
      persistKey: opts.persistKey || audioPersistKey(file),
      addedBy: localAuthor(),
    };
    selectedAudio = true;
    selectedId = null;
    renderTimeline();
    const bed = attachMusicToPlayback();
    // Dropping A-track music must not mute V clips or the preview globally.
    if (!audioDropShouldMutePreview()) {
      applyPreviewMute(clipAtAbs(playheadSec) || clips[0]);
    }
    try { onCacheMedia?.(file, { kind: "audio", persistKey: musicTrack.persistKey }); } catch (_) {}
    persistMusicOnce(file, { persist: opts.persist !== false });
    const preview = getPreviewEl?.();
    if (preview && !preview.paused) void playBedAudio();
    setLocalStatus("Audio added.");
    broadcastClip(musicTrack, "audio");
    emitTimelineDraft({ immediate: opts.persist !== false });
    void waitPreviewDuration(bed, 2500).then((d) => {
      if (!musicTrack || musicTrack.blob !== file) return;
      if (adoptMediaDuration(musicTrack, d)) {
        renderTimeline();
        setLocalStatus(`Audio · ${d.toFixed(1)}s`);
        emitTimelineDraft();
      }
    });
  }

  function clearMusic() {
    if (musicTrack) pushUndo();
    pauseBedAudio();
    const bed = host.querySelector("[data-vtl-bed]");
    pauseAndDetachMedia(bed);
    const musicUrl = musicTrack?.url;
    musicTrack = null;
    selectedAudio = false;
    if (!destroyed) renderTimeline();
    scheduleRevokeObjectURL(musicUrl);
    emitTimelineDraft({ immediate: true });
  }

  function ensureBedAudio() {
    let el = host.querySelector("[data-vtl-bed]");
    if (!el) {
      el = document.createElement("audio");
      el.dataset.vtlBed = "";
      el.preload = "metadata";
      el.playsInline = true;
      el.setAttribute("playsinline", "");
      el.setAttribute("hidden", "");
      host.appendChild(el);
    }
    return el;
  }

  function timelineTimeFromPreview(el) {
    const clip = selected() || clips[0];
    if (!clip || !el) return playheadSec;
    const tin = Number(clip.trimIn) || 0;
    const local = Math.max(0, (Number(el.currentTime) || 0) - tin);
    return absoluteTimeForClipStart(clip.id) + local;
  }

  function applyPreviewMute(clip = selected() || clipAtAbs(playheadSec) || clips[0]) {
    const el = getPreviewEl?.();
    if (!el) return;
    const mute = previewMuteShouldBe(clip);
    const vol = clipPreviewVolume(clip) * Math.max(0, Math.min(1, videoMixVolume));
    el.defaultMuted = mute;
    el.muted = mute;
    el.volume = mute ? 0 : vol;
    if (mute) el.setAttribute("muted", "");
    else el.removeAttribute("muted");
  }

  function applyBedMute() {
    const bed = host.querySelector("[data-vtl-bed]");
    const state = musicTrackPlaybackState(musicTrack);
    if (!bed) return;
    bed.muted = !state.attached || state.muted;
    bed.volume = state.volume;
  }

  function attachMusicToPlayback() {
    const bed = ensureBedAudio();
    const state = musicTrackPlaybackState(musicTrack);
    if (!state.attached) {
      pauseBedAudio();
      try { bed.removeAttribute("src"); } catch (_) {}
      return bed;
    }
    if (musicTrack.url && bed.getAttribute("src") !== musicTrack.url) {
      bed.src = musicTrack.url;
    }
    applyBedMute();
    const d = finiteMediaDuration(bed);
    if (adoptMediaDuration(musicTrack, d)) renderTimeline();
    return bed;
  }

  function pauseBedAudio() {
    const bed = host.querySelector("[data-vtl-bed]");
    try { bed?.pause?.(); } catch (_) {}
  }

  function musicClockAtPlayhead(abs) {
    if (!musicTrack) return null;
    const start = Math.max(0, Number(musicTrack.startSec) || 0);
    const localAbs = (Number(abs) || 0) - start;
    if (localAbs < -0.02) return null;
    const tin = Number(musicTrack.trimIn) || 0;
    const full = clipSourceDuration(musicTrack);
    const tout = musicTrack.trimOut != null && Number.isFinite(Number(musicTrack.trimOut))
      ? Number(musicTrack.trimOut)
      : (full || Infinity);
    const t = tin + Math.max(0, localAbs);
    if (t >= tout) return null;
    return t;
  }

  function previewShowsSourceClip() {
    return previewShowsTimelineClip(getPreviewEl?.(), selected() || clips[0]);
  }

  async function playBedAudio({ autoplayKick = false } = {}) {
    if (destroyed || mediaParked) return;
    const preview = getPreviewEl?.();
    const clip = selected() || clips[0];
    if (!autoplayKick) applyPreviewMute(clip);
    if (!preview || preview.paused) return;
    const state = musicTrackPlaybackState(musicTrack);
    if (!shouldStartBedAudio({
      attached: state.attached,
      musicMuted: state.muted,
      previewShowsClip: previewShowsSourceClip(),
      previewPaused: !!preview.paused,
      autoplayKick,
    })) {
      pauseBedAudio();
      return;
    }
    const bed = attachMusicToPlayback();
    const abs = timelineTimeFromPreview(preview);
    const clock = musicClockAtPlayhead(abs);
    if (clock == null) {
      pauseBedAudio();
      return;
    }
    try {
      if (Number.isFinite(clock) && Math.abs((Number(bed.currentTime) || 0) - clock) > 0.18) {
        bed.currentTime = Math.max(0, clock);
      }
    } catch (_) {}
    applyBedMute();
    try {
      await bed.play?.();
    } catch (_) {
      /* autoplay — next user play click retries */
    }
  }

  function onPreviewPlay() {
    if (destroyed || mediaParked) return;
    followPlayhead = true;
    applyPreviewMute();
    const el = getPreviewEl?.();
    const clip = clipAtAbs(playheadSec) || clips[0];
    if (el && clip) {
      const local = localTimeOnClip(clip, playheadSec);
      if (el.ended || Math.abs((Number(el.currentTime) || 0) - local) > 0.25) {
        try { el.currentTime = local; } catch (_) {}
      }
    }
    void playBedAudio({ autoplayKick: false });
  }

  function onPreviewPause() {
    pauseBedAudio();
  }

  function syncPreviewChrome() {
    const chrome = ensurePreviewChrome();
    const motion = chrome?.querySelector("[data-video-motion]");
    if (!motion) return;
    motion.classList.toggle("is-on", previewLoopOn);
    motion.setAttribute("aria-pressed", previewLoopOn ? "true" : "false");
    motion.title = previewLoopOn ? "Motion (loop on)" : "Motion (loop off)";
  }

  function ensurePreviewChrome() {
    const preview = getPreviewEl?.();
    const wrap = preview?.closest?.("[data-video-preview-wrap], .video-editor-preview-wrap, .ref-viewer-stage--video")
      || preview?.parentElement;
    if (!wrap) return null;
    let chrome = wrap.querySelector("[data-video-preview-chrome]");
    if (!chrome) {
      wrap.insertAdjacentHTML("beforeend", previewPlaybackChromeMarkup());
      chrome = wrap.querySelector("[data-video-preview-chrome]");
    }
    if (chrome && chrome.dataset.vtlChromeBound !== "1") {
      chrome.dataset.vtlChromeBound = "1";
      chrome.querySelector("[data-video-motion]")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        previewLoopOn = !previewLoopOn;
        syncPreviewChrome();
      });
      chrome.querySelector("[data-video-restart-loop]")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const el = getPreviewEl?.();
        const keepPlaying = !!(el && !el.paused && !el.ended);
        void restartPreviewLoop({ play: keepPlaying || previewLoopOn && el?.ended });
      });
    }
    return chrome;
  }

  async function restartPreviewLoop({ play = false } = {}) {
    if (destroyed || mediaParked || loopRestarting) return;
    loopRestarting = true;
    try {
      const el = getPreviewEl?.();
      followPlayhead = true;
      await seekTimelineTo(previewLoopRestartSec());
      if (play && el) {
        try { await el.play?.(); } catch (_) { /* autoplay */ }
        void playBedAudio();
      }
    } finally {
      loopRestarting = false;
    }
  }

  function onPreviewEnded() {
    if (destroyed || mediaParked) {
      pauseBedAudio();
      return;
    }
    if (previewLoopOn) {
      void restartPreviewLoop({ play: true });
      return;
    }
    pauseBedAudio();
  }

  function onPreviewTime() {
    if (destroyed || mediaParked || editorPageIsHidden()) return;
    const el = getPreviewEl?.();
    if (!el || el.paused) return;
    playheadSec = timelineTimeFromPreview(el);
    syncPlayhead();
    const bed = host.querySelector("[data-vtl-bed]");
    if (!bed || !musicTrackPlaybackState(musicTrack).attached || musicTrack?.muted) return;
    if (!Number.isFinite(Number(bed.duration)) || !(Number(bed.duration) > 0.05)) return;
    const abs = playheadSec;
    const clock = musicClockAtPlayhead(abs);
    if (clock == null) {
      pauseBedAudio();
      return;
    }
    if (!Number.isFinite(clock)) return;
    try {
      if (Math.abs((Number(bed.currentTime) || 0) - clock) > 0.28) bed.currentTime = Math.max(0, clock);
    } catch (_) {}
  }

  function unbindPreviewPlayback() {
    const el = previewPlaybackEl;
    const h = previewPlaybackHandlers;
    previewPlaybackEl = null;
    previewPlaybackHandlers = null;
    if (!el || !h) return;
    try { delete el.dataset.vtlPlaybackBound; } catch (_) { /* ignore */ }
    el.removeEventListener("play", h.onPlay);
    el.removeEventListener("playing", h.onPlay);
    el.removeEventListener("pause", h.onPause);
    el.removeEventListener("ended", h.onEnded);
    el.removeEventListener("click", h.onClick);
    el.removeEventListener("seeked", h.onSeeked);
    el.removeEventListener("timeupdate", h.onTime);
    el.removeEventListener("loadedmetadata", h.onAdopt);
    el.removeEventListener("durationchange", h.onAdopt);
    el.removeEventListener("error", h.onError);
  }

  function bindPreviewPlayback(el) {
    if (!el || destroyed) return;
    if (el.dataset.vtlPlaybackBound === "1" && previewPlaybackEl === el) return;
    if (previewPlaybackEl && previewPlaybackEl !== el) unbindPreviewPlayback();
    el.dataset.vtlPlaybackBound = "1";
    const onClick = () => {
      if (destroyed || mediaParked || !el.ended) return;
      const span = projectSpanSec();
      if (playheadPlaybackIntent(playheadSec, span, { playing: false, ended: true }) !== "play") return;
      setTimeout(() => {
        if (destroyed || mediaParked || (!el.paused && !el.ended)) return;
        void togglePreviewPlayback();
      }, 0);
    };
    const onSeeked = () => {
      if (destroyed || mediaParked) return;
      playheadSec = timelineTimeFromPreview(el);
      syncPlayhead();
      void playBedAudio();
    };
    const onAdopt = () => {
      if (destroyed || mediaParked) return;
      const clip = selected() || clips[0];
      let d = finiteMediaDuration(el);
      if (!(d > 0) && shouldSeekUnknownMediaDuration(el.duration, { tried: el.dataset.vtlDurationSeek === "1" })) {
        el.dataset.vtlDurationSeek = "1";
        try { el.currentTime = 1e10; } catch (_) {}
        d = finiteMediaDuration(el);
      }
      if (clip) clip.pending = false;
      setTimelineLoading(false);
      if (adoptMediaDuration(clip, d)) renderTimeline();
    };
    const onError = () => {
      const clip = selected() || clips[0];
      if (clip) clip.pending = false;
      setTimelineLoading(false);
      renderTimeline();
    };
    previewPlaybackEl = el;
    previewPlaybackHandlers = {
      onPlay: onPreviewPlay,
      onPause: onPreviewPause,
      onEnded: onPreviewEnded,
      onClick,
      onSeeked,
      onTime: onPreviewTime,
      onAdopt,
      onError,
    };
    el.addEventListener("play", onPreviewPlay);
    el.addEventListener("playing", onPreviewPlay);
    el.addEventListener("pause", onPreviewPause);
    el.addEventListener("ended", onPreviewEnded);
    el.addEventListener("click", onClick);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("timeupdate", onPreviewTime);
    el.addEventListener("loadedmetadata", onAdopt);
    el.addEventListener("durationchange", onAdopt);
    el.addEventListener("error", onError);
  }

  function setClipMuted(clip, muted) {
    if (!clip) return;
    pushUndo();
    clip.muted = !!muted;
    if (clip.id === selectedId || !selected()) applyPreviewMute(clip);
    renderTimeline();
    setLocalStatus(clip.muted ? `Muted “${clip.label || "clip"}”.` : `Unmuted “${clip.label || "clip"}”.`);
  }

  function setMusicMuted(muted) {
    if (!musicTrack) return;
    pushUndo();
    musicTrack.muted = !!muted;
    applyBedMute();
    if (musicTrack.muted) pauseBedAudio();
    else void playBedAudio();
    renderTimeline();
    setLocalStatus(musicTrack.muted ? "Audio track muted." : "Audio track unmuted.");
    emitTimelineDraft();
  }

  function hideClipMenu() {
    const menu = host.querySelector("[data-vtl-menu]");
    if (!menu) return;
    menu.classList.add("hidden");
    menu.hidden = true;
    menu.innerHTML = "";
  }

  function showClipMenu(clientX, clientY, clip, { playheadHits = false, kind = "clip" } = {}) {
    const menu = host.querySelector("[data-vtl-menu]");
    if (!menu || !clip) return;
    const model = clipContextMenuModel({
      clip,
      playheadHits,
      formats: CLIP_DOWNLOAD_FORMATS,
      kind,
    });
    const transRow = (edge, current) => ["cut", "fade", "dissolve"].map((mode) => {
      const label = mode === "cut" ? "Cut" : mode === "fade" ? "Fade" : "Dissolve";
      const on = (current || "cut") === mode;
      return `<button type="button" class="vtl-menu-chip${on ? " is-active" : ""}" data-vtl-menu-act="transition" data-vtl-edge="${edge}" data-vtl-mode="${mode}">${label}</button>`;
    }).join("");
    const formats = model.downloadFormats.map((fmt) => (
      `<button type="button" class="vtl-menu-item" role="menuitem" data-vtl-download="${escapeHtml(fmt)}">${fmt.toUpperCase()}</button>`
    )).join("");
    const transHtml = model.transitionStart.length ? `
      <p class="vtl-menu-label">Transition at start</p>
      <div class="vtl-menu-row">${transRow("start", clip.transitionIn)}</div>
      <p class="vtl-menu-label">Transition at end</p>
      <div class="vtl-menu-row">${transRow("end", clip.transitionOut)}</div>` : "";
    menu.innerHTML = `
      <button type="button" class="vtl-menu-item" role="menuitem" data-vtl-menu-act="copy">${escapeHtml(model.copyLabel)}</button>
      <button type="button" class="vtl-menu-item" role="menuitem" data-vtl-menu-act="paste">${escapeHtml(model.pasteLabel)}</button>
      <button type="button" class="vtl-menu-item" role="menuitem" data-vtl-menu-act="mute">${escapeHtml(model.muteLabel)}</button>
      ${model.duplicate ? `<button type="button" class="vtl-menu-item" role="menuitem" data-vtl-menu-act="duplicate">Duplicate</button>` : ""}
      ${musicTrack ? `<button type="button" class="vtl-menu-item" role="menuitem" data-vtl-menu-act="shorten-audio">${escapeHtml(model.shortenAudioLabel)}</button>` : ""}
      ${musicTrack ? `<button type="button" class="vtl-menu-item" role="menuitem" data-vtl-menu-act="trim-audio">${escapeHtml(model.trimAudioLabel)}</button>` : ""}
      <button type="button" class="vtl-menu-item" role="menuitem" data-vtl-menu-act="remove">${escapeHtml(model.removeLabel)}</button>
      ${transHtml}
      ${model.split ? `<button type="button" class="vtl-menu-item" role="menuitem" data-vtl-menu-act="split">${escapeHtml(model.splitLabel)}</button>` : ""}
      <div class="vtl-menu-download" data-vtl-download-wrap>
        <button type="button" class="vtl-menu-item vtl-menu-download-btn" data-vtl-menu-act="download-toggle" aria-haspopup="true" aria-expanded="false">Download ▾</button>
        <div class="vtl-menu-formats hidden" data-vtl-download-menu hidden>${formats}</div>
      </div>`;
    lastMenuPoint = { x: clientX, y: clientY };
    menu.dataset.vtlMenuKind = model.kind;
    menu.classList.remove("hidden");
    menu.hidden = false;
    placeClipMenu(clientX, clientY);
  }

  function placeClipMenu(clientX, clientY) {
    const menu = host.querySelector("[data-vtl-menu]");
    if (!menu || menu.hidden) return;
    menu.style.position = "fixed";
    menu.style.visibility = "hidden";
    menu.style.left = "0px";
    menu.style.top = "0px";
    const mw = Math.max(menu.offsetWidth || 0, 196);
    const mh = Math.max(menu.offsetHeight || 0, 48);
    const pos = clampMenuPosition({
      pointerX: clientX,
      pointerY: clientY,
      menuWidth: mw,
      menuHeight: mh,
      viewWidth: window.innerWidth || 800,
      viewHeight: window.innerHeight || 600,
    });
    menu.style.left = `${pos.left}px`;
    menu.style.top = `${pos.top}px`;
    menu.style.visibility = "";
    menu.style.zIndex = "80";
  }

  function applyClipTransition(clip, edge, mode) {
    if (!clip) return;
    pushUndo();
    setClipEdgeTransition(clip, edge, mode);
    if (mode === "dissolve") transitionMode = "dissolve";
    else if (mode === "fade" && transitionMode === "cut") transitionMode = "fade";
    syncTransitionUi();
    renderTimeline();
    const where = edge === "end" ? "end" : "start";
    setLocalStatus(`${mode === "cut" ? "Cut" : mode === "fade" ? "Fade" : "Dissolve"} at ${where} of “${clip.label || "clip"}”.`);
  }

  function splitSelectedAtPlayhead() {
    const before = clips.length;
    const next = splitClipAtPlayhead(clips, playheadSec);
    if (next.length === before) {
      setLocalStatus("Move the playhead onto a clip to split.", true);
      return false;
    }
    pushUndo();
    clips = next;
    const hit = clips.find((c) => playheadHitsClip(clips, c.id, playheadSec, 0));
    setSelection([hit?.id || clips[0]?.id].filter(Boolean), hit?.id || clips[0]?.id || null);
    renderTimeline();
    setLocalStatus("Split clip at playhead.");
    return true;
  }

  async function downloadClipBlob(format, clip) {
    const fmt = String(format || "mp4").toLowerCase();
    const blob = clip?.blob || outputBlob || clips[0]?.blob || musicTrack?.blob || null;
    if (!blob) {
      setLocalStatus("Nothing to download yet.", true);
      return;
    }
    hideClipMenu();
    if (typeof onDownloadClip === "function") {
      try {
        await onDownloadClip(blob, fmt, clip);
        return;
      } catch (err) {
        setLocalStatus(err?.message || "Download failed.", true);
        return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${String(clip?.label || "clip").replace(/[^\w.-]+/g, "-") || "clip"}.${fmt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setLocalStatus(`Downloading ${fmt.toUpperCase()}…`);
  }

  function clipUrlStillUsed(url) {
    if (!url) return false;
    if (musicTrack?.url === url) return true;
    return clips.some((c) => c.url === url);
  }

  function removeClip(clip, { history = true } = {}) {
    if (!clip) return;
    if (history) pushUndo();
    clips = clips.filter((c) => c.id !== clip.id);
    selectedIds.delete(clip.id);
    if (clip.url && !clipUrlStillUsed(clip.url) && clip.ownedUrl !== false) {
      pauseAndDetachMedia(getPreviewEl?.());
      scheduleRevokeObjectURL(clip.url);
    }
    setSelection(selectedIds.size ? [...selectedIds] : [clips[0]?.id].filter(Boolean), clips[0]?.id || null);
    selectedAudio = false;
    renderTimeline();
    if (clips[0]) previewClip(clips[0]);
    setLocalStatus("Clip removed.");
    emitTimelineDraft();
  }

  function removeSelected() {
    if (selectedAudio && musicTrack && !selectedClipList().length) {
      clearMusic();
      setLocalStatus("Audio removed.");
      return;
    }
    const list = selectedClipList();
    if (!list.length) {
      removeClip(selected());
      return;
    }
    pushUndo();
    const ids = new Set(list.map((c) => c.id));
    const removed = clips.filter((c) => ids.has(c.id));
    clips = clips.filter((c) => !ids.has(c.id));
    for (const clip of removed) {
      if (clip.url && !clipUrlStillUsed(clip.url) && clip.ownedUrl !== false) {
        pauseAndDetachMedia(getPreviewEl?.());
        scheduleRevokeObjectURL(clip.url);
      }
    }
    setSelection([], null, { anchor: null });
    selectionAnchor = null;
    renderTimeline();
    if (clips[0]) previewClip(clips[0]);
    setLocalStatus(list.length > 1 ? `Removed ${list.length} clips.` : "Clip removed.");
    emitTimelineDraft();
  }

  function duplicateSelected() {
    const clip = selected();
    if (!clip) return;
    pushUndo();
    const copy = {
      ...clip,
      id: uid(),
      addedBy: localAuthor(),
    };
    const idx = clips.findIndex((c) => c.id === clip.id);
    clips.splice(idx < 0 ? clips.length : idx + 1, 0, copy);
    setSelection([copy.id], copy.id, { anchor: copy.id });
    renderTimeline();
    setLocalStatus(`Duplicated “${clip.label || "clip"}”.`);
    emitTimelineDraft();
  }

  function snapshotClipboardItem(item, kind) {
    if (!item) return null;
    return {
      kind,
      data: {
        ...item,
        id: item.id,
        blob: item.blob,
        url: item.url,
      },
    };
  }

  function copySelected() {
    if (selectedAudio && musicTrack && !selectedClipList().length) {
      clipClipboard = snapshotClipboardItem(musicTrack, "audio");
      setLocalStatus("Copied audio.");
      return true;
    }
    const list = selectedClipList();
    if (!list.length) {
      setLocalStatus("Select a clip, sound, or image to copy.", true);
      return false;
    }
    clipClipboard = {
      kind: "clips",
      items: list.map((clip) => snapshotClipboardItem(
        clip,
        (clip.source === "still" || clip.source === "image") ? "image" : "clip",
      )),
    };
    setLocalStatus(list.length > 1 ? `Copied ${list.length} clips.` : `Copied “${list[0].label || "clip"}”.`);
    return true;
  }

  function pasteClipboard() {
    if (clipClipboard?.kind === "clips" && clipClipboard.items?.length) {
      pushUndo();
      let idx = clipPasteIndex(clips, playheadSec);
      const newIds = [];
      for (const item of clipClipboard.items) {
        if (!item?.data) continue;
        const copy = {
          ...item.data,
          id: uid(),
          addedBy: localAuthor(),
        };
        clips.splice(idx, 0, copy);
        newIds.push(copy.id);
        idx += 1;
      }
      setSelection(newIds, newIds[0] || null, { anchor: newIds[0] || null });
      renderTimeline();
      const first = clips.find((c) => c.id === newIds[0]);
      if (first) previewClip(first);
      setLocalStatus(newIds.length > 1 ? `Pasted ${newIds.length} clips.` : `Pasted “${first?.label || "clip"}”.`);
      emitTimelineDraft();
      return true;
    }
    if (!clipClipboard?.data) {
      setLocalStatus("Nothing to paste.", true);
      return false;
    }
    if (clipClipboard.kind === "audio") {
      pushUndo();
      const file = clipClipboard.data.blob;
      if (file) setMusicFromFile(file, { history: false });
      else {
        musicTrack = {
          ...clipClipboard.data,
          id: uid("audio"),
          addedBy: localAuthor(),
        };
        setSelection([], null, { audio: true });
        renderTimeline();
        attachMusicToPlayback();
      }
      setLocalStatus("Pasted audio.");
      emitTimelineDraft();
      return true;
    }
    pushUndo();
    const copy = {
      ...clipClipboard.data,
      id: uid(),
      addedBy: localAuthor(),
    };
    const idx = clipPasteIndex(clips, playheadSec);
    clips.splice(idx, 0, copy);
    setSelection([copy.id], copy.id, { anchor: copy.id });
    renderTimeline();
    previewClip(copy);
    setLocalStatus(`Pasted “${copy.label || "clip"}”.`);
    emitTimelineDraft();
    return true;
  }

  function muteSelected() {
    if (selectedAudio && musicTrack) {
      setMusicMuted(!musicTrack.muted);
      return true;
    }
    const clip = selected();
    if (!clip) {
      setLocalStatus("Select a video or audio clip to mute.", true);
      return false;
    }
    setClipMuted(clip, !clip.muted);
    return true;
  }

  function clipAtAbs(abs) {
    let t = 0;
    const head = Number(abs) || 0;
    for (const c of clips) {
      const dur = clipEffectiveDuration(c);
      if (head < t + dur - 1e-3) return c;
      t += dur;
    }
    return clips[clips.length - 1] || null;
  }

  function localTimeOnClip(clip, abs) {
    const startAbs = absoluteTimeForClipStart(clip.id);
    const tin = Number(clip.trimIn) || 0;
    return tin + Math.max(0, (Number(abs) || 0) - startAbs);
  }

  function previewShowsClip(clip) {
    const el = getPreviewEl?.();
    if (!el || !clip?.url) return false;
    const src = el.getAttribute("src") || el.src || "";
    return src === clip.url;
  }

  function seekMediaElement(el, time) {
    return new Promise((resolve) => {
      if (!el) {
        resolve();
        return;
      }
      const t = Math.max(0, Number(time) || 0);
      const cur = Number(el.currentTime) || 0;
      if (mediaSeekIsAtTarget(cur, t, { ended: !!el.ended })) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        el.removeEventListener("seeked", done);
        resolve();
      };
      el.addEventListener("seeked", done);
      try {
        el.currentTime = t;
      } catch (_) {
        done();
        return;
      }
      setTimeout(done, 400);
    });
  }

  function seekBedToPlayhead() {
    const clock = musicClockAtPlayhead(playheadSec);
    const bed = host.querySelector("[data-vtl-bed]");
    if (!bed || clock == null) return;
    try { bed.currentTime = Math.max(0, clock); } catch (_) {}
  }

  /** Apply the timeline playhead to video + audio so Play starts here, not at 0 / the old ended time. */
  function seekTimelineTo(sec) {
    playheadSec = Math.max(0, Number(sec) || 0);
    const clip = clipAtAbs(playheadSec) || clips[0];
    if (clip && !selectedAudio) selectedId = clip.id;
    syncPlayhead();
    seekBedToPlayhead();
    if (!clip?.url) return Promise.resolve();
    const el = getPreviewEl?.();
    if (!el) return Promise.resolve();
    if (!previewShowsClip(clip)) previewClip(clip);
    return seekMediaElement(el, localTimeOnClip(clip, playheadSec));
  }

  function timeAtBoardClientX(clientX) {
    const el = host.querySelector("[data-vtl-board]");
    if (!el) return playheadSec;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + el.scrollLeft - 36) / Math.max(1, pxPerSec));
  }

  function syncZoomSlider() {
    const slider = host.querySelector("[data-vtl-zoom-slider]");
    if (slider && Number(slider.value) !== Math.round(pxPerSec)) slider.value = String(Math.round(pxPerSec));
  }

  function applyTimelineZoom(nextPx, originSec) {
    const boardEl = host.querySelector("[data-vtl-board]");
    const prev = pxPerSec;
    pxPerSec = Math.max(PX_PER_SEC_MIN, Math.min(PX_PER_SEC_MAX, Number(nextPx) || prev));
    syncZoomSlider();
    if (Math.abs(pxPerSec - prev) < 0.04) return;
    const origin = Number.isFinite(originSec) ? originSec : playheadSec;
    const originViewX = boardEl ? (36 + origin * prev) - boardEl.scrollLeft : 0;
    layoutClipsLive();
    if (boardEl) {
      boardEl.scrollLeft = Math.max(0, (36 + origin * pxPerSec) - originViewX);
    }
  }

  function scheduleTimelineZoom(nextPx, originSec) {
    pendingZoom = { nextPx, originSec };
    if (zoomRaf) return;
    zoomRaf = requestAnimationFrame(() => {
      zoomRaf = 0;
      const job = pendingZoom;
      pendingZoom = null;
      if (job) applyTimelineZoom(job.nextPx, job.originSec);
    });
  }

  function zoomTimeline(dir) {
    const next = dir > 0 ? pxPerSec * ZOOM_STEP : pxPerSec / ZOOM_STEP;
    applyTimelineZoom(next, playheadSec);
  }

  function fitTimelineToClips() {
    const boardEl = host.querySelector("[data-vtl-board]");
    pxPerSec = fitTimelinePxPerSec(projectSpanSec(), boardEl?.clientWidth || 640);
    syncZoomSlider();
    followPlayhead = false;
    layoutClipsLive();
    if (boardEl) boardEl.scrollLeft = 0;
  }

  function absoluteTimeForClipStart(clipId) {
    let t = 0;
    for (const c of clips) {
      if (c.id === clipId) return t;
      t += clipEffectiveDuration(c);
    }
    return 0;
  }

  function trimSelected(edge) {
    const clip = selectedTarget();
    if (!clip) {
      setLocalStatus("Select a clip first.", true);
      return;
    }
    const startAbs = (selectedAudio && musicTrack) ? 0 : absoluteTimeForClipStart(clip.id);
    const tin = Math.max(0, Number(clip.trimIn) || 0);
    const full = Math.max(0.1, Number(clip.duration) || 1);
    const tout = clip.trimOut != null ? Math.min(full, Number(clip.trimOut)) : full;
    const local = tin + (playheadSec - startAbs);
    if (edge === "in") {
      if (local <= tin || local >= tout - 0.08) {
        setLocalStatus("Move the playhead inside the clip to trim in.", true);
        return;
      }
      pushUndo();
      clip.trimIn = Math.max(0, local);
    } else {
      if (local <= tin + 0.08 || local >= tout) {
        setLocalStatus("Move the playhead inside the clip to trim out.", true);
        return;
      }
      pushUndo();
      clip.trimOut = Math.min(full, local);
    }
    renderTimeline();
    setLocalStatus(edge === "in" ? "Trimmed in." : "Trimmed out.");
  }

  function shortenAudioToSelectedClip() {
    if (!musicTrack) {
      setLocalStatus("Drop audio first.", true);
      return false;
    }
    const end = videoClipsEndSec(clips);
    if (!(end > 0.08)) {
      setLocalStatus("Add a video clip first.", true);
      return false;
    }
    shortenAudioToClipEnd(musicTrack, end);
    renderTimeline();
    setLocalStatus(`Audio shortened to ${end.toFixed(1)}s (end of clip).`);
    emitTimelineDraft({ immediate: true });
    return true;
  }

  function enterAudioTrimMode() {
    if (!musicTrack) {
      setLocalStatus("Drop audio first.", true);
      return false;
    }
    selectedAudio = true;
    selectedId = null;
    audioTrimMode = true;
    const { tin, tout } = audioTrimBounds(musicTrack);
    audioTrimSec = audioTrimLoopRestart(tin + Math.max(0, playheadSec), { tin, tout });
    setAudioTrimChrome(true);
    const panel = host.querySelector("[data-vtl-audio-trim]");
    panel?.classList.remove("hidden");
    if (panel) panel.hidden = false;
    renderTimeline();
    syncAudioTrimUi();
    try {
      const preview = typeof getPreviewEl === "function" ? getPreviewEl() : null;
      const wrap = preview?.closest?.(".video-editor-preview-wrap, .clip-editor-studio, .ref-viewer-stage-wrap--video");
      (wrap || preview)?.scrollIntoView({ block: "start", inline: "nearest" });
      panel?.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch (_) {}
    audioTrimLooping = true;
    paintAudioTrimWave(placeholderAmplitudePeaks(120), { live: false });
    void hydrateAudioTrimWave();
    void startAudioTrimListen({ fromSec: audioTrimSec, loop: true });
    setLocalStatus("Trim audio — scrub the bar, drag In / Out. Loops until Update.");
    return true;
  }

  function paintAudioTrimWave(heights, { live = false } = {}) {
    const el = host.querySelector("[data-vtl-audio-trim-wave]");
    if (!el) return;
    el.classList.toggle("is-placeholder", !live);
    el.innerHTML = waveformBarsHtml(heights);
  }

  async function hydrateAudioTrimWave() {
    const track = musicTrack;
    if (!track) return;
    const key = audioPersistKey(track.blob || track) || track.url || track.filename || track.id || "";
    if (Array.isArray(track.trimPeaks) && track.trimPeaks.length && track.trimPeaksKey === key) {
      paintAudioTrimWave(track.trimPeaks, { live: true });
      return;
    }
    let blob = (track.blob instanceof Blob && track.blob.size > 0) ? track.blob : null;
    if (!blob && track.url) {
      try {
        const token = typeof getToken === "function" ? getToken() : null;
        const res = await fetch(track.url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (res.ok) blob = await res.blob();
      } catch (_) { /* decode from attached blob only */ }
    }
    try { decodeAbort?.abort(); } catch (_) { /* ignore */ }
    decodeAbort = new AbortController();
    const signal = decodeAbort.signal;
    const peaks = blob
      ? await decodeAudioAmplitudePeaks(blob, { count: 160, signal })
      : amplitudePeaksFromSamples([], 160);
    if (destroyed || signal.aborted || musicTrack !== track) return;
    track.trimPeaks = peaks;
    track.trimPeaksKey = key;
    paintAudioTrimWave(peaks, { live: true });
  }

  function stopAudioTrimListen() {
    audioTrimLooping = false;
    const bed = host.querySelector("[data-vtl-bed]");
    if (bed && audioTrimOnTime) {
      bed.removeEventListener("timeupdate", audioTrimOnTime);
    }
    audioTrimOnTime = null;
    pauseBedAudio();
    applyBedMute();
  }

  function applyAudioTrimInputs() {
    if (!musicTrack) return;
    const inEl = host.querySelector("[data-vtl-audio-in]");
    const outEl = host.querySelector("[data-vtl-audio-out]");
    if (inEl) applyEdgeTrim(musicTrack, "in", Number(inEl.value) || 0);
    if (outEl) {
      const v = Number(outEl.value);
      applyEdgeTrim(musicTrack, "out", Number.isFinite(v) ? v : clipSourceDuration(musicTrack) || 0);
    }
  }

  function commitAudioTrimUpdate() {
    if (musicTrack) pushUndo();
    applyAudioTrimInputs();
    stopAudioTrimListen();
    renderTimeline();
    setLocalStatus("Audio trim updated. Looping stopped.");
    emitTimelineDraft({ immediate: true });
  }

  function exitAudioTrimMode() {
    if (!audioTrimMode) return;
    stopAudioTrimListen();
    audioTrimMode = false;
    setAudioTrimChrome(false);
    const panel = host.querySelector("[data-vtl-audio-trim]");
    panel?.classList.add("hidden");
    if (panel) panel.hidden = true;
    renderTimeline();
  }

  function finishAudioTrim() {
    if (!audioTrimMode) return false;
    if (musicTrack) pushUndo();
    applyAudioTrimInputs();
    const end = videoClipsEndSec(clips);
    if (musicTrack && end > 0.08) shortenAudioToClipEnd(musicTrack, end);
    stopAudioTrimListen();
    exitAudioTrimMode();
    emitTimelineDraft({ immediate: true });
    setLocalStatus(end > 0.08
      ? `Trim length — song from In, cut to ${end.toFixed(1)}s video.`
      : "Audio trim saved.");
    return true;
  }

  function clearEditorSelection() {
    hideClipMenu();
    if (!selectedId && !selectedIds.size && !selectedAudio) return false;
    selectedId = null;
    selectedIds = new Set();
    selectedAudio = false;
    selectionAnchor = null;
    renderTimeline();
    return true;
  }

  async function startAudioTrimListen({ fromSec, loop = true } = {}) {
    if (!musicTrack) return;
    const bounds = audioTrimBounds(musicTrack);
    audioTrimLooping = loop;
    audioTrimSec = audioTrimLoopRestart(fromSec != null ? fromSec : audioTrimSec, bounds);
    const bed = attachMusicToPlayback();
    if (!bed) return;
    if (audioTrimOnTime) bed.removeEventListener("timeupdate", audioTrimOnTime);
    audioTrimOnTime = () => {
      if (!audioTrimMode) return;
      const b = audioTrimBounds(musicTrack);
      let t = Number(bed.currentTime) || 0;
      if (audioTrimLooping) {
        const next = audioTrimLoopRestart(t, b);
        if (next !== t) {
          t = next;
          try { bed.currentTime = t; } catch (_) {}
          void bed.play?.();
        }
      }
      audioTrimSec = Math.max(0, Math.min(b.full, t));
      playheadSec = Math.max(0, audioTrimSec - b.tin);
      syncPlayhead();
    };
    bed.addEventListener("timeupdate", audioTrimOnTime);
    try { bed.currentTime = audioTrimSec; } catch (_) {}
    if (bed) {
      bed.muted = false;
      bed.volume = Math.max(0.2, Number(musicTrack.volume) || 0.35);
    }
    try { await bed.play?.(); } catch (_) {}
  }

  async function listenAudioTrim() {
    await startAudioTrimListen({ fromSec: audioTrimSec, loop: true });
  }

  function trimAtPlayhead() {
    const clip = selectedTarget();
    if (!clip) {
      setLocalStatus("Select a clip first.", true);
      return false;
    }
    const startAbs = (selectedAudio && musicTrack) ? 0 : absoluteTimeForClipStart(clip.id);
    const edge = trimEdgeForPlayhead(playheadSec, startAbs, clipEffectiveDuration(clip));
    if (!edge) {
      setLocalStatus("Move the playhead inside the clip to trim.", true);
      return false;
    }
    trimSelected(edge);
    return true;
  }

  function applyPlan(plan) {
    if (!plan) return;
    pushUndo();
    if (plan.transition === "crossfade") plan = { ...plan, transition: "dissolve" };
    if (plan.transition && ["cut", "fade", "dissolve"].includes(plan.transition)) {
      transitionMode = plan.transition;
    }
    if (plan.zoom) zoomMode = plan.zoom;
    if (plan.fadeDuration != null) fadeDuration = plan.fadeDuration;
    if (plan.muteClipAudio === true) {
      const clip = selected() || clips[0];
      if (clip) clip.muted = true;
    } else if (plan.muteClipAudio === false) {
      const clip = selected() || clips[0];
      if (clip) clip.muted = false;
    }
    if (plan.music === "disable" && musicTrack) musicTrack.muted = true;
    if (plan.splitAt === "playhead" || (typeof plan.splitAt === "number" && Number.isFinite(plan.splitAt))) {
      if (typeof plan.splitAt === "number") playheadSec = plan.splitAt;
      const next = splitClipAtPlayhead(clips, playheadSec);
      if (next !== clips) {
        clips = next;
        const hit = clips.find((c) => playheadHitsClip(clips, c.id, playheadSec, 0));
        if (hit) setSelection([hit.id], hit.id, { anchor: hit.id });
      }
    }
    applyPreviewMute(selected() || clipAtAbs(playheadSec) || clips[0]);
    applyBedMute();
    syncTransitionUi();
    renderTimeline();
    if (plan.summary?.length) setLocalStatus(`Applied: ${plan.summary.join(" · ")}`);
    emitTimelineDraft({ immediate: true });
  }

  async function resolveFilmEditPlan(prompt, fields) {
    const text = String(prompt || "").trim();
    if (!text) return null;
    const token = typeof getToken === "function" ? getToken() : null;
    const res = await fetch("/api/video/edit-prompt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        prompt: text,
        project_id: typeof getProjectId === "function" ? getProjectId() : null,
        ...fields,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || "The AI film-edit plan could not be created.");
    return data?.plan || null;
  }

  function needsBake() {
    if (clips.length > 1) return true;
    if (musicTrack && !musicTrack.muted) return true;
    if (transitionMode !== "cut") return true;
    if (zoomMode && zoomMode !== "none") return true;
    if (clips.some((c) => (c.transitionIn && c.transitionIn !== "cut") || (c.transitionOut && c.transitionOut !== "cut") || c.muted)) return true;
    const clip = clips[0];
    if (clip && ((Number(clip.trimIn) || 0) > 0.04 || clip.trimOut != null)) return true;

    return false;
  }

  function fillRandomExample() {
    const input = host.querySelector("[data-vtl-prompt]");
    if (!input) return;
    lastPromptExample = nextVideoEditorPromptExample(lastPromptExample);
    input.value = lastPromptExample;
    input.focus?.();
    setLocalStatus("Filled a random editor example — edit it, then Generate.");
  }

  function askRenderAgent() {
    const question = VIDEO_EDITOR_AGENT_QUESTION;
    if (typeof onAskRenderAgent === "function") {
      onAskRenderAgent({ question, autoSend: true });
      setLocalStatus("Opened Render Agent for deeper editor prompt examples.");
      return;
    }
    try {
      document.getElementById("btn-render-agent")?.click();
      const input = document.getElementById("render-agent-input");
      if (input && !String(input.value || "").trim()) input.value = question;
    } catch {
      /* ignore */
    }
  }

  async function improvePrompt() {
    const input = host.querySelector("[data-vtl-prompt]");
    const prompt = String(input?.value || "").trim();
    if (!prompt) {
      setLocalStatus("Write a video-edit prompt first.", true);
      return;
    }
    const btn = host.querySelector("[data-vtl-improve]");
    if (btn) btn.disabled = true;
    setLocalStatus("Improving video-edit prompt…");
    try {
      const token = typeof getToken === "function" ? getToken() : null;
      const res = await fetch("/api/video/improve-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt,
          project_id: typeof getProjectId === "function" ? getProjectId() : null,
          ...resolveKeyFields(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Prompt improvement unavailable.");
      const improved = String(data.improved_prompt || data.prompt || "").trim()
        || localImproveVideoPrompt(prompt);
      if (input) input.value = improved;
      if (data.plan) applyPlan(data.plan);
      setLocalStatus(data.model ? `Prompt improved (${data.model}).` : "Prompt improved.");
      return improved;
    } catch (err) {
      const improved = localImproveVideoPrompt(prompt);
      if (input) input.value = improved;
      setLocalStatus(err?.message || "Improved locally.");
      return improved;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function filmModelLabelFromFields(fields = {}) {
    const extra = typeof getAiKeyDisplay === "function" ? (getAiKeyDisplay() || {}) : {};
    const model = fields.model || extra.model || "";
    return extra.modelLabel || filmModelPillLabel(model, fields.provider || extra.provider) || model || "";
  }

  function paintGeneratingModel(modelLabel) {
    const label = String(modelLabel || "").trim();
    host.querySelectorAll("[data-vtl-gen-model]").forEach((el) => {
      el.textContent = label ? `Generating with ${label}` : "";
      el.hidden = !label;
    });
    const wrap = getPreviewEl?.()?.closest("[data-video-preview-wrap]");
    wrap?.querySelectorAll("[data-vtl-gen-model]").forEach((el) => {
      el.textContent = label ? `Generating with ${label}` : "";
      el.hidden = !label;
    });
    const spin = wrap?.querySelector("[data-video-film-spin], [data-vtl-preview-loading]");
    if (spin && label) {
      const msg = spin.querySelector("[data-vtl-preview-loading-msg]");
      if (msg) msg.textContent = `Generating film edit with ${label}…`;
    }
  }

  function hideFilmGeneratingOverlay() {
    const wrap = getPreviewEl?.()?.closest("[data-video-preview-wrap], .video-editor-preview-wrap, .ref-viewer-stage--video");
    wrap?.classList.remove("is-film-generating");
    host.classList.remove("is-film-generating");
    const spin = wrap?.querySelector("[data-video-film-spin]");
    if (spin) {
      spin.classList.add("hidden");
      spin.hidden = true;
    }
    if (!timelineHydrating && !anyClipPending()) {
      wrap?.querySelectorAll("[data-vtl-preview-loading]").forEach((el) => {
        el.classList.add("hidden");
        el.hidden = true;
      });
    }
  }

  function setFilmGenerating(on, meta = {}) {
    const fields = typeof getAiKeyBodyFields === "function" ? (getAiKeyBodyFields() || {}) : {};
    const modelLabel = meta.modelLabel || filmModelLabelFromFields({ ...fields, ...meta });
    try { onFilmGenerating?.(!!on, projectName, { model: meta.model || fields.model, modelLabel, provider: meta.provider || fields.provider }); } catch (_) {}
    host.classList.toggle("is-film-generating", !!on);
    const wrap = getPreviewEl?.()?.closest("[data-video-preview-wrap]");
    wrap?.classList.toggle("is-film-generating", !!on);
    paintGeneratingModel(on ? modelLabel : "");
    if (!on) hideFilmGeneratingOverlay();
  }

  function rememberFilmVersion({ prompt = "", blob = null, transition, zoom, fadeDuration: fade } = {}) {
    const entry = {
      ...makeFilmEditHistoryEntry({
        prompt,
        transition: transition || transitionMode,
        zoom: zoom || zoomMode,
        fadeDuration: fade ?? fadeDuration,
      }),
      clips: clips.map((c) => ({ ...c })),
      music: musicTrack ? { ...musicTrack } : null,
      outputBlob: blob || outputBlob || null,
    };
    filmHistory = appendFilmEditHistory(filmHistory, entry);
    renderFilmHistoryPop();
    emitTimelineDraft();
    return entry;
  }

  function restoreFilmVersion(id) {
    const row = filmEditHistoryById(filmHistory, id);
    if (!row) {
      setLocalStatus("That film-edit version is gone.", true);
      return false;
    }
    pushUndo();
    if (Array.isArray(row.clips) && row.clips.length) {
      clips = row.clips.map((c) => ({ ...c }));
    }
    musicTrack = row.music ? { ...row.music } : musicTrack;
    if (row.transition) transitionMode = row.transition;
    if (row.zoom) zoomMode = row.zoom;
    if (row.fadeDuration != null) fadeDuration = row.fadeDuration;
    if (row.outputBlob) {
      outputBlob = row.outputBlob;
      onOutputBlob?.(row.outputBlob);
      const preview = getPreviewEl?.();
      if (preview) {
        attachPreviewObjectUrl(preview, row.outputBlob, filmHistoryPreviewCreated);
      }
    }
    syncTransitionUi();
    renderTimeline();
    hideFilmHistoryPop();
    setLocalStatus("Restored that film-edit version.");
    emitTimelineDraft({ immediate: true });
    return true;
  }

  function hideFilmHistoryPop() {
    const pop = host.querySelector("[data-vtl-film-history-pop]");
    pop?.classList.add("hidden");
    if (pop) pop.hidden = true;
    const compose = host.querySelector("[data-vtl-prompt-compose]");
    if (compose) compose.hidden = false;
    host.querySelector("[data-vtl-film-history]")?.setAttribute("aria-expanded", "false");
  }

  function renderFilmHistoryPop() {
    const pop = host.querySelector("[data-vtl-film-history-pop]");
    if (!pop) return;
    if (!filmHistory.length) {
      pop.innerHTML = `<p class="muted small">Generate a film edit to keep versions here.</p>`;
      return;
    }
    pop.innerHTML = `<strong>Film-edit history</strong>${filmHistory.slice().reverse().map((row) => {
      const when = new Date(row.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const title = escapeHtml((row.prompt || "Film edit").slice(0, 72));
      return `<div class="vtl-film-history-row" data-vtl-film-row="${escapeHtml(row.id)}">
        <span>${title}</span>
        <span class="muted small">${escapeHtml(when)}</span>
        <button type="button" class="vtl-tool" data-vtl-film-use="${escapeHtml(row.id)}">Use prompt</button>
        <button type="button" class="vtl-tool" data-vtl-film-restore="${escapeHtml(row.id)}">Restore</button>
      </div>`;
    }).join("")}`;
  }

  function toggleFilmHistoryPop() {
    const pop = host.querySelector("[data-vtl-film-history-pop]");
    if (!pop) return;
    const open = pop.classList.contains("hidden");
    renderFilmHistoryPop();
    pop.classList.toggle("hidden", !open);
    pop.hidden = !open;
    const compose = host.querySelector("[data-vtl-prompt-compose]");
    if (compose) compose.hidden = open;
    host.querySelector("[data-vtl-film-history]")?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function setVideoMixVolume(raw) {
    const n = Number(raw);
    videoMixVolume = Math.max(0, Math.min(1, n > 1 ? n / 100 : n || 0));
    for (const c of clips) c.volume = videoMixVolume;
    applyPreviewMute(selected() || clipAtAbs(playheadSec) || clips[0]);
    emitTimelineDraft();
  }

  function setMusicMixVolume(raw) {
    const vol = Number(raw) > 1 ? Number(raw) / 100 : Number(raw);
    pendingMusicVolume = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 0.35));
    if (musicTrack) {
      musicTrack.volume = pendingMusicVolume;
      applyBedMute();
    }
    emitTimelineDraft();
  }

  function applyTransitionTable(edge, mode) {
    const ids = selectedIds.size
      ? [...selectedIds]
      : (selectedId ? [selectedId] : clips.map((c) => c.id));
    if (!ids.length) {
      setLocalStatus("Select a clip to apply a transition.", true);
      return;
    }
    pushUndo();
    for (const id of ids) {
      const clip = clips.find((c) => c.id === id);
      if (clip) setClipEdgeTransition(clip, edge === "end" ? "end" : "start", mode);
    }
    if (mode === "dissolve") transitionMode = "dissolve";
    else if (mode === "fade" && transitionMode === "cut") transitionMode = "fade";
    else if (mode === "cut") transitionMode = "cut";
    syncTransitionUi();
    renderTimeline();
    setLocalStatus(`Applied ${mode} at ${edge === "end" ? "end" : "start"}.`);
    emitTimelineDraft({ immediate: true });
  }

  function toggleTransPop() {
    const pop = host.querySelector("[data-vtl-trans-pop]");
    const btn = host.querySelector("[data-vtl-trans-toggle]");
    if (!pop) return;
    const open = pop.classList.contains("hidden");
    pop.classList.toggle("hidden", !open);
    pop.hidden = !open;
    btn?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  let filmJobTrace = "";
  let filmPollTimer = 0;
  let filmWaitPromise = null;
  let filmProgressListener = null;
  let appliedFilmTrace = "";

  function stopFilmPoll() {
    if (filmPollTimer) {
      clearInterval(filmPollTimer);
      filmPollTimer = 0;
    }
  }

  function filmFileHref(pid, job) {
    const url = String(job?.url || "").trim();
    if (url) return url;
    const filename = String(job?.path || job?.filename || "").trim();
    if (!pid || !filename) return "";
    const rel = filename.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
    return `/api/projects/${encodeURIComponent(pid)}/files/${rel}`;
  }

  async function fetchProjectGeneration() {
    const pid = typeof getProjectId === "function" ? getProjectId() : "";
    const token = typeof getToken === "function" ? getToken() : null;
    if (!pid || !token) return null;
    const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/generation`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }

  async function fetchGeneratedFilmBlob(job) {
    const pid = typeof getProjectId === "function" ? getProjectId() : "";
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) return null;
    const href = filmFileHref(pid, job);
    if (!href) return null;
    const res = await fetch(href, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error("The edited video could not be loaded. Try reopening the editor.");
    return new Blob([await res.arrayBuffer()], { type: res.headers.get("content-type") || "video/mp4" });
  }

  function paintFilmProgress(job, gen) {
    const progress = job?.progress || gen?.progress || {};
    const pct = Number(progress.pct);
    const bar = host.querySelector("[data-vtl-progress-bar]");
    if (bar && Number.isFinite(pct) && pct > 0) bar.style.width = `${Math.max(8, Math.min(96, pct))}%`;
    const label = String(progress.label || "").trim();
    if (label) setLocalStatus(label);
    if (typeof filmProgressListener === "function") {
      filmProgressListener({
        stage: "encode",
        percent: Number.isFinite(pct) ? pct : undefined,
        pct: Number.isFinite(pct) ? pct : undefined,
        label,
      });
    }
  }

  function applyFilmResultToTimeline({
    url = "",
    blob = null,
    sourcePath = "",
    label = "Film edit",
    traceId = "",
    duration = 0,
  } = {}) {
    const tid = String(traceId || filmJobTrace || "");
    if (tid && tid === appliedFilmTrace) {
      const clip = clips[0];
      if (blob) {
        outputBlob = blob;
        onOutputBlob?.(blob);
        if (clip) clip.blob = blob;
      }
      if (sourcePath && clip) {
        clip.sourcePath = clip.sourcePath || sourcePath;
        clip.filename = clip.filename || sourcePath;
      }
      const preview = getPreviewEl?.();
      if (preview && url && preview.src && !String(preview.src).includes(String(url).split("?")[0])) {
        preview.src = filmResultPlaybackUrl(url);
        try { preview.currentTime = 0; } catch (_) {}
      }
      return clip || null; // leakfix33: do not createObjectURL on same-trace reuse
    }
    const playback = url
      ? filmResultPlaybackUrl(url)
      : (blob ? URL.createObjectURL(blob) : "");
    if (!playback) return null;
    appliedFilmTrace = tid;
    pushUndo();
    if (blob) {
      outputBlob = blob;
      onOutputBlob?.(blob);
    }
    const clip = {
      id: uid(),
      source: "film-edit",
      label: String(label || "Film edit").replace(/\.[^.]+$/, "").slice(0, 80),
      blob: blob || null,
      url: playback,
      filename: sourcePath || "",
      sourcePath: sourcePath || "",
      ownedUrl: !!blob && String(playback).startsWith("blob:"),
      duration: Number(duration) > 0.05 ? Number(duration) : 0,
      pending: false,
      trimIn: 0,
      trimOut: null,
      muted: false,
      transitionIn: null,
      transitionOut: null,
      addedBy: localAuthor(),
    };
    clips = [clip];
    // Audio is now baked into the result; do not play or mix the bed twice.
    if (musicTrack) musicTrack.muted = true;
    pauseBedAudio();
    transitionMode = "cut";
    zoomMode = "none";
    playheadSec = 0;
    setSelection([clip.id], clip.id, { anchor: clip.id });
    const preview = getPreviewEl?.();
    if (preview) {
      preview.pause();
      preview.src = playback;
      preview.load();
      try { preview.currentTime = 0; } catch (_) {}
      preview.onloadeddata = () => {
        const d = finiteMediaDuration(preview);
        if (d > 0.05) adoptMediaDuration(clip, d);
        // Keep this URL alive for timeline playback and undo/redo.
        renderTimeline();
      };
    }
    syncTransitionUi();
    renderTimeline();
    emitTimelineDraft({ immediate: true });
    setFilmGenerating(false);
    return clip;
  }

  const filmResultLoads = new Map();
  async function applyReadyFilmJob(job) {
    if (!job || destroyed || mediaParked) return null;
    const tid = String(job.trace_id || job.id || filmJobTrace || "");
    if (tid && appliedFilmTrace === tid) return clips[0] || null;
    if (filmResultLoads.has(tid)) return filmResultLoads.get(tid);
    const task = (async () => {
      setLocalStatus("Loading edited video…");
      // <video src> cannot send our Authorization header. Load once with auth
      // and use that same blob for playback, downloads, and the next edit.
      const blob = await fetchGeneratedFilmBlob(job);
      if (!blob) throw new Error("The edited video is not available yet.");
      if (destroyed || mediaParked || (filmJobTrace && tid !== filmJobTrace)) return null;
      return applyFilmResultToTimeline({
        blob,
        sourcePath: String(job.path || job.filename || "").trim(),
        label: "Film edit", traceId: tid, duration: Number(job.duration) || 0,
      });
    })();
    filmResultLoads.set(tid, task);
    try { return await task; }
    finally { filmResultLoads.delete(tid); }
  }

  function attachFilmJob(job, { modelLabel } = {}) {
    if (!job) return;
    filmJobTrace = String(job.trace_id || job.id || "");
    const label = modelLabel
      || filmModelPillLabel(job.model, job.provider)
      || String(job.model || "").trim();
    setFilmGenerating(true, { model: job.model, provider: job.provider, modelLabel: label });
    setLocalStatus(label ? `Generating with ${label}…` : "Generating film edit…");
  }

  async function waitForFilmJob(traceId) {
    const wanted = String(traceId || filmJobTrace || "").trim();
    if (filmWaitPromise && (!wanted || !filmJobTrace || String(filmJobTrace) === wanted)) {
      return filmWaitPromise;
    }
    filmJobTrace = wanted || filmJobTrace;
    stopFilmPoll();
    const started = Date.now();
    const pending = new Promise((resolve, reject) => {
      let finishing = false;
      let polling = false;
      const finishOk = async (job) => {
        if (finishing) return;
        finishing = true;
        stopFilmPoll();
        let clip;
        try { clip = await applyReadyFilmJob(job); }
        catch (err) { setFilmGenerating(false); reject(err); return; }
        setFilmGenerating(false);
        setLocalStatus("");
        resolve(clip || job || true);
      };
      const tick = async () => {
        if (destroyed) {
          stopFilmPoll();
          setFilmGenerating(false);
          resolve(null);
          return;
        }
        if (finishing || polling) return;
        if (Date.now() - started > 45 * 60 * 1000) {
          stopFilmPoll();
          setFilmGenerating(false);
          reject(new Error("Film edit timed out."));
          return;
        }
        try {
          polling = true;
          const gen = await fetchProjectGeneration();
          const job = videoJobFromGeneration(gen, wanted);
          if (!job || finishing) return;
          const status = String(job.status || "").toLowerCase();
          if (status === "running") {
            paintFilmProgress(job, gen);
            // Keep the actual render stage visible instead of resetting it to Generating.
            return;
          }
          if (status === "failed" || status === "canceled") {
            stopFilmPoll();
            setFilmGenerating(false);
            finishing = true;
            reject(new Error(job.error || "Film edit failed."));
            return;
          }
          const pid = typeof getProjectId === "function" ? getProjectId() : "";
          if (!filmFileHref(pid, job) && !job.filename && !job.path) return;
          if (status === "complete" || filmJobIsReady(job)) {
            finishOk(job);
          }
        } catch (err) {
          if (err?.name !== "AbortError") setLocalStatus("Reconnecting to edit progress…");
        } finally { polling = false; }
      };
      void tick();
      filmPollTimer = setInterval(tick, 400);
    });
    filmWaitPromise = pending;
    return pending.finally(() => {
      if (filmWaitPromise === pending) filmWaitPromise = null;
    });
  }

  async function resumeFilmJobFromProject() {
    try {
      const gen = await fetchProjectGeneration();
      const job = videoJobFromGeneration(gen, filmJobTrace);
      if (job && String(job.status || "") === "running") {
        attachFilmJob(job);
        return waitForFilmJob(job.trace_id || job.id);
      }
      if (job && (String(job.status || "") === "complete" || filmJobIsReady(job))) {
        await applyReadyFilmJob(job);
        return job;
      }
    } catch (_) { /* reconnect is best-effort */ }
    return null;
  }

  async function generateEdit({ applyPrompt = true, updatePreview = true, onProgress } = {}) {
    if (destroyed || mediaParked) return null;
    if (busy || improvingForGenerate) return null;
    if (!clips.length) {
      setLocalStatus("Drop at least one video clip first.", true);
      return null;
    }
    const originalPrompt = String(host.querySelector("[data-vtl-prompt]")?.value || "").trim();
    let prompt = originalPrompt;
    if (originalPrompt && host.querySelector("[data-vtl-auto-improve]")?.checked) {
      improvingForGenerate = true;
      const generateButton = host.querySelector("[data-vtl-generate]");
      if (generateButton) generateButton.disabled = true;
      try { prompt = await improvePrompt() || originalPrompt; }
      finally {
        improvingForGenerate = false;
        if (generateButton && !destroyed) generateButton.disabled = false;
      }
    }
    if (destroyed || mediaParked) return null;
    const spotifyUrls = extractSpotifyMusicUrls(originalPrompt);
    if (!needsBake() && !prompt) {
      outputBlob = clips[0].blob;
      onOutputBlob?.(outputBlob);
      if (updatePreview !== false) previewClip(clips[0]);
      setLocalStatus("Single clip ready.");
      return outputBlob;
    }
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) {
      setLocalStatus("Sign in to generate the edited clip.", true);
      return null;
    }
    const projectIdForJob = typeof getProjectId === "function" ? getProjectId() : "";
    if (!projectIdForJob) {
      setLocalStatus("Open a project to generate a film edit.", true);
      return null;
    }
    const fields = resolveKeyFields();
    if (applyPrompt !== false && originalPrompt) {
      try {
        const plan = await resolveFilmEditPlan(originalPrompt, fields);
        applyPlan(plan || parseFilmEditPrompt(originalPrompt));
      } catch (_) {
        applyPlan(parseFilmEditPrompt(originalPrompt));
      }
    }
    busy = true;
    const exportStartHeap = heapMbNow();
    setDesktopPerfScope("video-editor-export");
    const prevFilmProgress = filmProgressListener;
    if (typeof onProgress === "function") {
      filmProgressListener = onProgress;
      onProgress({ stage: "upload", percent: 8 });
    }
    const go = host.querySelector("[data-vtl-generate]");
    const progress = host.querySelector("[data-vtl-progress]");
    const bar = host.querySelector("[data-vtl-progress-bar]");
    const spin = host.querySelector("[data-vtl-gen-spin]");
    if (go) go.disabled = true;
    progress?.classList.remove("hidden");
    spin?.classList.remove("hidden");
    if (spin) spin.hidden = false;
    if (bar) bar.style.width = "8%";
    const modelLabel = filmModelLabelFromFields(fields);
    setFilmGenerating(true, { model: fields.model, provider: fields.provider, modelLabel });
    setLocalStatus(modelLabel ? `Generating with ${modelLabel}…` : "Generating film edit…");
    try {
      const form = new FormData();
      form.append("format", "mp4");
      form.append("transition", transitionMode === "dissolve" ? "crossfade" : (transitionMode || "cut"));
      form.append("fade_duration", String(fadeDuration || 0.6));
      form.append("zoom", zoomMode || "none");
      form.append("prompt", prompt);
      form.append("intent_prompt", originalPrompt);
      form.append("editor_name", projectName);
      const pid = typeof getProjectId === "function" ? getProjectId() : "";
      if (pid) form.append("project_id", pid);
      if (fields.ai_key_id) form.append("ai_key_id", fields.ai_key_id);
      if (fields.ai_key_source) form.append("ai_key_source", fields.ai_key_source);
      if (fields.model) form.append("model", fields.model);
      form.append("clip_count", String(clips.length));
      let uploaded = 0;
      let pathRefs = 0;
      for (let i = 0; i < clips.length; i += 1) {
        const clip = clips[i];
        const pathRef = String(clip.sourcePath || clip.filename || "").trim();
        if (pathRef) {
          form.append(`clip_path_${i}`, pathRef);
          pathRefs += 1;
        } else {
          const blob = await clipBytesForGenerate(clip);
          if (appendFormBlob(form, `clip_file_${i}`, blob, clipUploadName({ ...clip, blob }, i))) {
            uploaded += 1;
          }
        }
        form.append(`duration_${i}`, String(clipSourceDuration(clip) || 0));
        form.append(`trim_in_${i}`, String(Number(clip.trimIn) || 0));
        form.append(`trim_out_${i}`, clip.trimOut != null ? String(clip.trimOut) : "");
        form.append(`label_${i}`, clip.label || `clip ${i + 1}`);
        const tinMode = clip.transitionIn || transitionMode || "cut";
        const toutMode = clip.transitionOut || transitionMode || "cut";
        form.append(`fade_in_${i}`, tinMode !== "cut" ? "1" : "0");
        form.append(`fade_out_${i}`, toutMode !== "cut" ? "1" : "0");
        form.append(`mute_${i}`, clip.muted ? "1" : "0");
      }
      if (!uploaded && !pathRefs) {
        throw new Error("Could not read the clip. Re-open the recording and try Generate again.");
      }
      if (musicTrack && !musicTrack.muted) {
        let musicBlob = isFormBlob(musicTrack.blob) ? musicTrack.blob : null;
        if (!musicBlob) musicBlob = await blobFromHref(musicTrack.url);
        if (musicBlob) musicTrack.blob = musicBlob;
        if (appendFormBlob(form, "music", musicBlob, musicTrack.name || musicTrack.filename || "music.mp3")) {
          form.append("music_volume", String(musicTrack.volume ?? 0.35));
          form.append("music_trim_in", String(Number(musicTrack.trimIn) || 0));
          if (musicTrack.trimOut != null) form.append("music_trim_out", String(musicTrack.trimOut));
          form.append("music_start_sec", String(Number(musicTrack.startSec) || 0));
        }
      }
      if (bar) bar.style.width = "22%";
      onProgress?.({ stage: "upload", percent: 22 });
      generateAbort?.abort();
      generateAbort = new AbortController();
      const res = await fetch("/api/video/film-edit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: generateAbort.signal,
      });
      if (destroyed) return null;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data?.detail === "string" ? data.detail : "Film edit failed.");
      }
      const contentType = String(res.headers.get("content-type") || "");
      rememberFilmVersion({ prompt, transition: transitionMode, zoom: zoomMode, fadeDuration });
      let result = null;
      if (res.status === 202 || contentType.includes("json")) {
        const data = await res.json().catch(() => ({}));
        filmJobTrace = String(data.trace_id || data.generation?.trace_id || "");
        const liveLabel = filmModelPillLabel(data.model || data.generation?.model, data.provider)
          || modelLabel;
        attachFilmJob({
          ...data.generation,
          trace_id: filmJobTrace,
          model: data.model || data.generation?.model,
          provider: data.provider || data.generation?.provider,
          status: "running",
          kind: "video",
        }, { modelLabel: liveLabel });
        window.dispatchEvent(new CustomEvent("render3d:video-generation", {
          detail: {
            ...data.generation,
            trace_id: filmJobTrace,
            model: data.model || data.generation?.model,
            provider: data.provider || data.generation?.provider,
            status: "running",
            kind: "video",
            projectId: projectIdForJob,
          },
        }));
        if (bar) bar.style.width = "36%";
        onProgress?.({ stage: "encode", percent: 36 });
        result = await waitForFilmJob(filmJobTrace);
        if (!result) return null;
      } else {
        const blob = new Blob([await res.arrayBuffer()], {
          type: contentType || "video/mp4",
        });
        result = applyFilmResultToTimeline({ blob, label: "Film edit" });
      }
      if (bar) bar.style.width = "100%";
      onProgress?.({ stage: "done", percent: 100 });
      if (destroyed || mediaParked) return null;
      if (/^(video editor|viewport clip)$/i.test(projectName) && prompt) {
        setProjectName(defaultVideoEditorProjectName({ prompt, label: projectName }));
      }
      setLocalStatus(spotifyUrls.length && !musicTrack
        ? "Generated. Spotify links stay in the prompt — drop the track on A to attach it."
        : "");
      return outputBlob || clips[0]?.blob || result;
    } catch (err) {
      if (destroyed || mediaParked || err?.name === "AbortError") return null;
      setFilmGenerating(false);
      setLocalStatus(err?.message || "Could not generate the edit.", true);
      return null;
    } finally {
      filmProgressListener = prevFilmProgress;
      busy = false;
      const exportEndHeap = heapMbNow();
      if (shouldStampHeapJump(exportStartHeap, exportEndHeap)) {
        try {
          globalThis.dispatchEvent?.(new CustomEvent("studio-credit-incident", {
            detail: {
              eventType: "heap.jump",
              memMb: exportEndHeap,
              prevMb: exportStartHeap,
              scope: "video-editor-export",
              note: `Video editor export heap ${exportStartHeap}→${exportEndHeap} MB`,
            },
          }));
        } catch (_) { /* stamp is best-effort */ }
      }
      setDesktopPerfScope("video-timeline-editor");
      setFilmGenerating(false);
      if (!destroyed && go) go.disabled = false;
      if (!destroyed) {
        progress?.classList.add("hidden");
        spin?.classList.add("hidden");
        if (spin) spin.hidden = true;
      }
    }
  }

  function openGear(btn) {
    syncFilmKeyPill();
    if (typeof onOpenAiKeyPicker === "function") {
      onOpenAiKeyPicker(btn);
      queueMicrotask(() => syncFilmKeyPill());
      return;
    }
    const state = getAiKeyPickerState?.() || { options: [], selected: localKeyValue };
    const options = Array.isArray(state.options) ? state.options : [];
    if (!options.length) {
      setLocalStatus("Add an AI key or connect a subscription in Studio.", true);
      return;
    }
    const preferred = state.selected || localKeyValue || defaultVideoAiKeyValue(options, state.selected);
    const pick = window.prompt(
      "AI key or subscription:\n" + options.map((o) => o.value || o).join("\n"),
      preferred,
    );
    if (!pick) return;
    localKeyValue = pick;
    try { setAiKeyPickerValue?.(pick); } catch (_) {}
    syncFilmKeyPill();
    setLocalStatus("Using selected AI source for video edits.");
  }

  let pickerMode = "all";
  let ignoreTimelineClicksUntil = 0;

  function armPickerClickGuard() {
    ignoreTimelineClicksUntil = Date.now() + 700;
  }

  function openMediaPicker(mode = "all") {
    const input = host.querySelector("[data-vtl-file]");
    if (!input) return;
    pickerMode = mode === "audio" ? "audio" : "all";
    input.accept = pickerMode === "audio"
      ? "audio/*,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.aiff,.aif,.wma,.caf"
      : "video/*,audio/*,image/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.png,.jpg,.jpeg,.gif,.webp,.webm,.mp4,.mov,.m4v";
    try { input.value = ""; } catch (_) {}
    const stopBubble = (ev) => ev.stopPropagation();
    input.addEventListener("click", stopBubble, { capture: true, once: true });
    input.click();
  }

  function ingestFiles(files, e, opts = {}) {
    const list = [...(files || [])].filter(Boolean);
    const forceAudio = opts.forceAudio === true || pickerMode === "audio";
    const overAudio = forceAudio || opts.overAudio === true || dropIsOverAudioLane(e);
    pickerMode = "all";
    const plan = planDroppedMedia(list, { overAudio, forceAudio });
    for (const file of plan.audio) setMusicFromFile(file);
    const lastVideo = plan.video[plan.video.length - 1];
    for (const file of plan.video) {
      void addClip({ blob: file, source: "upload", label: file.name, attachPreview: file === lastVideo });
    }
    const lastImage = plan.image[plan.image.length - 1];
    for (const file of plan.image) {
      void addClip({ blob: file, source: "still", label: file.name, attachPreview: file === lastImage });
    }
    if (list.length && !plan.audio.length && !plan.video.length && !plan.image.length) {
      setLocalStatus("Drop a video, photo, or audio file.", true);
    }
  }

  host.addEventListener("click", (e) => {
    const viewProfile = e.target.closest("[data-vtl-view-profile]");
    if (viewProfile) {
      e.preventDefault();
      e.stopPropagation();
      hideAvatarPop();
      try { onOpenProfile?.({ userId: viewProfile.dataset.vtlViewProfile }); } catch (_) {}
      return;
    }
    const avatar = e.target.closest("[data-vtl-avatar]");
    if (avatar) {
      e.preventDefault();
      e.stopPropagation();
      showAvatarPop(avatar);
      return;
    }
    if (!e.target.closest("[data-vtl-avatar-pop]")) hideAvatarPop();
    if (e.target.closest("[data-vtl-updates-toggle]")) {
      updatesOpen = !updatesOpen;
      renderUpdates();
      return;
    }
    if (e.target.closest("[data-vtl-project-name]") && e.target.tagName === "BUTTON") {
      beginProjectRename();
      return;
    }
    if (e.target.closest("[data-vtl-undo]")) {
      e.preventDefault();
      undoTimeline();
      return;
    }
    if (e.target.closest("[data-vtl-redo]")) {
      e.preventDefault();
      redoTimeline();
      return;
    }
    const zoomBtn = e.target.closest("[data-vtl-zoom]");
    if (zoomBtn) {
      e.preventDefault();
      const act = zoomBtn.dataset.vtlZoom;
      if (act === "in") zoomTimeline(1);
      else if (act === "out") zoomTimeline(-1);
      else if (act === "fit") fitTimelineToClips();
      return;
    }
    if (e.target.closest("[data-vtl-trans-toggle]")) {
      e.preventDefault();
      toggleTransPop();
      return;
    }
    const transApply = e.target.closest("[data-vtl-trans-apply]");
    if (transApply) {
      e.preventDefault();
      applyTransitionTable(transApply.dataset.vtlTransApply, transApply.dataset.vtlMode || "cut");
      return;
    }
    if (e.target.closest("[data-vtl-film-history]")) {
      e.preventDefault();
      toggleFilmHistoryPop();
      return;
    }
    const restore = e.target.closest("[data-vtl-film-restore]");
    if (restore) {
      e.preventDefault();
      restoreFilmVersion(restore.dataset.vtlFilmRestore);
      return;
    }
    const useFilmPrompt = e.target.closest("[data-vtl-film-use]");
    if (useFilmPrompt) {
      const row = filmEditHistoryById(filmHistory, useFilmPrompt.dataset.vtlFilmUse);
      const input = host.querySelector("[data-vtl-prompt]");
      if (row && input) input.value = row.prompt || "";
      hideFilmHistoryPop();
      return;
    }
    const trans = e.target.closest("[data-vtl-transition]");
    if (trans) {
      transitionMode = trans.dataset.vtlTransition || "cut";
      syncTransitionUi();
      renderTimeline();
      return;
    }
    const tool = e.target.closest("[data-vtl-tool]");
    if (tool) {
      const id = tool.dataset.vtlTool;
      if (id === "trim-in") trimSelected("in");
      else if (id === "trim-out") trimSelected("out");
      else if (id === "trim") trimAtPlayhead();
      else if (id === "split") splitSelectedAtPlayhead();
      else if (id === "remove") removeSelected();
      else if (id === "add-audio") openMediaPicker("audio");
      else if (id === "add") openMediaPicker("all");
      return;
    }
    if (Date.now() < ignoreTimelineClicksUntil
      && e.target.closest("[data-vtl-music-clear], [data-vtl-clear='audio']")) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.target.closest("[data-vtl-music-clear], [data-vtl-clear='audio']")) {
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() < ignoreTimelineClicksUntil) return;
      clearMusic();
      return;
    }
    const clipClear = e.target.closest("[data-vtl-clear='clip']");
    if (clipClear) {
      e.preventDefault();
      e.stopPropagation();
      const clipEl = clipClear.closest("[data-vtl-clip]");
      const clip = clips.find((c) => c.id === clipEl?.dataset.vtlClip) || selected();
      removeClip(clip);
      hideClipMenu();
      return;
    }
    const muteBtn = e.target.closest("[data-vtl-mute]");
    if (muteBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (muteBtn.dataset.vtlMute === "audio") {
        setMusicMuted(!musicTrack?.muted);
      } else {
        const clipEl = muteBtn.closest("[data-vtl-clip]");
        const clip = clips.find((c) => c.id === clipEl?.dataset.vtlClip) || selected();
        if (clip) setClipMuted(clip, !clip.muted);
      }
      return;
    }
    const downloadFmt = e.target.closest("[data-vtl-download]");
    if (downloadFmt && downloadFmt.dataset.vtlDownload) {
      e.preventDefault();
      const clip = selected() || clips[0];
      void downloadClipBlob(downloadFmt.dataset.vtlDownload, clip);
      return;
    }
    if (e.target.closest("[data-vtl-menu-act='download-toggle']")) {
      e.preventDefault();
      const wrap = e.target.closest("[data-vtl-download-wrap]");
      const panel = wrap?.querySelector("[data-vtl-download-menu]");
      const btn = wrap?.querySelector("[data-vtl-menu-act='download-toggle']");
      const open = panel?.classList.contains("hidden");
      panel?.classList.toggle("hidden", !open);
      if (panel) panel.hidden = !open;
      btn?.setAttribute("aria-expanded", open ? "true" : "false");
      placeClipMenu(lastMenuPoint.x, lastMenuPoint.y);
      return;
    }
    const transAct = e.target.closest("[data-vtl-menu-act='transition']");
    if (transAct) {
      e.preventDefault();
      const clip = selected();
      applyClipTransition(clip, transAct.dataset.vtlEdge, transAct.dataset.vtlMode);
      hideClipMenu();
      return;
    }
    if (e.target.closest("[data-vtl-menu-act='split']")) {
      e.preventDefault();
      splitSelectedAtPlayhead();
      hideClipMenu();
      return;
    }
    if (e.target.closest("[data-vtl-menu-act='mute']")) {
      e.preventDefault();
      const kind = host.querySelector("[data-vtl-menu]")?.dataset?.vtlMenuKind;
      if (kind === "audio") setMusicMuted(!musicTrack?.muted);
      else {
        const clip = selected();
        if (clip) setClipMuted(clip, !clip.muted);
      }
      hideClipMenu();
      return;
    }
    if (e.target.closest("[data-vtl-menu-act='remove']")) {
      e.preventDefault();
      removeSelected();
      hideClipMenu();
      return;
    }
    if (e.target.closest("[data-vtl-menu-act='copy']")) {
      e.preventDefault();
      copySelected();
      hideClipMenu();
      return;
    }
    if (e.target.closest("[data-vtl-menu-act='paste']")) {
      e.preventDefault();
      pasteClipboard();
      hideClipMenu();
      return;
    }
    if (e.target.closest("[data-vtl-menu-act='shorten-audio']")) {
      e.preventDefault();
      shortenAudioToSelectedClip();
      hideClipMenu();
      return;
    }
    if (e.target.closest("[data-vtl-menu-act='trim-audio']")) {
      e.preventDefault();
      enterAudioTrimMode();
      hideClipMenu();
      return;
    }
    if (e.target.closest("[data-vtl-audio-trim-play]")) {
      e.preventDefault();
      void startAudioTrimListen({ fromSec: audioTrimSec, loop: true });
      return;
    }
    if (e.target.closest("[data-vtl-audio-trim-update]")) {
      e.preventDefault();
      commitAudioTrimUpdate();
      return;
    }
    if (e.target.closest("[data-vtl-audio-trim-done]")) {
      e.preventDefault();
      e.stopPropagation();
      finishAudioTrim();
      return;
    }
    if (e.target.closest("[data-vtl-menu-act='duplicate']")) {
      e.preventDefault();
      duplicateSelected();
      hideClipMenu();
      return;
    }
    if (!e.target.closest("[data-vtl-menu]")) hideClipMenu();
    if (e.target.closest("[data-vtl-example]")) {
      fillRandomExample();
      return;
    }
    if (e.target.closest("[data-vtl-ask-agent]")) {
      askRenderAgent();
      return;
    }
    if (e.target.closest("[data-vtl-prompt-help]")) {
      e.preventDefault();
      return;
    }
    if (e.target.closest("[data-vtl-improve]")) {
      void improvePrompt();
      return;
    }
    if (e.target.closest("[data-vtl-generate]")) {
      void generateEdit();
      return;
    }
    const gear = e.target.closest("[data-vtl-gear]");
    if (gear) {
      e.stopPropagation();
      openGear(gear);
      return;
    }
    const clipBtn = e.target.closest("[data-vtl-clip]");
    if (clipBtn && !e.target.closest("[data-vtl-trim], [data-vtl-mute], [data-vtl-clear]")) {
      const id = clipBtn.dataset.vtlClip;
      if (e.shiftKey && (selectionAnchor || selectedId)) {
        const ids = clipRangeIds(clips, selectionAnchor || selectedId, id);
        setSelection(ids, id);
      } else {
        setSelection([id], id, { anchor: id });
      }
      renderTimeline();
      const clip = selected();
      if (clip) previewClip(clip);
      return;
    }
    const musicBlock = e.target.closest("[data-vtl-music-block]");
    if (musicBlock && !e.target.closest("[data-vtl-trim], [data-vtl-mute], [data-vtl-clear], [data-vtl-music-clear]")) {
      setSelection([], null, { audio: true });
      const rect = musicBlock.getBoundingClientRect();
      if (audioTrimMode && musicTrack) {
        const { full, tin } = audioTrimBounds(musicTrack);
        const used = clipEffectiveDuration(musicTrack);
        const rel = audioTrimTimeFromClientX(e.clientX, rect, used);
        audioTrimSec = Math.min(full, tin + rel);
        playheadSec = rel;
        syncPlayhead();
        void startAudioTrimListen({ fromSec: audioTrimSec, loop: true });
      } else if (musicTrack) {
        const used = clipEffectiveDuration(musicTrack);
        playheadSec = audioTrimTimeFromClientX(e.clientX, rect, used);
        followPlayhead = false;
        void seekTimelineTo(playheadSec);
      }
      renderTimeline();
      return;
    }
  });

  host.addEventListener("input", (e) => {
    if (e.target.matches("[data-vtl-video-vol]")) {
      setVideoMixVolume(e.target.value);
      return;
    }
    if (e.target.matches("[data-vtl-music-vol]")) {
      setMusicMixVolume(e.target.value);
      return;
    }
    if (e.target.matches("[data-vtl-audio-in], [data-vtl-audio-out]")) {
      if (!musicTrack) return;
      if (e.target.matches("[data-vtl-audio-in]")) {
        applyEdgeTrim(musicTrack, "in", Number(e.target.value) || 0);
      } else {
        const v = Number(e.target.value);
        applyEdgeTrim(musicTrack, "out", Number.isFinite(v) ? v : clipSourceDuration(musicTrack) || 0);
      }
      const b = audioTrimBounds(musicTrack);
      audioTrimSec = audioTrimLoopRestart(audioTrimSec, b);
      layoutClipsLive();
      syncAudioTrimUi();
      syncMeta();
      emitTimelineDraft();
      return;
    }
    const clip = selectedTarget();
    if (!clip) return;
    if (e.target.matches("[data-vtl-in]")) {
      applyEdgeTrim(clip, "in", Number(e.target.value) || 0);
      renderTimeline();
      emitTimelineDraft();
    }
    if (e.target.matches("[data-vtl-out]")) {
      const v = Number(e.target.value);
      applyEdgeTrim(clip, "out", Number.isFinite(v) ? v : clipSourceDuration(clip) || 0);
      renderTimeline();
      emitTimelineDraft();
    }
  });

  async function togglePreviewPlayback() {
    if (audioTrimMode) {
      const bed = host.querySelector("[data-vtl-bed]");
      const playing = bed && !bed.paused && audioTrimLooping;
      if (playing) stopAudioTrimListen();
      else void startAudioTrimListen({ fromSec: audioTrimSec, loop: true });
      return;
    }
    const el = getPreviewEl?.();
    if (!el) {
      if (musicTrack) {
        followPlayhead = true;
        void listenAudioTrim();
      }
      return;
    }
    bindPreviewPlayback(el);
    applyPreviewMute();
    attachMusicToPlayback();
    const span = projectSpanSec();
    const playing = !el.paused && !el.ended;
    const intent = playheadPlaybackIntent(playheadSec, span, { playing, ended: !!el.ended });
    if (intent === "pause") {
      el.pause?.();
      pauseBedAudio();
      return;
    }
    followPlayhead = true;
    // Seek first so a stale ended flag / leftover currentTime cannot no-op play().
    await seekTimelineTo(intent === "restart" ? 0 : playheadSec);
    applyPreviewMute();
    try {
      await el.play?.();
    } catch (_) { /* autoplay — next click retries */ }
    applyPreviewMute();
    if (el.paused) {
      try { await el.play?.(); } catch (_) { /* user gesture already consumed */ }
    }
    void playBedAudio({ autoplayKick: false });
  }

  function editorWindowEl() {
    return host.closest(".clip-editor-workspace, .video-editor-window, [data-video-editor-card], [data-clip-studio]") || host;
  }

  function editorSurfaceActive() {
    if (!host.isConnected) return false;
    const win = editorWindowEl();
    if (win?.classList.contains("hidden")) return false;
    return true;
  }

  function eventInsideEditor(e) {
    if (!editorSurfaceActive()) return false;
    const win = editorWindowEl();
    if (e?.target && (win.contains(e.target) || host.contains(e.target) || isVideoEditorShortcutSurface(e.target))) {
      return true;
    }
    const active = document.activeElement;
    return !!(active && (win.contains(active) || host.contains(active)));
  }

  function editorOwnsShortcutEvent(e) {
    if (!editorSurfaceActive()) return false;
    if (isEditorTypingTarget(e.target)) return false;
    const card = host.closest("[data-video-editor-card], .clip-editor-workspace, .clip-editor-studio, .video-editor-window") || host;
    if (e.target && card.contains(e.target)) return true;
    const active = document.activeElement;
    if (active && card.contains(active) && !isEditorTypingTarget(active)) return true;
    return false;
  }

  function selectedEditorOwnsPlaybackShortcut(e) {
    const selected = typeof isEditorSelected === "function"
      ? !!isEditorSelected()
      : editorOwnsShortcutEvent(e);
    return videoPlaybackShortcutIntent({
      key: e.key,
      code: e.code,
      repeat: e.repeat,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      editorVisible: editorSurfaceActive(),
      editorSelected: selected,
      blockedTarget: isVideoPlaybackShortcutBlockedTarget(e.target),
    }) === "toggle";
  }

  function consumeEditorKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  }

  function onEditorKeyDown(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target.closest?.("[data-vtl-prompt]")) {
      if (!host.contains(e.target)) return;
      consumeEditorKey(e);
      void generateEdit();
      return;
    }
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (!editorSurfaceActive()) return;
      if (isEditorTypingTarget(e.target)) return;
      const caption = document.querySelector("[data-video-x-caption]");
      if (caption && !caption.classList.contains("hidden")) return;
      consumeEditorKey(e);
      clearEditorSelection();
      return;
    }
    if (selectedEditorOwnsPlaybackShortcut(e)) {
      consumeEditorKey(e);
      togglePreviewPlayback();
      return;
    }
    if (!editorOwnsShortcutEvent(e)) return;
    if (isEditorPageZoomKey(e)) {
      consumeEditorKey(e);
      return;
    }
    if (isEditorUndoKey(e)) {
      consumeEditorKey(e);
      undoTimeline();
      return;
    }
    if (isEditorRedoKey(e)) {
      consumeEditorKey(e);
      redoTimeline();
      return;
    }
    if (isEditorCopyKey(e)) {
      consumeEditorKey(e);
      copySelected();
      return;
    }
    if (isEditorPasteKey(e)) {
      consumeEditorKey(e);
      pasteClipboard();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod || e.altKey) return;
    const key = String(e.key || "").toLowerCase();
    if (key === "s" || e.code === "KeyS") {
      consumeEditorKey(e);
      splitSelectedAtPlayhead();
      return;
    }
    if (key === "t" || e.code === "KeyT") {
      consumeEditorKey(e);
      trimAtPlayhead();
      return;
    }
    if (key === "m" || e.code === "KeyM") {
      consumeEditorKey(e);
      muteSelected();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      consumeEditorKey(e);
      removeSelected();
      return;
    }
    if (key === "c" || e.code === "KeyC") {
      consumeEditorKey(e);
      copySelected();
      return;
    }
    if (key === "v" || e.code === "KeyV") {
      consumeEditorKey(e);
      pasteClipboard();
    }
  }
  document.addEventListener("keydown", onEditorKeyDown, true);

  function onEditorPageZoomKey(e) {
    if (!isEditorPageZoomKey(e)) return;
    if (!eventInsideEditor(e) && !isVideoEditorShortcutSurface(e.target)) return;
    consumeEditorKey(e);
  }
  function onEditorPageZoomWheel(e) {
    if (!isEditorPageZoomWheel(e)) return;
    if (!eventInsideEditor(e) && !isVideoEditorShortcutSurface(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    scheduleTimelineZoom(pxPerSec * factor, timeAtBoardClientX(e.clientX));
  }
  function onEditorPageZoomGesture(e) {
    if (!eventInsideEditor(e) && !isVideoEditorShortcutSurface(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "gesturestart") pinchBasePx = pxPerSec;
    if (e.type === "gesturechange" && pinchBasePx) {
      scheduleTimelineZoom(pinchBasePx * (Number(e.scale) || 1), playheadSec);
    }
    if (e.type === "gestureend") pinchBasePx = 0;
  }
  document.addEventListener("keydown", onEditorPageZoomKey, true);
  document.addEventListener("wheel", onEditorPageZoomWheel, { capture: true, passive: false });
  document.addEventListener("gesturestart", onEditorPageZoomGesture, { capture: true, passive: false });
  document.addEventListener("gesturechange", onEditorPageZoomGesture, { capture: true, passive: false });
  document.addEventListener("gestureend", onEditorPageZoomGesture, { capture: true, passive: false });

  host.addEventListener("pointerdown", (e) => {
    if (e.target.matches?.("[data-vtl-video-vol], [data-vtl-music-vol], [data-vtl-in], [data-vtl-out], [data-vtl-audio-in], [data-vtl-audio-out]")) pushUndo();
    if (isEditorTypingTarget(e.target)) return;
    try { host.focus({ preventScroll: true }); } catch (_) {}
  });

  const board = host.querySelector("[data-vtl-board]");
  board?.addEventListener("scroll", () => {
    if (applyingFollowScroll) return;
    followPlayhead = false;
  }, { passive: true });
  host.querySelector("[data-vtl-audio-trim-board]")?.addEventListener("pointerdown", (e) => {
    if (!musicTrack || !audioTrimMode) return;
    if (e.target.closest("input, button")) return;
    e.preventDefault();
    e.stopPropagation();
    const { full, tin, tout } = audioTrimBounds(musicTrack);
    const rect = e.currentTarget.getBoundingClientRect();
    const edgeEl = e.target.closest("[data-vtl-audio-trim-edge]");
    const onSpan = !!e.target.closest("[data-vtl-audio-trim-span]");
    trimBarDrag = {
      id: e.pointerId,
      mode: edgeEl ? edgeEl.dataset.vtlAudioTrimEdge : (onSpan ? "slide" : "seek"),
      startX: e.clientX,
      startTin: tin,
      startTout: tout,
      full,
      width: Math.max(1, rect.width),
      moved: false,
    };
    host.classList.add("is-trimming");
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (trimBarDrag.mode === "seek") {
      audioTrimSec = audioTrimTimeFromClientX(e.clientX, rect, full);
      syncPlayhead();
      void startAudioTrimListen({ fromSec: audioTrimSec, loop: true });
    }
  });
  board?.addEventListener("click", (e) => {
    if (ignoreBoardSeek) {
      ignoreBoardSeek = false;
      return;
    }
    if (e.target.closest("[data-vtl-clip], [data-vtl-mute], [data-vtl-clear], [data-vtl-music-block], [data-vtl-trim], [data-vtl-marquee]")) return;
    const rect = board.getBoundingClientRect();
    const x = e.clientX - rect.left + board.scrollLeft - 36;
    followPlayhead = false;
    void seekTimelineTo(Math.max(0, x / pxPerSec));
  });
  board?.addEventListener("wheel", (e) => {
    if (!board.contains(e.target)) return;
    if (e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    scheduleTimelineZoom(pxPerSec * factor, timeAtBoardClientX(e.clientX));
  }, { passive: false });
  host.querySelector("[data-vtl-zoom-slider]")?.addEventListener("input", (e) => {
    applyTimelineZoom(Number(e.target.value) || pxPerSec, playheadSec);
  });

  function clipClientRects() {
    return clips.map((c) => {
      const node = host.querySelector(`[data-vtl-clip="${CSS.escape ? CSS.escape(c.id) : c.id}"]`);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { id: c.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }).filter(Boolean);
  }

  function marqueeEl() {
    return host.querySelector("[data-vtl-marquee]");
  }

  function paintMarquee(rect) {
    const el = marqueeEl();
    if (!el || !board) return;
    const box = board.getBoundingClientRect();
    el.hidden = false;
    el.classList.remove("hidden");
    el.style.left = `${rect.left - box.left + board.scrollLeft}px`;
    el.style.top = `${rect.top - box.top + board.scrollTop}px`;
    el.style.width = `${Math.max(0, rect.width)}px`;
    el.style.height = `${Math.max(0, rect.height)}px`;
  }

  function hideMarquee() {
    const el = marqueeEl();
    if (!el) return;
    el.hidden = true;
    el.classList.add("hidden");
  }

  function beginMarquee(e) {
    if (e.button !== 0) return false;
    if (e.target.closest("[data-vtl-clip], [data-vtl-trim], [data-vtl-mute], [data-vtl-clear], [data-vtl-music-block], [data-vtl-music-clear], button, input, [data-vtl-menu]")) {
      return false;
    }
    if (!e.target.closest("[data-vtl-board], [data-vtl-video-lane], [data-vtl-timeline], [data-vtl-ruler]")) {
      return false;
    }
    marqueeDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) {}
    return true;
  }

  function moveMarquee(e) {
    if (!marqueeDrag || e.pointerId !== marqueeDrag.id) return;
    const rect = normalizeMarqueeRect(marqueeDrag, { x: e.clientX, y: e.clientY });
    if (rect.width > 4 || rect.height > 4) marqueeDrag.moved = true;
    if (!marqueeDrag.moved) return;
    paintMarquee(rect);
    const ids = clipIdsIntersectingMarquee(clipClientRects(), rect);
    setSelection(ids, ids[0] || null);
    renderTimeline();
  }

  function endMarquee(e) {
    if (!marqueeDrag || (e && e.pointerId !== marqueeDrag.id)) return false;
    const drag = marqueeDrag;
    marqueeDrag = null;
    hideMarquee();
    if (!drag.moved) return false;
    ignoreBoardSeek = true;
    const rect = normalizeMarqueeRect(drag, { x: e?.clientX ?? drag.x, y: e?.clientY ?? drag.y });
    const ids = clipIdsIntersectingMarquee(clipClientRects(), rect);
    setSelection(ids, ids[0] || null, { anchor: ids[0] || null });
    renderTimeline();
    return true;
  }

  board?.addEventListener("pointerdown", (e) => {
    beginMarquee(e);
  });
  board?.addEventListener("pointermove", moveMarquee);
  board?.addEventListener("pointerup", endMarquee);
  board?.addEventListener("pointercancel", endMarquee);

  host.addEventListener("contextmenu", (e) => {
    const clipEl = e.target.closest("[data-vtl-clip]");
    const musicEl = e.target.closest("[data-vtl-music-block]");
    const playheadEl = e.target.closest("[data-vtl-playhead]");
    const boardEl = e.target.closest("[data-vtl-board]");
    if (!clipEl && !musicEl && !playheadEl && !boardEl) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    if (musicEl && musicTrack) {
      selectedAudio = true;
      selectedId = null;
      renderTimeline();
      showClipMenu(e.clientX, e.clientY, musicTrack, { kind: "audio" });
      return;
    }
    let clip = clipEl ? clips.find((c) => c.id === clipEl.dataset.vtlClip) : null;
    if (!clip && (playheadEl || boardEl)) {
      clip = clips.find((c) => playheadHitsClip(clips, c.id, playheadSec)) || selected() || clips[0];
    }
    if (!clip) return;
    selectedId = clip.id;
    selectedAudio = false;
    renderTimeline();
    const hits = playheadHitsClip(clips, clip.id, playheadSec) || !!playheadEl;
    showClipMenu(e.clientX, e.clientY, clip, { playheadHits: hits, kind: "clip" });
  }, true);

  function onDocPointerDown(e) {
    if (!host.querySelector("[data-vtl-menu]:not(.hidden)")) return;
    if (host.contains(e.target)) return;
    hideClipMenu();
  }
  document.addEventListener("pointerdown", onDocPointerDown);

  host.addEventListener("dragstart", (e) => {
    if (e.target.closest("[data-vtl-mute], [data-vtl-menu], [data-vtl-trim], [data-vtl-clear], [data-vtl-music-clear]")) {
      e.preventDefault();
      return;
    }
    const clipBtn = e.target.closest("[data-vtl-clip]");
    if (!clipBtn) return;
    draggingClipId = clipBtn.dataset.vtlClip;
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", draggingClipId); } catch (_) {}
  });
  const unbindMediaDrop = bindMediaDropTarget(host, {
    onFiles: (files, e) => {
      draggingClipId = null;
      ingestFiles(files, e);
    },
    onDragState: (on, e) => {
      host.classList.toggle("is-drop-target", on);
      host.querySelectorAll("[data-vtl-audio-lane], [data-vtl-video-lane], [data-vtl-clip]").forEach((el) => {
        el.classList.remove("is-drop-target");
      });
      if (!on) return;
      const overAudio = e?.target?.closest?.("[data-vtl-audio-lane], [data-vtl-music]");
      const overClip = e?.target?.closest?.("[data-vtl-clip]");
      const overVideo = e?.target?.closest?.("[data-vtl-video-lane], [data-vtl-timeline]");
      if (overAudio) overAudio.closest("[data-vtl-audio-lane]")?.classList.add("is-drop-target");
      if (overClip) overClip.classList.add("is-drop-target");
      else if (overVideo) host.querySelector("[data-vtl-video-lane]")?.classList.add("is-drop-target");
    },
  });
  host.addEventListener("dragover", (e) => {
    if (isMediaFileDrag(e)) return;
    if (!draggingClipId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  });
  host.addEventListener("drop", (e) => {
    if (isMediaFileDrag(e) || filesFromDropEvent(e).length) return;
    const over = e.target.closest("[data-vtl-clip]");
    if (!draggingClipId || !over) return;
    e.preventDefault();
    const from = clips.findIndex((c) => c.id === draggingClipId);
    const to = clips.findIndex((c) => c.id === over.dataset.vtlClip);
    if (from !== to) pushUndo();
    clips = reorderClips(clips, from, to);
    draggingClipId = null;
    renderTimeline();
  });

  host.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-vtl-mute], [data-vtl-menu], [data-vtl-clear], [data-vtl-music-clear]")) {
      e.stopPropagation();
    }
    if (e.target.closest("[data-vtl-audio-trim-edge], [data-vtl-audio-trim-board]")) return;
    const handle = e.target.closest("[data-vtl-trim]");
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();
    const clipBtn = handle.closest("[data-vtl-clip]");
    const musicBtn = handle.closest("[data-vtl-music-block]");
    const isAudio = !!musicBtn && !clipBtn;
    const clip = clipBtn ? clips.find((c) => c.id === clipBtn.dataset.vtlClip) : null;
    const target = isAudio ? musicTrack : clip;
    if (!target) return;
    pushUndo();
    if (isAudio) {
      selectedAudio = true;
      selectedId = null;
    } else {
      selectedAudio = false;
      selectedId = clip.id;
    }
    const full = Math.max(0.1, clipSourceDuration(target) || 1);
    trimDrag = {
      id: e.pointerId,
      edge: handle.dataset.vtlTrim,
      clipId: isAudio ? null : clip.id,
      kind: isAudio ? "audio" : "clip",
      startX: e.clientX,
      trimIn: Number(target.trimIn) || 0,
      trimOut: target.trimOut != null ? Number(target.trimOut) : full,
    };
    host.classList.add("is-trimming");
    handle.setPointerCapture?.(e.pointerId);
  });
  host.addEventListener("pointermove", (e) => {
    if (trimBarDrag && e.pointerId === trimBarDrag.id && musicTrack) {
      const dx = e.clientX - trimBarDrag.startX;
      if (Math.abs(dx) > 3) trimBarDrag.moved = true;
      const dt = (dx / trimBarDrag.width) * trimBarDrag.full;
      if (trimBarDrag.mode === "in") {
        applyEdgeTrim(musicTrack, "in", trimBarDrag.startTin + dt);
      } else if (trimBarDrag.mode === "out") {
        applyEdgeTrim(musicTrack, "out", trimBarDrag.startTout + dt);
      } else if (trimBarDrag.mode === "slide") {
        musicTrack.trimIn = trimBarDrag.startTin;
        musicTrack.trimOut = trimBarDrag.startTout >= trimBarDrag.full - 1e-4 ? null : trimBarDrag.startTout;
        slideAudioTrimWindow(musicTrack, dt);
      } else {
        const rect = host.querySelector("[data-vtl-audio-trim-board]")?.getBoundingClientRect();
        audioTrimSec = audioTrimTimeFromClientX(e.clientX, rect, trimBarDrag.full);
        syncPlayhead();
        const bed = host.querySelector("[data-vtl-bed]");
        try { if (bed) bed.currentTime = audioTrimSec; } catch (_) {}
        if (!bed || bed.paused) void startAudioTrimListen({ fromSec: audioTrimSec, loop: true });
        return;
      }
      layoutClipsLive({ live: true });
      syncAudioTrimUi();
      return;
    }
    if (!trimDrag || e.pointerId !== trimDrag.id) return;
    const target = trimDrag.kind === "audio" ? musicTrack : clips.find((c) => c.id === trimDrag.clipId);
    if (!target) return;
    const dx = (e.clientX - trimDrag.startX) / pxPerSec;
    const next = trimDrag.edge === "in" ? trimDrag.trimIn + dx : trimDrag.trimOut + dx;
    applyEdgeTrim(target, trimDrag.edge, next);
    layoutClipsLive({ live: true });
    syncSelected();
  });
  const endTrim = (e) => {
    if (trimBarDrag && (!e || e.pointerId === trimBarDrag.id)) {
      const drag = trimBarDrag;
      const boardEl = host.querySelector("[data-vtl-audio-trim-board]");
      const rect = boardEl?.getBoundingClientRect();
      if (!drag.moved && rect) {
        audioTrimSec = audioTrimTimeFromClientX(e?.clientX ?? drag.startX, rect, drag.full);
      } else {
        const b = audioTrimBounds(musicTrack);
        audioTrimSec = audioTrimLoopRestart(audioTrimSec, b);
      }
      playheadSec = Math.max(0, audioTrimSec - (Number(musicTrack?.trimIn) || 0));
      trimBarDrag = null;
      host.classList.remove("is-trimming");
      renderTimeline();
      emitTimelineDraft();
      void startAudioTrimListen({ fromSec: audioTrimSec, loop: true });
      return;
    }
    if (!trimDrag || (e && e.pointerId !== trimDrag.id)) return;
    trimDrag = null;
    host.classList.remove("is-trimming");
    renderTimeline();
    emitTimelineDraft();
    if (audioTrimMode) void startAudioTrimListen({ fromSec: audioTrimSec, loop: true });
  };
  host.addEventListener("pointerup", endTrim);
  host.addEventListener("pointercancel", endTrim);

  host.querySelector("[data-vtl-file]")?.addEventListener("change", (e) => {
    const files = [...(e.target.files || [])];
    const audioPick = pickerMode === "audio";
    try { e.target.value = ""; } catch (_) {}
    ingestFiles(files, e, { overAudio: audioPick, forceAudio: audioPick });
    if (audioPick || files.length) armPickerClickGuard();
  });

  const audioLane = host.querySelector("[data-vtl-audio-lane]");
  const unbindAudioDrop = bindMediaDropTarget(audioLane, {
    onFiles: (files, ev) => ingestFiles(files, ev || { target: audioLane }),
    onDragState: (on) => audioLane?.classList.toggle("is-drop-target", on),
  });

  let unbindPreviewDrop = () => {};
  function attachPreviewDrop() {
    try { unbindPreviewDrop?.(); } catch (_) {}
    const preview = getPreviewEl?.();
    const wrap = preview?.closest?.("[data-video-preview-wrap], .video-editor-preview-wrap, .ref-viewer-stage-wrap--video, .ref-viewer-stage--video") || preview;
    const unbinds = [];
    const onFiles = (files, ev) => ingestFiles(files, ev);
    const onDragState = (on) => {
      wrap?.classList?.toggle("is-drop-target", on);
      preview?.classList?.toggle("is-drop-target", on);
    };
    if (wrap) unbinds.push(bindMediaDropTarget(wrap, { onFiles, onDragState }));
    if (preview && preview !== wrap) unbinds.push(bindMediaDropTarget(preview, { onFiles, onDragState }));
    if (preview) bindPreviewPlayback(preview);
    syncPreviewChrome();
    unbindPreviewDrop = () => unbinds.forEach((fn) => { try { fn?.(); } catch (_) {} });
  }
  attachPreviewDrop();

  function onPromptKeyChanged(e) {
    if (e.target?.closest?.("#prompt-key-popup, #prompt-ai-key-select, [data-vtl-key-pill]")) {
      queueMicrotask(() => syncFilmKeyPill());
    }
  }
  async function onVideoGenerationEvent(e) {
    const job = e?.detail;
    if (!job || !isVideoGenerationKind(job)) return;
    const pid = String(getProjectId?.() || "");
    if (job.projectId && String(job.projectId) !== pid) return;
    const tid = String(job.trace_id || job.id || "");
    if (filmJobTrace && tid && tid !== filmJobTrace) return;
    if (String(job.status || "") === "running" && isVideoGenerationKind(job)) {
      attachFilmJob(job);
      if (!filmPollTimer && !busy) {
        void waitForFilmJob(job.trace_id || job.id).catch((err) => {
          if (!destroyed && err?.message) setLocalStatus(err.message, true);
          setFilmGenerating(false);
        });
      }
      return;
    }
    if (String(job.status || "") === "complete" && isVideoGenerationKind(job)) {
      try {
        await applyReadyFilmJob(job);
        setFilmGenerating(false);
        setLocalStatus("");
      } catch (err) { setFilmGenerating(false); setLocalStatus(err.message, true); }
    }
    if (String(job.status || "") === "failed" || String(job.status || "") === "canceled") {
      setFilmGenerating(false);
      if (job.error) setLocalStatus(job.error, true);
    }
  }
  function onEditorVisibility() {
    if (!editorPageIsHidden()) return;
    if (zoomRaf) {
      cancelAnimationFrame(zoomRaf);
      zoomRaf = 0;
    }
    try { getPreviewEl?.()?.pause?.(); } catch (_) { /* ignore */ }
    pauseBedAudio();
  }
  document.addEventListener("visibilitychange", onEditorVisibility);
  document.addEventListener("change", onPromptKeyChanged, true);
  document.addEventListener("click", onPromptKeyChanged, true);
  window.addEventListener("render3d:video-generation", onVideoGenerationEvent);

  syncKeyDefault();
  syncZoomSlider();
  syncTransitionUi();
  renderTimeline();
  syncCollabUi();
  void resumeFilmJobFromProject();

  return {
    setPrimaryClip(blob, { label = "Clip", source = "viewport", sourcePath = "", url = "", duration = 0 } = {}) {
      const preview = getPreviewEl?.();
      const playbackUrl = url || "";
      const reuse = sourcePath
        ? findClipBySourceKey(clips, { sourcePath, filename: sourcePath })
        : null;
      if (reuse) {
        if (blob && !reuse.blob) reuse.blob = blob;
        if (playbackUrl && !reuse.url) reuse.url = playbackUrl;
        reuse.sourcePath = reuse.sourcePath || sourcePath;
        reuse.filename = reuse.filename || sourcePath;
        if (Number(duration) > 0.05) adoptMediaDuration(reuse, duration);
        reuse.pending = false;
        setSelection([reuse.id], reuse.id, { anchor: reuse.id });
        setTimelineLoading(false);
        if (playbackUrl && preview && preview.src !== playbackUrl && preview.currentSrc !== playbackUrl) {
          previewClip(reuse);
        }
        attachPreviewDrop();
        renderTimeline();
        return Promise.resolve(reuse);
      }
      const keepPreview = !!(
        (blob && previewAlreadyHasMedia(preview))
        || (playbackUrl && preview && (preview.currentSrc === playbackUrl || preview.getAttribute("src") === playbackUrl))
      );
      if (!keepPreview && !playbackUrl) pauseAndDetachMedia(preview);
      const urls = clips.filter((c) => c.ownedUrl !== false).map((c) => c.url).filter(Boolean);
      for (const u of collectHistoryOwnedUrls()) { // leakfix30
        if (u && !urls.includes(u)) urls.push(u);
      }
      clips = [];
      selectedId = null;
      selectedIds = new Set();
      selectionAnchor = null;
      undoStack = [];
      redoStack = [];
      syncHistoryButtons();
      outputBlob = blob || null;
      for (const href of urls) scheduleRevokeObjectURL(href);
      if (!blob && !playbackUrl) {
        clearMusic();
        setTimelineLoading(false);
        renderTimeline();
        attachPreviewDrop();
        return Promise.resolve(null);
      }
      setTimelineLoading(true, TIMELINE_CLIP_LOADING_STATUS);
      const added = addClip({
        blob: blob || null,
        url: playbackUrl,
        source,
        label,
        sourcePath,
        duration: Number(duration) > 0.05 ? Number(duration) : (keepPreview ? finiteMediaDuration(preview) : 0),
      });
      attachPreviewDrop();
      return Promise.resolve(added).then((clip) => {
        if (clip && (clip.url || previewPlayerHasSrc(getPreviewEl?.()))) {
          clip.pending = false;
          setTimelineLoading(false);
        }
        return clip;
      });
    },
    setTimelineLoading,
    setSource(blob) {
      return this.setPrimaryClip(blob, { label: "Clip", source: "viewport" });
    },
    addClip,
    ingestFiles,
    setMusicFromFile,
    clearMusic,
    addStill({ blob, url, name } = {}) {
      const file = blob || null;
      if (!file) return null;
      return addClip({ blob: file, source: "still", label: name || file.name || "Photo" });
    },
    setClipLabel(text) {
      const clip = selected() || clips[0];
      if (!clip) return;
      clip.label = String(text || "").slice(0, 80);
      renderTimeline();
    },
    getProjectName: () => projectName,
    setProjectName: (name, opts) => setProjectName(name, opts),
    videoEditorFolderKey: () => videoEditorFolderKey(projectName),
    togglePreviewPlayback,
    splitAtPlayhead: splitSelectedAtPlayhead,
    trimAtPlayhead,
    muteSelected,
    copySelected,
    pasteClipboard,
    removeSelected,
    shortenAudioToSelectedClip,
    enterAudioTrimMode,
    exitAudioTrimMode,
    finishAudioTrim,
    clearEditorSelection,
    undoTimeline,
    redoTimeline,
    getClips: () => clips.map((c) => ({ ...c })),
    getMusicTrack: () => (musicTrack ? { ...musicTrack } : null),
    getTimelineDraft: () => captureTimelineDraft(),
    restoreTimelineDraft(draft) {
      if (!draft || typeof draft !== "object") return;
      clips = hydrateTimelineClips(clips, draft.clips);
      transitionMode = String(draft.transition || "cut");
      zoomMode = String(draft.zoom || "none");
      playheadSec = Math.max(0, Number(draft.playheadSec) || 0);
      selectedId = clips[0]?.id || null;
      selectedIds = new Set(selectedId ? [selectedId] : []);
      selectedAudio = false;
      renderTimeline();
      syncPreviewToPlayhead({ autoplay: false });
    },
    getFilmHistory: () => filmHistory.map((row) => ({ ...row })),
    applyFilmHistoryMeta(list) {
      const slim = slimFilmEditHistory(list);
      const keep = new Map(filmHistory.map((row) => [row.id, row]));
      filmHistory = slim.map((row) => ({ ...row, ...(keep.get(row.id) || {}) }));
      renderFilmHistoryPop();
    },
    restoreFilmVersion,
    getOutputBlob: () => outputBlob || clips[0]?.blob || null,
    needsBake,
    ensureBaked: async (opts = {}) => {
      if (!needsBake()) return outputBlob || clips[0]?.blob || null;
      return generateEdit({
        applyPrompt: opts.applyPrompt === true,
        updatePreview: opts.updatePreview === true,
        onProgress: opts.onProgress,
      });
    },
    bake: generateEdit,
    generate: generateEdit,
    resumeFilmJob: resumeFilmJobFromProject,
    syncFilmKeyPill,
    improvePrompt,
    applyPlan,
    applyEditCommand: async (rawPrompt, { assembleIfAsked = true } = {}) => {
      const plan = parseFilmEditPrompt(rawPrompt);
      applyPlan(plan);
      if (assembleIfAsked !== false) await generateEdit();
      return { ok: true, plan };
    },
    syncAssembleAvailability() {},
    getState: () => ({
      transition: transitionMode,
      zoom: zoomMode,
      clips: clips.length,
      music: musicTrack?.name || null,
      musicAttached: musicTrackPlaybackState(musicTrack).attached,
      musicMuted: !!musicTrack?.muted,
      projectName,
    }),
    park() {
      mediaParked = true;
      if (zoomRaf) {
        cancelAnimationFrame(zoomRaf);
        zoomRaf = 0;
      }
      pendingZoom = null;
      stopAudioTrimListen();
      pauseAndDetachMedia(getPreviewEl?.());
      pauseAndDetachMedia(host.querySelector("[data-vtl-bed]"));
      pauseOffscreenEditorMedia(host, null);
    },
    unpark() {
      if (destroyed) return;
      mediaParked = false;
      const clip = selected() || clips[0];
      if (clip) previewClip(clip);
      void resumeFilmJobFromProject();
    },
    destroy() {
      destroyed = true;
      mediaParked = true;
      if (timelineHydrateTimer) {
        clearTimeout(timelineHydrateTimer);
        timelineHydrateTimer = 0;
      }
      if (timelineEmitTimer) {
        window.clearTimeout(timelineEmitTimer);
        timelineEmitTimer = 0;
      }
      if (zoomRaf) {
        cancelAnimationFrame(zoomRaf);
        zoomRaf = 0;
      }
      pendingZoom = null;
      try { decodeAbort?.abort(); } catch (_) { /* ignore */ }
      decodeAbort = null;
      try { generateAbort?.abort(); } catch (_) { /* ignore */ }
      generateAbort = null;
      stopFilmPoll();
      busy = false;
      stopCollabWatch();
      window.removeEventListener("render3d:presence-changed", onPresenceChanged);
      window.removeEventListener("render3d:video-editor", onRemoteEditorEvent);
      window.removeEventListener("render3d:video-generation", onVideoGenerationEvent);
      document.removeEventListener("visibilitychange", onEditorVisibility);
      document.removeEventListener("change", onPromptKeyChanged, true);
      document.removeEventListener("click", onPromptKeyChanged, true);
      hideAvatarPop();
      hideClipMenu();
      stopAudioTrimListen();
      setDesktopPerfScope("");
      unbindPreviewPlayback();
      pauseAndDetachMedia(getPreviewEl?.());
      pauseAndDetachMedia(host.querySelector("[data-vtl-bed]"));
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onEditorKeyDown, true);
      document.removeEventListener("keydown", onEditorPageZoomKey, true);
      document.removeEventListener("wheel", onEditorPageZoomWheel, true);
      document.removeEventListener("gesturestart", onEditorPageZoomGesture, true);
      document.removeEventListener("gesturechange", onEditorPageZoomGesture, true);
      document.removeEventListener("gestureend", onEditorPageZoomGesture, true);
      unbindMediaDrop?.();
      unbindAudioDrop?.();
      unbindPreviewDrop?.();
      const urls = [];
      if (musicTrack?.url) urls.push(musicTrack.url);
      for (const c of clips) {
        if (c.url && c.ownedUrl !== false && !urls.includes(c.url)) urls.push(c.url);
      }
      for (const u of collectHistoryOwnedUrls()) { // leakfix30
        if (u && !urls.includes(u)) urls.push(u);
      }
      musicTrack = null;
      clips = [];
      undoStack = [];
      redoStack = [];
      try { host.querySelector("[data-vtl-bed]")?.remove(); } catch (_) { /* ignore */ }
      try { host.hidden = true; } catch (_) { /* ignore */ }
      const wipe = () => {
        try { host.innerHTML = ""; } catch (_) { /* ignore */ }
        for (const url of urls) scheduleRevokeObjectURL(url, 80);
        revokeTrackedObjectUrls(filmHistoryPreviewCreated);
      };
      if (shouldHeavyTeardownVideoEditorOnCloseTick()) wipe();
      else scheduleVideoEditorIdle(wipe, 32);
    },
  };
}
