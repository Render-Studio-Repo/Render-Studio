/**
 * Invite hub — add people to a workspace and optionally a shared folder.
 * Shows current members, pending invites, and folder shares for the target.
 */

const MODAL_ID = "workspace-send-invite-modal";

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
  const status = $("ws-send-invite-status");
  if (!status) return;
  status.textContent = text || "";
  status.classList.toggle("is-error", !!isError && !!text);
}

function selectedTeamId() {
  return String($("ws-send-invite-team")?.value || "").trim();
}

function selectedFolderId() {
  return String($("ws-send-invite-folder")?.value || "").trim();
}

function inviteMode() {
  const checked = document.querySelector('input[name="ws-invite-mode"]:checked');
  return checked?.value === "folder" ? "folder" : "workspace";
}

function resolveTeams(getTeams, getActiveTeam) {
  try {
    const list = getTeams?.() || [];
    if (Array.isArray(list) && list.length) return list;
  } catch {
    /* fall through */
  }
  try {
    const active = getActiveTeam?.();
    return active ? [active] : [];
  } catch {
    return [];
  }
}

function teamLabel(team) {
  if (!team) return "Workspace";
  const members = Number(team.member_count ?? team.members_count ?? 0) || 0;
  const base = team.name || "Workspace";
  if (members > 1) return `${base} · ${members} members`;
  if (members === 1) return `${base} · 1 member`;
  return base;
}

function fillTeamSelect(teams, preferredId) {
  const sel = $("ws-send-invite-team");
  if (!sel) return null;
  const previous = preferredId || sel.value || "";
  sel.innerHTML = teams.length
    ? teams
        .map(
          (team) =>
            `<option value="${escapeHtml(team.id)}">${escapeHtml(teamLabel(team))}</option>`,
        )
        .join("")
    : `<option value="">No workspaces yet</option>`;
  if (previous && teams.some((t) => t.id === previous)) sel.value = previous;
  else if (teams[0]) sel.value = teams[0].id;
  return teams.find((t) => t.id === sel.value) || teams[0] || null;
}

async function loadFoldersForTeam(api, teamId) {
  const sel = $("ws-send-invite-folder");
  if (!sel) return [];
  if (!teamId) {
    sel.innerHTML = `<option value="">Pick a workspace first</option>`;
    return [];
  }
  sel.innerHTML = `<option value="">Loading folders…</option>`;
  try {
    const data = await api(`/api/teams/${encodeURIComponent(teamId)}/folders`);
    const folders = data.folders || data || [];
    const list = (Array.isArray(folders) ? folders : []).filter(
      (folder) => folder?.id && !folder.virtual && !folder.read_only && folder.visibility !== "virtual",
    );
    if (!list.length) {
      sel.innerHTML = `<option value="">No folders in this workspace yet</option>`;
      return [];
    }
    sel.innerHTML = [
      `<option value="">Choose a folder…</option>`,
      ...list.map(
        (folder) =>
          `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name || "Folder")}</option>`,
      ),
    ].join("");
    return list;
  } catch {
    sel.innerHTML = `<option value="">Could not load folders</option>`;
    return [];
  }
}

function renderHavePanel({ members = [], invites = [], folders = [], folderShares = {} } = {}) {
  const root = $("ws-send-invite-have");
  if (!root) return;

  const memberRows = members.length
    ? members
        .map((m) => {
          const name = escapeHtml(m.display_name || m.email || "Member");
          const email = escapeHtml(m.email || "");
          const role = escapeHtml(m.role_label || m.role || "member");
          return `
            <li class="ws-invite-have-row">
              <span>
                <strong>${name}</strong>
                ${email ? `<small>${email}</small>` : ""}
              </span>
              <em>${role}</em>
            </li>`;
        })
        .join("")
    : `<li class="ws-invite-have-empty muted small">No members yet — invite someone below.</li>`;

  const inviteRows = invites.length
    ? invites
        .map((inv) => {
          const email = escapeHtml(inv.email || "Pending");
          return `
            <li class="ws-invite-have-row ws-invite-have-row--pending">
              <span><strong>${email}</strong><small>Pending invite</small></span>
              <em>waiting</em>
            </li>`;
        })
        .join("")
    : `<li class="ws-invite-have-empty muted small">No pending invites.</li>`;

  const folderRows = folders.length
    ? folders
        .map((folder) => {
          const shares = folderShares[folder.id] || [];
          const count = shares.length;
          const shareLabel = count
            ? `${count} shared`
            : folder.visibility === "workspace"
              ? "workspace-visible"
              : "private";
          const people = shares
            .slice(0, 3)
            .map((s) => escapeHtml(s.display_name || s.email || "person"))
            .join(", ");
          return `
            <li class="ws-invite-have-row">
              <span>
                <strong>${escapeHtml(folder.name || "Folder")}</strong>
                <small>${people || (count ? `${count} people` : "Not shared yet")}</small>
              </span>
              <em>${escapeHtml(shareLabel)}</em>
            </li>`;
        })
        .join("")
    : `<li class="ws-invite-have-empty muted small">No folders yet. Create one in Projects, then share it here.</li>`;

  root.innerHTML = `
    <div class="ws-invite-have-head">
      <strong>What you have</strong>
      <small>Current access for this workspace</small>
    </div>
    <div class="ws-invite-have-grid">
      <section class="ws-invite-have-card">
        <h3>Members <span>${members.length}</span></h3>
        <ul>${memberRows}</ul>
      </section>
      <section class="ws-invite-have-card">
        <h3>Pending <span>${invites.length}</span></h3>
        <ul>${inviteRows}</ul>
      </section>
      <section class="ws-invite-have-card ws-invite-have-card--wide">
        <h3>Folders <span>${folders.length}</span></h3>
        <ul>${folderRows}</ul>
      </section>
    </div>
  `;
}

async function refreshHavePanel({ api, teamId } = {}) {
  const root = $("ws-send-invite-have");
  if (!root) return;
  if (!teamId) {
    root.innerHTML = `<p class="muted small">Pick a workspace to see members, invites, and folders.</p>`;
    return;
  }
  root.innerHTML = `<p class="muted small">Loading what you have…</p>`;

  let members = [];
  let invites = [];
  let folders = [];
  const folderShares = {};

  try {
    const membersRes = await api(`/api/teams/${encodeURIComponent(teamId)}/members`);
    members = membersRes.members || [];
  } catch {
    members = [];
  }

  try {
    const management = await api(`/api/teams/${encodeURIComponent(teamId)}/management`);
    invites = management.invites || [];
    if (!members.length) members = management.members || [];
  } catch {
    invites = [];
  }

  try {
    const folderRes = await api(`/api/teams/${encodeURIComponent(teamId)}/folders`);
    folders = folderRes.folders || folderRes || [];
    if (!Array.isArray(folders)) folders = [];
    folders = folders.filter(
      (folder) => folder?.id && !folder.virtual && !folder.read_only && folder.visibility !== "virtual",
    );
  } catch {
    folders = [];
  }

  await Promise.all(
    folders.slice(0, 12).map(async (folder) => {
      try {
        const data = await api(
          `/api/teams/${encodeURIComponent(teamId)}/folders/${encodeURIComponent(folder.id)}/shares`,
        );
        folderShares[folder.id] = data.shares || [];
      } catch {
        folderShares[folder.id] = [];
      }
    }),
  );

  renderHavePanel({ members, invites, folders, folderShares });
}

function syncModeUi() {
  const mode = inviteMode();
  const folderWrap = $("ws-send-invite-folder-wrap");
  const submit = $("btn-team-invite");
  if (folderWrap) folderWrap.hidden = mode !== "folder";
  if (submit) {
    submit.textContent = mode === "folder" ? "Invite + share folder" : "Send invite";
  }
}

async function onTeamChanged(opts = {}) {
  const { api } = opts;
  const teamId = selectedTeamId();
  const nameEl = $("ws-send-invite-workspace-name");
  const teamOpt = $("ws-send-invite-team")?.selectedOptions?.[0];
  if (nameEl) {
    nameEl.textContent = teamOpt?.textContent?.split("·")[0]?.trim() || "workspace";
  }
  const ready = !!teamId;
  const inviteBtn = $("btn-team-invite");
  const emailInput = $("team-invite-email");
  if (inviteBtn) inviteBtn.disabled = !ready;
  if (emailInput) emailInput.disabled = !ready;
  await loadFoldersForTeam(api, teamId);
  await refreshInviteCandidates(opts);
  await refreshHavePanel({ api, teamId });
  syncModeUi();
}

export async function refreshInviteCandidates(opts = {}) {
  const { api } = opts;
  const pick = $("team-invite-pick");
  if (!pick) return;
  const teamId = selectedTeamId();
  if (!teamId) {
    pick.hidden = true;
    pick.innerHTML = `<option value="">People you've worked with…</option>`;
    return;
  }
  try {
    const data = await api(
      `/api/teams/invite-candidates?team_id=${encodeURIComponent(teamId)}`,
    );
    const candidates = data.candidates || [];
    pick.innerHTML = [
      `<option value="">People you've worked with…</option>`,
      ...candidates.map((c) => {
        const label = c.display_name || c.email || "";
        const hint = c.source_teams
          ? ` · ${String(c.source_teams).split(",")[0]}`
          : "";
        return `<option value="${escapeHtml(c.email || "")}">${escapeHtml(label)}${escapeHtml(hint)}</option>`;
      }),
    ].join("");
    pick.hidden = candidates.length === 0;
    if (!candidates.length) pick.value = "";
  } catch {
    pick.hidden = true;
    pick.innerHTML = `<option value="">People you've worked with…</option>`;
  }
}

export function closeWorkspaceSendInvite() {
  const modal = $(MODAL_ID);
  if (!modal) return;
  modal.classList.add("hidden");
  setStatus("");
}

export async function openWorkspaceSendInvite(opts = {}) {
  const { getActiveTeam, getTeams, api } = opts;
  const modal = $(MODAL_ID);
  if (!modal) return;

  const teams = resolveTeams(getTeams, getActiveTeam);
  const active = currentTeamSafe(getActiveTeam);
  fillTeamSelect(teams, active?.id);

  setStatus("");
  const emailInput = $("team-invite-email");
  if (emailInput) emailInput.value = "";
  const pick = $("team-invite-pick");
  if (pick) pick.value = "";

  const workspaceMode = document.querySelector('input[name="ws-invite-mode"][value="workspace"]');
  if (workspaceMode) workspaceMode.checked = true;
  syncModeUi();

  modal.classList.remove("hidden");
  await onTeamChanged(opts);
  emailInput?.focus?.();
}

function currentTeamSafe(getActiveTeam) {
  try {
    return getActiveTeam?.() || null;
  } catch {
    return null;
  }
}

async function sendInvite(opts = {}) {
  const { api, onInvited } = opts;
  const teamId = selectedTeamId();
  const email = $("team-invite-email")?.value?.trim();
  const mode = inviteMode();
  const folderId = selectedFolderId();

  if (!teamId) {
    setStatus("Pick a workspace to invite into.", true);
    return;
  }
  if (!email) {
    setStatus("Enter an email to invite.", true);
    return;
  }
  if (mode === "folder" && !folderId) {
    setStatus("Pick a folder to share, or switch to whole workspace.", true);
    return;
  }

  setStatus(mode === "folder" ? "Inviting and sharing folder…" : "Sending invite…");
  try {
    let inviteRes = null;
    try {
      inviteRes = await api(`/api/teams/${encodeURIComponent(teamId)}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch (err) {
      // If they're already a member, folder share can still proceed.
      const msg = String(err?.message || "");
      if (!/already/i.test(msg) && mode !== "folder") throw err;
      inviteRes = { status: "already", email };
    }

    let folderMsg = "";
    if (mode === "folder" && folderId) {
      const shareRes = await api(
        `/api/teams/${encodeURIComponent(teamId)}/folders/${encodeURIComponent(folderId)}/share`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            restrict_access: $("ws-send-invite-restrict")?.checked !== false,
          }),
        },
      );
      folderMsg = shareRes.message || "Folder shared.";
    }

    const inviteMsg =
      inviteRes?.status === "invited"
        ? `Invite sent to ${email}`
        : inviteRes?.status === "already" || /already/i.test(String(inviteRes?.status || ""))
          ? `${email} is already in this workspace`
          : `Invite status: ${inviteRes?.status || "ok"}`;

    setStatus(folderMsg ? `${inviteMsg}. ${folderMsg}` : inviteMsg);

    const emailInput = $("team-invite-email");
    if (emailInput) emailInput.value = "";
    const pick = $("team-invite-pick");
    if (pick) pick.value = "";

    await refreshInviteCandidates(opts);
    await refreshHavePanel({ api, teamId });
    await onInvited?.({
      teamId,
      email,
      folderId: mode === "folder" ? folderId : null,
      result: inviteRes,
    });
  } catch (err) {
    setStatus(err?.message || "Invite failed.", true);
  }
}

let bound = false;

export function bindWorkspaceSendInvite(opts = {}) {
  if (bound) return;
  bound = true;

  $("btn-open-workspace-invite")?.addEventListener("click", (e) => {
    e.preventDefault();
    void openWorkspaceSendInvite(opts);
  });

  document.querySelectorAll("[data-ws-send-invite-close]").forEach((el) => {
    el.addEventListener("click", () => closeWorkspaceSendInvite());
  });

  $("ws-send-invite-team")?.addEventListener("change", () => {
    void onTeamChanged(opts);
  });

  document.querySelectorAll('input[name="ws-invite-mode"]').forEach((input) => {
    input.addEventListener("change", () => syncModeUi());
  });

  $("team-invite-pick")?.addEventListener("change", () => {
    const pick = $("team-invite-pick");
    const emailInput = $("team-invite-email");
    if (!pick || !emailInput) return;
    if (pick.value) emailInput.value = pick.value;
  });

  $("btn-team-invite")?.addEventListener("click", () => {
    void sendInvite(opts);
  });

  $("team-invite-email")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void sendInvite(opts);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const modal = $(MODAL_ID);
    if (!modal || modal.classList.contains("hidden")) return;
    closeWorkspaceSendInvite();
  });
}
