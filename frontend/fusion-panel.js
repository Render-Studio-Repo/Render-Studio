/** Fusion Library panel — browse Autodesk/Fusion hubs, import models, and push STEP updates. */

import { authHeaders } from "./auth.js";

const IMPORTABLE_EXTS = /\.(step|stp|stl|3mf|obj|glb|gltf)$/i;

export function initFusionPanel({ api, getCurrentProjectId, getSelectedFile, getWorkspaceId, onImported, onView, onStatus, onMirrorLinked } = {}) {
  const section = document.getElementById("fusion-library-section");
  if (!section) return;

  const statusEl = section.querySelector(".fusion-status");
  const controlsEl = section.querySelector(".fusion-library-controls");
  const listEl = section.querySelector(".fusion-doc-list");
  const btnRefresh = section.querySelector(".btn-fusion-refresh");

  let hubs = [];
  let projects = [];
  let activeHubId = "";
  let activeProjectId = "";
  let preferredMirrorTarget = null;
  const importedMap = new Map();
  let contextMenu = null;

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.className = `fusion-status muted small${isError ? " error" : ""}`;
  }

  async function loadHubs() {
    if (!controlsEl || !listEl) return;
    controlsEl.innerHTML = "";
    listEl.innerHTML = "";
    setStatus("Loading Fusion hubs...");
    try {
      const data = await api("/api/autodesk/hubs");
      hubs = data.hubs || [];
      if (!hubs.length) {
        setStatus("No Fusion hubs found for this Autodesk account.");
        return;
      }
      preferredMirrorTarget = await loadPreferredMirrorTarget();
      activeHubId = activeHubId && hubs.some((h) => h.id === activeHubId) ? activeHubId : hubs[0].id;
      if (preferredMirrorTarget?.hub_id && hubs.some((h) => h.id === preferredMirrorTarget.hub_id)) {
        activeHubId = preferredMirrorTarget.hub_id;
      }
      renderControls();
      await loadProjects();
    } catch (err) {
      const msg = err.message || "Could not load Fusion library.";
      setStatus(/not linked|401/i.test(msg) ? "Connect Autodesk to browse your Fusion library." : msg, !/not linked|401/i.test(msg));
    }
  }

  async function unlinkMirrorFolder(btn) {
    const currentProjectId = getCurrentProjectId?.();
    if (!currentProjectId) {
      setStatus("Open a Render3D project before unlinking a Fusion mirror folder.", true);
      return;
    }
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Unlinking...";
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/fusion-mirror`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Fusion mirror unlink failed (${res.status})`);
      }
      preferredMirrorTarget = null;
      setStatus("Fusion mirror unlinked. Choose a hub, project, and folder to link a new mirror.");
      onStatus?.("ok", "Fusion mirror unlinked.");
      onMirrorLinked?.();
      renderControls();
      if (activeProjectId) await loadTopFolders();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = orig;
      setStatus(err.message || "Fusion mirror unlink failed.", true);
      onStatus?.("error", err.message || "Fusion mirror unlink failed.");
    }
  }

  async function loadPreferredMirrorTarget() {
    const currentProjectId = getCurrentProjectId?.();
    if (!currentProjectId) return null;
    try {
      const data = await api(`/api/projects/${encodeURIComponent(currentProjectId)}/fusion-mirrors`);
      return data.mine || null;
    } catch {
      return null;
    }
  }

  function closeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
  }

  function renderControls() {
    controlsEl.innerHTML = `
      <label class="fusion-library-field">
        <span>Hub</span>
        <select id="fusion-hub-select"></select>
      </label>
      <label class="fusion-library-field">
        <span>Project</span>
        <select id="fusion-project-select"></select>
      </label>
      ${preferredMirrorTarget ? '<button type="button" class="btn btn-compact btn-fusion-unlink-mirror" title="Unlink this Render3D project from the currently selected Fusion mirror folder.">Unlink mirror</button>' : ""}
      <button type="button" class="btn btn-compact btn-fusion-import-visible" title="Import every file currently shown in open Fusion folders.">Import all visible</button>
      <button type="button" class="btn btn-compact btn-fusion-sync-latest" title="Pull the newest version from your linked Fusion mirror, update Render3D, then push to teammates' mirrors.">Sync latest from Fusion</button>
    `;
    controlsEl.querySelector(".btn-fusion-import-visible")?.addEventListener("click", (event) => {
      importVisibleItems(event.currentTarget);
    });
    controlsEl.querySelector(".btn-fusion-sync-latest")?.addEventListener("click", (event) => {
      syncLatestFromFusion(event.currentTarget);
    });
    controlsEl.querySelector(".btn-fusion-unlink-mirror")?.addEventListener("click", (event) => {
      unlinkMirrorFolder(event.currentTarget);
    });
    const hubSelect = controlsEl.querySelector("#fusion-hub-select");
    hubSelect.innerHTML = hubs.map((hub) => `<option value="${esc(hub.id)}"${hub.id === activeHubId ? " selected" : ""}>${esc(hub.name || hub.id)}</option>`).join("");
    hubSelect.onchange = async () => {
      activeHubId = hubSelect.value;
      activeProjectId = "";
      await loadProjects();
    };
    renderProjectSelect();
  }

  function renderProjectSelect() {
    const projectSelect = controlsEl?.querySelector("#fusion-project-select");
    if (!projectSelect) return;
    projectSelect.innerHTML = projects.map((project) => `<option value="${esc(project.id)}"${project.id === activeProjectId ? " selected" : ""}>${esc(project.name || project.id)}</option>`).join("");
    projectSelect.disabled = !projects.length;
    projectSelect.onchange = async () => {
      activeProjectId = projectSelect.value;
      await loadTopFolders();
    };
  }

  async function loadProjects() {
    if (!activeHubId) return;
    listEl.innerHTML = "";
    setStatus("Loading Fusion projects...");
    const data = await api(`/api/autodesk/hubs/${encodeURIComponent(activeHubId)}/projects`);
    projects = data.projects || [];
    activeProjectId = activeProjectId && projects.some((p) => p.id === activeProjectId) ? activeProjectId : projects[0]?.id || "";
    if (preferredMirrorTarget?.aps_project_id && projects.some((p) => p.id === preferredMirrorTarget.aps_project_id)) {
      activeProjectId = preferredMirrorTarget.aps_project_id;
    }
    renderProjectSelect();
    if (!activeProjectId) {
      setStatus("No Fusion projects found in this hub.");
      return;
    }
    await loadTopFolders();
  }

  async function loadTopFolders() {
    listEl.innerHTML = "";
    setStatus("Loading Fusion folders...");
    const data = await api(`/api/autodesk/hubs/${encodeURIComponent(activeHubId)}/projects/${encodeURIComponent(activeProjectId)}/top-folders`);
    setStatus("");
    renderFolders(data.folders || [], listEl, preferredMirrorTarget?.folder_id || "");
  }

  function renderFolders(folders, container, preferredFolderId = "") {
    container.innerHTML = "";
    if (!folders.length) {
      container.innerHTML = `<p class="muted small">No folders found.</p>`;
      return;
    }
    for (const folder of folders) {
      container.appendChild(folderRow(folder, folder.id === preferredFolderId));
    }
  }

  function folderRow(folder, autoOpen = false) {
    const item = document.createElement("div");
    item.className = "onshape-doc-item fusion-folder-item";
    item.innerHTML = `
      <div class="onshape-doc-header">
        <span class="onshape-doc-name"><span class="fusion-folder-glyph" aria-hidden="true">Folder</span> ${esc(folder.name || "Folder")}</span>
        <div class="fusion-row-actions">
          <button type="button" class="btn btn-compact btn-fusion-link-mirror${autoOpen ? " success" : ""}">${autoOpen ? "Linked mirror" : "Link mirror"}</button>
          <button type="button" class="btn btn-compact btn-fusion-import-folder">Import all</button>
          <button type="button" class="btn btn-compact btn-fusion-push">Push current model</button>
          <button type="button" class="btn-icon onshape-doc-toggle" title="Show folder contents" aria-expanded="false">
            <svg viewBox="0 0 10 10" width="10" height="10" fill="currentColor"><path d="M2 3l3 4 3-4H2z"/></svg>
          </button>
        </div>
      </div>
      <div class="onshape-doc-elements hidden"></div>
    `;
    const panel = item.querySelector(".onshape-doc-elements");
    const toggle = item.querySelector(".onshape-doc-toggle");
    toggle.addEventListener("click", () => {
      const open = panel.classList.toggle("hidden") === false;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.style.transform = open ? "rotate(0deg)" : "rotate(-90deg)";
      if (open && !panel.dataset.loaded) loadFolder(folder, panel);
    });
    item.querySelector(".btn-fusion-push")?.addEventListener("click", (event) => {
      pushToFolder(folder, event.currentTarget);
    });
    item.querySelector(".btn-fusion-link-mirror")?.addEventListener("click", (event) => {
      linkMirrorFolder(folder, event.currentTarget);
    });
    item.querySelector(".btn-fusion-import-folder")?.addEventListener("click", (event) => {
      importFolderItems(folder, event.currentTarget);
    });
    if (autoOpen) {
      item.classList.add("active");
      panel.classList.remove("hidden");
      toggle.setAttribute("aria-expanded", "true");
      toggle.style.transform = "rotate(0deg)";
      setTimeout(() => loadFolder(folder, panel), 0);
    }
    return item;
  }

  async function linkMirrorFolder(folder, btn) {
    const currentProjectId = getCurrentProjectId?.();
    if (!currentProjectId) {
      setStatus("Open a Render3D project before linking a Fusion mirror folder.", true);
      return;
    }
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Linking...";
    try {
      const hub = hubs.find((item) => item.id === activeHubId);
      const project = projects.find((item) => item.id === activeProjectId);
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/fusion-mirror`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          hub_id: activeHubId,
          hub_label: hub?.name || "",
          aps_project_id: activeProjectId,
          aps_project_label: project?.name || "",
          folder_id: folder.id,
          folder_label: folder.name || "Folder",
          team_id: getWorkspaceId?.() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Fusion mirror link failed (${res.status})`);
      }
      btn.textContent = "Linked ✓";
      btn.classList.add("success");
      preferredMirrorTarget = {
        hub_id: activeHubId,
        aps_project_id: activeProjectId,
        folder_id: folder.id,
        folder_label: folder.name || "Folder",
      };
      renderControls();
      setStatus(`Linked ${folder.name || "folder"} as your Fusion mirror for this Render3D project.`);
      onStatus?.("ok", "Fusion mirror folder linked.");
      onMirrorLinked?.();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = orig;
      setStatus(err.message || "Fusion mirror link failed.", true);
      onStatus?.("error", err.message || "Fusion mirror link failed.");
    }
  }

  async function syncLatestFromFusion(btn) {
    const currentProjectId = getCurrentProjectId?.();
    if (!currentProjectId) {
      setStatus("Open the Render3D project you want to sync from Fusion.", true);
      return;
    }
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Syncing...";
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/fusion-mirror/sync-from-fusion`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ import_bodies: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Fusion sync failed (${res.status})`);
      }
      const result = await res.json();
      btn.textContent = result.changed ? "Synced ✓" : "Already latest";
      btn.classList.toggle("success", !!result.changed);
      const pushed = result.pushed_mirrors?.length || 0;
      const errors = result.push_errors?.length || 0;
      if (!result.changed) {
        setStatus(result.message || "Render3D already has the latest Fusion version.");
      } else if (errors) {
        setStatus(`Pulled latest Fusion update into Render3D and pushed to ${pushed} mirror${pushed === 1 ? "" : "s"}; ${errors} mirror push failed.`, true);
      } else {
        setStatus(`Pulled latest Fusion update into Render3D and pushed to ${pushed} teammate mirror${pushed === 1 ? "" : "s"}.`);
      }
      onStatus?.(errors ? "error" : "ok", result.changed ? "Fusion update synced through Render3D." : "Fusion mirror already up to date.");
    } catch (err) {
      btn.disabled = false;
      btn.textContent = orig;
      setStatus(err.message || "Fusion sync failed.", true);
      onStatus?.("error", err.message || "Fusion sync failed.");
    }
  }

  async function loadFolder(folder, panel) {
    panel.dataset.loaded = "1";
    panel.innerHTML = `<p class="muted small loading-dots">Loading...</p>`;
    try {
      const data = await api(`/api/autodesk/projects/${encodeURIComponent(activeProjectId)}/folders/${encodeURIComponent(folder.id)}/contents`);
      panel.innerHTML = "";
      for (const child of data.folders || []) panel.appendChild(folderRow(child, child.id === preferredMirrorTarget?.folder_id));
      for (const file of data.items || []) panel.appendChild(itemRow(file, folder));
      if (!panel.children.length) panel.innerHTML = `<p class="muted small">Folder is empty.</p>`;
    } catch (err) {
      panel.innerHTML = `<p class="muted small error">${esc(err.message || "Failed to load folder.")}</p>`;
    }
  }

  function itemRow(file, folder) {
    const row = document.createElement("div");
    row.className = "onshape-elem-row fusion-file-row";
    row._fusionFolder = folder;
    row._fusionFile = file;
    const canImport = IMPORTABLE_EXTS.test(file.name || "");
    const imported = importedMap.get(file.id);
    row.innerHTML = `
      <span class="onshape-elem-type-badge">File</span>
      <span class="onshape-elem-name">${esc(file.name || "Untitled")}</span>
      <div class="onshape-elem-btns">
        ${imported ? `
          <button type="button" class="btn btn-compact btn-fusion-view">View</button>
          <button type="button" class="btn btn-compact btn-fusion-push-imported">Push update</button>
        ` : `
          <button type="button" class="btn btn-compact btn-fusion-import" title="${canImport ? "Import into Render3D" : "Auto-convert this Fusion design to STEP, then import"}">Import</button>
        `}
        ${file.web_url ? `<a class="btn btn-compact btn-onshape-view" target="_blank" rel="noopener" href="${esc(file.web_url)}">Open</a>` : ""}
      </div>
    `;
    if (imported) {
      row.querySelector(".btn-fusion-view")?.addEventListener("click", () => {
        onView?.(imported.projectId, imported.filename, imported.name);
      });
      row.querySelector(".btn-fusion-push-imported")?.addEventListener("click", (event) => {
        pushImportedProject(imported.projectId, event.currentTarget);
      });
    } else {
      row.querySelector(".btn-fusion-import")?.addEventListener("click", (event) => {
        showFileActionMenu(event, folder, file, row, event.currentTarget);
      });
    }
    row.addEventListener("contextmenu", (event) => showFileActionMenu(event, folder, file, row));
    return row;
  }

  function showFileActionMenu(event, folder, file, row, importBtn = null) {
    event.preventDefault();
    closeContextMenu();
    const imported = importedMap.get(file.id);
    const menu = document.createElement("div");
    menu.className = "folder-context-menu fusion-file-context-menu";
    menu.innerHTML = `
      ${imported ? `<button type="button" data-action="view-render3d">View in Render3D</button>` : `<button type="button" data-action="import">Import to Render3D</button>`}
      <button type="button" data-action="open">View in Fusion project</button>
    `;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const anchor = importBtn?.getBoundingClientRect?.();
    const x = anchor ? anchor.left : event.clientX;
    const y = anchor ? anchor.bottom + 4 : event.clientY;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    contextMenu = menu;
    menu.addEventListener("click", async (ev) => {
      const action = ev.target.closest("button")?.dataset.action;
      if (!action) return;
      closeContextMenu();
      if (action === "view-render3d" && imported) {
        onView?.(imported.projectId, imported.filename, imported.name);
      } else if (action === "import") {
        const btn = importBtn || row?.querySelector?.(".btn-fusion-import");
        if (btn) importItem(folder, file, row, btn);
      } else if (action === "open") {
        viewInFusionProject(file);
      }
    });
    setTimeout(() => {
      document.addEventListener("pointerdown", onOutsideContextMenu, { once: true });
      document.addEventListener("keydown", onContextMenuKeydown, { once: true });
    }, 0);
  }

  function onOutsideContextMenu(event) {
    if (contextMenu?.contains(event.target)) return;
    closeContextMenu();
  }

  function onContextMenuKeydown(event) {
    if (event.key === "Escape") closeContextMenu();
  }

  function viewInFusionProject(file) {
    if (!file.web_url) {
      const message = "Autodesk did not provide a browser view link for this item.";
      setStatus(message, true);
      onStatus?.("error", message);
      return;
    }
    window.open(file.web_url, "_blank", "noopener");
  }

  async function importFusionFile(folder, file) {
    const res = await fetch("/api/autodesk/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        aps_project_id: activeProjectId,
        hub_id: activeHubId,
        folder_id: folder.id,
        item_id: file.id,
        version_id: file.version_id || null,
        name: file.name || "autodesk_import",
        team_id: getWorkspaceId?.() || null,
        import_bodies: true,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Fusion import failed (${res.status})`);
    }
    return res.json();
  }

  async function importMany(items, btn, label = "items") {
    const pending = (items || []).filter(({ file }) => file?.id && !importedMap.has(file.id));
    if (!pending.length) {
      setStatus(`No new Fusion ${label} to import.`);
      return;
    }
    const orig = btn?.textContent || "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = `Importing 0/${pending.length}...`;
    }
    let importedCount = 0;
    let firstResult = null;
    try {
      for (const { folder, file, row } of pending) {
        const result = await importFusionFile(folder, file);
        importedMap.set(file.id, { projectId: result.project_id, filename: result.filename, name: result.name });
        importedCount += 1;
        firstResult ||= result;
        if (btn) btn.textContent = `Importing ${importedCount}/${pending.length}...`;
        if (row) markRowImported(row, file, result);
      }
      if (btn) {
        btn.textContent = "Imported all ✓";
        btn.classList.add("success");
      }
      setStatus(`Imported ${importedCount} Fusion ${importedCount === 1 ? "item" : "items"}.`);
      onStatus?.("ok", `Imported ${importedCount} Fusion ${importedCount === 1 ? "item" : "items"}.`);
      if (firstResult) onImported?.(firstResult.project_id, firstResult.filename, firstResult.name);
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = orig;
      }
      setStatus(`${importedCount ? `Imported ${importedCount}, then failed: ` : ""}${err.message || "Fusion import failed."}`, true);
      onStatus?.("error", err.message || "Fusion import failed.");
    }
  }

  function importVisibleItems(btn) {
    const rows = [...listEl.querySelectorAll(".fusion-file-row")];
    const items = rows
      .map((row) => ({ folder: row._fusionFolder, file: row._fusionFile, row }))
      .filter(({ folder, file }) => folder?.id && file?.id);
    void importMany(items, btn, "visible items");
  }

  async function collectFolderItems(folder) {
    const data = await api(`/api/autodesk/projects/${encodeURIComponent(activeProjectId)}/folders/${encodeURIComponent(folder.id)}/contents`);
    const ownItems = (data.items || []).map((file) => ({ folder, file }));
    const childGroups = await Promise.all((data.folders || []).map((child) => collectFolderItems(child)));
    return [...ownItems, ...childGroups.flat()];
  }

  async function importFolderItems(folder, btn) {
    const orig = btn?.textContent || "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Scanning...";
    }
    try {
      const items = await collectFolderItems(folder);
      if (btn) btn.textContent = "Importing...";
      await importMany(items, btn, "folder items");
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = orig;
      }
      setStatus(err.message || "Could not import Fusion folder.", true);
      onStatus?.("error", err.message || "Could not import Fusion folder.");
    }
  }

  function markRowImported(row, file, result) {
    const btns = row.querySelector(".onshape-elem-btns");
    if (!btns) return;
    btns.innerHTML = `
      <button type="button" class="btn btn-compact btn-fusion-view">View</button>
      <button type="button" class="btn btn-compact btn-fusion-push-imported">Push update</button>
      ${file.web_url ? `<a class="btn btn-compact btn-onshape-view" target="_blank" rel="noopener" href="${esc(file.web_url)}">Open</a>` : ""}
    `;
    btns.querySelector(".btn-fusion-view")?.addEventListener("click", () => {
      onView?.(result.project_id, result.filename, result.name);
    });
    btns.querySelector(".btn-fusion-push-imported")?.addEventListener("click", (event) => {
      pushImportedProject(result.project_id, event.currentTarget);
    });
  }

  async function importItem(folder, file, row, btn) {
    const orig = btn.textContent;
    const canImportDirectly = IMPORTABLE_EXTS.test(file.name || "");
    btn.disabled = true;
    btn.textContent = canImportDirectly ? "Importing..." : "Converting...";
    setStatus(canImportDirectly
      ? `Importing ${file.name || "Autodesk file"}...`
      : `Converting ${file.name || "Fusion design"} to STEP, then importing...`);
    try {
      const result = await importFusionFile(folder, file);
      importedMap.set(file.id, { projectId: result.project_id, filename: result.filename, name: result.name });
      btn.textContent = "Imported ✓";
      btn.classList.add("success");
      markRowImported(row, file, result);
      setStatus(`Imported ${result.name || file.name}.`);
      onStatus?.("ok", `Imported ${result.name || file.name} from Fusion.`);
      onImported?.(result.project_id, result.filename, result.name);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = orig;
      setStatus(err.message || "Fusion import failed.", true);
      onStatus?.("error", err.message || "Fusion import failed.");
    }
  }

  async function pushImportedProject(importedProjectId, btn) {
    if (!importedProjectId) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Pushing...";
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(importedProjectId)}/push-to-autodesk`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Fusion push failed (${res.status})`);
      }
      const result = await res.json();
      btn.textContent = "Pushed ✓";
      btn.classList.add("success");
      setStatus(`Pushed ${result.name || "STEP"} back to Fusion.`);
      onStatus?.("ok", `Pushed ${result.name || "STEP"} back to Fusion.`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = orig;
      setStatus(err.message || "Fusion push failed.", true);
      onStatus?.("error", err.message || "Fusion push failed.");
    }
  }

  async function pushToFolder(folder, btn) {
    const currentProjectId = getCurrentProjectId?.();
    if (!currentProjectId) {
      setStatus("Open or create a Render3D project before pushing to Fusion.", true);
      return;
    }
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Pushing...";
    try {
      const data = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/push-to-autodesk`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          hub_id: activeHubId,
          hub_label: hubs.find((item) => item.id === activeHubId)?.name || "",
          aps_project_id: activeProjectId,
          aps_project_label: projects.find((item) => item.id === activeProjectId)?.name || "",
          folder_id: folder.id,
          folder_label: folder.name || "",
          filename: getSelectedFile?.() || null,
          team_id: getWorkspaceId?.() || null,
        }),
      });
      if (!data.ok) {
        const err = await data.json().catch(() => ({}));
        throw new Error(err.detail || `Fusion push failed (${data.status})`);
      }
      const result = await data.json();
      btn.textContent = "Pushed ✓";
      btn.classList.add("success");
      const mirrorCount = result.pushed_mirrors?.length || 0;
      const mirrorErrors = result.push_errors?.length || 0;
      const mirrorNote = mirrorErrors
        ? ` Pushed to ${mirrorCount} teammate mirror${mirrorCount === 1 ? "" : "s"}; ${mirrorErrors} failed.`
        : mirrorCount
          ? ` Also pushed to ${mirrorCount} teammate mirror${mirrorCount === 1 ? "" : "s"}.`
          : "";
      setStatus(`Pushed ${result.name || "STEP"} to ${folder.name}. Saved as your Fusion mirror.${mirrorNote}`, mirrorErrors > 0);
      onStatus?.(mirrorErrors ? "error" : "ok", `Pushed ${result.name || "STEP"} to your Fusion mirror.${mirrorNote}`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = orig;
      setStatus(err.message || "Fusion push failed.", true);
      onStatus?.("error", err.message || "Fusion push failed.");
    }
  }

  btnRefresh?.addEventListener("click", () => loadHubs());
  window.addEventListener("render3d:autodesk-linked", () => {
    loadHubs();
    section?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  });
  window.addEventListener("render3d:open-fusion-library", () => {
    loadHubs();
  });
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      observer.disconnect();
      loadHubs();
    }
  }, { threshold: 0.1 });
  observer.observe(section);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}