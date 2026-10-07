/** Guest Public folder + Online Models catalog helpers. */

export const ONLINE_MODELS_CACHE = "onlinemod1";
export const GUEST_PUBLIC_LIST_LIMIT = 10;
export const ONLINE_MODELS_RETURN_KEY = "openOnlineModels";
export const ONLINE_MODELS_DEFAULT_TAB = "public";
export const PUBLIC_FOLDER_ID = "__public__";

export const PUBLIC_MODEL_ACTIONS = [
  "remix",
  "download",
  "prompt-history",
  "share",
  "copy-link",
  "send-to",
  "send-to-team",
  "send-to-person",
  "send-to-workspace",
  "add-new-project",
  "add-current-project",
  "open",
  "details",
  "profile",
  "add-author",
];

const GUEST_OK_ACTIONS = new Set([
  "copy-link",
  "prompt-history",
  "open",
  "details",
  "profile",
]);

export function isGuestExplorerUser(userId) {
  return !String(userId || "").trim();
}

export function isNewOrGuestExplorer(userId, projects = []) {
  if (isGuestExplorerUser(userId)) return true;
  const list = Array.isArray(projects) ? projects : [];
  return !list.some((p) => p && (
    String(p.owner_user_id || p.created_by || "") === String(userId)
    || (!p.public && !p.read_only_project && !p.shared_with_me)
  ));
}

export function withGuestPublicPin(projects = []) {
  const list = Array.isArray(projects) ? projects.map((p) => ({ ...p })) : [];
  if (!list.length) return list;
  if (list.some((p) => p.public_pinned)) return list;
  const featured = list.find((p) => p.featured) || list[0];
  return list.map((p) => (
    String(p.id) === String(featured.id)
      ? { ...p, public_pinned: true, guest_pin: true }
      : p
  ));
}

export function guestPublicVisibleSlice(projects = [], { limit = GUEST_PUBLIC_LIST_LIMIT } = {}) {
  const cap = Math.max(1, Number(limit) || GUEST_PUBLIC_LIST_LIMIT);
  return withGuestPublicPin(projects).slice(0, cap);
}

export function shouldShowPublicHover({ contextMenuOpen = false } = {}) {
  return !contextMenuOpen;
}

export function publicAuthorName(project = {}) {
  return String(
    project.owner_name
    || project.generated_by?.display_name
    || project.generation?.by_user_name
    || "",
  ).trim() || "Someone";
}

export function publicAuthorHandle(project = {}) {
  const raw = String(
    project.owner_handle
    || project.generated_by?.handle
    || project.owner?.handle
    || "",
  ).trim().replace(/^@/, "");
  return raw;
}

export function publicAuthorUserId(project = {}) {
  return String(
    project.owner_user_id
    || project.generated_by?.user_id
    || project.owner?.id
    || "",
  ).trim();
}

export function publicProfileHref(project = {}) {
  const handle = publicAuthorHandle(project);
  if (!handle) return "";
  return `/u/${encodeURIComponent(handle)}`;
}

export function publicProjectThumbUrl(project = {}) {
  const id = String(project.id || "").trim();
  const preview = String(project.preview_url || "").trim();
  if (preview) {
    return preview.replace(/^\/api\/projects\//, "/api/public/projects/");
  }
  return id ? `/api/public/projects/${encodeURIComponent(id)}/thumb` : "";
}

export function publicProjectLink(project = {}, origin = "") {
  const id = String(project.id || "").trim();
  const base = String(origin || "").replace(/\/$/, "") || "";
  return `${base}/?project=${encodeURIComponent(id)}`;
}

export function onlineModelsNeedsLogin(action, { signedIn = false } = {}) {
  if (signedIn) return false;
  return !GUEST_OK_ACTIONS.has(String(action || ""));
}

export function writeOnlineModelsReturn(payload, storage = defaultSessionStorage()) {
  if (!storage || !payload || typeof payload !== "object") return false;
  try {
    storage.setItem(ONLINE_MODELS_RETURN_KEY, JSON.stringify({
      open: true,
      tab: payload.tab || ONLINE_MODELS_DEFAULT_TAB,
      query: payload.query || "",
      pendingAction: payload.pendingAction || null,
      at: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function peekOnlineModelsReturn(storage = defaultSessionStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ONLINE_MODELS_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function consumeOnlineModelsReturn(storage = defaultSessionStorage()) {
  const pending = peekOnlineModelsReturn(storage);
  try {
    storage?.removeItem?.(ONLINE_MODELS_RETURN_KEY);
  } catch {
    /* ignore */
  }
  return pending;
}

export function defaultOnlineModelsTab(tab) {
  return tab === "marketplace" ? "marketplace" : ONLINE_MODELS_DEFAULT_TAB;
}

function defaultSessionStorage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}
