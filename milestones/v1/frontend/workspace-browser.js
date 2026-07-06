/** Workspace folders + drag-and-drop project organization. */

export function createWorkspaceBrowser({
  container,
  api,
  getWorkspaceId,
  getProjects,
  getActiveProjectId,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
}) {
  let folders = [];
  let dragProjectId = null;
  let contextMenu = null;
  let shareModalEl = null;
  let renameModalEl = null;
  let shareModalFolder = null;

  const ICON_SHARE = `<svg class="icon-share" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11 9.5a2.5 2.5 0 1 0-.9-1.9L8.5 5.6V5a2.5 2.5 0 1 0-1 0v.6L5.9 7.6a2.5 2.5 0 1 0 .9 1.9l2.6-1.6V11a2.5 2.5 0 1 0 1 0V7.9l2.6 1.6zM5 4.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm6 7a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zM3 11a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"/></svg>`;
  const ICON_PENCIL = `<svg class="icon-pencil" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11.5 2.5a1.5 1.5 0 0 1 2.12 2.12L5.62 12.62 2 13.5l.88-3.62L11.5 2.5z"/></svg>`;

  function closeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
  }

  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0) return;
      if (contextMenu?.contains(e.target)) return;
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
    shareModalEl.querySelector("#folder-share-email")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitShareModal();
      }
    });
    return shareModalEl;
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
    modal.querySelector("#folder-share-status").textContent = "";
    modal.querySelector("#folder-share-restrict").checked =
      folder.visibility !== "workspace";
    modal.classList.remove("hidden");
    await loadShareList(folder);
    modal.querySelector("#folder-share-email")?.focus();
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

  function showFolderContextMenu(e, folder) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "folder-context-menu";
    menu.innerHTML = `
      <button type="button" data-action="share">Share folder…</button>
      <button type="button" data-action="rename">Rename</button>
      <button type="button" data-action="delete">Delete</button>
    `;
    const x = e?.clientX ?? 0;
    const y = e?.clientY ?? 0;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    contextMenu = menu;

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

  function buildProjectRow(p) {
    const li = document.createElement("li");
    li.className = "proj-item";
    li.draggable = true;
    li.dataset.projectId = p.id;
    if (p.id === getActiveProjectId()) li.classList.add("active");

    const steps = p.timeline?.entries?.length || 0;
    const files = p.file_count ?? p.files?.length ?? 0;
    const when = p.updated_at
      ? new Date(p.updated_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
      : "";

    const handle = document.createElement("span");
    handle.className = "proj-drag-handle";
    handle.title = "Drag to move";
    handle.setAttribute("aria-hidden", "true");
    handle.textContent = "⠿";

    const body = document.createElement("button");
    body.type = "button";
    body.className = "proj-row-body";
    body.innerHTML = `<span class="proj-name">${escapeHtml(p.name || p.id)}</span><span class="proj-meta">${files} file${files !== 1 ? "s" : ""} · ${steps} step${steps !== 1 ? "s" : ""}${when ? " · " + when : ""}</span>`;
    body.addEventListener("click", () => onOpenProject?.(p.id));

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
    actions.append(rename, del);

    li.append(handle, body, actions);

    li.addEventListener("dragstart", (e) => {
      dragProjectId = p.id;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", p.id);
    });
    li.addEventListener("dragend", () => {
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
      const targetFolder = folderId || null;
      const projects = getProjects();
      const proj = projects.find((x) => x.id === pid);
      if (proj && (proj.folder_id || null) === targetFolder) return;
      try {
        await api(`/api/projects/${pid}/folder`, {
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
    });
  }

  function render() {
    if (!container) return;
    const projects = getProjects();
    const rootProjects = projects.filter((p) => !p.folder_id);

    container.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "folder-toolbar";
    toolbar.innerHTML = `
      <input type="text" class="folder-name-input" placeholder="New folder name" maxlength="120" />
      <button type="button" class="btn secondary btn-compact btn-create-folder">+ Folder</button>
    `;
    container.appendChild(toolbar);

    const input = toolbar.querySelector(".folder-name-input");
    toolbar.querySelector(".btn-create-folder")?.addEventListener("click", async () => {
      const teamId = getWorkspaceId();
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
    });

    const rootZone = document.createElement("section");
    rootZone.className = "folder-zone folder-zone-root";
    rootZone.dataset.folderId = "";
    rootZone.innerHTML = `<header class="folder-header"><span class="folder-icon">📁</span><span class="folder-title">Unfiled</span><span class="folder-count muted small"></span></header>`;
    const rootList = document.createElement("ul");
    rootList.className = "project-list";
    rootProjects.forEach((p) => rootList.appendChild(buildProjectRow(p)));
    rootZone.querySelector(".folder-count").textContent =
      rootProjects.length ? `${rootProjects.length}` : "";
    rootZone.appendChild(rootList);
    setupDropZone(rootZone, null);
    container.appendChild(rootZone);

    for (const folder of folders) {
      const inFolder = projects.filter((p) => p.folder_id === folder.id);
      const zone = document.createElement("section");
      zone.className = "folder-zone";
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

      header.innerHTML = `
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
      `;
      header.title = canManage ? "Share, rename, or right-click for more" : "Shared folder";

      if (canManage) {
        const openMenu = (ev) => showFolderContextMenu(ev, folder);
        header.addEventListener("contextmenu", openMenu);
        zone.addEventListener("contextmenu", (ev) => {
          if (ev.target.closest(".proj-item, .proj-row-body, .btn-proj-rename, .btn-proj-delete, .btn-icon, .btn-folder-menu")) return;
          openMenu(ev);
        });
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
      if (!inFolder.length) {
        const empty = document.createElement("li");
        empty.className = "folder-drop-hint muted small";
        empty.textContent = "Drop projects here";
        list.appendChild(empty);
      } else {
        inFolder.forEach((p) => list.appendChild(buildProjectRow(p)));
      }

      zone.append(header, list);
      setupDropZone(zone, folder.id);
      container.appendChild(zone);
    }

    if (!projects.length && !folders.length) {
      const empty = document.createElement("p");
      empty.className = "muted small browser-empty";
      empty.textContent = "No projects yet — create one or upload a model.";
      container.appendChild(empty);
    }
  }

  async function refreshFolders() {
    const teamId = getWorkspaceId();
    if (!teamId) {
      folders = [];
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

  return { refresh, refreshFolders, render, setFolders: (f) => { folders = f; } };
}
