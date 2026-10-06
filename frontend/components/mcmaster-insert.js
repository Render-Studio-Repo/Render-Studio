/**
 * Fusion-style McMaster-Carr insert from Parts Catalog.
 *
 * Catalog STEP is fetched by a headless crawler onto the studio server
 * (not the user's Downloads folder). Generate looks those files up.
 * Browse catalog remains available to find a part number.
 * mcmui2 dest + quick parts · mcmtype1 typeahead fetch
 * thumbs: https://images.mcmaster.com/{PN}.png
 */

import {
  suggestMcMasterParts,
  QUICK_FAMILIES,
  familySelection,
  MCMASTER_THUMB,
  catalogRowByNumber,
} from "./mcmaster-suggest.js?v=mcmtype1";
import {
  catalogWindowState,
  isCatalogWindowOpen,
  openCatalogWindow,
} from "./mcmaster-window.js?v=20260930-mcmaster-popup1";

const MCMASTER_HOME = "https://www.mcmaster.com/";
const MCMASTER_TAB_ID = "mcmaster";
const CAD_ACCEPT = ".step,.stp,.stl,.obj,.glb,.gltf,.3mf,.iges,.igs,.sat,.sldprt,.x_t,.x_b";
const LOGO_SRC = "/assets/brands/mcmaster-carr-masthead.svg";
const LS_RECENT = "render3d:mcmasterRecent:v2";
const RECENT_MAX = 10;
const IDB_NAME = "render3d-mcmaster";
const IDB_STORE = "handles";
const CAD_NAME_RE = /\.(step|stp|stl|obj|glb|gltf|3mf|iges|igs|sat|sldprt|x_t|x_b)$/i;
const MCMASTER_BUCKET = "Render Studio-McMaster";
const LS_DOWNLOAD_FOLDER_NAME = "render3d:mcmasterDownloadFolderName:v1";
const LS_AUTO_UPLOAD = "render3d:mcmasterAutoUpload:v1";
const LS_INSERT_DEST = "render3d:mcmasterInsertDest:v1";
const DEST_LABELS = {
  current: "Destination: Current workspace",
  new: "Destination: New project",
  ask: "Destination: Ask each time",
};

function readDownloadFolderName() {
  try {
    return String(localStorage.getItem(LS_DOWNLOAD_FOLDER_NAME) || "").trim();
  } catch {
    return "";
  }
}

function writeDownloadFolderName(name) {
  try {
    if (name) localStorage.setItem(LS_DOWNLOAD_FOLDER_NAME, String(name));
    else localStorage.removeItem(LS_DOWNLOAD_FOLDER_NAME);
  } catch {
    /* ignore */
  }
}

function readAutoUploadPref() {
  try {
    const raw = localStorage.getItem(LS_AUTO_UPLOAD);
    if (raw === null) return true; // default ON
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

function writeAutoUploadPref(on) {
  try {
    localStorage.setItem(LS_AUTO_UPLOAD, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

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
  { id: "91251A102", number: "91251A102", title: "Socket Head Screw", subtitle: "M3 × 12 mm", shape: "bolt", dims: { radius: 1.5, height: 12, headRadius: 2.7, headHeight: 3 } },
  { id: "91251A268", number: "91251A268", title: "Socket Head Screw", subtitle: "M6 × 20 mm", shape: "bolt", dims: { radius: 3.0, height: 20, headRadius: 5.0, headHeight: 6 } },
  { id: "90592A015", number: "90592A015", title: "Hex Nut", subtitle: "M5 × 0.8 mm", shape: "nut", dims: { radius: 4.5, height: 4 } },
  { id: "90592A085", number: "90592A085", title: "Hex Nut", subtitle: "M3", shape: "nut", dims: { radius: 3.1, height: 2.4 } },
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
  if (/^https?:\/\//i.test(raw)) {
    // Ignore bare homepage — not a useful product reference.
    if (/^https?:\/\/(www\.)?mcmaster\.com\/?$/i.test(raw)) return "";
    return raw;
  }
  const pn = guessMcMasterPartNumber(raw);
  return pn ? `https://www.mcmaster.com/${pn}` : "";
}

function buildMcMasterReferenceMarkdown({
  partNumber = "",
  pageUrl = "",
  cadFilename = "",
  title = "",
  subtitle = "",
  dims = null,
} = {}) {
  const pn = partNumber || guessMcMasterPartNumber(cadFilename) || guessMcMasterPartNumber(pageUrl);
  const url = pageUrl || mcmasterProductUrl(pn);
  const label = title || pn || cadFilename || "McMaster-Carr part";
  const pointer = pn ? `@mcmaster-${pn}` : "@mcmaster-part";
  const lines = [
    `# McMaster-Carr part${pn ? `: ${pn}` : ""}`,
    "",
    "## Pointer",
    `- Prompt chip: \`${pointer}\``,
    `- Spec file: \`parts_list.md\``,
    cadFilename ? `- Linked CAD geometry: \`${cadFilename}\`` : null,
    "",
    "## Identity",
    `- Supplier: McMaster-Carr`,
    pn ? `- Part number: ${pn}` : null,
    label && label !== pn ? `- Title: ${label}` : null,
    subtitle ? `- Size / variant: ${subtitle}` : null,
    url ? `- Product page (authoritative): ${url}` : null,
    `- Inserted: ${new Date().toISOString()}`,
    "",
    "## How the AI should use this",
    "When this pointer is attached (alone or with the CAD component), treat it as the supplier datasheet for the part.",
    "Prefer this file + the McMaster product page over guessing:",
    "- Strength / hardness / grade / class",
    "- Material, finish, coating, and temperature limits",
    "- Thread size, pitch, length, head style, drive",
    "- Torque / clamping guidance when listed",
    "- Clearance-hole and tap-drill recommendations",
    "- Compatible nuts, washers, and variants on the same listing",
    "The CAD file is geometry only — mechanical properties come from this McMaster listing.",
    "",
    "## Design rules",
    "- Size pockets, countersinks, and through-holes from the listing dimensions, not invented sizes.",
    "- If strength or material is required and not copied into this file yet, open the product page above rather than inventing values.",
    "- When the user drops this screw/part into a prompt, keep using this pointer for engineering questions about the same part.",
    "",
  ];
  if (dims && typeof dims === "object") {
    lines.push("## Known insert dimensions (mm, approximate)");
    for (const [k, v] of Object.entries(dims)) {
      if (v == null || v === "") continue;
      lines.push(`- ${k}: ${v}`);
    }
    lines.push("");
  }
  if (url) {
    lines.push("## Listing");
    lines.push(url);
    lines.push("");
  }
  return `${lines.filter((line) => line !== null).join("\n").trim()}\n`;
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
  onInsertCatalogPart = null,
  onFetchServerPart = null,
  onStatus,
  resolveDestination,
  onLibrarySave = null,
  onSavePartReference = null,
  onSuggestParts = null,
  getInsertDest = null,
  setInsertDest = null,
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
  let expectingReturnPick = false;
  let lastProductUrl = "";
  let lastPartNumber = "";

  const host = viewerEl || document.getElementById("mcmaster-viewer");

  const panel = document.createElement("div");
  panel.className = "insert-panel-overlay hidden";
  panel.innerHTML = `
    <div class="insert-panel insert-panel--clean hidden" role="dialog" aria-label="McMaster-Carr">
      <div class="insert-panel-head">
        <div>
          <strong>McMaster-Carr</strong>
          <span class="muted small">McMaster-Carr parts into this workspace</span>
        </div>
        <button type="button" class="insert-panel-close" aria-label="Close McMaster-Carr">×</button>
      </div>
      <button type="button" class="insert-source-card" data-insert-source="mcmaster">
        <span class="insert-source-icon insert-source-icon--logo" aria-hidden="true">
          <img src="${LOGO_SRC}" alt="" width="120" height="18" />
        </span>
        <span class="insert-source-copy">
          <strong>McMaster-Carr</strong>
          <small>Server crawler fetches STEP · Generate lists what to buy</small>
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
            <div class="mcmaster-typeahead">
              <input type="search" class="mcmaster-insert-search" placeholder="4 mm screw or PN…" aria-label="McMaster-Carr part search" autocomplete="off" />
              <div class="mcmaster-suggest-list" data-mcmaster-suggest hidden role="listbox"></div>
            </div>
            <button type="button" class="btn accent btn-compact" data-mcmaster-fetch>Fetch STEP on server</button>
            <button type="button" class="btn secondary btn-compact" data-mcmaster-dest>Destination: Ask each time</button>
            <button type="button" class="btn secondary btn-compact" data-mcmaster-open>Open McMaster</button>
            <button type="button" class="btn secondary btn-compact" data-mcmaster-focus>Focus site</button>
            <button type="button" class="btn secondary btn-compact" data-mcmaster-min>Minimize</button>
            <button type="button" class="btn secondary btn-compact" data-mcmaster-close-tab>Close</button>
          </div>
        </header>
        <div class="mcmaster-tab-body">
          <section class="mcmaster-tab-main">
            <div class="mcmaster-live-pane" data-mcmaster-window-state="idle">
              <div class="mcmaster-live-stage-card">
                <div class="mcmaster-live-stage-visual" aria-hidden="true"></div>
                <h3 data-mcmaster-window-title>Search McMaster-Carr</h3>
                <p data-mcmaster-window-copy>Use the search above or a quick part. McMaster opens in its own browser window because the vendor blocks embedded pages.</p>
                <div class="mcmaster-live-stage-actions">
                  <button type="button" class="btn accent" data-mcmaster-open>Open McMaster</button>
                  <button type="button" class="btn secondary btn-compact" data-mcmaster-focus hidden>Focus McMaster window</button>
                </div>
              </div>
            </div>
            <div class="mcmaster-stage-banner">
              <strong>Server crawler downloads STEP</strong>
              <span>Type a size or part number — pick a McMaster PN to fetch STEP onto the studio server. Generate looks those files up. Files never go through your Downloads folder.</span>
            </div>
            <div class="mcmaster-local-block">
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
                <p class="muted small">Fetched STEP files land on the server. Use the destination button if you want a new project instead of the current workspace.</p>
              </div>
              <div class="mcmaster-pending-actions" data-mcmaster-pending-actions hidden>
                <button type="button" class="btn accent" data-mcmaster-insert-current>Insert</button>
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
                <span class="muted small">Insert into this project</span>
              </div>
              <div class="mcmaster-quick-list" data-mcmaster-quick></div>
            </div>
          </aside>
        </div>
      </div>
    `;
  }

  const searchInput = host?.querySelector(".mcmaster-insert-search");
  const suggestBox = host?.querySelector("[data-mcmaster-suggest]");
  const destButton = host?.querySelector("[data-mcmaster-dest]");
  const livePane = host?.querySelector("[data-mcmaster-window-state]");
  const liveTitle = host?.querySelector("[data-mcmaster-window-title]");
  const liveCopy = host?.querySelector("[data-mcmaster-window-copy]");
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
  const gotBanner = host?.querySelector("[data-mcmaster-got-banner]");
  const chromeHint = host?.querySelector("[data-mcmaster-chrome-hint]");
  const folderNameEl = host?.querySelector("[data-mcmaster-folder-name]");
  const autoUploadInput = host?.querySelector("[data-mcmaster-auto-upload]");
  const gotCopy = host?.querySelector("[data-mcmaster-got-copy]");

  /** @type {FileSystemDirectoryHandle | null} */
  let parentDir = null;
  /** @type {FileSystemDirectoryHandle | null} */
  let downloadsDir = null; // the Render Studio-McMaster bucket
  let downloadFolderName = readDownloadFolderName();
  let autoUploadEnabled = readAutoUploadPref();
  /** @type {{ name: string, file: File, at: number }[]} */
  let localFiles = [];
  let localPollTimer = null;
  /** @type {Set<string>} */
  let seenLocalKeys = new Set();
  /** @type {Set<string>} names present when download watch started */
  let sessionBaselineNames = new Set();
  let autoUploading = false;
  let fsObserver = null;
  let popupBlocked = false;

  if (autoUploadInput) autoUploadInput.checked = autoUploadEnabled;

  function setGotBannerVisible(visible) {
    gotBanner?.classList.toggle("is-urgent", !!visible);
  }

  function syncDownloadFolderUi() {
    const name = downloadFolderName || (downloadsDir ? `${parentDir?.name || "…"}/${MCMASTER_BUCKET}` : "");
    if (localStatus) {
      if (downloadsDir) {
        localStatus.textContent = `Watching: ${name}`;
      } else if (pending.length) {
        localStatus.textContent = `${pending.length} staged`;
      } else {
        localStatus.textContent = "Waiting for a push";
      }
      localStatus.classList.toggle("is-linked", !!downloadsDir || pending.length > 0);
    }
    if (folderNameEl) folderNameEl.textContent = name || `…/${MCMASTER_BUCKET}`;
    if (chromeHint) chromeHint.hidden = !downloadsDir;
    const changeBtn = host?.querySelector("[data-mcmaster-change-downloads]");
    const scanBtn = host?.querySelector("[data-mcmaster-refresh-local]");
    const linkBtn = host?.querySelector("[data-mcmaster-link-downloads]");
    if (changeBtn) changeBtn.hidden = !downloadsDir;
    if (scanBtn) scanBtn.hidden = !downloadsDir;
    if (linkBtn) {
      linkBtn.textContent = downloadsDir ? "Change watch folder…" : "Optional: watch a normal folder…";
    }
    syncAutoUploadCopy();
  }

  function syncAutoUploadCopy() {
    if (gotCopy) {
      gotCopy.textContent = autoUploadEnabled
        ? "Opens Downloads — multi-select every new STEP (Cmd/Ctrl+click), push into this tab + workspace, and save AI spec pointers."
        : "Opens Downloads — multi-select STEPs to stage here (auto-upload off — insert manually). AI specs still save on insert.";
    }
  }

  async function maybeUploadStaged() {
    if (!autoUploadEnabled || !pending.length || autoUploading) return false;
    autoUploading = true;
    try {
      setStatus("loading", "Uploading into current workspace…");
      await insertPending(null, { forceCurrent: true });
      return true;
    } finally {
      autoUploading = false;
    }
  }

  function localFileKey(item) {
    return `${item.name}:${item.file?.size || 0}:${item.at || 0}`;
  }

  function setStatus(kind, text) {
    onStatus?.(kind, text);
  }

  function isWinOpen() {
    return isCatalogWindowOpen(mcmasterWin);
  }

  function syncConnectionUi() {
    const open = isWinOpen();
    const state = catalogWindowState(mcmasterWin, popupBlocked);
    if (connBadge) {
      connBadge.textContent = open ? "Live" : state === "blocked" ? "Popup blocked" : "Disconnected";
      connBadge.classList.toggle("is-live", open);
    }
    if (livePane) livePane.dataset.mcmasterWindowState = state;
    if (liveTitle) {
      liveTitle.textContent = state === "open"
        ? "McMaster is open"
        : state === "blocked"
          ? "Allow popups to browse McMaster"
          : "Search McMaster-Carr";
    }
    if (liveCopy) {
      liveCopy.textContent = state === "open"
        ? "Browse or download 3-D STEP in the McMaster window. This tab keeps server fetch, recent parts, and insertion controls available."
        : state === "blocked"
          ? "Your browser blocked the McMaster window. Allow popups for Render Studio, then try Open McMaster again."
          : "Use the search above or a quick part. McMaster opens in its own browser window because the vendor blocks embedded pages.";
    }
    host?.querySelectorAll("[data-mcmaster-focus]").forEach((button) => { button.hidden = !open; });
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
        popupBlocked = false;
        syncConnectionUi();
        stopWatch();
        // Popup closed after browsing/download — prompt to pick the STEP.
        if (awaitingDownload || returnPickerArmed) {
          void handleReturnedFromDownload({ reason: "popup-closed" });
        }
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
    // Baseline = files already in the bucket — only names appearing after this count.
    sessionBaselineNames = new Set(localFiles.map((f) => f.name));
    void (async () => {
      const found = await listLocalCadFiles();
      sessionBaselineNames = new Set(found.map((f) => f.name));
      for (const item of found) seenLocalKeys.add(localFileKey(item));
    })();
    syncConnectionUi();
    setGotBannerVisible(true);
    dropZone?.classList.add("is-attention");
    localList?.closest(".mcmaster-local-block")?.classList.add("is-attention");
    startLocalPoll({ fast: true });
    setStatus(
      "ok",
      autoUploadEnabled && downloadsDir
        ? `Download STEP into ${downloadFolderName || MCMASTER_BUCKET} — new files auto-upload. Or click this tab to pick from Downloads.`
        : "Download 3-D STEP in the McMaster window, then click this tab — the Downloads picker opens and inserts the part.",
    );
  }

  function clearAwaitingDownload({ disarm = false } = {}) {
    // Keep the session armed while the McMaster popup is still open so a 2nd/3rd
    // STEP download is not marked "seen" and skipped by Scan / folder watch.
    if (!disarm && isWinOpen()) {
      awaitingDownload = true;
      returnPickerArmed = true;
      downloadWatchStartedAt = Date.now();
      setGotBannerVisible(true);
      dropZone?.classList.add("is-attention");
      localList?.closest(".mcmaster-local-block")?.classList.add("is-attention");
      startLocalPoll({ fast: true });
      syncConnectionUi();
      return;
    }
    awaitingDownload = false;
    returnPickerArmed = false;
    expectingReturnPick = false;
    syncConnectionUi();
    setGotBannerVisible(false);
    dropZone?.classList.remove("is-attention");
    localList?.closest(".mcmaster-local-block")?.classList.remove("is-attention");
  }

  function syncRefLinkInput(url = lastProductUrl) {
    const clean = mcmasterProductUrl(url);
    if (!refLinkInput || !clean) return;
    refLinkInput.value = clean;
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

  function dockCatalogTab(direction = "right") {
    syncDocTab({ activate: true });
    setViewerVisible(true);
    if (!docTabs?.split) return;
    const existing = docTabs.getSplit?.();
    if (existing?.cross) return;
    const dir = String(direction || "right").toLowerCase();
    if (existing?.direction && existing.docId && existing.docId !== MCMASTER_TAB_ID) {
      docTabs.split(existing.direction, MCMASTER_TAB_ID, { ratio: existing.ratio });
      return;
    }
    if (!existing?.direction) docTabs.split(dir, MCMASTER_TAB_ID);
  }

  function openLiveWindow(url = MCMASTER_HOME) {
    const href = String(url || MCMASTER_HOME);
    dockCatalogTab("right");
    const w = Math.min(1080, Math.max(820, window.screen.availWidth - 220));
    const h = Math.min(760, Math.max(600, window.screen.availHeight - 180));
    const left = Math.max(20, Math.round((window.screen.availWidth - w) / 2));
    const top = Math.max(20, Math.round((window.screen.availHeight - h) / 2));
    const result = openCatalogWindow(
      window,
      href,
      `popup=yes,noopener=no,noreferrer=no,width=${w},height=${h},left=${left},top=${top}`,
    );
    mcmasterWin = result.window;
    popupBlocked = result.kind === "blocked";
    if (!mcmasterWin) {
      syncConnectionUi();
      setStatus("error", "Popup blocked. Allow popups for Render Studio to open McMaster.");
      return null;
    }
    markAwaitingDownload();
    startWatch();
    syncConnectionUi();
    rememberProductContext(href);
    setStatus("ok", "McMaster opened in your browser. Download there or fetch STEP on the server from this tab.");
    return mcmasterWin;
  }

  function focusLiveWindow() {
    if (!isWinOpen()) {
      openLiveWindow(searchUrlFromInput());
      return;
    }
    try { mcmasterWin.focus(); } catch { openLiveWindow(searchUrlFromInput()); }
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
      return [];
    }
    for (const file of files) {
      const id = `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 7)}`;
      pending = [
        { id, file, meta },
        ...pending.filter((p) => !(p.file.name === file.name && p.file.size === file.size)),
      ];
    }
    clearAwaitingDownload();
    setGotBannerVisible(false);
    renderPending();
    renderLocalDownloads();
    syncDocTab({ activate: true });
    setViewerVisible(true);
    // Optional: mirror into a watched non-Downloads folder.
    void (async () => {
      for (const file of files) await copyFileIntoDownloadFolder(file);
      if (downloadsDir) void refreshLocalDownloads();
    })();
    setStatus(
      "ok",
      files.length === 1
        ? `${files[0].name} staged${autoUploadEnabled ? " — uploading…" : " — click Insert."}`
        : `${files.length} files staged${autoUploadEnabled ? " — uploading…" : " — click Insert."}`,
    );
    return files;
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
      pendingList.innerHTML = `<p class="muted small">After Download STEP on McMaster, click this tab — the file lands here, then in the workspace.</p>`;
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
        renderLocalDownloads();
        syncDocTab();
      });
    });
  }

  async function ensureDirPermission(mode = "readwrite") {
    if (!downloadsDir) return false;
    try {
      let perm = await downloadsDir.queryPermission?.({ mode });
      if (perm === "granted") return true;
      if (perm === "prompt" || perm === "denied") {
        perm = await downloadsDir.requestPermission?.({ mode });
      }
      if (perm === "granted") return true;
      // Fall back to read-only if write isn't available.
      if (mode === "readwrite") return await ensureDirPermission("read");
      return false;
    } catch {
      return false;
    }
  }

  async function copyFileIntoDownloadFolder(file) {
    if (!downloadsDir || !file) return false;
    const ok = await ensureDirPermission("readwrite");
    if (!ok) return false;
    try {
      const safeName = String(file.name || "part.step").replace(/[\\/]/g, "_");
      const handle = await downloadsDir.getFileHandle(safeName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
      return true;
    } catch (err) {
      console.warn("Could not copy into McMaster download folder", err);
      return false;
    }
  }

  async function pickDownloadedCad({ upload = true } = {}) {
    if (pickerBusy) return;
    pickerBusy = true;
    activateSession();
    try {
      if (typeof window.showOpenFilePicker === "function") {
        try {
          const pickerOpts = {
            // Allow multi-select so a second (or third) McMaster STEP is not missed.
            multiple: true,
            // Always open OS Downloads — no directory grant / no “system files” block.
            startIn: "downloads",
            types: [
              {
                description: "CAD models",
                accept: {
                  "model/step": [".step", ".stp"],
                  "model/stl": [".stl"],
                  "model/gltf-binary": [".glb"],
                  "application/octet-stream": [".3mf", ".obj", ".gltf", ".iges", ".igs"],
                },
              },
            ],
          };
          const handles = await window.showOpenFilePicker(pickerOpts);
          const files = [];
          for (const handle of handles) files.push(await handle.getFile());
          const staged = stageFiles(files);
          if (!staged.length) return;
          if (upload && autoUploadEnabled) {
            await maybeUploadStaged();
          }
          clearAwaitingDownload({ disarm: true });
          expectingReturnPick = false;
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

  async function handleReturnedFromDownload({ reason = "focus" } = {}) {
    if (!sessionOpen) return;
    // Keep banner urgent until they actually push a file.
    setGotBannerVisible(true);
    activateSession();
    dropZone?.classList.add("is-attention");
    localList?.closest(".mcmaster-local-block")?.classList.add("is-attention");

    if (downloadsDir) {
      const fresh = await refreshLocalDownloads({ autoStageNew: true });
      if (fresh?.length) {
        returnPickerArmed = false;
        return;
      }
    }

    // Chrome will not open a file picker without a user gesture. Arm the next
    // click in this tab so returning from McMaster feels like VibeCAD insert.
    armReturnPicker();
    expectingReturnPick = true;
    setStatus(
      "ok",
      reason === "popup-closed"
        ? "McMaster window closed. Click this tab to insert the STEP from Downloads."
        : "Click this tab to insert the STEP from Downloads.",
    );
  }

  function armReturnPicker() {
    returnPickerArmed = true;
    awaitingDownload = true;
    setGotBannerVisible(true);
    dropZone?.classList.add("is-attention");
    localList?.closest(".mcmaster-local-block")?.classList.add("is-attention");
    syncConnectionUi();
  }

  function onMcMasterTabGesture(event) {
    if (!sessionOpen || !expectingReturnPick) return;
    const target = event.target;
    if (!(target instanceof Element) || !host?.contains(target)) return;
    if (target.closest("button, a, input, textarea, select, label, .mcmaster-insert-file")) return;
    event.preventDefault();
    void pickDownloadedCad({ upload: true });
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
      try {
        await onSavePartReference(
          {
            cadFilename,
            partNumber,
            pageUrl,
            title: quick?.title || ctx.title || "",
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
      renderLocalDownloads();
      syncDocTab();
      try {
        const pageUrls = {};
        const partNumbers = {};
        const titles = {};
        for (const name of savedNames) {
          const ctx = currentProductContext(name);
          const quick = mergedMeta.quick || QUICK_PARTS.find((p) => String(name).startsWith(p.number));
          const pn = quick?.number || ctx.partNumber || guessMcMasterPartNumber(name);
          if (ctx.pageUrl) pageUrls[name] = ctx.pageUrl;
          else if (pn) pageUrls[name] = mcmasterProductUrl(pn);
          if (pn) partNumbers[name] = pn;
          if (quick?.title) titles[name] = quick.title;
        }
        await onLibrarySave?.(savedNames, choice, { pageUrls, partNumbers, titles });
      } catch {
        /* optional */
      }
      await savePartReferences(savedNames, mergedMeta, choice);
      setStatus(
        "ok",
        savedNames.length === 1
          ? `Inserted ${savedNames[0]} and updated the McMaster parts list.`
          : `Inserted ${savedNames.length} files and updated the McMaster parts list.`,
      );
    } catch (err) {
      setStatus("error", err?.message || "Could not insert McMaster part.");
    }
  }

  async function fetchServerPart(partNumber, { title = "", subtitle = "" } = {}) {
    const pn = guessMcMasterPartNumber(partNumber) || String(partNumber || "").trim().toUpperCase();
    if (!pn) {
      setStatus("error", "Enter a McMaster part number such as 91251A194.");
      return null;
    }
    if (typeof onFetchServerPart !== "function") {
      setStatus("error", "Server fetch is not connected.");
      return null;
    }
    rememberProductContext(mcmasterProductUrl(pn));
    setStatus("loading", `Fetching ${pn} STEP onto the server…`);
    try {
      const result = await onFetchServerPart({ number: pn, id: pn, title, subtitle });
      const name = result?.filename || result?.viewer_filename || `${pn}.step`;
      rememberImport([name], { partNumber: pn, pageUrl: result?.page_url || mcmasterProductUrl(pn) });
      renderRecent();
      renderTabRecent();
      const buy = result?.page_url || mcmasterProductUrl(pn);
      setStatus("ok", `Saved ${name} on the server · buy ${pn} at ${buy}`);
      return result;
    } catch (err) {
      setStatus("error", err?.message || `Could not fetch ${pn} from McMaster.`);
      return null;
    }
  }

  async function insertQuickPart(part) {
    if (!part) return;
    if (typeof onFetchServerPart === "function" && part.number) {
      const fetched = await fetchServerPart(part.number, {
        title: part.title || "",
        subtitle: part.subtitle || "",
      });
      if (fetched) return;
    }
    if (typeof onInsertCatalogPart === "function") {
      setStatus("loading", `Inserting ${part.title || part.number}…`);
      try {
        const result = await onInsertCatalogPart(part);
        const name = result?.filename || result?.viewer_filename || part.number;
        rememberImport([name], { quick: part });
        renderRecent();
        renderQuick();
        setStatus("ok", `Inserted ${part.number} · ${part.title} into the project.`);
      } catch (err) {
        setStatus("error", err?.message || "Could not insert hardware.");
      }
      return;
    }
    await importFiles([stlFileForPart(part)], { quick: part });
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
            partNumbers: meta.quick?.number ? { [savedNames[0]]: meta.quick.number } : {},
            titles: meta.quick?.title ? { [savedNames[0]]: meta.quick.title } : {},
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
    quickList.innerHTML = QUICK_FAMILIES.map((family) => {
      const first = familySelection(family);
      const sel = first;
      const lengthOpts = (family.sizes?.[0]?.lengths || [])
        .map((len) => `<option value="${escapeHtml(len.id)}">${escapeHtml(len.label)}</option>`)
        .join("");
      return `
      <article class="mcmaster-quick-card" data-quick-family="${escapeHtml(family.id)}">
        <img class="mcmaster-quick-thumb" src="${escapeHtml(MCMASTER_THUMB(sel?.number || ""))}" alt="" width="72" height="72" loading="lazy" />
        <div class="mcmaster-quick-copy">
          <strong>${escapeHtml(family.title)}</strong>
          <em data-quick-pn>${escapeHtml(sel?.number || "")}</em>
          <small data-quick-sub>${escapeHtml(sel?.subtitle || "")}</small>
          <div class="mcmaster-quick-fields">
            <label>${escapeHtml(family.sizeLabel || "Size")}
              <select data-quick-size>
                ${(family.sizes || []).map((sz) => `<option value="${escapeHtml(sz.id)}">${escapeHtml(sz.label)}</option>`).join("")}
              </select>
            </label>
            ${lengthOpts ? `<label>${escapeHtml(family.lengthLabel || "Length")}<select data-quick-length>${lengthOpts}</select></label>` : ""}
          </div>
          <button type="button" class="btn accent btn-compact" data-quick-download>Download STEP</button>
        </div>
      </article>`;
    }).join("");

    const syncCard = (card) => {
      const family = QUICK_FAMILIES.find((f) => f.id === card.dataset.quickFamily);
      if (!family) return null;
      const sizeSel = card.querySelector("[data-quick-size]");
      const lengthSel = card.querySelector("[data-quick-length]");
      const size = (family.sizes || []).find((s) => s.id === sizeSel?.value) || family.sizes?.[0];
      if (lengthSel && size?.lengths) {
        const keep = lengthSel.value;
        lengthSel.innerHTML = size.lengths
          .map((len) => `<option value="${escapeHtml(len.id)}">${escapeHtml(len.label)}</option>`)
          .join("");
        lengthSel.value = size.lengths.some((l) => l.id === keep) ? keep : size.lengths[0].id;
      }
      const sel = familySelection(family, sizeSel?.value, lengthSel?.value);
      const pnEl = card.querySelector("[data-quick-pn]");
      const subEl = card.querySelector("[data-quick-sub]");
      const thumb = card.querySelector(".mcmaster-quick-thumb");
      if (pnEl) pnEl.textContent = sel?.number || "";
      if (subEl) subEl.textContent = sel?.subtitle || "";
      if (thumb && sel?.number) thumb.src = MCMASTER_THUMB(sel.number);
      return sel;
    };

    quickList.querySelectorAll("[data-quick-family]").forEach((card) => {
      card.querySelector("[data-quick-size]")?.addEventListener("change", () => syncCard(card));
      card.querySelector("[data-quick-length]")?.addEventListener("change", () => syncCard(card));
      card.querySelector(".mcmaster-quick-thumb")?.addEventListener("error", (event) => {
        event.currentTarget.style.visibility = "hidden";
      });
      card.querySelector("[data-quick-download]")?.addEventListener("click", async () => {
        const sel = syncCard(card);
        if (!sel?.number) return;
        const extra = catalogRowByNumber(sel.number);
        await insertQuickPart({
          id: sel.number,
          number: sel.number,
          title: extra?.title || sel.title,
          subtitle: sel.subtitle,
        });
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
            await insertQuickPart(part);
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
    syncDownloadFolderUi();
    // Default path: staged / just-pushed files (no Downloads folder link).
    if (!downloadsDir) {
      if (!pending.length) {
        localList.innerHTML = `<p class="muted small">Empty — fetched STEP files land on the server.</p>`;
        return;
      }
      localList.innerHTML = pending.slice(0, 10).map((item) => `
        <div class="mcmaster-local-row">
          <div class="mcmaster-pending-copy">
            <strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong>
            <small>${Math.max(1, Math.round(item.file.size / 1024))} KB · staged</small>
          </div>
        </div>
      `).join("");
      return;
    }
    if (!localFiles.length) {
      localList.innerHTML = `<p class="muted small">Watch folder <strong>${escapeHtml(downloadFolderName || MCMASTER_BUCKET)}</strong> is empty. McMaster saves into Chrome Downloads — click this tab or <strong>Insert downloaded STEP</strong> and multi-select every new STEP.</p>`;
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

  async function listLocalCadFiles() {
    if (!downloadsDir) return [];
    const ok = await ensureDirPermission("read");
    if (!ok) return [];
    const found = [];
    for await (const [name, handle] of downloadsDir.entries()) {
      if (handle.kind !== "file") continue;
      if (!CAD_NAME_RE.test(name)) continue;
      // Skip in-progress browser downloads.
      if (/\.(crdownload|part|tmp|download)$/i.test(name)) continue;
      try {
        const file = await handle.getFile();
        found.push({ name, file, at: file.lastModified || Date.now() });
      } catch {
        /* skip */
      }
    }
    found.sort((a, b) => b.at - a.at);
    return found;
  }

  async function snapshotSeenLocalFiles() {
    const found = await listLocalCadFiles();
    for (const item of found) seenLocalKeys.add(localFileKey(item));
    localFiles = found.slice(0, 10);
    renderLocalDownloads();
    return found;
  }

  async function waitFileStable(item, attempts = 4) {
    let last = item.file.size;
    for (let i = 0; i < attempts; i += 1) {
      await new Promise((r) => window.setTimeout(r, 600));
      try {
        const handle = await downloadsDir.getFileHandle(item.name);
        const fresh = await handle.getFile();
        if (fresh.size === last && fresh.size > 64) {
          return { name: item.name, file: fresh, at: fresh.lastModified || Date.now() };
        }
        last = fresh.size;
      } catch {
        return item;
      }
    }
    return item;
  }

  async function ingestNewDownloads({ force = false } = {}) {
    if (!downloadsDir || autoUploading) return [];
    try {
      const found = await listLocalCadFiles();
      localFiles = found.slice(0, 20);
      renderLocalDownloads();

      const candidates = found.filter((item) => {
        const key = localFileKey(item);
        const alreadyPending = pending.some(
          (p) => p.file?.name === item.name && Number(p.file?.size || 0) === Number(item.file?.size || 0),
        );
        if (alreadyPending) return false;

        // Manual Scan: pick up every CAD file in the bucket that isn't already staged
        // (do not permanently skip just because an earlier poll marked it "seen").
        if (force) return true;

        if (seenLocalKeys.has(key)) return false;
        if (sessionBaselineNames.has(item.name)) return false;
        // Must be newer than watch start (with small clock skew allowance).
        if (downloadWatchStartedAt && item.at < downloadWatchStartedAt - 3000) {
          return false;
        }
        // Not in an active download session — leave unseen so a later Scan can still find it.
        if (!awaitingDownload && !sessionOpen) {
          return false;
        }
        return true;
      });

      if (!candidates.length) {
        if (force) {
          setStatus(
            "ok",
            found.length
              ? "No new STEPs in the watch folder (already staged or previously seen). Click this tab to pick from Chrome Downloads."
              : "Watch folder is empty. McMaster saves to Chrome Downloads — click this tab and multi-select every STEP.",
          );
        }
        return [];
      }

      candidates.sort((a, b) => b.at - a.at);
      const readyList = [];
      for (const candidate of candidates) {
        const ready = await waitFileStable(candidate);
        seenLocalKeys.add(localFileKey(ready));
        seenLocalKeys.add(localFileKey(candidate));
        sessionBaselineNames.add(ready.name);
        readyList.push(ready);
      }
      if (!readyList.length) return [];

      const files = readyList.map((item) => item.file);
      const label =
        readyList.length === 1
          ? readyList[0].name
          : `${readyList.length} new STEPs`;

      if (!autoUploadEnabled) {
        stageFiles(files);
        setStatus(
          "ok",
          force
            ? `${label} found in watch folder — staged. Click Insert or enable auto-upload.`
            : `${label} landed in the bucket — staged. Enable auto-upload or click Insert.`,
        );
        return readyList;
      }

      autoUploading = true;
      try {
        stageFiles(files);
        setStatus("loading", `Uploading ${label} to current workspace…`);
        await insertPending(null, { forceCurrent: true });
        // Keep armed if McMaster is still open — more parts may follow.
        clearAwaitingDownload();
        setStatus(
          "ok",
          readyList.length === 1
            ? `Uploaded ${readyList[0].name} into the current workspace.`
            : `Uploaded ${readyList.length} files into the current workspace.`,
        );
      } finally {
        autoUploading = false;
      }
      return readyList;
    } catch (err) {
      console.warn("ingestNewDownloads failed", err);
      return [];
    }
  }

  async function refreshLocalDownloads({ autoStageNew = false } = {}) {
    if (!downloadsDir) {
      renderLocalDownloads();
      return [];
    }
    if (autoStageNew || (autoUploadEnabled && (awaitingDownload || sessionOpen))) {
      return ingestNewDownloads({ force: !!autoStageNew });
    }
    // Display-only refresh — do NOT mark files as seen (that made Scan miss later parts).
    const found = await listLocalCadFiles();
    localFiles = found.slice(0, 10);
    renderLocalDownloads();
    return found;
  }

  async function ensureMcMasterBucket(parentHandle) {
    const bucket = await parentHandle.getDirectoryHandle(MCMASTER_BUCKET, { create: true });
    return bucket;
  }

  async function linkDownloadsFolder() {
    if (typeof window.showDirectoryPicker !== "function") {
      setStatus("error", "This browser cannot watch a folder — click this tab after Download STEP instead (Chrome/Edge).");
      void pickDownloadedCad();
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({
        mode: "readwrite",
        id: "mcmaster-download-parent",
      });
      // Chrome Downloads (and some system dirs) refuse directory access — never require that path.
      const lower = String(handle.name || "").toLowerCase();
      if (lower === "downloads" || lower === "download") {
        setStatus(
          "error",
          "Chrome blocks the Downloads folder (system files). Click this tab after Download STEP, or pick Documents/Desktop to watch a folder.",
        );
        return;
      }
      parentDir = handle;
      downloadsDir = await ensureMcMasterBucket(handle);
      downloadFolderName = `${handle.name}/${MCMASTER_BUCKET}`;
      writeDownloadFolderName(downloadFolderName);
      try {
        await idbSet("downloadsParent", handle);
        await idbSet("downloadsDir", downloadsDir);
      } catch {
        /* optional */
      }
      syncDownloadFolderUi();
      setStatus(
        "ok",
        `Watching ${downloadFolderName}. Prefer clicking this tab after Download STEP unless you save STEPs into this folder.`,
      );
      await snapshotSeenLocalFiles();
      sessionBaselineNames = new Set(localFiles.map((f) => f.name));
      startLocalPoll({ fast: true });
      startFolderObserver();
    } catch (err) {
      if (err?.name === "AbortError") return;
      const msg = String(err?.message || err || "");
      if (/system files|not allowed|permission|denied/i.test(msg)) {
        setStatus(
          "error",
          "That folder can’t be linked (system files). Click this tab after Download STEP — no folder link needed.",
        );
        return;
      }
      setStatus("error", msg || "Could not set watch folder.");
    }
  }

  async function restoreDownloadsFolder() {
    try {
      const parent = await idbGet("downloadsParent");
      const bucket = await idbGet("downloadsDir");
      if (!parent && !bucket) {
        syncDownloadFolderUi();
        return;
      }
      if (parent) {
        parentDir = parent;
        downloadsDir = parent;
        let ok = await ensureDirPermission("readwrite");
        if (!ok) ok = await ensureDirPermission("read");
        if (!ok) {
          parentDir = null;
          downloadsDir = null;
          syncDownloadFolderUi();
          return;
        }
        downloadsDir = await ensureMcMasterBucket(parent);
        try {
          await idbSet("downloadsDir", downloadsDir);
        } catch {
          /* ignore */
        }
      } else {
        downloadsDir = bucket;
        let ok = await ensureDirPermission("readwrite");
        if (!ok) ok = await ensureDirPermission("read");
        if (!ok) {
          downloadsDir = null;
          syncDownloadFolderUi();
          return;
        }
      }
      downloadFolderName =
        readDownloadFolderName() ||
        (parentDir ? `${parentDir.name}/${MCMASTER_BUCKET}` : downloadsDir?.name || MCMASTER_BUCKET);
      writeDownloadFolderName(downloadFolderName);
      syncDownloadFolderUi();
      await snapshotSeenLocalFiles();
      sessionBaselineNames = new Set(localFiles.map((f) => f.name));
      startLocalPoll({ fast: false });
      startFolderObserver();
    } catch {
      syncDownloadFolderUi();
    }
  }

  function stopFolderObserver() {
    try {
      fsObserver?.disconnect?.();
    } catch {
      /* ignore */
    }
    fsObserver = null;
  }

  function startFolderObserver() {
    stopFolderObserver();
    if (!downloadsDir || typeof FileSystemObserver !== "function") return;
    try {
      fsObserver = new FileSystemObserver(() => {
        void ingestNewDownloads();
      });
      fsObserver.observe(downloadsDir);
    } catch (err) {
      console.warn("FileSystemObserver unavailable", err);
      fsObserver = null;
    }
  }

  function startLocalPoll({ fast = false } = {}) {
    if (localPollTimer) window.clearInterval(localPollTimer);
    const ms = fast || awaitingDownload ? 1200 : 4000;
    localPollTimer = window.setInterval(() => {
      if (sessionOpen && downloadsDir && !host?.classList.contains("hidden")) {
        void ingestNewDownloads();
      }
    }, ms);
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
    clearAwaitingDownload({ disarm: true });
    if (docTabs?.has?.(MCMASTER_TAB_ID)) docTabs.remove(MCMASTER_TAB_ID);
    mcmasterWin = null;
    popupBlocked = false;
    syncConnectionUi();
  }

  function openStepManager() {
    closePanel();
    activateSession();
    dockCatalogTab("right");
  }

  function openSession({ query = "", autoOpen = true, dock = "right" } = {}) {
    closePanel();
    if (query && searchInput) searchInput.value = query;
    activateSession();
    dockCatalogTab(dock || "right");
    if (autoOpen) openLiveWindow(searchUrlFromInput());
  }

  function closeAll() {
    closePanel();
  }

  async function onReturnFromMcMaster() {
    if (!sessionOpen) return;
    if (!awaitingDownload && !returnPickerArmed) return;
    returnPickerArmed = false;
    await handleReturnedFromDownload({ reason: "focus" });
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
  function readDestMode() {
    if (typeof getInsertDest === "function") {
      const mode = getInsertDest();
      if (["ask", "current", "new"].includes(mode)) return mode;
    }
    try {
      const mode = localStorage.getItem(LS_INSERT_DEST) || "ask";
      return ["ask", "current", "new"].includes(mode) ? mode : "ask";
    } catch {
      return "ask";
    }
  }

  function persistDestMode(mode) {
    const next = ["ask", "current", "new"].includes(mode) ? mode : "ask";
    if (typeof setInsertDest === "function") setInsertDest(next);
    else {
      try {
        localStorage.setItem(LS_INSERT_DEST, next);
      } catch {
        /* ignore */
      }
    }
    syncDestButton();
    return next;
  }

  function syncDestButton() {
    if (destButton) destButton.textContent = DEST_LABELS[readDestMode()] || DEST_LABELS.ask;
  }

  function hideSuggest() {
    if (!suggestBox) return;
    suggestBox.hidden = true;
    suggestBox.innerHTML = "";
    suggestBox.removeAttribute("data-active-pn");
  }

  function pickSuggest(row) {
    const pn = String(row?.number || "").trim().toUpperCase();
    if (!pn) return;
    hideSuggest();
    if (searchInput) searchInput.value = pn;
    void fetchServerPart(pn, { title: row.title || "", subtitle: row.subtitle || "" });
  }

  function suggestionFromQuery(query) {
    const q = String(query || "").trim();
    const pn = guessMcMasterPartNumber(q);
    if (pn) {
      const extra = catalogRowByNumber(pn);
      return { number: pn, title: extra?.title || "", subtitle: extra?.subtitle || "" };
    }
    return suggestMcMasterParts(q)[0] || null;
  }

  function renderSuggestRows(rows) {
    if (!suggestBox) return;
    if (!rows?.length) {
      hideSuggest();
      return;
    }
    suggestBox.hidden = false;
    suggestBox.innerHTML = rows
      .map(
        (row) => `
        <button type="button" class="mcmaster-suggest-row" role="option" data-suggest-pn="${escapeHtml(row.number)}" data-suggest-title="${escapeHtml(row.title || "")}" data-suggest-sub="${escapeHtml(row.subtitle || "")}">
          <img src="${escapeHtml(MCMASTER_THUMB(row.number))}" alt="" width="36" height="36" loading="lazy" />
          <span>
            <em>${escapeHtml(row.number)}</em>
            <strong>${escapeHtml(row.title || "McMaster part")}</strong>
            <small>${escapeHtml(row.subtitle || "")}</small>
          </span>
        </button>`,
      )
      .join("");
    suggestBox.querySelectorAll("[data-suggest-pn]").forEach((btn) => {
      btn.addEventListener("mousedown", (event) => event.preventDefault());
      btn.addEventListener("click", () => {
        pickSuggest({
          number: btn.dataset.suggestPn,
          title: btn.dataset.suggestTitle,
          subtitle: btn.dataset.suggestSub,
        });
      });
      btn.querySelector("img")?.addEventListener("error", (event) => {
        event.currentTarget.style.visibility = "hidden";
      });
    });
  }

  let suggestSeq = 0;
  let mcmasterSuggestAbort = null; // leakfix65
  function beginMcMasterSuggestFetch() {
    if (mcmasterSuggestAbort) {
      try { mcmasterSuggestAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    mcmasterSuggestAbort = ctl;
    return ctl;
  }
  async function refreshSuggest(query) {
    const q = String(query || "").trim();
    if (q.length < 2) {
      hideSuggest();
      return;
    }
    const local = suggestMcMasterParts(q);
    renderSuggestRows(local);
    if (typeof onSuggestParts !== "function") return;
    const seq = ++suggestSeq;
    const ctl = beginMcMasterSuggestFetch();
    try {
      const extra = await onSuggestParts(q, { signal: ctl.signal });
      if (ctl.signal.aborted || seq !== suggestSeq) return;
      const seen = new Set(local.map((row) => String(row.number || "").toUpperCase()));
      const merged = [...local];
      for (const row of extra || []) {
        const pn = String(row.number || row.id || "").toUpperCase();
        if (!pn || seen.has(pn)) continue;
        seen.add(pn);
        merged.push({
          number: pn,
          title: row.title || "",
          subtitle: row.subtitle || "",
        });
      }
      renderSuggestRows(merged.slice(0, 8));
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError" || seq !== suggestSeq) return;
      /* local rows already shown */
    } finally {
      if (mcmasterSuggestAbort === ctl) mcmasterSuggestAbort = null;
    }
  }

  host?.querySelectorAll("[data-mcmaster-fetch]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const hit = suggestionFromQuery(searchInput?.value || "");
      void fetchServerPart(hit?.number || searchInput?.value || "", {
        title: hit?.title || "",
        subtitle: hit?.subtitle || "",
      });
    });
  });
  destButton?.addEventListener("click", () => {
    const order = ["current", "new", "ask"];
    persistDestMode(order[(order.indexOf(readDestMode()) + 1) % order.length]);
  });
  syncDestButton();
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
  searchInput?.addEventListener("input", () => {
    rememberProductContext(searchInput.value);
    void refreshSuggest(searchInput.value);
  });
  searchInput?.addEventListener("focus", () => {
    if (String(searchInput.value || "").trim().length >= 2) void refreshSuggest(searchInput.value);
  });
  searchInput?.addEventListener("blur", () => {
    window.setTimeout(() => hideSuggest(), 120);
  });
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideSuggest();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      rememberProductContext(searchInput.value);
      const hit = suggestionFromQuery(searchInput.value);
      if (hit?.number && typeof onFetchServerPart === "function") {
        hideSuggest();
        void fetchServerPart(hit.number, { title: hit.title || "", subtitle: hit.subtitle || "" });
        return;
      }
      navigateLive(searchUrlFromInput());
    }
  });
  searchInput?.addEventListener("change", () => rememberProductContext(searchInput.value));
  refLinkInput?.addEventListener("change", () => rememberProductContext(refLinkInput.value));
  refLinkInput?.addEventListener("blur", () => rememberProductContext(refLinkInput.value));

  host?.querySelector("[data-mcmaster-link-downloads]")?.addEventListener("click", () => void linkDownloadsFolder());
  host?.querySelector("[data-mcmaster-change-downloads]")?.addEventListener("click", () => void linkDownloadsFolder());
  host?.querySelector("[data-mcmaster-refresh-local]")?.addEventListener("click", () => {
    void (async () => {
      const found = await ingestNewDownloads({ force: true });
      if (found?.length) return;
      // Watch folder empty / no new files — McMaster usually saved into Chrome Downloads.
      setStatus(
        "ok",
        "Nothing new in the watch folder. Opening Downloads — multi-select every STEP (Cmd/Ctrl+click).",
      );
      await pickDownloadedCad({ upload: true });
    })();
  });
  autoUploadInput?.addEventListener("change", () => {
    autoUploadEnabled = !!autoUploadInput.checked;
    writeAutoUploadPref(autoUploadEnabled);
    syncAutoUploadCopy();
    setStatus(
      "ok",
      autoUploadEnabled
        ? "After push, files upload immediately into the current workspace."
        : "After push, files stay staged until you insert.",
    );
  });
  syncAutoUploadCopy();
  host?.querySelector("[data-mcmaster-import]")?.addEventListener("click", () => void pickDownloadedCad());
  host?.querySelector("[data-mcmaster-got-download]")?.addEventListener("click", () => void pickDownloadedCad({ upload: true }));
  host?.querySelector("[data-mcmaster-insert-current]")?.addEventListener("click", () => void insertPending());
  host?.querySelector("[data-mcmaster-clear-pending]")?.addEventListener("click", () => {
    pending = [];
    renderPending();
    renderLocalDownloads();
    syncDocTab();
  });
  fileInput?.addEventListener("change", () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = "";
    stageFiles(files);
    void maybeUploadStaged();
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
    void maybeUploadStaged();
  });

  host?.addEventListener("pointerdown", onMcMasterTabGesture);
  window.addEventListener("focus", () => onReturnFromMcMaster());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onReturnFromMcMaster();
  });

  return {
    open: openStepManager,
    close: closeAll,
    openMcMaster: openSession,
    openStepManager,
    closeMcMaster: () => closeSession({ keepWindow: true }),
    activateFromShared() {
      activateSession();
      if (expectingReturnPick) {
        void pickDownloadedCad({ upload: true });
      }
    },
    hideViewerOnly,
    syncDest: syncDestButton,
    closeTab(id) {
      if (id && id !== MCMASTER_TAB_ID) return;
      closeSession({ keepWindow: true });
    },
    isOpen() {
      return !panel.classList.contains("hidden") || sessionOpen;
    },
  };
}
