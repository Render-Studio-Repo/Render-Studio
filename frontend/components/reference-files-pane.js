/** Left-sidebar Reference files / Recent pane: newest-first, folders, grid, search. */

import {
  filterBrowserEntriesByName,
  inferReferenceVirtualFolder,
  nestReferenceFolderItems,
  REFERENCE_VIRTUAL_FOLDERS,
  sortReferenceEntries,
  entryOpensInVideoEditor,
  videoEditorActionEntry,
} from "./reference-files.js?v=reftab1-notesx1-refcode1-20260915-code-workspace3-heicpng1-vidopen1&leakfix7&leakfix9&leakfix106&filmapply=20261006-2";
import {
  captureSortMs,
  formatEntryCapturedAt,
  friendlyCaptureDisplayName,
} from "../viewport/capture-labels.js?v=20260907-capture-names-20260915-refrec1-20260915-recclock1-reftab1";

export const REF_FILES_PANE_CACHE = "reftab1-notesx1";
export const REF_FILES_TAB_KEY = "render3d:ref-files-tab:v1";
export const REF_FILES_VIEW_KEY = "render3d:ref-files-view:v1";
export const REF_FILES_COLLAPSE_KEY = "render3d:ref-files-collapsed:v1";
export const REF_FILES_HIDDEN_KEY = "render3d:ref-files-pane-hidden:v1";
export const REF_FILES_SORT_KEY = "render3d:ref-files-sort:v1";
export const LEFT_PANEL_WIDTH_KEY = "render3d:leftPanelWidth";

const KNOWN_FOLDER_IDS = new Set(REFERENCE_VIRTUAL_FOLDERS.map((row) => row.id));

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return fallback;
    return raw;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

function readJsonSet(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeJsonSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function referenceEntrySortMs(entry = {}) {
  const captured = captureSortMs(entry);
  if (captured) return captured;
  for (const key of ["updated_at", "created_at", "mtime", "opened_at"]) {
    const value = entry?.[key];
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n > 1e12 ? n : n * 1000;
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

export function sortReferenceEntriesNewestFirst(entries = []) {
  return [...(entries || [])].sort((a, b) => referenceEntrySortMs(b) - referenceEntrySortMs(a));
}

function folderSortMs(entry = {}) {
  if (!entry?.virtual_folder) return referenceEntrySortMs(entry);
  let max = 0;
  for (const child of entry.children || []) {
    max = Math.max(max, folderSortMs(child));
  }
  return max;
}

export function sortReferenceTreeNewestFirst(items = []) {
  return sortReferenceEntriesNewestFirst(
    (items || []).map((entry) => {
      if (entry?.virtual_folder && Array.isArray(entry.children)) {
        return { ...entry, children: sortReferenceTreeNewestFirst(entry.children) };
      }
      return entry;
    }),
  ).sort((a, b) => folderSortMs(b) - folderSortMs(a));
}

export function flattenReferenceEntries(items = []) {
  const out = [];
  const walk = (list) => {
    for (const entry of list || []) {
      if (!entry) continue;
      if (entry.virtual_folder) {
        walk(entry.children);
        continue;
      }
      if (entry.name || entry.filename || entry.viewer_filename) out.push(entry);
      if (entry.children?.length) walk(entry.children);
    }
  };
  walk(items);
  return out;
}

function insertFolderPath(rootMap, parts, file) {
  if (!parts.length) return;
  const [head, ...rest] = parts;
  if (!rootMap.has(head)) {
    rootMap.set(head, {
      id: `folder:${head}`,
      name: head,
      label: head,
      virtual_folder: true,
      folder: head,
      default_collapsed: true,
      children: [],
      _dirs: new Map(),
    });
  }
  const node = rootMap.get(head);
  if (!rest.length) {
    node.children.push(file);
    return;
  }
  insertFolderPath(node._dirs, rest, file);
}

function flushFolderMap(rootMap, prefix = "") {
  const out = [];
  for (const node of rootMap.values()) {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    const nested = flushFolderMap(node._dirs, path);
    out.push({
      id: `folder:${path}`,
      name: node.name,
      label: node.label || node.name,
      children_label: node.label || node.name,
      virtual_folder: true,
      folder: path,
      default_collapsed: true,
      children: [...nested, ...node.children],
    });
  }
  return out;
}

export function nestLooseFolderPaths(items = []) {
  const folders = new Map();
  const out = [];
  for (const entry of items || []) {
    if (entry?.virtual_folder) {
      out.push(entry);
      continue;
    }
    const folder = String(entry?.folder || entry?.parent_folder || "").trim();
    const inferred = inferReferenceVirtualFolder(entry);
    if (!folder || KNOWN_FOLDER_IDS.has(folder) || KNOWN_FOLDER_IDS.has(inferred)) {
      out.push(entry);
      continue;
    }
    insertFolderPath(folders, folder.split("/").filter(Boolean), entry);
  }
  return [...out, ...flushFolderMap(folders)];
}

export function buildReferenceFilesTree(items = []) {
  return sortReferenceTreeNewestFirst(nestLooseFolderPaths(nestReferenceFolderItems(items)));
}

export function formatReferenceTimestamp(entry = {}) {
  return formatEntryCapturedAt(entry)
    || (() => {
      const ms = referenceEntrySortMs(entry);
      if (!ms) return "";
      try {
        return new Date(ms).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      } catch {
        return "";
      }
    })();
}

export function referenceFileKind(entry = {}) {
  const name = String(entry?.name || entry?.filename || "");
  if (entry.kind === "image" || /\.(png|jpe?g|webp|gif|bmp|svg|tiff?)$/i.test(name)) return "image";
  if (entry.kind === "video" || /\.(webm|mp4|mov|m4v)$/i.test(name)) return "video";
  if (entry.kind === "pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (/\.(txt|md|csv|tsv|log|json|ya?ml|html?|rtf|js|mjs|cjs|jsx|ts|tsx|py|css|sh)$/i.test(name)) {
    if (/\.json$/i.test(name)) return "json";
    if (/\.(csv|tsv)$/i.test(name)) return "csv";
    if (/\.(txt|log|rtf)$/i.test(name)) return "text";
    return "code";
  }
  if (/\.xlsx?$/i.test(name)) return "spreadsheet";
  return "file";
}

export function normalizeUserUpdateRows(rows = []) {
  return [...(rows || [])]
    .map((row) => {
      const when = row.when || row.created_at || row.updated_at || row.mtime || "";
      const ms = referenceEntrySortMs({ ...row, created_at: when, updated_at: row.updated_at, mtime: row.mtime });
      return {
        who: String(row.who || row.user_name || row.author || "Someone").trim() || "Someone",
        what: String(row.what || row.label || row.kind || "updated a file").trim() || "updated a file",
        when,
        kind: String(row.kind || "update"),
        ms,
      };
    })
    .sort((a, b) => (b.ms || 0) - (a.ms || 0));
}

function typeIcon(kind) {
  if (kind === "image") return "🖼";
  if (kind === "video") return "▶";
  if (kind === "pdf") return "📄";
  if (kind === "text" || kind === "code" || kind === "json" || kind === "csv") return "📝";
  if (kind === "spreadsheet") return "▦";
  return "📎";
}

function displayName(entry) {
  return friendlyCaptureDisplayName(entry, "")
    || entry?.label
    || entry?.stem
    || String(entry?.name || entry?.filename || "File").replace(/\.[^.]+$/, "");
}

function collectSourceItems(browser = {}) {
  return [
    ...(browser.drawings || []),
    ...(browser.references || []),
    ...(browser.renders || []),
    ...(browser.imagine || []),
  ];
}

export function createReferenceFilesPane({
  root,
  getProjectId = () => null,
  onOpenFile = null,
  onOpenCodeFolder = null,
  onOpenVideoEditor = null,
  onReopenNotes = null,
  onHideFilesPane = null,
  onShowUpdates = null,
} = {}) {
  if (!root) return null;

  let tab = readStore(REF_FILES_TAB_KEY, "files") === "recent" ? "recent" : "files";
  let view = readStore(REF_FILES_VIEW_KEY, "list") === "grid" ? "grid" : "list";
  let sortDir = readStore(REF_FILES_SORT_KEY, "newest") === "oldest" ? "oldest" : "newest";
  let query = "";
  let collapsed = readJsonSet(REF_FILES_COLLAPSE_KEY);
  let hidden = readStore(REF_FILES_HIDDEN_KEY, "") === "1";
  let tree = [];
  let flat = [];
  let projectId = "";

  root.innerHTML = `
    <div class="ref-files-pane-head">
      <div class="ref-files-pane-tabs" role="tablist" aria-label="Reference files">
        <button type="button" class="ref-files-pane-tab" role="tab" data-ref-pane-tab="files" id="ref-files-tab-files">Reference files</button>
        <button type="button" class="ref-files-pane-tab" role="tab" data-ref-pane-tab="recent" id="ref-files-tab-recent">Recent</button>
      </div>
      <div class="sidebar-chrome-menu">
        <button type="button" id="btn-sidebar-chrome-menu" class="sidebar-chrome-menu-btn" aria-haspopup="true" aria-expanded="false" aria-controls="sidebar-chrome-menu" title="Sidebar actions">
          <span aria-hidden="true">⋯</span>
          <span class="visually-hidden">Sidebar actions</span>
        </button>
        <div id="sidebar-chrome-menu" class="sidebar-chrome-menu-panel hidden" role="menu" aria-label="Sidebar actions">
          <button type="button" role="menuitem" data-sidebar-chrome="notes">Reopen notes</button>
          <button type="button" role="menuitem" data-sidebar-chrome="files">Hide files pane</button>
          <button type="button" role="menuitem" data-sidebar-chrome="updates">Show updates</button>
        </div>
      </div>
    </div>
    <div class="ref-files-pane-toolbar">
      <input type="search" id="ref-files-search" class="ref-files-search" placeholder="Search files…" autocomplete="off" aria-label="Search files" />
      <button type="button" class="refs-files-sort" data-ref-sort title="Toggle newest or oldest">Newest</button>
      <div class="ref-files-view-toggle" role="group" aria-label="File view">
        <button type="button" class="ref-files-view-btn" data-ref-view="list" title="List view">List</button>
        <button type="button" class="ref-files-view-btn" data-ref-view="grid" title="Grid view">Grid</button>
      </div>
    </div>
    <div class="ref-files-pane-body" id="ref-files-pane-body"></div>
  `;

  const body = root.querySelector("#ref-files-pane-body");
  const search = root.querySelector("#ref-files-search");
  const menuBtn = root.querySelector("#btn-sidebar-chrome-menu");
  const menu = root.querySelector("#sidebar-chrome-menu");

  function setMenuOpen(open) {
    menu?.classList.toggle("hidden", !open);
    menuBtn?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function syncChrome() {
    root.querySelectorAll("[data-ref-pane-tab]").forEach((btn) => {
      const on = btn.dataset.refPaneTab === tab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    root.querySelectorAll("[data-ref-view]").forEach((btn) => {
      const on = btn.dataset.refView === view;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const sortBtn = root.querySelector("[data-ref-sort]");
    if (sortBtn) {
      sortBtn.textContent = sortDir === "oldest" ? "Oldest" : "Newest";
      sortBtn.setAttribute("aria-pressed", sortDir === "oldest" ? "true" : "false");
      sortBtn.title = sortDir === "oldest" ? "Showing oldest first — click for newest" : "Showing newest first — click for oldest";
    }
    const hideBtn = menu?.querySelector('[data-sidebar-chrome="files"]');
    if (hideBtn) hideBtn.textContent = hidden ? "Show files pane" : "Hide files pane";
    root.hidden = hidden;
    root.classList.toggle("is-hidden", hidden);
    let restore = document.getElementById("reference-files-pane-restore");
    if (!restore) {
      restore = document.createElement("button");
      restore.type = "button";
      restore.id = "reference-files-pane-restore";
      restore.className = "ref-files-pane-restore";
      restore.textContent = "Show Reference files";
      root.insertAdjacentElement("afterend", restore);
      restore.addEventListener("click", () => setHidden(false));
    }
    restore.hidden = !hidden;
  }

  function folderKey(entry) {
    return String(entry?.id || entry?.folder || entry?.name || "");
  }

  function isCollapsed(entry) {
    const key = folderKey(entry);
    if (collapsed.has(key)) return true;
    if (collapsed.has(`open:${key}`)) return false;
    return !!entry?.default_collapsed;
  }

  function toggleFolder(entry) {
    const key = folderKey(entry);
    if (isCollapsed(entry)) {
      collapsed.delete(key);
      collapsed.add(`open:${key}`);
    } else {
      collapsed.delete(`open:${key}`);
      collapsed.add(key);
    }
    writeJsonSet(REF_FILES_COLLAPSE_KEY, collapsed);
    render();
  }

  function fileButton(entry, { grid = false } = {}) {
    const name = displayName(entry);
    const when = formatReferenceTimestamp(entry);
    const kind = referenceFileKind(entry);
    const thumb = entry.thumb_url || entry.preview_url || entry.thumbnail_url || "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = grid ? "ref-file-card" : "ref-file-row";
    btn.title = when ? `${name} — ${when}` : name;
    const media = thumb
      ? `<img class="ref-file-thumb" src="${escapeHtml(thumb)}" alt="" />`
      : `<span class="ref-file-icon ref-file-icon--${kind}" aria-hidden="true">${typeIcon(kind)}</span>`;
    btn.innerHTML = grid
      ? `${media}<span class="ref-file-name">${escapeHtml(name)}</span>${when ? `<time class="ref-file-time">${escapeHtml(when)}</time>` : ""}`
      : `${media}<span class="ref-file-copy"><span class="ref-file-name">${escapeHtml(name)}</span>${when ? `<time class="ref-file-time">${escapeHtml(when)}</time>` : ""}</span>`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onOpenFile?.(entry, projectId);
    });
    return btn;
  }

  function renderFolder(entry, into, depth = 0) {
    const open = !isCollapsed(entry);
    const wrap = document.createElement("div");
    wrap.className = "ref-file-folder";
    wrap.style.setProperty("--ref-folder-depth", String(depth));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ref-file-folder-toggle";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    const count = flattenReferenceEntries(entry.children || []).length;
    toggle.innerHTML = `
      <span class="ref-file-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
      <span class="ref-file-folder-name">${escapeHtml(entry.label || entry.name || "Folder")}</span>
      <span class="ref-file-folder-count">${count}</span>
    `;
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFolder(entry);
    });
    const actions = document.createElement("div");
    actions.className = "ref-code-folder-actions";
    actions.appendChild(toggle);
    const canOpenVideo = entryOpensInVideoEditor(entry);
    const canOpenCode = typeof onOpenCodeFolder === "function" && !canOpenVideo;
    if (canOpenVideo || canOpenCode) {
      const more = document.createElement("button");
      more.type = "button"; more.className = "ref-code-folder-menu-button";
      more.textContent = "⋯"; more.title = "Folder actions";
      more.setAttribute("aria-label", `Actions for ${entry.label || entry.name || "folder"}`);
      more.setAttribute("aria-haspopup", "menu");
      more.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        const existing = actions.querySelector(".ref-code-folder-menu");
        if (existing) { existing.remove(); more.setAttribute("aria-expanded", "false"); return; }
        root.querySelectorAll(".ref-code-folder-menu").forEach(menu => menu.remove());
        const menu = document.createElement("div"); menu.className = "ref-code-folder-menu"; menu.setAttribute("role", "menu");
        const open = document.createElement("button"); open.type = "button";
        open.textContent = canOpenVideo ? "Open in video editor" : "Open folder in code editor";
        open.setAttribute("role", "menuitem");
        open.onclick = e => {
          e.stopPropagation();
          menu.remove();
          more.setAttribute("aria-expanded", "false");
          if (canOpenVideo) {
            const target = videoEditorActionEntry(entry);
            if (typeof onOpenVideoEditor === "function") void onOpenVideoEditor(target);
            else void onOpenFile?.(target);
            return;
          }
          void onOpenCodeFolder(entry);
        };
        menu.appendChild(open); actions.appendChild(menu); more.setAttribute("aria-expanded", "true"); open.focus();
      });
      actions.appendChild(more);
    }
    wrap.appendChild(actions);
    if (open) {
      const kids = document.createElement("div");
      kids.className = "ref-file-folder-children";
      for (const child of entry.children || []) {
        if (child?.virtual_folder) renderFolder(child, kids, depth + 1);
        else kids.appendChild(fileButton(child, { grid: view === "grid" && tab === "files" }));
      }
      wrap.appendChild(kids);
    }
    into.appendChild(wrap);
  }

  function render() {
    syncChrome();
    if (!body) return;
    const filteredTree = sortReferenceEntries(query ? filterBrowserEntriesByName(tree, query) : tree, sortDir);
    const filteredFlat = sortReferenceEntries(
      query ? flattenReferenceEntries(filteredTree) : flat,
      sortDir,
    );
    body.classList.toggle("ref-files-pane-body--grid", tab === "files" && view === "grid");
    body.classList.toggle("ref-files-pane-body--recent", tab === "recent");
    body.replaceChildren();
    if (tab === "recent") {
      if (!filteredFlat.length) {
        const empty = document.createElement("p");
        empty.className = "ref-files-empty muted small";
        empty.textContent = projectId ? "No recent files." : "Open a project to see recent files.";
        body.appendChild(empty);
        return;
      }
      const list = document.createElement("div");
      list.className = "ref-files-recent-list";
      for (const entry of filteredFlat) list.appendChild(fileButton(entry));
      body.appendChild(list);
      return;
    }
    if (!filteredTree.length) {
      const empty = document.createElement("p");
      empty.className = "ref-files-empty muted small";
      empty.textContent = projectId ? "No reference files yet." : "Open a project to see reference files.";
      body.appendChild(empty);
      return;
    }
    const host = document.createElement("div");
    host.className = view === "grid" ? "ref-files-grid" : "ref-files-list";
    for (const entry of filteredTree) {
      if (entry?.virtual_folder) renderFolder(entry, host);
      else host.appendChild(fileButton(entry, { grid: view === "grid" }));
    }
    body.appendChild(host);
  }

  function setHidden(next) {
    hidden = !!next;
    writeStore(REF_FILES_HIDDEN_KEY, hidden ? "1" : "0");
    root.dataset.userHidden = hidden ? "1" : "0";
    onHideFilesPane?.(hidden);
    render();
  }

  root.addEventListener("click", (e) => {
    const nextTab = e.target.closest("[data-ref-pane-tab]")?.dataset.refPaneTab;
    if (nextTab && nextTab !== tab) {
      tab = nextTab === "recent" ? "recent" : "files";
      writeStore(REF_FILES_TAB_KEY, tab);
      render();
      return;
    }
    const nextView = e.target.closest("[data-ref-view]")?.dataset.refView;
    if (nextView && (nextView === "list" || nextView === "grid")) {
      view = nextView;
      writeStore(REF_FILES_VIEW_KEY, view);
      render();
      return;
    }
    if (e.target.closest("[data-ref-sort]")) {
      sortDir = sortDir === "newest" ? "oldest" : "newest";
      writeStore(REF_FILES_SORT_KEY, sortDir);
      render();
      return;
    }
    if (e.target.closest("#btn-sidebar-chrome-menu")) {
      e.stopPropagation();
      setMenuOpen(menu?.classList.contains("hidden"));
      return;
    }
    const chrome = e.target.closest("[data-sidebar-chrome]")?.dataset.sidebarChrome;
    if (chrome) {
      e.preventDefault();
      setMenuOpen(false);
      if (chrome === "notes") onReopenNotes?.();
      else if (chrome === "files") setHidden(!hidden);
      else if (chrome === "updates") onShowUpdates?.();
    }
  });

  search?.addEventListener("input", () => {
    query = search.value || "";
    render();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest?.(".sidebar-chrome-menu")) setMenuOpen(false);
    if (!e.target.closest?.(".ref-code-folder-actions")) root.querySelectorAll(".ref-code-folder-menu").forEach(menu => menu.remove());
  });
  document.addEventListener("render3d:reveal-reference-folder", (e) => {
    const folder = e.detail?.folder;
    if (folder) revealFolder(folder);
  });

  function revealFolder(folderName) {
    const name = String(folderName || "").split("/")[0].trim();
    if (!name) return;
    for (const entry of tree) {
      if (!entry?.virtual_folder) continue;
      const label = String(entry.folder || entry.name || entry.label || "");
      if (label === name || label.startsWith(`${name}/`)) {
        collapsed.delete(folderKey(entry));
        collapsed.delete(String(entry.id || ""));
        collapsed.add(`open:${folderKey(entry)}`);
      }
    }
    writeJsonSet(REF_FILES_COLLAPSE_KEY, collapsed);
    render();
  }

  function setBrowser(browser = {}, opts = {}) {
    projectId = String(opts.projectId || getProjectId?.() || "");
    tree = buildReferenceFilesTree(collectSourceItems(browser));
    flat = sortReferenceEntriesNewestFirst(flattenReferenceEntries(tree));
    if (opts.folder) revealFolder(opts.folder);
    else render();
  }

  syncChrome();
  render();

  return {
    setBrowser,
    revealFolder,
    setHidden,
    isHidden: () => hidden,
    getTab: () => tab,
    getView: () => view,
    getRecent: () => flat.slice(),
    render,
  };
}
