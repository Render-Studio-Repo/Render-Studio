/**
 * Workspace popup — people with permission controls, searchable project thumbs.
 */

import { authHeaders } from "../studio/auth.js?v=20260805-handle-signup";
import { foldersForWorkspace, projectsForWorkspace } from "./workspace-list.js?v=20260908-ws-inv1";
import {
  isInviteEmail,
  inviteStatusMessage,
  sendWorkspaceEmailInvite,
  teamAllowsInvite,
} from "./workspace-send-invite.js?v=20260908-ws-inv1&leakfix43&leakfix44&leakfix45&leakfix46";

const MODAL_ID = "workspace-inspect-modal";
const EMPTY_THUMB_SRC = "/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1";
const PROJECT_PAGE = 12;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function $(id) {
  return document.getElementById(id);
}

export function matchesInspectQuery(item, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    item?.name,
    item?.display_name,
    item?.email,
    item?.role,
    item?.role_label,
    item?.latest_file,
    item?.latest_model,
    item?.folder_name,
    item?.description,
    item?.prompt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function ensureModal() {
  let modal = $(MODAL_ID);
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.className = "auth-modal workspace-inspect-modal hidden";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "workspace-inspect-title");
  modal.innerHTML = `
    <div class="auth-backdrop" data-ws-inspect-close></div>
    <div class="auth-card app-dialog-card workspace-inspect-card">
      <button type="button" class="auth-close" data-ws-inspect-close aria-label="Close">&times;</button>
      <p class="workspace-manage-eyebrow">Workspace</p>
      <h2 id="workspace-inspect-title" class="app-dialog-title">Workspace</h2>
      <p id="workspace-inspect-sub" class="muted small workspace-inspect-sub"></p>
      <div id="workspace-inspect-toolbar" class="workspace-inspect-toolbar"></div>
      <div id="workspace-inspect-body" class="workspace-inspect-body"></div>
      <p id="workspace-inspect-status" class="muted small" role="status"></p>
      <div class="app-dialog-actions">
        <button type="button" class="cad-lib-btn" data-ws-inspect-close>Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function setStatus(text, isError = false) {
  const el = $("workspace-inspect-status");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-error", !!isError && !!text);
}

async function sendInspectInvite(opts, team) {
  const email = String($("ws-inspect-invite-email")?.value || "").trim();
  if (!teamAllowsInvite(team)) {
    setStatus("You do not have permission to invite people to this workspace.", true);
    return;
  }
  if (!isInviteEmail(email)) {
    setStatus("Enter a valid email address.", true);
    return;
  }
  setStatus("Sending invite…");
  try {
    const result = await sendWorkspaceEmailInvite(opts.api, team.id, email);
    setStatus(inviteStatusMessage(result, email));
    const input = $("ws-inspect-invite-email");
    if (input) input.value = "";
    await opts.onChanged?.({ action: "invite", teamId: team.id, result });
  } catch (err) {
    setStatus(err?.message || "Invite failed.", true);
  }
}

let boundOpts = null;
let bound = false;
let activeTeamId = null;
let inspectQuery = "";
let folderFilter = "";
let showAllProjects = false;
let inspectCache = { members: [], canManage: false, loadError: "" };
let inspectView = "grid";
let inspectSort = "recent";
const thumbBlobs = new Map();
function revokeUnlistedInspectThumbs(keepIds) { // leakfix28
  const keep = new Set([...keepIds || []].map((id) => String(id || "")).filter(Boolean));
  for (const [id, url] of [...thumbBlobs.entries()]) {
    if (keep.has(String(id))) continue;
    thumbBlobs.delete(id);
    if (!url) continue;
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
}

function readInspectPrefs(opts) {
  const prefs = opts?.readExplorerPrefs?.() || {};
  const view = prefs.inspectView || prefs.view;
  if (view === "list" || view === "grid") inspectView = view;
  if (prefs.inspectSort === "name" || prefs.inspectSort === "recent") inspectSort = prefs.inspectSort;
}

function persistInspectPrefs(opts) {
  opts?.writeExplorerPrefs?.({ inspectView, inspectSort, view: inspectView });
}

function projectDescription(p) {
  const raw = String(
    p.description || p.prompt || p.latest_prompt || p.generation?.prompt || p.generation?.original_prompt || "",
  ).replace(/\s+/g, " ").trim();
  if (raw) return raw.length > 140 ? `${raw.slice(0, 137)}…` : raw;
  return p.folder_name || p.latest_file || p.latest_model || "No description yet";
}

function projectCreatedLabel(p) {
  const stamp = p.created_at || p.updated_at;
  if (!stamp) return "";
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { dateStyle: "medium" });
}

function teamRecord(opts, teamId) {
  return (opts.getTeams?.() || []).find((t) => String(t.id) === String(teamId)) || null;
}

function teamTitle(opts, team) {
  const pid = opts.personalWorkspaceId?.();
  if (team?.id && pid && String(team.id) === String(pid)) {
    return opts.personalWorkspaceLabel?.() || team.name || "Personal workspace";
  }
  return team?.name || "Workspace";
}

function canManageTeam(opts, team, summary = {}) {
  if (summary.can_manage_roles) return true;
  const role = String(team?.role || "").toLowerCase();
  return role === "owner" || role === "admin";
}

function renderToolbar(opts, team) {
  const bar = $("workspace-inspect-toolbar");
  if (!bar || !team) return;
  const visible = opts.isWorkspaceVisible ? opts.isWorkspaceVisible(team.id) !== false : true;
  const canInvite = teamAllowsInvite(team);
  bar.innerHTML = `
    <label class="workspace-inspect-search">
      <span class="visually-hidden">Search people and projects</span>
      <input type="search" id="workspace-inspect-query" placeholder="Search people or projects" maxlength="120" autocomplete="off" value="${escapeHtml(inspectQuery)}" />
    </label>
    <label class="ws-manage-visible-toggle" title="Show this workspace in the left sidebar">
      <input type="checkbox" data-ws-inspect-visible ${visible ? "checked" : ""} />
      <span>Show in sidebar</span>
    </label>
    <label class="workspace-inspect-sort">
      <span class="visually-hidden">Sort projects</span>
      <select data-ws-inspect-sort>
        <option value="recent" ${inspectSort === "recent" ? "selected" : ""}>Newest</option>
        <option value="name" ${inspectSort === "name" ? "selected" : ""}>Name</option>
      </select>
    </label>
    <div class="workspace-inspect-view" role="group" aria-label="Project layout">
      <button type="button" class="cad-lib-btn${inspectView === "list" ? " cad-lib-btn--accent" : " cad-lib-btn--ghost"}" data-ws-inspect-view="list">List</button>
      <button type="button" class="cad-lib-btn${inspectView === "grid" ? " cad-lib-btn--accent" : " cad-lib-btn--ghost"}" data-ws-inspect-view="grid">Grid</button>
    </div>
    <div class="workspace-inspect-toolbar-actions">
      <button type="button" class="cad-lib-btn cad-lib-btn--accent" data-ws-inspect-invite>Invite</button>
      <button type="button" class="cad-lib-btn" data-ws-inspect-manage>Manage</button>
    </div>
    <form class="workspace-inspect-invite-form hidden" data-ws-inspect-invite-form>
      <label class="visually-hidden" for="ws-inspect-invite-email">Invite by email</label>
      <input type="email" id="ws-inspect-invite-email" placeholder="name@example.com" autocomplete="email" maxlength="254" />
      <button type="submit" class="cad-lib-btn cad-lib-btn--accent">Send invite</button>
    </form>
  `;
  const search = bar.querySelector("#workspace-inspect-query");
  search?.addEventListener("input", () => {
    inspectQuery = search.value;
    const teamNow = teamRecord(opts, activeTeamId);
    if (teamNow) renderBody(opts, teamNow, inspectCache);
    const next = $("workspace-inspect-query");
    if (next) {
      next.focus();
      const len = next.value.length;
      next.setSelectionRange(len, len);
    }
  });
  bar.querySelector("[data-ws-inspect-visible]")?.addEventListener("change", (ev) => {
    const on = !!ev.target.checked;
    void opts.onToggleVisible?.(team.id, on);
    setStatus(on ? "Shown in the left sidebar." : "Hidden from the left sidebar.");
  });
  bar.querySelector("[data-ws-inspect-invite]")?.addEventListener("click", () => {
    const form = bar.querySelector("[data-ws-inspect-invite-form]");
    if (!canInvite) {
      form?.classList.add("hidden");
      setStatus("You do not have permission to invite people to this workspace.", true);
      return;
    }
    form?.classList.toggle("hidden");
    if (form && !form.classList.contains("hidden")) {
      $("ws-inspect-invite-email")?.focus?.();
    }
  });
  bar.querySelector("[data-ws-inspect-invite-form]")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void sendInspectInvite(opts, team);
  });
  bar.querySelector("[data-ws-inspect-manage]")?.addEventListener("click", () => {
    closeWorkspaceInspect();
    opts.onManage?.(team.id);
  });
  bar.querySelector("[data-ws-inspect-sort]")?.addEventListener("change", (ev) => {
    inspectSort = ev.target.value === "name" ? "name" : "recent";
    persistInspectPrefs(opts);
    const teamNow = teamRecord(opts, activeTeamId);
    if (teamNow) renderBody(opts, teamNow, inspectCache);
  });
  bar.querySelectorAll("[data-ws-inspect-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-ws-inspect-view") === "list" ? "list" : "grid";
      if (next === inspectView) return;
      inspectView = next;
      persistInspectPrefs(opts);
      renderToolbar(opts, team);
      renderBody(opts, team, inspectCache);
    });
  });
}

function memberControlsHtml(m, canManage) {
  const isOwner = String(m.role || "").toLowerCase() === "owner";
  const name = escapeHtml(m.display_name || m.email || "Member");
  if (!canManage || isOwner) {
    return `
      <div class="workspace-inspect-member-flags">
        <span class="ws-inspect-pill">${escapeHtml(m.role_label || m.role || "member")}</span>
        <span class="muted small">${m.access === "view" ? "View only" : "Can edit"}</span>
        ${m.can_invite ? `<span class="muted small">Can invite</span>` : ""}
      </div>
    `;
  }
  return `
    <div class="workspace-inspect-member-perms">
      <label>
        <span>Role</span>
        <select data-ws-inspect-role data-user="${escapeHtml(m.id)}">
          <option value="manager" ${m.role === "manager" ? "selected" : ""}>Manager</option>
          <option value="user" ${m.role !== "manager" ? "selected" : ""}>User</option>
        </select>
      </label>
      <label>
        <span>Access</span>
        <select data-ws-inspect-access data-user="${escapeHtml(m.id)}">
          <option value="edit" ${m.access !== "view" ? "selected" : ""}>Can edit</option>
          <option value="view" ${m.access === "view" ? "selected" : ""}>View only</option>
        </select>
      </label>
      <label class="workspace-inspect-check">
        <input type="checkbox" data-ws-inspect-perm="can_invite" data-user="${escapeHtml(m.id)}" ${m.can_invite ? "checked" : ""} />
        Invite
      </label>
      <label class="workspace-inspect-check">
        <input type="checkbox" data-ws-inspect-perm="can_export" data-user="${escapeHtml(m.id)}" ${m.can_export !== false ? "checked" : ""} />
        Export
      </label>
      <label class="workspace-inspect-check">
        <input type="checkbox" data-ws-inspect-perm="can_access_tools" data-user="${escapeHtml(m.id)}" ${m.can_access_tools !== false ? "checked" : ""} />
        Tools
      </label>
      <span class="visually-hidden">${name} permissions</span>
    </div>
  `;
}

function paintThumb(el, src, empty = false) {
  if (!el) return;
  el.classList.toggle("is-empty", !!empty);
  el.classList.toggle("is-ready", !empty);
  const img = document.createElement("img");
  img.alt = "";
  img.src = src;
  el.replaceChildren(img);
}

async function hydrateThumbs(root) {
  const cells = [...(root?.querySelectorAll("[data-ws-inspect-thumb]") || [])];
  await Promise.all(cells.map(async (el) => {
    const projectId = el.getAttribute("data-ws-inspect-thumb");
    const url = el.getAttribute("data-thumb-url") || `/api/projects/${encodeURIComponent(projectId)}/thumb`;
    const cached = thumbBlobs.get(projectId);
    if (cached) {
      paintThumb(el, cached, false);
      return;
    }
    try {
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok || res.status === 204) throw new Error("no thumb");
      const blob = await res.blob();
      if (!blob?.size) throw new Error("empty");
      const objectUrl = URL.createObjectURL(blob);
      const prev = thumbBlobs.get(projectId);
      thumbBlobs.set(projectId, objectUrl);
      paintThumb(el, objectUrl, false);
      if (prev && prev !== objectUrl) URL.revokeObjectURL(prev);
    } catch {
      paintThumb(el, EMPTY_THUMB_SRC, true);
    }
  }));
}

function bindMemberControls(opts, team, root) {
  if (!inspectCache.canManage) return;
  root.querySelectorAll("[data-ws-inspect-role]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await opts.api?.(`/api/teams/${encodeURIComponent(team.id)}/members/${encodeURIComponent(sel.dataset.user)}/role`, {
          method: "PATCH",
          body: JSON.stringify({ role: sel.value }),
        });
        setStatus(sel.value === "manager" ? "Role set to manager." : "Role set to user.");
        await opts.onChanged?.({ action: "role", teamId: team.id });
        await reloadMembers(opts, team);
      } catch (err) {
        setStatus(err.message || "Could not update role", true);
      }
    });
  });
  root.querySelectorAll("[data-ws-inspect-access]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await opts.api?.(`/api/teams/${encodeURIComponent(team.id)}/members/${encodeURIComponent(sel.dataset.user)}/permissions`, {
          method: "PATCH",
          body: JSON.stringify({ access: sel.value }),
        });
        setStatus(sel.value === "view" ? "Set to view only." : "Can edit projects.");
        await reloadMembers(opts, team);
      } catch (err) {
        setStatus(err.message || "Could not update access", true);
      }
    });
  });
  root.querySelectorAll("[data-ws-inspect-perm]").forEach((input) => {
    input.addEventListener("change", async () => {
      const key = input.getAttribute("data-ws-inspect-perm");
      try {
        await opts.api?.(`/api/teams/${encodeURIComponent(team.id)}/members/${encodeURIComponent(input.dataset.user)}/permissions`, {
          method: "PATCH",
          body: JSON.stringify({ [key]: !!input.checked }),
        });
        setStatus("Permissions updated.");
        await reloadMembers(opts, team);
      } catch (err) {
        setStatus(err.message || "Could not update permissions", true);
        input.checked = !input.checked;
      }
    });
  });
}

function renderBody(opts, team, { members = [], canManage = false, loadError = "" } = {}) {
  const body = $("workspace-inspect-body");
  if (!body || !team) return;
  const folders = foldersForWorkspace(opts.getFolders?.() || [], team.id)
    .filter((f) => !String(f.id || "").startsWith("__shared_ws_"));
  const folderMap = new Map(folders.map((f) => [String(f.id), f.name || "Folder"]));
  const allProjects = projectsForWorkspace(opts.getProjects?.() || [], team.id).map((p) => ({
    ...p,
    folder_name: folderMap.get(String(p.folder_id || "")) || "",
  }));
  const people = (Array.isArray(members) ? members : []).filter((m) => matchesInspectQuery(m, inspectQuery));
  let projects = allProjects.filter((p) => matchesInspectQuery(p, inspectQuery));
  if (folderFilter) {
    projects = projects.filter((p) => String(p.folder_id || "") === String(folderFilter));
  }
  projects = [...projects].sort((a, b) => {
    if (inspectSort === "name") return String(a.name || "").localeCompare(String(b.name || ""));
    return String(b.created_at || b.updated_at || "").localeCompare(String(a.created_at || a.updated_at || ""));
  });
  const visibleProjects = showAllProjects ? projects : projects.slice(0, PROJECT_PAGE);
  body.innerHTML = `
    <section class="workspace-inspect-col workspace-inspect-col--people" aria-label="Members">
      <header class="workspace-inspect-col-head">
        <h3>People</h3>
        <span class="muted small">${people.length}${inspectQuery ? ` of ${members.length}` : ""}</span>
      </header>
      ${
        loadError
          ? `<p class="muted small">${escapeHtml(loadError)}</p>`
          : people.length
            ? `<ul class="workspace-inspect-people">
                ${people.map((m) => {
                  const isOwner = String(m.role || "").toLowerCase() === "owner";
                  const initial = escapeHtml(String(m.display_name || m.email || "?").trim().charAt(0).toUpperCase());
                  return `
                  <li class="workspace-inspect-member${canManage && !isOwner ? " workspace-inspect-member--manage" : ""}">
                    ${
                      m.avatar_url
                        ? `<img class="workspace-inspect-avatar" src="${escapeHtml(m.avatar_url)}" alt="" />`
                        : `<span class="workspace-inspect-avatar workspace-inspect-avatar--fallback" aria-hidden="true">${initial}</span>`
                    }
                    <div class="workspace-inspect-member-copy">
                      <strong>${escapeHtml(m.display_name || m.email || "Member")}</strong>
                      ${m.email ? `<span class="muted small">${escapeHtml(m.email)}</span>` : ""}
                    </div>
                    ${memberControlsHtml(m, canManage)}
                  </li>`;
                }).join("")}
              </ul>`
            : `<p class="muted small">${inspectQuery ? "No people match that search." : "No members loaded."}</p>`
      }
    </section>
    <section class="workspace-inspect-col workspace-inspect-col--projects" aria-label="Projects">
      <header class="workspace-inspect-col-head">
        <h3>Projects</h3>
        <div class="workspace-inspect-col-head-actions">
          <span class="muted small">${projects.length}</span>
          <button type="button" class="workspace-inspect-create" data-ws-inspect-create title="New project in this workspace" aria-label="New project in this workspace">+</button>
        </div>
      </header>
      ${
        folders.length
          ? `<div class="workspace-inspect-folders" role="tablist" aria-label="Folders">
              <button type="button" class="workspace-inspect-folder${folderFilter ? "" : " is-active"}" data-ws-inspect-folder="">All</button>
              ${folders.map((f) => `
                <button type="button" class="workspace-inspect-folder${String(folderFilter) === String(f.id) ? " is-active" : ""}" data-ws-inspect-folder="${escapeHtml(f.id)}">${escapeHtml(f.name || "Folder")}</button>
              `).join("")}
            </div>`
          : ""
      }
      ${
        visibleProjects.length
          ? `<ul class="workspace-inspect-projects workspace-inspect-projects--${inspectView}">
              ${visibleProjects.map((p) => {
                const created = projectCreatedLabel(p);
                return `
                <li>
                  <button type="button" class="workspace-inspect-project workspace-inspect-project--card" data-ws-inspect-project="${escapeHtml(p.id)}">
                    <span class="workspace-inspect-thumb is-empty" data-ws-inspect-thumb="${escapeHtml(p.id)}" data-thumb-url="${escapeHtml(p.preview_url || `/api/projects/${encodeURIComponent(p.id)}/thumb`)}" aria-hidden="true">
                      <img src="${EMPTY_THUMB_SRC}" alt="" />
                    </span>
                    <span class="workspace-inspect-project-copy">
                      <strong>${escapeHtml(p.name || "Untitled")}</strong>
                      <span class="workspace-inspect-desc">${escapeHtml(projectDescription(p))}</span>
                      <span class="muted small">${created ? `Created ${escapeHtml(created)}` : "Create date unknown"}</span>
                    </span>
                  </button>
                </li>`;
              }).join("")}
            </ul>`
          : `<p class="muted small">${inspectQuery || folderFilter ? "No projects match that search." : "No projects in this workspace yet."}</p>`
      }
      ${
        projects.length > PROJECT_PAGE
          ? `<button type="button" class="cad-lib-btn cad-lib-btn--ghost workspace-inspect-more" data-ws-inspect-more>
              ${showAllProjects ? "Show fewer projects" : `Show all ${projects.length} projects`}
            </button>`
          : ""
      }
    </section>
  `;
  body.querySelector("[data-ws-inspect-create]")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeWorkspaceInspect();
    void opts.onCreateProject?.(team.id);
  });
  body.querySelectorAll("[data-ws-inspect-project]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-ws-inspect-project");
      closeWorkspaceInspect();
      opts.onOpenProject?.(id);
    });
  });
  body.querySelectorAll("[data-ws-inspect-folder]").forEach((btn) => {
    btn.addEventListener("click", () => {
      folderFilter = btn.getAttribute("data-ws-inspect-folder") || "";
      showAllProjects = false;
      renderBody(opts, team, inspectCache);
    });
  });
  body.querySelector("[data-ws-inspect-more]")?.addEventListener("click", () => {
    showAllProjects = !showAllProjects;
    renderBody(opts, team, inspectCache);
  });
  bindMemberControls(opts, team, body);
  revokeUnlistedInspectThumbs(visibleProjects.map((p) => p.id)); // leakfix28
  void hydrateThumbs(body);
}

let inspectMembersAbort = null; // leakfix49
async function reloadMembers(opts, team) {
  if (inspectMembersAbort) {
    try { inspectMembersAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  inspectMembersAbort = ctl;
  const aborted = (err) => ctl.signal.aborted || err?.name === "AbortError";
  try {
    let summary = null;
    try {
      summary = await opts.api?.(`/api/teams/${encodeURIComponent(team.id)}/management`, { signal: ctl.signal });
    } catch (err) {
      if (aborted(err)) return;
      summary = null;
    }
    if (ctl.signal.aborted) return;
    if (summary) {
      inspectCache = {
        members: summary.members || [],
        canManage: canManageTeam(opts, team, summary),
        loadError: "",
      };
    } else {
      const data = await opts.api?.(`/api/teams/${encodeURIComponent(team.id)}/members`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      inspectCache = {
        members: data?.members || [],
        canManage: canManageTeam(opts, team),
        loadError: "",
      };
    }
    if (ctl.signal.aborted || activeTeamId !== String(team.id)) return;
    renderBody(opts, team, inspectCache);
  } catch (err) {
    if (aborted(err)) return;
    inspectCache.loadError = err?.message || "Could not load members.";
    renderBody(opts, team, inspectCache);
  } finally {
    if (inspectMembersAbort === ctl) inspectMembersAbort = null;
  }
}

export function closeWorkspaceInspect() {
  revokeUnlistedInspectThumbs([]); // leakfix28
  $(MODAL_ID)?.classList.add("hidden");
  activeTeamId = null;
  inspectQuery = "";
  folderFilter = "";
  showAllProjects = false;
  setStatus("");
}

export async function openWorkspaceInspect(teamId, opts = {}) {
  const o = { ...(boundOpts || {}), ...opts };
  const modal = ensureModal();
  const team = teamRecord(o, teamId);
  if (!team) return;
  activeTeamId = String(team.id);
  inspectQuery = "";
  folderFilter = "";
  showAllProjects = false;
  inspectCache = { members: [], canManage: canManageTeam(o, team), loadError: "" };
  readInspectPrefs(o);
  setStatus("");
  const title = $("workspace-inspect-title");
  const sub = $("workspace-inspect-sub");
  const name = teamTitle(o, team);
  if (title) title.textContent = name;
  if (sub) {
    const members = Number(team.member_count ?? team.members_count ?? 0) || 0;
    sub.textContent = team.id && o.personalWorkspaceId?.() === team.id
      ? "Personal workspace"
      : `${members} member${members === 1 ? "" : "s"} · ${team.role_label || team.role || "member"}`;
  }
  renderToolbar(o, team);
  renderBody(o, team, inspectCache);
  modal.classList.remove("hidden");
  await reloadMembers(o, team);
}

export function bindWorkspaceInspect(opts = {}) {
  boundOpts = opts;
  const modal = ensureModal();
  if (bound) return { open: openWorkspaceInspect, close: closeWorkspaceInspect };
  bound = true;
  modal.querySelectorAll("[data-ws-inspect-close]").forEach((el) => {
    el.addEventListener("click", () => closeWorkspaceInspect());
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modal.classList.contains("hidden")) return;
    closeWorkspaceInspect();
  });
  return { open: openWorkspaceInspect, close: closeWorkspaceInspect };
}
