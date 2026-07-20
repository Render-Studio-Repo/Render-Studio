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
const LS_RECENT = "render3d:mcmasterRecent:v2";
const RECENT_MAX = 10;
const IDB_NAME = "render3d-mcmaster";
const IDB_STORE = "handles";
const CAD_NAME_RE = /\.(step|stp|stl|obj|glb|gltf|3mf|iges|igs|sat|sldprt|x_t|x_b)$/i;

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
      .map((e) => {
        const name = String(e?.name || e?.filename || e?.title || "").trim();
        if (!name) return null;
        return {
          name,
          at: Number(e?.at) || Date.now(),
          quickId: e?.quickId || null,
        };
      })
      .filter(Boolean)
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function writeRecent(entries) {
  try {
    const cleaned = entries.slice(0, RECENT_MAX).map((e) => ({
      name: String(e.name || "").trim(),
      at: Number(e.at) || Date.now(),
      ...(e.quickId ? { quickId: e.quickId } : {}),
    })).filter((e) => e.name);
    localStorage.setItem(LS_RECENT, JSON.stringify(cleaned));
  } catch {
    /* ignore */
  }
}

function pushRecent(entry) {
  const name = String(entry?.name || "").trim();
  if (!name) return readRecent();
  const next = [
    { name, at: Date.now(), ...(entry.quickId ? { quickId: entry.quickId } : {}) },
    ...readRecent().filter((e) => e.name !== name),
  ].slice(0, RECENT_MAX);
  writeRecent(next);
  return next;
}

function guessMcMasterPartNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  // Direct part-number-ish tokens.
  if (/^[0-9A-Za-z]{5,12}$/.test(raw) && /\d/.test(raw) && /[A-Za-z]/.test(raw)) return raw.toUpperCase();
  // From CAD filename stems like 91251A194_STEP or 91251A194.step
  const stem = raw.replace(/\.[^.]+$/, "").split(/[_\s-]/)[0] || "";
  if (/^[0-9A-Za-z]{5,12}$/.test(stem) && /\d/.test(stem) && /[A-Za-z]/.test(stem)) return stem.toUpperCase();
  // From McMaster URL path
  try {
    const u = new URL(raw);
    if (/mcmaster\.com$/i.test(u.hostname.replace(/^www\./, "")) || /\.mcmaster\.com$/i.test(u.hostname)) {
      const seg = u.pathname.split("/").filter(Boolean)[0] || "";
      if (/^[0-9A-Za-z]{5,12}$/.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg)) return seg.toUpperCase();
    }
  } catch {
    /* ignore */
  }
  return "";
}

function mcmasterProductUrl(partNumberOrUrl) {
  const raw = String(partNumberOrUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const pn = guessMcMasterPartNumber(raw);
  return pn ? `https://www.mcmaster.com/${pn}` : "";
}

function buildMcMasterReferenceMarkdown({
  partNumber = "",
  pageUrl = "",
  cadFilename = "",
  title = "",
} = {}) {
  const pn = partNumber || guessMcMasterPartNumber(cadFilename) || guessMcMasterPartNumber(pageUrl);
  const url = pageUrl || mcmasterProductUrl(pn);
  const label = title || pn || cadFilename || "McMaster-Carr part";
  const lines = [
    `# McMaster-Carr part${pn ? `: ${pn}` : ""}`,
    "",
    `- Supplier: McMaster-Carr`,
    pn ? `- Part number: ${pn}` : null,
    label && label !== pn ? `- Title: ${label}` : null,
    cadFilename ? `- CAD file in project: \`${cadFilename}\`` : null,
    url ? `- Product page: ${url}` : null,
    `- Inserted: ${new Date().toISOString()}`,
    "",
    "## Notes for AI",
    "This reference is tied to the imported STEP/STL CAD above.",
    "Use the product page for authoritative dimensions, material, finish, and variants.",
    "When the user asks about this fastener/part, prefer this McMaster listing over guessing.",
    url ? "" : null,
    url ? `Open listing: ${url}` : null,
    "",
  ].filter((line) => line !== null);
  return `${lines.join("\n").trim()}\n`;
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function createMcMasterInsert({
  onImportFiles,
  onStatus,
  resolveDestination,
  onLibrarySave = null,
  onSavePartReference = null,
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
  let downloadWatchStartedAt = 0;
  let returnPickerArmed = false;
  let lastProductUrl = "";
  let lastPartNumber = "";

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
          <span class="muted small">Last 10</span>
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
              <strong>McMaster saves CAD to your local Downloads folder</strong>
              <span>Link that folder (or pick a file), then insert into the current workspace.</span>
            </div>
            <div class="mcmaster-local-block">
              <div class="mcmaster-quick-head">
                <strong>Local Downloads</strong>
                <span class="muted small" data-mcmaster-local-status>Not linked</span>
              </div>
              <div class="mcmaster-drop-actions">
                <button type="button" class="btn accent" data-mcmaster-import>Pick downloaded file…</button>
                <button type="button" class="btn secondary btn-compact" data-mcmaster-link-downloads>Link Downloads folder…</button>
                <button type="button" class="btn secondary btn-compact" data-mcmaster-refresh-local>Refresh</button>
              </div>
              <div class="mcmaster-local-list" data-mcmaster-local-list>
                <p class="muted small">McMaster cannot send files into Render3D. After download, click <strong>Pick downloaded file…</strong> (or link Downloads once for auto-detect).</p>
              </div>
            </div>
            <div class="mcmaster-live-drop" data-mcmaster-drop tabindex="0">
              <strong>Or drop CAD here</strong>
              <span>STEP · STL · GLB · 3MF from Downloads</span>
              <input type="file" class="mcmaster-insert-file" accept="${CAD_ACCEPT}" hidden multiple />
            </div>
            <div class="mcmaster-pending-block">
              <div class="mcmaster-quick-head">
                <strong>Ready to insert</strong>
                <span class="muted small" data-mcmaster-pending-count>No files yet</span>
              </div>
              <label class="mcmaster-ref-link-field">
                <span class="muted small">Product link for AI reference</span>
                <input type="url" class="mcmaster-ref-link-input" data-mcmaster-ref-link placeholder="https://www.mcmaster.com/91251A194 (auto-filled from search)" />
              </label>
              <div class="mcmaster-pending-list" data-mcmaster-pending>
                <p class="muted small">After you download from McMaster, click <strong>Pick downloaded file…</strong> (or link Downloads) — the file will show up here.</p>
              </div>
              <div class="mcmaster-pending-actions" data-mcmaster-pending-actions hidden>
                <button type="button" class="btn accent" data-mcmaster-insert-current>Insert to current workspace</button>
                <button type="button" class="btn secondary btn-compact" data-mcmaster-insert-all>Ask destination…</button>
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
                <strong>Recent</strong>
                <span class="muted small">Last 10</span>
                <button type="button" class="btn secondary btn-compact" data-mcmaster-clear-recent>Clear</button>
              </div>
              <div class="mcmaster-recent-side-list" data-mcmaster-tab-recent>
                <p class="muted small">No recent inserts yet.</p>
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
  const localList = host?.querySelector("[data-mcmaster-local-list]");
  const localStatus = host?.querySelector("[data-mcmaster-local-status]");
  const refLinkInput = host?.querySelector("[data-mcmaster-ref-link]");

  /** @type {FileSystemDirectoryHandle | null} */
  let downloadsDir = null;
  /** @type {{ name: string, file: File, at: number }[]} */
  let localFiles = [];
  let localPollTimer = null;

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
    returnPickerArmed = true;
    downloadWatchStartedAt = Date.now();
    syncConnectionUi();
    dropZone?.classList.add("is-attention");
    localList?.closest(".mcmaster-local-block")?.classList.add("is-attention");
  }

  function clearAwaitingDownload() {
    awaitingDownload = false;
    returnPickerArmed = false;
    syncConnectionUi();
    dropZone?.classList.remove("is-attention");
    localList?.closest(".mcmaster-local-block")?.classList.remove("is-attention");
  }

  function syncRefLinkInput(url = lastProductUrl) {
    if (refLinkInput && url && !String(refLinkInput.value || "").trim()) {
      refLinkInput.value = url;
    } else if (refLinkInput && url) {
      refLinkInput.value = url;
    }
  }

  function rememberProductContext(urlOrQuery = "") {
    const raw = String(urlOrQuery || "").trim();
    const pn = guessMcMasterPartNumber(raw) || guessMcMasterPartNumber(searchInput?.value || "");
    const url = mcmasterProductUrl(raw.startsWith("http") ? raw : pn);
    if (pn) lastPartNumber = pn;
    if (url) lastProductUrl = url;
    syncRefLinkInput(url || lastProductUrl);
    return { partNumber: lastPartNumber, pageUrl: lastProductUrl };
  }

  function currentProductContext(cadFilename = "") {
    const typed = String(refLinkInput?.value || "").trim();
    const fromTyped = typed ? rememberProductContext(typed) : null;
    const pn =
      fromTyped?.partNumber ||
      lastPartNumber ||
      guessMcMasterPartNumber(cadFilename) ||
      guessMcMasterPartNumber(searchInput?.value || "");
    const pageUrl = fromTyped?.pageUrl || lastProductUrl || mcmasterProductUrl(pn);
    return { partNumber: pn, pageUrl };
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
    rememberProductContext(url);
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
    rememberProductContext(url);
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
    if (pendingActions) {
      pendingActions.hidden = !pending.length;
      pendingActions.classList.toggle("is-empty", !pending.length);
    }
    if (!pending.length) {
      pendingList.innerHTML = `<p class="muted small">After you download from McMaster, click <strong>Pick file…</strong> (or link Downloads) — the file will show up here.</p>`;
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
      const clean = String(name || "").trim();
      if (!clean) continue;
      const quick = meta.quick || QUICK_PARTS.find((p) => clean.startsWith(p.number));
      recentEntries = pushRecent({
        name: clean,
        quickId: quick?.id || null,
      });
    }
    renderRecent();
    renderTabRecent();
  }

  async function savePartReferences(savedNames, meta = {}, choice = null) {
    if (!onSavePartReference || !savedNames?.length) return;
    for (const cadFilename of savedNames) {
      const quick = meta.quick || QUICK_PARTS.find((p) => String(cadFilename).startsWith(p.number));
      const ctx = currentProductContext(cadFilename);
      const partNumber = quick?.number || ctx.partNumber || guessMcMasterPartNumber(cadFilename);
      const pageUrl = ctx.pageUrl || mcmasterProductUrl(partNumber);
      const markdown = buildMcMasterReferenceMarkdown({
        partNumber,
        pageUrl,
        cadFilename,
        title: quick?.title || "",
      });
      const stem = String(partNumber || PathStem(cadFilename) || "part")
        .replace(/[^\w.-]+/g, "_")
        .slice(0, 60);
      const refFile = new File([markdown], `mcmaster_${stem}.md`, { type: "text/markdown" });
      try {
        await onSavePartReference(
          {
            file: refFile,
            cadFilename,
            partNumber,
            pageUrl,
            markdown,
          },
          choice,
        );
      } catch {
        /* optional */
      }
    }
  }

  function PathStem(name) {
    return String(name || "").replace(/\.[^.]+$/, "");
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
      // Infer product context from staged CAD names before insert.
      for (const file of files) rememberProductContext(file.name);
      const choice = meta.forceCurrent
        ? (await resolveDestination?.(files, { forceCurrent: true }))
        : await resolveDestination?.(files);
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
        const pageUrls = {};
        for (const name of savedNames) {
          const ctx = currentProductContext(name);
          if (ctx.pageUrl) pageUrls[name] = ctx.pageUrl;
        }
        await onLibrarySave?.(savedNames, choice, { pageUrls });
      } catch {
        /* optional */
      }
      await savePartReferences(savedNames, mergedMeta, choice);
      setStatus(
        "ok",
        savedNames.length === 1
          ? `Inserted ${savedNames[0]} + AI reference link.`
          : `Inserted ${savedNames.length} files + AI reference links.`,
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
          await onLibrarySave?.(savedNames, choice, {
            pageUrls: {
              [savedNames[0]]: mcmasterProductUrl(meta.quick?.number),
            },
          });
        } catch {
          /* optional */
        }
        if (meta.quick?.number) {
          lastPartNumber = meta.quick.number;
          lastProductUrl = mcmasterProductUrl(meta.quick.number);
          syncRefLinkInput(lastProductUrl);
        }
        await savePartReferences(savedNames, meta, choice);
        setStatus("ok", `Inserted ${savedNames[0] || files[0].name} + AI reference.`);
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
    target.querySelectorAll("[data-recent-name]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const entry = recentEntries.find((e) => e.name === btn.dataset.recentName);
        if (!entry) return;
        if (entry.quickId) {
          const part = QUICK_PARTS.find((p) => p.id === entry.quickId);
          if (part) {
            await importFiles([stlFileForPart(part)], { quick: part });
            return;
          }
        }
        // Prefer pulling the same filename from linked Downloads, else reopen McMaster search.
        const local = localFiles.find((f) => f.name === entry.name);
        if (local) {
          stageFiles([local.file]);
          return;
        }
        closePanel();
        openSession({
          query: String(entry.name || "").replace(/\.[^.]+$/, ""),
          autoOpen: true,
        });
      });
    });
  }

  function renderRecentCards(target, emptyText) {
    if (!target) return;
    recentEntries = readRecent().slice(0, RECENT_MAX);
    if (!recentEntries.length) {
      target.innerHTML = `<p class="muted small">${escapeHtml(emptyText)}</p>`;
      return;
    }
    target.innerHTML = recentEntries
      .map((entry) => `
        <button type="button" class="insert-recent-card insert-recent-card--simple" data-recent-name="${escapeHtml(entry.name)}" title="${escapeHtml(entry.name)}">
          <span>
            <strong>${escapeHtml(entry.name)}</strong>
            <small>${escapeHtml(formatRecentWhen(entry.at))}</small>
          </span>
        </button>`)
      .join("");
    bindRecentButtons(target);
  }

  function renderRecent() {
    recentEntries = readRecent().slice(0, RECENT_MAX);
    if (clearRecentBtn) clearRecentBtn.hidden = !recentEntries.length;
    if (clearTabRecentBtn) clearTabRecentBtn.hidden = !recentEntries.length;
    renderRecentCards(recentList, "No recent inserts yet.");
  }

  function renderTabRecent() {
    recentEntries = readRecent().slice(0, RECENT_MAX);
    if (clearTabRecentBtn) clearTabRecentBtn.hidden = !recentEntries.length;
    renderRecentCards(tabRecentList, "No recent inserts yet.");
  }

  function renderLocalDownloads() {
    if (!localList) return;
    if (localStatus) {
      localStatus.textContent = downloadsDir
        ? (localFiles.length ? `${Math.min(localFiles.length, 10)} recent CAD` : "Linked · no CAD yet")
        : "Not linked";
    }
    if (!downloadsDir) {
      localList.innerHTML = `<p class="muted small">Link your Downloads folder once — newest CAD files appear here for insert.</p>`;
      return;
    }
    if (!localFiles.length) {
      localList.innerHTML = `<p class="muted small">No CAD files found in the linked folder yet. Download from McMaster, then Refresh.</p>`;
      return;
    }
    localList.innerHTML = localFiles.slice(0, 10).map((item) => `
      <div class="mcmaster-local-row">
        <div class="mcmaster-pending-copy">
          <strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
          <small>${formatRecentWhen(item.at)} · ${Math.max(1, Math.round(item.file.size / 1024))} KB</small>
        </div>
        <div class="mcmaster-pending-row-actions">
          <button type="button" class="btn accent btn-compact" data-local-stage="${escapeHtml(item.name)}">Stage</button>
          <button type="button" class="btn secondary btn-compact" data-local-insert="${escapeHtml(item.name)}">Insert now</button>
        </div>
      </div>
    `).join("");
    localList.querySelectorAll("[data-local-stage]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = localFiles.find((f) => f.name === btn.dataset.localStage);
        if (item) stageFiles([item.file]);
      });
    });
    localList.querySelectorAll("[data-local-insert]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const item = localFiles.find((f) => f.name === btn.dataset.localInsert);
        if (!item) return;
        stageFiles([item.file]);
        await insertPending(null, { forceCurrent: true });
      });
    });
  }

  async function refreshLocalDownloads({ autoStageNew = false } = {}) {
    if (!downloadsDir) {
      renderLocalDownloads();
      return [];
    }
    try {
      const perm = await downloadsDir.queryPermission?.({ mode: "read" });
      if (perm === "prompt") await downloadsDir.requestPermission?.({ mode: "read" });
      const found = [];
      for await (const [name, handle] of downloadsDir.entries()) {
        if (handle.kind !== "file") continue;
        if (!CAD_NAME_RE.test(name)) continue;
        try {
          const file = await handle.getFile();
          found.push({ name, file, at: file.lastModified || Date.now() });
        } catch {
          /* skip unreadable */
        }
      }
      found.sort((a, b) => b.at - a.at);
      localFiles = found.slice(0, 10);
      renderLocalDownloads();

      if (autoStageNew && downloadWatchStartedAt) {
        const fresh = found.filter((f) => f.at >= downloadWatchStartedAt - 5000);
        if (fresh.length) {
          stageFiles(fresh.slice(0, 5).map((f) => f.file));
          setStatus("ok", `Found ${fresh[0].name} in Downloads — ready to insert.`);
          return fresh;
        }
      }
      return found;
    } catch (err) {
      setStatus("error", err?.message || "Could not read Downloads folder.");
      return [];
    }
  }

  async function linkDownloadsFolder() {
    if (typeof window.showDirectoryPicker !== "function") {
      setStatus("error", "This browser cannot link a folder — use Pick file… instead (Chrome/Edge recommended).");
      fileInput?.click();
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "read", id: "mcmaster-downloads" });
      downloadsDir = handle;
      try { await idbSet("downloadsDir", handle); } catch { /* optional */ }
      setStatus("ok", "Downloads folder linked — newest CAD files will show here.");
      await refreshLocalDownloads();
      startLocalPoll();
    } catch (err) {
      if (err?.name === "AbortError") return;
      setStatus("error", err?.message || "Could not link Downloads folder.");
    }
  }

  async function restoreDownloadsFolder() {
    try {
      const handle = await idbGet("downloadsDir");
      if (!handle) return;
      const perm = await handle.queryPermission?.({ mode: "read" });
      if (perm === "granted" || (perm === "prompt" && (await handle.requestPermission?.({ mode: "read" })) === "granted")) {
        downloadsDir = handle;
        await refreshLocalDownloads();
        startLocalPoll();
      }
    } catch {
      /* ignore */
    }
  }

  function startLocalPoll() {
    if (localPollTimer) window.clearInterval(localPollTimer);
    localPollTimer = window.setInterval(() => {
      if (sessionOpen && downloadsDir && !host?.classList.contains("hidden")) {
        void refreshLocalDownloads();
      }
    }, 4000);
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
    void restoreDownloadsFolder();
    renderLocalDownloads();
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

  async function onReturnFromMcMaster() {
    if (!sessionOpen || !awaitingDownload || !returnPickerArmed) return;
    returnPickerArmed = false; // only once per McMaster browse session
    activateSession();
    dropZone?.classList.add("is-attention");
    localList?.closest(".mcmaster-local-block")?.classList.add("is-attention");

    // If Downloads is linked, pull any new CAD automatically.
    if (downloadsDir) {
      const fresh = await refreshLocalDownloads({ autoStageNew: true });
      if (fresh?.length) return;
    }

    setStatus("ok", "Pick the file you just downloaded — McMaster saved it to your Downloads folder.");
    // Auto-open the file picker so the download shows up without hunting for a button.
    window.setTimeout(() => {
      void pickDownloadedCad();
    }, 250);
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
      rememberProductContext(searchInput.value);
      navigateLive(searchUrlFromInput());
    }
  });
  searchInput?.addEventListener("change", () => rememberProductContext(searchInput.value));
  refLinkInput?.addEventListener("change", () => rememberProductContext(refLinkInput.value));
  refLinkInput?.addEventListener("blur", () => rememberProductContext(refLinkInput.value));

  host?.querySelector("[data-mcmaster-link-downloads]")?.addEventListener("click", () => void linkDownloadsFolder());
  host?.querySelector("[data-mcmaster-refresh-local]")?.addEventListener("click", () => void refreshLocalDownloads());
  host?.querySelector("[data-mcmaster-import]")?.addEventListener("click", () => void pickDownloadedCad());
  host?.querySelector("[data-mcmaster-insert-current]")?.addEventListener("click", () => void insertPending(null, { forceCurrent: true }));
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
