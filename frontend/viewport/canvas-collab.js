/** OG Canvas collab helpers — share modes, author stamps, timeline, live patches. */

export const CANVAS_SHARE_MODES = Object.freeze(["view", "remix", "edit"]);

export const CANVAS_SHARE_MODE_LABELS = Object.freeze({
  view: {
    title: "View",
    hint: "See the canvas. Cannot edit or remix.",
  },
  remix: {
    title: "View and remix",
    hint: "Copy into your own canvas. Cannot edit the original.",
  },
  edit: {
    title: "View, edit, remix",
    hint: "Live-edit this canvas and remix a copy.",
  },
});

const EDIT_ALIASES = new Set([
  "edit",
  "editor",
  "remix_and_edit",
  "remixandedit",
  "view_edit_remix",
  "view_and_edit_remix",
  "view_and_remix_and_edit",
  "view_edit_and_remix",
]);

const REMIX_ALIASES = new Set([
  "remix",
  "remixer",
  "remix_only",
  "remixonly",
  "view_and_remix",
  "viewandremix",
  "download",
]);

export function normalizeCanvasShareMode(value) {
  const raw = String(value || "view").trim().toLowerCase().replace(/[\s,\-]+/g, "_");
  if (EDIT_ALIASES.has(raw)) return "edit";
  if (REMIX_ALIASES.has(raw)) return "remix";
  return "view";
}

export function canvasShareModeAllowsEdit(mode) {
  return normalizeCanvasShareMode(mode) === "edit";
}

export function canvasShareModeAllowsRemix(mode) {
  const resolved = normalizeCanvasShareMode(mode);
  return resolved === "remix" || resolved === "edit";
}

export function joinRoleForCanvasMode(mode) {
  const resolved = normalizeCanvasShareMode(mode);
  if (resolved === "edit") return "editor";
  if (resolved === "remix") return "remixer";
  return "viewer";
}

export function canvasObjectAuthorId(el) {
  if (!el || typeof el !== "object") return "";
  return String(el.authorUserId || el.author_user_id || el.authorId || "").trim();
}

export function stampCanvasAuthor(el, user) {
  if (!el || typeof el !== "object") return el;
  const id = String(user?.id || user?.user_id || "").trim();
  if (!id) return el;
  if (canvasObjectAuthorId(el)) return el;
  el.authorUserId = id;
  if (user.display_name) el.authorName = String(user.display_name);
  if (user.avatar_url) el.authorAvatar = String(user.avatar_url);
  return el;
}

export function isOwnCanvasObject(el, userId) {
  const author = canvasObjectAuthorId(el);
  const me = String(userId || "").trim();
  if (!author || !me) return true;
  return author === me;
}

export function shouldShowCanvasAuthorHover(el, userId) {
  const author = canvasObjectAuthorId(el);
  if (!author) return false;
  const me = String(userId || "").trim();
  return !!me && author !== me;
}

export function canvasElementAuthors(elements) {
  const ids = new Set();
  for (const el of Array.isArray(elements) ? elements : []) {
    const id = canvasObjectAuthorId(el);
    if (id) ids.add(id);
  }
  return [...ids];
}

export function shouldShowCanvasEditTimeline({
  elements = [],
  presenceUserIds = [],
  timeline = [],
  localUserId = "",
} = {}) {
  const authors = new Set(canvasElementAuthors(elements));
  for (const event of Array.isArray(timeline) ? timeline : []) {
    const id = String(event?.userId || event?.user_id || "").trim();
    if (id) authors.add(id);
  }
  const present = new Set(
    (Array.isArray(presenceUserIds) ? presenceUserIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  const me = String(localUserId || "").trim();
  if (me) present.add(me);
  if (present.size > 1) return true;
  if (authors.size > 1) return true;
  return false;
}

export function appendCanvasEditEvent(timeline, event, { limit = 80 } = {}) {
  const rows = Array.isArray(timeline) ? [...timeline] : [];
  const userId = String(event?.userId || event?.user_id || "").trim();
  if (!userId) return rows;
  rows.push({
    id: String(event?.id || `edit-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`),
    userId,
    displayName: String(event?.displayName || event?.display_name || "Someone"),
    avatarUrl: String(event?.avatarUrl || event?.avatar_url || ""),
    action: String(event?.action || "edit"),
    elementType: String(event?.elementType || event?.element_type || ""),
    at: String(event?.at || new Date().toISOString()),
  });
  return rows.slice(-Math.max(8, Number(limit) || 80));
}

export function applyCanvasCollabPatch(elements, msg) {
  const list = Array.isArray(elements) ? [...elements] : [];
  const op = String(msg?.op || "").toLowerCase();
  if (op === "delete") {
    const drop = new Set((msg.ids || []).filter(Boolean));
    if (!drop.size) return list;
    return list.filter((el) => !drop.has(el?.id) && !drop.has(el?.fromId) && !drop.has(el?.toId));
  }
  if (op === "upsert" && msg.element && typeof msg.element === "object") {
    const next = { ...msg.element };
    const idx = list.findIndex((el) => el?.id === next.id);
    if (idx >= 0) {
      const prev = list[idx] || {};
      if (!next.dataUrl && prev.dataUrl) next.dataUrl = prev.dataUrl;
      list[idx] = { ...prev, ...next };
    } else {
      list.push(next);
    }
    return list;
  }
  if (op === "replace" && Array.isArray(msg.elements)) {
    return msg.elements.map((el) => (el && typeof el === "object" ? { ...el } : el)).filter(Boolean);
  }
  return list;
}

export const CANVAS_COLLAB_TYPES = Object.freeze([
  "canvas.cursor",
  "canvas.preview",
  "canvas.patch",
  "canvas.delete",
]);
