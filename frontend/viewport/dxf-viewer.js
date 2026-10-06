/** Closable DXF drawing tabs with SVG preview from server render payload. */

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function strokeForKind(kind) {
  return kind === "bend" ? "#f0883e" : "#58a6ff";
}

function renderPayloadSvg(payload) {
  const bounds = payload?.bounds || {};
  const width = Number(bounds.width) || 1;
  const height = Number(bounds.height) || 1;
  const pad = Math.max(width, height) * 0.04 || 1;
  const viewBox = `${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`;
  const paths = (payload?.paths || [])
    .map((entry) => {
      const stroke = strokeForKind(entry.kind);
      return `<path d="${escapeHtml(entry.d)}" fill="none" stroke="${stroke}" stroke-width="1.25" vector-effect="non-scaling-stroke" data-layer="${escapeHtml(entry.layer || "")}" />`;
    })
    .join("");
  const circles = (payload?.circles || [])
    .map((entry) => {
      const stroke = strokeForKind(entry.kind);
      return `<circle cx="${entry.cx}" cy="${entry.cy}" r="${entry.r}" fill="none" stroke="${stroke}" stroke-width="1.25" vector-effect="non-scaling-stroke" data-layer="${escapeHtml(entry.layer || "")}" />`;
    })
    .join("");
  const texts = (payload?.texts || [])
    .map((entry) => {
      const fill = strokeForKind(entry.kind);
      const size = Math.max(Number(entry.height) || 2.5, 0.5);
      const anchor = entry.align === "middle" || entry.align === "center"
        ? "middle"
        : entry.align === "end" || entry.align === "right"
          ? "end"
          : "start";
      const rot = Number(entry.rotation) || 0;
      const transform = rot
        ? ` transform="rotate(${rot} ${entry.x} ${entry.y})"`
        : "";
      return `<text x="${entry.x}" y="${entry.y}" fill="${fill}" font-size="${size}" text-anchor="${anchor}" dominant-baseline="alphabetic"${transform} data-layer="${escapeHtml(entry.layer || "")}">${escapeHtml(entry.text || "")}</text>`;
    })
    .join("");
  return `<svg class="dxf-svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
    <rect class="dxf-svg-bg" x="${-pad}" y="${-pad}" width="${width + pad * 2}" height="${height + pad * 2}" />
    <g class="dxf-svg-geometry">${paths}${circles}${texts}</g>
  </svg>`;
}

export function createDxfViewer(options = {}) {
  const {
    tabBarEl,
    docTabs = null,
    viewerEl,
    api,
    getProjectId,
    onStatus,
    onActiveChange,
  } = options;

  /** @type {Map<string, { filename: string, label: string, projectId: string, payload: object | null, loading: boolean, error: string }>} */
  const tabs = new Map();
  let activeFilename = null;
  let panX = 0;
  let panY = 0;
  let zoom = 1;
  let dragState = null;
  let dxfPreviewAbort = null; // leakfix105
  function beginDxfPreviewFetch() {
    if (dxfPreviewAbort) {
      try { dxfPreviewAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    dxfPreviewAbort = ctl;
    return ctl;
  }

  function syncDocTab(tab, { activate = false } = {}) {
    if (!docTabs || !tab) return;
    docTabs.upsert({
      id: tab.filename,
      label: tab.label || tab.filename,
      kind: "dxf",
    });
    if (activate) docTabs.setActive(tab.filename);
  }

  function setVisible(on) {
    if (!docTabs) tabBarEl?.classList.toggle("hidden", !on);
    viewerEl?.classList.toggle("hidden", !on);
    viewerEl?.setAttribute("aria-hidden", on ? "false" : "true");
    if (!docTabs) {
      document.getElementById("viewport")?.classList.toggle("dxf-viewer-active", !!on);
    }
  }

  function resetView() {
    panX = 0;
    panY = 0;
    zoom = 1;
    applyTransform();
  }

  function applyTransform() {
    const stage = viewerEl?.querySelector(".dxf-viewer-stage");
    if (!stage) return;
    stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  function renderTabs() {
    if (docTabs) {
      for (const tab of tabs.values()) {
        docTabs.upsert({ id: tab.filename, label: tab.label || tab.filename, kind: "dxf" });
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
        const label = tab.label || tab.filename;
        return `<button type="button" class="dxf-tab ${active ? "active" : ""}" data-dxf-tab="${escapeHtml(tab.filename)}" role="tab" aria-selected="${active ? "true" : "false"}">
          <span class="dxf-tab-label">${escapeHtml(label)}</span>
          <span class="dxf-tab-close" data-dxf-close="${escapeHtml(tab.filename)}" role="button" aria-label="Close ${escapeHtml(label)}" title="Close">×</span>
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
    const counts = tab.payload?.counts || {};
    const entityCount = counts.entities ?? counts.paths ?? 0;
    const statusText = tab.loading
      ? "Loading drawing…"
      : tab.error
        ? tab.error
        : `${entityCount} entities · scroll to zoom · drag to pan`;
    viewerEl.innerHTML = `
      <header class="dxf-viewer-toolbar">
        <div class="dxf-viewer-title">
          <strong>${escapeHtml(tab.label || tab.filename)}</strong>
          <span class="muted small">${escapeHtml(statusText)}</span>
        </div>
        <div class="dxf-viewer-actions">
          <button type="button" class="dxf-viewer-btn" data-dxf-action="fit" title="Fit view">Fit</button>
          <button type="button" class="dxf-viewer-btn" data-dxf-action="zoom-out" title="Zoom out">−</button>
          <button type="button" class="dxf-viewer-btn" data-dxf-action="zoom-in" title="Zoom in">+</button>
          <button type="button" class="dxf-viewer-btn" data-dxf-action="close" title="Close tab">Close</button>
        </div>
      </header>
      <div class="dxf-viewer-canvas-wrap">
        <div class="dxf-viewer-stage">${tab.payload && !tab.error ? renderPayloadSvg(tab.payload) : `<div class="dxf-viewer-empty">${escapeHtml(tab.error || "No preview available.")}</div>`}</div>
      </div>
    `;
    applyTransform();
  }

  async function loadPreview(tab) {
    if (!tab?.projectId || !tab?.filename) {
      if (dxfPreviewAbort) {
        try { dxfPreviewAbort.abort(); } catch (_) { /* ignore */ }
      }
      return;
    }
    const ctl = beginDxfPreviewFetch();
    tab.loading = true;
    tab.error = "";
    renderViewer();
    try {
      const payload = await api(
        `/api/projects/${encodeURIComponent(tab.projectId)}/files/${encodeURIComponent(tab.filename)}/dxf-preview`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      tab.payload = payload;
      tab.loading = false;
      renderViewer();
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      tab.loading = false;
      tab.error = err.message || "Could not load DXF preview";
      tab.payload = null;
      renderViewer();
      onStatus?.("error", tab.error);
    }
  }

  function activate(filename, { syncShared = true } = {}) {
    if (!tabs.has(filename)) return;
    activeFilename = filename;
    resetView();
    if (syncShared) syncDocTab(tabs.get(filename), { activate: true });
    else renderTabs();
    renderViewer();
  }

  function closeTab(filename) {
    if (!tabs.has(filename)) return;
    if (tabs.get(filename)?.loading && dxfPreviewAbort) {
      try { dxfPreviewAbort.abort(); } catch (_) { /* ignore */ }
    }
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
      const next = tabs.keys().next().value || null;
      activeFilename = next;
      resetView();
    }
    renderTabs();
    renderViewer();
  }

  function hideViewerOnly() {
    activeFilename = null;
    setVisible(false);
    viewerEl && (viewerEl.innerHTML = "");
  }

  async function openTab(filename, { projectId, label } = {}) {
    const pid = projectId || getProjectId?.();
    if (!pid || !filename) {
      onStatus?.("error", "Select a project before opening a DXF drawing.");
      return null;
    }
    const key = String(filename);
    let tab = tabs.get(key);
    if (!tab) {
      tab = {
        filename: key,
        label: label || key.replace(/\.dxf$/i, ""),
        projectId: pid,
        payload: null,
        loading: false,
        error: "",
      };
      tabs.set(key, tab);
      syncDocTab(tab);
      await loadPreview(tab);
    } else {
      tab.projectId = pid;
      if (label) tab.label = label;
      if (!tab.payload && !tab.loading) await loadPreview(tab);
    }
    activate(key);
    onStatus?.("ok", `Opened ${tab.label}`);
    return tab;
  }

  if (!docTabs) {
    tabBarEl?.addEventListener("click", (e) => {
      const closeBtn = e.target.closest("[data-dxf-close]");
      if (closeBtn) {
        e.preventDefault();
        e.stopPropagation();
        closeTab(closeBtn.dataset.dxfClose);
        return;
      }
      const tabBtn = e.target.closest("[data-dxf-tab]");
      if (tabBtn) {
        activate(tabBtn.dataset.dxfTab);
      }
    });
  }

  viewerEl?.addEventListener("click", (e) => {
    const action = e.target.closest("[data-dxf-action]")?.dataset.dxfAction;
    if (!action) return;
    if (action === "fit") resetView();
    else if (action === "close" && activeFilename) closeTab(activeFilename);
    else if (action === "zoom-in") {
      zoom = Math.min(zoom * 1.2, 12);
      applyTransform();
    } else if (action === "zoom-out") {
      zoom = Math.max(zoom / 1.2, 0.15);
      applyTransform();
    }
  });

  viewerEl?.addEventListener(
    "wheel",
    (e) => {
      if (!activeFilename || viewerEl.classList.contains("hidden")) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = Math.min(Math.max(zoom * delta, 0.15), 12);
      applyTransform();
    },
    { passive: false },
  );

  viewerEl?.addEventListener("pointerdown", (e) => {
    if (!activeFilename || e.button !== 0) return;
    const wrap = e.target.closest(".dxf-viewer-canvas-wrap");
    if (!wrap) return;
    dragState = { x: e.clientX, y: e.clientY, panX, panY };
    viewerEl.setPointerCapture?.(e.pointerId);
    wrap.classList.add("is-panning");
  });

  viewerEl?.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    panX = dragState.panX + (e.clientX - dragState.x);
    panY = dragState.panY + (e.clientY - dragState.y);
    applyTransform();
  });

  function endPan(e) {
    if (!dragState) return;
    viewerEl.querySelector(".dxf-viewer-canvas-wrap")?.classList.remove("is-panning");
    dragState = null;
    try {
      viewerEl.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  viewerEl?.addEventListener("pointerup", endPan);
  viewerEl?.addEventListener("pointercancel", endPan);

  return {
    openTab,
    closeTab,
    activateFromShared(filename) {
      if (!tabs.has(filename)) return false;
      activeFilename = filename;
      resetView();
      renderViewer();
      onActiveChange?.(filename);
      return true;
    },
    hideViewerOnly,
    closeAll({ localOnly = false } = {}) {
      for (const name of [...tabs.keys()]) {
        if (!localOnly) docTabs?.remove?.(name);
      }
      // If we removed one-by-one, shared bar may have activated leftovers; force-clear our state.
      tabs.clear();
      activeFilename = null;
      if (!docTabs || localOnly) {
        if (!docTabs) renderTabs();
      }
      setVisible(false);
      if (viewerEl) viewerEl.innerHTML = "";
      onActiveChange?.(null);
    },
    closeIfOpen(filename) {
      closeTab(filename);
    },
    hasOpenTabs() {
      return tabs.size > 0;
    },
    getActiveFilename() {
      return activeFilename;
    },
    isOpen(filename) {
      return tabs.has(String(filename || ""));
    },
  };
}
