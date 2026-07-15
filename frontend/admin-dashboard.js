import { authHeaders, getStoredUser, getToken, isAdminUser } from "./auth.js?v=20260709-admin-matt";
import { createMiniViewer } from "./mini-viewer.js?v=20260715-admin-zup";
import { mountActivityCharts, mountNetworkBrain } from "./admin-charts.js?v=20260715-admin-charts";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "$0.00";
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

async function api(path) {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    try {
      const data = await res.json();
      message = data.detail || message;
    } catch {
      /* ignore */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function authBlobUrl(path) {
  if (!path) return null;
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return URL.createObjectURL(await res.blob());
}

function statCard(label, value, hint = "") {
  return `
    <article class="admin-stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </article>
  `;
}

function countPills(items, keyName) {
  if (!items?.length) return '<span class="muted small">No data yet</span>';
  return items.map((item) => `
    <span class="admin-pill">
      <strong>${escapeHtml(item[keyName] || "unknown")}</strong>
      <em>${formatNumber(item.count)}</em>
    </span>
  `).join("");
}

let chartCleanups = [];

function clearChartCleanups() {
  chartCleanups.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
  chartCleanups = [];
}

function renderUserRows(users = [], { clickable = true } = {}) {
  if (!users.length) return '<p class="muted">No users yet.</p>';
  return users.map((user) => `
    <article class="admin-user-row${clickable ? " admin-row--clickable" : ""}" ${clickable ? `data-user-id="${escapeHtml(user.id)}"` : ""}>
      <div>
        <strong>${escapeHtml(user.display_name || user.email || "User")}</strong>
        <span>${escapeHtml(user.email || "")}</span>
      </div>
      <div class="admin-row-stats">
        <span>${formatNumber(user.project_count)} projects</span>
        <span>${formatNumber(user.prompt_count)} prompts</span>
        <span>${formatNumber(user.model_count || 0)} models</span>
        <span>${formatMoney(user.total_cost_usd)}</span>
      </div>
      <small>Joined ${formatDate(user.created_at)} · active ${formatDate(user.last_active_at)}${user.training_ready_count ? ` · ${formatNumber(user.training_ready_count)} training-ready` : ""}</small>
    </article>
  `).join("");
}

function renderProjectRows(projects = []) {
  if (!projects.length) return '<p class="muted">No projects yet.</p>';
  return projects.map((project) => `
    <article class="admin-project-row admin-row--clickable" data-project-id="${escapeHtml(project.id)}">
      <div class="admin-project-thumb" data-preview-url="${escapeHtml(project.preview_url || "")}" aria-hidden="true">
        ${project.model_file || project.preview_url ? '<span class="admin-thumb-fallback">3D</span>' : '<span class="admin-thumb-fallback">—</span>'}
      </div>
      <div class="admin-project-main">
        <div>
          <strong>${escapeHtml(project.name || project.id)}</strong>
          <span>${escapeHtml(project.owner_name || project.owner_email || "Unknown owner")}</span>
          ${project.training_ready ? '<em class="admin-ready-tag">training-ready</em>' : ""}
        </div>
        <div class="admin-row-stats">
          <span>${formatNumber(project.file_count)} files</span>
          ${project.prompt_count != null ? `<span>${formatNumber(project.prompt_count)} prompts</span>` : ""}
          ${project.total_cost_usd != null ? `<span>${formatMoney(project.total_cost_usd)}</span>` : ""}
          ${project.public ? "<span>Public</span>" : ""}
          ${project.model_file ? `<span>${escapeHtml(project.model_file)}</span>` : ""}
        </div>
        <small>${escapeHtml(project.latest_file || "No model file")} · updated ${formatDate(project.updated_at)}</small>
        ${project.latest_prompt ? `<p class="admin-project-prompt">${escapeHtml(project.latest_prompt)}</p>` : ""}
      </div>
      <button type="button" class="btn secondary btn-compact admin-preview-btn" data-project-id="${escapeHtml(project.id)}">View model</button>
    </article>
  `).join("");
}

function renderPromptRows(prompts = [], { openProject = true } = {}) {
  if (!prompts.length) return '<p class="muted">No prompt history yet.</p>';
  return prompts.map((prompt) => `
    <article class="admin-prompt-row ${prompt.success ? "" : "admin-prompt-row--error"}${openProject ? " admin-row--clickable" : ""}" ${openProject && prompt.project_id ? `data-project-id="${escapeHtml(prompt.project_id)}"` : ""}>
      <div class="admin-prompt-head">
        <strong>${escapeHtml(prompt.user_name || prompt.owner_name || "Unknown user")}</strong>
        <span>${escapeHtml(prompt.kind || "cad")} · ${escapeHtml(prompt.prompt_mode || "mode")} · ${formatDate(prompt.created_at)}</span>
      </div>
      <p>${escapeHtml(prompt.prompt || prompt.prompt_preview || "(empty prompt)")}</p>
      <small>
        ${escapeHtml(prompt.project_name || prompt.project_id || "Project")}
        ${prompt.filename ? ` · ${escapeHtml(prompt.filename)}` : ""}
        ${prompt.model ? ` · ${escapeHtml(prompt.model)}` : ""}
        ${prompt.cost_usd != null ? ` · ${formatMoney(prompt.cost_usd)}` : ""}
        ${prompt.error ? ` · Error: ${escapeHtml(prompt.error)}` : ""}
      </small>
    </article>
  `).join("");
}

let modalState = {
  el: null,
  viewer: null,
  blobUrls: [],
};

function revokeModalBlobs() {
  modalState.blobUrls.forEach((url) => {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  });
  modalState.blobUrls = [];
}

function closeModal() {
  modalState.viewer?.dispose?.();
  modalState.viewer = null;
  revokeModalBlobs();
  modalState.el?.remove();
  modalState.el = null;
}

async function hydrateThumbs(root) {
  const thumbs = [...(root.querySelectorAll(".admin-project-thumb[data-preview-url]") || [])];
  await Promise.all(thumbs.map(async (thumb) => {
    const url = thumb.getAttribute("data-preview-url");
    if (!url) return;
    try {
      const blobUrl = await authBlobUrl(url);
      thumb.style.backgroundImage = `url("${blobUrl}")`;
      thumb.classList.add("has-image");
      thumb.dataset.blobUrl = blobUrl;
    } catch {
      /* keep fallback */
    }
  }));
}

function ensureModalShell() {
  closeModal();
  const el = document.createElement("div");
  el.className = "admin-modal-backdrop";
  el.innerHTML = `
    <div class="admin-modal" role="dialog" aria-modal="true" aria-label="Model preview">
      <header class="admin-modal-head">
        <div>
          <p class="info-eyebrow">3D Model Preview</p>
          <h2 id="admin-modal-title">Loading…</h2>
          <p class="muted small" id="admin-modal-sub"></p>
        </div>
        <button type="button" class="btn secondary btn-compact" id="admin-modal-close">Close</button>
      </header>
      <div class="admin-modal-stats" id="admin-modal-stats"></div>
      <div class="admin-modal-body">
        <div class="admin-modal-viewer-wrap">
          <div id="admin-modal-viewer" class="admin-modal-viewer"></div>
          <p class="muted small" id="admin-modal-viewer-status"></p>
          <div class="admin-modal-snaps" id="admin-modal-snaps"></div>
        </div>
        <aside class="admin-modal-side">
          <h3>Prompt history</h3>
          <div id="admin-modal-prompts" class="admin-list admin-list--prompts"></div>
          <h3 class="admin-subhead">Files</h3>
          <div id="admin-modal-files" class="admin-pill-list"></div>
        </aside>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  modalState.el = el;
  el.querySelector("#admin-modal-close")?.addEventListener("click", closeModal);
  el.addEventListener("click", (event) => {
    if (event.target === el) closeModal();
  });
  return el;
}

async function openProjectModal(projectId) {
  const el = ensureModalShell();
  const title = el.querySelector("#admin-modal-title");
  const sub = el.querySelector("#admin-modal-sub");
  const statsEl = el.querySelector("#admin-modal-stats");
  const promptsEl = el.querySelector("#admin-modal-prompts");
  const filesEl = el.querySelector("#admin-modal-files");
  const snapsEl = el.querySelector("#admin-modal-snaps");
  const viewerEl = el.querySelector("#admin-modal-viewer");
  const viewerStatus = el.querySelector("#admin-modal-viewer-status");
  title.textContent = "Loading project…";
  promptsEl.innerHTML = '<p class="muted">Loading prompt history…</p>';
  statsEl.innerHTML = "";
  if (viewerStatus) viewerStatus.textContent = "";

  try {
    const data = await api(`/api/admin/projects/${encodeURIComponent(projectId)}`);
    const project = data.project || {};
    const prompts = data.prompts || [];
    const totalCost = data.total_cost_usd ?? project.total_cost_usd ?? 0;
    title.textContent = project.name || project.id || "Project";
    sub.textContent = [
      project.owner_name || project.owner_email || "Unknown owner",
      project.model_file || project.latest_file || "No model",
      `updated ${formatDate(project.updated_at)}`,
      project.training_ready ? "training-ready" : null,
    ].filter(Boolean).join(" · ");

    statsEl.innerHTML = `
      <div class="admin-stats-grid admin-stats-grid--compact admin-modal-stats-grid">
        ${statCard("Total project cost", formatMoney(totalCost), `${formatNumber(project.prompt_count || prompts.length)} prompts`)}
        ${statCard("Tokens", formatNumber(project.total_tokens || 0), project.usage_summary?.model ? String(project.usage_summary.model) : "")}
        ${statCard("Files", formatNumber(project.file_count || (data.files || []).length), project.public ? "Public" : "Private")}
      </div>
    `;

    promptsEl.innerHTML = renderPromptRows(prompts, { openProject: false });
    filesEl.innerHTML = (data.files || []).slice(0, 24).map((file) => `
      <span class="admin-pill"><strong>${escapeHtml(file.name || "")}</strong></span>
    `).join("") || '<span class="muted small">No CAD files</span>';

    snapsEl.innerHTML = "";
    for (const snapUrl of (project.snapshot_urls || []).slice(0, 4)) {
      try {
        const blobUrl = await authBlobUrl(snapUrl);
        modalState.blobUrls.push(blobUrl);
        const img = document.createElement("img");
        img.src = blobUrl;
        img.alt = "Snapshot";
        snapsEl.appendChild(img);
      } catch {
        /* skip */
      }
    }

    viewerEl.innerHTML = "";
    modalState.viewer = createMiniViewer(viewerEl, { autoRotate: true, background: 0x0d1117, worldUp: "z" });
    if (project.model_url) {
      if (viewerStatus) viewerStatus.textContent = "Loading 3D model…";
      try {
        const glbBlob = await authBlobUrl(project.model_url);
        modalState.blobUrls.push(glbBlob);
        await modalState.viewer.load(glbBlob);
        modalState.viewer.resize?.();
        if (viewerStatus) viewerStatus.textContent = project.model_file || "GLB preview";
      } catch (loadErr) {
        modalState.viewer?.dispose?.();
        modalState.viewer = null;
        if (viewerStatus) {
          viewerStatus.textContent = `Could not load 3D model (${loadErr.message || "error"}).`;
        }
        if (!snapsEl.children.length && project.preview_url) {
          try {
            const blobUrl = await authBlobUrl(project.preview_url);
            modalState.blobUrls.push(blobUrl);
            viewerEl.innerHTML = `<img class="admin-viewer-fallback-img" src="${blobUrl}" alt="Snapshot preview" />`;
          } catch {
            viewerEl.innerHTML = '<p class="muted admin-viewer-empty">No GLB preview available for this project.</p>';
          }
        } else {
          viewerEl.innerHTML = '<p class="muted admin-viewer-empty">3D preview failed to load.</p>';
        }
      }
    } else {
      viewerEl.innerHTML = '<p class="muted admin-viewer-empty">No GLB preview available for this project.</p>';
      if (viewerStatus) viewerStatus.textContent = "No GLB on disk — showing snapshots if any.";
    }
  } catch (err) {
    title.textContent = "Could not open project";
    sub.textContent = err.message || "Request failed";
    promptsEl.innerHTML = `<p class="muted">${escapeHtml(err.message || "Request failed")}</p>`;
  }
}

async function openUserPanel(root, userId, dashboardData) {
  const panel = root.querySelector("#admin-user-detail");
  if (!panel) return;
  panel.innerHTML = '<p class="muted">Loading user activity…</p>';
  panel.classList.remove("hidden");
  try {
    const data = await api(`/api/admin/users/${encodeURIComponent(userId)}`);
    const user = data.user || {};
    const stats = data.stats || {};
    const community = dashboardData.community || {};
    panel.innerHTML = `
      <div class="admin-user-detail-head">
        <div>
          <p class="info-eyebrow">User lookup</p>
          <h3>${escapeHtml(user.display_name || user.email || "User")}</h3>
          <p class="muted small">${escapeHtml(user.email || "")} · joined ${formatDate(user.created_at)} · active ${formatDate(user.last_active_at)}</p>
        </div>
        <button type="button" class="btn secondary btn-compact" id="admin-user-detail-close">Close</button>
      </div>
      <div class="admin-stats-grid admin-stats-grid--compact">
        ${statCard("Projects", formatNumber(stats.project_count))}
        ${statCard("Prompts", formatNumber(stats.prompt_count), stats.success_rate == null ? "" : `${Math.round(stats.success_rate * 100)}% success`)}
        ${statCard("Models", formatNumber(stats.model_count), `${formatNumber(stats.training_ready_count)} training-ready`)}
        ${statCard("Spend", formatMoney(stats.estimated_cost_usd), `${formatNumber(stats.total_tokens)} tokens`)}
      </div>
      <div class="admin-compare muted small">
        Community avg: ${formatNumber(community.avg_projects_per_user)} projects / ${formatNumber(community.avg_prompts_per_user)} prompts per user
        · community training-ready ${formatNumber(community.training_ready_count)}
      </div>
      <div class="admin-grid">
        <article>
          <h4>Recent models</h4>
          <div class="admin-list">${renderProjectRows(data.projects || [])}</div>
        </article>
        <article>
          <h4>Recent prompts</h4>
          <div class="admin-list admin-list--prompts">${renderPromptRows(data.recent_prompts || [])}</div>
        </article>
      </div>
    `;
    panel.querySelector("#admin-user-detail-close")?.addEventListener("click", () => {
      panel.classList.add("hidden");
      panel.innerHTML = "";
    });
    bindInteractive(panel, dashboardData);
    void hydrateThumbs(panel);
  } catch (err) {
    panel.innerHTML = `<p class="muted">${escapeHtml(err.message || "Could not load user")}</p>`;
  }
}

function bindInteractive(root, data) {
  root.querySelectorAll("[data-project-id]").forEach((el) => {
    const open = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = el.getAttribute("data-project-id") || el.dataset.projectId;
      if (id) void openProjectModal(id);
    };
    if (el.matches("button.admin-preview-btn")) {
      el.addEventListener("click", open);
    } else if (el.matches(".admin-project-row, .admin-prompt-row")) {
      el.addEventListener("click", open);
    }
  });
  root.querySelectorAll(".admin-user-row[data-user-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-user-id");
      if (id) void openUserPanel(root.closest(".admin-dashboard") || root, id, data);
    });
  });
}

function renderUserLookup(users = []) {
  return `
    <section class="admin-panel admin-lookup-panel">
      <div class="admin-lookup-head">
        <h3>User lookup</h3>
        <input type="search" id="admin-user-search" class="admin-user-search" placeholder="Search name or email…" />
      </div>
      <p class="muted small">Click a user for individual stats vs community averages, recent models, and prompts (for future training).</p>
      <div id="admin-user-lookup-list" class="admin-list admin-list--lookup">${renderUserRows(users.slice(0, 20))}</div>
      <div id="admin-user-detail" class="admin-user-detail hidden"></div>
    </section>
  `;
}

function renderDashboard(root, data) {
  const stats = data.stats || {};
  const community = data.community || {};
  root.innerHTML = `
    <section class="admin-hero-card">
      <div>
        <p class="info-eyebrow">Management</p>
        <h2>Site Overview</h2>
        <p class="info-lead">Users, recent model activity, prompt history, and training-ready prompt↔model pairs across Render3D.</p>
      </div>
      <button type="button" class="btn secondary" id="admin-refresh">Refresh</button>
    </section>

    <section class="admin-stats-grid">
      ${statCard("Users", formatNumber(stats.user_count), "Registered accounts")}
      ${statCard("Projects", formatNumber(stats.project_count), "Tracked project folders")}
      ${statCard("Prompts", formatNumber(stats.prompt_count), `${formatNumber(stats.success_count)} succeeded · ${formatNumber(stats.error_count)} errors`)}
      ${statCard("AI Spend", formatMoney(stats.estimated_cost_usd), `${formatNumber(stats.total_tokens)} tokens`)}
      ${statCard("Models", formatNumber(stats.model_count || community.model_count || 0), `${formatNumber(stats.training_ready_count || 0)} training-ready`)}
      ${statCard("Success Rate", stats.success_rate == null ? "—" : `${Math.round(stats.success_rate * 100)}%`, "Prompt history success")}
    </section>

    <section class="admin-grid admin-grid--wide-left">
      <article class="admin-panel admin-panel--charts">
        <h3>Activity Trend</h3>
        <p class="muted small admin-panel-hint">Switch chart views and toggle series. Continuous last 30 days.</p>
        <div id="admin-activity-charts"></div>
      </article>
      <article class="admin-panel">
        <h3>Community stats</h3>
        <div class="admin-pill-list">
          <span class="admin-pill"><strong>Avg projects/user</strong><em>${formatNumber(community.avg_projects_per_user)}</em></span>
          <span class="admin-pill"><strong>Avg prompts/user</strong><em>${formatNumber(community.avg_prompts_per_user)}</em></span>
          <span class="admin-pill"><strong>Training-ready</strong><em>${formatNumber(community.training_ready_count)}</em></span>
        </div>
        <h3 class="admin-subhead">Prompt Mix</h3>
        <div class="admin-pill-list">${countPills(data.prompt_kind_counts, "kind")}</div>
        <h3 class="admin-subhead">Top Models</h3>
        <div class="admin-pill-list">${countPills(data.prompt_model_counts, "model")}</div>
      </article>
    </section>

    <section class="admin-panel admin-panel--network">
      <h3>Collaboration brain</h3>
      <p class="muted small admin-panel-hint">Users ↔ projects ↔ teams. Owns, collab prompts, and workspace membership. Click a user or project node to open details.</p>
      <div id="admin-network-brain"></div>
    </section>

    ${renderUserLookup(data.users || data.active_users || [])}

    <section class="admin-grid">
      <article class="admin-panel">
        <h3>Recent Users</h3>
        <div class="admin-list">${renderUserRows(data.recent_users || [])}</div>
      </article>
      <article class="admin-panel">
        <h3>Most Active Users</h3>
        <div class="admin-list">${renderUserRows(data.active_users || [])}</div>
      </article>
    </section>

    <section class="admin-grid admin-grid--wide-right">
      <article class="admin-panel">
        <h3>Recent Projects</h3>
        <p class="muted small admin-panel-hint">Click a row or <strong>View model</strong> for 3D preview + prompt detail.</p>
        <div class="admin-list">${renderProjectRows(data.recent_projects || [])}</div>
      </article>
      <article class="admin-panel">
        <h3>Recent Prompt History</h3>
        <div class="admin-list admin-list--prompts">${renderPromptRows(data.recent_prompts || [])}</div>
      </article>
    </section>

    <section class="admin-panel admin-panel--agent-activity">
      <div class="admin-agent-head">
        <div>
          <h3>Render Agent activity</h3>
          <p class="muted small admin-panel-hint">Latest questions asked across all users in Render Agent chat.</p>
        </div>
        <button type="button" class="btn secondary btn-compact" id="admin-agent-refresh">Refresh</button>
      </div>
      <div class="admin-agent-stats" id="admin-agent-stats">
        <span class="admin-pill"><strong>Loading…</strong></span>
      </div>
      <div class="admin-agent-activity-list" id="admin-agent-activity-list">
        <p class="muted small">Loading Render Agent questions…</p>
      </div>
    </section>

    <section class="admin-panel admin-panel--gs-approvals">
      <div class="admin-agent-head">
        <div>
          <h3>Getting Started approvals</h3>
          <p class="muted small admin-panel-hint">User-generated GIF guides waiting for approval, plus Suggest-to-developer requests.</p>
        </div>
        <button type="button" class="btn secondary btn-compact" id="admin-gs-refresh">Refresh</button>
      </div>
      <div id="admin-gs-pending" class="admin-gs-pending-list">
        <p class="muted small">Loading…</p>
      </div>
      <h3 class="admin-subhead">Developer suggestions</h3>
      <div id="admin-gs-suggestions" class="admin-gs-pending-list">
        <p class="muted small">Loading…</p>
      </div>
    </section>

    <section class="admin-panel">
      <h3>File Formats</h3>
      <div class="admin-pill-list">${countPills(data.project_format_counts, "format")}</div>
      <p class="muted small">Generated ${formatDate(data.generated_at)}</p>
    </section>
  `;

  root.querySelector("#admin-refresh")?.addEventListener("click", () => loadDashboard(root));
  root.querySelector("#admin-agent-refresh")?.addEventListener("click", () => {
    void loadRenderAgentActivity(root);
  });
  root.querySelector("#admin-gs-refresh")?.addEventListener("click", () => {
    void loadGettingStartedApprovals(root);
  });
  void loadRenderAgentActivity(root);
  void loadGettingStartedApprovals(root);
  const search = root.querySelector("#admin-user-search");
  const lookupList = root.querySelector("#admin-user-lookup-list");
  const allUsers = data.users || [];
  search?.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    const filtered = !q
      ? allUsers.slice(0, 20)
      : allUsers.filter((u) => `${u.display_name || ""} ${u.email || ""}`.toLowerCase().includes(q)).slice(0, 30);
    if (lookupList) {
      lookupList.innerHTML = renderUserRows(filtered);
      bindInteractive(lookupList, data);
    }
  });
  bindInteractive(root, data);
  void hydrateThumbs(root);

  clearChartCleanups();
  const chartsHost = root.querySelector("#admin-activity-charts");
  const networkHost = root.querySelector("#admin-network-brain");
  if (chartsHost) chartCleanups.push(mountActivityCharts(chartsHost, data.daily || []));
  if (networkHost) {
    chartCleanups.push(mountNetworkBrain(networkHost, data.network || {}, {
      onNodeClick(node) {
        if (node.kind === "user" && node.user_id) void openUserPanel(root, node.user_id, data);
        if (node.kind === "project" && node.project_id) void openProjectModal(node.project_id);
      },
    }));
  }
}

function renderAgentActivityRows(items = []) {
  if (!items.length) {
    return `<p class="muted small">No Render Agent questions yet.</p>`;
  }
  return items
    .map((item) => {
      const when = formatDate(item.created_at);
      const who = escapeHtml(item.asker_name || item.owner_name || "User");
      const email = escapeHtml(item.owner_email || "");
      const thread = escapeHtml(item.thread_title || "Thread");
      const q = escapeHtml(item.question_preview || item.question || "");
      const attachments = Number(item.attachment_count || 0);
      return `
        <article class="admin-agent-activity-row">
          <div>
            <strong>${who}</strong>
            <span class="muted">${email}</span>
          </div>
          <div>
            <p class="admin-agent-activity-q">${q || "<span class='muted'>(empty message)</span>"}</p>
            <span class="muted">Thread · ${thread}${attachments ? ` · ${attachments} attachment${attachments === 1 ? "" : "s"}` : ""}</span>
          </div>
          <div class="admin-agent-activity-meta">${when}</div>
        </article>
      `;
    })
    .join("");
}

async function loadGettingStartedApprovals(root) {
  const pendingEl = root.querySelector("#admin-gs-pending");
  const suggestEl = root.querySelector("#admin-gs-suggestions");
  if (!pendingEl || !suggestEl) return;
  pendingEl.innerHTML = `<p class="muted small">Loading…</p>`;
  suggestEl.innerHTML = `<p class="muted small">Loading…</p>`;
  try {
    const data = await api("/api/admin/getting-started/pending?status=pending&limit=80");
    const pending = data.pending_guides || [];
    const suggestions = data.developer_suggestions || [];
    pendingEl.innerHTML = pending.length
      ? pending.map((item) => {
          const g = item.guide || {};
          const steps = (g.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
          return `
            <article class="admin-gs-pending-row" data-pending-id="${escapeHtml(item.id)}">
              <strong>${escapeHtml(g.title || "Untitled")}</strong>
              <p class="muted small">${escapeHtml(item.user_name || "")} · ${escapeHtml(item.question || "")}</p>
              <p>${escapeHtml(g.summary || "")}</p>
              <ol>${steps}</ol>
              ${g.gif ? `<p class="muted small"><a href="${escapeHtml(g.gif)}" target="_blank" rel="noopener">Demo GIF</a>${item.share_url ? ` · <a href="${escapeHtml(item.share_url)}" target="_blank" rel="noopener">Chat</a>` : ""}</p>` : ""}
              <div class="admin-gs-pending-actions">
                <button type="button" class="btn accent btn-compact" data-gs-review="approved">Approve</button>
                <button type="button" class="btn secondary btn-compact" data-gs-review="rejected">Reject</button>
              </div>
            </article>
          `;
        }).join("")
      : `<p class="muted small">No pending Getting Started guides.</p>`;
    suggestEl.innerHTML = suggestions.length
      ? suggestions.map((item) => `
          <article class="admin-gs-pending-row">
            <strong>${escapeHtml(item.user_name || "User")}</strong>
            <p>${escapeHtml(item.message || "")}</p>
            <p class="muted small">${escapeHtml(item.created_at || "")}${item.share_url ? ` · <a href="${escapeHtml(item.share_url)}" target="_blank" rel="noopener">Open chat</a>` : ""}${item.sms?.ok ? " · SMS sent" : " · SMS queued/logged"}</p>
          </article>
        `).join("")
      : `<p class="muted small">No developer suggestions yet.</p>`;

    pendingEl.querySelectorAll("[data-gs-review]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("[data-pending-id]");
        const id = row?.getAttribute("data-pending-id");
        const status = btn.getAttribute("data-gs-review");
        if (!id || !status) return;
        btn.disabled = true;
        try {
          await api(`/api/admin/getting-started/pending/${encodeURIComponent(id)}`, {
            method: "POST",
            body: JSON.stringify({ status }),
          });
          void loadGettingStartedApprovals(root);
        } catch (err) {
          btn.disabled = false;
          alert(err.message || "Review failed");
        }
      });
    });
  } catch (err) {
    pendingEl.innerHTML = `<p class="muted small">Could not load approvals: ${escapeHtml(err.message || "error")}</p>`;
    suggestEl.innerHTML = "";
  }
}

async function loadRenderAgentActivity(root) {
  const statsEl = root.querySelector("#admin-agent-stats");
  const listEl = root.querySelector("#admin-agent-activity-list");
  if (!statsEl || !listEl) return;
  statsEl.innerHTML = `<span class="admin-pill"><strong>Loading…</strong></span>`;
  listEl.innerHTML = `<p class="muted small">Loading Render Agent questions…</p>`;
  try {
    const data = await api("/api/admin/render-agent/activity?limit=80");
    const stats = data.stats || {};
    statsEl.innerHTML = `
      <span class="admin-pill"><strong>Questions</strong><em>${formatNumber(stats.question_count)}</em></span>
      <span class="admin-pill"><strong>Threads</strong><em>${formatNumber(stats.thread_count)}</em></span>
      <span class="admin-pill"><strong>Users</strong><em>${formatNumber(stats.user_count)}</em></span>
    `;
    listEl.innerHTML = renderAgentActivityRows(data.activity || []);
  } catch (err) {
    statsEl.innerHTML = "";
    listEl.innerHTML = `<p class="muted small">Could not load Render Agent activity: ${escapeHtml(err.message || "error")}</p>`;
  }
}

async function loadDashboard(root) {
  const user = getStoredUser();
  if (!getToken()) {
    root.innerHTML = '<section class="admin-hero-card"><h2>Sign in required</h2><p class="muted">Sign in with an admin account to view the management dashboard.</p><a class="btn primary" href="/">Go to Studio</a></section>';
    return;
  }
  if (!isAdminUser(user)) {
    root.innerHTML = '<section class="admin-hero-card"><h2>Admin only</h2><p class="muted">This dashboard is only visible to admin users.</p><a class="btn secondary" href="/">Back to Studio</a></section>';
    return;
  }
  root.innerHTML = '<section class="admin-hero-card"><h2>Loading dashboard…</h2><p class="muted">Aggregating users, projects, model previews, and prompt histories.</p></section>';
  clearChartCleanups();
  try {
    const data = await api("/api/admin/dashboard");
    renderDashboard(root, data);
  } catch (err) {
    root.innerHTML = `<section class="admin-hero-card"><h2>Could not load dashboard</h2><p class="muted">${escapeHtml(err.message || "Request failed")}</p><a class="btn secondary" href="/">Back to Studio</a></section>`;
  }
}

export function initAdminDashboard() {
  const root = document.getElementById("admin-dashboard-root");
  if (!root) return;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });
  loadDashboard(root);
}
