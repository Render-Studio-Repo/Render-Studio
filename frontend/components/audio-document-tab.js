/** MP3 / audio document tab: play, SoundCloud-style bars, timed comments. */

import {
  amplitudePeaksFromSamples,
  commentMarkerHtml,
  commentMarkerModels,
  decodeAudioAmplitudePeaks,
  formatCommentTimeLabel,
  placeholderAmplitudePeaks,
  playheadPlayedPct,
  seekTimeFromClientX,
  waveformBarsHtml,
} from "../viewport/share-video-waveform.js?v=20260915-scwave1-sharemarkup1-20260915-sharelive1-trimwave1-mp3c1-clipperf1";
import { shareHistoryCommentCardHtml } from "../viewport/share-history-authors.js?v=mp3c1";
import { getStoredUser } from "../studio/auth.js?v=20260723-invite-claim";

export const AUDIO_TAB_CACHE = "mp3c1";
export const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|opus|flac|aiff?|wma|weba)$/i;
export const AUDIO_PEAK_COUNT = 160;

const peaksMemo = new Map();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function isAudioFilename(name = "") {
  return AUDIO_EXT_RE.test(String(name || "").toLowerCase().split(/[?#]/)[0]);
}

export function peaksCacheKey({ projectId = "", filename = "", size = 0 } = {}) {
  return `${String(projectId || "")}:${String(filename || "")}:${Number(size) || 0}`;
}

export function rememberAudioPeaks(key, peaks) {
  if (!key || !Array.isArray(peaks) || !peaks.length) return peaks;
  peaksMemo.set(key, peaks);
  return peaks;
}

export function cachedAudioPeaks(key) {
  return key ? peaksMemo.get(key) || null : null;
}

export function sanitizeAudioPeaks(peaks, count = AUDIO_PEAK_COUNT) {
  const n = Math.max(24, Math.min(320, Math.round(Number(count) || AUDIO_PEAK_COUNT)));
  const rows = Array.isArray(peaks) ? peaks : [];
  if (rows.length < 8) return placeholderAmplitudePeaks(n);
  return rows.slice(0, n).map((v) => Math.max(0.08, Math.min(1, Number(v) || 0.1)));
}

export async function peaksForAudioBlob(blob, key, count = AUDIO_PEAK_COUNT) {
  const hit = cachedAudioPeaks(key);
  if (hit?.length) return hit;
  if (!blob) return placeholderAmplitudePeaks(count);
  const peaks = await decodeAudioAmplitudePeaks(blob, { count });
  return rememberAudioPeaks(key, peaks?.length ? peaks : amplitudePeaksFromSamples([], count));
}

export function studioCommentAuthor(user) {
  const me = user || getStoredUser() || {};
  const id = String(me.id || "").trim();
  return {
    id,
    display_name: String(me.display_name || me.email || "Guest").trim() || "Guest",
    avatar_url: String(me.avatar_url || "").trim() || (id ? `/api/users/${encodeURIComponent(id)}/avatar` : ""),
  };
}

export function formatAudioClock(seconds) {
  const sec = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function audioCommentsPanelHtml(comments) {
  const rows = Array.isArray(comments) ? comments : [];
  if (!rows.length) {
    return `<div class="ref-audio-comments" data-ref-audio-comments>
      <p class="muted small ref-audio-comments-empty">Click the waveform to drop a comment at that time. Everyone in the project can see it.</p>
    </div>`;
  }
  return `<div class="ref-audio-comments" data-ref-audio-comments>
    ${rows.map((row) => shareHistoryCommentCardHtml(row)).join("")}
  </div>`;
}

export function audioPlayerHtml({ src = "", peaks = [], comments = [], duration = 0 } = {}) {
  const heights = sanitizeAudioPeaks(peaks);
  const bars = waveformBarsHtml(heights);
  const models = commentMarkerModels(comments, duration);
  const marks = models.map(commentMarkerHtml).join("");
  return `<div class="ref-viewer-stage-wrap ref-viewer-stage-wrap--audio">
    <div class="ref-audio-player" data-ref-audio-player>
      <audio class="ref-audio" src="${escapeHtml(src)}" preload="metadata" playsinline></audio>
      <div class="ref-audio-transport">
        <button type="button" class="dxf-viewer-btn accent" data-ref-audio-play title="Play or pause">Play</button>
        <span class="ref-audio-clock" data-ref-audio-clock>0:00 / 0:00</span>
      </div>
      <div class="share-waveform ref-audio-wave" aria-label="Audio waveform">
        <div class="share-waveform-track" data-ref-audio-wave role="slider" aria-label="Seek and comment" aria-valuemin="0" aria-valuenow="0" aria-valuemax="0" tabindex="0">
          <div class="share-waveform-layers" aria-hidden="true">
            <div class="share-waveform-bars" data-ref-audio-bars>${bars}</div>
            <div class="share-waveform-bars share-waveform-bars--played" data-ref-audio-played>${bars}</div>
            <div class="share-waveform-playhead"></div>
          </div>
          <div class="share-waveform-markers" data-ref-audio-marks>${marks}</div>
        </div>
      </div>
      <form class="ref-audio-comment-form" data-ref-audio-comment-form hidden>
        <label class="ref-audio-comment-label">Comment at <span data-ref-audio-comment-at>0.0s</span></label>
        <textarea data-ref-audio-comment-text rows="2" maxlength="2000" placeholder="Add a note for everyone on this track…"></textarea>
        <div class="ref-audio-comment-actions">
          <button type="button" class="dxf-viewer-btn" data-ref-audio-comment-cancel>Cancel</button>
          <button type="submit" class="dxf-viewer-btn accent">Add comment</button>
        </div>
      </form>
    </div>
  </div>`;
}

function paintBars(root, peaks) {
  const html = waveformBarsHtml(sanitizeAudioPeaks(peaks));
  const bars = root.querySelector("[data-ref-audio-bars]");
  const played = root.querySelector("[data-ref-audio-played]");
  if (bars) bars.innerHTML = html;
  if (played) played.innerHTML = html;
}

function paintMarks(root, comments, duration) {
  const marks = root.querySelector("[data-ref-audio-marks]");
  if (!marks) return;
  const models = commentMarkerModels(comments, duration);
  marks.innerHTML = models.map(commentMarkerHtml).join("");
}

function paintCommentsList(root, comments) {
  const host = root.closest(".ref-viewer-body")?.querySelector("[data-ref-audio-comments]")
    || document.querySelector("[data-ref-audio-comments]");
  if (!host) return;
  host.outerHTML = audioCommentsPanelHtml(comments);
}

export function bindAudioDocumentPlayer(root, {
  comments = [],
  peaks = [],
  duration = 0,
  startTime = 0,
  onAddComment,
  onTime,
} = {}) {
  if (!root) return { destroy() {}, setComments() {}, setPeaks() {} };
  const audio = root.querySelector(".ref-audio");
  const track = root.querySelector("[data-ref-audio-wave]");
  const playBtns = [...(root.querySelectorAll("[data-ref-audio-play]") || [])];
  const toolbarPlay = root.closest(".ref-viewer")?.querySelector(".ref-viewer-toolbar [data-ref-audio-play]")
    || document.querySelector(".ref-viewer-toolbar [data-ref-audio-play]");
  if (toolbarPlay && !playBtns.includes(toolbarPlay)) playBtns.push(toolbarPlay);
  const clock = root.querySelector("[data-ref-audio-clock]");
  const form = root.querySelector("[data-ref-audio-comment-form]");
  const atEl = root.querySelector("[data-ref-audio-comment-at]");
  const textEl = root.querySelector("[data-ref-audio-comment-text]");
  let rows = Array.isArray(comments) ? comments : [];
  let draftT = 0;
  let dead = false;

  paintBars(root, peaks);

  const durationNow = () => {
    const fromEl = Number(audio?.duration);
    if (Number.isFinite(fromEl) && fromEl > 0.05) return fromEl;
    return Math.max(0, Number(duration) || 0);
  };

  const syncPlayhead = () => {
    if (dead || !audio) return;
    const dur = durationNow();
    const t = Number(audio.currentTime) || 0;
    const pct = playheadPlayedPct(t, dur);
    if (track) {
      track.style.setProperty("--played", `${pct}%`);
      track.setAttribute("aria-valuenow", String(Math.round(t)));
      track.setAttribute("aria-valuemax", String(Math.round(dur)));
    }
    if (clock) clock.textContent = `${formatAudioClock(t)} / ${formatAudioClock(dur)}`;
    const label = audio.paused ? "Play" : "Pause";
    for (const btn of playBtns) {
      if (!btn) continue;
      btn.textContent = label;
      btn.setAttribute("aria-pressed", String(!audio.paused));
    }
    onTime?.({ t, duration: dur, paused: audio.paused });
  };

  const setComments = (next, nextDuration) => {
    rows = Array.isArray(next) ? next : [];
    paintMarks(root, rows, nextDuration ?? durationNow());
    paintCommentsList(root, rows);
  };

  const togglePlay = async () => {
    if (!audio) return;
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch {
      /* autoplay / decode */
    }
    syncPlayhead();
  };

  const seekTo = (t, { showForm = false } = {}) => {
    if (!audio) return;
    const dur = durationNow();
    const next = Math.max(0, Math.min(dur || t, Number(t) || 0));
    try { audio.currentTime = next; } catch { /* ignore */ }
    draftT = next;
    if (atEl) atEl.textContent = formatCommentTimeLabel(next);
    if (showForm && form) {
      form.hidden = false;
      textEl?.focus();
    }
    syncPlayhead();
  };

  const onTrackPointer = (event) => {
    const mark = event.target.closest?.(".share-wave-mark");
    if (mark) {
      event.preventDefault();
      const t = Number(mark.getAttribute("data-t"));
      seekTo(t, { showForm: false });
      mark.classList.add("is-open");
      return;
    }
    if (!track) return;
    event.preventDefault();
    const t = seekTimeFromClientX(event.clientX, track.getBoundingClientRect(), durationNow());
    seekTo(t, { showForm: true });
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    const text = String(textEl?.value || "").trim();
    if (!text) return;
    const t = draftT || Number(audio?.currentTime) || 0;
    try {
      await onAddComment?.({ text, t });
      if (textEl) textEl.value = "";
      if (form) form.hidden = true;
    } catch {
      /* caller status */
    }
  };

  const onKey = (event) => {
    if (dead) return;
    if (event.code !== "Space" && event.key !== " ") return;
    if (event.target?.closest?.("input, textarea, [contenteditable='true']")) return;
    const viewer = root.closest(".ref-viewer") || document.getElementById("ref-viewer");
    if (viewer?.classList.contains("hidden") || !root.isConnected) return;
    event.preventDefault();
    void togglePlay();
  };

  track?.addEventListener("click", onTrackPointer);
  form?.addEventListener("submit", onSubmit);
  form?.querySelector("[data-ref-audio-comment-cancel]")?.addEventListener("click", () => {
    if (form) form.hidden = true;
  });
  for (const btn of playBtns) btn?.addEventListener("click", (event) => {
    event.preventDefault();
    void togglePlay();
  });
  audio?.addEventListener("timeupdate", syncPlayhead);
  audio?.addEventListener("play", syncPlayhead);
  audio?.addEventListener("pause", syncPlayhead);
  audio?.addEventListener("loadedmetadata", () => {
    paintMarks(root, rows, durationNow());
    if (startTime > 0) {
      try { audio.currentTime = startTime; } catch { /* ignore */ }
    }
    syncPlayhead();
  });
  window.addEventListener("keydown", onKey);
  setComments(rows, duration);
  syncPlayhead();

  return {
    destroy() {
      dead = true;
      window.removeEventListener("keydown", onKey);
      try { audio?.pause?.(); } catch { /* ignore */ }
    },
    setComments,
    setPeaks(next) {
      paintBars(root, next);
    },
    seekTo,
    togglePlay,
    audioEl: audio,
  };
}
