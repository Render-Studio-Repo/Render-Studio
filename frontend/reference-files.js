/** Closable tabs for PDF / text / image reference files with notes, pen markup, and Send to AI. */

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
      const pts = (stroke.points || [])
        .map((p) => `${Number(p[0])},${Number(p[1])}`)
        .join(" ");
      if (!pts) return "";
      return `<polyline points="${pts}" fill="none" stroke="${escapeHtml(stroke.color || "#f0883e")}" stroke-width="${Number(stroke.width) || 2}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`;
    })
    .join("");
}

function drawStrokesOnCtx(ctx, strokes = [], pageIndex = null) {
  for (const stroke of strokes || []) {
    const p = stroke.page == null ? 0 : Number(stroke.page);
    if (pageIndex != null && p !== pageIndex) continue;
    const pts = stroke.points || [];
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color || "#f0883e";
    ctx.lineWidth = Number(stroke.width) || 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(Number(pts[0][0]), Number(pts[0][1]));
    for (let i = 1; i < pts.length; i += 1) {
      ctx.lineTo(Number(pts[i][0]), Number(pts[i][1]));
    }
    ctx.stroke();
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
      URL.revokeObjectURL(tab.blobUrl);
      tab.blobUrl = null;
    }
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
    const statusText = tab.loading
      ? "Loading…"
      : tab.error
        ? tab.error
        : kind === "text"
          ? "Edit text · notes save with Save · Send to AI includes notes"
          : kind === "image"
            ? "Pan · scroll zoom · Pen to markup · Send to AI includes marks + notes"
            : kind === "pdf"
              ? "Pen to markup pages · notes on the right · Send to AI includes marks + notes"
              : kind === "file"
                ? "Download or notes on the right · Send to AI includes notes"
                : "Notes on the right";

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
    viewerEl.innerHTML = `
      <header class="dxf-viewer-toolbar ref-viewer-toolbar">
        <div class="dxf-viewer-title">
          <strong>${escapeHtml(tab.label || tab.filename)}</strong>
          <span class="muted small">${escapeHtml(statusText)}</span>
        </div>
        <div class="dxf-viewer-actions">
          ${markupable ? `<button type="button" class="dxf-viewer-btn ${drawMode ? "active" : ""}" data-ref-action="pen" title="Draw markup on this file">Pen</button>` : ""}
          ${markupable ? `<button type="button" class="dxf-viewer-btn" data-ref-action="clear-strokes" title="Clear markup strokes">Clear marks</button>` : ""}
          ${markupable ? `<button type="button" class="dxf-viewer-btn" data-ref-action="fit" title="Fit view">Fit</button>` : ""}
          <button type="button" class="dxf-viewer-btn accent" data-ref-action="send-ai" title="Attach marked-up file and notes to the AI prompt">
            Send to AI${strokeCount ? ` (${strokeCount})` : ""}
          </button>
          ${
            kindIsImage || tab.blobUrl
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
          <button type="button" class="dxf-viewer-btn primary" data-ref-action="save" title="Save text and markup">Save</button>
          <button type="button" class="dxf-viewer-btn" data-ref-action="close" title="Close tab">Close</button>
        </div>
      </header>
      <div class="ref-viewer-body">
        <div class="ref-viewer-main">${bodyHtml}</div>
        <aside class="ref-notes-panel" aria-label="Notes and markup">
          <label class="ref-notes-label" for="ref-notes-input">Notes / markup</label>
          <textarea id="ref-notes-input" class="ref-notes-editor" data-ref-notes placeholder="Write notes, callouts, or markup for this file…">${escapeHtml(tab.notes || "")}</textarea>
          <p class="muted small ref-notes-hint">Saved with the file. Included when you Send to AI.</p>
        </aside>
      </div>
    `;
    if (markupable) applyTransform();
    viewerEl.classList.toggle("ref-draw-mode", !!drawMode && markupable);
    if (kind === "image") bindMarkupSurface(tab);
    if (kind === "pdf" && !tab.loading && !tab.error) {
      void renderPdfPages(tab);
    }
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
      };

      stack.addEventListener("pointerdown", (e) => {
        if (!drawMode) return;
        e.preventDefault();
        e.stopPropagation();
        drawing = true;
        currentStroke = {
          points: [toLocal(e)],
          color: "#f0883e",
          width: 3,
          page: pageIndex,
        };
        tab.strokes = [...(tab.strokes || []), currentStroke];
        stack.setPointerCapture?.(e.pointerId);
        redraw();
        markDirty(tab);
      });
      stack.addEventListener("pointermove", (e) => {
        if (!drawing || !currentStroke || currentStroke.page !== pageIndex) return;
        currentStroke.points.push(toLocal(e));
        redraw();
      });
      const endStroke = () => {
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

  async function handleDownload(format) {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return;
    closeDownloadPanel();
    try {
      if (format === "original") await downloadOriginal(tab);
      else if (format === "svg") await downloadAsSvg(tab);
      else await downloadAsRaster(tab, format);
      onStatus?.("ok", `Downloaded ${format.toUpperCase()}`);
    } catch (err) {
      onStatus?.("error", err.message || "Download failed");
    }
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
      } else {
        const blob = await fileRes.blob();
        revokeBlob(tab);
        tab.blobUrl = URL.createObjectURL(blob);
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
    if (canMarkup(tabs.get(filename)?.kind)) resetView();
    if (syncShared) syncDocTab(tabs.get(filename), { activate: true });
    else renderTabs();
    renderViewer();
  }

  function closeTab(filename) {
    const tab = tabs.get(filename);
    if (!tab) return;
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
    activeFilename = null;
    setVisible(false);
    if (viewerEl) viewerEl.innerHTML = "";
  }

  async function openTab(filename, { projectId, label, kind } = {}) {
    const pid = projectId || getProjectId?.();
    if (!pid || !filename) {
      onStatus?.("error", "Select a project before opening a reference file.");
      return null;
    }
    onBeforeOpen?.();
    const key = String(filename);
    let tab = tabs.get(key);
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

  viewerEl?.addEventListener("click", (e) => {
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
    if (action === "pen") {
      drawMode = !drawMode;
      viewerEl.classList.toggle("ref-draw-mode", drawMode);
      const penBtn = viewerEl.querySelector('[data-ref-action="pen"]');
      penBtn?.classList.toggle("active", drawMode);
      return;
    }
    if (action === "clear-strokes" && tab) {
      tab.strokes = [];
      markDirty(tab);
      renderViewer();
      return;
    }
    if (action === "fit") resetView();
    if (action === "send-ai") {
      void sendActiveToPrompt();
    }
  });

  viewerEl?.addEventListener("input", (e) => {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return;
    if (e.target.matches?.("[data-ref-notes], [data-ref-text]")) markDirty(tab);
  });

  viewerEl?.addEventListener(
    "wheel",
    (e) => {
      const tab = activeFilename ? tabs.get(activeFilename) : null;
      if (!tab || !canMarkup(tab.kind) || drawMode) return;
      if (!e.target.closest?.(".ref-viewer-stage-wrap")) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = Math.min(8, Math.max(0.2, zoom * factor));
      applyTransform();
    },
    { passive: false },
  );

  viewerEl?.addEventListener("pointerdown", (e) => {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab || !canMarkup(tab.kind) || drawMode) return;
    if (!e.target.closest?.(".ref-viewer-stage-wrap")) return;
    if (e.target.closest?.("[data-ref-image-stack], [data-ref-pdf-page]")) return;
    panDrag = { x: e.clientX - panX, y: e.clientY - panY };
    e.target.setPointerCapture?.(e.pointerId);
  });
  viewerEl?.addEventListener("pointermove", (e) => {
    if (!panDrag) return;
    panX = e.clientX - panDrag.x;
    panY = e.clientY - panDrag.y;
    applyTransform();
  });
  viewerEl?.addEventListener("pointerup", () => {
    panDrag = null;
  });

  return {
    openTab,
    closeTab,
    sendToPrompt: sendFilenameToPrompt,
    sendActiveToPrompt,
    activateFromShared(filename) {
      if (!tabs.has(filename)) return false;
      activeFilename = filename;
      if (canMarkup(tabs.get(filename)?.kind)) resetView();
      renderViewer();
      onActiveChange?.(filename);
      return true;
    },
    hideViewerOnly,
    closeAll({ localOnly = false } = {}) {
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
  return /\.(pdf|txt|md|csv|tsv|log|json|ya?ml|html?|rtf|docx?|xlsx?|pptx?|png|jpe?g|webp|gif|bmp|svg|tiff?)$/i.test(String(name || ""));
}
