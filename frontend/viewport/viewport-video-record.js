/** High-quality viewport video recording — expandable settings next to Screenshot. */

import { mountVideoClipStudio, bindMediaDropTarget } from "./video-clip-studio.js?v=20260914-clipdnd1-20260914-clipmedia2-20260914-tlupload1-20260914-musicon1-20260914-clipcut1-20260914-shareprompt1-cliplit1-cliptrim1-clipkeys1-clipaud1-clipplay1-sharexcap1-xsharepct1-vidclose1-clipaudtrim1-cliptrimui1-cliploop1-clipaudsave1-xsharebtn1-trimup1-addaudio1-escunsel1-trimdone1-sharegif2-sharexsame1-dledit1-vedir1-clipauddrop1-recdedupe1-tlkeys2-tlspin1-tlaudio1-tldupe1-imovie1-tlinstant1-filmeditkey1-clipshare1-trimwave1-trimlen1-sharexfull1-veditorhub1-clipui1-xtab1-vidlayout1-vidzoom1-vidmodel1-vidjob1-xcap1-clipgen1-xcap2-xcap3-xcap4-filmlive2&vidclose2=20260916-1&filmfix=20260916-1&dlprog1=20260916-1&clipperf1&editautosave=20261006-2&filmapply=20261006-2&spaceplay=20261006-2";
import {
  parseFilmEditPrompt,
  defaultVideoEditorProjectName,
  videoEditorFolderKey,
  isEditorTypingTarget,
  randomVideoEditorProjectName,
  clipAuthorFromUser,
  editorSessionStorageKey,
  matchListedMediaFile,
  applyMusicSnapshotOpts,
  mediaFileBasename,
  normalizeVideoEditorSourcePath,
  videoEditorProjectNameFromSource,
  videoEditorProjectNameFromFolder,
  isVideoEditorFolderKey,
  videoEditorSourceRefFromPath,
  shouldCopyBytesIntoVideoEditorFolder,
  videoEditorOpenLockKey,
  TIMELINE_CLIP_LOADING_STATUS,
  TIMELINE_LOADING_MAX_MS,
  findClipBySourceKey,
  clipSourceIdentityKey,
  previewPlayerHasSrc,
  finiteMediaDuration,
  mediaKindFromFile,
  pauseAndDetachMedia,
  pauseOffscreenEditorMedia,
  editorPageIsHidden,
  shouldRebuildCadOnVideoEditorCloseTick,
} from "./video-timeline-editor.js?v=20260914-clipdnd1-20260914-clipmedia2-20260914-tlupload1-20260914-musicon1-20260914-clipcut1-20260914-shareprompt1-cliplit1-cliptrim1-clipkeys1-clipaud1-clipplay1-sharexcap1-xsharepct1-vidclose1-clipaudtrim1-cliptrimui1-cliploop1-clipaudsave1-xsharebtn1-trimup1-addaudio1-escunsel1-trimdone1-sharegif2-sharexsame1-dledit1-vedir1-clipauddrop1-recdedupe1-tlkeys2-tlspin1-tlaudio1-tldupe1-imovie1-tlinstant1-filmeditkey1-clipshare1-trimwave1-trimlen1-sharexfull1-veditorhub1-clipui1-xtab1-vidlayout1-vidzoom1-vidmodel1-vidjob1-xcap1-clipgen1-xcap2-xcap3-xcap4&vidclose2=20260916-1&filmfix=20260916-1&dlprog1=20260916-1&clipperf1-deskdbg1&leakobs1&leakfix4&leakfix30&leakfix32&leakfix33&mp4videokind=20260926-1&editautosave=20261006-3&spaceplay=20261006-2";
import { renderEditedClip, VIDEO_LOOK_GRADES, cssFilterForGrade, revokeTrackedObjectUrls, triggerTrackedBlobDownload } from "./viewport-video-editor.js?v=20260915-sharexfull1-deskdbg1&leakobs1&leakobs2&leakfix1&leakfix2&leakfix3&leakfix5";
import {
  AUDIO_PEAK_COUNT,
  peaksForAudioBlob,
  sanitizeAudioPeaks,
} from "../components/audio-document-tab.js?v=mp3c1-xcap3-xcap4-clipperf1";
import {
  playheadPlayedPct,
  seekTimeFromClientX,
  waveformBarsHtml,
} from "./share-video-waveform.js?v=20260915-scwave1-sharemarkup1-20260915-sharelive1-trimwave1-mp3c1-xcap3-xcap4-clipperf1";
import { confirmOpenDiscordApp, openDiscord } from "../components/share-chat.js?v=20260909-sharechat1-20260914-shareprompt1-clipshare1-sharexfull1-discshare1";
import { reminderHasSeen, reminderMarkSeen, RECORD_DONE_HINT_KEY } from "../studio/studio-reminders.js?v=20260914-canvasdrop1-20260915-recdone1";
import { captureFileBaseName } from "./capture-labels.js?v=20260907-capture-names-20260915-refrec1-20260915-recclock1";
import {
  shouldBlitXrDomCanvasWhilePresenting,
  shouldOpenXrPassthroughCamera,
  xrRecordStartDeferMs,
} from "../xr/xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5";

export const CLIP_EDITOR_TAB_ID = "__clip_editor__";
export { shouldRebuildCadOnVideoEditorCloseTick };

const LS_KEY = "render3d:viewportVideo:v1";
const PREFS_VERSION = 4;

const SHARE_FORMATS = ["mp4", "webm", "gif"];

export function xShareExportPlan(sourceMime = "", requestedFormat = "mp4") {
  const format = SHARE_FORMATS.includes(String(requestedFormat || "").toLowerCase())
    ? String(requestedFormat).toLowerCase()
    : "mp4";
  const type = String(sourceMime || "").toLowerCase();
  const sourceFormat = type.includes("mp4") || type.includes("m4v")
    ? "mp4"
    : type.includes("webm")
      ? "webm"
      : type.includes("gif")
        ? "gif"
        : "";
  return { format, convert: sourceFormat !== format };
}

export function xShareTrimWindow(duration, trimIn = 0, trimOut = null) {
  const dur = Math.max(0, Number(duration) || 0);
  const minLen = Math.min(0.08, dur || 0.08);
  let tin = Math.max(0, Number(trimIn) || 0);
  let tout = trimOut == null || trimOut === "" ? dur : Number(trimOut);
  if (!Number.isFinite(tout) || tout < 0) tout = dur;
  if (dur > 0) tout = Math.min(dur, tout);
  if (tout < tin + minLen) {
    if (tin <= 0) tout = Math.min(dur || minLen, tin + minLen);
    else tin = Math.max(0, tout - minLen);
  }
  if (dur > 0) tin = Math.min(tin, Math.max(0, dur - minLen));
  return { trimIn: tin, trimOut: tout || dur, duration: Math.max(0, (tout || dur) - tin) };
}

export function xShareBakePlan({
  audio = true,
  grade = "none",
  song = null,
  duration = 0,
  trimIn = 0,
  trimOut = null,
} = {}) {
  const hasSong = !!(song && (song.blob || song instanceof Blob));
  const blob = hasSong ? (song.blob || song) : null;
  const full = Math.max(0, Number(duration) || 0);
  const trim = xShareTrimWindow(full, trimIn, trimOut);
  return {
    keepAudio: !!audio && !hasSong,
    grade: VIDEO_LOOK_GRADES[grade] ? grade : "none",
    music: audio && blob
      ? { blob, volume: 0.45, trimIn: Math.max(0, Number(song.trimIn) || 0) }
      : null,
    videoStart: trim.trimIn,
    videoDuration: trim.duration,
    needsTrim: full > 0 && (trim.trimIn > 0.04 || trim.trimOut < full - 0.04),
  };
}

export function xShareFallbackDuration({ duration = 0, seekableEnd = 0, currentTime = 0, cached = 0 } = {}) {
  const el = Number(duration);
  if (Number.isFinite(el) && el > 0) return el;
  const seek = Number(seekableEnd);
  if (Number.isFinite(seek) && seek > 0) return seek;
  const prev = Number(cached);
  if (Number.isFinite(prev) && prev > 0) return prev;
  const t = Math.max(0, Number(currentTime) || 0);
  return Math.max(t + 0.25, 1);
}

export function xShareTrackPct(clientX, rect) {
  const width = Math.max(1, Number(rect?.width) || 1);
  const left = Number(rect?.left) || 0;
  return Math.max(0, Math.min(1, (Number(clientX) - left) / width));
}

export function xSharePlayheadPct(currentTime, duration) {
  const t = Math.max(0, Number(currentTime) || 0);
  const dur = Number(duration);
  if (Number.isFinite(dur) && dur > 0.08) {
    return Math.max(0, Math.min(100, (t / dur) * 100));
  }
  const denom = Math.max(t + 0.5, 1);
  return Math.max(0, Math.min(95, (t / denom) * 100));
}

export function xSharePreviewLoopRestart(current, duration, trimIn = 0, trimOut = null) {
  const dur = Number(duration);
  const t = Number(current) || 0;
  // Unknown / not-yet-decoded length: never snap the playhead back to 0.
  if (!Number.isFinite(dur) || dur <= 0.08) return t;
  const win = xShareTrimWindow(duration, trimIn, trimOut);
  if (win.duration <= 0.08) return t;
  if (t >= win.trimOut - 0.05 || t < win.trimIn - 0.001) return win.trimIn;
  return t;
}

export function xShareSongPreviewTime(videoSec, songStart, songDuration) {
  const start = Math.max(0, Number(songStart) || 0);
  const full = Math.max(0, Number(songDuration) || 0);
  const t = start + Math.max(0, Number(videoSec) || 0);
  if (full > 0) return Math.min(full, t);
  return t;
}

export const X_SHARE_SITE = "https://render3d.app";
export const X_SHARE_ATTRIBUTION = "Built in Render Studio";
export const X_SHARE_ATTRIBUTION_LINE = `${X_SHARE_ATTRIBUTION} ${X_SHARE_SITE}`;
export const X_SHARE_DEFAULT = `\n\n${X_SHARE_ATTRIBUTION_LINE}`;

/** Map convert XHR / film-job progress to 0–100. Upload 0–40, encode ~42 or job.pct, download 42–95, done 100. */
export function convertProgressPercent(event = {}) {
  if (typeof event === "number") {
    if (!Number.isFinite(event)) return null;
    if (event >= 0 && event <= 1) return Math.max(0, Math.min(100, Math.round(event * 100)));
    return Math.max(0, Math.min(100, Math.round(event)));
  }
  const stage = String(event.stage || "");
  const loaded = Number(event.loaded) || 0;
  const total = Number(event.total) || 0;
  if (stage === "done") return 100;
  if (stage === "upload" && total > 0) return Math.round(40 * (loaded / total));
  if (stage === "encode") {
    if (Number.isFinite(Number(event.percent))) return Math.max(0, Math.min(100, Math.round(Number(event.percent))));
    if (Number.isFinite(Number(event.pct))) return Math.max(0, Math.min(100, Math.round(Number(event.pct))));
    return 42;
  }
  if (stage === "download" && total > 0) return 42 + Math.round(53 * (loaded / total));
  if (Number.isFinite(Number(event.percent))) return Math.max(0, Math.min(100, Math.round(Number(event.percent))));
  if (Number.isFinite(Number(event.pct))) return Math.max(0, Math.min(100, Math.round(Number(event.pct))));
  return null;
}

export function normalizeXShareCaption(text) {
  // X auto-links https://render3d.app. Keep it next to "Render Studio":
  //   testing this out
  //
  //   Built in Render Studio https://render3d.app
  let caption = String(text ?? "");
  if (!caption.trim()) return X_SHARE_DEFAULT;
  const hasAttr = /Built in Render Studio/i.test(caption);
  const hasSite = /render3d\.app/i.test(caption);
  if (!hasAttr) {
    caption = `${caption.replace(/[ \t]+$/g, "").replace(/\n+$/g, "")}\n\n${X_SHARE_ATTRIBUTION}`;
  }
  if (!hasSite) {
    if (/Built in Render Studio\s*$/i.test(caption)) {
      caption = caption.replace(/Built in Render Studio\s*$/i, X_SHARE_ATTRIBUTION_LINE);
    } else {
      caption = `${caption.replace(/\n+$/g, "")} ${X_SHARE_SITE}`;
    }
  }
  if (caption.length <= 270) return caption;
  const budget = 270 - X_SHARE_ATTRIBUTION_LINE.length - 2;
  const user = caption
    .replace(/\n+Built in Render Studio(?:\s+https?:\/\/render3d\.app\/?)?\s*$/i, "")
    .slice(0, Math.max(0, budget))
    .trimEnd();
  return user ? `${user}\n\n${X_SHARE_ATTRIBUTION_LINE}` : X_SHARE_DEFAULT;
}

export function xComposeHref(text) {
  const caption = normalizeXShareCaption(text);
  const params = new URLSearchParams();
  params.set("text", caption);
  return {
    caption,
    url: `https://x.com/intent/post?${params.toString()}`,
    prev: `https://twitter.com/intent/tweet?${params.toString()}`,
  };
}

const DEFAULTS = {
  quality: "ultra", // standard | high | ultra — default to film max
  shareFormat: "mp4",
  fps: 60,
  mic: true, // always on unless the user unchecks Include microphone
  target: "page", // page | fullscreen | viewport — full tab so Docs stays in the clip
};

const X_LOGO_PATH = `M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.734l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z`;
const X_LOGO_SVG = `<svg class="viewport-video-share-logo" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="${X_LOGO_PATH}"/></svg>`;
const X_LOGO_TITLE_SVG = `<svg class="viewport-video-share-logo viewport-video-x-title-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${X_LOGO_PATH}"/></svg>`;
const DISCORD_LOGO_SVG = `<svg class="viewport-video-share-logo" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="#5865F2" d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`;

const RECORD_DONE_AGENT_QUESTION = "I just finished recording in Render Studio. How do I edit this clip in the Editor tab — AI film-edit prompts, trimming by hand, Share, and GIF?";

const RECORD_DONE_HINT_MARKUP = `
  <div class="auth-backdrop" data-record-done-dismiss></div>
  <div class="auth-card record-done-hint-card r3d-record-done-card">
    <div class="record-done-hint-head">
      <img class="record-done-hint-logo" src="/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1" alt="Render Studio" width="40" height="40" />
      <div class="record-done-hint-heading">
        <h2 id="record-done-hint-title">You’re done recording</h2>
        <p class="muted small">Cut, caption, or share this clip in the Editor tab.</p>
      </div>
      <nav class="record-done-hint-social" aria-label="Render Studio on the web">
        <a class="record-done-hint-social-link" data-boot-social="x" href="https://x.com/A1_Projects" target="_blank" rel="noopener noreferrer" title="X" aria-label="X">${X_LOGO_SVG}</a>
        <a class="record-done-hint-social-link" data-boot-social="discord" href="https://discord.gg/Gh8p85YpFc" target="_blank" rel="noopener noreferrer" title="Discord" aria-label="Discord">${DISCORD_LOGO_SVG}</a>
      </nav>
    </div>
    <div class="record-done-hint-visual">
      <img class="record-done-hint-shot" src="/assets/studio/record-done-hint.gif?v=20260915-gifbtn1-sharegif2" width="720" height="300" alt="Editor timeline with Share, GIF, and AI film-edit prompt" />
    </div>
    <div class="record-done-hint-pins" aria-hidden="true">
      <span class="record-done-hint-pin record-done-hint-pin--share">
        <svg class="record-done-hint-pin-icon" viewBox="0 0 16 16" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M8 2.4v7.8M4.7 5.3 8 2.4l3.3 2.9M3.4 9V13.2h9.2V9"/></svg>
        Share
      </span>
      <span class="record-done-hint-pin record-done-hint-pin--gif">
        <svg class="record-done-hint-pin-icon" viewBox="0 0 16 16" width="14" height="14"><rect x="1.6" y="3.4" width="12.8" height="9.2" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.55"/><path fill="currentColor" d="M5.15 3.4v9.2h1.1V3.4h-1.1zm4.6 0v9.2h1.1V3.4h-1.1zM1.6 6.2h2v1.1H1.6zm0 3.3h2v1.1H1.6zm10.8-3.3h2v1.1h-2zm0 3.3h2v1.1h-2z"/></svg>
        GIF
      </span>
    </div>
    <div class="record-done-hint-copy">
      <p><strong>How to edit prompts with AI.</strong> In <strong>AI film edit</strong>, describe the cut — fades, zooms, pacing — then <strong>Improve prompt</strong> and <strong>Generate</strong>.</p>
      <p>You can quickly edit with AI or by hand: trim clips on the timeline, or use Cut / Fade / Dissolve. Highlighted <strong>Share</strong> posts to X or Discord; <strong>GIF</strong> is under Download ▾.</p>
    </div>
    <label class="record-done-hint-remember">
      <input type="checkbox" data-record-done-remember />
      <span>Don’t show this again</span>
    </label>
    <div class="record-done-hint-actions">
      <button type="button" class="btn secondary r3d-record-done-dismiss" data-record-done-dismiss>Dismiss</button>
      <button type="button" class="btn accent r3d-record-done-editor" data-record-done-editor>Open editor</button>
      <button type="button" class="btn accent r3d-record-done-share-x viewport-video-share-xbtn" data-record-done-share-x title="Share to X" aria-label="Share to X" aria-busy="false">${X_LOGO_SVG}<span class="viewport-video-share-x-spinner" hidden aria-hidden="true"></span><span>Share to X</span></button>
      <button type="button" class="btn accent record-done-hint-agent" data-record-done-agent title="Ask Render Agent for more info">Ask Agent<small>More info</small></button>
    </div>
  </div>
`;

const BITRATES = {
  standard: 8_000_000,
  high: 16_000_000,
  ultra: 28_000_000,
};

const STUDIO_SITE_PAGE_RE = /^\/(?:docs|getting-started|updates|privacy|roadmap|skills|marketplace|model-store|agent-store|knowledge-store|credibility)\.html$/;

function autoBitrate({ quality = "ultra", fps = 60, display = false, canvas = null } = {}) {
  const w = canvas?.width || canvas?.clientWidth || 1920;
  const h = canvas?.height || canvas?.clientHeight || 1080;
  const pixels = Math.max(1, Number(w) * Number(h));
  let base = 7_000_000;
  if (pixels > 3_500_000) base = 14_000_000;
  else if (pixels > 2_000_000) base = 11_000_000;
  else if (pixels > 1_200_000) base = 9_000_000;
  const qMul = quality === "ultra" ? 1.25 : quality === "standard" ? 0.75 : 1;
  const fpsMul = Number(fps) >= 60 ? 1.12 : 1;
  const displayMul = display ? 0.9 : 1;
  return Math.round(Math.min(16_000_000, Math.max(5_000_000, base * qMul * fpsMul * displayMul)));
}

function isStudioSitePath(pathname) {
  const path = String(pathname || "");
  if (path === "/" || path === "/index.html?editctx=20260915-1") return true;
  return STUDIO_SITE_PAGE_RE.test(path);
}

function readPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    const target = raw.target === "viewport" || raw.target === "fullscreen" || raw.target === "page"
      ? raw.target
      : DEFAULTS.target;
    const version = Number(raw.v) || 0;
    let quality = BITRATES[raw.quality] ? raw.quality : DEFAULTS.quality;
    let fps = Number(raw.fps) === 30 || Number(raw.fps) === 60 ? Number(raw.fps) : DEFAULTS.fps;
    // v2: old factory default was High / 30 fps. Highest quality is Ultra / 60.
    if (version < 2) {
      if (raw.quality == null || raw.quality === "high") quality = DEFAULTS.quality;
      if (raw.fps == null || Number(raw.fps) === 30) fps = DEFAULTS.fps;
    } else {
      if (raw.quality == null) quality = DEFAULTS.quality;
      if (raw.fps == null) fps = DEFAULTS.fps;
    }
    // v3: microphone stays checked unless the user turns it off after this bump.
    const mic = version < 3 || raw.mic == null ? DEFAULTS.mic : !!raw.mic;
    // v4: full-tab capture so Record → Docs does not kill the clip.
    let nextTarget = target;
    if (version < 4 && (raw.target == null || raw.target === "viewport")) {
      nextTarget = "page";
    }
    const shareFormat = SHARE_FORMATS.includes(raw.shareFormat) ? raw.shareFormat : DEFAULTS.shareFormat;
    const prefs = {
      quality,
      shareFormat,
      fps,
      mic,
      target: nextTarget,
      v: PREFS_VERSION,
    };
    if (version < PREFS_VERSION) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch (_) {}
    }
    return prefs;
  } catch {
    return { ...DEFAULTS, shareFormat: DEFAULTS.shareFormat, v: PREFS_VERSION };
  }
}

function writePrefs(next) {
  const prefs = { ...readPrefs(), ...next, v: PREFS_VERSION };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch (_) {}
  return prefs;
}

export function captureExtForBlob(blob, kind = "video") {
  const type = String(blob?.type || "");
  const name = String(blob?.name || "");
  if (kind === "audio" || type.startsWith("audio/")) {
    const m = name.match(/\.(mp3|wav|m4a|aac|ogg|opus|flac|aiff?|wma|weba)$/i);
    if (m) return m[1].toLowerCase();
    if (/wav/i.test(type)) return "wav";
    if (/flac/i.test(type)) return "flac";
    if (/m4a|aac|mp4/i.test(type)) return "m4a";
    return "mp3";
  }
  if (kind === "screenshot" || type.startsWith("image/")) return "png";
  if (/mp4|m4v/i.test(type)) return "mp4";
  if (/quicktime|mov/i.test(type)) return "mov";
  return "webm";
}

export function captureUploadFilename(blob, { kind = "video", page = false, fullscreen = false, xr = false, crop = false } = {}) {
  const ext = captureExtForBlob(blob, kind);
  return `${captureFileBaseName({ kind, page, fullscreen, xr, crop })}.${ext}`;
}

/** Persist a recording/screenshot under Reference Files. Does not set Content-Type (multipart boundary). */
export async function uploadProjectCapture(blob, {
  projectId,
  token,
  kind = "video",
  folder = "",
  filename = "",
  overwrite = false,
} = {}) {
  if (!blob) throw new Error("Nothing to save.");
  if (!projectId) throw new Error("Open a project first so captures save to Reference Files.");
  const name = filename || captureUploadFilename(blob, { kind, projectId });
  const form = new FormData();
  form.append("file", blob, name);
  form.append("kind", kind === "screenshot" ? "screenshot" : kind === "audio" ? "audio" : "video");
  if (folder) form.append("reference_folder", folder);
  if (overwrite) form.append("overwrite", "1");
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600_000);
  let res;
  try {
    res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/captures`, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("Capture upload timed out.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : `Could not save capture (${res.status}).`);
  }
  return data;
}

function pickMimeType({ xr = false } = {}) {
  const supported = (t) => !!window.MediaRecorder?.isTypeSupported?.(t);
  const candidates = xr
    ? [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp8",
      "video/mp4",
      "video/webm",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp9",
    ]
    : [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];
  for (const type of candidates) {
    if (supported(type)) return type;
  }
  return "";
}

function qualityLabel(q) {
  if (q === "ultra") return "Ultra";
  if (q === "standard") return "Standard";
  return "High";
}

function targetLabel(t) {
  if (t === "page") return "Full page";
  if (t === "fullscreen") return "Fullscreen";
  return "Viewport";
}

export async function openDisplayMediaStream({ fps = 30, fullscreen = false } = {}) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen capture is not available in this browser.");
  }
  const constraints = fullscreen
    ? {
        video: {
          frameRate: { ideal: fps, max: fps },
          displaySurface: "monitor",
        },
        audio: false,
        preferCurrentTab: false,
        selfBrowserSurface: "include",
        surfaceSwitching: "include",
        monitorTypeSurfaces: "include",
      }
    : {
        video: {
          frameRate: { ideal: fps, max: fps },
          displaySurface: "browser",
        },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        monitorTypeSurfaces: "exclude",
      };
  try {
    return await navigator.mediaDevices.getDisplayMedia(constraints);
  } catch (err) {
    if (/preferCurrentTab|selfBrowserSurface|monitorTypeSurfaces|surfaceSwitching|displaySurface/i.test(String(err?.message || err))) {
      return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    }
    throw err;
  }
}

export async function captureDisplayStill({ fullscreen = false } = {}) {
  const stream = await openDisplayMediaStream({ fps: 30, fullscreen });
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    if (w < 8 || h < 8) throw new Error("Screen capture did not produce a frame.");
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not capture the screen.");
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/png");
  } finally {
    try { video.pause(); } catch (_) {}
    video.srcObject = null;
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** Score Quest / XR camera labels — prefer world/passthrough over selfie. */
function scorePovCameraLabel(label = "") {
  const l = String(label || "").toLowerCase();
  if (/front|selfie|user|facing\s*front/.test(l)) return 0;
  if (/facing\s*back|environment|passthrough|world/.test(l)) return 5;
  if (/\bcamera\s*2\b|\bcamera\s*1\b/.test(l)) return 4;
  if (/back|external|rear/.test(l)) return 3;
  return 1;
}

function pickBestPovDeviceId(devices, currentId = "") {
  const cams = (devices || []).filter((d) => d.kind === "videoinput");
  if (!cams.length) return currentId || "";
  const ranked = cams.slice().sort((a, b) => scorePovCameraLabel(b.label) - scorePovCameraLabel(a.label));
  const best = ranked[0];
  if (!best) return currentId || "";
  // Keep current if it's already a strong POV camera.
  const cur = cams.find((d) => d.deviceId === currentId);
  if (cur && scorePovCameraLabel(cur.label) >= 3) return currentId;
  return best.deviceId || currentId || "";
}

/**
 * Open the headset's world / passthrough camera for XR POV recording.
 * Quest Browser exposes these via getUserMedia (not WebXR camera-access).
 */
async function openXrPovCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera API not available in this browser.");
  }
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 960 },
        frameRate: { ideal: 30 },
      },
    });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: true,
    });
  }

  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (_) {}
  const track = stream.getVideoTracks()?.[0];
  const currentId = track?.getSettings?.()?.deviceId || "";
  const bestId = pickBestPovDeviceId(devices, currentId);
  if (bestId && bestId !== currentId) {
    try {
      stream.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: bestId },
          width: { ideal: 1280 },
          height: { ideal: 960 },
          frameRate: { ideal: 30 },
        },
      });
    } catch (err) {
      console.warn("[viewport-video] preferred POV camera failed, keeping first stream", err);
      // Re-open fallback if we already stopped the first stream.
      if (!stream?.active) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
    }
  }
  return stream;
}

function drawCoverImage(ctx, source, w, h) {
  const sw = source.videoWidth || source.width || w;
  const sh = source.videoHeight || source.height || h;
  if (!sw || !sh) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.drawImage(source, dx, dy, dw, dh);
}

/**
 * XR framebuffers are often left|right side-by-side. Use the left eye for a mono POV overlay.
 */
function xrOverlaySourceRect(canvas) {
  const w = canvas.width || 1;
  const h = canvas.height || 1;
  const aspect = w / Math.max(1, h);
  if (aspect >= 1.55) {
    return { sx: 0, sy: 0, sw: Math.floor(w / 2), sh: h };
  }
  return { sx: 0, sy: 0, sw: w, sh: h };
}

export function createViewportVideoRecorder({
  getCanvas,
  onStatus,
  onMenuOpen,
  api,
  getToken,
  getProjectId,
  isFreeTrialCredits,
  isXrPresenting = null,
  getXrModeLabel = null,
  getXrSessionMode = null,
  getXrOverlayCanvas = null,
  getXrPassthroughOn = null,
  getXrMicStream = null,
  onSaveClip = null,
  onRecordingChange = null,
  onClipReady = null,
  onSendClipToChat = null,
  onRefreshFiles = null,
  getAiKeyBodyFields = null,
  getAiKeyPickerState = null,
  setAiKeyPickerValue = null,
  getAiKeyDisplay = null,
  onOpenAiKeyPicker = null,
  docTabs = null,
  listProjectVideos = null,
  fetchProjectVideo = null,
  getCurrentUser = null,
  getRemoteUsers = null,
  sendCollab = null,
  onOpenProfile = null,
  onShareProject = null,
  onAskRenderAgent = null,
} = {}) {
  let prefs = readPrefs();
  let recorder = null;
  let chunks = [];
  let mixedStream = null;
  let micStream = null;
  let povCameraStream = null;
  let povVideoEl = null;
  let povCompositeCanvas = null;
  let povCompositeCtx = null;
  let povCaptureTrack = null;
  let povRafId = 0;
  let startedAt = 0;
  let tickTimer = 0;
  let recording = false;
  let recordingStarting = false;
  let recordingStartTask = null;
  let recordingStartEpoch = 0;
  let startedInXr = false;
  let usedXrPov = false;
  let paused = false;
  let pauseStartedAt = 0;
  let pausedAccumMs = 0;
  let lastBlob = null;
  let sourceBlob = null;
  let shareModalEl = null;
  let videoEditor = null;
  let appendNextViewportTake = false;
  let pendingDesktopClip = null;
  let lastCaptureMeta = {};
  let sessionDisplayCapture = false;
  let browseFrame = null;
  let overlayEl = null;
  let donePopupEl = null;
  let overlayDrag = null;
  let overlayDock = "viewport";
  let overlayUserPos = { viewport: null, screen: null };
  let overlayLayoutBound = false;
  let displayCaptureTrack = null;
  let siteNavBound = false;
  let recMessageBound = false;
  let viewportBrowseHinted = false;
  const persistedBlobs = typeof WeakSet === "function" ? new WeakSet() : null;
  const persistedResults = new WeakMap();
  const saveInFlight = new WeakMap();
  let clipDownloadBusy = false;
  let clipDownloadPct = null;
  let pendingXShareBlob = null;
  let xShareInPlace = false;
  const sharePreviewCreated = [];
  const downloadCreated = [];
  let xShareSheet = {
    grade: "none",
    song: null,
    keepAudio: true,
    overlaySong: true,
    previewUrl: "",
    duration: 0,
    trimIn: 0,
    trimOut: null,
    trimInPct: 0,
    trimOutPct: 1,
  };
  function revokeXShareSheetUrls() { // leakfix25
    pauseAndDetachMedia(xSharePreviewEl());
    pauseAndDetachMedia(xShareSongEl());
    const previewUrl = xShareSheet.previewUrl;
    const songUrl = xShareSheet.song?.url;
    xShareSheet.previewUrl = "";
    if (xShareSheet.song) xShareSheet.song.url = "";
    if (previewUrl) {
      try { URL.revokeObjectURL(previewUrl); } catch { /* ignore */ }
    }
    if (songUrl && songUrl !== previewUrl) {
      try { URL.revokeObjectURL(songUrl); } catch { /* ignore */ }
    }
  }
  let xTrimDrag = null;
  let xSongWaveDrag = false;
  let xShareRaf = 0;
  let downloadToastTimer = 0;
  let editorProjectName = "Video Editor";
  let editorTimelineDraft = null;
  let editorAutosaveTimer = 0;
  let restoringEditorProject = "";

  const EDITOR_IDB_NAME = "render3d-video-editor";
  const EDITOR_IDB_STORE = "media";

  function editorSessionKey() {
    return editorSessionStorageKey(getProjectId?.());
  }

  function readEditorSession() {
    try {
      const raw = JSON.parse(localStorage.getItem(editorSessionKey()) || "null");
      return raw && typeof raw === "object" ? raw : null;
    } catch {
      return null;
    }
  }

  function writeEditorSession(patch) {
    const prev = readEditorSession() || {};
    const next = {
      ...prev,
      ...patch,
      name: patch.name || prev.name || editorProjectName,
      view: patch.view || prev.view || "studio",
      at: Date.now(),
    };
    try { localStorage.setItem(editorSessionKey(), JSON.stringify(next)); } catch (_) {}
    return next;
  }

  function openEditorIdb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("no idb"));
        return;
      }
      const req = indexedDB.open(EDITOR_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(EDITOR_IDB_STORE)) {
          req.result.createObjectStore(EDITOR_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("idb"));
    });
  }

  function editorMediaCacheKey(persistKey) {
    return `${getProjectId?.() || "none"}:${editorProjectName}:${persistKey || ""}`;
  }

  async function cacheEditorMediaBlob(file, persistKey) {
    if (!file || !persistKey) return;
    try {
      const db = await openEditorIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(EDITOR_IDB_STORE, "readwrite");
        tx.objectStore(EDITOR_IDB_STORE).put({
          blob: file,
          name: file.name || "audio.mp3",
          type: file.type || "audio/mpeg",
          persistKey,
        }, editorMediaCacheKey(persistKey));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close?.();
    } catch (_) {}
  }

  async function readCachedEditorMedia(persistKey) {
    if (!persistKey) return null;
    try {
      const db = await openEditorIdb();
      const row = await new Promise((resolve, reject) => {
        const tx = db.transaction(EDITOR_IDB_STORE, "readonly");
        const req = tx.objectStore(EDITOR_IDB_STORE).get(editorMediaCacheKey(persistKey));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close?.();
      const blob = row?.blob;
      if (!blob) return null;
      if (typeof File !== "undefined") {
        return new File([blob], row.name || "audio.mp3", { type: row.type || blob.type || "audio/mpeg" });
      }
      return blob;
    } catch {
      return null;
    }
  }

  const VIDEO_RECORD_ICON = `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.5" y="5" width="11" height="10" rx="2"/><path d="M13.5 8.2L17.5 6v8L13.5 11.8V8.2z" fill="currentColor" stroke="none"/></svg>`;
  const VIDEO_DOWNLOAD_ICON = `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.5" y="5" width="11" height="10" rx="2"/><path d="M8 9.2v4.2m0 0L6.2 11.6M8 13.4l1.8-1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 8.2L17.5 6v8L13.5 11.8V8.2z" fill="currentColor" stroke="none"/></svg>`;

  function els() {
    return {
      main: document.getElementById("btn-video-record"),
      options: document.getElementById("btn-video-options"),
      menu: document.getElementById("viewport-video-menu"),
      timer: document.getElementById("viewport-video-timer"),
    };
  }

  function setStatus(ok, msg) {
    onStatus?.(ok, msg);
  }

  function recordingElapsedMs() {
    if (!recording) return 0;
    const end = paused ? pauseStartedAt : Date.now();
    return Math.max(0, end - startedAt - pausedAccumMs);
  }

  function emitRecordingChange() {
    try {
      onRecordingChange?.({
        recording,
        paused,
        elapsedMs: recordingElapsedMs(),
      });
    } catch (err) {
      console.warn("[viewport-video] onRecordingChange", err);
    }
    syncOverlayUi();
  }

  async function saveClipToProject(blob, meta = {}) {
    if (!blob) return null;
    if (persistedBlobs?.has(blob) && persistedResults?.has(blob)) {
      return persistedResults.get(blob);
    }
    if (saveInFlight.has(blob)) return saveInFlight.get(blob);
    const run = persistClipToProject(blob, meta);
    saveInFlight.set(blob, run);
    try {
      return await run;
    } finally {
      saveInFlight.delete(blob);
    }
  }

  async function persistClipToProject(blob, meta = {}) {
    const kind = meta.kind === "screenshot" ? "screenshot" : meta.kind === "audio" ? "audio" : "video";
    const folder = meta.folder
      || (kind === "screenshot" ? "Screenshots" : "Screen Recordings");
    const xr = !!(meta.xr || isXrPresenting?.());
    const page = !!meta.page;
    const fullscreen = !!meta.fullscreen;
    const crop = !!meta.crop;
    const payload = {
      ...meta,
      kind,
      folder,
      xr,
      page,
      fullscreen,
      crop,
      modeLabel: meta.modeLabel || (xr ? (getXrModeLabel?.() || "AR") : null),
    };
    lastCaptureMeta = payload;
    const projectId = getProjectId?.() || "";
    let saved = meta.saved || null;
    const sourcePath = normalizeVideoEditorSourcePath(
      meta.sourcePath || meta.source_path || saved?.filename || "",
    );
    if (isVideoEditorFolderKey(folder) && !shouldCopyBytesIntoVideoEditorFolder({ kind, sourcePath })) {
      const projectName = videoEditorProjectNameFromFolder(folder)
        || videoEditorProjectNameFromSource(sourcePath, meta.label);
      const ref = sourcePath ? videoEditorSourceRefFromPath(sourcePath, { kind }) : null;
      const row = await persistVideoEditorSourceRefs(projectName, {
        sources: ref ? [ref] : [],
        refresh: true,
      });
      saved = {
        filename: sourcePath || row?.folder,
        folder: videoEditorFolderKey(projectName),
        path_ref: true,
        kind,
        name: row?.name || projectName,
      };
      if (saved?.filename) {
        persistedBlobs?.add(blob);
        persistedResults?.set(blob, saved);
      }
      return saved;
    }
    // Clip editor / Share must never replace this upload — always persist to Reference Files.
    if (!saved) {
      try {
        saved = await uploadProjectCapture(blob, {
          projectId,
          token: getToken?.(),
          kind,
          folder,
          filename: meta.filename || captureUploadFilename(blob, { kind, page, fullscreen, xr, crop, projectId }),
          overwrite: !!meta.overwrite,
        });
      } catch (err) {
        console.warn("[viewport-video] capture upload failed", err);
        setStatus(false, err?.message || `Could not save ${kind === "screenshot" ? "screenshot" : "clip"} to Reference Files → ${folder}.`);
      }
    }
    if (typeof onSaveClip === "function") {
      try {
        const extra = await onSaveClip(blob, { ...payload, saved });
        if (!saved) saved = extra;
      } catch (err) {
        console.warn("[viewport-video] onSaveClip failed", err);
      }
    }
    if (saved?.filename) {
      persistedBlobs?.add(blob);
      persistedResults?.set(blob, saved);
      try { onRefreshFiles?.(); } catch (_) {}
    } else if (!saved && !projectId) {
      setStatus(false, `Open a project first so captures save under Reference Files → ${folder}.`);
    }
    return saved;
  }

  function closeMenu() {
    const { menu, options } = els();
    menu?.classList.add("hidden");
    options?.setAttribute("aria-expanded", "false");
  }

  function openMenu() {
    const { menu, options } = els();
    if (!menu || !options) return;
    onMenuOpen?.();
    syncMenuUi();
    menu.classList.remove("hidden");
    options.setAttribute("aria-expanded", "true");
  }

  function toggleMenu() {
    const { menu } = els();
    if (!menu) return;
    if (menu.classList.contains("hidden")) openMenu();
    else closeMenu();
  }

  function formatElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const sec = String(s % 60).padStart(2, "0");
    return `${m}:${sec}`;
  }

  const OVERLAY_SNAP = 8;

  function snapOverlayPx(n) {
    return Math.round(Number(n) / OVERLAY_SNAP) * OVERLAY_SNAP;
  }

  function isAwayFromViewport() {
    if (browseFrame && !browseFrame.hidden) return true;
    const vp = document.getElementById("viewport");
    if (!vp) return false;
    return vp.classList.contains("doc-viewer-active")
      || vp.classList.contains("dxf-viewer-active")
      || vp.classList.contains("ref-viewer-active");
  }

  function captureCropElement() {
    if (browseFrame && !browseFrame.hidden) return browseFrame;
    const vp = document.getElementById("viewport");
    if (vp && !isAwayFromViewport()) return vp;
    return document.getElementById("app") || document.documentElement;
  }

  async function cropDisplayTrack() {
    const track = displayCaptureTrack;
    if (!track || !sessionDisplayCapture) return;
    const CropTargetCtor = window.CropTarget;
    if (!CropTargetCtor?.fromElement || typeof track.cropTo !== "function") return;
    const surface = captureCropElement();
    if (!surface) return;
    try {
      const target = await CropTargetCtor.fromElement(surface);
      await track.cropTo(target);
    } catch (err) {
      console.warn("[viewport-video] overlay crop", err);
    }
  }

  function defaultOverlayPos(dock, el) {
    const w = el?.offsetWidth || 84;
    const h = el?.offsetHeight || 168;
    const margin = 10;
    if (dock === "viewport") {
      const r = document.getElementById("viewport")?.getBoundingClientRect();
      if (r && r.width > 48 && r.height > 48) {
        return {
          left: r.right - w - margin,
          top: r.top + r.height * 0.42 - h / 2,
        };
      }
    }
    const vw = window.visualViewport?.width || window.innerWidth;
    const vh = window.visualViewport?.height || window.innerHeight;
    const ox = window.visualViewport?.offsetLeft || 0;
    const oy = window.visualViewport?.offsetTop || 0;
    return {
      left: ox + vw - w - margin,
      top: oy + vh * 0.42 - h / 2,
    };
  }

  function clampOverlayPos(left, top, el) {
    const w = el?.offsetWidth || 84;
    const h = el?.offsetHeight || 168;
    const maxX = Math.max(8, window.innerWidth - w - 8);
    const maxY = Math.max(8, window.innerHeight - h - 8);
    return {
      left: Math.max(8, Math.min(left, maxX)),
      top: Math.max(8, Math.min(top, maxY)),
    };
  }

  function applyOverlayPosition({ snapNow = false } = {}) {
    if (!overlayEl || !recording) return;
    const dock = isAwayFromViewport() ? "screen" : "viewport";
    overlayDock = dock;
    overlayEl.classList.toggle("r3d-record-overlay--screen", dock === "screen");
    overlayEl.classList.toggle("r3d-record-overlay--viewport", dock === "viewport");
    overlayEl.dataset.dock = dock;
    const custom = overlayUserPos[dock];
    let pos = custom || defaultOverlayPos(dock, overlayEl);
    if (snapNow || custom) {
      pos = { left: snapOverlayPx(pos.left), top: snapOverlayPx(pos.top) };
    }
    pos = clampOverlayPos(pos.left, pos.top, overlayEl);
    overlayEl.style.left = `${Math.round(pos.left)}px`;
    overlayEl.style.top = `${Math.round(pos.top)}px`;
    overlayEl.style.right = "auto";
    overlayEl.style.bottom = "auto";
    overlayEl.style.transform = "none";
  }

  function bindOverlayDrag(el) {
    if (!el || el.dataset.dragBound === "1") return;
    el.dataset.dragBound = "1";
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("[data-r3d-rec]")) return;
      const rect = el.getBoundingClientRect();
      overlayDrag = {
        pointerId: e.pointerId,
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
      };
      el.classList.add("is-dragging");
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    el.addEventListener("pointermove", (e) => {
      if (!overlayDrag || overlayDrag.pointerId !== e.pointerId) return;
      const snapped = clampOverlayPos(
        snapOverlayPx(e.clientX - overlayDrag.dx),
        snapOverlayPx(e.clientY - overlayDrag.dy),
        el,
      );
      el.style.left = `${snapped.left}px`;
      el.style.top = `${snapped.top}px`;
      el.style.right = "auto";
      el.style.transform = "none";
    });
    const endDrag = (e) => {
      if (!overlayDrag || overlayDrag.pointerId !== e.pointerId) return;
      el.classList.remove("is-dragging");
      const rect = el.getBoundingClientRect();
      overlayUserPos[overlayDock] = {
        left: snapOverlayPx(rect.left),
        top: snapOverlayPx(rect.top),
      };
      overlayDrag = null;
      applyOverlayPosition({ snapNow: true });
    };
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
  }

  function bindOverlayLayout() {
    if (overlayLayoutBound) return;
    overlayLayoutBound = true;
    const relayout = () => {
      if (!recording) return;
      applyOverlayPosition();
      void cropDisplayTrack();
    };
    window.addEventListener("resize", relayout);
    window.visualViewport?.addEventListener("resize", relayout);
    window.visualViewport?.addEventListener("scroll", relayout);
    const vp = document.getElementById("viewport");
    if (vp && typeof MutationObserver === "function") {
      new MutationObserver(relayout).observe(vp, { attributes: true, attributeFilter: ["class"] });
    }
    document.getElementById("doc-tab-bar")?.addEventListener("click", () => {
      window.setTimeout(relayout, 0);
    });
  }

  function ensureRecordOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.id = "r3d-record-overlay";
    overlayEl.className = "r3d-record-overlay r3d-record-overlay--off";
    overlayEl.setAttribute("role", "toolbar");
    overlayEl.setAttribute("aria-label", "Recording controls");
    overlayEl.setAttribute("aria-hidden", "true");
    overlayEl.innerHTML = `
      <span class="r3d-record-overlay-grip" aria-hidden="true">
        <span class="r3d-record-overlay-live"></span>
        <span class="r3d-record-overlay-kicker">REC</span>
        <span class="r3d-record-overlay-time" data-r3d-rec-time>0:00</span>
      </span>
      <button type="button" class="r3d-record-overlay-btn" data-r3d-rec="pause" title="Pause recording" aria-label="Pause recording"><span aria-hidden="true">❚❚</span><span>Pause</span></button>
      <button type="button" class="r3d-record-overlay-btn" data-r3d-rec="resume" title="Resume recording" aria-label="Resume recording" hidden><span aria-hidden="true">▶</span><span>Play</span></button>
      <button type="button" class="r3d-record-overlay-btn r3d-record-overlay-btn--stop" data-r3d-rec="stop" title="Stop recording" aria-label="Stop recording"><span aria-hidden="true">■</span><span>Stop</span></button>
      <button type="button" class="r3d-record-overlay-btn r3d-record-overlay-btn--editor" data-r3d-rec="editor" title="Open editor" aria-label="Open editor">Editor</button>
      <button type="button" class="r3d-record-overlay-btn r3d-record-overlay-btn--share-x viewport-video-share-xbtn" data-r3d-rec="share-x" title="Share to X" aria-label="Share to X" aria-busy="false">${X_LOGO_SVG}<span class="viewport-video-share-x-spinner" hidden aria-hidden="true"></span><span>Share to X</span></button>
    `;
    overlayEl.addEventListener("click", (e) => {
      const action = e.target.closest("[data-r3d-rec]")?.dataset.r3dRec;
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === "pause") pauseRecording();
      else if (action === "resume") resumeRecording();
      else if (action === "stop") void stopRecording();
      else if (action === "studio") hideBrowseFrame();
      else if (action === "editor") void openClipEditorFromChrome();
      else if (action === "share-x") void openShareToXFromChrome();
    });
    bindOverlayDrag(overlayEl);
    bindOverlayLayout();
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function mountRecordChrome() {
    if (!recording) return;
    const host = document.fullscreenElement || document.body;
    if (browseFrame) host.appendChild(browseFrame);
    const overlay = ensureRecordOverlay();
    host.appendChild(overlay);
  }

  function injectFrameControls(doc) {
    /* Overlay stays on the parent page so Region Capture can crop it out of the clip. */
    if (!doc) return;
  }

  function bindRecMessages() {
    if (recMessageBound) return;
    recMessageBound = true;
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin) return;
      if (e.data?.source !== "r3d-rec") return;
      const action = String(e.data.action || "");
      if (action === "pause") pauseRecording();
      else if (action === "resume") resumeRecording();
      else if (action === "stop") void stopRecording();
      else if (action === "studio") hideBrowseFrame();
      else if (action === "editor") void openClipEditorFromChrome();
      else if (action === "share-x") void openShareToXFromChrome();
    });
  }

  function syncOverlayUi() {
    const inXr = !!isXrPresenting?.();
    const live = !!(recording && !inXr);
    document.documentElement.classList.toggle("r3d-is-recording", live);
    document.body.classList.toggle("r3d-is-recording", live);
    if (!live) {
      if (overlayEl) {
        overlayEl.classList.add("r3d-record-overlay--off");
        overlayEl.classList.remove("is-dragging", "is-paused");
        overlayEl.setAttribute("aria-hidden", "true");
      }
      return;
    }
    const el = ensureRecordOverlay();
    mountRecordChrome();
    el.classList.remove("r3d-record-overlay--off", "hidden");
    el.setAttribute("aria-hidden", "false");
    const timeEl = el.querySelector("[data-r3d-rec-time]");
    if (timeEl) timeEl.textContent = formatElapsed(recordingElapsedMs());
    el.classList.toggle("is-paused", !!paused);
    const pauseBtn = el.querySelector('[data-r3d-rec="pause"]');
    const resumeBtn = el.querySelector('[data-r3d-rec="resume"]');
    const editorBtn = el.querySelector('[data-r3d-rec="editor"]');
    if (pauseBtn) pauseBtn.hidden = !!paused;
    if (resumeBtn) resumeBtn.hidden = !paused;
    if (editorBtn) editorBtn.hidden = false;
    applyOverlayPosition();
    void cropDisplayTrack();
  }

  function hideBrowseFrame() {
    if (!browseFrame) return;
    browseFrame.hidden = true;
    browseFrame.removeAttribute("src");
    document.body.classList.remove("r3d-recording-browse");
    if (overlayEl) syncOverlayUi();
  }

  function recordDoneUserId() {
    return getCurrentUser?.()?.id || null;
  }

  function rememberRecordDoneIfRequested() {
    const el = donePopupEl || document.getElementById("record-done-hint-modal");
    if (el?.querySelector("[data-record-done-remember]")?.checked) {
      reminderMarkSeen(RECORD_DONE_HINT_KEY, recordDoneUserId());
    }
  }

  function hideRecordDonePopup() {
    const el = donePopupEl || document.getElementById("record-done-hint-modal");
    el?.classList.add("hidden");
  }

  function openRecordDoneAgent() {
    rememberRecordDoneIfRequested();
    hideRecordDonePopup();
    const question = RECORD_DONE_AGENT_QUESTION;
    if (typeof onAskRenderAgent === "function") {
      onAskRenderAgent({ question, autoSend: true });
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

  function finishRecordDonePopup({ openEditor = false, shareX = false } = {}) {
    rememberRecordDoneIfRequested();
    hideRecordDonePopup();
    if (openEditor) void openClipEditorFromChrome({ fromRecording: true });
    else if (shareX) void openShareToXFromChrome();
  }

  function bindRecordDonePopup(el) {
    if (!el || el.dataset.recordDoneBound === "1") return el;
    el.dataset.recordDoneBound = "1";
    el.querySelectorAll("[data-record-done-dismiss]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        finishRecordDonePopup();
      });
    });
    el.querySelector("[data-record-done-editor]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      finishRecordDonePopup({ openEditor: true });
    });
    el.querySelector("[data-record-done-share-x]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      finishRecordDonePopup({ shareX: true });
    });
    el.querySelector("[data-record-done-agent]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRecordDoneAgent();
    });
    return el;
  }

  function ensureRecordDonePopup() {
    if (donePopupEl) return bindRecordDonePopup(donePopupEl);
    donePopupEl = document.getElementById("record-done-hint-modal");
    if (!donePopupEl) {
      donePopupEl = document.createElement("div");
      donePopupEl.id = "record-done-hint-modal";
      donePopupEl.className = "auth-modal r3d-record-done hidden";
      donePopupEl.setAttribute("role", "dialog");
      donePopupEl.setAttribute("aria-modal", "true");
      donePopupEl.setAttribute("aria-labelledby", "record-done-hint-title");
      donePopupEl.innerHTML = RECORD_DONE_HINT_MARKUP;
      document.body.appendChild(donePopupEl);
    }
    return bindRecordDonePopup(donePopupEl);
  }

  function showRecordDonePopup() {
    if (reminderHasSeen(RECORD_DONE_HINT_KEY, recordDoneUserId())) return false;
    const el = ensureRecordDonePopup();
    const remember = el.querySelector("[data-record-done-remember]");
    if (remember) remember.checked = false;
    const host = document.fullscreenElement || document.body;
    host.appendChild(el);
    el.classList.remove("hidden");
    return true;
  }

  function openClipEditorFromChrome(opts = {}) {
    hideBrowseFrame();
    hideRecordDonePopup();
    const blob = opts.blob || lastBlob || pendingDesktopClip;
    if (blob) void openShareModal(blob, { label: opts.label || "Clip" });
    else void openEditorTab({ label: opts.label || "Video Editor" });
  }

  async function openShareToXFromChrome(opts = {}) {
    hideBrowseFrame();
    hideRecordDonePopup();
    const blob = opts.blob || lastBlob || pendingDesktopClip;
    if (blob) {
      await shareBlobToX(blob, { inPlace: true });
      return;
    }
    await openEditorTab({ label: opts.label || "Video Editor" });
    await postToX();
  }

  function bindBrowseDocument(doc) {
    if (!doc) return;
    try {
      injectFrameControls(doc);
    } catch (_) {
      /* ignore */
    }
    if (doc.documentElement?.dataset.r3dRecNav === "1") return;
    try {
      doc.documentElement.dataset.r3dRecNav = "1";
    } catch (_) {
      return;
    }
    doc.addEventListener("click", onSiteNavClick, true);
  }

  function showBrowseFrame(href) {
    if (!browseFrame) {
      browseFrame = document.createElement("iframe");
      browseFrame.id = "r3d-record-browse";
      browseFrame.className = "r3d-record-browse";
      browseFrame.title = "Site page (recording continues)";
      browseFrame.addEventListener("load", () => {
        try {
          bindBrowseDocument(browseFrame.contentDocument);
        } catch (_) {
          /* cross-origin */
        }
      });
      document.body.appendChild(browseFrame);
    }
    browseFrame.hidden = false;
    document.body.classList.add("r3d-recording-browse");
    mountRecordChrome();
    if (browseFrame.getAttribute("src") !== href) browseFrame.src = href;
    else {
      try {
        bindBrowseDocument(browseFrame.contentDocument);
      } catch (_) {}
    }
    syncOverlayUi();
  }

  function isStudioPath(pathname) {
    const p = String(pathname || "/").replace(/\/+$/, "") || "/";
    return p === "/" || p === "/index.html?editctx=20260915-1";
  }

  function isSameOriginBrowseUrl(url) {
    if (!url || url.origin !== location.origin) return false;
    if (isStudioPath(url.pathname)) return false;
    if (url.pathname.startsWith("/api/")) return false;
    if (/\.(js|css|map|png|jpe?g|gif|webp|svg|ico|glb|gltf|zip|pdf|json|woff2?|mp4|webm|wasm)$/i.test(url.pathname)) {
      return false;
    }
    return true;
  }

  function onSiteNavClick(e) {
    if (!recording) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const a = e.target?.closest?.("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const raw = a.getAttribute("href");
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return;
    let url;
    try {
      url = new URL(raw, a.baseURI || document.baseURI || location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) return;
    if (isStudioPath(url.pathname)) {
      if (browseFrame && !browseFrame.hidden) {
        e.preventDefault();
        e.stopPropagation();
        hideBrowseFrame();
      }
      return;
    }
    if (!isSameOriginBrowseUrl(url)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    if (!sessionDisplayCapture && !viewportBrowseHinted) {
      viewportBrowseHinted = true;
      setStatus(
        true,
        "Still recording. Use Full page or Fullscreen in ▾ Capture if you want Docs in the clip — Pause / Stop stay on the right.",
      );
    }
    showBrowseFrame(url.href);
  }

  function bindSiteNavGuard() {
    if (siteNavBound) return;
    siteNavBound = true;
    document.addEventListener("click", onSiteNavClick, true);
    window.addEventListener("click", onSiteNavClick, true);
    window.addEventListener("beforeunload", onRecordBeforeUnload);
    document.addEventListener("fullscreenchange", () => {
      if (recording) mountRecordChrome();
      if (donePopupEl && !donePopupEl.classList.contains("hidden")) {
        (document.fullscreenElement || document.body).appendChild(donePopupEl);
      }
    });
  }

  function onRecordBeforeUnload(e) {
    if (!recording) return;
    e.preventDefault();
    e.returnValue = "";
  }

  function setClipDownloadBusy(busy, { percent = null } = {}) {
    clipDownloadBusy = !!busy;
    if (!busy) clipDownloadPct = null;
    else if (Number.isFinite(Number(percent))) {
      const n = Math.max(0, Math.min(100, Math.round(Number(percent))));
      clipDownloadPct = clipDownloadPct == null ? n : Math.max(clipDownloadPct, n);
    } else if (clipDownloadPct == null) {
      clipDownloadPct = 0;
    }
    const btn = shareModalEl?.querySelector("[data-video-share-download]");
    const n = clipDownloadBusy ? clipDownloadPct : null;
    if (btn) {
      btn.disabled = !!busy;
      btn.classList.toggle("is-loading", !!busy);
      btn.setAttribute("aria-busy", busy ? "true" : "false");
      btn.title = busy
        ? (n != null ? `Downloading… ${n}%` : "Downloading…")
        : "Download";
      const spinner = btn.querySelector(".viewport-video-download-spinner");
      const pct = btn.querySelector("[data-video-download-pct]");
      const caret = btn.querySelector(".viewport-video-download-caret");
      if (spinner) {
        if (busy) spinner.removeAttribute("hidden");
        else spinner.setAttribute("hidden", "");
      }
      if (pct) {
        if (busy && n != null) {
          pct.hidden = false;
          pct.textContent = `${n}%`;
        } else {
          pct.hidden = true;
        }
      }
      if (caret) caret.toggleAttribute("hidden", !!busy);
    }
    syncMainUi();
  }

  function showVideoDownloadPopup(message, isError = false) {
    const host = document.querySelector(".viewport-video-control");
    if (!host) {
      setStatus(!isError, message);
      return;
    }
    let toast = host.querySelector("[data-video-download-toast]");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "viewport-video-download-toast";
      toast.dataset.videoDownloadToast = "1";
      toast.setAttribute("role", "status");
      host.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle("is-error", !!isError);
    toast.classList.remove("hidden", "is-leaving");
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    if (downloadToastTimer) window.clearTimeout(downloadToastTimer);
    downloadToastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.classList.add("hidden"), 220);
    }, isError ? 4200 : 2800);
  }

  function syncMainUi() {
    const { main, timer } = els();
    if (!main) return;
    const downloading = clipDownloadBusy && !recording;
    main.classList.toggle("is-recording", recording);
    main.classList.toggle("is-downloading", downloading);
    main.setAttribute("aria-pressed", recording ? "true" : "false");
    main.setAttribute("aria-busy", downloading ? "true" : "false");
    main.classList.toggle("is-paused", !!(recording && paused));
    main.title = recording
      ? (paused ? "Resume recording" : "Stop recording")
      : downloading
        ? "Downloading video…"
        : `Record ${targetLabel(prefs.target).toLowerCase()} video (${qualityLabel(prefs.quality)}, ${prefs.fps} fps). Use ▾ for settings.`;
    const icon = main.querySelector("[data-video-icon]");
    if (icon) {
      icon.innerHTML = recording
        ? (paused
          ? `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M7 5l9 5-9 5V5z" fill="currentColor"/></svg>`
          : `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor"/></svg>`)
        : downloading
          ? VIDEO_DOWNLOAD_ICON
          : VIDEO_RECORD_ICON;
    }
    if (timer) {
      timer.classList.toggle("hidden", !recording);
      if (recording) {
        const label = formatElapsed(recordingElapsedMs());
        timer.textContent = paused ? `❚❚ ${label}` : label;
      }
    }
    syncOverlayUi();
  }

  function syncMenuUi() {
    prefs = readPrefs();
    const { menu } = els();
    if (!menu) return;
    menu.querySelectorAll("[data-video-quality]").forEach((btn) => {
      const active = btn.dataset.videoQuality === prefs.quality;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-checked", active ? "true" : "false");
    });
    menu.querySelectorAll("[data-video-fps]").forEach((btn) => {
      const active = Number(btn.dataset.videoFps) === prefs.fps;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-checked", active ? "true" : "false");
    });
    menu.querySelectorAll("[data-video-target]").forEach((btn) => {
      const active = (btn.dataset.videoTarget || "viewport") === prefs.target;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-checked", active ? "true" : "false");
    });
    const mic = menu.querySelector("[data-video-mic]");
    if (mic instanceof HTMLInputElement) mic.checked = !!prefs.mic;
    const summary = menu.querySelector("[data-video-summary]");
    if (summary) {
      summary.textContent = `${targetLabel(prefs.target)} · ${qualityLabel(prefs.quality)} · ${prefs.fps} fps${prefs.mic ? " · mic" : ""}`;
    }
    const startHint = menu.querySelector("[data-video-start] span");
    if (startHint) {
      startHint.textContent = prefs.target === "fullscreen"
        ? "Records a whole display. Use the side controls to pause/stop while you browse Docs."
        : prefs.target === "page"
          ? "Records the whole tab — keep recording while you open Docs and other site pages."
          : "Records the 3D canvas. Open Docs anytime — use the side bar to pause or stop. Full page / Fullscreen include the rest of the UI.";
    }
  }

  function triggerLocalDownload(blob, filename) {
    return triggerTrackedBlobDownload(blob, filename, downloadCreated);
  }

  function downloadExtForBlob(blob, fallback = "webm") {
    const type = String(blob?.type || "").toLowerCase();
    if (type.includes("mp4") || type.includes("m4v")) return "mp4";
    if (type.includes("quicktime") || type.endsWith("/mov")) return "mov";
    if (type.includes("webm")) return "webm";
    if (type.includes("gif")) return "gif";
    if (type.includes("png")) return "png";
    if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
    return String(fallback || "webm").replace(/^\./, "").toLowerCase() || "webm";
  }

  function downloadBlob(blob, ext = "webm") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeExt = downloadExtForBlob(blob, ext);
    triggerLocalDownload(blob, `render3d-video-${stamp}.${safeExt}`);
  }

  function isShareBlob(value) {
    return typeof Blob !== "undefined" && value instanceof Blob && Number(value.size) > 0;
  }

  function selectedDownloadFormat() {
    const wrap = shareModalEl?.querySelector("[data-video-download-wrap]");
    const picked = String(wrap?.dataset?.videoDownloadFormat || shareModalEl?.querySelector("[data-video-download-format].is-active")?.dataset?.videoDownloadFormat || "mp4").toLowerCase();
    if (picked === "mp4" || picked === "gif" || picked === "webm" || picked === "mov") return picked === "mov" ? "mp4" : picked;
    return "mp4";
  }

  function selectedDownloadAudio() {
    const wrap = shareModalEl?.querySelector("[data-video-download-wrap]");
    return String(wrap?.dataset?.videoDownloadAudio || "1") !== "0";
  }

  function selectedDownloadQuality() {
    const wrap = shareModalEl?.querySelector("[data-video-download-wrap]");
    const picked = String(wrap?.dataset?.videoDownloadQuality || readPrefs().quality || "ultra").toLowerCase();
    return BITRATES[picked] ? picked : "ultra";
  }

  function syncDownloadMenuState() {
    const wrap = shareModalEl?.querySelector("[data-video-download-wrap]");
    if (!wrap) return;
    if (!wrap.dataset.videoDownloadFormat) wrap.dataset.videoDownloadFormat = "mp4";
    if (wrap.dataset.videoDownloadAudio == null) wrap.dataset.videoDownloadAudio = "1";
    if (!wrap.dataset.videoDownloadQuality) wrap.dataset.videoDownloadQuality = readPrefs().quality || "ultra";
    const fmt = selectedDownloadFormat();
    const audio = selectedDownloadAudio();
    const quality = selectedDownloadQuality();
    wrap.dataset.videoDownloadFormat = fmt;
    wrap.dataset.videoDownloadAudio = audio ? "1" : "0";
    wrap.dataset.videoDownloadQuality = quality;
    const menu = shareModalEl?.querySelector("[data-video-download-menu]")
      || document.querySelector(".viewport-video-download-menu.is-floating");
    menu?.querySelectorAll("[data-video-download-format]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.videoDownloadFormat === fmt);
      el.setAttribute("aria-checked", el.dataset.videoDownloadFormat === fmt ? "true" : "false");
    });
    const gif = fmt === "gif";
    menu?.querySelectorAll("[data-video-download-audio]").forEach((el) => {
      const keep = el.dataset.videoDownloadAudio !== "0";
      el.disabled = gif;
      el.classList.toggle("is-disabled", gif);
      el.classList.toggle("is-active", gif ? !keep : keep === audio);
      el.setAttribute("aria-checked", String(gif ? !keep : keep === audio));
    });
    menu?.querySelectorAll("[data-video-download-quality]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.videoDownloadQuality === quality);
      el.setAttribute("aria-checked", el.dataset.videoDownloadQuality === quality ? "true" : "false");
    });
    const go = menu?.querySelector("[data-video-download-go]");
    if (go) go.textContent = `Download ${fmt.toUpperCase()}`;
    const label = shareModalEl?.querySelector("[data-video-download-label]");
    if (label) label.textContent = `Export ${fmt.toUpperCase()}`;
  }

  let clipDownloadMenuHome = null;

  function placeClipDownloadMenu() {
    const wrap = shareModalEl?.querySelector("[data-video-download-wrap]");
    const menu = shareModalEl?.querySelector("[data-video-download-menu]")
      || document.querySelector(".viewport-video-download-menu.is-floating");
    const btn = shareModalEl?.querySelector("[data-video-share-download]");
    if (!menu || !btn || menu.classList.contains("hidden")) return;
    if (!clipDownloadMenuHome) clipDownloadMenuHome = wrap;
    if (menu.parentElement !== document.body) {
      document.body.appendChild(menu);
      menu.classList.add("is-floating");
    }
    const pad = 8;
    const gap = 6;
    const btnRect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(260, Math.max(176, btnRect.width + 48));
    menu.style.position = "fixed";
    menu.style.width = `${width}px`;
    menu.style.right = "auto";
    menu.style.maxHeight = "none";
    menu.style.visibility = "hidden";
    menu.hidden = false;
    menu.classList.remove("hidden");
    const natural = Math.max(menu.scrollHeight, menu.offsetHeight);
    const spaceAbove = btnRect.top - pad;
    const spaceBelow = vh - btnRect.bottom - pad;
    // Prefer opening upward into the editor so MP4/WebM/GIF stay on screen.
    const openBelow = spaceAbove < Math.min(natural, 280) + gap && spaceBelow > spaceAbove + 24;
    const avail = Math.max(120, (openBelow ? spaceBelow : spaceAbove) - gap);
    const height = Math.min(natural, avail);
    menu.style.maxHeight = `${height}px`;
    menu.style.overflowY = natural > height + 1 ? "auto" : "hidden";
    menu.style.overflowX = "hidden";
    let left = btnRect.left;
    left = Math.min(Math.max(pad, left), vw - width - pad);
    menu.style.left = `${Math.round(left)}px`;
    if (openBelow) {
      menu.classList.add("is-below");
      menu.style.top = `${Math.round(btnRect.bottom + gap)}px`;
      menu.style.bottom = "auto";
    } else {
      menu.classList.remove("is-below");
      menu.style.bottom = `${Math.round(vh - btnRect.top + gap)}px`;
      menu.style.top = "auto";
    }
    menu.style.visibility = "";
    menu.style.zIndex = "40000";
  }

  function setDownloadMenuOpen(open) {
    const wrap = shareModalEl?.querySelector("[data-video-download-wrap]");
    const menu = shareModalEl?.querySelector("[data-video-download-menu]")
      || document.querySelector(".viewport-video-download-menu.is-floating");
    const btn = shareModalEl?.querySelector("[data-video-share-download]");
    if (menu) {
      menu.classList.toggle("hidden", !open);
      menu.hidden = !open;
    }
    wrap?.classList.toggle("is-open", !!open);
    btn?.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      syncDownloadMenuState();
      requestAnimationFrame(() => {
        placeClipDownloadMenu();
        requestAnimationFrame(placeClipDownloadMenu);
      });
    } else if (menu) {
      menu.classList.remove("is-below");
      menu.style.position = "";
      menu.style.top = "";
      menu.style.bottom = "";
      menu.style.left = "";
      menu.style.right = "";
      menu.style.width = "";
      menu.style.maxHeight = "";
      menu.style.overflowY = "";
      menu.style.visibility = "";
      menu.style.zIndex = "";
      if (clipDownloadMenuHome && menu.parentElement !== clipDownloadMenuHome) {
        clipDownloadMenuHome.appendChild(menu);
        menu.classList.remove("is-floating");
      }
    }
  }

  function blobLooksLike(blob, format) {
    const type = String(blob?.type || "").toLowerCase();
    if (format === "mp4") return type.includes("mp4") || type.includes("m4v");
    if (format === "gif") return type.includes("gif");
    if (format === "webm") return type.includes("webm");
    return false;
  }

  async function remuxViaCanvas(blob, mimeType) {
    if (!blob || !window.MediaRecorder) return null;
    if (mimeType && !MediaRecorder.isTypeSupported?.(mimeType)) return null;
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.src = url;
    video.playsInline = true;
    video.muted = true;
    video.preload = "auto";
    try {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Could not load clip for conversion."));
      });
      const w = Math.max(2, video.videoWidth || 1280);
      const h = Math.max(2, video.videoHeight || 720);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return null;
      const outStream = canvas.captureStream(60);
      const tracks = [...outStream.getVideoTracks()];
      try {
        const captured = typeof video.captureStream === "function"
          ? video.captureStream()
          : (typeof video.mozCaptureStream === "function" ? video.mozCaptureStream() : null);
        for (const t of captured?.getAudioTracks?.() || []) tracks.push(t);
      } catch (_) {}
      const mixed = new MediaStream(tracks);
      const recorder = mimeType
        ? new MediaRecorder(mixed, { mimeType, videoBitsPerSecond: BITRATES.ultra })
        : new MediaRecorder(mixed, { videoBitsPerSecond: BITRATES.ultra });
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunks.push(e.data);
      };
      const done = new Promise((resolve, reject) => {
        recorder.onerror = () => reject(new Error("Could not encode download."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" }));
      });
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      recorder.start(200);
      video.currentTime = 0;
      await video.play().catch(() => {});
      await new Promise((resolve) => {
        video.onended = () => resolve();
        const tick = () => {
          if (video.ended || video.paused) {
            ctx.drawImage(video, 0, 0, w, h);
            resolve();
            return;
          }
          ctx.drawImage(video, 0, 0, w, h);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(resolve, (duration || 30) * 1000 + 4000);
      });
      try { video.pause(); } catch (_) {}
      if (recorder.state !== "inactive") recorder.stop();
      const out = await done;
      outStream.getTracks().forEach((t) => t.stop());
      return out?.size ? out : null;
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function convertViaApi(blob, format, extras = {}) {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) throw new Error("Sign in to convert this clip to " + format.toUpperCase() + ".");
    const form = new FormData();
    const srcName = blobLooksLike(blob, "mp4") ? "clip.mp4" : "clip.webm";
    if (!(blob instanceof Blob) || !(blob.size > 0)) {
      throw new Error("Clip is not a file yet. Generate the timeline edit first.");
    }
    form.append("video", blob, srcName);
    form.append("format", format);
    if (extras.intent) form.append("intent", extras.intent);
    const quality = String(extras.quality || "").toLowerCase();
    if (quality === "standard" || quality === "high" || quality === "ultra") {
      form.append("quality", quality);
    }
    if (extras.audio === false) form.append("audio", "0");
    if (extras.overlayAudio instanceof Blob && extras.overlayAudio.size > 0) {
      const name = extras.overlayName || extras.overlayAudio.name || "song.wav";
      form.append("overlay_audio", extras.overlayAudio, name);
      form.append("audio_start", String(Number(extras.audioStart) || 0));
      const duration = Number(extras.videoDuration);
      if (Number.isFinite(duration) && duration > 0) {
        form.append("video_duration", String(duration));
      }
    }
    const trimIn = Number(extras.trimIn);
    const trimOut = Number(extras.trimOut);
    if (Number.isFinite(trimIn) && trimIn > 0) form.append("trim_in", String(trimIn));
    if (Number.isFinite(trimOut) && trimOut > 0) form.append("trim_out", String(trimOut));
    const pid = extras.projectId || (typeof getProjectId === "function" ? getProjectId() : "") || "";
    if (pid) form.append("project_id", pid);
    const onProgress = typeof extras.onProgress === "function" ? extras.onProgress : null;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/video/convert");
      xhr.responseType = "arraybuffer";
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        onProgress?.({
          stage: "upload",
          loaded: e.loaded,
          total: e.total,
          percent: convertProgressPercent({ stage: "upload", loaded: e.loaded, total: e.total }),
        });
      };
      xhr.upload.onload = () => {
        onProgress?.({ stage: "encode", percent: 42 });
      };
      xhr.onprogress = (e) => {
        if (!e.lengthComputable) return;
        onProgress?.({
          stage: "download",
          loaded: e.loaded,
          total: e.total,
          percent: convertProgressPercent({ stage: "download", loaded: e.loaded, total: e.total }),
        });
      };
      xhr.onload = () => {
        const typeHeader = xhr.getResponseHeader("content-type") || "";
        if (xhr.status < 200 || xhr.status >= 300) {
          let detail = xhr.statusText || "Conversion failed.";
          try {
            const text = new TextDecoder().decode(xhr.response || new ArrayBuffer(0));
            const data = JSON.parse(text);
            detail = data?.detail || data?.message || detail;
          } catch (_) { /* keep status text */ }
          reject(new Error(typeof detail === "string" ? detail : JSON.stringify(detail)));
          return;
        }
        onProgress?.({ stage: "done", percent: 100 });
        const type = typeHeader || (
          format === "gif" ? "image/gif" : format === "mp4" ? "video/mp4" : "video/webm"
        );
        resolve(new Blob([xhr.response], { type }));
      };
      xhr.onerror = () => reject(new Error("Conversion failed."));
      xhr.send(form);
    });
  }

  async function blobForDownloadFormat(blob, format, extras = {}) {
    if (!isShareBlob(blob)) return null;
    const quality = BITRATES[extras.quality] ? extras.quality : readPrefs().quality;
    const audio = extras.audio !== false;
    const type = String(blob.type || "").toLowerCase();
    if (format === "mp4" && (blobLooksLike(blob, "mp4") || type.includes("quicktime") || type.endsWith("/mov")) && audio) {
      return blob;
    }
    if (blobLooksLike(blob, format) && audio) return blob;
    const onProgress = typeof extras.onProgress === "function" ? extras.onProgress : null;
    try {
      if (format === "mp4") {
        return await convertViaApi(blob, "mp4", { intent: "share", quality, audio, onProgress });
      }
      if (format === "webm") {
        if (blobLooksLike(blob, "webm") && !audio) {
          return await convertViaApi(blob, "webm", { quality, audio: false, onProgress });
        }
        const local = audio
          ? (await remuxViaCanvas(blob, "video/webm;codecs=vp9") || await remuxViaCanvas(blob, "video/webm"))
          : null;
        if (local) {
          onProgress?.({ stage: "encode", percent: 70 });
          onProgress?.({ stage: "done", percent: 100 });
          return local;
        }
        return await convertViaApi(blob, "webm", { quality, audio, onProgress });
      }
      if (format === "gif") {
        return await convertViaApi(blob, "gif", { quality, audio: false, onProgress });
      }
    } catch (err) {
      console.warn("[viewport-video] download conversion failed", err);
      throw err;
    }
    return blob;
  }

  function upsertClipEditorTab(label = "Editor") {
    try {
      docTabs?.upsert?.({
        id: CLIP_EDITOR_TAB_ID,
        label: label || "Editor",
        kind: "clip",
      });
      docTabs?.setActive?.(CLIP_EDITOR_TAB_ID, { notify: false });
    } catch (_) {}
  }

  function syncEditorTitle(name) {
    editorProjectName = defaultVideoEditorProjectName({ label: name }) || "Video Editor";
    const btn = shareModalEl?.querySelector("[data-video-project-name]");
    if (btn && btn.tagName === "BUTTON") btn.textContent = editorProjectName;
    videoEditor?.setProjectName?.(editorProjectName, { persist: false });
    upsertClipEditorTab(editorProjectName);
  }

  function editorAuthHeaders() {
    const token = typeof getToken === "function" ? getToken() : null;
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async function persistVideoEditorProject(name, { unique = false, timeline = null, sources = null, refresh = false } = {}) {
    const pid = getProjectId?.();
    if (!pid || !name) return null;
    const draft = timeline || editorTimelineDraft || videoEditor?.getTimelineDraft?.() || null;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/video-editor`, {
        method: "POST",
        headers: editorAuthHeaders(),
        body: JSON.stringify({
          name,
          unique,
          caption: String(shareModalEl?.querySelector("[data-video-share-text]")?.value || "").trim(),
          editor: clipAuthorFromUser(getCurrentUser?.()),
          timeline: draft,
          sources,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      if (refresh) {
        try { onRefreshFiles?.(); } catch (_) {}
      }
      return data;
    } catch {
      return null;
    }
  }

  async function persistVideoEditorSourceRefs(name, { sources = [], refresh = false, timeline = null } = {}) {
    return persistVideoEditorProject(name, { unique: false, sources, refresh, timeline });
  }

  function scheduleEditorAutosave() {
    if (editorAutosaveTimer) window.clearTimeout(editorAutosaveTimer);
    editorAutosaveTimer = window.setTimeout(() => {
      editorAutosaveTimer = 0;
      const name = videoEditor?.getProjectName?.() || editorProjectName;
      void persistVideoEditorProject(name, { unique: false });
    }, 280);
  }

  let videoEditorListAbort = null; // leakfix94
  let videoEditorListInflight = null;
  function beginVideoEditorListFetch() {
    if (videoEditorListAbort) {
      try { videoEditorListAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    videoEditorListAbort = ctl;
    return ctl;
  }

  async function fetchVideoEditorProjects() {
    const pid = getProjectId?.();
    if (!pid) return [];
    if (videoEditorListInflight) return videoEditorListInflight;
    const ctl = beginVideoEditorListFetch();
    const run = (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/video-editor`, {
          headers: editorAuthHeaders(),
          signal: ctl.signal,
        });
        if (ctl.signal.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        const data = await res.json().catch(() => ({}));
        return Array.isArray(data.projects) ? data.projects : [];
      } catch (err) {
        if (ctl.signal.aborted || err?.name === "AbortError") throw err;
        return [];
      } finally {
        if (videoEditorListInflight === run) videoEditorListInflight = null;
      }
    })();
    videoEditorListInflight = run;
    return run;
  }

  async function deleteVideoEditorProject(name) {
    const pid = getProjectId?.();
    if (!pid || !name) return false;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/video-editor?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: editorAuthHeaders(),
      });
      if (res.ok) {
        try { onRefreshFiles?.(); } catch (_) {}
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  async function persistEditorFolderRename(oldName, newName) {
    const pid = getProjectId?.();
    if (!pid || !newName || oldName === newName) return;
    try {
      await fetch(`/api/projects/${encodeURIComponent(pid)}/video-editor/rename`, {
        method: "POST",
        headers: editorAuthHeaders(),
        body: JSON.stringify({ old_name: oldName, new_name: newName }),
      });
      try { onRefreshFiles?.(); } catch (_) {}
    } catch (_) {}
  }

  function beginModalTitleEdit() {
    const btn = shareModalEl?.querySelector("[data-video-project-name]");
    if (!btn || btn.tagName !== "BUTTON") return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "app-dialog-title vtl-project-name vtl-project-name-input";
    input.value = editorProjectName;
    input.maxLength = 80;
    input.setAttribute("aria-label", "Timeline name");
    btn.replaceWith(input);
    input.focus();
    input.select();
    const finish = (commit) => {
      const next = commit
        ? defaultVideoEditorProjectName({ label: input.value }) || editorProjectName
        : editorProjectName;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "app-dialog-title vtl-project-name";
      button.dataset.videoProjectName = "";
      button.title = "Click to rename";
      button.textContent = next;
      input.replaceWith(button);
      button.addEventListener("click", beginModalTitleEdit);
      if (commit && next !== editorProjectName) {
        const prev = editorProjectName;
        syncEditorTitle(next);
        void persistEditorFolderRename(prev, next);
      }
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

  function parkClipEditor() {
    finishXPinPrompt(false);
    hideXPrepPopup();
    hideXCaptionPopup();
    revokeXShareSheetUrls(); // leakfix25
    if (editorAutosaveTimer) {
      window.clearTimeout(editorAutosaveTimer);
      editorAutosaveTimer = 0;
    }
    try { videoEditor?.park?.(); } catch (_) { /* ignore */ }
    pauseAndDetachMedia(shareModalEl?.querySelector(".viewport-video-share-preview"));
    shareModalEl?.classList.add("hidden");
    try { docTabs?.deactivate?.({ notify: true }); } catch (_) {}
  }

  function closeClipEditorTab() {
    try {
      if (docTabs?.has?.(CLIP_EDITOR_TAB_ID)) docTabs.remove?.(CLIP_EDITOR_TAB_ID);
    } catch (_) {}
  }

  function bindEditorCardDrag(card) {
    const grip = card?.querySelector(".video-editor-grip");
    if (!card || !grip || grip.dataset.bound === "1") return;
    grip.dataset.bound = "1";
    let drag = null;
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = card.getBoundingClientRect();
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, left: rect.left, top: rect.top };
      card.classList.add("floating-panel--dragging");
      card.style.position = "fixed";
      card.style.margin = "0";
      card.style.left = `${rect.left}px`;
      card.style.top = `${rect.top}px`;
      card.style.right = "auto";
      card.style.transform = "none";
      grip.setPointerCapture?.(e.pointerId);
    });
    grip.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      const x = Math.max(8, Math.min(window.innerWidth - 80, drag.left + (e.clientX - drag.sx)));
      const y = Math.max(8, Math.min(window.innerHeight - 80, drag.top + (e.clientY - drag.sy)));
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      card.classList.remove("floating-panel--dragging");
    };
    grip.addEventListener("pointerup", endDrag);
    grip.addEventListener("pointercancel", endDrag);
  }

  async function applyAiPrompt() {
    const input = shareModalEl?.querySelector("[data-vtl-prompt]")
      || shareModalEl?.querySelector("[data-video-ai-prompt]");
    const prompt = String(input?.value || "").trim();
    if (!prompt) {
      setShareStatus("Write an edit prompt first.", true);
      return;
    }
    try {
      await videoEditor?.applyEditCommand?.(prompt, { assembleIfAsked: true });
    } catch (err) {
      const plan = parseFilmEditPrompt(prompt);
      videoEditor?.applyPlan?.(plan);
      setShareStatus(err?.message || "Could not apply that prompt.", true);
    }
  }

  function ensureShareModal() {
    if (shareModalEl) return shareModalEl;
    shareModalEl = document.createElement("div");
    shareModalEl.id = "viewport-video-share-modal";
    shareModalEl.className = "clip-editor-workspace viewport-video-share-modal video-editor-window hidden";
    shareModalEl.setAttribute("role", "region");
    shareModalEl.setAttribute("aria-label", "Timeline editor");
    shareModalEl.innerHTML = `
      <div class="clip-editor-panel video-editor-card" data-video-editor-card data-no-feedback-drop="1">
        <section class="clip-editor-home" data-clip-home>
          <p class="viewport-video-share-eyebrow screenshot-markup-eyebrow">Video Editor</p>
          <h2 class="app-dialog-title">Projects</h2>
          <p class="muted small screenshot-markup-hint">Create a project, then drop clips onto the timeline. Space plays and pauses.</p>
          <button type="button" class="btn accent clip-editor-create" data-video-new>Create project</button>
          <div class="clip-editor-grid" data-video-library-rail role="list"></div>
          <p class="muted small clip-editor-library-empty" data-video-library-empty hidden>No clips in Video Editor yet.</p>
        </section>
        <section class="clip-editor-studio hidden" data-clip-studio>
        <div class="clip-editor-studio-head">
          <button type="button" class="btn secondary small clip-editor-back" data-video-back title="Back to Projects">← Back</button>
          <button type="button" class="app-dialog-title vtl-project-name" data-video-project-name title="Click to rename">Video Editor</button>
          <div class="clip-editor-history" data-clip-history>
            <label class="clip-editor-history-toggle" title="User comments"><input type="checkbox" data-hist-toggle="comments" checked /> Comments</label>
            <label class="clip-editor-history-toggle" title="Prompts"><input type="checkbox" data-hist-toggle="prompts" checked /> Prompts</label>
            <span class="clip-editor-history-download" data-hist-download hidden>
              <button type="button" class="btn secondary btn-compact" data-video-share-download-hist>Download</button>
            </span>
          </div>
          <div class="clip-editor-share-wrap" data-video-project-share-wrap>
            <button type="button" class="btn secondary btn-compact" data-video-share-link aria-haspopup="menu">
              <span data-video-share-link-label>Share link</span>
              <span class="clip-editor-share-copied" data-video-share-copied hidden aria-hidden="true">✓</span>
              <span aria-hidden="true">▾</span>
            </button>
            <div class="clip-editor-share-menu hidden" data-video-share-menu hidden>
              <button type="button" data-share-mode="view">View only</button>
              <button type="button" data-share-mode="remix">Remix only</button>
              <button type="button" data-share-mode="edit">Remix and edit</button>
            </div>
          </div>
        </div>
        <div class="clip-editor-history-list muted small hidden" data-clip-history-list></div>
        <div class="clip-editor-stage" data-clip-stage>
          <div class="video-editor-preview-wrap" data-video-preview-wrap>
            <div class="clip-editor-preview-sizer" aria-hidden="true"></div>
            <video class="viewport-video-share-preview" controls playsinline></video>
            <div class="vtl-preview-loading hidden" data-video-film-spin hidden>
              <span class="vtl-spin" aria-hidden="true"></span>
              <span data-vtl-preview-loading-msg>Generating film edit…</span>
              <span class="vtl-gen-model" data-vtl-gen-model hidden></span>
            </div>
            <div class="video-editor-still-layer" data-video-stills></div>
            <div class="video-editor-preview-chrome" data-video-preview-chrome>
              <button type="button" class="video-editor-chrome-circle is-on" data-video-motion title="Motion" aria-label="Motion" aria-pressed="true"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8 2.4a5.6 5.6 0 1 1-5 2.6l1.15.7A4.25 4.25 0 1 0 8 3.75V5.6L11.2 3 8 .4Z"/></svg></button>
              <button type="button" class="video-editor-chrome-circle" data-video-restart-loop title="Restart loop" aria-label="To start"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M2.6 2.4h1.5v11.2H2.6Zm2.9 5.6 8 4.7V3.3Z"/></svg></button>
            </div>
          </div>
          <div class="clip-editor-overlays" data-clip-overlays>
            <p class="viewport-video-share-x-status muted small" data-video-share-x-status></p>
            <p class="viewport-video-share-status muted small" data-video-share-status role="status"></p>
            <div class="viewport-x-pin-panel hidden" data-video-x-pin-panel>
              <p class="viewport-x-pin-title">Enter the PIN from X</p>
              <p class="muted small">Authorize Render Studio in the X window, then type the PIN shown there.</p>
              <div class="viewport-x-pin-row">
                <input type="text" inputmode="numeric" autocomplete="one-time-code" data-video-x-pin-input placeholder="PIN code" maxlength="12" />
                <button type="button" class="btn accent" data-video-x-pin-submit>Connect</button>
                <button type="button" class="btn secondary" data-video-x-pin-cancel>Cancel</button>
              </div>
            </div>
            <div class="viewport-video-discord-picker hidden" data-video-discord-picker hidden role="dialog" aria-label="Share to Discord">
              <p class="muted small">Search a channel or user, then send. We open the Discord app and post this clip with the Render Studio bot.</p>
              <label class="viewport-video-discord-search-label">
                <span class="visually-hidden">Search channels and users</span>
                <input type="search" class="viewport-video-discord-search" data-video-discord-search placeholder="Search channels and users" autocomplete="off" />
              </label>
              <div class="viewport-video-discord-channels" data-video-discord-channels></div>
              <div class="viewport-video-discord-actions">
                <button type="button" class="btn secondary btn-compact" data-video-discord-cancel>Cancel</button>
                <button type="button" class="btn accent btn-compact" data-video-discord-send>Send</button>
              </div>
            </div>
          </div>
        </div>
        <div data-video-editor-host></div>
        <div class="clip-editor-export-dock">
            <div class="viewport-video-share-actions screenshot-markup-actions">
              <div class="viewport-video-download-wrap" data-video-download-wrap>
                <button type="button" class="btn secondary btn-compact viewport-video-download-btn" data-video-share-download aria-haspopup="menu" aria-expanded="false" aria-busy="false">
                  <span class="viewport-video-download-spinner" hidden aria-hidden="true"></span>
                  <span class="viewport-video-download-pct" data-video-download-pct hidden>0%</span>
                  <span data-video-download-label>Export MP4</span>
                  <span class="viewport-video-download-caret" aria-hidden="true">▾</span>
                </button>
                <div class="viewport-video-download-menu hidden" data-video-download-menu hidden role="menu">
                  <div class="viewport-video-download-group" role="group" aria-label="Format">
                    <button type="button" role="menuitemradio" data-video-download-format="mp4">MP4</button>
                    <button type="button" role="menuitemradio" data-video-download-format="webm">WebM</button>
                    <button type="button" role="menuitemradio" data-video-download-format="gif">GIF</button>
                  </div>
                  <div class="viewport-video-download-sep" role="separator"></div>
                  <div class="viewport-video-download-group" role="group" aria-label="Audio">
                    <button type="button" role="menuitemradio" data-video-download-audio="1">With audio</button>
                    <button type="button" role="menuitemradio" data-video-download-audio="0">Without audio</button>
                  </div>
                  <div class="viewport-video-download-sep" role="separator"></div>
                  <div class="viewport-video-download-group" role="group" aria-label="Quality">
                    <button type="button" role="menuitemradio" data-video-download-quality="standard">Standard</button>
                    <button type="button" role="menuitemradio" data-video-download-quality="high">High</button>
                    <button type="button" role="menuitemradio" data-video-download-quality="ultra">Ultra</button>
                  </div>
                  <div class="viewport-video-download-sep" role="separator"></div>
                  <button type="button" class="viewport-video-download-go" data-video-download-go>Download timeline</button>
                </div>
              </div>
              <button type="button" class="btn secondary btn-compact viewport-video-share-xbtn" data-video-share-connect-x data-x-connected="0" title="Connect X" aria-label="Connect X">${X_LOGO_SVG}<span>Connect X</span></button>
              <button type="button" class="btn accent btn-compact viewport-video-share-xbtn" data-video-share-post-x title="Upload to X" aria-label="Upload to X" aria-busy="false">${X_LOGO_SVG}<span class="viewport-video-share-x-spinner" hidden aria-hidden="true"></span><span class="viewport-video-x-prep-pct" data-video-x-prep-pct hidden>0%</span><span data-video-share-post-x-label>Upload to X</span></button>
            </div>
            <div class="app-dialog-actions">
              <button type="button" class="btn secondary" data-video-share-close>Done</button>
            </div>
        </div>
        </section>
      </div>
      <div class="viewport-video-x-caption hidden" data-video-x-caption data-video-share-sheet role="dialog" aria-labelledby="video-share-caption-title" aria-modal="true">
        <div class="viewport-video-x-caption-card">
          <div class="viewport-video-x-profile" data-video-x-profile>
            <div class="viewport-video-x-profile-id">
              <img class="viewport-video-x-avatar" data-video-x-avatar hidden alt="" />
              <span class="viewport-video-x-avatar-fallback" data-video-x-avatar-fallback aria-hidden="true">${X_LOGO_SVG}</span>
              <div class="viewport-video-x-profile-copy">
                <span class="viewport-video-x-profile-title" id="video-share-caption-title">Share to ${X_LOGO_TITLE_SVG}</span>
                <span class="muted small" data-video-x-profile-handle>Compose a post, then attach the clip</span>
              </div>
            </div>
            <button type="button" class="btn secondary btn-compact viewport-video-share-xbtn" data-video-x-caption-connect data-x-connected="0" title="Connect X" aria-label="Connect X">${X_LOGO_SVG}<span>Connect X</span></button>
          </div>
          <div class="viewport-video-x-full" data-video-x-full hidden>
            <div class="viewport-video-x-preview-wrap">
              <video class="viewport-video-x-preview" data-video-x-preview playsinline></video>
              <button type="button" class="btn secondary btn-compact" data-video-x-play>Play</button>
            </div>
            <div class="viewport-video-x-mini-tl" data-video-x-mini-tl>
              <div class="viewport-video-x-mini-track" data-video-x-mini-track>
                <span class="viewport-video-x-mini-shade viewport-video-x-mini-shade--in" data-video-x-trim-shade-in></span>
                <span class="viewport-video-x-mini-shade viewport-video-x-mini-shade--out" data-video-x-trim-shade-out></span>
                <span class="viewport-video-x-mini-window" data-video-x-trim-window></span>
                <button type="button" class="viewport-video-x-mini-handle" data-video-x-trim="in" aria-label="Trim start"></button>
                <button type="button" class="viewport-video-x-mini-handle" data-video-x-trim="out" aria-label="Trim end"></button>
                <span class="viewport-video-x-mini-playhead" data-video-x-mini-playhead></span>
              </div>
              <span class="muted small" data-video-x-mini-clock>0.0s</span>
            </div>
            <audio class="hidden" data-video-x-song-el preload="auto"></audio>
            <div class="viewport-video-x-song viewport-video-x-song-drop" data-video-x-song-drop>
              <button type="button" class="btn secondary btn-compact" data-video-x-add-song>Drop audio here</button>
              <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" hidden data-video-x-song-file />
              <div class="share-waveform viewport-video-x-song-wave hidden" data-video-x-song-wave hidden>
                <div class="share-waveform-track" data-video-x-song-track role="slider" aria-label="Song start" aria-valuemin="0" aria-valuenow="0" aria-valuemax="0" tabindex="0">
                  <div class="share-waveform-layers" aria-hidden="true">
                    <div class="share-waveform-bars" data-video-x-song-bars></div>
                    <div class="share-waveform-bars share-waveform-bars--played" data-video-x-song-played></div>
                    <span class="viewport-video-x-song-span" data-video-x-song-span></span>
                    <div class="share-waveform-playhead" data-video-x-song-head></div>
                  </div>
                </div>
              </div>
              <label class="viewport-video-x-song-start">Song start
                <input type="range" min="0" max="0" step="0.05" value="0" data-video-x-song-start disabled />
                <input type="number" min="0" step="0.05" value="0" data-video-x-song-start-num />
              </label>
              <p class="muted small">Drop an audio clip. Click the ridges to set song start. Space listens, looped. Overlay fills the trimmed video length.</p>
              <span class="muted small" data-video-x-song-name></span>
            </div>
            <div class="viewport-video-x-filters">
              <span class="vve-label">Filter</span>
              <div class="vve-chips">
                ${Object.entries(VIDEO_LOOK_GRADES).map(([id, meta]) => (
                  `<button type="button" class="vve-chip${id === "none" ? " is-active" : ""}" data-video-x-grade="${id}">${meta.label}</button>`
                )).join("")}
              </div>
              <button type="button" class="btn secondary btn-compact" data-video-x-apply-filter>Apply filter</button>
            </div>
            <div class="viewport-video-x-audio-row">
              <div class="viewport-video-x-audio-group" role="group" aria-label="Audio">
                <button type="button" class="vve-chip is-active" data-video-x-audio="1">With audio</button>
                <button type="button" class="vve-chip" data-video-x-audio="0">Without audio</button>
                <button type="button" class="btn secondary btn-compact hidden" data-video-x-overlay aria-pressed="false">Overlay this song</button>
              </div>
            </div>
          </div>
          <label class="viewport-video-share-caption viewport-video-share-caption--short">
            <span class="viewport-video-share-caption-head">
              <span>Caption</span>
              <button type="button" class="prompt-mic-btn" data-mic-target="video-share-caption" title="Talk to write your X post" aria-label="Dictate caption">
                <span class="prompt-mic-icon" aria-hidden="true">🎙</span>
              </button>
            </span>
            <textarea id="video-share-caption" data-video-share-text maxlength="280" rows="3" placeholder="Talk or type your X post…"></textarea>
          </label>
          <div class="viewport-video-x-caption-opts">
            <label class="viewport-video-x-opt">
              <span>Type</span>
              <select data-video-x-format aria-label="Video type">
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
                <option value="gif">GIF</option>
              </select>
            </label>
            <label class="viewport-video-x-opt">
              <span>Quality</span>
              <select data-video-x-quality aria-label="Video quality">
                <option value="standard">Standard</option>
                <option value="high">High</option>
                <option value="ultra">Ultra</option>
              </select>
            </label>
          </div>
          <p class="viewport-video-share-status muted small" data-video-x-caption-status role="status"></p>
          <div class="viewport-video-x-caption-actions">
            <button type="button" class="btn secondary" data-video-x-caption-cancel>Cancel</button>
            <button type="button" class="btn secondary" data-video-x-caption-editor>Open in editor</button>
            <button type="button" class="btn secondary" data-video-x-download>Download</button>
            <button type="button" class="btn accent viewport-video-share-xbtn" data-video-x-caption-post aria-busy="false"><span class="viewport-video-share-x-spinner" hidden aria-hidden="true"></span><span data-video-x-caption-post-label>Post to X</span></button>
          </div>
        </div>
      </div>
      <div class="viewport-video-x-prep hidden" data-video-x-prep role="status" aria-live="polite">
        <div class="viewport-video-x-prep-card">
          <div class="viewport-video-x-prep-meter" data-video-x-prep-meter>
            <div class="viewport-video-x-prep-spinner" aria-hidden="true"></div>
            <span class="viewport-video-x-prep-pct" data-video-x-prep-pct>0%</span>
          </div>
          <p class="viewport-video-x-prep-title" data-video-x-prep-title>Preparing MP4…</p>
          <p class="viewport-video-x-prep-body" data-video-x-prep-body>Converting your clip so X can attach it.</p>
          <button type="button" class="btn secondary viewport-video-x-prep-dismiss hidden" data-video-x-prep-dismiss>Got it</button>
        </div>
      </div>
    `;
    const dock = document.querySelector(".main-column") || document.body;
    dock.appendChild(shareModalEl);
    shareModalEl.querySelectorAll("[data-video-share-close]").forEach((el) => {
      el.addEventListener("click", () => parkClipEditor());
    });
    shareModalEl.querySelector("[data-video-new]")?.addEventListener("click", () => {
      void startNewFilm();
    });
    shareModalEl.querySelector("[data-video-back]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void showClipHome();
    });
    shareModalEl.querySelector("[data-video-share-link]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = shareModalEl.querySelector("[data-video-share-menu]");
      const open = !!menu?.classList.contains("hidden");
      menu?.classList.toggle("hidden", !open);
      menu?.toggleAttribute("hidden", !open);
    });
    shareModalEl.querySelectorAll("[data-video-share-menu] [data-share-mode]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        shareModalEl.querySelector("[data-video-share-menu]")?.classList.add("hidden");
        void shareCurrentVideoProject(btn.getAttribute("data-share-mode"));
      });
    });
    shareModalEl.querySelector("[data-video-share-download-hist]")?.addEventListener("click", () => {
      void downloadEdited();
    });
    shareModalEl.querySelectorAll("[data-hist-toggle]").forEach((input) => {
      input.addEventListener("change", () => refreshClipHistoryPanel());
    });
    shareModalEl.querySelector("[data-video-library-rail]")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-video-ctx], .clip-editor-ctx")) return;
      const del = e.target.closest("[data-video-delete]");
      if (del) {
        void confirmDeleteEditorProject(del.getAttribute("data-video-delete"));
        return;
      }
      const share = e.target.closest("[data-video-share-project]");
      if (share) {
        void shareEditorProject?.(share.getAttribute("data-video-share-project"), "view");
        return;
      }
      const settings = e.target.closest("[data-video-settings]");
      if (settings) {
        void openEditorProjectSettings(settings.getAttribute("data-video-settings"));
        return;
      }
      const proj = e.target.closest("[data-video-open-project]");
      if (proj) {
        void openEditorProject(proj.dataset.videoOpenProject);
      }
    });
    shareModalEl.querySelector("[data-video-library-rail]")?.addEventListener("contextmenu", (e) => {
      const card = e.target.closest(".clip-editor-grid-item");
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      showClipCardMenu(card, e.clientX, e.clientY);
    });
    shareModalEl.querySelector("[data-video-x-prep-dismiss]")?.addEventListener("click", () => {
      hideXPrepPopup();
    });
    shareModalEl.querySelector("[data-video-share-download]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (clipDownloadBusy) return;
      const menu = shareModalEl.querySelector("[data-video-download-menu]")
        || document.querySelector(".viewport-video-download-menu.is-floating");
      setDownloadMenuOpen(!!menu?.classList.contains("hidden"));
    });
    const onDownloadMenuClick = (e) => {
      if (e._clipDlHandled) return;
      const formatBtn = e.target.closest("[data-video-download-format]");
      const audioBtn = e.target.closest("[data-video-download-audio]");
      const qualityBtn = e.target.closest("[data-video-download-quality]");
      const goBtn = e.target.closest("[data-video-download-go]");
      if (!formatBtn && !audioBtn && !qualityBtn && !goBtn) return;
      e._clipDlHandled = true;
      e.preventDefault();
      e.stopPropagation();
      const wrap = shareModalEl.querySelector("[data-video-download-wrap]");
      if (formatBtn) wrap && (wrap.dataset.videoDownloadFormat = String(formatBtn.dataset.videoDownloadFormat || "mp4").toLowerCase());
      if (audioBtn) wrap && (wrap.dataset.videoDownloadAudio = audioBtn.dataset.videoDownloadAudio === "0" ? "0" : "1");
      if (qualityBtn) wrap && (wrap.dataset.videoDownloadQuality = String(qualityBtn.dataset.videoDownloadQuality || "ultra"));
      syncDownloadMenuState();
      placeClipDownloadMenu();
      if (goBtn) {
        setDownloadMenuOpen(false);
        void downloadEdited(selectedDownloadFormat());
      }
    };
    shareModalEl.addEventListener("click", onDownloadMenuClick);
    document.addEventListener("click", (e) => {
      const menu = document.querySelector(".viewport-video-download-menu.is-floating");
      if (menu && menu.contains(e.target)) onDownloadMenuClick(e);
    });
    shareModalEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-video-download-wrap]")) return;
      if (e.target.closest(".viewport-video-download-menu")) return;
      setDownloadMenuOpen(false);
    });
    document.addEventListener("pointerdown", (e) => {
      if (!shareModalEl || shareModalEl.classList.contains("hidden")) return;
      if (e.target.closest("[data-video-download-wrap]")) return;
      if (e.target.closest(".viewport-video-download-menu")) return;
      setDownloadMenuOpen(false);
    });
    window.addEventListener("resize", () => {
      const menu = document.querySelector(".viewport-video-download-menu.is-floating");
      if (menu && !menu.classList.contains("hidden")) placeClipDownloadMenu();
    });
    shareModalEl.querySelector("[data-video-share-connect-x]")?.addEventListener("click", () => {
      const btn = shareModalEl.querySelector("[data-video-share-connect-x]");
      if (btn?.dataset.xConnected === "1") void disconnectX();
      else void connectX();
    });
    shareModalEl.querySelector("[data-video-share-post-x]")?.addEventListener("click", () => {
      void postToX();
    });
    shareModalEl.querySelector("[data-video-x-caption-post]")?.addEventListener("click", () => {
      void confirmShareToX();
    });
    shareModalEl.querySelector("[data-video-x-caption-cancel]")?.addEventListener("click", () => {
      hideXCaptionPopup();
    });
    shareModalEl.querySelector("[data-video-x-caption-editor]")?.addEventListener("click", () => {
      openEditorFromSharePopup();
    });
    shareModalEl.querySelector("[data-video-x-caption-connect]")?.addEventListener("click", () => {
      const btn = shareModalEl.querySelector("[data-video-x-caption-connect]");
      if (btn?.dataset.xConnected === "1") void disconnectX();
      else void connectX();
    });
    const preview = shareModalEl.querySelector("[data-video-x-preview]");
    preview?.addEventListener("timeupdate", () => syncXSharePlayhead({ seekLoop: true }));
    preview?.addEventListener("ended", () => loopXSharePreview());
    preview?.addEventListener("durationchange", () => refreshXShareDuration());
    preview?.addEventListener("loadedmetadata", () => {
      refreshXShareDuration();
      startXSharePlayheadClock();
    });
    preview?.addEventListener("loadeddata", () => {
      refreshXShareDuration();
      startXSharePlayheadClock();
    });
    preview?.addEventListener("playing", () => startXSharePlayheadClock());
    preview?.addEventListener("play", () => startXSharePlayheadClock());
    shareModalEl.querySelector("[data-video-x-play]")?.addEventListener("click", () => {
      toggleXSharePreview();
    });
    shareModalEl.querySelector("[data-video-x-mini-track]")?.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest("[data-video-x-trim]");
      const track = e.currentTarget;
      const pct = xShareTrackPct(e.clientX, track.getBoundingClientRect());
      if (handle) {
        e.preventDefault();
        xTrimDrag = { edge: handle.dataset.videoXTrim === "out" ? "out" : "in", track };
        handle.setPointerCapture?.(e.pointerId);
        setXShareTrimFromPct(xTrimDrag.edge, pct);
        return;
      }
      const el = xSharePreviewEl();
      if (!el) return;
      setXShareTrimFromPct(null, pct, { seek: true });
      syncXSharePlayhead();
    });
    shareModalEl.querySelector("[data-video-x-song-track]")?.addEventListener("pointerdown", (e) => {
      if (!xShareSheet.song) return;
      e.preventDefault();
      xSongWaveDrag = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setXShareSongStartFromClientX(e.clientX);
    });
    shareModalEl.querySelector("[data-video-x-add-song]")?.addEventListener("click", () => {
      shareModalEl.querySelector("[data-video-x-song-file]")?.click();
    });
    shareModalEl.querySelector("[data-video-x-song-file]")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) setXShareSong(file);
    });
    shareModalEl.querySelector("[data-video-x-song-start]")?.addEventListener("input", (e) => applyXShareSongStart(e.target.value));
    shareModalEl.querySelector("[data-video-x-song-start-num]")?.addEventListener("input", (e) => applyXShareSongStart(e.target.value));
    window.addEventListener("pointermove", (e) => {
      if (xTrimDrag?.track) {
        setXShareTrimFromPct(xTrimDrag.edge, xShareTrackPct(e.clientX, xTrimDrag.track.getBoundingClientRect()));
      }
      if (xSongWaveDrag) setXShareSongStartFromClientX(e.clientX);
    });
    window.addEventListener("pointerup", () => {
      xTrimDrag = null;
      xSongWaveDrag = false;
    });
    const captionSheet = shareModalEl.querySelector("[data-video-x-caption]");
    const songDrop = shareModalEl.querySelector("[data-video-x-song-drop]");
    bindMediaDropTarget(captionSheet, {
      isActive: () => isXCaptionOpen(),
      onFiles: (files) => {
        const audio = (files || []).find((f) => mediaKindFromFile(f) === "audio");
        if (audio) setXShareSong(audio);
      },
      onDragState: (on) => {
        captionSheet?.classList.toggle("is-drop-target", on);
        songDrop?.classList.toggle("is-drop-target", on);
      },
    });
    shareModalEl.querySelectorAll("[data-video-x-grade]").forEach((btn) => {
      btn.addEventListener("click", () => {
        xShareSheet.grade = btn.dataset.videoXGrade || "none";
        applyXShareFilterPreview();
      });
    });
    shareModalEl.querySelector("[data-video-x-apply-filter]")?.addEventListener("click", () => {
      applyXShareFilterPreview();
    });
    shareModalEl.querySelectorAll("[data-video-x-audio]").forEach((btn) => {
      btn.addEventListener("click", () => {
        xShareSheet.keepAudio = btn.dataset.videoXAudio !== "0";
        if (!xShareSheet.keepAudio) xShareSheet.overlaySong = false;
        else if (xShareSheet.song) xShareSheet.overlaySong = true;
        syncXShareAudioRow();
      });
    });
    shareModalEl.querySelector("[data-video-x-overlay]")?.addEventListener("click", () => {
      if (!xShareSheet.song) {
        setShareStatus("Drop a song first, then overlay it.", true);
        return;
      }
      xShareSheet.overlaySong = !xShareSheet.overlaySong;
      if (xShareSheet.overlaySong) xShareSheet.keepAudio = true;
      syncXShareAudioRow();
    });
    shareModalEl.querySelector("[data-video-x-download]")?.addEventListener("click", () => {
      void downloadXShareClip();
    });
    shareModalEl.querySelector("[data-video-x-caption]")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) hideXCaptionPopup();
    });
    shareModalEl.querySelector("[data-video-x-format]")?.addEventListener("change", (e) => {
      persistShareExportPrefs({ shareFormat: e.target.value });
    });
    shareModalEl.querySelector("[data-video-x-quality]")?.addEventListener("change", (e) => {
      persistShareExportPrefs({ quality: e.target.value });
    });
    shareModalEl.querySelector("[data-video-share-discord]")?.addEventListener("click", () => {
      void shareClipToDiscord();
    });
    shareModalEl.querySelector("[data-video-discord-cancel]")?.addEventListener("click", () => {
      hideDiscordChannelPicker();
    });
    shareModalEl.querySelector("[data-video-discord-send]")?.addEventListener("click", () => {
      void sendSelectedDiscordClip();
    });
    shareModalEl.querySelector("[data-video-discord-search]")?.addEventListener("input", () => {
      scheduleDiscordDestSearch();
    });
    shareModalEl.querySelector("[data-video-x-pin-submit]")?.addEventListener("click", () => {
      finishXPinPrompt(true);
    });
    shareModalEl.querySelector("[data-video-x-pin-cancel]")?.addEventListener("click", () => {
      finishXPinPrompt(false);
    });
    shareModalEl.querySelector("[data-video-x-pin-input]")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishXPinPrompt(true);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        finishXPinPrompt(false);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (!editorPageIsHidden()) return;
      if (xShareRaf) {
        cancelAnimationFrame(xShareRaf);
        xShareRaf = 0;
      }
      pauseXSharePreview();
    });

    const host = shareModalEl.querySelector("[data-video-editor-host]");
    videoEditor = mountVideoClipStudio(host, {
      getPreviewEl: () => shareModalEl?.querySelector(".viewport-video-share-preview"),
      getToken,
      getProjectId,
      getAiKeyBodyFields,
      getAiKeyPickerState,
      setAiKeyPickerValue,
      getAiKeyDisplay,
      onOpenAiKeyPicker,
      isEditorSelected: () => {
        const active = docTabs?.getActive?.();
        return active?.kind === "clip" || active?.id === CLIP_EDITOR_TAB_ID;
      },
      isFreeTrialCredits,
      getCurrentUser,
      getRemoteUsers,
      sendCollab,
      onOpenProfile,
      onAskRenderAgent,
      onClipAuthored: (author) => {
        void persistVideoEditorProject(videoEditor?.getProjectName?.() || editorProjectName, { unique: false });
      },
      onCacheMedia: (file, meta = {}) => {
        void cacheEditorMediaBlob(file, meta.persistKey);
      },
      onFilmGenerating: (on, name, meta = {}) => {
        if (shareModalEl) shareModalEl.dataset.filmGenerating = on ? (name || editorProjectName) : "";
        const spin = shareModalEl?.querySelector("[data-video-film-spin]");
        const modelEl = shareModalEl?.querySelector("[data-vtl-gen-model]");
        const msgEl = spin?.querySelector("[data-vtl-preview-loading-msg]");
        const modelLabel = String(meta.modelLabel || "").trim();
        if (msgEl) msgEl.textContent = modelLabel ? `Generating film edit with ${modelLabel}…` : "Generating film edit…";
        if (modelEl) {
          modelEl.textContent = modelLabel ? `Generating with ${modelLabel}` : "";
          modelEl.hidden = !modelLabel;
        }
        spin?.classList.toggle("hidden", !on);
        if (spin) spin.hidden = !on;
        shareModalEl?.querySelector("[data-video-preview-wrap]")?.classList.toggle("is-film-generating", !!on);
        if (!on) {
          spin?.classList.add("hidden");
          if (spin) spin.hidden = true;
        }
        void refreshVideoLibrary();
      },
      onTimelineChange: (draft) => {
        if (restoringEditorProject) return;
        editorTimelineDraft = draft;
        writeEditorSession({
          name: videoEditor?.getProjectName?.() || editorProjectName,
          view: "studio",
          timeline: draft,
        });
        scheduleEditorAutosave();
      },
      onPersistMedia: async (file, meta = {}) => {
        if (!file) return null;
        const name = videoEditor?.getProjectName?.() || editorProjectName;
        const sourcePath = normalizeVideoEditorSourcePath(meta.sourcePath || meta.source_path || file.__sourcePath || "");
        if (sourcePath && !shouldCopyBytesIntoVideoEditorFolder({ kind: meta.kind, sourcePath })) {
          return persistVideoEditorSourceRefs(name, {
            sources: [videoEditorSourceRefFromPath(sourcePath, { kind: meta.kind })],
          });
        }
        const destFolder = meta.kind === "audio"
          ? videoEditorFolderKey(name)
          : meta.kind === "image"
            ? "Screenshots"
            : "Screen Recordings";
        const saved = await saveClipToProject(file, {
          kind: meta.kind === "audio" ? "audio" : meta.kind === "image" ? "screenshot" : "video",
          folder: destFolder,
          filename: meta.filename || file.name,
          label: meta.label || file.name,
          sourcePath,
        });
        const path = normalizeVideoEditorSourcePath(saved?.filename || "");
        if (path) {
          await persistVideoEditorSourceRefs(name, {
            sources: [videoEditorSourceRefFromPath(path, { kind: meta.kind })],
          });
        }
        return saved;
      },
      onOutputBlob: (blob) => {
        if (blob) {
          lastBlob = blob;
          sourceBlob = blob;
          syncPreviewVisibility();
        }
      },
      onStatus: (msg, isError) => setShareStatus(msg, !!isError),
      onDownloadClip: async (_blob, format) => {
        const wrap = shareModalEl?.querySelector("[data-video-download-wrap]");
        if (wrap && format) wrap.dataset.videoDownloadFormat = String(format || "mp4").toLowerCase();
        await downloadEdited(format);
      },
      onProjectNameChange: (name, prev) => {
        const next = name || "Video Editor";
        const old = prev || editorProjectName;
        editorProjectName = next;
        const btn = shareModalEl?.querySelector("[data-video-project-name]");
        if (btn && btn.tagName === "BUTTON") btn.textContent = next;
        upsertClipEditorTab(next);
        void persistEditorFolderRename(old, next);
      },
      initialProjectName: editorProjectName,
      onRequestViewportRecord: () => {
        appendNextViewportTake = true;
        parkClipEditor();
        setStatus(true, "Record another 3D take — it will append to your timeline.");
        void startRecording();
      },
      onSendToChat: (payload) => {
        try { onSendClipToChat?.(payload); } catch (_) {}
      },
    });
    shareModalEl.querySelector("[data-video-share-text]")?.addEventListener("input", (e) => {
      const line = String(e.target.value || "").trim().split("\n")[0].slice(0, 80);
      videoEditor?.setClipLabel?.(line);
      scheduleEditorAutosave();
    });
    shareModalEl.querySelector("[data-video-ai-go]")?.addEventListener("click", () => {
      void applyAiPrompt();
    });
    shareModalEl.querySelector("[data-video-ai-prompt]")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void applyAiPrompt();
      }
    });
    const card = shareModalEl.querySelector("[data-video-editor-card]");
    card?.setAttribute("data-no-feedback-drop", "1");
    shareModalEl.setAttribute("data-no-feedback-drop", "1");
    shareModalEl.querySelector("[data-video-project-name]")?.addEventListener("click", beginModalTitleEdit);
    const previewWrap = shareModalEl.querySelector("[data-video-preview-wrap]");
    const onShareFiles = (files, ev) => videoEditor?.ingestFiles?.(files, ev);
    bindMediaDropTarget(shareModalEl, {
      isActive: () => !shareModalEl.classList.contains("hidden") && shareModalEl.classList.contains("is-studio"),
      onFiles: onShareFiles,
      onDragState: (on) => card?.classList.toggle("is-drop-target", on),
    });
    shareModalEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isXCaptionOpen()) {
        e.preventDefault();
        e.stopPropagation();
        hideXCaptionPopup();
        return;
      }
      if (isXCaptionOpen()) {
        if ((e.key === " " || e.code === "Space") && !e.repeat && !isXCaptionTyping(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          toggleXSharePreview();
        }
        return;
      }
      if (isEditorTypingTarget(e.target)) return;
      if (shareModalEl.classList.contains("hidden") || !shareModalEl.classList.contains("is-studio")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod || e.altKey) return;
      const key = String(e.key || "").toLowerCase();
      if (e.key === "s" || e.code === "KeyS") {
        e.preventDefault();
        e.stopPropagation();
        videoEditor?.splitAtPlayhead?.();
        return;
      }
      if (e.key === "t" || e.code === "KeyT") {
        e.preventDefault();
        e.stopPropagation();
        videoEditor?.trimAtPlayhead?.();
        return;
      }
      if (e.key === "m" || e.code === "KeyM") {
        e.preventDefault();
        e.stopPropagation();
        videoEditor?.muteSelected?.();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        e.stopPropagation();
        videoEditor?.removeSelected?.();
        return;
      }
      if (key === "c" || e.code === "KeyC") {
        e.preventDefault();
        e.stopPropagation();
        videoEditor?.copySelected?.();
        return;
      }
      if (key === "v" || e.code === "KeyV") {
        e.preventDefault();
        e.stopPropagation();
        videoEditor?.pasteClipboard?.();
        return;
      }
      if ((e.key !== " " && e.code !== "Space") || e.repeat) return;
      e.preventDefault();
      videoEditor?.togglePreviewPlayback?.();
    });
    bindMediaDropTarget(card, {
      isActive: () => shareModalEl.classList.contains("is-studio"),
      onFiles: onShareFiles,
      onDragState: (on) => card?.classList.toggle("is-drop-target", on),
    });
    bindMediaDropTarget(previewWrap, {
      isActive: () => shareModalEl.classList.contains("is-studio"),
      onFiles: onShareFiles,
      onDragState: (on) => previewWrap?.classList.toggle("is-drop-target", on),
    });
    const mediaDropPreview = shareModalEl.querySelector(".viewport-video-share-preview");
    bindMediaDropTarget(mediaDropPreview, {
      onFiles: onShareFiles,
      onDragState: (on) => previewWrap?.classList.toggle("is-drop-target", on),
    });
    return shareModalEl;
  }

  async function materializeShareBlob(src) {
    if (isShareBlob(src)) return src;
    if (typeof src !== "string" || !src) return null;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => {
      try { ctrl?.abort(); } catch { /* ignore */ }
    }, 20_000);
    try {
      const res = await fetch(src, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) return null;
      const blob = await res.blob();
      return isShareBlob(blob) ? blob : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveOriginalShareBlob() {
    // Share to X downloads the current clip as-is. Never ensureBaked / convert.
    const candidates = [
      pendingXShareBlob,
      lastBlob,
      pendingDesktopClip,
      sourceBlob,
      typeof videoEditor?.getOutputBlob === "function" ? videoEditor.getOutputBlob() : null,
    ];
    for (const item of candidates) {
      if (isShareBlob(item)) return item;
    }
    for (const item of candidates) {
      if (typeof item === "string" && /^(blob:|https?:|\/)/i.test(item)) {
        const blob = await materializeShareBlob(item);
        if (isShareBlob(blob)) return blob;
      }
    }
    return null;
  }

  function waitShareDownloadTick() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => setTimeout(resolve, 0));
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  async function resolveShareBlob() {
    const editorOpen = !!shareModalEl?.classList.contains("is-studio");
    if (editorOpen && videoEditor) {
      const edited = await resolveEditorExportBlob();
      if (isShareBlob(edited)) return edited;
      if (videoEditor.needsBake?.()) return null;
    }
    if (isShareBlob(pendingXShareBlob)) return pendingXShareBlob;
    return resolveEditorExportBlob();
  }

  async function resolveEditorExportBlob(opts = {}) {
    if (videoEditor?.ensureBaked) {
      const baked = await videoEditor.ensureBaked({
        applyPrompt: false,
        updatePreview: false,
        onProgress: opts.onProgress,
      });
      if (isShareBlob(baked)) {
        lastBlob = baked;
        sourceBlob = baked;
        return baked;
      }
      if (videoEditor.needsBake?.()) return null;
    }
    const fallback = videoEditor?.getOutputBlob?.() || lastBlob || pendingDesktopClip || sourceBlob;
    return isShareBlob(fallback) ? fallback : null;
  }

  async function downloadEdited(formatOverride, blobOverride) {
    if (clipDownloadBusy) return;
    const format = String(formatOverride || selectedDownloadFormat() || "mp4").toLowerCase();
    setClipDownloadBusy(true, { percent: 0 });
    setDownloadMenuOpen(false);
    const report = (event) => {
      const percent = convertProgressPercent(event);
      if (percent != null) setClipDownloadBusy(true, { percent });
    };
    try {
      const blob = blobOverride || await resolveEditorExportBlob({ onProgress: report });
      if (!isShareBlob(blob)) {
        setShareStatus("Nothing to download yet — generate the timeline first.", true);
        return;
      }
      report({ stage: "encode", percent: Math.max(clipDownloadPct || 0, 8) });
      const out = await blobForDownloadFormat(blob, format, {
        audio: selectedDownloadAudio(),
        quality: selectedDownloadQuality(),
        onProgress: report,
      });
      report({ stage: "done", percent: 100 });
      if (!out) throw new Error(`Export did not return a ${format.toUpperCase()} file.`);
      downloadBlob(out, format);
    } catch (err) {
      setShareStatus(err?.message || "Download failed.", true);
    } finally {
      setClipDownloadBusy(false);
    }
  }

  function setShareStatus(text, isError = false) {
    const els = shareModalEl?.querySelectorAll("[data-video-share-status], [data-video-x-caption-status]");
    if (!els?.length) return;
    els.forEach((el) => {
      el.textContent = text || "";
      el.classList.toggle("is-error", !!isError && !!text);
    });
  }

  function setShareXBusy(busy, { percent = null, title = "" } = {}) {
    const postBtn = shareModalEl?.querySelector("[data-video-share-post-x]");
    const confirmBtn = shareModalEl?.querySelector("[data-video-x-caption-post]");
    const n = Number.isFinite(Number(percent))
      ? Math.max(0, Math.min(100, Math.round(Number(percent))))
      : null;
    const apply = (btn, idleLabel, labelSel) => {
      if (!btn) return;
      btn.disabled = !!busy;
      btn.classList.toggle("is-loading", !!busy);
      btn.setAttribute("aria-busy", busy ? "true" : "false");
      const spinner = btn.querySelector(".viewport-video-share-x-spinner");
      const logo = btn.querySelector(".viewport-video-share-logo");
      const label = labelSel ? btn.querySelector(labelSel) : null;
      const pct = btn.querySelector("[data-video-x-prep-pct]");
      const spinLogo = btn.hasAttribute("data-video-x-caption-post") && !!logo;
      if (spinner) {
        if (busy && !spinLogo) spinner.removeAttribute("hidden");
        else spinner.setAttribute("hidden", "");
      }
      if (logo) logo.toggleAttribute("hidden", !!busy && !spinLogo);
      if (pct) {
        if (busy && n != null) {
          pct.hidden = false;
          pct.textContent = `${n}%`;
        } else {
          pct.hidden = true;
        }
      }
      if (label) {
        if (!busy) label.textContent = idleLabel;
        else label.textContent = idleLabel === "Post to X" ? "Posting to X…" : "Sharing…";
      }
    };
    apply(postBtn, "Share to X", "[data-video-share-post-x-label]");
    apply(confirmBtn, "Post to X", "[data-video-x-caption-post-label]");
    apply(document.querySelector(".ref-markup-toolbar [data-ref-action='share-x']"), "Share to X", "[data-ref-share-x-label]");
    apply(document.querySelector("[data-record-done-share-x]"), "Share to X", null);
    apply(document.querySelector('[data-r3d-rec="share-x"]'), "Share to X", null);
    document.querySelectorAll(".browser-action-share-x").forEach((btn) => {
      apply(btn, "Share to X", "[data-ref-share-x-label]");
    });
    if (postBtn) {
      postBtn.title = busy ? (title || "Sharing to X") : "Share to X";
      postBtn.setAttribute("aria-label", busy ? (title || "Sharing to X") : "Share to X");
    }
  }

  function showXPrepPopup({ title, body, spinning = true, percent = null } = {}) {
    // Progress belongs on Share to X — never overlay or spin the video / Motion chrome.
    shareModalEl?.querySelector("[data-video-x-prep]")?.classList.add("hidden");
    const preview = shareModalEl?.querySelector(".viewport-video-share-preview");
    preview?.classList.remove("is-loading");
    if (spinning) {
      setShareXBusy(true, { percent, title });
      setShareStatus(body || title || "Preparing clip for X…");
      return;
    }
    setShareXBusy(false);
    setShareStatus(body || title || "");
  }

  function hideXPrepPopup() {
    shareModalEl?.querySelector("[data-video-x-prep]")?.classList.add("hidden");
    setShareXBusy(false);
  }

  function setXStatus(text) {
    const el = shareModalEl?.querySelector("[data-video-share-x-status]");
    if (el) el.textContent = text || "";
  }

  function setConnectXButton(btn, { connected = false, disabled = false } = {}) {
    if (!btn) return;
    const label = connected ? "Disconnect X" : "Connect X";
    btn.innerHTML = `${X_LOGO_SVG}<span>${label}</span>`;
    btn.dataset.xConnected = connected ? "1" : "0";
    btn.disabled = !!disabled;
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  async function disconnectX() {
    if (!api) {
      setShareStatus("Sign in first.", true);
      return;
    }
    setShareStatus("Disconnecting X…");
    try {
      await api("/api/integrations/twitter/link", { method: "DELETE" });
      setShareStatus("X disconnected.");
      void refreshXStatus();
    } catch (err) {
      setShareStatus(err?.message || "Could not disconnect X.", true);
    }
  }

  const DISCORD_DEFAULT_CHANNEL_ID = "1512906649822560508";
  let discordDestState = {
    channels: [],
    users: [],
    defaultChannelId: DISCORD_DEFAULT_CHANNEL_ID,
    defaultGuildId: "",
    selected: null,
    searchTimer: 0,
  };
  let discordDestAbort = null; // leakfix87
  function beginDiscordDestFetch() {
    if (discordDestAbort) {
      try { discordDestAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    discordDestAbort = ctl;
    return ctl;
  }

  function hideDiscordChannelPicker() {
    if (discordDestAbort) {
      try { discordDestAbort.abort(); } catch (_) { /* ignore */ }
    }
    window.clearTimeout(discordDestState.searchTimer);
    const el = shareModalEl?.querySelector("[data-video-discord-picker]");
    el?.classList.add("hidden");
    if (el) el.hidden = true;
  }

  function discordDestKey(dest) {
    if (!dest) return "";
    return dest.kind === "user" ? `user:${dest.id}` : `channel:${dest.id}`;
  }

  function selectDiscordDest(dest) {
    discordDestState.selected = dest || null;
    const list = shareModalEl?.querySelector("[data-video-discord-channels]");
    list?.querySelectorAll("[data-discord-dest]").forEach((btn) => {
      btn.classList.toggle("is-selected", btn.dataset.discordDest === discordDestKey(dest));
    });
  }

  function renderDiscordDestList() {
    const list = shareModalEl?.querySelector("[data-video-discord-channels]");
    if (!list) return;
    list.innerHTML = "";
    const channels = Array.isArray(discordDestState.channels) ? discordDestState.channels : [];
    const users = Array.isArray(discordDestState.users) ? discordDestState.users : [];
    const addRow = (dest) => {
      const isUser = dest.kind === "user";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "viewport-video-discord-channel";
      if (dest.preferred) btn.classList.add("is-preferred");
      btn.dataset.discordDest = discordDestKey(dest);
      const label = String(dest.name || dest.username || (isUser ? "user" : "channel")).replace(/</g, "&lt;");
      const sub = isUser
        ? `@${String(dest.username || dest.name || "user").replace(/</g, "&lt;")} · Direct message`
        : `${String(dest.guild_name || "Server").replace(/</g, "&lt;")}${dest.preferred ? " · default" : ""}`;
      btn.innerHTML = `<strong>${isUser ? "@" : "#"}${label}</strong><span>${sub}</span>`;
      btn.addEventListener("click", () => {
        selectDiscordDest(dest);
        void postClipToDiscordDest(dest);
      });
      list.appendChild(btn);
    };
    if (channels.length) {
      const head = document.createElement("div");
      head.className = "viewport-video-discord-heading";
      head.textContent = "Channels";
      list.appendChild(head);
      channels.forEach(addRow);
    }
    if (users.length) {
      const head = document.createElement("div");
      head.className = "viewport-video-discord-heading";
      head.textContent = "Users";
      list.appendChild(head);
      users.forEach(addRow);
    }
    if (!channels.length && !users.length) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      empty.textContent = "No matching channels or users.";
      list.appendChild(empty);
    }
    const preferred = channels.find((ch) => ch.preferred)
      || channels.find((ch) => String(ch.id) === String(discordDestState.defaultChannelId))
      || channels[0]
      || users[0]
      || null;
    selectDiscordDest(discordDestState.selected && [...channels, ...users].some((row) => discordDestKey(row) === discordDestKey(discordDestState.selected))
      ? discordDestState.selected
      : preferred);
  }

  function showDiscordDestPicker() {
    const el = shareModalEl?.querySelector("[data-video-discord-picker]");
    if (!el) return;
    renderDiscordDestList();
    el.classList.remove("hidden");
    el.hidden = false;
    shareModalEl?.querySelector("[data-video-discord-search]")?.focus();
  }

  function scheduleDiscordDestSearch() {
    window.clearTimeout(discordDestState.searchTimer);
    discordDestState.searchTimer = window.setTimeout(() => {
      void loadDiscordDestinations(shareModalEl?.querySelector("[data-video-discord-search]")?.value || "");
    }, 220);
  }

  async function sendSelectedDiscordClip() {
    if (!discordDestState.selected) {
      setShareStatus("Pick a Discord channel or user.", true);
      return;
    }
    await postClipToDiscordDest(discordDestState.selected);
  }

  async function postClipToDiscordDest(dest) {
    const blob = await resolveShareBlob();
    if (!isShareBlob(blob)) {
      setShareStatus("Nothing to post yet — generate the timeline first.", true);
      return;
    }
    const caption = String(shareModalEl?.querySelector("[data-video-share-text]")?.value || "").trim()
      || "Clip from Render Studio";
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) {
      setShareStatus("Sign in to share to Discord.", true);
      return;
    }
    const isUser = dest.kind === "user";
    setShareStatus(isUser ? "Posting clip as a Discord DM…" : "Posting clip to Discord…");
    confirmOpenDiscordApp({
      confirm: false,
      guildId: dest.guild_id,
      channelId: isUser ? (dest.dm_channel_id || "") : dest.id,
      userId: isUser ? dest.id : "",
    });
    const form = new FormData();
    form.append("file", blob, blobLooksLike(blob, "mp4") ? "clip.mp4" : "clip.webm");
    form.append("content", caption);
    form.append("kind", isUser ? "dm" : "channel");
    if (isUser) form.append("user_id", String(dest.id || ""));
    else form.append("channel_id", String(dest.id || ""));
    try {
      const res = await fetch("/api/integrations/discord/share-clip", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "Could not post to Discord.");
      hideDiscordChannelPicker();
      const label = isUser ? `@${dest.username || dest.name || "user"}` : `#${dest.name || "channel"}`;
      setShareStatus(`Posted to ${label} — Discord app is open.`);
    } catch (err) {
      setShareStatus(err?.message || "Could not post to Discord.", true);
    }
  }

  async function loadDiscordDestinations(query) {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) {
      setShareStatus("Sign in to list Discord channels and users.", true);
      return { channels: [], users: [] };
    }
    const ctl = beginDiscordDestFetch();
    const q = String(query || "").trim();
    const url = q
      ? `/api/integrations/discord/channels?q=${encodeURIComponent(q)}`
      : "/api/integrations/discord/channels";
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal });
      const data = await res.json().catch(() => ({}));
      if (ctl.signal.aborted) return { channels: discordDestState.channels, users: discordDestState.users };
      discordDestState.channels = Array.isArray(data?.channels) ? data.channels : [];
      discordDestState.users = Array.isArray(data?.users) ? data.users : [];
      discordDestState.defaultChannelId = String(data?.default_channel_id || DISCORD_DEFAULT_CHANNEL_ID);
      discordDestState.defaultGuildId = String(data?.default_guild_id || "");
      const picker = shareModalEl?.querySelector("[data-video-discord-picker]");
      if (picker && !picker.classList.contains("hidden") && !picker.hidden) {
        renderDiscordDestList();
      }
      return data;
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") {
        return { channels: discordDestState.channels, users: discordDestState.users };
      }
      throw err;
    }
  }

  async function shareClipToDiscord() {
    try { openDiscord({ skipWeb: true }); } catch { /* keep Studio tab */ }
    confirmOpenDiscordApp({
      confirm: false,
      channelId: discordDestState.defaultChannelId || DISCORD_DEFAULT_CHANNEL_ID,
      guildId: discordDestState.defaultGuildId,
    });
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) {
      setShareStatus("Sign in to list Discord channels.", true);
      return;
    }
    const destList = shareModalEl?.querySelector("[data-video-discord-channels]");
    if (!destList?.querySelector("[data-discord-dest]")) {
      setShareStatus("Loading Discord channels and users…");
    }
    try {
      const data = await loadDiscordDestinations("");
      const channels = discordDestState.channels;
      const users = discordDestState.users;
      if (!channels.length && !users.length) {
        const blob = await resolveShareBlob();
        if (isShareBlob(blob)) {
          try { downloadShareBlob(blob); } catch { /* still open Discord */ }
        }
        setShareStatus(
          data?.error
            || "Discord app is open. No bot channels or users yet — drop the downloaded clip in Discord.",
          !data?.configured,
        );
        return;
      }
      showDiscordDestPicker();
      setShareStatus("Pick a channel or user. Default is your Discord updates channel.");
    } catch (err) {
      setShareStatus(err?.message || "Could not load Discord destinations.", true);
    }
  }

  function setXProfileRow({ connected = false, handle = "", name = "", picture = "", configured = true } = {}) {
    const avatar = shareModalEl?.querySelector("[data-video-x-avatar]");
    const fallback = shareModalEl?.querySelector("[data-video-x-avatar-fallback]");
    const handleEl = shareModalEl?.querySelector("[data-video-x-profile-handle]");
    const connectBtn = shareModalEl?.querySelector("[data-video-x-caption-connect]");
    if (avatar) {
      if (connected && picture) {
        avatar.src = picture;
        avatar.hidden = false;
      } else {
        avatar.removeAttribute("src");
        avatar.hidden = true;
      }
    }
    if (fallback) fallback.hidden = !!(connected && picture);
    if (handleEl) {
      handleEl.textContent = connected
        ? (handle || name || "X account")
        : "Compose opens X with your clip";
    }
    setConnectXButton(connectBtn, { connected, disabled: !configured });
  }

  async function refreshXStatus() {
    const connectBtn = shareModalEl?.querySelector("[data-video-share-connect-x]");
    const postBtn = shareModalEl?.querySelector("[data-video-share-post-x]");
    // Local Share to X (compose + attach) never needs the API.
    if (postBtn) postBtn.disabled = false;
    setXStatus("");
    if (!api) {
      setConnectXButton(connectBtn, { connected: false, disabled: true });
      setXProfileRow({ connected: false, configured: false });
      return { connected: false };
    }
    try {
      const data = await api("/api/integrations/twitter/status");
      const connected = !!data?.connected;
      const handle = data?.account?.username ? `@${data.account.username}` : "";
      const name = data?.account?.display_name || "";
      const picture = data?.account?.picture_url || "";
      const configured = data?.configured !== false;
      if (!configured) {
        setConnectXButton(connectBtn, { connected: false, disabled: true });
        setXProfileRow({ connected: false, configured: false });
      } else if (connected) {
        setConnectXButton(connectBtn, { connected: true, disabled: false });
        setXProfileRow({ connected: true, handle, name, picture, configured: true });
      } else {
        setConnectXButton(connectBtn, { connected: false, disabled: false });
        setXProfileRow({ connected: false, configured: true });
      }
      return data;
    } catch (err) {
      setXProfileRow({ connected: false, configured: true });
      return { connected: false };
    }
  }

  let xPinResolver = null;

  function hideXPinPanel() {
    const panel = shareModalEl?.querySelector("[data-video-x-pin-panel]");
    panel?.classList.add("hidden");
    const input = shareModalEl?.querySelector("[data-video-x-pin-input]");
    if (input) input.value = "";
  }

  function finishXPinPrompt(submit) {
    const input = shareModalEl?.querySelector("[data-video-x-pin-input]");
    const pin = submit ? String(input?.value || "").trim() : "";
    hideXPinPanel();
    const resolve = xPinResolver;
    xPinResolver = null;
    resolve?.(pin || null);
  }

  function ensureXPinPanel() {
    ensureShareModal();
    if (shareModalEl.querySelector("[data-video-x-pin-panel]")) return;
    const status = shareModalEl.querySelector("[data-video-share-status]");
    const html = `
        <div class="viewport-x-pin-panel hidden" data-video-x-pin-panel>
          <p class="viewport-x-pin-title">Enter the PIN from X</p>
          <p class="muted small">Authorize Render Studio in the X window, then type the PIN shown there.</p>
          <div class="viewport-x-pin-row">
            <input type="text" inputmode="numeric" autocomplete="one-time-code" data-video-x-pin-input placeholder="PIN code" maxlength="12" />
            <button type="button" class="btn accent" data-video-x-pin-submit>Connect</button>
            <button type="button" class="btn secondary" data-video-x-pin-cancel>Cancel</button>
          </div>
        </div>`;
    if (status) status.insertAdjacentHTML("afterend", html);
    else shareModalEl.querySelector(".viewport-video-share-actions")?.insertAdjacentHTML("beforebegin", html);
    shareModalEl.querySelector("[data-video-x-pin-submit]")?.addEventListener("click", () => finishXPinPrompt(true));
    shareModalEl.querySelector("[data-video-x-pin-cancel]")?.addEventListener("click", () => finishXPinPrompt(false));
    shareModalEl.querySelector("[data-video-x-pin-input]")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finishXPinPrompt(true); }
      if (e.key === "Escape") { e.preventDefault(); finishXPinPrompt(false); }
    });
  }

  function askXPinInModal() {
    ensureXPinPanel();
    return new Promise((resolve) => {
      if (xPinResolver) {
        const prev = xPinResolver;
        xPinResolver = null;
        prev(null);
      }
      xPinResolver = resolve;
      const panel = shareModalEl.querySelector("[data-video-x-pin-panel]");
      const input = shareModalEl.querySelector("[data-video-x-pin-input]");
      panel?.classList.remove("hidden");
      if (input) {
        input.value = "";
        window.setTimeout(() => input.focus(), 50);
      }
      setShareStatus("Authorize in the X window, then enter the PIN below.");
    });
  }

  async function connectX() {
    if (!api) {
      setShareStatus("Sign in first.", true);
      return;
    }
    setShareStatus("Opening X authorization…");
    try {
      const data = await api("/api/integrations/twitter/link-url", { method: "POST" });
      if (!data?.url) throw new Error("X authorization URL was not returned.");
      const mode = String(data.mode || "redirect").toLowerCase();
      const width = 560;
      const height = 720;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
      const popup = window.open(
        data.url,
        "render3d-twitter-connect",
        `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
      );
      if (!popup) {
        setShareStatus(
          "Popup blocked — allow popups for Render Studio, or open the X link from Preferences → Connected apps.",
          true,
        );
        return;
      }

      // Desktop/Native X apps only support PIN (oob) — collect it in-page (window.prompt is often blocked).
      if (mode === "oob") {
        const pin = await askXPinInModal();
        try { popup.close(); } catch (_) {}
        if (!pin) {
          setShareStatus("Connect cancelled — no PIN entered.", true);
          return;
        }
        setShareStatus("Finishing X connect…");
        await api("/api/integrations/twitter/link-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: data.state, pin }),
        });
        setShareStatus("X connected — you can Share to X now.");
        void refreshXStatus();
        return;
      }

      setShareStatus("Finish connecting in the X window…");
      const onMessage = (event) => {
        if (event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== "render3d:oauth-done") return;
        if (!["twitter", "x"].includes(String(event.data.provider || "").toLowerCase())) return;
        window.removeEventListener("message", onMessage);
        window.clearInterval(closeTimer);
        if (event.data.ok) {
          setShareStatus("X connected — you can Share to X now.");
          void refreshXStatus();
        } else {
          const detail = String(event.data.detail || "").trim().toLowerCase();
          setShareStatus(
            detail
              ? `X connect failed: ${detail}`
              : "X connect failed. Enable User authentication + Read and write in the Developer Portal.",
            true,
          );
          void refreshXStatus();
        }
      };
      window.addEventListener("message", onMessage);
      const closeTimer = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(closeTimer);
        window.removeEventListener("message", onMessage);
        void refreshXStatus().then((status) => {
          if (status?.connected) {
            setShareStatus("X connected — you can Share to X now.");
          } else {
            setShareStatus("X window closed without connecting.", true);
          }
        });
      }, 800);
      window.setTimeout(() => {
        window.clearInterval(closeTimer);
        window.removeEventListener("message", onMessage);
      }, 10 * 60 * 1000);
    } catch (err) {
      setShareStatus(err?.message || "Could not start X connect.", true);
    }
  }

  function reserveXComposeTab() {
    try {
      const tab = window.open("about:blank", "_blank");
      if (tab) {
        try {
          tab.document.title = "Opening X…";
          tab.document.body.innerHTML = "<p style=\"font:14px/1.4 sans-serif;padding:24px;color:#111\">Preparing your clip…</p>";
        } catch { /* cross-origin about:blank */ }
      }
      return tab;
    } catch {
      return null;
    }
  }

  function openXCompose(text, tab = null) {
    // X auto-links https://render3d.app in the caption. url= is a fallback
    // card when the text somehow omitted the site.
    const { caption, url, prev } = xComposeHref(text);
    if (tab && !tab.closed) {
      try {
        tab.location = url;
        return caption;
      } catch { /* fall through */ }
    }
    try {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) window.open(prev, "_blank", "noopener,noreferrer");
    } catch { /* keep Studio tab */ }
    return caption;
  }

  function downloadShareBlob(blob) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = downloadExtForBlob(blob, "mp4");
    triggerLocalDownload(blob, `render3d-video-${stamp}.${ext}`);
  }

  function persistShareExportPrefs(next = {}) {
    const shareFormat = SHARE_FORMATS.includes(String(next.shareFormat || "").toLowerCase())
      ? String(next.shareFormat).toLowerCase()
      : undefined;
    const quality = BITRATES[next.quality] ? next.quality : undefined;
    const patch = {};
    if (shareFormat) patch.shareFormat = shareFormat;
    if (quality) patch.quality = quality;
    if (!Object.keys(patch).length) return readPrefs();
    prefs = writePrefs(patch);
    return prefs;
  }

  function selectedShareFormat() {
    const picked = String(shareModalEl?.querySelector("[data-video-x-format]")?.value || readPrefs().shareFormat || "mp4").toLowerCase();
    return SHARE_FORMATS.includes(picked) ? picked : "mp4";
  }

  function selectedShareQuality() {
    const picked = String(shareModalEl?.querySelector("[data-video-x-quality]")?.value || readPrefs().quality || "ultra").toLowerCase();
    return BITRATES[picked] ? picked : "ultra";
  }

  function syncShareExportSelects() {
    const p = readPrefs();
    const formatEl = shareModalEl?.querySelector("[data-video-x-format]");
    const qualityEl = shareModalEl?.querySelector("[data-video-x-quality]");
    if (formatEl) formatEl.value = SHARE_FORMATS.includes(p.shareFormat) ? p.shareFormat : "mp4";
    if (qualityEl) qualityEl.value = BITRATES[p.quality] ? p.quality : "ultra";
  }

  function xSharePreviewEl() {
    return shareModalEl?.querySelector("[data-video-x-preview]");
  }

  function xShareVideoDuration() {
    return xShareKnownDuration();
  }

  function xShareSeekableEnd(preview) {
    try {
      const seek = preview?.seekable;
      if (seek && seek.length) {
        const end = Number(seek.end(seek.length - 1));
        if (Number.isFinite(end) && end > 0) return end;
      }
    } catch { /* seekable not ready */ }
    return 0;
  }

  function xShareKnownDuration() {
    const preview = xSharePreviewEl();
    const next = xShareFallbackDuration({
      duration: finiteMediaDuration(preview) || preview?.duration,
      seekableEnd: xShareSeekableEnd(preview),
      currentTime: preview?.currentTime,
      cached: xShareSheet.duration,
    });
    const real = finiteMediaDuration(preview) || (Number(preview?.duration) > 0 ? Number(preview.duration) : 0);
    if (real > 0) rememberXShareDuration(real);
    return next;
  }

  function rememberXShareDuration(next) {
    const n = Number(next);
    if (!Number.isFinite(n) || n <= 0) return Number(xShareSheet.duration) || 0;
    const prev = Number(xShareSheet.duration) || 0;
    if (prev > 0 && Math.abs(prev - n) > 0.08) {
      const inPct = Number(xShareSheet.trimInPct) || 0;
      const outPct = xShareSheet.trimOutPct == null ? 1 : Number(xShareSheet.trimOutPct);
      xShareSheet.trimIn = inPct * n;
      xShareSheet.trimOut = outPct >= 0.999 ? null : outPct * n;
    }
    xShareSheet.duration = n;
    return n;
  }

  function refreshXShareDuration() {
    const preview = xSharePreviewEl();
    const real = finiteMediaDuration(preview) || Number(preview?.duration) || xShareSeekableEnd(preview);
    if (real > 0) rememberXShareDuration(real);
    syncXShareTrimUi();
    syncXShareSongWave();
    syncXSharePlayhead();
  }

  function xShareActiveTrim() {
    const dur = xShareKnownDuration();
    const tin = (Number(xShareSheet.trimInPct) || 0) * dur;
    const tout = (xShareSheet.trimOutPct == null ? 1 : Number(xShareSheet.trimOutPct)) * dur;
    return xShareTrimWindow(dur, tin, tout);
  }

  function xShareNeedsTrim() {
    const full = xShareKnownDuration();
    const win = xShareActiveTrim();
    return full > 0 && (win.trimIn > 0.04 || win.trimOut < full - 0.04);
  }

  function setXShareTrimFromPct(edge, pct, { seek = true } = {}) {
    const p = Math.max(0, Math.min(1, Number(pct) || 0));
    const minGap = 0.02;
    let tin = Number(xShareSheet.trimInPct) || 0;
    let tout = xShareSheet.trimOutPct == null ? 1 : Number(xShareSheet.trimOutPct);
    if (!Number.isFinite(tout)) tout = 1;
    if (edge === "in") tin = Math.min(p, tout - minGap);
    else if (edge === "out") tout = Math.max(p, tin + minGap);
    tin = Math.max(0, Math.min(1, tin));
    tout = Math.max(0, Math.min(1, tout));
    xShareSheet.trimInPct = tin;
    xShareSheet.trimOutPct = tout >= 0.999 ? 1 : tout;
    const dur = xShareKnownDuration();
    xShareSheet.trimIn = tin * dur;
    xShareSheet.trimOut = tout >= 0.999 ? null : tout * dur;
    const preview = xSharePreviewEl();
    const real = finiteMediaDuration(preview) || Number(preview?.duration) || 0;
    if (seek && preview && real > 0.08) {
      const at = edge === "out" ? xShareSheet.trimOut ?? real : edge === "in" ? xShareSheet.trimIn : p * real;
      try { preview.currentTime = Math.max(0, Math.min(real, Number(at) || 0)); } catch { /* ignore */ }
    }
    syncXShareTrimUi();
    syncXSharePlayhead();
    syncXShareSongWave();
  }

  function syncXShareTrimUi() {
    const tin = Number(xShareSheet.trimInPct) || 0;
    const tout = xShareSheet.trimOutPct == null ? 1 : Number(xShareSheet.trimOutPct);
    const left = tin * 100;
    const right = (Number.isFinite(tout) ? tout : 1) * 100;
    const shadeIn = shareModalEl?.querySelector("[data-video-x-trim-shade-in]");
    const shadeOut = shareModalEl?.querySelector("[data-video-x-trim-shade-out]");
    const windowEl = shareModalEl?.querySelector("[data-video-x-trim-window]");
    const inHandle = shareModalEl?.querySelector("[data-video-x-trim='in']");
    const outHandle = shareModalEl?.querySelector("[data-video-x-trim='out']");
    if (shadeIn) shadeIn.style.width = `${left}%`;
    if (shadeOut) {
      shadeOut.style.left = `${right}%`;
      shadeOut.style.width = `${Math.max(0, 100 - right)}%`;
    }
    if (windowEl) {
      windowEl.style.left = `${left}%`;
      windowEl.style.width = `${Math.max(0, right - left)}%`;
    }
    if (inHandle) inHandle.style.left = `${left}%`;
    if (outHandle) outHandle.style.left = `${right}%`;
  }

  function applyXShareSongStart(value) {
    if (!xShareSheet.song) return;
    const max = Math.max(0, Number(xShareSheet.song.duration) || 0);
    xShareSheet.song.trimIn = Math.max(0, Math.min(max, Number(value) || 0));
    const start = shareModalEl?.querySelector("[data-video-x-song-start]");
    const num = shareModalEl?.querySelector("[data-video-x-song-start-num]");
    if (start) start.value = String(xShareSheet.song.trimIn);
    if (num) num.value = String(xShareSheet.song.trimIn);
    syncXShareSongWave();
    previewFromSongOffset();
  }

  function setXShareSongStartFromClientX(clientX) {
    const track = shareModalEl?.querySelector("[data-video-x-song-track]");
    const full = Number(xShareSheet.song?.duration) || 0;
    if (!track || full <= 0) return;
    applyXShareSongStart(seekTimeFromClientX(clientX, track.getBoundingClientRect(), full));
  }

  function syncXShareSongWave() {
    const track = shareModalEl?.querySelector("[data-video-x-song-track]");
    const span = shareModalEl?.querySelector("[data-video-x-song-span]");
    const song = xShareSheet.song;
    if (!track || !song) return;
    const full = Number(song.duration) || 0;
    const start = Number(song.trimIn) || 0;
    const used = xShareActiveTrim().duration;
    const pct = playheadPlayedPct(start, full);
    const endPct = playheadPlayedPct(start + used, full);
    track.style.setProperty("--played", `${pct}%`);
    track.style.setProperty("--start", `${pct}%`);
    track.style.setProperty("--span", `${Math.max(0, endPct - pct)}%`);
    track.setAttribute("aria-valuenow", String(Math.round(start)));
    track.setAttribute("aria-valuemax", String(Math.round(full)));
    if (span) {
      span.style.left = `${pct}%`;
      span.style.width = `${Math.max(0, endPct - pct)}%`;
    }
  }

  async function paintXShareSongWave() {
    const wave = shareModalEl?.querySelector("[data-video-x-song-wave]");
    const bars = shareModalEl?.querySelector("[data-video-x-song-bars]");
    const played = shareModalEl?.querySelector("[data-video-x-song-played]");
    const song = xShareSheet.song;
    if (!wave || !song?.blob) {
      wave?.classList.add("hidden");
      wave?.setAttribute("hidden", "");
      return;
    }
    wave.classList.remove("hidden");
    wave.removeAttribute("hidden");
    const key = `xshare:${song.name || "song"}:${song.blob.size || 0}`;
    const peaks = await peaksForAudioBlob(song.blob, key, AUDIO_PEAK_COUNT);
    const html = waveformBarsHtml(sanitizeAudioPeaks(peaks));
    if (bars) bars.innerHTML = html;
    if (played) played.innerHTML = html;
    syncXShareSongWave();
  }

  function xShareShouldOverlay(audio = true) {
    return !!audio && !!xShareSheet.overlaySong && !!(xShareSheet.song?.blob || (xShareSheet.song instanceof Blob));
  }

  function syncXShareAudioRow() {
    shareModalEl?.querySelectorAll("[data-video-x-audio]").forEach((el) => {
      el.classList.toggle("is-active", (el.dataset.videoXAudio !== "0") === !!xShareSheet.keepAudio);
    });
    const overlay = shareModalEl?.querySelector("[data-video-x-overlay]");
    if (overlay) {
      const hasSong = !!(xShareSheet.song?.blob || (xShareSheet.song instanceof Blob));
      overlay.classList.toggle("hidden", !hasSong);
      overlay.classList.toggle("is-active", hasSong && !!xShareSheet.overlaySong);
      overlay.setAttribute("aria-pressed", hasSong && xShareSheet.overlaySong ? "true" : "false");
    }
  }

  function xShareSongEl() {
    return shareModalEl?.querySelector("[data-video-x-song-el]");
  }

  function isXCaptionOpen() {
    const el = shareModalEl?.querySelector("[data-video-x-caption]");
    return !!(el && !el.classList.contains("hidden"));
  }

  function isXCaptionTyping(el) {
    return !!el?.closest?.("textarea, input:not([type=range]), select, [contenteditable='true'], [contenteditable='']");
  }

  function toggleXSharePreview() {
    const el = xSharePreviewEl();
    if (!el) return;
    if (el.paused) {
      const real = finiteMediaDuration(el) || Number(el.duration) || 0;
      const win = xShareActiveTrim();
      const t = Number(el.currentTime) || 0;
      if (real > 0.08 && (t < win.trimIn || t >= win.trimOut - 0.05)) {
        try { el.currentTime = win.trimIn; } catch { /* ignore */ }
      }
      el.play?.().catch(() => {});
      const song = xShareSongEl();
      if (song && xShareSheet.song) {
        const videoSec = Math.max(0, (Number(el.currentTime) || 0) - win.trimIn);
        try {
          song.currentTime = xShareSongPreviewTime(videoSec, xShareSheet.song.trimIn, song.duration || xShareSheet.song.duration);
        } catch { /* ignore */ }
        song.play?.().catch(() => {});
      }
      const play = shareModalEl?.querySelector("[data-video-x-play]");
      if (play) play.textContent = "Pause";
      startXSharePlayheadClock();
    } else {
      pauseXSharePreview();
    }
  }

  function previewFromSongOffset() {
    const preview = xSharePreviewEl();
    const song = xShareSongEl();
    const win = xShareActiveTrim();
    const real = finiteMediaDuration(preview) || Number(preview?.duration) || 0;
    if (preview) {
      if (real > 0.08) {
        try { preview.currentTime = win.trimIn; } catch { /* ignore */ }
      }
      preview.play?.().catch(() => {});
    }
    if (song && xShareSheet.song) {
      try { song.currentTime = xShareSheet.song.trimIn || 0; } catch { /* ignore */ }
      song.play?.().catch(() => {});
    }
    const play = shareModalEl?.querySelector("[data-video-x-play]");
    if (play) play.textContent = "Pause";
    startXSharePlayheadClock();
    syncXSharePlayhead();
  }

  function pauseXSharePreview() {
    const preview = xSharePreviewEl();
    const song = xShareSongEl();
    try { preview?.pause?.(); } catch { /* ignore */ }
    try { song?.pause?.(); } catch { /* ignore */ }
    if (xShareRaf) {
      cancelAnimationFrame(xShareRaf);
      xShareRaf = 0;
    }
    const play = shareModalEl?.querySelector("[data-video-x-play]");
    if (play) play.textContent = "Play";
  }

  function startXSharePlayheadClock() {
    if (xShareRaf) return;
    pauseOffscreenEditorMedia(shareModalEl, xSharePreviewEl());
    const tick = () => {
      xShareRaf = 0;
      if (editorPageIsHidden()) return;
      if (!isXCaptionOpen()) return;
      syncXSharePlayhead({ seekLoop: !xTrimDrag });
      const preview = xSharePreviewEl();
      if (preview && !preview.paused) {
        xShareRaf = requestAnimationFrame(tick);
      }
    };
    xShareRaf = requestAnimationFrame(tick);
  }

  function syncXSharePlayhead({ seekLoop = false } = {}) {
    const preview = xSharePreviewEl();
    const head = shareModalEl?.querySelector("[data-video-x-mini-playhead]");
    const clock = shareModalEl?.querySelector("[data-video-x-mini-clock]");
    const raw = Number(preview?.currentTime) || 0;
    const real = finiteMediaDuration(preview) || Number(preview?.duration) || 0;
    const dur = real > 0 ? rememberXShareDuration(real) : xShareKnownDuration();
    const win = xShareActiveTrim();
    let t = raw;
    if (seekLoop && !xTrimDrag && real > 0.08) {
      const restarted = xSharePreviewLoopRestart(raw, real, win.trimIn, win.trimOut);
      if (preview && Math.abs(restarted - raw) > 0.04) {
        try { preview.currentTime = restarted; } catch { /* ignore */ }
        t = restarted;
      } else {
        t = restarted;
      }
    }
    if (head) head.style.left = `${xSharePlayheadPct(t, dur)}%`;
    if (clock) clock.textContent = `${t.toFixed(1)}s · ${win.duration.toFixed(1)}s`;
    const song = xShareSongEl();
    if (song && xShareSheet.song && real > 0.08) {
      const want = xShareSongPreviewTime(
        Math.max(0, t - win.trimIn),
        xShareSheet.song.trimIn,
        song.duration || xShareSheet.song.duration,
      );
      if (Math.abs((song.currentTime || 0) - want) > 0.35) {
        try { song.currentTime = want; } catch { /* ignore */ }
      }
    }
    syncXShareTrimUi();
  }

  function loopXSharePreview() {
    const preview = xSharePreviewEl();
    if (!preview) return;
    const win = xShareActiveTrim();
    preview.currentTime = win.trimIn;
    const song = xShareSongEl();
    if (song && xShareSheet.song) {
      try { song.currentTime = xShareSheet.song.trimIn || 0; } catch { /* ignore */ }
      song.play?.().catch(() => {});
    }
    preview.play?.().catch(() => {});
  }

  function applyXShareFilterPreview() {
    const preview = xSharePreviewEl();
    if (preview) preview.style.filter = cssFilterForGrade(xShareSheet.grade);
    shareModalEl?.querySelectorAll("[data-video-x-grade]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.videoXGrade === xShareSheet.grade);
    });
  }

  function loadXSharePreview(blob) {
    const preview = xSharePreviewEl();
    const full = shareModalEl?.querySelector("[data-video-x-full]");
    if (!preview || !full) return;
    full.hidden = false;
    if (isShareBlob(blob)) {
      if (xShareSheet.previewUrl) {
        try { URL.revokeObjectURL(xShareSheet.previewUrl); } catch { /* ignore */ }
      }
      xShareSheet.previewUrl = URL.createObjectURL(blob);
      preview.src = xShareSheet.previewUrl;
      preview.loop = true;
      preview.muted = !!xShareSheet.song;
      xShareSheet.duration = 0;
      xShareSheet.trimIn = 0;
      xShareSheet.trimOut = null;
      xShareSheet.trimInPct = 0;
      xShareSheet.trimOutPct = 1;
    }
    applyXShareFilterPreview();
    syncXShareTrimUi();
    syncXSharePlayhead();
    startXSharePlayheadClock();
    void paintXShareSongWave();
  }

  async function bakeXShareClip({ audio = true, onProgress } = {}) {
    const src = pendingXShareBlob || lastBlob;
    if (!isShareBlob(src)) return null;
    const overlay = xShareShouldOverlay(audio);
    const plan = xShareBakePlan({
      audio,
      grade: xShareSheet.grade,
      song: overlay ? xShareSheet.song : null,
      duration: xShareVideoDuration(),
      trimIn: xShareSheet.trimIn,
      trimOut: xShareSheet.trimOut,
    });
    let work = src;
    if (plan.grade && plan.grade !== "none") {
      try {
        work = await renderEditedClip(src, {
          keepAudio: plan.keepAudio || !!plan.music,
          grade: plan.grade,
        }, { onProgress }) || src;
      } catch {
        work = src;
      }
    }
    // Share to X / Download never call /api/video/convert. That ffmpeg path
    // is what showed "Conversion failed". Download the current clip as-is.
    return work;
  }

  async function downloadXShareClip() {
    const format = selectedShareFormat();
    const quality = selectedShareQuality();
    persistShareExportPrefs({
      shareFormat: format,
      quality,
    });
    setShareStatus("Preparing download…");
    const report = (event) => {
      const percent = convertProgressPercent(event);
      if (percent != null) setShareStatus(`Preparing download… ${percent}%`);
    };
    try {
      const baked = await bakeXShareClip({
        audio: xShareSheet.keepAudio,
        onProgress: report,
      });
      if (!isShareBlob(baked)) {
        setShareStatus("Nothing to download yet.", true);
        return;
      }
      const exportPlan = xShareExportPlan(baked.type, format);
      const output = exportPlan.convert
        ? await convertViaApi(baked, exportPlan.format, {
          intent: "share",
          quality,
          audio: xShareSheet.keepAudio,
          onProgress: report,
        })
        : baked;
      if (!isShareBlob(output) || !blobLooksLike(output, exportPlan.format)) {
        throw new Error(`Export did not return a ${exportPlan.format.toUpperCase()} file.`);
      }
      downloadBlob(output, exportPlan.format);
      setShareStatus("Clip downloaded.");
    } catch (err) {
      setShareStatus(err?.message || "Could not export this video.", true);
    }
  }

  function setXShareSong(file) {
    if (!file) return;
    if (xShareSheet.song?.url) {
      try { URL.revokeObjectURL(xShareSheet.song.url); } catch { /* ignore */ }
    }
    const url = URL.createObjectURL(file);
    xShareSheet.song = { blob: file, url, name: file.name || "Song", trimIn: 0, duration: 0 };
    const song = xShareSongEl();
    if (song) {
      song.src = url;
      song.onloadedmetadata = () => {
        xShareSheet.song.duration = Number(song.duration) || 0;
        const start = shareModalEl?.querySelector("[data-video-x-song-start]");
        const num = shareModalEl?.querySelector("[data-video-x-song-start-num]");
        const max = Math.max(0, xShareSheet.song.duration);
        if (start) {
          start.max = String(max);
          start.disabled = max <= 0;
        }
        if (num) num.max = String(max);
        syncXShareSongWave();
      };
    }
    const name = shareModalEl?.querySelector("[data-video-x-song-name]");
    if (name) name.textContent = xShareSheet.song.name;
    const preview = xSharePreviewEl();
    if (preview) preview.muted = true;
    xShareSheet.overlaySong = true;
    xShareSheet.keepAudio = true;
    syncXShareAudioRow();
    void paintXShareSongWave();
  }

  function hideXCaptionPopup() {
    if (xShareRaf) {
      cancelAnimationFrame(xShareRaf);
      xShareRaf = 0;
    }
    revokeXShareSheetUrls(); // leakfix25
    pauseXSharePreview();
    shareModalEl?.querySelector("[data-video-x-caption]")?.classList.add("hidden");
    if (shareModalEl?.classList.contains("is-sheet-only")) {
      shareModalEl.classList.add("hidden");
      shareModalEl.classList.remove("is-sheet-only");
    }
  }

  function openEditorFromSharePopup() {
    const blob = pendingXShareBlob || lastBlob || pendingDesktopClip;
    const sheetOnly = shareModalEl?.classList.contains("is-sheet-only");
    shareModalEl?.querySelector("[data-video-x-caption]")?.classList.add("hidden");
    shareModalEl?.classList.remove("is-sheet-only");
    xShareInPlace = false;
    if (sheetOnly || shareModalEl?.classList.contains("hidden")) {
      void openClipEditorFromChrome({ blob, fromRecording: true });
    }
  }

  function showXCaptionPopup() {
    const modal = ensureShareModal();
    const studioOpen = !!(modal && !modal.classList.contains("hidden") && !modal.classList.contains("is-sheet-only"));
    if (xShareInPlace && !studioOpen) {
      modal.classList.add("is-sheet-only");
      modal.classList.remove("hidden");
    }
    const sheet = modal.querySelector("[data-video-x-caption]");
    const textEl = modal.querySelector("[data-video-share-text]");
    const currentCaption = String(textEl?.value || "").trim();
    if (textEl && (
      !currentCaption
      || currentCaption === X_SHARE_ATTRIBUTION
      || currentCaption === X_SHARE_ATTRIBUTION_LINE
      || currentCaption === `${X_SHARE_ATTRIBUTION}\n${X_SHARE_SITE}`
    )) {
      textEl.value = X_SHARE_DEFAULT;
    }
    syncShareExportSelects();
    syncXShareAudioRow();
    syncXShareTrimUi();
    sheet?.classList.remove("hidden");
    loadXSharePreview(pendingXShareBlob || lastBlob || pendingDesktopClip);
    setShareStatus("");
    void refreshXStatus();
    textEl?.focus?.();
    try {
      const len = String(textEl?.value || "").indexOf(X_SHARE_ATTRIBUTION);
      if (textEl && len >= 0) textEl.setSelectionRange(0, Math.max(0, len));
      else if (textEl) textEl.setSelectionRange(0, 0);
    } catch (_) {}
  }

  async function blobForXShare(blob, { format = "mp4", quality = "ultra", audio = true, onProgress } = {}) {
    if (!isShareBlob(blob)) return null;
    const fmt = SHARE_FORMATS.includes(String(format || "").toLowerCase()) ? String(format).toLowerCase() : "mp4";
    const plan = xShareExportPlan(blob.type, fmt);
    if (!plan.convert && audio) return blob;
    return convertViaApi(blob, plan.format, {
      intent: "x",
      quality,
      audio: plan.format === "gif" ? false : audio,
      onProgress,
    });
  }

  async function shareVideoViaWebShare(blob, text) {
    if (!blob || typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
    try {
      const type = String(blob.type || "").toLowerCase();
      const ext = type.includes("mp4") || type.includes("m4v")
        ? "mp4"
        : type.includes("quicktime")
          ? "mov"
          : "mp4";
      const file = new File([blob], `render3d-video.${ext}`, {
        type: blob.type || (ext === "mov" ? "video/quicktime" : "video/mp4"),
      });
      const shareText = normalizeXShareCaption(text);
      const payload = { files: [file], text: shareText, title: "Render Studio" };
      if (navigator.canShare && !navigator.canShare(payload)) return false;
      await navigator.share(payload);
      return true;
    } catch (err) {
      if (String(err?.name || "") === "AbortError") return true;
      return false;
    }
  }

  let xComposeOpened = false;

  function openXComposeOnce(text, tab = null) {
    if (xComposeOpened) return "";
    xComposeOpened = true;
    return openXCompose(text, tab);
  }

  function stageLabelForProgress(stage, format = "mp4") {
    const kind = String(format || "mp4").toUpperCase();
    if (stage === "upload") return { title: `Uploading ${kind}…`, body: "Sending your clip to encode." };
    if (stage === "encode") return { title: `Encoding ${kind}…`, body: "Export is running — X stays closed until this finishes." };
    if (stage === "download") return { title: `Finishing ${kind}…`, body: "Receiving the exported clip." };
    return { title: `Preparing ${kind}…`, body: "Exporting your clip. X will open when the file is ready." };
  }

  async function shareViaComposeAttach(blob, text, { composeTab = null, format = "mp4", quality = "ultra", audio = true } = {}) {
    if (!isShareBlob(blob)) throw new Error("Nothing to post yet.");
    const report = (event = {}) => {
      const label = stageLabelForProgress(event.stage, format);
      showXPrepPopup({ ...label, spinning: true, dismissible: false, percent: convertProgressPercent(event) });
    };
    report({ stage: "upload", percent: 0 });
    const xBlob = await blobForXShare(blob, { format, quality, audio, onProgress: report });
    if (!isShareBlob(xBlob) || !blobLooksLike(xBlob, format)) {
      throw new Error(`Export did not return a ${format.toUpperCase()} file.`);
    }
    downloadShareBlob(xBlob);
    await waitShareDownloadTick();
    openXComposeOnce(text, composeTab);
    const isMp4 = format === "mp4";
    showXPrepPopup({
      title: isMp4 ? "MP4 ready — drag it onto X" : "Clip ready — drag it onto X",
      body: isMp4
        ? "X compose is open with your caption. Your MP4 just downloaded — drag and drop that video into the X post."
        : "X compose is open with your caption. Your clip just downloaded — drag and drop that video into the X post.",
      spinning: false,
      dismissible: true,
      percent: 100,
    });
    setShareStatus(
      isMp4
        ? "MP4 downloaded — drag and drop the video onto X."
        : "Clip downloaded — drag and drop the video onto X.",
    );
    setStatus(true, "Opened X compose — drag and drop the downloaded video onto X.");
    return false;
  }

  async function postToX() {
    xComposeOpened = false;
    xShareInPlace = false;
    showXCaptionPopup();
  }

  async function shareBlobToX(blob, { inPlace = false, skipCaption = false } = {}) {
    xShareInPlace = !!inPlace;
    if (isShareBlob(blob)) {
      pendingXShareBlob = blob;
      lastBlob = blob;
    } else if (typeof blob === "string") {
      const material = await materializeShareBlob(blob);
      if (isShareBlob(material)) {
        pendingXShareBlob = material;
        lastBlob = material;
      }
    }
    // Stop recording and in-place share open the popup. Only skipCaption
    // (explicit "just post") downloads and opens X without asking.
    if (skipCaption) {
      await confirmShareToX({ skipCaption: !!skipCaption });
      return;
    }
    showXCaptionPopup();
  }

  async function confirmShareToX(opts = {}) {
    const text = normalizeXShareCaption(
      opts.skipCaption ? "" : shareModalEl?.querySelector("[data-video-share-text]")?.value,
    );
    const format = selectedShareFormat();
    const quality = selectedShareQuality();
    persistShareExportPrefs({ shareFormat: format, quality });
    xComposeOpened = false;
    const composeTab = reserveXComposeTab();
    setShareXBusy(true, { title: "Downloading clip" });
    try {
      const blob = await resolveShareBlob();
      if (!isShareBlob(blob)) {
        try { composeTab?.close?.(); } catch { /* ignore */ }
        setShareStatus(
          videoEditor?.needsBake?.()
            ? "The edited timeline could not be exported. Nothing was downloaded or opened in X."
            : "Nothing to post yet.",
          true,
        );
        return;
      }
      showXPrepPopup({
        title: "Downloading clip",
        body: "Downloading your clip. X stays closed until the file is ready.",
        spinning: true,
        percent: 100,
      });
      await shareViaComposeAttach(blob, text, {
        composeTab,
        format,
        quality,
        audio: xShareSheet.keepAudio,
      });
      hideXCaptionPopup();
    } catch (err) {
      try { composeTab?.close?.(); } catch { /* ignore */ }
      hideXPrepPopup();
      setShareStatus(err?.message || "Could not share to X.", true);
    } finally {
      pendingXShareBlob = null;
      xShareInPlace = false;
      setShareXBusy(false);
    }
  }

  function isVideoEditorRefFolder(folder) {
    const raw = String(folder || "");
    return raw === "Video Editor" || raw.startsWith("Video Editor/");
  }

  function setClipEditorView(view) {
    const home = view === "home";
    shareModalEl?.classList.toggle("is-home", home);
    shareModalEl?.classList.toggle("is-studio", !home);
    shareModalEl?.querySelector("[data-clip-home]")?.classList.toggle("hidden", !home);
    shareModalEl?.querySelector("[data-clip-studio]")?.classList.toggle("hidden", home);
    if (!home) refreshClipHistoryPanel();
  }

  function closeClipMenus() {
    shareModalEl?.querySelector("[data-video-share-menu]")?.classList.add("hidden");
    shareModalEl?.querySelector("[data-video-share-menu]")?.setAttribute("hidden", "");
    shareModalEl?.querySelector("[data-video-ctx]")?.remove();
  }

  function showClipCardMenu(card, x, y) {
    closeClipMenus();
    const name = card?.querySelector("[data-video-open-project]")?.getAttribute("data-video-open-project") || "";
    const pop = document.createElement("div");
    pop.className = "clip-editor-ctx";
    pop.dataset.videoCtx = "";
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 220, x))}px`;
    pop.style.top = `${Math.max(8, Math.min(window.innerHeight - 240, y))}px`;
    pop.innerHTML = `
      <button type="button" data-ctx="open">Open</button>
      <button type="button" data-ctx="share">Share</button>
      <button type="button" data-ctx="invite">Invite</button>
      <button type="button" data-ctx="thumb">Re-upload profile picture</button>
      <button type="button" data-ctx="settings">Project settings</button>
      <button type="button" data-ctx="delete">Delete</button>
    `;
    document.body.appendChild(pop);
    const done = () => pop.remove();
    pop.addEventListener("click", (ev) => {
      const act = ev.target.closest("[data-ctx]")?.getAttribute("data-ctx");
      if (!act) return;
      ev.preventDefault();
      done();
      if (act === "open") void openEditorProject(name);
      if (act === "share") void shareEditorProject(name, "view");
      if (act === "invite" || act === "settings") void openEditorProjectSettings(name);
      if (act === "thumb") void pickEditorThumb(name);
      if (act === "delete") void confirmDeleteEditorProject(name);
    });
    window.setTimeout(() => {
      const hide = (ev) => {
        if (pop.contains(ev.target)) return;
        done();
        window.removeEventListener("pointerdown", hide, true);
      };
      window.addEventListener("pointerdown", hide, true);
    }, 0);
  }

  async function shareEditorProject(name, mode = "view") {
    const pid = getProjectId?.();
    const projects = await fetchVideoEditorProjects();
    const row = projects.find((p) => p.name === name) || {};
    const file = (row.files || []).find((f) => f.kind === "video") || (row.files || [])[0];
    if (!pid || !file?.filename) {
      try { onShareProject?.(); } catch (_) {}
      setShareStatus("Share the CAD project, or add a clip first.", true);
      return;
    }
    try {
      const { createShareRecord } = await import("../components/file-actions.js?v=20260909-sharefast1-20260909-remix1-fusionfolder1-sharechat1-shareperm1-20260914-vrshare1-20260915-lightgear1-20260915-vidshare1-20260915-nativejoints1-20260916-shareui1&leakfix6&leakfix81&leakfix82");
      const data = await createShareRecord(pid, file.filename, null, { share_mode: mode });
      const url = data?.share_url;
      if (url && navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      markShareLinkCopied(!!url);
      setShareStatus("");
    } catch (err) {
      markShareLinkCopied(false);
      setShareStatus(err?.message || "Could not create share link.", true);
    }
  }

  function markShareLinkCopied(ok) {
    const wrap = shareModalEl?.querySelector("[data-video-project-share-wrap]");
    const mark = shareModalEl?.querySelector("[data-video-share-copied]");
    const label = shareModalEl?.querySelector("[data-video-share-link-label]");
    wrap?.classList.toggle("is-copied", !!ok);
    if (mark) mark.hidden = !ok;
    if (label) label.textContent = ok ? "Copied" : "Share link";
    if (ok) {
      window.clearTimeout(shareModalEl?._shareCopiedTimer);
      if (shareModalEl) {
        shareModalEl._shareCopiedTimer = window.setTimeout(() => {
          wrap?.classList.remove("is-copied");
          if (mark) mark.hidden = true;
          if (label) label.textContent = "Share link";
        }, 2200);
      }
    }
  }

  async function shareCurrentVideoProject(mode) {
    await shareEditorProject(editorProjectName, mode);
  }

  function refreshClipHistoryPanel() {
    const host = shareModalEl?.querySelector("[data-clip-history-list]");
    if (!host) return;
    const showComments = shareModalEl.querySelector('[data-hist-toggle="comments"]')?.checked !== false;
    const showPrompts = shareModalEl.querySelector('[data-hist-toggle="prompts"]')?.checked !== false;
    const lines = [];
    if (showPrompts) {
      const prompt = String(shareModalEl.querySelector("[data-vtl-prompt]")?.value || "").trim();
      if (prompt) lines.push(`Prompt: ${prompt}`);
    }
    const comments = Array.isArray(shareModalEl._clipComments) ? shareModalEl._clipComments : [];
    if (showComments) {
      for (const row of comments) lines.push(`${row.author_name || "Guest"} @ ${Number(row.t || 0).toFixed(1)}s — ${row.text}`);
    }
    host.textContent = lines.join(" · ") || "";
    host.classList.toggle("hidden", !lines.length);
    const canDownload = true;
    shareModalEl.querySelector("[data-hist-download]")?.toggleAttribute("hidden", !canDownload);
  }

  async function pickEditorThumb(name) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/webp,image/png";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const dataUrl = await compressThumbFile(file);
      await uploadEditorThumb(name, dataUrl);
      await refreshVideoLibrary();
    });
    input.click();
  }

  function compressThumbFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 160;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read image"));
      };
      img.src = url;
    });
  }

  async function captureClipThumb(blob) {
    if (!blob) return "";
    let url = "";
    let video = null;
    try {
      url = URL.createObjectURL(blob);
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = url;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1800);
        video.onloadeddata = () => { clearTimeout(timer); resolve(); };
        video.onerror = () => { clearTimeout(timer); resolve(); };
      });
      if (!video.videoWidth) return "";
      try { video.currentTime = Math.min(0.2, (video.duration || 1) * 0.05); } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 80));
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      canvas.getContext("2d").drawImage(video, 0, 0, 160, 90);
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return "";
    } finally {
      try { video?.pause(); video?.removeAttribute("src"); video?.load(); } catch (_) {}
      if (url) URL.revokeObjectURL(url);
    }
  }

  async function uploadEditorThumb(name, dataUrl) {
    const pid = getProjectId?.();
    if (!pid || !name || !dataUrl) return;
    try {
      await fetch(`/api/projects/${encodeURIComponent(pid)}/video-editor/thumb`, {
        method: "POST",
        headers: editorAuthHeaders(),
        body: JSON.stringify({ name, image: dataUrl }),
      });
    } catch (_) {}
  }

  function syncPreviewVisibility() {
    const wrap = shareModalEl?.querySelector("[data-video-preview-wrap]");
    const preview = shareModalEl?.querySelector(".viewport-video-share-preview");
    const studio = !!(shareModalEl?.classList.contains("is-studio") && !shareModalEl?.classList.contains("is-sheet-only"));
    const hasSrc = !!(preview?.currentSrc || preview?.getAttribute("src"));
    wrap?.classList.toggle("hidden", studio ? false : !hasSrc);
  }

  async function showClipHome() {
    const modal = ensureShareModal();
    modal.querySelector("[data-video-share-sheet]")?.classList.add("hidden");
    modal.querySelector("[data-clip-settings]")?.remove();
    setClipEditorView("home");
    upsertClipEditorTab("Video Editor");
    await refreshVideoLibrary();
    writeEditorSession({ name: "Video Editor", view: "home" });
    modal.classList.remove("hidden");
  }

  function renderVideoLibrary(items = []) {
    const rail = shareModalEl?.querySelector("[data-video-library-rail]");
    const empty = shareModalEl?.querySelector("[data-video-library-empty]");
    if (!rail) return;
    const list = Array.isArray(items) ? items : [];
    empty?.toggleAttribute("hidden", list.length > 0);
    rail.innerHTML = list.map((item) => {
      const name = String(item.name || item.label || "Untitled");
      const safe = name.replace(/"/g, "&quot;");
      const generating = shareModalEl?.dataset?.filmGenerating === name;
      const thumb = item.thumb_url
        ? `<img class="clip-editor-grid-thumb" src="${String(item.thumb_url).replace(/"/g, "&quot;")}" alt="" />`
        : `<span class="clip-editor-grid-thumb" aria-hidden="true">▶</span>`;
      const gen = generating
        ? `<span class="clip-editor-gen-badge" title="Generating film edit"><span class="vtl-spin" aria-hidden="true"></span><svg class="clip-editor-gen-video" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.4" y="3.2" width="13.2" height="9.6" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="currentColor" d="M6.2 6.1 10.4 8 6.2 9.9z"/></svg></span>`
        : "";
      return `<div class="clip-editor-grid-item${generating ? " is-generating" : ""}" role="listitem">
        <button type="button" class="clip-editor-grid-open" data-video-open-project="${safe}">
          ${thumb}${gen}
          <strong>${name.replace(/</g, "&lt;")}</strong>
        </button>
        <div class="clip-editor-grid-menu">
          <button type="button" data-video-delete="${safe}">Delete</button>
          <button type="button" data-video-share-project="${safe}">Share project</button>
          <button type="button" data-video-settings="${safe}">Project settings</button>
        </div>
      </div>`;
    }).join("");
  }

  async function refreshVideoLibrary() {
    try {
      const projects = await fetchVideoEditorProjects();
      renderVideoLibrary(projects);
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (shareModalEl?.querySelector(".clip-editor-grid-item")) return;
      renderVideoLibrary([]);
    }
  }

  async function startNewFilm() {
    ensureShareModal();
    lastBlob = null;
    sourceBlob = null;
    editorTimelineDraft = null;
    await videoEditor?.setPrimaryClip?.(null);
    let existing = [];
    try {
      existing = (await fetchVideoEditorProjects()).map((p) => p.name);
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
    const name = randomVideoEditorProjectName(existing);
    const saved = await persistVideoEditorProject(name, { unique: true });
    const finalName = saved?.name || name;
    syncEditorTitle(finalName);
    const preview = shareModalEl?.querySelector(".viewport-video-share-preview");
    if (preview) {
      preview.removeAttribute("src");
      preview.load?.();
    }
    syncPreviewVisibility();
    setClipEditorView("studio");
    upsertClipEditorTab(finalName);
    writeEditorSession({ name: finalName, view: "studio", timeline: { v: 1, clips: [], music: null } });
    setShareStatus("");
    shareModalEl?.classList.remove("hidden");
    void refreshVideoLibrary();
  }

  let recordingEditorLock = "";

  async function openRecordingInEditor(entry, { addStill = false } = {}) {
    const filename = normalizeVideoEditorSourcePath(
      entry?.source_path || entry?.filename || entry?.name || "",
    );
    const lock = videoEditorOpenLockKey({ ...entry, filename }, { addStill });
    if (recordingEditorLock === lock) return null;
    recordingEditorLock = lock;
    try {
      const folder = String(entry?.folder || "");
      if (entry?.virtual_folder && isVideoEditorFolderKey(folder) && videoEditorProjectNameFromFolder(folder)) {
        await openEditorProject(videoEditorProjectNameFromFolder(folder) || entry.name);
        return { reused: true, name: entry.name };
      }
      const projectName = videoEditorProjectNameFromSource(filename, entry?.label);
      const ref = filename ? videoEditorSourceRefFromPath(filename, { kind: addStill ? "image" : "video" }) : null;
      ensureShareModal();
      syncEditorTitle(projectName);
      setClipEditorView("studio");
      shareModalEl?.classList.remove("hidden");
      upsertClipEditorTab(projectName);
      const already = findClipBySourceKey(videoEditor?.getClips?.() || [], { sourcePath: filename, filename });
      const preview = shareModalEl?.querySelector(".viewport-video-share-preview");
      if (already && !addStill) {
        preview?.classList.remove("is-loading");
        videoEditor?.setTimelineLoading?.(false);
        setShareStatus(`Loaded “${projectName}” on V.`);
        syncPreviewVisibility();
        return { reused: true, name: projectName, path_ref: true };
      }
      videoEditor?.setTimelineLoading?.(true, TIMELINE_CLIP_LOADING_STATUS);
      setShareStatus(TIMELINE_CLIP_LOADING_STATUS);
      if (ref) {
        void persistVideoEditorSourceRefs(projectName, { sources: [ref], refresh: false });
      }
      // Private file URLs cannot authenticate a <video src>. Load the file
      // with the project's authenticated fetch, then play its local blob.
      const blob = entry?.blob || (filename && fetchProjectVideo
        ? await fetchProjectVideo({ filename, name: filename, label: entry?.label || filename })
        : null);
      if (!blob) {
        videoEditor?.setTimelineLoading?.(false);
        preview?.classList.remove("is-loading");
        throw new Error("Could not load that file.");
      }
      if (addStill) {
        await videoEditor?.addStill?.({ blob, name: filename || entry?.label || "Still" });
        videoEditor?.setTimelineLoading?.(false);
        return { reused: true, name: projectName, path_ref: true };
      }
      await openShareModal(blob, {
        label: projectName,
        source: "library",
        sourcePath: filename,
        folder: videoEditorFolderKey(projectName),
        keepSequence: false,
      });
      return { reused: true, name: projectName, path_ref: !!filename };
    } catch (err) {
      videoEditor?.setTimelineLoading?.(false);
      shareModalEl?.querySelector(".viewport-video-share-preview")?.classList.remove("is-loading");
      throw err;
    } finally {
      recordingEditorLock = "";
    }
  }

  async function openEditorProject(name) {
    if (!name) return;
    restoringEditorProject = name;
    ensureShareModal();
    lastBlob = null;
    sourceBlob = null;
    await videoEditor?.setPrimaryClip?.(null);
    syncEditorTitle(name);
    setClipEditorView("studio");
    shareModalEl?.classList.remove("hidden");
    videoEditor?.setTimelineLoading?.(true, TIMELINE_CLIP_LOADING_STATUS);
    setShareStatus(TIMELINE_CLIP_LOADING_STATUS);
    let projects = [];
    try {
      projects = await fetchVideoEditorProjects();
    } catch (err) {
      if (err?.name === "AbortError") return;
      projects = [];
    }
    const row = projects.find((p) => p.name === name) || {};
    const session = readEditorSession();
    const draft = row.timeline && typeof row.timeline === "object"
      ? row.timeline
      : (session?.name === name ? session.timeline : null);
    const musicSnap = draft?.music || null;
    editorTimelineDraft = draft;
    if (draft?.filmHistory) videoEditor?.applyFilmHistoryMeta?.(draft.filmHistory);
    restoringEditorProject = name;
    const caption = String(row.caption || "").trim();
    const text = shareModalEl.querySelector("[data-video-share-text]");
    if (text && caption) text.value = caption;
    const files = Array.isArray(row.files) ? row.files : [];
    const videos = files.filter((f) => f.kind === "video" || /\.(webm|mp4|mov|m4v)$/i.test(f.filename || f.name || ""));
    const stills = files.filter((f) => f.kind === "image" || /\.(png|jpe?g|webp|gif)$/i.test(f.filename || f.name || ""));
    const audios = files.filter((f) => f.kind === "audio" || /\.(mp3|wav|m4a|aac|ogg|opus|flac|aiff?|wma|weba)$/i.test(f.filename || f.name || ""));
    const loadFirst = videos[0] || stills[0];
    if (loadFirst?.filename && fetchProjectVideo) {
      try {
        setShareStatus(`Opening ${name}…`);
        const blob = await fetchProjectVideo({ filename: loadFirst.filename, name: loadFirst.filename, label: name });
        lastBlob = blob;
        sourceBlob = blob;
        await videoEditor?.setPrimaryClip?.(blob, {
          label: name,
          source: "library",
          sourcePath: loadFirst.filename,
        });
        videoEditor?.restoreTimelineDraft?.(draft);
        if (caption) videoEditor?.setClipLabel?.(caption);
        const preview = shareModalEl?.querySelector(".viewport-video-share-preview");
        if (preview?.readyState >= 1) preview.classList.remove("is-loading");
        // The first playable clip is ready now. Fetch the rest concurrently so
        // a large second recording does not hold the editor open state hostage.
        setShareStatus(`Loaded “${name}” on V. Loading remaining media…`);
        const seenVideo = new Set();
        const extraLoads = videos.map(async (extra) => {
          const extraPath = extra.filename || extra.source_path || extra.name || "";
          const extraKey = clipSourceIdentityKey({ sourcePath: extraPath, filename: extraPath });
          if (extraKey && seenVideo.has(extraKey)) return { skip: true };
          if (extraKey) seenVideo.add(extraKey);
          if (extra === loadFirst) return { skip: true };
          if (findClipBySourceKey(videoEditor?.getClips?.() || [], { sourcePath: extraPath, filename: extraPath })) {
            return { skip: true };
          }
          try {
            const extraBlob = await fetchProjectVideo({ filename: extra.filename, name: extra.filename });
            return { extra, extraBlob, extraPath };
          } catch (_) { return null; }
        });
        const stillLoads = stills.map(async (still) => {
          try {
            const stillBlob = await fetchProjectVideo({ filename: still.filename, name: still.filename });
            await videoEditor?.addStill?.({ blob: stillBlob, name: still.name });
          } catch (_) {}
        });
        const extraReady = Promise.all(extraLoads).then(async (loaded) => {
          let missing = 0;
          for (const item of loaded) {
            if (!item) { missing += 1; continue; }
            if (item.skip) continue;
            if (editorProjectName !== name) continue;
            try {
              await videoEditor?.addClip?.({
                blob: item.extraBlob, source: "library",
                label: item.extra.name || name, sourcePath: item.extraPath,
              });
            } catch (_) { missing += 1; }
          }
          return missing;
        });
        void Promise.all([extraReady, ...stillLoads]).then(([missing]) => {
          if (editorProjectName === name) videoEditor?.restoreTimelineDraft?.(draft);
          if (editorProjectName === name) setShareStatus(missing
            ? `Loaded “${name}” with ${missing} clip${missing === 1 ? "" : "s"} unavailable.`
            : `Loaded “${name}” on V.`);
        });
        if (!row.thumb_url && blob) {
          void captureClipThumb(blob).then((thumb) => {
            if (thumb) void uploadEditorThumb(name, thumb);
          });
        }
      } catch (err) {
        videoEditor?.setTimelineLoading?.(false);
        setShareStatus(err?.message || "Could not load that clip.", true);
      }
    } else {
      videoEditor?.setTimelineLoading?.(false);
    }
    if (audios.length || musicSnap) {
      await restoreEditorMusic({ audios, folder: row.folder, snap: musicSnap });
    }
    syncPreviewVisibility();
    setClipEditorView("studio");
    upsertClipEditorTab(name);
    writeEditorSession({ name, view: "studio", timeline: draft });
    setShareStatus(loadFirst ? `Loaded “${name}” on V.` : "Timeline — drop audio, photos, or video.");
    shareModalEl?.classList.remove("hidden");
    refreshClipHistoryPanel();
    restoringEditorProject = "";
  }

  async function restoreEditorMusic({ audios = [], folder = "", snap = null } = {}) {
    const listed = Array.isArray(audios) ? audios : [];
    const needle = snap?.filename || snap?.name || "";
    const matched = matchListedMediaFile(listed, needle) || listed[0] || null;
    let named = null;
    if (matched?.filename && fetchProjectVideo) {
      try {
        const audioBlob = await fetchProjectVideo({ filename: matched.filename, name: matched.filename });
        if (audioBlob) {
          named = typeof File !== "undefined"
            ? new File([audioBlob], matched.name || mediaFileBasename(matched.filename) || "audio.mp3", {
              type: audioBlob.type || "audio/mpeg",
            })
            : audioBlob;
        }
      } catch (_) {}
    }
    if (!named && snap?.persistKey) {
      named = await readCachedEditorMedia(snap.persistKey);
    }
    if (!named) return;
    const opts = {
      persist: false,
      folder: folder || "",
      ...applyMusicSnapshotOpts(snap || {}),
      filename: matched?.filename || snap?.filename || named.name,
    };
    videoEditor?.setMusicFromFile?.(named, opts);
  }

  async function confirmDeleteEditorProject(name) {
    if (!name) return;
    if (!window.confirm(`Delete “${name}” from Video Editor?`)) return;
    const ok = await deleteVideoEditorProject(name);
    setShareStatus(ok ? `Deleted “${name}”.` : "Could not delete that project.", !ok);
    await refreshVideoLibrary();
  }

  async function openEditorProjectSettings(name) {
    ensureShareModal();
    let invited = [];
    try {
      const pid = getProjectId?.();
      if (pid && api) {
        const data = await api(`/api/projects/${encodeURIComponent(pid)}/shares`);
        invited = [
          ...(data.shares || []).map((s) => s.display_name || s.email),
          ...(data.pending || []).map((p) => `${p.email} (pending)`),
        ];
      }
    } catch (_) {}
    const projects = await fetchVideoEditorProjects();
    const row = projects.find((p) => p.name === name) || {};
    const editors = (row.editors || []).map((e) => e.display_name || e.email || "Editor");
    const existing = shareModalEl.querySelector("[data-clip-settings]");
    existing?.remove();
    const pop = document.createElement("div");
    pop.className = "clip-editor-settings";
    pop.dataset.clipSettings = "";
    pop.innerHTML = `
      <div class="clip-editor-settings-card">
        <strong>Project settings</strong>
        <p class="muted small">${String(name || "").replace(/</g, "&lt;")}</p>
        <p class="muted small"><span>Invited</span><br>${invited.length ? invited.map((n) => String(n).replace(/</g, "&lt;")).join("<br>") : "Only you so far."}</p>
        <p class="muted small"><span>Edited video</span><br>${editors.length ? editors.map((n) => String(n).replace(/</g, "&lt;")).join("<br>") : "No edits yet."}</p>
        <label class="muted small">Invite to edit
          <input type="email" data-clip-invite-email placeholder="email@example.com" />
        </label>
        <button type="button" class="btn secondary small" data-clip-invite>Send invite</button>
        <button type="button" class="btn secondary small" data-clip-thumb>Re-upload profile picture</button>
        <button type="button" class="btn secondary small" data-clip-settings-close>Close</button>
      </div>`;
    shareModalEl.querySelector("[data-clip-home]")?.appendChild(pop);
    pop.querySelector("[data-clip-settings-close]")?.addEventListener("click", () => pop.remove());
    pop.querySelector("[data-clip-thumb]")?.addEventListener("click", () => {
      pop.remove();
      void pickEditorThumb(name);
    });
    pop.querySelector("[data-clip-invite]")?.addEventListener("click", async () => {
      const email = String(pop.querySelector("[data-clip-invite-email]")?.value || "").trim();
      const pid = getProjectId?.();
      if (!email || !pid || !api) return;
      try {
        await api(`/api/projects/${encodeURIComponent(pid)}/shares`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, role: "editor" }),
        });
        setShareStatus(`Invited ${email} to edit.`);
        pop.remove();
      } catch (err) {
        setShareStatus(err?.message || "Could not invite.", true);
      }
    });
  }

  async function openLibraryClip(filename, label) {
    if (!filename || !fetchProjectVideo) return;
    try {
      setShareStatus(`Opening ${label || filename}…`);
      const blob = await fetchProjectVideo({ filename, name: filename, label });
      await openShareModal(blob, { label: label || filename.replace(/\.[^.]+$/, ""), source: "library" });
    } catch (err) {
      setShareStatus(err?.message || "Could not open that clip.", true);
    }
  }

  function closeShareModal() {
    if (videoEditorListAbort) {
      try { videoEditorListAbort.abort(); } catch (_) { /* ignore */ }
    }
    finishXPinPrompt(false);
    hideXPrepPopup();
    hideXCaptionPopup();
    if (editorAutosaveTimer) {
      window.clearTimeout(editorAutosaveTimer);
      editorAutosaveTimer = 0;
    }
    try { videoEditor?.park?.(); } catch (_) { /* ignore */ }
    revokeTrackedObjectUrls(sharePreviewCreated);
    revokeTrackedObjectUrls(downloadCreated);
    revokeXShareSheetUrls(); // leakfix25
    const sharePreview = shareModalEl?.querySelector(".viewport-video-share-preview");
    if (sharePreview) delete sharePreview.dataset.objectUrl;
    pauseAndDetachMedia(shareModalEl?.querySelector(".viewport-video-share-preview"));
    shareModalEl?.classList.add("hidden");
    closeClipEditorTab();
  }

  async function openEditorTab(opts = {}) {
    const modal = ensureShareModal();
    if (opts.newProject) {
      await startNewFilm();
    } else if (opts.blob) {
      await openShareModal(opts.blob, opts);
      await refreshVideoLibrary();
      return modal;
    } else {
      const session = readEditorSession();
      if (session?.view === "studio" && session.name && session.name !== "Video Editor") {
        await openEditorProject(session.name);
      } else {
        await showClipHome();
      }
    }
    modal.classList.remove("hidden");
    return modal;
  }

  async function restoreLastEditorSession() {
    const hasWork = !!(videoEditor?.getMusicTrack?.() || (videoEditor?.getClips?.() || []).length);
    if (hasWork) return;
    const session = readEditorSession();
    if (session?.view === "studio" && session.name) {
      await openEditorProject(session.name);
    }
  }

  async function openShareModal(blob, opts = {}) {
    const append = appendNextViewportTake;
    appendNextViewportTake = false;
    const keepSequence = !!opts.keepSequence || !!opts.preserveEditor || !!opts.autoPost;
    sourceBlob = blob || sourceBlob || lastBlob || pendingDesktopClip;
    lastBlob = blob || lastBlob || pendingDesktopClip;
    pendingDesktopClip = lastBlob;
    const modal = ensureShareModal();
    const sourcePath = normalizeVideoEditorSourcePath(
      opts.sourcePath || opts.source_path || lastCaptureMeta?.saved?.filename || opts.filename || "",
    );
    if (blob && !keepSequence) {
      const name = defaultVideoEditorProjectName({
        label: opts.label,
        source: opts.source || "viewport",
      });
      syncEditorTitle(name);
      if (sourcePath) {
        void persistVideoEditorSourceRefs(name, {
          sources: [videoEditorSourceRefFromPath(sourcePath, { kind: "video" })],
          refresh: false,
        });
      } else if (opts.source !== "upload" && opts.source !== "library" && !opts.saved) {
        void saveClipToProject(blob, {
          kind: "video",
          ...lastCaptureMeta,
          ...opts,
          folder: "Screen Recordings",
        }).then((saved) => {
          const path = normalizeVideoEditorSourcePath(saved?.filename || "");
          if (path) {
            void persistVideoEditorSourceRefs(name, {
              sources: [videoEditorSourceRefFromPath(path, { kind: "video" })],
              refresh: false,
            });
          }
        });
      }
    }
    // Close screenshot markup if it somehow opened — video studio only
    try {
      document.getElementById("screenshot-markup-modal")?.classList.add("hidden");
    } catch (_) {}
    if (blob && !keepSequence) {
      const already = findClipBySourceKey(videoEditor?.getClips?.() || [], { sourcePath, filename: sourcePath });
      if (already && !append) {
        videoEditor?.setTimelineLoading?.(false);
      } else if (append && videoEditor?.addClip) {
        await videoEditor.addClip({
          blob,
          source: "viewport",
          label: opts.label || `3D take ${(videoEditor.getClips?.() || []).filter((c) => c.source === "viewport").length + 1}`,
          sourcePath: sourcePath || "",
        });
      } else {
        await videoEditor?.setPrimaryClip?.(blob, {
          label: opts.label || "3D viewport",
          source: opts.source || "viewport",
          sourcePath: sourcePath || "",
        });
      }
    }
    const preview = modal.querySelector(".viewport-video-share-preview");
    if (preview && blob && !append && !keepSequence) {
      const existingSrc = preview.currentSrc || preview.getAttribute("src") || "";
      if (existingSrc && !existingSrc.startsWith("blob:")) {
        preview.classList.remove("is-loading");
      } else {
        preview.classList.add("is-loading");
        preview.removeAttribute("poster");
        preview.pause?.();
        const reveal = () => {
          preview.classList.remove("is-loading");
          try {
            if (Number.isFinite(preview.duration) && preview.duration > 0.12) {
              preview.currentTime = Math.min(0.12, preview.duration * 0.05);
            }
          } catch (_) {}
        };
        preview.onloadeddata = reveal;
        preview.onloadedmetadata = reveal;
        preview.onerror = reveal;
        if (preview.readyState >= 1) reveal();
        setTimeout(reveal, TIMELINE_LOADING_MAX_MS);
        preview.muted = true;
        preview.defaultMuted = true;
        preview.setAttribute("muted", "");
        preview.playsInline = true;
        preview.setAttribute("playsinline", "");
        const unmutePreview = () => {
          preview.defaultMuted = false;
          preview.muted = false;
          preview.removeAttribute("muted");
          if (!(preview.volume > 0)) preview.volume = 1;
        };
        const kick = preview.play?.();
        if (kick && typeof kick.then === "function") {
          kick.then(() => {
            try { preview.pause(); } catch (_) {}
            unmutePreview();
            reveal();
          }).catch(() => {
            unmutePreview();
            reveal();
          });
        } else {
          unmutePreview();
        }
      }
    }
    const text = modal.querySelector("[data-video-share-text]");
    const captionNow = String(text?.value || "").trim();
    if (text && (
      !captionNow
      || captionNow === X_SHARE_ATTRIBUTION
      || captionNow === X_SHARE_ATTRIBUTION_LINE
      || captionNow === `${X_SHARE_ATTRIBUTION}\n${X_SHARE_SITE}`
    )) {
      text.value = X_SHARE_DEFAULT;
    }
    shareModalEl?.querySelector("[data-video-share-sheet]")?.classList.add("hidden");
    if (!keepSequence) {
      syncPreviewVisibility();
      setClipEditorView("studio");
      setShareStatus(append ? "3D take added." : "");
      try { videoEditor?.syncAssembleAvailability?.(); } catch (_) {}
      modal.classList.remove("hidden");
      upsertClipEditorTab(editorProjectName || opts.label || "Editor");
      await refreshVideoLibrary();
    }
    await refreshXStatus();
    if (opts.autoPost) {
      xShareInPlace = true;
      if (blob) pendingXShareBlob = blob;
      setShareStatus("Downloading clip — X opens when the file is ready.");
      await postToX();
    }
  }

  function stopPovCompositeLoop() {
    if (povRafId) {
      try { cancelAnimationFrame(povRafId); } catch (_) {}
      povRafId = 0;
    }
  }

  function cleanupStreams() {
    stopPovCompositeLoop();
    try {
      mixedStream?.getTracks?.().forEach((t) => t.stop());
    } catch (_) {}
    try {
      micStream?.getTracks?.().forEach((t) => t.stop());
    } catch (_) {}
    try {
      povCameraStream?.getTracks?.().forEach((t) => t.stop());
    } catch (_) {}
    try {
      if (povVideoEl) {
        povVideoEl.pause?.();
        povVideoEl.srcObject = null;
      }
    } catch (_) {}
    try {
      povCompositeCanvas?.remove?.();
    } catch (_) {}
    mixedStream = null;
    micStream = null;
    povCameraStream = null;
    povVideoEl = null;
    povCompositeCanvas = null;
    povCompositeCtx = null;
    povCaptureTrack = null;
    displayCaptureTrack = null;
    usedXrPov = false;
  }

  function isXrVrSession() {
    const mode = String(getXrSessionMode?.() || "").toLowerCase();
    if (mode.includes("immersive-vr")) return true;
    if (mode.includes("immersive-ar")) return false;
    return String(getXrModeLabel?.() || "").toUpperCase() === "VR";
  }

  function paintPovCompositeFrame() {
    if (!povCompositeCtx || !povCompositeCanvas) return false;
    const outW = povCompositeCanvas.width || 960;
    const outH = povCompositeCanvas.height || 540;
    const ctx = povCompositeCtx;
    const havePassthrough = !!(povVideoEl && povVideoEl.readyState >= 2);
    const presenting = !!isXrPresenting?.();
    ctx.fillStyle = havePassthrough ? "#0f172a" : "#e7e5e4";
    ctx.fillRect(0, 0, outW, outH);

    // Headset world camera when the compositor passthrough cannot be copied.
    if (havePassthrough) {
      drawCoverImage(ctx, povVideoEl, outW, outH);
    }

    let overlay = null;
    if (presenting) {
      try { overlay = getXrOverlayCanvas?.() || null; } catch (_) { overlay = null; }
    }
    if (overlay) {
      try { ctx.drawImage(overlay, 0, 0, outW, outH); } catch (_) {}
    } else if (shouldBlitXrDomCanvasWhilePresenting({ presenting })) {
      const glCanvas = getCanvas?.();
      if (glCanvas) {
        const { sx, sy, sw, sh } = xrOverlaySourceRect(glCanvas);
        try {
          ctx.drawImage(glCanvas, sx, sy, sw, sh, 0, 0, outW, outH);
        } catch (_) {}
      }
    }

    // Push a frame into MediaRecorder (captureStream(0) needs this on Quest)
    try {
      povCaptureTrack?.requestFrame?.();
    } catch (_) {}
    return true;
  }

  /** Called from the Three/XR animation loop — window rAF does not run reliably in immersive XR. */
  let lastXrPaintAt = 0;
  function onXrFrame() {
    if (!recording || !usedXrPov || paused) return;
    const now = performance.now();
    // ~24 fps spectator at 720p — sharp UI text without freezing Quest
    if (now - lastXrPaintAt < 80) return;
    lastXrPaintAt = now;
    paintPovCompositeFrame();
  }

  async function startXrSpectatorOnlyStream(_fps) {
    // VR spectator at 540p so Rec does not stall the headset
    const outW = 960;
    const outH = 540;
    const composite = document.createElement("canvas");
    composite.width = outW;
    composite.height = outH;
    composite.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    try { document.body.appendChild(composite); } catch (_) {}
    povCompositeCanvas = composite;
    povCompositeCtx = composite.getContext("2d", { alpha: false, desynchronized: true });
    if (!povCompositeCtx) throw new Error("Could not create VR spectator canvas.");
    try {
      povCompositeCtx.imageSmoothingEnabled = true;
      povCompositeCtx.imageSmoothingQuality = "high";
    } catch (_) {}
    povVideoEl = null;
    povCameraStream = null;

    const stream = typeof composite.captureStream === "function"
      ? composite.captureStream(0)
      : null;
    if (!stream) throw new Error("Spectator canvas captureStream unavailable.");
    povCaptureTrack = stream.getVideoTracks()?.[0] || null;
    usedXrPov = true;
    lastXrPaintAt = 0;
    // First paint happens on the XR frame *before* headset submit — never here.
    stopPovCompositeLoop();
    return stream;
  }

  async function startXrPovCaptureStream(fps) {
    povCameraStream = await openXrPovCameraStream();
    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.srcObject = povCameraStream;
    povVideoEl = video;
    try {
      await video.play();
    } catch (err) {
      console.warn("[viewport-video] POV video play failed", err);
    }
    if (video.readyState < 2) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        video.addEventListener("loadeddata", finish, { once: true });
        setTimeout(finish, 1000);
      });
    }

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 960;
    // 720p landscape — sharp enough for UI text while keeping Quest stable
    const outH = 720;
    const outW = Math.max(960, Math.round(outH * (vw / Math.max(1, vh))));

    const composite = document.createElement("canvas");
    composite.width = outW;
    composite.height = outH;
    composite.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    try { document.body.appendChild(composite); } catch (_) {}
    povCompositeCanvas = composite;
    povCompositeCtx = composite.getContext("2d", { alpha: false, desynchronized: true });
    if (!povCompositeCtx) throw new Error("Could not create POV composite canvas.");
    try {
      povCompositeCtx.imageSmoothingEnabled = true;
      povCompositeCtx.imageSmoothingQuality = "high";
    } catch (_) {}

    // captureStream(0) + requestFrame is reliable during XR; timed captureStream often yields 0s clips.
    const stream = typeof composite.captureStream === "function"
      ? composite.captureStream(0)
      : null;
    if (!stream) throw new Error("Composite canvas captureStream unavailable.");
    povCaptureTrack = stream.getVideoTracks()?.[0] || null;
    usedXrPov = true;
    lastXrPaintAt = 0;
    // First paint happens on the XR frame *before* headset submit — never here.
    stopPovCompositeLoop();
    return stream;
  }

  /**
   * Capture the Render Studio tab (Full page) or an entire display (Fullscreen).
   */
  async function startPageCaptureStream(fps, { fullscreen = false } = {}) {
    const stream = await openDisplayMediaStream({ fps, fullscreen });
    const track = stream.getVideoTracks()?.[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("No video track from screen capture.");
    }
    try {
      await track.applyConstraints?.({ frameRate: fps });
    } catch (_) {}
    track.addEventListener("ended", () => {
      if (recording) void stopRecording({ silent: false });
    });
    displayCaptureTrack = track;
    try {
      await cropDisplayTrack();
    } catch (_) {}
    return stream;
  }

  function startRecording() {
    if (recordingStartTask) return recordingStartTask;
    if (recording) return Promise.resolve();
    const inXrNow = !!isXrPresenting?.();
    recordingStarting = true;
    const epoch=++recordingStartEpoch;
    const task = (async()=>{
      if(inXrNow){setStatus(true,"Starting recording…");await new Promise(resolve=>setTimeout(resolve,xrRecordStartDeferMs()));}
      if(epoch!==recordingStartEpoch || (inXrNow&&!isXrPresenting?.()))return;
      return startRecordingNow();
    })();
    recordingStartTask=task;
    void task.finally(()=>{if(recordingStartTask===task){recordingStartTask=null;recordingStarting=false;}}).catch(()=>{});
    return task;
  }

  async function startRecordingNow() {
    if (recording) return;
    prefs = readPrefs();
    const fps = Math.min(Number(prefs.fps) || 24, isXrPresenting?.() ? 15 : 60);
    const inXrEarly = !!isXrPresenting?.();
    const inXr = inXrEarly;
    const fullscreenNow = !!document.fullscreenElement;
    const wantDisplay = !inXr && (
      prefs.target === "page"
      || prefs.target === "fullscreen"
      || fullscreenNow
    );
    const wantFullscreen = !inXr && prefs.target === "fullscreen";
    const canvas = getCanvas?.();
    const bitrate = inXr
      ? Math.min(autoBitrate({ quality: prefs.quality, fps, canvas }), 8_000_000)
      : autoBitrate({ quality: prefs.quality, fps, display: wantDisplay, canvas });
    const mimeType = pickMimeType({ xr: inXr });
    usedXrPov = false;
    sessionDisplayCapture = wantDisplay;

    if (!window.MediaRecorder) {
      setStatus(false, "MediaRecorder is not available in this browser.");
      return;
    }

    if (!wantDisplay && (!canvas || typeof canvas.captureStream !== "function")) {
      setStatus(false, "This browser cannot record the viewport canvas.");
      return;
    }

    let canvasStream;
    try {
      if (inXr) {
        const wantPass = shouldOpenXrPassthroughCamera({
          presenting: true,
          passthroughOn: !!getXrPassthroughOn?.(),
          sessionMode: getXrSessionMode?.() || "",
        });
        if (wantPass) {
          try {
            canvasStream = await startXrPovCaptureStream(fps);
            setStatus(true, "Recording headset POV (passthrough + 3D)…");
          } catch (passErr) {
            console.warn("[viewport-video] passthrough camera unavailable, 3D POV only", passErr);
            canvasStream = await startXrSpectatorOnlyStream(fps);
            setStatus(true, "Recording headset 3D POV (compositor passthrough not capturable)…");
          }
        } else {
          canvasStream = await startXrSpectatorOnlyStream(fps);
          setStatus(true, "Recording headset 3D POV…");
        }
      } else if (wantDisplay) {
        setStatus(
          true,
          wantFullscreen
            ? "Pick a screen to record in fullscreen…"
            : "Pick this Render Studio tab to record the full page…",
        );
        canvasStream = await startPageCaptureStream(fps, { fullscreen: wantFullscreen });
      } else {
        canvasStream = canvas.captureStream(fps);
      }
    } catch (err) {
      cleanupStreams();
      sessionDisplayCapture = false;
      const msg = String(err?.message || err || "");
      if (/NotAllowedError|Permission denied|denied|cancel/i.test(msg) || err?.name === "NotAllowedError") {
        setStatus(false, "Page capture canceled — allow screen share, or switch Capture to Viewport.");
      } else {
        setStatus(false, msg || "Could not capture video stream.");
      }
      return;
    }

    const tracks = [...canvasStream.getVideoTracks()];
    const wantMic = prefs.mic || inXr;
    if (wantMic) {
      try {
        const live = inXr ? getXrMicStream?.() : null;
        if (live && typeof live.getAudioTracks === "function" && live.getAudioTracks().length) {
          micStream = new MediaStream(live.getAudioTracks().map((t) => t.clone()));
        } else {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              channelCount: 1,
            },
          });
        }
        tracks.push(...micStream.getAudioTracks());
        if (inXr && !prefs.mic) {
          prefs = writePrefs({ mic: true });
        }
      } catch {
        if (prefs.mic) {
          setStatus(false, "Microphone permission denied — recording video only.");
          prefs = writePrefs({ mic: false });
        } else {
          console.warn("[viewport-video] XR mic unavailable — recording silent video");
          setStatus(false, "Mic blocked — recording silent video. Allow microphone and try again.");
        }
      }
    }

    mixedStream = new MediaStream(tracks);
    chunks = [];
    try {
      recorder = mimeType
        ? new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: bitrate })
        : new MediaRecorder(mixedStream, { videoBitsPerSecond: bitrate });
    } catch (err) {
      cleanupStreams();
      setStatus(false, err.message || "Could not start MediaRecorder.");
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      setStatus(false, "Video recording failed.");
      void stopRecording({ silent: true });
    };
    recorder.onstop = () => {
      const type = recorder?.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunks, { type });
      chunks = [];
      const hadPov = usedXrPov;
      const wasPage = wantDisplay;
      const elapsed = recordingElapsedMs();
      cleanupStreams();
      recorder = null;
      const xr = startedInXr || !!isXrPresenting?.();
      startedInXr = false;
      void (async () => {
        // Tiny / empty encodes are useless — don't publish a 0s clip to the PC.
        const tooSmall = !blob || blob.size < 12_000 || elapsed < 400;
        if (blob.size > 0 && !tooSmall) {
          lastBlob = blob;
          sourceBlob = blob;
          pendingDesktopClip = blob;
          const saveP = saveClipToProject(blob, {
            kind: "video",
            folder: xr ? undefined : "Screen Recordings",
            label: xr
              ? (hadPov ? "XR POV clip" : "XR viewport clip")
              : (wantFullscreen ? "Fullscreen clip" : wasPage ? "Full page clip" : "Viewport clip"),
            xr,
            page: wasPage && !wantFullscreen,
            fullscreen: wantFullscreen,
            modeLabel: xr ? (getXrModeLabel?.() || "AR") : null,
          });
          if (!xr || !isXrPresenting?.()) {
            // Show Share to X popup. Never auto-download or open X on stop.
            try { await shareBlobToX(blob, { inPlace: true }); } catch (err) {
              console.warn("[viewport-video] open share modal", err);
            }
          }
          let saved = null;
          try {
            saved = await saveP;
          } catch (err) {
            console.warn("[viewport-video] save clip failed", err);
            setStatus(false, err?.message || "Could not save clip to references.");
          }
          try { onClipReady?.(blob, { xr, kind: "video", saved: !!saved, pov: hadPov, page: wasPage, fullscreen: wantFullscreen }); } catch (_) {}
          setStatus(
            !!saved,
            xr
              ? (saved
                ? `${qualityLabel(prefs.quality)} ${hadPov ? "POV " : ""}clip saved — Share to X opening on your PC.`
                : `${qualityLabel(prefs.quality)} clip ready locally — save to Reference Files failed.`)
              : (saved
                ? `${qualityLabel(prefs.quality)} ${wasPage ? "full-page " : ""}clip saved to Reference Files → ${saved?.folder || "Screen Recordings"}.`
                : `${qualityLabel(prefs.quality)} ${wasPage ? "full-page " : ""}clip ready locally — save to Reference Files → Screen Recordings failed.`),
          );
        } else {
          setStatus(
            false,
            tooSmall
              ? "Recording was too short / empty — hold Rec for a couple seconds, then Stop."
              : "Recording was empty — nothing saved.",
          );
        }
        recording = false;
        paused = false;
        pauseStartedAt = 0;
        pausedAccumMs = 0;
        sessionDisplayCapture = false;
        hideBrowseFrame();
        clearInterval(tickTimer);
        tickTimer = 0;
        syncMainUi();
        syncMenuUi();
        emitRecordingChange();
      })();
    };

    try {
      // Smaller timeslice keeps Quest MediaRecorder flushing chunks.
      recorder.start(100);
    } catch (err) {
      cleanupStreams();
      recorder = null;
      sessionDisplayCapture = false;
      setStatus(false, err.message || "Could not start recording.");
      return;
    }

    hideRecordDonePopup();
    recording = true;
    overlayUserPos = { viewport: null, screen: null };
    viewportBrowseHinted = false;
    startedInXr = inXr;
    paused = false;
    pauseStartedAt = 0;
    pausedAccumMs = 0;
    startedAt = Date.now();
    bindSiteNavGuard();
    bindRecMessages();
    ensureRecordOverlay();
    clearInterval(tickTimer);
    tickTimer = window.setInterval(() => {
      syncMainUi();
      emitRecordingChange();
    }, 250);
    closeMenu();
    syncMainUi();
    emitRecordingChange();
    setStatus(
      true,
      usedXrPov
        ? `Recording headset POV… ${qualityLabel(prefs.quality)} @ ${fps} fps`
        : wantFullscreen
          ? `Recording fullscreen… ${qualityLabel(prefs.quality)} @ ${fps} fps — pause/stop from the side bar, even on Docs.`
          : wantDisplay
            ? `Recording full page… ${qualityLabel(prefs.quality)} @ ${fps} fps — open Docs without stopping.`
            : `Recording viewport… ${qualityLabel(prefs.quality)} @ ${fps} fps`,
    );
  }

  function pauseRecording() {
    if (!recording || paused) return false;
    try {
      if (recorder && recorder.state === "recording" && typeof recorder.pause === "function") {
        recorder.pause();
      }
    } catch (err) {
      console.warn("[viewport-video] pause", err);
      return false;
    }
    paused = true;
    pauseStartedAt = Date.now();
    syncMainUi();
    emitRecordingChange();
    setStatus(true, "Recording paused — resume from the side controls.");
    return true;
  }

  function resumeRecording() {
    if (!recording || !paused) return false;
    try {
      if (recorder && recorder.state === "paused" && typeof recorder.resume === "function") {
        recorder.resume();
      }
    } catch (err) {
      console.warn("[viewport-video] resume", err);
      return false;
    }
    pausedAccumMs += Math.max(0, Date.now() - pauseStartedAt);
    paused = false;
    pauseStartedAt = 0;
    syncMainUi();
    emitRecordingChange();
    setStatus(true, "Recording resumed.");
    return true;
  }

  function togglePause() {
    if (!recording) return false;
    return paused ? resumeRecording() : pauseRecording();
  }

  async function stopRecording({ silent = false } = {}) {
    recordingStartEpoch++;
    if (!recording) return;
    clearInterval(tickTimer);
    tickTimer = 0;
    try {
      // Resume first so MediaRecorder can finalize cleanly on some browsers
      if (paused && recorder?.state === "paused") {
        try { recorder.resume(); } catch (_) {}
        paused = false;
      }
      // Final composite frame + flush encoder before stop (Quest often drops the last GOP otherwise)
      if (usedXrPov) {
        try { paintPovCompositeFrame(); } catch (_) {}
      }
      try { recorder?.requestData?.(); } catch (_) {}
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else {
        recording = false;
        paused = false;
        sessionDisplayCapture = false;
        hideBrowseFrame();
        cleanupStreams();
        syncMainUi();
        emitRecordingChange();
      }
    } catch (err) {
      recording = false;
      paused = false;
      sessionDisplayCapture = false;
      hideBrowseFrame();
      cleanupStreams();
      syncMainUi();
      emitRecordingChange();
      if (!silent) setStatus(false, err.message || "Could not stop recording.");
    }
  }

  async function toggleRecording() {
    if (recording) await stopRecording();
    else await startRecording();
  }

  async function reopenPendingClip() {
    const blob = pendingDesktopClip || lastBlob;
    if (!blob) return false;
    await openShareModal(blob);
    return true;
  }

  function clearPendingClip() {
    pendingDesktopClip = null;
  }

  function bind() {
    const { main, options, menu } = els();
    if (!main || main.dataset.videoBound === "1") return;
    main.dataset.videoBound = "1";

    main.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      if (clipDownloadBusy && !recording) return;
      void toggleRecording();
    });

    options?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });
    menu?.addEventListener("click", (e) => {
      const qualityBtn = e.target.closest("[data-video-quality]");
      if (qualityBtn) {
        prefs = writePrefs({ quality: qualityBtn.dataset.videoQuality || "ultra" });
        syncMenuUi();
        setStatus(true, `Video quality: ${qualityLabel(prefs.quality)}`);
        return;
      }
      const fpsBtn = e.target.closest("[data-video-fps]");
      if (fpsBtn) {
        prefs = writePrefs({ fps: Number(fpsBtn.dataset.videoFps) === 60 ? 60 : 30 });
        syncMenuUi();
        setStatus(true, `Video frame rate: ${prefs.fps} fps`);
        return;
      }
      const targetBtn = e.target.closest("[data-video-target]");
      if (targetBtn) {
        const raw = String(targetBtn.dataset.videoTarget || "viewport");
        const next = raw === "page" || raw === "fullscreen" ? raw : "viewport";
        prefs = writePrefs({ target: next });
        syncMenuUi();
        setStatus(
          true,
          next === "fullscreen"
            ? "Capture: Fullscreen — records a whole display (browser picker)."
            : next === "page"
              ? "Capture: Full page — records the whole Render Studio UI (guides & demos)."
              : "Capture: Viewport — records the 3D canvas only.",
        );
        return;
      }
      if (e.target.closest("[data-video-start]")) {
        void startRecording();
        return;
      }
      if (e.target.closest("[data-video-open-editor]")) {
        closeMenu();
        void openClipEditorFromChrome();
      }
    });

    menu?.addEventListener("change", (e) => {
      const mic = e.target.closest("[data-video-mic]");
      if (mic instanceof HTMLInputElement) {
        prefs = writePrefs({ mic: mic.checked });
        syncMenuUi();
      }
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest(".viewport-video-control")) return;
      closeMenu();
    });

    document.addEventListener("keydown", (e) => {
      if (isXCaptionOpen() && (e.key === " " || e.code === "Space") && !e.repeat && !isXCaptionTyping(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        toggleXSharePreview();
        return;
      }
      if (e.key === "Escape") {
        if (donePopupEl && !donePopupEl.classList.contains("hidden")) {
          hideRecordDonePopup();
          return;
        }
        if (browseFrame && !browseFrame.hidden) {
          hideBrowseFrame();
          return;
        }
        closeMenu();
        if (isXCaptionOpen()) return;
        if (shareModalEl && !shareModalEl.classList.contains("hidden")) return;
      }
    }, true);

    syncMainUi();
    syncMenuUi();
    bindSiteNavGuard();
    bindRecMessages();
    bindOverlayLayout();
  }

  return {
    bind,
    startRecording,
    stopRecording,
    toggleRecording,
    pauseRecording,
    resumeRecording,
    togglePause,
    reopenPendingClip,
    clearPendingClip,
    onXrFrame,
    isRecording: () => recording,
    isPaused: () => paused,
    getElapsedMs: () => recordingElapsedMs(),
    closeMenu,
    openShareModal,
    shareBlobToX,
    openEditorTab,
    resumeFilmJob() {
      return videoEditor?.resumeFilmJob?.() || Promise.resolve(null);
    },
    openEditor: (blob, opts) => (blob ? openShareModal(blob, opts) : openEditorTab(opts || {})),
    openEditorProject,
    openRecordingInEditor,
    persistEditorSources: persistVideoEditorSourceRefs,
    saveStillToProject: (blob, meta = {}) => saveClipToProject(blob, { ...meta, kind: "screenshot" }),
    saveClipToProject,
    showEditorWindow() {
      const modal = ensureShareModal();
      modal.classList.remove("hidden");
      upsertClipEditorTab(docTabs?.list?.()?.find?.((t) => t.id === CLIP_EDITOR_TAB_ID)?.label || "Editor");
      try { videoEditor?.unpark?.(); } catch (_) { /* ignore */ }
      void restoreLastEditorSession();
      void videoEditor?.resumeFilmJob?.();
      void refreshVideoLibrary();
    },
    hideEditorWindow() {
      if (videoEditorListAbort) {
        try { videoEditorListAbort.abort(); } catch (_) { /* ignore */ }
      }
      finishXPinPrompt(false);
      hideXPrepPopup();
      hideXCaptionPopup();
      if (editorAutosaveTimer) {
        window.clearTimeout(editorAutosaveTimer);
        editorAutosaveTimer = 0;
      }
      try { videoEditor?.park?.(); } catch (_) { /* ignore */ }
      pauseAndDetachMedia(shareModalEl?.querySelector(".viewport-video-share-preview"));
      revokeXShareSheetUrls(); // leakfix25
      shareModalEl?.classList.add("hidden");
      shareModalEl?.classList.remove("is-sheet-only");
    },
    addStill: (payload) => {
      ensureShareModal();
      return videoEditor?.addStill?.(payload);
    },
    addMusic: (file) => {
      ensureShareModal();
      videoEditor?.setMusicFromFile?.(file);
    },
    isStudioOpen: () => !!(shareModalEl && !shareModalEl.classList.contains("hidden")),
    applyEditCommand: async (prompt, opts) => {
      if (!videoEditor?.applyEditCommand) return { ok: false, error: "Video studio is closed." };
      return videoEditor.applyEditCommand(prompt, opts);
    },
    getVideoEditor: () => videoEditor,
  };
}
