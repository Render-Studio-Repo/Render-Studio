/**
 * Manage workspace popup — rename, leave, or delete next to Invite people.
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

function fillTeamSelect({ getTeams, getActiveTeam, helpers = {} }) {
  const sel = $("ws-manage-team");
  if (!sel) return null;
  const { teams, active } = resolveTeams(getTeams, getActiveTeam);
  const pid = personalId(teams, helpers.currentUserId?.(), helpers);
  const listed = [...teams].sort((a, b) => {
    if (a.id === pid) return -1;
    if (b.id === pid) return 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  const preferred = active?.id && listed.some((t) => t.id === active.id)
    ? active.id
    : (listed[0]?.id || "");
  sel.innerHTML = listed.length
    ? listed.map((team) => {
        const personal = team.id === pid;
        const label = personal
          ? (helpers.personalWorkspaceLabel?.() || team.name || "Personal workspace")
          : (team.name || "Shared workspace");
        const role = team.role_label || team.role || "member";
        return `<option value="${escapeHtml(team.id)}">${escapeHtml(label)} · ${escapeHtml(role)}</option>`;
      }).join("")
    : `<option value="">No workspaces</option>`;
  if (preferred) sel.value = preferred;
  return listed.find((t) => t.id === sel.value) || null;
}

function selectedTeam(opts) {
  const id = String($("ws-manage-team")?.value || "").trim();
  const teams = (opts.getTeams?.() || []);
  return teams.find((t) => t.id === id) || null;
}

function helpersFrom(opts) {
  return {
    personalWorkspaceId: opts.personalWorkspaceId,
    personalWorkspaceLabel: opts.personalWorkspaceLabel,
    currentUserId: opts.currentUserId,
    getTeams: opts.getTeams,
  };
}

function renderSummary(team, opts = {}) {
  const box = $("ws-manage-summary");
  const renameWrap = $("ws-manage-rename");
  const danger = $("ws-manage-danger");
  const nameInput = $("ws-manage-name");
  if (!box || !danger) return;

  if (!team) {
    box.innerHTML = `<p class="muted small">Select a workspace to manage.</p>`;
    if (renameWrap) renameWrap.hidden = true;
    danger.innerHTML = "";
    return;
  }

  const helpers = helpersFrom(opts);
  const pid = personalId(opts.getTeams?.() || [], opts.currentUserId?.(), helpers);
  const personal = team.id === pid;
  const owner = isOwner(team);
  const members = Number(team.member_count ?? team.members_count ?? 1) || 1;
  const title = personal
    ? (opts.personalWorkspaceLabel?.() || team.name || "Personal workspace")
    : (team.name || "Shared workspace");

  box.innerHTML = `
    <div class="ws-manage-summary-card">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p class="muted small">${personal ? "Personal workspace" : `${members} member${members === 1 ? "" : "s"} · shared`}</p>
      </div>
      <span class="ws-manage-role-pill">${escapeHtml(team.role_label || team.role || "member")}</span>
    </div>
  `;

  if (renameWrap) {
    renameWrap.hidden = !owner || personal;
    if (nameInput && owner && !personal) nameInput.value = team.name || "";
  }

  if (personal) {
    danger.innerHTML = `
      <article class="ws-manage-action-card">
        <div>
          <strong>Personal workspace</strong>
          <p class="muted small">Your personal files stay here. Leave and delete are only for shared teams.</p>
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
  renderSummary(selectedTeam(opts), opts);
}

export function closeWorkspaceManage() {
  $(MODAL_ID)?.classList.add("hidden");
  setStatus("");
}

export async function openWorkspaceManage(opts = {}) {
  const modal = $(MODAL_ID);
  if (!modal) return;
  setStatus("");
  fillTeamSelect({ ...opts, helpers: helpersFrom(opts) });
  refreshPanel(opts);
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
        fillTeamSelect({ ...o, helpers: helpersFrom(o) });
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
