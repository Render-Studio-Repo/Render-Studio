/** Auth gates and shared-workspace choices for remix / copy-share flows. */

export const PENDING_SHARE_ACTION_KEY = "render3d:pendingShareAction:v1";
export const STUDIO_VIEWPORT_HASH = "viewport";

export function mustAuthBeforeRemixOrShare(token) {
  return !String(token || "").trim();
}

export function studioViewportPath(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return `/#${STUDIO_VIEWPORT_HASH}`;
  return `/?project=${encodeURIComponent(id)}#${STUDIO_VIEWPORT_HASH}`;
}

export function savePendingShareAction(action, storage = defaultSessionStorage()) {
  if (!storage || !action || typeof action !== "object") return false;
  const kind = String(action.kind || "").trim();
  if (!kind) return false;
  try {
    storage.setItem(PENDING_SHARE_ACTION_KEY, JSON.stringify({ ...action, kind, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function peekPendingShareAction(storage = defaultSessionStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_SHARE_ACTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function takePendingShareAction(storage = defaultSessionStorage()) {
  const pending = peekPendingShareAction(storage);
  try {
    storage?.removeItem?.(PENDING_SHARE_ACTION_KEY);
  } catch {
    /* ignore */
  }
  return pending;
}

export function looksLikePersonalWorkspace(team, { personalTeamId, currentUserId } = {}) {
  if (!team?.id) return false;
  const members = Number(team.member_count ?? team.members_count ?? 1) || 1;
  if (members > 1) return false;
  if (personalTeamId && team.id === personalTeamId) return true;
  if (currentUserId && team.created_by && String(team.created_by) !== String(currentUserId)) return false;
  const name = String(team.name || "").trim().toLowerCase();
  return (
    /'s\s+workspace$/i.test(name)
    || /’s\s+workspace$/i.test(name)
    || name === "my workspace"
    || name === "personal workspace"
    || name === "personal"
    || name === "projects"
  );
}

export function inferPersonalTeamId(teams, { currentUserId } = {}) {
  const list = Array.isArray(teams) ? teams : [];
  const mine = list
    .filter((team) => {
      if (currentUserId && team.created_by && String(team.created_by) !== String(currentUserId)) return false;
      return team.role === "owner" || !team.role;
    })
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const solo = mine.filter((team) => (Number(team.member_count ?? 1) || 1) <= 1);
  const named = solo.find((team) => looksLikePersonalWorkspace(team, { currentUserId }));
  return (named || solo[0] || null)?.id || null;
}

export function sharedWorkspacesFromTeams(teams, opts = {}) {
  const personalTeamId = opts.personalTeamId || inferPersonalTeamId(teams, opts);
  return (Array.isArray(teams) ? teams : []).filter((team) => (
    team?.id && !looksLikePersonalWorkspace(team, { ...opts, personalTeamId })
  ));
}

export function remixOpenBody(choice = {}, { targetProjectId } = {}) {
  const body = {};
  const existingProject = String(targetProjectId || "").trim();
  if (existingProject) {
    body.target_project_id = existingProject;
    return body;
  }
  const mode = String(choice.mode || "none");
  if (mode === "existing" && choice.teamId) body.team_id = String(choice.teamId);
  if (mode === "new") {
    body.create_shared_workspace = true;
    const name = String(choice.workspaceName || "").trim();
    if (name) body.workspace_name = name.slice(0, 80);
  }
  if (choice.shareWithSharer) body.share_with_sharer = true;
  return body;
}

export function sharedWorkspacePickerHtml({
  workspaces = [],
  sharer = null,
  prefix = "share-ws",
  escapeHtml = escapePickerHtml,
} = {}) {
  const list = Array.isArray(workspaces) ? workspaces.filter((row) => row?.id) : [];
  const options = list.length
    ? list.map((row) => {
      const members = Number(row.member_count ?? row.members_count ?? 0) || 0;
      const mark = members > 1 ? ` · ${members} member${members === 1 ? "" : "s"}` : "";
      return `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name || "Shared workspace")}${escapeHtml(mark)}</option>`;
    }).join("")
    : `<option value="">No shared workspaces yet</option>`;
  const sharerName = sharer?.display_name || sharer?.email || "the original sharer";
  return `
    <fieldset class="share-ws-picker" data-share-ws-picker>
      <legend>Shared workspace</legend>
      <label class="share-ws-option">
        <input type="radio" name="${escapeHtml(prefix)}-mode" value="none" data-share-ws-mode="none" checked />
        <span>
          <strong>Keep in my workspace</strong>
          <small>Personal project — not added to a shared workspace.</small>
        </span>
      </label>
      <label class="share-ws-option">
        <input type="radio" name="${escapeHtml(prefix)}-mode" value="existing" data-share-ws-mode="existing"${list.length ? "" : " disabled"} />
        <span>
          <strong>Add to an existing shared workspace</strong>
          <small>Place this in a workspace you already have.</small>
          <select class="share-ws-existing" data-share-ws-existing ${list.length ? "" : "disabled"}>
            ${list.length ? `<option value="">Choose a workspace…</option>${options}` : options}
          </select>
        </span>
      </label>
      <label class="share-ws-option">
        <input type="radio" name="${escapeHtml(prefix)}-mode" value="new" data-share-ws-mode="new" />
        <span>
          <strong>Create a new shared workspace</strong>
          <small>Start a fresh collaboration workspace.</small>
          <input type="text" class="share-ws-new-name" data-share-ws-new-name placeholder="Workspace name" maxlength="80" disabled />
        </span>
      </label>
      ${sharer?.id ? `
        <label class="share-ws-invite">
          <input type="checkbox" data-share-ws-invite-sharer />
          <span>Invite ${escapeHtml(sharerName)} to the selected workspace</span>
        </label>
      ` : ""}
    </fieldset>
  `;
}

export function readSharedWorkspacePicker(root) {
  const picker = root?.querySelector?.("[data-share-ws-picker]") || root;
  if (!picker) {
    return { mode: "none", teamId: "", createSharedWorkspace: false, workspaceName: "", shareWithSharer: false };
  }
  const mode = picker.querySelector("[data-share-ws-mode]:checked")?.value
    || picker.querySelector('input[type="radio"]:checked')?.value
    || "none";
  return {
    mode,
    teamId: mode === "existing" ? String(picker.querySelector("[data-share-ws-existing]")?.value || "").trim() : "",
    createSharedWorkspace: mode === "new",
    workspaceName: String(picker.querySelector("[data-share-ws-new-name]")?.value || "").trim(),
    shareWithSharer: !!picker.querySelector("[data-share-ws-invite-sharer]")?.checked,
  };
}

export function syncSharedWorkspacePicker(root) {
  const picker = root?.querySelector?.("[data-share-ws-picker]") || root;
  if (!picker) return;
  const mode = picker.querySelector("[data-share-ws-mode]:checked")?.value || "none";
  const existing = picker.querySelector("[data-share-ws-existing]");
  const name = picker.querySelector("[data-share-ws-new-name]");
  if (existing) existing.disabled = mode !== "existing";
  if (name) name.disabled = mode !== "new";
}

export function bindSharedWorkspacePicker(root) {
  const picker = root?.querySelector?.("[data-share-ws-picker]") || root;
  if (!picker || picker.dataset.shareWsBound === "1") return picker;
  picker.dataset.shareWsBound = "1";
  picker.querySelectorAll("[data-share-ws-mode]").forEach((input) => {
    input.addEventListener("change", () => syncSharedWorkspacePicker(picker));
  });
  syncSharedWorkspacePicker(picker);
  return picker;
}

export function gateRemixOrShare({ token, action, storage } = {}) {
  if (!mustAuthBeforeRemixOrShare(token)) return { ok: true, needsAuth: false };
  if (action) savePendingShareAction(action, storage);
  return { ok: false, needsAuth: true, action: action || null };
}

function defaultSessionStorage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function escapePickerHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}
