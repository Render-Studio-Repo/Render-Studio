/**
 * Manage workspace popup — rename, leave, delete, and member permissions
 * (invite / edit / view) for each workspace you admin.
 */

const MODAL_ID = "workspace-manage-modal";

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(text, isError = false) {
  const status = $("ws-manage-status");
  if (!status) return;
  status.textContent = text || "";
  status.classList.toggle("is-error", !!isError && !!text);
}

function resolveTeams(getTeams, getActiveTeam) {
  const teams = (typeof getTeams === "function" ? getTeams() : []) || [];
  const active = typeof getActiveTeam === "function" ? getActiveTeam() : null;
  return { teams, active };
}

function isOwner(team) {
  return String(team?.role || "").toLowerCase() === "owner";
}

function personalId(teams, currentUserId, helpers = {}) {
  if (typeof helpers.personalWorkspaceId === "function") {
    try {
      return helpers.personalWorkspaceId(teams);
    } catch {
      /* fall through */
    }
  }
  const mine = (teams || [])
    .filter((team) => String(team?.role || "").toLowerCase() === "owner"
      && (!currentUserId || team.created_by === currentUserId))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  return mine[0]?.id || null;
}

function helpersFrom(opts) {
  return {
    personalWorkspaceId: opts.personalWorkspaceId,
    personalWorkspaceLabel: opts.personalWorkspaceLabel,
    currentUserId: opts.currentUserId,
    getTeams: opts.getTeams,
  };
}

function teamTitle(team, opts = {}) {
  const helpers = helpersFrom(opts);
  const pid = personalId(opts.getTeams?.() || [], opts.currentUserId?.(), helpers);
  if (team?.id === pid) {
    return opts.personalWorkspaceLabel?.() || team.name || "Personal workspace";
  }
  return team?.name || "Shared workspace";
}

function listedTeams(opts) {
  const { teams, active } = resolveTeams(opts.getTeams, opts.getActiveTeam);
  const helpers = helpersFrom(opts);
  const pid = personalId(teams, opts.currentUserId?.(), helpers);
  const listed = [...teams].sort((a, b) => {
    if (a.id === pid) return -1;
    if (b.id === pid) return 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  return { teams: listed, active, pid };
}

function fillTeamSelect(opts) {
  const sel = $("ws-manage-team");
  if (!sel) return null;
  const { teams, active, pid } = listedTeams(opts);
  const preferred =
    (opts.preferTeamId && teams.some((t) => String(t.id) === String(opts.preferTeamId))
      ? opts.preferTeamId
      : null)
    || (active?.id && teams.some((t) => t.id === active.id) ? active.id : (teams[0]?.id || ""));
  sel.innerHTML = teams.length
    ? teams.map((team) => {
        const personal = team.id === pid;
        const label = personal
          ? (opts.personalWorkspaceLabel?.() || team.name || "Personal workspace")
          : (team.name || "Shared workspace");
        const role = team.role_label || team.role || "member";
        return `<option value="${escapeHtml(team.id)}">${escapeHtml(label)} · ${escapeHtml(role)}</option>`;
      }).join("")
    : `<option value="">No workspaces</option>`;
  if (preferred) sel.value = preferred;
  return teams.find((t) => t.id === sel.value) || null;
}

function selectedTeam(opts) {
  const id = String($("ws-manage-team")?.value || "").trim();
  const teams = (opts.getTeams?.() || []);
  return teams.find((t) => t.id === id) || null;
}

/** @type {Map<string, any>} */
const managementCache = new Map();
/** @type {Set<string>} */
const openPermPanels = new Set();
/** @type {Set<string>} */
const loadingTeams = new Set();

async function ensureManagement(opts, teamId) {
  if (!teamId) return null;
  if (managementCache.has(teamId)) return managementCache.get(teamId);
  if (loadingTeams.has(teamId)) return null;
  loadingTeams.add(teamId);
  try {
    const data = await opts.api(`/api/teams/${encodeURIComponent(teamId)}/management`);
    managementCache.set(teamId, data);
    return data;
  } finally {
    loadingTeams.delete(teamId);
  }
}

function invalidateManagement(teamId) {
  if (teamId) managementCache.delete(teamId);
  else managementCache.clear();
}

function memberSearchQuery() {
  return String($("ws-manage-member-search")?.value || "").trim();
}

function memberMatches(member, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const handle = String(member?.handle || "").replace(/^@/, "");
  const haystack = [
    member?.display_name,
    member?.email,
    member?.handle,
    member?.handle_label,
    handle ? `@${handle}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function editableMembers(data) {
  return (data?.members || []).filter((m) => String(m.role || "").toLowerCase() !== "owner");
}

function renderMemberPerms(team, data, opts) {
  const canManage = !!(data?.can_manage_permissions || isOwner(team));
  const members = editableMembers(data);
  const query = memberSearchQuery();
  const visible = members.filter((m) => memberMatches(m, query));
  if (!canManage) {
    return `<p class="muted small ws-manage-perms-empty">Only the workspace admin can change invite and edit/view permissions.</p>`;
  }
  if (!members.length) {
    return `<p class="muted small ws-manage-perms-empty">Invite teammates to this workspace, then set whether each person can invite others, edit projects, or only view.</p>`;
  }
  if (query && !visible.length) {
    return `<p class="muted small ws-manage-perms-empty">No teammates match “${escapeHtml(query)}”.</p>`;
  }
  return `
    <div class="ws-manage-member-list">
      ${visible.map((m) => {
        const access = m.access === "view" ? "view" : "edit";
        const canInvite = !!m.can_invite;
        const label = m.display_name || m.email || "member";
        return `
          <div class="ws-manage-member-row" data-ws-member="${escapeHtml(m.id)}">
            <div class="ws-manage-member-meta">
              <strong>${escapeHtml(m.display_name || m.email || "Member")}</strong>
              <span class="muted small">${escapeHtml(m.email || m.handle_label || "")}</span>
            </div>
            <div class="ws-manage-member-controls">
              <label class="ws-manage-perm-field">
                <span>Access</span>
                <select
                  data-ws-perm-access
                  data-team-id="${escapeHtml(team.id)}"
                  data-user-id="${escapeHtml(m.id)}"
                  aria-label="Access for ${escapeHtml(label)}"
                >
                  <option value="edit" ${access === "edit" ? "selected" : ""}>Can edit</option>
                  <option value="view" ${access === "view" ? "selected" : ""}>View only</option>
                </select>
              </label>
              <label class="ws-manage-perm-field">
                <span>Invite</span>
                <select
                  data-ws-perm-invite
                  data-team-id="${escapeHtml(team.id)}"
                  data-user-id="${escapeHtml(m.id)}"
                  aria-label="Invite rights for ${escapeHtml(label)}"
                >
                  <option value="1" ${canInvite ? "selected" : ""}>Can invite</option>
                  <option value="0" ${!canInvite ? "selected" : ""}>Cannot invite</option>
                </select>
              </label>
              <label class="ws-manage-perm-field">
                <span>Remove</span>
                <button
                  type="button"
                  class="ws-manage-remove-btn"
                  data-ws-manage-action="remove-member"
                  data-team-id="${escapeHtml(team.id)}"
                  data-user-id="${escapeHtml(m.id)}"
                  data-member-name="${escapeHtml(label)}"
                  aria-label="Remove ${escapeHtml(label)} from workspace"
                >Remove</button>
              </label>
            </div>
          </div>`;
      }).join("")}
    </div>
  `;
}

function renderWorkspaceList(opts) {
  const box = $("ws-manage-summary");
  if (!box) return;
  const { teams, pid } = listedTeams(opts);
  if (!teams.length) {
    box.innerHTML = `<p class="muted small">Select a workspace to manage.</p>`;
    return;
  }

  const query = memberSearchQuery();
  const cards = teams.map((team) => {
        const personal = team.id === pid;
        const owner = isOwner(team);
        const title = teamTitle(team, opts);
        const members = Number(team.member_count ?? team.members_count ?? 0) || 0;
        const subtitle = personal
          ? "Personal workspace"
          : (members
            ? `${members} member${members === 1 ? "" : "s"} · shared`
            : "Shared workspace");
        const data = managementCache.get(team.id);
        const loading = loadingTeams.has(team.id);
        const canManage = owner;
        const searchable = canManage && data;
        const matchCount = searchable
          ? editableMembers(data).filter((m) => memberMatches(m, query)).length
          : 0;
        if (query && canManage && data && !matchCount) return "";
        if (query && !canManage) return "";
        const open = openPermPanels.has(team.id) || !!(query && canManage);
        return `
          <article class="ws-manage-workspace-card${open ? " is-open" : ""}" data-team-id="${escapeHtml(team.id)}" role="listitem">
            <div class="ws-manage-workspace-card-head">
              <div>
                <strong>${escapeHtml(title)}</strong>
                <p class="muted small">${escapeHtml(subtitle)}</p>
              </div>
              <div class="ws-manage-workspace-card-actions">
                ${
                  canManage
                    ? `<div class="ws-manage-perm-dropdown">
                        <button
                          type="button"
                          class="ws-manage-perm-toggle${open ? " is-open" : ""}"
                          data-ws-manage-action="toggle-perms"
                          data-team-id="${escapeHtml(team.id)}"
                          aria-expanded="${open ? "true" : "false"}"
                          aria-controls="ws-manage-perms-${escapeHtml(team.id)}"
                        >
                          Permissions
                          <span class="ws-manage-perm-caret" aria-hidden="true">▾</span>
                        </button>
                      </div>`
                    : `<span class="ws-manage-role-pill">${escapeHtml(team.role_label || team.role || "member")}</span>`
                }
              </div>
            </div>
            ${
              canManage && open
                ? `<div id="ws-manage-perms-${escapeHtml(team.id)}" class="ws-manage-perms-panel">
                    <p class="muted small ws-manage-perms-hint">Choose whether each teammate can <strong>invite</strong> people, <strong>edit</strong> projects, or only <strong>view</strong>.</p>
                    ${
                      loading && !data
                        ? `<p class="muted small">Loading members…</p>`
                        : renderMemberPerms(team, data, opts)
                    }
                  </div>`
                : ""
            }
          </article>`;
      }).filter(Boolean);

  if (query && !cards.length) {
    box.innerHTML = `<p class="muted small ws-manage-perms-empty">No teammates match “${escapeHtml(query)}”.</p>`;
    return;
  }

  box.innerHTML = `
    <div class="ws-manage-workspace-list" role="list">
      ${cards.join("")}
    </div>
  `;
}

function renderDanger(team, opts = {}) {
  const renameWrap = $("ws-manage-rename");
  const danger = $("ws-manage-danger");
  const nameInput = $("ws-manage-name");
  if (!danger) return;

  if (!team) {
    if (renameWrap) renameWrap.hidden = true;
    danger.innerHTML = "";
    return;
  }

  const helpers = helpersFrom(opts);
  const pid = personalId(opts.getTeams?.() || [], opts.currentUserId?.(), helpers);
  const personal = team.id === pid;
  const owner = isOwner(team);

  if (renameWrap) {
    renameWrap.hidden = !owner || personal;
    if (nameInput && owner && !personal) nameInput.value = team.name || "";
  }

  if (personal) {
    danger.innerHTML = `
      <article class="ws-manage-action-card">
        <div>
          <strong>Personal workspace</strong>
          <p class="muted small">Your personal files stay here. Leave and delete are only for shared teams. Use Permissions above after you invite people.</p>
        </div>
      </article>
    `;
    return;
  }

  if (!owner) {
    danger.innerHTML = `
      <article class="ws-manage-action-card">
        <div>
          <strong>Leave workspace</strong>
          <p class="muted small">Remove yourself from this team. Projects stay for everyone else.</p>
        </div>
        <button type="button" class="btn secondary btn-compact" data-ws-manage-action="leave">Leave</button>
      </article>
    `;
    return;
  }

  danger.innerHTML = `
    <article class="ws-manage-action-card ws-manage-action-card--danger">
      <div>
        <strong>Delete workspace</strong>
        <p class="muted small">Permanently removes this team and its projects for all members.</p>
      </div>
      <button type="button" class="btn danger btn-compact" data-ws-manage-action="delete-start">Delete</button>
    </article>
    <div id="ws-manage-delete-confirm" class="ws-manage-delete-confirm hidden">
      <p class="muted small">Type <strong>${escapeHtml(team.name || "DELETE")}</strong> to confirm.</p>
      <div class="ws-manage-rename-row">
        <input type="text" id="ws-manage-delete-input" autocomplete="off" placeholder="Workspace name" />
        <button type="button" class="btn danger btn-compact" data-ws-manage-action="delete-confirm" disabled>Confirm delete</button>
      </div>
    </div>
  `;
}

function refreshPanel(opts) {
  renderWorkspaceList(opts);
  renderDanger(selectedTeam(opts), opts);
}

async function togglePerms(opts, teamId) {
  if (!teamId) return;
  if (openPermPanels.has(teamId)) {
    openPermPanels.delete(teamId);
    refreshPanel(opts);
    return;
  }
  openPermPanels.add(teamId);
  refreshPanel(opts);
  try {
    await ensureManagement(opts, teamId);
  } catch (err) {
    openPermPanels.delete(teamId);
    setStatus(err?.message || "Could not load members.", true);
  }
  refreshPanel(opts);
}

async function patchPermissions(opts, teamId, userId, patch) {
  if (!teamId || !userId) return;
  try {
    setStatus("Saving permissions…");
    await opts.api(
      `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}/permissions`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    invalidateManagement(teamId);
    await ensureManagement(opts, teamId);
    const bits = [];
    if (patch.access) bits.push(patch.access === "view" ? "view only" : "can edit");
    if (typeof patch.can_invite === "boolean") {
      bits.push(patch.can_invite ? "can invite" : "cannot invite");
    }
    setStatus(bits.length ? `Updated (${bits.join(", ")}).` : "Permissions updated.");
    await opts.onChanged?.({ action: "permissions", teamId, userId, patch });
    refreshPanel(opts);
  } catch (err) {
    setStatus(err?.message || "Could not update permissions.", true);
    invalidateManagement(teamId);
    try {
      await ensureManagement(opts, teamId);
    } catch {
      /* ignore */
    }
    refreshPanel(opts);
  }
}

async function removeMember(opts, teamId, userId, memberName) {
  if (!teamId || !userId) return;
  const teams = opts.getTeams?.() || [];
  const team = teams.find((t) => t.id === teamId);
  const label = memberName || "this person";
  const workspace = teamTitle(team, opts);
  if (!window.confirm(`Remove ${label} from “${workspace}”? They will lose access to this workspace.`)) {
    return;
  }
  try {
    setStatus("Removing…");
    await opts.api(`/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    invalidateManagement(teamId);
    await ensureManagement(opts, teamId);
    setStatus(`Removed ${label}.`);
    await opts.onChanged?.({ action: "remove-member", teamId, userId });
    refreshPanel(opts);
  } catch (err) {
    setStatus(err?.message || "Could not remove teammate.", true);
  }
}

export function closeWorkspaceManage() {
  $(MODAL_ID)?.classList.add("hidden");
  setStatus("");
}

export async function openWorkspaceManage(opts = {}) {
  const modal = $(MODAL_ID);
  if (!modal) return;
  if (opts && (opts.api || opts.getTeams || opts.onChanged)) {
    boundOpts = { ...(boundOpts || {}), ...opts };
  }
  const o = { ...(boundOpts || {}), ...opts };
  setStatus("");
  invalidateManagement();
  const search = $("ws-manage-member-search");
  if (search) search.value = "";
  fillTeamSelect(o);
  refreshPanel(o);
  modal.classList.remove("hidden");
  requestAnimationFrame(() => $("ws-manage-team")?.focus());
}

let bound = false;
let boundOpts = null;

export function bindWorkspaceManage(opts = {}) {
  boundOpts = opts;
  if (bound) return;
  bound = true;

  $("btn-open-workspace-manage")?.addEventListener("click", (e) => {
    e.preventDefault();
    void openWorkspaceManage(boundOpts || opts);
  });

  document.querySelectorAll("[data-ws-manage-close]").forEach((el) => {
    el.addEventListener("click", () => closeWorkspaceManage());
  });

  $("ws-manage-team")?.addEventListener("change", () => {
    refreshPanel(boundOpts || opts);
    setStatus("");
  });

  $("ws-manage-member-search")?.addEventListener("input", () => {
    const o = boundOpts || opts;
    refreshPanel(o);
    const query = memberSearchQuery();
    if (!query) return;
    const { teams } = listedTeams(o);
    void Promise.all(
      teams.filter(isOwner).map((team) => ensureManagement(o, team.id).catch(() => null)),
    ).then(() => refreshPanel(o));
  });

  $("btn-ws-manage-rename")?.addEventListener("click", () => {
    void (async () => {
      const o = boundOpts || opts;
      const team = selectedTeam(o);
      const name = String($("ws-manage-name")?.value || "").trim();
      if (!team || !name) return;
      try {
        setStatus("Saving…");
        const data = await o.api(`/api/teams/${encodeURIComponent(team.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        await o.onChanged?.({ action: "rename", teamId: team.id, team: data?.team || data });
        fillTeamSelect(o);
        refreshPanel(o);
        setStatus("Workspace renamed.");
      } catch (err) {
        setStatus(err?.message || "Could not rename.", true);
      }
    })();
  });

  $(MODAL_ID)?.addEventListener("click", (e) => {
    const actionBtn = e.target.closest("[data-ws-manage-action]");
    if (!actionBtn) return;
    const action = actionBtn.dataset.wsManageAction;
    const o = boundOpts || opts;
    void (async () => {
      if (action === "toggle-perms") {
        await togglePerms(o, actionBtn.dataset.teamId);
        return;
      }
      if (action === "remove-member") {
        await removeMember(o, actionBtn.dataset.teamId, actionBtn.dataset.userId, actionBtn.dataset.memberName);
        return;
      }
      const team = selectedTeam(o);
      if (!team) return;
      if (action === "leave") {
        if (!window.confirm(`Leave “${team.name || "this workspace"}”? It will disappear from your explorer.`)) return;
        try {
          setStatus("Leaving…");
          await o.api(`/api/teams/${encodeURIComponent(team.id)}/leave`, { method: "DELETE" });
          await o.onChanged?.({ action: "leave", teamId: team.id });
          closeWorkspaceManage();
        } catch (err) {
          setStatus(err?.message || "Could not leave workspace.", true);
        }
        return;
      }
      if (action === "delete-start") {
        $("ws-manage-delete-confirm")?.classList.remove("hidden");
        $("ws-manage-delete-input")?.focus();
        return;
      }
      if (action === "delete-confirm") {
        const typed = String($("ws-manage-delete-input")?.value || "").trim();
        if (typed !== String(team.name || "").trim()) {
          setStatus("Name does not match.", true);
          return;
        }
        try {
          setStatus("Deleting workspace…");
          await o.api(`/api/teams/${encodeURIComponent(team.id)}`, { method: "DELETE" });
          await o.onChanged?.({ action: "delete", teamId: team.id });
          closeWorkspaceManage();
        } catch (err) {
          setStatus(err?.message || "Could not delete workspace.", true);
        }
      }
    })();
  });

  $(MODAL_ID)?.addEventListener("change", (e) => {
    const accessSel = e.target?.closest?.("[data-ws-perm-access]");
    const inviteSel = e.target?.closest?.("[data-ws-perm-invite]");
    const o = boundOpts || opts;
    if (accessSel) {
      void patchPermissions(o, accessSel.dataset.teamId, accessSel.dataset.userId, {
        access: accessSel.value === "view" ? "view" : "edit",
      });
      return;
    }
    if (inviteSel) {
      void patchPermissions(o, inviteSel.dataset.teamId, inviteSel.dataset.userId, {
        can_invite: inviteSel.value === "1",
      });
    }
  });

  $(MODAL_ID)?.addEventListener("input", (e) => {
    if (e.target?.id !== "ws-manage-delete-input") return;
    const o = boundOpts || opts;
    const team = selectedTeam(o);
    const confirmBtn = $(MODAL_ID)?.querySelector('[data-ws-manage-action="delete-confirm"]');
    if (!confirmBtn) return;
    confirmBtn.disabled = !team || e.target.value.trim() !== String(team.name || "").trim();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const modal = $(MODAL_ID);
    if (!modal || modal.classList.contains("hidden")) return;
    closeWorkspaceManage();
  });
}
