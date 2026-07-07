/**
 * Wiring Debug Dashboard
 * Persistent split-panel inside the wiring workspace with a multi-turn chat
 * interface. Attaches to #wiring-debug-panel in index.html.
 */

import { mountFocusDiagram } from "./wiring-focus-diagram.js?v=20260619-readable";

const WDBG_STORAGE_PREFIX = "render3d:wdbg:v1:";

function wdbgStorageKey(projectId) {
  return `${WDBG_STORAGE_PREFIX}${projectId}`;
}

const SEVERITY_META = {
  error:   { icon: "✕", label: "Error",      cls: "wdbg-sev-error" },
  warning: { icon: "⚠", label: "Warning",   cls: "wdbg-sev-warning" },
  info:    { icon: "ℹ", label: "Info",       cls: "wdbg-sev-info" },
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatCostUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return "$0.00";
  const n = Number(value);
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** Resize/compress photos before upload — faster upload + vision processing. */
async function compressPhoto(dataUrl, { maxDim = 1280, quality = 0.82 } = {}) {
  if (!dataUrl || typeof dataUrl !== "string") return { dataUrl, type: "image/jpeg" };
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height, 1));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve({ dataUrl: canvas.toDataURL("image/jpeg", quality), type: "image/jpeg" });
    };
    img.onerror = () => resolve({ dataUrl, type: "image/jpeg" });
    img.src = dataUrl;
  });
}

async function compressPhotos(photos) {
  const out = [];
  for (const p of photos) {
    if (!p?.dataUrl || p.photoMissing) {
      out.push(p);
      continue;
    }
    const compressed = await compressPhoto(p.dataUrl);
    out.push({ ...p, dataUrl: compressed.dataUrl, type: compressed.type });
  }
  return out;
}

// ── Camera capture helper ────────────────────────────────────────────────────
function openCameraCapture(onCapture) {
  const overlay = document.createElement("div");
  overlay.className = "wdbg-camera-overlay";
  overlay.innerHTML = `
    <div class="wdbg-camera-modal">
      <div class="wdbg-camera-header">
        <span>📸 Camera</span>
        <button class="wdbg-camera-close" type="button">✕</button>
      </div>
      <video id="wdbg-cam-video" class="wdbg-cam-video" autoplay playsinline muted></video>
      <canvas id="wdbg-cam-canvas" hidden></canvas>
      <div class="wdbg-camera-actions">
        <button class="wdbg-camera-shoot wdbg-send-btn" type="button">📷 Capture</button>
      </div>
      <p class="wdbg-camera-hint">Position your circuit in frame and tap Capture.</p>
    </div>`;
  document.body.appendChild(overlay);

  const video  = overlay.querySelector("#wdbg-cam-video");
  const canvas = overlay.querySelector("#wdbg-cam-canvas");
  let stream   = null;

  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    .then(s => { stream = s; video.srcObject = s; })
    .catch(() => { overlay.querySelector(".wdbg-camera-hint").textContent = "Camera access denied — use file upload instead."; });

  function close() {
    stream?.getTracks().forEach(t => t.stop());
    overlay.remove();
  }

  overlay.querySelector(".wdbg-camera-close").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

  overlay.querySelector(".wdbg-camera-shoot").addEventListener("click", () => {
    if (!stream) return;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    close();
    onCapture(dataUrl, "camera-capture.jpg");
  });
}

// ── Main factory ─────────────────────────────────────────────────────────────
export function createWiringDebugPanel({ getProjectId, getSchematic, getAiKeyBodyFields, getGenerationSpeed, onApplyFocusDiagram, apiFn }) {
  const panel       = document.getElementById("wiring-debug-panel");
  const chat        = document.getElementById("wdbg-chat");
  const photoRow    = document.getElementById("wdbg-photo-row");
  const fileInput   = document.getElementById("wdbg-file-input");
  const textInput   = document.getElementById("wdbg-text-input");
  const sendBtn     = document.getElementById("wdbg-send-btn");
  const clearBtn    = document.getElementById("wdbg-clear-btn");
  const closeBtn    = document.getElementById("wdbg-close-btn");
  const addPhotoBtn = document.getElementById("wdbg-add-photo-btn");
  const cameraBtn   = document.getElementById("wdbg-camera-btn");
  const schemBadge  = document.getElementById("wdbg-schematic-badge");
  const sessionCostEl = document.getElementById("wdbg-session-cost");
  const schemChk    = document.getElementById("wdbg-include-schematic");
  const contentArea = panel?.closest(".wiring-content-area");
  const debugBtn    = document.getElementById("btn-wiring-photo-debug");

  if (!panel) return { toggle() {}, isOpen() { return false; }, close() {} };

  // Pending attachment images for the current compose
  let pendingPhotos = [];

  // Conversation history (persisted per project in localStorage)
  let history = [];   // [{ role: "user"|"ai", text?, photos?, diagnosis?, error?, costUsd? }]
  let sessionCostUsd = 0;
  let activeStorageProjectId = null;
  let restoringChat = false;
  let diagnosePollTimer = null;
  let inFlightTraceId = null;
  let pendingTraceId = null;
  let activeLoadingBubble = null;

  const DIAGNOSE_POLL_MS = 2000;
  const DIAGNOSE_MAX_MS = 5 * 60 * 1000;

  function _photosForRequest(newPhotos) {
    if (newPhotos.length) {
      return newPhotos.filter((p) => p.dataUrl && !p.photoMissing);
    }
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const entry = history[i];
      if (entry.role === "user" && entry.photos?.length) {
        return entry.photos.filter((p) => p.dataUrl && !p.photoMissing);
      }
    }
    return [];
  }

  function _slimHistoryForStorage(entries) {
    let keptPhotoTurn = -1;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].role === "user" && entries[i].photos?.length) {
        keptPhotoTurn = i;
        break;
      }
    }
    return entries.map((entry, idx) => {
      if (entry.role !== "user" || !entry.photos?.length) return entry;
      if (idx === keptPhotoTurn) return entry;
      return {
        ...entry,
        photos: entry.photos.map((p) => ({
          name: p.name,
          type: p.type,
          dataUrl: "",
          photoMissing: true,
        })),
      };
    });
  }

  function _persistHistory(projectId = activeStorageProjectId) {
    if (!projectId || typeof localStorage === "undefined") return;
    const payload = {
      v: 1,
      sessionCostUsd,
      history: _slimHistoryForStorage(history),
      pendingTraceId,
      savedAt: Date.now(),
    };
    const key = wdbgStorageKey(projectId);
    try {
      localStorage.setItem(key, JSON.stringify(payload));
      return;
    } catch (_) {
      // Photos can exceed quota — keep text + diagnoses, drop image data.
      try {
        localStorage.setItem(key, JSON.stringify({
          ...payload,
          history: history.map((entry) => {
            if (entry.role !== "user" || !entry.photos?.length) return entry;
            return {
              ...entry,
              photos: entry.photos.map((p) => ({
                name: p.name,
                type: p.type,
                dataUrl: "",
                photoMissing: true,
              })),
            };
          }),
        }));
      } catch (_) {
        try { localStorage.removeItem(key); } catch (_) {}
      }
    }
  }

  function _loadPersistedHistory(projectId) {
    if (!projectId || typeof localStorage === "undefined") {
      return { history: [], sessionCostUsd: 0 };
    }
    try {
      const raw = localStorage.getItem(wdbgStorageKey(projectId));
      if (!raw) return { history: [], sessionCostUsd: 0 };
      const data = JSON.parse(raw);
      const entries = Array.isArray(data?.history) ? data.history : [];
      const cleaned = entries.filter((e) => e && (e.role === "user" || e.role === "ai"));
      const cost = Number(data?.sessionCostUsd);
      return {
        history: cleaned,
        sessionCostUsd: Number.isFinite(cost) && cost > 0 ? cost : 0,
        pendingTraceId: data?.pendingTraceId || null,
      };
    } catch (_) {
      return { history: [], sessionCostUsd: 0 };
    }
  }

  function _showWelcome() {
    if (!chat) return;
    chat.innerHTML = `
      <div class="wdbg-welcome">
        <div class="wdbg-welcome-icon">📷</div>
        <div class="wdbg-welcome-title">Circuit Debugger</div>
        <div class="wdbg-welcome-body">Upload a photo of your physical wiring and ask what's wrong. The AI cross-references it against your schematic, returns a fault report, and draws the signal path from your board to the area under review. Analysis runs in the background — safe to refresh.</div>
        <div class="wdbg-welcome-tips">
          <span>💡 Tip: use good lighting</span>
          <span>💡 Multiple photos welcome</span>
          <span>💡 Describe the symptom</span>
        </div>
      </div>`;
  }

  function _restoreChatFromHistory() {
    if (!chat) return;
    if (!history.length) {
      _showWelcome();
      _updateSessionCostDisplay();
      return;
    }
    restoringChat = true;
    chat.innerHTML = "";
    for (const entry of history) {
      if (entry.role === "user") appendUserBubble(entry);
      else if (entry.role === "ai" && entry.diagnosis) appendAiBubble(entry);
      else if (entry.role === "ai" && entry.error) appendErrorBubble(entry.error);
    }
    restoringChat = false;
    chat.lastElementChild?.scrollIntoView({ block: "end" });
    _updateSessionCostDisplay();
  }

  function setProjectId(projectId) {
    if (projectId === activeStorageProjectId) return;
    if (activeStorageProjectId) _persistHistory(activeStorageProjectId);
    activeStorageProjectId = projectId || null;
    if (!projectId) {
      history = [];
      sessionCostUsd = 0;
      pendingPhotos = [];
      renderPhotoRow();
      _showWelcome();
      _updateSessionCostDisplay();
      return;
    }
    const loaded = _loadPersistedHistory(projectId);
    history = loaded.history;
    sessionCostUsd = loaded.sessionCostUsd;
    pendingTraceId = loaded.pendingTraceId;
    pendingPhotos = [];
    renderPhotoRow();
    if (textInput) textInput.value = "";
    _restoreChatFromHistory();
    void _resumePendingDiagnosis(projectId);
  }

  function _historyHasTrace(traceId) {
    if (!traceId) return false;
    return history.some((h) => h.role === "ai" && h.traceId === traceId);
  }

  function stopDiagnosePoll() {
    if (diagnosePollTimer) {
      clearInterval(diagnosePollTimer);
      diagnosePollTimer = null;
    }
  }

  function _setWaitingUi(waiting) {
    if (sendBtn) {
      sendBtn.disabled = waiting;
      sendBtn.innerHTML = waiting
        ? `<span class="wdbg-spinner"></span> Analysing…`
        : `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M2 14V9l6-1-6-1V2l13 6-13 6z"/></svg> Analyse`;
    }
    if (textInput) textInput.disabled = waiting;
    if (!waiting && sendBtn) {
      sendBtn.disabled = pendingPhotos.length === 0 && !textInput?.value.trim();
    }
  }

  function _applyDiagnoseResult(job) {
    const diagnosis = job?.diagnosis;
    const traceId = job?.trace_id || job?.traceId;
    if (!diagnosis) return false;
    if (_historyHasTrace(traceId)) return true;

    activeLoadingBubble?.remove();
    activeLoadingBubble = null;

    const callCost = Number(job?.trace?.ai?.cost_usd);
    if (Number.isFinite(callCost) && callCost > 0) {
      sessionCostUsd += callCost;
      _updateSessionCostDisplay();
    }

    const aiEntry = { role: "ai", diagnosis, traceId, costUsd: callCost };
    history.push(aiEntry);
    appendAiBubble(aiEntry);
    pendingTraceId = null;
    inFlightTraceId = null;
    setTimeout(() => _persistHistory(), 0);
    return true;
  }

  function _clearLoadingBubbles() {
    chat?.querySelectorAll(".wdbg-msg-loading").forEach((el) => el.remove());
    if (activeLoadingBubble) activeLoadingBubble = null;
  }

  async function cancelDiagnosis() {
    stopDiagnosePoll();
    const projectId = getProjectId?.();
    try {
      if (projectId) {
        await apiFn(`/api/projects/${projectId}/wiring/diagnose-photo/cancel`, { method: "POST" });
      }
    } catch (_) {}
    _clearLoadingBubbles();
    pendingTraceId = null;
    inFlightTraceId = null;
    _setWaitingUi(false);
    history.push({ role: "ai", error: "Diagnosis canceled." });
    appendErrorBubble("Diagnosis canceled.");
    setTimeout(() => _persistHistory(), 0);
  }

  async function _pollDiagnoseJob(projectId, traceId, loadingBubble) {
    stopDiagnosePoll();
    inFlightTraceId = traceId;
    pendingTraceId = traceId;
    activeLoadingBubble = loadingBubble;
    _setWaitingUi(true);

    const t0 = Date.now();
    let slowMsgShown = false;

    return new Promise((resolve, reject) => {
      const tick = async () => {
        if (Date.now() - t0 > DIAGNOSE_MAX_MS) {
          stopDiagnosePoll();
          reject(new Error("Diagnosis timed out — try again or switch to a faster model in the account menu."));
          return;
        }
        try {
          const job = await apiFn(`/api/projects/${projectId}/wiring/diagnose-photo/status`);
          if (job.status === "running") {
            if (!slowMsgShown && Date.now() - t0 > 45000) {
              slowMsgShown = true;
              const label = loadingBubble?.querySelector(".wdbg-loading-text");
              if (label) {
                label.textContent = "Still analysing — safe to refresh; result appears when ready…";
              }
            }
            return;
          }
          stopDiagnosePoll();
          if (job.status === "complete") {
            _applyDiagnoseResult(job);
            resolve(job);
          } else {
            reject(new Error(job.error || "Diagnosis failed."));
          }
        } catch (err) {
          stopDiagnosePoll();
          reject(err);
        }
      };

      diagnosePollTimer = setInterval(tick, DIAGNOSE_POLL_MS);
      tick();
    });
  }

  function _lastUserAwaitingReply() {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].role === "ai") return false;
      if (history[i].role === "user") return true;
    }
    return false;
  }

  async function _resumePendingDiagnosis(projectId) {
    if (!projectId) return;
    try {
      const job = await apiFn(`/api/projects/${projectId}/wiring/diagnose-photo/status`);
      if (job.status === "idle") {
        if (pendingTraceId === "starting") return;
        pendingTraceId = null;
        _persistHistory();
        return;
      }
      if (job.status === "complete") {
        if (!_historyHasTrace(job.trace_id)) {
          _applyDiagnoseResult(job);
        } else {
          pendingTraceId = null;
          _persistHistory();
        }
        return;
      }
      if (job.status === "failed") {
        _clearLoadingBubbles();
        if ((pendingTraceId || _lastUserAwaitingReply()) && !_historyHasTrace(job.trace_id)) {
          const msg = job.error || "Diagnosis failed.";
          history.push({ role: "ai", error: msg, traceId: job.trace_id });
          appendErrorBubble(msg);
          pendingTraceId = null;
          _persistHistory();
        } else {
          pendingTraceId = null;
          _persistHistory();
        }
        _setWaitingUi(false);
        return;
      }
      if (job.status !== "running") return;
      if (!pendingTraceId && !_lastUserAwaitingReply()) return;

      const traceId = job.trace_id || pendingTraceId;
      if (_historyHasTrace(traceId)) {
        pendingTraceId = traceId;
        void _pollDiagnoseJob(projectId, traceId, null);
        return;
      }

      let loadingBubble = activeLoadingBubble;
      if (!loadingBubble || !chat?.contains(loadingBubble)) {
        loadingBubble = appendLoadingBubble();
        const label = loadingBubble.querySelector(".wdbg-loading-text");
        if (label) label.textContent = "Resuming analysis… safe to refresh.";
      }
      pendingTraceId = traceId;
      _persistHistory();
      await _pollDiagnoseJob(projectId, traceId, loadingBubble);
    } catch (_) {
      // Server unreachable — keep pendingTraceId for next load
    } finally {
      _setWaitingUi(false);
    }
  }

  function _updateSessionCostDisplay() {
    if (!sessionCostEl) return;
    sessionCostEl.textContent = formatCostUsd(sessionCostUsd);
    sessionCostEl.title = sessionCostUsd > 0
      ? `Estimated total cost for ${history.filter((h) => h.role === "ai").length} debugger prompt(s) this session`
      : "Estimated total cost for this debugger session";
  }

  // ── Open / close ──────────────────────────────────────────────────────────
  function isOpen() { return !panel.hidden; }

  function open() {
    panel.hidden = false;
    contentArea?.classList.add("debug-open");
    debugBtn?.classList.add("active");
    _updateSchemBadge();
    textInput?.focus();
    window.dispatchEvent(new Event("resize"));
  }

  function close() {
    panel.hidden = true;
    contentArea?.classList.remove("debug-open");
    debugBtn?.classList.remove("active");
    window.dispatchEvent(new Event("resize"));
  }

  function toggle() { isOpen() ? close() : open(); }

  // ── Schematic badge ───────────────────────────────────────────────────────
  function _updateSchemBadge() {
    if (!schemBadge) return;
    const s = getSchematic?.();
    const compCount = s?.components?.length ?? 0;
    const wireCount = s?.wires?.length ?? 0;
    if (compCount > 0 || wireCount > 0) {
      schemBadge.hidden = false;
      schemBadge.textContent = `${compCount} part${compCount === 1 ? "" : "s"} · ${wireCount} wire${wireCount === 1 ? "" : "s"}`;
    } else {
      schemBadge.hidden = true;
    }
  }

  // ── Photo management ─────────────────────────────────────────────────────
  function addPhotos(files) {
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    [...files].slice(0, 6 - pendingPhotos.length).forEach(file => {
      if (!allowed.includes(file.type)) return;
      if (file.size > 12 * 1024 * 1024) return;
      const reader = new FileReader();
      reader.onload = () => {
        pendingPhotos.push({ dataUrl: reader.result, name: file.name, type: file.type });
        renderPhotoRow();
      };
      reader.readAsDataURL(file);
    });
  }

  function addPhotoFromDataUrl(dataUrl, name) {
    pendingPhotos.push({ dataUrl, name, type: "image/jpeg" });
    renderPhotoRow();
  }

  function renderPhotoRow() {
    if (!photoRow) return;
    photoRow.innerHTML = pendingPhotos.map((p, i) => `
      <div class="wdbg-thumb" data-idx="${i}">
        <img src="${esc(p.dataUrl)}" alt="${esc(p.name)}" />
        <button class="wdbg-thumb-remove" type="button" title="Remove">✕</button>
      </div>`).join("");
    photoRow.querySelectorAll(".wdbg-thumb-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = +btn.closest(".wdbg-thumb").dataset.idx;
        pendingPhotos.splice(idx, 1);
        renderPhotoRow();
      });
    });
    sendBtn.disabled = pendingPhotos.length === 0 && !textInput?.value.trim();
  }

  // ── Send a message ────────────────────────────────────────────────────────
  async function send() {
    const text    = textInput?.value.trim() ?? "";
    const newPhotos = [...pendingPhotos];
    if (!newPhotos.length && !text) return;
    const projectId = getProjectId?.();
    if (!projectId) {
      appendErrorBubble("Open or create a project before running circuit diagnosis.");
      return;
    }

    const photos = await compressPhotos(_photosForRequest(newPhotos));
    if (!photos.length) {
      appendErrorBubble("Add a circuit photo — the debugger needs an image to analyse.");
      return;
    }

    // Disable input while waiting
    sendBtn.disabled  = true;
    sendBtn.innerHTML = `<span class="wdbg-spinner"></span> Analysing…`;
    textInput.disabled = true;

    // Add user bubble
    const userEntry = { role: "user", text, photos: newPhotos.length ? photos : [] };
    history.push(userEntry);
    appendUserBubble({
      role: "user",
      text,
      photos: newPhotos.length ? photos : [{ name: "Previous photo", photoMissing: true, type: "image/jpeg" }],
    });
    setTimeout(() => _persistHistory(), 0);

    pendingTraceId = "starting";
    setTimeout(() => _persistHistory(), 0);

    // Clear compose area
    pendingPhotos = [];
    renderPhotoRow();
    if (textInput) textInput.value = "";

    // Add loading bubble
    const loadingBubble = appendLoadingBubble();
    const loadingTimer = setTimeout(() => {
      const label = loadingBubble.querySelector(".wdbg-loading-text");
      if (label) label.textContent = "Still analysing — safe to refresh; result appears when ready…";
    }, 45000);

    // Build request - include conversation history as context
    const schematic = schemChk?.checked ? (getSchematic?.() ?? null) : null;
    const contextDescription = _buildContextDescription(text);

    try {
      const body = {
        images: photos.map((p, i) => ({
          id: `dbg-${Date.now()}-${i}`,
          name: p.name || `photo-${i + 1}.jpg`,
          media_type: (p.type || "image/jpeg").replace("image/gif", "image/png"),
          data_url: p.dataUrl,
        })),
        description: contextDescription || null,
        include_schematic: !!schematic,
        speed: getGenerationSpeed?.() || "fast",
        ...(getAiKeyBodyFields?.() || {}),
      };

      const start = await apiFn(
        `/api/projects/${getProjectId()}/wiring/diagnose-photo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        120000,
      );

      const traceId = start.trace_id || start.job?.trace_id;
      pendingTraceId = traceId;
      setTimeout(() => _persistHistory(), 0);

      await _pollDiagnoseJob(getProjectId(), traceId, loadingBubble);
    } catch (err) {
      loadingBubble.remove();
      activeLoadingBubble = null;
      pendingTraceId = null;
      inFlightTraceId = null;
      const msg = typeof formatUserError === "function" ? formatUserError(err) : err.message;
      history.push({ role: "ai", error: msg });
      appendErrorBubble(msg);
      setTimeout(() => _persistHistory(), 0);
    } finally {
      clearTimeout(loadingTimer);
      stopDiagnosePoll();
      activeLoadingBubble = null;
      _setWaitingUi(false);
      textInput?.focus();
    }
  }

  // Include prior AI summary + current question in description for multi-turn context
  function _buildContextDescription(currentText) {
    const parts = [];
    const aiEntries = history.filter(h => h.role === "ai" && h.diagnosis?.overall);
    if (aiEntries.length > 0) {
      const last = aiEntries[aiEntries.length - 1];
      parts.push(`[Prior analysis summary: "${last.diagnosis.overall}"]`);
    }
    if (currentText) parts.push(currentText);
    return parts.join("\n\n") || null;
  }

  // ── Chat bubble renderers ─────────────────────────────────────────────────
  function appendUserBubble({ text, photos }) {
    const el = document.createElement("div");
    el.className = "wdbg-msg wdbg-msg-user";
    let html = "";
    if (photos.length > 0) {
      html += `<div class="wdbg-msg-photos">`;
      photos.forEach(p => {
        if (p.photoMissing || !p.dataUrl) {
          html += `<div class="wdbg-msg-photo wdbg-msg-photo-missing" title="Photo not restored after refresh">📷 ${esc(p.name || "photo")}</div>`;
        } else {
          html += `<img class="wdbg-msg-photo" src="${esc(p.dataUrl)}" alt="${esc(p.name)}" />`;
        }
      });
      html += `</div>`;
    }
    if (text) html += `<div class="wdbg-msg-text">${esc(text)}</div>`;
    el.innerHTML = html;
    _scrollAppend(el);
  }

  function appendAiBubble({ diagnosis: d }) {
    const el = document.createElement("div");
    el.className = "wdbg-msg wdbg-msg-ai";
    el.innerHTML = _renderDiagnosis(d);
    _scrollAppend(el);

    const diagramSlot = el.querySelector(".wdbg-focus-diagram-slot");
    if (diagramSlot && d?.focus_diagram) {
      mountFocusDiagram(diagramSlot, d.focus_diagram, { issues: d.issues || [] });
    }

    el.querySelector(".wdbg-apply-focus-btn")?.addEventListener("click", () => {
      const schematic = d?.focus_diagram?.schematic;
      if (schematic && typeof onApplyFocusDiagram === "function") {
        onApplyFocusDiagram(schematic, { ...d.focus_diagram, issues: d.issues || [] });
      }
    });

    // Wire accordion toggles
    el.querySelectorAll(".wdbg-issue-hdr").forEach(hdr => {
      hdr.addEventListener("click", () => {
        const body = hdr.nextElementSibling;
        const chev = hdr.querySelector(".wdbg-chev");
        const open = body?.classList.toggle("open");
        if (chev) chev.textContent = open ? "▼" : "▶";
      });
      // Auto-expand errors
      if (hdr.closest(".wdbg-sev-error")) hdr.click();
    });
  }

  function appendLoadingBubble() {
    const el = document.createElement("div");
    el.className = "wdbg-msg wdbg-msg-ai wdbg-msg-loading";
    el.innerHTML = `
      <span class="wdbg-spinner"></span>
      <span class="wdbg-loading-text">Analysing your circuit… usually under a minute</span>
      <button type="button" class="wdbg-cancel-btn">Cancel</button>`;
    el.querySelector(".wdbg-cancel-btn")?.addEventListener("click", () => void cancelDiagnosis());
    _scrollAppend(el);
    return el;
  }

  function appendErrorBubble(msg) {
    const el = document.createElement("div");
    el.className = "wdbg-msg wdbg-msg-ai wdbg-msg-error";
    el.innerHTML = `<span class="wdbg-err-icon">⚠</span> ${esc(msg)}`;
    _scrollAppend(el);
  }

  function _scrollAppend(el) {
    chat.appendChild(el);
    if (!restoringChat) el.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  function _renderDiagnosis(d) {
    if (!d) return `<span style="color:#f85149">No diagnosis returned.</span>`;

    const issues   = d.issues || [];
    const correct  = d.correct_wiring || [];
    const detected = d.components_detected || [];
    const errors   = issues.filter(i => i.severity === "error").length;
    const warnings = issues.filter(i => i.severity === "warning").length;
    const infos    = issues.filter(i => i.severity === "info").length;

    let html = `<div class="wdbg-diagnosis">`;

    // Banner
    if (d.safe_to_power === false) {
      html += `<div class="wdbg-banner wdbg-banner-danger">⚠ DO NOT power on — fix errors below first</div>`;
    } else if (issues.length === 0) {
      html += `<div class="wdbg-banner wdbg-banner-ok">✓ No problems detected — circuit looks correct!</div>`;
    } else {
      html += `<div class="wdbg-banner wdbg-banner-warn">⚠ Circuit has warnings — review below</div>`;
    }

    // Summary pills
    if (issues.length > 0) {
      html += `<div class="wdbg-pills">`;
      if (errors)   html += `<span class="wdbg-pill wdbg-pill-error">${errors} error${errors > 1 ? "s" : ""}</span>`;
      if (warnings) html += `<span class="wdbg-pill wdbg-pill-warning">${warnings} warning${warnings > 1 ? "s" : ""}</span>`;
      if (infos)    html += `<span class="wdbg-pill wdbg-pill-info">${infos} suggestion${infos > 1 ? "s" : ""}</span>`;
      html += `</div>`;
    }

    // Overall assessment
    if (d.overall) {
      html += `<div class="wdbg-overall">${esc(d.overall)}</div>`;
    }

    // Focus signal-path diagram (controller → area of interest)
    const focus = d.focus_diagram;
    if (focus?.schematic?.components?.length >= 2) {
      html += `<div class="wdbg-section-title">${esc(focus.title || "Signal path")}</div>`;
      if (focus.caption) {
        html += `<div class="wdbg-focus-caption">${esc(focus.caption)}</div>`;
      }
      html += `<div class="wdbg-focus-diagram-slot" aria-hidden="false"></div>`;
      if (typeof onApplyFocusDiagram === "function") {
        html += `<button type="button" class="wdbg-apply-focus-btn">Open path in wiring canvas</button>`;
      }
    }

    // Issues list
    if (issues.length > 0) {
      html += `<div class="wdbg-section-title">Issues found</div>`;
      issues.forEach((issue, idx) => {
        const sev = SEVERITY_META[issue.severity] || SEVERITY_META.info;
        html += `
          <div class="wdbg-issue ${sev.cls}">
            <div class="wdbg-issue-hdr">
              <span class="wdbg-sev-badge">${esc(sev.icon)} ${esc(sev.label)}</span>
              <span class="wdbg-issue-title">${esc(issue.title || "Issue")}</span>
              <span class="wdbg-chev">▶</span>
            </div>
            <div class="wdbg-issue-body">
              <div class="wdbg-issue-desc">${esc(issue.description || "")}</div>
              ${issue.location ? `<div class="wdbg-issue-loc">📍 ${esc(issue.location)}</div>` : ""}
              ${issue.fix ? `<div class="wdbg-fix-box">${esc(issue.fix)}</div>` : ""}
            </div>
          </div>`;
      });
    }

    // What's correct
    if (correct.length > 0) {
      html += `<div class="wdbg-section-title">What looks correct</div><ul class="wdbg-correct-list">`;
      correct.forEach(c => { html += `<li>${esc(c)}</li>`; });
      html += `</ul>`;
    }

    // Components detected
    if (detected.length > 0) {
      html += `<div class="wdbg-section-title">Components in photo</div><div class="wdbg-detected">`;
      detected.forEach(c => { html += `<span class="wdbg-tag">${esc(c)}</span>`; });
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  // ── Clear conversation ────────────────────────────────────────────────────
  function clearChat() {
    stopDiagnosePoll();
    _clearLoadingBubbles();
    pendingTraceId = null;
    inFlightTraceId = null;
    const pid = activeStorageProjectId;
    if (pid) {
      apiFn(`/api/projects/${pid}/wiring/diagnose-photo/cancel`, { method: "POST" }).catch(() => {});
    }
    inFlightTraceId = null;
    activeLoadingBubble = null;
    if (activeStorageProjectId) {
      try { localStorage.removeItem(wdbgStorageKey(activeStorageProjectId)); } catch (_) {}
    }
    history = [];
    pendingPhotos = [];
    sessionCostUsd = 0;
    _updateSessionCostDisplay();
    renderPhotoRow();
    if (textInput) textInput.value = "";
    _showWelcome();
  }

  // ── Event wiring ──────────────────────────────────────────────────────────
  addPhotoBtn?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", () => {
    if (fileInput.files?.length) addPhotos(fileInput.files);
    fileInput.value = "";
  });

  cameraBtn?.addEventListener("click", () => {
    openCameraCapture((dataUrl, name) => addPhotoFromDataUrl(dataUrl, name));
  });

  // Drag-and-drop photos onto the panel
  panel?.addEventListener("dragover", e => { e.preventDefault(); panel.classList.add("drag-over"); });
  panel?.addEventListener("dragleave", () => panel.classList.remove("drag-over"));
  panel?.addEventListener("drop", e => {
    e.preventDefault();
    panel.classList.remove("drag-over");
    const files = [...(e.dataTransfer?.files ?? [])].filter(f => f.type.startsWith("image/"));
    if (files.length) addPhotos(files);
  });

  // Paste image from clipboard
  document.addEventListener("paste", e => {
    if (!isOpen()) return;
    const items = [...(e.clipboardData?.items ?? [])].filter(i => i.type.startsWith("image/"));
    const blobs = items.map(i => i.getAsFile()).filter(Boolean);
    if (blobs.length) addPhotos(blobs);
  });

  textInput?.addEventListener("input", () => {
    sendBtn.disabled = pendingPhotos.length === 0 && !textInput.value.trim();
  });

  textInput?.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !sendBtn.disabled) {
      e.preventDefault();
      send();
    }
  });

  sendBtn?.addEventListener("click", send);
  clearBtn?.addEventListener("click", clearChat);
  closeBtn?.addEventListener("click", close);

  // Disable send until there's something to send
  if (sendBtn) sendBtn.disabled = true;

  window.addEventListener("beforeunload", () => {
    if (activeStorageProjectId) _persistHistory(activeStorageProjectId);
  });

  return { toggle, isOpen, open, close, setProjectId };
}
