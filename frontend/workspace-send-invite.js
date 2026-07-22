/**
 * Workspace send-invite popup — invite people to the *current* workspace only.
 * Opened from the slim "Invite people" button in the left Workspace panel.
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

function currentTeam(getActiveTeam) {
  try {
    return getActiveTeam?.() || null;
  } catch {
    return null;
  }
}

function updateModalContext(getActiveTeam) {
  const team = currentTeam(getActiveTeam);
  const nameEl = $("ws-send-invite-workspace-name");
  const hintEl = $("ws-send-invite-hint");
  const inviteBtn = $("btn-team-invite");
  const emailInput = $("team-invite-email");
  const pick = $("team-invite-pick");

  if (nameEl) {
    nameEl.textContent = team?.name ? String(team.name) : "current workspace";
  }

  const ready = !!(team?.id);
  if (hintEl) {
    hintEl.textContent = ready
      ? `People join “${team.name}” — the workspace you have open now. Switch workspace from Projects if you meant a different one.`
      : "Pick a workspace from the Projects folder icon first, then invite.";
  }
  if (inviteBtn) inviteBtn.disabled = !ready;
  if (emailInput) emailInput.disabled = !ready;
  if (pick && !ready) {
    pick.hidden = true;
    pick.innerHTML = `<option value="">People you've worked with…</option>`;
  }
  return team;
}

export async function refreshInviteCandidates({ getActiveTeam, api } = {}) {
  const pick = $("team-invite-pick");
  if (!pick) return;
  const team = currentTeam(getActiveTeam);
  if (!team?.id) {
    pick.hidden = true;
    pick.innerHTML = `<option value="">People you've worked with…</option>`;
    return;
  }
  try {
    const data = await api(
      `/api/teams/invite-candidates?team_id=${encodeURIComponent(team.id)}`,
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
  const { getActiveTeam, api } = opts;
  const modal = $(MODAL_ID);
  if (!modal) return;
  updateModalContext(getActiveTeam);
  setStatus("");
  const emailInput = $("team-invite-email");
  if (emailInput) emailInput.value = "";
  const pick = $("team-invite-pick");
  if (pick) pick.value = "";
  modal.classList.remove("hidden");
  await refreshInviteCandidates({ getActiveTeam, api });
  emailInput?.focus?.();
}

async function sendInvite(opts = {}) {
  const { getActiveTeam, api, onInvited } = opts;
  const team = currentTeam(getActiveTeam);
  const email = $("team-invite-email")?.value?.trim();
  if (!team?.id) {
    setStatus("Pick a workspace from the Projects folder icon first.", true);
    return;
  }
  if (!email) {
    setStatus("Enter an email to invite.", true);
    return;
  }
  setStatus("Sending invite…");
  try {
    const res = await api(`/api/teams/${team.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setStatus(
      res.status === "invited"
        ? `Invite sent to ${email}`
        : `${email} is already in this workspace`,
    );
    const emailInput = $("team-invite-email");
    if (emailInput) emailInput.value = "";
    const pick = $("team-invite-pick");
    if (pick) pick.value = "";
    await refreshInviteCandidates({ getActiveTeam, api });
    await onInvited?.({ team, email, result: res });
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
