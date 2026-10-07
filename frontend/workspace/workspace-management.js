/** Workspace management panel — overview + role / permission assignment for workspace admins. */

import { authHeaders, getStoredUser, isAdminUser, isManagementDashboardUser } from "../studio/auth.js?v=20260826-mgmt-dash";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...authHeaders(options.headers || {}),
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
  });
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

export function createWorkspaceManagementUI({
  menuButtonEl = null,
  panelEl = null,
  getTeams = () => [],
  onStatus = null,
  onTeamsChanged = null,
} = {}) {
  let activeTab = "overview";
  let selectedTeamId = null;
  let cache = new Map();

  function ownedTeams() {
    return (getTeams() || []).filter((t) => t.role === "owner" || t.created_by === getStoredUser()?.id);
  }

  function syncMenuVisibility() {
    const owned = ownedTeams();
    const show = owned.length > 0 || isAdminUser(getStoredUser());
    menuButtonEl?.classList.toggle("hidden", !show);
    if (!show) panelEl?.classList.add("hidden");
    return show;
  }

  let managementAbort = null; // leakfix54
  async function loadTeam(teamId) {
    if (!teamId) return;
    if (managementAbort) {
      try { managementAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    managementAbort = ctl;
    try {
      const data = await api(`/api/teams/${encodeURIComponent(teamId)}/management`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      cache.set(teamId, data);
      return data;
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      throw err;
    } finally {
      if (managementAbort === ctl) managementAbort = null;
    }
  }

  function render() {
    if (!panelEl) return;
    const owned = ownedTeams();
    if (!owned.length && !isAdminUser(getStoredUser())) {
      panelEl.classList.add("hidden");
      panelEl.innerHTML = "";
      return;
    }
    if (!selectedTeamId || !owned.some((t) => t.id === selectedTeamId)) {
      selectedTeamId = owned[0]?.id || null;
    }
    const team = owned.find((t) => t.id === selectedTeamId);
    const data = cache.get(selectedTeamId) || { members: [], invites: [], project_count: 0 };
    const members = data.members || [];
    const invites = data.invites || [];
    const canRoles = !!data.can_manage_roles || team?.role === "owner";

    panelEl.innerHTML = `
      <div class="wm-head">
        <div>
          <strong>Workspace management</strong>
          <span class="muted small">Roles, invite rights, and edit vs view access</span>
        </div>
        <select id="wm-team-select" aria-label="Workspace">
          ${owned
            .map(
              (t) =>
                `<option value="${esc(t.id)}" ${t.id === selectedTeamId ? "selected" : ""}>${esc(t.name)}</option>`
            )
            .join("")}
        </select>
      </div>
      <div class="wm-tabs" role="tablist">
        <button type="button" class="wm-tab${activeTab === "overview" ? " active" : ""}" data-wm-tab="overview">Overview</button>
        <button type="button" class="wm-tab${activeTab === "roles" ? " active" : ""}" data-wm-tab="roles" ${canRoles ? "" : "disabled"}>Permissions</button>
      </div>
      <div class="wm-body">
        ${
          activeTab === "roles"
            ? renderRolesTab(members, canRoles)
            : renderOverviewTab(team, data, members, invites)
        }
      </div>
      ${
        isManagementDashboardUser(getStoredUser())
          ? `<a class="wm-site-link" href="/admin-dashboard.html">Open site Management dashboard →</a>`
          : ""
      }
    `;

    panelEl.querySelector("#wm-team-select")?.addEventListener("change", async (ev) => {
      selectedTeamId = ev.target.value;
      try {
        await loadTeam(selectedTeamId);
      } catch (err) {
        onStatus?.("error", err.message || "Could not load workspace");
      }
      render();
    });
    panelEl.querySelectorAll("[data-wm-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.wmTab || "overview";
        render();
      });
    });
    panelEl.querySelectorAll("[data-wm-role]").forEach((sel) => {
      sel.addEventListener("change", () => void setRole(sel.dataset.userId, sel.value));
    });
    panelEl.querySelectorAll("[data-wm-access]").forEach((sel) => {
      sel.addEventListener("change", () => void setPermissions(sel.dataset.userId, { access: sel.value }));
    });
    panelEl.querySelectorAll("[data-wm-invite]").forEach((input) => {
      input.addEventListener("change", () => {
        void setPermissions(input.dataset.userId, { can_invite: !!input.checked });
      });
    });
  }

  function renderOverviewTab(team, data, members, invites) {
    const managers = members.filter((m) => m.role === "manager").length;
    const viewers = members.filter((m) => m.access === "view").length;
    const users = members.filter((m) => m.role === "user" || m.role === "member").length;
    return `
      <div class="wm-stats">
        <article><span>Members</span><strong>${members.length}</strong></article>
        <article><span>Managers</span><strong>${managers}</strong></article>
        <article><span>Users</span><strong>${users}</strong></article>
        <article><span>View only</span><strong>${viewers}</strong></article>
        <article><span>Projects</span><strong>${Number(data.project_count || 0)}</strong></article>
        <article><span>Pending invites</span><strong>${invites.length}</strong></article>
      </div>
      <div class="wm-section">
        <h3>Roster</h3>
        <div class="wm-member-list">
          ${
            members
              .map(
                (m) => `
            <div class="wm-member-row">
              <div>
                <strong>${esc(m.display_name || m.email)}</strong>
                <span class="muted small">${esc(m.email || "")}</span>
              </div>
              <div class="wm-member-flags">
                <small class="wm-role-pill wm-role-pill--${esc(m.role || "user")}">${esc(m.role_label || m.role || "User")}</small>
                <small class="wm-access-pill wm-access-pill--${esc(m.access || "edit")}">${esc(m.access_label || (m.access === "view" ? "View only" : "Can edit"))}</small>
                ${m.can_invite ? `<small class="wm-invite-pill">Can invite</small>` : ""}
              </div>
            </div>`
              )
              .join("") || `<p class="muted small">No members yet.</p>`
          }
        </div>
      </div>
      ${
        invites.length
          ? `<div class="wm-section">
              <h3>Pending invites</h3>
              ${invites.map((inv) => `<div class="muted small">${esc(inv.email)}</div>`).join("")}
            </div>`
          : ""
      }
      <p class="muted small wm-note">Your role: <strong>${esc(data.requester_role_label || team?.role_label || "Admin")}</strong>. Only the workspace admin can change invite rights and edit/view access.</p>
    `;
  }

  function renderRolesTab(members, canRoles) {
    if (!canRoles) {
      return `<p class="muted small">Only the workspace admin can assign roles and permissions.</p>`;
    }
    return `
      <p class="muted small">Set each member’s <strong>role</strong>, whether they can <strong>invite</strong> others, and whether they can <strong>edit</strong> or only <strong>view</strong> projects.</p>
      <div class="wm-member-list wm-member-list--perms">
        ${members
          .map((m) => {
            const isOwner = m.role === "owner";
            return `
              <div class="wm-member-row wm-member-row--perms">
                <div>
                  <strong>${esc(m.display_name || m.email)}</strong>
                  <span class="muted small">${esc(m.email || "")}</span>
                </div>
                ${
                  isOwner
                    ? `<div class="wm-perm-controls">
                        <small class="wm-role-pill wm-role-pill--owner">Admin</small>
                        <small class="muted small">Full access</small>
                      </div>`
                    : `<div class="wm-perm-controls">
                        <label class="wm-perm-field">
                          <span>Role</span>
                          <select data-wm-role data-user-id="${esc(m.id)}" aria-label="Role for ${esc(m.display_name || m.email)}">
                            <option value="manager" ${m.role === "manager" ? "selected" : ""}>Manager</option>
                            <option value="user" ${m.role === "user" || m.role === "member" ? "selected" : ""}>User</option>
                          </select>
                        </label>
                        <label class="wm-perm-field">
                          <span>Access</span>
                          <select data-wm-access data-user-id="${esc(m.id)}" aria-label="Access for ${esc(m.display_name || m.email)}">
                            <option value="edit" ${m.access !== "view" ? "selected" : ""}>Can edit</option>
                            <option value="view" ${m.access === "view" ? "selected" : ""}>View only</option>
                          </select>
                        </label>
                        <label class="wm-perm-check">
                          <input type="checkbox" data-wm-invite data-user-id="${esc(m.id)}" ${m.can_invite ? "checked" : ""} />
                          <span>Can invite people</span>
                        </label>
                      </div>`
                }
              </div>`;
          })
          .join("")}
      </div>
    `;
  }

  async function setRole(userId, role) {
    if (!selectedTeamId || !userId || !role) return;
    try {
      await api(`/api/teams/${encodeURIComponent(selectedTeamId)}/members/${encodeURIComponent(userId)}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await loadTeam(selectedTeamId);
      onStatus?.("ok", `Updated role to ${role}`);
      onTeamsChanged?.();
      render();
    } catch (err) {
      onStatus?.("error", err.message || "Could not update role");
      try {
        await loadTeam(selectedTeamId);
      } catch {
        /* ignore */
      }
      render();
    }
  }

  async function setPermissions(userId, patch = {}) {
    if (!selectedTeamId || !userId) return;
    try {
      await api(
        `/api/teams/${encodeURIComponent(selectedTeamId)}/members/${encodeURIComponent(userId)}/permissions`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
      );
      await loadTeam(selectedTeamId);
      const bits = [];
      if (patch.access) bits.push(patch.access === "view" ? "view only" : "can edit");
      if (typeof patch.can_invite === "boolean") bits.push(patch.can_invite ? "can invite" : "cannot invite");
      onStatus?.("ok", bits.length ? `Updated permissions (${bits.join(", ")})` : "Updated permissions");
      onTeamsChanged?.();
      render();
    } catch (err) {
      onStatus?.("error", err.message || "Could not update permissions");
      try {
        await loadTeam(selectedTeamId);
      } catch {
        /* ignore */
      }
      render();
    }
  }

  async function openPanel({ teamId = null, tab = null } = {}) {
    if (!syncMenuVisibility()) return;
    const costs = document.getElementById("profile-costs-panel");
    const prefs = document.getElementById("profile-preferences-panel");
    const workspaces = document.getElementById("profile-workspace-panel");
    const subs = document.getElementById("profile-subscriptions-panel");
    costs?.classList.add("hidden");
    prefs?.classList.add("hidden");
    workspaces?.classList.add("hidden");
    subs?.classList.add("hidden");
    if (tab) activeTab = tab;
    panelEl?.classList.remove("hidden");
    const owned = ownedTeams();
    if (teamId && owned.some((t) => t.id === teamId)) {
      selectedTeamId = teamId;
    } else {
      selectedTeamId = selectedTeamId || owned[0]?.id || null;
    }
    if (selectedTeamId) {
      try {
        await loadTeam(selectedTeamId);
      } catch (err) {
        onStatus?.("error", err.message || "Could not load management data");
      }
    }
    render();
  }

  menuButtonEl?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void openPanel();
  });

  return {
    syncMenuVisibility,
    openPanel,
    refresh: async () => {
      syncMenuVisibility();
      if (panelEl && !panelEl.classList.contains("hidden") && selectedTeamId) {
        try {
          await loadTeam(selectedTeamId);
        } catch {
          /* ignore */
        }
        render();
      }
    },
  };
}
