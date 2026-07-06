import { authHeaders, getStoredUser, getToken } from "./auth.js?v=20260706-admin-fusion-fix";

const ADMIN_EMAIL = "a1projects@protonmail.com";

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
      /* ignore non-json errors */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
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

function renderDailyChart(days = []) {
  if (!days.length) return '<p class="muted">No recent activity yet.</p>';
  const max = Math.max(1, ...days.map((d) => Math.max(d.prompts || 0, d.projects_created || 0, d.users_joined || 0)));
  return `
    <div class="admin-daily-chart">
      ${days.map((day) => {
        const promptH = Math.max(4, ((day.prompts || 0) / max) * 100);
        const projectH = Math.max(4, ((day.projects_created || 0) / max) * 100);
        const userH = Math.max(4, ((day.users_joined || 0) / max) * 100);
        return `
          <div class="admin-day" title="${escapeHtml(day.date)} · ${day.prompts || 0} prompts · ${day.projects_created || 0} projects · ${day.users_joined || 0} users">
            <i class="prompts" style="height:${promptH}%"></i>
            <i class="projects" style="height:${projectH}%"></i>
            <i class="users" style="height:${userH}%"></i>
            <span>${escapeHtml(String(day.date || "").slice(5))}</span>
          </div>
        `;
      }).join("")}
    </div>
    <div class="admin-legend">
      <span><i class="prompts"></i>Prompts</span>
      <span><i class="projects"></i>Projects</span>
      <span><i class="users"></i>Users joined</span>
    </div>
  `;
}

function renderUserRows(users = []) {
  if (!users.length) return '<p class="muted">No users yet.</p>';
  return users.map((user) => `
    <article class="admin-user-row">
      <div>
        <strong>${escapeHtml(user.display_name || user.email || "User")}</strong>
        <span>${escapeHtml(user.email || "")}</span>
      </div>
      <div class="admin-row-stats">
        <span>${formatNumber(user.project_count)} projects</span>
        <span>${formatNumber(user.prompt_count)} prompts</span>
        <span>${formatMoney(user.total_cost_usd)}</span>
      </div>
      <small>Joined ${formatDate(user.created_at)} · active ${formatDate(user.last_active_at)}</small>
    </article>
  `).join("");
}

function renderProjectRows(projects = []) {
  if (!projects.length) return '<p class="muted">No projects yet.</p>';
  return projects.map((project) => `
    <article class="admin-project-row">
      <div>
        <strong>${escapeHtml(project.name || project.id)}</strong>
        <span>${escapeHtml(project.owner_name || project.owner_email || "Unknown owner")}</span>
      </div>
      <div class="admin-row-stats">
        <span>${formatNumber(project.file_count)} files</span>
        ${project.public ? "<span>Public</span>" : ""}
      </div>
      <small>${escapeHtml(project.latest_file || "No model file")} · updated ${formatDate(project.updated_at)}</small>
    </article>
  `).join("");
}

function renderPromptRows(prompts = []) {
  if (!prompts.length) return '<p class="muted">No prompt history yet.</p>';
  return prompts.map((prompt) => `
    <article class="admin-prompt-row ${prompt.success ? "" : "admin-prompt-row--error"}">
      <div class="admin-prompt-head">
        <strong>${escapeHtml(prompt.user_name || prompt.owner_name || "Unknown user")}</strong>
        <span>${escapeHtml(prompt.kind || "cad")} · ${escapeHtml(prompt.prompt_mode || "mode")} · ${formatDate(prompt.created_at)}</span>
      </div>
      <p>${escapeHtml(prompt.prompt || "(empty prompt)")}</p>
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

function renderDashboard(root, data) {
  const stats = data.stats || {};
  root.innerHTML = `
    <section class="admin-hero-card">
      <div>
        <p class="info-eyebrow">Management</p>
        <h2>Site Overview</h2>
        <p class="info-lead">Users, project activity, prompt history, model usage, and estimated AI spend across Render3D.</p>
      </div>
      <button type="button" class="btn secondary" id="admin-refresh">Refresh</button>
    </section>

    <section class="admin-stats-grid">
      ${statCard("Users", formatNumber(stats.user_count), "Registered accounts")}
      ${statCard("Projects", formatNumber(stats.project_count), "Tracked project folders")}
      ${statCard("Prompts", formatNumber(stats.prompt_count), `${formatNumber(stats.success_count)} succeeded · ${formatNumber(stats.error_count)} errors`)}
      ${statCard("AI Spend", formatMoney(stats.estimated_cost_usd), `${formatNumber(stats.total_tokens)} tokens`)}
      ${statCard("Files", formatNumber(stats.file_count), "CAD and export files")}
      ${statCard("Success Rate", stats.success_rate == null ? "—" : `${Math.round(stats.success_rate * 100)}%`, "Prompt history success")}
    </section>

    <section class="admin-grid admin-grid--wide-left">
      <article class="admin-panel">
        <h3>Activity Trend</h3>
        ${renderDailyChart(data.daily || [])}
      </article>
      <article class="admin-panel">
        <h3>Prompt Mix</h3>
        <div class="admin-pill-list">${countPills(data.prompt_kind_counts, "kind")}</div>
        <h3 class="admin-subhead">Top Models</h3>
        <div class="admin-pill-list">${countPills(data.prompt_model_counts, "model")}</div>
      </article>
    </section>

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
        <div class="admin-list">${renderProjectRows(data.recent_projects || [])}</div>
      </article>
      <article class="admin-panel">
        <h3>Recent Prompt History</h3>
        <div class="admin-list admin-list--prompts">${renderPromptRows(data.recent_prompts || [])}</div>
      </article>
    </section>

    <section class="admin-panel">
      <h3>File Formats</h3>
      <div class="admin-pill-list">${countPills(data.project_format_counts, "format")}</div>
      <p class="muted small">Generated ${formatDate(data.generated_at)}</p>
    </section>
  `;
  root.querySelector("#admin-refresh")?.addEventListener("click", () => loadDashboard(root));
}

async function loadDashboard(root) {
  const user = getStoredUser();
  if (!getToken()) {
    root.innerHTML = '<section class="admin-hero-card"><h2>Sign in required</h2><p class="muted">Sign in as the a1projects user to view the management dashboard.</p><a class="btn primary" href="/">Go to Studio</a></section>';
    return;
  }
  if (user?.email && String(user.email).toLowerCase() !== ADMIN_EMAIL) {
    root.innerHTML = '<section class="admin-hero-card"><h2>Admin only</h2><p class="muted">This dashboard is only visible to the a1projects user.</p><a class="btn secondary" href="/">Back to Studio</a></section>';
    return;
  }
  root.innerHTML = '<section class="admin-hero-card"><h2>Loading dashboard…</h2><p class="muted">Aggregating users, projects, and prompt histories.</p></section>';
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
  loadDashboard(root);
}
