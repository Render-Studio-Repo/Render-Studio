/**
 * Canvas mode — freehand drawing on a 2D grid. Sketch is sent to the main AI prompt on Generate.
 */

const GRID_MINOR = 20;
const GRID_MAJOR = 100;
const BG_COLOR = "#0d1117";
const GRID_MINOR_COLOR = "rgba(88, 166, 255, 0.12)";
const GRID_MAJOR_COLOR = "rgba(88, 166, 255, 0.28)";
const CANVAS_TAGS = [
  "Robot",
  "Building",
  "Arm",
  "Wheel",
  "Base",
  "Door",
  "Window",
  "Sensor",
  "Motor",
  "Floor",
];

export function createCanvasMode({ containerEl, voiceEls, onTranscriptChange } = {}) {
  let canvas, ctx;
  let tool = "pen";
  let color = "#58a6ff";
  let strokeWidth = 3;
  let drawing = false;
  let startPt = null;
  let snapshot = null;
  let history = [];
  let redoStack = [];
  let voiceTranscript = "";
  let mediaRecorder = null;
  let recognizing = false;
  let recognition = null;
  let audioChunks = [];
  let recordingStartTime = null;
  let recordingTimer = null;
  let textInput = null;
  let elements = [];
  let activeElement = null;
  let tagMenu = null;

  function isActive() {
    return document.body.classList.contains("canvas-design-tab")
      && !containerEl?.classList.contains("hidden")
      && !containerEl?.closest(".canvas-workspace-wrap")?.classList.contains("hidden");
  }

  function drawGridBackground() {
    if (!ctx || !canvas) return;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let x = 0; x <= canvas.width; x += GRID_MINOR) {
      ctx.strokeStyle = x % GRID_MAJOR === 0 ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR;
      ctx.lineWidth = x % GRID_MAJOR === 0 ? 1.2 : 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += GRID_MINOR) {
      ctx.strokeStyle = y % GRID_MAJOR === 0 ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR;
      ctx.lineWidth = y % GRID_MAJOR === 0 ? 1.2 : 1;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
      ctx.stroke();
    }
  }

  function init() {
    if (!containerEl) return;
    containerEl.innerHTML = `
      <div class="canvas-workspace">
        <div class="canvas-area" id="canvas-draw-area">
          <div class="canvas-toolbar-popup" role="toolbar" aria-label="Drawing tools">
            <div class="canvas-tool-group">
              <button class="canvas-tool-btn active" data-tool="pen" title="Pen (P)">✏️ Pen</button>
              <button class="canvas-tool-btn" data-tool="eraser" title="Eraser (E)">🧹</button>
            </div>
            <div class="canvas-tool-sep"></div>
            <div class="canvas-tool-group">
              <button class="canvas-tool-btn" data-tool="line" title="Line (L)">╱</button>
              <button class="canvas-tool-btn" data-tool="arrow" title="Arrow (A)">→</button>
              <button class="canvas-tool-btn" data-tool="rect" title="Rectangle (R)">▭</button>
              <button class="canvas-tool-btn" data-tool="circle" title="Circle (C)">○</button>
              <button class="canvas-tool-btn" data-tool="text" title="Text (T)">T</button>
            </div>
            <div class="canvas-tool-sep"></div>
            <div class="canvas-tool-group canvas-color-group">
              <input type="color" id="canvas-color-pick" class="canvas-color-pick" value="${color}" title="Stroke color" />
              <div class="canvas-preset-colors">
                <button class="canvas-preset" data-color="#58a6ff" style="background:#58a6ff" title="Blue"></button>
                <button class="canvas-preset" data-color="#f85149" style="background:#f85149" title="Red"></button>
                <button class="canvas-preset" data-color="#3fb950" style="background:#3fb950" title="Green"></button>
                <button class="canvas-preset" data-color="#d29922" style="background:#d29922" title="Yellow"></button>
                <button class="canvas-preset" data-color="#bc8cff" style="background:#bc8cff" title="Purple"></button>
                <button class="canvas-preset" data-color="#ffffff" style="background:#ffffff" title="White"></button>
              </div>
            </div>
            <div class="canvas-tool-sep"></div>
            <div class="canvas-tool-group">
              <label class="canvas-stroke-label" title="Stroke width">
                <span>W</span>
                <input type="range" id="canvas-stroke-width" min="1" max="24" value="${strokeWidth}" class="canvas-stroke-range" />
                <span id="canvas-stroke-val">${strokeWidth}px</span>
              </label>
            </div>
            <div class="canvas-tool-sep"></div>
            <div class="canvas-tool-group">
              <button class="canvas-tool-btn" id="canvas-undo-btn" title="Undo (⌘Z)" disabled>↶</button>
              <button class="canvas-tool-btn" id="canvas-redo-btn" title="Redo (⌘⇧Z)" disabled>↷</button>
              <button class="canvas-tool-btn canvas-clear-btn" id="canvas-clear-btn" title="Clear canvas">🗑</button>
              <button class="canvas-tool-btn" id="canvas-attach-prompt-btn" title="Attach sketch to AI prompt">📎 Prompt</button>
            </div>
          </div>
          <canvas id="canvas-draw" class="canvas-draw"></canvas>
          <div class="canvas-tag-layer" id="canvas-tag-layer" aria-label="Canvas shape tags"></div>
        </div>
      </div>`;

    canvas = containerEl.querySelector("#canvas-draw");
    ctx = canvas.getContext("2d");
    resizeCanvas();

    bindToolbar();
    bindCanvas();
    bindVoice();
    bindKeyboard();
    bindActions();
    updateUndoRedo();

    const ro = new ResizeObserver(() => resizeCanvasKeepContent());
    ro.observe(containerEl.querySelector("#canvas-draw-area"));
  }

  function resizeCanvas() {
    const area = containerEl.querySelector("#canvas-draw-area");
    if (!area || !canvas) return;
    canvas.width = area.clientWidth || 900;
    canvas.height = area.clientHeight || 600;
    drawGridBackground();
  }

  function resizeCanvasKeepContent() {
    const area = containerEl.querySelector("#canvas-draw-area");
    if (!area || !canvas) return;
    const w = area.clientWidth;
    const h = area.clientHeight;
    if (canvas.width === w && canvas.height === h) return;
    const saved = canvas.toDataURL();
    canvas.width = w;
    canvas.height = h;
    const img = new Image();
    img.onload = () => {
      drawGridBackground();
      ctx.drawImage(img, 0, 0, w, h);
      renderTagBadges();
    };
    img.src = saved;
  }

  function bindToolbar() {
    containerEl.querySelectorAll("[data-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        tool = btn.dataset.tool;
        containerEl.querySelectorAll("[data-tool]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        updateCursor();
        dismissTextInput();
      });
    });

    const colorPick = containerEl.querySelector("#canvas-color-pick");
    colorPick?.addEventListener("input", () => { color = colorPick.value; });

    containerEl.querySelectorAll(".canvas-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        color = btn.dataset.color;
        if (colorPick) colorPick.value = color;
      });
    });

    const strokeRange = containerEl.querySelector("#canvas-stroke-width");
    const strokeVal = containerEl.querySelector("#canvas-stroke-val");
    strokeRange?.addEventListener("input", () => {
      strokeWidth = parseInt(strokeRange.value, 10);
      if (strokeVal) strokeVal.textContent = `${strokeWidth}px`;
    });

    containerEl.querySelector("#canvas-undo-btn")?.addEventListener("click", undo);
    containerEl.querySelector("#canvas-redo-btn")?.addEventListener("click", redo);
    containerEl.querySelector("#canvas-clear-btn")?.addEventListener("click", clearCanvas);
    containerEl.querySelector("#canvas-attach-prompt-btn")?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("canvas:attach-sketch"));
    });
  }

  function updateCursor() {
    if (!canvas) return;
    const cursors = { pen: "crosshair", eraser: "cell", text: "text", default: "crosshair" };
    canvas.style.cursor = cursors[tool] || cursors.default;
  }

  function cloneElements() {
    return elements.map((el) => ({ ...el, bounds: { ...(el.bounds || {}) } }));
  }

  function pushHistory() {
    history.push({ dataUrl: canvas.toDataURL(), elements: cloneElements() });
    if (history.length > 60) history.shift();
    redoStack = [];
    updateUndoRedo();
  }

  function undo() {
    if (!history.length) return;
    redoStack.push({ dataUrl: canvas.toDataURL(), elements: cloneElements() });
    restoreSnapshot(history.pop());
    updateUndoRedo();
  }

  function redo() {
    if (!redoStack.length) return;
    history.push({ dataUrl: canvas.toDataURL(), elements: cloneElements() });
    restoreSnapshot(redoStack.pop());
    updateUndoRedo();
  }

  function restoreSnapshot(state) {
    if (!state) return;
    elements = (state.elements || []).map((el) => ({ ...el, bounds: { ...(el.bounds || {}) } }));
    restoreDataUrl(state.dataUrl);
    renderTagBadges();
  }

  function restoreDataUrl(url) {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = url;
  }

  function updateUndoRedo() {
    const u = containerEl?.querySelector("#canvas-undo-btn");
    const r = containerEl?.querySelector("#canvas-redo-btn");
    if (u) u.disabled = !history.length;
    if (r) r.disabled = !redoStack.length;
  }

  function clearCanvas() {
    if (!canvas) return;
    pushHistory();
    drawGridBackground();
    elements = [];
    closeTagMenu();
    renderTagBadges();
  }

  function pt(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches?.[0] ?? e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  function bindCanvas() {
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onUp);
    canvas.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("click", (event) => {
      if (!tagMenu || tagMenu.contains(event.target)) return;
      closeTagMenu();
    });
  }

  function onDown(e) {
    if (e.button === 2) return;
    closeTagMenu();
    if (tool === "text") { placeTextInput(pt(e)); return; }
    drawing = true;
    startPt = pt(e);
    activeElement = {
      id: `canvas-el-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: tool,
      color,
      strokeWidth,
      bounds: pointBounds(startPt),
    };
    pushHistory();
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (tool === "pen" || tool === "eraser") {
      ctx.beginPath();
      ctx.moveTo(startPt.x, startPt.y);
    }
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onMove(e) {
    if (!drawing) return;
    const cur = pt(e);
    if (activeElement) activeElement.bounds = mergeBounds(activeElement.bounds, pointBounds(cur));
    if (tool === "pen") {
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "source-over";
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
    } else if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = strokeWidth * 4;
      ctx.lineCap = "round";
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.putImageData(snapshot, 0, 0);
      drawShape(tool, startPt, cur);
    }
  }

  function onUp(e) {
    if (!drawing) return;
    drawing = false;
    if (tool !== "pen" && tool !== "eraser" && snapshot) {
      ctx.putImageData(snapshot, 0, 0);
      const end = pt(e);
      drawShape(tool, startPt, end);
      if (activeElement) activeElement.bounds = boundsFromPoints(startPt, end);
    }
    if (activeElement && tool !== "eraser" && meaningfulBounds(activeElement.bounds)) {
      elements.push(activeElement);
      renderTagBadges();
    }
    activeElement = null;
    snapshot = null;
    ctx.globalCompositeOperation = "source-over";
  }

  function pointBounds(p) {
    return { x: p.x, y: p.y, w: 0, h: 0 };
  }

  function boundsFromPoints(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  function mergeBounds(a, b) {
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x + a.w, b.x + b.w);
    const maxY = Math.max(a.y + a.h, b.y + b.h);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function meaningfulBounds(bounds = {}) {
    return Math.max(Number(bounds.w) || 0, Number(bounds.h) || 0) > 4;
  }

  function findElementAt(pos) {
    const pad = 12;
    for (let i = elements.length - 1; i >= 0; i -= 1) {
      const el = elements[i];
      const b = el.bounds || {};
      if (
        pos.x >= b.x - pad
        && pos.x <= b.x + b.w + pad
        && pos.y >= b.y - pad
        && pos.y <= b.y + b.h + pad
      ) return el;
    }
    return null;
  }

  function onContextMenu(event) {
    event.preventDefault();
    const target = findElementAt(pt(event));
    if (!target) {
      closeTagMenu();
      return;
    }
    showTagMenu(target, event.clientX, event.clientY);
  }

  function drawShape(shapeType, a, b) {
    ctx.strokeStyle = color;
    ctx.fillStyle = "transparent";
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "source-over";
    if (shapeType === "rect") {
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    } else if (shapeType === "circle") {
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shapeType === "line") {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (shapeType === "arrow") {
      const headLen = Math.max(10, strokeWidth * 4);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
  }

  function placeTextInput(pos) {
    dismissTextInput();
    pushHistory();
    const area = containerEl.querySelector("#canvas-draw-area");
    textInput = document.createElement("textarea");
    textInput.className = "canvas-text-input";
    textInput.style.left = `${pos.x}px`;
    textInput.style.top = `${pos.y - 4}px`;
    textInput.style.color = color;
    textInput.style.fontSize = `${Math.max(14, strokeWidth * 5)}px`;
    textInput.placeholder = "Type…";
    area.appendChild(textInput);
    textInput.focus();
    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") dismissTextInput();
      if (e.key === "Enter" && !e.shiftKey) { commitTextInput(pos); e.preventDefault(); }
      e.stopPropagation();
    });
    textInput.addEventListener("blur", () => commitTextInput(pos));
  }

  function commitTextInput(pos) {
    if (!textInput) return;
    const text = textInput.value.trim();
    const fontSize = parseInt(textInput.style.fontSize, 10) || 18;
    textInput.remove();
    textInput = null;
    if (!text) return;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = color;
    ctx.globalCompositeOperation = "source-over";
    const lines = text.split("\n");
    lines.forEach((line, i) => ctx.fillText(line, pos.x, pos.y + i * (fontSize + 4)));
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width), 24);
    elements.push({
      id: `canvas-el-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: "text",
      text,
      color,
      strokeWidth,
      bounds: { x: pos.x, y: pos.y - fontSize, w: width, h: lines.length * (fontSize + 4) },
    });
    renderTagBadges();
  }

  function dismissTextInput() {
    if (textInput) { textInput.remove(); textInput = null; }
  }

  function closeTagMenu() {
    tagMenu?.remove();
    tagMenu = null;
  }

  function showTagMenu(element, clientX, clientY) {
    closeTagMenu();
    tagMenu = document.createElement("div");
    tagMenu.className = "canvas-tag-menu";
    tagMenu.style.left = `${Math.min(window.innerWidth - 220, Math.max(8, clientX))}px`;
    tagMenu.style.top = `${Math.min(window.innerHeight - 280, Math.max(8, clientY))}px`;
    tagMenu.innerHTML = `
      <strong>Tag this shape</strong>
      <span>Tell AI what this drawing represents.</span>
      <div class="canvas-tag-options">
        ${CANVAS_TAGS.map((tag) => `<button type="button" data-canvas-tag="${tag}">${tag}</button>`).join("")}
        <button type="button" data-canvas-tag-custom>Other…</button>
        ${element.tag ? `<button type="button" data-canvas-tag-clear>Clear tag</button>` : ""}
      </div>
    `;
    document.body.appendChild(tagMenu);
    tagMenu.addEventListener("click", (event) => {
      const tagBtn = event.target.closest("[data-canvas-tag]");
      if (tagBtn) {
        element.tag = tagBtn.getAttribute("data-canvas-tag");
        closeTagMenu();
        renderTagBadges();
        return;
      }
      if (event.target.closest("[data-canvas-tag-custom]")) {
        const custom = window.prompt("What is this shape?", element.tag || "");
        if (custom?.trim()) element.tag = custom.trim().slice(0, 40);
        closeTagMenu();
        renderTagBadges();
        return;
      }
      if (event.target.closest("[data-canvas-tag-clear]")) {
        delete element.tag;
        closeTagMenu();
        renderTagBadges();
      }
    });
  }

  function renderTagBadges() {
    const layer = containerEl?.querySelector("#canvas-tag-layer");
    if (!layer) return;
    layer.innerHTML = elements
      .filter((el) => el.tag && el.bounds)
      .map((el) => {
        const b = el.bounds;
        const x = Math.max(8, Math.min((canvas?.width || 0) - 110, b.x + b.w / 2 - 36));
        const y = Math.max(8, b.y - 28);
        return `<button type="button" class="canvas-tag-badge" data-canvas-el="${el.id}" style="left:${x}px;top:${y}px;">${escapeHtml(el.tag)}</button>`;
      })
      .join("");
    layer.querySelectorAll("[data-canvas-el]").forEach((badge) => {
      badge.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const element = elements.find((el) => el.id === badge.getAttribute("data-canvas-el"));
        if (element) showTagMenu(element, event.clientX, event.clientY);
      });
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function syncTranscript(text) {
    voiceTranscript = String(text || "").replace(/\s*…\s*$/, "").trim();
    const panel = voiceEls?.transcriptPanel;
    if (panel) {
      panel.textContent = text?.trim() ? text : "No recording yet.";
      panel.classList.toggle("muted", !text?.trim());
    }
    onTranscriptChange?.(text);
  }

  function bindActions() {
    voiceEls?.clearTranscriptBtn?.addEventListener("click", () => syncTranscript(""));
  }

  function bindKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (!isActive()) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const shortcuts = { p: "pen", e: "eraser", r: "rect", c: "circle", l: "line", a: "arrow", t: "text" };
      if (shortcuts[e.key.toLowerCase()]) {
        e.preventDefault();
        tool = shortcuts[e.key.toLowerCase()];
        containerEl.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
        updateCursor();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    });
  }

  function bindVoice() {
    voiceEls?.recordBtn?.addEventListener("click", () => {
      if (recognizing || mediaRecorder?.state === "recording") stopVoice();
      else startVoice();
    });
  }

  async function startVoice() {
    const btn = voiceEls?.recordBtn;
    const timer = voiceEls?.timer;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      let interim = "";
      recognition.onresult = (e) => {
        interim = "";
        let final = voiceTranscript;
        for (const r of e.results) {
          if (r.isFinal) final += (final ? " " : "") + r[0].transcript;
          else interim += r[0].transcript;
        }
        syncTranscript(final + (interim ? ` ${interim}…` : ""));
      };
      recognition.onerror = () => {};
      recognition.start();
      recognizing = true;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorder.start();
    } catch (_) {}

    recordingStartTime = Date.now();
    if (btn) { btn.textContent = "⏹ Stop recording"; btn.classList.add("recording"); }
    timer?.classList.remove("hidden");
    recordingTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recordingStartTime) / 1000);
      const m = Math.floor(s / 60);
      const sec = String(s % 60).padStart(2, "0");
      if (voiceEls?.time) voiceEls.time.textContent = `${m}:${sec}`;
    }, 500);
  }

  function stopVoice() {
    const btn = voiceEls?.recordBtn;
    const timer = voiceEls?.timer;
    recognition?.stop();
    recognizing = false;
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    clearInterval(recordingTimer);
    if (btn) { btn.textContent = "🎤 Record voice note"; btn.classList.remove("recording"); }
    timer?.classList.add("hidden");
  }

  function getCanvasDataUrl() {
    return canvas?.toDataURL("image/png") ?? null;
  }

  function hasDrawing() {
    return history.length > 0;
  }

  function getTranscript() {
    return voiceTranscript.trim();
  }

  function getTaggedContext() {
    const width = canvas?.width || 1;
    const height = canvas?.height || 1;
    const tagged = elements
      .filter((el) => el.tag && el.bounds)
      .map((el, index) => {
        const b = el.bounds;
        return {
          index: index + 1,
          tag: el.tag,
          type: el.type,
          x: Math.round((b.x / width) * 100),
          y: Math.round((b.y / height) * 100),
          w: Math.round((b.w / width) * 100),
          h: Math.round((b.h / height) * 100),
          text: el.text || undefined,
        };
      });
    const summary = tagged.length
      ? tagged.map((el) => `${el.index}. ${el.tag} (${el.type}) at ${el.x}%,${el.y}% size ${el.w}%x${el.h}%${el.text ? ` text "${el.text}"` : ""}`).join("\n")
      : "";
    return { tagged, summary, totalElements: elements.length };
  }

  function show() {
    containerEl?.classList.remove("hidden");
    containerEl?.closest(".canvas-workspace-wrap")?.classList.remove("hidden");
    resizeCanvasKeepContent();
    updateCursor();
  }

  function hide() {
    containerEl?.classList.add("hidden");
    dismissTextInput();
    stopVoice();
  }

  function destroy() {
    stopVoice();
    dismissTextInput();
    closeTagMenu();
    history = [];
    redoStack = [];
    elements = [];
    drawGridBackground();
    renderTagBadges();
    updateUndoRedo();
    syncTranscript("");
  }

  function rebuild() {
    destroy();
    init();
  }

  init();

  return { show, hide, destroy, rebuild, stopVoice, getCanvasDataUrl, getTranscript, getTaggedContext, hasDrawing, clearCanvas };
}
