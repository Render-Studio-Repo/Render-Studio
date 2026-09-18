/** High-quality viewport video recording — expandable settings next to Screenshot. */

import { mountVideoClipStudio } from "./video-clip-studio.js?v=20260727-no-assemble-trial";

const LS_KEY = "render3d:viewportVideo:v1";

const DEFAULTS = {
  quality: "high", // standard | high | ultra
  fps: 30,
  mic: true, // include headset/browser mic by default (esp. XR POV clips)
};

const BITRATES = {
  standard: 4_000_000,
  high: 10_000_000,
  ultra: 18_000_000,
};

function readPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    return {
      quality: BITRATES[raw.quality] ? raw.quality : DEFAULTS.quality,
      fps: Number(raw.fps) === 60 ? 60 : 30,
      mic: !!raw.mic,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writePrefs(next) {
  const prefs = { ...readPrefs(), ...next };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch (_) {}
  return prefs;
}

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const type of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return "";
}

function qualityLabel(q) {
  if (q === "ultra") return "Ultra";
  if (q === "standard") return "Standard";
  return "High";
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
  onSaveClip = null,
  onRecordingChange = null,
  onClipReady = null,
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
  let pendingImportOptions = null;

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
  }

  async function saveClipToProject(blob, meta = {}) {
    if (!blob || typeof onSaveClip !== "function") return null;
    try {
      const xr = !!(meta.xr || isXrPresenting?.());
      return await onSaveClip(blob, {
        ...meta,
        xr,
        forceArFolder: xr || !!meta.forceArFolder,
        modeLabel: meta.modeLabel || (xr ? (getXrModeLabel?.() || "AR") : null),
      });
    } catch (err) {
      console.warn("[viewport-video] save clip failed", err);
      return null;
    }
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

  function syncMainUi() {
    const { main, timer } = els();
    if (!main) return;
    main.classList.toggle("is-recording", recording);
    main.setAttribute("aria-pressed", recording ? "true" : "false");
    main.classList.toggle("is-paused", !!(recording && paused));
    main.title = recording
      ? (paused ? "Resume recording" : "Stop recording")
      : `Record viewport video (${qualityLabel(prefs.quality)}, ${prefs.fps} fps). Use ▾ for settings.`;
    const icon = main.querySelector("[data-video-icon]");
    if (icon) {
      icon.innerHTML = recording
        ? (paused
          ? `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M7 5l9 5-9 5V5z" fill="currentColor"/></svg>`
          : `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor"/></svg>`)
        : `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.5" y="5" width="11" height="10" rx="2"/><path d="M13.5 8.2L17.5 6v8L13.5 11.8V8.2z" fill="currentColor" stroke="none"/></svg>`;
    }
    if (timer) {
      timer.classList.toggle("hidden", !recording);
      if (recording) {
        const label = formatElapsed(recordingElapsedMs());
        timer.textContent = paused ? `❚❚ ${label}` : label;
      }
    }
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
    const mic = menu.querySelector("[data-video-mic]");
    if (mic instanceof HTMLInputElement) mic.checked = !!prefs.mic;
    const summary = menu.querySelector("[data-video-summary]");
    if (summary) {
      summary.textContent = `${qualityLabel(prefs.quality)} · ${prefs.fps} fps${prefs.mic ? " · mic" : ""}`;
    }
  }

  function downloadBlob(blob, ext = "webm") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeExt = String(ext || "webm").replace(/^\./, "").toLowerCase() || "webm";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `render3d-video-${stamp}.${safeExt}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function selectedDownloadFormat() {
    const sel = shareModalEl?.querySelector("[data-video-download-format]");
    const value = String(sel?.value || "webm").toLowerCase();
    if (value === "mp4" || value === "gif" || value === "webm") return value;
    return "webm";
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
      const outStream = canvas.captureStream(30);
      const tracks = [...outStream.getVideoTracks()];
      try {
        const captured = typeof video.captureStream === "function"
          ? video.captureStream()
          : (typeof video.mozCaptureStream === "function" ? video.mozCaptureStream() : null);
        for (const t of captured?.getAudioTracks?.() || []) tracks.push(t);
      } catch (_) {}
      const mixed = new MediaStream(tracks);
      const recorder = mimeType
        ? new MediaRecorder(mixed, { mimeType, videoBitsPerSecond: 10_000_000 })
        : new MediaRecorder(mixed, { videoBitsPerSecond: 10_000_000 });
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

  async function convertViaApi(blob, format) {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) throw new Error("Sign in to convert this clip to " + format.toUpperCase() + ".");
    const form = new FormData();
    const srcName = blobLooksLike(blob, "mp4") ? "clip.mp4" : "clip.webm";
    form.append("video", blob, srcName);
    form.append("format", format);
    const res = await fetch("/api/video/convert", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const detail = data?.detail || data?.message || res.statusText || "Conversion failed.";
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    const type = res.headers.get("content-type") || (
      format === "gif" ? "image/gif" : format === "mp4" ? "video/mp4" : "video/webm"
    );
    return new Blob([await res.arrayBuffer()], { type });
  }

  async function blobForDownloadFormat(blob, format) {
    if (!blob) return null;
    if (blobLooksLike(blob, format)) return blob;
    if (format === "webm") {
      if (blobLooksLike(blob, "webm")) return blob;
      const local = await remuxViaCanvas(blob, "video/webm;codecs=vp9")
        || await remuxViaCanvas(blob, "video/webm");
      if (local) return local;
      return convertViaApi(blob, "webm");
    }
    if (format === "mp4") {
      const local = await remuxViaCanvas(blob, "video/mp4")
        || await remuxViaCanvas(blob, "video/mp4;codecs=avc1.42E01E,mp4a.40.2");
      if (local && blobLooksLike(local, "mp4")) return local;
      return convertViaApi(blob, "mp4");
    }
    if (format === "gif") {
      return convertViaApi(blob, "gif");
    }
    return blob;
  }

  function ensureShareModal() {
    if (shareModalEl) return shareModalEl;
    shareModalEl = document.createElement("div");
    shareModalEl.id = "viewport-video-share-modal";
    shareModalEl.className = "auth-modal viewport-video-share-modal hidden";
    shareModalEl.setAttribute("role", "dialog");
    shareModalEl.setAttribute("aria-modal", "true");
    shareModalEl.innerHTML = `
      <div class="auth-backdrop" data-video-share-close></div>
      <div class="auth-card app-dialog-card viewport-video-share-card viewport-video-studio-card">
        <button type="button" class="auth-close" data-video-share-close aria-label="Close">&times;</button>
        <p class="viewport-video-share-eyebrow">Video studio</p>
        <h2 class="app-dialog-title">Edit &amp; assemble clips</h2>
        <p class="muted small">Mix 3D takes, webcam, uploads, and phone clips — label them so assemble knows the cut.</p>
        <section class="viewport-video-recent" data-video-recent hidden>
          <div class="viewport-video-recent-head">
            <h3>Recent in this project</h3>
            <p class="muted small">Tap a clip to re-edit filters or Share to X again.</p>
          </div>
          <div class="viewport-video-recent-rail" data-video-recent-rail role="list"></div>
        </section>
        <video class="viewport-video-share-preview" controls playsinline></video>
        <div data-video-editor-host></div>
        <label class="viewport-video-share-caption">
          <span>Caption (X)</span>
          <textarea data-video-share-text maxlength="270" rows="4" placeholder="Your caption…"></textarea>
        </label>
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
        <div class="viewport-video-share-actions">
          <div class="viewport-video-download-wrap">
            <label class="viewport-video-download-format">
              <select data-video-download-format aria-label="Download file type">
                <option value="webm">WebM</option>
                <option value="mp4">MP4</option>
                <option value="gif">GIF</option>
              </select>
            </label>
            <button type="button" class="btn secondary" data-video-share-download>Download</button>
          </div>
          <button type="button" class="btn secondary" data-video-share-connect-x>Connect X</button>
          <button type="button" class="btn accent" data-video-share-post-x>Share to X</button>
        </div>
        <div class="app-dialog-actions">
          <button type="button" class="btn secondary" data-video-share-close>Done</button>
        </div>
      </div>
      <div class="viewport-video-x-prep hidden" data-video-x-prep role="status" aria-live="polite">
        <div class="viewport-video-x-prep-card">
          <div class="viewport-video-x-prep-spinner" aria-hidden="true"></div>
          <p class="viewport-video-x-prep-title" data-video-x-prep-title>Preparing MP4…</p>
          <p class="viewport-video-x-prep-body" data-video-x-prep-body>Converting your clip so X can attach it.</p>
          <button type="button" class="btn secondary viewport-video-x-prep-dismiss hidden" data-video-x-prep-dismiss>Got it</button>
        </div>
      </div>
    `;
    document.body.appendChild(shareModalEl);
    shareModalEl.querySelectorAll("[data-video-share-close]").forEach((el) => {
      el.addEventListener("click", () => closeShareModal());
    });
    shareModalEl.querySelector("[data-video-x-prep-dismiss]")?.addEventListener("click", () => {
      hideXPrepPopup();
    });
    shareModalEl.querySelector("[data-video-share-download]")?.addEventListener("click", () => {
      void downloadEdited();
    });
    shareModalEl.querySelector("[data-video-share-connect-x]")?.addEventListener("click", () => {
      void connectX();
    });
    shareModalEl.querySelector("[data-video-share-post-x]")?.addEventListener("click", () => {
      void postToX();
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

    const host = shareModalEl.querySelector("[data-video-editor-host]");
    videoEditor = mountVideoClipStudio(host, {
      getPreviewEl: () => shareModalEl?.querySelector(".viewport-video-share-preview"),
      getToken,
      getProjectId,
      isFreeTrialCredits,
      onOutputBlob: (blob) => {
        if (blob) {
          lastBlob = blob;
          sourceBlob = blob;
          void saveClipToProject(blob, { label: "Edited clip" });
        }
      },
      onStatus: (msg, isError) => setShareStatus(msg, !!isError),
      onRequestViewportRecord: () => {
        appendNextViewportTake = true;
        closeShareModal();
        setStatus(true, "Record another 3D take — it will append to your timeline.");
        void startRecording();
      },
    });
    return shareModalEl;
  }

  async function resolveShareBlob() {
    if (videoEditor?.needsBake?.()) {
      const baked = await videoEditor.ensureBaked();
      if (baked) lastBlob = baked;
    }
    return lastBlob;
  }

  async function downloadEdited() {
    const blob = await resolveShareBlob();
    if (!blob) {
      setShareStatus("Nothing to download yet.", true);
      return;
    }
    const format = selectedDownloadFormat();
    const btn = shareModalEl?.querySelector("[data-video-share-download]");
    if (btn) btn.disabled = true;
    setShareStatus(format === "webm" && blobLooksLike(blob, "webm")
      ? "Downloading…"
      : `Converting to ${format.toUpperCase()}…`);
    try {
      const out = await blobForDownloadFormat(blob, format);
      if (!out) throw new Error("Could not prepare download.");
      downloadBlob(out, format);
      setShareStatus(`Downloaded ${format.toUpperCase()}.`);
    } catch (err) {
      setShareStatus(err?.message || "Download failed.", true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function setShareStatus(text, isError = false) {
    const el = shareModalEl?.querySelector("[data-video-share-status]");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError && !!text);
  }

  function showXPrepPopup({ title, body, spinning = true, dismissible = false } = {}) {
    const modal = ensureShareModal();
    const prep = modal.querySelector("[data-video-x-prep]");
    const titleEl = modal.querySelector("[data-video-x-prep-title]");
    const bodyEl = modal.querySelector("[data-video-x-prep-body]");
    const dismiss = modal.querySelector("[data-video-x-prep-dismiss]");
    const spinner = modal.querySelector(".viewport-video-x-prep-spinner");
    if (!prep) return;
    if (titleEl) titleEl.textContent = title || "Preparing MP4…";
    if (bodyEl) bodyEl.textContent = body || "Converting your clip so X can attach it.";
    spinner?.classList.toggle("hidden", !spinning);
    dismiss?.classList.toggle("hidden", !dismissible);
    prep.classList.remove("hidden");
  }

  function hideXPrepPopup() {
    shareModalEl?.querySelector("[data-video-x-prep]")?.classList.add("hidden");
  }

  function setXStatus(text) {
    const el = shareModalEl?.querySelector("[data-video-share-x-status]");
    if (el) el.textContent = text || "";
  }

  async function refreshXStatus() {
    const connectBtn = shareModalEl?.querySelector("[data-video-share-connect-x]");
    const postBtn = shareModalEl?.querySelector("[data-video-share-post-x]");
    // Local Share to X (compose + attach) never needs the API.
    if (postBtn) postBtn.disabled = false;
    if (!api) {
      setXStatus("Share to X opens compose with your caption and saves the clip for you to attach.");
      if (connectBtn) connectBtn.disabled = true;
      return { connected: false };
    }
    try {
      const data = await api("/api/integrations/twitter/status");
      const connected = !!data?.connected;
      const handle = data?.account?.username ? `@${data.account.username}` : "";
      if (!data?.configured) {
        setXStatus("Share to X opens compose + saves the clip — attach it with X’s media button.");
        if (connectBtn) connectBtn.disabled = true;
      } else if (connected) {
        setXStatus(
          `Connected as ${handle || "X account"}. Share to X uses compose + attach (API media needs paid X credits).`,
        );
        if (connectBtn) {
          connectBtn.textContent = "Reconnect X";
          connectBtn.disabled = false;
        }
      } else {
        setXStatus("Share to X opens compose with your caption and saves the clip for you to attach.");
        if (connectBtn) {
          connectBtn.textContent = "Connect X";
          connectBtn.disabled = false;
        }
      }
      return data;
    } catch (err) {
      setXStatus("Share to X opens compose + saves the clip — attach it with X’s media button.");
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
          "Popup blocked — allow popups for Render Studio, or open the X link from Account → Authorized apps.",
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

  const X_SHARE_SITE = "https://render3d.app";
  const X_SHARE_ATTRIBUTION = "Built in Render Studio";
  const X_SHARE_DEFAULT = `\n\n${X_SHARE_ATTRIBUTION}`;

  function normalizeXShareCaption(text) {
    // Keep a blank line above the attribution so tweets read like:
    //   testing this out
    //
    //   Built in Render Studio
    let caption = String(text ?? "");
    if (!caption.trim()) return X_SHARE_DEFAULT;
    const hasAttr = new RegExp(X_SHARE_ATTRIBUTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(caption);
    if (!hasAttr) {
      caption = `${caption.replace(/[ \t]+$/g, "").replace(/\n+$/g, "")}\n\n${X_SHARE_ATTRIBUTION}`;
    }
    return caption.slice(0, 270);
  }

  function openXCompose(text) {
    // X cannot hyperlink arbitrary words; attach render3d.app via the url=
    // intent param so "Built in Render Studio" posts include a live link to the site.
    const caption = normalizeXShareCaption(text);
    const params = new URLSearchParams();
    params.set("text", caption);
    if (!/render3d\.app/i.test(caption)) {
      params.set("url", X_SHARE_SITE);
    }
    const url = `https://x.com/intent/post?${params.toString()}`;
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) window.location.href = url;
    return caption;
  }

  function downloadShareBlob(blob) {
    const type = String(blob?.type || "").toLowerCase();
    const ext = type.includes("mp4") || type.includes("m4v")
      ? "mp4"
      : type.includes("quicktime")
        ? "mov"
        : type.includes("webm")
          ? "webm"
          : "mp4";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `render3d-video-${stamp}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function blobForXShare(blob) {
    // X accepts MP4 and MOV; H.264 MP4 is the efficient choice (smaller than
    // typical MOV, and WebM often fails to attach on desktop compose).
    if (!blob) return null;
    if (blobLooksLike(blob, "mp4")) return blob;
    const type = String(blob.type || "").toLowerCase();
    if (type.includes("quicktime") || type.endsWith("/mov")) return blob;
    return blobForDownloadFormat(blob, "mp4");
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

  async function shareViaComposeAttach(blob, text) {
    // No site can inject a file into x.com's compose box. On phones, the OS
    // share sheet can hand the video to the X app. On desktop, we open compose
    // with the caption and save an MP4 so the user can drag it onto X.
    showXPrepPopup({
      title: "Preparing MP4…",
      body: "Converting your clip for X. This can take a few seconds.",
      spinning: true,
      dismissible: false,
    });
    setShareStatus("Preparing MP4 for X…");
    let xBlob = blob;
    try {
      xBlob = await blobForXShare(blob);
    } catch (err) {
      setShareStatus(err?.message || "Could not convert to MP4 — using original clip.", true);
      xBlob = blob;
    }
    if (!xBlob) xBlob = blob;

    const shared = await shareVideoViaWebShare(xBlob, text);
    if (shared) {
      hideXPrepPopup();
      setShareStatus("Pick X in the share sheet — the video goes with the post.");
      setStatus(true, "Shared viewport video.");
      return true;
    }
    openXCompose(text);
    downloadShareBlob(xBlob);
    const isMp4 = blobLooksLike(xBlob, "mp4");
    showXPrepPopup({
      title: isMp4 ? "MP4 ready — drag it onto X" : "Clip ready — drag it onto X",
      body: isMp4
        ? "X compose is open with your caption. Your MP4 just downloaded — drag and drop that video into the X post."
        : "X compose is open with your caption. Your clip just downloaded — drag and drop that video into the X post.",
      spinning: false,
      dismissible: true,
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
    const blob = await resolveShareBlob();
    if (!blob) {
      setShareStatus("Nothing to post yet.", true);
      return;
    }
    const text = normalizeXShareCaption(
      shareModalEl?.querySelector("[data-video-share-text]")?.value,
    );
    const postBtn = shareModalEl?.querySelector("[data-video-share-post-x]");
    if (postBtn) postBtn.disabled = true;
    try {
      // Skip X API media upload — it needs paid developer credits and was
      // showing "Uploading…" then silently falling back to a download.
      showXPrepPopup({
        title: "Preparing MP4…",
        body: "Getting your video ready for X.",
        spinning: true,
        dismissible: false,
      });
      setShareStatus("Preparing MP4 for X…");
      await shareViaComposeAttach(blob, text);
    } catch (err) {
      hideXPrepPopup();
      setShareStatus(err?.message || "Could not open X.", true);
    } finally {
      if (postBtn) postBtn.disabled = false;
    }
  }

  function closeShareModal() {
    finishXPinPrompt(false);
    hideXPrepPopup();
    const preview = shareModalEl?.querySelector(".viewport-video-share-preview");
    if (preview) {
      preview.removeAttribute("src");
      preview.load?.();
    }
    shareModalEl?.classList.add("hidden");
  }

  async function openShareModal(blob, options = {}) {
    const append = options && Object.prototype.hasOwnProperty.call(options, "append")
      ? !!options.append
      : appendNextViewportTake;
    appendNextViewportTake = false;
    sourceBlob = blob;
    lastBlob = blob;
    const modal = ensureShareModal();
    const label = String(options.label || "3D viewport").slice(0, 80) || "3D viewport";
    const source = String(options.source || "viewport") || "viewport";
    if (append && videoEditor?.addClip) {
      await videoEditor.addClip({
        blob,
        source,
        label,
      });
    } else {
      videoEditor?.setPrimaryClip?.(blob, { label, source });
    }
    const preview = modal.querySelector(".viewport-video-share-preview");
    if (preview && !append) {
      const url = URL.createObjectURL(blob);
      preview.src = url;
      preview.onloadeddata = () => {
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      };
      preview.muted = false;
      preview.volume = 1;
    }
    const text = modal.querySelector("[data-video-share-text]");
    if (text) {
      if (!String(text.value || "").trim() || String(text.value || "").trim() === X_SHARE_ATTRIBUTION) {
        text.value = X_SHARE_DEFAULT;
      }
      // Cursor at the top so typing goes above the blank line + attribution.
      requestAnimationFrame(() => {
        try {
          text.focus();
          text.setSelectionRange(0, 0);
        } catch (_) {}
      });
    }
    setShareStatus(String(options.editorStatus || (append ? `${label} added to timeline.` : "")));
    try {
      videoEditor?.syncAssembleAvailability?.();
    } catch (_) {}
    modal.classList.remove("hidden");
    await refreshXStatus();
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
    const outW = povCompositeCanvas.width || 1280;
    const outH = povCompositeCanvas.height || 720;
    const ctx = povCompositeCtx;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, outW, outH);

    const vrOnly = usedXrPov && isXrVrSession() && !povVideoEl;

    // 1) Headset camera / passthrough (AR only — VR uses spectator CAD view alone)
    if (!vrOnly && povVideoEl && povVideoEl.readyState >= 2) {
      drawCoverImage(ctx, povVideoEl, outW, outH);
    }

    // 2) Mono headset view from offscreen XR spectator (model + controllers + UI windows)
    let overlay = null;
    try {
      overlay = getXrOverlayCanvas?.(outW, outH, { opaque: vrOnly || isXrVrSession() }) || null;
    } catch (err) {
      console.warn("[viewport-video] overlay canvas failed", err);
    }
    if (overlay) {
      try {
        ctx.drawImage(overlay, 0, 0, outW, outH);
      } catch (_) {}
    } else if (!vrOnly) {
      // Fallback: try left-eye crop of the live GL canvas (often empty on Quest)
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
  function onXrFrame() {
    if (!recording || !usedXrPov || paused) return;
    paintPovCompositeFrame();
  }

  async function startXrSpectatorOnlyStream(_fps) {
    // VR: record the headset spectator view only (no passthrough camera).
    // Passthrough FOV/pose never matches WebXR, which made controllers look wrong.
    const outW = 1280;
    const outH = 720;
    const composite = document.createElement("canvas");
    composite.width = outW;
    composite.height = outH;
    composite.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    try { document.body.appendChild(composite); } catch (_) {}
    povCompositeCanvas = composite;
    povCompositeCtx = composite.getContext("2d", { alpha: false, desynchronized: true });
    if (!povCompositeCtx) throw new Error("Could not create VR spectator canvas.");
    povVideoEl = null;
    povCameraStream = null;

    const stream = typeof composite.captureStream === "function"
      ? composite.captureStream(0)
      : null;
    if (!stream) throw new Error("Spectator canvas captureStream unavailable.");
    povCaptureTrack = stream.getVideoTracks()?.[0] || null;
    usedXrPov = true;
    paintPovCompositeFrame();
    stopPovCompositeLoop();
    const pump = () => {
      povRafId = 0;
      if (!recording || !usedXrPov) return;
      if (!paused) paintPovCompositeFrame();
      povRafId = requestAnimationFrame(pump);
    };
    povRafId = requestAnimationFrame(pump);
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
    // Target ~720p landscape for Share/X; keep camera aspect.
    const outH = 720;
    const outW = Math.max(640, Math.round(outH * (vw / Math.max(1, vh))));

    const composite = document.createElement("canvas");
    composite.width = outW;
    composite.height = outH;
    composite.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    try { document.body.appendChild(composite); } catch (_) {}
    povCompositeCanvas = composite;
    povCompositeCtx = composite.getContext("2d", { alpha: false, desynchronized: true });
    if (!povCompositeCtx) throw new Error("Could not create POV composite canvas.");

    // captureStream(0) + requestFrame is reliable during XR; timed captureStream often yields 0s clips.
    const stream = typeof composite.captureStream === "function"
      ? composite.captureStream(0)
      : null;
    if (!stream) throw new Error("Composite canvas captureStream unavailable.");
    povCaptureTrack = stream.getVideoTracks()?.[0] || null;
    usedXrPov = true;
    paintPovCompositeFrame();
    // Safety net if XR loop is slow to start
    stopPovCompositeLoop();
    const pump = () => {
      povRafId = 0;
      if (!recording || !usedXrPov) return;
      if (!paused) paintPovCompositeFrame();
      povRafId = requestAnimationFrame(pump);
    };
    povRafId = requestAnimationFrame(pump);
    return stream;
  }

  async function startRecording(options = {}) {
    if (recording) return false;
    const canvas = getCanvas?.();
    if (!canvas || typeof canvas.captureStream !== "function") {
      setStatus(false, "This browser cannot record the viewport canvas.");
      return false;
    }
    if (!window.MediaRecorder) {
      setStatus(false, "MediaRecorder is not available in this browser.");
      return false;
    }
    pendingImportOptions = options && typeof options === "object" ? { ...options } : null;

    prefs = readPrefs();
    const fps = prefs.fps;
    const bitrate = BITRATES[prefs.quality] || BITRATES.high;
    const mimeType = pickMimeType();
    const inXr = !!isXrPresenting?.();
    usedXrPov = false;

    let canvasStream;
    try {
      if (inXr) {
        if (isXrVrSession()) {
          canvasStream = await startXrSpectatorOnlyStream(fps);
          setStatus(true, "Recording VR view (model, controllers, explorer & prompt windows)…");
        } else {
          try {
            canvasStream = await startXrPovCaptureStream(fps);
            setStatus(true, "Recording headset POV (passthrough + CAD)…");
          } catch (povErr) {
            console.warn("[viewport-video] XR POV camera unavailable, spectator-only", povErr);
            cleanupStreams();
            canvasStream = await startXrSpectatorOnlyStream(fps);
            setStatus(
              true,
              "Headset camera blocked — recording CAD/UI view only. Allow camera for passthrough next time.",
            );
          }
        }
      } else {
        canvasStream = canvas.captureStream(fps);
      }
    } catch (err) {
      cleanupStreams();
      setStatus(false, err.message || "Could not capture viewport stream.");
      pendingImportOptions = null;
      return false;
    }

    const tracks = [...canvasStream.getVideoTracks()];
    // XR POV clips should always try for mic audio (prefs may have mic off from desktop).
    const wantMic = prefs.mic || inXr;
    if (wantMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
        });
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
      pendingImportOptions = null;
      return false;
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
      const elapsed = recordingElapsedMs();
      cleanupStreams();
      recorder = null;
      const xr = startedInXr || !!isXrPresenting?.();
      startedInXr = false;
      const importOptions = pendingImportOptions && typeof pendingImportOptions === "object"
        ? { ...pendingImportOptions }
        : {};
      pendingImportOptions = null;
      void (async () => {
        // Tiny / empty encodes are useless — don't publish a 0s clip to the PC.
        const tooSmall = !blob || blob.size < 12_000 || elapsed < 400;
        if (blob.size > 0 && !tooSmall) {
          lastBlob = blob;
          sourceBlob = blob;
          pendingDesktopClip = blob;
          const clipLabel = String(
            importOptions.label
            || (xr ? (hadPov ? "XR POV clip" : "XR viewport clip") : "Viewport clip"),
          ).slice(0, 80) || "Viewport clip";
          const clipSource = String(importOptions.source || "viewport") || "viewport";
          let saved = null;
          try {
            saved = await saveClipToProject(blob, {
              label: clipLabel,
              xr,
              forceArFolder: xr,
              modeLabel: xr ? (getXrModeLabel?.() || "AR") : null,
            });
          } catch (err) {
            console.warn("[viewport-video] save clip failed", err);
            setStatus(false, err?.message || "Could not save clip to references.");
          }
          if (!xr || !isXrPresenting?.()) {
            try {
              await openShareModal(blob, {
                append: importOptions.append,
                label: importOptions.editorLabel || clipLabel,
                source: clipSource,
                editorStatus: importOptions.editorStatus,
              });
            } catch (err) {
              console.warn("[viewport-video] open share modal", err);
            }
          }
          try {
            onClipReady?.(blob, {
              xr,
              kind: "video",
              saved: !!saved,
              pov: hadPov,
              label: clipLabel,
              source: clipSource,
            });
          } catch (_) {}
          setStatus(
            true,
            xr
              ? (saved
                ? `${qualityLabel(prefs.quality)} ${hadPov ? "POV " : ""}clip saved — Share to X opening on your PC.`
                : `${qualityLabel(prefs.quality)} clip ready locally — save to references failed.`)
              : `${qualityLabel(prefs.quality)} clip ready.`,
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
      setStatus(false, err.message || "Could not start recording.");
      return;
    }

    recording = true;
    startedInXr = inXr;
    paused = false;
    pauseStartedAt = 0;
    pausedAccumMs = 0;
    startedAt = Date.now();
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
        : `Recording… ${qualityLabel(prefs.quality)} @ ${fps} fps`,
    );
    return true;
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
    setStatus(true, "Recording paused — resume from the left-hand dock or video button.");
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
        cleanupStreams();
        syncMainUi();
        emitRecordingChange();
      }
    } catch (err) {
      recording = false;
      paused = false;
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

  async function importClip(blob, options = {}) {
    if (!blob) return false;
    await openShareModal(blob, {
      append: Object.prototype.hasOwnProperty.call(options || {}, "append") ? options.append : true,
      ...options,
    });
    return true;
  }

  function bind() {
    const { main, options, menu } = els();
    if (!main || main.dataset.videoBound === "1") return;
    main.dataset.videoBound = "1";

    main.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
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
        prefs = writePrefs({ quality: qualityBtn.dataset.videoQuality || "high" });
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
      if (e.target.closest("[data-video-start]")) {
        void startRecording();
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
      if (e.key === "Escape") {
        closeMenu();
        if (shareModalEl && !shareModalEl.classList.contains("hidden")) closeShareModal();
      }
    });

    syncMainUi();
    syncMenuUi();
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
    importClip,
    getLastBlob: () => pendingDesktopClip || lastBlob,
  };
}
