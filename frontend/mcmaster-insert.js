/**
 * Fusion-style Insert → McMaster-Carr.
 *
 * Why not an iframe?
 *   McMaster sends X-Frame-Options: DENY. Browsers block embedding.
 *   Fusion does NOT iframe McMaster — it loads it in a native top-level
 *   WebView/CEF document, where framing headers don't apply.
 *
 * Web equivalent:
 *   Open McMaster in a real popup/tab (top-level document) and keep our
 *   Fusion chrome as a connected dock for drop/import + library.
 */

const MCMASTER_HOME = "https://www.mcmaster.com/";
const MCMASTER_WINDOW_NAME = "render3d-mcmaster-webview";
const CAD_ACCEPT = ".step,.stp,.stl,.obj,.glb,.gltf,.3mf,.iges,.igs,.sat,.sldprt,.x_t,.x_b";
const LOGO_SRC = "/assets/brands/mcmaster-carr-masthead.svg";

const CATEGORIES = [
  { id: "fasteners", label: "Screws & Bolts", path: "products/screws/" },
  { id: "nuts", label: "Nuts", path: "products/nuts/" },
  { id: "washers", label: "Washers", path: "products/washers/" },
  { id: "bearings", label: "Ball Bearings", path: "products/ball-bearings/" },
  { id: "standoffs", label: "Spacers & Standoffs", path: "products/spacers/" },
  { id: "shafts", label: "Shafts & Rods", path: "products/rods/" },
  { id: "plates", label: "Plates & Bars", path: "products/metal/" },
  { id: "springs", label: "Springs", path: "products/springs/" },
];

/** Quick-insert fallbacks when you want a part without browsing live McMaster. */
const QUICK_PARTS = [
  { id: "91251A194", number: "91251A194", title: "Socket Head Screw", subtitle: "M5 × 16 mm", shape: "bolt", dims: { radius: 2.5, height: 16, headRadius: 4.2, headHeight: 5 }, tags: ["m5", "socket"] },
  { id: "90592A015", number: "90592A015", title: "Hex Nut", subtitle: "M5 × 0.8 mm", shape: "nut", dims: { radius: 4.5, height: 4 }, tags: ["m5", "nut"] },
  { id: "92141A011", number: "92141A011", title: "Flat Washer", subtitle: "For M5", shape: "washer", dims: { major: 5, minor: 1.2 }, tags: ["m5", "washer"] },
  { id: "7804K55", number: "7804K55", title: "Ball Bearing", subtitle: "608 · 8×22 mm", shape: "bearing", dims: { major: 7.5, minor: 3.5 }, tags: ["608", "bearing"] },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function norm(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
function tri(a, b, c) {
  return { n: norm(cross(sub(b, a), sub(c, a))), v: [a, b, c] };
}
function addBox(tris, x0, y0, z0, x1, y1, z1) {
  const p = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  for (const f of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) {
    tris.push(tri(p[f[0]], p[f[1]], p[f[2]]), tri(p[f[0]], p[f[2]], p[f[3]]));
  }
}
function addCylinder(tris, radius, height, segments = 24, z0 = 0) {
  const z1 = z0 + height;
  const ring0 = [];
  const ring1 = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    ring0.push([Math.cos(a) * radius, Math.sin(a) * radius, z0]);
    ring1.push([Math.cos(a) * radius, Math.sin(a) * radius, z1]);
  }
  const c0 = [0, 0, z0];
  const c1 = [0, 0, z1];
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    tris.push(tri(c0, ring0[j], ring0[i]), tri(c1, ring1[i], ring1[j]), tri(ring0[i], ring0[j], ring1[j]), tri(ring0[i], ring1[j], ring1[i]));
  }
}
function addTorus(tris, major, minor, segMajor = 24, segMinor = 12) {
  const ring = [];
  for (let i = 0; i < segMajor; i += 1) {
    const row = [];
    const u = (i / segMajor) * Math.PI * 2;
    for (let j = 0; j < segMinor; j += 1) {
      const v = (j / segMinor) * Math.PI * 2;
      const r = major + Math.cos(v) * minor;
      row.push([Math.cos(u) * r, Math.sin(u) * r, Math.sin(v) * minor]);
    }
    ring.push(row);
  }
  for (let i = 0; i < segMajor; i += 1) {
    const i2 = (i + 1) % segMajor;
    for (let j = 0; j < segMinor; j += 1) {
      const j2 = (j + 1) % segMinor;
      tris.push(tri(ring[i][j], ring[i2][j], ring[i2][j2]), tri(ring[i][j], ring[i2][j2], ring[i][j2]));
    }
  }
}
function meshForPart(part) {
  const tris = [];
  const d = part.dims || {};
  if (part.shape === "bolt") {
    addCylinder(tris, d.radius || 2, d.height || 16, 24, 0);
    addCylinder(tris, d.headRadius || 4, d.headHeight || 4, 24, d.height || 16);
  } else if (part.shape === "nut") {
    addCylinder(tris, d.radius || 4, d.height || 4, 6, 0);
  } else if (part.shape === "washer" || part.shape === "bearing") {
    addTorus(tris, d.major || 5, d.minor || 1.2);
  } else {
    const L = d.length || 40;
    const W = d.width || 40;
    const H = d.height || 3;
    addBox(tris, -L / 2, -W / 2, 0, L / 2, W / 2, H);
  }
  return tris;
}
function stlFileForPart(part) {
  const tris = meshForPart(part);
  const safe = String(part.number || part.id || "part").replace(/[^\w.-]+/g, "_");
  const name = `mcmaster_${safe}`;
  let out = `solid ${name}\n`;
  for (const t of tris) {
    out += ` facet normal ${t.n[0]} ${t.n[1]} ${t.n[2]}\n  outer loop\n`;
    for (const v of t.v) out += `   vertex ${v[0]} ${v[1]} ${v[2]}\n`;
    out += "  endloop\n endfacet\n";
  }
  out += `endsolid ${name}\n`;
  return new File([out], `${name}.stl`, { type: "model/stl" });
}

export function createMcMasterInsert({
  onImportFiles,
  onStatus,
  resolveDestination,
  onLibrarySave = null,
  onLoadLibrary = null,
} = {}) {
  let mcmasterWin = null;
  let watchTimer = null;
  let libraryEntries = [];

  const panel = document.createElement("div");
  panel.className = "insert-panel-overlay hidden";
  panel.innerHTML = `
    <div class="insert-panel" role="dialog" aria-label="Insert">
      <div class="insert-panel-head">
        <div>
          <strong>Insert</strong>
          <span class="muted small">Supplier parts — live McMaster-Carr in a connected browser window (Fusion-style).</span>
        </div>
        <button type="button" class="insert-panel-close" aria-label="Close insert">×</button>
      </div>
      <div class="insert-panel-grid">
        <button type="button" class="insert-source-card" data-insert-source="mcmaster">
          <span class="insert-source-icon insert-source-icon--logo" aria-hidden="true">
            <img src="${LOGO_SRC}" alt="" width="120" height="18" />
          </span>
          <span class="insert-source-copy">
            <strong>McMaster-Carr</strong>
            <small>Opens the real site in a top-level window — not an iframe (those are blocked)</small>
          </span>
        </button>
      </div>
      <p class="muted small insert-panel-hint">Same approach as Fusion: McMaster runs as its own browser document. Download CAD there, then drop it into the Render3D dock.</p>
    </div>
  `;
  document.body.appendChild(panel);

  const modal = document.createElement("div");
  modal.className = "mcmaster-insert-modal hidden";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "mcmaster-insert-title");
  modal.innerHTML = `
    <div class="mcmaster-insert-shell mcmaster-insert-shell--live">
      <header class="mcmaster-insert-chrome">
        <div class="mcmaster-insert-chrome-left">
          <button type="button" class="mcmaster-insert-min" data-mcmaster-close title="Close" aria-label="Close">−</button>
          <strong id="mcmaster-insert-title">INSERT MCMASTER-CARR COMPONENT</strong>
          <span class="mcmaster-live-badge" data-mcmaster-conn>Disconnected</span>
        </div>
        <div class="mcmaster-insert-chrome-right">
          <input type="search" class="mcmaster-insert-search" placeholder="Search McMaster (opens in live window)…" aria-label="Search McMaster-Carr" />
          <button type="button" class="btn accent btn-compact" data-mcmaster-open>Open McMaster</button>
          <button type="button" class="btn secondary btn-compact" data-mcmaster-focus>Focus window</button>
        </div>
      </header>

      <div class="mcmaster-live-layout">
        <section class="mcmaster-live-dock">
          <div class="mcmaster-live-dock-brand">
            <img src="${LOGO_SRC}" alt="McMaster-Carr" width="160" height="24" />
          </div>
          <p class="mcmaster-live-explain">
            <strong>Why a separate window?</strong>
            McMaster blocks iframes (<code>X-Frame-Options: DENY</code>).
            Fusion embeds it in a <em>native webview</em> — a real top-level page, not a frame.
            We do the same: open McMaster as a real browser window, then import CAD here.
          </p>

          <div class="mcmaster-live-drop" data-mcmaster-drop tabindex="0">
            <strong>Drop downloaded CAD here</strong>
            <span>STEP · STL · GLB · 3MF from McMaster’s Download 3-D Model</span>
            <button type="button" class="btn accent btn-compact" data-mcmaster-import>Import download…</button>
            <input type="file" class="mcmaster-insert-file" accept="${CAD_ACCEPT}" hidden multiple />
          </div>

          <div class="mcmaster-live-shortcuts">
            <span class="muted small">Jump live window to:</span>
            <div class="mcmaster-live-shortcut-row">
              ${CATEGORIES.map((c) => `<button type="button" class="btn secondary btn-compact" data-mcmaster-nav="${escapeHtml(c.path)}">${escapeHtml(c.label)}</button>`).join("")}
            </div>
          </div>

          <div class="mcmaster-quick-block">
            <div class="mcmaster-quick-head">
              <strong>Quick insert</strong>
              <span class="muted small">Approximate STL if you don’t need the official McMaster STEP yet</span>
            </div>
            <div class="mcmaster-quick-list" data-mcmaster-quick></div>
          </div>

          <div class="mcmaster-library-block">
            <div class="mcmaster-quick-head">
              <strong>Project library</strong>
              <span class="muted small">Saved under <code>mcmaster_library/</code> in this project</span>
            </div>
            <div class="mcmaster-library-list" data-mcmaster-library>
              <p class="muted small">Imported McMaster parts will appear here.</p>
            </div>
          </div>
        </section>

        <section class="mcmaster-live-stage" data-mcmaster-stage>
          <div class="mcmaster-live-stage-card">
            <div class="mcmaster-live-stage-visual" aria-hidden="true"></div>
            <h3>Live McMaster-Carr window</h3>
            <p data-mcmaster-stage-copy>
              Click <strong>Open McMaster</strong> to launch the real site beside this dock.
              Browse and download there, then drop the CAD file back here.
            </p>
            <div class="mcmaster-live-stage-actions">
              <button type="button" class="btn accent" data-mcmaster-open>Open McMaster window</button>
              <button type="button" class="btn secondary" data-mcmaster-focus>Bring to front</button>
            </div>
            <ol class="mcmaster-live-steps">
              <li>Open the connected McMaster window</li>
              <li>Find a part → <em>Download 3-D Model / CAD</em></li>
              <li>Drop the file on this dock (asks current project vs new)</li>
            </ol>
          </div>
        </section>
      </div>

      <footer class="mcmaster-insert-footer">
        <div class="mcmaster-insert-footer-hint muted small">
          Destination: Preferences → McMaster-Carr insert (ask / current / new). Official CAD comes from McMaster’s site download.
        </div>
        <div class="mcmaster-insert-footer-actions">
          <button type="button" class="btn secondary btn-compact" data-mcmaster-close>Close</button>
        </div>
      </footer>
    </div>
  `;
  document.body.appendChild(modal);

  const searchInput = modal.querySelector(".mcmaster-insert-search");
  const connBadge = modal.querySelector("[data-mcmaster-conn]");
  const stageCopy = modal.querySelector("[data-mcmaster-stage-copy]");
  const fileInput = modal.querySelector(".mcmaster-insert-file");
  const dropZone = modal.querySelector("[data-mcmaster-drop]");
  const quickList = modal.querySelector("[data-mcmaster-quick]");
  const libraryList = modal.querySelector("[data-mcmaster-library]");

  function setStatus(kind, text) {
    onStatus?.(kind, text);
  }

  function isWinOpen() {
    try {
      return !!(mcmasterWin && !mcmasterWin.closed);
    } catch {
      return false;
    }
  }

  function syncConnectionUi() {
    const open = isWinOpen();
    if (connBadge) {
      connBadge.textContent = open ? "Live window connected" : "Disconnected";
      connBadge.classList.toggle("is-live", open);
    }
    modal.classList.toggle("is-connected", open);
    if (stageCopy) {
      stageCopy.innerHTML = open
        ? "McMaster is open in a <strong>top-level browser window</strong> (not framed). Download CAD there, then drop the file onto this dock."
        : "Click <strong>Open McMaster</strong> to launch the real site beside this dock. Browse and download there, then drop the CAD file back here.";
    }
  }

  function stopWatch() {
    if (watchTimer) {
      window.clearInterval(watchTimer);
      watchTimer = null;
    }
  }

  function startWatch() {
    stopWatch();
    watchTimer = window.setInterval(() => {
      if (!isWinOpen()) {
        mcmasterWin = null;
        syncConnectionUi();
        stopWatch();
      }
    }, 800);
  }

  function openLiveWindow(url = MCMASTER_HOME) {
    const w = Math.min(1280, Math.max(960, window.screen.availWidth - 80));
    const h = Math.min(900, Math.max(700, window.screen.availHeight - 80));
    const left = Math.max(20, Math.round((window.screen.availWidth - w) / 2));
    const top = Math.max(20, Math.round((window.screen.availHeight - h) / 2));
    const features = `popup=yes,noopener=no,noreferrer=no,width=${w},height=${h},left=${left},top=${top}`;
    // Reuse the named window so Focus / Search navigate the same session.
    mcmasterWin = window.open(url, MCMASTER_WINDOW_NAME, features);
    if (!mcmasterWin) {
      setStatus("error", "Popup blocked — allow popups for Render3D to open the McMaster window.");
      syncConnectionUi();
      return null;
    }
    try {
      mcmasterWin.focus();
    } catch {
      /* ignore */
    }
    startWatch();
    syncConnectionUi();
    setStatus("ok", "McMaster-Carr opened in a live browser window.");
    return mcmasterWin;
  }

  function focusLiveWindow() {
    if (!isWinOpen()) {
      openLiveWindow(searchUrlFromInput());
      return;
    }
    try {
      mcmasterWin.focus();
      setStatus("ok", "Focused McMaster window.");
    } catch {
      openLiveWindow(searchUrlFromInput());
    }
  }

  function searchUrlFromInput() {
    const q = String(searchInput?.value || "").trim();
    if (!q) return MCMASTER_HOME;
    // Part-number-ish → direct product page; otherwise search.
    if (/^[0-9A-Za-z]{5,12}$/.test(q) && /\d/.test(q) && /[A-Za-z]/.test(q)) {
      return `https://www.mcmaster.com/${encodeURIComponent(q)}`;
    }
    return `https://www.mcmaster.com/search/?q=${encodeURIComponent(q)}`;
  }

  function navigateLive(url) {
    if (!isWinOpen()) {
      openLiveWindow(url);
      return;
    }
    try {
      mcmasterWin.location.href = url;
      mcmasterWin.focus();
    } catch {
      // Cross-origin: can't assign location after navigation — reopen named window.
      openLiveWindow(url);
    }
  }

  function normalizeLibraryEntries(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => ({
        name: String(entry?.name || entry?.filename || "").trim(),
        at: entry?.at || entry?.imported_at || Date.now(),
      }))
      .filter((entry) => entry.name)
      .slice(0, 48);
  }

  async function hydrateLibrary() {
    if (!onLoadLibrary) return;
    try {
      const entries = normalizeLibraryEntries(await onLoadLibrary());
      if (entries.length) {
        libraryEntries = entries;
        renderLibrary();
      }
    } catch {
      /* optional */
    }
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
      const results = await onImportFiles?.(files, choice);
      const savedNames = Array.isArray(results) && results.length
        ? results.map((r) => r?.filename || r?.name).filter(Boolean)
        : files.map((f) => f.name);
      for (const name of savedNames) {
        libraryEntries = [
          { name, at: Date.now() },
          ...libraryEntries.filter((e) => e.name !== name),
        ].slice(0, 48);
      }
      renderLibrary();
      try {
        const saved = await onLibrarySave?.(savedNames, choice);
        const next = normalizeLibraryEntries(saved);
        if (next.length) {
          libraryEntries = next;
          renderLibrary();
        }
      } catch {
        /* optional */
      }
      setStatus("ok", savedNames.length === 1
        ? `Inserted ${savedNames[0]} from McMaster-Carr.`
        : `Inserted ${savedNames.length} McMaster-Carr files.`);
    } catch (err) {
      setStatus("error", err?.message || "Could not import McMaster part.");
    }
  }

  function renderQuick() {
    if (!quickList) return;
    quickList.innerHTML = QUICK_PARTS.map((part) => `
      <button type="button" class="mcmaster-quick-card" data-quick-id="${escapeHtml(part.id)}">
        <span class="mcmaster-sim-card-preview" data-shape="${escapeHtml(part.shape)}" aria-hidden="true"></span>
        <span>
          <em>${escapeHtml(part.number)}</em>
          <strong>${escapeHtml(part.title)}</strong>
          <small>${escapeHtml(part.subtitle || "")}</small>
        </span>
      </button>
    `).join("");
    quickList.querySelectorAll("[data-quick-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const part = QUICK_PARTS.find((p) => p.id === btn.dataset.quickId);
        if (!part) return;
        await importFiles([stlFileForPart(part)]);
      });
    });
  }

  function renderLibrary() {
    if (!libraryList) return;
    if (!libraryEntries.length) {
      libraryList.innerHTML = `<p class="muted small">Imported McMaster parts will appear here.</p>`;
      return;
    }
    libraryList.innerHTML = libraryEntries.map((entry) => `
      <div class="mcmaster-library-row">
        <strong>${escapeHtml(entry.name)}</strong>
        <small>${new Date(entry.at).toLocaleString()}</small>
      </div>
    `).join("");
  }

  function openPanel() {
    panel.classList.remove("hidden");
  }
  function closePanel() {
    panel.classList.add("hidden");
  }

  function openBrowser({ query = "", autoOpen = true } = {}) {
    modal.classList.remove("hidden");
    document.body.classList.add("mcmaster-insert-open");
    if (query && searchInput) searchInput.value = query;
    renderQuick();
    renderLibrary();
    void hydrateLibrary();
    syncConnectionUi();
    if (autoOpen) {
      // Open live window immediately — this is the Fusion-like path.
      openLiveWindow(searchUrlFromInput());
    }
  }

  function closeBrowser() {
    modal.classList.add("hidden");
    document.body.classList.remove("mcmaster-insert-open");
    // Keep McMaster window open so downloads aren't interrupted; user can close it.
    stopWatch();
  }

  function closeAll() {
    closeBrowser();
    closePanel();
  }

  panel.querySelector(".insert-panel-close")?.addEventListener("click", closePanel);
  panel.addEventListener("click", (event) => {
    if (event.target === panel) closePanel();
  });
  panel.querySelector('[data-insert-source="mcmaster"]')?.addEventListener("click", () => openBrowser({ autoOpen: true }));

  modal.querySelectorAll("[data-mcmaster-close]").forEach((btn) => {
    btn.addEventListener("click", closeBrowser);
  });
  modal.querySelectorAll("[data-mcmaster-open]").forEach((btn) => {
    btn.addEventListener("click", () => openLiveWindow(searchUrlFromInput()));
  });
  modal.querySelectorAll("[data-mcmaster-focus]").forEach((btn) => {
    btn.addEventListener("click", () => focusLiveWindow());
  });
  modal.querySelectorAll("[data-mcmaster-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigateLive(`https://www.mcmaster.com/${btn.dataset.mcmasterNav}`);
    });
  });
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      navigateLive(searchUrlFromInput());
    }
  });

  modal.querySelector("[data-mcmaster-import]")?.addEventListener("click", () => fileInput?.click());
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
    void importFiles([...(event.dataTransfer?.files || [])]);
  };
  dropZone?.addEventListener("dragover", onDragOver);
  dropZone?.addEventListener("dragleave", onDragLeave);
  dropZone?.addEventListener("drop", onDrop);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) closeBrowser();
  });

  // When user returns from McMaster after a download, nudge the drop zone.
  window.addEventListener("focus", () => {
    if (!modal.classList.contains("hidden") && isWinOpen()) {
      dropZone?.classList.add("is-attention");
      window.setTimeout(() => dropZone?.classList.remove("is-attention"), 1600);
    }
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
