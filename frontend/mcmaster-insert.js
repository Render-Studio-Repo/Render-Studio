/**
 * Fusion-style Insert → McMaster-Carr component browser.
 *
 * Opens a local popup chrome (like Fusion's "INSERT MCMASTER-CARR COMPONENT")
 * with https://www.mcmaster.com/ embedded. Downloads can't be intercepted from
 * a cross-origin iframe, so the footer accepts the downloaded STEP/CAD file
 * and routes it through the current-project vs new-project destination flow.
 */

const MCMASTER_HOME = "https://www.mcmaster.com/";
const CAD_ACCEPT = ".step,.stp,.stl,.obj,.glb,.gltf,.3mf,.iges,.igs,.sat,.sldprt,.x_t,.x_b";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createMcMasterInsert({
  onImportFiles,
  onStatus,
  resolveDestination,
} = {}) {
  const panel = document.createElement("div");
  panel.className = "insert-panel-overlay hidden";
  panel.innerHTML = `
    <div class="insert-panel" role="dialog" aria-label="Insert">
      <div class="insert-panel-head">
        <div>
          <strong>Insert</strong>
          <span class="muted small">Add supplier parts into the current design — McMaster-Carr, then import the downloaded CAD.</span>
        </div>
        <button type="button" class="insert-panel-close" aria-label="Close insert">×</button>
      </div>
      <div class="insert-panel-grid">
        <button type="button" class="insert-source-card" data-insert-source="mcmaster">
          <span class="insert-source-icon" aria-hidden="true">MC</span>
          <span class="insert-source-copy">
            <strong>McMaster-Carr</strong>
            <small>Browse mcmaster.com and insert hardware / mechanical parts</small>
          </span>
        </button>
      </div>
      <p class="muted small insert-panel-hint">Opens a Fusion-style browser popup. After you download a CAD file from McMaster, import it here or drop it on the popup.</p>
    </div>
  `;
  document.body.appendChild(panel);

  const modal = document.createElement("div");
  modal.className = "mcmaster-insert-modal hidden";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "mcmaster-insert-title");
  modal.innerHTML = `
    <div class="mcmaster-insert-shell">
      <header class="mcmaster-insert-chrome">
        <div class="mcmaster-insert-chrome-left">
          <button type="button" class="mcmaster-insert-min" data-mcmaster-close title="Close" aria-label="Close">−</button>
          <strong id="mcmaster-insert-title">INSERT MCMASTER-CARR COMPONENT</strong>
        </div>
        <div class="mcmaster-insert-chrome-right">
          <input type="search" class="mcmaster-insert-search" placeholder="Search McMaster-Carr…" aria-label="Search McMaster-Carr" />
          <button type="button" class="btn secondary btn-compact" data-mcmaster-search>Go</button>
          <a class="btn secondary btn-compact" data-mcmaster-external href="${MCMASTER_HOME}" target="_blank" rel="noopener">Open site</a>
        </div>
      </header>
      <div class="mcmaster-insert-body">
        <iframe
          class="mcmaster-insert-frame"
          title="McMaster-Carr"
          src="${MCMASTER_HOME}"
          referrerpolicy="no-referrer-when-downgrade"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        ></iframe>
        <div class="mcmaster-insert-fallback" hidden>
          <p><strong>McMaster-Carr blocked embedding in this browser.</strong></p>
          <p class="muted small">Use <em>Open site</em> to browse McMaster, download the CAD/STEP file, then drop it here or click <em>Import download</em>.</p>
        </div>
        <div class="mcmaster-insert-drop" data-mcmaster-drop>
          <strong>Download from McMaster, then import here</strong>
          <span>Drop STEP / STL / GLB / 3MF / IGES — or click Import download</span>
        </div>
      </div>
      <footer class="mcmaster-insert-footer">
        <div class="mcmaster-insert-footer-hint muted small">
          Download asks current workspace vs new project (change in Preferences).
        </div>
        <div class="mcmaster-insert-footer-actions">
          <input type="file" class="mcmaster-insert-file" accept="${CAD_ACCEPT}" hidden multiple />
          <button type="button" class="btn accent btn-compact" data-mcmaster-import>Import download</button>
          <button type="button" class="btn secondary btn-compact" data-mcmaster-close>Close</button>
        </div>
      </footer>
    </div>
  `;
  document.body.appendChild(modal);

  const frame = modal.querySelector(".mcmaster-insert-frame");
  const fallback = modal.querySelector(".mcmaster-insert-fallback");
  const searchInput = modal.querySelector(".mcmaster-insert-search");
  const fileInput = modal.querySelector(".mcmaster-insert-file");
  const dropZone = modal.querySelector("[data-mcmaster-drop]");
  let iframeBlockedTimer = null;

  function setStatus(kind, text) {
    onStatus?.(kind, text);
  }

  function navigateMcMaster(query = "") {
    const q = String(query || "").trim();
    const url = q
      ? `https://www.mcmaster.com/products/${encodeURIComponent(q.replace(/\s+/g, "-").toLowerCase())}/`
      : MCMASTER_HOME;
    // Prefer search results page pattern McMaster uses for free text.
    const searchUrl = q
      ? `https://www.mcmaster.com/search/?q=${encodeURIComponent(q)}`
      : MCMASTER_HOME;
    if (frame) {
      fallback.hidden = true;
      frame.classList.remove("is-blocked");
      frame.src = searchUrl;
      armIframeWatch();
    }
    const ext = modal.querySelector("[data-mcmaster-external]");
    if (ext) ext.href = searchUrl;
    return url;
  }

  function armIframeWatch() {
    if (iframeBlockedTimer) window.clearTimeout(iframeBlockedTimer);
    // McMaster often sends X-Frame-Options; after a beat, surface the drop/import path.
    iframeBlockedTimer = window.setTimeout(() => {
      try {
        // Cross-origin access throws when the frame loaded a foreign document.
        void frame?.contentWindow?.location?.href;
      } catch {
        fallback.hidden = false;
        frame?.classList.add("is-blocked");
        return;
      }
      // Same-origin blank / empty still show helper strip.
      fallback.hidden = false;
    }, 2200);
  }

  async function importFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    try {
      const choice = await resolveDestination?.(files);
      if (!choice) {
        setStatus("ok", "McMaster import cancelled.");
        return;
      }
      setStatus("loading", `Importing ${files.length === 1 ? files[0].name : `${files.length} files`}…`);
      await onImportFiles?.(files, choice);
      setStatus("ok", files.length === 1
        ? `Inserted ${files[0].name} from McMaster-Carr.`
        : `Inserted ${files.length} McMaster-Carr parts.`);
      closeBrowser();
    } catch (err) {
      setStatus("error", err?.message || "Could not import McMaster part.");
    }
  }

  function openPanel() {
    panel.classList.remove("hidden");
  }

  function closePanel() {
    panel.classList.add("hidden");
  }

  function openBrowser({ query = "" } = {}) {
    modal.classList.remove("hidden");
    document.body.classList.add("mcmaster-insert-open");
    if (query) {
      searchInput.value = query;
      navigateMcMaster(query);
    } else if (!frame?.src || frame.src === "about:blank") {
      navigateMcMaster("");
    } else {
      armIframeWatch();
    }
    searchInput?.focus?.();
  }

  function closeBrowser() {
    modal.classList.add("hidden");
    document.body.classList.remove("mcmaster-insert-open");
    if (iframeBlockedTimer) window.clearTimeout(iframeBlockedTimer);
  }

  function closeAll() {
    closeBrowser();
    closePanel();
  }

  panel.querySelector(".insert-panel-close")?.addEventListener("click", closePanel);
  panel.addEventListener("click", (event) => {
    if (event.target === panel) closePanel();
  });
  panel.querySelector('[data-insert-source="mcmaster"]')?.addEventListener("click", () => {
    openBrowser();
  });

  modal.querySelectorAll("[data-mcmaster-close]").forEach((btn) => {
    btn.addEventListener("click", closeBrowser);
  });
  modal.querySelector("[data-mcmaster-search]")?.addEventListener("click", () => {
    navigateMcMaster(searchInput?.value || "");
  });
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      navigateMcMaster(searchInput.value || "");
    }
  });
  modal.querySelector("[data-mcmaster-import]")?.addEventListener("click", () => {
    fileInput?.click();
  });
  fileInput?.addEventListener("change", () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = "";
    void importFiles(files);
  });

  const onDragOver = (event) => {
    event.preventDefault();
    dropZone?.classList.add("is-dragover");
  };
  const onDragLeave = () => dropZone?.classList.remove("is-dragover");
  const onDrop = (event) => {
    event.preventDefault();
    dropZone?.classList.remove("is-dragover");
    const files = [...(event.dataTransfer?.files || [])];
    void importFiles(files);
  };
  dropZone?.addEventListener("dragover", onDragOver);
  dropZone?.addEventListener("dragleave", onDragLeave);
  dropZone?.addEventListener("drop", onDrop);
  modal.querySelector(".mcmaster-insert-body")?.addEventListener("dragover", onDragOver);
  modal.querySelector(".mcmaster-insert-body")?.addEventListener("drop", onDrop);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) {
      closeBrowser();
    }
  });

  frame?.addEventListener("load", () => {
    // Keep helper visible; McMaster may still be blank when framed.
    fallback.hidden = false;
  });

  return {
    open: openPanel,
    close: closeAll,
    openMcMaster: openBrowser,
    closeMcMaster: closeBrowser,
    isOpen() {
      return !panel.classList.contains("hidden") || !modal.classList.contains("hidden");
    },
  };
}
