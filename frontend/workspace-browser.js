/** Workspace folders + drag-and-drop project organization. */

import { recognizePart } from "./part-catalog.js?v=20260617-part-drag";
import { setExplorerDragData } from "./explorer-drag.js?v=20260618-multi-drag";

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
  if (entry.format === "program") {
    return entry.stem || entry.name.replace(/\.program\.json$/i, "");
  }
  if (entry.format === "wiring") return entry.name;
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
  for (const list of [browser.components, browser.drawings, browser.sketches, browser.wiring]) {
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
  getProjects,
  getActiveProjectId,
  isProjectLoading,
  isProjectGenerating,
  isProjectNew,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onExportProject,
  onMakePublicProject,
  onOpenHierarchyItem,
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
  let contextMenu = null;
  let shareModalEl = null;
  let renameModalEl = null;
  let shareModalFolder = null;
  let collapsedFolders = loadIdSet(FOLDER_COLLAPSE_KEY);
  let showAllFolders = loadIdSet(FOLDER_SHOW_ALL_KEY);
  let showAllHierarchySections = loadIdSet(HIERARCHY_SHOW_ALL_KEY);
  let expandedProjects = loadIdSet(PROJECT_EXPAND_KEY);
  const forceCollapsedProjects = new Set();
  const expandedSections = new Map();
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

  function closeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
    moveSubmenuEl?.remove();
    moveSubmenuEl = null;
  }

  let moveSubmenuEl = null;

  function effectiveProjectFolderId(project) {
    const folderIds = new Set(folders.map((f) => f.id));
    const fid = project?.folder_id || null;
    return fid && folderIds.has(fid) ? fid : null;
  }

  function folderListKey(folderId) {
    return folderId || "__root__";
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

  async function moveProjectToFolder(projectId, folderId) {
    const projects = getProjects();
    const proj = projects.find((x) => x.id === projectId);
    if (proj?.read_only_project) return;
    const targetFolder = folderId || null;
    if (proj && effectiveProjectFolderId(proj) === targetFolder) return;
    try {
      await api(`/api/projects/${projectId}/folder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: targetFolder }),
      });
      if (proj) proj.folder_id = targetFolder;
      render();
      document.dispatchEvent(new CustomEvent("workspace-folders-changed"));
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
      { id: null, label: "Unfiled", icon: "📁" },
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
        <p class="muted small folder-share-hint">Invite a coworker by email. They must have an account (or will get a workspace invite).</p>
        <ul class="folder-share-list" id="folder-share-list"></ul>
        <label class="app-dialog-label">Team member
          <select id="folder-share-member" class="folder-share-member-select">
            <option value="">Loading workspace members…</option>
          </select>
        </label>
        <label class="app-dialog-label">Email
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
      const email = e.target.value || "";
      const emailInput = shareModalEl?.querySelector("#folder-share-email");
      if (emailInput) emailInput.value = email;
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
    const restrict = shareModalEl?.querySelector("#folder-share-restrict");
    if (!folder || !teamId) return;
    const email = emailInput?.value?.trim();
    if (!email) {
      if (status) status.textContent = "Enter an email address.";
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
      await loadShareList(folder);
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

  function projectsInFolder(folderId) {
    const projects = getProjects();
    const folderIds = new Set(folders.map((f) => f.id));
    if (folderId == null) {
      return projects.filter((p) => !p.folder_id || !folderIds.has(p.folder_id));
    }
    return projects.filter((p) => p.folder_id === folderId);
  }

  function folderHasExpandedProjects(folderId) {
    return projectsInFolder(folderId).some((p) => {
      if (isProjectExpanded(p.id)) return true;
      return ["components", "drawings", "sketches", "wiring"].some((sectionId) => sectionExpanded(p.id, sectionId));
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
      for (const sectionId of ["components", "drawings", "sketches", "wiring"]) {
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
      <button type="button" data-action="share">Share folder…</button>
      <button type="button" data-action="rename">Rename</button>
      <button type="button" data-action="delete">Delete</button>
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
      if (!window.confirm(`Delete folder "${folder.name}"? Projects inside will move to Unfiled.`)) return;
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
      .replace(/>/g, "&gt;");
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
        : sectionId === "drawings"
          ? "dxf"
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
    const safeWiringType = wiringType || safeStored?.wiring_type || safeRecognized?.wiringType || null;
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
      type: sectionId === "drawings" ? "dxf" : sectionId === "sketches" ? "sketch" : "wiring",
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
      const wiringType = stored?.wiring_type || recognized?.wiringType || null;
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
    const menu = document.createElement("div");
    menu.className = "folder-context-menu project-context-menu";
    menu.innerHTML = `
      <div class="component-context-title">
        <strong>${escapeHtml(project?.name || project?.id || "Project")}</strong>
        <span>${escapeHtml(idToken)}</span>
      </div>
      <button type="button" data-action="open">Open project</button>
      <button type="button" data-action="copy-id">Copy project ID</button>
      ${readOnly || project?.public ? "" : `<button type="button" data-action="move">Move to…</button>`}
      ${readOnly || project?.public ? "" : `<button type="button" data-action="make-public">Make public</button>`}
      <button type="button" data-action="export">Export / share…</button>
      ${readOnly ? "" : `<button type="button" data-action="rename">Rename…</button>
      <hr />
      <button type="button" data-action="delete">Delete project</button>`}
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
        : sectionId === "drawings"
          ? "DXF drawing"
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
    const browser = project.browser || { components: [], drawings: [], sketches: [], wiring: [] };
    const wrap = document.createElement("div");
    wrap.className = "proj-hierarchy";

    const sections = [
      { id: "components", label: "Components", items: browser.components || [] },
      { id: "drawings", label: "DXF Drawings", items: browser.drawings || [] },
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
              : section.id === "drawings"
                ? "No DXF drawings"
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
            const isDrawing = section.id === "drawings";
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
            const wiringType = stored?.wiring_type || recognized?.wiringType || null;

            const editHint = isEditableSketch ? ` <span class="proj-hierarchy-edit-hint" title="Double-click to edit">✎</span>` : "";
            btn.innerHTML = `<span class="proj-hierarchy-item-name">${escapeHtml(hierarchyDisplayName(entry))}</span>${editHint}`;
            btn.title = isEditableSketch
              ? `${entry.name} — double-click to open in feature editor`
              : isDrawing
              ? `${entry.name} — click to open this DXF drawing preview.`
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
            btn.draggable = !isDrawing;
            item.draggable = !isDrawing;

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
            } else if (isDrawing) {
              const payload = hierarchyPayload(project, section.id, entry);
              item.classList.add("proj-hierarchy-item--drawing");
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

  function generationExplorerBadge(gen = {}) {
    if (!gen || gen.status !== "running") return "";
    const name = gen.by_user_name || "Someone";
    const initial = escapeHtml(String(name).trim().charAt(0).toUpperCase() || "A");
    const avatar = gen.by_avatar_url || "";
    const avatarEl = avatar
      ? `<span class="proj-gen-avatar proj-gen-avatar--image" style="background-image:url('${escapeHtml(avatar)}')" title="${escapeHtml(name)} generating"></span>`
      : `<span class="proj-gen-avatar" title="${escapeHtml(name)} generating">${initial}</span>`;
    return `<span class="proj-gen-user" aria-label="${escapeHtml(name)} generating with AI">${avatarEl}<span class="proj-gen-ai">AI</span></span>`;
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
    handle.title = readOnly ? "Read-only render" : "Drag to move";
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
    const genBadge = generating && p.generation?.status === "running"
      ? generationExplorerBadge(p.generation)
      : "";
    const spinner = showSpinner && !genBadge
      ? '<span class="proj-loading-spinner" aria-hidden="true"></span>'
      : "";
    const loadingLabel = generating
      ? '<span class="proj-loading-label">Generating…</span>'
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
    const ownerLabel = [p.owner_name, p.owner_email].filter(Boolean).join(" · ");
    const ownerMeta = readOnly && ownerLabel
      ? `<span class="proj-owner-badge" title="Generated by ${escapeHtml(ownerLabel)}">Generated by ${escapeHtml(ownerLabel)}</span>`
      : "";
    body.innerHTML = `${genBadge}${spinner}<span class="proj-name">${escapeHtml(p.name || p.id)}</span>${newBadge}<span class="proj-id-badge" title="${escapeHtml(projectIdToken)}">${escapeHtml(projectIdLabel)}</span>${loadingLabel}${ownerMeta}<span class="proj-meta">${files} file${files !== 1 ? "s" : ""} · ${steps} step${steps !== 1 ? "s" : ""}${promptCost}${when ? " · " + when : ""}</span>`;
    body.addEventListener("click", (e) => {
      e.stopPropagation();
      onOpenProject?.(p.id);
    });

    const exp = document.createElement("button");
    exp.type = "button";
    exp.className = "btn-proj-export";
    exp.title = "Export / share model";
    exp.textContent = "Export";
    exp.addEventListener("click", (e) => {
      e.stopPropagation();
      onExportProject?.(p);
    });

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "btn-proj-rename";
    rename.title = "Rename project";
    rename.textContent = "Rename";
    rename.addEventListener("click", (e) => {
      e.stopPropagation();
      onRenameProject?.(p);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-proj-delete";
    del.title = "Delete project";
    del.textContent = "Delete";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      onDeleteProject?.(p);
    });

    const actions = document.createElement("div");
    actions.className = "proj-row-actions";
    if (readOnly) {
      actions.append(exp);
    } else {
      actions.append(exp, rename, del);
    }

    const main = document.createElement("div");
    main.className = "proj-item-main";
    main.append(handle, expandBtn, body, actions);
    main.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".proj-row-actions, .proj-drag-handle, .proj-expand-btn")) return;
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
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", p.id);
    });
    handle.addEventListener("dragend", () => {
      dragProjectId = null;
      li.classList.remove("dragging");
      container.querySelectorAll(".drop-target-active").forEach((el) => {
        el.classList.remove("drop-target-active");
      });
    });

    return li;
  }

  function setupDropZone(zoneEl, folderId) {
    zoneEl.addEventListener("dragover", (e) => {
      if (!dragProjectId) return;
      const projects = getProjects();
      if (projects.find((p) => p.id === dragProjectId)?.read_only_project) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      zoneEl.classList.add("drop-target-active");
    });
    zoneEl.addEventListener("dragleave", () => {
      zoneEl.classList.remove("drop-target-active");
    });
    zoneEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      zoneEl.classList.remove("drop-target-active");
      const pid = dragProjectId || e.dataTransfer.getData("text/plain");
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
    const allRootProjects = projects.filter((p) => !p.folder_id || !folderIds.has(p.folder_id));
    const query = normalizeProjectSearch(projectSearchQuery);
    const searching = query.length > 0;
    const filterProjects = (list, folderName = "") =>
      searching ? list.filter((p) => matchesProjectSearch(p, query, folderName)) : list;
    const rootProjects = filterProjects(allRootProjects, "Unfiled");
    const folderProjects = (fid, folderName = "") =>
      filterProjects(projects.filter((p) => p.folder_id === fid), folderName);

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

    const folderTeamId = resolveTeamId();
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

    if (rootProjects.length || !searching) {
      const rootCollapsed = searching ? false : collapsedFolders.has(folderStorageId(null));
      const rootZone = document.createElement("section");
      rootZone.className = "folder-zone folder-zone-root";
      if (rootCollapsed) rootZone.classList.add("folder-zone-collapsed");
      rootZone.dataset.folderId = "";
      const rootHeader = document.createElement("header");
      rootHeader.className = "folder-header";
      rootHeader.append(
        buildFolderCollapseBtn(null, rootCollapsed),
        Object.assign(document.createElement("span"), { className: "folder-icon", textContent: "📁" }),
        Object.assign(document.createElement("span"), { className: "folder-title", textContent: "Unfiled" }),
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

    for (const folder of folders) {
      const inFolder = folderProjects(folder.id, folder.name);
      if (searching && !inFolder.length) continue;
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
      header.insertAdjacentHTML(
        "beforeend",
        `
        <span class="folder-icon">📂</span>
        <span class="folder-title">${escapeHtml(folder.name)}</span>
        ${sharedLabel}
        ${shareBadge}
        <span class="folder-count muted small">${inFolder.length}</span>
        ${canManage ? `<span class="folder-header-actions">
          <button type="button" class="btn-icon btn-folder-share" title="Share folder">${ICON_SHARE}</button>
          <button type="button" class="btn-icon btn-folder-rename" title="Rename folder">${ICON_PENCIL}</button>
          <button type="button" class="btn-folder-menu" title="More">⋯</button>
        </span>` : ""}
      `
      );
      attachFolderTitleToggle(header.querySelector(".folder-title"), folder.id);
      header.title = canManage ? "Share, rename, or right-click for more" : "Right-click to collapse all projects";

      const openMenu = (ev) => showFolderContextMenu(ev, folder);
      header.addEventListener("contextmenu", openMenu);
      zone.addEventListener("contextmenu", (ev) => {
        if (ev.target.closest(".proj-item, .proj-row-body, .btn-proj-rename, .btn-proj-delete, .btn-icon, .btn-folder-menu")) return;
        openMenu(ev);
      });
      if (canManage) {
        header.querySelector(".btn-folder-share")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openShareDialog(folder);
        });
        header.querySelector(".btn-folder-rename")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openRenameDialog(folder);
        });
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
    const teamId = getWorkspaceId();
    if (!teamId) {
      const seen = new Set();
      folders = [];
      for (const project of getProjects() || []) {
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
      const folderTeamId = resolveTeamId();
      if (folderTeamId) {
        try {
          const data = await api(`/api/teams/${folderTeamId}/folders`);
          for (const folder of data.folders || []) {
            if (!folder?.id || seen.has(folder.id)) continue;
            seen.add(folder.id);
            folders.push(folder);
          }
        } catch {
          /* keep virtual folders only */
        }
      }
      return;
    }
    try {
      const data = await api(`/api/teams/${teamId}/folders`);
      folders = data.folders || [];
    } catch {
      folders = [];
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
    expandProject(projectId) {
      if (!projectId) return;
      forceCollapsedProjects.delete(projectId);
      expandedProjects.add(projectId);
      saveIdSet(PROJECT_EXPAND_KEY, expandedProjects);
    },
  };
}
