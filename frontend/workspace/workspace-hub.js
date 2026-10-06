/** Clickable DESIGN Workspace header — workspaces, teams, friends, roles, watchdogs. */

import { authHeaders, getStoredUser } from "../studio/auth.js?v=20260907-ops-dash";
import { automationFormHtml, bindAutomationForm } from "./workspace-automation.js?v=20260908-wd-run";

const MODAL_ID = "workspace-hub-modal";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...authHeaders(options.headers || {}),
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
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

let state = { tab: "workspaces", teams: [], friends: [], management: new Map(), activeId: "" };
let hubOpts = {};

function modal() {
  return document.getElementById(MODAL_ID);
}

function setStatus(text, err = false) {
  const el = document.getElementById("ws-hub-status");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-error", !!err);
}

function owned(team) {
  const user = getStoredUser();
  return team?.role === "owner" || team?.created_by === user?.id;
}

function hubWorkspaceVisible(teamId) {
  return hubOpts.isWorkspaceVisible ? hubOpts.isWorkspaceVisible(teamId) !== false : true;
}

/** Every workspace the user belongs to — never hide rows because the sidebar is one-current. */
export function mergeHubTeams(apiTeams = [], localTeams = []) {
  const byId = new Map();
  for (const team of [...(localTeams || []), ...(apiTeams || [])]) {
    const id = String(team?.id || "").trim();
    if (!id) continue;
    byId.set(id, { ...(byId.get(id) || {}), ...team });
  }
  return [...byId.values()];
}

function hubWorkspaceCard(t, { joined = false } = {}) {
  const visible = hubWorkspaceVisible(t.id);
  return `
        <article class="ws-hub-card ws-hub-card--row" data-team-id="${esc(t.id)}" data-hub-inspect="${esc(t.id)}" title="Open workspace">
          <div>
            <strong>${esc(t.name)}</strong>
            <span class="ws-hub-pill">${esc(t.role_label || (joined ? t.role : "Admin"))}</span>
            <p class="muted small">${esc(t.member_count || 0)} members</p>
          </div>
          <div class="ws-hub-card-actions">
            <button type="button" class="ws-hub-eye" data-hub-eye="${esc(t.id)}" title="${visible ? "Hide from sidebar" : "Show in sidebar"}" aria-label="${visible ? "Hide workspace" : "Show workspace"}">${visible ? "◉" : "○"}</button>
            <button type="button" class="btn secondary btn-compact" data-hub-invite="${esc(t.id)}">Invite</button>
            <button type="button" class="btn accent btn-compact" data-hub-switch="${esc(t.id)}">Use</button>
            <button type="button" class="btn secondary btn-compact" data-hub-inspect="${esc(t.id)}">Open</button>
          </div>
        </article>`;
}

function renderHierarchy(teams) {
  const user = getStoredUser();
  const list = Array.isArray(teams) ? teams : [];
  const mine = list.filter((t) => owned(t));
  const others = list.filter((t) => !owned(t));
  return `
    <div class="ws-hub-tree">
      <p class="muted small">Every workspace you belong to is listed here — including hidden ones. Use switches the sidebar row. Open shows people and projects.</p>
      ${mine.map((t) => hubWorkspaceCard(t)).join("")}
      ${
        others.length
          ? `<h4>Joined</h4>${others.map((t) => hubWorkspaceCard(t, { joined: true })).join("")}`
          : ""
      }
      ${!list.length ? `<p class="muted small">No workspaces loaded yet.</p>` : ""}
      ${user ? `<p class="muted small">Signed in as ${esc(user.email)}</p>` : ""}
    </div>
  `;
}

function renderTeamDetail(team, data) {
  if (!team) return `<p class="muted small">Select a workspace.</p>`;
  const can = owned(team);
  const members = data?.members || [];
  return `
    <div class="ws-hub-detail">
      <header>
        <h3>${esc(team.name)}</h3>
        <p class="muted small">${esc(team.role_label || team.role)} · ${members.length} people</p>
      </header>
      <div class="ws-hub-member-list">
        ${members
          .map((m) => {
            const isOwner = m.role === "owner";
            return `
          <article class="ws-hub-member">
            <div>
              <strong>${esc(m.display_name || m.email)}</strong>
              <span class="muted small">${esc(m.email || "")}</span>
            </div>
            <div class="ws-hub-member-controls">
              ${
                can && !isOwner
                  ? `<select data-hub-role data-user="${esc(m.id)}" data-team="${esc(team.id)}">
                      <option value="manager" ${m.role === "manager" ? "selected" : ""}>Manager</option>
                      <option value="user" ${m.role !== "manager" ? "selected" : ""}>User</option>
                    </select>
                    <label class="ws-hub-toggle">export <input type="checkbox" data-hub-perm="can_export" data-user="${esc(m.id)}" data-team="${esc(team.id)}" ${m.can_export !== false ? "checked" : ""} /></label>
                    <label class="ws-hub-toggle">edit files <input type="checkbox" data-hub-access data-user="${esc(m.id)}" data-team="${esc(team.id)}" ${m.access !== "view" ? "checked" : ""} /></label>
                    <label class="ws-hub-toggle">tools <input type="checkbox" data-hub-perm="can_access_tools" data-user="${esc(m.id)}" data-team="${esc(team.id)}" ${m.can_access_tools !== false ? "checked" : ""} /></label>
                    <button type="button" class="btn secondary btn-compact" data-hub-transfer="${esc(m.id)}" data-team="${esc(team.id)}">Transfer ownership</button>
                    <button type="button" class="btn danger btn-compact" data-hub-revoke="${esc(m.id)}" data-team="${esc(team.id)}">Revoke tools+export</button>`
                  : `<span class="ws-hub-pill">${esc(m.role_label || m.role)}</span>`
              }
            </div>
          </article>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderFriends(friends) {
  const list = Array.isArray(friends?.people)
    ? friends.people
    : Array.isArray(friends?.friends)
      ? friends.friends
      : Array.isArray(friends)
        ? friends
        : [];
  if (!list.length) return `<p class="muted small">No friends yet. Use Social to connect.</p>`;
  return `<div class="ws-hub-friends">${list
    .map(
      (f) => `<article class="ws-hub-card"><strong>${esc(f.display_name || f.handle || f.email)}</strong><span class="muted small">${esc(f.handle_label || f.email || "")}</span></article>`
    )
    .join("")}</div>`;
}

function renderBody() {
  const body = document.getElementById("ws-hub-body");
  if (!body) return;
  const user = getStoredUser();
  if (state.tab === "friends") {
    body.innerHTML = renderFriends(state.friends);
    return;
  }
  if (state.tab === "automation") {
    body.innerHTML = automationFormHtml({
      teams: state.teams,
      userId: user?.id,
      selected: state.activeId ? [state.activeId] : [],
    });
    void bindAutomationForm(body, { onStatus: setStatus });
    return;
  }
  if (state.tab === "roles" || state.tab === "teams") {
    const team = state.teams.find((t) => t.id === state.activeId) || state.teams.find((t) => owned(t));
    const data = team ? state.management.get(team.id) : null;
    body.innerHTML = `${renderHierarchy(state.teams)}${renderTeamDetail(team, data)}`;
    return;
  }
  body.innerHTML = renderHierarchy(state.teams);
}

let hubRefreshAbort = null; // leakfix51
function beginHubFetch() {
  if (hubRefreshAbort) {
    try { hubRefreshAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  hubRefreshAbort = ctl;
  return ctl;
}

async function loadTeam(teamId, signal) {
  if (!teamId) return;
  const ctl = signal ? null : beginHubFetch();
  const sig = signal || ctl.signal;
  try {
    const data = await api(`/api/teams/${encodeURIComponent(teamId)}/management`, { signal: sig });
    if (sig.aborted) return;
    state.management.set(teamId, data);
    state.activeId = teamId;
  } catch (err) {
    if (sig.aborted || err?.name === "AbortError") return;
    throw err;
  } finally {
    if (ctl && hubRefreshAbort === ctl) hubRefreshAbort = null;
  }
}

function selectWorkspace(teamId) {
  const id = String(teamId || "").trim();
  if (!id) return;
  closeWorkspaceHub();
  if (hubOpts.onSelectWorkspace) hubOpts.onSelectWorkspace(id);
  else if (hubOpts.onInspectWorkspace) hubOpts.onInspectWorkspace(id);
}

async function refresh() {
  const ctl = beginHubFetch();
  setStatus("");
  try {
    const [teams, friends] = await Promise.all([
      api("/api/teams", { signal: ctl.signal }).catch((err) => {
        if (ctl.signal.aborted || err?.name === "AbortError") throw err;
        return { teams: [] };
      }),
      api("/api/social/friends", { signal: ctl.signal }).catch((err) => {
        if (ctl.signal.aborted || err?.name === "AbortError") throw err;
        return { friends: [] };
      }),
    ]);
    if (ctl.signal.aborted) return;
    const fromApi = teams.teams || teams || [];
    state.teams = mergeHubTeams(fromApi, hubOpts.getTeams?.() || []);
    state.friends = friends;
    if (!state.activeId) {
      const first = state.teams.find((t) => owned(t));
      if (first) await loadTeam(first.id, ctl.signal);
    } else if (!state.management.has(state.activeId)) {
      await loadTeam(state.activeId, ctl.signal);
    }
    if (ctl.signal.aborted) return;
    renderBody();
  } catch (err) {
    if (ctl.signal.aborted || err?.name === "AbortError") return;
    setStatus(err.message || "Could not load workspace hub", true);
  } finally {
    if (hubRefreshAbort === ctl) hubRefreshAbort = null;
  }
}

export function closeWorkspaceHub() {
  modal()?.classList.add("hidden");
}

export async function openWorkspaceHub({ tab = "workspaces", teamId = "", ...rest } = {}) {
  if (rest && Object.keys(rest).length) hubOpts = { ...hubOpts, ...rest };
  const el = modal();
  if (!el) return;
  state.tab = tab;
  if (teamId) state.activeId = teamId;
  if (!state.teams.length && hubOpts.getTeams) {
    state.teams = mergeHubTeams([], hubOpts.getTeams() || []);
  }
  el.classList.remove("hidden");
  el.querySelectorAll("[data-hub-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.hubTab === state.tab);
  });
  await refresh();
}

export function bindWorkspaceHub(opts = {}) {
  hubOpts = opts || {};
  const trigger = document.getElementById("btn-workspace-hub");
  trigger?.addEventListener("click", (e) => {
    e.preventDefault();
    void openWorkspaceHub({ tab: "workspaces" });
  });
  document.getElementById("btn-view-workspaces")?.addEventListener("click", (e) => {
    e.preventDefault();
    void openWorkspaceHub({ tab: "workspaces" });
  });
  document.getElementById("btn-open-workspace-automation")?.addEventListener("click", (e) => {
    e.preventDefault();
    void openWorkspaceHub({ tab: "automation", teamId: opts.getActiveTeam?.()?.id });
  });
  document.querySelectorAll("[data-ws-hub-close]").forEach((el) => {
    el.addEventListener("click", () => closeWorkspaceHub());
  });
  modal()?.addEventListener("click", async (e) => {
    const tab = e.target.closest("[data-hub-tab]");
    if (tab) {
      state.tab = tab.dataset.hubTab || "workspaces";
      modal()?.querySelectorAll("[data-hub-tab]").forEach((btn) => {
        btn.classList.toggle("active", btn === tab);
      });
      renderBody();
      return;
    }
    const eye = e.target.closest("[data-hub-eye]");
    if (eye) {
      e.stopPropagation();
      const id = eye.dataset.hubEye;
      if (!id) return;
      const nextVisible = !hubWorkspaceVisible(id);
      void hubOpts.onToggleVisible?.(id, nextVisible);
      const team = state.teams.find((t) => String(t.id) === String(id));
      if (team) team.explorer_visible = nextVisible;
      renderBody();
      return;
    }
    const invite = e.target.closest("[data-hub-invite]");
    if (invite) {
      e.stopPropagation();
      const id = invite.dataset.hubInvite;
      if (!id) return;
      const team = state.teams.find((t) => String(t.id) === String(id));
      const role = String(team?.role || "").toLowerCase();
      const allowed = !!(team?.can_invite || role === "owner" || role === "admin");
      if (!allowed) {
        setStatus("You do not have permission to invite people to this workspace.", true);
        return;
      }
      if (!hubOpts.onInviteWorkspace) {
        setStatus("Invite is not available.", true);
        return;
      }
      closeWorkspaceHub();
      hubOpts.onInviteWorkspace(id);
      return;
    }
    const switchBtn = e.target.closest("[data-hub-switch]");
    if (switchBtn) {
      e.stopPropagation();
      selectWorkspace(switchBtn.dataset.hubSwitch);
      return;
    }
    const inspect = e.target.closest("[data-hub-inspect]");
    if (inspect) {
      const id = inspect.dataset.hubInspect;
      closeWorkspaceHub();
      if (hubOpts.onInspectWorkspace) hubOpts.onInspectWorkspace(id);
      else {
        await loadTeam(id);
        state.tab = "roles";
        modal()?.querySelectorAll("[data-hub-tab]").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.hubTab === "roles");
        });
        modal()?.classList.remove("hidden");
        renderBody();
      }
      return;
    }
    const open = e.target.closest("[data-hub-open]");
    if (open) {
      await loadTeam(open.dataset.hubOpen);
      state.tab = "roles";
      modal()?.querySelectorAll("[data-hub-tab]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.hubTab === "roles");
      });
      renderBody();
      return;
    }
    const transfer = e.target.closest("[data-hub-transfer]");
    if (transfer) {
      if (!window.confirm("Transfer workspace ownership to this member?")) return;
      try {
        await api(`/api/teams/${encodeURIComponent(transfer.dataset.team)}/transfer`, {
          method: "POST",
          body: JSON.stringify({ user_id: transfer.dataset.hubTransfer }),
        });
        setStatus("Ownership transferred.");
        await opts.onChanged?.({ action: "transfer", teamId: transfer.dataset.team });
        await refresh();
      } catch (err) {
        setStatus(err.message || "Transfer failed", true);
      }
      return;
    }
    const revoke = e.target.closest("[data-hub-revoke]");
    if (revoke) {
      try {
        await api(
          `/api/teams/${encodeURIComponent(revoke.dataset.team)}/members/${encodeURIComponent(revoke.dataset.hubRevoke)}/permissions`,
          { method: "PATCH", body: JSON.stringify({ can_export: false, can_access_tools: false }) },
        );
        setStatus("Export and tools revoked.");
        await loadTeam(revoke.dataset.team);
        renderBody();
      } catch (err) {
        setStatus(err.message || "Revoke failed", true);
      }
    }
  });
  modal()?.addEventListener("change", async (e) => {
    const role = e.target.closest("[data-hub-role]");
    if (role) {
      try {
        await api(
          `/api/teams/${encodeURIComponent(role.dataset.team)}/members/${encodeURIComponent(role.dataset.user)}/role`,
          { method: "PATCH", body: JSON.stringify({ role: role.value }) },
        );
        setStatus(role.value === "manager" ? "Manager appointed." : "Role set to user.");
        await loadTeam(role.dataset.team);
        renderBody();
      } catch (err) {
        setStatus(err.message || "Role failed", true);
      }
      return;
    }
    const access = e.target.closest("[data-hub-access]");
    if (access) {
      await api(
        `/api/teams/${encodeURIComponent(access.dataset.team)}/members/${encodeURIComponent(access.dataset.user)}/permissions`,
        { method: "PATCH", body: JSON.stringify({ access: access.checked ? "edit" : "view" }) },
      );
      return;
    }
    const perm = e.target.closest("[data-hub-perm]");
    if (perm) {
      await api(
        `/api/teams/${encodeURIComponent(perm.dataset.team)}/members/${encodeURIComponent(perm.dataset.user)}/permissions`,
        { method: "PATCH", body: JSON.stringify({ [perm.dataset.hubPerm]: perm.checked }) },
      );
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal() && !modal().classList.contains("hidden")) closeWorkspaceHub();
  });
}
