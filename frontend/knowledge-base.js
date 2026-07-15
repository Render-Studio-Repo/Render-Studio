/** Knowledge bases: folders of docs/CAD for AI prompts + skill attachment. */

import { authHeaders, getToken } from "./auth.js?v=20260709-admin-matt";
import { fetchSkillsCatalog } from "./skills-library.js?v=20260706-ui-fix";

const KB_SELECTED_KEY = "render3d:knowledge:selected:v1";

function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, options = {}) {
  const headers = { ...authHeaders(), ...(options.headers || {}) };
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    try {
      const data = await res.json();
      message = data.detail || message;
    } catch {
      /* ignore */
    }
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  if (res.status === 204) return null;
  return res.json();
}

export function getSelectedKnowledgeBaseIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(KB_SELECTED_KEY) || "[]");
    return Array.isArray(raw) ? raw.map(String).filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function setSelectedKnowledgeBaseIds(ids = []) {
  try {
    localStorage.setItem(KB_SELECTED_KEY, JSON.stringify([...new Set(ids.map(String))].slice(0, 12)));
  } catch {
    /* ignore */
  }
}

export function isKnowledgeEnabled() {
  return getSelectedKnowledgeBaseIds().length > 0;
}

export function getKnowledgePromptFields() {
  const ids = getSelectedKnowledgeBaseIds();
  if (!ids.length) return {};
  return {
    use_knowledge_base: true,
    knowledge_base_ids: ids,
  };
}

function formatBytes(n) {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

export function createKnowledgePromptUI({
  iconBtn,
  badgeEl,
  popover,
  pickerList,
  manageBtn,
  statusEl,
  modal,
} = {}) {
  let bases = [];
  let activeKbId = null;
  let tree = null;
  let skills = [];
  let currentFolderId = null;
  let popoverOpen = false;

  function setStatus(message = "", isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle("error", !!isError);
  }

  function syncIcon() {
    const ids = getSelectedKnowledgeBaseIds();
    const on = ids.length > 0;
    iconBtn?.classList.toggle("is-on", on);
    iconBtn?.setAttribute("aria-pressed", on ? "true" : "false");
    if (badgeEl) {
      badgeEl.textContent = String(ids.length);
      badgeEl.classList.toggle("hidden", !on);
    }
    const names = bases.filter((b) => ids.includes(b.id)).map((b) => b.name);
    const title = on
      ? `Knowledge bases: ${names.join(", ") || ids.length}`
      : "Select knowledge base";
    if (iconBtn) iconBtn.title = title;
  }

  function renderPicker() {
    if (!pickerList) return;
    const selected = new Set(getSelectedKnowledgeBaseIds());
    if (!bases.length) {
      pickerList.innerHTML = `<p class="muted small">No knowledge bases yet. Click Manage to create one.</p>`;
      return;
    }
    pickerList.innerHTML = bases.map((kb) => `
      <label class="prompt-kb-pick-item">
        <input type="checkbox" data-kb-id="${esc(kb.id)}" ${selected.has(kb.id) ? "checked" : ""} />
        <span class="prompt-kb-pick-text">
          <strong>${esc(kb.name)}</strong>
          <em>${kb.item_count || 0} files</em>
        </span>
      </label>
    `).join("");
    pickerList.querySelectorAll("input[data-kb-id]").forEach((input) => {
      input.addEventListener("change", () => {
        const ids = [...pickerList.querySelectorAll("input[data-kb-id]:checked")]
          .map((el) => el.getAttribute("data-kb-id"))
          .filter(Boolean);
        setSelectedKnowledgeBaseIds(ids);
        syncIcon();
      });
    });
  }

  async function refreshBases() {
    if (!getToken()) {
      bases = [];
      renderPicker();
      syncIcon();
      return;
    }
    try {
      const data = await api("/api/knowledge-bases");
      bases = data.knowledge_bases || [];
      const selected = getSelectedKnowledgeBaseIds().filter((id) => bases.some((b) => b.id === id));
      setSelectedKnowledgeBaseIds(selected);
      renderPicker();
      syncIcon();
      renderModalList();
    } catch (err) {
      setStatus(err.message || "Could not load knowledge bases", true);
    }
  }

  function openPopover() {
    popoverOpen = true;
    popover?.classList.remove("hidden");
    iconBtn?.setAttribute("aria-expanded", "true");
    void refreshBases();
  }

  function closePopover() {
    popoverOpen = false;
    popover?.classList.add("hidden");
    iconBtn?.setAttribute("aria-expanded", "false");
  }

  function togglePopover() {
    if (popoverOpen) closePopover();
    else openPopover();
  }

  function renderModalList() {
    const list = modal?.querySelector("#kb-list");
    if (!list) return;
    if (!bases.length) {
      list.innerHTML = `<p class="muted small">No knowledge bases yet. Create one to get started.</p>`;
      return;
    }
    list.innerHTML = bases.map((kb) => `
      <button type="button" class="kb-list-item${kb.id === activeKbId ? " active" : ""}" data-kb-id="${esc(kb.id)}">
        <strong>${esc(kb.name)}</strong>
        <span>${kb.item_count || 0} files</span>
        <em>${esc(kb.description || "")}</em>
      </button>
    `).join("");
    list.querySelectorAll("[data-kb-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeKbId = btn.getAttribute("data-kb-id");
        currentFolderId = null;
        renderModalList();
        void loadTree(activeKbId);
      });
    });
  }

  function renderTree() {
    const panel = modal?.querySelector("#kb-tree");
    const meta = modal?.querySelector("#kb-detail-meta");
    const skillsBox = modal?.querySelector("#kb-skills");
    if (!panel) return;
    if (!tree?.knowledge_base) {
      panel.innerHTML = `<p class="muted small">Select or create a knowledge base.</p>`;
      if (meta) meta.innerHTML = "";
      if (skillsBox) skillsBox.innerHTML = "";
      return;
    }
    const kb = tree.knowledge_base;
    if (meta) {
      meta.innerHTML = `
        <strong>${esc(kb.name)}</strong>
        <span>${esc(kb.description || "No description")}</span>
      `;
    }
    if (skillsBox) {
      const linked = new Set((kb.skill_ids || []).map(String));
      skillsBox.innerHTML = `
        <label class="kb-skills-label">Attach to skills</label>
        <div class="kb-skills-grid">
          ${skills.map((skill) => `
            <label class="kb-skill-chip">
              <input type="checkbox" data-skill-id="${esc(skill.id)}" ${linked.has(String(skill.id)) ? "checked" : ""} />
              <span>${esc(skill.name)}</span>
            </label>
          `).join("") || `<span class="muted small">No skills available</span>`}
        </div>
        <button type="button" class="btn secondary btn-compact" id="kb-save-skills">Save skill links</button>
      `;
      skillsBox.querySelector("#kb-save-skills")?.addEventListener("click", () => void saveSkills());
    }

    const folders = (tree.folders || []).filter((f) => (f.parent_id || null) === (currentFolderId || null));
    const items = (tree.items || []).filter((it) => (it.folder_id || null) === (currentFolderId || null));
    const crumbs = [`<button type="button" class="kb-crumb" data-folder-id="">Root</button>`];
    if (currentFolderId) {
      const folder = (tree.folders || []).find((f) => f.id === currentFolderId);
      if (folder) crumbs.push(`<button type="button" class="kb-crumb" data-folder-id="${esc(folder.id)}">${esc(folder.name)}</button>`);
    }
    panel.innerHTML = `
      <div class="kb-crumbs">${crumbs.join("")}</div>
      <div class="kb-tree-grid">
        ${folders.map((folder) => `
          <button type="button" class="kb-folder-card" data-open-folder="${esc(folder.id)}">
            <strong>📁 ${esc(folder.name)}</strong>
          </button>
        `).join("")}
        ${items.map((item) => `
          <article class="kb-item-card">
            <strong>${esc(item.name)}</strong>
            <p>${esc(item.content_type || item.kind || "file")} · ${formatBytes(item.size_bytes)}</p>
            <button type="button" class="btn danger btn-compact" data-delete-item="${esc(item.id)}">Delete</button>
          </article>
        `).join("")}
        ${!folders.length && !items.length ? `<p class="muted small">Empty folder — upload files or create a subfolder.</p>` : ""}
      </div>
    `;
    panel.querySelectorAll(".kb-crumb").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentFolderId = btn.getAttribute("data-folder-id") || null;
        renderTree();
      });
    });
    panel.querySelectorAll("[data-open-folder]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentFolderId = btn.getAttribute("data-open-folder");
        renderTree();
      });
    });
    panel.querySelectorAll("[data-delete-item]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const itemId = btn.getAttribute("data-delete-item");
        if (!itemId || !activeKbId) return;
        if (!window.confirm("Delete this file from the knowledge base?")) return;
        try {
          await api(`/api/knowledge-bases/${encodeURIComponent(activeKbId)}/items/${encodeURIComponent(itemId)}`, {
            method: "DELETE",
          });
          await loadTree(activeKbId);
          await refreshBases();
        } catch (err) {
          setStatus(err.message || "Delete failed", true);
        }
      });
    });
  }

  async function loadTree(kbId) {
    try {
      tree = await api(`/api/knowledge-bases/${encodeURIComponent(kbId)}`);
      renderTree();
    } catch (err) {
      tree = null;
      renderTree();
      setStatus(err.message || "Could not open knowledge base", true);
    }
  }

  async function saveSkills() {
    if (!activeKbId || !modal) return;
    const ids = [...modal.querySelectorAll("#kb-skills [data-skill-id]:checked")].map((el) => el.getAttribute("data-skill-id"));
    try {
      await api(`/api/knowledge-bases/${encodeURIComponent(activeKbId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill_ids: ids }),
      });
      await loadTree(activeKbId);
      setStatus("Skill links saved.");
    } catch (err) {
      setStatus(err.message || "Could not save skill links", true);
    }
  }

  async function createBase() {
    const nameInput = modal?.querySelector("#kb-new-name");
    const descInput = modal?.querySelector("#kb-new-desc");
    const name = nameInput?.value?.trim() || "Knowledge base";
    try {
      const data = await api("/api/knowledge-bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: descInput?.value?.trim() || "",
        }),
      });
      if (nameInput) nameInput.value = "";
      if (descInput) descInput.value = "";
      activeKbId = data.knowledge_base?.id;
      if (activeKbId) {
        setSelectedKnowledgeBaseIds([...new Set([...getSelectedKnowledgeBaseIds(), activeKbId])]);
      }
      await refreshBases();
      if (activeKbId) await loadTree(activeKbId);
      setStatus("Knowledge base created.");
    } catch (err) {
      setStatus(err.message || "Create failed", true);
    }
  }

  async function createFolder() {
    if (!activeKbId) return;
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    try {
      await api(`/api/knowledge-bases/${encodeURIComponent(activeKbId)}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), parent_id: currentFolderId }),
      });
      await loadTree(activeKbId);
    } catch (err) {
      setStatus(err.message || "Could not create folder", true);
    }
  }

  async function uploadFiles(fileList, { asFolder = false } = {}) {
    if (!activeKbId) {
      setStatus("Create or select a knowledge base first.", true);
      return;
    }
    const files = [...(fileList || [])];
    if (!files.length) return;
    const form = new FormData();
    files.forEach((file) => form.append("files", file, file.webkitRelativePath || file.name));
    if (currentFolderId) form.append("folder_id", currentFolderId);
    if (asFolder) form.append("preserve_paths", "1");
    try {
      const res = await fetch(`/api/knowledge-bases/${encodeURIComponent(activeKbId)}/items`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      if (!res.ok) {
        let message = res.statusText || "Upload failed";
        try {
          const data = await res.json();
          message = data.detail || message;
        } catch {
          /* ignore */
        }
        throw new Error(typeof message === "string" ? message : JSON.stringify(message));
      }
      await loadTree(activeKbId);
      await refreshBases();
      setStatus(`Uploaded ${files.length} file${files.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setStatus(err.message || "Upload failed", true);
    }
  }

  function openModal() {
    closePopover();
    modal?.classList.remove("hidden");
    void (async () => {
      try {
        const catalog = await fetchSkillsCatalog((path, options) => fetch(path, options));
        skills = (catalog || []).map((s) => ({
          id: s.id || s.skill_id,
          name: s.name || s.id,
        })).filter((s) => s.id);
      } catch {
        skills = [];
      }
      await refreshBases();
      if (!activeKbId) activeKbId = getSelectedKnowledgeBaseIds()[0] || bases[0]?.id || null;
      if (activeKbId) await loadTree(activeKbId);
      else renderTree();
    })();
  }

  function closeModal() {
    modal?.classList.add("hidden");
  }

  iconBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePopover();
  });
  manageBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    openModal();
  });
  popover?.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", () => {
    if (popoverOpen) closePopover();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && popoverOpen) closePopover();
  });

  modal?.querySelector("#kb-modal-close")?.addEventListener("click", closeModal);
  modal?.querySelector("#kb-modal-backdrop")?.addEventListener("click", closeModal);
  modal?.querySelector("#kb-create-btn")?.addEventListener("click", () => void createBase());
  modal?.querySelector("#kb-new-folder")?.addEventListener("click", () => void createFolder());
  modal?.querySelector("#kb-upload-files")?.addEventListener("change", (event) => {
    void uploadFiles(event.target.files, { asFolder: false });
    event.target.value = "";
  });
  modal?.querySelector("#kb-upload-folder")?.addEventListener("change", (event) => {
    void uploadFiles(event.target.files, { asFolder: true });
    event.target.value = "";
  });
  modal?.querySelector("#kb-delete-base")?.addEventListener("click", async () => {
    if (!activeKbId) return;
    if (!window.confirm("Delete this knowledge base and all of its files?")) return;
    try {
      await api(`/api/knowledge-bases/${encodeURIComponent(activeKbId)}`, { method: "DELETE" });
      const remaining = getSelectedKnowledgeBaseIds().filter((id) => id !== activeKbId);
      setSelectedKnowledgeBaseIds(remaining);
      activeKbId = null;
      tree = null;
      await refreshBases();
      renderTree();
      setStatus("Knowledge base deleted.");
    } catch (err) {
      setStatus(err.message || "Delete failed", true);
    }
  });

  syncIcon();
  void refreshBases();

  return {
    refresh: refreshBases,
    open: openModal,
    close: closeModal,
    isEnabled: isKnowledgeEnabled,
  };
}
