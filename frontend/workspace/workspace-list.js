/** Pure helpers for the left-sidebar WORKSPACES list. */

function looksPersonalName(team) {
  const name = String(team?.name || "").trim().toLowerCase();
  return (
    /'s\s+workspace$/i.test(name)
    || /’s\s+workspace$/i.test(name)
    || name === "my workspace"
    || name === "personal workspace"
    || name === "personal"
    || name === "projects"
    || name.includes("@")
  );
}

function teamMemberCount(team) {
  return Number(team?.member_count ?? team?.members_count ?? 1) || 1;
}

/** Solo owned workspace only. Multi-member teams (including email-named collabs) are not personal. */
export function inferPersonalWorkspaceId(teams = [], explicitId = null) {
  const list = teams || [];
  const hasCollab = list.some((team) => teamMemberCount(team) > 1);
  const mine = list.filter((team) => {
    const role = String(team?.role || "").toLowerCase();
    const owner = role === "owner" || role === "admin";
    return owner && teamMemberCount(team) <= 1;
  });
  const explicit = explicitId != null ? String(explicitId).trim() : "";
  if (explicit) {
    const team = list.find((row) => String(row?.id || "") === explicit);
    // Unknown id: trust caller (invitee before teams hydrate). Known multi-member: ignore.
    if (!team) return explicit;
    if (teamMemberCount(team) > 1) return "";
    if (hasCollab && !looksPersonalName(team)) return "";
    return explicit;
  }
  const named = mine.find(looksPersonalName);
  if (named) return String(named.id);
  if (hasCollab) return "";
  return String(mine[0]?.id || "");
}

export const SIDEBAR_WORKSPACE_LIMIT = 5;

export function listedSidebarWorkspaces({
  teams = [],
  hiddenIds = [],
  personalId = null,
  personalLabel = "Projects",
  projects = [],
  pinPersonal = true,
  recentIds = [],
  limit = SIDEBAR_WORKSPACE_LIMIT,
} = {}) {
  const hidden = hiddenIds instanceof Set
    ? hiddenIds
    : new Set([...(hiddenIds || [])].map((id) => String(id)));
  const counts = new Map();
  for (const project of projects || []) {
    const tid = String(project?.team_id || "");
    if (!tid) continue;
    counts.set(tid, (counts.get(tid) || 0) + 1);
  }
  const pid = inferPersonalWorkspaceId(teams, personalId);
  const list = (teams || []).filter((team) => {
    if (!team?.id) return false;
    const id = String(team.id);
    if (pinPersonal && pid && id === pid) return true;
    return !hidden.has(id);
  });
  if (pid && !list.some((team) => String(team.id) === pid)) {
    const found = (teams || []).find((team) => String(team.id) === pid);
    if (found) list.unshift(found);
  }
  const recency = new Map(
    [...recentIds || []].map((id, index) => [String(id), index]),
  );
  const sorted = list.sort((a, b) => {
    const aid = String(a.id);
    const bid = String(b.id);
    const ar = recency.has(aid) ? recency.get(aid) : 999;
    const br = recency.has(bid) ? recency.get(bid) : 999;
    if (ar !== br) return ar - br;
    if (pid && aid === pid) return -1;
    if (pid && bid === pid) return 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  const capped = Number(limit) > 0 ? sorted.slice(0, Number(limit)) : sorted;
  if (pid && Number(limit) > 0 && !capped.some((team) => String(team.id) === pid)) {
    const personal = sorted.find((team) => String(team.id) === pid);
    if (personal) {
      if (capped.length >= Number(limit)) capped.pop();
      capped.push(personal);
    }
  }
  return capped
    .map((team) => {
      const id = String(team.id);
      const personal = !!pid && id === pid;
      const members = Number(team.member_count ?? team.members_count ?? 1) || 1;
      const role = String(team.role || "").toLowerCase();
      return {
        id,
        label: personal ? personalLabel : (team.name || "Shared workspace"),
        personal,
        shared: !personal || members > 1,
        memberCount: members,
        projectCount: counts.get(id) || 0,
        canInvite: !!(team.can_invite || role === "owner" || role === "admin"),
        canManagePerms: role === "owner" || role === "admin",
        role,
      };
    });
}

/** True for Public / admin "other user renders" virtual folders. */
export function isCommunityProject(project = {}) {
  const id = String(project?.folder_id || project?.id || "");
  return (
    project?.public === true
    || id === "__public__"
    || id === "__other_user_renders__"
  );
}

export function projectOwnerId(project = {}) {
  return String(
    project?.owner_user_id
    || project?.created_by
    || project?.generation?.by_user_id
    || "",
  ).trim();
}

/**
 * Projects that belong in the left-sidebar "Projects" list (personal tree).
 *
 * Invitees with a solo personal workspace: that workspace only.
 * Collab-only owners (Sam W / a1projects): projects they own, not the
 * Kiefer / Docs Demo / admin other-renders feed.
 */
export function belongsInPersonalProjectsList(project, {
  personalWorkspaceId = "",
  sharedWorkspaceIds = [],
  currentUserId = "",
} = {}) {
  if (!project) return false;
  if (isCommunityProject(project)) {
    // Publishing changes visibility, not ownership or personal-list membership.
    return !!currentUserId && projectOwnerId(project) === String(currentUserId)
      && String(project.folder_id || "") !== "__other_user_renders__";
  }
  const fid = String(project.folder_id || "");
  if (project.shared_workspace_folder || fid.startsWith("__shared_ws_")) return false;
  const tid = String(project.team_id || "");
  const pid = String(personalWorkspaceId || "");
  const me = String(currentUserId || "").trim();
  const owner = projectOwnerId(project);
  // True solo personal workspace (invitee): that team only.
  // No solo workspace (Sam W): owned union across teams. Never treat a
  // multi-member email team as personal — vineetsai@gmail.com has 0 projects.
  if (pid) return !tid || tid === pid;
  if (me && owner) return owner === me;
  if (project.shared_with_me) return false;
  const shared = sharedWorkspaceIds instanceof Set
    ? sharedWorkspaceIds
    : new Set([...(sharedWorkspaceIds || [])].map((id) => String(id)));
  if (tid && shared.size && !shared.has(tid)) return false;
  return true;
}

/**
 * Personal projects omitted from the Explorer root list (unknown folder_id, etc.).
 * `includeProject` is the search predicate — default keep all. Search callers must
 * pass a matcher so this catch-up cannot restore rows the query already excluded.
 */
export function unlistedPersonalProjects(projects = [], {
  listedIds = [],
  isPersonalProject = () => true,
  personalFolderIds = [],
  includeProject = () => true,
} = {}) {
  const seen = listedIds instanceof Set
    ? new Set([...listedIds].map((id) => String(id)))
    : new Set([...(listedIds || [])].map((id) => String(id)));
  const folders = personalFolderIds instanceof Set
    ? personalFolderIds
    : new Set([...(personalFolderIds || [])].map((id) => String(id)));
  const extra = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    if (!project?.id || seen.has(String(project.id)) || !isPersonalProject(project)) continue;
    const fid = String(project.folder_id || "");
    if (fid && folders.has(fid)) continue;
    if (project.shared_workspace_folder || fid.startsWith("__shared_ws_")) {
      continue;
    }
    if (!includeProject(project)) continue;
    extra.push(project);
    seen.add(String(project.id));
  }
  return extra;
}

/** Folders that belong under the personal Projects tree (not shared-workspace rows). */
export function belongsInPersonalFolderList(folder, {
  personalWorkspaceId = "",
  currentUserId = "",
  ownedFolderIds = [],
} = {}) {
  if (!folder?.id) return false;
  const id = String(folder.id);
  if (folder.public || id === "__public__" || id === "__other_user_renders__" || id === "__archive__") {
    return false;
  }
  if (folder.shared_workspace || folder.shared_workspace_folder || id.startsWith("__shared_ws_")) {
    return false;
  }
  const pid = String(personalWorkspaceId || "");
  if (pid) return !folder.team_id || String(folder.team_id) === pid;
  const me = String(currentUserId || "").trim();
  if (me && folder.created_by && String(folder.created_by) === me) return true;
  const owned = ownedFolderIds instanceof Set
    ? ownedFolderIds
    : new Set([...(ownedFolderIds || [])].map((fid) => String(fid)));
  return owned.has(id);
}

function knownTeamId(teams, raw) {
  const id = String(raw || "").trim();
  if (!id) return "";
  return (teams || []).some((row) => String(row?.id || "") === id) ? id : "";
}

/**
 * Explorer WORKSPACES: the one workspace to show (opened workspace, else
 * the last/current project's team, else the most recent / saved team).
 */
export function currentSidebarWorkspaceId({
  teams = [],
  projects = [],
  lastOpenedProjectId = null,
  activeProjectId = null,
  recentIds = [],
  savedWorkspaceId = null,
  openedWorkspaceId = null,
  preferRecent = false,
} = {}) {
  const last = lastOpenedSidebarProject({
    teams,
    projects,
    lastOpenedProjectId,
    activeProjectId,
  });
  const valid = (raw) => knownTeamId(teams, raw);
  const recent = valid(recentIds?.[0]);
  const fromProject = valid(last?.id);
  const opened = valid(openedWorkspaceId);
  const saved = valid(savedWorkspaceId);
  if (preferRecent) return opened || recent || fromProject || saved;
  return opened || fromProject || recent || saved;
}

/**
 * One listed workspace row for Explorer WORKSPACES (same shape as listedSidebarWorkspaces).
 * Does not pin personal or cap a roster — Manage still lists the rest.
 */
export function currentListedSidebarWorkspace(opts = {}) {
  const id = currentSidebarWorkspaceId(opts);
  if (!id) return null;
  const rows = listedSidebarWorkspaces({
    teams: opts.teams || [],
    hiddenIds: [],
    personalId: opts.personalId ?? null,
    personalLabel: opts.personalLabel || "Projects",
    projects: opts.projects || [],
    pinPersonal: false,
    recentIds: [id],
    limit: 0,
  });
  return rows.find((row) => row.id === id) || null;
}

/**
 * Left WORKSPACES chrome: the last opened project and the workspace it belongs to.
 * Does not list the workspace roster or pick a different recents project in that team.
 */
/** Individual project shares (not team workspaces / Public). */
export function isSharedSidebarProject(project = {}, { currentUserId = "" } = {}) {
  if (!project || isCommunityProject(project)) return false;
  if (project.shared_workspace_folder) return false;
  if (project.shared_with_me) return true;
  if (project.shared_by_me) return true;
  const shares = Number(project.share_count || 0);
  const me = String(currentUserId || "").trim();
  const owner = projectOwnerId(project);
  return !!(me && owner && owner === me && shares > 0);
}

export function listedSharedProjects({
  projects = [],
  currentUserId = "",
} = {}) {
  return (Array.isArray(projects) ? projects : []).filter((project) => (
    isSharedSidebarProject(project, { currentUserId })
  ));
}

/** Split shared-with-me vs shared-by-me for the Shared Projects popup. */
export function partitionSharedProjects({
  projects = [],
  currentUserId = "",
} = {}) {
  const withMe = [];
  const byMe = [];
  const seen = new Set();
  for (const project of listedSharedProjects({ projects, currentUserId })) {
    const id = String(project?.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (project.shared_with_me) withMe.push(project);
    else byMe.push(project);
  }
  return {
    withMe: sortProjectsForDisplay(withMe, { recencyFirst: true }),
    byMe: sortProjectsForDisplay(byMe, { recencyFirst: true }),
  };
}

export const SHARED_SIDEBAR_RECENTS_MIN = 1;
export const SHARED_SIDEBAR_RECENTS_MAX = 10;
export const SHARED_SIDEBAR_PREF_PREFIX = "render3d:shared-sidebar:";
export const PERSONAL_PIN_MAX = 5;
export const PERSONAL_PIN_PREF_PREFIX = "render3d:project-pins:";
export const PERSONAL_PIN_CAP_MESSAGE = "Unpin one project first — you can pin up to 5.";
export const PERSONAL_PIN_CACHE = "projpin1";

/** UI labels mapped onto project_shares.role (viewer / remixer / editor). */
export const SHARE_PERMISSIONS = [
  { id: "viewer", label: "View only", hint: "Can watch and comment" },
  { id: "remixer", label: "Remix only", hint: "Can copy into their own project and download" },
  { id: "editor", label: "Remix and edit", hint: "Can edit this live project, pin markup, and download" },
];

export function clampSharedRecentsCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return SHARED_SIDEBAR_RECENTS_MIN;
  return Math.min(
    SHARED_SIDEBAR_RECENTS_MAX,
    Math.max(SHARED_SIDEBAR_RECENTS_MIN, Math.round(n)),
  );
}

export function defaultSharedSidebarPrefs() {
  return { pinnedIds: [], tabPinnedIds: [], recentsCount: 1, order: [], view: "list" };
}

export function normalizeSharePermission(role) {
  const value = String(role || "viewer").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "editor" || value === "edit" || value === "remix_and_edit") return "editor";
  if (value === "remixer" || value === "remix" || value === "remix_only" || value === "view_and_remix") return "remixer";
  return "viewer";
}

export function sharePermissionLabel(role) {
  const id = normalizeSharePermission(role);
  return SHARE_PERMISSIONS.find((row) => row.id === id)?.label || "View only";
}

export function sharedProjectPreviewUrl(project = {}) {
  const preview = String(project?.preview_url || "").trim();
  if (preview) return preview;
  const id = String(project?.id || "").trim();
  return id ? `/api/projects/${encodeURIComponent(id)}/thumb` : "";
}

function readStorage(storage) {
  if (storage && typeof storage.getItem === "function") return storage;
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode */
  }
  return null;
}

export function normalizePersonalPinIds(ids = []) {
  return [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean))];
}

/** Public / community rows stay on the Public pin, not personal Projects pins. */
export function canPinPersonalProject(project = {}) {
  if (!project?.id) return false;
  if (isCommunityProject(project)) return false;
  if (project.public === true) return false;
  return true;
}

/**
 * Pin or unpin a personal project. Never silently drops a 6th pin —
 * callers should show `error` and leave the existing five in place.
 */
export function togglePersonalProjectPin(ids, projectId, { max = PERSONAL_PIN_MAX } = {}) {
  const current = normalizePersonalPinIds(ids);
  const id = String(projectId || "").trim();
  const cap = Number(max) > 0 ? Number(max) : PERSONAL_PIN_MAX;
  if (!id) return { ok: false, pinned: false, pinnedIds: current, error: "Missing project" };
  if (current.includes(id)) {
    return { ok: true, pinned: false, pinnedIds: current.filter((row) => row !== id) };
  }
  if (current.length >= cap) {
    return { ok: false, pinned: false, pinnedIds: current, error: PERSONAL_PIN_CAP_MESSAGE };
  }
  return { ok: true, pinned: true, pinnedIds: [...current, id] };
}

export function partitionPersonalPinnedProjects(projects = [], pinnedIds = []) {
  const byId = new Map((projects || []).filter((p) => p?.id).map((p) => [String(p.id), p]));
  const pinned = [];
  const seen = new Set();
  for (const raw of normalizePersonalPinIds(pinnedIds)) {
    const row = byId.get(raw);
    if (!row || seen.has(raw)) continue;
    seen.add(raw);
    pinned.push(row);
  }
  const rest = (projects || []).filter((p) => p?.id && !seen.has(String(p.id)));
  return { pinned, rest };
}

export function loadPersonalPinIds(userId = "", storage = null) {
  const store = readStorage(storage);
  if (!store) return [];
  const key = `${PERSONAL_PIN_PREF_PREFIX}${String(userId || "anon")}`;
  try {
    const raw = JSON.parse(store.getItem(key) || "null");
    if (Array.isArray(raw)) return normalizePersonalPinIds(raw);
    if (raw && typeof raw === "object" && Array.isArray(raw.pinnedIds)) {
      return normalizePersonalPinIds(raw.pinnedIds);
    }
    return [];
  } catch {
    return [];
  }
}

export function savePersonalPinIds(userId = "", ids = [], storage = null) {
  const next = normalizePersonalPinIds(ids);
  const store = readStorage(storage);
  if (!store || typeof store.setItem !== "function") return next;
  const key = `${PERSONAL_PIN_PREF_PREFIX}${String(userId || "anon")}`;
  try {
    store.setItem(key, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

export function loadSharedSidebarPrefs(userId = "", storage = null) {
  const defaults = defaultSharedSidebarPrefs();
  const store = readStorage(storage);
  if (!store) return defaults;
  const key = `${SHARED_SIDEBAR_PREF_PREFIX}${String(userId || "anon")}`;
  try {
    const raw = JSON.parse(store.getItem(key) || "null");
    if (!raw || typeof raw !== "object") return defaults;
    const pinnedIds = [...new Set((Array.isArray(raw.pinnedIds) ? raw.pinnedIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
    const tabPinnedIds = [...new Set((Array.isArray(raw.tabPinnedIds) ? raw.tabPinnedIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
    const order = [...new Set((Array.isArray(raw.order) ? raw.order : []).map((id) => String(id || "").trim()).filter(Boolean))];
    const view = raw.view === "grid" ? "grid" : "list";
    return {
      pinnedIds,
      tabPinnedIds,
      recentsCount: clampSharedRecentsCount(raw.recentsCount),
      order,
      view,
    };
  } catch {
    return defaults;
  }
}

export function saveSharedSidebarPrefs(userId = "", prefs = {}, storage = null) {
  const next = {
    ...defaultSharedSidebarPrefs(),
    ...prefs,
    pinnedIds: [...new Set((prefs.pinnedIds || []).map((id) => String(id || "").trim()).filter(Boolean))],
    tabPinnedIds: [...new Set((prefs.tabPinnedIds || []).map((id) => String(id || "").trim()).filter(Boolean))],
    recentsCount: clampSharedRecentsCount(prefs.recentsCount),
    order: [...new Set((prefs.order || []).map((id) => String(id || "").trim()).filter(Boolean))],
    view: prefs.view === "grid" ? "grid" : "list",
  };
  const store = readStorage(storage);
  if (!store || typeof store.setItem !== "function") return next;
  const key = `${SHARED_SIDEBAR_PREF_PREFIX}${String(userId || "anon")}`;
  try {
    store.setItem(key, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

/**
 * Left SHARED PROJECTS strip: pinned rows plus up to recentsCount recents (1–10).
 * Custom `order` only rearranges that strip — not the full explorer.
 */
export function listedSidebarSharedProjects({
  projects = [],
  currentUserId = "",
  lastOpenedProjectId = null,
  activeProjectId = null,
  pinnedIds = [],
  recentsCount = 1,
  order = [],
} = {}) {
  const shared = listedSharedProjects({ projects, currentUserId });
  if (!shared.length) return [];
  const byId = new Map(shared.map((row) => [String(row.id), row]));
  const seen = new Set();
  const pinned = [];
  for (const raw of pinnedIds || []) {
    const id = String(raw || "").trim();
    const row = byId.get(id);
    if (!row || seen.has(id)) continue;
    seen.add(id);
    pinned.push({ ...row, sidebarKind: "pinned" });
  }
  const recents = [];
  const wanted = [...new Set(
    [lastOpenedProjectId, activeProjectId]
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  )];
  const recentPool = [
    ...wanted.map((id) => byId.get(id)).filter(Boolean),
    ...sortProjectsForDisplay(shared, { recencyFirst: true }),
  ];
  const cap = clampSharedRecentsCount(recentsCount);
  for (const row of recentPool) {
    const id = String(row?.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    recents.push({ ...row, sidebarKind: "recent" });
    if (recents.length >= cap) break;
  }
  const combined = [...pinned, ...recents];
  const rank = new Map((order || []).map((id, index) => [String(id), index]));
  combined.sort((a, b) => {
    const aid = String(a.id);
    const bid = String(b.id);
    const ar = rank.has(aid) ? rank.get(aid) : 1000;
    const br = rank.has(bid) ? rank.get(bid) : 1000;
    if (ar !== br) return ar - br;
    return 0;
  });
  return combined;
}

/**
 * Explorer SHARED PROJECTS: one current/last shared project (same idea as ws-one1).
 * Last opened wins when it is shared; else the active shared project; else newest shared.
 */
export function currentListedSidebarSharedProject({
  projects = [],
  lastOpenedProjectId = null,
  activeProjectId = null,
  currentUserId = "",
} = {}) {
  const rows = listedSidebarSharedProjects({
    projects,
    lastOpenedProjectId,
    activeProjectId,
    currentUserId,
    recentsCount: 1,
  });
  return rows[0] || null;
}

/** Team to create into from the Shared Projects popup (last shared context, else fallback). */
export function sharedCreateTeamId({
  projects = [],
  lastOpenedProjectId = null,
  activeProjectId = null,
  currentUserId = "",
  fallbackTeamId = null,
} = {}) {
  const current = currentListedSidebarSharedProject({
    projects,
    lastOpenedProjectId,
    activeProjectId,
    currentUserId,
  });
  return String(current?.team_id || fallbackTeamId || "").trim();
}

export function lastOpenedSidebarProject({
  teams = [],
  projects = [],
  lastOpenedProjectId = null,
  activeProjectId = null,
  personalId = null,
  personalLabel = "Projects",
} = {}) {
  const list = Array.isArray(projects) ? projects : [];
  const wanted = [...new Set(
    [lastOpenedProjectId, activeProjectId]
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  )];
  let project = null;
  for (const id of wanted) {
    const found = list.find((row) => String(row?.id || "") === id);
    if (found && !isCommunityProject(found)) {
      project = found;
      break;
    }
  }
  if (!project) return null;
  const pid = inferPersonalWorkspaceId(teams, personalId);
  const teamId = String(project.team_id || "").trim();
  const team = (teams || []).find((row) => String(row?.id || "") === teamId) || null;
  const personal = !!(pid && (!teamId || teamId === pid));
  const role = String(team?.role || "").toLowerCase();
  const members = Number(team?.member_count ?? team?.members_count ?? 1) || 1;
  const label = looksPersonalName(team)
    ? personalLabel
    : (team?.name || (personal ? personalLabel : "Workspace"));
  return {
    id: String(team?.id || teamId || ""),
    label,
    personal,
    shared: !personal,
    memberCount: members,
    project,
    role,
    canInvite: !!(team?.can_invite || role === "owner" || role === "admin"),
    canManagePerms: role === "owner" || role === "admin",
  };
}

/** Last opened project card for the left WORKSPACES region (not the roster). */
export function activeSidebarWorkspace(opts = {}) {
  return lastOpenedSidebarProject({
    ...opts,
    lastOpenedProjectId: opts.lastOpenedProjectId || opts.activeProjectId,
  });
}

export function projectsForWorkspace(projects = [], workspaceId = null) {
  const wid = workspaceId != null ? String(workspaceId).trim() : "";
  if (!wid) return [];
  return (Array.isArray(projects) ? projects : []).filter(
    (project) => String(project?.team_id || "") === wid,
  );
}

function parseTimeMs(raw) {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw <= 0) return 0;
    return raw < 1e12 ? raw * 1000 : raw;
  }
  const text = String(raw).trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Recency for the Projects list: last opened or last edited, whichever is newer.
 * Folder mtime is a last-resort fallback only — listing a project retouches the
 * directory and must not float old work above newer opens/edits.
 */
export function projectRecencyMs(project = {}) {
  const opened = parseTimeMs(project?.opened_at);
  const updated = parseTimeMs(project?.updated_at);
  const created = parseTimeMs(project?.created_at);
  const newest = Math.max(opened, updated, created);
  return newest || parseTimeMs(project?.mtime);
}

function isLiveGenerating(project = {}, isGenerating) {
  if (typeof isGenerating === "function" && isGenerating(project?.id)) return true;
  return ["running", "queued", "starting", "pending"].includes(project?.generation?.status);
}

/**
 * Sidebar project order (yesterday explorer):
 * - If any sibling has a non-zero drag sort_order, honor that order.
 * - If every sort_order is 0/missing, newest opened/updated/created first.
 */
/**
 * Open = insert-at-top of the same roster (former #1 becomes #2).
 * Never assign over index 0 — that drops the previous first project.
 */
export function promoteOpenedProjectInList(projects, id, openedAt = new Date().toISOString()) {
  const source = Array.isArray(projects) ? projects : [];
  const want = String(id || "").trim();
  if (!want) return source.slice();

  const idx = source.findIndex((project) => String(project?.id) === want);
  const row = idx >= 0
    ? { ...source[idx], opened_at: openedAt }
    : { id, opened_at: openedAt };

  const without = idx >= 0
    ? source.filter((_, i) => i !== idx)
    : source.slice();

  const next = [row, ...without];
  const folderId = row.folder_id ?? null;
  const siblings = next.filter((project) => (project.folder_id ?? null) === folderId);
  const custom = siblings.some((project) => {
    const n = Number(project?.sort_order);
    return Number.isFinite(n) && n !== 0;
  });
  if (custom) {
    siblings.forEach((project, i) => {
      project.sort_order = i;
    });
  }
  return next;
}

export function sortProjectsForDisplay(list, {
  recencyFirst = false,
  isGenerating = null,
} = {}) {
  const items = Array.isArray(list) ? [...list] : [];
  const custom = !recencyFirst && items.some((project) => {
    const n = Number(project?.sort_order);
    return Number.isFinite(n) && n !== 0;
  });
  return items.sort((a, b) => {
    const aLive = isLiveGenerating(a, isGenerating);
    const bLive = isLiveGenerating(b, isGenerating);
    if (aLive !== bLive) return aLive ? -1 : 1;
    const aPin = a?.public_pinned ? 1 : 0;
    const bPin = b?.public_pinned ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    if (custom) {
      const ao = Number(a?.sort_order);
      const bo = Number(b?.sort_order);
      const an = Number.isFinite(ao) ? ao : 0;
      const bn = Number.isFinite(bo) ? bo : 0;
      if (an !== bn) return an - bn;
    }
    const recency = projectRecencyMs(b) - projectRecencyMs(a);
    if (recency) return recency;
    return String(b?.id || "").localeCompare(String(a?.id || ""));
  });
}

/** Newest project in a workspace (updated_at, then created_at). Community folders excluded. */
export function mostRecentProjectForWorkspace(projects = [], workspaceId = null) {
  const list = projectsForWorkspace(projects, workspaceId).filter((project) => !isCommunityProject(project));
  if (!list.length) return null;
  return sortProjectsForDisplay(list, { recencyFirst: true })[0];
}

/**
 * 2D viewport VR / Enter VR: the explorer / current viewport project only.
 * Never last-opened, Unfiled invent, or newest-in-list fallback. Trust the
 * live viewport id even when the cached list has not caught up yet.
 */
export function resolveSelectedProjectIdForXrEnter({
  activeProjectId = null,
  projects = [],
} = {}) {
  void projects;
  return String(activeProjectId || "").trim();
}

/** True when the selected viewport project is already the live XR CAD. */
export function selectedProjectIsInXrScene({
  selectedId = "",
  presentingProjectId = "",
  hasLiveMesh = false,
  presenting = false,
} = {}) {
  if (presenting !== true) return false;
  const sel = String(selectedId || "").trim();
  if (!sel) return false;
  if (String(presentingProjectId || "").trim() !== sel) return false;
  return hasLiveMesh === true;
}

/** Desktop / in-app VR button — selected project, not boot last-opened. */
export function xrViewportEnterPayload({
  activeProjectId = null,
  hasLiveMesh = false,
  projects = [],
} = {}) {
  const projectId = resolveSelectedProjectIdForXrEnter({ activeProjectId, projects });
  return {
    emptyScene: !projectId && hasLiveMesh !== true,
    openMenu: false,
    tour: false,
    fromBoot: false,
    projectId,
  };
}

export const LAST_OPENED_PROJECT_STORAGE_KEY = "render3d:lastProjectId";

/**
 * Headset Enter VR: last opened id, else the active project, else the newest
 * already-fetched project. Never invents an id or creates a project.
 * lastProjectId / the viewport id win even if the explorer cache is stale —
 * dropping them latched emptyScene and skipped the deferred view=open load.
 */
export function resolveLastProjectIdForXrBoot({
  lastOpenedProjectId = null,
  activeProjectId = null,
  projects = [],
} = {}) {
  const last = String(lastOpenedProjectId || "").trim();
  if (last) return last;
  const active = String(activeProjectId || "").trim();
  if (active) return active;
  const list = Array.isArray(projects) ? projects : [];
  const usable = list.filter((project) => String(project?.id || "").trim() && !isCommunityProject(project));
  if (!usable.length) return "";
  return String(sortProjectsForDisplay(usable, { recencyFirst: true })[0]?.id || "").trim();
}

/** Boot XR enter flags: attach a real project id when one exists; empty room only as fallback or tour. */
export function xrBootEnterPayload({
  lastOpenedProjectId = null,
  activeProjectId = null,
  projects = [],
  tour = false,
} = {}) {
  const projectId = resolveLastProjectIdForXrBoot({
    lastOpenedProjectId,
    activeProjectId,
    projects,
  });
  return {
    emptyScene: !!tour || !projectId,
    openMenu: true,
    tour: !!tour,
    fromBoot: true,
    projectId,
  };
}

/** Remix / document tabs use `#viewport`. Enter VR must never treat that as immersive enter. */
export function xrEnterShouldNavigateToViewportHash() {
  return false;
}

/** Always request a WebXR session — hash / data-shell-tab=viewport is desktop chrome only. */
export function resolveXrEnterSessionIntent({ hash = "", shellTab = "" } = {}) {
  void hash;
  void shellTab;
  return "requestSession";
}

/** Open (or finish loading) the last project after requestSession — same id without a mesh still needs a load. */
export function xrEnterNeedsDeferredOpen({
  projectId = "",
  activeProjectId = "",
  hasLiveMesh = false,
  emptyScene = false,
} = {}) {
  if (emptyScene === true) return false;
  const id = String(projectId || "").trim();
  if (!id) return false;
  if (String(activeProjectId || "").trim() !== id) return true;
  return hasLiveMesh !== true;
}

const PROJECTS_LIST_CACHE_PREFIX = "render3d:projects-list-cache:v1:";

export function slimProjectForCache(project = {}) {
  const gen = project.generation && typeof project.generation === "object" ? project.generation : {};
  const generation = gen.status
    ? {
        status: gen.status,
        kind: gen.kind,
        progress: gen.progress,
        by_user_name: gen.by_user_name,
        running_count: gen.running_count,
      }
    : undefined;
  return {
    id: project.id,
    name: project.name,
    team_id: project.team_id || null,
    folder_id: project.folder_id ?? null,
    folder_name: project.folder_name ?? null,
    sort_order: Number(project.sort_order) || 0,
    updated_at: project.updated_at || null,
    opened_at: project.opened_at || null,
    created_at: project.created_at || null,
    mtime: project.mtime || null,
    file_count: project.file_count || 0,
    owner_user_id: project.owner_user_id || "",
    owner_name: project.owner_name || "",
    public: !!project.public,
    shared_with_me: !!project.shared_with_me,
    shared_by_me: !!project.shared_by_me,
    share_count: Number(project.share_count) || 0,
    read_only_project: !!project.read_only_project,
    shared_workspace_folder: !!project.shared_workspace_folder,
    generation,
  };
}

export function readCachedProjectList(userId, storage) {
  const uid = String(userId || "").trim();
  if (!uid) return [];
  let store = storage;
  if (!store) {
    try { store = globalThis.localStorage; } catch { return []; }
  }
  if (!store?.getItem) return [];
  try {
    const parsed = JSON.parse(store.getItem(PROJECTS_LIST_CACHE_PREFIX + uid) || "null");
    const list = Array.isArray(parsed?.projects) ? parsed.projects : [];
    return list.filter((row) => row && row.id);
  } catch {
    return [];
  }
}

export function writeCachedProjectList(userId, projects, storage) {
  const uid = String(userId || "").trim();
  if (!uid) return false;
  let store = storage;
  if (!store) {
    try { store = globalThis.localStorage; } catch { return false; }
  }
  if (!store?.setItem) return false;
  try {
    const slim = (Array.isArray(projects) ? projects : []).map(slimProjectForCache).filter((row) => row.id);
    store.setItem(PROJECTS_LIST_CACHE_PREFIX + uid, JSON.stringify({ savedAt: Date.now(), projects: slim }));
    return true;
  } catch {
    return false;
  }
}

export function foldersForWorkspace(folders = [], workspaceId = null) {
  const wid = workspaceId != null ? String(workspaceId).trim() : "";
  if (!wid) return [];
  return (Array.isArray(folders) ? folders : []).filter((folder) => {
    if (!folder || folder.public || folder.virtual && (folder.id === "__public__" || folder.id === "__other_user_renders__")) {
      return false;
    }
    const id = String(folder.id || "");
    if (id === "__public__" || id === "__other_user_renders__" || id === "__archive__") return false;
    if (folder.team_id) return String(folder.team_id) === wid;
    if (id.startsWith("__shared_ws_")) return id.slice("__shared_ws_".length) === wid;
    return false;
  });
}
