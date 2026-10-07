/**
 * Invite hub — add people to a workspace and optionally a shared folder.
 * Shows current members, pending invites, and folder shares for the target.
 */

const MODAL_ID = "workspace-send-invite-modal";

const lookupState = { query: "", person: null, matches: [] };
let lookupTimer = 0;

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

export function isInviteEmail(value) {
  const raw = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

export function teamAllowsInvite(team) {
  if (!team) return false;
  const role = String(team.role || "").toLowerCase();
  return !!(team.can_invite || role === "owner" || role === "admin");
}

export function resolveInviteTeam(teams, preferId) {
  const list = Array.isArray(teams) ? teams : [];
  const want = String(preferId || "").trim();
  if (want) {
    const hit = list.find((team) => String(team?.id || "") === want);
    if (hit) return hit;
  }
  return list[0] || null;
}

function personLabel(person) {
  if (!person) return "";
  return person.handle_label || (person.handle ? `@${person.handle}` : "") || person.display_name || person.email || "";
}

export function inviteStatusMessage(result, fallback = "") {
  const who = personLabel(result?.user) || result?.email || fallback || "them";
  const status = String(result?.status || "");
  if (status === "added") return `Added ${who} to the workspace`;
  if (status === "already_member" || /already/i.test(status)) return `${who} is already in this workspace`;
  if (status === "invited" || !status) return `Invited ${who}`;
  return `Invite status: ${status}`;
}

export async function sendWorkspaceEmailInvite(api, teamId, email) {
  const address = String(email || "").trim().toLowerCase();
  if (!isInviteEmail(address)) {
    throw new Error("Enter a valid email address.");
  }
  if (!teamId) throw new Error("Pick a workspace to invite into.");
  if (typeof api !== "function") throw new Error("Invite is not available.");
  return api(`/api/teams/${encodeURIComponent(teamId)}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: address, confirm_new_collaborator: true }),
  });
}

let liveOpts = {};

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

let foldersForTeamAbort = null; // leakfix45
async function loadFoldersForTeam(api, teamId) {
  const sel = $("ws-send-invite-folder");
  if (!sel) return [];
  if (!teamId) {
    if (foldersForTeamAbort) {
      try { foldersForTeamAbort.abort(); } catch (_) { /* ignore */ }
      foldersForTeamAbort = null;
    }
    sel.innerHTML = `<option value="">Pick a workspace first</option>`;
    return [];
  }
  if (foldersForTeamAbort) {
    try { foldersForTeamAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  foldersForTeamAbort = ctl;
  if (![...sel.options].some((opt) => opt.value)) {
    sel.innerHTML = `<option value="">Loading folders…</option>`;
  }
  try {
    const data = await api(`/api/teams/${encodeURIComponent(teamId)}/folders`, { signal: ctl.signal });
    if (ctl.signal.aborted) return [];
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
  } catch (err) {
    if (ctl.signal.aborted || err?.name === "AbortError") return [];
    sel.innerHTML = `<option value="">Could not load folders</option>`;
    return [];
  } finally {
    if (foldersForTeamAbort === ctl) foldersForTeamAbort = null;
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

let havePanelAbort = null; // leakfix44
async function refreshHavePanel({ api, teamId, folders: prefetchedFolders = null } = {}) {
  const root = $("ws-send-invite-have");
  if (!root) return;
  if (!teamId) {
    if (havePanelAbort) {
      try { havePanelAbort.abort(); } catch (_) { /* ignore */ }
      havePanelAbort = null;
    }
    root.innerHTML = `<p class="muted small">Pick a workspace to see members, invites, and folders.</p>`;
    return;
  }
  if (havePanelAbort) {
    try { havePanelAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  havePanelAbort = ctl;
  if (!root.querySelector(".ws-invite-have-card")) {
    root.innerHTML = `<p class="muted small">Loading what you have…</p>`;
  }

  let members = [];
  let invites = [];
  let folders = [];
  const folderShares = {};
  const aborted = (err) => ctl.signal.aborted || err?.name === "AbortError";

  try {
    try {
      const membersRes = await api(`/api/teams/${encodeURIComponent(teamId)}/members`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      members = membersRes.members || [];
    } catch (err) {
      if (aborted(err)) return;
      members = [];
    }

    try {
      const management = await api(`/api/teams/${encodeURIComponent(teamId)}/management`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      invites = management.invites || [];
      if (!members.length) members = management.members || [];
    } catch (err) {
      if (aborted(err)) return;
      invites = [];
    }

    if (Array.isArray(prefetchedFolders)) {
      folders = prefetchedFolders; // leakfix46
    } else {
      try {
        const folderRes = await api(`/api/teams/${encodeURIComponent(teamId)}/folders`, { signal: ctl.signal });
        if (ctl.signal.aborted) return;
        folders = folderRes.folders || folderRes || [];
        if (!Array.isArray(folders)) folders = [];
        folders = folders.filter(
          (folder) => folder?.id && !folder.virtual && !folder.read_only && folder.visibility !== "virtual",
        );
      } catch (err) {
        if (aborted(err)) return;
        folders = [];
      }
    }

    await Promise.all(
      folders.slice(0, 12).map(async (folder) => {
        try {
          const data = await api(
            `/api/teams/${encodeURIComponent(teamId)}/folders/${encodeURIComponent(folder.id)}/shares`,
            { signal: ctl.signal },
          );
          if (ctl.signal.aborted) return;
          folderShares[folder.id] = data.shares || [];
        } catch (err) {
          if (aborted(err)) return;
          folderShares[folder.id] = [];
        }
      }),
    );
    if (ctl.signal.aborted) return;
    renderHavePanel({ members, invites, folders, folderShares });
  } finally {
    if (havePanelAbort === ctl) havePanelAbort = null;
  }
}

function syncModeUi() {
  const mode = inviteMode();
  const folderWrap = $("ws-send-invite-folder-wrap");
  const submit = $("btn-team-invite");
  if (folderWrap) folderWrap.hidden = mode !== "folder";
  if (submit) {
    submit.textContent = mode === "folder" ? "Share folder" : "Send invite";
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
  const teams = resolveTeams(opts.getTeams, opts.getActiveTeam);
  const team = teams.find((row) => String(row?.id || "") === String(teamId || "")) || null;
  const allowed = !team || teamAllowsInvite(team);
  const ready = !!teamId && allowed;
  const inviteBtn = $("btn-team-invite");
  const emailInput = $("team-invite-email");
  if (inviteBtn) inviteBtn.disabled = !ready;
  if (emailInput) emailInput.disabled = !teamId;
  if (teamId && !allowed) {
    setStatus("You do not have permission to invite people to this workspace.", true);
  } else {
    const status = $("ws-send-invite-status");
    if (status && /do not have permission to invite/i.test(status.textContent || "")) {
      setStatus("");
    }
  }
  const folders = await loadFoldersForTeam(api, teamId);
  await refreshInviteCandidates(opts);
  await refreshHavePanel({ api, teamId, folders }); // leakfix46
  syncModeUi();
}

let inviteCandidatesAbort = null; // leakfix43
export async function refreshInviteCandidates(opts = {}) {
  const { api } = opts;
  const pick = $("team-invite-pick");
  if (!pick) return;
  const teamId = selectedTeamId();
  if (!teamId) {
    if (inviteCandidatesAbort) {
      try { inviteCandidatesAbort.abort(); } catch (_) { /* ignore */ }
      inviteCandidatesAbort = null;
    }
    pick.hidden = true;
    pick.innerHTML = `<option value="">People you've worked with…</option>`;
    return;
  }
  if (inviteCandidatesAbort) {
    try { inviteCandidatesAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  inviteCandidatesAbort = ctl;
  try {
    const data = await api(
      `/api/teams/invite-candidates?team_id=${encodeURIComponent(teamId)}`,
      { signal: ctl.signal },
    );
    if (ctl.signal.aborted) return;
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
  } catch (err) {
    if (ctl.signal.aborted || err?.name === "AbortError") return;
    pick.hidden = true;
    pick.innerHTML = `<option value="">People you've worked with…</option>`;
  } finally {
    if (inviteCandidatesAbort === ctl) inviteCandidatesAbort = null;
  }
}

export function closeWorkspaceSendInvite() {
  const modal = $(MODAL_ID);
  if (!modal) return;
  modal.classList.add("hidden");
  setStatus("");
}

export async function openWorkspaceSendInvite(opts = {}) {
  liveOpts = { ...liveOpts, ...opts };
  const { getActiveTeam, getTeams, api } = liveOpts;
  const modal = $(MODAL_ID);
  if (!modal) return;

  const teams = resolveTeams(getTeams, getActiveTeam);
  const preferredId = opts.preferTeamId || opts.teamId || currentTeamSafe(getActiveTeam)?.id;
  const active = resolveInviteTeam(teams, preferredId) || currentTeamSafe(getActiveTeam);
  fillTeamSelect(teams, preferredId || active?.id);

  setStatus("");
  const emailInput = $("team-invite-email");
  if (emailInput) emailInput.value = "";
  const pick = $("team-invite-pick");
  if (pick) pick.value = "";
  clearLookup();

  const workspaceMode = document.querySelector('input[name="ws-invite-mode"][value="workspace"]');
  if (workspaceMode) workspaceMode.checked = true;
  syncModeUi();

  modal.classList.remove("hidden");
  await onTeamChanged(liveOpts);
  emailInput?.focus?.();
}

function clearLookup() {
  lookupState.person = null;
  lookupState.matches = [];
  const box = $("team-invite-lookup");
  if (!box) return;
  box.hidden = true;
  box.classList.remove("is-missing", "is-new", "is-known");
  box.innerHTML = "";
}

function renderLookup(data, { selectedId } = {}) {
  const box = $("team-invite-lookup");
  if (!box) return;
  const matches = data?.matches || [];
  const status = data?.status || "";
  box.hidden = false;
  box.classList.remove("is-missing", "is-new", "is-known");
  if (status === "not_found" || !matches.length) {
    lookupState.person = null;
    lookupState.matches = [];
    const typed = $("team-invite-email")?.value?.trim() || "";
    if (isInviteEmail(typed)) {
      box.classList.add("is-new");
      box.textContent = `No account yet — we'll email an invite to ${typed}`;
      return;
    }
    box.classList.add("is-missing");
    box.textContent = "Enter a registered name, @handle, or a valid email.";
    return;
  }
  lookupState.matches = matches;
  if (matches.length === 1) {
    const person = matches[0];
    lookupState.person = person;
    box.classList.add(person.already_member ? "is-known" : person.needs_confirm ? "is-new" : "is-known");
    const handle = escapeHtml(person.handle_label || person.display_name || "this person");
    const extra = person.already_member
      ? "Already in this workspace"
      : person.needs_confirm
        ? "You haven't worked with this person"
        : "You've shared a workspace before";
    box.innerHTML = `<span class="ws-invite-lookup-handle">${handle}</span> · ${escapeHtml(person.display_name || "")}<div>${escapeHtml(extra)}</div>`;
    return;
  }
  lookupState.person = matches.find((m) => m.id === selectedId) || null;
  box.classList.add("is-new");
  box.innerHTML = `
    <div>Pick the person you mean:</div>
    <div class="ws-invite-lookup-matches">
      ${matches
        .map((person) => {
          const selected = lookupState.person?.id === person.id ? " is-selected" : "";
          return `<button type="button" class="ws-invite-lookup-match${selected}" data-invite-user="${escapeHtml(person.id)}">
            <strong>${escapeHtml(person.handle_label || person.display_name)}</strong>
            <small>${escapeHtml(person.display_name || "")}${person.needs_confirm ? " · haven't worked together" : ""}</small>
          </button>`;
        })
        .join("")}
    </div>
  `;
}

async function runLookup(opts = {}) {
  const { api } = opts;
  const query = $("team-invite-email")?.value?.trim() || "";
  const teamId = selectedTeamId();
  lookupState.query = query;
  if (!query || query.length < 2) {
    clearLookup();
    return null;
  }
  if (!api || !teamId) return null;
  const data = await api(
    `/api/teams/invite-lookup?q=${encodeURIComponent(query)}&team_id=${encodeURIComponent(teamId)}`,
  );
  if (($("team-invite-email")?.value?.trim() || "") !== query) return data;
  renderLookup(data);
  return data;
}

function scheduleLookup(opts = {}) {
  window.clearTimeout(lookupTimer);
  lookupTimer = window.setTimeout(() => {
    void runLookup(opts).catch(() => {
      renderLookup({ status: "not_found", matches: [] });
    });
  }, 280);
}
function currentTeamSafe(getActiveTeam) {
  try {
    return getActiveTeam?.() || null;
  } catch {
    return null;
  }
}

async function sendInvite(opts = {}) {
  const { api, onInvited, getTeams, getActiveTeam } = { ...liveOpts, ...opts };
  const teamId = selectedTeamId();
  const query = $("team-invite-email")?.value?.trim();
  const mode = inviteMode();
  const folderId = selectedFolderId();
  const teams = resolveTeams(getTeams, getActiveTeam);
  const team = teams.find((row) => String(row?.id || "") === String(teamId || "")) || null;

  if (!teamId) {
    setStatus("Pick a workspace to invite into.", true);
    return;
  }
  if (team && !teamAllowsInvite(team)) {
    setStatus("You do not have permission to invite people to this workspace.", true);
    return;
  }
  if (!query) {
    setStatus("Enter an email address to invite.", true);
    return;
  }
  if (mode === "folder" && !folderId) {
    setStatus("Pick a folder to share, or switch to whole workspace.", true);
    return;
  }

  let person = lookupState.person;
  if (!person || lookupState.query !== query) {
    try {
      await runLookup({ ...liveOpts, ...opts });
    } catch (err) {
      const msg = String(err?.message || "");
      if (isInviteEmail(query) && /doesn.?t exist|not found|404/i.test(msg)) {
        renderLookup({ status: "not_found", matches: [] });
      } else if (/doesn.?t exist|not found|404/i.test(msg)) {
        renderLookup({ status: "not_found", matches: [] });
        setStatus("Enter a registered name, @handle, or a valid email.", true);
        return;
      } else if (!isInviteEmail(query)) {
        setStatus(msg || "Could not look up that person.", true);
        return;
      }
    }
    person = lookupState.person;
  }
  if (!person && !isInviteEmail(query)) {
    setStatus("Enter a valid email address.", true);
    return;
  }
  if (person?.already_member && mode !== "folder") {
    setStatus(`${personLabel(person)} is already in this workspace`);
    return;
  }
  if (person?.needs_confirm) {
    const label = personLabel(person) || person.display_name || "this person";
    const ok = window.confirm(
      `You haven't worked with this person yet.\n\nShare this workspace with ${label}? They'll be added immediately — they don't need to accept.`,
    );
    if (!ok) {
      setStatus("Invite canceled.");
      return;
    }
  }

  const payload = {
    confirm_new_collaborator: true,
  };
  if (person?.handle) payload.handle = person.handle;
  if (person?.email) payload.email = person.email;
  if (!payload.email && !payload.handle) {
    if (isInviteEmail(query)) payload.email = query.toLowerCase();
    else payload.handle = query.replace(/^@/, "");
  }

  setStatus(mode === "folder" ? "Inviting and sharing folder…" : "Sending invite…");
  try {
    let inviteRes = null;
    try {
      inviteRes = await api(`/api/teams/${encodeURIComponent(teamId)}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const msg = String(err?.message || "");
      if (/permission|not have permission|403/i.test(msg)) {
        setStatus(msg || "You do not have permission to invite people to this workspace.", true);
        return;
      }
      if (isInviteEmail(payload.email || query) && /doesn.?t exist|not found|404/i.test(msg)) {
        inviteRes = await sendWorkspaceEmailInvite(api, teamId, payload.email || query);
      } else if (/doesn.?t exist|not found|404/i.test(msg)) {
        renderLookup({ status: "not_found", matches: [] });
        setStatus("Enter a registered name, @handle, or a valid email.", true);
        return;
      } else if (!/already/i.test(msg) && mode !== "folder") {
        throw err;
      } else {
        inviteRes = { status: "already_member", user: person };
      }
    }

    if (inviteRes?.status === "needs_confirm") {
      const label = personLabel(inviteRes.user) || personLabel(person) || "this person";
      const ok = window.confirm(
        inviteRes.message ||
          `You haven't worked with this person yet. Share this workspace with ${label}?`,
      );
      if (!ok) {
        setStatus("Invite canceled.");
        return;
      }
      inviteRes = await api(`/api/teams/${encodeURIComponent(teamId)}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, confirm_new_collaborator: true }),
      });
    }

    const addedName = personLabel(inviteRes?.user) || personLabel(person) || payload.email || query;
    let folderMsg = "";
    if (mode === "folder" && folderId) {
      const shareRes = await api(
        `/api/teams/${encodeURIComponent(teamId)}/folders/${encodeURIComponent(folderId)}/share`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: person?.email || payload.email,
            restrict_access: $("ws-send-invite-restrict")?.checked !== false,
          }),
        },
      );
      folderMsg = shareRes.message || "Folder shared.";
    }

    const inviteMsg = inviteStatusMessage(inviteRes, addedName);

    setStatus(folderMsg ? `${inviteMsg}. ${folderMsg}` : inviteMsg);

    const emailInput = $("team-invite-email");
    if (emailInput) emailInput.value = "";
    const pick = $("team-invite-pick");
    if (pick) pick.value = "";
    clearLookup();

    await refreshInviteCandidates({ ...liveOpts, ...opts, api });
    await refreshHavePanel({ api, teamId });
    await onInvited?.({
      teamId,
      email: person?.email || payload.email,
      folderId: mode === "folder" ? folderId : null,
      result: inviteRes,
    });
  } catch (err) {
    setStatus(err?.message || "Invite failed.", true);
  }
}

let bound = false;

export function bindWorkspaceSendInvite(opts = {}) {
  liveOpts = { ...liveOpts, ...opts };
  if (bound) return;
  bound = true;

  $("btn-open-workspace-invite")?.addEventListener("click", (e) => {
    e.preventDefault();
    void openWorkspaceSendInvite(liveOpts);
  });

  document.querySelectorAll("[data-ws-send-invite-close]").forEach((el) => {
    el.addEventListener("click", () => closeWorkspaceSendInvite());
  });

  $("ws-send-invite-team")?.addEventListener("change", () => {
    void onTeamChanged(liveOpts);
  });

  document.querySelectorAll('input[name="ws-invite-mode"]').forEach((input) => {
    input.addEventListener("change", () => syncModeUi());
  });

  $("team-invite-pick")?.addEventListener("change", () => {
    const pick = $("team-invite-pick");
    const emailInput = $("team-invite-email");
    if (!pick || !emailInput) return;
    if (pick.value) {
      emailInput.value = pick.value;
      scheduleLookup(liveOpts);
    }
  });

  $("btn-team-invite")?.addEventListener("click", () => {
    void sendInvite(liveOpts);
  });

  $("team-invite-email")?.addEventListener("input", () => {
    scheduleLookup(liveOpts);
  });

  $("team-invite-email")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void sendInvite(liveOpts);
    }
  });

  $("team-invite-lookup")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-invite-user]");
    if (!btn) return;
    const id = btn.getAttribute("data-invite-user");
    const person = lookupState.matches.find((m) => m.id === id);
    if (!person) return;
    lookupState.person = person;
    const emailInput = $("team-invite-email");
    if (emailInput) emailInput.value = person.handle_label || person.email || person.display_name || "";
    renderLookup({ status: "found", matches: [person] });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const modal = $(MODAL_ID);
    if (!modal || modal.classList.contains("hidden")) return;
    closeWorkspaceSendInvite();
  });
}
