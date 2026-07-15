/** Knowledge bases: folders of docs/CAD for AI prompts + skill attachment. */

import { authHeaders, getToken } from "./auth.js?v=20260709-admin-matt";
import { fetchSkillsCatalog } from "./skills-library.js?v=20260706-ui-fix";

const KB_ENABLED_KEY = "render3d:knowledge:enabled:v1";
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

export function isKnowledgeEnabled() {
  try {
    return localStorage.getItem(KB_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setKnowledgeEnabled(on) {
  try {
    localStorage.setItem(KB_ENABLED_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
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

export function getKnowledgePromptFields() {
  if (!isKnowledgeEnabled()) return {};
  const ids = getSelectedKnowledgeBaseIds();
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
  toggleWrap,
  checkbox,
  manageBtn,
  selectEl,
  statusEl,
  modal,
} = {}) {
  let bases = [];
  let activeKbId = null;
  let tree = null;
  let skills = [];
  let currentFolderId = null;

  function setStatus(message = "", isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle("error", !!isError);
  }

  function syncToggle() {
    if (checkbox) checkbox.checked = isKnowledgeEnabled();
    if (toggleWrap) toggleWrap.classList.toggle("is-on", isKnowledgeEnabled());
  }

  function renderSelect() {
    if (!selectEl) return;
    const selected = new Set(getSelectedKnowledgeBaseIds());
    if (!bases.length) {
      selectEl.innerHTML = `<option value="">No knowledge bases yet</option>`;
      selectEl.disabled = true;
      return;
    }
    selectEl.disabled = false;
    selectEl.innerHTML = bases.map((kb) => `
      <option value="${esc(kb.id)}" ${selected.has(kb.id) ? "selected" : ""}>
        ${esc(kb.name)} (${kb.item_count || 0} files)
      </option>
    `).join("");
    // multi-select via multiple attribute
  }

  async function refreshBases() {
    if (!getToken()) {
      bases = [];
      renderSelect();
      return;
    }
    try {
      const data = await api("/api/knowledge-bases");
      bases = data.knowledge_bases || [];
      const selected = getSelectedKnowledgeBaseIds().filter((id) => bases.some((b) => b.id === id));
      if (!selected.length && bases[0]) selected.push(bases[0].id);
      setSelectedKnowledgeBaseIds(selected);
      renderSelect();
      renderModalList();
    } catch (err) {
      setStatus(err.message || "Could not load knowledge bases", true);
    }
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
        <span>${kb.item_count || 0} files · ${kb.folder_count || 0} folders</span>
        ${(kb.skill_ids || []).length ? `<em>skills: ${(kb.skill_ids || []).map(esc).join(", ")}</em>` : ""}
      </button>
    `).join("");
    list.querySelectorAll("[data-kb-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeKbId = btn.getAttribute("data-kb-id");
        currentFolderId = null;
        void loadTree(activeKbId);
        renderModalList();
      });
    });
  }

  function folderChildren(parentId) {
    return (tree?.folders || []).filter((f) => (f.parent_id || null) === (parentId || null));
  }

  function itemsInFolder(folderId) {
    return (tree?.items || []).filter((item) => (item.folder_id || null) === (folderId || null));
  }

  function renderTree() {
    const panel = modal?.querySelector("#kb-tree");
    const meta = modal?.querySelector("#kb-detail-meta");
    const skillsBox = modal?.querySelector("#kb-skills");
    if (!panel) return;
    if (!tree?.knowledge_base) {
      panel.innerHTML = `<p class="muted small">Select or create a knowledge base.</p>`;
      if (meta) meta.textContent = "";
      if (skillsBox) skillsBox.innerHTML = "";
      return;
    }
    const kb = tree.knowledge_base;
    if (meta) {
      meta.innerHTML = `<strong>${esc(kb.name)}</strong><span>${esc(kb.description || "No description")}</span>`;
    }
    if (skillsBox) {
      const linked = new Set(kb.skill_ids || []);
      skillsBox.innerHTML = `
        <label class="kb-skills-label">Attach to skills</label>
        <div class="kb-skills-grid">
          ${skills.map((skill) => `
            <label class="kb-skill-chip">
              <input type="checkbox" data-skill-id="${esc(skill.id)}" ${linked.has(skill.id) ? "checked" : ""} />
              ${esc(skill.name || skill.id)}
            </label>
          `).join("") || '<span class="muted small">No skills available</span>'}
        </div>
        <button type="button" class="btn secondary btn-compact" id="kb-save-skills">Save skill links</button>
      `;
      skillsBox.querySelector("#kb-save-skills")?.addEventListener("click", () => void saveSkills());
    }

    const crumbs = [`<button type="button" class="kb-crumb" data-folder-id="">Root</button>`];
    if (currentFolderId) {
      const folder = (tree.folders || []).find((f) => f.id === currentFolderId);
      if (folder) crumbs.push(`<span>/</span><span>${esc(folder.name)}</span>`);
    }
    const folders = folderChildren(currentFolderId);
    const items = itemsInFolder(currentFolderId);
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
            <div>
              <strong>${esc(item.name)}</strong>
              <span>${formatBytes(item.size_bytes)}${item.has_text ? " · text ready" : ""}</span>
              ${item.text_excerpt ? `<p>${esc(item.text_excerpt)}</p>` : ""}
            </div>
            <button type="button" class="btn secondary btn-compact" data-delete-item="${esc(item.id)}">Remove</button>
          </article>
        `).join("")}
        ${!folders.length && !items.length ? '<p class="muted small">This folder is empty. Upload files or a whole folder.</p>' : ""}
      </div>
    `;
    panel.querySelectorAll("[data-open-folder]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentFolderId = btn.getAttribute("data-open-folder");
        renderTree();
      });
    });
    panel.querySelector(".kb-crumb")?.addEventListener("click", () => {
      currentFolderId = null;
      renderTree();
    });
    panel.querySelectorAll("[data-delete-item]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const itemId = btn.getAttribute("data-delete-item");
        if (!itemId || !activeKbId) return;
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
    if (!kbId) {
      tree = null;
      renderTree();
      return;
    }
    try {
      tree = await api(`/api/knowledge-bases/${encodeURIComponent(kbId)}`);
      activeKbId = kbId;
      renderTree();
    } catch (err) {
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
      await refreshBases();
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
        body: JSON.stringify({ name, description: descInput?.value?.trim() || "" }),
      });
      if (nameInput) nameInput.value = "";
      if (descInput) descInput.value = "";
      await refreshBases();
      activeKbId = data.knowledge_base?.id;
      if (activeKbId) {
        setSelectedKnowledgeBaseIds([...new Set([...getSelectedKnowledgeBaseIds(), activeKbId])]);
        renderSelect();
        await loadTree(activeKbId);
      }
      setStatus("Knowledge base created.");
    } catch (err) {
      setStatus(err.message || "Create failed", true);
    }
  }

  async function createFolder() {
    if (!activeKbId) return;
    const name = window.prompt("Folder name?");
    if (!name?.trim()) return;
    try {
      await api(`/api/knowledge-bases/${encodeURIComponent(activeKbId)}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), parent_id: currentFolderId }),
      });
      await loadTree(activeKbId);
      await refreshBases();
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
    if (currentFolderId && !asFolder) form.append("folder_id", currentFolderId);
    files.forEach((file) => {
      const rel = asFolder && file.webkitRelativePath ? file.webkitRelativePath : file.name;
      form.append("files", file, rel);
    });
    setStatus(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`);
    try {
      const res = await fetch(`/api/knowledge-bases/${encodeURIComponent(activeKbId)}/items`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || res.statusText || "Upload failed");
      const errCount = (data.errors || []).length;
      setStatus(
        errCount
          ? `Uploaded ${data.count || 0}; ${errCount} skipped.`
          : `Uploaded ${data.count || 0} file${(data.count || 0) === 1 ? "" : "s"}.`,
        errCount > 0,
      );
      await loadTree(activeKbId);
      await refreshBases();
    } catch (err) {
      setStatus(err.message || "Upload failed", true);
    }
  }

  function openModal() {
    if (!modal) return;
    modal.classList.remove("hidden");
    void (async () => {
      try {
        const catalog = await fetchSkillsCatalog((path, options) => fetch(path, { ...options, headers: { ...authHeaders(), ...(options?.headers || {}) } }));
        skills = (Array.isArray(catalog) ? catalog : []).map((s) => ({
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

  checkbox?.addEventListener("change", () => {
    setKnowledgeEnabled(!!checkbox.checked);
    syncToggle();
  });
  selectEl?.addEventListener("change", () => {
    const ids = [...selectEl.selectedOptions].map((opt) => opt.value).filter(Boolean);
    setSelectedKnowledgeBaseIds(ids);
  });
  manageBtn?.addEventListener("click", openModal);
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
      activeKbId = null;
      tree = null;
      await refreshBases();
      renderTree();
      setStatus("Knowledge base deleted.");
    } catch (err) {
      setStatus(err.message || "Delete failed", true);
    }
  });

  syncToggle();
  void refreshBases();

  return {
    refresh: refreshBases,
    open: openModal,
    close: closeModal,
    isEnabled: isKnowledgeEnabled,
  };
}
