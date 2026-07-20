/**
 * Fusion-style Insert → McMaster-Carr.
 *
 * McMaster blocks iframes. We open the live site in a popup and host a
 * viewport tab where downloads are staged, then inserted into a workspace.
 * Recent inserts show on the right.
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
  { id: "91251A194", number: "91251A194", title: "Socket Head Screw", subtitle: "M5 × 16 mm", shape: "bolt", dims: { radius: 2.5, height: 16, headRadius: 4.2, headHeight: 5 } },
  { id: "90592A015", number: "90592A015", title: "Hex Nut", subtitle: "M5 × 0.8 mm", shape: "nut", dims: { radius: 4.5, height: 4 } },
  { id: "92141A011", number: "92141A011", title: "Flat Washer", subtitle: "For M5", shape: "washer", dims: { major: 5, minor: 1.2 } },
  { id: "7804K55", number: "7804K55", title: "Ball Bearing", subtitle: "608 · 8×22 mm", shape: "bearing", dims: { major: 7.5, minor: 3.5 } },
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

export function createMcMasterInsert({
  onImportFiles,
  onStatus,
  resolveDestination,
  onLibrarySave = null,
  docTabs = null,
  viewerEl = null,
} = {}) {
  let mcmasterWin = null;
  let watchTimer = null;
  let sessionOpen = false;
  let recentEntries = readRecent();
  /** @type {{ id: string, file: File, meta?: object }[]} */
  let pending = [];
  let awaitingDownload = false;
  let pickerBusy = false;

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
          <small>Live catalog · docks as a viewport tab</small>
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
            <button type="button" class="btn accent btn-compact" data-mcmaster-open>Open McMaster</button>
            <button type="button" class="btn secondary btn-compact" data-mcmaster-focus>Focus site</button>
            <button type="button" class="btn secondary btn-compact" data-mcmaster-min>Minimize</button>
            <button type="button" class="btn secondary btn-compact" data-mcmaster-close-tab>Close</button>
          </div>
        </header>
        <div class="mcmaster-tab-body">
          <section class="mcmaster-tab-main">
            <div class="mcmaster-stage-banner">
              <strong>1. Download CAD on McMaster</strong>
              <span>2. Bring the file into this tab · 3. Insert into a workspace</span>
            </div>
            <div class="mcmaster-live-drop" data-mcmaster-drop tabindex="0">
              <strong>Bring download into this tab</strong>
              <span>Drop the STEP / STL here, or choose it from Downloads</span>
              <div class="mcmaster-drop-actions">
                <button type="button" class="btn accent" data-mcmaster-import>Choose downloaded CAD…</button>
              </div>
              <input type="file" class="mcmaster-insert-file" accept="${CAD_ACCEPT}" hidden multiple />
            </div>
            <div class="mcmaster-pending-block">
              <div class="mcmaster-quick-head">
                <strong>Ready to insert</strong>
                <span class="muted small" data-mcmaster-pending-count>No files yet</span>
              </div>
              <div class="mcmaster-pending-list" data-mcmaster-pending>
                <p class="muted small">Downloaded parts appear here first. Then insert into the current workspace or a new project.</p>
              </div>
              <div class="mcmaster-pending-actions" data-mcmaster-pending-actions hidden>
                <button type="button" class="btn accent" data-mcmaster-insert-all>Insert into workspace…</button>
                <button type="button" class="btn secondary btn-compact" data-mcmaster-clear-pending>Clear</button>
              </div>
            </div>
            <div class="mcmaster-live-shortcuts">
              <span class="muted small">Browse McMaster</span>
              <div class="mcmaster-live-shortcut-row">
                ${CATEGORIES.map((c) => `<button type="button" class="btn secondary btn-compact" data-mcmaster-nav="${escapeHtml(c.path)}">${escapeHtml(c.label)}</button>`).join("")}
              </div>
            </div>
          </section>
          <aside class="mcmaster-tab-side">
            <div class="mcmaster-recent-side">
              <div class="mcmaster-quick-head">
                <strong>Recent inserts</strong>
                <button type="button" class="btn secondary btn-compact" data-mcmaster-clear-recent>Clear</button>
              </div>
              <div class="mcmaster-recent-side-list" data-mcmaster-tab-recent>
                <p class="muted small">Inserted screws and CAD show up here.</p>
              </div>
            </div>
            <div class="mcmaster-quick-block">
              <div class="mcmaster-quick-head">
                <strong>Quick parts</strong>
                <span class="muted small">Approx. STL</span>
              </div>
              <div class="mcmaster-quick-list" data-mcmaster-quick></div>
            </div>
          </aside>
        </div>
      </div>
    `;
  }

  const searchInput = host?.querySelector(".mcmaster-insert-search");
  const connBadge = host?.querySelector("[data-mcmaster-conn]");
  const fileInput = host?.querySelector(".mcmaster-insert-file");
  const dropZone = host?.querySelector("[data-mcmaster-drop]");
  const pendingList = host?.querySelector("[data-mcmaster-pending]");
  const pendingCount = host?.querySelector("[data-mcmaster-pending-count]");
  const pendingActions = host?.querySelector("[data-mcmaster-pending-actions]");
  const quickList = host?.querySelector("[data-mcmaster-quick]");
  const tabRecentList = host?.querySelector("[data-mcmaster-tab-recent]");
  const clearTabRecentBtn = host?.querySelector("[data-mcmaster-clear-recent]");
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
    host?.classList.toggle("is-awaiting", awaitingDownload);
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
      label: pending.length ? `McMaster (${pending.length})` : "McMaster-Carr",
      kind: "mcmaster",
    });
    if (activate) docTabs.setActive(MCMASTER_TAB_ID);
  }

  function markAwaitingDownload() {
    awaitingDownload = true;
    syncConnectionUi();
    dropZone?.classList.add("is-attention");
  }

  function clearAwaitingDownload() {
    awaitingDownload = false;
    syncConnectionUi();
    dropZone?.classList.remove("is-attention");
  }

  function openLiveWindow(url = MCMASTER_HOME) {
    const w = Math.min(1280, Math.max(960, window.screen.availWidth - 80));
    const h = Math.min(900, Math.max(700, window.screen.availHeight - 80));
    const left = Math.max(20, Math.round((window.screen.availWidth - w) / 2));
    const top = Math.max(20, Math.round((window.screen.availHeight - h) / 2));
    mcmasterWin = window.open(
      url,
      MCMASTER_WINDOW_NAME,
      `popup=yes,noopener=no,noreferrer=no,width=${w},height=${h},left=${left},top=${top}`,
    );
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
    markAwaitingDownload();
    startWatch();
    syncConnectionUi();
    setStatus("ok", "Download CAD on McMaster, then choose the file in this tab.");
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
    markAwaitingDownload();
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
    markAwaitingDownload();
  }

  function isCadFile(file) {
    const name = String(file?.name || "").toLowerCase();
    return CAD_ACCEPT.split(",").some((ext) => name.endsWith(ext.trim()));
  }

  function stageFiles(fileList, meta = {}) {
    const files = [...(fileList || [])].filter((f) => f && isCadFile(f));
    if (!files.length) {
      setStatus("error", "Choose a CAD file (STEP, STL, GLB, 3MF, …).");
      return;
    }
    for (const file of files) {
      const id = `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 7)}`;
      pending = [
        { id, file, meta },
        ...pending.filter((p) => !(p.file.name === file.name && p.file.size === file.size)),
      ];
    }
    clearAwaitingDownload();
    renderPending();
    syncDocTab({ activate: true });
    setViewerVisible(true);
    setStatus(
      "ok",
      files.length === 1
        ? `${files[0].name} ready in McMaster tab — click Insert.`
        : `${files.length} files ready in McMaster tab — click Insert.`,
    );
  }

  function renderPending() {
    if (!pendingList) return;
    if (pendingCount) {
      pendingCount.textContent = pending.length
        ? `${pending.length} file${pending.length === 1 ? "" : "s"} staged`
        : "No files yet";
    }
    if (pendingActions) pendingActions.hidden = !pending.length;
    if (!pending.length) {
      pendingList.innerHTML = `<p class="muted small">Downloaded parts appear here first. Then insert into the current workspace or a new project.</p>`;
      return;
    }
    pendingList.innerHTML = pending
      .map(
        (item) => `
      <div class="mcmaster-pending-row">
        <div class="mcmaster-pending-copy">
          <strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong>
          <small>${Math.max(1, Math.round(item.file.size / 1024))} KB</small>
        </div>
        <div class="mcmaster-pending-row-actions">
          <button type="button" class="btn accent btn-compact" data-pending-insert="${escapeHtml(item.id)}">Insert…</button>
          <button type="button" class="btn secondary btn-compact" data-pending-remove="${escapeHtml(item.id)}">Remove</button>
        </div>
      </div>`,
      )
      .join("");
    pendingList.querySelectorAll("[data-pending-insert]").forEach((btn) => {
      btn.addEventListener("click", () => void insertPending([btn.dataset.pendingInsert]));
    });
    pendingList.querySelectorAll("[data-pending-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        pending = pending.filter((p) => p.id !== btn.dataset.pendingRemove);
        renderPending();
        syncDocTab();
      });
    });
  }

  async function pickDownloadedCad() {
    if (pickerBusy) return;
    pickerBusy = true;
    try {
      if (typeof window.showOpenFilePicker === "function") {
        try {
          const handles = await window.showOpenFilePicker({
            multiple: true,
            types: [
              {
                description: "CAD models",
                accept: {
                  "model/stl": [".stl"],
                  "model/step": [".step", ".stp"],
                  "model/gltf-binary": [".glb"],
                  "application/octet-stream": [".3mf", ".obj", ".gltf", ".iges", ".igs"],
                },
              },
            ],
          });
          const files = [];
          for (const handle of handles) files.push(await handle.getFile());
          stageFiles(files);
          return;
        } catch (err) {
          if (err?.name === "AbortError") return;
        }
      }
      fileInput?.click();
    } finally {
      pickerBusy = false;
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
    renderTabRecent();
  }

  async function insertPending(ids = null, meta = {}) {
    const selected = ids?.length ? pending.filter((p) => ids.includes(p.id)) : [...pending];
    if (!selected.length) {
      setStatus("error", "Stage a downloaded CAD file first.");
      return;
    }
    const files = selected.map((p) => p.file);
    const mergedMeta =
      meta.quick || selected[0]?.meta?.quick ? { quick: meta.quick || selected[0]?.meta?.quick } : meta;
    try {
      const choice = await resolveDestination?.(files);
      if (!choice) {
        setStatus("ok", "Insert cancelled.");
        return;
      }
      setStatus("loading", `Inserting ${files.length === 1 ? files[0].name : `${files.length} files`}…`);
      const results = await onImportFiles?.(files, choice);
      const savedNames =
        Array.isArray(results) && results.length
          ? results.map((r) => r?.filename || r?.name).filter(Boolean)
          : files.map((f) => f.name);
      rememberImport(savedNames, mergedMeta);
      const selectedIds = new Set(selected.map((p) => p.id));
      pending = pending.filter((p) => !selectedIds.has(p.id));
      renderPending();
      syncDocTab();
      try {
        await onLibrarySave?.(savedNames, choice);
      } catch {
        /* optional */
      }
      setStatus(
        "ok",
        savedNames.length === 1
          ? `Inserted ${savedNames[0]} into workspace.`
          : `Inserted ${savedNames.length} files into workspace.`,
      );
    } catch (err) {
      setStatus("error", err?.message || "Could not insert McMaster part.");
    }
  }

  async function importFiles(fileList, meta = {}) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    if (meta.quick) {
      try {
        const choice = await resolveDestination?.(files);
        if (!choice) {
          setStatus("ok", "Insert cancelled.");
          return;
        }
        setStatus("loading", `Inserting ${files[0].name}…`);
        const results = await onImportFiles?.(files, choice);
        const savedNames =
          Array.isArray(results) && results.length
            ? results.map((r) => r?.filename || r?.name).filter(Boolean)
            : files.map((f) => f.name);
        rememberImport(savedNames, meta);
        try {
          await onLibrarySave?.(savedNames, choice);
        } catch {
          /* optional */
        }
        setStatus("ok", `Inserted ${savedNames[0] || files[0].name}.`);
      } catch (err) {
        setStatus("error", err?.message || "Could not insert part.");
      }
      return;
    }
    stageFiles(files, meta);
  }

  function renderQuick() {
    if (!quickList) return;
    quickList.innerHTML = QUICK_PARTS.map(
      (part) => `
      <button type="button" class="mcmaster-quick-card" data-quick-id="${escapeHtml(part.id)}">
        <span class="mcmaster-sim-card-preview" data-shape="${escapeHtml(part.shape)}" aria-hidden="true"></span>
        <span>
          <em>${escapeHtml(part.number)}</em>
          <strong>${escapeHtml(part.title)}</strong>
          <small>${escapeHtml(part.subtitle || "")}</small>
        </span>
      </button>`,
    ).join("");
    quickList.querySelectorAll("[data-quick-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const part = QUICK_PARTS.find((p) => p.id === btn.dataset.quickId);
        if (!part) return;
        await importFiles([stlFileForPart(part)], { quick: part });
      });
    });
  }

  function bindRecentButtons(target) {
    target.querySelectorAll("[data-recent-id]").forEach((btn) => {
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
        closePanel();
        openSession({
          query: entry.number || String(entry.name || "").replace(/\.[^.]+$/, ""),
          autoOpen: true,
        });
      });
    });
  }

  function renderRecentCards(target, emptyText) {
    if (!target) return;
    recentEntries = readRecent();
    if (!recentEntries.length) {
      target.innerHTML = `<p class="muted small">${escapeHtml(emptyText)}</p>`;
      return;
    }
    target.innerHTML = recentEntries
      .map((entry) => {
        const label = entry.number || entry.title || entry.name;
        const sub = entry.subtitle || entry.name || "";
        return `
        <button type="button" class="insert-recent-card" data-recent-id="${escapeHtml(entry.id || entry.name)}" title="${escapeHtml(entry.name || label)}">
          <span class="mcmaster-sim-card-preview" data-shape="${escapeHtml(entry.shape || "file")}" aria-hidden="true"></span>
          <span>
            <strong>${escapeHtml(label)}</strong>
            <small>${escapeHtml(sub)}</small>
          </span>
        </button>`;
      })
      .join("");
    bindRecentButtons(target);
  }

  function renderRecent() {
    recentEntries = readRecent();
    if (clearRecentBtn) clearRecentBtn.hidden = !recentEntries.length;
    if (clearTabRecentBtn) clearTabRecentBtn.hidden = !recentEntries.length;
    renderRecentCards(recentList, "Recent screws, nuts, and imports show up here.");
  }

  function renderTabRecent() {
    recentEntries = readRecent();
    if (clearTabRecentBtn) clearTabRecentBtn.hidden = !recentEntries.length;
    renderRecentCards(tabRecentList, "Inserted screws and CAD show up here.");
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
    renderPending();
    renderTabRecent();
    syncConnectionUi();
  }

  function hideViewerOnly() {
    setViewerVisible(false);
  }

  function minimizeToTab() {
    hideViewerOnly();
    docTabs?.deactivate?.({ notify: true });
    setStatus("ok", "McMaster minimized to a tab — click it to return.");
  }

  function closeSession({ keepWindow = true } = {}) {
    sessionOpen = false;
    hideViewerOnly();
    stopWatch();
    clearAwaitingDownload();
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
  }

  function onReturnFromMcMaster() {
    if (!sessionOpen || !awaitingDownload) return;
    activateSession();
    dropZone?.classList.add("is-attention");
    setStatus("ok", "Choose the downloaded CAD file to stage it in this McMaster tab.");
  }

  const clearAllRecent = () => {
    writeRecent([]);
    recentEntries = [];
    renderRecent();
    renderTabRecent();
  };

  panel.querySelector(".insert-panel-close")?.addEventListener("click", closePanel);
  panel.addEventListener("click", (event) => {
    if (event.target === panel) closePanel();
  });
  panel.querySelector('[data-insert-source="mcmaster"]')?.addEventListener("click", () => {
    openSession({ autoOpen: true });
  });
  clearRecentBtn?.addEventListener("click", clearAllRecent);
  clearTabRecentBtn?.addEventListener("click", clearAllRecent);
  panel.querySelector("[data-insert-import]")?.addEventListener("click", () => panelFileInput?.click());
  panelFileInput?.addEventListener("change", () => {
    const files = [...(panelFileInput.files || [])];
    panelFileInput.value = "";
    stageFiles(files);
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

  host?.querySelector("[data-mcmaster-import]")?.addEventListener("click", () => void pickDownloadedCad());
  host?.querySelector("[data-mcmaster-insert-all]")?.addEventListener("click", () => void insertPending());
  host?.querySelector("[data-mcmaster-clear-pending]")?.addEventListener("click", () => {
    pending = [];
    renderPending();
    syncDocTab();
  });
  fileInput?.addEventListener("change", () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = "";
    stageFiles(files);
  });

  dropZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragover");
  });
  dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("is-dragover"));
  dropZone?.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragover");
    stageFiles([...(event.dataTransfer?.files || [])]);
  });

  window.addEventListener("focus", () => onReturnFromMcMaster());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onReturnFromMcMaster();
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
