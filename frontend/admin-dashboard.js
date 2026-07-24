import { authHeaders, getStoredUser, getToken, isAdminUser } from "./auth.js?v=20260715-auth-connect-social";
import { createMiniViewer } from "./mini-viewer.js?v=20260716-bodycolor-init";
import { mountActivityCharts, mountNetworkBrain } from "./admin-charts.js?v=20260724-brain-avatars";

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

async function api(path, options = {}) {
  const headers = authHeaders(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...options, headers });
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

async function authDownloadFile(path, filename) {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Could not download ${filename || path}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "model";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function fileStem(name = "") {
  return String(name || "")
    .replace(/\.part\.step$/i, "")
    .replace(/\.fusionpart\.step$/i, "")
    .replace(/\.[^.]+$/, "");
}

function isFacetedStepName(name = "") {
  return /__faceted/i.test(String(name || ""));
}

function isPartStepName(name = "") {
  return /\.part\.step$/i.test(String(name || "")) || /\.fusionpart\.step$/i.test(String(name || ""));
}

function preferBetterDownloadOption(existing, candidate) {
  if (!existing) return candidate;
  if (!candidate) return existing;
  const aFaceted = isFacetedStepName(existing.name) || existing.step_kind === "faceted_mesh";
  const bFaceted = isFacetedStepName(candidate.name) || candidate.step_kind === "faceted_mesh";
  // Never let faceted mesh STEP win over a solid/editable B-rep sibling.
  if (String(candidate.format || "").toLowerCase() === "step") {
    if (aFaceted && !bFaceted) return candidate;
    if (!aFaceted && bFaceted) return existing;
    const aPart = existing.fusion_editable || existing.step_structure === "part" || isPartStepName(existing.name);
    const bPart = candidate.fusion_editable || candidate.step_structure === "part" || isPartStepName(candidate.name);
    if (bPart && !aPart) return candidate;
    if (aPart && !bPart) return existing;
    if (candidate.step_kind === "editable_brep" && existing.step_kind !== "editable_brep") return candidate;
  }
  if (candidate.related && !existing.related) return candidate;
  return existing;
}

function stepDownloadUrl(url, name) {
  const base = String(url || "");
  if (!base) {
    return name ? `/api/projects/_/files/${encodeURIComponent(name)}?step_mode=part` : "";
  }
  if (!/\.ste?p($|\?)/i.test(base) && !/\.ste?p$/i.test(String(name || ""))) return base;
  if (/[?&]step_mode=/i.test(base)) return base;
  return `${base}${base.includes("?") ? "&" : "?"}step_mode=part`;
}

function cleanStepDownloadName(name = "") {
  const stem = fileStem(name) || "model";
  return `${stem}.step`;
}

function buildDownloadOptions(project = {}, files = []) {
  const preferred = String(project.model_file || project.latest_file || "").trim();
  const stem = preferred ? fileStem(preferred).toLowerCase() : "";
  const formats = new Map();
  const order = ["glb", "stl", "step", "3mf", "obj"];
  const consider = (file) => {
    const name = String(file?.name || "").trim();
    if (!name) return;
    let fmt = String(file.format || name.split(".").pop() || "").toLowerCase();
    if (fmt === "stp") fmt = "step";
    if (!order.includes(fmt)) return;
    const url = file.url || null;
    if (!url) return;
    const related = !stem
      || fileStem(name).toLowerCase().startsWith(stem)
      || stem.startsWith(fileStem(name).toLowerCase());
    const candidate = {
      format: fmt,
      name,
      url,
      related: !!related,
      step_kind: file.step_kind || (fmt === "step" && isFacetedStepName(name) ? "faceted_mesh" : null),
    };
    formats.set(fmt, preferBetterDownloadOption(formats.get(fmt), candidate));
  };
  for (const file of files) consider(file);
  if (project.model_url && project.model_file) {
    consider({ name: project.model_file, format: "glb", url: project.model_url });
  }
  return [...formats.values()].sort((a, b) => {
    if (a.related !== b.related) return a.related ? -1 : 1;
    return order.indexOf(a.format) - order.indexOf(b.format);
  });
}

function bindModalDownload(el, options) {
  const wrap = el.querySelector("#admin-modal-download");
  const select = el.querySelector("#admin-modal-download-format");
  const btn = el.querySelector("#admin-modal-download-btn");
  if (!wrap || !select || !btn) return;
  if (!options.length) {
    wrap.hidden = true;
    select.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  // Prefer STEP (Fusion-ready Part) in the default selection when present.
  let preferredIdx = options.findIndex((opt) => {
    if (String(opt.format || "").toLowerCase() !== "step") return false;
    if (isFacetedStepName(opt.name) || opt.step_kind === "faceted_mesh") return false;
    return true;
  });
  if (preferredIdx < 0) preferredIdx = options.findIndex((opt) => String(opt.format || "").toLowerCase() === "step");
  if (preferredIdx < 0) preferredIdx = 0;
  select.innerHTML = options.map((opt, idx) => {
    const fmt = String(opt.format || "").toUpperCase();
    let label = fmt;
    let value = opt.url;
    let dlName = opt.name;
    if (String(opt.format || "").toLowerCase() === "step") {
      label = "STEP";
      value = stepDownloadUrl(opt.url, opt.name);
      dlName = opt.download_name || cleanStepDownloadName(opt.name);
    } else {
      label = `${fmt} · ${opt.name}`;
    }
    return `<option value="${escapeHtml(value)}" data-name="${escapeHtml(dlName)}"${idx === preferredIdx ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  btn.onclick = async () => {
    const option = select.selectedOptions?.[0];
    const url = select.value;
    const name = option?.dataset?.name || "model";
    if (!url) return;
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Downloading…";
    try {
      await authDownloadFile(url, name);
    } catch (err) {
      alert(err.message || "Download failed");
    } finally {
      btn.disabled = false;
      btn.textContent = prev || "Download";
    }
  };
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
const AGENT_ACTIVITY_DEFAULT_FILTERS = {
  actor: "all",
  modes: new Set(["render", "v2", "wiring", "rigging", "general"]),
};
const agentActivityFilters = {
  actor: AGENT_ACTIVITY_DEFAULT_FILTERS.actor,
  modes: new Set(AGENT_ACTIVITY_DEFAULT_FILTERS.modes),
};
let latestAgentActivity = [];
let latestAgentStats = {};
let adminRealtimeSocket = null;
let adminRealtimeReconnectTimer = null;
let adminDashboardRoot = null;

function clearChartCleanups() {
  chartCleanups.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
  chartCleanups = [];
}

function userRealtimeUrl() {
  const token = encodeURIComponent(getToken());
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/ws/user?token=${token}`;
}

function scheduleAdminRealtimeReconnect() {
  if (adminRealtimeReconnectTimer || !getToken()) return;
  adminRealtimeReconnectTimer = window.setTimeout(() => {
    adminRealtimeReconnectTimer = null;
    connectAdminRealtime();
  }, 2500);
}

function handleAdminRealtimeEvent(msg = {}) {
  if (!adminDashboardRoot || msg.type !== "management.notification.updated") return;
  const event = String(msg.event || "");
  if (event.startsWith("feedback.")) {
    void loadFeedbackInbox(adminDashboardRoot);
  }
  if (event.startsWith("new_user.")) {
    void loadNewUserAlerts(adminDashboardRoot);
  }
}

function connectAdminRealtime() {
  adminRealtimeSocket?.close();
  if (!getToken() || !isAdminUser(getStoredUser())) return;
  const ws = new WebSocket(userRealtimeUrl());
  adminRealtimeSocket = ws;
  ws.onmessage = (event) => {
    try {
      handleAdminRealtimeEvent(JSON.parse(event.data));
    } catch {
      /* ignore malformed realtime payload */
    }
  };
  ws.onclose = () => {
    if (adminRealtimeSocket === ws) {
      adminRealtimeSocket = null;
      scheduleAdminRealtimeReconnect();
    }
  };
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
        </div>
        <small title="${escapeHtml(project.latest_file || project.model_file || "No model file")}">${escapeHtml(project.latest_file || project.model_file || "No model file")} · updated ${formatDate(project.updated_at)}</small>
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
        <div class="admin-modal-head-actions">
          <div class="admin-modal-download" id="admin-modal-download" hidden>
            <label class="admin-modal-download-label" for="admin-modal-download-format">Download</label>
            <select id="admin-modal-download-format" aria-label="Download file format"></select>
            <button type="button" class="btn accent btn-compact" id="admin-modal-download-btn">Download</button>
          </div>
          <button type="button" class="btn secondary btn-compact" id="admin-modal-close">Close</button>
        </div>
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

    let downloadOptions = buildDownloadOptions(project, data.files || []);
    // Prefer exports API for sibling formats (STL/STEP/3MF) of the previewed model.
    const exportSource = project.model_file || project.latest_file;
    if (exportSource) {
      try {
        const exportData = await api(
          `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(exportSource)}/exports`,
        );
        const exportOpts = (exportData.exports || [])
          .filter((item) => item?.name)
          .map((item) => {
            let format = String(item.format || item.name.split(".").pop() || "").toLowerCase();
            if (format === "stp") format = "step";
            const url = item.url || `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(item.name)}`;
            return {
              format,
              name: item.name,
              url: format === "step" ? stepDownloadUrl(url, item.name) : url,
              related: true,
              step_kind: item.step_kind || (format === "step" && isFacetedStepName(item.name) ? "faceted_mesh" : null),
              step_structure: item.step_structure || null,
              fusion_editable: !!item.fusion_editable,
              base: !!item.base,
              download_name: item.download_name || (format === "step" ? cleanStepDownloadName(item.name) : item.name),
            };
          })
          .filter((item) => ["glb", "stl", "step", "3mf", "obj"].includes(item.format))
          .filter((item) => !(item.format === "step" && (isFacetedStepName(item.name) || item.step_kind === "faceted_mesh")));
        if (exportData.file_url && exportSource) {
          let srcFmt = String(exportSource.split(".").pop() || "").toLowerCase();
          if (srcFmt === "stp") srcFmt = "step";
          if (["glb", "stl", "step", "3mf", "obj"].includes(srcFmt)) {
            exportOpts.unshift({
              format: srcFmt,
              name: exportData.filename || exportSource,
              url: exportData.file_url,
              related: true,
              step_kind: srcFmt === "step"
                ? (isFacetedStepName(exportData.filename || exportSource) ? "faceted_mesh" : "editable_brep")
                : null,
            });
          }
        }
        if (exportOpts.length) {
          const byFmt = new Map(downloadOptions.map((o) => [o.format, o]));
          for (const opt of exportOpts) {
            byFmt.set(opt.format, preferBetterDownloadOption(byFmt.get(opt.format), opt));
          }
          downloadOptions = [...byFmt.values()].sort((a, b) => {
            const order = ["glb", "stl", "step", "3mf", "obj"];
            return order.indexOf(a.format) - order.indexOf(b.format);
          });
        }
      } catch {
        /* keep file-list options */
      }
    }
    bindModalDownload(el, downloadOptions);

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

function bindAdminViewToolbar(root) {
  const toolbar = root.querySelector(".admin-view-toolbar");
  if (!toolbar) return;
  const tabs = [...toolbar.querySelectorAll("[data-admin-view]")];
  const setActive = (view) => {
    tabs.forEach((tab) => tab.classList.toggle("active", tab.getAttribute("data-admin-view") === view));
  };
  const scrollToView = (view, { updateHash = true } = {}) => {
    const section = root.querySelector(`#admin-section-${CSS.escape(view)}`);
    if (!section) return;
    setActive(view);
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    if (updateHash) {
      try {
        history.replaceState(null, "", `#${view}`);
      } catch {
        /* hash update is best effort */
      }
    }
  };
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.getAttribute("data-admin-view") || "overview";
      scrollToView(view);
    });
  });
  const initialHash = (window.location.hash || "").replace(/^#/, "");
  if (initialHash && root.querySelector(`#admin-section-${CSS.escape(initialHash)}`)) {
    window.setTimeout(() => scrollToView(initialHash, { updateHash: false }), 80);
  }
  const sections = [...root.querySelectorAll("[data-admin-section][id]")];
  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    const view = visible?.target?.getAttribute("data-admin-section");
    if (view) setActive(view);
  }, { rootMargin: "-18% 0px -68% 0px", threshold: [0.1, 0.25, 0.5] });
  sections.forEach((section) => observer.observe(section));
  chartCleanups.push(() => observer.disconnect());
}

function renderUserLookup(users = []) {
  return `
    <section class="admin-panel admin-lookup-panel" id="admin-section-users" data-admin-section="users">
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

function renderAdminViewToolbar() {
  const items = [
    ["overview", "Overview", "Stats and trends"],
    ["requests", "Requests", "Suggestions and bugs"],
    ["new-users", "New Users", "Signup alerts"],
    ["agent", "Render Agent", "User questions"],
    ["approvals", "Approvals", "Guides and requests"],
    ["users", "Users", "Lookup and cohorts"],
    ["projects", "Projects", "Models and previews"],
    ["prompts", "Prompts", "History and errors"],
    ["network", "Network", "Collaboration graph"],
    ["training", "Training", "Ready data"],
  ];
  return `
    <nav class="admin-view-toolbar" aria-label="Management dashboard views">
      ${items.map(([id, label, hint], index) => `
        <button type="button" class="admin-view-tab${index === 0 ? " active" : ""}" data-admin-view="${id}">
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(hint)}</small>
        </button>
      `).join("")}
    </nav>
  `;
}

function renderDashboard(root, data) {
  const stats = data.stats || {};
  const community = data.community || {};
  root.innerHTML = `
    ${renderAdminViewToolbar()}

    <section class="admin-hero-card" id="admin-section-overview" data-admin-section="overview">
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

    <section class="admin-grid admin-grid--wide-left" data-admin-section="overview">
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

    <section class="admin-panel admin-panel--network" id="admin-section-network" data-admin-section="network">
      <h3>Collaboration brain</h3>
      <p class="muted small admin-panel-hint">Users ↔ projects ↔ teams. Owns, collab prompts, and workspace membership. Click a user or project node to open details.</p>
      <div id="admin-network-brain"></div>
    </section>

    ${renderUserLookup(data.users || data.active_users || [])}

    <section class="admin-grid" data-admin-section="users">
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
      <article class="admin-panel" id="admin-section-projects" data-admin-section="projects">
        <h3>Recent Projects</h3>
        <p class="muted small admin-panel-hint">Click a row or <strong>View model</strong> for 3D preview + prompt detail.</p>
        <div class="admin-list">${renderProjectRows(data.recent_projects || [])}</div>
      </article>
      <article class="admin-panel" id="admin-section-prompts" data-admin-section="prompts">
        <h3>Recent Prompt History</h3>
        <div class="admin-list admin-list--prompts">${renderPromptRows(data.recent_prompts || [])}</div>
      </article>
    </section>

    <section class="admin-panel admin-panel--agent-activity" id="admin-section-agent" data-admin-section="agent">
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
      <div class="admin-agent-controls" id="admin-agent-controls" aria-label="Render Agent activity filters"></div>
      <div class="admin-agent-activity-list" id="admin-agent-activity-list">
        <p class="muted small">Loading Render Agent questions…</p>
      </div>
    </section>

    <section class="admin-panel admin-panel--gs-approvals" id="admin-section-approvals" data-admin-section="approvals">
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

    <section class="admin-panel admin-panel--feedback-inbox" id="admin-section-new-users" data-admin-section="new-users">
      <div class="admin-alert-tabs" role="tablist" aria-label="Management inbox tabs">
        <button type="button" class="admin-alert-tab active" role="tab" aria-selected="true">New user alerts</button>
        <a class="admin-alert-tab" role="tab" href="#admin-feedback-list">Suggestions & bugs</a>
      </div>
      <div class="admin-agent-head">
        <div>
          <h3>New user alerts</h3>
          <p class="muted small admin-panel-hint">Realtime signup notifications for admins. Check, contact, or dismiss after review.</p>
        </div>
        <button type="button" class="btn secondary btn-compact" id="admin-new-user-refresh">Refresh</button>
      </div>
      <div class="admin-agent-stats" id="admin-new-user-stats">
        <span class="admin-pill"><strong>Loading…</strong></span>
      </div>
      <div id="admin-new-user-list" class="admin-feedback-list">
        <p class="muted small">Loading new user alerts…</p>
      </div>
      <div id="admin-onboarding-template"></div>
    </section>

    <section class="admin-panel admin-panel--feedback-inbox" id="admin-section-requests" data-admin-section="requests">
      <div class="admin-alert-tabs" role="tablist" aria-label="Management inbox tabs">
        <a class="admin-alert-tab" role="tab" href="#admin-new-user-list">New user alerts</a>
        <button type="button" class="admin-alert-tab active" role="tab" aria-selected="true">Suggestions & bugs</button>
      </div>
      <div class="admin-agent-head">
        <div>
          <h3>Suggestions & bug reports</h3>
          <p class="muted small admin-panel-hint">Unread user requests, screenshots, project/prompt context, and trace logs. Approve, deny, or mark checked.</p>
        </div>
        <button type="button" class="btn secondary btn-compact" id="admin-feedback-refresh">Refresh</button>
      </div>
      <div class="admin-agent-stats" id="admin-feedback-stats">
        <span class="admin-pill"><strong>Loading…</strong></span>
      </div>
      <div id="admin-feedback-list" class="admin-feedback-list">
        <p class="muted small">Loading feedback requests…</p>
      </div>
    </section>

    <section class="admin-panel" id="admin-section-training" data-admin-section="training">
      <h3>File Formats</h3>
      <div class="admin-pill-list">${countPills(data.project_format_counts, "format")}</div>
      <p class="muted small">Generated ${formatDate(data.generated_at)}</p>
    </section>
  `;

  root.querySelector("#admin-refresh")?.addEventListener("click", () => loadDashboard(root));
  root.querySelector("#admin-agent-refresh")?.addEventListener("click", () => {
    void loadRenderAgentActivity(root);
  });
  bindAgentActivityControls(root);
  root.querySelector("#admin-gs-refresh")?.addEventListener("click", () => {
    void loadGettingStartedApprovals(root);
  });
  root.querySelector("#admin-feedback-refresh")?.addEventListener("click", () => {
    void loadFeedbackInbox(root);
  });
  root.querySelector("#admin-new-user-refresh")?.addEventListener("click", () => {
    void loadNewUserAlerts(root);
  });
  void loadRenderAgentActivity(root);
  void loadGettingStartedApprovals(root);
  void loadNewUserAlerts(root);
  void loadFeedbackInbox(root);
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
  bindAdminViewToolbar(root);
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

function agentActivityActor(item = {}) {
  const text = [
    item.actor,
    item.source,
    item.sender_type,
    item.kind,
    item.thread_title,
    item.question,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/\b(system|assistant|render agent|agent reply|automated|tool|generated|pipeline)\b/.test(text)) return "system";
  return "user";
}

function agentActivityMode(item = {}) {
  const text = [
    item.mode,
    item.prompt_mode,
    item.thread_title,
    item.folder,
    item.question,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/\b(wiring|schematic|circuit|arduino|servo|stepper|pin|gpio|breadboard)\b/.test(text)) return "wiring";
  if (/\b(rigging|urdf|joint|kinematic|inverse kinematics|motion|simulate movement)\b/.test(text)) return "rigging";
  if (/\b(2\.0|v2|text to cad|cad generate|build123d|source|step-valid|parametric)\b/.test(text)) return "v2";
  if (/\b(render|photoreal|environment|kitchen|scene|lighting|material|texture)\b/.test(text)) return "render";
  return "general";
}

function agentActivityModeLabel(mode) {
  return {
    render: "Render prompt",
    v2: "2.0 CAD",
    wiring: "Wiring",
    rigging: "Rigging",
    general: "General",
  }[mode] || "General";
}

function normalizeAgentActivity(items = []) {
  return items.map((item) => ({
    ...item,
    _actor: agentActivityActor(item),
    _mode: agentActivityMode(item),
  }));
}

function filteredAgentActivity(items = latestAgentActivity) {
  return (items || []).filter((item) => {
    if (agentActivityFilters.actor !== "all" && item._actor !== agentActivityFilters.actor) return false;
    if (!agentActivityFilters.modes.has(item._mode)) return false;
    return true;
  });
}

function renderAgentFilterButton({ type, value, label, count, active }) {
  return `
    <button
      type="button"
      class="admin-agent-filter${active ? " active" : ""}"
      data-agent-filter-type="${escapeHtml(type)}"
      data-agent-filter-value="${escapeHtml(value)}"
      aria-pressed="${active ? "true" : "false"}"
    >
      <span>${escapeHtml(label)}</span>
      <em>${formatNumber(count)}</em>
    </button>
  `;
}

function renderAgentActivityControls(items = latestAgentActivity) {
  const counts = items.reduce((acc, item) => {
    acc.actor[item._actor] = (acc.actor[item._actor] || 0) + 1;
    acc.mode[item._mode] = (acc.mode[item._mode] || 0) + 1;
    return acc;
  }, { actor: { all: items.length, user: 0, system: 0 }, mode: { render: 0, v2: 0, wiring: 0, rigging: 0, general: 0 } });
  const modeOrder = ["render", "v2", "wiring", "rigging", "general"];
  return `
    <div class="admin-agent-filter-group" role="group" aria-label="Actor">
      <span>Show</span>
      ${renderAgentFilterButton({ type: "actor", value: "all", label: "All", count: counts.actor.all, active: agentActivityFilters.actor === "all" })}
      ${renderAgentFilterButton({ type: "actor", value: "user", label: "Users", count: counts.actor.user, active: agentActivityFilters.actor === "user" })}
      ${renderAgentFilterButton({ type: "actor", value: "system", label: "System", count: counts.actor.system, active: agentActivityFilters.actor === "system" })}
    </div>
    <div class="admin-agent-filter-group" role="group" aria-label="Prompt areas">
      <span>Area</span>
      ${modeOrder.map((mode) => renderAgentFilterButton({
        type: "mode",
        value: mode,
        label: agentActivityModeLabel(mode),
        count: counts.mode[mode] || 0,
        active: agentActivityFilters.modes.has(mode),
      })).join("")}
    </div>
  `;
}

function renderAgentActivityRows(items = []) {
  const visible = filteredAgentActivity(items);
  if (!items.length) {
    return `<p class="muted small">No Render Agent questions yet.</p>`;
  }
  if (!visible.length) {
    return `<p class="muted small admin-agent-empty">No questions match these filters. Turn on another user/system or prompt-area toggle.</p>`;
  }
  return visible
    .map((item) => {
      const when = formatDate(item.created_at);
      const who = escapeHtml(item.asker_name || item.owner_name || "User");
      const email = escapeHtml(item.owner_email || "");
      const thread = escapeHtml(item.thread_title || "Thread");
      const q = escapeHtml(item.question_preview || item.question || "");
      const attachments = Number(item.attachment_count || 0);
      const actor = item._actor === "system" ? "System" : "User";
      const mode = agentActivityModeLabel(item._mode);
      return `
        <article class="admin-agent-activity-row admin-agent-activity-row--${escapeHtml(item._mode)}">
          <div class="admin-agent-activity-main">
            <div class="admin-agent-activity-person">
              <span class="admin-agent-avatar" aria-hidden="true">${escapeHtml((who || "U").trim().slice(0, 1).toUpperCase())}</span>
              <div>
                <strong>${who}</strong>
                <span>${email || "No email"}</span>
              </div>
            </div>
            <p class="admin-agent-activity-q">${q || "<span class='muted'>(empty message)</span>"}</p>
            <div class="admin-agent-activity-tags">
              <span>${escapeHtml(actor)}</span>
              <span>${escapeHtml(mode)}</span>
              <span>Thread · ${thread}</span>
              ${attachments ? `<span>${attachments} attachment${attachments === 1 ? "" : "s"}</span>` : ""}
            </div>
          </div>
          <time class="admin-agent-activity-meta" datetime="${escapeHtml(item.created_at || "")}">${when}</time>
        </article>
      `;
    })
    .join("");
}

function renderAgentActivity(root) {
  const listEl = root.querySelector("#admin-agent-activity-list");
  const controlsEl = root.querySelector("#admin-agent-controls");
  const statsEl = root.querySelector("#admin-agent-stats");
  if (controlsEl) controlsEl.innerHTML = renderAgentActivityControls(latestAgentActivity);
  if (listEl) listEl.innerHTML = renderAgentActivityRows(latestAgentActivity);
  if (statsEl) {
    statsEl.innerHTML = `
      <span class="admin-pill"><strong>Questions</strong><em>${formatNumber(latestAgentStats.question_count)}</em></span>
      <span class="admin-pill"><strong>Threads</strong><em>${formatNumber(latestAgentStats.thread_count)}</em></span>
      <span class="admin-pill"><strong>Users</strong><em>${formatNumber(latestAgentStats.user_count)}</em></span>
      <span class="admin-pill"><strong>Visible</strong><em>${formatNumber(filteredAgentActivity().length)}</em></span>
    `;
  }
}

function bindAgentActivityControls(root) {
  const controlsEl = root.querySelector("#admin-agent-controls");
  if (!controlsEl) return;
  controlsEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-agent-filter-type]");
    if (!btn) return;
    const type = btn.getAttribute("data-agent-filter-type");
    const value = btn.getAttribute("data-agent-filter-value");
    if (type === "actor") {
      agentActivityFilters.actor = value || "all";
    } else if (type === "mode") {
      if (agentActivityFilters.modes.has(value)) {
        if (agentActivityFilters.modes.size > 1) agentActivityFilters.modes.delete(value);
      } else if (value) {
        agentActivityFilters.modes.add(value);
      }
    }
    renderAgentActivity(root);
  });
}

function renderFeedbackRows(items = []) {
  if (!items.length) return `<p class="muted small">No feedback requests yet.</p>`;
  return items.map((item) => {
    const screenshots = (item.screenshots || []).map((shot, idx) => (
      `<button type="button" class="admin-feedback-shot-link" data-feedback-shot="${escapeHtml(shot.url || "")}">Screenshot ${idx + 1}</button>`
    )).join(" · ");
    const context = item.context || {};
    const prompt = context.prompt_history?.prompt || item.prompt_label || "";
    const trace = item.trace_id || context.trace_id || context.prompt_history?.trace_id || "";
    const unread = item.unread ? `<span class="admin-feedback-unread">Unread</span>` : "";
    const adminMessages = (item.admin_messages || []).slice(-3).map((msg) => `
      <li>
        <strong>${escapeHtml(msg.admin_name || "Admin")}</strong>
        <span>${escapeHtml(msg.message || "")}</span>
        <small>${formatDate(msg.created_at)}${msg.project_id ? " · sent to chat" : " · sent notification"}</small>
      </li>
    `).join("");
    return `
      <article class="admin-feedback-row admin-feedback-row--${escapeHtml(item.kind || "request")}" data-feedback-id="${escapeHtml(item.id)}">
        <div class="admin-feedback-head">
          <div>
            <strong>${escapeHtml(item.kind === "bug" ? "Bug report" : "Suggestion")} ${unread}</strong>
            <span class="muted small">${escapeHtml(item.user_name || "User")} · ${escapeHtml(item.user_email || "")} · ${formatDate(item.created_at)}</span>
          </div>
          <span class="admin-feedback-status">${escapeHtml(item.status || "open")}</span>
        </div>
        <p>${escapeHtml(item.message || "")}</p>
        <p class="muted small">
          ${item.project_id ? `Project: ${escapeHtml(item.project_name || item.project_id)}` : "No project"}
          ${item.prompt_id ? ` · Prompt: ${escapeHtml(item.prompt_id)}` : ""}
          ${trace ? ` · Trace: ${escapeHtml(trace)}` : ""}
          ${item.page_url ? ` · <a href="${escapeHtml(item.page_url)}" target="_blank" rel="noopener">Page</a>` : ""}
          ${screenshots ? ` · ${screenshots}` : ""}
        </p>
        ${prompt ? `<details class="admin-feedback-details"><summary>Prompt / trace context</summary><pre>${escapeHtml(JSON.stringify({ prompt, trace_log: context.trace_log || [], generation_jobs: context.generation_jobs || [] }, null, 2))}</pre></details>` : ""}
        ${adminMessages ? `<ul class="admin-feedback-admin-messages">${adminMessages}</ul>` : ""}
        <div class="admin-gs-pending-actions">
          <button type="button" class="btn accent btn-compact" data-feedback-message>Ask user</button>
          <button type="button" class="btn accent btn-compact" data-feedback-review="approved">Approve</button>
          <button type="button" class="btn secondary btn-compact" data-feedback-review="checked">Check</button>
          <button type="button" class="btn secondary btn-compact" data-feedback-review="denied">Deny</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderNewUserRows(items = []) {
  if (!items.length) return `<p class="muted small">No new user alerts yet.</p>`;
  return items.map((item) => {
    const unread = item.unread ? `<span class="admin-feedback-unread">Unread</span>` : "";
    return `
      <article class="admin-feedback-row admin-feedback-row--new-user" data-new-user-alert-id="${escapeHtml(item.id)}">
        <div class="admin-feedback-head">
          <div>
            <strong>New user signup ${unread}</strong>
            <span class="muted small">${escapeHtml(item.user_name || "User")} · ${escapeHtml(item.user_email || "")} · ${formatDate(item.created_at)}</span>
          </div>
          <span class="admin-feedback-status">${escapeHtml(item.status || "new")}</span>
        </div>
        <p>${escapeHtml(item.user_name || "A new user")} created an account from ${escapeHtml(item.source || "signup")}.</p>
        <div class="admin-gs-pending-actions">
          <button type="button" class="btn accent btn-compact" data-new-user-review="contacted">Contacted</button>
          <button type="button" class="btn secondary btn-compact" data-new-user-review="checked">Check</button>
          <button type="button" class="btn secondary btn-compact" data-new-user-review="dismissed">Dismiss</button>
        </div>
      </article>
    `;
  }).join("");
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

async function loadFeedbackInbox(root) {
  const statsEl = root.querySelector("#admin-feedback-stats");
  const listEl = root.querySelector("#admin-feedback-list");
  if (!statsEl || !listEl) return;
  statsEl.innerHTML = `<span class="admin-pill"><strong>Loading…</strong></span>`;
  listEl.innerHTML = `<p class="muted small">Loading feedback requests…</p>`;
  try {
    const data = await api("/api/admin/feedback/requests?status=all&limit=120&mark_read=true");
    const summary = data.summary || {};
    statsEl.innerHTML = `
      <span class="admin-pill"><strong>Unread</strong><em>${formatNumber(summary.unread_count)}</em></span>
      <span class="admin-pill"><strong>Open</strong><em>${formatNumber(summary.open_count)}</em></span>
      <span class="admin-pill"><strong>Bugs</strong><em>${formatNumber(summary.bug_count)}</em></span>
      <span class="admin-pill"><strong>Suggestions</strong><em>${formatNumber(summary.suggestion_count)}</em></span>
    `;
    listEl.innerHTML = renderFeedbackRows(data.requests || []);
    listEl.querySelectorAll("[data-feedback-message]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("[data-feedback-id]");
        const id = row?.getAttribute("data-feedback-id");
        if (!id) return;
        const text = window.prompt("Message this user from Render3D support:");
        if (!text || !text.trim()) return;
        btn.disabled = true;
        try {
          await api(`/api/admin/feedback/requests/${encodeURIComponent(id)}/message`, {
            method: "POST",
            body: JSON.stringify({ message: text.trim() }),
          });
          void loadFeedbackInbox(root);
        } catch (err) {
          btn.disabled = false;
          alert(err.message || "Could not message user");
        }
      });
    });
    listEl.querySelectorAll("[data-feedback-review]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("[data-feedback-id]");
        const id = row?.getAttribute("data-feedback-id");
        const status = btn.getAttribute("data-feedback-review");
        if (!id || !status) return;
        btn.disabled = true;
        try {
          await api(`/api/admin/feedback/requests/${encodeURIComponent(id)}`, {
            method: "POST",
            body: JSON.stringify({ status }),
          });
          void loadFeedbackInbox(root);
        } catch (err) {
          btn.disabled = false;
          alert(err.message || "Review failed");
        }
      });
    });
    listEl.querySelectorAll("[data-feedback-shot]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const url = btn.getAttribute("data-feedback-shot");
        if (!url) return;
        btn.disabled = true;
        try {
          const blobUrl = await authBlobUrl(url);
          window.open(blobUrl, "_blank", "noopener");
        } catch (err) {
          alert(err.message || "Could not open screenshot");
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    statsEl.innerHTML = "";
    listEl.innerHTML = `<p class="muted small">Could not load feedback requests: ${escapeHtml(err.message || "error")}</p>`;
  }
}

async function loadNewUserAlerts(root) {
  const statsEl = root.querySelector("#admin-new-user-stats");
  const listEl = root.querySelector("#admin-new-user-list");
  const templateEl = root.querySelector("#admin-onboarding-template");
  if (!statsEl || !listEl) return;
  statsEl.innerHTML = `<span class="admin-pill"><strong>Loading…</strong></span>`;
  listEl.innerHTML = `<p class="muted small">Loading new user alerts…</p>`;
  try {
    const data = await api("/api/admin/new-users?status=all&limit=120&mark_read=true");
    const summary = data.summary || {};
    statsEl.innerHTML = `
      <span class="admin-pill"><strong>Unread</strong><em>${formatNumber(summary.unread_count)}</em></span>
      <span class="admin-pill"><strong>Open</strong><em>${formatNumber(summary.open_count)}</em></span>
      <span class="admin-pill"><strong>Total</strong><em>${formatNumber(summary.total_count)}</em></span>
    `;
    listEl.innerHTML = renderNewUserRows(data.alerts || []);
    listEl.querySelectorAll("[data-new-user-review]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("[data-new-user-alert-id]");
        const id = row?.getAttribute("data-new-user-alert-id");
        const status = btn.getAttribute("data-new-user-review");
        if (!id || !status) return;
        btn.disabled = true;
        try {
          await api(`/api/admin/new-users/${encodeURIComponent(id)}`, {
            method: "POST",
            body: JSON.stringify({ status }),
          });
          void loadNewUserAlerts(root);
        } catch (err) {
          btn.disabled = false;
          alert(err.message || "Review failed");
        }
      });
    });
    if (templateEl) {
      try {
        const templateData = await api("/api/admin/onboarding-email/template");
        const template = templateData.template || {};
        templateEl.innerHTML = `
          <details class="admin-feedback-details">
            <summary>Preview onboarding email template</summary>
            <p class="muted small"><strong>${escapeHtml(template.subject || "Welcome email")}</strong></p>
            <pre>${escapeHtml(template.text || "")}</pre>
          </details>
        `;
      } catch {
        templateEl.innerHTML = "";
      }
    }
  } catch (err) {
    statsEl.innerHTML = "";
    listEl.innerHTML = `<p class="muted small">Could not load new user alerts: ${escapeHtml(err.message || "error")}</p>`;
  }
}

async function loadRenderAgentActivity(root) {
  const statsEl = root.querySelector("#admin-agent-stats");
  const listEl = root.querySelector("#admin-agent-activity-list");
  const controlsEl = root.querySelector("#admin-agent-controls");
  if (!statsEl || !listEl) return;
  statsEl.innerHTML = `<span class="admin-pill"><strong>Loading…</strong></span>`;
  if (controlsEl) controlsEl.innerHTML = "";
  listEl.innerHTML = `<p class="muted small">Loading Render Agent questions…</p>`;
  try {
    const data = await api("/api/admin/render-agent/activity?limit=80");
    const stats = data.stats || {};
    latestAgentStats = stats;
    latestAgentActivity = normalizeAgentActivity(data.activity || []);
    statsEl.innerHTML = `
      <span class="admin-pill"><strong>Questions</strong><em>${formatNumber(stats.question_count)}</em></span>
      <span class="admin-pill"><strong>Threads</strong><em>${formatNumber(stats.thread_count)}</em></span>
      <span class="admin-pill"><strong>Users</strong><em>${formatNumber(stats.user_count)}</em></span>
      <span class="admin-pill"><strong>Visible</strong><em>${formatNumber(filteredAgentActivity().length)}</em></span>
    `;
    renderAgentActivity(root);
  } catch (err) {
    latestAgentActivity = [];
    latestAgentStats = {};
    statsEl.innerHTML = "";
    if (controlsEl) controlsEl.innerHTML = "";
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
  adminDashboardRoot = root;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });
  loadDashboard(root);
  connectAdminRealtime();
}
