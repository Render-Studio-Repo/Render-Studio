/**
 * Wiring Debug Dashboard
 * Persistent split-panel inside the wiring workspace with a multi-turn chat
 * interface. Attaches to #wiring-debug-panel in index.html.
 */

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
export function createWiringDebugPanel({ getProjectId, getSchematic, apiFn }) {
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
  const schemChk    = document.getElementById("wdbg-include-schematic");
  const contentArea = panel?.closest(".wiring-content-area");
  const debugBtn    = document.getElementById("btn-wiring-photo-debug");

  if (!panel) return { toggle() {}, isOpen() { return false; }, close() {} };

  // Pending attachment images for the current compose
  let pendingPhotos = [];

  // Conversation history (kept in memory for multi-turn context)
  let history = [];   // [{ role: "user"|"ai", text, photos?, diagnosis? }]

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
    const photos  = [...pendingPhotos];
    if (!photos.length && !text) return;
    const projectId = getProjectId?.();
    if (!projectId) {
      appendErrorBubble("Open or create a project before running circuit diagnosis.");
      return;
    }

    // Disable input while waiting
    sendBtn.disabled  = true;
    sendBtn.innerHTML = `<span class="wdbg-spinner"></span> Analysing…`;
    textInput.disabled = true;

    // Add user bubble
    const userEntry = { role: "user", text, photos };
    history.push(userEntry);
    appendUserBubble(userEntry);

    // Clear compose area
    pendingPhotos = [];
    renderPhotoRow();
    if (textInput) textInput.value = "";

    // Add loading bubble
    const loadingBubble = appendLoadingBubble();

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
      };

      const resp = await apiFn(
        `/api/projects/${getProjectId()}/wiring/diagnose-photo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Server error ${resp.status}: ${errText}`);
      }

      const data = await resp.json();
      loadingBubble.remove();

      const aiEntry = { role: "ai", diagnosis: data.diagnosis };
      history.push(aiEntry);
      appendAiBubble(aiEntry);
    } catch (err) {
      loadingBubble.remove();
      appendErrorBubble(err.message);
    } finally {
      sendBtn.disabled  = false;
      sendBtn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M2 14V9l6-1-6-1V2l13 6-13 6z"/></svg> Analyse`;
      textInput.disabled = false;
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
        html += `<img class="wdbg-msg-photo" src="${esc(p.dataUrl)}" alt="${esc(p.name)}" />`;
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
    el.innerHTML = `<span class="wdbg-spinner"></span><span class="wdbg-loading-text">Analysing your circuit…</span>`;
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
    el.scrollIntoView({ behavior: "smooth", block: "end" });
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
    history = [];
    pendingPhotos = [];
    renderPhotoRow();
    if (textInput) textInput.value = "";

    // Restore welcome message
    chat.innerHTML = `
      <div class="wdbg-welcome">
        <div class="wdbg-welcome-icon">📷</div>
        <div class="wdbg-welcome-title">Circuit Debugger</div>
        <div class="wdbg-welcome-body">Upload a photo of your physical wiring and ask what's wrong. The AI cross-references it against your schematic and returns a structured fault report.</div>
        <div class="wdbg-welcome-tips">
          <span>💡 Tip: use good lighting</span>
          <span>💡 Multiple photos welcome</span>
          <span>💡 Describe the symptom</span>
        </div>
      </div>`;
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

  return { toggle, isOpen, open, close };
}
