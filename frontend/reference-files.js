/** Closable tabs for PDF / text / image reference files with notes + markup. */

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kindFromName(filename = "") {
  const lower = String(filename).toLowerCase();
  if (/\.(png|jpe?g|webp|gif)$/i.test(lower)) return "image";
  if (/\.pdf$/i.test(lower)) return "pdf";
  if (/\.(txt|md|csv|tsv|log|json|ya?ml)$/i.test(lower)) return "text";
  return "file";
}

function labelFromName(filename = "") {
  return String(filename || "").replace(/\.[^.]+$/, "") || filename;
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

  function strokeSvg(strokes = []) {
    return (strokes || [])
      .map((stroke) => {
        const pts = (stroke.points || [])
          .map((p) => `${Number(p[0])},${Number(p[1])}`)
          .join(" ");
        if (!pts) return "";
        return `<polyline points="${pts}" fill="none" stroke="${escapeHtml(stroke.color || "#f0883e")}" stroke-width="${Number(stroke.width) || 2}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`;
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
    const statusText = tab.loading
      ? "Loading…"
      : tab.error
        ? tab.error
        : kind === "text"
          ? "Edit text · notes & markup save with Save"
          : kind === "image"
            ? "Pan · scroll zoom · Pen to markup · notes on the right"
            : "Notes & markup on the right · scroll PDF inside the frame";

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
            <div class="ref-image-stack" data-ref-image-stack>
              <img class="ref-image" src="${escapeHtml(tab.blobUrl || "")}" alt="${escapeHtml(tab.label || tab.filename)}" draggable="false" />
              <svg class="ref-markup-svg" xmlns="http://www.w3.org/2000/svg">${strokeSvg(tab.strokes)}</svg>
            </div>
          </div>
        </div>`;
    } else if (kind === "pdf") {
      bodyHtml = `
        <div class="ref-pdf-frame">
          <iframe class="ref-pdf-iframe" title="${escapeHtml(tab.label || tab.filename)}" src="${escapeHtml(tab.blobUrl || "")}"></iframe>
        </div>`;
    } else {
      bodyHtml = `<div class="ref-viewer-empty">Open this file from Reference Files.</div>`;
    }

    viewerEl.innerHTML = `
      <header class="dxf-viewer-toolbar ref-viewer-toolbar">
        <div class="dxf-viewer-title">
          <strong>${escapeHtml(tab.label || tab.filename)}</strong>
          <span class="muted small">${escapeHtml(statusText)}</span>
        </div>
        <div class="dxf-viewer-actions">
          ${kind === "image" ? `<button type="button" class="dxf-viewer-btn ${drawMode ? "active" : ""}" data-ref-action="pen" title="Draw markup">Pen</button>` : ""}
          ${kind === "image" ? `<button type="button" class="dxf-viewer-btn" data-ref-action="clear-strokes" title="Clear markup strokes">Clear marks</button>` : ""}
          ${kind === "image" ? `<button type="button" class="dxf-viewer-btn" data-ref-action="fit" title="Fit view">Fit</button>` : ""}
          <button type="button" class="dxf-viewer-btn primary" data-ref-action="save" title="Save text and markup">Save</button>
          <button type="button" class="dxf-viewer-btn" data-ref-action="close" title="Close tab">Close</button>
        </div>
      </header>
      <div class="ref-viewer-body">
        <div class="ref-viewer-main">${bodyHtml}</div>
        <aside class="ref-notes-panel" aria-label="Notes and markup">
          <label class="ref-notes-label" for="ref-notes-input">Notes / markup</label>
          <textarea id="ref-notes-input" class="ref-notes-editor" data-ref-notes placeholder="Write notes, callouts, or markup for this file…">${escapeHtml(tab.notes || "")}</textarea>
          <p class="muted small ref-notes-hint">Saved with the file in this project.</p>
        </aside>
      </div>
    `;
    if (kind === "image") applyTransform();
    bindImageMarkup(tab);
  }

  function markDirty(tab) {
    if (!tab) return;
    tab.dirty = true;
    if (docTabs) docTabs.setDirty(tab.filename, true);
    else renderTabs();
  }

  function bindImageMarkup(tab) {
    const stack = viewerEl?.querySelector("[data-ref-image-stack]");
    const img = stack?.querySelector("img");
    if (!stack || !img) return;

    const syncSvgSize = () => {
      const svg = stack.querySelector(".ref-markup-svg");
      if (!svg) return;
      const w = img.naturalWidth || img.clientWidth || 1;
      const h = img.naturalHeight || img.clientHeight || 1;
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
    };
    if (img.complete) syncSvgSize();
    else img.addEventListener("load", syncSvgSize, { once: true });

    const toLocal = (e) => {
      const rect = img.getBoundingClientRect();
      const w = img.naturalWidth || rect.width || 1;
      const h = img.naturalHeight || rect.height || 1;
      const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * w;
      const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * h;
      return [x, y];
    };

    const redraw = () => {
      const svg = stack.querySelector(".ref-markup-svg");
      if (svg) svg.innerHTML = strokeSvg(tab.strokes);
      syncSvgSize();
    };

    stack.addEventListener("pointerdown", (e) => {
      if (!drawMode) return;
      e.preventDefault();
      drawing = true;
      currentStroke = { points: [toLocal(e)], color: "#f0883e", width: 3 };
      tab.strokes = [...(tab.strokes || []), currentStroke];
      stack.setPointerCapture?.(e.pointerId);
      redraw();
      markDirty(tab);
    });
    stack.addEventListener("pointermove", (e) => {
      if (!drawing || !currentStroke) return;
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
    const notesEl = viewerEl?.querySelector("[data-ref-notes]");
    const textEl = viewerEl?.querySelector("[data-ref-text]");
    if (notesEl) tab.notes = notesEl.value;
    if (textEl) tab.textContent = textEl.value;

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
    // Persist unsaved notes from previous tab into memory
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
    if ((tabs.get(filename)?.kind) === "image") resetView();
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
      if (activeFilename && tabs.get(activeFilename)?.kind === "image") resetView();
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
    const action = e.target.closest("[data-ref-action]")?.dataset.refAction;
    if (!action) return;
    const tab = activeFilename ? tabs.get(activeFilename) : null;
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
      renderViewer();
      return;
    }
    if (action === "clear-strokes" && tab) {
      tab.strokes = [];
      markDirty(tab);
      renderViewer();
      return;
    }
    if (action === "fit") resetView();
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
      if (!tab || tab.kind !== "image" || drawMode) return;
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
    if (!tab || tab.kind !== "image" || drawMode) return;
    if (!e.target.closest?.(".ref-viewer-stage-wrap")) return;
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
    activateFromShared(filename) {
      if (!tabs.has(filename)) return false;
      activeFilename = filename;
      if ((tabs.get(filename)?.kind) === "image") resetView();
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
  return /\.(pdf|txt|md|csv|tsv|log|json|ya?ml|png|jpe?g|webp|gif)$/i.test(String(name || ""));
}
