/** Closable tabs for PDF / text / image / video reference files with notes, pen markup, and Send to AI. */

import { mountViewportVideoEditor } from "./viewport-video-editor.js?v=20260730-ref-video";
import { authHeaders, getToken } from "./auth.js?v=20260723-invite-claim";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kindFromName(filename = "") {
  const lower = String(filename).toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg|tiff?)$/i.test(lower)) return "image";
  if (/\.(webm|mp4|mov|m4v)$/i.test(lower)) return "video";
  if (/\.pdf$/i.test(lower)) return "pdf";
  if (/\.(txt|md|csv|tsv|log|json|ya?ml|html?|rtf)$/i.test(lower)) return "text";
  return "file";
}

function labelFromName(filename = "") {
  return String(filename || "").replace(/\.[^.]+$/, "") || filename;
}

let pdfjsLibPromise = null;

async function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs"
    ).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsLibPromise;
}

function strokeSvg(strokes = [], pageIndex = null) {
  return (strokes || [])
    .filter((stroke) => {
      if (pageIndex == null) return true;
      const p = stroke.page == null ? 0 : Number(stroke.page);
      return p === pageIndex;
    })
    .map((stroke) => {
      const type = String(stroke.type || "pen").toLowerCase();
      const color = escapeHtml(stroke.color || "#f0883e");
      const width = Number(stroke.width) || 3;
      if (type === "text") {
        const x = Number(stroke.x ?? stroke.points?.[0]?.[0] ?? 0);
        const y = Number(stroke.y ?? stroke.points?.[0]?.[1] ?? 0);
        const size = Number(stroke.fontSize) || Math.max(14, width * 5);
        const text = escapeHtml(stroke.text || "");
        if (!text) return "";
        return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-family="Inter, system-ui, sans-serif" font-weight="700">${text}</text>`;
      }
      const pts = (stroke.points || [])
        .map((p) => `${Number(p[0])},${Number(p[1])}`)
        .join(" ");
      if (!pts) return "";
      if (type === "rect" && (stroke.points || []).length >= 2) {
        const [[x0, y0], [x1, y1]] = stroke.points;
        const x = Math.min(x0, x1);
        const y = Math.min(y0, y1);
        const w = Math.abs(x1 - x0);
        const h = Math.abs(y1 - y0);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke" />`;
      }
      if (type === "arrow" && (stroke.points || []).length >= 2) {
        const ptsArr = stroke.points;
        const [x0, y0] = ptsArr[0];
        const [x1, y1] = ptsArr[ptsArr.length - 1];
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const head = Math.max(10, width * 4);
        const ax = x1 - Math.cos(ang) * head;
        const ay = y1 - Math.sin(ang) * head;
        const lx = ax + Math.cos(ang + Math.PI / 2) * head * 0.45;
        const ly = ay + Math.sin(ang + Math.PI / 2) * head * 0.45;
        const rx = ax + Math.cos(ang - Math.PI / 2) * head * 0.45;
        const ry = ay + Math.sin(ang - Math.PI / 2) * head * 0.45;
        return `<g>
          <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" vector-effect="non-scaling-stroke" />
          <polygon points="${x1},${y1} ${lx},${ly} ${rx},${ry}" fill="${color}" />
        </g>`;
      }
      const opacity = type === "highlight" ? 0.35 : 1;
      const sw = type === "highlight" ? Math.max(width * 3, 12) : width;
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`;
    })
    .join("");
}

function drawStrokesOnCtx(ctx, strokes = [], pageIndex = null) {
  for (const stroke of strokes || []) {
    const p = stroke.page == null ? 0 : Number(stroke.page);
    if (pageIndex != null && p !== pageIndex) continue;
    const type = String(stroke.type || "pen").toLowerCase();
    const color = stroke.color || "#f0883e";
    const width = Number(stroke.width) || 3;
    if (type === "text") {
      const x = Number(stroke.x ?? stroke.points?.[0]?.[0] ?? 0);
      const y = Number(stroke.y ?? stroke.points?.[0]?.[1] ?? 0);
      const size = Number(stroke.fontSize) || Math.max(14, width * 5);
      if (!stroke.text) continue;
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
      ctx.fillText(String(stroke.text), x, y);
      ctx.restore();
      continue;
    }
    const pts = stroke.points || [];
    if (pts.length < 2) continue;
    if (type === "rect") {
      const [[x0, y0], [x1, y1]] = pts;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.restore();
      continue;
    }
    if (type === "arrow") {
      const [x0, y0] = pts[0];
      const [x1, y1] = pts[pts.length - 1];
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.max(10, width * 4);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - Math.cos(ang) * head + Math.cos(ang + Math.PI / 2) * head * 0.45, y1 - Math.sin(ang) * head + Math.sin(ang + Math.PI / 2) * head * 0.45);
      ctx.lineTo(x1 - Math.cos(ang) * head + Math.cos(ang - Math.PI / 2) * head * 0.45, y1 - Math.sin(ang) * head + Math.sin(ang - Math.PI / 2) * head * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = type === "highlight" ? 0.35 : 1;
    ctx.lineWidth = type === "highlight" ? Math.max(width * 3, 12) : width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(Number(pts[0][0]), Number(pts[0][1]));
    for (let i = 1; i < pts.length; i += 1) {
      ctx.lineTo(Number(pts[i][0]), Number(pts[i][1]));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export function createReferenceFilesViewer(options = {}) {
  const {
    tabBarEl,
    docTabs = null,
    viewerEl,
    api,
    rawFetch,
    getProjectId,
    onStatus,
    onActiveChange,
    onBeforeOpen,
    onSendToPrompt,
    getAiKeyBodyFields,
    getAiKeyPickerState,
    setAiKeyPickerValue,
    onRenderEdited,
    onReferenceAction,
  } = options;

  /** @type {Map<string, object>} */
  const tabs = new Map();
  let activeFilename = null;
  let drawMode = false;
  let drawing = false;
  let currentStroke = null;
  let panX = 0;
  let panY = 0;
  let zoom = 1;
  let panDrag = null;
  let markupTool = "pan"; // pan | pen | highlight | eraser | rect | arrow | text | region
  let markupColor = "#f0883e";
  let markupWidth = 3;
  /** @type {string[]} */
  let undoStack = [];
  /** @type {string[]} */
  let redoStack = [];
  let regionSelect = null; // { start, end, page }
  let regionDrag = null;
  let videoEditorApi = null;

  function destroyVideoEditor() {
    try { videoEditorApi?.destroy?.(); } catch (_) {}
    videoEditorApi = null;
  }

  const MARKUP_COLORS = ["#f0883e", "#58a6ff", "#3fb950", "#f85149", "#d2a8ff", "#ffffff", "#0d1117"];
  const RENDER_EDIT_PREF_KEY = "render3d:renderEditSaveMode:v1";
  let imageEditSaveMode = (() => {
    const pref = (() => {
      try {
        const v = localStorage.getItem(RENDER_EDIT_PREF_KEY);
        if (v === "new" || v === "replace" || v === "ask") return v;
      } catch {
        /* ignore */
      }
      return "ask";
    })();
    return pref === "replace" ? "replace" : "new";
  })();

  function readRenderEditPref() {
    try {
      const v = localStorage.getItem(RENDER_EDIT_PREF_KEY);
      if (v === "new" || v === "replace" || v === "ask") return v;
    } catch {
      /* ignore */
    }
    return "ask";
  }

  function writeRenderEditPref(mode) {
    try {
      localStorage.setItem(RENDER_EDIT_PREF_KEY, mode);
    } catch {
      /* ignore */
    }
    if (mode === "new" || mode === "replace") imageEditSaveMode = mode;
  }

  function setImageEditSaveMode(mode, { persist = false } = {}) {
    imageEditSaveMode = mode === "replace" ? "replace" : "new";
    if (persist) writeRenderEditPref(imageEditSaveMode);
    viewerEl?.querySelectorAll("[data-ref-save-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.refSaveMode === imageEditSaveMode);
      btn.setAttribute("aria-pressed", String(btn.dataset.refSaveMode === imageEditSaveMode));
    });
    const modalToggle = document.querySelector("#ref-region-edit-modal [data-region-save-mode]");
    if (modalToggle) {
      modalToggle.querySelectorAll("[data-save-mode]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.saveMode === imageEditSaveMode);
      });
    }
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = String(el.tagName || "").toLowerCase();
    return tag === "textarea" || tag === "input" || el.isContentEditable;
  }

  function pushStrokeHistory(tab) {
    if (!tab) return;
    undoStack.push(JSON.stringify(tab.strokes || []));
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
  }

  function redrawActiveMarkup() {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return;
    viewerEl?.querySelectorAll("[data-ref-image-stack], [data-ref-pdf-page]").forEach((stack) => {
      const pageIndex = Number(stack.dataset.page || 0);
      const svg = stack.querySelector(".ref-markup-svg");
      if (svg) svg.innerHTML = strokeSvg(tab.strokes, pageIndex);
    });
    updateRegionOverlay();
  }

  function undoMarkup() {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab || !undoStack.length) return;
    redoStack.push(JSON.stringify(tab.strokes || []));
    tab.strokes = JSON.parse(undoStack.pop() || "[]");
    markDirty(tab);
    redrawActiveMarkup();
    onStatus?.("ok", "Markup undone");
  }

  function redoMarkup() {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab || !redoStack.length) return;
    undoStack.push(JSON.stringify(tab.strokes || []));
    tab.strokes = JSON.parse(redoStack.pop() || "[]");
    markDirty(tab);
    redrawActiveMarkup();
    onStatus?.("ok", "Markup redone");
  }

  function setMarkupTool(tool) {
    markupTool = tool;
    drawMode = tool !== "pan";
    viewerEl?.classList.toggle("ref-draw-mode", drawMode);
    viewerEl?.querySelectorAll("[data-ref-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.refTool === tool);
    });
    if (tool !== "region") {
      regionSelect = null;
      regionDrag = null;
      updateRegionOverlay();
    }
  }

  function eraseNearPoint(tab, point, pageIndex, radius = 18) {
    const [x, y] = point;
    const next = (tab.strokes || []).filter((stroke) => {
      const p = stroke.page == null ? 0 : Number(stroke.page);
      if (p !== pageIndex) return true;
      if (String(stroke.type || "") === "text") {
        const tx = Number(stroke.x ?? stroke.points?.[0]?.[0] ?? 0);
        const ty = Number(stroke.y ?? stroke.points?.[0]?.[1] ?? 0);
        return Math.hypot(tx - x, ty - y) > radius * 1.5;
      }
      return !(stroke.points || []).some(([px, py]) => Math.hypot(px - x, py - y) <= radius);
    });
    if (next.length !== (tab.strokes || []).length) {
      pushStrokeHistory(tab);
      tab.strokes = next;
      markDirty(tab);
      redrawActiveMarkup();
    }
  }

  function updateRegionOverlay() {
    const overlay = viewerEl?.querySelector("[data-ref-region-overlay]");
    if (!overlay) return;
    const sel = regionSelect || (regionDrag ? { start: regionDrag.start, end: regionDrag.current } : null);
    if (!sel?.start || !sel?.end) {
      overlay.innerHTML = "";
      overlay.classList.add("hidden");
      return;
    }
    const media = viewerEl.querySelector("[data-ref-image-stack] img, [data-ref-image-stack] canvas");
    if (!media) return;
    const rect = media.getBoundingClientRect();
    const stage = media.closest(".ref-viewer-stage-wrap") || media.parentElement;
    const stageRect = stage.getBoundingClientRect();
    const w = media.naturalWidth || media.width || 1;
    const h = media.naturalHeight || media.height || 1;
    const x0 = Math.min(sel.start[0], sel.end[0]);
    const y0 = Math.min(sel.start[1], sel.end[1]);
    const x1 = Math.max(sel.start[0], sel.end[0]);
    const y1 = Math.max(sel.start[1], sel.end[1]);
    const left = ((x0 / w) * rect.width) + (rect.left - stageRect.left);
    const top = ((y0 / h) * rect.height) + (rect.top - stageRect.top);
    const width = ((x1 - x0) / w) * rect.width;
    const height = ((y1 - y0) / h) * rect.height;
    overlay.classList.remove("hidden");
    overlay.innerHTML = `<div class="ref-region-box" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px"></div>`;
  }

  function syncDocTab(tab, { activate = false } = {}) {
    if (!docTabs || !tab) return;
    docTabs.upsert({
      id: tab.filename,
      label: tab.label || tab.filename,
      kind: tab.kind || kindFromName(tab.filename),
      dirty: !!tab.dirty,
    });
    if (activate) docTabs.setActive(tab.filename);
  }

  function setVisible(on) {
    if (!docTabs) tabBarEl?.classList.toggle("hidden", !on);
    viewerEl?.classList.toggle("hidden", !on);
    viewerEl?.setAttribute("aria-hidden", on ? "false" : "true");
    if (!docTabs) {
      document.getElementById("viewport")?.classList.toggle("ref-viewer-active", !!on);
    }
  }

  function revokeBlob(tab) {
    if (tab?.blobUrl) {
      try { URL.revokeObjectURL(tab.blobUrl); } catch (_) {}
      tab.blobUrl = null;
    }
    if (tab?.previewUrl && tab.previewUrl !== tab.blobUrl) {
      try { URL.revokeObjectURL(tab.previewUrl); } catch (_) {}
      tab.previewUrl = null;
    }
    tab.blob = null;
    tab.editedBlob = null;
  }

  function resetView() {
    panX = 0;
    panY = 0;
    zoom = 1;
    applyTransform();
  }

  function applyTransform() {
    const stage = viewerEl?.querySelector(".ref-viewer-stage");
    if (!stage) return;
    stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  function canMarkup(kind) {
    return kind === "image" || kind === "pdf";
  }

  function renderTabs() {
    if (docTabs) {
      for (const tab of tabs.values()) {
        docTabs.upsert({
          id: tab.filename,
          label: tab.label || tab.filename,
          kind: tab.kind || kindFromName(tab.filename),
          dirty: !!tab.dirty,
        });
      }
      if (activeFilename) docTabs.setActive(activeFilename);
      else docTabs.render?.();
      return;
    }
    if (!tabBarEl) return;
    if (!tabs.size) {
      tabBarEl.innerHTML = "";
      tabBarEl.classList.add("hidden");
      return;
    }
    tabBarEl.classList.remove("hidden");
    tabBarEl.innerHTML = [...tabs.values()]
      .map((tab) => {
        const active = tab.filename === activeFilename;
        const dirty = tab.dirty ? " *" : "";
        const label = (tab.label || tab.filename) + dirty;
        return `<button type="button" class="dxf-tab ${active ? "active" : ""}" data-ref-tab="${escapeHtml(tab.filename)}" role="tab" aria-selected="${active ? "true" : "false"}">
          <span class="dxf-tab-label">${escapeHtml(label)}</span>
          <span class="dxf-tab-close" data-ref-close="${escapeHtml(tab.filename)}" role="button" aria-label="Close ${escapeHtml(tab.label || tab.filename)}" title="Close">×</span>
        </button>`;
      })
      .join("");
  }

  function renderViewer() {
    if (!viewerEl) return;
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) {
      viewerEl.innerHTML = "";
      setVisible(false);
      onActiveChange?.(null);
      return;
    }
    setVisible(true);
    onActiveChange?.(tab.filename);

    const kind = tab.kind || kindFromName(tab.filename);
    const markupable = canMarkup(kind);
    const statusText = tab.loading ? "Loading…" : tab.error ? tab.error : "";

    let bodyHtml = "";
    if (tab.loading) {
      bodyHtml = `<div class="ref-viewer-empty">Loading…</div>`;
    } else if (tab.error) {
      bodyHtml = `<div class="ref-viewer-empty">${escapeHtml(tab.error)}</div>`;
    } else if (kind === "text") {
      bodyHtml = `<textarea class="ref-text-editor" spellcheck="true" data-ref-text>${escapeHtml(tab.textContent || "")}</textarea>`;
    } else if (kind === "image") {
      bodyHtml = `
        <div class="ref-viewer-stage-wrap">
          <div class="ref-viewer-stage">
            <div class="ref-image-stack" data-ref-image-stack data-page="0">
              <img class="ref-image" src="${escapeHtml(tab.blobUrl || "")}" alt="${escapeHtml(tab.label || tab.filename)}" draggable="false" />
              <svg class="ref-markup-svg" xmlns="http://www.w3.org/2000/svg">${strokeSvg(tab.strokes, 0)}</svg>
            </div>
          </div>
        </div>`;
    } else if (kind === "video") {
      bodyHtml = `
        <div class="ref-viewer-stage-wrap ref-viewer-stage-wrap--video">
          <div class="ref-viewer-stage ref-viewer-stage--video">
            <video class="ref-video" src="${escapeHtml(tab.previewUrl || tab.blobUrl || "")}" controls playsinline preload="metadata"></video>
          </div>
          <div class="ref-video-editor-host" data-ref-video-editor></div>
        </div>`;
    } else if (kind === "pdf") {
      bodyHtml = `
        <div class="ref-viewer-stage-wrap ref-pdf-markup-wrap">
          <div class="ref-viewer-stage">
            <div class="ref-pdf-pages" data-ref-pdf-pages>
              <div class="ref-viewer-empty">Rendering PDF…</div>
            </div>
          </div>
        </div>`;
    } else {
      bodyHtml = `<div class="ref-viewer-empty">
        <p>Preview isn’t available for this file type.</p>
        ${tab.blobUrl ? `<p><a class="ref-download-link" href="${escapeHtml(tab.blobUrl)}" download="${escapeHtml(tab.filename)}">Download ${escapeHtml(tab.filename)}</a></p>` : ""}
      </div>`;
    }

    const strokeCount = (tab.strokes || []).length;
    const kindIsImage = kind === "image";
    const kindIsVideo = kind === "video";
    const canShare = kindIsImage || kindIsVideo || kind === "pdf" || kind === "file";
    const toolBtn = (id, label, title) =>
      `<button type="button" class="dxf-viewer-btn ${markupTool === id ? "active" : ""}" data-ref-tool="${id}" title="${title}">${label}</button>`;
    destroyVideoEditor();
    viewerEl.innerHTML = `
      <header class="dxf-viewer-toolbar ref-viewer-toolbar">
        <div class="dxf-viewer-title">
          <strong>${escapeHtml(tab.label || tab.filename)}</strong>
          ${statusText ? `<span class="muted small">${escapeHtml(statusText)}</span>` : ""}
        </div>
        <div class="dxf-viewer-actions ref-markup-toolbar">
          ${markupable ? `
            <div class="ref-tool-group" role="group" aria-label="Markup tools">
              ${toolBtn("pan", "Pan", "Drag to move the image")}
              ${toolBtn("pen", "Pen", "Freehand pen")}
              ${toolBtn("highlight", "Highlight", "Highlighter")}
              ${toolBtn("rect", "Rect", "Rectangle")}
              ${toolBtn("arrow", "Arrow", "Arrow")}
              ${toolBtn("text", "Text", "Add text label")}
              ${toolBtn("eraser", "Eraser", "Erase marks")}
              ${kindIsImage ? toolBtn("region", "AI Edit", "Drag-select a window on the image and prompt an edit of that region") : ""}
            </div>
            ${kindIsImage ? `
            <div class="ref-tool-group ref-tool-group--save-mode" role="group" aria-label="AI edit save mode">
              <span class="ref-tool-group-label">AI result</span>
              <button type="button" class="dxf-viewer-btn ${imageEditSaveMode === "new" ? "active" : ""}" data-ref-save-mode="new" aria-pressed="${imageEditSaveMode === "new" ? "true" : "false"}" title="Always save AI edits as a new image">New</button>
              <button type="button" class="dxf-viewer-btn ${imageEditSaveMode === "replace" ? "active" : ""}" data-ref-save-mode="replace" aria-pressed="${imageEditSaveMode === "replace" ? "true" : "false"}" title="Replace the current image with the AI edit">Replace</button>
            </div>
            ` : ""}
            <div class="ref-tool-group ref-tool-group--style">
              <label class="ref-color-picker" title="Stroke color">
                <span>Color</span>
                <input type="color" data-ref-color value="${escapeHtml(markupColor)}" />
              </label>
              <label class="ref-width-picker" title="Stroke width">
                <span>Size</span>
                <input type="range" data-ref-width min="1" max="16" value="${markupWidth}" />
              </label>
              <div class="ref-swatch-row">
                ${MARKUP_COLORS.map((c) => `<button type="button" class="ref-swatch${c === markupColor ? " is-active" : ""}" data-ref-swatch="${c}" style="--swatch:${c}" title="${c}"></button>`).join("")}
              </div>
            </div>
            <div class="ref-tool-group">
              <button type="button" class="dxf-viewer-btn" data-ref-action="undo" title="Undo (⌘Z)">Undo</button>
              <button type="button" class="dxf-viewer-btn" data-ref-action="redo" title="Redo (⌘⇧Z)">Redo</button>
              <button type="button" class="dxf-viewer-btn" data-ref-action="clear-strokes" title="Clear markup strokes">Clear</button>
              <button type="button" class="dxf-viewer-btn" data-ref-action="fit" title="Fit view">Fit</button>
            </div>
          ` : ""}
          ${kindIsImage ? `<button type="button" class="dxf-viewer-btn" data-ref-action="texture-model" title="Use this render as a texture/material reference for the current model">Texture to model</button>` : ""}
          ${canShare ? `<button type="button" class="dxf-viewer-btn" data-ref-action="share-menu" title="Share, copy link, or post to X">Share</button>` : ""}
          <button type="button" class="dxf-viewer-btn accent" data-ref-action="send-ai" title="Attach marked-up file and notes to the AI prompt">
            Send to AI${strokeCount ? ` (${strokeCount})` : ""}
          </button>
          ${
            kindIsVideo
              ? `<div class="ref-download-menu">
                  <button type="button" class="dxf-viewer-btn" data-ref-action="download-toggle" aria-haspopup="true" aria-expanded="false" title="Download this video">Download ▾</button>
                  <div class="ref-download-menu-panel hidden" data-ref-download-panel role="menu">
                    <button type="button" role="menuitem" data-ref-download="original">Original file</button>
                    <button type="button" role="menuitem" data-ref-download="mp4">MP4</button>
                    <button type="button" role="menuitem" data-ref-download="webm">WebM</button>
                  </div>
                </div>`
              : kindIsImage || tab.blobUrl
              ? `<div class="ref-download-menu">
                  <button type="button" class="dxf-viewer-btn" data-ref-action="download-toggle" aria-haspopup="true" aria-expanded="false" title="Download this image">Download ▾</button>
                  <div class="ref-download-menu-panel hidden" data-ref-download-panel role="menu">
                    <button type="button" role="menuitem" data-ref-download="png">PNG${strokeCount ? " (with markup)" : ""}</button>
                    <button type="button" role="menuitem" data-ref-download="jpeg">JPEG</button>
                    <button type="button" role="menuitem" data-ref-download="webp">WebP</button>
                    <button type="button" role="menuitem" data-ref-download="svg">SVG${strokeCount ? " (with markup)" : ""}</button>
                    ${tab.blobUrl ? `<button type="button" role="menuitem" data-ref-download="original">Original file</button>` : ""}
                  </div>
                </div>`
              : ""
          }
          ${kindIsVideo && tab.editedBlob ? `<button type="button" class="dxf-viewer-btn primary" data-ref-action="save-edited-video" title="Save the edited clip as a new recording">Save edit</button>` : ""}
          <button type="button" class="dxf-viewer-btn primary" data-ref-action="save" title="Save text and markup">Save</button>
          <button type="button" class="dxf-viewer-btn" data-ref-action="close" title="Close tab">Close</button>
        </div>
      </header>
      <div class="ref-viewer-body">
        <div class="ref-viewer-main">
          ${bodyHtml}
          ${kindIsImage ? `<div class="ref-region-overlay hidden" data-ref-region-overlay></div>` : ""}
        </div>
        <aside class="ref-notes-panel" aria-label="Notes and markup">
          <label class="ref-notes-label" for="ref-notes-input">Notes / markup</label>
          <textarea id="ref-notes-input" class="ref-notes-editor" data-ref-notes placeholder="Write notes, callouts, or markup for this file…">${escapeHtml(tab.notes || "")}</textarea>
        </aside>
      </div>
    `;
    if (markupable) {
      drawMode = markupTool !== "pan";
      applyTransform();
    }
    viewerEl.classList.toggle("ref-draw-mode", !!drawMode && markupable);
    if (kind === "image") bindMarkupSurface(tab);
    if (kind === "video" && !tab.loading && !tab.error) bindVideoEditor(tab);
    if (kind === "pdf" && !tab.loading && !tab.error) {
      void renderPdfPages(tab);
    }
  }

  function bindVideoEditor(tab) {
    destroyVideoEditor();
    const host = viewerEl?.querySelector("[data-ref-video-editor]");
    const videoEl = viewerEl?.querySelector(".ref-video");
    if (!host || !videoEl || !tab.blob) return;
    videoEditorApi = mountViewportVideoEditor(host, {
      getPreviewEl: () => viewerEl?.querySelector(".ref-video"),
      getSourceBlob: () => tab.editedBlob || tab.blob,
      onOutputBlob: (blob) => {
        if (!blob) return;
        tab.editedBlob = blob;
        if (tab.previewUrl && tab.previewUrl !== tab.blobUrl) {
          try { URL.revokeObjectURL(tab.previewUrl); } catch (_) {}
        }
        tab.previewUrl = URL.createObjectURL(blob);
        const el = viewerEl?.querySelector(".ref-video");
        if (el) el.src = tab.previewUrl;
        markDirty(tab);
        const actions = viewerEl?.querySelector(".ref-markup-toolbar");
        if (actions && !actions.querySelector('[data-ref-action="save-edited-video"]')) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "dxf-viewer-btn primary";
          btn.dataset.refAction = "save-edited-video";
          btn.title = "Save the edited clip as a new recording";
          btn.textContent = "Save edit";
          const saveBtn = actions.querySelector('[data-ref-action="save"]');
          if (saveBtn) actions.insertBefore(btn, saveBtn);
          else actions.appendChild(btn);
        }
        onStatus?.("ok", "Edited clip ready — Save edit, Download, or Share.");
      },
      onStatus: (msg, isError) => {
        onStatus?.(isError ? "error" : "ok", typeof msg === "string" ? msg : String(msg || ""));
      },
    });
    try {
      videoEditorApi.setSource?.(tab.editedBlob || tab.blob);
    } catch (_) {}
  }

  function markDirty(tab) {
    if (!tab) return;
    tab.dirty = true;
    if (docTabs) docTabs.setDirty(tab.filename, true);
    else renderTabs();
  }

  function syncNotesFromDom(tab) {
    if (!tab) return;
    const notesEl = viewerEl?.querySelector("[data-ref-notes]");
    const textEl = viewerEl?.querySelector("[data-ref-text]");
    if (notesEl) tab.notes = notesEl.value;
    if (textEl) tab.textContent = textEl.value;
  }

  function bindMarkupSurface(tab, root = null) {
    const stacks = root
      ? [root]
      : [...(viewerEl?.querySelectorAll("[data-ref-image-stack], [data-ref-pdf-page]") || [])];
    for (const stack of stacks) {
      if (!stack || stack.dataset.markupBound === "1") continue;
      stack.dataset.markupBound = "1";
      const pageIndex = Number(stack.dataset.page || 0);
      const media = stack.querySelector("img, canvas");
      if (!media) continue;

      const syncSvgSize = () => {
        const svg = stack.querySelector(".ref-markup-svg");
        if (!svg) return;
        const w =
          media.naturalWidth ||
          media.width ||
          media.clientWidth ||
          Number(media.getAttribute("width")) ||
          1;
        const h =
          media.naturalHeight ||
          media.height ||
          media.clientHeight ||
          Number(media.getAttribute("height")) ||
          1;
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
        svg.setAttribute("width", String(w));
        svg.setAttribute("height", String(h));
      };

      if (media.tagName === "IMG") {
        if (media.complete) syncSvgSize();
        else media.addEventListener("load", syncSvgSize, { once: true });
      } else {
        syncSvgSize();
      }

      const toLocal = (e) => {
        const rect = media.getBoundingClientRect();
        const w =
          media.naturalWidth ||
          media.width ||
          Number(media.getAttribute("width")) ||
          rect.width ||
          1;
        const h =
          media.naturalHeight ||
          media.height ||
          Number(media.getAttribute("height")) ||
          rect.height ||
          1;
        const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * w;
        const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * h;
        return [x, y];
      };

      const redraw = () => {
        const svg = stack.querySelector(".ref-markup-svg");
        if (svg) svg.innerHTML = strokeSvg(tab.strokes, pageIndex);
        syncSvgSize();
        updateRegionOverlay();
      };

      stack.addEventListener("pointerdown", (e) => {
        if (!drawMode) return;
        e.preventDefault();
        e.stopPropagation();
        const point = toLocal(e);
        if (markupTool === "eraser") {
          eraseNearPoint(tab, point, pageIndex);
          return;
        }
        if (markupTool === "text") {
          const text = window.prompt("Text label", "");
          if (!text?.trim()) return;
          pushStrokeHistory(tab);
          tab.strokes = [
            ...(tab.strokes || []),
            {
              type: "text",
              text: text.trim().slice(0, 240),
              x: point[0],
              y: point[1],
              points: [point, point],
              color: markupColor,
              width: markupWidth,
              fontSize: Math.max(16, markupWidth * 6),
              page: pageIndex,
            },
          ];
          markDirty(tab);
          redraw();
          return;
        }
        if (markupTool === "region") {
          regionDrag = { start: point, current: point, page: pageIndex };
          regionSelect = null;
          updateRegionOverlay();
          stack.setPointerCapture?.(e.pointerId);
          return;
        }
        drawing = true;
        currentStroke = {
          type: markupTool === "highlight" ? "highlight" : markupTool === "rect" ? "rect" : markupTool === "arrow" ? "arrow" : "pen",
          points: [point, point],
          color: markupColor,
          width: markupWidth,
          page: pageIndex,
        };
        pushStrokeHistory(tab);
        tab.strokes = [...(tab.strokes || []), currentStroke];
        stack.setPointerCapture?.(e.pointerId);
        redraw();
        markDirty(tab);
      });
      stack.addEventListener("pointermove", (e) => {
        if (regionDrag && regionDrag.page === pageIndex) {
          regionDrag.current = toLocal(e);
          updateRegionOverlay();
          return;
        }
        if (!drawing || !currentStroke || currentStroke.page !== pageIndex) return;
        const point = toLocal(e);
        if (currentStroke.type === "rect" || currentStroke.type === "arrow") {
          currentStroke.points = [currentStroke.points[0], point];
        } else {
          currentStroke.points.push(point);
        }
        redraw();
      });
      const endStroke = (e) => {
        if (regionDrag && regionDrag.page === pageIndex) {
          const end = e ? toLocal(e) : regionDrag.current;
          const start = regionDrag.start;
          regionDrag = null;
          const w = Math.abs(end[0] - start[0]);
          const h = Math.abs(end[1] - start[1]);
          if (w < 8 || h < 8) {
            regionSelect = null;
            updateRegionOverlay();
            return;
          }
          regionSelect = { start, end, page: pageIndex };
          updateRegionOverlay();
          void openRegionEditModal(tab, regionSelect);
          return;
        }
        drawing = false;
        currentStroke = null;
      };
      stack.addEventListener("pointerup", endStroke);
      stack.addEventListener("pointercancel", endStroke);
    }
  }

  async function renderPdfPages(tab) {
    const host = viewerEl?.querySelector("[data-ref-pdf-pages]");
    if (!host || !tab.blobUrl) return;
    try {
      const pdfjs = await loadPdfJs();
      const loadingTask = pdfjs.getDocument(tab.blobUrl);
      const pdf = await loadingTask.promise;
      tab.pdfPageCount = pdf.numPages;
      host.innerHTML = "";
      const maxPages = Math.min(pdf.numPages, 20);
      for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.35 });
        const pageEl = document.createElement("div");
        pageEl.className = "ref-pdf-page";
        pageEl.dataset.refPdfPage = "";
        pageEl.dataset.page = String(pageNum - 1);
        const canvas = document.createElement("canvas");
        canvas.className = "ref-pdf-canvas";
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("ref-markup-svg");
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        svg.innerHTML = strokeSvg(tab.strokes, pageNum - 1);
        pageEl.append(canvas, svg);
        host.appendChild(pageEl);
        bindMarkupSurface(tab, pageEl);
      }
      if (pdf.numPages > maxPages) {
        const note = document.createElement("p");
        note.className = "muted small ref-pdf-more";
        note.textContent = `Showing first ${maxPages} of ${pdf.numPages} pages for markup.`;
        host.appendChild(note);
      }
    } catch (err) {
      host.innerHTML = `<div class="ref-viewer-empty">Could not render PDF for markup (${escapeHtml(err.message || "error")}). Notes still work — use Send to AI for notes.</div>`;
    }
  }

  async function compositeMarkedImage(tab) {
    const kind = tab.kind || kindFromName(tab.filename);
    if (kind === "image") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Could not load image for Send to AI"));
        img.src = tab.blobUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      drawStrokesOnCtx(ctx, tab.strokes, 0);
      return canvas.toDataURL("image/png");
    }
    if (kind === "pdf") {
      const pageCanvases = [...(viewerEl?.querySelectorAll(".ref-pdf-page canvas") || [])];
      if (!pageCanvases.length) {
        // Ensure pages are rendered before compositing
        await renderPdfPages(tab);
      }
      const pages = [...(viewerEl?.querySelectorAll(".ref-pdf-page") || [])];
      if (!pages.length) return null;
      const markedPages = pages.filter((pageEl) => {
        const idx = Number(pageEl.dataset.page || 0);
        return (tab.strokes || []).some((s) => (s.page == null ? 0 : Number(s.page)) === idx);
      });
      const usePages = markedPages.length ? markedPages : pages.slice(0, Math.min(3, pages.length));
      const gap = 12;
      const widths = usePages.map((el) => el.querySelector("canvas")?.width || 0);
      const heights = usePages.map((el) => el.querySelector("canvas")?.height || 0);
      const width = Math.max(...widths, 1);
      const height = heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, usePages.length - 1);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      let y = 0;
      for (const pageEl of usePages) {
        const src = pageEl.querySelector("canvas");
        const idx = Number(pageEl.dataset.page || 0);
        if (!src) continue;
        ctx.save();
        ctx.translate(0, y);
        ctx.drawImage(src, 0, 0);
        drawStrokesOnCtx(ctx, tab.strokes, idx);
        ctx.restore();
        y += src.height + gap;
      }
      return canvas.toDataURL("image/png");
    }
    return null;
  }

  function stemForDownload(tab) {
    return String(tab?.label || labelFromName(tab?.filename) || "render").replace(/[^\w.-]+/g, "_") || "render";
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function dataUrlToBlob(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid image data");
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] });
  }

  async function loadImageElement(src) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = src;
    });
    return img;
  }

  async function buildExportCanvas(tab, { withMarkup = true } = {}) {
    const src = withMarkup ? await compositeMarkedImage(tab) : null;
    if (src) {
      const img = await loadImageElement(src);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas;
    }
    if (!tab.blobUrl) throw new Error("Nothing to download");
    const img = await loadImageElement(tab.blobUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    if (withMarkup) drawStrokesOnCtx(ctx, tab.strokes, 0);
    return canvas;
  }

  async function downloadAsRaster(tab, format) {
    const canvas = await buildExportCanvas(tab, { withMarkup: true });
    const mime =
      format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
    const quality = format === "png" ? undefined : 0.92;
    const dataUrl = canvas.toDataURL(mime, quality);
    const ext = format === "jpeg" ? "jpg" : format;
    triggerBlobDownload(dataUrlToBlob(dataUrl), `${stemForDownload(tab)}.${ext}`);
  }

  async function downloadAsSvg(tab) {
    const img = await loadImageElement(tab.blobUrl);
    const width = img.naturalWidth || img.width || 1024;
    const height = img.naturalHeight || img.height || 1024;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0);
    const pngUrl = canvas.toDataURL("image/png");
    const markup = strokeSvg(tab.strokes, 0);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image width="${width}" height="${height}" xlink:href="${pngUrl}" href="${pngUrl}" />
  <g class="markup">${markup}</g>
</svg>`;
    triggerBlobDownload(new Blob([svg], { type: "image/svg+xml" }), `${stemForDownload(tab)}.svg`);
  }

  async function downloadOriginal(tab) {
    const kind = tab.kind || kindFromName(tab.filename);
    if (kind === "video") {
      const blob = await resolveTabVideoBlob(tab);
      const name = tab.filename || `${stemForDownload(tab)}.webm`;
      triggerBlobDownload(blob, name);
      return;
    }
    if (!tab.blobUrl) throw new Error("Nothing to download");
    const a = document.createElement("a");
    a.href = tab.blobUrl;
    a.download = tab.filename || `${stemForDownload(tab)}.png`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function closeDownloadPanel() {
    const panel = viewerEl?.querySelector("[data-ref-download-panel]");
    const toggle = viewerEl?.querySelector('[data-ref-action="download-toggle"]');
    panel?.classList.add("hidden");
    toggle?.setAttribute("aria-expanded", "false");
  }

  function closeReferenceContextMenu() {
    document.getElementById("ref-image-context-menu")?.remove();
  }

  function debugTagForTab(tab) {
    return [
      `Render Studio render image`,
      `project_id=${tab?.projectId || getProjectId?.() || ""}`,
      `filename=${tab?.filename || ""}`,
      `prompt_debug=include this project id and filename when reporting render image issues`,
    ].join("\n");
  }

  async function copyRenderImageWithDebug(tab) {
    const canvas = await buildExportCanvas(tab, { withMarkup: true });
    const debug = debugTagForTab(tab);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not prepare image for clipboard.");
    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": blob,
            "text/plain": new Blob([debug], { type: "text/plain" }),
          }),
        ]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(debug);
      } else {
        throw new Error("Clipboard is not available in this browser.");
      }
      onStatus?.("ok", "Copied render image with project/debug tag.");
    } catch (err) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(debug);
        onStatus?.("ok", "Copied render debug tag. Browser blocked image clipboard access.");
        return;
      }
      throw err;
    }
  }

  function emitReferenceAction(action, tab, extra = {}) {
    closeReferenceContextMenu();
    onReferenceAction?.({
      action,
      filename: tab?.filename,
      label: tab?.label || tab?.filename,
      kind: tab?.kind || kindFromName(tab?.filename),
      projectId: tab?.projectId || getProjectId?.(),
      blobUrl: tab?.blobUrl,
      blob: extra.blob || tab?.editedBlob || tab?.blob || null,
      debugText: debugTagForTab(tab),
      includeModel: !!extra.includeModel,
      source: "reference-image",
    });
  }

  function showReferenceContextMenu(event, tab) {
    const kind = tab?.kind || kindFromName(tab?.filename);
    if (!tab || (kind !== "image" && kind !== "video" && kind !== "pdf" && kind !== "file")) return;
    event.preventDefault();
    event.stopPropagation();
    closeReferenceContextMenu();
    const menu = document.createElement("div");
    menu.id = "ref-image-context-menu";
    menu.className = "ref-image-context-menu";
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 280)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 280)}px`;
    const isVideo = kind === "video";
    const isImage = kind === "image";
    menu.innerHTML = `
      <div class="ref-image-context-menu-title">
        <strong>${isVideo ? "Share video" : isImage ? "Share render" : "Share file"}</strong>
        <button type="button" data-ref-context-close aria-label="Close share menu">×</button>
      </div>
      ${isImage ? `<button type="button" data-ref-context="copy">Copy render image + debug tag</button>` : ""}
      <button type="button" data-ref-context="copy-link">Copy share link</button>
      <button type="button" data-ref-context="share-x">Share to X…</button>
      <button type="button" data-ref-context="download">Download</button>
      <button type="button" data-ref-context="share-link">Export / share…</button>
      ${isImage ? `<button type="button" data-ref-context="share-chat">Share to project chat...</button>` : ""}
      ${isImage ? `<button type="button" data-ref-context="share-dm">Share to DM...</button>` : ""}
      ${isImage ? `<button type="button" data-ref-context="store">Add to public profile/store...</button>` : ""}
      ${isImage ? `<button type="button" data-ref-context="texture">Export texture back to model</button>` : ""}
      <hr />
      <button type="button" data-ref-context="delete" class="danger">Delete reference file</button>
    `;
    document.body.appendChild(menu);
    menu.addEventListener("click", (e) => {
      if (e.target.closest("[data-ref-context-close]")) {
        closeReferenceContextMenu();
        return;
      }
      const action = e.target.closest("[data-ref-context]")?.dataset.refContext;
      if (!action) return;
      if (action === "copy") {
        void copyRenderImageWithDebug(tab).catch((err) => onStatus?.("error", err.message || "Could not copy render image."));
        closeReferenceContextMenu();
        return;
      }
      if (action === "delete") {
        closeReferenceContextMenu();
        emitReferenceAction("delete", tab);
        return;
      }
      if (action === "download") {
        closeReferenceContextMenu();
        void handleDownload(isVideo ? "original" : "original");
        return;
      }
      if (action === "copy-link") emitReferenceAction("copy-link", tab);
      else if (action === "share-x") emitReferenceAction("share-x", tab);
      else if (action === "share-link") emitReferenceAction("share-link", tab);
      else if (action === "share-chat") emitReferenceAction("share-chat", tab);
      else if (action === "share-dm") emitReferenceAction("share-dm", tab);
      else if (action === "store") emitReferenceAction("store", tab);
      else if (action === "texture") emitReferenceAction("texture-model", tab);
    });
  }

  async function handleDownload(format) {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return;
    closeDownloadPanel();
    try {
      const kind = tab.kind || kindFromName(tab.filename);
      if (kind === "video" && (format === "mp4" || format === "webm")) {
        await downloadVideoFormat(tab, format);
      } else if (format === "original") {
        await downloadOriginal(tab);
      } else if (format === "svg") {
        await downloadAsSvg(tab);
      } else {
        await downloadAsRaster(tab, format);
      }
      onStatus?.("ok", `Downloaded ${format.toUpperCase()}`);
    } catch (err) {
      onStatus?.("error", err.message || "Download failed");
    }
  }

  async function resolveTabVideoBlob(tab) {
    if (tab.editedBlob) return tab.editedBlob;
    if (tab.blob) return tab.blob;
    if (!tab.blobUrl) throw new Error("Nothing to download");
    const res = await fetch(tab.blobUrl);
    if (!res.ok) throw new Error("Could not read video");
    return res.blob();
  }

  async function downloadVideoFormat(tab, format) {
    let blob = await resolveTabVideoBlob(tab);
    const type = String(blob.type || "").toLowerCase();
    const already = format === "mp4"
      ? type.includes("mp4") || type.includes("m4v")
      : type.includes("webm");
    if (!already) {
      const token = typeof getToken === "function" ? getToken() : null;
      if (!token) throw new Error(`Sign in to convert this clip to ${format.toUpperCase()}.`);
      const form = new FormData();
      const srcName = type.includes("mp4") ? "clip.mp4" : "clip.webm";
      form.append("video", blob, tab.filename || srcName);
      form.append("format", format);
      const res = await fetch("/api/video/convert", {
        method: "POST",
        headers: { ...authHeaders() },
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Could not convert to ${format.toUpperCase()}`);
      }
      blob = new Blob([await res.arrayBuffer()], {
        type: format === "mp4" ? "video/mp4" : "video/webm",
      });
    }
    const stem = stemForDownload(tab);
    triggerBlobDownload(blob, `${stem}.${format}`);
  }

  async function buildSendPayload(tab) {
    syncNotesFromDom(tab);
    const kind = tab.kind || kindFromName(tab.filename);
    const notes = String(tab.notes || "").trim();
    const strokes = tab.strokes || [];
    const images = [];
    if (canMarkup(kind)) {
      try {
        const dataUrl = await compositeMarkedImage(tab);
        if (dataUrl) {
          images.push({
            id: `ref-mark-${Date.now()}`,
            name: `${labelFromName(tab.filename)}-marked.png`,
            media_type: "image/png",
            data_url: dataUrl,
            source_filename: tab.filename,
            markup_strokes: strokes.length,
          });
        }
      } catch (err) {
        onStatus?.("error", err.message || "Could not build marked image");
      }
    }
    let documentText = null;
    if (kind === "text") {
      const parts = [];
      if (notes) parts.push(`Notes:\n${notes}`);
      if (tab.textContent?.trim()) parts.push(tab.textContent.trim());
      documentText = parts.join("\n\n") || null;
    } else if (notes) {
      documentText = `Notes for ${tab.filename}:\n${notes}`;
    }
    return {
      filename: tab.filename,
      label: tab.label || tab.filename,
      kind,
      notes,
      strokeCount: strokes.length,
      images,
      documentText,
      projectId: tab.projectId,
    };
  }

  async function loadTab(tab) {
    tab.loading = true;
    tab.error = "";
    renderViewer();
    try {
      const fileRes = await rawFetch(
        `/api/projects/${encodeURIComponent(tab.projectId)}/files/${encodeURIComponent(tab.filename)}`,
      );
      if (!fileRes.ok) throw new Error("Could not load file");
      if (tab.kind === "text") {
        tab.textContent = await fileRes.text();
        tab.blobUrl = null;
        tab.blob = null;
      } else {
        const blob = await fileRes.blob();
        revokeBlob(tab);
        tab.blob = blob;
        tab.blobUrl = URL.createObjectURL(blob);
        tab.previewUrl = null;
        tab.editedBlob = null;
      }
      let markup = { notes: "", strokes: [] };
      try {
        markup = await api(
          `/api/projects/${encodeURIComponent(tab.projectId)}/files/${encodeURIComponent(tab.filename)}/markup`,
        );
      } catch {
        /* markup optional */
      }
      tab.notes = markup.notes || "";
      tab.strokes = Array.isArray(markup.strokes) ? markup.strokes : [];
      tab.loading = false;
      tab.dirty = false;
      renderTabs();
      renderViewer();
    } catch (err) {
      tab.loading = false;
      tab.error = err.message || "Could not load reference file";
      renderViewer();
      onStatus?.("error", tab.error);
    }
  }

  async function saveActive() {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return;
    syncNotesFromDom(tab);

    try {
      if (tab.kind === "text") {
        await api(
          `/api/projects/${encodeURIComponent(tab.projectId)}/files/${encodeURIComponent(tab.filename)}/text`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: tab.textContent || "" }),
          },
        );
      }
      await api(
        `/api/projects/${encodeURIComponent(tab.projectId)}/files/${encodeURIComponent(tab.filename)}/markup`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: tab.notes || "", strokes: tab.strokes || [] }),
        },
      );
      tab.dirty = false;
      if (docTabs) docTabs.setDirty(tab.filename, false);
      else renderTabs();
      onStatus?.("ok", `Saved ${tab.label || tab.filename}`);
    } catch (err) {
      onStatus?.("error", err.message || "Save failed");
    }
  }

  function activate(filename, { syncShared = true } = {}) {
    if (!tabs.has(filename)) return;
    const prev = activeFilename ? tabs.get(activeFilename) : null;
    if (prev) {
      const notesEl = viewerEl?.querySelector("[data-ref-notes]");
      const textEl = viewerEl?.querySelector("[data-ref-text]");
      if (notesEl) prev.notes = notesEl.value;
      if (textEl && textEl.value !== prev.textContent) {
        prev.textContent = textEl.value;
        prev.dirty = true;
        if (docTabs) docTabs.setDirty(prev.filename, true);
      }
    }
    activeFilename = filename;
    undoStack = [];
    redoStack = [];
    regionSelect = null;
    regionDrag = null;
    if (canMarkup(tabs.get(filename)?.kind)) resetView();
    if (syncShared) syncDocTab(tabs.get(filename), { activate: true });
    else renderTabs();
    renderViewer();
    onActiveChange?.(filename);
  }

  function closeTab(filename) {
    const tab = tabs.get(filename);
    if (!tab) return;
    if (activeFilename === filename) destroyVideoEditor();
    revokeBlob(tab);
    tabs.delete(filename);
    if (activeFilename === filename) activeFilename = null;
    if (docTabs) {
      docTabs.remove(filename);
      if (!activeFilename) {
        setVisible(false);
        if (viewerEl) viewerEl.innerHTML = "";
        onActiveChange?.(null);
      }
      return;
    }
    if (activeFilename === filename) {
      activeFilename = tabs.keys().next().value || null;
      if (activeFilename && canMarkup(tabs.get(activeFilename)?.kind)) resetView();
    }
    renderTabs();
    renderViewer();
  }

  function hideViewerOnly() {
    destroyVideoEditor();
    activeFilename = null;
    setVisible(false);
    if (viewerEl) viewerEl.innerHTML = "";
  }

  async function openTab(filename, { projectId, label, kind, forceReload = false } = {}) {
    const pid = projectId || getProjectId?.();
    if (!pid || !filename) {
      onStatus?.("error", "Select a project before opening a reference file.");
      return null;
    }
    onBeforeOpen?.();
    const key = String(filename);
    let tab = tabs.get(key);
    if (tab && forceReload) {
      revokeBlob(tab);
      tabs.delete(key);
      docTabs?.remove?.(key);
      tab = null;
    }
    if (!tab) {
      tab = {
        filename: key,
        label: label || labelFromName(key),
        projectId: pid,
        kind: kind || kindFromName(key),
        textContent: "",
        notes: "",
        strokes: [],
        blobUrl: null,
        loading: false,
        error: "",
        dirty: false,
      };
      tabs.set(key, tab);
      syncDocTab(tab);
      await loadTab(tab);
    } else {
      tab.projectId = pid;
      if (label) tab.label = label;
      if (kind) tab.kind = kind;
      if (!tab.blobUrl && tab.kind !== "text" && !tab.loading) await loadTab(tab);
      else if (tab.kind === "text" && tab.textContent == null && !tab.loading) await loadTab(tab);
    }
    activate(key);
    onStatus?.("ok", `Opened ${tab.label}`);
    return tab;
  }

  async function sendActiveToPrompt() {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return null;
    try {
      await saveActive();
    } catch {
      /* still try to send */
    }
    const payload = await buildSendPayload(tab);
    if (onSendToPrompt) {
      await onSendToPrompt(payload);
    }
    return payload;
  }

  async function sendFilenameToPrompt(filename) {
    if (!filename) return null;
    if (!tabs.has(filename)) {
      await openTab(filename);
    } else {
      activate(filename);
    }
    return sendActiveToPrompt();
  }

  if (!docTabs) {
    tabBarEl?.addEventListener("click", (e) => {
      const closeBtn = e.target.closest("[data-ref-close]");
      if (closeBtn) {
        e.preventDefault();
        e.stopPropagation();
        closeTab(closeBtn.dataset.refClose);
        return;
      }
      const tabBtn = e.target.closest("[data-ref-tab]");
      if (tabBtn) activate(tabBtn.dataset.refTab);
    });
  }

  function buildAiKeySelectHtml() {
    const state = getAiKeyPickerState?.() || { options: [], selected: "" };
    const options = Array.isArray(state.options) ? state.options : [];
    if (!options.length) {
      return `<select data-region-ai-key disabled><option value="">Default OpenAI key</option></select>`;
    }
    return `<select data-region-ai-key aria-label="AI key">
      ${options.map((opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === state.selected ? " selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
    </select>`;
  }

  async function openRegionEditModal(tab, region) {
    if (!tab?.blobUrl || !region) return;
    const x0 = Math.min(region.start[0], region.end[0]);
    const y0 = Math.min(region.start[1], region.end[1]);
    const x1 = Math.max(region.start[0], region.end[0]);
    const y1 = Math.max(region.start[1], region.end[1]);
    const w = Math.max(1, Math.round(x1 - x0));
    const h = Math.max(1, Math.round(y1 - y0));
    let cropUrl = "";
    try {
      const img = await loadImageElement(tab.blobUrl);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, x0, y0, w, h, 0, 0, w, h);
      cropUrl = canvas.toDataURL("image/png");
    } catch (err) {
      onStatus?.("error", err.message || "Could not crop selection");
      return;
    }

    document.getElementById("ref-region-edit-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "ref-region-edit-modal";
    modal.className = "ref-region-edit-modal";
    modal.innerHTML = `
      <div class="ref-region-edit-card" role="dialog" aria-modal="true" aria-labelledby="ref-region-edit-title">
        <button type="button" class="ref-region-edit-close" data-region-close aria-label="Close">×</button>
        <h3 id="ref-region-edit-title">Edit selected region</h3>
        <p class="muted small">Prompt an edit for this crop. The rest of the image stays the same.</p>
        <div class="ref-region-edit-preview"><img src="${cropUrl}" alt="Selected region" /></div>
        <label class="ref-region-field">
          <span>Prompt</span>
          <textarea data-region-prompt rows="3" placeholder="e.g. Change the background to a marble counter, keep lighting…"></textarea>
        </label>
        <label class="ref-region-field">
          <span>AI key</span>
          ${buildAiKeySelectHtml()}
        </label>
        <div class="ref-region-field" data-region-save-mode>
          <span>Save result as</span>
          <div class="ref-save-mode-toggle" role="group" aria-label="Save mode">
            <button type="button" class="dxf-viewer-btn ${imageEditSaveMode === "new" ? "active" : ""}" data-save-mode="new">New image</button>
            <button type="button" class="dxf-viewer-btn ${imageEditSaveMode === "replace" ? "active" : ""}" data-save-mode="replace">Replace current</button>
          </div>
          <small class="muted">Also available on the image toolbar. Change the default later in Preferences.</small>
        </div>
        <div class="ref-region-edit-actions">
          <button type="button" class="btn secondary" data-region-close>Cancel</button>
          <button type="button" class="btn primary" data-region-generate>Generate edit</button>
        </div>
        <p class="muted small ref-region-edit-status" data-region-status></p>
      </div>
    `;
    document.body.appendChild(modal);
    const promptEl = modal.querySelector("[data-region-prompt]");
    const statusEl = modal.querySelector("[data-region-status]");
    const keySelect = modal.querySelector("[data-region-ai-key]");
    promptEl?.focus();

    modal.querySelectorAll("[data-save-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setImageEditSaveMode(btn.dataset.saveMode, { persist: false });
        modal.querySelectorAll("[data-save-mode]").forEach((el) => {
          el.classList.toggle("active", el.dataset.saveMode === imageEditSaveMode);
        });
      });
    });
    keySelect?.addEventListener("change", () => {
      if (keySelect.value) setAiKeyPickerValue?.(keySelect.value);
    });

    const close = () => modal.remove();
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal || ev.target.closest("[data-region-close]")) close();
    });
    modal.querySelector("[data-region-generate]")?.addEventListener("click", async () => {
      const prompt = String(promptEl?.value || "").trim();
      if (!prompt) {
        statusEl.textContent = "Write a prompt describing the edit.";
        return;
      }
      const genBtn = modal.querySelector("[data-region-generate]");
      if (genBtn) genBtn.disabled = true;
      const saveMode = imageEditSaveMode === "replace" ? "replace" : "new";
      statusEl.textContent = saveMode === "replace"
        ? "Generating edit and replacing current image…"
        : "Generating edit as a new image…";
      try {
        if (keySelect?.value) setAiKeyPickerValue?.(keySelect.value);
        const fullDataUrl = await compositeMarkedImage(tab);
        let sourceImage = fullDataUrl;
        if (!sourceImage) {
          const img = await loadImageElement(tab.blobUrl);
          const c = document.createElement("canvas");
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          c.getContext("2d").drawImage(img, 0, 0);
          sourceImage = c.toDataURL("image/png");
        }
        let keyFields = getAiKeyBodyFields?.() || {};
        if (keySelect?.value && keySelect.value.includes(":")) {
          const [source, ...rest] = keySelect.value.split(":");
          const keyId = rest.join(":");
          if (source && keyId) keyFields = { ai_key_id: keyId, ai_key_source: source };
        }
        const body = {
          prompt,
          source_image: sourceImage,
          source_filename: tab.filename,
          region: { x: Math.round(x0), y: Math.round(y0), w, h },
          save_mode: saveMode,
          ...keyFields,
        };
        const data = await api(`/api/projects/${encodeURIComponent(tab.projectId)}/render-region-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }, 240000);
        close();
        await applyRenderEditResult(tab, data, saveMode);
      } catch (err) {
        statusEl.textContent = err.message || "Region edit failed.";
        if (genBtn) genBtn.disabled = false;
      }
    });
  }

  async function applyRenderEditResult(tab, data, choice) {
    const pid = tab.projectId;
    const filename = data?.filename;
    onRenderEdited?.({
      projectId: pid,
      filename,
      replace: choice === "replace",
      previousFilename: tab.filename,
    });
    if (filename) {
      revokeBlob(tab);
      await openTab(filename, {
        projectId: pid,
        label: String(filename).replace(/\.[^.]+$/, "") || "Image",
        kind: "image",
        forceReload: true,
      });
    }
    onStatus?.(
      "ok",
      choice === "replace"
        ? "Replaced current image. Toggle New/Replace on the toolbar anytime."
        : "Saved as a new image. Toggle New/Replace on the toolbar anytime.",
    );
  }

  viewerEl?.addEventListener("click", (e) => {
    const saveModeBtn = e.target.closest("[data-ref-save-mode]");
    if (saveModeBtn) {
      setImageEditSaveMode(saveModeBtn.dataset.refSaveMode, { persist: true });
      onStatus?.(
        "ok",
        imageEditSaveMode === "replace"
          ? "AI edits will replace the current image."
          : "AI edits will save as a new image.",
      );
      return;
    }
    const tool = e.target.closest("[data-ref-tool]")?.dataset.refTool;
    if (tool) {
      setMarkupTool(tool);
      return;
    }
    const swatch = e.target.closest("[data-ref-swatch]")?.dataset.refSwatch;
    if (swatch) {
      markupColor = swatch;
      const colorInput = viewerEl.querySelector("[data-ref-color]");
      if (colorInput) colorInput.value = swatch;
      viewerEl.querySelectorAll("[data-ref-swatch]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.refSwatch === swatch);
      });
      return;
    }
    const downloadFmt = e.target.closest("[data-ref-download]")?.dataset.refDownload;
    if (downloadFmt) {
      e.preventDefault();
      void handleDownload(downloadFmt);
      return;
    }
    const action = e.target.closest("[data-ref-action]")?.dataset.refAction;
    if (!action) return;
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (action === "download-toggle") {
      const panel = viewerEl.querySelector("[data-ref-download-panel]");
      const toggle = viewerEl.querySelector('[data-ref-action="download-toggle"]');
      const open = panel?.classList.toggle("hidden") === false;
      toggle?.setAttribute("aria-expanded", String(!!open));
      return;
    }
    if (action === "save") {
      void saveActive();
      return;
    }
    if (action === "close" && activeFilename) {
      closeTab(activeFilename);
      return;
    }
    if (action === "undo") {
      undoMarkup();
      return;
    }
    if (action === "redo") {
      redoMarkup();
      return;
    }
    if (action === "clear-strokes" && tab) {
      pushStrokeHistory(tab);
      tab.strokes = [];
      markDirty(tab);
      redrawActiveMarkup();
      return;
    }
    if (action === "fit") resetView();
    if (action === "send-ai") {
      void sendActiveToPrompt();
      return;
    }
    if (action === "texture-model" && tab) {
      emitReferenceAction("texture-model", tab);
      return;
    }
    if (action === "share-menu" && tab) {
      const btn = e.target.closest("[data-ref-action]");
      const rect = btn?.getBoundingClientRect?.() || { left: e.clientX, bottom: e.clientY };
      showReferenceContextMenu({ ...e, clientX: rect.left, clientY: rect.bottom + 6, preventDefault() {}, stopPropagation() {} }, tab);
      return;
    }
    if (action === "save-edited-video" && tab) {
      emitReferenceAction("save-edited-video", tab, {
        blob: tab.editedBlob || tab.blob,
      });
    }
  });

  viewerEl?.addEventListener("input", (e) => {
    if (e.target.matches?.("[data-ref-color]")) {
      markupColor = e.target.value || markupColor;
      return;
    }
    if (e.target.matches?.("[data-ref-width]")) {
      markupWidth = Math.max(1, Math.min(16, Number(e.target.value) || 3));
      return;
    }
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return;
    if (e.target.matches?.("[data-ref-notes], [data-ref-text]")) markDirty(tab);
  });

  document.addEventListener("keydown", (e) => {
    if (!activeFilename || !viewerEl || viewerEl.classList.contains("hidden")) return;
    if (isTypingTarget(e.target)) return;
    const tab = tabs.get(activeFilename);
    if (!tab || !canMarkup(tab.kind)) return;
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    const key = String(e.key || "").toLowerCase();
    if (key === "z" && e.shiftKey) {
      e.preventDefault();
      redoMarkup();
      return;
    }
    if (key === "z") {
      e.preventDefault();
      undoMarkup();
      return;
    }
    if (key === "y") {
      e.preventDefault();
      redoMarkup();
    }
  });

  viewerEl?.addEventListener(
    "wheel",
    (e) => {
      const tab = activeFilename ? tabs.get(activeFilename) : null;
      if (!tab || !canMarkup(tab.kind)) return;
      if (!e.target.closest?.(".ref-viewer-stage-wrap")) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0008);
      zoom = Math.min(8, Math.max(0.2, zoom * factor));
      applyTransform();
      updateRegionOverlay();
    },
    { passive: false },
  );

  viewerEl?.addEventListener("pointerdown", (e) => {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab || !canMarkup(tab.kind) || drawMode) return;
    if (!e.target.closest?.(".ref-viewer-stage-wrap")) return;
    e.preventDefault();
    panDrag = { x: e.clientX - panX, y: e.clientY - panY };
    e.target.setPointerCapture?.(e.pointerId);
  });
  viewerEl?.addEventListener("pointermove", (e) => {
    if (!panDrag) return;
    panX = e.clientX - panDrag.x;
    panY = e.clientY - panDrag.y;
    applyTransform();
    updateRegionOverlay();
  });
  viewerEl?.addEventListener("pointerup", () => {
    panDrag = null;
  });

  viewerEl?.addEventListener("contextmenu", (e) => {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    const kind = tab?.kind || kindFromName(tab?.filename);
    if (!tab || (kind !== "image" && kind !== "video")) return;
    if (!e.target.closest?.("[data-ref-image-stack], .ref-viewer-stage-wrap, .ref-video, .ref-video-editor-host")) return;
    showReferenceContextMenu(e, tab);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("#ref-image-context-menu")) closeReferenceContextMenu();
  });

  return {
    openTab,
    closeTab,
    sendToPrompt: sendFilenameToPrompt,
    sendActiveToPrompt,
    activateFromShared(filename) {
      if (!tabs.has(filename)) return false;
      activate(filename, { syncShared: true });
      return true;
    },
    hideViewerOnly,
    closeAll({ localOnly = false } = {}) {
      destroyVideoEditor();
      for (const name of [...tabs.keys()]) {
        const tab = tabs.get(name);
        revokeBlob(tab);
        if (!localOnly) docTabs?.remove?.(name);
      }
      tabs.clear();
      activeFilename = null;
      if (!docTabs || localOnly) {
        if (!docTabs) renderTabs();
      }
      setVisible(false);
      if (viewerEl) viewerEl.innerHTML = "";
      onActiveChange?.(null);
    },
    isActive: () => !!activeFilename && tabs.has(activeFilename),
    hasTabs: () => tabs.size > 0,
    getActiveFilename: () => activeFilename,
  };
}

export function isReferenceFilename(name = "") {
  return /\.(pdf|txt|md|csv|tsv|log|json|ya?ml|html?|rtf|docx?|xlsx?|pptx?|png|jpe?g|webp|gif|bmp|svg|tiff?|webm|mp4|mov|m4v)$/i.test(String(name || ""));
}
