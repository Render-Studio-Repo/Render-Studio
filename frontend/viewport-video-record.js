/** High-quality viewport video recording — expandable settings next to Screenshot. */

import { mountVideoClipStudio } from "./video-clip-studio.js?v=20260727-clip-studio";

const LS_KEY = "render3d:viewportVideo:v1";

const DEFAULTS = {
  quality: "high", // standard | high | ultra
  fps: 30,
  mic: false,
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

export function createViewportVideoRecorder({
  getCanvas,
  onStatus,
  onMenuOpen,
  api,
  getToken,
  getProjectId,
} = {}) {
  let prefs = readPrefs();
  let recorder = null;
  let chunks = [];
  let mixedStream = null;
  let micStream = null;
  let startedAt = 0;
  let tickTimer = 0;
  let recording = false;
  let lastBlob = null;
  let sourceBlob = null;
  let shareModalEl = null;
  let videoEditor = null;
  let appendNextViewportTake = false;

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
    main.title = recording
      ? "Stop recording"
      : `Record viewport video (${qualityLabel(prefs.quality)}, ${prefs.fps} fps). Use ▾ for settings.`;
    const icon = main.querySelector("[data-video-icon]");
    if (icon) {
      icon.innerHTML = recording
        ? `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor"/></svg>`
        : `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.5" y="5" width="11" height="10" rx="2"/><path d="M13.5 8.2L17.5 6v8L13.5 11.8V8.2z" fill="currentColor" stroke="none"/></svg>`;
    }
    if (timer) {
      timer.classList.toggle("hidden", !recording);
      if (recording) timer.textContent = formatElapsed(Date.now() - startedAt);
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
        <video class="viewport-video-share-preview" controls playsinline></video>
        <div data-video-editor-host></div>
        <label class="viewport-video-share-caption">
          <span>Caption (X)</span>
          <textarea data-video-share-text maxlength="270" rows="3" placeholder="Made in Render3D…"></textarea>
        </label>
        <p class="viewport-video-share-x-status muted small" data-video-share-x-status></p>
        <p class="viewport-video-share-status muted small" data-video-share-status role="status"></p>
        <div class="viewport-x-pin-panel hidden" data-video-x-pin-panel>
          <p class="viewport-x-pin-title">Enter the PIN from X</p>
          <p class="muted small">Authorize Render3D in the X window, then type the PIN shown there.</p>
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
    `;
    document.body.appendChild(shareModalEl);
    shareModalEl.querySelectorAll("[data-video-share-close]").forEach((el) => {
      el.addEventListener("click", () => closeShareModal());
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
      onOutputBlob: (blob) => {
        if (blob) {
          lastBlob = blob;
          sourceBlob = blob;
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

  function setXStatus(text) {
    const el = shareModalEl?.querySelector("[data-video-share-x-status]");
    if (el) el.textContent = text || "";
  }

  async function refreshXStatus() {
    const connectBtn = shareModalEl?.querySelector("[data-video-share-connect-x]");
    const postBtn = shareModalEl?.querySelector("[data-video-share-post-x]");
    if (!api) {
      setXStatus("Sign in to connect X.");
      if (connectBtn) connectBtn.disabled = true;
      if (postBtn) postBtn.disabled = true;
      return { connected: false };
    }
    try {
      const data = await api("/api/integrations/twitter/status");
      const connected = !!data?.connected;
      const handle = data?.account?.username ? `@${data.account.username}` : "";
      if (!data?.configured) {
        setXStatus("X isn’t set up on this server yet (missing TWITTER_CLIENT_ID / SECRET). Download the clip for now.");
        if (connectBtn) connectBtn.disabled = true;
        if (postBtn) postBtn.disabled = true;
      } else if (connected) {
        setXStatus(`Connected as ${handle || "X account"}.`);
        if (connectBtn) {
          connectBtn.textContent = "Reconnect X";
          connectBtn.disabled = false;
        }
        if (postBtn) postBtn.disabled = false;
      } else {
        setXStatus("Connect X to post this clip from Render3D.");
        if (connectBtn) {
          connectBtn.textContent = "Connect X";
          connectBtn.disabled = false;
        }
        if (postBtn) postBtn.disabled = true;
      }
      return data;
    } catch (err) {
      setXStatus(err?.message || "Could not load X status.");
      if (postBtn) postBtn.disabled = true;
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
          <p class="muted small">Authorize Render3D in the X window, then type the PIN shown there.</p>
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
          "Popup blocked — allow popups for Render3D, or open the X link from Account → Authorized apps.",
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

  function openXCompose(text) {
    const caption = String(text || "Made in Render3D").trim().slice(0, 270);
    const url = `https://x.com/intent/post?text=${encodeURIComponent(caption)}`;
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) window.location.href = url;
    return caption;
  }

  function downloadShareBlob(blob) {
    const ext = (blob.type || "").includes("mp4") ? "mp4" : "webm";
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

  async function shareVideoViaWebShare(blob, text) {
    if (!blob || typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
    try {
      const ext = (blob.type || "").includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `render3d-video.${ext}`, { type: blob.type || `video/${ext}` });
      if (navigator.canShare && !navigator.canShare({ files: [file], text })) return false;
      await navigator.share({ files: [file], text: text || "Made in Render3D", title: "Render3D" });
      return true;
    } catch (err) {
      if (String(err?.name || "") === "AbortError") return true;
      return false;
    }
  }

  async function postToX() {
    const blob = await resolveShareBlob();
    if (!blob) {
      setShareStatus("Nothing to post yet.", true);
      return;
    }
    const text = shareModalEl?.querySelector("[data-video-share-text]")?.value?.trim() || "Made in Render3D";
    const postBtn = shareModalEl?.querySelector("[data-video-share-post-x]");
    if (postBtn) postBtn.disabled = true;

    // Prefer the connected-account API upload so the video is attached to the tweet.
    // Only fall back to compose/share-sheet when X is not linked.
    try {
      const status = await refreshXStatus();
      const connected = !!status?.connected;
      if (!connected || !api) {
        setShareStatus("Connect X to upload the video with your caption, or use the share sheet…");
        const shared = await shareVideoViaWebShare(blob, text);
        if (shared) {
          setShareStatus("Shared via your device share sheet.");
          setStatus(true, "Shared viewport video.");
          return;
        }
        openXCompose(text);
        downloadShareBlob(blob);
        setShareStatus("Opened X compose with your caption — attach the downloaded clip (Connect X to auto-upload).", true);
        return;
      }

      setShareStatus("Uploading to X… this can take a minute for longer clips.");
      const form = new FormData();
      const ext = (blob.type || "").includes("mp4") ? "mp4" : "webm";
      form.append("video", blob, `render3d-video.${ext}`);
      form.append("text", text);
      const headers = {};
      const token = getToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/integrations/twitter/post-video", {
        method: "POST",
        headers,
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data?.detail || data?.message || res.statusText || "Post failed.";
        if (res.status === 401) {
          setShareStatus(String(detail), true);
          await refreshXStatus();
          return;
        }
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      setShareStatus(data?.url ? `Posted — ${data.url}` : "Posted to X with video.");
      setStatus(true, "Shared viewport video to X.");
      if (data?.url) {
        try {
          window.open(data.url, "_blank", "noopener");
        } catch (_) {}
      }
    } catch (err) {
      setShareStatus(err?.message || "Could not post to X.", true);
    } finally {
      if (postBtn) postBtn.disabled = false;
      await refreshXStatus();
    }
  }

  function closeShareModal() {
    finishXPinPrompt(false);
    const preview = shareModalEl?.querySelector(".viewport-video-share-preview");
    if (preview) {
      preview.removeAttribute("src");
      preview.load?.();
    }
    shareModalEl?.classList.add("hidden");
  }

  async function openShareModal(blob) {
    const append = appendNextViewportTake;
    appendNextViewportTake = false;
    sourceBlob = blob;
    lastBlob = blob;
    const modal = ensureShareModal();
    if (append && videoEditor?.addClip) {
      await videoEditor.addClip({
        blob,
        source: "viewport",
        label: `3D take ${(videoEditor.getClips?.() || []).filter((c) => c.source === "viewport").length + 1}`,
      });
    } else {
      videoEditor?.setPrimaryClip?.(blob, { label: "3D viewport", source: "viewport" });
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
    if (text && !text.value) text.value = "Made in Render3D";
    setShareStatus(append ? "3D take added to timeline." : "");
    modal.classList.remove("hidden");
    await refreshXStatus();
  }

  function cleanupStreams() {
    try {
      mixedStream?.getTracks?.().forEach((t) => t.stop());
    } catch (_) {}
    try {
      micStream?.getTracks?.().forEach((t) => t.stop());
    } catch (_) {}
    mixedStream = null;
    micStream = null;
  }

  async function startRecording() {
    if (recording) return;
    const canvas = getCanvas?.();
    if (!canvas || typeof canvas.captureStream !== "function") {
      setStatus(false, "This browser cannot record the viewport canvas.");
      return;
    }
    if (!window.MediaRecorder) {
      setStatus(false, "MediaRecorder is not available in this browser.");
      return;
    }

    prefs = readPrefs();
    const fps = prefs.fps;
    const bitrate = BITRATES[prefs.quality] || BITRATES.high;
    const mimeType = pickMimeType();

    let canvasStream;
    try {
      canvasStream = canvas.captureStream(fps);
    } catch (err) {
      setStatus(false, err.message || "Could not capture viewport stream.");
      return;
    }

    const tracks = [...canvasStream.getVideoTracks()];
    if (prefs.mic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
        });
        tracks.push(...micStream.getAudioTracks());
      } catch {
        setStatus(false, "Microphone permission denied — recording video only.");
        prefs = writePrefs({ mic: false });
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
      cleanupStreams();
      recorder = null;
      if (blob.size > 0) {
        void openShareModal(blob);
        setStatus(true, `${qualityLabel(prefs.quality)} clip ready — download or share to X.`);
      } else {
        setStatus(false, "Recording was empty — nothing saved.");
      }
      recording = false;
      clearInterval(tickTimer);
      tickTimer = 0;
      syncMainUi();
      syncMenuUi();
    };

    try {
      recorder.start(250);
    } catch (err) {
      cleanupStreams();
      recorder = null;
      setStatus(false, err.message || "Could not start recording.");
      return;
    }

    recording = true;
    startedAt = Date.now();
    clearInterval(tickTimer);
    tickTimer = window.setInterval(() => syncMainUi(), 250);
    closeMenu();
    syncMainUi();
    setStatus(true, `Recording… ${qualityLabel(prefs.quality)} @ ${fps} fps`);
  }

  async function stopRecording({ silent = false } = {}) {
    if (!recording) return;
    clearInterval(tickTimer);
    tickTimer = 0;
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else {
        recording = false;
        cleanupStreams();
        syncMainUi();
      }
    } catch (err) {
      recording = false;
      cleanupStreams();
      syncMainUi();
      if (!silent) setStatus(false, err.message || "Could not stop recording.");
    }
  }

  async function toggleRecording() {
    if (recording) await stopRecording();
    else await startRecording();
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
    isRecording: () => recording,
    closeMenu,
    openShareModal,
  };
}
