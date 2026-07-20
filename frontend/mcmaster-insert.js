/**
 * Fusion-style Insert → McMaster-Carr.
 *
 * McMaster blocks iframes (X-Frame-Options: DENY). We open the real site in a
 * top-level popup and host the import dock as a viewport document tab.
 */

const MCMASTER_HOME = "https://www.mcmaster.com/";
const MCMASTER_WINDOW_NAME = "render3d-mcmaster-webview";
const MCMASTER_TAB_ID = "mcmaster";
const CAD_ACCEPT = ".step,.stp,.stl,.obj,.glb,.gltf,.3mf,.iges,.igs,.sat,.sldprt,.x_t,.x_b";
const LOGO_SRC = "/assets/brands/mcmaster-carr-masthead.svg";
const LS_RECENT = "render3d:mcmasterRecent:v1";
const RECENT_MAX = 18;

const CATEGORIES = [
  { id: "fasteners", label: "Screws", path: "products/screws/" },
  { id: "nuts", label: "Nuts", path: "products/nuts/" },
  { id: "washers", label: "Washers", path: "products/washers/" },
  { id: "bearings", label: "Bearings", path: "products/ball-bearings/" },
  { id: "standoffs", label: "Standoffs", path: "products/spacers/" },
  { id: "springs", label: "Springs", path: "products/springs/" },
];

const QUICK_PARTS = [
  { id: "91251A194", number: "91251A194", title: "Socket Head Screw", subtitle: "M5 × 16 mm", shape: "bolt", dims: { radius: 2.5, height: 16, headRadius: 4.2, headHeight: 5 }, tags: ["m5", "socket", "screw"] },
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

function stlFileForPart(part) {
  const tris = [];
  const d = part.dims || {};
  if (part.shape === "bolt") {
    addCylinder(tris, d.radius || 2.5, d.height || 16, 24, 0);
    addCylinder(tris, d.headRadius || 4, d.headHeight || 5, 24, d.height || 16);
  } else if (part.shape === "nut") {
    addCylinder(tris, d.radius || 4.5, d.height || 4, 6, 0);
  } else if (part.shape === "washer") {
    addTorus(tris, d.major || 5, d.minor || 1.2, 28, 10);
  } else if (part.shape === "bearing") {
    addTorus(tris, d.major || 7.5, d.minor || 3.5, 28, 12);
  } else {
    addBox(tris, -5, -5, 0, 5, 5, 4);
  }
  const name = String(part.number || part.id || "part").replace(/[^\w.-]+/g, "_");
  let out = `solid ${name}\n`;
  for (const t of tris) {
    out += ` facet normal ${t.n[0]} ${t.n[1]} ${t.n[2]}\n  outer loop\n`;
    for (const v of t.v) out += `   vertex ${v[0]} ${v[1]} ${v[2]}\n`;
    out += "  endloop\n endfacet\n";
  }
  out += `endsolid ${name}\n`;
  return new File([out], `${name}.stl`, { type: "model/stl" });
}

function readRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_RECENT) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((e) => ({
        id: String(e?.id || e?.number || e?.name || "").trim(),
        number: String(e?.number || "").trim(),
        title: String(e?.title || e?.name || "").trim(),
        subtitle: String(e?.subtitle || "").trim(),
        name: String(e?.name || "").trim(),
        shape: String(e?.shape || "file").trim(),
        source: e?.source === "quick" ? "quick" : "import",
        at: Number(e?.at) || Date.now(),
        quickId: e?.quickId || null,
      }))
      .filter((e) => e.id || e.name)
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function writeRecent(entries) {
  try {
    localStorage.setItem(LS_RECENT, JSON.stringify(entries.slice(0, RECENT_MAX)));
  } catch {
    /* ignore */
  }
}

function pushRecent(entry) {
  const next = [
    { ...entry, at: Date.now() },
    ...readRecent().filter((e) => (e.id || e.name) !== (entry.id || entry.name)),
  ].slice(0, RECENT_MAX);
  writeRecent(next);
  return next;
}

/**
 * @param {{
 *   onImportFiles?: Function,
 *   onStatus?: Function,
 *   resolveDestination?: Function,
 *   onLibrarySave?: Function,
 *   onLoadLibrary?: Function,
 *   docTabs?: any,
 *   viewerEl?: HTMLElement | null,
 * }} options
 */
export function createMcMasterInsert({
  onImportFiles,
  onStatus,
  resolveDestination,
  onLibrarySave = null,
  onLoadLibrary = null,
  docTabs = null,
  viewerEl = null,
} = {}) {
  let mcmasterWin = null;
  let watchTimer = null;
  let sessionOpen = false;
  let recentEntries = readRecent();

  const host = viewerEl || document.getElementById("mcmaster-viewer");

  const panel = document.createElement("div");
  panel.className = "insert-panel-overlay hidden";
  panel.innerHTML = `
    <div class="insert-panel insert-panel--clean" role="dialog" aria-label="Insert">
      <div class="insert-panel-head">
        <div>
          <strong>Insert</strong>
          <span class="muted small">McMaster-Carr parts into this workspace</span>
        </div>
        <button type="button" class="insert-panel-close" aria-label="Close insert">×</button>
      </div>

      <button type="button" class="insert-source-card" data-insert-source="mcmaster">
        <span class="insert-source-icon insert-source-icon--logo" aria-hidden="true">
          <img src="${LOGO_SRC}" alt="" width="120" height="18" />
        </span>
        <span class="insert-source-copy">
          <strong>McMaster-Carr</strong>
          <small>Opens live catalog · docks as a viewport tab</small>
        </span>
      </button>

      <section class="insert-recent-block">
        <div class="insert-recent-head">
          <strong>Recent</strong>
          <button type="button" class="btn secondary btn-compact" data-insert-clear-recent ${recentEntries.length ? "" : "hidden"}>Clear</button>
        </div>
        <div class="insert-recent-list" data-insert-recent></div>
      </section>

      <div class="insert-panel-actions">
        <button type="button" class="btn secondary btn-compact" data-insert-import>Import CAD file…</button>
        <input type="file" class="insert-panel-file" accept="${CAD_ACCEPT}" hidden multiple />
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  if (host) {
    host.classList.add("mcmaster-viewer", "hidden");
    host.setAttribute("aria-hidden", "true");
    host.innerHTML = `
      <div class="mcmaster-tab-shell">
        <header class="mcmaster-tab-chrome">
          <div class="mcmaster-tab-chrome-left">
            <img class="mcmaster-tab-logo" src="${LOGO_SRC}" alt="McMaster-Carr" width="120" height="18" />
            <span class="mcmaster-live-badge" data-mcmaster-conn>Disconnected</span>
          </div>
          <div class="mcmaster-tab-chrome-right">
            <input type="search" class="mcmaster-insert-search" placeholder="Search McMaster…" aria-label="Search McMaster-Carr" />
            <button type="button" class="btn accent btn-compact" data-mcmaster-open>Open site</button>
            <button type="button" class="btn secondary btn-compact" data-mcmaster-focus>Focus</button>
            <button type="button" class="btn secondary btn-compact" data-mcmaster-min title="Show model, keep tab">Minimize</button>
            <button type="button" class="btn secondary btn-compact" data-mcmaster-close-tab title="Close McMaster tab">Close</button>
          </div>
        </header>

        <div class="mcmaster-tab-body">
          <section class="mcmaster-tab-main">
            <div class="mcmaster-live-drop" data-mcmaster-drop tabindex="0">
              <strong>Drop downloaded CAD here</strong>
              <span>Asks current workspace or new project · STEP · STL · GLB · 3MF</span>
              <button type="button" class="btn accent btn-compact" data-mcmaster-import>Import download…</button>
              <input type="file" class="mcmaster-insert-file" accept="${CAD_ACCEPT}" hidden multiple />
            </div>
            <div class="mcmaster-live-shortcuts">
              <span class="muted small">Browse</span>
              <div class="mcmaster-live-shortcut-row">
                ${CATEGORIES.map((c) => `<button type="button" class="btn secondary btn-compact" data-mcmaster-nav="${escapeHtml(c.path)}">${escapeHtml(c.label)}</button>`).join("")}
              </div>
            </div>
            <p class="mcmaster-tab-hint muted small" data-mcmaster-stage-copy>
              Live McMaster opens in a separate browser window (iframes are blocked). Download CAD there, then drop it here.
            </p>
          </section>

          <aside class="mcmaster-tab-side">
            <div class="mcmaster-quick-block">
              <div class="mcmaster-quick-head">
                <strong>Quick insert</strong>
                <span class="muted small">Approx. STL</span>
              </div>
              <div class="mcmaster-quick-list" data-mcmaster-quick></div>
            </div>
            <div class="mcmaster-library-block">
              <div class="mcmaster-quick-head">
                <strong>This project</strong>
                <span class="muted small">mcmaster_library/</span>
              </div>
              <div class="mcmaster-library-list" data-mcmaster-library>
                <p class="muted small">Nothing imported yet.</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    `;
  }

  const searchInput = host?.querySelector(".mcmaster-insert-search");
  const connBadge = host?.querySelector("[data-mcmaster-conn]");
  const stageCopy = host?.querySelector("[data-mcmaster-stage-copy]");
  const fileInput = host?.querySelector(".mcmaster-insert-file");
  const dropZone = host?.querySelector("[data-mcmaster-drop]");
  const quickList = host?.querySelector("[data-mcmaster-quick]");
  const libraryList = host?.querySelector("[data-mcmaster-library]");
  const recentList = panel.querySelector("[data-insert-recent]");
  const clearRecentBtn = panel.querySelector("[data-insert-clear-recent]");
  const panelFileInput = panel.querySelector(".insert-panel-file");

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
      connBadge.textContent = open ? "Live" : "Disconnected";
      connBadge.classList.toggle("is-live", open);
    }
    host?.classList.toggle("is-connected", open);
    if (stageCopy) {
      stageCopy.textContent = open
        ? "McMaster is open beside Render3D. Download a 3-D model, then drop the file onto this tab."
        : "Open the live McMaster site, download CAD, then drop it here. You’ll choose current workspace or a new project.";
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

  function setViewerVisible(visible) {
    if (!host) return;
    host.classList.toggle("hidden", !visible);
    host.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function syncDocTab({ activate = false } = {}) {
    if (!docTabs) return;
    docTabs.upsert({
      id: MCMASTER_TAB_ID,
      label: "McMaster-Carr",
      kind: "mcmaster",
    });
    if (activate) docTabs.setActive(MCMASTER_TAB_ID);
  }

  function openLiveWindow(url = MCMASTER_HOME) {
    const w = Math.min(1280, Math.max(960, window.screen.availWidth - 80));
    const h = Math.min(900, Math.max(700, window.screen.availHeight - 80));
    const left = Math.max(20, Math.round((window.screen.availWidth - w) / 2));
    const top = Math.max(20, Math.round((window.screen.availHeight - h) / 2));
    const features = `popup=yes,noopener=no,noreferrer=no,width=${w},height=${h},left=${left},top=${top}`;
    mcmasterWin = window.open(url, MCMASTER_WINDOW_NAME, features);
    if (!mcmasterWin) {
      setStatus("error", "Popup blocked — allow popups for Render3D to open McMaster.");
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
    setStatus("ok", "McMaster-Carr opened — docked as a viewport tab.");
    return mcmasterWin;
  }

  function focusLiveWindow() {
    if (!isWinOpen()) {
      openLiveWindow(searchUrlFromInput());
      return;
    }
    try {
      mcmasterWin.focus();
    } catch {
      openLiveWindow(searchUrlFromInput());
    }
  }

  function searchUrlFromInput() {
    const q = String(searchInput?.value || "").trim();
    if (!q) return MCMASTER_HOME;
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
      libraryEntries = entries;
      renderLibrary();
    } catch {
      /* optional */
    }
  }

  function rememberImport(names, meta = {}) {
    for (const name of names) {
      const quick = meta.quick || QUICK_PARTS.find((p) => name.startsWith(p.number));
      recentEntries = pushRecent({
        id: quick?.id || name,
        number: quick?.number || "",
        title: quick?.title || name,
        subtitle: quick?.subtitle || "",
        name,
        shape: quick?.shape || "file",
        source: quick ? "quick" : "import",
        quickId: quick?.id || null,
      });
    }
    renderRecent();
  }

  async function importFiles(fileList, meta = {}) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    try {
      const choice = await resolveDestination?.(files);
      if (!choice) {
        setStatus("ok", "Import cancelled.");
        return;
      }
      setStatus("loading", `Importing ${files.length === 1 ? files[0].name : `${files.length} files`}…`);
      const results = await onImportFiles?.(files, choice);
      const savedNames = Array.isArray(results) && results.length
        ? results.map((r) => r?.filename || r?.name).filter(Boolean)
        : files.map((f) => f.name);
      rememberImport(savedNames, meta);
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
        ? `Inserted ${savedNames[0]}.`
        : `Inserted ${savedNames.length} files.`);
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
        await importFiles([stlFileForPart(part)], { quick: part });
      });
    });
  }

  function renderLibrary() {
    if (!libraryList) return;
    if (!libraryEntries.length) {
      libraryList.innerHTML = `<p class="muted small">Nothing imported yet.</p>`;
      return;
    }
    libraryList.innerHTML = libraryEntries.map((entry) => `
      <div class="mcmaster-library-row">
        <strong title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</strong>
        <small>${new Date(entry.at).toLocaleDateString()}</small>
      </div>
    `).join("");
  }

  function renderRecent() {
    if (!recentList) return;
    recentEntries = readRecent();
    if (clearRecentBtn) clearRecentBtn.hidden = !recentEntries.length;
    if (!recentEntries.length) {
      recentList.innerHTML = `<p class="muted small insert-recent-empty">Recent screws, nuts, and imports show up here.</p>`;
      return;
    }
    recentList.innerHTML = recentEntries.map((entry) => {
      const label = entry.number || entry.title || entry.name;
      const sub = entry.subtitle || (entry.source === "import" ? entry.name : entry.title);
      return `
        <button type="button" class="insert-recent-card" data-recent-id="${escapeHtml(entry.id || entry.name)}" title="${escapeHtml(entry.name || label)}">
          <span class="mcmaster-sim-card-preview" data-shape="${escapeHtml(entry.shape || "file")}" aria-hidden="true"></span>
          <span>
            <strong>${escapeHtml(label)}</strong>
            <small>${escapeHtml(sub || "")}</small>
          </span>
        </button>
      `;
    }).join("");
    recentList.querySelectorAll("[data-recent-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const entry = recentEntries.find((e) => (e.id || e.name) === btn.dataset.recentId);
        if (!entry) return;
        if (entry.quickId || entry.source === "quick") {
          const part = QUICK_PARTS.find((p) => p.id === (entry.quickId || entry.id));
          if (part) {
            await importFiles([stlFileForPart(part)], { quick: part });
            return;
          }
        }
        // Re-open McMaster to that part number when possible.
        closePanel();
        openSession({
          query: entry.number || entry.name.replace(/\.[^.]+$/, ""),
          autoOpen: true,
        });
      });
    });
  }

  function openPanel() {
    renderRecent();
    panel.classList.remove("hidden");
  }

  function closePanel() {
    panel.classList.add("hidden");
  }

  function activateSession() {
    sessionOpen = true;
    syncDocTab({ activate: true });
    setViewerVisible(true);
    renderQuick();
    renderLibrary();
    void hydrateLibrary();
    syncConnectionUi();
  }

  function hideViewerOnly() {
    setViewerVisible(false);
  }

  function minimizeToTab() {
    // Keep the viewport tab; return to the 3D model.
    hideViewerOnly();
    docTabs?.deactivate?.({ notify: true });
    setStatus("ok", "McMaster minimized to a tab — click it to return.");
  }

  function closeSession({ keepWindow = true } = {}) {
    sessionOpen = false;
    hideViewerOnly();
    stopWatch();
    if (docTabs?.has?.(MCMASTER_TAB_ID)) docTabs.remove(MCMASTER_TAB_ID);
    if (!keepWindow && isWinOpen()) {
      try {
        mcmasterWin.close();
      } catch {
        /* ignore */
      }
      mcmasterWin = null;
    }
    syncConnectionUi();
  }

  function openSession({ query = "", autoOpen = true } = {}) {
    closePanel();
    if (query && searchInput) searchInput.value = query;
    activateSession();
    if (autoOpen) openLiveWindow(searchUrlFromInput());
  }

  function closeAll() {
    closePanel();
    // Leave the McMaster tab/session alone unless caller closes the tab.
  }

  panel.querySelector(".insert-panel-close")?.addEventListener("click", closePanel);
  panel.addEventListener("click", (event) => {
    if (event.target === panel) closePanel();
  });
  panel.querySelector('[data-insert-source="mcmaster"]')?.addEventListener("click", () => {
    openSession({ autoOpen: true });
  });
  clearRecentBtn?.addEventListener("click", () => {
    writeRecent([]);
    recentEntries = [];
    renderRecent();
  });
  panel.querySelector("[data-insert-import]")?.addEventListener("click", () => panelFileInput?.click());
  panelFileInput?.addEventListener("change", () => {
    const files = [...(panelFileInput.files || [])];
    panelFileInput.value = "";
    void importFiles(files);
  });

  host?.querySelectorAll("[data-mcmaster-open]").forEach((btn) => {
    btn.addEventListener("click", () => openLiveWindow(searchUrlFromInput()));
  });
  host?.querySelectorAll("[data-mcmaster-focus]").forEach((btn) => {
    btn.addEventListener("click", () => focusLiveWindow());
  });
  host?.querySelector("[data-mcmaster-min]")?.addEventListener("click", () => minimizeToTab());
  host?.querySelector("[data-mcmaster-close-tab]")?.addEventListener("click", () => closeSession({ keepWindow: true }));
  host?.querySelectorAll("[data-mcmaster-nav]").forEach((btn) => {
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

  host?.querySelector("[data-mcmaster-import]")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = "";
    void importFiles(files);
  });

  dropZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragover");
  });
  dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("is-dragover"));
  dropZone?.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragover");
    void importFiles([...(event.dataTransfer?.files || [])]);
  });

  window.addEventListener("focus", () => {
    if (sessionOpen && !host?.classList.contains("hidden") && isWinOpen()) {
      dropZone?.classList.add("is-attention");
      window.setTimeout(() => dropZone?.classList.remove("is-attention"), 1600);
    }
  });

  return {
    open: openPanel,
    close: closeAll,
    openMcMaster: openSession,
    closeMcMaster: () => closeSession({ keepWindow: true }),
    activateFromShared() {
      activateSession();
    },
    hideViewerOnly,
    closeTab(id) {
      if (id && id !== MCMASTER_TAB_ID) return;
      closeSession({ keepWindow: true });
    },
    isOpen() {
      return !panel.classList.contains("hidden") || sessionOpen;
    },
  };
}
