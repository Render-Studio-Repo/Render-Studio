/** Shared Projects popup — thumbnails, pin, share/invite, sidebar recents. */

import {
  clampSharedRecentsCount,
  loadSharedSidebarPrefs,
  normalizeSharePermission,
  partitionSharedProjects,
  saveSharedSidebarPrefs,
  SHARE_PERMISSIONS,
  sharePermissionLabel,
  sharedCreateTeamId,
  sharedProjectPreviewUrl,
} from "./workspace-list.js?v=20260908-projsearch1-shared1-20260915-shareui1";

const MODAL_ID = "shared-projects-modal";
export const SHARE_SEARCH_DEBOUNCE_MS = 220;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function $(id) {
  return document.getElementById(id);
}

function modal() {
  return $(MODAL_ID);
}

function setStatus(text, err = false) {
  const el = $("shared-projects-status");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-error", !!err);
}

let boundOpts = {};
let bound = false;
let invites = [];
let sharedInvitesAbort = null; // leakfix80
function beginSharedInvitesFetch() {
  if (sharedInvitesAbort) {
    try { sharedInvitesAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  sharedInvitesAbort = ctl;
  return ctl;
}
let panel = "list";
let collection = "shared";
let detailsPeople = [];
let searchGeneration = 0;
let shareBusy = false;
let shareErrors = new Map();
let detailsProjectId = "";
let shareCache = new Map();
let shareIndexSkip = new Set();
let searchTimer = 0;
let peopleIndexTimer = 0;
let peopleIndexGen = 0;
let searchHits = [];
let searchQuery = "";
let listFilterQuery = "";
let friends = [];
let friendsLoaded = false;
let createDraft = { name: "", permission: "viewer", people: [] };
let detailsQuery = "";
let thumbObserver = null;
let detailsLoading = false;

export function notifySharedSidebarChanged() {
  try {
    document.dispatchEvent(new CustomEvent("render3d:shared-sidebar-changed"));
  } catch {
    /* ignore */
  }
}

function currentUserId() {
  return String(boundOpts.getCurrentUserId?.() || "");
}

function prefs() {
  return loadSharedSidebarPrefs(currentUserId());
}

function writePrefs(patch) {
  const next = saveSharedSidebarPrefs(currentUserId(), { ...prefs(), ...patch });
  notifySharedSidebarChanged();
  return next;
}

function isPinned(projectId) {
  return prefs().pinnedIds.includes(String(projectId || ""));
}

export function canManageSharedProject(project = {}, me = "") {
  return !!me && (String(project.owner_user_id || project.created_by || "") === String(me) || !!project.shared_by_me);
}

function canManageProject(project = {}) {
  return canManageSharedProject(project, currentUserId());
}

function permissionSelectHtml(selected = "viewer", name = "shared-perm") {
  return `
    <select class="shared-projects-perm" data-shared-perm-select="${esc(name)}" aria-label="Permission">
      ${SHARE_PERMISSIONS.map((row) => `
        <option value="${esc(row.id)}" ${normalizeSharePermission(selected) === row.id ? "selected" : ""} title="${esc(row.hint)}">${esc(row.label)}</option>
      `).join("")}
    </select>
  `;
}

export function personQueryMatches(person = {}, query = "") {
  const q = String(query || "").trim().toLowerCase().replace(/^@+/, "");
  if (!q) return false;
  const blob = [
    person.display_name,
    person.email,
    person.handle,
    person.handle_label,
    person.id,
    person.user_id,
    person.name,
    person.inviter_name,
    person.by,
  ].filter(Boolean).join(" ").toLowerCase();
  return blob.includes(q);
}

export function friendIdsMatchingQuery(people = [], query = "") {
  return (Array.isArray(people) ? people : [])
    .filter((row) => personQueryMatches(row, query))
    .map((row) => String(row.id || row.user_id || ""))
    .filter(Boolean);
}

export function sharedProjectMatchesQuery(project = {}, {
  query = "",
  sharePeople = null,
  friendIds = [],
} = {}) {
  const q = String(query || "").trim().toLowerCase().replace(/^@+/, "");
  if (!q) return true;
  if (String(project.name || "").toLowerCase().includes(q)) return true;
  const ownerBlob = [
    project.owner_name,
    project.owner_email,
    project.owner_user_id,
  ].filter(Boolean).join(" ").toLowerCase();
  if (ownerBlob.includes(q)) return true;
  const ownerId = String(project.owner_user_id || "");
  if (ownerId && friendIds.includes(ownerId)) return true;
  const payload = sharePeople || {};
  for (const row of [...(payload.shares || []), ...(payload.pending || [])]) {
    if (personQueryMatches(row, q)) return true;
    const uid = String(row.user_id || row.id || "");
    if (uid && friendIds.includes(uid)) return true;
  }
  return false;
}

export function shareableProjects(projects = [], userId = "", query = "") {
  return projects.filter((p) => canManageSharedProject(p, userId)
    && sharedProjectMatchesQuery(p, { query }));
}

export function sharedProjectRowHtml(project = {}, { kind = "with-me", pinned = false, view = "list" } = {}) {
  const owner = project.owner_name || project.owner_email || (kind === "by-me" ? "You" : "Shared");
  const shares = Number(project.share_count || 0);
  const meta = kind === "by-me" || kind === "mine"
    ? (shares ? `Shared with ${shares}` : "Shared by you")
    : (owner ? `From ${owner}` : "Shared with you");
  const thumb = sharedProjectPreviewUrl(project);
  const manage = kind === "by-me" || kind === "mine" || !!project.shared_by_me;
  const grid = view === "grid";
  return `
    <article class="ws-hub-card shared-projects-card ${grid ? "shared-projects-card--grid" : "ws-hub-card--row"}" data-shared-project="${esc(project.id)}" ${pinned ? "data-pinned=\"1\"" : ""} title="Open project">
      <div class="shared-projects-thumb" aria-hidden="true">
        <img class="shared-projects-thumb-img" alt="" width="72" height="72" sizes="72px" decoding="async" loading="lazy" data-thumb-src="${esc(thumb)}">
      </div>
      <div class="shared-projects-card-copy">
        <strong>${esc(project.name || "Untitled")}</strong>
        <span class="ws-hub-pill">${kind === "mine" ? (project.public ? "🌐 Public" : "Your project") : kind === "by-me" ? "Shared by me" : "Shared with me"}</span>
        <p class="muted small">${esc(meta)}</p>
      </div>
      <div class="ws-hub-card-actions">
        <button type="button" class="btn-icon shared-projects-pin${pinned ? " is-pinned" : ""}" data-shared-pin="${esc(project.id)}" aria-pressed="${pinned ? "true" : "false"}" title="Pin this project" aria-label="Pin this project">📌</button>
        ${manage ? `<button type="button" class="btn secondary btn-compact" data-shared-share="${esc(project.id)}">${kind === "mine" && !shares ? "Share" : "Manage access"}</button>` : ""}
        ${!manage ? `<button type="button" class="btn secondary btn-compact" data-shared-details="${esc(project.id)}">Access</button>` : ""}
        <button type="button" class="btn secondary btn-compact" data-shared-open="${esc(project.id)}">Open</button>
      </div>
    </article>
  `;
}

export function renderSharedProjectsBody({
  projects = [],
  currentUserId = "",
  pendingInvites = [],
  view = "list",
  pinnedIds = [],
  query = "",
  sharePeopleByProject = {},
  friends: friendRows = [],
  collection = "shared",
} = {}) {
  const q = String(query || "").trim();
  if (collection === "mine") {
    const mine = shareableProjects(projects, currentUserId, q);
    return `<div class="shared-projects-tree"><h4>Choose a project to share</h4>
      <div class="shared-projects-section ${view === "grid" ? "shared-projects-grid" : ""}">
        ${mine.map((p) => sharedProjectRowHtml(p, { kind: "mine", view, pinned: pinnedIds.includes(String(p.id)) })).join("")
          || `<p class="muted small">${q ? "No projects match your search." : "Create a project to start sharing."}</p>`}
      </div></div>`;
  }
  const friendIds = q ? friendIdsMatchingQuery(friendRows, q) : [];
  const { withMe: allWithMe, byMe: allByMe } = partitionSharedProjects({ projects, currentUserId });
  const matchProject = (project) => sharedProjectMatchesQuery(project, {
    query: q,
    sharePeople: sharePeopleByProject[String(project.id)] || null,
    friendIds,
  });
  const withMe = allWithMe.filter(matchProject);
  const byMe = allByMe.filter(matchProject);
  const pendingAll = Array.isArray(pendingInvites) ? pendingInvites : [];
  const pending = q
    ? pendingAll.filter((inv) => (
      String(inv.project_name || "").toLowerCase().includes(q.toLowerCase())
      || personQueryMatches(inv, q)
    ))
    : pendingAll;
  const empty = !withMe.length && !byMe.length && !pending.length;
  const pinSet = new Set((pinnedIds || []).map((id) => String(id)));
  const noneWith = q ? "No matches in Shared with me." : "Nothing shared with you yet.";
  const noneBy = q ? "No matches in Shared by me." : "You have not shared a project yet.";
  return `
    <div class="ws-hub-tree shared-projects-tree shared-projects-tree--${view === "grid" ? "grid" : "list"}">
      ${
        pending.length
          ? `<h4>Pending invites</h4>${pending.map((inv) => `
              <article class="ws-hub-card ws-hub-card--row">
                <div>
                  <strong>${esc(inv.project_name || "Shared project")}</strong>
                  <span class="ws-hub-pill">Invite</span>
                  <p class="muted small">${esc(inv.inviter_name || inv.by || "Someone")} invited you</p>
                </div>
              </article>`).join("")}`
          : ""
      }
      <h4>Shared with me</h4>
      <div class="shared-projects-section ${view === "grid" ? "shared-projects-grid" : ""}">
        ${withMe.length ? withMe.map((p) => sharedProjectRowHtml(p, { kind: "with-me", pinned: pinSet.has(String(p.id)), view })).join("") : `<p class="muted small">${esc(noneWith)}</p>`}
      </div>
      <h4>Shared by me</h4>
      <div class="shared-projects-section ${view === "grid" ? "shared-projects-grid" : ""}">
        ${byMe.length ? byMe.map((p) => sharedProjectRowHtml(p, { kind: "by-me", pinned: pinSet.has(String(p.id)), view })).join("") : `<p class="muted small">${esc(noneBy)}</p>`}
      </div>
      ${empty ? `<p class="muted small">${q ? "No shared projects match that search." : "Share a project from its row, or accept an invite, to see it here."}</p>` : ""}
    </div>
  `;
}

function observeThumbs(root) {
  if (!root) return;
  try { thumbObserver?.disconnect?.(); } catch { /* ignore */ }
  const imgs = [...root.querySelectorAll("img[data-thumb-src]")];
  const assign = (img) => {
    const src = img.getAttribute("data-thumb-src");
    if (!src || img.getAttribute("src") === src) return;
    img.src = src;
    img.removeAttribute("data-thumb-src");
  };
  if (typeof IntersectionObserver !== "function") {
    imgs.forEach(assign);
    return;
  }
  const host = root.closest(".ws-hub-body") || root;
  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        assign(entry.target);
        thumbObserver.unobserve(entry.target);
      }
    },
    { root: host, rootMargin: "80px 0px", threshold: 0.01 },
  );
  imgs.forEach((img) => thumbObserver.observe(img));
}

function syncViewButtons() {
  const view = prefs().view === "grid" ? "grid" : "list";
  modal()?.querySelectorAll("[data-shared-view]").forEach((btn) => {
    const on = btn.getAttribute("data-shared-view") === view;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function sharePeopleMap() {
  const map = {};
  for (const [id, payload] of shareCache.entries()) {
    map[id] = payload;
  }
  return map;
}

function syncListFilterChrome() {
  const input = $("shared-projects-filter");
  const wrap = input?.closest(".shared-projects-filter");
  if (input && document.activeElement !== input) input.value = listFilterQuery;
  wrap?.classList.toggle("hidden", panel !== "list");
  modal()?.querySelector(".shared-projects-toolbar")?.classList.toggle("hidden", panel !== "list");
  modal()?.querySelector(".shared-projects-navigation")?.classList.toggle("hidden", panel !== "list");
  modal()?.querySelectorAll("[data-shared-collection]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.sharedCollection === collection));
  });
  const active = (boundOpts.getProjects?.() || []).find((p) => String(p.id) === String(boundOpts.getActiveProjectId?.() || ""));
  const current = $("btn-share-current-project");
  if (current) {
    current.disabled = !active;
    current.textContent = active && !canManageProject(active) ? "Current project access" : "Share current project";
    current.title = active ? active.name || "Current project" : "Open or save a project first";
  }
}

function renderListPanel() {
  const body = $("shared-projects-body");
  if (!body) return;
  body.innerHTML = renderSharedProjectsBody({
    projects: boundOpts.getProjects?.() || [],
    currentUserId: currentUserId(),
    pendingInvites: invites,
    view: prefs().view,
    pinnedIds: prefs().pinnedIds,
    query: listFilterQuery,
    sharePeopleByProject: sharePeopleMap(),
    friends,
    collection,
  });
  observeThumbs(body);
  syncViewButtons();
  syncListFilterChrome();
}

async function loadShareListQuiet(projectId) {
  const id = String(projectId || "");
  if (!id || !boundOpts.api) return { shares: [], pending: [] };
  if (shareCache.has(id)) return shareCache.get(id);
  if (shareIndexSkip.has(id)) return { shares: [], pending: [] };
  try {
    const data = await boundOpts.api(`/api/projects/${encodeURIComponent(id)}/shares`);
    const payload = {
      shares: data?.shares || [],
      pending: data?.pending || [],
    };
    shareErrors.delete(id);
    shareCache.set(id, payload);
    return payload;
  } catch {
    shareIndexSkip.add(id);
    return { shares: [], pending: [] };
  }
}

async function ensurePeopleIndex() {
  const q = String(listFilterQuery || "").trim();
  if (!q || panel !== "list") return;
  const gen = ++peopleIndexGen;
  if (!friendsLoaded && boundOpts.api) {
    friendsLoaded = true;
    try {
      const data = await boundOpts.api("/api/social/friends");
      friends = data?.people || data?.friends || [];
    } catch {
      friends = [];
    }
  }
  if (gen !== peopleIndexGen) return;
  const { byMe } = partitionSharedProjects({
    projects: boundOpts.getProjects?.() || [],
    currentUserId: currentUserId(),
  });
  const missing = byMe.filter((project) => (
    canManageProject(project) && !shareCache.has(String(project.id || ""))
  ));
  const batch = missing.slice(0, 40);
  if (batch.length) {
    await Promise.all(batch.map((project) => loadShareListQuiet(project.id)));
  }
  if (gen !== peopleIndexGen || panel !== "list") return;
  paintBody();
}

function schedulePeopleIndex() {
  clearTimeout(peopleIndexTimer);
  if (!String(listFilterQuery || "").trim()) return;
  peopleIndexTimer = setTimeout(() => {
    void ensurePeopleIndex();
  }, SHARE_SEARCH_DEBOUNCE_MS);
}

function peopleChipHtml(person) {
  return `
    <span class="shared-projects-chip" data-chip="${esc(person.key)}">
      ${esc(person.label)}
      <small>${esc(sharePermissionLabel(person.role))}</small>
      <button type="button" class="btn-icon" data-remove-chip="${esc(person.key)}" aria-label="Remove">×</button>
    </span>
  `;
}

function renderHitsHtml(hits, { forDetails = false } = {}) {
  if (!hits.length) {
    if (searchQuery.trim() && !/^\s*$/.test(searchQuery)) {
      return `<p class="muted small">No people or teams match. Use a full email to invite a new user.</p>`;
    }
    return "";
  }
  return `
    <div class="shared-projects-hits" role="listbox">
      ${hits.map((hit) => `
        <button type="button" class="shared-projects-hit" role="option" data-hit-kind="${esc(hit.kind)}" data-hit-id="${esc(hit.id || "")}" data-hit-email="${esc(hit.email || "")}" data-hit-label="${esc(hit.label)}" ${forDetails ? "data-details-hit=1" : "data-create-hit=1"}>
          <strong>${esc(hit.label)}</strong>
          <span class="muted small">${esc(hit.subtitle || hit.kind)}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderCreatePanel() {
  const body = $("shared-projects-body");
  if (!body) return;
  body.innerHTML = `
    <div class="shared-projects-create">
      <div class="shared-projects-panel-head">
        <button type="button" class="btn secondary btn-compact" data-shared-back>Back</button>
        <h3>Create project</h3>
        <button type="button" class="btn-icon shared-projects-more" data-shared-create-details title="Project details" aria-label="Project details">⋯</button>
      </div>
      <label class="app-dialog-label" for="shared-create-name">Name</label>
      <input type="text" id="shared-create-name" maxlength="120" placeholder="Untitled project" value="${esc(createDraft.name)}" />
      <label class="app-dialog-label" for="shared-create-search">Invite people</label>
      <p class="muted small">Search @handles, emails, or teams. New users get an email invite.</p>
      <div class="shared-projects-invite-row">
        <input type="search" id="shared-create-search" placeholder="Search people, @handle, teams, or email…" autocomplete="off" spellcheck="false" value="${esc(searchQuery)}" />
        ${permissionSelectHtml(createDraft.permission, "create")}
      </div>
      <div id="shared-create-hits">${renderHitsHtml(searchHits)}</div>
      <div class="shared-projects-chips" id="shared-create-chips">
        ${createDraft.people.length ? createDraft.people.map(peopleChipHtml).join("") : `<p class="muted small">No one invited yet.</p>`}
      </div>
      <div class="app-dialog-actions">
        <button type="button" class="btn accent" data-shared-create-submit>Create project</button>
      </div>
    </div>
  `;
  $("shared-create-name")?.addEventListener("input", (e) => {
    createDraft.name = e.target.value || "";
  });
  $("shared-create-search")?.addEventListener("input", (e) => {
    searchQuery = e.target.value || "";
    scheduleSearch({ forDetails: false });
  });
  body.querySelector("[data-shared-perm-select]")?.addEventListener("change", (e) => {
    createDraft.permission = normalizeSharePermission(e.target.value);
  });
}

export function detailsPeopleHtml(data, { manage = true, query = "" } = {}) {
  const shares = data?.shares || [];
  const pending = data?.pending || [];
  const q = query.trim().toLowerCase();
  const match = (row) => {
    if (!q) return true;
    const blob = `${row.display_name || ""} ${row.email || ""} ${row.handle || ""}`.toLowerCase();
    return blob.includes(q);
  };
  const people = [
    ...shares.filter(match).map((s) => ({
      kind: "active",
      id: s.user_id,
      title: s.display_name || s.email,
      subtitle: [s.handle ? `@${s.handle}` : "", s.email].filter(Boolean).join(" · "),
      role: normalizeSharePermission(s.role),
    })),
    ...pending.filter(match).map((p) => ({
      kind: "pending",
      id: p.id,
      title: p.email,
      subtitle: "Invite pending",
      role: normalizeSharePermission(p.role),
    })),
  ];
  if (!people.length) {
    return `<p class="muted small">${q ? "No people match that search." : "Not shared yet."}</p>`;
  }
  return people.map((item) => `
    <div class="shared-projects-person" data-kind="${item.kind}">
      <div class="shared-projects-person-copy">
        <strong>${esc(item.title)}</strong>
        <small>${esc(item.subtitle || "")}</small>
      </div>
      ${manage ? `${permissionSelectHtml(item.role, `${item.kind}:${item.id}`)}
      <button type="button" class="btn secondary btn-compact" data-remove-person="${esc(item.id)}" data-remove-kind="${item.kind}">${item.kind === "pending" ? "Cancel invite" : "Remove"}</button>` : `<span>${esc(sharePermissionLabel(item.role))}</span>`}
    </div>
  `).join("");
}

function renderDetailsPanel(project, data) {
  const body = $("shared-projects-body");
  if (!body) return;
  const manage = canManageProject(project);
  body.innerHTML = `
    <div class="shared-projects-details">
      <div class="shared-projects-panel-head">
        <button type="button" class="btn secondary btn-compact" data-shared-back>Back</button>
        <h3>Manage access</h3>
      </div>
      <div class="shared-projects-details-hero">
        <div class="shared-projects-thumb" aria-hidden="true">
          <img class="shared-projects-thumb-img" alt="" width="72" height="72" sizes="72px" decoding="async" loading="lazy" data-thumb-src="${esc(sharedProjectPreviewUrl(project))}">
        </div>
        <div>
          <strong>${esc(project.name || "Untitled")}</strong>
          <p class="muted small">${esc(project.owner_name || project.owner_email || "Shared project")}</p>
        </div>
      </div>
      ${manage ? `
        <label class="app-dialog-label" for="shared-details-search">Share with people</label>
        <div class="shared-projects-invite-row">
          <input type="search" id="shared-details-search" placeholder="Search name, @handle, or email…" autocomplete="off" spellcheck="false" value="${esc(searchQuery)}" />
          ${permissionSelectHtml(createDraft.permission, "details")}
        </div>
        <div id="shared-details-hits">${renderHitsHtml(searchHits, { forDetails: true })}</div>
        <div class="shared-projects-chips">${detailsPeople.map(peopleChipHtml).join("")}</div>
        <button type="button" class="btn accent" data-shared-invite-submit ${!detailsPeople.length || shareBusy ? "disabled" : ""}>${shareBusy ? "Sharing…" : `Share with ${detailsPeople.length || "selected"} ${detailsPeople.length === 1 ? "person" : "people"}`}</button>
        <p class="muted small">View only, remix only, or remix and edit. New users receive an invitation.</p>
      ` : `<p class="muted small">Only the owner can change who this is shared with.</p>`}
      <h4>People with access</h4>
      <div class="shared-projects-person"><div class="shared-projects-person-copy"><strong>${esc(project.owner_name || project.owner_email || "Project owner")}</strong><small>Owner</small></div></div>
      ${project.public ? '<p class="muted small">🌐 Public project — anyone can view it. Removing direct access does not make it private.</p>' : ""}
      ${project.team_id ? '<p class="muted small">Workspace access is managed separately. Removing someone below removes their direct project access.</p>' : ""}
      ${manage ? `<label class="app-dialog-label" for="shared-members-search">Search people with access</label>
      <input type="search" id="shared-members-search" placeholder="Filter members and pending invites…" value="${esc(detailsQuery)}" />
      <div id="shared-details-people">${detailsLoading ? `<p class="muted small">Loading…</p>` : shareErrors.has(String(project.id)) ? '<p class="muted small">Could not load access. <button type="button" class="btn secondary btn-compact" data-shared-retry>Retry</button></p>' : renderDetailsPeople(data)}</div>` : '<p class="muted small">Ask the owner to invite people or update permissions.</p>'}
    </div>
  `;
  observeThumbs(body);
  $("shared-details-search")?.addEventListener("input", (e) => {
    searchQuery = e.target.value || "";
    scheduleSearch({ forDetails: true });
  });
  $("shared-members-search")?.addEventListener("input", (e) => {
    detailsQuery = e.target.value;
    const host = $("shared-details-people");
    if (host && !detailsLoading && !shareErrors.has(String(project.id))) host.innerHTML = renderDetailsPeople(data);
  });
  body.querySelector("[data-shared-perm-select='details']")?.addEventListener("change", (e) => {
    createDraft.permission = normalizeSharePermission(e.target.value);
  });
}

function renderDetailsPeople(data) {
  return detailsPeopleHtml(data, { query: detailsQuery });
}

function paintBody() {
  if (panel === "create") {
    renderCreatePanel();
    syncListFilterChrome();
    return;
  }
  if (panel === "details") {
    const project = (boundOpts.getProjects?.() || []).find((p) => String(p.id) === String(detailsProjectId))
      || { id: detailsProjectId, name: "Project" };
    renderDetailsPanel(project, shareCache.get(String(detailsProjectId)) || { shares: [], pending: [] });
    syncListFilterChrome();
    return;
  }
  renderListPanel();
}

async function refreshInvites() {
  if (!boundOpts.api) return;
  const ctl = beginSharedInvitesFetch();
  try {
    const data = await boundOpts.api("/api/me/project-share-invites", { signal: ctl.signal });
    if (ctl.signal.aborted) return;
    invites = data?.invites || [];
  } catch (err) {
    if (ctl.signal.aborted || err?.name === "AbortError") return;
    invites = [];
  } finally {
    if (sharedInvitesAbort === ctl) sharedInvitesAbort = null;
  }
}

function createTeamId() {
  return sharedCreateTeamId({
    projects: boundOpts.getProjects?.() || [],
    lastOpenedProjectId: boundOpts.getLastOpenedProjectId?.() || null,
    activeProjectId: boundOpts.getActiveProjectId?.() || null,
    currentUserId: currentUserId(),
    fallbackTeamId: boundOpts.getFallbackTeamId?.() || null,
  });
}

function looksEmail(value) {
  const raw = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

function filterTeams(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  return (boundOpts.getTeams?.() || [])
    .filter((team) => String(team?.name || "").toLowerCase().includes(q))
    .slice(0, 6)
    .map((team) => ({
      kind: "team",
      id: team.id,
      label: team.name || "Workspace",
      subtitle: "Team",
    }));
}

async function runSearch(query, { forDetails = false } = {}) {
  const q = String(query || "").trim();
  const generation = ++searchGeneration;
  searchHits = forDetails ? [] : filterTeams(q);
  if (!q) {
    paintHits(forDetails);
    return;
  }
  if (!boundOpts.api) {
    if (looksEmail(q)) {
      searchHits.push({
        kind: "email",
        id: "",
        email: q,
        label: q,
        subtitle: "Invite new user",
      });
    }
    paintHits(forDetails);
    return;
  }
  try {
    const teamId = createTeamId();
    const qs = new URLSearchParams({ q });
    if (teamId) qs.set("team_id", teamId);
    const result = await boundOpts.api(`/api/teams/invite-lookup?${qs.toString()}`);
    if (generation !== searchGeneration || q !== searchQuery.trim()) return;
    const matches = result?.matches || (result?.user ? [result.user] : []) || [];
    for (const user of matches) {
      searchHits.push({
        kind: "user",
        id: user.id,
        email: user.email || "",
        label: user.display_name || user.handle_label || user.email || "User",
        subtitle: [user.handle ? `@${user.handle}` : "", user.email].filter(Boolean).join(" · ") || "User",
      });
    }
    if (!matches.length && looksEmail(q)) {
      searchHits.push({
        kind: "email",
        id: "",
        email: q,
        label: q,
        subtitle: "Invite new user",
      });
    }
  } catch {
    if (generation !== searchGeneration || q !== searchQuery.trim()) return;
    if (looksEmail(q)) {
      searchHits.push({
        kind: "email",
        id: "",
        email: q,
        label: q,
        subtitle: "Invite new user",
      });
    }
  }
  paintHits(forDetails);
}

function paintHits(forDetails) {
  const host = forDetails ? $("shared-details-hits") : $("shared-create-hits");
  if (!host) return;
  host.innerHTML = renderHitsHtml(searchHits, { forDetails });
}

function scheduleSearch({ forDetails = false } = {}) {
  clearTimeout(searchTimer);
  searchGeneration += 1;
  searchHits = [];
  paintHits(forDetails);
  searchTimer = setTimeout(() => {
    void runSearch(searchQuery, { forDetails });
  }, SHARE_SEARCH_DEBOUNCE_MS);
}

function addDraftPerson(hit, role) {
  const key = hit.kind === "team" ? `team:${hit.id}` : `user:${String(hit.email || hit.id || hit.label).toLowerCase()}`;
  if (createDraft.people.some((row) => row.key === key)) return;
  createDraft.people.push({
    key,
    kind: hit.kind,
    id: hit.id,
    email: hit.email || "",
    label: hit.label,
    role: normalizeSharePermission(role || createDraft.permission),
  });
}

async function loadShareList(projectId, { force = false } = {}) {
  const id = String(projectId || "");
  if (!id || !boundOpts.api) return { shares: [], pending: [] };
  if (!force && shareCache.has(id)) return shareCache.get(id);
  detailsLoading = true;
  paintBody();
  try {
    const data = await boundOpts.api(`/api/projects/${encodeURIComponent(id)}/shares`);
    const payload = {
      shares: data?.shares || [],
      pending: data?.pending || [],
    };
    shareErrors.delete(id);
    shareCache.set(id, payload);
    return payload;
  } catch (err) {
    setStatus(err.message || "Could not load project details.", true);
    const empty = { shares: [], pending: [] };
    shareErrors.set(id, true);
    return empty;
  } finally {
    detailsLoading = false;
    if (panel === "details" && String(detailsProjectId) === id) paintBody();
  }
}

async function openDetails(projectId) {
  detailsProjectId = String(projectId || "");
  panel = "details";
  searchQuery = "";
  detailsQuery = "";
  searchHits = [];
  detailsPeople = [];
  searchGeneration += 1;
  clearTimeout(searchTimer);
  setStatus("");
  const project = (boundOpts.getProjects?.() || []).find((p) => String(p.id) === detailsProjectId);
  if (!canManageProject(project)) { detailsLoading = false; paintBody(); return; }
  if (!shareCache.has(detailsProjectId)) {
    detailsLoading = true;
    paintBody();
    await loadShareList(detailsProjectId);
  } else {
    paintBody();
  }
}

function openCreate() {
  clearTimeout(searchTimer);
  searchGeneration += 1;
  panel = "create";
  searchQuery = "";
  searchHits = [];
  setStatus("");
  paintBody();
}

function openList() {
  clearTimeout(searchTimer);
  searchGeneration += 1;
  panel = "list";
  detailsProjectId = "";
  searchQuery = "";
  searchHits = [];
  setStatus("");
  paintBody();
}

async function shareWithHit(projectId, hit, role) {
  if (!projectId || !boundOpts.api) return;
  const perm = normalizeSharePermission(role || createDraft.permission);
  if (hit.kind === "team" && hit.id) {
    await boundOpts.api(`/api/projects/${encodeURIComponent(projectId)}/workspace`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team_id: hit.id }),
    });
    setStatus(`Saved to ${hit.label}.`);
    await Promise.resolve(boundOpts.onProjectsChanged?.()).catch(() => {});
    return;
  }
  const email = hit.email || (looksEmail(hit.label) ? hit.label : "");
  const handle = !email && hit.label ? hit.label : "";
  await boundOpts.api(`/api/projects/${encodeURIComponent(projectId)}/shares`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email || handle, role: perm }),
  });
  shareCache.delete(String(projectId));
  await Promise.resolve(boundOpts.onProjectsChanged?.()).catch(() => {});
}

async function submitCreate() {
  setStatus("Creating…");
  try {
    const teamId = createTeamId();
    const name = String(createDraft.name || "").trim();
    const project = await boundOpts.onCreateSharedProject?.(teamId, name);
    if (!project?.id) throw new Error("Could not create project");
    const failedInvites = [];
    for (const person of createDraft.people) {
      try {
        await shareWithHit(project.id, person, person.role);
      } catch (err) {
        failedInvites.push({ person, message: err.message });
      }
    }
    createDraft = { name: "", permission: "viewer", people: [] };
    await refreshInvites();
    await openDetails(project.id);
    detailsPeople = failedInvites.map((f) => f.person);
    paintBody();
    setStatus(failedInvites.length ? `Project created; ${failedInvites.length} invites failed. Retry the selected people.` : "Project created.", !!failedInvites.length);
  } catch (err) {
    setStatus(err.message || "Could not create project.", true);
  }
}

async function submitDetailsInvites() {
  if (shareBusy || !detailsPeople.length) return;
  const id = detailsProjectId;
  const selected = [...detailsPeople];
  shareBusy = true;
  paintBody();
  const failures = [];
  for (const person of selected) {
    try { await shareWithHit(id, person, person.role); }
    catch (err) { failures.push({ person, message: err.message }); }
  }
  shareBusy = false;
  if (detailsProjectId !== id || panel !== "details") return;
  detailsPeople = failures.map((f) => f.person);
  await loadShareList(id, { force: true });
  setStatus(failures.length ? `${selected.length - failures.length} shared; ${failures.length} failed. ${failures[0].message || "Try again."}` : "Project shared. Access list updated.", !!failures.length);
}

async function changePersonRole(kind, id, role) {
  const projectId = detailsProjectId;
  if (!projectId || !boundOpts.api) return;
  const perm = normalizeSharePermission(role);
  const path = kind === "pending"
    ? `/api/projects/${encodeURIComponent(projectId)}/share-invites/${encodeURIComponent(id)}`
    : `/api/projects/${encodeURIComponent(projectId)}/shares/${encodeURIComponent(id)}`;
  await boundOpts.api(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: perm }),
  });
  shareCache.delete(String(projectId));
  await loadShareList(projectId, { force: true });
}

async function removePerson(kind, id) {
  const projectId = detailsProjectId;
  if (!projectId || !boundOpts.api || !id) return;
  if (kind === "pending") {
    await boundOpts.api(`/api/projects/${encodeURIComponent(projectId)}/share-invites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } else {
    if (!window.confirm("Remove this person’s access?")) return;
    await boundOpts.api(`/api/projects/${encodeURIComponent(projectId)}/shares/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  shareCache.delete(String(projectId));
  await Promise.resolve(boundOpts.onProjectsChanged?.()).catch(() => {});
  await loadShareList(projectId, { force: true });
}

function togglePin(projectId) {
  const id = String(projectId || "");
  if (!id) return;
  modal()?.querySelector(".shared-pin-chooser")?.remove();
  const current = prefs();
  const sideOn = current.pinnedIds.includes(id);
  const tabOn = (current.tabPinnedIds || []).includes(id);
  const pop = document.createElement("div");
  pop.className = "shared-pin-chooser";
  pop.innerHTML = `
    <strong>Pin “${esc((boundOpts.getProjects?.() || []).find((p) => String(p.id) === id)?.name || "project")}”</strong>
    <button type="button" class="btn secondary" data-pin-kind="side">${sideOn ? "Unpin from the side" : "Pin to the side"}
      <small>Keeps this project on the left Shared projects rail, even when you minimize the list.</small>
    </button>
    <button type="button" class="btn secondary" data-pin-kind="tab">${tabOn ? "Unpin from viewport tabs" : "Pin to a tab"}
      <small>Docks it like the Fusion 360 tab in the viewport strip so you can jump back without hunting the explorer.</small>
    </button>
  `;
  const card = modal()?.querySelector(`[data-shared-project="${CSS.escape(id)}"]`);
  (card || modal()?.querySelector(".ws-hub-body") || document.body).appendChild(pop);
  pop.addEventListener("click", (ev) => {
    const kind = ev.target.closest("[data-pin-kind]")?.getAttribute("data-pin-kind");
    if (!kind) return;
    ev.preventDefault();
    ev.stopPropagation();
    const next = prefs();
    if (kind === "side") {
      const pinnedIds = next.pinnedIds.includes(id)
        ? next.pinnedIds.filter((row) => row !== id)
        : [...next.pinnedIds, id];
      writePrefs({ pinnedIds });
    } else {
      const tabPinnedIds = (next.tabPinnedIds || []).includes(id)
        ? (next.tabPinnedIds || []).filter((row) => row !== id)
        : [...(next.tabPinnedIds || []), id];
      writePrefs({ tabPinnedIds });
      try {
        document.dispatchEvent(new CustomEvent("render3d:shared-tab-pin", { detail: { projectId: id, pinned: tabPinnedIds.includes(id) } }));
      } catch { /* ignore */ }
    }
    pop.remove();
    if (panel === "list") paintBody();
  });
}

function openProject(id) {
  if (!id) return;
  closeSharedProjectsBrowser();
  boundOpts.onOpenProject?.(id);
}

export function closeSharedProjectsBrowser() {
  if (sharedInvitesAbort) {
    try { sharedInvitesAbort.abort(); } catch (_) { /* ignore */ }
    sharedInvitesAbort = null;
  }
  modal()?.classList.add("hidden");
  setStatus("");
  panel = "list";
  detailsProjectId = "";
  searchHits = [];
  searchQuery = "";
  listFilterQuery = "";
  clearTimeout(searchTimer);
  searchGeneration += 1;
  peopleIndexGen += 1;
  const filter = $("shared-projects-filter");
  if (filter) filter.value = "";
  try { thumbObserver?.disconnect?.(); } catch { /* ignore */ }
}

export async function openSharedProjectsBrowser(opts = {}) {
  if (opts && typeof opts === "object") boundOpts = { ...boundOpts, ...opts };
  const el = modal();
  if (!el) return;
  setStatus("");
  panel = "list";
  shareCache.clear();
  shareIndexSkip.clear();
  shareErrors.clear();
  paintBody();
  el.classList.remove("hidden");
  await refreshInvites();
  if (panel === "list") paintBody();
}

export function bindSharedProjectsBrowser(opts = {}) {
  boundOpts = { ...boundOpts, ...opts };
  if (bound) return { open: openSharedProjectsBrowser, close: closeSharedProjectsBrowser };
  bound = true;
  document.querySelectorAll("[data-shared-projects-close]").forEach((el) => {
    el.addEventListener("click", () => closeSharedProjectsBrowser());
  });
  $("btn-share-current-project")?.addEventListener("click", () => {
    const id = boundOpts.getActiveProjectId?.();
    if (id) void openDetails(id);
  });
  modal()?.querySelectorAll("[data-shared-collection]").forEach((btn) => {
    btn.addEventListener("click", () => {
      collection = btn.dataset.sharedCollection;
      listFilterQuery = "";
      openList();
    });
  });
  $("btn-shared-projects-create")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    openCreate();
  });
  $("shared-projects-filter")?.addEventListener("input", (ev) => {
    listFilterQuery = ev.target.value || "";
    if (panel === "list") paintBody();
    schedulePeopleIndex();
  });
  modal()?.querySelectorAll("[data-shared-view]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const next = btn.getAttribute("data-shared-view") === "grid" ? "grid" : "list";
      writePrefs({ view: next });
      if (panel === "list") paintBody();
      else syncViewButtons();
    });
  });
  modal()?.addEventListener("click", (e) => {
    const target = e.target.closest("button, article, [data-shared-project]");
    if (!target) return;
    if (target.closest("[data-shared-projects-close]")) return;
    if (target.hasAttribute("data-shared-invite-submit")) { void submitDetailsInvites(); return; }
    if (target.hasAttribute("data-shared-retry")) { void loadShareList(detailsProjectId, { force: true }); return; }
    if (target.hasAttribute("data-shared-back")) {
      e.preventDefault();
      openList();
      return;
    }
    if (target.hasAttribute("data-shared-create-submit")) {
      e.preventDefault();
      void submitCreate();
      return;
    }
    if (target.hasAttribute("data-shared-create-details")) {
      e.preventDefault();
      if (detailsProjectId) void openDetails(detailsProjectId);
      else setStatus("Create the project first to see who it is shared with.");
      return;
    }
    const pin = target.closest("[data-shared-pin]");
    if (pin) {
      e.preventDefault();
      e.stopPropagation();
      togglePin(pin.getAttribute("data-shared-pin"));
      return;
    }
    const details = target.closest("[data-shared-details], [data-shared-share]");
    if (details) {
      e.preventDefault();
      e.stopPropagation();
      void openDetails(details.getAttribute("data-shared-details") || details.getAttribute("data-shared-share"));
      return;
    }
    const openBtn = target.closest("[data-shared-open]");
    if (openBtn) {
      e.preventDefault();
      e.stopPropagation();
      openProject(openBtn.getAttribute("data-shared-open"));
      return;
    }
    const chip = target.closest("[data-remove-chip]");
    if (chip) {
      e.preventDefault();
      if (panel === "details") detailsPeople = detailsPeople.filter((row) => row.key !== chip.getAttribute("data-remove-chip"));
      else createDraft.people = createDraft.people.filter((row) => row.key !== chip.getAttribute("data-remove-chip"));
      paintBody();
      return;
    }
    const hit = target.closest("[data-create-hit], [data-details-hit]");
    if (hit) {
      e.preventDefault();
      const payload = {
        kind: hit.getAttribute("data-hit-kind"),
        id: hit.getAttribute("data-hit-id"),
        email: hit.getAttribute("data-hit-email"),
        label: hit.getAttribute("data-hit-label"),
      };
      if (hit.hasAttribute("data-details-hit")) {
        const key = String(payload.email || payload.id || payload.label).toLowerCase();
        if (!detailsPeople.some((p) => p.key === key)) detailsPeople.push({ ...payload, key, role: createDraft.permission });
        searchQuery = "";
        searchHits = [];
        searchGeneration += 1;
        paintBody();
        $("shared-details-search")?.focus();
      } else {
        addDraftPerson(payload, createDraft.permission);
        searchQuery = "";
        searchHits = [];
        paintBody();
      }
      return;
    }
    const remove = target.closest("[data-remove-person]");
    if (remove) {
      e.preventDefault();
      void removePerson(remove.getAttribute("data-remove-kind"), remove.getAttribute("data-remove-person"))
        .catch((err) => setStatus(err.message || "Could not remove.", true));
      return;
    }
    const card = target.closest("[data-shared-project]");
    if (card && panel === "list" && !target.closest("button")) {
      openProject(card.getAttribute("data-shared-project"));
    }
  });
  modal()?.addEventListener("change", (e) => {
    const perm = e.target.closest?.("[data-shared-perm-select]");
    if (!perm) return;
    const key = String(perm.getAttribute("data-shared-perm-select") || "");
    if (!key.includes(":")) return;
    const [kind, id] = key.split(":");
    perm.disabled = true;
    void changePersonRole(kind, id, perm.value).catch(async (err) => {
      await loadShareList(detailsProjectId, { force: true });
      setStatus(err.message || "Could not update permission.", true);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!modal() || modal().classList.contains("hidden")) return;
    if (panel !== "list") {
      openList();
      return;
    }
    closeSharedProjectsBrowser();
  });
  return { open: openSharedProjectsBrowser, close: closeSharedProjectsBrowser };
}

export { SHARE_PERMISSIONS, clampSharedRecentsCount, sharePermissionLabel };
