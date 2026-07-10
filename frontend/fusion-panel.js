/** Fusion Library panel — browse Autodesk/Fusion hubs, import models, and push STEP updates. */

import { authHeaders } from "./auth.js";

const IMPORTABLE_EXTS = /\.(step|stp|stl|3mf|obj|glb|gltf)$/i;

export function initFusionPanel({ api, getCurrentProjectId, getCurrentProjectLabel, getSelectedFile, getWorkspaceId, onImported, onView, onOpenProject, onStatus, onMirrorLinked } = {}) {
  const section = document.getElementById("fusion-library-section");
  if (!section) return;

  const statusEl = section.querySelector(".fusion-status");
  const browsePanel = section.querySelector('[data-fusion-panel="browse"]');
  const mirrorsPanel = section.querySelector('[data-fusion-panel="mirrors"]');
  const controlsEl = browsePanel?.querySelector(".fusion-library-controls");
  const listEl = browsePanel?.querySelector(".fusion-doc-list");
  const mirrorsSummaryEl = mirrorsPanel?.querySelector(".fusion-mirrors-summary");
  const mirrorsListEl = mirrorsPanel?.querySelector(".fusion-mirrors-list");
  const tabButtons = [...section.querySelectorAll(".fusion-library-tab")];
  const btnRefresh = section.querySelector(".btn-fusion-refresh");

  let activeTab = "browse";
  let accountMirrors = [];

  let hubs = [];
  let projects = [];
  let topFolders = [];
  let libraryItems = [];
  let linkedAccount = null;
  let activeHubId = "";
  let activeProjectId = "";
  let activeFolderId = "";
  let activeItemId = "";
  let preferredMirrorTarget = null;
  let mirrorStale = false;
  let mirrorStaleMessage = "";
  const importedMap = new Map();
  let contextMenu = null;

  function updateMirrorStaleState() {
    if (!preferredMirrorTarget) {
      mirrorStale = false;
      mirrorStaleMessage = "";
      return;
    }
    if (preferredMirrorTarget.hub_id && hubs.length && !hubs.some((hub) => hub.id === preferredMirrorTarget.hub_id)) {
      mirrorStale = true;
      mirrorStaleMessage = `Your saved mirror points to hub "${preferredMirrorTarget.hub_label || preferredMirrorTarget.hub_id}", which is no longer accessible. Unlink it, then link a folder on a hub you can open.`;
      return;
    }
    if (preferredMirrorTarget.contents?.needs_relink) {
      mirrorStale = true;
      mirrorStaleMessage = preferredMirrorTarget.contents.error || "Your saved Fusion mirror is no longer accessible. Unlink it, then link the folder again.";
      return;
    }
    mirrorStale = false;
    mirrorStaleMessage = "";
  }

  function linkedMirrorFolderId() {
    if (!preferredMirrorTarget || mirrorStale) return "";
    if (preferredMirrorTarget.hub_id && preferredMirrorTarget.hub_id !== activeHubId) return "";
    if (preferredMirrorTarget.aps_project_id && preferredMirrorTarget.aps_project_id !== activeProjectId) return "";
    return preferredMirrorTarget.folder_id || "";
  }

  async function syncMirrorUiFromCurrentProject() {
    if (!linkedAccount || !hubs.length) return;
    preferredMirrorTarget = await loadPreferredMirrorTarget();
    updateMirrorStaleState();
    if (preferredMirrorTarget?.hub_id && hubs.some((hub) => hub.id === preferredMirrorTarget.hub_id) && !mirrorStale) {
      activeHubId = preferredMirrorTarget.hub_id;
    }
    renderControls();
    if (activeHubId) await loadProjects();
  }

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.className = `fusion-status muted small${isError ? " error" : ""}`;
  }

  function setActiveTab(tab) {
    activeTab = tab === "mirrors" ? "mirrors" : "browse";
    tabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.fusionTab === activeTab);
    });
    browsePanel?.classList.toggle("hidden", activeTab !== "browse");
    mirrorsPanel?.classList.toggle("hidden", activeTab !== "mirrors");
  }

  function wireTabButtons() {
    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.fusionTab === "mirrors" ? "mirrors" : "browse";
        if (tab === activeTab) return;
        setActiveTab(tab);
        if (tab === "mirrors") void loadAllMirrors();
        else if (linkedAccount) void loadHubs();
      });
    });
  }

  function formatMirrorWhen(value) {
    if (!value) return "Never";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  async function loadAllMirrors() {
    if (!mirrorsListEl) return;
    mirrorsListEl.innerHTML = `<p class="muted small loading-dots">Loading linked mirrors...</p>`;
    if (mirrorsSummaryEl) mirrorsSummaryEl.textContent = "";
    try {
      const status = await api("/api/autodesk/status");
      if (!status?.linked) {
        mirrorsListEl.innerHTML = `<p class="muted small">Connect Fusion 360 from your profile menu to manage linked mirrors.</p>`;
        return;
      }
      const data = await api("/api/autodesk/fusion-mirrors?include_access=true");
      accountMirrors = data.mirrors || [];
      const accountLabel = data.autodesk_email || data.autodesk_name || data.account_email || "your account";
      if (mirrorsSummaryEl) {
        mirrorsSummaryEl.textContent = accountMirrors.length
          ? `${accountMirrors.length} linked mirror${accountMirrors.length === 1 ? "" : "s"} for ${accountLabel}.`
          : `No linked Fusion mirrors saved for ${accountLabel} yet.`;
      }
      renderMirrorsList();
      const staleCount = accountMirrors.filter((mirror) => mirror.access?.needs_relink).length;
      if (mirrorsSummaryEl && staleCount) {
        mirrorsSummaryEl.innerHTML = `
          <span>${accountMirrors.length} linked mirror${accountMirrors.length === 1 ? "" : "s"} for ${esc(accountLabel)} · ${staleCount} stale.</span>
          <button type="button" class="btn btn-compact btn-fusion-cleanup-stale">Remove ${staleCount} stale mirror${staleCount === 1 ? "" : "s"}</button>
        `;
        mirrorsSummaryEl.querySelector(".btn-fusion-cleanup-stale")?.addEventListener("click", (event) => {
          void cleanupStaleMirrors(event.currentTarget);
        });
      }
      if (activeTab === "mirrors") {
        setStatus(accountMirrors.length
          ? `Showing ${accountMirrors.length} linked mirror${accountMirrors.length === 1 ? "" : "s"} for ${accountLabel}.`
          : `No linked mirrors for ${accountLabel}. Use Browse to link a folder.`);
      }
    } catch (err) {
      mirrorsListEl.innerHTML = `<p class="muted small error">${esc(err.message || "Could not load linked mirrors.")}</p>`;
      setStatus(err.message || "Could not load linked mirrors.", true);
    }
  }

  async function cleanupStaleMirrors(btn) {
    const orig = btn?.textContent || "Remove stale mirrors";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Removing...";
    }
    try {
      const res = await fetch("/api/autodesk/fusion-mirrors/cleanup-stale", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: "{}",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Cleanup failed (${res.status})`);
      }
      const result = await res.json();
      if (getCurrentProjectId?.()) {
        preferredMirrorTarget = await loadPreferredMirrorTarget();
        updateMirrorStaleState();
      }
      await loadAllMirrors();
      if (linkedAccount && activeTab === "browse" && activeHubId) await loadProjects();
      setStatus(`Removed ${result.count || 0} stale Fusion mirror${result.count === 1 ? "" : "s"}.`);
      onStatus?.("ok", `Removed ${result.count || 0} stale Fusion mirror${result.count === 1 ? "" : "s"}.`);
      onMirrorLinked?.();
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = orig;
      }
      setStatus(err.message || "Could not remove stale Fusion mirrors.", true);
      onStatus?.("error", err.message || "Could not remove stale Fusion mirrors.");
    }
  }

  function renderMirrorsList() {
    if (!mirrorsListEl) return;
    if (!accountMirrors.length) {
      mirrorsListEl.innerHTML = `<p class="muted small">Open Browse, pick a Fusion hub/project/folder, then click <strong>Link mirror</strong> on the folder you want.</p>`;
      return;
    }
    mirrorsListEl.innerHTML = accountMirrors.map((mirror) => {
      const stale = !!mirror.access?.needs_relink;
      const render3dName = mirror.render3d_project_name || mirror.project_id;
      const fusionPath = [
        mirror.hub_label || mirror.hub_id || "Hub",
        mirror.aps_project_label || mirror.aps_project_id || "Project",
        mirror.folder_label || mirror.folder_id || "Folder",
      ].join(" / ");
      const currentProjectId = getCurrentProjectId?.();
      const isCurrent = currentProjectId && currentProjectId === mirror.project_id;
      return `
        <article class="fusion-mirror-card${stale ? " stale" : ""}" data-mirror-project-id="${esc(mirror.project_id)}">
          <div class="fusion-mirror-card-head">
            <div class="fusion-mirror-card-title">${esc(render3dName)}${isCurrent ? " · open now" : ""}</div>
            <span class="fusion-mirror-card-badge">${stale ? "Needs re-link" : "Linked"}</span>
          </div>
          <p class="muted small fusion-mirror-card-meta">
            Render3D project <code>${esc(mirror.project_id)}</code>${mirror.team_name ? ` · ${esc(mirror.team_name)}` : ""}
          </p>
          <p class="muted small fusion-mirror-card-path">Fusion: ${esc(fusionPath)}</p>
          ${stale && mirror.access?.error ? `<p class="muted small error">${esc(mirror.access.error)}</p>` : ""}
          <p class="muted small fusion-mirror-card-meta">Updated ${esc(formatMirrorWhen(mirror.updated_at))}${mirror.last_pushed_at ? ` · Last push ${esc(formatMirrorWhen(mirror.last_pushed_at))}` : ""}</p>
          <div class="fusion-mirror-card-actions">
            <button type="button" class="btn btn-compact btn-fusion-open-mirror-project">Open Render3D project</button>
            <button type="button" class="btn btn-compact btn-fusion-goto-mirror-folder"${stale ? " disabled" : ""}>Show in Browse</button>
            <button type="button" class="btn btn-compact btn-fusion-unlink-mirror-project">${stale ? "Remove stale link" : "Unlink"}</button>
          </div>
        </article>
      `;
    }).join("");

    mirrorsListEl.querySelectorAll(".btn-fusion-open-mirror-project").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const card = event.currentTarget.closest("[data-mirror-project-id]");
        const projectId = card?.dataset.mirrorProjectId;
        if (!projectId) return;
        const orig = event.currentTarget.textContent;
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = "Opening...";
        try {
          await onOpenProject?.(projectId);
          setStatus(`Opened Render3D project ${projectId}.`);
          setActiveTab("browse");
          await syncMirrorUiFromCurrentProject();
        } catch (err) {
          setStatus(err.message || "Could not open Render3D project.", true);
        } finally {
          event.currentTarget.disabled = false;
          event.currentTarget.textContent = orig;
        }
      });
    });

    mirrorsListEl.querySelectorAll(".btn-fusion-goto-mirror-folder").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const card = event.currentTarget.closest("[data-mirror-project-id]");
        const mirror = accountMirrors.find((item) => item.project_id === card?.dataset.mirrorProjectId);
        if (!mirror || mirror.access?.needs_relink) return;
        setActiveTab("browse");
        await navigateToMirror(mirror);
      });
    });

    mirrorsListEl.querySelectorAll(".btn-fusion-unlink-mirror-project").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const card = event.currentTarget.closest("[data-mirror-project-id]");
        const projectId = card?.dataset.mirrorProjectId;
        if (!projectId) return;
        await unlinkMirrorByProjectId(projectId, event.currentTarget);
      });
    });
  }

  async function navigateToMirror(mirror) {
    if (!mirror || !linkedAccount) {
      await loadHubs();
    }
    if (!hubs.length) return;
    preferredMirrorTarget = mirror;
    mirrorStale = false;
    mirrorStaleMessage = "";
    if (mirror.hub_id && hubs.some((hub) => hub.id === mirror.hub_id)) {
      activeHubId = mirror.hub_id;
    }
    renderControls();
    await loadProjects();
    if (getCurrentProjectId?.() !== mirror.project_id) {
      setStatus(`Showing Fusion folder for Render3D project ${mirror.render3d_project_name || mirror.project_id}. Open that project to link or push.`);
    }
  }

  async function unlinkMirrorByProjectId(projectId, btn) {
    const orig = btn?.textContent || "Unlink";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Unlinking...";
    }
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/fusion-mirror`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Fusion mirror unlink failed (${res.status})`);
      }
      accountMirrors = accountMirrors.filter((mirror) => mirror.project_id !== projectId);
      if (getCurrentProjectId?.() === projectId) {
        preferredMirrorTarget = null;
        mirrorStale = false;
        mirrorStaleMessage = "";
        renderControls();
        if (activeProjectId) await loadTopFolders();
      }
      renderMirrorsList();
      if (mirrorsSummaryEl) {
        const accountLabel = linkedAccount?.autodesk_email || linkedAccount?.autodesk_name || "your account";
        mirrorsSummaryEl.textContent = accountMirrors.length
          ? `${accountMirrors.length} linked mirror${accountMirrors.length === 1 ? "" : "s"} for ${accountLabel}.`
          : `No linked Fusion mirrors saved for ${accountLabel} yet.`;
      }
      setStatus(`Removed Fusion mirror link from Render3D project ${projectId}.`);
      onStatus?.("ok", "Fusion mirror unlinked.");
      onMirrorLinked?.();
      window.dispatchEvent(new CustomEvent("render3d:fusion-mirror-changed"));
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = orig;
      }
      setStatus(err.message || "Fusion mirror unlink failed.", true);
      onStatus?.("error", err.message || "Fusion mirror unlink failed.");
    }
  }

  async function loadHubs() {
    if (!controlsEl || !listEl) return;
    controlsEl.innerHTML = "";
    listEl.innerHTML = "";
    setStatus("Loading Fusion account...");
    try {
      const status = await api("/api/autodesk/status");
      linkedAccount = status?.linked ? status : null;
      if (!linkedAccount) {
        setStatus("Connect Fusion 360 from your profile menu to browse your library.");
        renderDisconnectedControls();
        return;
      }
      const accountLabel = linkedAccount.autodesk_email || linkedAccount.autodesk_name || "Autodesk account";
      setStatus(`Connected as ${accountLabel}. Pick a hub, project, folder, and model below.`);
      const data = await api("/api/autodesk/hubs");
      hubs = data.hubs || [];
      if (!hubs.length) {
        setStatus(`Connected as ${accountLabel}, but no Fusion hubs were found.`);
        renderAccountControls();
        return;
      }
      preferredMirrorTarget = await loadPreferredMirrorTarget();
      updateMirrorStaleState();
      activeHubId = activeHubId && hubs.some((h) => h.id === activeHubId) ? activeHubId : hubs[0].id;
      if (preferredMirrorTarget?.hub_id && hubs.some((h) => h.id === preferredMirrorTarget.hub_id) && !mirrorStale) {
        activeHubId = preferredMirrorTarget.hub_id;
      }
      if (mirrorStale) {
        setStatus(mirrorStaleMessage, true);
      }
      renderControls();
      await loadProjects();
    } catch (err) {
      const msg = err.message || "Could not load Fusion library.";
      setStatus(/not linked|401/i.test(msg) ? "Connect Autodesk to browse your Fusion library." : msg, !/not linked|401/i.test(msg));
      if (/not linked|401/i.test(msg)) renderDisconnectedControls();
    }
  }

  function renderDisconnectedControls() {
    controlsEl.innerHTML = `
      <button type="button" class="btn btn-compact btn-fusion-connect-account">Connect Fusion 360</button>
    `;
    controlsEl.querySelector(".btn-fusion-connect-account")?.addEventListener("click", () => {
      window.location.href = "/oauth/autodesk/start";
    });
  }

  async function disconnectAutodeskAccount(btn) {
    const accountLabel = linkedAccount?.autodesk_email || linkedAccount?.autodesk_name || "this Fusion account";
    if (!window.confirm(`Disconnect ${accountLabel}? You can connect a different Autodesk account afterward.`)) return;
    const orig = btn?.textContent || "Disconnect";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Disconnecting...";
    }
    try {
      const res = await fetch("/api/autodesk/unlink", { method: "DELETE", headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Fusion disconnect failed (${res.status})`);
      }
      linkedAccount = null;
      hubs = [];
      projects = [];
      topFolders = [];
      libraryItems = [];
      activeHubId = "";
      activeProjectId = "";
      activeFolderId = "";
      activeItemId = "";
      preferredMirrorTarget = null;
      mirrorStale = false;
      mirrorStaleMessage = "";
      accountMirrors = [];
      importedMap.clear();
      controlsEl.innerHTML = "";
      listEl.innerHTML = "";
      if (mirrorsListEl) mirrorsListEl.innerHTML = "";
      if (mirrorsSummaryEl) mirrorsSummaryEl.textContent = "";
      setStatus("Fusion account disconnected. Connect a new Autodesk account from your profile menu.");
      onStatus?.("ok", "Fusion account disconnected.");
      window.dispatchEvent(new CustomEvent("render3d:autodesk-unlinked"));
      renderDisconnectedControls();
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = orig;
      }
      setStatus(err.message || "Fusion disconnect failed.", true);
      onStatus?.("error", err.message || "Fusion disconnect failed.");
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
      mirrorStale = false;
      mirrorStaleMessage = "";
      setStatus("Fusion mirror unlinked. Choose a hub, project, and folder to link a new mirror.");
      onStatus?.("ok", "Fusion mirror unlinked.");
      onMirrorLinked?.();
      renderControls();
      if (activeProjectId) await loadTopFolders();
      if (activeTab === "mirrors") void loadAllMirrors();
      window.dispatchEvent(new CustomEvent("render3d:fusion-mirror-changed"));
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

  function renderAccountControls() {
    controlsEl.innerHTML = `
      <div class="fusion-account-row">
        <span class="fusion-account-label">${esc(linkedAccount?.autodesk_email || linkedAccount?.autodesk_name || "Connected")}</span>
        <button type="button" class="btn btn-compact btn-fusion-disconnect-account" title="Disconnect this Autodesk account so you can connect a different one.">Disconnect account</button>
      </div>
    `;
    controlsEl.querySelector(".btn-fusion-disconnect-account")?.addEventListener("click", (event) => {
      disconnectAutodeskAccount(event.currentTarget);
    });
  }

  function renderControls() {
    const accountLabel = linkedAccount?.autodesk_email || linkedAccount?.autodesk_name || "Connected";
    const currentProjectId = getCurrentProjectId?.();
    const currentProjectLabel = currentProjectId
      ? (getCurrentProjectLabel?.() || currentProjectId)
      : "None open — open a Render3D project first";
    controlsEl.innerHTML = `
      <div class="fusion-account-row">
        <span class="fusion-account-label">${esc(accountLabel)}</span>
        <button type="button" class="btn btn-compact btn-fusion-disconnect-account" title="Disconnect this Autodesk account so you can connect a different one.">Disconnect account</button>
      </div>
      <p class="fusion-mirror-target muted small${currentProjectId ? "" : " error"}">
        Linking mirror to Render3D project: <strong>${esc(currentProjectLabel)}</strong>
      </p>
      ${mirrorStale ? `<p class="fusion-mirror-stale muted small error">${esc(mirrorStaleMessage)}</p>` : ""}
      <label class="fusion-library-field">
        <span>Hub</span>
        <select id="fusion-hub-select"></select>
      </label>
      <label class="fusion-library-field">
        <span>Project</span>
        <select id="fusion-project-select"></select>
      </label>
      <label class="fusion-library-field">
        <span>Folder</span>
        <select id="fusion-folder-select"></select>
      </label>
      <label class="fusion-library-field">
        <span>Model</span>
        <select id="fusion-model-select"></select>
      </label>
      <div class="fusion-library-actions">
        <button type="button" class="btn btn-compact btn-fusion-import-selected" title="Import the model selected above into Render3D.">Import selected</button>
        ${preferredMirrorTarget && !mirrorStale ? '<button type="button" class="btn btn-compact btn-fusion-unlink-mirror" title="Unlink this Render3D project from the currently selected Fusion mirror folder.">Unlink mirror</button>' : ""}
        ${mirrorStale ? '<button type="button" class="btn btn-compact btn-fusion-unlink-mirror" title="Remove the stale Fusion mirror saved on this Render3D project.">Clear stale mirror</button>' : ""}
        <button type="button" class="btn btn-compact btn-fusion-import-visible" title="Import every file currently shown in open Fusion folders.">Import all visible</button>
        <button type="button" class="btn btn-compact btn-fusion-sync-latest" title="Pull the newest version from your linked Fusion mirror, update Render3D, then push to teammates' mirrors.">Sync latest from Fusion</button>
      </div>
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
    controlsEl.querySelector(".btn-fusion-disconnect-account")?.addEventListener("click", (event) => {
      disconnectAutodeskAccount(event.currentTarget);
    });
    controlsEl.querySelector(".btn-fusion-import-selected")?.addEventListener("click", (event) => {
      importSelectedModel(event.currentTarget);
    });
    const hubSelect = controlsEl.querySelector("#fusion-hub-select");
    hubSelect.innerHTML = hubs.map((hub) => `<option value="${esc(hub.id)}"${hub.id === activeHubId ? " selected" : ""}>${esc(hub.name || hub.id)}</option>`).join("");
    hubSelect.onchange = async () => {
      activeHubId = hubSelect.value;
      activeProjectId = "";
      activeFolderId = "";
      activeItemId = "";
      libraryItems = [];
      topFolders = [];
      await loadProjects();
    };
    renderProjectSelect();
    renderFolderSelect();
    renderModelSelect();
  }

  function folderById(folderId) {
    return topFolders.find((folder) => folder.id === folderId) || { id: folderId, name: "Folder" };
  }

  function renderFolderSelect() {
    const folderSelect = controlsEl?.querySelector("#fusion-folder-select");
    if (!folderSelect) return;
    if (!topFolders.length) {
      folderSelect.innerHTML = `<option value="">No folders in this project</option>`;
      folderSelect.disabled = true;
      return;
    }
    folderSelect.disabled = false;
    folderSelect.innerHTML = topFolders
      .map((folder) => `<option value="${esc(folder.id)}"${folder.id === activeFolderId ? " selected" : ""}>${esc(folder.name || "Folder")}</option>`)
      .join("");
    folderSelect.onchange = async () => {
      activeFolderId = folderSelect.value;
      activeItemId = "";
      await loadFolderLibraryItems(activeFolderId);
      highlightFolderInTree(activeFolderId);
    };
  }

  function renderModelSelect() {
    const modelSelect = controlsEl?.querySelector("#fusion-model-select");
    if (!modelSelect) return;
    if (!activeFolderId) {
      modelSelect.innerHTML = `<option value="">Select a folder first</option>`;
      modelSelect.disabled = true;
      return;
    }
    if (!libraryItems.length) {
      modelSelect.innerHTML = `<option value="">No models in this folder</option>`;
      modelSelect.disabled = true;
      return;
    }
    modelSelect.disabled = false;
    if (!activeItemId || !libraryItems.some((item) => item.id === activeItemId)) {
      activeItemId = libraryItems[0]?.id || "";
    }
    modelSelect.innerHTML = libraryItems
      .map((file) => `<option value="${esc(file.id)}"${file.id === activeItemId ? " selected" : ""}>${esc(file.name || "Untitled")}</option>`)
      .join("");
    modelSelect.value = activeItemId;
    modelSelect.onchange = () => {
      activeItemId = modelSelect.value;
    };
  }

  async function loadFolderLibraryItems(folderId) {
    if (!folderId || !activeProjectId) {
      libraryItems = [];
      renderModelSelect();
      return;
    }
    try {
      const data = await api(`/api/autodesk/projects/${encodeURIComponent(activeProjectId)}/folders/${encodeURIComponent(folderId)}/contents`);
      libraryItems = data.items || [];
      renderModelSelect();
      const folderName = folderById(folderId).name || "folder";
      if (libraryItems.length) {
        setStatus(`${libraryItems.length} model${libraryItems.length === 1 ? "" : "s"} in ${folderName}.`);
      } else {
        setStatus(`Folder "${folderName}" has no importable models yet.`);
      }
    } catch (err) {
      libraryItems = [];
      renderModelSelect();
      setStatus(err.message || "Could not load folder models.", true);
    }
  }

  function highlightFolderInTree(folderId) {
    if (!folderId || !listEl) return;
    listEl.querySelectorAll(".fusion-folder-item").forEach((item) => {
      const toggle = item.querySelector(".onshape-doc-toggle");
      const panel = item.querySelector(".onshape-doc-elements");
      const folder = item._fusionFolder;
      const isMatch = folder?.id === folderId;
      item.classList.toggle("active", isMatch);
      if (isMatch && panel && toggle) {
        panel.classList.remove("hidden");
        toggle.setAttribute("aria-expanded", "true");
        toggle.style.transform = "rotate(0deg)";
        if (!panel.dataset.loaded) {
          loadFolder(folder, panel);
        }
      }
    });
  }

  async function importSelectedModel(btn) {
    const file = libraryItems.find((item) => item.id === activeItemId);
    if (!file || !activeFolderId) {
      setStatus("Select a folder and model from the dropdowns first.", true);
      return;
    }
    await importItem(folderById(activeFolderId), file, null, btn);
  }

  function renderProjectSelect() {
    const projectSelect = controlsEl?.querySelector("#fusion-project-select");
    if (!projectSelect) return;
    projectSelect.innerHTML = projects.map((project) => `<option value="${esc(project.id)}"${project.id === activeProjectId ? " selected" : ""}>${esc(project.name || project.id)}</option>`).join("");
    projectSelect.disabled = !projects.length;
    projectSelect.onchange = async () => {
      activeProjectId = projectSelect.value;
      activeFolderId = "";
      activeItemId = "";
      libraryItems = [];
      topFolders = [];
      renderFolderSelect();
      renderModelSelect();
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
    if (!mirrorStale && preferredMirrorTarget?.aps_project_id && projects.some((p) => p.id === preferredMirrorTarget.aps_project_id)) {
      activeProjectId = preferredMirrorTarget.aps_project_id;
    }
    renderProjectSelect();
    renderFolderSelect();
    renderModelSelect();
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
    topFolders = data.folders || [];
    activeFolderId = activeFolderId && topFolders.some((folder) => folder.id === activeFolderId)
      ? activeFolderId
      : (linkedMirrorFolderId() && topFolders.some((folder) => folder.id === linkedMirrorFolderId())
        ? linkedMirrorFolderId()
        : topFolders[0]?.id || "");
    renderFolderSelect();
    setStatus("");
    renderFolders(topFolders, listEl, linkedMirrorFolderId());
    if (activeFolderId) {
      await loadFolderLibraryItems(activeFolderId);
      highlightFolderInTree(activeFolderId);
    } else {
      libraryItems = [];
      renderModelSelect();
      setStatus("No folders found in this Fusion project.");
    }
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
    item._fusionFolder = folder;
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
      const payload = await res.json().catch(() => ({}));
      preferredMirrorTarget = payload.mirror || {
        hub_id: activeHubId,
        hub_label: hub?.name || "",
        aps_project_id: activeProjectId,
        aps_project_label: project?.name || "",
        folder_id: folder.id,
        folder_label: folder.name || "Folder",
      };
      mirrorStale = false;
      mirrorStaleMessage = "";
      activeFolderId = folder.id;
      renderControls();
      await loadTopFolders();
      const projectLabel = getCurrentProjectLabel?.() || getCurrentProjectId?.() || "this project";
      setStatus(`Linked "${folder.name || "folder"}" as the Fusion mirror for ${projectLabel}.`);
      onStatus?.("ok", "Fusion mirror folder linked.");
      onMirrorLinked?.();
      if (activeTab === "mirrors") void loadAllMirrors();
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
      for (const child of data.folders || []) panel.appendChild(folderRow(child, child.id === linkedMirrorFolderId()));
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
    if (!row) return;
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
    const orig = btn?.textContent || "Import";
    const canImportDirectly = IMPORTABLE_EXTS.test(file.name || "");
    if (btn) {
      btn.disabled = true;
      btn.textContent = canImportDirectly ? "Importing..." : "Converting...";
    }
    setStatus(canImportDirectly
      ? `Importing ${file.name || "Autodesk file"}...`
      : `Converting ${file.name || "Fusion design"} to STEP, then importing...`);
    try {
      const result = await importFusionFile(folder, file);
      importedMap.set(file.id, { projectId: result.project_id, filename: result.filename, name: result.name });
      if (btn) {
        btn.textContent = "Imported ✓";
        btn.classList.add("success");
      }
      markRowImported(row, file, result);
      setStatus(`Imported ${result.name || file.name}.`);
      onStatus?.("ok", `Imported ${result.name || file.name} from Fusion.`);
      onImported?.(result.project_id, result.filename, result.name);
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = orig;
      }
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

  btnRefresh?.addEventListener("click", () => {
    if (activeTab === "mirrors") void loadAllMirrors();
    else void loadHubs();
  });
  wireTabButtons();
  setActiveTab("browse");
  window.addEventListener("render3d:autodesk-linked", () => {
    if (activeTab === "mirrors") void loadAllMirrors();
    else void loadHubs();
  });
  window.addEventListener("render3d:open-fusion-library", () => {
    if (activeTab === "mirrors") void loadAllMirrors();
    else void loadHubs();
  });
  window.addEventListener("render3d:project-changed", () => {
    void syncMirrorUiFromCurrentProject();
    if (activeTab === "mirrors") void loadAllMirrors();
  });
  window.addEventListener("render3d:fusion-mirror-changed", () => {
    void syncMirrorUiFromCurrentProject();
    if (activeTab === "mirrors") void loadAllMirrors();
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