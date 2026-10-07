const DEFAULT_CHROME = {
  discord_url: "https://discord.gg/Gh8p85YpFc",
  slack_url: "https://join.slack.com/t/renderserver/shared_invite/zt-490s0apzr-K3C9wuQmLfgWjKKVvEnUWg",
  github_url: "https://github.com/wprojects/Render-Studio",
  x_url: "https://x.com/A1_Projects",
};

const KIND_LEAD = {
  bug: "Bugs go to info@render3d.app and Slack #suggestions.",
  idea: "Ideas go to info@render3d.app and Slack #suggestions.",
  business: "Business inquiries go to info@render3d.app only — not Slack.",
};

export const SUGGEST_X_HANDLE = "@A1_Projects";
export const SUGGEST_SENT_CLOSE_MS = 850;
export const SUGGEST_MAX_FILES = 6;
export const SUGGEST_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const SUGGEST_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
export const SUGGEST_ACCEPT_EXT = /\.(png|jpe?g|webp|gif|txt|pdf)$/i;

const DRAW_COLORS = ["#7dd3fc", "#fb923c", "#e2e8f0", "#f87171", "#a78bfa"];

function authHeaders() {
  try {
    const token = localStorage.getItem("render3d:token") || sessionStorage.getItem("render3d:token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export function isSuggestAttachment(file) {
  if (!file) return false;
  const name = String(file.name || "");
  const type = String(file.type || "").toLowerCase();
  if (SUGGEST_ACCEPT_EXT.test(name)) return true;
  return (
    type === "image/png"
    || type === "image/jpeg"
    || type === "image/webp"
    || type === "image/gif"
    || type === "text/plain"
    || type === "application/pdf"
  );
}

export function composeSuggestXText(message, { handle = SUGGEST_X_HANDLE } = {}) {
  const tag = handle.startsWith("@") ? handle : `@${handle}`;
  const note = String(message || "").trim();
  const suffix = `\n\n${tag}`;
  const budget = 280 - suffix.length;
  const fallback = "Feedback for Render Studio";
  const body = note || fallback;
  if (body.length <= budget) return `${body}${suffix}`;
  return `${body.slice(0, Math.max(0, budget - 1))}…${suffix}`;
}

export function composeSuggestXUrl(message) {
  const params = new URLSearchParams();
  params.set("text", composeSuggestXText(message));
  return `https://x.com/intent/post?${params.toString()}`;
}

export function speechRecognitionCtor(win = typeof window !== "undefined" ? window : globalThis) {
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function suggestMicErrorMessage(err) {
  const name = String(err?.name || err?.error || err?.message || err || "");
  if (/NotAllowed|PermissionDenied|not-allowed|SecurityError/i.test(name)) {
    return "Microphone permission denied. Allow the mic for this site, then try again.";
  }
  if (/NotFound|DevicesNotFound|audio-capture/i.test(name)) {
    return "No microphone found.";
  }
  if (/NotSupported|service-not-allowed/i.test(name)) {
    return "Speech recognition is not supported in this browser.";
  }
  if (!name) return "Could not start the microphone.";
  return name;
}

function applyChrome(chrome) {
  const links = {
    discord: chrome.discord_url,
    slack: chrome.slack_url,
    github: chrome.github_url,
    x: chrome.x_url,
  };
  document.querySelectorAll("[data-boot-social]").forEach((el) => {
    const key = el.getAttribute("data-boot-social");
    const href = links[key];
    if (href) el.setAttribute("href", href);
  });
}

function selectedKind() {
  return document.querySelector("#studio-boot-suggest input[name='boot-suggest-kind']:checked")?.value || "idea";
}

function syncKindLead() {
  const lead = document.getElementById("studio-boot-suggest-lead");
  if (!lead) return;
  lead.textContent = KIND_LEAD[selectedKind()] || KIND_LEAD.idea;
}

function setStatus(text, tone = "") {
  const status = document.getElementById("studio-boot-suggest-status");
  if (!status) return;
  status.textContent = text || "";
  status.classList.toggle("is-ok", tone === "ok");
  status.classList.toggle("is-error", tone === "error");
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageAttachment(file) {
  const type = String(file?.type || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(file?.name || "");
}

/** Keep the suggestions dialog on `document.body` so splash removal cannot take it. */
export function pinSuggestOverlay() {
  const modal = document.getElementById("studio-boot-suggest");
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  return modal;
}

function suggestIsOpen() {
  const modal = document.getElementById("studio-boot-suggest");
  return !!(modal && !modal.hidden);
}

function wrapWalkthroughHold() {
  const orig = window.__maybeStartStudioBootWalkthrough;
  if (typeof orig !== "function" || orig.__suggestHoldWrap) return;
  const wrapped = function maybeStartStudioBootWalkthroughHeld() {
    if (document.body.classList.contains("studio-suggest-open") || suggestIsOpen()) {
      wrapped._held = true;
      return;
    }
    orig();
  };
  wrapped.__suggestHoldWrap = true;
  wrapped._held = false;
  window.__maybeStartStudioBootWalkthrough = wrapped;
}

function releaseHeldWalkthrough() {
  const fn = window.__maybeStartStudioBootWalkthrough;
  if (fn?._held) {
    fn._held = false;
    fn();
  }
}

export function mountBootChrome() {
  const pendingFiles = [];
  const previewUrls = [];
  const draw = {
    tool: "pen",
    color: DRAW_COLORS[0],
    drawing: false,
    last: null,
    ctx: null,
  };
  const dictation = {
    rec: null,
    recorder: null,
    stream: null,
    chunks: [],
    committed: "",
    btn: null,
    listening: false,
    mode: "",
  };
  let micWarmed = false;

  function fieldEl() {
    return document.getElementById("studio-boot-suggest-text");
  }

  function talkBtn() {
    return dictation.btn || document.getElementById("studio-boot-suggest-talk");
  }

  function setMicBtnActive(on, btn = talkBtn()) {
    btn?.classList.toggle("mic-active", !!on);
    btn?.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function markTranscribed(field) {
    if (!field) return;
    field.setAttribute("data-transcribed", "1");
    try {
      field.dispatchEvent(new Event("input", { bubbles: true }));
    } catch {
      /* ignore */
    }
  }

  function stopSuggestStream() {
    const stream = dictation.stream;
    dictation.stream = null;
    try {
      stream?.getTracks?.().forEach((track) => track.stop());
    } catch {
      /* ignore */
    }
  }

  function stopSuggestDictation() {
    const rec = dictation.rec;
    dictation.rec = null;
    dictation.listening = false;
    dictation.mode = "";
    if (rec) {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
      } catch {
        /* ignore */
      }
      try { rec.stop(); } catch { /* ignore */ }
      try { rec.abort(); } catch { /* ignore */ }
    }
    const recorder = dictation.recorder;
    dictation.recorder = null;
    if (recorder && recorder.state === "recording") {
      try { recorder.onstop = null; } catch { /* ignore */ }
      try { recorder.stop(); } catch { /* ignore */ }
    }
    dictation.chunks = [];
    stopSuggestStream();
    setMicBtnActive(false, dictation.btn);
    dictation.btn = null;
    try {
      window.__stopPromptDictation?.("studio-boot-suggest-text");
    } catch {
      /* ignore */
    }
  }

  async function warmSuggestMic() {
    if (micWarmed) return;
    micWarmed = true;
    try {
      speechRecognitionCtor();
    } catch {
      /* ignore */
    }
    try {
      await navigator.permissions?.query?.({ name: "microphone" });
    } catch {
      /* permission query is optional; never open a MediaStream just to warm it */
    }
  }

  function startWebSpeech(field, btn, SpeechRecognition) {
    stopSuggestDictation();
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    try {
      rec.lang = navigator.language || "en-US";
    } catch {
      /* ignore */
    }
    const base = field.value || "";
    dictation.committed = base;
    dictation.btn = btn;
    dictation.listening = true;
    dictation.mode = "speech";
    rec.onresult = (event) => {
      let interim = "";
      let finals = base;
      for (const result of event.results) {
        const chunk = result[0]?.transcript || "";
        if (result.isFinal) {
          finals += (finals && !finals.endsWith(" ") ? " " : "") + chunk;
        } else {
          interim += chunk;
        }
      }
      dictation.committed = finals;
      field.value = finals + (interim ? ` ${interim}` : "");
      markTranscribed(field);
    };
    rec.onerror = (event) => {
      const code = String(event?.error || "");
      if (code === "aborted" || code === "no-speech") return;
      if (code === "not-allowed") {
        setStatus(suggestMicErrorMessage("not-allowed"), "error");
        stopSuggestDictation();
        return;
      }
      if (code === "audio-capture") {
        setStatus(suggestMicErrorMessage("audio-capture"), "error");
        stopSuggestDictation();
        return;
      }
      if (window.MediaRecorder && navigator.mediaDevices?.getUserMedia) {
        void startRecorderDictation(field, btn);
        return;
      }
      setStatus(suggestMicErrorMessage(code), "error");
      stopSuggestDictation();
    };
    rec.onend = () => {
      if (dictation.rec !== rec) return;
      field.value = dictation.committed || field.value;
      stopSuggestDictation();
    };
    dictation.rec = rec;
    setMicBtnActive(true, btn);
    try {
      rec.start();
    } catch (err) {
      dictation.listening = false;
      dictation.rec = null;
      setMicBtnActive(false, btn);
      return startRecorderDictation(field, btn);
    }
    return { ok: true, listening: true };
  }

  async function startRecorderDictation(field, btn) {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, error: "This browser cannot use the microphone." };
    }
    if (!window.MediaRecorder) {
      return { ok: false, error: "Speech recognition is not supported in this browser." };
    }
    stopSuggestDictation();
    try {
      dictation.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      return { ok: false, error: suggestMicErrorMessage(err) };
    }
    const mimeCandidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    const mime = mimeCandidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
    let recorder;
    try {
      recorder = mime
        ? new MediaRecorder(dictation.stream, { mimeType: mime })
        : new MediaRecorder(dictation.stream);
    } catch (err) {
      stopSuggestStream();
      return { ok: false, error: suggestMicErrorMessage(err) };
    }
    dictation.chunks = [];
    dictation.recorder = recorder;
    dictation.mode = "recorder";
    dictation.committed = field.value || "";
    dictation.btn = btn;
    dictation.listening = true;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) dictation.chunks.push(event.data);
    };
    try {
      recorder.start(250);
    } catch (err) {
      stopSuggestDictation();
      return { ok: false, error: suggestMicErrorMessage(err) };
    }
    setMicBtnActive(true, btn);
    return { ok: true, listening: true };
  }

  async function stopRecorderDictation(field) {
    const recorder = dictation.recorder;
    if (!recorder) {
      stopSuggestDictation();
      return { ok: true, listening: false };
    }
    setStatus("Transcribing…");
    const blob = await new Promise((resolve) => {
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) dictation.chunks.push(event.data);
      };
      recorder.onstop = () => {
        resolve(new Blob(dictation.chunks.slice(), { type: recorder.mimeType || "audio/webm" }));
      };
      try { recorder.requestData?.(); } catch { /* ignore */ }
      try { recorder.stop(); } catch { resolve(null); }
    });
    dictation.recorder = null;
    dictation.chunks = [];
    stopSuggestStream();
    dictation.listening = false;
    dictation.mode = "";
    setMicBtnActive(false, dictation.btn);
    dictation.btn = null;
    if (!blob || blob.size < 64) {
      return { ok: false, error: "No audio captured — try again." };
    }
    try {
      const form = new FormData();
      const type = blob.type || "audio/webm";
      const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
      form.append("file", blob, `speech.${ext}`);
      const res = await fetch("/api/transcribe", { method: "POST", headers: authHeaders(), body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || data?.error || `Transcribe failed (${res.status})`);
      const text = String(data?.text || "").trim();
      const base = dictation.committed || field?.value || "";
      const next = text ? (base ? `${base.replace(/\s*$/, "")} ${text}` : text) : base;
      if (field) {
        field.value = next;
        if (text) markTranscribed(field);
      }
      if (!text) return { ok: false, error: "No speech detected." };
      return { ok: true, listening: false, text };
    } catch (err) {
      return { ok: false, error: err?.message || "Transcription failed." };
    }
  }

  async function toggleSuggestDictation(btn) {
    const field = fieldEl();
    if (!field) return { ok: false, error: "Note field missing." };
    if (dictation.listening) {
      if (dictation.mode === "recorder" || dictation.recorder) {
        return stopRecorderDictation(field);
      }
      const committed = dictation.committed;
      stopSuggestDictation();
      if (committed) field.value = committed;
      return { ok: true, listening: false, text: committed };
    }
    const SpeechRecognition = speechRecognitionCtor();
    if (SpeechRecognition) {
      return startWebSpeech(field, btn, SpeechRecognition);
    }
    const studioToggle = window.__togglePromptDictation;
    if (typeof studioToggle === "function") {
      try {
        const result = await studioToggle("studio-boot-suggest-text", btn);
        if (result?.ok || result?.listening || result?.error) return result;
      } catch {
        /* fall through to local recorder */
      }
    }
    return startRecorderDictation(field, btn);
  }

  function revokePreviews() {
    for (const url of previewUrls) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    previewUrls.length = 0;
  }

  function totalBytes() {
    return pendingFiles.reduce((sum, file) => sum + (file.size || 0), 0);
  }

  function addFiles(fileList) {
    const incoming = [...(fileList || [])].filter(isSuggestAttachment);
    if ([...(fileList || [])].length && !incoming.length) {
      setStatus("Use images, TXT, or PDF (5 MB each).");
      return;
    }
    for (const file of incoming) {
      if (pendingFiles.length >= SUGGEST_MAX_FILES) {
        setStatus(`Up to ${SUGGEST_MAX_FILES} files.`);
        break;
      }
      if (file.size > SUGGEST_MAX_FILE_BYTES) {
        setStatus(`${file.name} is over ${formatBytes(SUGGEST_MAX_FILE_BYTES)}.`);
        continue;
      }
      if (totalBytes() + file.size > SUGGEST_MAX_TOTAL_BYTES) {
        setStatus(`Attachments cap is ${formatBytes(SUGGEST_MAX_TOTAL_BYTES)}.`);
        break;
      }
      const dup = pendingFiles.some((f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
      if (dup) continue;
      pendingFiles.push(file);
    }
    renderFiles();
  }

  function removeFile(index) {
    pendingFiles.splice(index, 1);
    renderFiles();
  }

  function renderFiles() {
    const host = document.getElementById("studio-boot-suggest-file-list");
    if (!host) return;
    revokePreviews();
    if (!pendingFiles.length) {
      host.innerHTML = "";
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = pendingFiles.map((file, index) => {
      const image = isImageAttachment(file);
      const thumb = image ? URL.createObjectURL(file) : "";
      if (thumb) previewUrls.push(thumb);
      return `<li class="studio-boot-suggest-file">
        ${image
          ? `<img src="${thumb}" alt="" />`
          : `<span class="studio-boot-suggest-file-glyph">${/\.pdf$/i.test(file.name) ? "PDF" : "TXT"}</span>`}
        <span class="studio-boot-suggest-file-meta">
          <span class="studio-boot-suggest-file-name">${esc(file.name)}</span>
          <span class="studio-boot-suggest-file-size">${formatBytes(file.size)}</span>
        </span>
        ${image ? `<button type="button" class="studio-boot-suggest-file-act" data-markup="${index}">Mark</button>` : ""}
        <button type="button" class="studio-boot-suggest-file-act" data-remove="${index}" aria-label="Remove ${esc(file.name)}">×</button>
      </li>`;
    }).join("");
    host.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        removeFile(Number(btn.dataset.remove));
      });
    });
    host.querySelectorAll("[data-markup]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const file = pendingFiles[Number(btn.dataset.markup)];
        if (file) void openDrawWithImage(file);
      });
    });
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function canvasEl() {
    return document.getElementById("studio-boot-suggest-canvas");
  }

  function ensureDrawCtx() {
    const canvas = canvasEl();
    if (!canvas) return null;
    if (draw.ctx && draw.ctx.canvas === canvas) return draw.ctx;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    draw.ctx = ctx;
    if (!canvas.dataset.ready) {
      fillDrawBackdrop(ctx, canvas);
      canvas.dataset.ready = "1";
    }
    return ctx;
  }

  function fillDrawBackdrop(ctx, canvas) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(125, 211, 252, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 20; x < canvas.width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 20; y < canvas.height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function setDrawOpen(open) {
    const panel = document.getElementById("studio-boot-suggest-draw-panel");
    const btn = document.getElementById("studio-boot-suggest-draw");
    panel?.classList.toggle("hidden", !open);
    btn?.classList.toggle("is-active", !!open);
    btn?.setAttribute("aria-pressed", open ? "true" : "false");
    if (open) ensureDrawCtx();
  }

  function canvasPoint(event) {
    const canvas = canvasEl();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  }

  function strokeTo(pt) {
    const ctx = ensureDrawCtx();
    if (!ctx || !draw.last) {
      draw.last = pt;
      return;
    }
    ctx.save();
    if (draw.tool === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = 18;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = draw.color;
      ctx.lineWidth = 2.6;
    }
    ctx.beginPath();
    ctx.moveTo(draw.last.x, draw.last.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    ctx.restore();
    draw.last = pt;
  }

  async function openDrawWithImage(file) {
    setDrawOpen(true);
    const ctx = ensureDrawCtx();
    const canvas = canvasEl();
    if (!ctx || !canvas) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not load image"));
        image.src = url;
      });
      fillDrawBackdrop(ctx, canvas);
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      canvas.dataset.ready = "1";
      setStatus("Mark up the image, then Add sketch.");
    } catch {
      setStatus("Could not open that image for markup.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function addSketchFile() {
    const canvas = canvasEl();
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus("Could not save sketch.");
        return;
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      addFiles([new File([blob], `sketch-${stamp}.png`, { type: "image/png" })]);
      setStatus("Sketch attached.");
    }, "image/png");
  }

  function syncXShareHref() {
    const link = document.getElementById("studio-boot-suggest-x");
    if (!link) return;
    link.href = composeSuggestXUrl(fieldEl()?.value || "");
  }

  function openXShare(event) {
    event?.preventDefault();
    const url = composeSuggestXUrl(fieldEl()?.value || "");
    const link = document.getElementById("studio-boot-suggest-x");
    if (link) link.href = url;
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setStatus("Opened X compose with @A1_Projects.");
  }

  let closeAfterSentTimer = 0;

  function resetSuggestSendUi() {
    const sendBtn = document.getElementById("studio-boot-suggest-send");
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
      sendBtn.classList.remove("is-sent");
    }
    document.querySelector(".studio-boot-suggest-card")?.classList.remove("is-sent");
    setStatus("");
  }

  function closeSuggest() {
    revokePreviews(); // leakfix31
    if (closeAfterSentTimer) {
      window.clearTimeout(closeAfterSentTimer);
      closeAfterSentTimer = 0;
    }
    const modal = pinSuggestOverlay();
    if (modal) modal.hidden = true;
    modal?.classList.remove("studio-boot-suggest--after-boot", "is-open");
    document.body.classList.remove("studio-suggest-open");
    setDrawOpen(false);
    resetSuggestSendUi();
    stopSuggestDictation();
    try {
      window.dispatchEvent(new Event("render3d:suggest-closed"));
    } catch {
      /* ignore */
    }
    releaseHeldWalkthrough();
  }

  function openSuggest() {
    const modal = pinSuggestOverlay();
    if (!modal) return;
    wrapWalkthroughHold();
    modal.hidden = false;
    modal.classList.add("is-open");
    if (!document.getElementById("studio-boot-screen") || document.getElementById("studio-boot-screen")?.classList.contains("is-done")) {
      modal.classList.add("studio-boot-suggest--after-boot");
    }
    document.body.classList.add("studio-suggest-open");
    resetSuggestSendUi();
    syncKindLead();
    syncXShareHref();
    ensureDrawCtx();
    void warmSuggestMic();
    fieldEl()?.focus();
  }

  function persistAfterBoot() {
    wrapWalkthroughHold();
    const modal = pinSuggestOverlay();
    if (!modal || modal.hidden) return;
    modal.classList.add("is-open", "studio-boot-suggest--after-boot");
    document.body.classList.add("studio-suggest-open");
  }

  async function sendSuggestion() {
    const field = fieldEl();
    const kind = selectedKind();
    const message = (field?.value || "").trim();
    const sendBtn = document.getElementById("studio-boot-suggest-send");
    if (message.length < 4) {
      setStatus("Say or type a bit more before sending.", "error");
      return;
    }
    setStatus("Sending…");
    if (sendBtn) sendBtn.disabled = true;
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("message", message);
      form.append("page_url", window.location.href);
      form.append("transcribed", field?.getAttribute("data-transcribed") === "1" ? "1" : "0");
      for (const file of pendingFiles) form.append("files", file, file.name);
      const res = await fetch("/api/site/suggestions", {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.detail || data.error || "Could not send");
      }
      setStatus("Sent", "ok");
      if (sendBtn) {
        sendBtn.textContent = "Sent";
        sendBtn.classList.add("is-sent");
        sendBtn.disabled = true;
      }
      document.querySelector(".studio-boot-suggest-card")?.classList.add("is-sent");
      if (field) field.value = "";
      field?.removeAttribute("data-transcribed");
      pendingFiles.length = 0;
      renderFiles();
      const canvas = canvasEl();
      const ctx = ensureDrawCtx();
      if (canvas && ctx) {
        fillDrawBackdrop(ctx, canvas);
        canvas.dataset.ready = "1";
      }
      syncXShareHref();
      if (closeAfterSentTimer) window.clearTimeout(closeAfterSentTimer);
      closeAfterSentTimer = window.setTimeout(() => {
        closeAfterSentTimer = 0;
        closeSuggest();
      }, SUGGEST_SENT_CLOSE_MS);
    } catch (err) {
      setStatus(err.message || "Could not send", "error");
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
        sendBtn.classList.remove("is-sent");
      }
    }
  }

  function bindSuggestMic() {
    const btn = document.getElementById("studio-boot-suggest-talk");
    const field = fieldEl();
    field?.addEventListener("input", () => {
      syncXShareHref();
      if (field.getAttribute("data-transcribed") === "1") return;
      if (btn?.classList.contains("mic-active")) field.setAttribute("data-transcribed", "1");
    });
    btn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void toggleSuggestDictation(btn).then((result) => {
        if (result?.listening) setStatus("Listening…");
        else if (result?.ok && result?.text) {
          setStatus("Review the transcript, then send.");
          syncXShareHref();
        } else if (result?.error) setStatus(result.error, "error");
        else if (result?.ok) {
          syncXShareHref();
          if (fieldEl()?.value) setStatus("Review the transcript, then send.");
          else setStatus("");
        }
      });
    });
  }

  function bindDraw() {
    const canvas = canvasEl();
    document.getElementById("studio-boot-suggest-draw")?.addEventListener("click", () => {
      const panel = document.getElementById("studio-boot-suggest-draw-panel");
      setDrawOpen(panel?.classList.contains("hidden"));
    });
    document.getElementById("studio-boot-suggest-draw-clear")?.addEventListener("click", () => {
      const ctx = ensureDrawCtx();
      const el = canvasEl();
      if (ctx && el) fillDrawBackdrop(ctx, el);
    });
    document.getElementById("studio-boot-suggest-draw-add")?.addEventListener("click", addSketchFile);
    document.querySelectorAll("[data-draw-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        draw.tool = btn.getAttribute("data-draw-tool") || "pen";
        document.querySelectorAll("[data-draw-tool]").forEach((el) => {
          el.classList.toggle("is-active", el === btn);
          el.setAttribute("aria-pressed", el === btn ? "true" : "false");
        });
      });
    });
    document.querySelectorAll("[data-draw-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        draw.color = btn.getAttribute("data-draw-color") || DRAW_COLORS[0];
        document.querySelectorAll("[data-draw-color]").forEach((el) => el.classList.toggle("is-active", el === btn));
      });
    });
    if (!canvas) return;
    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      draw.drawing = true;
      draw.last = canvasPoint(event);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!draw.drawing) return;
      event.preventDefault();
      const pt = canvasPoint(event);
      if (pt) strokeTo(pt);
    });
    const stopDraw = (event) => {
      if (!draw.drawing) return;
      draw.drawing = false;
      draw.last = null;
      try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    };
    canvas.addEventListener("pointerup", stopDraw);
    canvas.addEventListener("pointercancel", stopDraw);
    canvas.addEventListener("pointerleave", stopDraw);
  }

  function bindDrop() {
    const drop = document.getElementById("studio-boot-suggest-drop") || document.querySelector(".studio-boot-suggest-card");
    const input = document.getElementById("studio-boot-suggest-files");
    document.getElementById("studio-boot-suggest-browse")?.addEventListener("click", () => input?.click());
    input?.addEventListener("change", () => {
      addFiles(input.files);
      input.value = "";
    });
    ["dragenter", "dragover"].forEach((type) => {
      drop?.addEventListener(type, (ev) => {
        if (![...(ev.dataTransfer?.types || [])].includes("Files")) return;
        ev.preventDefault();
        ev.stopPropagation();
        drop.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      drop?.addEventListener(type, (ev) => {
        ev.preventDefault();
        drop.classList.remove("is-dragover");
      });
    });
    drop?.addEventListener("drop", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      addFiles(ev.dataTransfer?.files);
    });
  }

  applyChrome(DEFAULT_CHROME);
  fetch("/api/site/boot-chrome")
    .then((res) => (res.ok ? res.json() : DEFAULT_CHROME))
    .then((data) => applyChrome({ ...DEFAULT_CHROME, ...(data || {}) }))
    .catch(() => {});

  pinSuggestOverlay();
  wrapWalkthroughHold();
  document.getElementById("studio-boot-suggest-open")?.addEventListener("click", openSuggest);
  document.getElementById("studio-boot-suggest-pc")?.addEventListener("click", openSuggest);
  document.getElementById("btn-suggestion")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    openSuggest();
  });
  document.getElementById("studio-boot-suggest-close")?.addEventListener("click", closeSuggest);
  document.getElementById("studio-boot-suggest-send")?.addEventListener("click", () => {
    void sendSuggestion();
  });
  document.getElementById("studio-boot-suggest-x")?.addEventListener("click", openXShare);
  document.querySelectorAll("#studio-boot-suggest input[name='boot-suggest-kind']").forEach((input) => {
    input.addEventListener("change", syncKindLead);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = document.getElementById("studio-boot-suggest");
    if (!modal || modal.hidden) return;
    event.preventDefault();
    closeSuggest();
  });
  window.addEventListener("render3d:studio-ready", persistAfterBoot);
  bindSuggestMic();
  bindDraw();
  bindDrop();
  syncKindLead();
  syncXShareHref();
  void warmSuggestMic();
  window.__openStudioSuggest = openSuggest;
  window.__closeStudioSuggest = closeSuggest;
  window.__pinStudioSuggest = pinSuggestOverlay;
}

if (typeof document !== "undefined") {
  mountBootChrome();
}
