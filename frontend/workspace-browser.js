/** Workspace folders + drag-and-drop project organization. */

import { recognizePart } from "./part-catalog.js?v=20260715-elec-none";
import { setExplorerDragData } from "./explorer-drag.js?v=20260618-multi-drag";
import { createProjectShareDialog } from "./project-share.js?v=20260723-proj-share";

const FOLDER_COLLAPSE_KEY = "render3d:folder-collapsed";
const PROJECT_EXPAND_KEY = "render3d:project-expanded";
const PROJECT_SEARCH_KEY = "render3d:project-search";
const FOLDER_SHOW_ALL_KEY = "render3d:folder-show-all";
const HIERARCHY_SHOW_ALL_KEY = "render3d:hierarchy-show-all";
const COMPACT_LIST_LIMIT = 5;

let projectSearchQuery = "";
try {
  projectSearchQuery = sessionStorage.getItem(PROJECT_SEARCH_KEY) || "";
} catch (_) {}

function loadIdSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

function saveIdSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

function hierarchyItemCount(project) {
  const browser = project.browser || {};
  return (
    (browser.components?.length || 0) +
    (browser.drawings?.length || 0) +
    (browser.references?.length || 0) +
    (browser.sketches?.length || 0) +
    (browser.wiring?.length || 0)
  );
}

function formatCostUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function compactTokenCount(value) {
  const total = Number(value) || 0;
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(2)}M tokens`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k tokens`;
  return `${total.toLocaleString()} tokens`;
}

function projectProviderLabel(summary) {
  const provider = (summary?.provider || "").toLowerCase();
  if (provider === "deterministic") return "Deterministic";
  if (provider === "anthropic") return "Claude";
  if (provider === "openai") return "OpenAI";
  // Infer from model name if provider field missing
  const model = (summary?.model || "").toLowerCase();
  if (model.includes("claude") || model.includes("anthropic")) return "Claude";
  if (model.includes("gpt") || model.includes("o1") || model.includes("o3")) return "OpenAI";
  return "AI";
}

function projectPromptCostMeta(p) {
  const summary = p?.usage_summary;
  if (!summary) return "";
  const tracked = summary.tracked_count ?? 0;
  if (!tracked) return "";
  // Use cost_usd (total, all providers) — openai_cost_usd is 0 when using Claude
  const totalCost = summary.cost_usd ?? 0;
  const cost = formatCostUsd(totalCost) ?? (tracked ? "$0.00" : null);
  if (!cost) return "";
  const label = projectProviderLabel(summary);
  const untracked = summary.untracked_count ?? 0;
  const suffix = untracked > 0 ? "+" : "";
  const tokens = summary.usage?.total_tokens ?? 0;
  const tokenLabel = tokens ? ` · ${compactTokenCount(tokens)}` : "";
  return ` · ${cost} ${label}${suffix}${tokenLabel} · ${tracked} prompt${tracked !== 1 ? "s" : ""}`;
}

function hierarchyDisplayName(entry) {
  if (entry?.format === "body" || entry?.virtual_body) {
    const label = String(entry.label || entry.body_name || "").trim();
    if (label) {
      const short = label.includes("|") ? label.split("|", 1)[0].trim() : label;
      return short || label;
    }
  }
  if (entry.format === "program") {
    return entry.stem || entry.name.replace(/\.program\.json$/i, "");
  }
  if (entry.format === "wiring") return entry.name;
  if (entry.label) return entry.label;
  return entry.stem || entry.name.replace(/\.[^.]+$/, "");
}

function normalizeProjectSearch(query) {
  return String(query || "").trim().toLowerCase();
}

function projectSearchHaystack(project, folderName = "") {
  const parts = [
    project?.name,
    project?.id,
    folderName,
    project?.usage_summary?.provider,
    project?.usage_summary?.model,
  ];
  const browser = project?.browser || {};
  for (const list of [browser.components, browser.drawings, browser.references, browser.sketches, browser.wiring]) {
    for (const entry of list || []) {
      parts.push(entry?.name, entry?.stem, hierarchyDisplayName(entry));
    }
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function matchesProjectSearch(project, query, folderName = "") {
  const q = normalizeProjectSearch(query);
  if (!q) return true;
  return projectSearchHaystack(project, folderName).includes(q);
}

function hierarchyEyeSvg(hidden) {
  return hidden
    ? `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M2 2l12 12M6.3 6.3A2.7 2.7 0 0 0 8 10.7c.7 0 1.3-.2 1.8-.7M4.8 4.1C2.9 4.9 1.3 6.4.3 8c1.7 2.6 4.5 5 7.7 5 1.2 0 2.3-.3 3.3-.8M7.4 3.1 8 3c3.5 0 6.3 2.4 8 5-.4.7-.9 1.3-1.5 1.9"/>
  </svg>`
    : `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M1.2 8s2.4-4.5 6.8-4.5S14.8 8 14.8 8s-2.4 4.5-6.8 4.5S1.2 8 1.2 8z"/>
    <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.35"/>
  </svg>`;
}

export function createWorkspaceBrowser({
  container,
  api,
  getWorkspaceId,
  getFolderTeamId = getWorkspaceId,
  getWorkspaceMeta = () => ({}),
  getProjects,
  getActiveProjectId,
  getCurrentUserId = () => null,
  isProjectLoading,
  isProjectGenerating,
  isProjectNew,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onExportProject,
  onMakePublicProject,
  onCreateProjectInFolder,
  onOpenHierarchyItem,
  onSendReferenceToPrompt,
  canDeleteProject,
  onEditHierarchyItem,
  onOpenProfile,
  onRenameHierarchyItem,
  onDeleteHierarchyItem,
  onExportHierarchyItem,
  onAttachWiringComponent,
  onToggleHierarchyVisibility,
  isHierarchyItemHidden,
  onDragComponent,
  getPartProfile,
}) {
  let folders = [];
  let dragProjectId = null;
  let dropBeforeProjectId = null;
  let dropAtEnd = false;
  let contextMenu = null;
  let shareModalEl = null;
  let renameModalEl = null;
  let shareModalFolder = null;
  const projectShareDialog = createProjectShareDialog({
    api,
    getWorkspaceId,
    onChanged: () => {
      document.dispatchEvent(new CustomEvent("workspace-projects-changed"));
      void refreshFolders();
      render();
    },
  });
  let collapsedFolders = loadIdSet(FOLDER_COLLAPSE_KEY);
  let showAllFolders = loadIdSet(FOLDER_SHOW_ALL_KEY);
  let showAllHierarchySections = loadIdSet(HIERARCHY_SHOW_ALL_KEY);
  let expandedProjects = loadIdSet(PROJECT_EXPAND_KEY);
  const forceCollapsedProjects = new Set();
  const expandedSections = new Map();
  const expandedHierarchyBodies = new Set();
  const selectedHierarchyKeys = new Set();
  /** @type {Map<string, { project: object, sectionId: string, entry: object }>} */
  const hierarchyEntryCache = new Map();
  let suppressHierarchyClick = false;

  function resolveTeamId() {
    const folderTeamId = getFolderTeamId?.();
    if (folderTeamId) return folderTeamId;
    return getWorkspaceId?.() || null;
  }

  function clearHierarchyClickSuppress() {
    window.setTimeout(() => {
      suppressHierarchyClick = false;
    }, 0);
  }

  const ICON_SHARE = `<svg class="icon-share" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11 9.5a2.5 2.5 0 1 0-.9-1.9L8.5 5.6V5a2.5 2.5 0 1 0-1 0v.6L5.9 7.6a2.5 2.5 0 1 0 .9 1.9l2.6-1.6V11a2.5 2.5 0 1 0 1 0V7.9l2.6 1.6zM5 4.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm6 7a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zM3 11a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"/></svg>`;
  const ICON_PENCIL = `<svg class="icon-pencil" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11.5 2.5a1.5 1.5 0 0 1 2.12 2.12L5.62 12.62 2 13.5l.88-3.62L11.5 2.5z"/></svg>`;
  const ICON_PLUS = `<svg class="icon-plus" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7.25 2.75a.75.75 0 0 1 1.5 0V7.25h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5V2.75z"/></svg>`;
  const ICON_EDIT_FOLDER = `<svg class="icon-edit-folder" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 3.75A1.75 1.75 0 0 1 3.75 2h3.1L8.2 3.5h4.05A1.75 1.75 0 0 1 14 5.25v6A1.75 1.75 0 0 1 12.25 13h-8.5A1.75 1.75 0 0 1 2 11.25v-7.5zm8.22 2.03a.75.75 0 0 0-1.06 1.06l.72.72-1.9 1.9-.22.9.9-.22 1.9-1.9.72.72a.75.75 0 1 0 1.06-1.06l-.72-.72.72-.72z"/></svg>`;
  let editFolderModalEl = null;

  function closeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
    moveSubmenuEl?.remove();
    moveSubmenuEl = null;
  }

  let moveSubmenuEl = null;

  function projectFromContextTarget(target) {
    const row = target?.closest?.(".proj-item[data-project-id]");
    const projectId = row?.dataset?.projectId || "";
    if (!projectId) return null;
    return (getProjects?.() || []).find((project) => project.id === projectId) || null;
  }

  function effectiveProjectFolderId(project) {
    const folderIds = new Set(folders.map((f) => f.id));
    const fid = project?.folder_id || null;
    return fid && folderIds.has(fid) ? fid : null;
  }

  function folderListKey(folderId) {
    return folderId || "__root__";
  }

  function rootFolderLabel() {
    const meta = getWorkspaceMeta?.(resolveTeamId()) || {};
    return meta.rootLabel || "Personal files";
  }

  function isCommunityFolder(folder) {
    if (!folder) return false;
    const id = folder.id;
    return (
      folder.public === true
      || id === "__public__"
      || id === "__other_user_renders__"
    );
  }

  function appendFolderGroupLabel(parent, label, { breakBefore = false } = {}) {
    const el = document.createElement("div");
    el.className = breakBefore ? "folder-group-label folder-group-label--break" : "folder-group-label";
    el.setAttribute("role", "presentation");
    el.textContent = label;
    parent.appendChild(el);
  }

  function hierarchyListKey(projectId, sectionId) {
    return `${projectId}:${sectionId}`;
  }

  function visibleSlice(items, key, set, forceAll = false) {
    const list = items || [];
    if (forceAll || set.has(key) || list.length <= COMPACT_LIST_LIMIT) return list;
    return list.slice(0, COMPACT_LIST_LIMIT);
  }

  function buildShowMoreControl({ total, shown, expanded, label, onToggle }) {
    if (total <= COMPACT_LIST_LIMIT) return null;
    const li = document.createElement("li");
    li.className = "browser-show-more-row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "browser-show-more-btn";
    btn.textContent = expanded
      ? `Show less ${label}`
      : `Show ${total - shown} more ${label}`;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onToggle?.();
    });
    li.appendChild(btn);
    return li;
  }

  function clearDropIndicators() {
    dropBeforeProjectId = null;
    dropAtEnd = false;
    container?.querySelectorAll(".drop-target-active, .drop-before, .drop-after").forEach((el) => {
      el.classList.remove("drop-target-active", "drop-before", "drop-after");
    });
  }

  function projectActivityRank(p) {
    // Lower = higher in the list. Live generations and brand-new work float to the top
    // so teammates (Aaron generating McDonalds, etc.) are obvious in a shared workspace.
    if (isProjectGenerating?.(p?.id) || ["running", "queued", "starting", "pending"].includes(p?.generation?.status)) {
      return 0;
    }
    if (isProjectNew?.(p?.id)) return 1;
    const stamp = Date.parse(p?.updated_at || p?.created_at || "") || 0;
    if (stamp && Date.now() - stamp < 30 * 60 * 1000) return 2; // last 30 minutes
    return 3;
  }

  function sortProjectsForDisplay(list) {
    return [...list].sort((a, b) => {
      const ar = projectActivityRank(a);
      const br = projectActivityRank(b);
      if (ar !== br) return ar - br;
      if (ar < 3) {
        // Within live/new/recent: newest first
        return String(b?.updated_at || b?.created_at || "").localeCompare(String(a?.updated_at || a?.created_at || ""));
      }
      const ao = Number(a?.sort_order ?? 0);
      const bo = Number(b?.sort_order ?? 0);
      if (ao !== bo) return ao - bo;
      return String(b?.updated_at || b?.created_at || "").localeCompare(String(a?.updated_at || a?.created_at || ""));
    });
  }

  function applyLocalFolderOrder(projectId, folderId, { beforeProjectId = null, atEnd = false } = {}) {
    const projects = getProjects();
    const moved = projects.find((p) => p.id === projectId);
    if (!moved) return;
    moved.folder_id = folderId || null;
    const siblings = sortProjectsForDisplay(
      projects.filter((p) => p.id !== projectId && effectiveProjectFolderId(p) === (folderId || null))
    );
    let nextOrder;
    if (beforeProjectId) {
      const idx = siblings.findIndex((p) => p.id === beforeProjectId);
      nextOrder = idx >= 0 ? siblings.slice(0, idx).concat(moved, siblings.slice(idx)) : siblings.concat(moved);
    } else if (atEnd) {
      nextOrder = siblings.concat(moved);
    } else {
      nextOrder = [moved, ...siblings];
    }
    nextOrder.forEach((p, index) => {
      p.sort_order = index;
      p.folder_id = folderId || null;
    });
  }

  async function moveProjectToFolder(projectId, folderId, { beforeProjectId = null, atEnd = false } = {}) {
    const projects = getProjects();
    const proj = projects.find((x) => x.id === projectId);
    if (proj?.read_only_project) return;
    const targetFolder = folderId || null;
    const sameFolder = proj && effectiveProjectFolderId(proj) === targetFolder;
    const isReorder = !!(beforeProjectId || atEnd);
    if (sameFolder && !isReorder) return;
    try {
      const data = await api(`/api/projects/${projectId}/folder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_id: targetFolder,
          before_project_id: beforeProjectId || null,
          at_end: !!atEnd,
        }),
      });
      applyLocalFolderOrder(projectId, targetFolder, { beforeProjectId, atEnd });
      if (proj && data?.sort_order != null) proj.sort_order = data.sort_order;
      render();
      // Same-folder reorder: keep local order. A full project refetch can race and
      // briefly restore the previous sort before the DB read sees the new values.
      if (!sameFolder || !isReorder) {
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      }
    } catch (err) {
      alert(err.message || "Could not move project");
    }
  }

  function openMoveProjectSubmenu(anchorBtn, project) {
    if (project?.read_only_project) return;
    moveSubmenuEl?.remove();
    moveSubmenuEl = null;
    const submenu = document.createElement("div");
    submenu.className = "folder-context-submenu";
    submenu.setAttribute("role", "menu");
    const currentFolderId = effectiveProjectFolderId(project);
    const targets = [
      { id: null, label: rootFolderLabel(), icon: "📁" },
      ...folders
        .filter((f) => !(f.virtual || f.read_only || f.public))
        .map((f) => ({ id: f.id, label: f.name, icon: "📂" })),
    ];

    for (const target of targets) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      const isCurrent = (target.id || null) === currentFolderId;
      btn.textContent = isCurrent ? `${target.icon} ${target.label} (current)` : `${target.icon} ${target.label}`;
      btn.disabled = isCurrent;
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        closeContextMenu();
        await moveProjectToFolder(project.id, target.id);
      });
      submenu.appendChild(btn);
    }

    document.body.appendChild(submenu);
    moveSubmenuEl = submenu;
    const anchorRect = anchorBtn.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    let left = anchorRect.right + 4;
    let top = anchorRect.top;
    if (left + submenuRect.width > window.innerWidth - 8) {
      left = Math.max(8, anchorRect.left - submenuRect.width - 4);
    }
    top = Math.min(top, window.innerHeight - submenuRect.height - 8);
    submenu.style.left = `${Math.max(8, left)}px`;
    submenu.style.top = `${Math.max(8, top)}px`;
  }

  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0) return;
      if (contextMenu?.contains(e.target)) return;
      if (moveSubmenuEl?.contains(e.target)) return;
      closeContextMenu();
    },
    true
  );
  document.addEventListener("scroll", closeContextMenu, true);
  window.addEventListener("resize", closeContextMenu);

  function ensureShareModal() {
    if (shareModalEl) return shareModalEl;
    shareModalEl = document.createElement("div");
    shareModalEl.className = "auth-modal hidden";
    shareModalEl.id = "folder-share-modal";
    shareModalEl.setAttribute("role", "dialog");
    shareModalEl.setAttribute("aria-modal", "true");
    shareModalEl.innerHTML = `
      <div class="auth-backdrop" data-share-close></div>
      <div class="auth-card app-dialog-card">
        <button type="button" class="auth-close" data-share-close aria-label="Close">&times;</button>
        <h2 class="app-dialog-title" id="folder-share-title">Share folder</h2>
        <p class="muted small folder-share-hint">Pick a team member or type an email. They must have an account (or will get a workspace invite).</p>
        <ul class="folder-share-list" id="folder-share-list"></ul>
        <label class="app-dialog-label">Team member
          <select id="folder-share-member" class="folder-share-member-select">
            <option value="">Loading workspace members…</option>
          </select>
        </label>
        <label class="app-dialog-label">Email <span class="muted small">(optional if you picked a member)</span>
          <input type="email" id="folder-share-email" placeholder="coworker@company.com" autocomplete="email" />
        </label>
        <label class="folder-share-restrict">
          <input type="checkbox" id="folder-share-restrict" checked />
          <span>Private — only you and people you share with can see this folder</span>
        </label>
        <p id="folder-share-status" class="muted small"></p>
        <div class="app-dialog-actions">
          <button type="button" class="btn secondary" data-share-close>Close</button>
          <button type="button" class="btn accent" id="folder-share-submit">Share</button>
        </div>
      </div>
    `;
    document.body.appendChild(shareModalEl);
    shareModalEl.querySelectorAll("[data-share-close]").forEach((el) => {
      el.addEventListener("click", closeShareModal);
    });
    shareModalEl.querySelector("#folder-share-submit")?.addEventListener("click", () => {
      submitShareModal();
    });
    shareModalEl.querySelector("#folder-share-member")?.addEventListener("change", (e) => {
      const email = String(e.target.value || "").trim();
      const emailInput = shareModalEl?.querySelector("#folder-share-email");
      const status = shareModalEl?.querySelector("#folder-share-status");
      if (emailInput) emailInput.value = email;
      if (status) status.textContent = email ? `Ready to share with ${email}` : "";
    });
    shareModalEl.querySelector("#folder-share-email")?.addEventListener("input", () => {
      const status = shareModalEl?.querySelector("#folder-share-status");
      if (status && status.textContent === "Enter an email address.") status.textContent = "";
    });
    shareModalEl.querySelector("#folder-share-email")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitShareModal();
      }
    });
    return shareModalEl;
  }

  async function loadMemberOptions(existingShares = []) {
    const teamId = getWorkspaceId();
    const select = shareModalEl?.querySelector("#folder-share-member");
    if (!select || !teamId) return;
    select.innerHTML = `<option value="">Loading workspace members…</option>`;
    try {
      const data = await api(`/api/teams/${teamId}/members`);
      const sharedEmails = new Set(
        existingShares
          .map((s) => String(s.email || "").toLowerCase())
          .filter(Boolean)
      );
      const ownerId = shareModalFolder?.created_by;
      const members = (data.members || []).filter(
        (m) => m.id !== ownerId && !sharedEmails.has(String(m.email || "").toLowerCase())
      );
      select.innerHTML = "";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Type a new email…";
      select.appendChild(blank);
      for (const member of members) {
        const opt = document.createElement("option");
        opt.value = member.email;
        opt.textContent = `${member.display_name || member.email} (${member.email})`;
        select.appendChild(opt);
      }
      if (!members.length) {
        blank.textContent = "No unshared team members — type a new email…";
      }
    } catch {
      select.innerHTML = `<option value="">Could not load members — type a new email…</option>`;
    }
  }

  function closeShareModal() {
    shareModalEl?.classList.add("hidden");
    shareModalFolder = null;
  }

  async function loadShareList(folder) {
    const teamId = getWorkspaceId();
    const listEl = shareModalEl?.querySelector("#folder-share-list");
    if (!listEl || !teamId) return [];
    listEl.innerHTML = `<li class="muted small">Loading…</li>`;
    let shares = [];
    try {
      const data = await api(`/api/teams/${teamId}/folders/${folder.id}/shares`);
      shares = data.shares || [];
    } catch {
      listEl.innerHTML = `<li class="muted small">Could not load shares.</li>`;
      return [];
    }
    if (!shares.length) {
      listEl.innerHTML = `<li class="muted small folder-share-empty">Not shared with anyone yet.</li>`;
      return shares;
    }
    listEl.innerHTML = "";
    for (const s of shares) {
      const li = document.createElement("li");
      li.className = "folder-share-item";
      if (s.pending) {
        li.innerHTML = `<span>⏳ ${escapeHtml(s.email)} <span class="muted small">(pending)</span></span>`;
      } else {
        li.innerHTML = `<span><strong>${escapeHtml(s.display_name || s.email)}</strong> <span class="muted small">${escapeHtml(s.email)}</span></span>`;
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "btn-icon btn-share-remove";
        rm.title = "Remove access";
        rm.textContent = "×";
        rm.addEventListener("click", async () => {
          if (!window.confirm(`Remove ${s.display_name || s.email} from this folder?`)) return;
          try {
            await api(`/api/teams/${teamId}/folders/${folder.id}/shares/${s.user_id}`, {
              method: "DELETE",
            });
            await loadShareList(folder);
            await refreshFolders();
            render();
            document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
          } catch (err) {
            alert(err.message || "Could not remove share");
          }
        });
        li.appendChild(rm);
      }
      listEl.appendChild(li);
    }
    return shares;
  }

  async function submitShareModal() {
    const folder = shareModalFolder;
    const teamId = getWorkspaceId();
    const status = shareModalEl?.querySelector("#folder-share-status");
    const emailInput = shareModalEl?.querySelector("#folder-share-email");
    const memberSelect = shareModalEl?.querySelector("#folder-share-member");
    const restrict = shareModalEl?.querySelector("#folder-share-restrict");
    if (!folder || !teamId) return;
    // Typed email wins if present; otherwise use the selected team member.
    const email = String(emailInput?.value || memberSelect?.value || "").trim();
    if (!email) {
      if (status) status.textContent = "Pick a team member or enter an email address.";
      memberSelect?.focus();
      return;
    }
    if (status) status.textContent = "Sharing…";
    try {
      const res = await api(`/api/teams/${teamId}/folders/${folder.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          restrict_access: restrict?.checked ?? true,
        }),
      });
      if (status) status.textContent = res.message || "Folder shared.";
      if (emailInput) emailInput.value = "";
      if (memberSelect) memberSelect.value = "";
      const shares = await loadShareList(folder);
      await loadMemberOptions(shares);
      await refreshFolders();
      render();
      document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
    } catch (err) {
      if (status) status.textContent = err.message || "Could not share folder";
    }
  }

  async function openShareDialog(folder) {
    const teamId = getWorkspaceId();
    if (!teamId) return;
    shareModalFolder = folder;
    const modal = ensureShareModal();
    modal.querySelector("#folder-share-title").textContent = `Share “${folder.name}”`;
    modal.querySelector("#folder-share-email").value = "";
    modal.querySelector("#folder-share-member").innerHTML = `<option value="">Loading workspace members…</option>`;
    modal.querySelector("#folder-share-status").textContent = "";
    modal.querySelector("#folder-share-restrict").checked =
      folder.visibility !== "workspace";
    modal.classList.remove("hidden");
    const shares = await loadShareList(folder);
    await loadMemberOptions(shares);
    modal.querySelector("#folder-share-member")?.focus();
  }

  function ensureRenameModal() {
    if (renameModalEl) return renameModalEl;
    renameModalEl = document.createElement("div");
    renameModalEl.className = "auth-modal hidden";
    renameModalEl.setAttribute("role", "dialog");
    renameModalEl.setAttribute("aria-modal", "true");
    renameModalEl.innerHTML = `
      <div class="auth-backdrop" data-rename-close></div>
      <div class="auth-card app-dialog-card">
        <button type="button" class="auth-close" data-rename-close aria-label="Close">&times;</button>
        <h2 class="app-dialog-title">Rename folder</h2>
        <label class="app-dialog-label">Folder name
          <input type="text" id="folder-rename-input" maxlength="120" />
        </label>
        <p id="folder-rename-error" class="auth-error hidden"></p>
        <div class="app-dialog-actions">
          <button type="button" class="btn secondary" data-rename-close>Cancel</button>
          <button type="button" class="btn accent" id="folder-rename-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(renameModalEl);
    let renameTarget = null;
    renameModalEl.querySelectorAll("[data-rename-close]").forEach((el) => {
      el.addEventListener("click", () => {
        renameModalEl.classList.add("hidden");
        renameTarget = null;
      });
    });
    renameModalEl.querySelector("#folder-rename-save")?.addEventListener("click", async () => {
      const folder = renameTarget;
      const teamId = getWorkspaceId();
      const input = renameModalEl.querySelector("#folder-rename-input");
      const errEl = renameModalEl.querySelector("#folder-rename-error");
      const next = input?.value?.trim();
      if (!folder || !teamId || !next || next === folder.name) {
        renameModalEl.classList.add("hidden");
        return;
      }
      errEl.classList.add("hidden");
      try {
        await api(`/api/teams/${teamId}/folders/${folder.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: next }),
        });
        renameModalEl.classList.add("hidden");
        renameTarget = null;
        await refreshFolders();
        render();
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      } catch (err) {
        errEl.textContent = err.message || "Could not rename folder";
        errEl.classList.remove("hidden");
      }
    });
    renameModalEl.openFor = (folder) => {
      renameTarget = folder;
      renameModalEl.querySelector("#folder-rename-input").value = folder.name;
      renameModalEl.querySelector("#folder-rename-error").classList.add("hidden");
      renameModalEl.classList.remove("hidden");
      renameModalEl.querySelector("#folder-rename-input")?.focus();
      renameModalEl.querySelector("#folder-rename-input")?.select();
    };
    return renameModalEl;
  }

  function openRenameDialog(folder) {
    ensureRenameModal().openFor(folder);
  }

  async function renameProjectInline(project, nextName) {
    const trimmed = String(nextName || "").trim();
    if (!project?.id || !trimmed || trimmed === (project.name || project.id)) return false;
    try {
      const data = await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const projects = getProjects();
      const local = projects.find((p) => p.id === project.id);
      if (local) local.name = data?.name || trimmed;
      project.name = data?.name || trimmed;
      document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      return true;
    } catch (err) {
      alert(err.message || "Could not rename project");
      return false;
    }
  }

  function ensureEditFolderModal() {
    if (editFolderModalEl) return editFolderModalEl;
    editFolderModalEl = document.createElement("div");
    editFolderModalEl.className = "auth-modal hidden";
    editFolderModalEl.id = "folder-edit-modal";
    editFolderModalEl.setAttribute("role", "dialog");
    editFolderModalEl.setAttribute("aria-modal", "true");
    editFolderModalEl.innerHTML = `
      <div class="auth-backdrop" data-edit-folder-close></div>
      <div class="auth-card app-dialog-card folder-edit-card">
        <button type="button" class="auth-close" data-edit-folder-close aria-label="Close">&times;</button>
        <h2 class="app-dialog-title" id="folder-edit-title">Edit folder</h2>
        <p class="muted small folder-edit-hint">Rename this folder and manage the projects inside it.</p>
        <label class="app-dialog-label">Folder name
          <input type="text" id="folder-edit-name" maxlength="120" />
        </label>
        <div class="folder-edit-projects-head">
          <strong>Projects in this folder</strong>
          <span class="muted small" id="folder-edit-count"></span>
        </div>
        <ul class="folder-edit-project-list" id="folder-edit-project-list"></ul>
        <p id="folder-edit-status" class="muted small"></p>
        <p id="folder-edit-error" class="auth-error hidden"></p>
        <div class="app-dialog-actions">
          <button type="button" class="btn secondary" data-edit-folder-close>Cancel</button>
          <button type="button" class="btn accent" id="folder-edit-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(editFolderModalEl);
    let editTarget = null;

    const close = () => {
      editFolderModalEl.classList.add("hidden");
      editTarget = null;
    };

    editFolderModalEl.querySelectorAll("[data-edit-folder-close]").forEach((el) => {
      el.addEventListener("click", close);
    });

    editFolderModalEl.querySelector("#folder-edit-save")?.addEventListener("click", async () => {
      const folder = editTarget;
      const teamId = getWorkspaceId();
      const input = editFolderModalEl.querySelector("#folder-edit-name");
      const errEl = editFolderModalEl.querySelector("#folder-edit-error");
      const statusEl = editFolderModalEl.querySelector("#folder-edit-status");
      const listEl = editFolderModalEl.querySelector("#folder-edit-project-list");
      const next = input?.value?.trim();
      if (!folder || !teamId) {
        close();
        return;
      }
      errEl?.classList.add("hidden");
      if (!next) {
        if (errEl) {
          errEl.textContent = "Folder name is required";
          errEl.classList.remove("hidden");
        }
        return;
      }

      const folderNameChanged = next !== folder.name;
      const projectRenames = [];
      const rows = [...(listEl?.querySelectorAll(".folder-edit-project-row") || [])];
      for (const row of rows) {
        const projectId = row.getAttribute("data-project-id");
        const project = projectsInFolder(folder.id).find((p) => p.id === projectId)
          || getProjects().find((p) => p.id === projectId);
        if (!project) continue;
        const nameInput = row.querySelector(".folder-edit-project-name");
        const trimmed = String(nameInput?.value || "").trim();
        if (!trimmed) {
          if (errEl) {
            errEl.textContent = "Project name is required";
            errEl.classList.remove("hidden");
          }
          nameInput?.focus();
          return;
        }
        if (trimmed !== (project.name || project.id)) {
          projectRenames.push({ project, nextName: trimmed });
        }
      }

      if (!folderNameChanged && !projectRenames.length) {
        close();
        render();
        return;
      }

      try {
        if (statusEl) statusEl.textContent = "Saving…";
        if (folderNameChanged) {
          await api(`/api/teams/${teamId}/folders/${folder.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: next }),
          });
          folder.name = next;
        }
        for (const { project, nextName } of projectRenames) {
          const ok = await renameProjectInline(project, nextName);
          if (!ok) {
            if (statusEl) statusEl.textContent = "";
            return;
          }
        }
        close();
        await refreshFolders();
        render();
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      } catch (err) {
        if (statusEl) statusEl.textContent = "";
        if (errEl) {
          errEl.textContent = err.message || "Could not save changes";
          errEl.classList.remove("hidden");
        }
      }
    });

    function renderProjectRows(folder) {
      const listEl = editFolderModalEl.querySelector("#folder-edit-project-list");
      const countEl = editFolderModalEl.querySelector("#folder-edit-count");
      const projects = projectsInFolder(folder.id);
      if (countEl) countEl.textContent = `${projects.length}`;
      if (!listEl) return;
      if (!projects.length) {
        listEl.innerHTML = `<li class="folder-edit-empty muted small">No projects in this folder yet.</li>`;
        return;
      }
      listEl.innerHTML = projects
        .map(
          (p) => `
        <li class="folder-edit-project-row" data-project-id="${escapeHtml(p.id)}">
          <input type="text" class="folder-edit-project-name" value="${escapeHtml(p.name || p.id)}" maxlength="120" aria-label="Project name" />
          <div class="folder-edit-project-actions">
            <button type="button" class="btn secondary btn-compact" data-edit-remove title="Remove from folder">Remove</button>
          </div>
        </li>`
        )
        .join("");

      listEl.querySelectorAll(".folder-edit-project-row").forEach((row) => {
        const projectId = row.getAttribute("data-project-id");
        const project = projects.find((p) => p.id === projectId);
        if (!project) return;
        const nameInput = row.querySelector(".folder-edit-project-name");
        nameInput?.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          editFolderModalEl.querySelector("#folder-edit-save")?.click();
        });
        row.querySelector("[data-edit-remove]")?.addEventListener("click", async () => {
          if (!window.confirm(`Remove “${project.name || project.id}” from this folder?\n\nIt will move to ${rootFolderLabel()}.`)) return;
          await moveProjectToFolder(project.id, null);
          renderProjectRows(folder);
        });
      });
    }

    editFolderModalEl.openFor = (folder) => {
      editTarget = folder;
      editFolderModalEl.querySelector("#folder-edit-title").textContent = `Edit “${folder.name}”`;
      editFolderModalEl.querySelector("#folder-edit-name").value = folder.name;
      editFolderModalEl.querySelector("#folder-edit-error")?.classList.add("hidden");
      const statusEl = editFolderModalEl.querySelector("#folder-edit-status");
      if (statusEl) statusEl.textContent = "";
      renderProjectRows(folder);
      editFolderModalEl.classList.remove("hidden");
      editFolderModalEl.querySelector("#folder-edit-name")?.focus();
      editFolderModalEl.querySelector("#folder-edit-name")?.select();
    };
    return editFolderModalEl;
  }

  function openEditFolderDialog(folder) {
    ensureEditFolderModal().openFor(folder);
  }

  async function createProjectInFolder(folder) {
    if (!folder?.id) return;
    try {
      if (typeof onCreateProjectInFolder === "function") {
        await onCreateProjectInFolder(folder.id);
      } else {
        const teamId = resolveTeamId();
        if (!teamId) throw new Error("Could not find a workspace for the new project.");
        const { project_id } = await api(`/api/projects?team_id=${encodeURIComponent(teamId)}`, {
          method: "POST",
        });
        await api(`/api/projects/${project_id}/folder`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_id: folder.id }),
        });
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      }
      // Keep folder open so the new project is visible
      collapsedFolders.delete(folderStorageId(folder.id));
      saveIdSet(FOLDER_COLLAPSE_KEY, collapsedFolders);
      await refreshFolders();
      render();
    } catch (err) {
      alert(err.message || "Could not create project in folder");
    }
  }

  function projectsInFolder(folderId) {
    const projects = getProjects();
    const folderIds = new Set(folders.map((f) => f.id));
    const list = folderId == null
      ? projects.filter((p) => !p.folder_id || !folderIds.has(p.folder_id))
      : projects.filter((p) => p.folder_id === folderId);
    return sortProjectsForDisplay(list);
  }

  function folderHasExpandedProjects(folderId) {
    return projectsInFolder(folderId).some((p) => {
      if (isProjectExpanded(p.id)) return true;
      return ["components", "references", "sketches", "wiring"].some((sectionId) => sectionExpanded(p.id, sectionId));
    });
  }

  function collapseAllProjectsInFolder(folderId) {
    let changed = false;
    for (const p of projectsInFolder(folderId)) {
      if (!forceCollapsedProjects.has(p.id)) {
        forceCollapsedProjects.add(p.id);
        changed = true;
      }
      if (expandedProjects.has(p.id)) {
        expandedProjects.delete(p.id);
        changed = true;
      }
      for (const sectionId of ["components", "references", "sketches", "wiring"]) {
        const key = `${p.id}:${sectionId}`;
        if (!expandedSections.has(key) || expandedSections.get(key) !== false) {
          expandedSections.set(key, false);
          changed = true;
        }
      }
    }
    if (changed) {
      saveIdSet(PROJECT_EXPAND_KEY, expandedProjects);
      render();
    }
  }

  function showFolderContextMenu(e, folder) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    closeContextMenu();
    const folderId = folder?.id ?? null;
    const canManage = folder && (folder.can_manage || folder.is_owner);
    const inFolder = projectsInFolder(folderId);
    const canCollapseAll = inFolder.length > 0 && folderHasExpandedProjects(folderId);

    let html = "";
    if (inFolder.length) {
      html += `<button type="button" data-action="collapse-all"${canCollapseAll ? "" : " disabled"}>Collapse all projects</button>`;
      if (canManage) html += `<hr />`;
    }
    if (canManage) {
      html += `
      <button type="button" data-action="new-project">New project in this folder</button>
      <button type="button" data-action="edit">Edit folder…</button>
      <hr />
      <button type="button" data-action="share">Share folder…</button>
      <button type="button" data-action="rename">Rename folder…</button>
      <button type="button" data-action="delete">Delete folder</button>
    `;
    }
    if (!html) return;

    const menu = document.createElement("div");
    menu.className = "folder-context-menu";
    menu.innerHTML = html;
    const x = e?.clientX ?? 0;
    const y = e?.clientY ?? 0;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    contextMenu = menu;

    menu.querySelector('[data-action="collapse-all"]')?.addEventListener("click", () => {
      closeContextMenu();
      collapseAllProjectsInFolder(folderId);
    });
    menu.querySelector('[data-action="new-project"]')?.addEventListener("click", () => {
      closeContextMenu();
      void createProjectInFolder(folder);
    });
    menu.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
      closeContextMenu();
      openEditFolderDialog(folder);
    });
    menu.querySelector('[data-action="share"]')?.addEventListener("click", () => {
      closeContextMenu();
      openShareDialog(folder);
    });
    menu.querySelector('[data-action="rename"]')?.addEventListener("click", () => {
      closeContextMenu();
      openRenameDialog(folder);
    });
    menu.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      closeContextMenu();
      if (!window.confirm(`Delete folder "${folder.name}"? Projects inside will move to ${rootFolderLabel()}.`)) return;
      const teamId = getWorkspaceId();
      try {
        await api(`/api/teams/${teamId}/folders/${folder.id}`, { method: "DELETE" });
        await refreshFolders();
        render();
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      } catch (err) {
        alert(err.message || "Could not delete folder");
      }
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hierarchyEntryKey(project, sectionId, entry) {
    if (sectionId === "components") {
      return entry?.id || entry?.stem || entry?.name?.replace(/\.[^.]+$/, "") || entry?.name || "";
    }
    return entry?.id || entry?.stem || entry?.filename || entry?.name || "";
  }

  function explorerIdToken(project, sectionId, entry) {
    const pid = project?.id || "";
    const key = hierarchyEntryKey(project, sectionId, entry);
    const kind =
      sectionId === "components"
        ? "component"
        : sectionId === "references"
          ? (/\.dxf$/i.test(String(entry?.name || "")) || entry?.format === "dxf" ? "dxf" : "reference")
          : sectionId === "sketches"
            ? "sketch"
            : sectionId === "wiring"
              ? "wiring"
              : sectionId;
    return `${kind}:${pid}:${key}`;
  }

  function projectExplorerId(project) {
    return `project:${project?.id || ""}`;
  }

  function shortExplorerIdLabel(token) {
    const parts = String(token || "").split(":");
    if (parts[0] === "project") return `#${parts[1] || ""}`;
    const key = parts.slice(2).join(":") || parts[parts.length - 1] || "";
    return key.length > 22 ? `#${key.slice(0, 10)}…${key.slice(-8)}` : `#${key}`;
  }

  async function copyExplorerId(text) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else window.prompt("Copy ID", text);
    } catch {
      window.prompt("Copy ID", text);
    }
  }

  function componentPayload(project, entry, { stem, stored, recognized, wiringType } = {}) {
    const safeStem = stem || entry.stem || entry.name.replace(/\.[^.]+$/, "");
    const safeStored = stored || getPartProfile?.(safeStem) || null;
    const safeRecognized = recognized || recognizePart(safeStem);
    const safeWiringType = wiringType || safeStored?.wiring_type || null;
    return {
      type: "component",
      projectId: project?.id || null,
      projectName: project?.name || project?.id || "Project",
      name: entry.name,
      filename: entry.name,
      stem: safeStem,
      format: entry.format,
      viewer_filename: entry.viewer_filename,
      label: safeStored?.label || hierarchyDisplayName(entry),
      wiringType: safeWiringType,
      part: safeStored
        ? { kind: safeStored.kind, label: safeStored.label, datasheet: safeStored.datasheet }
        : safeRecognized
        ? {
            kind: safeRecognized.kind,
            label: safeRecognized.label,
            partNumber: safeRecognized.partNumber,
            datasheet: safeRecognized.datasheet,
          }
        : null,
      profile: safeStored || null,
    };
  }

  function hierarchySelectionKey(project, sectionId, entry) {
    const id =
      sectionId === "sketches"
        ? (entry.filename || entry.name || entry.id || entry.stem)
        : (entry.name || entry.id || entry.stem);
    return `${project?.id || ""}:${sectionId}:${id}`;
  }

  function hierarchyPayload(project, sectionId, entry, extras = {}) {
    if (sectionId === "components") {
      return componentPayload(project, entry, extras);
    }
    const filename = entry.filename || entry.name;
    const stem = entry.stem || entry.id || String(filename || entry.name || sectionId).replace(/\.[^.]+$/, "");
    return {
      type:
        sectionId === "references"
          ? (/\.dxf$/i.test(String(filename || "")) || entry.format === "dxf" ? "dxf" : "reference")
          : sectionId === "sketches"
            ? "sketch"
            : "wiring",
      projectId: project?.id || null,
      projectName: project?.name || project?.id || "Project",
      name: entry.name,
      filename,
      stem,
      format: entry.format || sectionId,
      label: hierarchyDisplayName(entry),
    };
  }

  function selectedHierarchyPayloads(fallbackPayload) {
    const selected = [];
    for (const key of selectedHierarchyKeys) {
      const cached = hierarchyEntryCache.get(key);
      if (!cached) continue;
      const { project, sectionId, entry } = cached;
      const stem = entry.stem || entry.name?.replace(/\.[^.]+$/, "");
      const stored = sectionId === "components" ? (getPartProfile?.(stem) || null) : null;
      const recognized = sectionId === "components" ? recognizePart(stem) : null;
      const wiringType = stored?.wiring_type || null;
      selected.push(hierarchyPayload(project, sectionId, entry, { stem, stored, recognized, wiringType }));
    }
    if (!selected.length && fallbackPayload) return [fallbackPayload];
    return selected;
  }

  function setHierarchyDragData(e, payloads) {
    setExplorerDragData(e, payloads);
  }

  function showProjectContextMenu(e, project) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    closeContextMenu();
    const idToken = projectExplorerId(project);
    const readOnly = !!project?.read_only_project;
    const canDelete = !readOnly || !!canDeleteProject?.(project);
    const sharedWithMe = !!project?.shared_with_me;
    const me = getCurrentUserId?.();
    const canShare =
      !readOnly
      && !project?.public
      && !sharedWithMe
      && (!!me && (project?.owner_user_id === me || project?.created_by === me));
    const menu = document.createElement("div");
    menu.className = "folder-context-menu project-context-menu";
    menu.innerHTML = `
      <div class="component-context-title">
        <strong>${escapeHtml(project?.name || project?.id || "Project")}</strong>
        <span>${escapeHtml(idToken)}</span>
      </div>
      <button type="button" data-action="open">Open project</button>
      <button type="button" data-action="copy-id">Copy project ID</button>
      ${canShare ? `<button type="button" data-action="share">Share with teammate…</button>` : ""}
      ${sharedWithMe ? `<button type="button" data-action="leave-share">Remove from my folder</button>` : ""}
      ${readOnly || project?.public ? "" : `<button type="button" data-action="move">Move to…</button>`}
      ${readOnly || project?.public ? "" : `<button type="button" data-action="make-public">Make public</button>`}
      <button type="button" data-action="export">Export / share…</button>
      ${readOnly ? "" : `<button type="button" data-action="rename">Rename…</button>`}
      ${canDelete ? `<hr />
      <button type="button" data-action="delete">Delete project</button>` : ""}
    `;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(e.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(e.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    contextMenu = menu;

    menu.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest("button");
      const action = btn?.dataset?.action;
      if (!action) return;
      if (action === "move") {
        ev.stopPropagation();
        openMoveProjectSubmenu(btn, project);
        return;
      }
      closeContextMenu();
      if (action === "open") {
        onOpenProject?.(project.id);
      } else if (action === "copy-id") {
        await copyExplorerId(idToken);
      } else if (action === "share") {
        await projectShareDialog.open(project);
      } else if (action === "leave-share") {
        try {
          await projectShareDialog.leave(project);
        } catch (err) {
          alert(err.message || "Could not remove shared project");
        }
      } else if (action === "export") {
        onExportProject?.(project);
      } else if (action === "make-public") {
        onMakePublicProject?.(project);
      } else if (action === "rename") {
        onRenameProject?.(project);
      } else if (action === "delete") {
        onDeleteProject?.(project);
      }
    });
  }

  function showHierarchyItemContextMenu(e, project, entry, sectionId, payload = null) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    closeContextMenu();
    const idToken = explorerIdToken(project, sectionId, entry);
    const kindLabel =
      sectionId === "components"
        ? "component"
        : sectionId === "references"
          ? "reference file"
          : sectionId === "sketches"
            ? "sketch"
            : sectionId === "wiring"
              ? "wiring"
              : "item";
    const menu = document.createElement("div");
    menu.className = "folder-context-menu component-context-menu";
    menu.innerHTML = `
      <div class="component-context-title">
        <strong>${escapeHtml(hierarchyDisplayName(entry))}</strong>
        <span>${escapeHtml(idToken)}</span>
      </div>
      <button type="button" data-action="copy-id">Copy ${kindLabel} ID</button>
      <button type="button" data-action="open">Open / view</button>
      ${
        (sectionId === "references" || sectionId === "renders") &&
        !(entry.format === "dxf" || /\.dxf$/i.test(String(entry.name || "")))
          ? `<button type="button" data-action="send-ai">Send to AI prompt</button>`
          : ""
      }
    `;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(e.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(e.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    contextMenu = menu;

    menu.addEventListener("click", async (ev) => {
      const action = ev.target?.closest("button")?.dataset?.action;
      if (!action) return;
      closeContextMenu();
      if (action === "copy-id") {
        await copyExplorerId(idToken);
      } else if (action === "open") {
        onOpenHierarchyItem?.(project, entry, sectionId);
      } else if (action === "send-ai") {
        onSendReferenceToPrompt?.(project, entry);
      } else if (action === "attach" && payload) {
        onAttachWiringComponent?.(project, entry, payload);
      }
    });
  }

  function showComponentContextMenu(e, project, entry, payload) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    closeContextMenu();

    const token = `@${payload.stem}`;
    const idToken = explorerIdToken(project, "components", entry);
    const isHidden = entry.__hidden ?? !!isHierarchyItemHidden?.(project, entry, "components");
    const menu = document.createElement("div");
    menu.className = "folder-context-menu component-context-menu";
    menu.innerHTML = `
      <div class="component-context-title">
        <strong>${escapeHtml(hierarchyDisplayName(entry))}</strong>
        <span>${escapeHtml(idToken)}</span>
      </div>
      <button type="button" data-action="copy-id">Copy component ID</button>
      <button type="button" data-action="open">Open / view</button>
      <button type="button" data-action="attach">Attach to Wiring Simulator</button>
      <button type="button" data-action="profile">Profile / source</button>
      <button type="button" data-action="visibility">${isHidden ? "Show object" : "Hide object"}</button>
      <button type="button" data-action="export">Export component...</button>
      <button type="button" data-action="copy">Copy ${escapeHtml(token)} reference</button>
      <button type="button" data-action="rename">Rename</button>
      <hr />
      <button type="button" data-action="delete">Delete component</button>
    `;
    if (!onExportHierarchyItem) {
      menu.querySelector('[data-action="export"]')?.setAttribute("disabled", "true");
    }

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(e.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(e.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    contextMenu = menu;

    menu.addEventListener("click", async (ev) => {
      const action = ev.target?.closest("button")?.dataset?.action;
      if (!action) return;
      closeContextMenu();
      if (action === "open") {
        onOpenHierarchyItem?.(project, entry, "components");
      } else if (action === "copy-id") {
        await copyExplorerId(idToken);
      } else if (action === "attach") {
        onAttachWiringComponent?.(project, entry, payload);
      } else if (action === "profile") {
        onOpenProfile?.(project, entry);
      } else if (action === "visibility") {
        const nextVisible = isHidden;
        entry.__hidden = !nextVisible;
        await onToggleHierarchyVisibility?.(project, entry, nextVisible, "components");
        render();
      } else if (action === "export") {
        onExportHierarchyItem?.(project, entry, ev.target);
      } else if (action === "copy") {
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(token);
          else window.prompt("Copy component reference", token);
        } catch {
          window.prompt("Copy component reference", token);
        }
      } else if (action === "rename") {
        onRenameHierarchyItem?.(project, entry, "components");
      } else if (action === "delete") {
        onDeleteHierarchyItem?.(project, entry, "components");
      }
    });
  }

  function folderStorageId(folderId) {
    return folderId || "__root__";
  }

  function toggleFolderCollapse(folderId) {
    const key = folderStorageId(folderId);
    if (collapsedFolders.has(key)) collapsedFolders.delete(key);
    else collapsedFolders.add(key);
    saveIdSet(FOLDER_COLLAPSE_KEY, collapsedFolders);
  }

  function toggleProjectExpand(projectId) {
    forceCollapsedProjects.delete(projectId);
    if (expandedProjects.has(projectId)) expandedProjects.delete(projectId);
    else expandedProjects.add(projectId);
    saveIdSet(PROJECT_EXPAND_KEY, expandedProjects);
  }

  function isProjectExpanded(projectId) {
    if (forceCollapsedProjects.has(projectId)) return false;
    return expandedProjects.has(projectId);
  }

  function sectionExpanded(projectId, sectionId) {
    const key = `${projectId}:${sectionId}`;
    if (!expandedSections.has(key)) return true;
    return expandedSections.get(key);
  }

  function toggleSection(projectId, sectionId) {
    const key = `${projectId}:${sectionId}`;
    expandedSections.set(key, !sectionExpanded(projectId, sectionId));
  }

  function buildFolderCollapseBtn(folderId, isCollapsed) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "folder-collapse-btn";
    btn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    btn.title = isCollapsed ? "Expand folder" : "Collapse folder";
    btn.textContent = isCollapsed ? "▸" : "▾";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFolderCollapse(folderId);
      render();
    });
    return btn;
  }

  function attachFolderTitleToggle(titleEl, folderId) {
    titleEl.classList.add("folder-title-toggle");
    titleEl.addEventListener("click", (e) => {
      if (e.target.closest(".btn-icon, .btn-folder-menu, .folder-header-actions")) return;
      toggleFolderCollapse(folderId);
      render();
    });
  }

  function buildProjectHierarchy(project) {
    const browser = project.browser || { components: [], drawings: [], references: [], renders: [], sketches: [], wiring: [] };
    const wrap = document.createElement("div");
    wrap.className = "proj-hierarchy";

    const referenceItems = [...(browser.drawings || []), ...(browser.references || [])];
    const sections = [
      { id: "components", label: "Components", items: browser.components || [] },
      { id: "references", label: "Reference Files", items: referenceItems },
      { id: "renders", label: "Renders", items: browser.renders || [] },
      { id: "sketches", label: "Sketches", items: browser.sketches || [] },
      { id: "wiring", label: "Wiring", items: browser.wiring || [] },
    ];

    for (const section of sections) {
      const sectionEl = document.createElement("div");
      sectionEl.className = "proj-hierarchy-section";
      sectionEl.dataset.section = section.id;

      const open = sectionExpanded(project.id, section.id);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "proj-hierarchy-section-toggle";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.innerHTML = `
        <span class="browser-chevron">${open ? "▾" : "▸"}</span>
        <span class="proj-hierarchy-section-label">${section.label}</span>
        <span class="proj-hierarchy-section-count">${section.items.length}</span>
      `;
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSection(project.id, section.id);
        render();
      });
      sectionEl.appendChild(toggle);

      if (open) {
        const list = document.createElement("ul");
        list.className = "proj-hierarchy-list";
        if (!section.items.length) {
          const empty = document.createElement("li");
          empty.className = "proj-hierarchy-empty muted small";
          empty.textContent =
            section.id === "components"
              ? "No components"
              : section.id === "references"
                ? "No reference files"
                : section.id === "renders"
                  ? "No renders yet"
                : section.id === "sketches"
                  ? "No sketches"
                  : "No wiring";
          list.appendChild(empty);
        } else {
          const sectionKey = hierarchyListKey(project.id, section.id);
          const sectionShowAll = showAllHierarchySections.has(sectionKey);
          const visibleItems = visibleSlice(section.items, sectionKey, showAllHierarchySections);
          for (const entry of visibleItems) {
            const item = document.createElement("li");
            item.className = "proj-hierarchy-item";
            const isComponent = section.id === "components";
            const isReference = section.id === "references" || section.id === "renders";
            const isDxf = section.id === "references" && (entry.format === "dxf" || /\.dxf$/i.test(String(entry.name || "")));
            const isEditableSketch = section.id === "sketches";
            const itemHidden = isComponent && (entry.__hidden ?? !!isHierarchyItemHidden?.(project, entry, section.id));
            const selectionKey = hierarchySelectionKey(project, section.id, entry);
            hierarchyEntryCache.set(selectionKey, { project, sectionId: section.id, entry });
            if (selectedHierarchyKeys.has(selectionKey)) {
              item.classList.add("proj-hierarchy-item--selected");
            }
            if (itemHidden) {
              item.classList.add("proj-hierarchy-item--hidden");
            }

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "proj-hierarchy-item-btn";

            const stem = entry.stem || entry.name.replace(/\.[^.]+$/, "");
            const recognized = isComponent ? recognizePart(stem) : null;
            const stored = isComponent ? (getPartProfile?.(stem) || null) : null;
            const wiringType = stored?.wiring_type || null;

            const editHint = isEditableSketch ? ` <span class="proj-hierarchy-edit-hint" title="Double-click to edit">✎</span>` : "";
            btn.innerHTML = `<span class="proj-hierarchy-item-name">${escapeHtml(hierarchyDisplayName(entry))}</span>${editHint}`;
            btn.title = isEditableSketch
              ? `${entry.name} — double-click to open in feature editor`
              : isDxf
              ? `${entry.name} — click to open this DXF drawing preview.`
              : isReference
              ? `${entry.name} — click to open this reference file.`
              : isComponent
              ? `${entry.name} — drag into the AI prompt to reference it, or into the Wiring Simulator. Shift-click to select multiple. Click ⓘ for ID, tags, and part profile.`
              : entry.name;
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (suppressHierarchyClick) {
                e.preventDefault();
                return;
              }
              if (e.shiftKey || e.metaKey || e.ctrlKey) {
                if (selectedHierarchyKeys.has(selectionKey)) selectedHierarchyKeys.delete(selectionKey);
                else selectedHierarchyKeys.add(selectionKey);
                render();
                return;
              }
              selectedHierarchyKeys.clear();
              if (itemHidden) {
                selectedHierarchyKeys.add(selectionKey);
                render();
                return;
              }
              onOpenHierarchyItem?.(project, entry, section.id);
            });
            if (isEditableSketch) {
              btn.addEventListener("dblclick", (e) => {
                e.preventDefault();
                e.stopPropagation();
                onEditHierarchyItem?.(project, entry, section.id);
              });
            }
            btn.draggable = !isReference;
            item.draggable = !isReference;

            if (isComponent) {
              const visBtn = document.createElement("button");
              visBtn.type = "button";
              visBtn.className = "proj-hierarchy-vis-btn";
              visBtn.classList.toggle("is-hidden", itemHidden);
              visBtn.title = itemHidden ? "Show object" : "Hide object";
              visBtn.setAttribute("aria-label", itemHidden ? "Show object" : "Hide object");
              visBtn.setAttribute("aria-pressed", itemHidden ? "true" : "false");
              visBtn.innerHTML = hierarchyEyeSvg(itemHidden);
              visBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const nextVisible = itemHidden;
                entry.__hidden = !nextVisible;
                await onToggleHierarchyVisibility?.(project, entry, nextVisible, section.id);
                render();
              });
              item.appendChild(visBtn);
            }

            item.appendChild(btn);

            if (isComponent) {
              item.classList.add("proj-hierarchy-item--component");
              const payload = componentPayload(project, entry, { stem, stored, recognized, wiringType });
              item.addEventListener("contextmenu", (e) => showComponentContextMenu(e, project, entry, payload));
              const onDragStart = (e) => {
                e.stopPropagation();
                suppressHierarchyClick = true;
                if (!selectedHierarchyKeys.has(selectionKey)) {
                  selectedHierarchyKeys.clear();
                  selectedHierarchyKeys.add(selectionKey);
                  item.classList.add("proj-hierarchy-item--selected");
                }
                setHierarchyDragData(e, selectedHierarchyPayloads(payload));
                onDragComponent?.(project, entry);
              };
              const onDragEnd = () => clearHierarchyClickSuppress();
              btn.addEventListener("dragstart", onDragStart);
              item.addEventListener("dragstart", onDragStart);
              btn.addEventListener("dragend", onDragEnd);
              item.addEventListener("dragend", onDragEnd);

              const prof = document.createElement("button");
              prof.type = "button";
              prof.className = "proj-hierarchy-profile-btn";
              prof.textContent = "ⓘ";
              prof.title = "View component ID, tags, part profile, and 3D preview";
              prof.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenProfile?.(project, entry);
              });
              item.appendChild(prof);
            } else if (isReference) {
              const payload = hierarchyPayload(project, section.id, entry);
              item.classList.add(isDxf ? "proj-hierarchy-item--drawing" : "proj-hierarchy-item--reference");
              item.addEventListener("contextmenu", (e) => showHierarchyItemContextMenu(e, project, entry, section.id, payload));
            } else {
              const payload = hierarchyPayload(project, section.id, entry);
              item.addEventListener("contextmenu", (e) => showHierarchyItemContextMenu(e, project, entry, section.id, payload));
              const onDragStart = (e) => {
                e.stopPropagation();
                suppressHierarchyClick = true;
                if (!selectedHierarchyKeys.has(selectionKey)) {
                  selectedHierarchyKeys.clear();
                  selectedHierarchyKeys.add(selectionKey);
                  item.classList.add("proj-hierarchy-item--selected");
                }
                setHierarchyDragData(e, selectedHierarchyPayloads(payload));
                onDragComponent?.(project, entry);
              };
              const onDragEnd = () => clearHierarchyClickSuppress();
              btn.addEventListener("dragstart", onDragStart);
              item.addEventListener("dragstart", onDragStart);
              btn.addEventListener("dragend", onDragEnd);
              item.addEventListener("dragend", onDragEnd);
            }

            // Bodies nest under the component row (header first, then body parts).
            if (isComponent && Array.isArray(entry.children) && entry.children.length) {
              const bodiesGroup = document.createElement("div");
              bodiesGroup.className = "proj-hierarchy-bodies";
              const bodiesKey = `${project.id}:${entry.name}:bodies`;
              const bodiesOpen = expandedHierarchyBodies.has(bodiesKey);
              const bodiesToggle = document.createElement("button");
              bodiesToggle.type = "button";
              bodiesToggle.className = "proj-hierarchy-bodies-toggle";
              bodiesToggle.setAttribute("aria-expanded", bodiesOpen ? "true" : "false");
              bodiesToggle.innerHTML = `
                <span class="browser-chevron">${bodiesOpen ? "▾" : "▸"}</span>
                <span class="proj-hierarchy-section-label">${escapeHtml(entry.children_label || "Bodies")}</span>
                <span class="proj-hierarchy-section-count">${entry.children.length}</span>
              `;
              bodiesToggle.addEventListener("click", (e) => {
                e.stopPropagation();
                if (expandedHierarchyBodies.has(bodiesKey)) expandedHierarchyBodies.delete(bodiesKey);
                else expandedHierarchyBodies.add(bodiesKey);
                render();
              });
              bodiesGroup.appendChild(bodiesToggle);
              if (bodiesOpen) {
                const nested = document.createElement("ul");
                nested.className = "proj-hierarchy-list proj-hierarchy-list--bodies";
                for (const child of entry.children) {
                  const childItem = document.createElement("li");
                  childItem.className = "proj-hierarchy-item proj-hierarchy-item--body";
                  const childHidden = child.__hidden ?? !!isHierarchyItemHidden?.(project, child, section.id);
                  if (childHidden) childItem.classList.add("proj-hierarchy-item--hidden");
                  const childSelectionKey = hierarchySelectionKey(project, section.id, child);
                  hierarchyEntryCache.set(childSelectionKey, { project, sectionId: section.id, entry: child });
                  if (selectedHierarchyKeys.has(childSelectionKey)) {
                    childItem.classList.add("proj-hierarchy-item--selected");
                  }

                  const childVis = document.createElement("button");
                  childVis.type = "button";
                  childVis.className = "proj-hierarchy-vis-btn";
                  childVis.classList.toggle("is-hidden", childHidden);
                  childVis.title = childHidden ? "Show body" : "Hide body";
                  childVis.setAttribute("aria-label", childHidden ? "Show body" : "Hide body");
                  childVis.setAttribute("aria-pressed", childHidden ? "true" : "false");
                  childVis.innerHTML = hierarchyEyeSvg(childHidden);
                  childVis.addEventListener("click", async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const nextVisible = childHidden;
                    child.__hidden = !nextVisible;
                    await onToggleHierarchyVisibility?.(project, child, nextVisible, section.id);
                    render();
                  });

                  const childBtn = document.createElement("button");
                  childBtn.type = "button";
                  childBtn.className = "proj-hierarchy-item-btn";
                  childBtn.innerHTML = `<span class="proj-hierarchy-body-icon" aria-hidden="true">◆</span><span class="proj-hierarchy-item-name">${escapeHtml(hierarchyDisplayName(child))}</span>`;
                  childBtn.title = `${child.body_name || child.label || child.name} — click to select this body`;
                  childBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    selectedHierarchyKeys.clear();
                    selectedHierarchyKeys.add(childSelectionKey);
                    if (!childHidden) onOpenHierarchyItem?.(project, child, section.id);
                    render();
                  });

                  childItem.append(childVis, childBtn);
                  nested.appendChild(childItem);
                }
                bodiesGroup.appendChild(nested);
              }
              item.appendChild(bodiesGroup);
            }

            list.appendChild(item);
          }
          const more = buildShowMoreControl({
            total: section.items.length,
            shown: visibleItems.length,
            expanded: sectionShowAll,
            label: section.label.toLowerCase(),
            onToggle: () => {
              if (sectionShowAll) showAllHierarchySections.delete(sectionKey);
              else showAllHierarchySections.add(sectionKey);
              saveIdSet(HIERARCHY_SHOW_ALL_KEY, showAllHierarchySections);
              render();
            },
          });
          if (more) list.appendChild(more);
        }
        sectionEl.appendChild(list);
      }
      wrap.appendChild(sectionEl);
    }
    return wrap;
  }

  function activeGenerationForBadge(project = {}) {
    const jobs = Array.isArray(project.generation?.running_jobs) && project.generation.running_jobs.length
      ? project.generation.running_jobs
      : Array.isArray(project.generation?.jobs)
        ? project.generation.jobs.filter((job) => job?.status === "running")
        : [];
    return jobs.find((job) => String(job?.kind || "").toLowerCase() === "rigging")
      || jobs[0]
      || project.generation
      || {};
  }

  function generationVisualTone(gen = {}) {
    const kind = String(gen?.kind || "").toLowerCase();
    if (kind === "rigging") return "rigging";
    if (kind === "wiring") return "wiring";
    if (kind === "render" || kind === "scene_render" || kind === "render_region_edit") return "render";
    const mode = String(gen?.mode || gen?.prompt_mode || gen?.promptMode || "").toLowerCase();
    if (mode === "render") return "render";
    if (["v2", "2.0", "2", "fusion", "architect", "fusion360", "fusion-360", "architecture"].includes(mode)) {
      return "v2";
    }
    const searchable = String([
      gen?.message,
      gen?.label,
      gen?.prompt,
      gen?.progress?.label,
    ].filter(Boolean).join(" "));
    if (/\b(v2|2\.0)\b/i.test(searchable)) return "v2";
    if (/\bfusion\b/i.test(searchable)) return "v2";
    if (/\barchitect(?:ure)?\b/i.test(searchable)) return "v2";
    return "standard";
  }

  function generationExplorerBadge(gen = {}) {
    if (!gen || gen.status !== "running") return "";
    const name = gen.by_user_name || "Someone";
    const initial = escapeHtml(String(name).trim().charAt(0).toUpperCase() || "A");
    const avatar = gen.by_avatar_url || "";
    const tone = generationVisualTone(gen);
    const rigging = tone === "rigging";
    const toneClass = rigging
      ? " proj-gen-user--rigging"
      : tone === "v2"
        ? " proj-gen-user--v2"
        : tone === "render"
          ? " proj-gen-user--render"
          : "";
    const avatarEl = avatar
      ? `<span class="proj-gen-avatar proj-gen-avatar--image" style="background-image:url('${escapeHtml(avatar)}')" title="${escapeHtml(name)} generating"></span>`
      : `<span class="proj-gen-avatar" title="${escapeHtml(name)} generating">${initial}</span>`;
    const rigIcon = rigging
      ? `<span class="proj-gen-rig-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 12.5h8M5 12.5V9l3-3 3 3v3.5M8 6V2.5M6.5 4h3M8 2.5l2 1.5M8 2.5 6 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`
      : "";
    return `<span class="proj-gen-user${toneClass}" aria-label="${escapeHtml(name)} ${rigging ? "generating rigging" : "generating with AI"}">${avatarEl}${rigIcon}<span class="proj-gen-ai">${rigging ? "RIG" : "AI"}</span></span>`;
  }

  function generationProgressPercent(gen = {}, fallback = {}) {
    const raw = gen?.progress?.pct ?? gen?.pct ?? fallback?.progress?.pct ?? fallback?.pct;
    const pct = Number(raw);
    if (!Number.isFinite(pct)) return null;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  function buildProjectRow(p) {
    const li = document.createElement("li");
    li.className = "proj-item";
    li.dataset.projectId = p.id;
    const generating = isProjectGenerating?.(p.id);
    const loading = isProjectLoading?.(p.id) && !generating;
    const showSpinner = loading || generating;
    if (p.id === getActiveProjectId()) li.classList.add("active");
    if (showSpinner) li.classList.add("proj-item--loading");
    const readOnly = !!p.read_only_project;

    const steps = p.timeline?.entries?.length || 0;
    const files = p.file_count ?? p.files?.length ?? 0;
    const when = p.updated_at
      ? new Date(p.updated_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
      : "";

    const handle = document.createElement("span");
    handle.className = "proj-drag-handle";
    handle.title = readOnly ? "Read-only render" : "Drag to reorder or move to another folder";
    handle.setAttribute("aria-hidden", "true");
    handle.draggable = !readOnly;
    handle.textContent = readOnly ? "👁" : "⠿";

    const hasHierarchy = hierarchyItemCount(p) > 0;
    const projectOpen = isProjectExpanded(p.id);

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "proj-expand-btn";
    if (hasHierarchy) {
      expandBtn.textContent = projectOpen ? "▾" : "▸";
      expandBtn.title = projectOpen ? "Collapse objects" : "Expand objects";
      expandBtn.setAttribute("aria-expanded", projectOpen ? "true" : "false");
      expandBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleProjectExpand(p.id);
        render();
      });
    } else {
      expandBtn.classList.add("proj-expand-btn-spacer");
      expandBtn.disabled = true;
      expandBtn.setAttribute("aria-hidden", "true");
      expandBtn.textContent = " ";
    }

    const body = document.createElement("button");
    body.type = "button";
    body.className = "proj-row-body";
    const activeGen = activeGenerationForBadge(p);
    const activeTone = generationVisualTone(activeGen);
    const genBadge = generating && activeGen?.status === "running"
      ? generationExplorerBadge(activeGen)
      : "";
    const promptGenerating = generating && activeTone !== "rigging" && activeTone !== "wiring";
    if (activeTone === "v2") li.classList.add("proj-item--v2-gen");
    else if (activeTone === "render") li.classList.add("proj-item--render-gen");
    const spinnerToneClass = activeTone === "v2"
      ? " proj-loading-spinner--v2"
      : activeTone === "render"
        ? " proj-loading-spinner--render"
        : "";
    const spinner = showSpinner && !genBadge
      ? `<span class="proj-loading-spinner${promptGenerating ? spinnerToneClass : ""}" aria-hidden="true"></span>`
      : "";
    const promptProgress = promptGenerating ? generationProgressPercent(activeGen, p.generation) : null;
    const progressToneClass = activeTone === "v2"
      ? " proj-gen-progress--v2"
      : activeTone === "render"
        ? " proj-gen-progress--render"
        : "";
    const progressBadge = promptProgress != null
      ? `<span class="proj-gen-progress${progressToneClass}" title="Prompt progress: ${promptProgress}%">${promptProgress}%</span>`
      : "";
    const loadingLabelToneClass = activeTone === "rigging"
      ? " proj-loading-label--rigging"
      : activeTone === "v2"
        ? " proj-loading-label--v2"
        : activeTone === "render"
          ? " proj-loading-label--render"
          : "";
    const loadingLabel = generating
      ? `<span class="proj-loading-label${loadingLabelToneClass}">${activeTone === "rigging" ? "Rigging…" : "Generating…"}</span>`
      : loading
        ? '<span class="proj-loading-label">Loading…</span>'
        : "";
    const promptCost = projectPromptCostMeta(p);
    const projectIdToken = projectExplorerId(p);
    const projectIdLabel = shortExplorerIdLabel(projectIdToken);
    const isNew = !generating && isProjectNew?.(p.id);
    const newBadge = isNew
      ? '<span class="proj-new-badge" title="New model ready — click to view" aria-label="New model ready">✓</span>'
      : "";
    if (isNew) li.classList.add("proj-item--new");
    const genOwner = p.generation?.by_user_name || p.generated_by?.display_name || "";
    const ownerLabel = [p.owner_name || genOwner, p.public ? null : p.owner_email].filter(Boolean).join(" · ");
    const showOwner = !!(ownerLabel && (readOnly || p.public || generating || isProjectNew?.(p.id) || p.shared_with_me));
    const ownerMeta = showOwner
      ? `<span class="proj-owner-badge" title="${escapeHtml(generating ? `${ownerLabel} is generating` : `Generated by ${ownerLabel}`)}">${escapeHtml(generating ? `${(p.owner_name || genOwner || "Teammate")}` : `By ${p.owner_name || genOwner || ownerLabel}`)}</span>`
      : "";
    const sharedTag = p.shared_with_me
      ? `<span class="folder-shared-tag proj-shared-tag" title="Shared with you">Shared</span>`
      : "";
    body.innerHTML = `${genBadge}${spinner}${progressBadge}<span class="proj-name">${escapeHtml(p.name || p.id)}</span>${sharedTag}${newBadge}<span class="proj-id-badge" title="${escapeHtml(projectIdToken)}">${escapeHtml(projectIdLabel)}</span>${loadingLabel}${ownerMeta}<span class="proj-meta">${files} file${files !== 1 ? "s" : ""} · ${steps} step${steps !== 1 ? "s" : ""}${promptCost}${when ? " · " + when : ""}</span>`;
    body.addEventListener("click", (e) => {
      e.stopPropagation();
      onOpenProject?.(p.id);
    });

    const actions = document.createElement("div");
    actions.className = "proj-row-actions proj-row-actions--menu-only";
    if (!readOnly || p.shared_with_me) {
      actions.title = p.shared_with_me
        ? "Right-click to open or remove from your folder"
        : "Right-click project for share, export, rename, and delete";
    }

    const main = document.createElement("div");
    main.className = "proj-item-main";
    main.append(handle, expandBtn, body, actions);
    main.addEventListener("contextmenu", (e) => {
      showProjectContextMenu(e, p);
    });
    li.append(main);
    if (loading && projectOpen) {
      const loadingEl = document.createElement("div");
      loadingEl.className = "proj-hierarchy-loading";
      loadingEl.innerHTML = '<span class="proj-loading-spinner" aria-hidden="true"></span><span>Loading models…</span>';
      li.appendChild(loadingEl);
    } else if (hasHierarchy && projectOpen) {
      li.appendChild(buildProjectHierarchy(p));
    }

    handle.addEventListener("dragstart", (e) => {
      if (readOnly) {
        e.preventDefault();
        return;
      }
      e.stopPropagation();
      dragProjectId = p.id;
      clearDropIndicators();
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", p.id);
    });
    handle.addEventListener("dragend", () => {
      dragProjectId = null;
      li.classList.remove("dragging");
      clearDropIndicators();
    });

    if (!readOnly) {
      li.addEventListener("dragover", (e) => {
        if (!dragProjectId || dragProjectId === p.id) return;
        const projects = getProjects();
        if (projects.find((x) => x.id === dragProjectId)?.read_only_project) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const rect = li.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        container?.querySelectorAll(".drop-before, .drop-after").forEach((el) => {
          el.classList.remove("drop-before", "drop-after");
        });
        li.classList.add(before ? "drop-before" : "drop-after");
        dropAtEnd = false;
        if (before) {
          dropBeforeProjectId = p.id;
        } else {
          const siblings = [...(li.parentElement?.querySelectorAll(":scope > .proj-item") || [])];
          const idx = siblings.indexOf(li);
          const next = siblings.slice(idx + 1).find((el) => el.dataset.projectId !== dragProjectId);
          dropBeforeProjectId = next?.dataset?.projectId || null;
          dropAtEnd = !dropBeforeProjectId;
        }
      });
      li.addEventListener("dragleave", (e) => {
        if (!li.contains(e.relatedTarget)) {
          li.classList.remove("drop-before", "drop-after");
        }
      });
      li.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pid = dragProjectId || e.dataTransfer.getData("text/plain");
        const beforeId = dropBeforeProjectId;
        const atEnd = dropAtEnd;
        clearDropIndicators();
        if (!pid || pid === p.id) return;
        const projects = getProjects();
        if (projects.find((x) => x.id === pid)?.read_only_project) return;
        const targetFolder = effectiveProjectFolderId(p);
        await moveProjectToFolder(pid, targetFolder, {
          beforeProjectId: beforeId,
          atEnd,
        });
      });
    }

    return li;
  }

  function setupDropZone(zoneEl, folderId) {
    zoneEl.addEventListener("dragover", (e) => {
      if (!dragProjectId) return;
      const projects = getProjects();
      if (projects.find((p) => p.id === dragProjectId)?.read_only_project) return;
      // Project-row handlers own precise before/after placement.
      if (e.target.closest?.(".proj-item")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      zoneEl.classList.add("drop-target-active");
      dropBeforeProjectId = null;
      dropAtEnd = false;
    });
    zoneEl.addEventListener("dragleave", (e) => {
      if (!zoneEl.contains(e.relatedTarget)) {
        zoneEl.classList.remove("drop-target-active");
      }
    });
    zoneEl.addEventListener("drop", async (e) => {
      if (e.target.closest?.(".proj-item")) return;
      e.preventDefault();
      zoneEl.classList.remove("drop-target-active");
      const pid = dragProjectId || e.dataTransfer.getData("text/plain");
      clearDropIndicators();
      if (!pid) return;
      const projects = getProjects();
      if (projects.find((p) => p.id === pid)?.read_only_project) return;
      await moveProjectToFolder(pid, folderId || null);
    });
  }

  function render() {
    if (!container) return;
    hierarchyEntryCache.clear();
    const projects = getProjects();
    const folderIds = new Set(folders.map((f) => f.id));
    const allRootProjects = sortProjectsForDisplay(
      projects.filter((p) => !p.folder_id || !folderIds.has(p.folder_id))
    );
    const query = normalizeProjectSearch(projectSearchQuery);
    const searching = query.length > 0;
    const filterProjects = (list, folderName = "") =>
      searching ? list.filter((p) => matchesProjectSearch(p, query, folderName)) : list;
    const folderTeamId = resolveTeamId();
    const workspaceMeta = getWorkspaceMeta?.(folderTeamId) || {};
    const teamIdsInView = [
      ...new Set((projects || []).map((p) => p?.team_id).filter(Boolean).map(String)),
    ];
    const multiWorkspace = teamIdsInView.length > 1;
    const rootLabel = multiWorkspace
      ? "All workspaces"
      : workspaceMeta.rootLabel || "Personal files";
    const rootProjects = filterProjects(allRootProjects, rootLabel);
    const folderProjects = (fid, folderName = "") =>
      filterProjects(
        sortProjectsForDisplay(projects.filter((p) => p.folder_id === fid)),
        folderName
      );

    container.innerHTML = "";

    const browserToolbar = document.createElement("div");
    browserToolbar.className = "project-browser-toolbar";

    const searchBar = document.createElement("label");
    searchBar.className = "project-search-bar";
    searchBar.innerHTML = `
      <span class="project-search-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="6.5" cy="6.5" r="4.25"></circle>
          <path d="M10 10l3.5 3.5" stroke-linecap="round"></path>
        </svg>
      </span>
      <input type="search" class="project-search-input" placeholder="Search projects or objects…" maxlength="120" autocomplete="off" spellcheck="false" />
      <button type="button" class="project-search-clear${projectSearchQuery.trim() ? "" : " hidden"}" title="Clear search" aria-label="Clear search">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"></path>
        </svg>
      </button>
    `;
    browserToolbar.appendChild(searchBar);

    const searchInput = searchBar.querySelector(".project-search-input");
    const clearBtn = searchBar.querySelector(".project-search-clear");
    searchInput.value = projectSearchQuery;
    searchInput.addEventListener("input", () => {
      projectSearchQuery = searchInput.value;
      try {
        if (projectSearchQuery.trim()) {
          sessionStorage.setItem(PROJECT_SEARCH_KEY, projectSearchQuery);
        } else {
          sessionStorage.removeItem(PROJECT_SEARCH_KEY);
        }
      } catch (_) {}
      render();
      const nextInput = container.querySelector(".project-search-input");
      if (nextInput) {
        nextInput.focus();
        const len = nextInput.value.length;
        nextInput.setSelectionRange(len, len);
      }
    });
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      projectSearchQuery = "";
      try { sessionStorage.removeItem(PROJECT_SEARCH_KEY); } catch (_) {}
      render();
      container.querySelector(".project-search-input")?.focus();
    });

    const toolbar = document.createElement("div");
    toolbar.className = "folder-toolbar";
    if (folderTeamId) {
      toolbar.innerHTML = `
        <input type="text" class="folder-name-input" placeholder="New folder name" maxlength="120" aria-label="New folder name" />
        <button type="button" class="btn-create-folder" title="Create folder" aria-label="Create folder">
          <svg class="btn-create-folder-icon" viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
            <path d="M2.75 5.75c0-.97.78-1.75 1.75-1.75h3.15l1.55 1.65h6.3c.97 0 1.75.78 1.75 1.75v7.1c0 .97-.78 1.75-1.75 1.75h-11c-.97 0-1.75-.78-1.75-1.75V5.75z" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round"></path>
            <path d="M10 8.25v5M7.5 10.75h5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"></path>
          </svg>
        </button>
      `;
      browserToolbar.appendChild(toolbar);
    }
    container.appendChild(browserToolbar);

    const input = toolbar.querySelector(".folder-name-input");
    const createFolder = async () => {
      const teamId = resolveTeamId();
      const name = input?.value?.trim();
      if (!teamId || !name) return;
      try {
        await api(`/api/teams/${teamId}/folders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        input.value = "";
        await refreshFolders();
        render();
        document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
      } catch (err) {
        alert(err.message || "Could not create folder");
      }
    };
    toolbar.querySelector(".btn-create-folder")?.addEventListener("click", createFolder);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createFolder();
      }
    });

    let visibleProjectCount = 0;

    const privateFolders = folders.filter((f) => !isCommunityFolder(f));
    const communityFolders = folders.filter((f) => isCommunityFolder(f));
    const showPrivateGroup = !!(rootProjects.length || !searching || privateFolders.some((f) => folderProjects(f.id, f.name).length));
    const showCommunityGroup = communityFolders.some((f) => {
      if (!searching) return true;
      return folderProjects(f.id, f.name).length > 0;
    });

    if (showPrivateGroup && (showCommunityGroup || privateFolders.length || rootProjects.length || !searching)) {
      appendFolderGroupLabel(
        container,
        multiWorkspace ? "Workspaces" : workspaceMeta.shared ? "Shared workspace" : "Personal"
      );
    }

    if (rootProjects.length || !searching) {
      const rootCollapsed = searching ? false : collapsedFolders.has(folderStorageId(null));
      const rootZone = document.createElement("section");
      rootZone.className = "folder-zone folder-zone-root";
      rootZone.classList.toggle("folder-zone-root--personal", !multiWorkspace && !!workspaceMeta.personal);
      rootZone.classList.toggle("folder-zone-root--shared", !multiWorkspace && !!workspaceMeta.shared);
      if (rootCollapsed) rootZone.classList.add("folder-zone-collapsed");
      rootZone.dataset.folderId = "";
      const rootHeader = document.createElement("header");
      rootHeader.className = "folder-header";
      rootHeader.append(
        buildFolderCollapseBtn(null, rootCollapsed),
        Object.assign(document.createElement("span"), {
          className: "folder-icon",
          textContent: multiWorkspace ? "📁" : workspaceMeta.shared ? "🟧" : "📁",
        }),
        Object.assign(document.createElement("span"), { className: "folder-title", textContent: rootLabel }),
        ...(!multiWorkspace && workspaceMeta.shared
          ? [
              Object.assign(document.createElement("span"), {
                className: "folder-workspace-highlight",
                textContent: "Shared workspace",
                title: "You are creating inside a shared workspace.",
              }),
              Object.assign(document.createElement("span"), {
                className: "folder-share-badge folder-share-badge--workspace",
                textContent: `👥 ${workspaceMeta.memberCount || ""}`.trim(),
                title: `${workspaceMeta.memberCount || 1} member${Number(workspaceMeta.memberCount || 1) === 1 ? "" : "s"} in this workspace`,
              }),
            ]
          : []),
        Object.assign(document.createElement("span"), {
          className: "folder-count muted small",
          textContent: rootProjects.length ? `${rootProjects.length}` : "",
        })
      );
      attachFolderTitleToggle(rootHeader.querySelector(".folder-title"), null);
      const openRootMenu = (ev) => showFolderContextMenu(ev, null);
      rootHeader.addEventListener("contextmenu", openRootMenu);
      rootZone.addEventListener("contextmenu", (ev) => {
        if (ev.target.closest(".proj-item, .proj-row-body, .btn-proj-rename, .btn-proj-delete, .btn-icon")) return;
        openRootMenu(ev);
      });
      rootZone.appendChild(rootHeader);
      const rootList = document.createElement("ul");
      rootList.className = "project-list";
      if (!rootCollapsed) {
        const rootKey = folderListKey(null);
        const rootShowAll = showAllFolders.has(rootKey);
        const visibleRootProjects = visibleSlice(rootProjects, rootKey, showAllFolders, searching);
        visibleRootProjects.forEach((p) => rootList.appendChild(buildProjectRow(p)));
        visibleProjectCount += visibleRootProjects.length;
        const more = buildShowMoreControl({
          total: rootProjects.length,
          shown: visibleRootProjects.length,
          expanded: rootShowAll || searching,
          label: "projects",
          onToggle: () => {
            if (rootShowAll) showAllFolders.delete(rootKey);
            else showAllFolders.add(rootKey);
            saveIdSet(FOLDER_SHOW_ALL_KEY, showAllFolders);
            render();
          },
        });
        if (!searching && more) rootList.appendChild(more);
      }
      rootZone.appendChild(rootList);
      setupDropZone(rootZone, null);
      container.appendChild(rootZone);
    }

    const appendFolderZone = (folder) => {
      const inFolder = folderProjects(folder.id, folder.name);
      if (searching && !inFolder.length) return;
      const folderCollapsed = searching ? false : collapsedFolders.has(folderStorageId(folder.id));
      const zone = document.createElement("section");
      zone.className = "folder-zone";
      if (folderCollapsed) zone.classList.add("folder-zone-collapsed");
      zone.dataset.folderId = folder.id;

      const header = document.createElement("header");
      header.className = "folder-header";
      const shareBadge =
        folder.visibility === "shared" || (folder.share_count ?? 0) > 0
          ? `<span class="folder-share-badge" title="Shared folder">👥 ${folder.share_count || ""}</span>`
          : "";
      const sharedLabel = folder.shared_with_me
        ? `<span class="folder-shared-tag">Shared with you</span>`
        : "";

      const canManage = folder.can_manage || folder.is_owner;

      header.appendChild(buildFolderCollapseBtn(folder.id, folderCollapsed));
      const folderWsMeta = folder.team_id ? getWorkspaceMeta?.(folder.team_id) : null;
      const folderWsTag =
        multiWorkspace && folderWsMeta?.label && !folder.virtual && !folder.public
          ? `<span class="folder-workspace-tag" title="Workspace">${escapeHtml(folderWsMeta.label)}</span>`
          : "";
      header.insertAdjacentHTML(
        "beforeend",
        `
        <span class="folder-icon">📂</span>
        <span class="folder-title">${escapeHtml(folder.name)}</span>
        ${folderWsTag}
        ${sharedLabel}
        ${shareBadge}
        <span class="folder-count muted small">${inFolder.length}</span>
        ${canManage ? `<span class="folder-header-actions">
          <button type="button" class="btn-folder-menu" title="Folder menu" aria-label="Folder menu">⋯</button>
        </span>` : ""}
      `
      );
      attachFolderTitleToggle(header.querySelector(".folder-title"), folder.id);
      header.title = canManage ? "Open the folder menu for new project, edit, share, and more" : "Right-click to collapse all projects";

      const openMenu = (ev) => showFolderContextMenu(ev, folder);
      header.addEventListener("contextmenu", openMenu);
      zone.addEventListener("contextmenu", (ev) => {
        if (ev.target.closest(".proj-item, .proj-row-body, .btn-proj-rename, .btn-proj-delete, .btn-icon, .btn-folder-menu")) return;
        openMenu(ev);
      });
      if (canManage) {
        header.querySelector(".btn-folder-menu")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const r = header.getBoundingClientRect();
          showFolderContextMenu({ clientX: r.right, clientY: r.bottom, preventDefault() {}, stopPropagation() {} }, folder);
        });
      }

      const list = document.createElement("ul");
      list.className = "project-list";
      if (!folderCollapsed) {
        if (!inFolder.length) {
          const empty = document.createElement("li");
          empty.className = "folder-drop-hint muted small";
          empty.textContent = folder.virtual || folder.read_only ? "No renders yet" : "Drop projects here";
          list.appendChild(empty);
        } else {
          const listKey = folderListKey(folder.id);
          const folderShowAll = showAllFolders.has(listKey);
          const visibleFolderProjects = visibleSlice(inFolder, listKey, showAllFolders, searching);
          visibleFolderProjects.forEach((p) => list.appendChild(buildProjectRow(p)));
          visibleProjectCount += visibleFolderProjects.length;
          const more = buildShowMoreControl({
            total: inFolder.length,
            shown: visibleFolderProjects.length,
            expanded: folderShowAll || searching,
            label: "projects",
            onToggle: () => {
              if (folderShowAll) showAllFolders.delete(listKey);
              else showAllFolders.add(listKey);
              saveIdSet(FOLDER_SHOW_ALL_KEY, showAllFolders);
              render();
            },
          });
          if (!searching && more) list.appendChild(more);
        }
      }

      zone.append(header, list);
      if (!(folder.virtual || folder.read_only)) setupDropZone(zone, folder.id);
      container.appendChild(zone);
    };

    for (const folder of privateFolders) {
      appendFolderZone(folder);
    }

    if (showCommunityGroup) {
      appendFolderGroupLabel(container, "Public", { breakBefore: true });
      for (const folder of communityFolders) {
        appendFolderZone(folder);
      }
    }

    if (searching && visibleProjectCount === 0) {
      const noMatch = document.createElement("p");
      noMatch.className = "muted small browser-empty project-search-empty";
      noMatch.textContent = `No projects or objects match “${projectSearchQuery.trim()}”`;
      container.appendChild(noMatch);
    } else if (!projects.length && !folders.length) {
      const empty = document.createElement("p");
      empty.className = "muted small browser-empty";
      empty.textContent = "No projects yet — create one or upload a model.";
      container.appendChild(empty);
    }
  }

  async function refreshFolders() {
    const projects = getProjects() || [];
    const seen = new Set();
    folders = [];

    // Seed from project folder refs (covers virtual Public / other-user folders too).
    for (const project of projects) {
      const id = project?.folder_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const isPublic = id === "__public__";
      const isOtherRenders = id === "__other_user_renders__";
      folders.push({
        id,
        team_id: project.team_id || null,
        name: project.folder_name || (isPublic ? "Public" : isOtherRenders ? "New renders from other users" : "Folder"),
        virtual: isPublic || isOtherRenders || !project.team_id,
        read_only: isPublic || isOtherRenders || !!project.read_only_project,
        public: isPublic,
      });
    }

    // Load real folders for every workspace that has visible projects, plus the
    // active/folder workspace (so empty checked workspaces still get their folders).
    const teamIds = new Set(
      projects.map((p) => p?.team_id).filter(Boolean).map(String)
    );
    const focusId = resolveTeamId();
    if (focusId) teamIds.add(String(focusId));
    // When focused on one workspace, still pull folders for other teams present
    // in the project list so checkbox-visible shared workspaces keep their folders.
    for (const tid of teamIds) {
      try {
        const data = await api(`/api/teams/${encodeURIComponent(tid)}/folders`);
        for (const folder of data.folders || []) {
          if (!folder?.id || seen.has(folder.id)) continue;
          seen.add(folder.id);
          folders.push(folder);
        }
      } catch {
        /* keep whatever we already have for this team */
      }
    }
  }

  async function refresh() {
            await refreshFolders();
            render();
            document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
  }

  return {
    refresh,
    refreshFolders,
    render,
    setFolders: (f) => {
      folders = f;
    },
    upsertFolder(folder) {
      if (!folder?.id) return;
      const idx = folders.findIndex((f) => f.id === folder.id);
      if (idx >= 0) {
        folders[idx] = { ...folders[idx], ...folder };
      } else {
        folders = [...folders, folder];
      }
      render();
    },
    removeFolder(folderId) {
      if (!folderId) return;
      const next = folders.filter((f) => f.id !== folderId);
      if (next.length === folders.length) return;
      folders = next;
      render();
    },
    expandProject(projectId) {
      if (!projectId) return;
      forceCollapsedProjects.delete(projectId);
      expandedProjects.add(projectId);
      saveIdSet(PROJECT_EXPAND_KEY, expandedProjects);
    },
  };
}
