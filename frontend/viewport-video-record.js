/** High-quality viewport video recording — expandable settings next to Screenshot. */

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
  let shareModalEl = null;

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

  function downloadBlob(blob) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = (blob.type || "").includes("mp4") ? "mp4" : "webm";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `render3d-video-${stamp}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
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
      <div class="auth-card app-dialog-card viewport-video-share-card">
        <button type="button" class="auth-close" data-video-share-close aria-label="Close">&times;</button>
        <p class="viewport-video-share-eyebrow">Viewport recording</p>
        <h2 class="app-dialog-title">Share your clip</h2>
        <p class="muted small">Download it, or post straight to X once your account is connected.</p>
        <video class="viewport-video-share-preview" controls playsinline muted></video>
        <label class="viewport-video-share-caption">
          <span>Caption</span>
          <textarea data-video-share-text maxlength="270" rows="3" placeholder="Made in Render3D…"></textarea>
        </label>
        <p class="viewport-video-share-x-status muted small" data-video-share-x-status></p>
        <p class="viewport-video-share-status muted small" data-video-share-status role="status"></p>
        <div class="viewport-video-share-actions">
          <button type="button" class="btn secondary" data-video-share-download>Download</button>
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
      if (lastBlob) downloadBlob(lastBlob);
      setShareStatus("Downloaded.");
    });
    shareModalEl.querySelector("[data-video-share-connect-x]")?.addEventListener("click", () => {
      void connectX();
    });
    shareModalEl.querySelector("[data-video-share-post-x]")?.addEventListener("click", () => {
      void postToX();
    });
    return shareModalEl;
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
        setXStatus("X posting needs TWITTER_CLIENT_ID / SECRET on the server.");
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

  async function connectX() {
    if (!api) {
      setShareStatus("Sign in first.", true);
      return;
    }
    setShareStatus("Opening X authorization…");
    try {
      const data = await api("/api/integrations/twitter/link-url", { method: "POST" });
      if (!data?.url) throw new Error("X authorization URL was not returned.");
      window.location.href = data.url;
    } catch (err) {
      setShareStatus(err?.message || "Could not start X connect.", true);
    }
  }

  async function postToX() {
    if (!lastBlob || !api) {
      setShareStatus("Nothing to post yet.", true);
      return;
    }
    const text = shareModalEl?.querySelector("[data-video-share-text]")?.value?.trim() || "Made in Render3D";
    const postBtn = shareModalEl?.querySelector("[data-video-share-post-x]");
    if (postBtn) postBtn.disabled = true;
    setShareStatus("Uploading to X… this can take a minute for longer clips.");
    try {
      const form = new FormData();
      const ext = (lastBlob.type || "").includes("mp4") ? "mp4" : "webm";
      form.append("video", lastBlob, `render3d-video.${ext}`);
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
      setShareStatus(data?.url ? `Posted — ${data.url}` : "Posted to X.");
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
    const preview = shareModalEl?.querySelector(".viewport-video-share-preview");
    if (preview) {
      preview.removeAttribute("src");
      preview.load?.();
    }
    shareModalEl?.classList.add("hidden");
  }

  async function openShareModal(blob) {
    lastBlob = blob;
    const modal = ensureShareModal();
    const preview = modal.querySelector(".viewport-video-share-preview");
    if (preview) {
      const url = URL.createObjectURL(blob);
      preview.src = url;
      preview.onloadeddata = () => {
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      };
    }
    const text = modal.querySelector("[data-video-share-text]");
    if (text && !text.value) text.value = "Made in Render3D";
    setShareStatus("");
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
