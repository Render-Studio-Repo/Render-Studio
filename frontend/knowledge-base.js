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
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatPct(rate, count, total) {
  if (rate == null && !(total > 0)) return "—";
  const pct = rate != null ? Math.round(Number(rate) * 100) : Math.round((Number(count || 0) / Number(total)) * 100);
  return `${pct}%`;
}

function formatRelativeTime(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso).slice(0, 10);
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

function categoryPills(byCategory = {}) {
  const labels = [
    ["text", "Text"],
    ["cad", "CAD"],
    ["pdf", "PDF"],
    ["image", "Images"],
    ["other", "Other"],
  ];
  return labels
    .filter(([key]) => Number(byCategory[key] || 0) > 0)
    .map(([key, label]) => `
      <span class="kb-stat-pill kb-stat-pill--${key}">
        ${label} <em>${Number(byCategory[key] || 0)}</em>
      </span>
    `)
    .join("") || `<span class="kb-stat-pill">Empty</span>`;
}

function formatBars(formats = [], totalItems = 0) {
  const rows = (formats || []).slice(0, 6);
  if (!rows.length) return `<p class="muted small">No file formats yet.</p>`;
  const max = Math.max(...rows.map((r) => Number(r.count || 0)), 1);
  return `
    <div class="kb-stats-formats">
      ${rows.map((row) => {
        const count = Number(row.count || 0);
        const width = Math.max(8, Math.round((count / max) * 100));
        const share = totalItems > 0 ? Math.round((count / totalItems) * 100) : 0;
        return `
          <div class="kb-format-row" title="${esc(row.ext)} · ${formatBytes(row.bytes)} · ${share}%">
            <span>${esc(row.ext || "(none)")}</span>
            <i style="width:${width}%"></i>
            <em>${count}</em>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderStatsPanel(stats, { title = "Library overview", compact = false } = {}) {
  if (!stats) return "";
  const cats = stats.by_category || {};
  const largest = stats.largest_file;
  const ready = formatPct(stats.text_ready_rate, stats.text_ready_count, stats.item_count);
  return `
    <div class="kb-stats${compact ? " kb-stats--compact" : ""}">
      <div class="kb-stats-head"><strong>${esc(title)}</strong></div>
      <div class="kb-stats-grid">
        <article><span>Bases</span><strong>${stats.knowledge_base_count ?? "—"}</strong><small>collections</small></article>
        <article><span>Files</span><strong>${stats.item_count || 0}</strong><small>${stats.folder_count || 0} folders</small></article>
        <article><span>Storage</span><strong>${formatBytes(stats.total_bytes)}</strong><small>avg ${formatBytes(stats.avg_bytes)}</small></article>
        <article><span>AI-ready</span><strong>${ready}</strong><small>${stats.text_ready_count || 0} with text</small></article>
        <article><span>Excerpt chars</span><strong>${Number(stats.excerpt_chars || 0).toLocaleString()}</strong><small>indexed text</small></article>
        <article><span>Skill links</span><strong>${stats.skill_link_count ?? stats.skill_count ?? 0}</strong><small>attached skills</small></article>
      </div>
      <div class="kb-stats-cats">${categoryPills(cats)}</div>
      ${formatBars(stats.by_format, stats.item_count || 0)}
      ${largest ? `<p class="kb-stats-largest muted small">Largest: <strong>${esc(largest.name)}</strong> · ${formatBytes(largest.size_bytes)} · ${esc(largest.category || "")}</p>` : ""}
    </div>
  `;
}

function renderKbCardStats(kb) {
  const stats = kb.stats || {};
  const cats = kb.by_category || stats.by_category || {};
  const ready = formatPct(stats.text_ready_rate, kb.text_ready_count ?? stats.text_ready_count, kb.item_count);
  const skillCount = (kb.skill_ids || stats.skill_ids || []).length;
  const formats = (stats.by_format || []).slice(0, 4).map((f) => f.ext).filter(Boolean);
  return `
    <div class="prompt-kb-card-stats">
      <div class="prompt-kb-metric-row">
        <span><em>${kb.item_count || 0}</em> files</span>
        <span><em>${kb.folder_count || 0}</em> folders</span>
        <span><em>${formatBytes(kb.total_bytes || stats.total_bytes)}</em></span>
        <span><em>${ready}</em> AI-ready</span>
        <span><em>${skillCount}</em> skills</span>
      </div>
      <div class="kb-stats-cats kb-list-cats">${categoryPills(cats)}</div>
      <div class="prompt-kb-card-meta">
        <span>Updated ${formatRelativeTime(kb.updated_at)}</span>
        ${formats.length ? `<span>${formats.map((f) => esc(f)).join(" · ")}</span>` : `<span>No formats yet</span>`}
        ${stats.largest_file ? `<span title="${esc(stats.largest_file.name)}">Largest ${formatBytes(stats.largest_file.size_bytes)}</span>` : ""}
      </div>
    </div>
  `;
}

export function createKnowledgePromptUI({
  iconBtn,
  badgeEl,
  popover,
  pickerList,
  overviewEl,
  dropZone,
  dropInput,
  manageBtn,
  statusEl,
  modal,
} = {}) {
  let bases = [];
  let sharedBases = [];
  let userStats = null;
  let shareTargets = { users: [], teams: [], projects: [] };
  let activeKbId = null;
  let tree = null;
  let skills = [];
  let currentFolderId = null;
  let popoverOpen = false;
  let uploading = false;
  let canEditActive = true;

  function allBases() {
    return [...bases, ...sharedBases];
  }

  function findBase(id) {
    return allBases().find((b) => b.id === id) || null;
  }

  function setStatus(message = "", isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle("error", !!isError);
  }

  function resolveUploadTargetId() {
    if (activeKbId) {
      const active = findBase(activeKbId);
      if (active && active.access !== "shared") return activeKbId;
    }
    const selected = getSelectedKnowledgeBaseIds()
      .map((id) => findBase(id))
      .filter((b) => b && b.access !== "shared");
    if (selected[0]) return selected[0].id;
    return bases[0]?.id || null;
  }

  function syncIcon() {
    const ids = getSelectedKnowledgeBaseIds();
    const on = ids.length > 0;
    iconBtn?.classList.toggle("is-on", on);
    iconBtn?.setAttribute("aria-pressed", on ? "true" : "false");
    document.getElementById("btn-knowledge-base")?.classList.toggle("active", on);
    if (badgeEl) {
      badgeEl.textContent = String(ids.length);
      badgeEl.classList.toggle("hidden", !on);
    }
    const names = allBases().filter((b) => ids.includes(b.id)).map((b) => b.name);
    const title = on
      ? `Knowledge bases: ${names.join(", ") || ids.length}`
      : "Select knowledge base";
    if (iconBtn) iconBtn.title = title;
  }

  function updateDropHint() {
    const targetId = resolveUploadTargetId();
    const target = bases.find((b) => b.id === targetId);
    const label = dropZone?.querySelector("span");
    if (label) {
      label.textContent = target
        ? `Uploads go to “${target.name}” — select multiple or drag & drop`
        : "Select or create a knowledge base, then drop files here";
    }
    const modalDrop = modal?.querySelector("#kb-modal-drop span");
    if (modalDrop) {
      const modalTarget = bases.find((b) => b.id === activeKbId);
      modalDrop.textContent = modalTarget
        ? `Drop into “${modalTarget.name}”`
        : "Select a knowledge base on the left, then drop files here";
    }
  }

  function renderOverview() {
    const selected = getSelectedKnowledgeBaseIds();
    const selectedBases = allBases().filter((b) => selected.includes(b.id));
    const selectedFiles = selectedBases.reduce((n, kb) => n + Number(kb.item_count || 0), 0);
    const selectedBytes = selectedBases.reduce((n, kb) => n + Number(kb.total_bytes || kb.stats?.total_bytes || 0), 0);
    if (overviewEl) {
      overviewEl.innerHTML = `
        ${renderStatsPanel(userStats, { title: "Your knowledge library", compact: true })}
        <div class="prompt-kb-selected-summary">
          <span><em>${selected.length}</em> selected for this prompt</span>
          <span><em>${selectedFiles}</em> files in scope</span>
          <span><em>${formatBytes(selectedBytes)}</em> selected storage</span>
          <span><em>${sharedBases.length}</em> shared with you</span>
        </div>
      `;
    }
    const modalOverview = modal?.querySelector("#kb-overview-stats");
    if (modalOverview) {
      modalOverview.innerHTML = renderStatsPanel(userStats, { title: "Account knowledge stats" });
    }
  }

  function renderKbPickItem(kb, selected) {
    const shared = kb.access === "shared" || kb.shared_with_me;
    const owner = kb.owner?.display_name ? ` · from ${esc(kb.owner.display_name)}` : "";
    const via = shared && kb.shared_via?.length
      ? ` · via ${esc(kb.shared_via.map((r) => r.label).join(", "))}`
      : "";
    return `
      <label class="prompt-kb-pick-item${selected.has(kb.id) ? " is-selected" : ""}${shared ? " is-shared" : ""}">
        <input type="checkbox" data-kb-id="${esc(kb.id)}" ${selected.has(kb.id) ? "checked" : ""} />
        <span class="prompt-kb-pick-body">
          <span class="prompt-kb-pick-title">
            <strong>${esc(kb.name)}${shared ? ` <span class="kb-shared-tag">Shared</span>` : ""}</strong>
            ${kb.description ? `<em class="prompt-kb-pick-desc">${esc(kb.description)}</em>` : ""}
            ${shared ? `<em class="prompt-kb-pick-desc">Shared with you${owner}${via}</em>` : ""}
          </span>
          ${renderKbCardStats(kb)}
        </span>
      </label>
    `;
  }

  function renderPicker() {
    if (!pickerList) return;
    const selected = new Set(getSelectedKnowledgeBaseIds());
    renderOverview();
    if (!bases.length && !sharedBases.length) {
      pickerList.innerHTML = `<p class="muted small">No knowledge bases yet. Click Manage to create one.</p>`;
      return;
    }
    const parts = [];
    if (bases.length) {
      parts.push(`<div class="prompt-kb-section-label">Your bases</div>`);
      parts.push(bases.map((kb) => renderKbPickItem(kb, selected)).join(""));
    }
    if (sharedBases.length) {
      parts.push(`<div class="prompt-kb-section-label">Shared with you</div>`);
      parts.push(sharedBases.map((kb) => renderKbPickItem(kb, selected)).join(""));
    }
    pickerList.innerHTML = parts.join("");
    pickerList.querySelectorAll("input[data-kb-id]").forEach((input) => {
      input.addEventListener("change", () => {
        const ids = [...pickerList.querySelectorAll("input[data-kb-id]:checked")]
          .map((el) => el.getAttribute("data-kb-id"))
          .filter(Boolean);
        setSelectedKnowledgeBaseIds(ids);
        syncIcon();
        renderPicker();
        updateDropHint();
      });
    });
  }

  async function refreshBases() {
    if (!getToken()) {
      bases = [];
      sharedBases = [];
      userStats = null;
      renderPicker();
      syncIcon();
      return;
    }
    try {
      const data = await api("/api/knowledge-bases");
      bases = data.knowledge_bases || [];
      sharedBases = data.shared_with_me || [];
      userStats = data.stats || null;
      const allowed = new Set(allBases().map((b) => b.id));
      const selected = getSelectedKnowledgeBaseIds().filter((id) => allowed.has(id));
      setSelectedKnowledgeBaseIds(selected);
      renderPicker();
      syncIcon();
      updateDropHint();
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
    if (!bases.length && !sharedBases.length) {
      list.innerHTML = `<p class="muted small">No knowledge bases yet. Create one to get started.</p>`;
      return;
    }
    const parts = [];
    if (bases.length) {
      parts.push(`<div class="kb-list-section">Your bases</div>`);
      parts.push(bases.map((kb) => `
        <button type="button" class="kb-list-item${kb.id === activeKbId ? " active" : ""}" data-kb-id="${esc(kb.id)}">
          <strong>${esc(kb.name)}</strong>
          <span class="kb-list-cats">${kb.item_count || 0} files · ${formatBytes(kb.total_bytes)} · ${formatPct(kb.stats?.text_ready_rate, kb.text_ready_count, kb.item_count)} AI-ready</span>
          <em>${esc(kb.description || "No description")}</em>
        </button>
      `).join(""));
    }
    if (sharedBases.length) {
      parts.push(`<div class="kb-list-section">Shared with you</div>`);
      parts.push(sharedBases.map((kb) => `
        <button type="button" class="kb-list-item kb-list-item--shared${kb.id === activeKbId ? " active" : ""}" data-kb-id="${esc(kb.id)}">
          <strong>${esc(kb.name)} <span class="kb-shared-tag">Shared</span></strong>
          <span class="kb-list-cats">${kb.item_count || 0} files · from ${esc(kb.owner?.display_name || "owner")}</span>
          <em>${esc((kb.shared_via || []).map((r) => r.label).join(" · ") || kb.description || "Shared knowledge base")}</em>
        </button>
      `).join(""));
    }
    list.innerHTML = parts.join("");
    list.querySelectorAll("[data-kb-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeKbId = btn.getAttribute("data-kb-id");
        currentFolderId = null;
        const active = findBase(activeKbId);
        canEditActive = !(active?.access === "shared" || active?.shared_with_me);
        renderModalList();
        updateDropHint();
        syncEditControls();
        void loadTree(activeKbId);
      });
    });
  }

  function syncEditControls() {
    const uploadRow = modal?.querySelector(".kb-upload-row");
    const drop = modal?.querySelector("#kb-modal-drop");
    const delBtn = modal?.querySelector("#kb-delete-base");
    const createRow = modal?.querySelector(".kb-create-row");
    uploadRow?.classList.toggle("hidden", !canEditActive);
    drop?.classList.toggle("hidden", !canEditActive);
    delBtn?.classList.toggle("hidden", !canEditActive);
    createRow?.classList.remove("hidden");
  }

  async function renderSharePanel() {
    const panel = modal?.querySelector("#kb-share-panel");
    if (!panel) return;
    if (!activeKbId || !canEditActive) {
      panel.innerHTML = canEditActive
        ? ""
        : `<div class="kb-share-readonly muted small">Shared with you — read-only. You can select it for AI prompts.</div>`;
      return;
    }
    try {
      if (!shareTargets.users?.length && !shareTargets.teams?.length) {
        shareTargets = await api("/api/knowledge-bases/share-targets");
      }
      const data = await api(`/api/knowledge-bases/${encodeURIComponent(activeKbId)}/shares`);
      const shares = data.shares || [];
      panel.innerHTML = `
        <div class="kb-share-head"><strong>Share</strong><span class="muted small">Team members, projects, or workspaces</span></div>
        <div class="kb-share-form">
          <select id="kb-share-type" aria-label="Share type">
            <option value="user">Team member</option>
            <option value="project">Project</option>
            <option value="team">Workspace</option>
          </select>
          <select id="kb-share-target" aria-label="Share target"></select>
          <button type="button" class="btn accent btn-compact" id="kb-share-btn">Share</button>
        </div>
        <div class="kb-share-list">
          ${shares.length ? shares.map((share) => `
            <div class="kb-share-row">
              <span><strong>${esc(share.label || share.target_id)}</strong> <em>${esc(share.share_type)}</em></span>
              <button type="button" class="btn danger btn-compact" data-unshare="${esc(share.id)}">Remove</button>
            </div>
          `).join("") : `<p class="muted small">Not shared yet.</p>`}
        </div>
      `;
      const typeEl = panel.querySelector("#kb-share-type");
      const targetEl = panel.querySelector("#kb-share-target");
      const fillTargets = () => {
        const type = typeEl.value;
        const options = type === "user"
          ? (shareTargets.users || [])
          : type === "team"
            ? (shareTargets.teams || [])
            : (shareTargets.projects || []);
        targetEl.innerHTML = options.length
          ? options.map((opt) => `<option value="${esc(opt.id)}">${esc(opt.display_name || opt.name || opt.id)}${opt.email ? ` (${esc(opt.email)})` : ""}</option>`).join("")
          : `<option value="">No targets available</option>`;
      };
      fillTargets();
      typeEl.addEventListener("change", fillTargets);
      panel.querySelector("#kb-share-btn")?.addEventListener("click", async () => {
        const targetId = targetEl.value;
        if (!targetId) {
          setStatus("Pick someone or a project/workspace to share with.", true);
          return;
        }
        try {
          await api(`/api/knowledge-bases/${encodeURIComponent(activeKbId)}/shares`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ share_type: typeEl.value, target_id: targetId }),
          });
          setStatus("Knowledge base shared.");
          await renderSharePanel();
        } catch (err) {
          setStatus(err.message || "Share failed", true);
        }
      });
      panel.querySelectorAll("[data-unshare]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api(`/api/knowledge-bases/${encodeURIComponent(activeKbId)}/shares/${encodeURIComponent(btn.getAttribute("data-unshare"))}`, {
              method: "DELETE",
            });
            setStatus("Share removed.");
            await renderSharePanel();
          } catch (err) {
            setStatus(err.message || "Could not remove share", true);
          }
        });
      });
    } catch (err) {
      panel.innerHTML = `<p class="muted small">${esc(err.message || "Could not load shares")}</p>`;
    }
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
    const stats = tree.stats || kb.stats || {};
    if (meta) {
      meta.innerHTML = `
        <strong>${esc(kb.name)}</strong>
        <span>${esc(kb.description || "No description")}</span>
        <div class="kb-detail-stats">
          ${renderStatsPanel({
            ...stats,
            knowledge_base_count: 1,
            skill_link_count: stats.skill_count ?? (kb.skill_ids || []).length,
          }, { title: "This base", compact: true })}
        </div>
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
            ${canEditActive ? `<button type="button" class="btn danger btn-compact" data-delete-item="${esc(item.id)}">Delete</button>` : ""}
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
      canEditActive = tree?.can_edit !== false && tree?.knowledge_base?.access !== "shared";
      syncEditControls();
      renderTree();
      void renderSharePanel();
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

  async function uploadFiles(fileList, { asFolder = false, kbId = null } = {}) {
    const targetId = kbId || resolveUploadTargetId();
    if (!targetId) {
      setStatus("Create or select a knowledge base first.", true);
      openModal();
      return;
    }
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    if (uploading) {
      setStatus("Upload already in progress…");
      return;
    }
    uploading = true;
    dropZone?.classList.add("is-uploading");
    modal?.querySelector("#kb-modal-drop")?.classList.add("is-uploading");
    setStatus(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`);
    const form = new FormData();
    files.forEach((file) => form.append("files", file, file.webkitRelativePath || file.name));
    if (currentFolderId && targetId === activeKbId) form.append("folder_id", currentFolderId);
    if (asFolder) form.append("preserve_paths", "1");
    try {
      const res = await fetch(`/api/knowledge-bases/${encodeURIComponent(targetId)}/items`, {
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
      if (!getSelectedKnowledgeBaseIds().includes(targetId)) {
        setSelectedKnowledgeBaseIds([...getSelectedKnowledgeBaseIds(), targetId]);
      }
      activeKbId = targetId;
      await refreshBases();
      if (!modal?.classList.contains("hidden")) await loadTree(targetId);
      setStatus(`Uploaded ${files.length} file${files.length === 1 ? "" : "s"} to knowledge base.`);
    } catch (err) {
      setStatus(err.message || "Upload failed", true);
    } finally {
      uploading = false;
      dropZone?.classList.remove("is-uploading");
      modal?.querySelector("#kb-modal-drop")?.classList.remove("is-uploading");
    }
  }

  function bindDropTarget(el, { openFilePicker = null } = {}) {
    if (!el) return;
    const onDragOver = (event) => {
      event.preventDefault();
      event.stopPropagation();
      el.classList.add("is-dragover");
    };
    const onDragLeave = (event) => {
      if (!el.contains(event.relatedTarget)) el.classList.remove("is-dragover");
    };
    const onDrop = (event) => {
      event.preventDefault();
      event.stopPropagation();
      el.classList.remove("is-dragover");
      const files = event.dataTransfer?.files;
      if (files?.length) void uploadFiles(files);
    };
    el.addEventListener("dragenter", onDragOver);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    if (openFilePicker) {
      el.addEventListener("click", (event) => {
        if (event.target.closest("button, a, input, label, select")) return;
        openFilePicker();
      });
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openFilePicker();
        }
      });
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
      if (!activeKbId) activeKbId = getSelectedKnowledgeBaseIds()[0] || bases[0]?.id || sharedBases[0]?.id || null;
      const active = findBase(activeKbId);
      canEditActive = !(active?.access === "shared" || active?.shared_with_me);
      syncEditControls();
      if (activeKbId) await loadTree(activeKbId);
      else renderTree();
      updateDropHint();
      try {
        shareTargets = await api("/api/knowledge-bases/share-targets");
      } catch {
        shareTargets = { users: [], teams: [], projects: [] };
      }
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

  const openDropPicker = () => dropInput?.click();
  bindDropTarget(dropZone, { openFilePicker: openDropPicker });
  bindDropTarget(popover, { openFilePicker: null });
  bindDropTarget(modal?.querySelector(".kb-modal-card") || modal, { openFilePicker: null });
  bindDropTarget(modal?.querySelector("#kb-modal-drop"), {
    openFilePicker: () => modal?.querySelector("#kb-upload-files")?.click(),
  });
  dropInput?.addEventListener("change", (event) => {
    void uploadFiles(event.target.files, { asFolder: false });
    event.target.value = "";
  });
  document.addEventListener("click", (event) => {
    const ribbonKb = event.target.closest("#btn-knowledge-base");
    if (!ribbonKb) return;
    event.preventDefault();
    openModal();
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
