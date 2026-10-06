/** Viewport Spotlight search: signed-in user’s in-memory projects, prompts, timeline. */

import { trackObjectUrl, revokeTrackedObjectUrls } from "../viewport/viewport-video-editor.js?v=leakfix11";

export const VIEWPORT_SEARCH_CACHE = "20260909-vpsearch2-cmdf1-findui1-projpin1&leakfix11";
export const SEARCH_DEBOUNCE_MS = 180;
export const SEARCH_RESULT_LIMIT = 32;
export const SEARCH_HOVER_DELAY_MS = 150;
export const SEARCH_HOVER_PROMPT_MAX_CHARS = 280;
export const SEARCH_HOVER_PROMPT_MAX_PX = 260;
export const SEARCH_ROW_AVATAR_MAX = 2;
export const SEARCH_HOVER_AVATAR_MAX = 6;
export const SEARCH_PROMPT_PREVIEW_CHARS = SEARCH_HOVER_PROMPT_MAX_CHARS;
export const SEARCH_THUMB_CACHE = new Map();
export const SEARCH_THUMB_CACHE_LIMIT = 32;
const searchThumbCreated = [];

const KIND_LABEL = {
  project: "Project",
  prompt: "Prompt",
  timeline: "History",
};

export function escapeSearchHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isEditableFindTarget(target) {
  return !!target?.closest?.(
    "textarea, input, select, [contenteditable='true'], [contenteditable=''], .prompt-editor, .prompt-editor-wrap",
  );
}

/** Same Mac/iOS detection as file-actions / XR: platform, UA-CH, then userAgent. */
export function isAppleFindPlatform(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return false;
  try {
    const uaDataPlatform = String(nav.userAgentData?.platform || "").trim();
    if (uaDataPlatform) return /mac|iphone|ipad|ipod|ios/i.test(uaDataPlatform);
    const platform = String(nav.platform || "");
    const ua = String(nav.userAgent || "");
    return /Mac|iPhone|iPad|iPod/i.test(ua) || /Mac/i.test(platform);
  } catch {
    return false;
  }
}

export const usesMacFindModifier = isAppleFindPlatform;

function findModifierPressed(event, isMac) {
  if (isMac) return !!(event?.metaKey && !event?.ctrlKey);
  return !!(event?.ctrlKey && !event?.metaKey);
}

/**
 * Cmd+F on macOS, Ctrl+F elsewhere. Never steal find-in-page from a real
 * text field (except our overlay). Matches existing Cmd+F field policy.
 */
export function shouldInterceptViewportFind(event, {
  overlayOpen = false,
  inField = false,
  inViewport = false,
  isMac = null,
  navigator: nav = typeof navigator !== "undefined" ? navigator : null,
} = {}) {
  const apple = isMac == null ? isAppleFindPlatform(nav) : !!isMac;
  const key = String(event?.key || "").toLowerCase();
  if (key !== "f" || event?.altKey || event?.shiftKey) return false;
  if (!findModifierPressed(event, apple)) return false;
  if (overlayOpen) return true;
  if (inField) return false;
  return !!inViewport;
}

export function formatSearchWhen(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

export function formatSearchCostUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  const n = Number(value);
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function searchUsageTokenTotal(usage) {
  if (!usage || typeof usage !== "object") return 0;
  return Number(usage.total_tokens)
    || (Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0))
    || 0;
}

function compactTokenCount(value) {
  const total = Number(value) || 0;
  if (total <= 0) return "";
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(2)}M tok`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k tok`;
  return `${total} tok`;
}

export function formatSearchCostLabel(entry = {}) {
  const parts = [];
  const credits = entry.credits ?? entry.credit_cost ?? entry.credits_used ?? entry.meta?.credits;
  if (credits != null && credits !== "" && Number.isFinite(Number(credits))) {
    const n = Number(credits);
    parts.push(`${Number.isInteger(n) ? String(n) : n.toFixed(2)} cr`);
  } else {
    const label = String(credits || entry.credits_label || "").trim();
    if (label) parts.push(label);
  }
  const cost = formatSearchCostUsd(entry.costUsd ?? entry.cost_usd ?? entry.meta?.cost_usd);
  if (cost) parts.push(cost);
  const tokens = compactTokenCount(
    entry.tokens
    ?? searchUsageTokenTotal(entry.usage || entry.meta?.usage)
    ?? 0,
  );
  if (tokens) parts.push(tokens);
  return parts.join(" · ");
}

export const formatSearchPromptUsage = formatSearchCostLabel;

function clip(text, n = 88) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function clipSearchPromptText(text, max = SEARCH_HOVER_PROMPT_MAX_CHARS) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const limit = Math.max(40, Number(max) || SEARCH_HOVER_PROMPT_MAX_CHARS);
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

export function clampSearchPromptText(text, maxOrOpts = SEARCH_PROMPT_PREVIEW_CHARS) {
  const chars = typeof maxOrOpts === "object" && maxOrOpts
    ? maxOrOpts.chars
    : maxOrOpts;
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const limit = Math.max(40, Number(chars) || SEARCH_PROMPT_PREVIEW_CHARS);
  if (raw.length <= limit) return { text: raw, clamped: false };
  return { text: `${raw.slice(0, limit - 1)}…`, clamped: true };
}

function promptTextOf(entry = {}) {
  return String(
    entry.original_prompt
    || entry.prompt
    || entry.improved_prompt
    || entry.meta?.original_prompt
    || entry.meta?.prompt
    || "",
  ).trim();
}

function timelineLabel(entry = {}) {
  const kind = String(entry.kind || "").replace(/_/g, " ");
  return String(entry.label || kind || "History").trim();
}

function assetTypeLabel(project = {}, kind = "project") {
  if (kind === "prompt") return "Prompt";
  if (kind === "timeline") return "History";
  const file = String(project.latest_file || project.latest_model || project.filename || "").toLowerCase();
  if (/\.(glb|gltf|obj|stl|step|stp|3mf)$/.test(file)) return "3D model";
  if (file) return "3D asset";
  return "Project";
}

export function projectOwnerId(project = {}) {
  return String(
    project?.owner_user_id
    || project?.created_by
    || project?.generation?.by_user_id
    || "",
  ).trim();
}

export function isSharedWorkspaceSearchProject(project = {}, {
  personalWorkspaceId = "",
} = {}) {
  if (!project?.id) return false;
  const folder = String(project.folder_id || project.id || "");
  if (project.public === true || folder === "__public__" || folder === "__other_user_renders__") {
    return false;
  }
  if (project.shared_with_me) return true;
  if (project.shared_workspace || project.shared_workspace_folder || folder.startsWith("__shared_ws_")) {
    return true;
  }
  const tid = String(project.team_id || "");
  const pid = String(personalWorkspaceId || "");
  if (tid && pid && tid !== pid) return true;
  const members = Number(project.member_count || project.workspace_member_count || 0);
  return members > 1;
}

/** Explorer rows the signed-in user already has — never public / other-user feeds. */
export function ownViewportSearchProjects(projects, {
  currentUserId = "",
  allowProject = null,
} = {}) {
  const me = String(currentUserId || "").trim();
  return (projects || []).filter((project) => {
    if (!project?.id) return false;
    const folder = String(project.folder_id || project.id || "");
    if (project.public === true || folder === "__public__" || folder === "__other_user_renders__") {
      return false;
    }
    if (typeof allowProject === "function") return !!allowProject(project);
    const owner = projectOwnerId(project);
    if (me && owner && owner === me) return true;
    if (project.shared_with_me) return true;
    if (project.shared_workspace || project.shared_workspace_folder || folder.startsWith("__shared_ws_")) {
      return true;
    }
    if (me && owner) return owner === me;
    return true;
  });
}

/** Drop other users’ prompt/timeline rows when a user id is present. */
export function ownViewportSearchEntries(entries, currentUserId) {
  const me = String(currentUserId || "").trim();
  if (!me) return Array.isArray(entries) ? entries : [];
  return (entries || []).filter((entry) => {
    const uid = String(entry?.user_id || entry?.by_user_id || entry?.meta?.user_id || "").trim();
    return !uid || uid === me;
  });
}

export function shouldApplySearchGeneration(started, current) {
  return started === current;
}

export function searchHitPeople(people, currentUserId = "") {
  const me = String(currentUserId || "").trim();
  const seen = new Set();
  const out = [];
  for (const raw of people || []) {
    const person = normalizeSearchPerson(raw);
    if (!person || seen.has(person.id) || (me && person.id === me)) continue;
    seen.add(person.id);
    out.push(person);
  }
  return out;
}

export function normalizeSearchPerson(raw = {}) {
  const id = String(raw.id || raw.user_id || raw.by_user_id || "").trim();
  const name = String(
    raw.display_name
    || raw.name
    || raw.by_user_name
    || raw.owner_name
    || raw.email
    || raw.by_user_email
    || "",
  ).trim();
  let avatar = String(raw.avatar_url || raw.by_avatar_url || raw.owner_avatar_url || "").trim();
  if (!avatar && id) avatar = `/api/users/${encodeURIComponent(id)}/avatar`;
  if (!id && !name) return null;
  return { id: id || name, name: name || "Teammate", avatar_url: avatar };
}

/**
 * Cheap people list from fields already on the project / already-loaded extras.
 * No network. Dedupes by id. extra = workspace member_count minus known faces.
 */
export function collectSearchPeople(project = {}, {
  extras = [],
  memberCount = 0,
  currentUserId = "",
} = {}) {
  const seen = new Set();
  const people = [];
  const push = (raw) => {
    const person = normalizeSearchPerson(raw);
    if (!person || seen.has(person.id)) return;
    seen.add(person.id);
    people.push(person);
  };
  for (const row of project.people_preview || project.members || project.collaborators || []) {
    push(row);
  }
  push({
    id: project.owner_user_id || project.created_by,
    name: project.owner_name,
    email: project.owner_email,
    avatar_url: project.owner_avatar_url,
  });
  push(project.generated_by);
  push(project.generation);
  for (const row of extras || []) push(row);
  const me = String(currentUserId || "").trim();
  const others = me ? people.filter((p) => p.id !== me) : people;
  const known = people.length;
  const billed = Number(memberCount || project.member_count || project.workspace_member_count || 0) || 0;
  const extra = Math.max(0, billed - known);
  const folder = String(project.folder_id || "");
  const shared = extra > 0
    || others.length > 0
    || !!project.shared_with_me
    || !!project.shared_workspace
    || !!project.shared_workspace_folder
    || folder.startsWith("__shared_ws_")
    || billed > 1;
  return { people: others, extra, shared };
}

export function clipSearchPeople(people, extra = 0, { max = SEARCH_ROW_AVATAR_MAX } = {}) {
  const list = Array.isArray(people) ? people : [];
  const cap = Math.max(1, Number(max) || SEARCH_ROW_AVATAR_MAX);
  const shown = list.slice(0, cap);
  const more = Math.max(0, list.length - shown.length) + Math.max(0, Number(extra) || 0);
  return { shown, more };
}

export function searchAvatarCluster(people, extra = 0, opts = {}) {
  const { shown, more } = clipSearchPeople(people, extra, opts);
  return { shown, extra: more };
}

export function searchAvatarBarPeople(people, limit = SEARCH_HOVER_AVATAR_MAX) {
  return (Array.isArray(people) ? people : []).slice(0, Math.max(1, Number(limit) || SEARCH_HOVER_AVATAR_MAX));
}

function costFieldsFrom(entry = {}, fallback = {}) {
  const usage = entry.usage || entry.meta?.usage || fallback.usage || null;
  const costUsd = entry.cost_usd ?? entry.meta?.cost_usd ?? fallback.cost_usd ?? fallback.costUsd ?? null;
  const tokens = searchUsageTokenTotal(usage);
  const credits = entry.credits || entry.meta?.credits || fallback.credits || "";
  return { costUsd, tokens, usage, credits };
}

function peopleFieldsFrom(project = {}, { currentUserId = "" } = {}) {
  const packed = collectSearchPeople(project, {
    extras: project.search_people_extras || [],
    memberCount: project.workspace_member_count || project.member_count || 0,
    currentUserId,
  });
  const editors = [];
  const seen = new Set();
  for (const person of packed.people) {
    editors.push(person);
    seen.add(person.id);
  }
  for (const row of project.editors || project.edited_by || []) {
    const person = normalizeSearchPerson(row);
    if (!person || seen.has(person.id)) continue;
    seen.add(person.id);
    editors.push(person);
  }
  return {
    people: packed.people,
    peopleExtra: packed.extra,
    shared: packed.shared,
    editors,
    workspaceName: String(project.workspace_name || project.team_name || "").trim(),
    workspaceId: String(project.team_id || "").trim(),
  };
}

function projectItem(project, { currentUserId = "" } = {}) {
  const when = formatSearchWhen(project.updated_at || project.opened_at || project.created_at);
  const people = peopleFieldsFrom(project, { currentUserId });
  const summary = project.usage_summary || {};
  const typeLabel = assetTypeLabel(project, "project");
  return {
    kind: "project",
    id: `project:${project.id}`,
    projectId: project.id,
    title: String(project.name || project.id || "Project").trim() || "Project",
    subtitle: [project.name && project.id !== project.name ? project.id : "", when, typeLabel].filter(Boolean).join(" · "),
    haystack: [project.name, project.id, people.workspaceName].filter(Boolean).join(" "),
    date: project.updated_at || project.opened_at || project.created_at || "",
    previewUrl: String(project.preview_url || "").trim(),
    typeLabel,
    latestFile: String(project.latest_file || project.latest_model || project.filename || "").trim(),
    promptCount: Number(summary.tracked_count ?? summary.prompt_count ?? project.prompt_count ?? 0) || 0,
    costUsd: summary.cost_usd ?? project.total_cost_usd ?? null,
    tokens: searchUsageTokenTotal(summary.usage) || Number(summary.total_tokens || 0) || 0,
    ...people,
  };
}

function promptItem(entry, projectId, projectName, project = {}, { currentUserId = "" } = {}) {
  const text = promptTextOf(entry);
  const when = formatSearchWhen(entry.created_at || entry.updated_at);
  const id = entry.id || entry.prompt_id || `${projectId}:${text.slice(0, 24)}`;
  const cost = costFieldsFrom(entry);
  const people = peopleFieldsFrom({
    ...project,
    search_people_extras: [
      ...(project.search_people_extras || []),
      {
        id: entry.user_id || entry.by_user_id || entry.meta?.user_id,
        name: entry.by_user_name || entry.user_name || entry.meta?.by_user_name,
        avatar_url: entry.by_avatar_url || entry.user_avatar_url || entry.meta?.by_avatar_url,
      },
    ],
  }, { currentUserId });
  return {
    kind: "prompt",
    id: `prompt:${id}`,
    entryId: entry.id || entry.prompt_id || "",
    projectId: entry.project_id || projectId || "",
    promptText: text,
    title: clip(text, 92) || "Prompt",
    subtitle: [projectName || projectId, when, "Prompt"].filter(Boolean).join(" · "),
    haystack: [text, entry.id, entry.prompt_id, projectName, projectId].filter(Boolean).join(" "),
    date: entry.created_at || entry.updated_at || "",
    previewUrl: String(project.preview_url || "").trim(),
    typeLabel: "Prompt",
    latestFile: String(project.latest_file || "").trim(),
    promptCount: Number(project.usage_summary?.tracked_count ?? project.prompt_count ?? 0) || 0,
    ...cost,
    ...people,
    workspaceName: people.workspaceName || String(project.workspace_name || "").trim(),
  };
}

function timelineItem(entry, project, { index = -1, currentUserId = "" } = {}) {
  const text = promptTextOf(entry);
  const label = timelineLabel(entry);
  const when = formatSearchWhen(entry.created_at || entry.meta?.created_at || entry.updated_at);
  const kind = String(entry.kind || "change").replace(/_/g, " ");
  const id = entry.id || entry.meta?.prompt_id || `${project.id}:${index}:${label}`;
  const cost = costFieldsFrom(entry, entry.meta || {});
  const people = peopleFieldsFrom({
    ...project,
    search_people_extras: [
      ...(project.search_people_extras || []),
      {
        id: entry.user_id || entry.by_user_id || entry.meta?.user_id,
        name: entry.by_user_name || entry.meta?.by_user_name,
        avatar_url: entry.by_avatar_url || entry.meta?.by_avatar_url,
      },
    ],
  }, { currentUserId });
  return {
    kind: "timeline",
    id: `timeline:${project.id}:${id}`,
    entryId: entry.id || "",
    promptId: entry.meta?.prompt_id || entry.prompt_id || "",
    timelineIndex: index,
    projectId: project.id || "",
    promptText: text,
    title: clip(text || label, 92) || label,
    subtitle: [project.name || project.id, when, kind || "History"].filter(Boolean).join(" · "),
    haystack: [label, text, kind, entry.filename, entry.meta?.filename, project.name, project.id].filter(Boolean).join(" "),
    date: entry.created_at || entry.meta?.created_at || entry.updated_at || "",
    previewUrl: String(project.preview_url || "").trim(),
    typeLabel: kind || "History",
    latestFile: String(project.latest_file || "").trim(),
    promptCount: Number(project.usage_summary?.tracked_count ?? project.prompt_count ?? 0) || 0,
    ...cost,
    ...people,
  };
}

/**
 * Flat index from lists already in memory. No network, no disk, no reindex.
 * Other projects contribute name/id only unless their timeline is already loaded.
 */
export function indexViewportSearchItems({
  projects = [],
  prompts = [],
  timelineEntries = [],
  currentProjectId = "",
  currentProjectName = "",
  currentUserId = "",
  people = [],
  peopleByProjectId = null,
} = {}) {
  const items = [];
  const seen = new Set();
  const push = (item) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };
  const extrasFor = (projectId) => {
    const keyed = peopleByProjectId && projectId != null ? peopleByProjectId[projectId] : null;
    return [...(Array.isArray(keyed) ? keyed : []), ...(people || [])];
  };
  const withPeople = (project) => ({
    ...project,
    search_people_extras: [
      ...(project.search_people_extras || []),
      ...extrasFor(project.id),
    ],
  });

  const byId = new Map();
  for (const project of projects || []) {
    if (!project?.id) continue;
    byId.set(String(project.id), project);
    push(projectItem(withPeople(project), { currentUserId }));
    if (String(project.id) === String(currentProjectId)) continue;
    const more = project.timeline?.entries;
    if (!Array.isArray(more) || !more.length) continue;
    ownViewportSearchEntries(more, currentUserId).forEach((entry, index) => {
      push(timelineItem(entry, withPeople(project), { index, currentUserId }));
    });
  }

  const currentProject = withPeople(byId.get(String(currentProjectId)) || {
    id: currentProjectId,
    name: currentProjectName,
  });
  for (const entry of prompts || []) {
    push(promptItem(entry, currentProjectId, currentProjectName, currentProject, { currentUserId }));
  }

  (timelineEntries || []).forEach((entry, index) => {
    push(timelineItem(entry, currentProject, { index, currentUserId }));
  });

  return items;
}

export function filterViewportSearchItems(items, query, { limit = SEARCH_RESULT_LIMIT } = {}) {
  const list = Array.isArray(items) ? items : [];
  const raw = String(query || "").trim().toLowerCase();
  if (!raw) {
    const kindRank = { project: 0, prompt: 1, timeline: 2 };
    return [...list]
      .sort((a, b) => {
        const da = Date.parse(a.date || "") || 0;
        const db = Date.parse(b.date || "") || 0;
        if (db !== da) return db - da;
        return (kindRank[a.kind] ?? 9) - (kindRank[b.kind] ?? 9);
      })
      .slice(0, limit);
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  return list
    .map((item) => {
      const title = String(item.title || "").toLowerCase();
      const blob = `${item.title} ${item.subtitle} ${item.haystack}`.toLowerCase();
      let score = 0;
      if (title.startsWith(raw)) score = 130;
      else if (title.includes(raw)) score = 100;
      else if (blob.includes(raw)) score = 70;
      else if (tokens.length && tokens.every((tok) => blob.includes(tok))) score = 40;
      if (item.kind === "project" && (title.includes(raw) || String(item.projectId || "").toLowerCase().includes(raw))) {
        score += 12;
      }
      return { item, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.title).localeCompare(String(b.item.title)))
    .slice(0, limit)
    .map((row) => row.item);
}

function kindIcon(kind) {
  if (kind === "prompt") {
    return `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="M10 2.4l1.5 4.4 4.6.2-3.6 2.9 1.3 4.5L10 11.7 6.2 14l1.3-4.5-3.6-2.9 4.6-.2L10 2.4z" fill="currentColor"/></svg>`;
  }
  if (kind === "timeline") {
    return `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.2" stroke="currentColor" stroke-width="1.6"/><path d="M10 6.2V10l2.6 1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="M3.4 6.2 10 3.2l6.6 3v9.2L10 16.8 3.4 15.4V6.2z" stroke="currentColor" stroke-width="1.5"/><path d="M10 3.4v13.2M3.6 6.4l6.4 3 6.4-3" stroke="currentColor" stroke-width="1.5"/></svg>`;
}

function avatarMarkup(person, { size = 18 } = {}) {
  const name = escapeSearchHtml(person?.name || person?.display_name || "Teammate");
  const initial = escapeSearchHtml(String(person?.name || person?.display_name || "?").trim().charAt(0).toUpperCase() || "?");
  const src = String(person?.avatar_url || "").trim();
  const cls = size > 20 ? "viewport-search-avatar viewport-search-avatar--bar" : "viewport-search-avatar";
  if (src) {
    return `<span class="${cls} has-photo" title="${name}" aria-hidden="true" style="background-image:url('${escapeSearchHtml(src)}')"></span>`;
  }
  return `<span class="${cls} viewport-search-avatar--letter" title="${name}" aria-hidden="true">${initial}</span>`;
}

export function renderSearchAvatarCluster(people, extra = 0, { max = SEARCH_ROW_AVATAR_MAX } = {}) {
  if (!people?.length && !(Number(extra) > 0)) return "";
  const { shown, more } = clipSearchPeople(people, extra, { max });
  if (!shown.length && more <= 0) return "";
  const plus = more > 0 ? `<span class="viewport-search-avatar-more" title="${more} more">+${more}</span>` : "";
  return `<span class="viewport-search-hit-people" data-vp-search-people="1" data-vp-search-avatars="1">${shown.map((p) => avatarMarkup(p)).join("")}${plus}</span>`;
}

export function renderSearchPeopleBar(people) {
  const shown = searchAvatarBarPeople(people, SEARCH_HOVER_AVATAR_MAX);
  if (!shown.length) return "";
  return shown.map((p) => avatarMarkup(p, { size: 26, photos: true })).join("");
}

export function renderViewportSearchResults(results, { selectedIndex = 0, query = "" } = {}) {
  const q = String(query || "").trim();
  if (!results?.length) {
    return `<div class="viewport-search-empty">${q ? "No matches" : "Search projects, prompts, and history"}</div>`;
  }
  return results.map((item, i) => {
    const active = i === selectedIndex;
    const avatars = item.shared
      ? renderSearchAvatarCluster(item.people, item.peopleExtra, { max: SEARCH_ROW_AVATAR_MAX })
      : "";
    return `<button type="button" class="viewport-search-hit${active ? " is-active" : ""}" role="option" aria-selected="${active ? "true" : "false"}" data-vp-search-index="${i}">
      <span class="viewport-search-hit-icon viewport-search-hit-icon--${escapeSearchHtml(item.kind)}" aria-hidden="true">${kindIcon(item.kind)}</span>
      <span class="viewport-search-hit-copy">
        <span class="viewport-search-hit-title">${escapeSearchHtml(item.title)}</span>
        <span class="viewport-search-hit-sub">${escapeSearchHtml(item.subtitle || KIND_LABEL[item.kind] || "")}</span>
      </span>
      ${avatars}
    </button>`;
  }).join("");
}

export function renderViewportSearchHover(item = {}) {
  if (!item) return "";
  const isPrompt = item.kind === "prompt" || (item.kind === "timeline" && item.promptText);
  const people = clipSearchPeople(item.people, item.peopleExtra, { max: SEARCH_HOVER_AVATAR_MAX });
  const peopleRow = (item.shared || people.shown.length)
    ? `<div class="viewport-search-hover-people">${people.shown.map((p) => avatarMarkup(p, { size: 22, photos: true })).join("")}${people.more > 0 ? `<span class="viewport-search-avatars-more">+${people.more}</span>` : ""}</div>`
    : "";
  const cost = formatSearchCostLabel(item);
  if (isPrompt) {
    const clamped = clampSearchPromptText(item.promptText || item.title, { chars: SEARCH_HOVER_PROMPT_MAX_CHARS });
    return `${peopleRow}<div class="viewport-search-preview-card viewport-search-preview--prompt">
      <p class="viewport-search-preview-prompt${clamped.clamped ? " is-clamped" : ""}">${escapeSearchHtml(clamped.text || "Prompt")}</p>
      ${cost ? `<p class="viewport-search-preview-usage">${escapeSearchHtml(cost)}</p>` : ""}
    </div>`;
  }
  const thumbUrl = String(item.thumbUrl || item.previewUrl || "").trim()
    || (item.projectId ? `/api/projects/${encodeURIComponent(item.projectId)}/thumb` : "");
  const bits = [
    item.typeLabel || "Project",
    formatSearchWhen(item.date),
    item.workspaceName,
  ].filter(Boolean);
  return `${peopleRow}<div class="viewport-search-preview-card viewport-search-preview--project">
    <div class="viewport-search-preview-thumb" data-vp-search-thumb="${escapeSearchHtml(thumbUrl)}"></div>
    <div class="viewport-search-preview-meta">
      <strong>${escapeSearchHtml(item.title || "Project")}</strong>
      ${bits.map((b) => `<span>${escapeSearchHtml(b)}</span>`).join("")}
      ${cost ? `<span class="viewport-search-hover-cost">${escapeSearchHtml(cost)}</span>` : ""}
    </div>
  </div>`;
}

export const renderViewportSearchPreview = renderViewportSearchHover;

export function renderViewportSearchMenu(item = {}) {
  const canPin = !!item.canPin;
  const pinned = !!item.pinned;
  return `
    <button type="button" role="menuitem" data-vp-search-action="share">Share to friends inside Render</button>
    <button type="button" role="menuitem" data-vp-search-action="copy-link">Copy share link</button>
    <button type="button" role="menuitem" data-vp-search-action="download">Download</button>
    ${canPin ? `<button type="button" role="menuitem" data-vp-search-action="pin">${pinned ? "Unpin from projects" : "Pin to projects"}</button>` : ""}
    <button type="button" role="menuitem" data-vp-search-action="details">Project details</button>
  `;
}

export function renderViewportSearchDetails(item = {}) {
  const people = item.people || [];
  const editors = item.editors?.length ? item.editors : people;
  const cost = formatSearchCostLabel({
    costUsd: item.costUsd,
    tokens: item.tokens,
    credits: item.credits,
  }) || "—";
  const personList = (list) => list.length
    ? list.slice(0, SEARCH_HOVER_AVATAR_MAX).map((p) => (
      `<span class="viewport-search-details-person">${avatarMarkup(p, { size: 20 })}${escapeSearchHtml(p.name)}</span>`
    )).join("")
    : `<span class="muted">Just you</span>`;
  return `
    <div class="viewport-search-details-card">
      <h3>${escapeSearchHtml(item.title || "Project")}</h3>
      <dl class="viewport-search-details-dl">
        <div><dt>Workspace</dt><dd>${escapeSearchHtml(item.workspaceName || "Personal")}</dd></div>
        <div><dt>Users involved</dt><dd class="viewport-search-details-people">${personList(people)}</dd></div>
        <div><dt>Users who edited</dt><dd class="viewport-search-details-people">${personList(editors)}</dd></div>
        <div><dt>Total prompts</dt><dd>${item.promptCount || 0}</dd></div>
        <div><dt>Project costs</dt><dd>${escapeSearchHtml(cost)}</dd></div>
      </dl>
      <div class="viewport-search-details-actions">
        <button type="button" class="btn secondary" data-vp-search-action="share">Share</button>
        <button type="button" class="btn secondary" data-vp-search-action="copy-link">Copy link</button>
        <button type="button" class="btn secondary" data-vp-search-action="download">Download</button>
        <button type="button" class="btn secondary" data-vp-search-action="open">Open</button>
        <button type="button" class="btn accent" data-vp-search-action="remix">Remix</button>
      </div>
    </div>
  `;
}

function placeNear(el, anchor, { gap = 10, preferRight = true } = {}) {
  if (!el || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth || 300;
  const h = el.offsetHeight || 160;
  const vw = window.innerWidth || 800;
  const vh = window.innerHeight || 600;
  let left = preferRight ? r.right + gap : r.left;
  let top = r.top;
  if (left + w > vw - 8) left = Math.max(8, r.left - w - gap);
  if (left < 8) left = 8;
  if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
  if (top < 8) top = 8;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

export function canUseSearchThumbUrlDirect(url) {
  return /^(data:|blob:|https?:)/i.test(String(url || "").trim());
}

export function rememberSearchThumb(key, value, cache = SEARCH_THUMB_CACHE, created = searchThumbCreated, limit = SEARCH_THUMB_CACHE_LIMIT) {
  const id = String(key || "").trim();
  if (!id || !value) return value;
  if (cache.has(id)) cache.delete(id);
  cache.set(id, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    const prev = cache.get(oldest);
    cache.delete(oldest);
    const i = created.indexOf(prev);
    if (i >= 0) {
      created.splice(i, 1);
      try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
    }
  }
  return value;
}

export function clearSearchThumbCache(cache = SEARCH_THUMB_CACHE, created = searchThumbCreated) {
  revokeTrackedObjectUrls(created);
  cache.clear();
}

export async function fetchSearchThumbnail(url, {
  signal,
  headers = {},
  fetch: fetchFn = globalThis.fetch,
  cache = SEARCH_THUMB_CACHE,
  created = searchThumbCreated,
  limit = SEARCH_THUMB_CACHE_LIMIT,
} = {}) {
  const key = String(url || "").trim();
  if (!key) return "";
  if (cache.has(key)) return rememberSearchThumb(key, cache.get(key), cache, created, limit);
  if (canUseSearchThumbUrlDirect(key) && !key.startsWith(typeof location !== "undefined" ? location.origin : "https://render3d.app")) {
    return rememberSearchThumb(key, key, cache, created, limit);
  }
  if (typeof fetchFn !== "function") return "";
  const res = await fetchFn(key, { signal, headers, credentials: "same-origin" });
  if (!res?.ok || res.status === 204) throw new Error("thumb");
  const blob = await res.blob();
  if (!blob?.size) throw new Error("empty");
  const type = String(blob.type || "").toLowerCase();
  if (type && !type.startsWith("image/") && type !== "application/octet-stream") {
    throw new Error("type");
  }
  const objectUrl = trackObjectUrl(blob, created) || key;
  return rememberSearchThumb(key, objectUrl, cache, created, limit);
}

export function createViewportSearchOverlay({
  getItems = () => [],
  onSelect = null,
  onAction = null,
  onOpen = null,
  getAuthHeaders = () => ({}),
  isProjectPinned = () => false,
  canPinProject = () => false,
  document: doc = typeof document !== "undefined" ? document : null,
} = {}) {
  let root = null;
  let input = null;
  let list = null;
  let hoverEl = null;
  let menuEl = null;
  let detailsEl = null;
  let peopleBar = null;
  let open = false;
  let selected = 0;
  let results = [];
  let query = "";
  let indexed = [];
  let searchGen = 0;
  let debounceTimer = 0;
  let hoverTimer = 0;
  let hoverIndex = -1;
  let menuHit = null;
  let detailsHit = null;
  let thumbAbort = null;

  function cancelThumb() {
    try { thumbAbort?.abort?.(); } catch { /* ignore */ }
    thumbAbort = null;
  }

  function hidePeopleBar() {
    if (!peopleBar) return;
    peopleBar.classList.add("hidden");
    peopleBar.innerHTML = "";
  }

  function showPeopleBar(people) {
    if (!peopleBar) return;
    const html = renderSearchPeopleBar(people);
    if (!html) {
      hidePeopleBar();
      return;
    }
    peopleBar.innerHTML = html;
    peopleBar.classList.remove("hidden");
  }

  function hideHover() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = 0;
    }
    hoverIndex = -1;
    cancelThumb();
    hoverEl?.classList.add("hidden");
    if (hoverEl) hoverEl.innerHTML = "";
    hidePeopleBar();
  }

  function hideMenu() {
    menuHit = null;
    menuEl?.classList.add("hidden");
  }

  function hideDetails() {
    detailsHit = null;
    detailsEl?.classList.add("hidden");
    if (detailsEl) detailsEl.innerHTML = "";
  }

  async function fillHoverThumb(item) {
    const slot = hoverEl?.querySelector?.("[data-vp-search-thumb], .viewport-search-hover-thumb");
    const url = String(item?.previewUrl || "").trim()
      || (item?.projectId ? `/api/projects/${encodeURIComponent(item.projectId)}/thumb` : "");
    if (!slot || !url || item.kind === "prompt") return;
    const cached = SEARCH_THUMB_CACHE.get(url);
    if (cached) {
      if (slot.tagName === "IMG") slot.src = cached;
      else slot.innerHTML = `<img alt="" width="240" height="132" decoding="async" src="${escapeSearchHtml(cached)}">`;
      return;
    }
    if (canUseSearchThumbUrlDirect(url)) {
      if (slot.tagName === "IMG") slot.src = url;
      return;
    }
    cancelThumb();
    thumbAbort = typeof AbortController === "function" ? new AbortController() : null;
    try {
      const headers = typeof getAuthHeaders === "function" ? (getAuthHeaders() || {}) : {};
      const objectUrl = await fetchSearchThumbnail(url, { signal: thumbAbort?.signal, headers });
      if (!hoverEl || hoverEl.classList.contains("hidden")) return;
      if (slot.tagName === "IMG") slot.src = objectUrl;
      else slot.innerHTML = `<img alt="" width="240" height="132" decoding="async" src="${escapeSearchHtml(objectUrl)}">`;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }

  function showHover(index, anchor) {
    const item = results[index];
    if (!item || !hoverEl || detailsHit || menuHit) return;
    hoverIndex = index;
    hoverEl.innerHTML = renderViewportSearchHover(item);
    hoverEl.classList.remove("hidden");
    placeNear(hoverEl, anchor, { preferRight: true });
    if (item.kind !== "prompt") void fillHoverThumb(item);
  }

  function showMenu(index, event) {
    const item = results[index];
    if (!item || !menuEl) return;
    hideHover();
    hideDetails();
    menuHit = item;
    menuEl.innerHTML = renderViewportSearchMenu({
      ...item,
      canPin: !!item?.projectId && !!canPinProject?.(item),
      pinned: !!item?.projectId && !!isProjectPinned?.(item.projectId),
    });
    menuEl.classList.remove("hidden");
    const fake = {
      getBoundingClientRect: () => ({
        left: event.clientX,
        right: event.clientX,
        top: event.clientY,
        bottom: event.clientY,
        width: 0,
        height: 0,
      }),
    };
    placeNear(menuEl, fake, { preferRight: true, gap: 4 });
  }

  function showDetails(item) {
    if (!item || !detailsEl) return;
    hideHover();
    hideMenu();
    detailsHit = item;
    detailsEl.innerHTML = `<div class="viewport-search-details-backdrop" data-vp-search-details-dismiss="1"></div>${renderViewportSearchDetails(item)}`;
    detailsEl.classList.remove("hidden");
  }

  async function runAction(action, hit) {
    if (!action || !hit) return;
    if (action === "details") {
      showDetails(hit);
      return;
    }
    if (action === "open") {
      hideDetails();
      hideMenu();
      await choose(hit);
      return;
    }
    try {
      await onAction?.(action, hit);
    } catch (_) {}
    if (action !== "share") hideMenu();
  }

  function ensure() {
    if (root || !doc) return;
    root = doc.createElement("div");
    root.id = "viewport-search-root";
    root.className = "viewport-search-overlay hidden";
    root.innerHTML = `
      <div class="viewport-search-backdrop" data-vp-search-dismiss="1"></div>
      <div class="viewport-search-panel" role="dialog" aria-modal="true" aria-label="Search studio">
        <label class="viewport-search-field">
          <span class="viewport-search-lens" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none"><circle cx="10.5" cy="10.5" r="6.2" stroke="currentColor" stroke-width="1.8"/><path d="M15.2 15.2 20 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </span>
          <input type="search" class="viewport-search-input" placeholder="Search projects, prompts, history…" autocomplete="off" spellcheck="false" aria-label="Search studio" />
        </label>
        <div class="viewport-search-people-bar hidden" data-vp-search-people-bar></div>
        <div class="viewport-search-results" role="listbox" aria-label="Search results"></div>
      </div>
      <div class="viewport-search-hover viewport-search-preview hidden" role="tooltip"></div>
      <div class="viewport-search-menu hidden" role="menu" aria-label="Search result actions"></div>
      <div class="viewport-search-details hidden" role="dialog" aria-label="Project details"></div>
    `;
    input = root.querySelector(".viewport-search-input");
    list = root.querySelector(".viewport-search-results");
    hoverEl = root.querySelector(".viewport-search-hover");
    menuEl = root.querySelector(".viewport-search-menu");
    detailsEl = root.querySelector(".viewport-search-details");
    peopleBar = root.querySelector("[data-vp-search-people-bar]");
    doc.body.appendChild(root);

    root.addEventListener("mousedown", (event) => {
      if (event.target?.closest?.("[data-vp-search-details-dismiss]")) {
        event.preventDefault();
        hideDetails();
        return;
      }
      if (event.target?.closest?.("[data-vp-search-dismiss]") && !event.target?.closest?.(".viewport-search-details-card")) {
        if (!detailsEl?.classList.contains("hidden")) {
          event.preventDefault();
          hideDetails();
          return;
        }
        event.preventDefault();
        close();
      }
    });
    root.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const btn = event.target.closest?.("[data-vp-search-index]");
      if (!btn || !list?.contains(btn)) return;
      const idx = Number(btn.dataset.vpSearchIndex);
      if (!Number.isFinite(idx)) return;
      selected = idx;
      if (list) list.innerHTML = renderViewportSearchResults(results, { selectedIndex: selected, query });
      showMenu(idx, event);
    }, true);
    list.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      const btn = event.target.closest?.("[data-vp-search-index]");
      if (!btn) return;
      event.preventDefault();
      const idx = Number(btn.dataset.vpSearchIndex);
      selected = Number.isFinite(idx) ? idx : selected;
      void choose(results[selected]);
    });
    list.addEventListener("pointerover", (event) => {
      if (!open) return;
      const btn = event.target.closest?.("[data-vp-search-index]");
      const cluster = event.target.closest?.("[data-vp-search-people], [data-vp-search-avatars]");
      if (cluster && btn) {
        const cidx = Number(btn.dataset.vpSearchIndex);
        if (Number.isFinite(cidx)) showPeopleBar(results[cidx]?.people);
      }
      if (!btn) return;
      const idx = Number(btn.dataset.vpSearchIndex);
      if (!Number.isFinite(idx) || idx === hoverIndex) return;
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => showHover(idx, btn), SEARCH_HOVER_DELAY_MS);
    });
    list.addEventListener("pointerout", (event) => {
      const next = event.relatedTarget;
      if (next && peopleBar?.contains?.(next)) {
        cancelThumb();
        hoverEl?.classList.add("hidden");
        return;
      }
      if (next && (list.contains(next) || hoverEl?.contains?.(next))) {
        if (!next.closest?.("[data-vp-search-people], [data-vp-search-avatars], [data-vp-search-people-bar]")) {
          hidePeopleBar();
        }
        return;
      }
      hideHover();
    });
    hoverEl.addEventListener("pointerleave", (event) => {
      if (event.relatedTarget && list.contains(event.relatedTarget)) return;
      hideHover();
    });
    menuEl.addEventListener("mousedown", (event) => event.preventDefault());
    menuEl.addEventListener("click", (event) => {
      const action = event.target.closest?.("[data-vp-search-action]")?.dataset?.vpSearchAction;
      if (!action) return;
      event.preventDefault();
      void runAction(action, menuHit);
    });
    detailsEl.addEventListener("click", (event) => {
      if (event.target?.closest?.("[data-vp-search-details-dismiss]")) {
        hideDetails();
        return;
      }
      const action = event.target.closest?.("[data-vp-search-action]")?.dataset?.vpSearchAction;
      if (!action) return;
      event.preventDefault();
      void runAction(action, detailsHit);
    });
    doc.addEventListener("mousedown", (event) => {
      if (!open) return;
      if (menuEl && !menuEl.classList.contains("hidden") && !menuEl.contains(event.target)) {
        hideMenu();
      }
    });
    input.addEventListener("input", () => {
      query = input.value;
      hideHover();
      hideMenu();
      scheduleFilter();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        move(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        void choose(results[selected]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (!detailsEl?.classList.contains("hidden")) {
          hideDetails();
          return;
        }
        if (!menuEl?.classList.contains("hidden")) {
          hideMenu();
          return;
        }
        close();
      }
    });
  }

  function rebuildIndex() {
    indexed = getItems() || [];
  }

  function applyQuery(q, gen) {
    if (!shouldApplySearchGeneration(gen, searchGen)) return;
    results = filterViewportSearchItems(indexed, q, { limit: SEARCH_RESULT_LIMIT });
    if (selected >= results.length) selected = Math.max(0, results.length - 1);
    hideHover();
    if (list) list.innerHTML = renderViewportSearchResults(results, { selectedIndex: selected, query: q });
  }

  function scheduleFilter() {
    const gen = ++searchGen;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => applyQuery(query, gen), SEARCH_DEBOUNCE_MS);
  }

  function refresh({ immediate = false } = {}) {
    if (immediate) {
      if (debounceTimer) clearTimeout(debounceTimer);
      rebuildIndex();
      applyQuery(query, ++searchGen);
      return;
    }
    scheduleFilter();
  }

  function move(delta) {
    if (!results.length) return;
    selected = (selected + delta + results.length) % results.length;
    hideHover();
    if (list) list.innerHTML = renderViewportSearchResults(results, { selectedIndex: selected, query });
    list?.querySelector(".is-active")?.scrollIntoView?.({ block: "nearest" });
  }

  async function choose(hit) {
    if (!hit) return;
    close();
    try {
      await onSelect?.(hit);
    } catch (_) {}
  }

  function openOverlay() {
    ensure();
    if (!root) return;
    open = true;
    query = "";
    if (input) input.value = "";
    selected = 0;
    hideHover();
    hideMenu();
    hideDetails();
    root.classList.remove("hidden");
    refresh({ immediate: true });
    queueMicrotask(() => {
      input?.focus?.();
      input?.select?.();
    });
    if (typeof onOpen === "function") {
      void Promise.resolve(onOpen()).then(() => {
        if (open) refresh({ immediate: true });
      }).catch(() => {});
    }
  }

  function close() {
    if (!open) return;
    open = false;
    searchGen += 1;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = 0;
    hideHover();
    hideMenu();
    hideDetails();
    root?.classList.add("hidden");
    if (input) input.value = "";
    query = "";
    selected = 0;
    results = [];
    indexed = [];
  }

  return {
    open: openOverlay,
    close,
    isOpen: () => open,
    refresh,
  };
}
