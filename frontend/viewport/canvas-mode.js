/**
 * Canvas mode — diagram + freehand on a 2D grid. Sketch is sent to the main AI prompt on Generate.
 */

import {
  buildCanvasDrawingMetadata,
  canvasImageDisplayName,
  canvasLinkMentionNodes,
  canvasMentionToken,
  canvasInterestKind,
  canvasInterestTitle,
  canvasPromptGraph,
  CANVAS_FINAL_LOOK_TIP,
  collectCanvasInterests,
  expandCanvasMentionText,
  isCanvasFinalExample,
  slugifyCanvasImageName,
  isCanvasGroupLink,
  canvasNodeCaption,
  assignCanvasPromptToken,
} from "./canvas-context.js?v=canvas-2e2d00af6fb4-canvasmention1";
import { convertHeicIngestFiles, isHeicFile } from "../media/heic-to-png.js?v=heicpng1";
import {
  normalizeCanvasShareMode,
  canvasShareModeAllowsEdit,
  canvasShareModeAllowsRemix,
  stampCanvasAuthor,
  canvasObjectAuthorId,
  shouldShowCanvasAuthorHover,
  shouldShowCanvasEditTimeline,
  applyCanvasCollabPatch,
  appendCanvasEditEvent,
} from "./canvas-collab.js?v=cvinvite-20260916-1";
import { triggerTrackedBlobDownload, trackObjectUrl, revokeTrackedObjectUrls } from "./viewport-video-editor.js?v=leakfix10";

const canvasDownloadCreated = [];
const canvasDisplayCreated = [];

const GRID_MINOR = 20;
const GRID_MAJOR = 100;
const BG_COLOR = "#0d1117";
const GRID_MINOR_COLOR = "rgba(88, 166, 255, 0.12)";
const GRID_MAJOR_COLOR = "rgba(88, 166, 255, 0.28)";
const PORT_R = 8;
const HANDLE_HIT = 14;
const EDGE_HIT = 10;
const MIN_NODE_SIZE = 16;
const MIN_STROKE_INK = 2;
const MIN_CONNECTOR_INK = 6;
const NODE_TYPES = new Set([
  "rect", "roundrect", "circle", "oval", "diamond", "parallelogram",
  "triangle", "hexagon", "cloud", "callout", "note", "text", "image",
  "view-mark", "face-mark", "split-mark",
]);
const CONNECTOR_TYPES = new Set(["line", "arrow", "link"]);
const INTEREST_TYPES = new Set(["view-mark", "face-mark", "edge-mark", "split-mark"]);
const INTEREST_BOX_TYPES = new Set(["view-mark", "face-mark", "split-mark"]);
const MARKUP_DRAW_TOOLS = new Set([
  "pen", "text", "line", "arrow", "rect", "roundrect", "circle", "oval",
  "diamond", "parallelogram", "triangle", "hexagon", "cloud", "callout", "note",
  "view-mark", "face-mark", "edge-mark", "split-mark",
]);
const CANVAS_VIEW_TAGS = ["Top", "Front", "Side", "Back", "Bottom", "Iso"];
const CANVAS_TAGS = [
  "Robot",
  "Building",
  "Arm",
  "Wheel",
  "Base",
  "Door",
  "Window",
  "Sensor",
  "Motor",
  "Floor",
];
const INTEREST_KIND_BY_TOOL = {
  "view-mark": "view",
  "face-mark": "face",
  "edge-mark": "edge",
  "split-mark": "split",
};

export function handlesOf(bounds) {
  const b = bounds || { x: 0, y: 0, w: 0, h: 0 };
  return {
    nw: { id: "nw", x: b.x, y: b.y },
    ne: { id: "ne", x: b.x + b.w, y: b.y },
    sw: { id: "sw", x: b.x, y: b.y + b.h },
    se: { id: "se", x: b.x + b.w, y: b.y + b.h },
  };
}

export function hitResizeHandle(bounds, pos, size = HANDLE_HIT) {
  if (!bounds || !pos) return null;
  const r = size * size;
  for (const h of Object.values(handlesOf(bounds))) {
    const dx = h.x - pos.x;
    const dy = h.y - pos.y;
    if (dx * dx + dy * dy <= r) return h.id;
  }
  return null;
}

export function resizeBounds(bounds, handle, pos, minSize = MIN_NODE_SIZE) {
  const b = bounds || { x: 0, y: 0, w: minSize, h: minSize };
  const anchors = {
    nw: { x: b.x + b.w, y: b.y + b.h },
    ne: { x: b.x, y: b.y + b.h },
    sw: { x: b.x + b.w, y: b.y },
    se: { x: b.x, y: b.y },
  };
  const a = anchors[handle] || anchors.se;
  const p = pos || a;
  const w = Math.max(minSize, Math.abs(p.x - a.x));
  const h = Math.max(minSize, Math.abs(p.y - a.y));
  return {
    x: p.x < a.x ? a.x - w : a.x,
    y: p.y < a.y ? a.y - h : a.y,
    w,
    h,
  };
}

export function pointInBounds(bounds, pos, pad = 0) {
  if (!bounds || !pos) return false;
  return pos.x >= bounds.x - pad
    && pos.x <= bounds.x + bounds.w + pad
    && pos.y >= bounds.y - pad
    && pos.y <= bounds.y + bounds.h + pad;
}

export function hitShapeEdge(bounds, pos, threshold = EDGE_HIT) {
  if (!bounds || !pos) return false;
  const { x, y, w, h } = bounds;
  const withinX = pos.x >= x - threshold && pos.x <= x + w + threshold;
  const withinY = pos.y >= y - threshold && pos.y <= y + h + threshold;
  if (!withinX || !withinY) return false;
  const nearV = Math.abs(pos.x - x) <= threshold || Math.abs(pos.x - (x + w)) <= threshold;
  const nearH = Math.abs(pos.y - y) <= threshold || Math.abs(pos.y - (y + h)) <= threshold;
  return (nearV && withinY) || (nearH && withinX);
}

export function isCanvasUndoShortcut(e) {
  const key = String(e?.key || "").toLowerCase();
  const mod = !!(e?.metaKey || e?.ctrlKey);
  return Boolean(mod && key === "z" && !e?.shiftKey && !e?.altKey);
}

export function isCanvasRedoShortcut(e) {
  const key = String(e?.key || "").toLowerCase();
  const mod = !!(e?.metaKey || e?.ctrlKey);
  if (!mod || e?.altKey) return false;
  return key === "y" || (key === "z" && !!e?.shiftKey);
}

export function isCanvasEscapeToMove(e) {
  return String(e?.key || "") === "Escape" && !e?.metaKey && !e?.ctrlKey && !e?.altKey;
}

/** Letter → tool. Image markup imports this map so IMG and Canvas 2D share one keymap. */
export const CANVAS_TOOL_SHORTCUTS = Object.freeze({
  v: "select",
  p: "pen",
  e: "eraser",
  r: "rect",
  c: "circle",
  l: "line",
  a: "arrow",
  k: "link",
  t: "text",
  d: "diamond",
  n: "note",
});

export function canvasToolFromShortcutEvent(e) {
  if (!e || e.metaKey || e.ctrlKey || e.altKey) return "";
  const letter = String(e.key || "").toLowerCase();
  return CANVAS_TOOL_SHORTCUTS[letter] || "";
}

export function canvasToolAfterDeselect(current, clicked) {
  const next = String(clicked || "");
  if (next && next === String(current || "") && next !== CANVAS_DEFAULT_TOOL) {
    return CANVAS_DEFAULT_TOOL;
  }
  return next || CANVAS_DEFAULT_TOOL;
}

export function isMarkupDrawTool(tool) {
  return MARKUP_DRAW_TOOLS.has(tool);
}

export function slugifyCanvasName(name) {
  const raw = String(name || "Canvas").trim() || "Canvas";
  const cleaned = raw.replace(/[^\w\s\-_.]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "Canvas").slice(0, 80);
}

export const CANVAS_AUTOSAVE_MS = 1800;
export const CANVAS_IMAGE_MAX_DIM = 1280;
export const CANVAS_IMAGE_JPEG_QUALITY = 0.72;
export const CANVAS_UNDO_LIMIT = 40;
export const CANVAS_IMAGE_CACHE_LIMIT = 24;
export const CANVAS_SNAPSHOT_MAX_DIM = 1600;

export function shouldKeepRawCanvasImageDataUrl(dataUrl, { maxChars = 180000 } = {}) {
  const raw = String(dataUrl || "");
  if (!raw.startsWith("data:image/")) return true;
  if (/^data:image\/svg/i.test(raw)) return true;
  if (/^data:image\/jpeg/i.test(raw) && raw.length <= maxChars) return true;
  return false;
}

/** Shrink huge PNG/GIF data URLs before they land in undo / autosave JSON. */
export function compressCanvasImageDataUrl(dataUrl, opts = {}) {
  const raw = String(dataUrl || "");
  const maxDim = Number(opts.maxDim) > 0 ? Number(opts.maxDim) : CANVAS_IMAGE_MAX_DIM;
  const quality = Number.isFinite(Number(opts.quality)) ? Number(opts.quality) : CANVAS_IMAGE_JPEG_QUALITY;
  if (!raw || shouldKeepRawCanvasImageDataUrl(raw, { maxChars: opts.maxChars ?? 180000 })) {
    return Promise.resolve(raw);
  }
  const ImageCtor = opts.Image || (typeof Image !== "undefined" ? Image : null);
  const makeCanvas = opts.createCanvas
    || (() => (typeof document !== "undefined" ? document.createElement("canvas") : null));
  if (!ImageCtor || !makeCanvas) return Promise.resolve(raw);
  return new Promise((resolve) => {
    try {
      const img = new ImageCtor();
      img.onload = () => {
        try {
          const nw = img.naturalWidth || img.width || 1;
          const nh = img.naturalHeight || img.height || 1;
          const scale = Math.min(1, maxDim / Math.max(nw, nh, 1));
          const w = Math.max(1, Math.round(nw * scale));
          const h = Math.max(1, Math.round(nh * scale));
          const canvas = makeCanvas();
          if (!canvas?.getContext) {
            resolve(raw);
            return;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx?.drawImage || !canvas.toDataURL) {
            resolve(raw);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          const out = canvas.toDataURL("image/jpeg", quality);
          resolve(out && out.length && out.length < raw.length ? out : raw);
        } catch {
          resolve(raw);
        }
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    } catch {
      resolve(raw);
    }
  });
}

export const CANVAS_NAME_DEBOUNCE_MS = 600;
export const CANVAS_DEFAULT_TOOL = "select";
export const CANVAS_DEFAULT_TOOL_KEY = "render3d:canvasDefaultTool:v1";
export const CANVAS_PINNABLE_TOOLS = Object.freeze([
  "select", "pen", "eraser", "line", "arrow", "link",
  "view-mark", "face-mark", "edge-mark", "split-mark",
  "rect", "roundrect", "diamond", "circle", "oval", "triangle", "hexagon",
  "cloud", "callout", "parallelogram", "note", "text",
]);

export function isCanvasPinnableTool(tool) {
  return CANVAS_PINNABLE_TOOLS.includes(String(tool || ""));
}

export function loadCanvasDefaultTool(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(CANVAS_DEFAULT_TOOL_KEY);
    if (isCanvasPinnableTool(raw)) return raw;
  } catch {
    /* ignore quota / private mode */
  }
  return CANVAS_DEFAULT_TOOL;
}

export function storeCanvasDefaultTool(tool, storage = globalThis.localStorage) {
  const next = isCanvasPinnableTool(tool) ? String(tool) : CANVAS_DEFAULT_TOOL;
  try {
    storage?.setItem?.(CANVAS_DEFAULT_TOOL_KEY, next);
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}

export function defaultCanvasTimestampName(date = new Date()) {
  const parsed = date instanceof Date ? date : new Date(date);
  const d = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const pad = (n) => String(n).padStart(2, "0");
  return `Canvas ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

export function isGenericCanvasName(name) {
  const cleaned = String(name || "").trim();
  if (!cleaned) return true;
  return /^canvas$/i.test(cleaned);
}

/** Other canvas stores in the current project (Reference Files → Canvas/<name>). */
export const CANVAS_ASK_OPEN_KEY = "render3d:canvasAskOpen:v1";

export function readCanvasAskOpenPref(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(CANVAS_ASK_OPEN_KEY);
    if (raw == null || raw === "") return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

export function writeCanvasAskOpenPref(on, storage = globalThis.localStorage) {
  try { storage?.setItem?.(CANVAS_ASK_OPEN_KEY, on ? "1" : "0"); } catch { /* ignore */ }
  return !!on;
}

export const CANVAS_LAST_EDITED_KEY = "render3d:canvasLastEdited:v1";

/** Keep empty names empty — slugifyCanvasName("") is "Canvas". */
export function namedCanvasStore(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  return slugifyCanvasName(raw);
}

export function canvasLastEditedKey(projectId) {
  const id = String(projectId || "").trim();
  return id ? `${CANVAS_LAST_EDITED_KEY}:${id}` : "";
}

export function readLastEditedCanvasName(projectId, storage = globalThis.localStorage) {
  const key = canvasLastEditedKey(projectId);
  if (!key) return "";
  try {
    return namedCanvasStore(storage?.getItem?.(key) || "");
  } catch {
    return "";
  }
}

export function writeLastEditedCanvasName(projectId, name, storage = globalThis.localStorage) {
  const key = canvasLastEditedKey(projectId);
  const stored = namedCanvasStore(name);
  if (!key || !stored) return "";
  try { storage?.setItem?.(key, stored); } catch { /* ignore */ }
  return stored;
}

export function canvasBoardMtime(file = {}) {
  const raw = Number(file?.mtime);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const parsed = Date.parse(file?.updated_at || file?.updatedAt || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed / 1000;
}

function rankCanvasBoardsByMtime(rows = []) {
  return [...rows].sort((a, b) => {
    const mt = (Number(b.mtime) || 0) - (Number(a.mtime) || 0);
    if (mt) return mt;
    return Number(isGenericCanvasName(a.name)) - Number(isGenericCanvasName(b.name));
  });
}

/** Open last: last edited/opened by this user, else newest mtime — never alpha / generic-first. */
export function pickLastCanvasBoard(boards = [], { lastEditedName = "", lastOpenedName = "" } = {}) {
  const rows = [];
  const seen = new Set();
  for (const row of boards || []) {
    const name = namedCanvasStore(row?.name || row);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    rows.push({
      name,
      mtime: canvasBoardMtime(row),
      folder: row?.folder || `Canvas/${name}`,
    });
  }
  const match = (want) => {
    const slug = namedCanvasStore(want);
    if (!slug) return null;
    return rows.find((row) => row.name === slug) || null;
  };
  return match(lastEditedName) || match(lastOpenedName) || rankCanvasBoardsByMtime(rows)[0] || null;
}

export function listCanvasBoardsByRecency(files = []) {
  return collectCanvasBoardNames(files, "");
}

export function collectCanvasBoardNames(files = [], currentName = "") {
  const current = namedCanvasStore(currentName);
  const byName = new Map();
  for (const file of files || []) {
    const folder = String(file?.folder || "");
    const folderMatch = folder.match(/^Canvas\/([^/]+)/i);
    const rawName = folderMatch?.[1]
      || file?.canvasName
      || file?.storeName
      || (/^canvas\.json$/i.test(String(file?.name || file?.filename || "")) ? file?.label : "");
    if (!String(rawName || "").trim()) continue;
    const name = namedCanvasStore(rawName);
    if (!name || name === current) continue;
    const mtime = canvasBoardMtime(file);
    const prev = byName.get(name);
    if (prev && (Number(prev.mtime) || 0) >= mtime) continue;
    byName.set(name, {
      name,
      mtime,
      folder: folderMatch ? `Canvas/${name}` : folder,
    });
  }
  return rankCanvasBoardsByMtime([...byName.values()]);
}

export function resolveCanvasTabOpen({ replace = false, currentTabId = "", nextName = "" } = {}) {
  const name = slugifyCanvasName(nextName);
  if (replace) {
    return { action: "replace", tabId: String(currentTabId || "__canvas__"), name };
  }
  return { action: "new-tab", tabId: "", name };
}

export function toImageLocal(bounds, pos) {
  const w = bounds?.w || 1;
  const h = bounds?.h || 1;
  return { u: (pos.x - bounds.x) / w, v: (pos.y - bounds.y) / h };
}

export function fromImageLocal(bounds, local) {
  return {
    x: bounds.x + (local.u ?? local.x ?? 0) * bounds.w,
    y: bounds.y + (local.v ?? local.y ?? 0) * bounds.h,
  };
}

export function strokePathLength(points) {
  const pts = Array.isArray(points) ? points : [];
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const dx = Number(pts[i]?.x) - Number(pts[i - 1]?.x);
    const dy = Number(pts[i]?.y) - Number(pts[i - 1]?.y);
    if (Number.isFinite(dx) && Number.isFinite(dy)) len += Math.hypot(dx, dy);
  }
  return len;
}

/** Real ink vs leftover click-dots, zero-length connectors, or empty preview nodes. */
export function canvasElementHasInk(el) {
  if (!el || typeof el !== "object") return false;
  const type = el.type;
  if (type === "pen") return strokePathLength(el.points) >= MIN_STROKE_INK;
  if (CONNECTOR_TYPES.has(type) || type === "edge-mark") {
    const x1 = Number(el.x1);
    const y1 = Number(el.y1);
    const x2 = Number(el.x2);
    const y2 = Number(el.y2);
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      return Math.hypot(x2 - x1, y2 - y1) > MIN_CONNECTOR_INK;
    }
    return !!(el.fromId || el.toId);
  }
  if (type === "group-link") {
    return (el.memberIds || []).length >= 2 || !!(String(el.relation || el.linkName || "").trim());
  }
  if (type === "image") {
    const b = el.bounds;
    return !!(el.dataUrl || (b && Number(b.w) > 1 && Number(b.h) > 1));
  }
  if (NODE_TYPES.has(type)) {
    const b = el.bounds;
    if (b && Number(b.w) > 8 && Number(b.h) > 8) return true;
    return !!(String(el.text || "").trim() || el.tag);
  }
  if (el.points) return strokePathLength(el.points) >= MIN_STROKE_INK;
  const b = el.bounds;
  return !!(b && Number(b.w) > 0 && Number(b.h) > 0);
}

export function sanitizeCanvasElements(list) {
  return (Array.isArray(list) ? list : []).filter(canvasElementHasInk);
}

export function canvasPointFromClient(canvas, clientX, clientY) {
  if (!canvas) return { x: 0, y: 0 };
  const r = typeof canvas.getBoundingClientRect === "function"
    ? canvas.getBoundingClientRect()
    : { left: 0, top: 0, width: Number(canvas.width) || 0, height: Number(canvas.height) || 0 };
  const cssW = Math.max(1, Number(r.width) || Number(canvas.width) || 1);
  const cssH = Math.max(1, Number(r.height) || Number(canvas.height) || 1);
  const sx = (Number(canvas.width) || cssW) / cssW;
  const sy = (Number(canvas.height) || cssH) / cssH;
  const x = (Number(clientX) - (Number(r.left) || 0)) * sx;
  const y = (Number(clientY) - (Number(r.top) || 0)) * sy;
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

export const CANVAS_VIEW_ZOOM_MIN = 0.25;
export const CANVAS_VIEW_ZOOM_MAX = 8;

export function clampCanvasViewZoom(zoom, min = CANVAS_VIEW_ZOOM_MIN, max = CANVAS_VIEW_ZOOM_MAX) {
  const z = Number(zoom);
  if (!Number.isFinite(z)) return 1;
  return Math.min(max, Math.max(min, z));
}

/** Flip/shift a canvas context menu so it stays fully inside the canvas / viewport. */
export function clampCanvasMenuPosition({
  pointerX = 0,
  pointerY = 0,
  menuWidth = 210,
  menuHeight = 280,
  viewWidth = 800,
  viewHeight = 600,
  viewLeft = 0,
  viewTop = 0,
  pad = 8,
} = {}) {
  const mw = Math.max(1, Number(menuWidth) || 210);
  const mh = Math.max(1, Number(menuHeight) || 280);
  const left0 = Number(viewLeft) || 0;
  const top0 = Number(viewTop) || 0;
  const vw = Math.max(1, Number(viewWidth) || 800);
  const vh = Math.max(1, Number(viewHeight) || 600);
  const px = Number(pointerX) || 0;
  const py = Number(pointerY) || 0;
  let left = px;
  let top = py;
  if (left + mw > left0 + vw - pad) left = left0 + vw - mw - pad;
  if (left < left0 + pad) left = left0 + pad;
  if (top + mh > top0 + vh - pad) top = py - mh;
  if (top + mh > top0 + vh - pad) top = top0 + vh - mh - pad;
  if (top < top0 + pad) top = top0 + pad;
  return { left, top, flipped: top + 4 < py };
}

export function canvasViewPanAfterZoom({ areaX = 0, areaY = 0, panX = 0, panY = 0, zoom = 1, nextZoom = 1 } = {}) {
  const z = zoom || 1;
  const nz = nextZoom || 1;
  const ratio = nz / z;
  return {
    panX: areaX - (areaX - panX) * ratio,
    panY: areaY - (areaY - panY) * ratio,
  };
}

/** Keep minor/major lines readable on screen as zoom changes (still on the 20/100 lattice). */
export function canvasGridSpacing(zoom, {
  minor = GRID_MINOR,
  major = GRID_MAJOR,
  minPx = 12,
  maxPx = 72,
} = {}) {
  const z = Number(zoom);
  const scale = Number.isFinite(z) && z > 0 ? z : 1;
  const base = Number(minor) > 0 ? minor : GRID_MINOR;
  const ratio = Number(major) > 0 && base > 0 ? major / base : GRID_MAJOR / GRID_MINOR;
  let step = base;
  let guard = 0;
  while (step * scale < minPx && guard < 24) {
    step *= 2;
    guard += 1;
  }
  while (step * scale > maxPx && step / 2 >= base / 8 && guard < 48) {
    const next = step / 2;
    if (next * scale < minPx) break;
    step = next;
    guard += 1;
  }
  return { minor: step, major: step * ratio };
}

function strokeCanvasGridLines(ctx, width, height, originX, originY, screenStep) {
  if (!(screenStep > 0.75) || !Number.isFinite(screenStep)) return;
  const maxLines = 480;
  const count = Math.ceil(width / screenStep) + Math.ceil(height / screenStep) + 4;
  if (count > maxLines) return;
  const startX = originX + Math.floor((0 - originX) / screenStep) * screenStep;
  const startY = originY + Math.floor((0 - originY) / screenStep) * screenStep;
  const nx = Math.ceil((width - startX) / screenStep) + 1;
  const ny = Math.ceil((height - startY) / screenStep) + 1;
  ctx.beginPath();
  for (let i = 0; i < nx; i += 1) {
    const px = Math.round(startX + i * screenStep) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
  }
  for (let i = 0; i < ny; i += 1) {
    const py = Math.round(startY + i * screenStep) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(width, py);
  }
  ctx.stroke();
}

/** Paint a world-aligned grid that fills the given bitmap (viewport or snapshot). */
export function fillCanvasGrid(ctx, width, height, {
  bg = BG_COLOR,
  minor = GRID_MINOR,
  major = GRID_MAJOR,
  minorColor = GRID_MINOR_COLOR,
  majorColor = GRID_MAJOR_COLOR,
  originX = 0,
  originY = 0,
  zoom = 1,
} = {}) {
  if (!ctx || width < 1 || height < 1) return false;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  const z = Number(zoom);
  const scale = Number.isFinite(z) && z > 0 ? z : 1;
  const ox = Number(originX) || 0;
  const oy = Number(originY) || 0;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = minorColor;
  strokeCanvasGridLines(ctx, width, height, ox, oy, minor * scale);
  ctx.strokeStyle = majorColor;
  strokeCanvasGridLines(ctx, width, height, ox, oy, major * scale);
  ctx.restore();
  return true;
}

export function canvasWheelShouldZoom(event) {
  return !!(event?.ctrlKey || event?.metaKey);
}

export function canvasWheelZoomFactor(event) {
  const dy = Number(event?.deltaY) || 0;
  const mode = Number(event?.deltaMode) || 0;
  const px = mode === 1 ? dy * 16 : mode === 2 ? dy * 800 : dy;
  return Math.exp(-px * 0.0022);
}

export function canvasEraserCanDelete(el) {
  const type = String(el?.type || "");
  return type === "pen"
    || type === "image"
    || type === "line"
    || type === "arrow"
    || type === "link"
    || NODE_TYPES.has(type)
    || INTEREST_TYPES.has(type);
}

export function canvasElementEraseBounds(el) {
  if (el?.bounds && Number.isFinite(Number(el.bounds.x))) return el.bounds;
  if (el?.type === "line" || el?.type === "arrow" || el?.type === "link" || el?.type === "edge-mark") {
    const x1 = Number(el.x1);
    const y1 = Number(el.y1);
    const x2 = Number(el.x2);
    const y2 = Number(el.y2);
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.max(1, Math.abs(x2 - x1)),
        h: Math.max(1, Math.abs(y2 - y1)),
      };
    }
  }
  const pts = Array.isArray(el?.points) ? el.points : [];
  if (pts.length) {
    const xs = pts.map((p) => Number(p.x)).filter(Number.isFinite);
    const ys = pts.map((p) => Number(p.y)).filter(Number.isFinite);
    if (!xs.length || !ys.length) return null;
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
  }
  return null;
}

export function boundsIntersect(a, b, pad = 0) {
  if (!a || !b) return false;
  return a.x < b.x + b.w + pad
    && a.x + a.w + pad > b.x
    && a.y < b.y + b.h + pad
    && a.y + a.h + pad > b.y;
}

export function canvasIdsIntersectingEraseBox(elements, box) {
  return (Array.isArray(elements) ? elements : [])
    .filter((el) => canvasEraserCanDelete(el) && boundsIntersect(canvasElementEraseBounds(el), box, 4))
    .map((el) => el.id);
}

export function removeCanvasElementsByIds(list, ids) {
  const drop = new Set((ids || []).filter(Boolean));
  return (Array.isArray(list) ? list : []).filter((el) => !drop.has(el.id) && !drop.has(el.fromId) && !drop.has(el.toId));
}

function finiteCoord(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isCanvasImageFile(file) {
  return !!file && (
    String(file.type || "").startsWith("image/")
    || isHeicFile(file)
    || /\.(png|jpe?g|webp|gif|bmp|svg|tiff?|heic|heif)$/i.test(file.name || "")
  );
}

export function createCanvasMode({
  containerEl,
  voiceEls,
  onTranscriptChange,
  onChange,
  onDropFiles,
  fetchFile,
  onRename,
  onListCanvases,
  onOpenCanvas,
  onToggleSplit,
  onShare,
  onInvite,
  onSmartDescribe,
  onSendRegion,
  getCurrentUser,
  canEditCanvas,
  onCollabSend,
  onAuthorAction,
  snapshotOnly = false,
  title = "Canvas",
} = {}) {
  let canvas, ctx;
  let tool = loadCanvasDefaultTool();
  let pinnedTool = tool;
  let color = "#58a6ff";
  let strokeWidth = 3;
  let drawing = false;
  let startPt = null;
  let history = [];
  let redoStack = [];
  let voiceTranscript = "";
  let mediaRecorder = null;
  let recognizing = false;
  let recognition = null;
  let audioChunks = [];
  let recordingStartTime = null;
  let recordingTimer = null;
  let textInput = null;
  let elements = [];
  // VR Draw owns this document extension; desktop Canvas must round-trip it.
  let spatialBoardState = null;
  let preview = null;
  let selectedId = null;
  let selectedIds = new Set();
  let drag = null;
  let connectFrom = null;
  let hoverPort = null;
  let tagMenu = null;
  let pendingImage = null;
  let canvasTitle = slugifyCanvasName(title);
  let canvasDescription = "";
  let relationPop = null;
  let interestPop = null;
  let interestIgnoreClickUntil = 0;
  let drawParentId = null;
  const imageCache = new Map();
  let lastTagSignature = "";
  let resizeRaf = 0;
  let viewEl = null;
  let gridCanvas = null;
  let gridCtx = null;
  let viewZoom = 1;
  let viewPanX = 0;
  let viewPanY = 0;
  let viewPanDrag = null;
  let viewGestureZoom = 1;
  const viewPointers = new Map();
  let viewPinch = null;
  let cameraStream = null;
  let canvasPermission = "edit";
  let editTimeline = [];
  let applyingRemote = false;
  const remoteCursors = new Map();
  const remotePreviews = new Map();
  let presenceUserIds = [];
  let hoverAuthorId = "";
  let cursorSendAt = 0;

  function isActive() {
    return document.body.classList.contains("canvas-design-tab")
      && !containerEl?.classList.contains("hidden")
      && !containerEl?.closest(".canvas-workspace-wrap")?.classList.contains("hidden");
  }

  function nid(prefix = "el") {
    return `canvas-${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function escapeTitle(value) {
    return String(value || "Canvas")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function notifyChange() {
    onChange?.({ elements: cloneElements(), title: canvasTitle });
    renderEditTimeline();
  }

  function setTitle(name, { silent = false } = {}) {
    canvasTitle = slugifyCanvasName(name);
    const input = containerEl?.querySelector("#canvas-name-input");
    if (input && document.activeElement !== input) input.value = canvasTitle;
    if (!silent) onRename?.(canvasTitle);
  }

  function getTitle() {
    return canvasTitle;
  }

  function hideLoadPopover() {
    const pop = containerEl?.querySelector("#canvas-load-popover");
    pop?.classList.add("hidden");
    pop?.querySelectorAll(".canvas-load-action-menu").forEach((el) => el.classList.add("hidden"));
    pop?.querySelectorAll("[data-canvas-action-toggle]").forEach((el) => el.setAttribute("aria-expanded", "false"));
    containerEl?.querySelector("#canvas-load-more-btn")?.setAttribute("aria-expanded", "false");
  }

  function hideShareSettings() {
    containerEl?.querySelector("[data-canvas-share-settings]")?.classList.add("hidden");
    containerEl?.querySelector("[data-canvas-share='settings']")?.setAttribute("aria-expanded", "false");
  }

  function hideSharePopover() {
    containerEl?.querySelector("#canvas-share-popover")?.classList.add("hidden");
    containerEl?.querySelector("#canvas-share-btn")?.setAttribute("aria-expanded", "false");
    hideShareSettings();
  }

  function hideInvitePopover() {
    containerEl?.querySelector("#canvas-invite-popover")?.classList.add("hidden");
    containerEl?.querySelector("#canvas-invite-btn")?.setAttribute("aria-expanded", "false");
  }

  function localUser() {
    return getCurrentUser?.() || {};
  }

  function localUserId() {
    return String(localUser()?.id || "").trim();
  }

  function canMutateCanvas() {
    if (canEditCanvas?.() === false) return false;
    return canvasShareModeAllowsEdit(canvasPermission);
  }

  function emitCollab(type, extra = {}) {
    if (applyingRemote || typeof onCollabSend !== "function") return;
    onCollabSend({ type, board: canvasTitle, ...extra });
  }

  function stampNew(el) {
    stampCanvasAuthor(el, localUser());
    return el;
  }

  function recordEdit(el, action = "draw") {
    const user = localUser();
    if (!user?.id || !el) return;
    editTimeline = appendCanvasEditEvent(editTimeline, {
      userId: user.id,
      displayName: user.display_name || "You",
      avatarUrl: user.avatar_url || "",
      action,
      elementType: el.type || "",
    });
  }

  function setShareStatus(text, kind = "") {
    const status = containerEl?.querySelector("[data-canvas-share-status]");
    if (!status) return;
    status.textContent = text || "";
    status.className = `canvas-share-status muted${kind ? ` ${kind}` : ""}`;
  }

  function selectedShareMode() {
    return containerEl?.querySelector("[data-share-mode]:checked")?.getAttribute("data-share-mode") || "view";
  }

  function syncShareModeUi(mode) {
    const next = mode === "edit" ? "edit" : mode === "remix" ? "remix" : "view";
    containerEl?.querySelectorAll("[data-share-mode]").forEach((input) => {
      input.checked = input.getAttribute("data-share-mode") === next;
    });
  }

  function closeLoadActionMenus(exceptRow = null) {
    const pop = containerEl?.querySelector("#canvas-load-popover");
    pop?.querySelectorAll(".canvas-load-row").forEach((row) => {
      const keep = row === exceptRow;
      row.querySelector(".canvas-load-action-menu")?.classList.toggle("hidden", !keep);
      row.querySelector("[data-canvas-action-toggle]")?.setAttribute("aria-expanded", keep ? "true" : "false");
    });
  }

  function renderLoadPopover(entries) {
    const pop = containerEl?.querySelector("#canvas-load-popover");
    if (!pop) return;
    const rows = Array.isArray(entries) ? entries : [];
    if (!rows.length) {
      pop.innerHTML = `<p class="canvas-load-empty">No other canvases in this project</p>`;
      return;
    }
    pop.innerHTML = `<div class="canvas-load-list">${rows.map((row) => {
      const name = slugifyCanvasName(row?.name);
      const encoded = encodeURIComponent(name);
      const label = escapeTitle(name);
      return `<div class="canvas-load-row" data-canvas-name="${encoded}">
        <button type="button" class="canvas-load-name" title="Load ${label} in this viewer" data-canvas-open="${encoded}" data-canvas-mode="replace">${label}</button>
        <div class="canvas-load-action">
          <button type="button" class="canvas-tool-btn canvas-load-action-btn" data-canvas-action-toggle="${encoded}" aria-haspopup="menu" aria-expanded="false" title="Open ${label}">Open ▾</button>
          <div class="canvas-load-action-menu hidden" role="menu">
            <button type="button" role="menuitem" data-canvas-open="${encoded}" data-canvas-mode="replace" title="Show this canvas in the current viewer. Does not change files.">Replace viewer</button>
            <button type="button" role="menuitem" data-canvas-open="${encoded}" data-canvas-mode="new-tab" title="Open this canvas in another tab">New tab</button>
          </div>
        </div>
      </div>`;
    }).join("")}</div>`;
  }

  async function showLoadPopover() {
    const pop = containerEl?.querySelector("#canvas-load-popover");
    const btn = containerEl?.querySelector("#canvas-load-more-btn");
    if (!pop || !btn) return;
    const opening = pop.classList.contains("hidden");
    if (!opening) {
      hideLoadPopover();
      return;
    }
    hideSharePopover();
    pop.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
    pop.innerHTML = `<p class="canvas-load-empty">Loading canvases…</p>`;
    try {
      const entries = await onListCanvases?.();
      renderLoadPopover(entries);
    } catch {
      renderLoadPopover([]);
    }
  }

  function bindNameAndLoad() {
    const input = containerEl.querySelector("#canvas-name-input");
    const pop = containerEl.querySelector("#canvas-load-popover");
    let renameTimer = 0;
    const cancelPendingRename = () => {
      if (!renameTimer) return;
      window.clearTimeout(renameTimer);
      renameTimer = 0;
    };
    const flushRename = () => {
      cancelPendingRename();
      if (!input) return;
      const next = slugifyCanvasName(input.value);
      if (!next) {
        input.value = canvasTitle;
        return;
      }
      if (next !== canvasTitle) setTitle(next);
    };
    input?.addEventListener("input", () => {
      cancelPendingRename();
      renameTimer = window.setTimeout(flushRename, CANVAS_NAME_DEBOUNCE_MS);
    });
    input?.addEventListener("blur", flushRename);
    input?.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        ev.preventDefault();
        input.blur();
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        input.value = canvasTitle;
        input.blur();
      }
    });
    const loadBtn = containerEl.querySelector("#canvas-load-more-btn");
    loadBtn?.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    loadBtn?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void showLoadPopover();
    });
    pop?.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    pop?.addEventListener("mousedown", (ev) => ev.stopPropagation());
    pop?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const toggle = ev.target?.closest?.("[data-canvas-action-toggle]");
      if (toggle) {
        ev.preventDefault();
        const row = toggle.closest(".canvas-load-row");
        const menu = row?.querySelector(".canvas-load-action-menu");
        const opening = !!menu?.classList.contains("hidden");
        closeLoadActionMenus(opening ? row : null);
        return;
      }
      const openBtn = ev.target?.closest?.("[data-canvas-open]");
      if (!openBtn) {
        closeLoadActionMenus(null);
        return;
      }
      ev.preventDefault();
      const name = slugifyCanvasName(decodeURIComponent(openBtn.dataset.canvasOpen || ""));
      const replace = openBtn.dataset.canvasMode !== "new-tab";
      cancelPendingRename();
      hideLoadPopover();
      if (name) onOpenCanvas?.(name, { replace });
    });
    document.addEventListener("click", (ev) => {
      if (ev.target?.closest?.(".canvas-load-popover, #canvas-load-more-btn, .canvas-load-action-menu")) return;
      hideLoadPopover();
      if (ev.target?.closest?.("#canvas-share-popover, #canvas-share-btn")) return;
      hideSharePopover();
      if (ev.target?.closest?.("#canvas-invite-popover, #canvas-invite-btn, #canvas-author-hover")) return;
      hideInvitePopover();
    });
  }

  function triggerBlobDownload(blob, filename) {
    triggerTrackedBlobDownload(blob, filename, canvasDownloadCreated);
  }

  async function withCleanSnapshot(fn) {
    const oldSelection = selectedId;
    const oldTool = tool;
    selectedId = null;
    tool = "select";
    redraw();
    try {
      return await fn();
    } finally {
      selectedId = oldSelection;
      tool = oldTool;
      redraw();
    }
  }

  function snapshotElement({ mime = "image/png", quality = 0.92, maxDim = 0 } = {}) {
    if (!canvas) return null;
    const srcW = canvas.width || 1;
    const srcH = canvas.height || 1;
    const cap = Number(maxDim) > 0 ? Number(maxDim) : Math.max(srcW, srcH, 1);
    const scale = Math.min(1, cap / Math.max(srcW, srcH, 1));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const snap = document.createElement("canvas");
    snap.width = w;
    snap.height = h;
    const sctx = snap.getContext("2d");
    if (!sctx) return canvas;
    sctx.fillStyle = BG_COLOR;
    sctx.fillRect(0, 0, w, h);
    sctx.drawImage(canvas, 0, 0, w, h);
    snap._exportMime = mime;
    snap._exportQuality = quality;
    return snap;
  }

  function blobFromCanvas(el, mime, quality) {
    return new Promise((resolve, reject) => {
      if (!el) {
        reject(new Error("Nothing to download."));
        return;
      }
      if (typeof el.toBlob === "function") {
        el.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Could not export this canvas."));
        }, mime, quality);
        return;
      }
      try {
        const dataUrl = el.toDataURL(mime, quality);
        const comma = dataUrl.indexOf(",");
        const binary = atob(comma >= 0 ? dataUrl.slice(comma + 1) : "");
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        resolve(new Blob([bytes], { type: mime }));
      } catch (err) {
        reject(err);
      }
    });
  }

  async function getExportBlob(format = "png") {
    const kind = String(format || "png").toLowerCase();
    if (kind === "json") {
      const payload = { name: canvasTitle, state: exportState() };
      return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    }
    const mime = kind === "jpg" || kind === "jpeg" ? "image/jpeg" : kind === "webp" ? "image/webp" : "image/png";
    const quality = mime === "image/png" ? undefined : 0.92;
    return withCleanSnapshot(() => blobFromCanvas(snapshotElement({ mime, quality }), mime, quality));
  }

  async function downloadCanvas(format) {
    const kind = String(format || "png").toLowerCase();
    const ext = kind === "jpeg" ? "jpg" : kind;
    const blob = await getExportBlob(kind);
    triggerBlobDownload(blob, `${canvasTitle || "Canvas"}.${ext}`);
  }

  function bindShare() {
    const btn = containerEl.querySelector("#canvas-share-btn");
    const pop = containerEl.querySelector("#canvas-share-popover");
    if (!btn || !pop) return;
    let preparedShare = null;
    const runShare = async (action) => {
      if (typeof onShare !== "function") throw new Error("Save this canvas to a project first.");
      const shareMode = selectedShareMode();
      if (action === "share-discord") setShareStatus("Preparing Discord share…");
      else if (action === "set-mode") setShareStatus("Saving permissions…");
      else setShareStatus("Creating share link…");
      try {
        const result = await onShare({ action, shareMode, share: preparedShare });
        if (result?.cancelled) {
          setShareStatus("");
          return;
        }
        if (result?.share_mode) syncShareModeUi(result.share_mode);
        if (result?.share_url || result?.token) preparedShare = { ...(preparedShare || {}), ...result };
        if (action === "copy-link") setShareStatus("Share link copied.");
        else if (action === "share-discord") setShareStatus("Copied — Discord is open. Paste in a channel.");
        else if (action === "set-mode") setShareStatus("Permissions saved.");
        else setShareStatus("");
        return result;
      } catch (err) {
        setShareStatus(err?.message || "Could not share canvas.", "error");
        throw err;
      }
    };
    btn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      hideLoadPopover();
      const opening = pop.classList.contains("hidden");
      if (!opening) {
        hideSharePopover();
        return;
      }
      pop.classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
      setShareStatus("");
    });
    pop.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    pop.addEventListener("click", (ev) => ev.stopPropagation());
    pop.querySelectorAll("[data-canvas-share]").forEach((item) => {
      item.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const action = item.dataset.canvasShare;
        if (action === "settings") {
          const settings = pop.querySelector("[data-canvas-share-settings]");
          const opening = settings?.classList.contains("hidden");
          if (opening) {
            try { await runShare("prepare"); } catch { return; }
            settings?.classList.remove("hidden");
            item.setAttribute("aria-expanded", "true");
          } else {
            hideShareSettings();
          }
          return;
        }
        try { await runShare(action); } catch { /* status already set */ }
      });
    });
    pop.querySelectorAll("[data-share-mode]").forEach((input) => {
      input.addEventListener("change", () => {
        void runShare("set-mode").catch(() => { });
      });
    });
    pop.querySelectorAll("[data-canvas-download]").forEach((item) => {
      item.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const format = item.dataset.canvasDownload;
        setShareStatus(`Downloading ${String(format || "").toUpperCase()}…`);
        try {
          await downloadCanvas(kindForDownload(format));
          setShareStatus(`Downloaded ${String(format || "").toUpperCase()}.`);
        } catch (err) {
          setShareStatus(err?.message || "Could not download.", "error");
        }
      });
    });
  }

  function setInviteStatus(text, kind = "") {
    const status = containerEl?.querySelector("[data-canvas-invite-status]");
    if (!status) return;
    status.textContent = text || "";
    status.className = `canvas-share-status muted${kind ? ` ${kind}` : ""}`;
  }

  function inviteKind() {
    return containerEl?.querySelector("[data-canvas-invite-kind].is-active")?.getAttribute("data-canvas-invite-kind") || "user";
  }

  function renderInviteResults(data = {}) {
    const box = containerEl?.querySelector("#canvas-invite-results");
    if (!box) return;
    const kind = inviteKind();
    const rows = kind === "user"
      ? (data.users || [])
      : kind === "team"
        ? (data.teams || [])
        : (data.workspaces || []);
    if (!rows.length) {
      box.innerHTML = `<p class="muted small">No matches. Try another name or @handle.</p>`;
      return;
    }
    box.innerHTML = rows.map((row) => {
      const id = escapeHtml(row.id || row.user_id || "");
      const name = escapeHtml(row.display_name || row.name || row.email || "Someone");
      const handle = row.handle ? `@${escapeHtml(row.handle)}` : "";
      const avatar = row.avatar_url
        ? `<img src="${escapeHtml(row.avatar_url)}" alt="" />`
        : `<span>${name.slice(0, 1)}</span>`;
      return `<button type="button" class="canvas-invite-result" data-canvas-invite-pick="${id}" data-kind="${kind}" data-email="${escapeHtml(row.email || "")}">
        <span class="canvas-invite-result-avatar">${avatar}</span>
        <span><strong>${name}</strong>${handle ? `<span class="muted"> ${handle}</span>` : ""}</span>
      </button>`;
    }).join("");
  }

  function bindInvite() {
    const btn = containerEl.querySelector("#canvas-invite-btn");
    const pop = containerEl.querySelector("#canvas-invite-popover");
    if (!btn || !pop) return;
    const searchInput = pop.querySelector("#canvas-invite-search");
    const remixBtn = pop.querySelector("[data-canvas-invite='remix']");
    const syncRemixBtn = () => {
      remixBtn?.classList.toggle("hidden", !canvasShareModeAllowsRemix(canvasPermission) || canvasShareModeAllowsEdit(canvasPermission));
    };
    syncRemixBtn();
    btn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      hideLoadPopover();
      hideSharePopover();
      const opening = pop.classList.contains("hidden");
      if (!opening) {
        hideInvitePopover();
        return;
      }
      pop.classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
      setInviteStatus("");
      syncRemixBtn();
      searchInput?.focus();
    });
    pop.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    pop.addEventListener("click", (ev) => ev.stopPropagation());
    pop.querySelectorAll("[data-canvas-invite-kind]").forEach((tab) => {
      tab.addEventListener("click", () => {
        pop.querySelectorAll("[data-canvas-invite-kind]").forEach((other) => other.classList.toggle("is-active", other === tab));
        const box = pop.querySelector("#canvas-invite-results");
        if (box) box.innerHTML = "";
        if (searchInput?.value.trim()) void runInviteSearch();
      });
    });
    const runInviteSearch = async () => {
      const query = searchInput?.value?.trim() || "";
      setInviteStatus("Searching…");
      try {
        const data = await onInvite?.({ action: "search", kind: inviteKind(), query, shareMode: selectedShareMode() });
        renderInviteResults(data || {});
        setInviteStatus(query ? "" : "Type a name, @handle, team, or workspace.");
      } catch (err) {
        setInviteStatus(err?.message || "Could not search.", "error");
      }
    };
    pop.querySelector("[data-canvas-invite='search']")?.addEventListener("click", () => void runInviteSearch());
    searchInput?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void runInviteSearch();
      }
    });
    pop.addEventListener("click", async (ev) => {
      const pick = ev.target.closest?.("[data-canvas-invite-pick]");
      if (!pick) return;
      ev.preventDefault();
      const kind = pick.getAttribute("data-kind") || inviteKind();
      setInviteStatus("Inviting…");
      try {
        await onInvite?.({
          action: "invite",
          kind,
          userId: kind === "user" ? pick.getAttribute("data-canvas-invite-pick") : "",
          email: pick.getAttribute("data-email") || "",
          teamId: kind === "user" ? "" : pick.getAttribute("data-canvas-invite-pick"),
          shareMode: selectedShareMode(),
        });
        setInviteStatus("Invite sent.");
      } catch (err) {
        setInviteStatus(err?.message || "Could not invite.", "error");
      }
    });
    pop.querySelector("[data-canvas-invite='copy-link']")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try {
        const result = await onShare?.({ action: "copy-link", shareMode: selectedShareMode() });
        if (result?.cancelled) return;
        setInviteStatus("Share link copied.");
      } catch (err) {
        setInviteStatus(err?.message || "Could not copy link.", "error");
      }
    });
    pop.querySelectorAll("[data-share-mode]").forEach((input) => {
      input.addEventListener("change", () => {
        syncShareModeUi(selectedShareMode());
        void onShare?.({ action: "set-mode", shareMode: selectedShareMode() }).catch(() => { });
      });
    });
    remixBtn?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      setInviteStatus("Remixing into your workspace…");
      try {
        await onInvite?.({ action: "remix", shareMode: selectedShareMode() });
        setInviteStatus("Remixed into your workspace.");
      } catch (err) {
        setInviteStatus(err?.message || "Could not remix.", "error");
      }
    });
  }

  function kindForDownload(format) {
    const kind = String(format || "png").toLowerCase();
    if (kind === "jpeg") return "jpg";
    return kind;
  }

  function cloneElements(list = elements) {
    return list.map((el) => ({
      ...el,
      bounds: el.bounds ? { ...el.bounds } : null,
      localBounds: el.localBounds ? { ...el.localBounds } : null,
      points: el.points ? el.points.map((p) => ({ ...p })) : null,
      localPoints: el.localPoints ? el.localPoints.map((p) => ({ ...p })) : null,
    }));
  }

  function addElement(el) {
    stampNew(el);
    if (!el.authorUserId && localUserId()) el.authorUserId = localUserId();
    elements.push(el);
    recordEdit(el, "draw");
    emitCollab("canvas.patch", { op: "upsert", element: el });
    return el;
  }

  function sendLiveCursor(pos) {
    const now = Date.now();
    if (now - cursorSendAt < 50) return;
    cursorSendAt = now;
    emitCollab("canvas.cursor", { x: pos.x, y: pos.y });
  }

  function hideAuthorHover() {
    hoverAuthorId = "";
    containerEl?.querySelector("#canvas-author-hover")?.classList.add("hidden");
  }

  function updateAuthorHover(pos) {
    const card = containerEl?.querySelector("#canvas-author-hover");
    if (!card) return;
    const hit = findElementAt(pos);
    if (!shouldShowCanvasAuthorHover(hit, localUserId())) {
      hideAuthorHover();
      return;
    }
    const authorId = canvasObjectAuthorId(hit);
    if (hoverAuthorId === authorId && !card.classList.contains("hidden")) {
      card.style.left = `${Math.max(8, pos.x + 12)}px`;
      card.style.top = `${Math.max(8, pos.y + 12)}px`;
      return;
    }
    hoverAuthorId = authorId;
    const name = escapeHtml(hit.authorName || "Collaborator");
    const avatar = hit.authorAvatar
      ? `<img src="${escapeHtml(hit.authorAvatar)}" alt="" />`
      : `<span>${name.slice(0, 1)}</span>`;
    card.innerHTML = `<button type="button" class="canvas-author-hover-btn" data-author-id="${escapeHtml(authorId)}" title="View ${name}">
      <span class="canvas-author-hover-avatar">${avatar}</span>
    </button>
    <div class="canvas-author-hover-menu hidden" data-author-menu>
      <button type="button" data-author-act="profile">View public profile</button>
      <button type="button" data-author-act="add">Add</button>
      <button type="button" data-author-act="dm">Message</button>
    </div>`;
    card.classList.remove("hidden");
    card.style.left = `${Math.max(8, pos.x + 12)}px`;
    card.style.top = `${Math.max(8, pos.y + 12)}px`;
    const btn = card.querySelector("[data-author-id]");
    const menu = card.querySelector("[data-author-menu]");
    btn?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      menu?.classList.toggle("hidden");
    });
    card.querySelectorAll("[data-author-act]").forEach((item) => {
      item.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        onAuthorAction?.({
          action: item.getAttribute("data-author-act"),
          userId: authorId,
          displayName: hit.authorName || "",
          avatarUrl: hit.authorAvatar || "",
        });
        menu?.classList.add("hidden");
      });
    });
  }

  function renderRemoteCursors() {
    const layer = containerEl?.querySelector("#canvas-collab-cursors");
    if (!layer) return;
    layer.innerHTML = [...remoteCursors.values()].map((row) => {
      const name = escapeHtml(row.displayName || "User");
      const avatar = row.avatarUrl
        ? `<img src="${escapeHtml(row.avatarUrl)}" alt="" />`
        : `<span>${name.slice(0, 1)}</span>`;
      return `<div class="canvas-collab-cursor" style="left:${Number(row.x) || 0}px;top:${Number(row.y) || 0}px;--cursor:${escapeHtml(row.color || "#58a6ff")}">
        <span class="canvas-collab-cursor-avatar">${avatar}</span>
        <span class="canvas-collab-cursor-name">${name}</span>
      </div>`;
    }).join("");
  }

  function renderEditTimeline() {
    const bar = containerEl?.querySelector("#canvas-edit-timeline");
    if (!bar) return;
    const show = shouldShowCanvasEditTimeline({
      elements,
      timeline: editTimeline,
      presenceUserIds,
      localUserId: localUserId(),
    });
    bar.hidden = !show;
    bar.classList.toggle("hidden", !show);
    if (!show) {
      bar.innerHTML = "";
      return;
    }
    const rows = editTimeline.slice(-24).reverse();
    bar.innerHTML = rows.map((event) => {
      const name = escapeHtml(event.displayName || "Someone");
      const avatar = event.avatarUrl
        ? `<img src="${escapeHtml(event.avatarUrl)}" alt="" />`
        : `<span>${name.slice(0, 1)}</span>`;
      const when = event.at ? new Date(event.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
      const what = escapeHtml([event.action, event.elementType].filter(Boolean).join(" "));
      return `<button type="button" class="canvas-edit-chip" data-author-id="${escapeHtml(event.userId || "")}" title="${name} · ${what} · ${escapeHtml(when)}">
        <span class="canvas-edit-chip-avatar">${avatar}</span>
        <span class="canvas-edit-chip-copy"><strong>${name}</strong> ${what}</span>
        <span class="canvas-edit-chip-when">${escapeHtml(when)}</span>
      </button>`;
    }).join("");
    bar.querySelectorAll("[data-author-id]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const uid = chip.getAttribute("data-author-id");
        if (!uid || uid === localUserId()) return;
        onAuthorAction?.({ action: "profile", userId: uid });
      });
    });
  }

  function setCanvasPermission(mode) {
    canvasPermission = normalizeCanvasShareMode(mode || "edit");
    containerEl?.classList.toggle("canvas-collab-readonly", !canMutateCanvas());
    const remixBtn = containerEl?.querySelector("[data-canvas-invite='remix']");
    remixBtn?.classList.toggle("hidden", !canvasShareModeAllowsRemix(canvasPermission) || canvasShareModeAllowsEdit(canvasPermission));
  }

  function setCollabPresence(users = []) {
    presenceUserIds = (Array.isArray(users) ? users : []).map((u) => String(u.id || u.user_id || "")).filter(Boolean);
    renderEditTimeline();
  }

  function applyCollabMessage(msg) {
    if (msg?.board && canvasTitle && msg.board !== canvasTitle) return;
    applyingRemote = true;
    try {
      if (msg.type === "canvas.cursor") {
        if (msg.user_id && msg.user_id !== localUserId()) {
          remoteCursors.set(msg.user_id, {
            id: msg.user_id,
            displayName: msg.display_name,
            avatarUrl: msg.avatar_url,
            color: msg.color,
            x: msg.x,
            y: msg.y,
          });
          renderRemoteCursors();
        }
        return;
      }
      if (msg.type === "canvas.preview") {
        if (msg.user_id && msg.user_id !== localUserId()) {
          remotePreviews.set(msg.user_id, msg.preview);
          redraw();
        }
        return;
      }
      if (msg.type === "canvas.patch" || msg.type === "canvas.delete") {
        const next = applyCanvasCollabPatch(elements, msg.type === "canvas.delete" ? { op: "delete", ids: msg.ids } : msg);
        elements = next;
        if (msg.user_id && msg.user_id !== localUserId()) {
          editTimeline = appendCanvasEditEvent(editTimeline, {
            userId: msg.user_id,
            displayName: msg.display_name,
            avatarUrl: msg.avatar_url,
            action: msg.op === "delete" ? "erase" : "draw",
            elementType: msg.element?.type || "",
          });
          remotePreviews.delete(msg.user_id);
        }
        renderEditTimeline();
        redraw();
      }
    } finally {
      applyingRemote = false;
    }
  }

  function init() {
    if (!containerEl) return;
    if (snapshotOnly) {
      canvas = document.createElement("canvas");
      ctx = canvas.getContext("2d", { alpha: true });
      canvas.width = 900;
      canvas.height = 600;
      return;
    }
    containerEl.innerHTML = `
      <div class="canvas-workspace">
        <div class="canvas-area" id="canvas-draw-area">
          <div class="canvas-palette-stack">
            <div class="canvas-name-block">
              <div class="canvas-name-row">
                <input type="text" class="canvas-name-input" id="canvas-name-input" maxlength="80" autocomplete="off" spellcheck="false" aria-label="Canvas name" title="Canvas name — saves to Reference Files" value="${escapeTitle(canvasTitle)}" />
                <button type="button" class="canvas-tool-btn canvas-load-more-btn" id="canvas-load-more-btn" aria-haspopup="true" aria-expanded="false" title="Load another canvas from this project">Canvases ▾</button>
              </div>
              <div class="canvas-name-actions">
                <button type="button" class="canvas-tool-btn canvas-share-btn" id="canvas-share-btn" aria-haspopup="true" aria-expanded="false" title="Share canvas" aria-label="Share canvas">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"></path>
                    <polyline points="16 6 12 2 8 6"></polyline>
                    <line x1="12" y1="2" x2="12" y2="15"></line>
                  </svg>
                </button>
              </div>
              <div class="canvas-load-popover hidden" id="canvas-load-popover" role="menu" aria-label="Project canvases"></div>
              <div class="canvas-share-popover hidden" id="canvas-share-popover" role="dialog" aria-label="Share canvas">
                <div class="canvas-share-row">
                  <button type="button" class="canvas-tool-btn canvas-share-link-btn" data-canvas-share="copy-link">Copy share link</button>
                  <button type="button" class="canvas-tool-btn canvas-share-gear-btn" data-canvas-share="settings" aria-label="Share permissions" aria-expanded="false" title="Share permissions">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 1-2 0 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 1 0-2 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 1 2 0 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0 .33 1.82 1.65 1.65 0 0 1 0 2Z"></path>
                    </svg>
                  </button>
                </div>
                <div class="canvas-share-settings hidden" data-canvas-share-settings>
                  <strong>Share permissions</strong>
                  <label class="canvas-share-opt"><input type="radio" name="canvas-share-mode" value="view" data-share-mode="view" checked><span><strong>View</strong><span class="muted">See the canvas. Cannot edit or remix.</span></span></label>
                  <label class="canvas-share-opt"><input type="radio" name="canvas-share-mode" value="remix" data-share-mode="remix"><span><strong>View and remix</strong><span class="muted">Copy into their own canvas. Cannot edit the original.</span></span></label>
                  <label class="canvas-share-opt"><input type="radio" name="canvas-share-mode" value="edit" data-share-mode="edit"><span><strong>View, edit, remix</strong><span class="muted">Live-edit this canvas and remix a copy.</span></span></label>
                </div>
                <button type="button" class="canvas-tool-btn canvas-share-discord-btn" data-canvas-share="share-discord">Share to Discord</button>
                <div class="canvas-share-download">
                  <span>Download</span>
                  <div class="canvas-share-formats" role="group" aria-label="Download format">
                    <button type="button" class="canvas-tool-btn" data-canvas-download="png">PNG</button>
                    <button type="button" class="canvas-tool-btn" data-canvas-download="jpg">JPG</button>
                    <button type="button" class="canvas-tool-btn" data-canvas-download="webp">WebP</button>
                    <button type="button" class="canvas-tool-btn" data-canvas-download="json">JSON</button>
                  </div>
                </div>
                <p class="canvas-share-status muted" data-canvas-share-status></p>
              </div>
            </div>
            <button type="button" class="canvas-tool-btn canvas-split-btn" id="canvas-split-btn" aria-pressed="false" title="Show canvas beside the 3D viewport">◫ Split view</button>
            <div class="canvas-invite-wrap">
            <button type="button" class="canvas-tool-btn canvas-invite-btn" id="canvas-invite-btn" aria-haspopup="true" aria-expanded="false" title="Invite a team, workspace, or person to this canvas">Invite</button>
            <div class="canvas-invite-popover hidden" id="canvas-invite-popover" role="dialog" aria-label="Invite to canvas">
              <div class="canvas-invite-kinds" role="tablist" aria-label="Invite kind">
                <button type="button" class="canvas-tool-btn is-active" data-canvas-invite-kind="user">User</button>
                <button type="button" class="canvas-tool-btn" data-canvas-invite-kind="team">Team</button>
                <button type="button" class="canvas-tool-btn" data-canvas-invite-kind="workspace">Workspace</button>
              </div>
              <div class="canvas-invite-search-row">
                <input type="search" id="canvas-invite-search" placeholder="Search people, teams, or workspaces" autocomplete="off" spellcheck="false" />
                <button type="button" class="canvas-tool-btn" data-canvas-invite="search">Search</button>
              </div>
              <div class="canvas-invite-results" id="canvas-invite-results" role="listbox"></div>
              <div class="canvas-share-row">
                <button type="button" class="canvas-tool-btn canvas-share-link-btn" data-canvas-invite="copy-link">Copy share link</button>
              </div>
              <div class="canvas-share-settings" data-canvas-invite-settings>
                <strong>Share link permissions</strong>
                <label class="canvas-share-opt"><input type="radio" name="canvas-share-mode" value="view" data-share-mode="view"><span><strong>View</strong><span class="muted">See the canvas. Cannot edit or remix.</span></span></label>
                <label class="canvas-share-opt"><input type="radio" name="canvas-share-mode" value="remix" data-share-mode="remix"><span><strong>View and remix</strong><span class="muted">Copy into their own canvas. Cannot edit the original.</span></span></label>
                <label class="canvas-share-opt"><input type="radio" name="canvas-share-mode" value="edit" data-share-mode="edit"><span><strong>View, edit, remix</strong><span class="muted">Live-edit this canvas and remix a copy.</span></span></label>
              </div>
              <button type="button" class="canvas-tool-btn hidden" data-canvas-invite="remix">Remix into my workspace</button>
              <p class="canvas-share-status muted" data-canvas-invite-status></p>
            </div>
            </div>
            <div class="canvas-toolbar-popup" role="toolbar" aria-label="Drawing tools">
            <div class="canvas-toolbar-row canvas-toolbar-row--tools">
            <div class="canvas-tool-group">
              <button type="button" class="canvas-tool-btn" data-tool="select" title="Select / move (V). Right-click to pin as default.">✥</button>
              <button type="button" class="canvas-tool-btn" data-tool="pen" title="Pen (P). Right-click to pin as default.">✏️</button>
              <button type="button" class="canvas-tool-btn" data-tool="eraser" title="Eraser (E) — click or drag-select drawings, lines, arrows, or images to delete. Right-click to pin as default.">🧹</button>
            </div>
            <div class="canvas-tool-sep"></div>
            <div class="canvas-tool-group">
              <button type="button" class="canvas-tool-btn" data-tool="line" title="Connector line (L). Right-click to pin as default.">╱</button>
              <button type="button" class="canvas-tool-btn" data-tool="arrow" title="Connector arrow (A). Right-click to pin as default.">→</button>
              <button type="button" class="canvas-tool-btn" data-tool="link" title="Dotted image link — connect photos and describe how they relate">⋯</button>
            </div>
            <div class="canvas-tool-sep"></div>
            <div class="canvas-tool-group" role="group" aria-label="Views and faces of interest">
              <button type="button" class="canvas-tool-btn" data-tool="view-mark" title="View tag — mark Top / Front / Side so AI knows which camera this is">View</button>
              <button type="button" class="canvas-tool-btn" data-tool="face-mark" title="Face of interest — dotted box on the face you want edited (extrude, cut, or split)">Face</button>
              <button type="button" class="canvas-tool-btn" data-tool="edge-mark" title="Edge of interest — draw a line on the edge you want edited">Edge</button>
              <button type="button" class="canvas-tool-btn" data-tool="split-mark" title="Split — drag a box, or hold Shift and lasso the region to split">Split</button>
            </div>
            <div class="canvas-tool-sep"></div>
            <div class="canvas-tool-group">
              <button type="button" class="canvas-tool-btn" data-tool="rect" title="Rectangle (R). Right-click to pin as default.">▭</button>
              <button type="button" class="canvas-tool-btn" data-tool="roundrect" title="Rounded rectangle. Right-click to pin as default.">▢</button>
              <button type="button" class="canvas-tool-btn" data-tool="diamond" title="Diamond. Right-click to pin as default.">◇</button>
              <button type="button" class="canvas-tool-btn" data-tool="circle" title="Circle (1:1). Right-click to pin as default.">◯</button>
              <button type="button" class="canvas-tool-btn" data-tool="oval" title="Oval / ellipse (C). Right-click to pin as default.">⬭</button>
              <button type="button" class="canvas-tool-btn" data-tool="triangle" title="Triangle. Right-click to pin as default.">△</button>
              <button type="button" class="canvas-tool-btn" data-tool="hexagon" title="Hexagon. Right-click to pin as default.">⬡</button>
              <button type="button" class="canvas-tool-btn" data-tool="cloud" title="Cloud. Right-click to pin as default.">☁</button>
              <button type="button" class="canvas-tool-btn" data-tool="callout" title="Callout. Right-click to pin as default.">💬</button>
              <button type="button" class="canvas-tool-btn" data-tool="parallelogram" title="Parallelogram. Right-click to pin as default.">▱</button>
              <button type="button" class="canvas-tool-btn" data-tool="note" title="Sticky note. Right-click to pin as default.">🗒</button>
              <button type="button" class="canvas-tool-btn" data-tool="text" title="Text box (T). Right-click to pin as default.">T</button>
              <button type="button" class="canvas-tool-btn" data-tool="image" title="Add photos from your library">🖼</button>
              <button type="button" class="canvas-tool-btn" id="canvas-camera-btn" title="Take a photo with the webcam">📷</button>
            </div>
            <p class="canvas-media-status muted hidden" id="canvas-media-status"></p>
            </div>
            <div class="canvas-toolbar-row canvas-toolbar-row--style">
            <div class="canvas-tool-group canvas-color-group">
              <input type="color" id="canvas-color-pick" class="canvas-color-pick" value="${color}" title="Stroke color" />
              <div class="canvas-preset-colors">
                <button class="canvas-preset" data-color="#58a6ff" style="background:#58a6ff" title="Blue"></button>
                <button class="canvas-preset" data-color="#f85149" style="background:#f85149" title="Red"></button>
                <button class="canvas-preset" data-color="#3fb950" style="background:#3fb950" title="Green"></button>
                <button class="canvas-preset" data-color="#d29922" style="background:#d29922" title="Yellow"></button>
                <button class="canvas-preset" data-color="#bc8cff" style="background:#bc8cff" title="Purple"></button>
                <button class="canvas-preset" data-color="#ffffff" style="background:#ffffff" title="White"></button>
              </div>
            </div>
            <div class="canvas-tool-sep"></div>
            <div class="canvas-tool-group">
              <label class="canvas-stroke-label" title="Stroke width">
                <span>W</span>
                <input type="range" id="canvas-stroke-width" min="1" max="24" value="${strokeWidth}" class="canvas-stroke-range" />
                <span id="canvas-stroke-val">${strokeWidth}px</span>
              </label>
            </div>
            <div class="canvas-tool-sep"></div>
            <div class="canvas-tool-group">
              <button type="button" class="canvas-tool-btn" id="canvas-undo-btn" title="Undo (⌘Z)" disabled>↶</button>
              <button type="button" class="canvas-tool-btn" id="canvas-redo-btn" title="Redo (⌘⇧Z)" disabled>↷</button>
              <button type="button" class="canvas-tool-btn canvas-clear-btn" id="canvas-clear-btn" title="Clear canvas">🗑</button>
            </div>
            </div>
            </div>
            <button type="button" class="canvas-tool-btn canvas-send-ai-btn" id="canvas-attach-prompt-btn" tabindex="-1" title="Send this canvas and metadata to the AI prompt — no prompt text">Send to AI</button>
          </div>
          <input type="file" id="canvas-image-input" accept="image/*,image/heic,image/heif,.heic,.heif" hidden />
          <div class="canvas-camera-overlay hidden" id="canvas-camera-overlay">
            <video id="canvas-camera-video" class="canvas-camera-video" autoplay playsinline muted></video>
            <div class="canvas-camera-actions">
              <button type="button" class="canvas-tool-btn" id="canvas-camera-snap">Snap</button>
              <button type="button" class="canvas-tool-btn" id="canvas-camera-cancel">Cancel</button>
            </div>
            <p class="canvas-camera-status muted" id="canvas-camera-status"></p>
          </div>
          <canvas id="canvas-grid" class="canvas-grid" aria-hidden="true"></canvas>
          <div class="canvas-view" id="canvas-view">
            <canvas id="canvas-draw" class="canvas-draw" tabindex="0" aria-label="2D canvas"></canvas>
            <div class="canvas-tag-layer" id="canvas-tag-layer" aria-label="Canvas shape tags"></div>
            <div class="canvas-collab-cursors" id="canvas-collab-cursors" aria-hidden="true"></div>
            <div class="canvas-author-hover hidden" id="canvas-author-hover" role="dialog" aria-label="Author"></div>
            <div class="canvas-final-look-tip hidden" id="canvas-final-look-tip" role="tooltip">${CANVAS_FINAL_LOOK_TIP}</div>
          </div>
          <div class="canvas-edit-timeline hidden" id="canvas-edit-timeline" hidden aria-label="Canvas edit history"></div>
          <button type="button" class="canvas-smart-desc-btn" id="canvas-smart-desc-btn" title="Organize linked photos, link notes, and the final look into the AI prompt. Does not generate.">
            <span class="canvas-smart-desc-think" aria-hidden="true">
              <span class="canvas-smart-desc-spin"></span>
              <span class="canvas-smart-desc-ai">
                <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M6 1.2l.85 2.55L9.4 4.6 6.85 6.05 6 8.8l-.85-2.75L2.6 4.6l2.55-.85L6 1.2z" fill="currentColor" opacity="0.95"/>
                  <path d="M9.6 7.1l.4 1.2 1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4.4-1.2z" fill="currentColor" opacity="0.7"/>
                </svg>
              </span>
            </span>
            <span class="canvas-smart-desc-label">Smart description</span>
          </button>
        </div>
      </div>`;

    canvas = containerEl.querySelector("#canvas-draw");
    viewEl = containerEl.querySelector("#canvas-view");
    gridCanvas = containerEl.querySelector("#canvas-grid");
    gridCtx = gridCanvas?.getContext("2d", { alpha: false }) || null;
    ctx = canvas.getContext("2d", { alpha: true });
    if (canvas) canvas.tabIndex = 0;
    resizeCanvas();
    bindToolbar();
    bindCanvas();
    bindViewControls();
    bindVoice();
    bindKeyboard();
    bindActions();
    bindImageInput();
    bindNameAndLoad();
    bindShare();
    bindInvite();
    bindCamera();
    bindSmartDescribe();
    updateUndoRedo();
    setTool(loadCanvasDefaultTool(), { pickFile: false });

    const ro = new ResizeObserver(() => {
      if (!isActive()) return;
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (!isActive()) return;
        resizeCanvasKeepContent();
      });
    });
    ro.observe(containerEl.querySelector("#canvas-draw-area"));
  }

  function resizeCanvas() {
    const area = containerEl.querySelector("#canvas-draw-area");
    if (!area || !canvas) return;
    canvas.width = area.clientWidth || 900;
    canvas.height = area.clientHeight || 600;
    applyViewTransform();
    redraw();
  }

  function resizeCanvasKeepContent() {
    const area = containerEl.querySelector("#canvas-draw-area");
    if (!area || !canvas) return;
    if (!area.clientWidth || !area.clientHeight) return;
    // Fit the complete drawing when split, without moving/cropping its annotations.
    const boxes = elements.filter((el) => el.bounds).map((el) => el.bounds);
    const w = Math.max(canvas.width, area.clientWidth, ...boxes.map((b) => b.x + b.w + 24));
    const h = Math.max(canvas.height, area.clientHeight, ...boxes.map((b) => b.y + b.h + 24));
    if (canvas.width !== Math.ceil(w)) canvas.width = Math.ceil(w);
    if (canvas.height !== Math.ceil(h)) canvas.height = Math.ceil(h);
    applyViewTransform();
    redraw();
  }

  function fitScale() {
    const area = containerEl.querySelector("#canvas-draw-area");
    if (!area || !canvas) return 1;
    const aw = Math.max(1, area.clientWidth || 1);
    const ah = Math.max(1, area.clientHeight || 1);
    const cw = Math.max(1, canvas.width || 1);
    const ch = Math.max(1, canvas.height || 1);
    return Math.min(aw / cw, ah / ch);
  }

  function viewWorldZoom() {
    return fitScale() * clampCanvasViewZoom(viewZoom);
  }

  function paintViewportGrid() {
    const area = containerEl?.querySelector("#canvas-draw-area");
    if (!gridCanvas || !gridCtx || !area) return false;
    const w = Math.max(1, Math.round(area.clientWidth || 1));
    const h = Math.max(1, Math.round(area.clientHeight || 1));
    if (gridCanvas.width !== w) gridCanvas.width = w;
    if (gridCanvas.height !== h) gridCanvas.height = h;
    const zoom = viewWorldZoom();
    const spacing = canvasGridSpacing(zoom);
    return fillCanvasGrid(gridCtx, w, h, {
      originX: viewPanX,
      originY: viewPanY,
      zoom,
      minor: spacing.minor,
      major: spacing.major,
    });
  }

  function applyViewTransform() {
    if (!viewEl || !canvas) return;
    const z = viewWorldZoom();
    viewEl.style.width = `${canvas.width}px`;
    viewEl.style.height = `${canvas.height}px`;
    viewEl.style.transform = `translate(${viewPanX}px, ${viewPanY}px) scale(${z})`;
    canvas.style.width = "";
    canvas.style.height = "";
    paintViewportGrid();
  }

  function resetCanvasView() {
    viewZoom = 1;
    viewPanX = 0;
    viewPanY = 0;
    applyViewTransform();
  }

  function zoomCanvasViewAt(clientX, clientY, nextZoom) {
    const area = containerEl.querySelector("#canvas-draw-area");
    if (!area) return;
    const r = area.getBoundingClientRect();
    const next = clampCanvasViewZoom(nextZoom);
    const pan = canvasViewPanAfterZoom({
      areaX: clientX - r.left,
      areaY: clientY - r.top,
      panX: viewPanX,
      panY: viewPanY,
      zoom: viewZoom || 1,
      nextZoom: next,
    });
    viewZoom = next;
    viewPanX = pan.panX;
    viewPanY = pan.panY;
    applyViewTransform();
  }

  function zoomCanvasViewBy(factor, clientX, clientY) {
    const area = containerEl.querySelector("#canvas-draw-area");
    const r = area?.getBoundingClientRect();
    const x = Number.isFinite(clientX) ? clientX : (r ? r.left + r.width / 2 : 0);
    const y = Number.isFinite(clientY) ? clientY : (r ? r.top + r.height / 2 : 0);
    zoomCanvasViewAt(x, y, (viewZoom || 1) * factor);
  }

  function pointerInDrawArea(event) {
    const area = containerEl.querySelector("#canvas-draw-area");
    if (!area || !isActive()) return false;
    const r = area.getBoundingClientRect();
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function bindViewControls() {
    const area = containerEl.querySelector("#canvas-draw-area");
    const onWheel = (event) => {
      if (!pointerInDrawArea(event)) return;
      if (!event.cancelable) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.target?.closest?.("textarea, input, select, [contenteditable='true']") && !canvasWheelShouldZoom(event)) {
        return;
      }
      if (canvasWheelShouldZoom(event)) {
        zoomCanvasViewBy(canvasWheelZoomFactor(event), event.clientX, event.clientY);
        return;
      }
      viewPanX -= Number(event.deltaX) || 0;
      viewPanY -= Number(event.deltaY) || 0;
      applyViewTransform();
    };
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    const onGestureStart = (event) => {
      if (!pointerInDrawArea(event) && event.target !== area && !area?.contains(event.target)) return;
      event.preventDefault();
      viewGestureZoom = viewZoom || 1;
    };
    const onGestureChange = (event) => {
      if (!isActive()) return;
      event.preventDefault();
      zoomCanvasViewAt(event.clientX, event.clientY, viewGestureZoom * (Number(event.scale) || 1));
    };
    const onGestureEnd = (event) => {
      if (!isActive()) return;
      event.preventDefault();
    };
    area?.addEventListener("gesturestart", onGestureStart, { passive: false });
    area?.addEventListener("gesturechange", onGestureChange, { passive: false });
    area?.addEventListener("gestureend", onGestureEnd, { passive: false });
  }

  function toolLabel(btn) {
    return String(btn?.getAttribute("title") || "").split(". Right-click")[0].split(" — ")[0] || btn?.dataset?.tool || "Tool";
  }

  function syncToolChrome() {
    containerEl?.querySelectorAll("[data-tool]").forEach((b) => {
      const id = b.dataset.tool;
      const pinned = id === pinnedTool;
      b.classList.toggle("active", id === tool);
      b.classList.toggle("canvas-tool-pinned", pinned);
      b.setAttribute("aria-pressed", id === tool ? "true" : "false");
      if (pinned) b.setAttribute("aria-label", `${toolLabel(b)} (pinned as default)`);
      else b.removeAttribute("aria-label");
    });
  }

  function pinDefaultTool(next) {
    pinnedTool = storeCanvasDefaultTool(next);
    syncToolChrome();
    return pinnedTool;
  }

  function setMediaStatus(text, kind = "") {
    const status = containerEl?.querySelector("#canvas-media-status");
    if (!status) return;
    status.textContent = text || "";
    status.classList.toggle("hidden", !text);
    status.classList.toggle("error", kind === "error");
  }

  function closeCameraOverlay() {
    cameraStream?.getTracks?.().forEach((track) => track.stop());
    cameraStream = null;
    const video = containerEl?.querySelector("#canvas-camera-video");
    if (video) video.srcObject = null;
    containerEl?.querySelector("#canvas-camera-overlay")?.classList.add("hidden");
  }

  function setCameraStatus(text, kind = "") {
    const status = containerEl?.querySelector("#canvas-camera-status");
    if (!status) return;
    status.textContent = text || "";
    status.className = `canvas-camera-status muted${kind ? ` ${kind}` : ""}`;
  }

  function restoreMoveTool() {
    pendingImage = null;
    closeCameraOverlay();
    closeRelationEditor();
    setTool(CANVAS_DEFAULT_TOOL, { pickFile: false });
  }

  function setTool(next, { pickFile = true } = {}) {
    if (next !== "image") closeCameraOverlay();
    tool = next || CANVAS_DEFAULT_TOOL;
    connectFrom = null;
    hoverPort = null;
    drawing = false;
    preview = null;
    syncToolChrome();
    updateCursor();
    dismissTextInput();
    if (pickFile && tool === "image") containerEl.querySelector("#canvas-image-input")?.click();
    redraw();
  }

  function bindToolbar() {
    containerEl.querySelector("#canvas-split-btn")?.addEventListener("click", () => onToggleSplit?.());
    containerEl.querySelectorAll("[data-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.tool;
        const next = canvasToolAfterDeselect(tool, id);
        setTool(next, { pickFile: next === "image" && id === "image" });
      });
      btn.addEventListener("contextmenu", (ev) => {
        if (!isCanvasPinnableTool(btn.dataset.tool)) return;
        ev.preventDefault();
        ev.stopPropagation();
        const next = btn.dataset.tool === pinnedTool ? CANVAS_DEFAULT_TOOL : btn.dataset.tool;
        pinDefaultTool(next);
        setTool(next, { pickFile: false });
      });
    });

    const colorPick = containerEl.querySelector("#canvas-color-pick");
    colorPick?.addEventListener("input", () => { color = colorPick.value; });

    containerEl.querySelectorAll(".canvas-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        color = btn.dataset.color;
        if (colorPick) colorPick.value = color;
      });
    });

    const strokeRange = containerEl.querySelector("#canvas-stroke-width");
    const strokeVal = containerEl.querySelector("#canvas-stroke-val");
    strokeRange?.addEventListener("input", () => {
      strokeWidth = parseInt(strokeRange.value, 10);
      if (strokeVal) strokeVal.textContent = `${strokeWidth}px`;
    });

    containerEl.querySelector("#canvas-undo-btn")?.addEventListener("click", undo);
    containerEl.querySelector("#canvas-redo-btn")?.addEventListener("click", redo);
    containerEl.querySelector("#canvas-clear-btn")?.addEventListener("click", clearCanvas);
    containerEl.querySelector("#canvas-attach-prompt-btn")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.currentTarget?.blur?.();
      window.dispatchEvent(new CustomEvent("canvas:attach-sketch"));
      canvas?.focus?.({ preventScroll: true });
    });
  }

  function bindCamera() {
    containerEl.querySelector("#canvas-camera-btn")?.addEventListener("click", (event) => {
      event.preventDefault();
      void openCameraOverlay();
    });
    containerEl.querySelector("#canvas-camera-snap")?.addEventListener("click", (event) => {
      event.preventDefault();
      void snapCameraPhoto();
    });
    containerEl.querySelector("#canvas-camera-cancel")?.addEventListener("click", (event) => {
      event.preventDefault();
      closeCameraOverlay();
      restoreMoveTool();
    });
  }

  async function openCameraOverlay() {
    const overlay = containerEl.querySelector("#canvas-camera-overlay");
    const video = containerEl.querySelector("#canvas-camera-video");
    if (!overlay || !video) return;
    overlay.classList.remove("hidden");
    setCameraStatus("Starting camera…");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("Camera is not available in this browser.", "error");
      setMediaStatus("Camera is not available in this browser.", "error");
      return;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.srcObject = cameraStream;
      await video.play?.();
      setCameraStatus("Line up the shot, then Snap.");
    } catch (err) {
      const denied = /notallowed|permission|denied/i.test(String(err?.name || err?.message || ""));
      const message = denied
        ? "Camera permission denied. Allow the camera to snap a photo."
        : (err?.message || "Could not open the camera.");
      setCameraStatus(message, "error");
      setMediaStatus(message, "error");
    }
  }

  async function snapCameraPhoto() {
    const video = containerEl.querySelector("#canvas-camera-video");
    if (!video || !cameraStream) {
      setCameraStatus("Camera is not ready yet.", "error");
      return;
    }
    const snap = document.createElement("canvas");
    snap.width = video.videoWidth || 1280;
    snap.height = video.videoHeight || 720;
    snap.getContext("2d")?.drawImage(video, 0, 0, snap.width, snap.height);
    const blob = await blobFromCanvas(snap, "image/jpeg", 0.88);
    const file = new File([blob], `webcam-${Date.now()}.jpg`, { type: "image/jpeg" });
    closeCameraOverlay();
    const pos = { x: (canvas?.width || 400) / 2, y: (canvas?.height || 300) / 2 };
    await addDroppedImageFiles([file], pos);
    if (onDropFiles) await onDropFiles([file], pos, { alreadyPlaced: true });
  }

  function bindSmartDescribe() {
    const btn = containerEl.querySelector("#canvas-smart-desc-btn");
    btn?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.currentTarget?.blur?.();
      if (typeof onSmartDescribe !== "function") return;
      btn.disabled = true;
      btn.classList.add("busy");
      try {
        await onSmartDescribe({
          description: canvasDescription,
          metadata: getDrawingMetadata(),
        });
      } finally {
        btn.disabled = false;
        btn.classList.remove("busy");
      }
    });
  }

  function nextLinkNumber() {
    let max = 0;
    for (const el of elements) {
      if (el.type !== "link" && el.type !== "group-link") continue;
      const n = Number(el.linkNumber);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max + 1;
  }

  function selectionList() {
    return [...selectedIds].filter((id) => elementById(id));
  }

  function setSelection(ids, primary) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => elementById(id));
    selectedIds = new Set(list);
    selectedId = (primary && selectedIds.has(primary)) ? primary : (list.at(-1) || null);
  }

  function toggleSelection(id) {
    if (!id || !elementById(id)) return;
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      selectedId = [...selectedIds].at(-1) || null;
    } else {
      selectedIds.add(id);
      selectedId = id;
    }
  }

  function closeRelationEditor() {
    relationPop?.remove();
    relationPop = null;
  }

  function nextInterestNumber() {
    let max = 0;
    for (const el of elements) {
      const n = Number(el.interestNumber);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max + 1;
  }

  function interestKindFor(el) {
    return canvasInterestKind(el) || INTEREST_KIND_BY_TOOL[el?.type] || "";
  }

  function interestTitle(el) {
    return canvasInterestTitle(el);
  }

  function applyInterestDefaults(el, kind) {
    el.interestKind = kind;
    if (!Number(el.interestNumber)) el.interestNumber = nextInterestNumber();
    if (!el.action) el.action = kind === "split" ? "split" : "extrude";
    if (!el.direction) el.direction = "up";
    if (kind === "view" && !el.viewName && !el.tag) {
      el.viewName = "Top";
      el.tag = "Top View";
    }
    if (kind === "face" && !el.tag) el.tag = "Face of interest";
    if (kind === "edge" && !el.tag) el.tag = "Edge of interest";
    if (kind === "split" && !el.tag) el.tag = "Split";
    el.interestPrompt = String(el.interestPrompt || "");
    return el;
  }

  function closeInterestEditor() {
    interestPop?.remove();
    interestPop = null;
  }

  function getInterests() {
    return collectCanvasInterests(sanitizeCanvasElements(elements)).map((el) => ({
      id: el.id,
      kind: interestKindFor(el),
      number: Number(el.interestNumber) || 0,
      viewName: String(el.viewName || ""),
      action: String(el.action || ""),
      direction: String(el.direction || ""),
      tag: String(el.tag || ""),
      interestPrompt: String(el.interestPrompt || ""),
      title: interestTitle(el),
    }));
  }

  function updateInterestPrompt(id, text) {
    const el = elementById(id);
    if (!el) return false;
    el.interestPrompt = String(text || "").slice(0, 2000);
    notifyChange();
    return true;
  }

  function sendNodeToAi(el) {
    if (!el) return false;
    if (!el.promptToken) pushHistory();
    assignCanvasPromptToken(el, elements);
    notifyChange();
    lastTagSignature = "";
    redraw();
    onSendRegion?.(el, {
      elements: sanitizeCanvasElements(elements),
      boardName: canvasTitle,
      description: canvasDescription,
    });
    return true;
  }

  function setInterestTip(text) {
    const tip = interestPop?.querySelector("[data-interest-tip]");
    if (tip) tip.textContent = text;
  }

  function viewportMenuBox() {
    const vv = window.visualViewport;
    if (vv) {
      return {
        left: Number(vv.offsetLeft) || 0,
        top: Number(vv.offsetTop) || 0,
        width: Number(vv.width) || window.innerWidth,
        height: Number(vv.height) || window.innerHeight,
      };
    }
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function canvasMenuBox() {
    const area = containerEl?.querySelector("#canvas-draw-area") || viewEl || containerEl;
    const rect = area?.getBoundingClientRect?.();
    const vp = viewportMenuBox();
    if (!rect) return vp;
    const left = Math.max(vp.left, rect.left);
    const top = Math.max(vp.top, rect.top);
    const right = Math.min(vp.left + vp.width, rect.right);
    const bottom = Math.min(vp.top + vp.height, rect.bottom);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    if (width < 48 || height < 48) return vp;
    return { left, top, width, height };
  }

  function placeCanvasContextMenu(menu, clientX, clientY) {
    if (!menu) return;
    menu.style.visibility = "hidden";
    if (!menu.parentNode) document.body.appendChild(menu);
    const box = canvasMenuBox();
    const pos = clampCanvasMenuPosition({
      pointerX: clientX,
      pointerY: clientY,
      menuWidth: menu.offsetWidth,
      menuHeight: menu.offsetHeight,
      viewWidth: box.width,
      viewHeight: box.height,
      viewLeft: box.left,
      viewTop: box.top,
    });
    menu.style.left = `${pos.left}px`;
    menu.style.top = `${pos.top}px`;
    menu.style.visibility = "";
  }

  function placeCanvasLocalMenu(menu, x, y, host) {
    if (!menu || !host) return;
    if (menu.parentNode !== host) host.appendChild(menu);
    const pos = clampCanvasMenuPosition({
      pointerX: x,
      pointerY: y,
      menuWidth: menu.offsetWidth,
      menuHeight: menu.offsetHeight,
      viewWidth: host.clientWidth || canvas?.width || 400,
      viewHeight: host.clientHeight || canvas?.height || 300,
      viewLeft: 0,
      viewTop: 0,
    });
    menu.style.left = `${pos.left}px`;
    menu.style.top = `${pos.top}px`;
  }

  function resolveCanvasElId(id) {
    const raw = String(id || "");
    if (elementById(raw)) return raw;
    const last = raw.split(":").at(-1);
    return last && elementById(last) ? last : raw;
  }

  function selectElement(id) {
    const el = elementById(resolveCanvasElId(id));
    if (!el) return false;
    setSelection([el.id]);
    canvas?.focus?.({ preventScroll: true });
    redraw();
    renderTagBadges();
    return true;
  }

  function selectElements(ids) {
    setSelection(ids);
    redraw();
    return selectionList();
  }

  function openInterestEditor(el, clientX, clientY) {
    if (!el) return;
    closeTagMenu();
    closeRelationEditor();
    closeInterestEditor();
    if (!el.interestKind && INTEREST_TYPES.has(el.type)) {
      applyInterestDefaults(el, INTEREST_KIND_BY_TOOL[el.type] || "face");
    }
    const kind = interestKindFor(el) || "face";
    const pop = document.createElement("div");
    pop.className = "canvas-interest-pop";
    const dir = String(el.direction || "up");
    const action = String(el.action || (kind === "split" ? "split" : "extrude"));
    const viewName = String(el.viewName || "").replace(/ view$/i, "");
    pop.innerHTML = `
      <strong>${escapeHtml(interestTitle(el))}</strong>
      <p class="canvas-interest-tip" data-interest-tip>Hover a button to see what it tells the AI.</p>
      <label>View</label>
      <div class="canvas-tag-options canvas-interest-views">
        ${CANVAS_VIEW_TAGS.map((name) => `<button type="button" data-view="${name}" title="This drawing is the ${name.toLowerCase()} view of the part">${name}</button>`).join("")}
        <button type="button" data-view-custom title="Type another view name">Other…</button>
      </div>
      <label>This mark is</label>
      <div class="canvas-tag-options">
        <button type="button" data-kind="view" title="A camera view of the whole part (Top, Front, Side…).">View</button>
        <button type="button" data-kind="face" title="The face you want edited — AI treats this as the selected face, not a new box solid.">Face of interest</button>
        <button type="button" data-kind="edge" title="The edge you want edited or used as a path.">Edge of interest</button>
        <button type="button" data-kind="split" title="Split this face or part along the marked region.">Split</button>
      </div>
      <label>Edit action</label>
      <div class="canvas-interest-actions">
        <button type="button" data-action="extrude" title="Grow / extrude the face in the chosen direction (arrows point out).">↗ Extrude</button>
        <button type="button" data-action="cut" title="Cut / pocket into the face (inverse arrows, material removed).">↙ Cut</button>
        <button type="button" data-action="split" title="Split the face or part of interest along this mark.">✂ Split</button>
      </div>
      <label>Direction in this view</label>
      <div class="canvas-interest-dirs">
        <button type="button" data-dir="up" title="Up in this view — extrude up, or cut downward if Cut is selected.">↑</button>
        <button type="button" data-dir="down" title="Down in this view.">↓</button>
        <button type="button" data-dir="left" title="Left in this view.">←</button>
        <button type="button" data-dir="right" title="Right in this view.">→</button>
      </div>
      <label for="canvas-interest-prompt">What should happen</label>
      <textarea id="canvas-interest-prompt" class="canvas-interest-prompt" rows="3" placeholder="e.g. go out 45 mm and curve to fit a Meta Quest headset">${escapeHtml(el.interestPrompt || "")}</textarea>
      <label>Also tag as</label>
      <div class="canvas-tag-options">
        ${CANVAS_TAGS.map((tag) => `<button type="button" data-canvas-tag="${tag}" title="This region is a ${tag.toLowerCase()}">${tag}</button>`).join("")}
        <button type="button" data-canvas-tag-custom title="Type your own part name">Other…</button>
        ${el.tag ? `<button type="button" data-canvas-tag-clear title="Remove the part tag">Clear tag</button>` : ""}
      </div>
      <div class="canvas-interest-actions">
        <button type="button" class="canvas-send-region-btn" data-canvas-send-region title="Insert a prompt mention like box: @box1">Send to AI</button>
        <button type="button" class="canvas-interest-done">Done</button>
      </div>
    `;
    placeCanvasContextMenu(pop, Number.isFinite(clientX) ? clientX : 24, Number.isFinite(clientY) ? clientY : 24);
    interestPop = pop;
    interestIgnoreClickUntil = Date.now() + 500;
    const syncActive = () => {
      pop.querySelectorAll("[data-view]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.getAttribute("data-view") === viewName || btn.getAttribute("data-view") === el.viewName);
      });
      pop.querySelectorAll("[data-kind]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.getAttribute("data-kind") === interestKindFor(el));
      });
      pop.querySelectorAll("[data-action]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.getAttribute("data-action") === (el.action || action));
      });
      pop.querySelectorAll("[data-dir]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.getAttribute("data-dir") === (el.direction || dir));
      });
    };
    syncActive();
    pop.querySelectorAll("button[title]").forEach((btn) => {
      btn.addEventListener("mouseenter", () => setInterestTip(btn.title));
    });
    const commitPrompt = () => {
      el.interestPrompt = String(pop.querySelector("#canvas-interest-prompt")?.value || "").trim();
      notifyChange();
    };
    pop.querySelector("#canvas-interest-prompt")?.addEventListener("input", commitPrompt);
    pop.addEventListener("click", (event) => {
      const viewBtn = event.target.closest("[data-view]");
      if (viewBtn) {
        if (!el.interestKind) applyInterestDefaults(el, "view");
        el.viewName = viewBtn.getAttribute("data-view");
        if (!el.tag || /view$/i.test(el.tag)) el.tag = `${el.viewName} View`;
        const titleEl = pop.querySelector("strong");
        if (titleEl) titleEl.textContent = interestTitle(el);
        notifyChange();
        syncActive();
        lastTagSignature = "";
        redraw();
        return;
      }
      if (event.target.closest("[data-view-custom]")) {
        const custom = window.prompt("View name", el.viewName || "");
        if (custom?.trim()) {
          el.viewName = custom.trim().slice(0, 40);
          if (!el.tag || /view$/i.test(el.tag)) el.tag = `${el.viewName} View`;
          notifyChange();
          lastTagSignature = "";
          redraw();
        }
        return;
      }
      const kindBtn = event.target.closest("[data-kind]");
      if (kindBtn) {
        applyInterestDefaults(el, kindBtn.getAttribute("data-kind"));
        const titleEl = pop.querySelector("strong");
        if (titleEl) titleEl.textContent = interestTitle(el);
        notifyChange();
        syncActive();
        lastTagSignature = "";
        redraw();
        return;
      }
      const actionBtn = event.target.closest("[data-action]");
      if (actionBtn) {
        el.action = actionBtn.getAttribute("data-action");
        notifyChange();
        syncActive();
        redraw();
        return;
      }
      const dirBtn = event.target.closest("[data-dir]");
      if (dirBtn) {
        el.direction = dirBtn.getAttribute("data-dir");
        notifyChange();
        syncActive();
        redraw();
        return;
      }
      const tagBtn = event.target.closest("[data-canvas-tag]");
      if (tagBtn) {
        el.tag = tagBtn.getAttribute("data-canvas-tag");
        notifyChange();
        lastTagSignature = "";
        redraw();
        return;
      }
      if (event.target.closest("[data-canvas-tag-custom]")) {
        const custom = window.prompt("What is this shape?", el.tag || "");
        if (custom?.trim()) el.tag = custom.trim().slice(0, 40);
        notifyChange();
        lastTagSignature = "";
        redraw();
        return;
      }
      if (event.target.closest("[data-canvas-tag-clear]")) {
        delete el.tag;
        notifyChange();
        lastTagSignature = "";
        redraw();
        return;
      }
      if (event.target.closest("[data-canvas-send-region]")) {
        commitPrompt();
        sendNodeToAi(el);
        closeInterestEditor();
        return;
      }
      if (event.target.closest(".canvas-interest-done")) {
        commitPrompt();
        closeInterestEditor();
      }
    });
  }

  function openRelationEditor(el) {
    if (!el || (el.type !== "link" && el.type !== "group-link")) return;
    closeRelationEditor();
    const view = viewEl || containerEl.querySelector("#canvas-draw-area");
    if (!view) return;
    const x1 = Number(el.x1) || 0;
    const y1 = Number(el.y1) || 0;
    const x2 = Number(el.x2) || 0;
    const y2 = Number(el.y2) || 0;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const pop = document.createElement("div");
    pop.className = "canvas-relation-pop";
    const mentionables = canvasLinkMentionNodes(el, elements)
      .filter((node) => canvasNodeCaption(node, ""));
    const isGroup = el.type === "group-link" || isCanvasGroupLink(el);
    pop.innerHTML = `
      ${isGroup ? `<label class="canvas-relation-label" for="canvas-link-name">Link name</label>
      <input id="canvas-link-name" class="canvas-relation-input" type="text" maxlength="80" value="${escapeHtml(el.linkName || "")}" placeholder="Name this related group" />` : ""}
      <label class="canvas-relation-label" for="canvas-relation-input">${isGroup ? "Note with @ / # tags" : `Link #${el.linkNumber || "?"} relationship`}</label>
      <textarea id="canvas-relation-input" class="canvas-relation-input" rows="3" placeholder="Type @ or # to tag a linked object">${escapeHtml(expandCanvasMentionText(el.relation || "", elements))}</textarea>
      <div class="canvas-relation-mentions hidden" data-canvas-relation-mentions></div>
      <div class="canvas-relation-actions">
        <button type="button" class="canvas-send-region-btn" data-canvas-send-region>Send to AI</button>
        <button type="button" class="canvas-relation-save">Save</button>
        <button type="button" class="canvas-relation-cancel">Close</button>
      </div>`;
    placeCanvasLocalMenu(pop, midX + 12, midY + 10, view);
    relationPop = pop;
    const input = pop.querySelector("#canvas-relation-input");
    const mentionList = pop.querySelector("[data-canvas-relation-mentions]");
    const persistRelationText = (visible) => {
      let next = String(visible || "");
      for (const node of mentionables) {
        const name = canvasNodeCaption(node, "");
        if (!name) continue;
        next = next.replaceAll(`@${name}`, canvasMentionToken(node.id));
        next = next.replaceAll(`#${name}`, canvasMentionToken(node.id));
      }
      return next.trim();
    };
    const insertMention = (node) => {
      if (!input || !node) return;
      const caret = input.selectionStart ?? input.value.length;
      const before = input.value.slice(0, caret);
      const after = input.value.slice(caret);
      const match = before.match(/[@#]([^\s@#]*)$/);
      const start = match ? caret - match[0].length : caret;
      const name = canvasNodeCaption(node, "image");
      const mark = node.type === "image" ? "@" : "#";
      input.value = `${before.slice(0, start)}${mark}${name} ${after}`;
      const nextCaret = start + name.length + 2;
      input.setSelectionRange(nextCaret, nextCaret);
      mentionList?.classList.add("hidden");
      input.focus();
    };
    const renderMentionChoices = () => {
      if (!input || !mentionList) return;
      const caret = input.selectionStart ?? input.value.length;
      const match = input.value.slice(0, caret).match(/[@#]([^\s@#]*)$/);
      if (!match) {
        mentionList.classList.add("hidden");
        mentionList.innerHTML = "";
        return;
      }
      const q = String(match[1] || "").toLowerCase();
      const hits = mentionables.filter((node) => {
        const name = canvasNodeCaption(node, "").toLowerCase();
        return !q || name.includes(q);
      });
      if (!hits.length) {
        mentionList.classList.add("hidden");
        mentionList.innerHTML = "";
        return;
      }
      mentionList.innerHTML = hits.map((node) => {
        const name = canvasNodeCaption(node, "image");
        const thumb = node.dataUrl
          ? `<img src="${node.dataUrl}" alt="" />`
          : "";
        return `<button type="button" class="canvas-relation-mention" data-mention-id="${escapeHtml(node.id)}">${thumb}<span>${escapeHtml(name)}</span></button>`;
      }).join("");
      mentionList.classList.remove("hidden");
      mentionList.querySelectorAll("[data-mention-id]").forEach((btn) => {
        btn.addEventListener("mousedown", (event) => {
          event.preventDefault();
          insertMention(mentionables.find((node) => node.id === btn.getAttribute("data-mention-id")));
        });
      });
    };
    const save = () => {
      const next = persistRelationText(input?.value || "");
      const nameInput = pop.querySelector("#canvas-link-name");
      const nextName = String(nameInput?.value || "").trim().slice(0, 80);
      if (next !== String(el.relation || "").trim() || (isGroup && nextName !== String(el.linkName || "").trim())) {
        pushHistory();
        el.relation = next;
        if (isGroup) el.linkName = nextName;
      }
      closeRelationEditor();
      lastTagSignature = "";
      redraw();
    };
    pop.querySelector(".canvas-relation-save")?.addEventListener("click", save);
    pop.querySelector(".canvas-relation-cancel")?.addEventListener("click", closeRelationEditor);
    pop.querySelector("[data-canvas-send-region]")?.addEventListener("click", () => {
      const next = persistRelationText(input?.value || "");
      const nextName = String(pop.querySelector("#canvas-link-name")?.value || "").trim();
      if (next !== String(el.relation || "").trim() || (isGroup && nextName !== String(el.linkName || "").trim())) {
        pushHistory();
        el.relation = next;
        if (isGroup) el.linkName = nextName;
      }
      sendNodeToAi(el);
      closeRelationEditor();
    });
    input?.addEventListener("input", renderMentionChoices);
    input?.addEventListener("click", renderMentionChoices);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRelationEditor();
        return;
      }
      if (e.key === "Tab" && mentionList && !mentionList.classList.contains("hidden")) {
        const first = mentionables.find((node) => mentionList.querySelector(`[data-mention-id="${node.id}"]`));
        if (first) {
          e.preventDefault();
          insertMention(first);
          return;
        }
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        save();
      }
    });
    input?.focus();
    input?.select();
  }

  function bindImageInput() {
    const input = containerEl.querySelector("#canvas-image-input");
    input?.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      if (onDropFiles) {
        const w = canvas?.width || 400;
        const h = canvas?.height || 300;
        await onDropFiles([file], { x: w / 2, y: h / 2 });
        return;
      }
      const dataUrl = await readFileAsDataUrl(file);
      pendingImage = dataUrl;
      setTool("image", { pickFile: false });
    });
    const area = containerEl.querySelector("#canvas-draw-area");
    const wrap = containerEl.closest(".canvas-workspace-wrap");
    const filesFromDrop = (e) => {
      const out = [];
      for (const file of e.dataTransfer?.files || []) out.push(file);
      if (!out.length) {
        for (const item of e.dataTransfer?.items || []) {
          if (item.kind === "file") {
            const file = item.getAsFile?.();
            if (file) out.push(file);
          }
        }
      }
      return out.filter(isCanvasImageFile);
    };
    const onDragOver = (e) => {
      const types = [...(e.dataTransfer?.types || [])];
      if (!types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = async (e) => {
      const files = filesFromDrop(e);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = pt(e);
      try {
        const converted = await addDroppedImageFiles(files, pos);
        if (onDropFiles) await onDropFiles(converted?.length ? converted : files, pos, { alreadyPlaced: true });
      } catch (err) {
        if (onDropFiles) await onDropFiles(files, pos, { alreadyPlaced: true });
        else throw err;
      }
    };
    area?.addEventListener("dragover", onDragOver);
    area?.addEventListener("drop", onDrop);
    // Capture so the workspace CAD drop handler cannot steal the pointer position.
    wrap?.addEventListener("dragover", onDragOver, true);
    wrap?.addEventListener("drop", onDrop, true);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function resolveDisplaySrc(src) {
    const raw = String(src || "");
    if (!raw) return "";
    if (raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
    if (!fetchFile || !raw.startsWith("/api/")) return raw;
    try {
      const res = await fetchFile(raw);
      if (!res?.ok) return "";
      const blob = await res.blob();
      if (!blob || blob.size < 32) return "";
      return trackObjectUrl(blob, canvasDisplayCreated);
    } catch {
      return "";
    }
  }

  function loadImage(dataUrl) {
    if (!dataUrl) return Promise.resolve(null);
    if (imageCache.has(dataUrl)) return Promise.resolve(imageCache.get(dataUrl));
    return resolveDisplaySrc(dataUrl).then((src) => {
      if (!src) return null;
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          rememberImage(dataUrl, img);
          resolve(img);
        };
        img.onerror = () => {
          const i = canvasDisplayCreated.indexOf(src);
          if (i >= 0) {
            canvasDisplayCreated.splice(i, 1);
            try { URL.revokeObjectURL(src); } catch { /* ignore */ }
          }
          resolve(null);
        };
        img.src = src;
      });
    });
  }

  function rememberImage(key, img) {
    if (!key || !img) return;
    if (imageCache.has(key)) {
      imageCache.delete(key);
      imageCache.set(key, img);
      return;
    }
    while (imageCache.size >= CANVAS_IMAGE_CACHE_LIMIT) {
      const oldest = imageCache.keys().next().value;
      const evicted = imageCache.get(oldest);
      imageCache.delete(oldest);
      const src = evicted?.src || "";
      const i = canvasDisplayCreated.indexOf(src);
      if (i >= 0) {
        canvasDisplayCreated.splice(i, 1);
        try { URL.revokeObjectURL(src); } catch { /* ignore */ }
      }
    }
    imageCache.set(key, img);
  }

  function hoverKey(hit) {
    if (!hit) return "";
    return `${hit.el?.id || ""}:${hit.port?.id || ""}`;
  }

  async function addImageNode(x, y, dataUrl, sourceFilename = "") {
    const stored = await compressCanvasImageDataUrl(dataUrl);
    const img = await loadImage(stored);
    const nw = img?.naturalWidth || 160;
    const nh = img?.naturalHeight || 120;
    const max = 180;
    const scale = Math.min(max / nw, max / nh, 1);
    const w = Math.max(64, Math.round(nw * scale));
    const h = Math.max(48, Math.round(nh * scale));
    const stem = String(sourceFilename || "").replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
    addElement({
      id: nid("img"),
      type: "image",
      color,
      strokeWidth,
      dataUrl: stored,
      sourceFilename,
      imageName: slugifyCanvasImageName(stem),
      bounds: { x: x - w / 2, y: y - h / 2, w, h },
    });
    setSelection([elements[elements.length - 1].id]);
    pendingImage = null;
    notifyChange();
    renderTagBadges();
  }

  function cursorForHandle(handle) {
    if (handle === "nw" || handle === "se") return "nwse-resize";
    if (handle === "ne" || handle === "sw") return "nesw-resize";
    return "move";
  }

  function updateCursor(pos) {
    if (!canvas) return;
    if (pos) {
      const selected = elementById(selectedId);
      if (selected?.bounds && NODE_TYPES.has(selected.type)) {
        const handle = hitResizeHandle(selected.bounds, pos);
        if (handle) {
          canvas.style.cursor = cursorForHandle(handle);
          return;
        }
      }
      if (drag?.kind === "resize") {
        canvas.style.cursor = cursorForHandle(drag.handle);
        return;
      }
      if (drag?.kind === "move") {
        canvas.style.cursor = "move";
        return;
      }
      if (tool === "select") {
        const hit = findElementAt(pos);
        if (hit) {
          canvas.style.cursor = hit.type === "link" ? "pointer" : "move";
          return;
        }
      }
    }
    const cursors = {
      select: "default",
      pen: "crosshair",
      eraser: "cell",
      text: "crosshair",
      image: "copy",
      default: "crosshair",
    };
    canvas.style.cursor = cursors[tool] || cursors.default;
    syncFinalLookTip(pos);
  }

  function pushHistory() {
    history.push({ elements: cloneElements() });
    if (history.length > CANVAS_UNDO_LIMIT) history.shift();
    redoStack = [];
    updateUndoRedo();
    notifyChange();
  }

  function undo() {
    if (textInput) commitTextInput();
    closeRelationEditor();
    if (!history.length) return;
    redoStack.push({ elements: cloneElements() });
    elements = cloneElements(history.pop().elements || []);
    setSelection([]);
    redraw();
    updateUndoRedo();
  }

  function redo() {
    if (textInput) commitTextInput();
    closeRelationEditor();
    if (!redoStack.length) return;
    history.push({ elements: cloneElements() });
    elements = cloneElements(redoStack.pop().elements || []);
    selectedId = null;
    redraw();
    updateUndoRedo();
  }

  function deleteSelected() {
    const ids = selectionList();
    if (!ids.length && selectedId) ids.push(selectedId);
    if (!ids.length) return false;
    if (textInput) dismissTextInput();
    eraseElementsByIds(ids);
    redraw();
    return true;
  }

  function eraseElementsByIds(ids) {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return false;
    pushHistory();
    elements = removeCanvasElementsByIds(elements, list);
    if (list.includes(selectedId)) selectedId = null;
    for (const id of list) selectedIds.delete(id);
    emitCollab("canvas.patch", { op: "delete", ids: list });
    recordEdit({ type: "erase" }, "erase");
    notifyChange();
    return true;
  }

  function updateUndoRedo() {
    const u = containerEl?.querySelector("#canvas-undo-btn");
    const r = containerEl?.querySelector("#canvas-redo-btn");
    if (u) u.disabled = !history.length;
    if (r) r.disabled = !redoStack.length;
  }

  function clearCanvas() {
    if (!canvas) return;
    pushHistory();
    elements = [];
    selectedId = null;
    selectedIds = new Set();
    canvasDescription = "";
    resetTransientDrawing();
    closeTagMenu();
    resetCanvasView();
    redraw();
  }

  function pointFromClient(clientX, clientY) {
    return canvasPointFromClient(canvas, clientX, clientY);
  }

  function pt(e) {
    const t = e.touches?.[0] ?? e;
    return pointFromClient(t.clientX, t.clientY);
  }

  function bindCanvas() {
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onUp);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("click", (event) => {
      if (tagMenu && !tagMenu.contains(event.target)) closeTagMenu();
      if (interestPop && !interestPop.contains(event.target) && Date.now() >= interestIgnoreClickUntil
        && !event.target.closest?.(".canvas-tag-badge, .canvas-interest-pop")) {
        closeInterestEditor();
      }
    });
  }

  function portsOf(el) {
    const b = el.bounds || { x: 0, y: 0, w: 0, h: 0 };
    return {
      n: { id: "n", x: b.x + b.w / 2, y: b.y },
      s: { id: "s", x: b.x + b.w / 2, y: b.y + b.h },
      e: { id: "e", x: b.x + b.w, y: b.y + b.h / 2 },
      w: { id: "w", x: b.x, y: b.y + b.h / 2 },
    };
  }

  function nearestPort(el, pos) {
    const ports = Object.values(portsOf(el));
    let best = ports[0];
    let bestD = Infinity;
    for (const p of ports) {
      const d = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2;
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  function hitPort(pos) {
    let found = null;
    let best = PORT_R * PORT_R * 4;
    for (const el of elements) {
      if (!NODE_TYPES.has(el.type) || !el.bounds) continue;
      for (const p of Object.values(portsOf(el))) {
        const d = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2;
        if (d < best) {
          best = d;
          found = { el, port: p };
        }
      }
    }
    return found;
  }

  function findNodeAt(pos) {
    for (let i = elements.length - 1; i >= 0; i -= 1) {
      const el = elements[i];
      if (!NODE_TYPES.has(el.type) || !el.bounds) continue;
      const b = el.bounds;
      if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) return el;
    }
    return null;
  }

  function hitPolyline(points, pos, threshold = 8) {
    const pts = points || [];
    for (let i = 1; i < pts.length; i += 1) {
      if (distToSegment(pos, pts[i - 1], pts[i]) < threshold) return true;
    }
    return false;
  }

  function hitNodeGeometry(el, pos) {
    if (!el?.bounds) return false;
    return pointInBounds(el.bounds, pos, 0) || hitShapeEdge(el.bounds, pos, EDGE_HIT);
  }

  function findElementAt(pos) {
    for (let i = elements.length - 1; i >= 0; i -= 1) {
      const el = elements[i];
      if (CONNECTOR_TYPES.has(el.type)) {
        const a = connectorStart(el);
        const b = connectorEnd(el);
        if (el.type === "link") {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          if (Math.abs(pos.x - mx) < 20 && Math.abs(pos.y - my) < 18) return el;
        }
        if (distToSegment(pos, a, b) < (el.type === "link" ? 14 : (tool === "eraser" ? 16 : 8))) return el;
        continue;
      }
      if (el.type === "pen" && el.points) {
        if (hitPolyline(el.points, pos, Math.max(8, (el.strokeWidth || strokeWidth) + 4))) return el;
        continue;
      }
      if (el.type === "edge-mark") {
        if (distToSegment(pos, { x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }) < 12) return el;
        continue;
      }
      if (el.type === "split-mark" && el.interestMode === "lasso" && el.points) {
        if (hitPolyline(el.points, pos, 10) || (el.bounds && hitNodeGeometry(el, pos))) return el;
        continue;
      }
      if (NODE_TYPES.has(el.type) && hitNodeGeometry(el, pos)) return el;
    }
    return null;
  }

  function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    const x = a.x + t * dx;
    const y = a.y + t * dy;
    return Math.hypot(p.x - x, p.y - y);
  }

  function elementById(id) {
    return elements.find((el) => el.id === id) || null;
  }

  function attachLocalBounds(el, parent) {
    if (!parent?.bounds || !el.bounds) return;
    const pb = parent.bounds;
    el.parentId = parent.id;
    el.localBounds = {
      x: (el.bounds.x - pb.x) / (pb.w || 1),
      y: (el.bounds.y - pb.y) / (pb.h || 1),
      w: el.bounds.w / (pb.w || 1),
      h: el.bounds.h / (pb.h || 1),
    };
  }

  function worldBoundsFromParent(el) {
    const parent = el.parentId ? elementById(el.parentId) : null;
    if (!parent?.bounds || !el.localBounds) return el.bounds;
    const pb = parent.bounds;
    const lb = el.localBounds;
    return {
      x: pb.x + lb.x * pb.w,
      y: pb.y + lb.y * pb.h,
      w: lb.w * pb.w,
      h: lb.h * pb.h,
    };
  }

  function syncParentedBounds() {
    for (const el of elements) {
      if (!el.parentId) continue;
      const parent = elementById(el.parentId);
      if (!parent?.bounds) continue;
      if (el.localBounds) el.bounds = worldBoundsFromParent(el);
      if (el.localPoints) {
        el.points = el.localPoints.map((p) => fromImageLocal(parent.bounds, p));
        if (el.type === "edge-mark" && el.localPoints.length >= 2) {
          el.x1 = el.points[0].x;
          el.y1 = el.points[0].y;
          el.x2 = el.points[1].x;
          el.y2 = el.points[1].y;
        }
      }
    }
  }

  function parentMarkupOnto(el) {
    const parent = drawParentId ? elementById(drawParentId) : null;
    drawParentId = null;
    if (!parent?.bounds || parent.type !== "image") return el;
    if (el.points) {
      el.localPoints = el.points.map((p) => toImageLocal(parent.bounds, p));
    } else if (Number.isFinite(el.x1) && Number.isFinite(el.x2)) {
      el.localPoints = [
        toImageLocal(parent.bounds, { x: el.x1, y: el.y1 }),
        toImageLocal(parent.bounds, { x: el.x2, y: el.y2 }),
      ];
    }
    if (el.bounds) attachLocalBounds(el, parent);
    return el;
  }

  function connectorStart(el) {
    const from = elementById(el.fromId);
    if (from?.bounds && el.fromPort) return portsOf(from)[el.fromPort] || nearestPort(from, { x: el.x1, y: el.y1 });
    return { x: el.x1, y: el.y1 };
  }

  function connectorEnd(el) {
    const to = elementById(el.toId);
    if (to?.bounds && el.toPort) return portsOf(to)[el.toPort] || nearestPort(to, { x: el.x2, y: el.y2 });
    return { x: el.x2, y: el.y2 };
  }

  function snapshotElPos(el) {
    if (el?.bounds) return { kind: "box", x: el.bounds.x, y: el.bounds.y };
    if (el && Number.isFinite(el.x1)) return { kind: "line", x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2 };
    if (el?.points) return { kind: "pts", points: el.points.map((p) => ({ x: p.x, y: p.y })) };
    return null;
  }

  function applyElDelta(el, start, dx, dy) {
    if (!el || !start) return;
    if (start.kind === "box" && el.bounds) {
      el.bounds.x = start.x + dx;
      el.bounds.y = start.y + dy;
    } else if (start.kind === "line") {
      el.x1 = start.x1 + dx;
      el.y1 = start.y1 + dy;
      el.x2 = start.x2 + dx;
      el.y2 = start.y2 + dy;
    } else if (start.kind === "pts" && el.points) {
      el.points = start.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
  }

  function beginMove(el, pos) {
    if (!selectedIds.has(el.id)) setSelection([el.id]);
    const starts = new Map();
    for (const id of selectionList()) {
      const snap = snapshotElPos(elementById(id));
      if (snap) starts.set(id, snap);
    }
    drag = {
      kind: "move",
      id: el.id,
      origin: { x: pos.x, y: pos.y },
      starts,
      dx: el.bounds ? pos.x - el.bounds.x : 0,
      dy: el.bounds ? pos.y - el.bounds.y : 0,
      moved: false,
    };
  }

  function beginResize(el, handle) {
    drag = {
      kind: "resize",
      id: el.id,
      handle,
      start: { ...el.bounds },
      moved: false,
    };
  }

  function applyDrag(pos) {
    if (drag?.kind === "move" && drag.starts?.size) {
      if (!drag.moved) pushHistory();
      const dx = pos.x - drag.origin.x;
      const dy = pos.y - drag.origin.y;
      for (const [id, start] of drag.starts) applyElDelta(elementById(id), start, dx, dy);
      drag.moved = true;
      syncParentedBounds();
      redraw();
      return;
    }
    const el = elementById(drag?.id);
    if (!el?.bounds) return;
    if (drag.kind === "resize") {
      if (!drag.moved) pushHistory();
      el.bounds = resizeBounds(drag.start, drag.handle, pos);
      drag.moved = true;
      if (el.parentId) attachLocalBounds(el, elementById(el.parentId));
      if (el.type === "image") syncParentedBounds();
      redraw();
    }
  }

  /** Corner handles always resize; fill or stroke/edge selects (and can move). */
  function trySelectOrTransform(pos, { shift = false } = {}) {
    const selected = elementById(selectedId);
    if (!shift && selected && NODE_TYPES.has(selected.type) && selected.bounds) {
      const handle = hitResizeHandle(selected.bounds, pos);
      if (handle) {
        beginResize(selected, handle);
        redraw();
        return true;
      }
    }
    const hit = findElementAt(pos);
    if (!hit || hit.type === "group-link") return false;
    if (shift) {
      toggleSelection(hit.id);
      redraw();
      return true;
    }
    if (!selectedIds.has(hit.id)) setSelection([hit.id]);
    else selectedId = hit.id;
    if (hit.type === "link" && selectedIds.size <= 1) {
      redraw();
      openRelationEditor(hit);
      return true;
    }
    if ((INTEREST_TYPES.has(hit.type) || hit.interestKind) && selectedIds.size <= 1) {
      if (NODE_TYPES.has(hit.type) && hit.bounds) {
        const handle = hitResizeHandle(hit.bounds, pos);
        if (handle) beginResize(hit, handle);
        else if (hit.bounds) beginMove(hit, pos);
      }
      redraw();
      openInterestEditor(hit);
      return true;
    }
    if (NODE_TYPES.has(hit.type) && hit.bounds) {
      const handle = hitResizeHandle(hit.bounds, pos);
      if (handle) beginResize(hit, handle);
      else beginMove(hit, pos);
    } else {
      beginMove(hit, pos);
    }
    redraw();
    return true;
  }

  function beginViewPan(e) {
    viewPanDrag = { x: e.clientX, y: e.clientY, panX: viewPanX, panY: viewPanY };
    canvas?.setPointerCapture?.(e.pointerId);
    if (canvas) canvas.style.cursor = "grabbing";
  }

  function updateViewPinch(e) {
    if (viewPointers.has(e.pointerId)) {
      viewPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (viewPointers.size < 2) {
      viewPinch = null;
      return false;
    }
    const pts = [...viewPointers.values()];
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    if (!viewPinch) {
      viewPinch = { dist, zoom: viewZoom || 1 };
    }
    drawing = false;
    preview = null;
    drag = null;
    e.preventDefault?.();
    zoomCanvasViewAt(midX, midY, viewPinch.zoom * (dist / viewPinch.dist));
    return true;
  }

  function onDown(e) {
    if (e.button === 2) return;
    closeTagMenu();
    closeRelationEditor();
    hideAuthorHover();
    viewPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.button === 1) {
      e.preventDefault();
      beginViewPan(e);
      return;
    }
    if (!canMutateCanvas()) {
      e.preventDefault();
      beginViewPan(e);
      return;
    }
    if (viewPointers.size >= 2) {
      e.preventDefault();
      drawing = false;
      preview = null;
      drag = null;
      updateViewPinch(e);
      return;
    }
    const pos = pt(e);
    canvas.setPointerCapture?.(e.pointerId);
    canvas.focus?.({ preventScroll: true });
    dismissTextInput();

    const selected = elementById(selectedId);
    if (tool !== "eraser" && selected?.bounds && NODE_TYPES.has(selected.type)) {
      const handle = hitResizeHandle(selected.bounds, pos);
      if (handle) {
        beginResize(selected, handle);
        redraw();
        return;
      }
    }

    if (tool !== "eraser" && !isMarkupDrawTool(tool) && !CONNECTOR_TYPES.has(tool) && trySelectOrTransform(pos, { shift: !!e.shiftKey })) return;

    drawParentId = null;
    if (isMarkupDrawTool(tool)) {
      const under = findNodeAt(pos);
      if (under?.type === "image") drawParentId = under.id;
    }

    if (tool === "image") {
      if (!pendingImage) {
        containerEl.querySelector("#canvas-image-input")?.click();
        return;
      }
      pushHistory();
      void addImageNode(pos.x, pos.y, pendingImage).then(() => redraw());
      return;
    }

    if (tool === "select") {
      if (e.shiftKey) {
        drawing = true;
        startPt = pos;
        preview = { type: "select-box", bounds: pointBounds(pos) };
        redraw();
        return;
      }
      setSelection([]);
      beginViewPan(e);
      return;
    }

    if (tool === "eraser") {
      const hit = findElementAt(pos);
      if (hit && canvasEraserCanDelete(hit)) {
        eraseElementsByIds([hit.id]);
        redraw();
        return;
      }
      if (selectedId && elementById(selectedId) && canvasEraserCanDelete(elementById(selectedId))) {
        eraseElementsByIds([selectedId]);
        redraw();
        return;
      }
      drawing = true;
      startPt = pos;
      preview = { type: "eraser-box", bounds: pointBounds(pos) };
      return;
    }

    if (tool === "edge-mark") {
      drawing = true;
      startPt = pos;
      preview = { type: "edge-mark", x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, color, strokeWidth };
      redraw();
      return;
    }

    if (tool === "split-mark" && e.shiftKey) {
      drawing = true;
      startPt = pos;
      preview = { type: "split-mark", mode: "lasso", color, strokeWidth, points: [pos], bounds: pointBounds(pos) };
      pushHistory();
      redraw();
      return;
    }

    if (CONNECTOR_TYPES.has(tool)) {
      const portHit = hitPort(pos);
      const nodeHit = findNodeAt(pos);
      const from = portHit || (nodeHit ? { el: nodeHit, port: nearestPort(nodeHit, pos) } : null);
      connectFrom = from
        ? { id: from.el.id, port: from.port.id, x: from.port.x, y: from.port.y }
        : { id: null, port: null, x: pos.x, y: pos.y };
      drawing = true;
      preview = { type: tool, x1: connectFrom.x, y1: connectFrom.y, x2: pos.x, y2: pos.y };
      redraw();
      return;
    }

    if (tool === "text" || NODE_TYPES.has(tool)) {
      drawing = true;
      startPt = pos;
      preview = { type: tool, bounds: pointBounds(pos), color, strokeWidth };
      redraw();
      return;
    }

    if (tool === "pen") {
      drawing = true;
      startPt = pos;
      preview = { type: "pen", color, strokeWidth, points: [pos] };
      pushHistory();
      redraw();
    }
  }

  function onMove(e) {
    if (viewPointers.has(e.pointerId)) viewPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (viewPanDrag) {
      viewPanX = viewPanDrag.panX + (e.clientX - viewPanDrag.x);
      viewPanY = viewPanDrag.panY + (e.clientY - viewPanDrag.y);
      applyViewTransform();
      return;
    }
    if (updateViewPinch(e)) return;
    const pos = pt(e);
    updateCursor(pos);
    sendLiveCursor(pos);
    if (!drawing && !drag) updateAuthorHover(pos);
    if (CONNECTOR_TYPES.has(tool) || tool === "select") {
      const nextHover = hitPort(pos);
      const hoverChanged = hoverKey(nextHover) !== hoverKey(hoverPort);
      hoverPort = nextHover;
      if (!drawing && !drag) {
        if (hoverChanged) redraw();
      }
    }

    if (drag) {
      applyDrag(pos);
      return;
    }

    if (!drawing || !preview) return;
    if (preview.type === "pen" || preview.type === "eraser" || (preview.type === "split-mark" && preview.mode === "lasso")) {
      preview.points.push(pos);
      if (preview.type === "split-mark") preview.bounds = boundsFromPointsList(preview.points);
      emitCollab("canvas.preview", { preview: { type: preview.type, points: preview.points.slice(-40), color, strokeWidth } });
      redraw();
      return;
    }
    if (preview.type === "eraser-box" || preview.type === "select-box") {
      preview.bounds = boundsFromPoints(startPt, pos);
      redraw();
      return;
    }
    if (preview.type === "edge-mark") {
      preview.x2 = pos.x;
      preview.y2 = pos.y;
      redraw();
      return;
    }
    if (CONNECTOR_TYPES.has(preview.type)) {
      const snap = hitPort(pos) || (findNodeAt(pos) ? { el: findNodeAt(pos), port: nearestPort(findNodeAt(pos), pos) } : null);
      preview.x2 = snap ? snap.port.x : pos.x;
      preview.y2 = snap ? snap.port.y : pos.y;
      hoverPort = snap;
      redraw();
      return;
    }
    preview.bounds = boundsFromPoints(startPt, pos, { lockAspect: preview.type === "circle" });
    redraw();
  }

  function onUp(e) {
    viewPointers.delete(e.pointerId);
    if (viewPointers.size < 2) viewPinch = null;
    if (viewPanDrag) {
      viewPanDrag = null;
      updateCursor(e ? pt(e) : null);
      return;
    }
    if (drag) {
      drag = null;
      updateCursor(pt(e));
      return;
    }
    if (!drawing) return;
    drawing = false;
    const pos = pt(e);

    if (preview?.type === "select-box") {
      const box = normalizeBounds(preview.bounds || pointBounds(pos));
      if (box.w > 4 || box.h > 4) {
        const hits = elements.filter((el) => {
          if (!el || el.type === "pen" || el.type === "group-link") return false;
          return boundsOverlap(box, elementWorldBounds(el));
        });
        setSelection(hits.map((el) => el.id));
      }
      preview = null;
      connectFrom = null;
      redraw();
      return;
    }

    if (preview?.type === "pen" && canvasElementHasInk(preview)) {
      addElement(parentMarkupOnto({
        id: nid("pen"),
        type: "pen",
        color: preview.color,
        strokeWidth: preview.strokeWidth,
        points: preview.points,
        bounds: boundsFromPointsList(preview.points),
      }));
    } else if (preview?.type === "eraser" && preview.points?.length) {
      eraseAlong(preview.points);
    } else if (preview?.type === "eraser-box") {
      const box = normalizeBounds(preview.bounds);
      if (box.w > 6 || box.h > 6) {
        const ids = canvasIdsIntersectingEraseBox(elements, box);
        if (ids.length) eraseElementsByIds(ids);
      }
    } else if (preview?.type === "edge-mark") {
      if (Math.hypot((preview.x2 || 0) - preview.x1, (preview.y2 || 0) - preview.y1) > MIN_CONNECTOR_INK) {
        pushHistory();
        const el = applyInterestDefaults(parentMarkupOnto({
          id: nid("edge-mark"),
          type: "edge-mark",
          color,
          strokeWidth,
          x1: preview.x1,
          y1: preview.y1,
          x2: preview.x2,
          y2: preview.y2,
        }), "edge");
        addElement(el);
        selectedId = el.id;
        notifyChange();
        queueMicrotask(() => openInterestEditor(el));
      }
    } else if (preview && CONNECTOR_TYPES.has(preview.type)) {
      const snap = hitPort(pos) || (findNodeAt(pos) ? { el: findNodeAt(pos), port: nearestPort(findNodeAt(pos), pos) } : null);
      const x2 = snap ? snap.port.x : pos.x;
      const y2 = snap ? snap.port.y : pos.y;
      if (Math.hypot(x2 - preview.x1, y2 - preview.y1) > MIN_CONNECTOR_INK) {
        pushHistory();
        const edge = {
          id: nid("edge"),
          type: preview.type,
          color,
          strokeWidth,
          fromId: connectFrom?.id || null,
          fromPort: connectFrom?.port || null,
          toId: snap?.el?.id || null,
          toPort: snap?.port?.id || null,
          x1: preview.x1,
          y1: preview.y1,
          x2,
          y2,
        };
        if (preview.type === "link") {
          edge.linkNumber = nextLinkNumber();
          edge.relation = "";
        }
        addElement(edge);
        if (preview.type === "link") {
          selectedId = edge.id;
          queueMicrotask(() => openRelationEditor(edge));
        }
      }
    } else if (preview && (preview.type === "text" || NODE_TYPES.has(preview.type))) {
      const lasso = preview.type === "split-mark" && preview.mode === "lasso";
      const bounds = normalizeBounds(preview.bounds || (preview.points ? boundsFromPointsList(preview.points) : pointBounds(pos)));
      if ((lasso && (preview.points?.length || 0) > 4) || (bounds.w > 8 && bounds.h > 8)) {
        pushHistory();
        const el = {
          id: nid(preview.type),
          type: preview.type,
          color,
          strokeWidth,
          bounds,
          text: preview.type === "note" ? "" : "",
        };
        if (lasso && preview.points?.length) {
          el.points = preview.points;
          el.interestMode = "lasso";
        }
        parentMarkupOnto(el);
        if (INTEREST_BOX_TYPES.has(preview.type)) {
          applyInterestDefaults(el, INTEREST_KIND_BY_TOOL[preview.type] || "face");
          addElement(el);
          selectedId = el.id;
          preview = null;
          connectFrom = null;
          notifyChange();
          redraw();
          queueMicrotask(() => openInterestEditor(el));
          return;
        }
        if (preview.type === "text" || preview.type === "note") {
          addElement(el);
          selectedId = el.id;
          preview = null;
          connectFrom = null;
          redraw();
          placeTextInput(el);
          return;
        }
        addElement(el);
        selectedId = el.id;
      }
    }

    preview = null;
    connectFrom = null;
    redraw();
    renderTagBadges();
  }

  function onDblClick(e) {
    const hit = findElementAt(pt(e));
    if (!hit) return;
    if (NODE_TYPES.has(hit.type) && hit.type !== "image") {
      selectedId = hit.id;
      placeTextInput(hit);
    }
  }

  function eraseAlong(points) {
    const r = Math.max(10, strokeWidth * 4);
    const keep = [];
    for (const el of elements) {
      if (el.type === "pen" && el.points) {
        const leftover = el.points.filter((p) => !points.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < r));
        if (leftover.length > 1) keep.push({ ...el, points: leftover, bounds: boundsFromPointsList(leftover) });
        continue;
      }
      const box = el.bounds || (CONNECTOR_TYPES.has(el.type)
        ? boundsFromPoints(connectorStart(el), connectorEnd(el))
        : null);
      if (!box) { keep.push(el); continue; }
      const hit = points.some((p) => (
        p.x >= box.x - r && p.x <= box.x + box.w + r && p.y >= box.y - r && p.y <= box.y + box.h + r
      ));
      if (!hit) keep.push(el);
    }
    elements = keep;
  }

  function pointBounds(p) {
    return { x: p.x, y: p.y, w: 0, h: 0 };
  }

  function boundsFromPoints(a, b, { lockAspect = false } = {}) {
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (lockAspect) {
      const s = Math.max(w, h, MIN_NODE_SIZE);
      return {
        x: b.x >= a.x ? a.x : a.x - s,
        y: b.y >= a.y ? a.y : a.y - s,
        w: s,
        h: s,
      };
    }
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w,
      h,
    };
  }

  function boundsFromPointsList(pts) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  function elementWorldBounds(el) {
    if (el?.bounds) return el.bounds;
    if (el && Number.isFinite(el.x1) && Number.isFinite(el.x2)) {
      return {
        x: Math.min(el.x1, el.x2),
        y: Math.min(el.y1, el.y2),
        w: Math.abs(el.x2 - el.x1),
        h: Math.abs(el.y2 - el.y1),
      };
    }
    if (el?.points?.length) return boundsFromPointsList(el.points);
    return null;
  }

  function boundsOverlap(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + (b.w || 0) && a.x + (a.w || 0) > b.x && a.y < b.y + (b.h || 0) && a.y + (a.h || 0) > b.y;
  }

  function normalizeBounds(b = {}) {
    const w = Math.abs(b.w || 0);
    const h = Math.abs(b.h || 0);
    return {
      x: (b.w || 0) < 0 ? b.x + (b.w || 0) : b.x,
      y: (b.h || 0) < 0 ? b.y + (b.h || 0) : b.y,
      w,
      h,
    };
  }

  function drawGridBackground() {
    paintViewportGrid();
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function fillFor(el) {
    if (el.type === "note") return "rgba(210, 153, 34, 0.22)";
    if (el.type === "text") return "rgba(13, 17, 23, 0.55)";
    if (el.type === "image") return "rgba(22, 27, 34, 0.9)";
    const hex = String(el.color || color);
    if (!/^#/.test(hex) || hex.length < 7) return "rgba(88, 166, 255, 0.12)";
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},0.14)`;
  }

  function strokeNodePath(el) {
    const b = el.bounds;
    if (!b) return;
    const x = b.x;
    const y = b.y;
    const w = b.w;
    const h = b.h;
    ctx.beginPath();
    if (el.type === "circle" || el.type === "oval") {
      const rw = el.type === "circle" ? Math.abs(Math.min(w, h) / 2) : Math.abs(w / 2);
      const rh = el.type === "circle" ? rw : Math.abs(h / 2);
      ctx.ellipse(x + w / 2, y + h / 2, rw, rh, 0, 0, Math.PI * 2);
    } else if (el.type === "triangle") {
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
    } else if (el.type === "hexagon") {
      const cx = x + w / 2;
      const cy = y + h / 2;
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + (w / 2) * Math.cos(a);
        const py = cy + (h / 2) * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (el.type === "cloud") {
      const bumps = [
        [0.18, 0.55, 0.22], [0.38, 0.38, 0.24], [0.62, 0.36, 0.26],
        [0.82, 0.52, 0.22], [0.68, 0.72, 0.2], [0.42, 0.74, 0.22], [0.22, 0.7, 0.18],
      ];
      bumps.forEach(([ux, uy, ur], i) => {
        const cx = x + ux * w;
        const cy = y + uy * h;
        const r = Math.min(w, h) * ur;
        if (i === 0) ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      });
    } else if (el.type === "callout") {
      const bodyH = h * 0.72;
      const r = Math.min(10, w / 6, bodyH / 4);
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, bodyH, r);
      else ctx.rect(x, y, w, bodyH);
      ctx.moveTo(x + w * 0.22, y + bodyH);
      ctx.lineTo(x + w * 0.18, y + h);
      ctx.lineTo(x + w * 0.42, y + bodyH);
    } else if (el.type === "diamond") {
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x, y + h / 2);
      ctx.closePath();
    } else if (el.type === "parallelogram") {
      const skew = Math.min(28, w * 0.22);
      ctx.moveTo(x + skew, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w - skew, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
    } else if (el.type === "roundrect" || el.type === "note" || el.type === "text" || el.type === "image") {
      const r = el.type === "text" ? 6 : 10;
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
    } else {
      ctx.rect(x, y, w, h);
    }
  }

  function drawConnector(el) {
    const a = connectorStart(el);
    const b = connectorEnd(el);
    const isLink = el.type === "link";
    ctx.strokeStyle = el.color || color;
    ctx.fillStyle = el.color || color;
    ctx.lineWidth = isLink ? Math.max(1.75, (el.strokeWidth || strokeWidth) * 0.85) : (el.strokeWidth || strokeWidth);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(isLink ? [7, 6] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (el.type === "arrow") {
      const headLen = Math.max(10, (el.strokeWidth || strokeWidth) * 4);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
    if (isLink && Number(el.linkNumber) > 0) drawLinkBadge(el, a, b);
  }

  function drawLinkBadge(el, a, b) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const label = `#${el.linkNumber}`;
    ctx.save();
    ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = Math.max(22, ctx.measureText(label).width + 10);
    const h = 16;
    ctx.fillStyle = "rgba(13, 17, 23, 0.94)";
    ctx.strokeStyle = el.color || color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(mx - w / 2, my - h / 2, w, h, 8);
    else ctx.rect(mx - w / 2, my - h / 2, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e6edf3";
    ctx.fillText(label, mx, my + 0.5);
    const relation = String(el.relation || "").trim();
    if (relation) {
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(230, 237, 243, 0.92)";
      const snippet = relation.length > 32 ? `${relation.slice(0, 31)}…` : relation;
      ctx.fillText(snippet, mx, my + 16);
    }
    ctx.restore();
  }

  function drawPen(el) {
    if (!canvasElementHasInk(el)) return;
    const pts = el.points || [];
    if (pts.length < 2) return;
    ctx.strokeStyle = el.color || color;
    ctx.lineWidth = el.strokeWidth || strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function wrapText(text, maxWidth, fontSize) {
    ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    const paragraphs = String(text || "").split("\n");
    const lines = [];
    for (const para of paragraphs) {
      if (!para) { lines.push(""); continue; }
      const words = para.split(/\s+/);
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  function drawNodeLabel(el) {
    const text = String(el.text || "").trim();
    if (!text || !el.bounds) return;
    const pad = 8;
    const fontSize = Math.max(12, Math.min(22, Math.round((el.bounds.h || 40) / 6) + 10));
    const lines = wrapText(text, Math.max(20, el.bounds.w - pad * 2), fontSize);
    ctx.fillStyle = el.type === "note" ? "#f0f3f6" : (el.color || color);
    ctx.textBaseline = "top";
    ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    const lineH = fontSize + 4;
    const maxLines = Math.max(1, Math.floor((el.bounds.h - pad * 2) / lineH));
    lines.slice(0, maxLines).forEach((line, i) => {
      ctx.fillText(line, el.bounds.x + pad, el.bounds.y + pad + i * lineH, el.bounds.w - pad * 2);
    });
  }

  function drawElement(el) {
    if (el.type === "pen") { drawPen(el); return; }
    if (CONNECTOR_TYPES.has(el.type)) { drawConnector(el); return; }
    if (INTEREST_TYPES.has(el.type) || el.interestKind) {
      drawInterestMark(el);
      return;
    }
    if (!el.bounds) return;
    ctx.lineWidth = el.strokeWidth || strokeWidth;
    ctx.strokeStyle = el.color || color;
    ctx.fillStyle = fillFor(el);
    ctx.lineJoin = "round";
    strokeNodePath(el);
    ctx.fill();
    ctx.stroke();
    if (el.type === "image" && el.dataUrl) {
      const img = imageCache.get(el.dataUrl);
      if (img) {
        const pad = 4;
        ctx.drawImage(img, el.bounds.x + pad, el.bounds.y + pad, el.bounds.w - pad * 2, el.bounds.h - pad * 2);
      } else {
        void loadImage(el.dataUrl).then(() => redraw());
      }
      drawImageNameLabel(el);
      if (isCanvasFinalExample(el)) drawFinalLookFrame(el);
    }
    drawNodeLabel(el);
  }

  function drawFinalLookFrame(el) {
    const b = el?.bounds;
    if (!b || !ctx) return;
    ctx.save();
    ctx.strokeStyle = "#f0c14b";
    ctx.lineWidth = 3.4;
    ctx.shadowColor = "rgba(240, 193, 75, 0.55)";
    ctx.shadowBlur = 14;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6, 8);
      ctx.stroke();
    } else {
      ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
    }
    ctx.restore();
  }

  function drawImageNameLabel(el) {
    const name = canvasImageDisplayName(el, "");
    if (!name || !el?.bounds || !ctx) return;
    ctx.save();
    ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
    const padX = 6;
    const maxW = Math.max(24, el.bounds.w - 8);
    const textW = ctx.measureText(name).width;
    const w = Math.min(maxW, textW + padX * 2);
    const h = 18;
    const x = el.bounds.x + el.bounds.w - w - 4;
    const y = el.bounds.y + 4;
    ctx.fillStyle = "rgba(13, 17, 23, 0.86)";
    ctx.strokeStyle = "rgba(88, 166, 255, 0.5)";
    ctx.lineWidth = 1;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 8);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    ctx.fillStyle = "#a5d6ff";
    ctx.textBaseline = "middle";
    ctx.fillText(name, x + padX, y + h / 2, w - padX * 2);
    ctx.restore();
  }

  function drawEraserBox(bounds) {
    const b = normalizeBounds(bounds);
    if (!ctx || b.w < 1 || b.h < 1) return;
    ctx.save();
    ctx.strokeStyle = "#f85149";
    ctx.fillStyle = "rgba(248, 81, 73, 0.12)";
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.2;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }

  function drawSelection(el) {
    if (!el?.bounds) return;
    const b = el.bounds;
    ctx.save();
    ctx.strokeStyle = "#58a6ff";
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
    ctx.setLineDash([]);
    ctx.fillStyle = "#58a6ff";
    ctx.strokeStyle = "#0d1117";
    ctx.lineWidth = 1.5;
    for (const h of Object.values(handlesOf(b))) {
      ctx.beginPath();
      ctx.rect(h.x - 5, h.y - 5, 10, 10);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawInterestArrows(el, box) {
    const dir = String(el.direction || "up");
    const cut = el.action === "cut";
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const inward = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] };
    const outward = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const [vx, vy] = (cut ? inward : outward)[dir] || outward.up;
    let ox = cx;
    let oy = cy;
    if (dir === "up") oy = box.y + (cut ? 10 : 4);
    if (dir === "down") oy = box.y + box.h - (cut ? 10 : 4);
    if (dir === "left") ox = box.x + (cut ? 10 : 4);
    if (dir === "right") ox = box.x + box.w - (cut ? 10 : 4);
    const len = 14;
    ctx.save();
    ctx.strokeStyle = cut ? "#f85149" : "#3fb950";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const offset of [-12, 0, 12]) {
      const px = ox + (dir === "up" || dir === "down" ? offset : 0);
      const py = oy + (dir === "left" || dir === "right" ? offset : 0);
      const x2 = px + vx * len;
      const y2 = py + vy * len;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const angle = Math.atan2(vy, vx);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - 6 * Math.cos(angle - Math.PI / 6), y2 - 6 * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - 6 * Math.cos(angle + Math.PI / 6), y2 - 6 * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawInterestMark(el) {
    ctx.save();
    const kind = interestKindFor(el);
    const stroke = el.action === "cut" ? "#f85149" : (kind === "split" ? "#d29922" : "#58a6ff");
    ctx.strokeStyle = el.color || stroke;
    ctx.fillStyle = "rgba(88, 166, 255, 0.08)";
    ctx.lineWidth = Math.max(1.75, el.strokeWidth || 2);
    ctx.setLineDash(kind === "edge" ? [1, 0] : [7, 5]);
    if (el.type === "edge-mark" || (kind === "edge" && Number.isFinite(el.x1))) {
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      const mx = (el.x1 + el.x2) / 2;
      const my = (el.y1 + el.y2) / 2;
      drawInterestArrows(el, { x: mx - 16, y: my - 16, w: 32, h: 32 });
    } else if (el.interestMode === "lasso" && el.points?.length) {
      ctx.beginPath();
      ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i += 1) ctx.lineTo(el.points[i].x, el.points[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      if (el.bounds) drawInterestArrows(el, el.bounds);
    } else if (el.bounds) {
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(el.bounds.x, el.bounds.y, el.bounds.w, el.bounds.h, 8);
      else ctx.rect(el.bounds.x, el.bounds.y, el.bounds.w, el.bounds.h);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      if (kind !== "view") drawInterestArrows(el, el.bounds);
    }
    ctx.restore();
    if (el.bounds) drawNodeLabel(el);
  }

  function drawPorts(el) {
    if (!NODE_TYPES.has(el.type) || !el.bounds || INTEREST_TYPES.has(el.type)) return;
    ctx.save();
    for (const p of Object.values(portsOf(el))) {
      const hot = hoverPort?.el?.id === el.id && hoverPort?.port?.id === p.id;
      ctx.beginPath();
      ctx.fillStyle = hot ? "#3fb950" : "#58a6ff";
      ctx.strokeStyle = "#0d1117";
      ctx.lineWidth = 1.5;
      ctx.arc(p.x, p.y, hot ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function redraw() {
    if (!ctx || !canvas) return;
    drawGridBackground();
    ctx.globalCompositeOperation = "source-over";
    const live = sanitizeCanvasElements(elements);
    const images = live.filter((el) => el.type === "image");
    const connectors = live.filter((el) => CONNECTOR_TYPES.has(el.type));
    const rest = live.filter((el) => el.type !== "image" && !CONNECTOR_TYPES.has(el.type));
    images.forEach(drawElement);
    connectors.forEach(drawElement);
    rest.forEach(drawElement);
    if (preview) {
      if (preview.type === "pen") {
        if (canvasElementHasInk(preview)) drawPen(preview);
      } else if ((preview.type === "eraser-box" || preview.type === "select-box") && preview.bounds) {
        drawEraserBox(preview.bounds);
      } else if (preview.type === "edge-mark" || INTEREST_TYPES.has(preview.type)) {
        drawInterestMark(preview);
      } else if (CONNECTOR_TYPES.has(preview.type)) drawConnector(preview);
      else if (preview.bounds) drawElement(preview);
    }
    remotePreviews.forEach((remote) => {
      if (!remote) return;
      if (remote.type === "pen" && remote.points) drawPen(remote);
      else if (CONNECTOR_TYPES.has(remote.type)) drawConnector(remote);
      else if (remote.bounds) drawElement(remote);
    });
    const showPorts = CONNECTOR_TYPES.has(tool) || !!connectFrom;
    if (showPorts) {
      images.forEach(drawPorts);
      rest.forEach(drawPorts);
    }
    for (const id of selectionList()) {
      const selected = elementById(id);
      if (selected && (NODE_TYPES.has(selected.type) || selected.type === "edge-mark") && selected.bounds) {
        drawSelection(selected);
      }
    }
    if (!drawing && !drag) renderTagBadges();
  }

  function placeTextInput(el) {
    dismissTextInput();
    const area = containerEl.querySelector("#canvas-draw-area");
    const view = viewEl || area;
    if (!view || !el.bounds) return;
    pushHistory();
    textInput = document.createElement("textarea");
    textInput.className = "canvas-text-input canvas-text-input--box";
    textInput.value = el.text || "";
    textInput.placeholder = el.type === "note" ? "Note…" : "Type in this box…";
    textInput.style.left = `${el.bounds.x}px`;
    textInput.style.top = `${el.bounds.y}px`;
    textInput.style.width = `${Math.max(80, el.bounds.w)}px`;
    textInput.style.height = `${Math.max(36, el.bounds.h)}px`;
    textInput.style.color = el.color || color;
    textInput.dataset.elId = el.id;
    view.appendChild(textInput);
    textInput.focus();
    textInput.select();
    textInput.addEventListener("keydown", (ev) => {
      if (isCanvasUndoShortcut(ev)) {
        ev.preventDefault();
        ev.stopPropagation();
        undo();
        return;
      }
      if (isCanvasRedoShortcut(ev)) {
        ev.preventDefault();
        ev.stopPropagation();
        redo();
        return;
      }
      ev.stopPropagation();
      if (ev.key === "Escape") {
        ev.preventDefault();
        dismissTextInput();
        redraw();
      }
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        commitTextInput();
      }
    });
    textInput.addEventListener("blur", () => commitTextInput());
  }

  function commitTextInput() {
    if (!textInput) return;
    const id = textInput.dataset.elId;
    const text = textInput.value;
    const node = textInput;
    textInput = null;
    node.remove();
    const el = elementById(id);
    if (!el) return;
    el.text = text;
    redraw();
    renderTagBadges();
  }

  function dismissTextInput() {
    if (textInput) { textInput.remove(); textInput = null; }
  }

  function closeTagMenu() {
    tagMenu?.remove();
    tagMenu = null;
  }

  function groupableSelection() {
    return selectionList().filter((id) => {
      const el = elementById(id);
      return el && el.type !== "pen" && el.type !== "link" && el.type !== "group-link";
    });
  }

  function findGroupLinkFor(ids) {
    const set = new Set(ids);
    return elements.find((el) => (
      el.type === "group-link"
      && (el.memberIds || []).length === set.size
      && (el.memberIds || []).every((id) => set.has(id))
    )) || null;
  }

  function createGroupLink(ids) {
    const members = [...new Set(ids)].filter((id) => elementById(id));
    if (members.length < 2) return null;
    const existing = findGroupLinkFor(members);
    if (existing) return existing;
    pushHistory();
    const el = {
      id: nid("glink"),
      type: "group-link",
      linkNumber: nextLinkNumber(),
      linkName: "",
      memberIds: members,
      relation: "",
    };
    addElement(el);
    notifyChange();
    return el;
  }

  function onContextMenu(event) {
    event.preventDefault();
    const target = findElementAt(pt(event));
    if (target && target.type !== "group-link" && !selectedIds.has(target.id)) {
      setSelection([target.id]);
    }
    const groupable = groupableSelection();
    if (target?.type === "group-link" || (target?.type === "link" && groupable.length < 2)) {
      openRelationEditor(target);
      return;
    }
    if (!target) {
      if (groupable.length >= 2) {
        showTagMenu(elementById(groupable[0]), event.clientX, event.clientY, { canLink: true, groupable });
        return;
      }
      closeTagMenu();
      closeInterestEditor();
      return;
    }
    showTagMenu(target, event.clientX, event.clientY, { canLink: groupable.length >= 2, groupable });
  }

  function setFinalExample(element, on) {
    if (!element || element.type !== "image") return;
    pushHistory();
    for (const el of elements) {
      if (el.type === "image") el.finalExample = false;
    }
    element.finalExample = !!on;
    notifyChange();
    lastTagSignature = "";
    renderTagBadges();
    redraw();
  }

  function showTagMenu(element, clientX, clientY, { canLink = false, groupable = [] } = {}) {
    closeTagMenu();
    tagMenu = document.createElement("div");
    tagMenu.className = "canvas-tag-menu";
    tagMenu.innerHTML = `
      ${element ? `<button type="button" class="canvas-send-region-btn" data-canvas-send-region title="Insert a prompt mention like box: @box1">Send to AI</button>` : ""}
      ${element && element.type !== "image" ? `<button type="button" data-canvas-open-interest>View / face of interest…</button>` : ""}
      ${canLink ? `<button type="button" data-canvas-group-link>Link</button>` : ""}
      ${element?.type === "image" ? `
        <button type="button" class="canvas-rename-btn" data-canvas-rename>Rename</button>
        <button type="button" class="canvas-final-look-btn" data-canvas-final-look>
          ${isCanvasFinalExample(element) ? "Unmark final look" : "Mark as final example"}
        </button>
      ` : ""}
      <strong>Tag this shape</strong>
      <span>Tell AI what this drawing represents.</span>
      <div class="canvas-tag-options">
        ${CANVAS_TAGS.map((tag) => `<button type="button" data-canvas-tag="${tag}">${tag}</button>`).join("")}
        <button type="button" data-canvas-tag-custom>Other…</button>
        ${element?.tag ? `<button type="button" data-canvas-tag-clear>Clear tag</button>` : ""}
      </div>
    `;
    placeCanvasContextMenu(tagMenu, clientX, clientY);
    tagMenu.addEventListener("click", (event) => {
      if (event.target.closest("[data-canvas-send-region]")) {
        sendNodeToAi(element);
        closeTagMenu();
        return;
      }
      if (event.target.closest("[data-canvas-open-interest]")) {
        closeTagMenu();
        openInterestEditor(element, clientX, clientY);
        return;
      }
      if (event.target.closest("[data-canvas-group-link]")) {
        const link = createGroupLink(groupable.length ? groupable : groupableSelection());
        closeTagMenu();
        if (link) openRelationEditor(link);
        return;
      }
      if (event.target.closest("[data-canvas-final-look]")) {
        setFinalExample(element, !isCanvasFinalExample(element));
        closeTagMenu();
        return;
      }
      if (event.target.closest("[data-canvas-rename]")) {
        const current = canvasImageDisplayName(element, "");
        const next = slugifyCanvasImageName(window.prompt("Image name", current) || "");
        if (next) {
          pushHistory();
          element.imageName = next;
          element.tag = next;
          notifyChange();
        }
        closeTagMenu();
        lastTagSignature = "";
        renderTagBadges();
        redraw();
        return;
      }
      const tagBtn = event.target.closest("[data-canvas-tag]");
      if (tagBtn) {
        element.tag = tagBtn.getAttribute("data-canvas-tag");
        notifyChange();
        closeTagMenu();
        renderTagBadges();
        return;
      }
      if (event.target.closest("[data-canvas-tag-custom]")) {
        const custom = window.prompt("What is this shape?", element.tag || "");
        if (custom?.trim()) element.tag = custom.trim().slice(0, 40);
        notifyChange();
        closeTagMenu();
        renderTagBadges();
        return;
      }
      if (event.target.closest("[data-canvas-tag-clear]")) {
        delete element.tag;
        notifyChange();
        closeTagMenu();
        renderTagBadges();
      }
    });
  }

  function renderTagBadges() {
    const layer = containerEl?.querySelector("#canvas-tag-layer");
    if (!layer) return;
    const tagged = elements.filter((el) => (el.tag || el.imageName || el.finalExample || el.interestKind) && (el.bounds || Number.isFinite(el.x1)));
    const signature = tagged.map((el) => {
      const b = el.bounds || {};
      return `${el.id}:${el.tag}:${el.imageName || ""}:${el.finalExample ? 1 : 0}:${el.interestKind || ""}:${el.action || ""}:${el.direction || ""}:${Math.round(b.x || el.x1 || 0)}:${Math.round(b.y || el.y1 || 0)}:${Math.round(b.w || 0)}:${Math.round(b.h || 0)}`;
    }).join("|");
    if (signature === lastTagSignature) return;
    lastTagSignature = signature;
    layer.innerHTML = tagged
      .map((el) => {
        const b = el.bounds;
        const image = el.type === "image";
        const finalLook = isCanvasFinalExample(el);
        const mx = b ? (image ? b.x + b.w - 8 : b.x + b.w / 2) : ((Number(el.x1) + Number(el.x2)) / 2);
        const my = b ? b.y : ((Number(el.y1) + Number(el.y2)) / 2);
        const x = Math.max(8, Math.min((canvas?.width || 0) - 140, image ? mx - 120 : mx - 48));
        const y = Math.max(8, (b ? b.y : my) - (image ? 0 : 28));
        const label = el.interestKind ? interestTitle(el) : (image ? canvasImageDisplayName(el, el.tag) : el.tag);
        const nameBtn = label
          ? `<button type="button" class="canvas-tag-badge${image ? " canvas-image-name" : ""}" data-canvas-el="${el.id}" style="left:${x}px;top:${y}px;">${escapeHtml(label)}</button>`
          : "";
        const lookBtn = finalLook && b
          ? `<button type="button" class="canvas-final-look-badge" data-canvas-el="${el.id}" data-final-look title="${escapeHtml(CANVAS_FINAL_LOOK_TIP)}" style="left:${Math.max(8, b.x + 6)}px;top:${Math.max(8, b.y + 6)}px;">Final look</button>`
          : "";
        return `${lookBtn}${nameBtn}`;
      })
      .join("");
    layer.querySelectorAll("[data-canvas-el]").forEach((badge) => {
      const open = (event) => {
        event.preventDefault();
        const element = elements.find((el) => el.id === badge.getAttribute("data-canvas-el"));
        if (!element) return;
        if (element.type === "image") showTagMenu(element, event.clientX, event.clientY);
        else openInterestEditor(element, event.clientX, event.clientY);
      };
      badge.addEventListener("click", open);
      badge.addEventListener("contextmenu", open);
    });
  }

  function syncFinalLookTip(pos) {
    const tip = containerEl?.querySelector("#canvas-final-look-tip");
    if (!tip) return;
    const hit = pos ? findElementAt(pos) : null;
    if (hit?.type === "image" && isCanvasFinalExample(hit)) {
      tip.textContent = CANVAS_FINAL_LOOK_TIP;
      tip.classList.remove("hidden");
      const area = containerEl.querySelector("#canvas-draw-area") || viewEl;
      const rect = area?.getBoundingClientRect?.();
      if (rect && pos) {
        const left = Math.min((canvas?.width || 400) - 220, Math.max(8, pos.x + 14));
        const top = Math.min((canvas?.height || 300) - 56, Math.max(8, pos.y + 18));
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      }
    } else {
      tip.classList.add("hidden");
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function syncTranscript(text) {
    voiceTranscript = String(text || "").replace(/\s*…\s*$/, "").trim();
    const panel = voiceEls?.transcriptPanel;
    if (panel) {
      panel.textContent = text?.trim() ? text : "No recording yet.";
      panel.classList.toggle("muted", !text?.trim());
    }
    onTranscriptChange?.(text);
  }

  function bindActions() {
    voiceEls?.clearTranscriptBtn?.addEventListener("click", () => syncTranscript(""));
  }

  function isTypingTarget(target) {
    if (!target || target === document.body || target === document.documentElement) return false;
    if (target.isContentEditable) return true;
    return !!target.closest?.(
      [
        "textarea",
        "input",
        "select",
        "[contenteditable='true']",
        "[contenteditable='']",
        "[contenteditable]",
        "#prompt-input",
        "#prompt-pane-compose",
        ".prompt-editor",
        ".prompt-editor-wrap",
        ".prompt-compose",
        ".pc-input",
        ".pc-composer",
        "#wiring-prompt-input",
        "#rigging-prompt-input",
        "#sketch-prompt-input",
      ].join(", "),
    );
  }

  function isCanvasTextInput(target) {
    return !!target?.closest?.("textarea.canvas-text-input, .canvas-text-input, .canvas-relation-pop, .canvas-interest-pop");
  }

  function isForeignTextField(target) {
    if (isCanvasTextInput(target)) return false;
    return isTypingTarget(target);
  }

  function bindKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (!isActive()) return;
      if (document.querySelector(".main-column.canvas-layout-split")
        && !containerEl.contains(e.target) && !containerEl.contains(document.activeElement)) return;
      const foreign = isForeignTextField(e.target) || isForeignTextField(document.activeElement);
      const canvasText = isCanvasTextInput(e.target) || isCanvasTextInput(document.activeElement);

      if (isCanvasUndoShortcut(e)) {
        if (foreign) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        undo();
        return;
      }
      if (isCanvasRedoShortcut(e)) {
        if (foreign) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        redo();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selectedId && !foreign && !canvasText) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        deleteSelected();
        return;
      }
      if (isCanvasEscapeToMove(e)) {
        if (foreign && !canvasText) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (textInput) dismissTextInput();
        closeRelationEditor();
        closeInterestEditor();
        restoreMoveTool();
        return;
      }

      if (foreign || canvasText) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const key = String(e.key || "");
        const code = String(e.code || "");
        if (key === "=" || key === "+" || code === "Equal" || code === "NumpadAdd") {
          e.preventDefault();
          e.stopPropagation();
          zoomCanvasViewBy(1.15);
          return;
        }
        if (key === "-" || key === "−" || code === "Minus" || code === "NumpadSubtract") {
          e.preventDefault();
          e.stopPropagation();
          zoomCanvasViewBy(1 / 1.15);
          return;
        }
        if (key === "0" || code === "Digit0" || code === "Numpad0") {
          e.preventDefault();
          e.stopPropagation();
          resetCanvasView();
          return;
        }
      }
      const next = canvasToolFromShortcutEvent(e);
      if (next) {
        e.preventDefault();
        setTool(next);
      }
    }, true);
  }

  function bindVoice() {
    voiceEls?.recordBtn?.addEventListener("click", () => {
      if (recognizing || mediaRecorder?.state === "recording") stopVoice();
      else startVoice();
    });
  }

  async function startVoice() {
    const btn = voiceEls?.recordBtn;
    const timer = voiceEls?.timer;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      const dictationLang = String(navigator.language || navigator.userLanguage || "").trim();
      if (dictationLang) recognition.lang = dictationLang;
      let interim = "";
      recognition.onresult = (e) => {
        interim = "";
        let final = voiceTranscript;
        for (const r of e.results) {
          if (r.isFinal) final += (final ? " " : "") + r[0].transcript;
          else interim += r[0].transcript;
        }
        syncTranscript(final + (interim ? ` ${interim}…` : ""));
      };
      recognition.onerror = () => { };
      recognition.start();
      recognizing = true;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (ev) => audioChunks.push(ev.data);
      mediaRecorder.start();
    } catch (_) { }

    recordingStartTime = Date.now();
    if (btn) { btn.textContent = "⏹ Stop recording"; btn.classList.add("recording"); }
    timer?.classList.remove("hidden");
    recordingTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recordingStartTime) / 1000);
      const m = Math.floor(s / 60);
      const sec = String(s % 60).padStart(2, "0");
      if (voiceEls?.time) voiceEls.time.textContent = `${m}:${sec}`;
    }, 500);
  }

  function stopVoice() {
    const btn = voiceEls?.recordBtn;
    const timer = voiceEls?.timer;
    recognition?.stop();
    recognizing = false;
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    clearInterval(recordingTimer);
    if (btn) { btn.textContent = "🎤 Record voice note"; btn.classList.remove("recording"); }
    timer?.classList.add("hidden");
  }

  function getCanvasDataUrl() {
    if (!canvas) return null;
    const srcW = canvas.width || 1;
    const srcH = canvas.height || 1;
    const scale = Math.min(1, CANVAS_SNAPSHOT_MAX_DIM / Math.max(srcW, srcH, 1));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const snap = typeof document !== "undefined" ? document.createElement("canvas") : canvas;
    snap.width = w;
    snap.height = h;
    const sctx = snap.getContext?.("2d");
    if (!sctx) return canvas.toDataURL?.("image/jpeg", CANVAS_IMAGE_JPEG_QUALITY) ?? null;
    const spacing = canvasGridSpacing(scale);
    fillCanvasGrid(sctx, w, h, {
      originX: 0,
      originY: 0,
      zoom: scale,
      minor: spacing.minor,
      major: spacing.major,
    });
    sctx.drawImage(canvas, 0, 0, w, h);
    return snap.toDataURL("image/jpeg", 0.82);
  }

  async function getPromptSnapshot() {
    const images = elements.filter((el) => el.type === "image" && el.dataUrl);
    const loaded = await Promise.all(images.map((el) => loadImage(el.dataUrl)));
    if (loaded.some((img) => !img)) throw new Error("A canvas image could not be loaded. Reopen the canvas and try again.");
    const oldSelection = selectedId;
    const oldTool = tool;
    selectedId = null;
    tool = "select";
    redraw();
    const snapshot = { data_url: getCanvasDataUrl(), drawing_metadata: getDrawingMetadata() };
    selectedId = oldSelection;
    tool = oldTool;
    redraw();
    return snapshot;
  }

  function resetTransientDrawing() {
    drawing = false;
    drag = null;
    preview = null;
    connectFrom = null;
    hoverPort = null;
    startPt = null;
    drawParentId = null;
    closeRelationEditor();
    closeInterestEditor();
  }

  function exportState() {
    return {
      title: canvasTitle,
      description: canvasDescription,
      elements: sanitizeCanvasElements(cloneElements()),
      width: canvas?.width,
      height: canvas?.height,
      drawing_metadata: getDrawingMetadata(),
      edit_timeline: editTimeline,
      ...(spatialBoardState ? { spatial_board: spatialBoardState } : {}),
    };
  }

  function getDrawingMetadata() {
    return buildCanvasDrawingMetadata({
      title: canvasTitle,
      description: canvasDescription,
      elements: sanitizeCanvasElements(elements),
      width: canvas?.width || 1,
      height: canvas?.height || 1,
    });
  }

  function importState(state = {}) {
    spatialBoardState = state.spatial_board && typeof state.spatial_board === "object" ? state.spatial_board : null;
    if (state.title) setTitle(state.title, { silent: true });
    canvasDescription = String(state.description || state.drawing_metadata?.description || "");
    editTimeline = Array.isArray(state.edit_timeline) ? state.edit_timeline : [];
    resetTransientDrawing();
    selectedId = null;
    selectedIds = new Set();
    elements = cloneElements(sanitizeCanvasElements(state.elements || []));
    if (canvas) {
      const boxes = elements.filter((el) => el.bounds).map((el) => el.bounds);
      canvas.width = Math.ceil(Math.max(1, Number(state.width) || 900, ...boxes.map((b) => b.x + b.w + 24)));
      canvas.height = Math.ceil(Math.max(1, Number(state.height) || 600, ...boxes.map((b) => b.y + b.h + 24)));
      resizeCanvasKeepContent();
    }
    syncParentedBounds();
    lastTagSignature = "";
    redraw();
    renderEditTimeline();
  }

  async function addImageFromUrl(url, pos = {}) {
    const x = finiteCoord(pos.x, (canvas?.width || 400) / 2);
    const y = finiteCoord(pos.y, (canvas?.height || 300) / 2);
    pushHistory();
    await addImageNode(x, y, url);
    redraw();
  }

  async function addDroppedImageFiles(files, pos = {}) {
    const incoming = [...(files || [])].filter(isCanvasImageFile);
    if (!incoming.length) return [];
    const list = await convertHeicIngestFiles(incoming);
    let x = finiteCoord(pos.x, (canvas?.width || 400) / 2);
    let y = finiteCoord(pos.y, (canvas?.height || 300) / 2);
    pushHistory();
    for (const file of list) {
      const dataUrl = await readFileAsDataUrl(file);
      await addImageNode(x, y, dataUrl, file.name);
      x += 28;
      y += 20;
    }
    redraw();
    restoreMoveTool();
    return list;
  }

  function hasDrawing() {
    return sanitizeCanvasElements(elements).length > 0;
  }

  function getTranscript() {
    return voiceTranscript.trim();
  }

  function getTaggedContext() {
    const width = canvas?.width || 1;
    const height = canvas?.height || 1;
    const tagged = elements
      .filter((el) => el.tag && el.bounds)
      .map((el, index) => {
        const b = el.bounds;
        return {
          index: index + 1,
          tag: el.tag,
          type: el.type,
          x: Math.round((b.x / width) * 100),
          y: Math.round((b.y / height) * 100),
          w: Math.round((b.w / width) * 100),
          h: Math.round((b.h / height) * 100),
          text: el.text || undefined,
        };
      });
    const summary = tagged.length
      ? tagged.map((el) => `${el.index}. ${el.tag} (${el.type}) at ${el.x}%,${el.y}% size ${el.w}%x${el.h}%${el.text ? ` text "${el.text}"` : ""}`).join("\n")
      : "";
    return { tagged, summary, totalElements: elements.length };
  }

  function show() {
    resetTransientDrawing();
    elements = sanitizeCanvasElements(elements);
    containerEl?.classList.remove("hidden");
    containerEl?.closest(".canvas-workspace-wrap")?.classList.remove("hidden");
    resizeCanvasKeepContent();
    updateCursor();
    canvas?.focus?.({ preventScroll: true });
  }

  function hide() {
    resetTransientDrawing();
    hideSharePopover();
    hideInvitePopover();
    hideAuthorHover();
    hideLoadPopover();
    closeRelationEditor();
    closeInterestEditor();
    containerEl?.classList.add("hidden");
    dismissTextInput();
    stopVoice();
    redraw();
  }

  function destroy() {
    stopVoice();
    dismissTextInput();
    closeTagMenu();
    closeRelationEditor();
    closeInterestEditor();
    history = [];
    redoStack = [];
    elements = [];
    selectedId = null;
    lastTagSignature = "";
    imageCache.clear();
    revokeTrackedObjectUrls(canvasDisplayCreated);
    resetTransientDrawing();
    redraw();
    renderTagBadges();
    updateUndoRedo();
    syncTranscript("");
  }

  function rebuild() {
    destroy();
    init();
  }

  init();

  return {
    show,
    hide,
    destroy,
    rebuild,
    stopVoice,
    getCanvasDataUrl,
    getPromptSnapshot,
    getExportBlob,
    getTranscript,
    getTaggedContext,
    getDrawingMetadata,
    getInterests,
    updateInterestPrompt,
    getPromptGraph: () => canvasPromptGraph(elements, { boardName: canvasTitle, description: canvasDescription }),
    getDescription: () => canvasDescription,
    setDescription: (text) => {
      canvasDescription = String(text || "");
      notifyChange();
    },
    hasDrawing,
    clearCanvas,
    exportState,
    importState,
    addImageFromUrl,
    addDroppedImageFiles,
    pointFromClient,
    selectElement,
    selectElements,
    setTitle,
    getTitle,
    setCanvasPermission,
    setCollabPresence,
    applyCollabMessage,
    getCanvasPermission: () => canvasPermission,
  };
}

export async function renderCanvasBoardSnapshot(state, { fetchFile } = {}) {
  const mode = createCanvasMode({ containerEl: document.createElement("div"), snapshotOnly: true, fetchFile });
  mode.importState(state);
  return mode.getPromptSnapshot();
}
