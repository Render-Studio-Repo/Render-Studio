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
} = {}) {
  let prefs = readPrefs();
  let recorder = null;
  let chunks = [];
  let mixedStream = null;
  let micStream = null;
  let startedAt = 0;
  let tickTimer = 0;
  let recording = false;

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
        downloadBlob(blob);
        setStatus(true, `Saved ${qualityLabel(prefs.quality)} viewport video.`);
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
      if (e.key === "Escape") closeMenu();
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
  };
}
