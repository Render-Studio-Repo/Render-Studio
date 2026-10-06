/** Saved viewport split layouts — general Studio setting, shareable, marketplace-installable. */

export const VIEWPORT_LAYOUT_KIND = "viewport_layout";
export const VIEWPORT_LAYOUT_VERSION = 1;
export const LS_VIEWPORT_LAYOUTS = "render3d:viewport-layouts:v1";
export const VIEWPORT_LAYOUT_CACHE = "vplayout=20260916-1&layui1";
export const LS_VIEWPORT_LAYOUT_VIEW = "render3d:viewport-layouts:view";
export const LOGO_SRC = "/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1";
export const LAYOUT_CONFIGS_GIF = "/media/images/render-animations/VR-Animations/viewport-layout-configs.svg?v=layui1";

const NAME_MAX = 80;
const DESC_MAX = 2000;
const DIRECTIONS = new Set(["up", "left", "down", "right"]);
const HORIZ = new Set(["left", "right"]);

/** Official starter layouts people paste into Import. No fake copy counts. */
export const POPULAR_LAYOUT_TEMPLATES = [
  {
    token: "vpl-wiring-right",
    name: "Viewport + Wiring",
    description: "3D on the left, schematic on the right.",
    sharePath: "/share/vpl-wiring-right",
    tree: {
      type: "split",
      direction: "right",
      ratio: 0.5,
      a: { type: "leaf", pane: "viewport", kind: "viewport", id: "__viewport__", label: "Viewport" },
      b: { type: "leaf", pane: "doc", kind: "wiring", id: "__wiring__", label: "Wiring" },
    },
  },
  {
    token: "vpl-mcmaster-right",
    name: "Viewport + McMaster",
    description: "Parts catalog docked beside 3D — not a popup.",
    sharePath: "/share/vpl-mcmaster-right",
    tree: {
      type: "split",
      direction: "right",
      ratio: 0.5,
      a: { type: "leaf", pane: "viewport", kind: "viewport", id: "__viewport__", label: "Viewport" },
      b: { type: "leaf", pane: "doc", kind: "mcmaster", id: "mcmaster", label: "McMaster" },
    },
  },
  {
    token: "vpl-parts-down",
    name: "Viewport + Parts List",
    description: "BOM under the 3D view.",
    sharePath: "/share/vpl-parts-down",
    tree: {
      type: "split",
      direction: "down",
      ratio: 0.55,
      a: { type: "leaf", pane: "viewport", kind: "viewport", id: "__viewport__", label: "Viewport" },
      b: { type: "leaf", pane: "doc", kind: "parts", id: "__parts_list__", label: "Parts List" },
    },
  },
  {
    token: "vpl-canvas-right",
    name: "Viewport + Canvas",
    description: "Sketch beside the 3D view.",
    sharePath: "/share/vpl-canvas-right",
    tree: {
      type: "split",
      direction: "right",
      ratio: 0.5,
      a: { type: "leaf", pane: "viewport", kind: "viewport", id: "__viewport__", label: "Viewport" },
      b: { type: "leaf", pane: "doc", kind: "canvas", id: "__canvas__", label: "Canvas" },
    },
  },
  {
    token: "vpl-quad-left-down",
    name: "Build Desk Quad",
    description: "2×2: Canvas, Viewport, Wiring, Parts List. One WebGL viewport.",
    sharePath: "/share/vpl-quad-left-down",
    tree: {
      type: "split",
      direction: "left",
      ratio: 0.5,
      a: {
        type: "split",
        direction: "down",
        ratio: 0.5,
        a: { type: "leaf", pane: "doc", kind: "canvas", id: "__canvas__", label: "Canvas" },
        b: { type: "leaf", pane: "doc", kind: "wiring", id: "__wiring__", label: "Wiring" },
      },
      b: {
        type: "split",
        direction: "down",
        ratio: 0.5,
        a: { type: "leaf", pane: "viewport", kind: "viewport", id: "__viewport__", label: "Viewport" },
        b: { type: "leaf", pane: "doc", kind: "parts", id: "__parts_list__", label: "Parts List" },
      },
    },
  },
  {
    token: "vpl-robot-ops-quad",
    name: "Robot Ops Quad",
    description: "3D, Viser, Teleop, and Parts List for robot bring-up.",
    sharePath: "/share/vpl-robot-ops-quad",
    tree: {
      type: "split", direction: "left", ratio: 0.56,
      a: { type: "split", direction: "down", ratio: 0.55,
        a: { type: "leaf", pane: "doc", kind: "viser", id: "viser:open", label: "Viser" },
        b: { type: "leaf", pane: "doc", kind: "teleop", id: "teleop:open", label: "Teleop" } },
      b: { type: "split", direction: "down", ratio: 0.6,
        a: { type: "leaf", pane: "viewport", kind: "viewport", id: "__viewport__", label: "Viewport" },
        b: { type: "leaf", pane: "doc", kind: "parts", id: "__parts_list__", label: "Parts List" } },
    },
  },
  {
    token: "vpl-cad-sourcing-quad",
    name: "CAD Sourcing Quad",
    description: "3D, McMaster, Canvas, and Parts List for sourcing and fit checks.",
    sharePath: "/share/vpl-cad-sourcing-quad",
    tree: {
      type: "split", direction: "right", ratio: 0.56,
      a: { type: "split", direction: "down", ratio: 0.62,
        a: { type: "leaf", pane: "viewport", kind: "viewport", id: "__viewport__", label: "Viewport" },
        b: { type: "leaf", pane: "doc", kind: "canvas", id: "__canvas__", label: "Canvas" } },
      b: { type: "split", direction: "down", ratio: 0.55,
        a: { type: "leaf", pane: "doc", kind: "mcmaster", id: "mcmaster", label: "McMaster" },
        b: { type: "leaf", pane: "doc", kind: "parts", id: "__parts_list__", label: "Parts List" } },
    },
  },
];

export function isHorizontalDir(dir) {
  return HORIZ.has(String(dir || "").toLowerCase());
}

export function isOrthogonalSplit(a, b) {
  const left = String(a || "").toLowerCase();
  const right = String(b || "").toLowerCase();
  if (!DIRECTIONS.has(left) || !DIRECTIONS.has(right)) return false;
  return isHorizontalDir(left) !== isHorizontalDir(right);
}

export function layoutTimestamp(layout) {
  const raw = layout?.updatedAt || layout?.createdAt || layout?.updated_at || layout?.created_at || "";
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : 0;
}

export function sortLayoutsNewestFirst(layouts = []) {
  return [...(layouts || [])].sort((a, b) => {
    const diff = layoutTimestamp(b) - layoutTimestamp(a);
    if (diff) return diff;
    return String(b?.id || "").localeCompare(String(a?.id || ""));
  });
}

export function layoutMatchesQuery(layout, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    layout?.name,
    layout?.description,
    layout?.sharePath,
    layout?.token,
    layout?.shareToken,
    ...(layout?.tabs || []).map((tab) => tab?.label || tab?.kind),
  ].join(" ").toLowerCase();
  return hay.includes(q);
}

export function filterLayouts(layouts, query) {
  return (layouts || []).filter((row) => layoutMatchesQuery(row, query));
}

export function readLibraryView() {
  try {
    const value = localStorage.getItem(LS_VIEWPORT_LAYOUT_VIEW);
    return value === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

export function writeLibraryView(view) {
  const next = view === "grid" ? "grid" : "list";
  try {
    localStorage.setItem(LS_VIEWPORT_LAYOUT_VIEW, next);
  } catch {
    /* ignore */
  }
  return next;
}

export function collectTreeLeaves(tree) {
  const node = sanitizeLayoutTree(tree);
  const leaves = [];
  const walk = (item) => {
    if (!item) return;
    if (item.type === "split") {
      walk(item.a);
      walk(item.b);
      return;
    }
    leaves.push(item);
  };
  walk(node);
  return leaves;
}

export function isQuadLayoutTree(tree) {
  const node = sanitizeLayoutTree(tree);
  if (node.type !== "split") return false;
  if (node.a?.type !== "split" || node.b?.type !== "split") return false;
  if (node.a.direction !== node.b.direction) return false;
  return isOrthogonalSplit(node.direction, node.a.direction);
}

export function quadViewportSlot(hDir, vDir) {
  const row = String(vDir).toLowerCase() === "up" ? "s" : "n";
  const col = String(hDir).toLowerCase() === "right" ? "w" : "e";
  return `${row}${col}`;
}

export function buildQuadTree({
  hDir = "left",
  vDir = "down",
  primaryDir = "left",
  ratio = 0.5,
  crossRatio = 0.5,
  primary,
  cross,
  extra,
  viewportLabel = "Viewport",
} = {}) {
  const horiz = HORIZ.has(String(hDir).toLowerCase()) ? String(hDir).toLowerCase() : "left";
  const vert = String(vDir).toLowerCase() === "up" ? "up" : "down";
  const vp = leafFromTab({ kind: "viewport", label: viewportLabel }, { pane: "viewport" });
  const primaryLeaf = sanitizeLayoutTree(primary);
  const crossLeaf = sanitizeLayoutTree(cross);
  const extraLeaf = extra
    ? sanitizeLayoutTree(extra)
    : { type: "leaf", pane: "doc", kind: "file", id: "", label: "Pane", missing: true };
  const vpSlot = quadViewportSlot(horiz, vert);
  const primaryIsHoriz = HORIZ.has(String(primaryDir || horiz).toLowerCase());
  const row = vpSlot[0];
  const col = vpSlot[1];
  const horizSlot = `${row}${col === "e" ? "w" : "e"}`;
  const vertSlot = `${row === "n" ? "s" : "n"}${col}`;
  const farSlot = `${row === "n" ? "s" : "n"}${col === "e" ? "w" : "e"}`;
  const slots = { nw: null, ne: null, sw: null, se: null };
  slots[vpSlot] = vp;
  slots[primaryIsHoriz ? horizSlot : vertSlot] = primaryLeaf;
  slots[primaryIsHoriz ? vertSlot : horizSlot] = crossLeaf;
  slots[farSlot] = extraLeaf;
  return {
    type: "split",
    direction: horiz,
    ratio: clampRatio(ratio),
    a: {
      type: "split",
      direction: "down",
      ratio: clampRatio(crossRatio),
      a: slots.nw,
      b: slots.sw,
    },
    b: {
      type: "split",
      direction: "down",
      ratio: clampRatio(crossRatio),
      a: slots.ne,
      b: slots.se,
    },
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clampRatio(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(0.78, Math.max(0.22, n));
}

export function shortPaneLabel(tab = {}) {
  const kind = String(tab?.kind || tab?.pane || "").toLowerCase();
  if (kind === "viewport" || kind === "3d" || tab?.id === "__viewport__" || tab?.pane === "viewport") return "Viewport";
  if (kind === "wiring") return "Wiring";
  if (kind === "parts") return "Parts List";
  if (kind === "mcmaster" || kind === "catalog" || kind === "parts-catalog") return "McMaster";
  if (kind === "canvas") return "Canvas";
  if (kind === "viser") return "Viser";
  if (kind === "teleop") return "Teleop";
  if (kind === "simulation") return "Simulation";
  if (kind === "clip" || kind === "video") return "Video";
  if (kind === "code" || kind === "code-project") return "Code";
  const label = String(tab?.customLabel || tab?.label || "").trim();
  if (label) return label.length > 14 ? `${label.slice(0, 13)}…` : label;
  if (kind === "pdf") return "PDF";
  if (kind === "image") return "Image";
  if (kind === "dxf") return "DXF";
  return "Pane";
}

function leafFromTab(tab, { pane = "doc" } = {}) {
  if (!tab || pane === "viewport" || tab.kind === "viewport" || tab.id === "__viewport__") {
    return {
      type: "leaf",
      pane: "viewport",
      kind: "viewport",
      id: "__viewport__",
      label: shortPaneLabel({ kind: "viewport", label: tab?.label || "Viewport" }),
    };
  }
  return {
    type: "leaf",
    pane: "doc",
    kind: tab.kind || "file",
    id: String(tab.id || ""),
    label: shortPaneLabel(tab),
    missing: !!tab.missing,
  };
}

export function sanitizeLayoutTree(raw) {
  if (!raw || typeof raw !== "object") {
    return leafFromTab({ kind: "viewport" }, { pane: "viewport" });
  }
  const dir = String(raw.direction || "").toLowerCase();
  if (raw.type === "split" || DIRECTIONS.has(dir)) {
    const direction = DIRECTIONS.has(dir) ? dir : "right";
    const a = raw.a || raw.first || (direction === "left" || direction === "up" ? raw.doc : raw.viewport);
    const b = raw.b || raw.second || (direction === "left" || direction === "up" ? raw.viewport : raw.doc);
    return {
      type: "split",
      direction,
      ratio: clampRatio(raw.ratio),
      a: sanitizeLayoutTree(a),
      b: sanitizeLayoutTree(b),
    };
  }
  return leafFromTab(raw, { pane: raw.pane });
}

function tabOrMissing(list, id) {
  return list.find((row) => String(row.id) === String(id || ""))
    || { id: String(id || ""), kind: "file", label: id ? "Missing" : "Pane", missing: true };
}

/**
 * Capture the live viewport tab + split state.
 * Binary: 3D + one document. Quad: left/right AND up/down → 2×2 (one WebGL viewport).
 */
export function serializeSplitTree({
  split = null,
  tabs = [],
  activeId = null,
  viewportLabel = "Viewport",
} = {}) {
  const list = Array.isArray(tabs) ? tabs : [...(tabs || [])];
  const vp = leafFromTab({ kind: "viewport", label: viewportLabel }, { pane: "viewport" });
  const dir = String(split?.direction || "").toLowerCase();
  const docId = String(split?.docId || "");
  const crossDir = String(split?.cross?.direction || "").toLowerCase();
  if (DIRECTIONS.has(dir) && docId && DIRECTIONS.has(crossDir) && isOrthogonalSplit(dir, crossDir)) {
    const hDir = isHorizontalDir(dir) ? dir : crossDir;
    const vDir = isHorizontalDir(dir) ? crossDir : dir;
    return buildQuadTree({
      hDir,
      vDir,
      primaryDir: dir,
      ratio: isHorizontalDir(dir) ? split?.ratio : split?.cross?.ratio,
      crossRatio: isHorizontalDir(dir) ? split?.cross?.ratio : split?.ratio,
      primary: leafFromTab(tabOrMissing(list, docId)),
      cross: leafFromTab(tabOrMissing(list, split.cross.docId)),
      extra: split.cross.extraId ? leafFromTab(tabOrMissing(list, split.cross.extraId)) : null,
      viewportLabel,
    });
  }
  if (DIRECTIONS.has(dir) && docId) {
    const tab = tabOrMissing(list, docId);
    const doc = leafFromTab(tab);
    return {
      type: "split",
      direction: dir,
      ratio: clampRatio(split?.ratio),
      a: dir === "left" || dir === "up" ? doc : vp,
      b: dir === "left" || dir === "up" ? vp : doc,
    };
  }
  const active = list.find((row) => String(row.id) === String(activeId || ""));
  if (active) return leafFromTab(active);
  return vp;
}

export function layoutDiagramBoxes(tree, rect = { x: 0, y: 0, w: 1, h: 1 }) {
  const node = sanitizeLayoutTree(tree);
  if (node.type !== "split") {
    return [{ ...rect, label: shortPaneLabel(node), kind: node.kind || "file", id: node.id || "" }];
  }
  const ratio = clampRatio(node.ratio);
  const gap = 0.035;
  const vertical = node.direction === "left" || node.direction === "right";
  if (vertical) {
    const leftW = (rect.w - gap) * ratio;
    return [
      ...layoutDiagramBoxes(node.a, { x: rect.x, y: rect.y, w: leftW, h: rect.h }),
      ...layoutDiagramBoxes(node.b, { x: rect.x + leftW + gap, y: rect.y, w: rect.w - leftW - gap, h: rect.h }),
    ];
  }
  const topH = (rect.h - gap) * ratio;
  return [
    ...layoutDiagramBoxes(node.a, { x: rect.x, y: rect.y, w: rect.w, h: topH }),
    ...layoutDiagramBoxes(node.b, { x: rect.x, y: rect.y + topH + gap, w: rect.w, h: rect.h - topH - gap }),
  ];
}

export function layoutDiagramHtml(tree, { className = "vp-layout-diagram" } = {}) {
  const boxes = layoutDiagramBoxes(tree);
  const cells = boxes.map((box) => {
    const left = (box.x * 100).toFixed(2);
    const top = (box.y * 100).toFixed(2);
    const width = (box.w * 100).toFixed(2);
    const height = (box.h * 100).toFixed(2);
    return `<span class="vp-layout-cell vp-layout-cell--${escapeHtml(box.kind || "file")}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%" title="${escapeHtml(box.label)}"><span class="vp-layout-cell-label">${escapeHtml(box.label)}</span></span>`;
  }).join("");
  return `<div class="${escapeHtml(className)}" role="img" aria-label="Viewport split diagram">${cells}</div>`;
}

export function layoutDiagramSvgDataUrl(tree, { w = 240, h = 140 } = {}) {
  const boxes = layoutDiagramBoxes(tree);
  const cells = boxes.map((box) => {
    const x = (box.x * w).toFixed(1);
    const y = (box.y * h).toFixed(1);
    const width = Math.max(8, box.w * w).toFixed(1);
    const height = Math.max(8, box.h * h).toFixed(1);
    const label = escapeHtml(box.label);
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="#161b22" stroke="#30363d"/><text x="${(Number(x) + 8).toFixed(1)}" y="${(Number(y) + Math.min(22, Number(height) * 0.55)).toFixed(1)}" fill="#c9d1d9" font-size="11" font-family="ui-sans-serif,system-ui,sans-serif">${label}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#0d1117"/>${cells}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function splitStateFromTree(tree) {
  const node = sanitizeLayoutTree(tree);
  if (node.type !== "split") {
    const activeId = node.pane === "viewport" ? null : node.id || null;
    return { direction: null, docId: null, ratio: 0.5, activeId, tabs: node.pane === "doc" ? [node] : [], cross: null };
  }
  const leaves = collectTreeLeaves(node).filter((item) => item.pane !== "viewport" && item.id && item.id !== "__viewport__");
  if (isQuadLayoutTree(node)) {
    const hDir = isHorizontalDir(node.direction) ? node.direction : node.a.direction;
    const vDir = isHorizontalDir(node.direction) ? node.a.direction : node.direction;
    const vpSlot = quadViewportSlot(hDir, vDir);
    const columns = isHorizontalDir(node.direction)
      ? { left: node.a, right: node.b }
      : null;
    const rows = !columns
      ? { top: node.a, bottom: node.b }
      : null;
    const slots = columns
      ? { nw: columns.left.a, sw: columns.left.b, ne: columns.right.a, se: columns.right.b }
      : { nw: rows.top.a, ne: rows.top.b, sw: rows.bottom.a, se: rows.bottom.b };
    const primaryIsHoriz = isHorizontalDir(node.direction);
    const row = vpSlot[0];
    const col = vpSlot[1];
    const horizSlot = `${row}${col === "e" ? "w" : "e"}`;
    const vertSlot = `${row === "n" ? "s" : "n"}${col}`;
    const farSlot = `${row === "n" ? "s" : "n"}${col === "e" ? "w" : "e"}`;
    const primarySlot = primaryIsHoriz ? horizSlot : vertSlot;
    const crossSlot = primaryIsHoriz ? vertSlot : horizSlot;
    return {
      direction: node.direction,
      docId: slots[primarySlot]?.id || null,
      ratio: clampRatio(node.ratio),
      activeId: slots[primarySlot]?.id || leaves[0]?.id || null,
      tabs: leaves,
      quad: true,
      hDir,
      vDir,
      vpSlot,
      cross: {
        direction: isHorizontalDir(node.direction) ? vDir : hDir,
        ratio: clampRatio(node.a?.ratio ?? 0.5),
        docId: slots[crossSlot]?.id || null,
        extraId: slots[farSlot]?.id || "",
      },
    };
  }
  const doc = leaves[0] || null;
  return {
    direction: node.direction,
    docId: doc?.id || null,
    ratio: clampRatio(node.ratio),
    activeId: doc?.id || null,
    tabs: leaves,
    cross: null,
  };
}

export function parseViewportLayoutShareUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const fromPath = (value) => {
    const match = String(value || "").match(/\/share\/([A-Za-z0-9_-]+)/i);
    return match ? match[1] : null;
  };
  try {
    const url = new URL(text, "https://render3d.app");
    const token = fromPath(url.pathname) || url.searchParams.get("token") || url.searchParams.get("import_viewport_layout");
    if (token) return token;
  } catch {
    /* not a URL */
  }
  const token = fromPath(text);
  if (token) return token;
  if (/^[A-Za-z0-9_-]{8,80}$/.test(text)) return text;
  return null;
}

export function parseViewportLayoutPayload(raw) {
  if (!raw) return null;
  if (typeof raw === "object") {
    if (raw.tree || raw.tabs || raw.name) return sanitizeSavedLayout(raw);
    if (raw.layout) return sanitizeSavedLayout(raw.layout);
    if (raw.type === "split" || raw.direction || raw.type === "leaf") {
      return sanitizeSavedLayout({ name: "Imported layout", tree: raw });
    }
    return null;
  }
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith("{")) {
    try {
      return parseViewportLayoutPayload(JSON.parse(text));
    } catch {
      return null;
    }
  }
  return null;
}

export function sanitizeSavedLayout(raw = {}) {
  const id = String(raw.id || "").trim() || `vpl-${Date.now().toString(36)}`;
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.map((tab) => ({
      id: String(tab?.id || ""),
      kind: String(tab?.kind || "file"),
      label: String(tab?.label || tab?.id || "Pane"),
    })).filter((tab) => tab.id)
    : splitStateFromTree(raw.tree || raw).tabs;
  return {
    id,
    name: String(raw.name || "Untitled layout").trim().slice(0, NAME_MAX) || "Untitled layout",
    description: String(raw.description || "").slice(0, DESC_MAX),
    tree: sanitizeLayoutTree(raw.tree || raw.split || raw),
    tabs,
    shareToken: String(raw.shareToken || raw.share_token || "").trim(),
    listingId: String(raw.listingId || raw.listing_id || "").trim(),
    createdAt: raw.createdAt || raw.created_at || "",
    updatedAt: raw.updatedAt || raw.updated_at || "",
  };
}

export function extraLinksFromStore(store = {}) {
  const rows = store.extraLinks || store.extra_links || [];
  const out = [];
  for (const row of rows) {
    const url = typeof row === "string" ? row.trim() : String(row?.url || row?.href || "").trim();
    if (url && !out.includes(url)) out.push(url);
  }
  return out.slice(0, 40);
}

export function mergeImportedLayout(store, layout) {
  const current = {
    layouts: Array.isArray(store?.layouts) ? store.layouts.map(sanitizeSavedLayout) : [],
    extraLinks: extraLinksFromStore(store),
    lastId: String(store?.lastId || ""),
    v: 1,
  };
  const incoming = sanitizeSavedLayout(layout);
  const now = new Date().toISOString();
  const idx = current.layouts.findIndex((row) => row.id === incoming.id);
  if (idx >= 0) current.layouts[idx] = { ...current.layouts[idx], ...incoming, updatedAt: now };
  else {
    incoming.createdAt = incoming.createdAt || now;
    incoming.updatedAt = incoming.updatedAt || now;
    current.layouts.unshift(incoming);
  }
  current.lastId = incoming.id;
  return current;
}

export function isViewportLayoutListing(item) {
  if (!item || typeof item !== "object") return false;
  const category = String(item.category || "").toLowerCase();
  if (category.includes("viewport") || category.includes("layout")) return true;
  if (String(item.kind || "").toLowerCase() === VIEWPORT_LAYOUT_KIND) return true;
  const files = item.files || [];
  return files.some((file) => String(file?.product_type || file?.kind || "") === VIEWPORT_LAYOUT_KIND || file?.layout);
}

export function layoutFromListing(item) {
  if (!item) return null;
  const files = item.files || [];
  for (const file of files) {
    if (file?.layout) return sanitizeSavedLayout({ ...file.layout, name: file.layout.name || item.name, description: file.layout.description || item.description || item.tagline });
  }
  if (item.layout) return sanitizeSavedLayout(item.layout);
  return null;
}

function readLocalStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_VIEWPORT_LAYOUTS) || "null");
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* ignore */
  }
  return { v: 1, layouts: [], extraLinks: [], lastId: "" };
}

function writeLocalStore(store) {
  try {
    localStorage.setItem(LS_VIEWPORT_LAYOUTS, JSON.stringify(store));
  } catch {
    /* ignore */
  }
  return store;
}

export async function loadViewportLayoutStore(api) {
  if (typeof api === "function") {
    try {
      const data = await api("/api/me/viewport-layouts");
      if (data && typeof data === "object") {
        writeLocalStore(data);
        return data;
      }
    } catch {
      /* fall through */
    }
  }
  return readLocalStore();
}

export async function saveViewportLayoutStore(api, store) {
  const payload = {
    v: 1,
    layouts: (store?.layouts || []).map(sanitizeSavedLayout),
    extraLinks: extraLinksFromStore(store),
    lastId: String(store?.lastId || ""),
  };
  writeLocalStore(payload);
  if (typeof api === "function") {
    try {
      return await api("/api/me/viewport-layouts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      /* keep local */
    }
  }
  return payload;
}

export async function importLayoutIntoStore(api, layout) {
  const store = await loadViewportLayoutStore(api);
  const next = mergeImportedLayout(store, layout);
  return saveViewportLayoutStore(api, next);
}

export function studioImportUrl(token) {
  const clean = String(token || "").trim();
  return clean ? `/?import_viewport_layout=${encodeURIComponent(clean)}` : "/";
}

export function captureCurrentLayout({ docTabs, viewportLabel = "Viewport" } = {}) {
  const tabs = docTabs?.list?.() || [];
  const split = docTabs?.getSplit?.() || { direction: null, docId: null, ratio: 0.5 };
  const active = docTabs?.getActive?.();
  return {
    tree: serializeSplitTree({
      split,
      tabs,
      activeId: active?.id || null,
      viewportLabel,
    }),
    tabs: tabs.map((tab) => ({ id: tab.id, kind: tab.kind, label: tab.customLabel || tab.label || tab.id })),
    split,
    activeId: active?.id || null,
  };
}

function truncateBox(text) {
  const value = String(text || "").trim();
  if (value.length <= 16) return value;
  return `${value.slice(0, 15)}…`;
}

export function layoutSavesButtonHtml() {
  return `<div class="vp-layout-saves" data-vp-layout-saves="1">
    <button type="button" class="vp-layout-saves-btn dxf-tab dxf-tab--layouts" data-vp-layout-open aria-haspopup="dialog" aria-label="Split view saves" title="Save and load split view layouts">
      <span class="vp-layout-saves-icon" aria-hidden="true">⧉</span>
      <span class="vp-layout-saves-label">Layouts</span>
      <span class="vp-layout-saves-caret" data-vp-layout-caret aria-label="Saved layouts" title="Saved layouts">▾</span>
    </button>
  </div>`;
}

function rowHtml(layout, selectedId, { view = "list" } = {}) {
  const live = sanitizeSavedLayout(layout);
  const active = live.id === selectedId ? " is-selected" : "";
  return `<li class="vp-layout-row vp-layout-row--${escapeHtml(view)}${active}" data-vp-layout-id="${escapeHtml(live.id)}">
    ${layoutDiagramHtml(live.tree, { className: "vp-layout-diagram vp-layout-diagram--row" })}
    <div class="vp-layout-row-copy">
      <strong>${escapeHtml(live.name)}</strong>
      <span>${escapeHtml(truncateBox(live.description) || "No description")}</span>
    </div>
    <button type="button" class="btn secondary btn-compact" data-vp-layout-load="${escapeHtml(live.id)}">Load</button>
    <button type="button" class="vp-layout-kebab" data-vp-layout-menu="${escapeHtml(live.id)}" aria-label="Layout actions" title="Copy link, marketplace, profile">⋯</button>
  </li>`;
}

export function layoutConfigsGifHtml() {
  return `<div class="vp-layout-gif" role="img" aria-label="Animated preview of split and quad layouts">
    <img class="vp-layout-gif-img" src="${escapeHtml(LAYOUT_CONFIGS_GIF)}" alt="Viewport, Wiring, Canvas, and quad split configurations" width="480" height="220" />
    <div class="vp-layout-gif-css" aria-hidden="true">
      <div class="vp-layout-gif-frame" data-frame="wiring"><span>Viewport</span><span>Wiring</span></div>
      <div class="vp-layout-gif-frame" data-frame="canvas"><span>Canvas</span><span>Viewport</span></div>
      <div class="vp-layout-gif-frame" data-frame="parts"><span>Viewport</span><span>Parts List</span></div>
      <div class="vp-layout-gif-frame" data-frame="stack"><span>Canvas</span><span>Viewport</span></div>
      <div class="vp-layout-gif-frame vp-layout-gif-frame--quad" data-frame="quad"><span>Canvas</span><span>Viewport</span><span>Wiring</span><span>Parts List</span></div>
    </div>
  </div>`;
}

export function popularTemplatesHtml(query = "") {
  const rows = filterLayouts(POPULAR_LAYOUT_TEMPLATES, query).map((item) => `
    <li class="vp-layout-popular-row" data-vp-layout-popular="${escapeHtml(item.token)}">
      ${layoutDiagramHtml(item.tree, { className: "vp-layout-diagram vp-layout-diagram--row" })}
      <div class="vp-layout-row-copy">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.description)}</span>
        <code class="vp-layout-share-link">${escapeHtml(item.sharePath)}</code>
      </div>
      <button type="button" class="btn secondary btn-compact" data-vp-layout-import-popular="${escapeHtml(item.sharePath)}">Import</button>
    </li>`).join("");
  return rows || `<li class="vp-layout-empty">No templates match that search.</li>`;
}

export function savedLayoutsHtml({ layouts = [], selectedId = "", query = "", view = "list" } = {}) {
  const filtered = filterLayouts(sortLayoutsNewestFirst(layouts), query);
  if (!filtered.length) {
    return `<p class="muted small vp-layout-empty">${(layouts || []).length ? "No saved layouts match that search." : "No saved layouts yet. Name this split and Save, paste a share link under Import, or install a template below."}</p><ul class="vp-layout-list vp-layout-list--${escapeHtml(view)}" data-vp-layout-list></ul>`;
  }
  return `<ul class="vp-layout-list vp-layout-list--${escapeHtml(view)}" data-vp-layout-list>${filtered.map((row) => rowHtml(row, selectedId, { view })).join("")}</ul>`;
}

export function layoutSavesPopupHtml({
  name = "",
  description = "",
  tree = null,
  layouts = [],
  extraLinks = [],
  selectedId = "",
  query = "",
  view = "list",
} = {}) {
  const viewListOn = view === "list" ? " is-active" : "";
  const viewGridOn = view === "grid" ? " is-active" : "";
  return `<div class="auth-backdrop" data-vp-layout-close></div>
    <div class="auth-card app-dialog-card vp-layout-saves-card" role="dialog" aria-modal="true" aria-labelledby="vp-layout-saves-title">
      <button type="button" class="auth-close" data-vp-layout-close aria-label="Close">&times;</button>
      <div class="vp-layout-saves-scroll vp-layout-browser">
        <header class="vp-layout-browser-head">
          <div class="vp-layout-hero-brand">
            <img class="vp-layout-logo" src="${escapeHtml(LOGO_SRC)}" alt="Render Studio" width="40" height="40" />
            <div>
              <p class="workspace-manage-eyebrow">Viewport layouts</p>
              <h2 id="vp-layout-saves-title" class="app-dialog-title">Browse layouts</h2>
            </div>
          </div>
          <div class="vp-layout-browser-actions">
            <a class="btn secondary btn-compact" href="/marketplace.html#/sell">Sam's Store</a>
            <a class="btn secondary btn-compact" href="/marketplace.html#/browse?category=viewport-layouts">Layout Store</a>
            <button type="button" class="btn secondary btn-compact" data-vp-layout-reset>Close layout</button>
          </div>
        </header>
        <section class="vp-layout-current">
          <div>${layoutDiagramHtml(tree, { className: "vp-layout-diagram vp-layout-diagram--live" })}</div>
          <div class="vp-layout-current-copy"><strong>Current layout</strong><span>Save this arrangement or close it to return to one viewport.</span></div>
          <input type="text" maxlength="${NAME_MAX}" data-vp-layout-name required aria-label="Layout name" placeholder="Name this layout" value="${escapeHtml(name)}" />
          <button type="button" class="btn accent btn-compact" data-vp-layout-save>Save</button>
        </section>
        <section class="vp-layout-panel vp-layout-library" data-vp-layout-library data-view="${escapeHtml(view)}">
          <div class="vp-layout-library-head">
            <h3>My layouts</h3>
            <div class="vp-layout-library-tools">
              <label class="vp-layout-search">
                <span class="visually-hidden">Search layouts</span>
                <input type="search" data-vp-layout-search placeholder="Search saved layouts and templates" value="${escapeHtml(query)}" />
              </label>
              <div class="vp-layout-view-toggle" role="group" aria-label="Layout view">
                <button type="button" class="vp-layout-view-btn${viewListOn}" data-vp-layout-view="list" aria-pressed="${view === "list" ? "true" : "false"}">List</button>
                <button type="button" class="vp-layout-view-btn${viewGridOn}" data-vp-layout-view="grid" aria-pressed="${view === "grid" ? "true" : "false"}">Grid</button>
              </div>
            </div>
          </div>
          <div class="vp-layout-saved-scroll" data-vp-layout-saved>${savedLayoutsHtml({ layouts, selectedId, query, view })}</div>
        </section>
        <section class="vp-layout-panel vp-layout-popular">
          <h3>Starter layouts</h3>
          <p class="muted small">Open a complete workspace arrangement. Quad layouts restore all four panes.</p>
          <ul class="vp-layout-popular-list" data-vp-layout-popular-list>${popularTemplatesHtml(query)}</ul>
        </section>
        <section class="vp-layout-import-bar">
          <input type="text" data-vp-layout-import aria-label="Import layout" placeholder="Paste a layout link or JSON" />
          <button type="button" class="btn secondary btn-compact" data-vp-layout-import-go>Import</button>
          <button type="button" class="btn secondary btn-compact" data-vp-layout-copy>Copy current link</button>
        </section>
        <p class="muted small" data-vp-layout-status></p>
      </div>
    </div>`;
}

export function layoutImportHintHtml() {
  return `<aside class="vp-layout-import-hint" role="status" data-vp-layout-import-hint>
    <button type="button" class="vp-layout-import-hint-close" data-vp-layout-hint-close aria-label="Dismiss">&times;</button>
    <p><strong>Layout imported</strong> into your general Studio viewport layouts — not a project. Open Account → Viewport to see it, or use the Layouts button at the end of the tab strip.</p>
    <p class="muted small">Add more share links in the <b>Extra view config links</b> field in that same Viewport settings tab.</p>
  </aside>`;
}

export function layoutImportDestinationHtml(layout = {}) {
  const live = sanitizeSavedLayout(layout);
  return `<div class="auth-backdrop" data-vp-import-cancel></div>
    <div class="auth-card app-dialog-card vp-layout-import-destination" role="dialog" aria-modal="true" aria-labelledby="vp-import-title">
      <button type="button" class="auth-close" data-vp-import-cancel aria-label="Cancel">&times;</button>
      <p class="workspace-manage-eyebrow">Import layout</p>
      <h2 id="vp-import-title" class="app-dialog-title">Where should “${escapeHtml(live.name)}” open?</h2>
      <label class="vp-layout-import-choice"><input type="radio" name="vp-import-destination" value="viewport" checked /> <span><strong>Default Viewport</strong><small>Replace the current viewport layout. Use its × to return to the default.</small></span></label>
      <label class="vp-layout-import-choice"><input type="radio" name="vp-import-destination" value="tab" /> <span><strong>New tab</strong><small>Keep this layout available in the project tab strip.</small></span></label>
      <div class="vp-layout-import-tab-options" data-vp-import-tab-options hidden>
        <label class="app-dialog-label">Tab name<input type="text" maxlength="${NAME_MAX}" data-vp-import-tab-name value="${escapeHtml(live.name)}" /></label>
        <label class="vp-layout-import-pin"><input type="checkbox" data-vp-import-pin /> Pin this tab for this project</label>
      </div>
      <div class="app-dialog-actions">
        <button type="button" class="btn secondary" data-vp-import-cancel>Cancel</button>
        <button type="button" class="btn accent" data-vp-import-confirm>Open layout</button>
      </div>
    </div>`;
}

function defaultApi(path, options = {}) {
  return fetch(path, options).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
    return data;
  });
}

async function copyText(value) {
  const text = String(value || "");
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copy this share link:", text);
    return false;
  }
}

export async function copyLayoutShareLink(api, layout, origin = "") {
  const live = sanitizeSavedLayout(layout);
  const fetchApi = typeof api === "function" ? api : defaultApi;
  const data = await fetchApi("/api/me/viewport-layouts/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: live }),
  });
  const url = data.share_url?.startsWith("http")
    ? data.share_url
    : `${origin || (typeof location !== "undefined" ? location.origin : "")}${data.share_url || `/share/${data.token}`}`;
  await copyText(url);
  return { ...data, share_url: url };
}

export async function publishLayoutToMarketplace(api, layout, { pinProfile = false } = {}) {
  const live = sanitizeSavedLayout(layout);
  const fetchApi = typeof api === "function" ? api : defaultApi;
  const tagline = (live.description || `${live.name} viewport split`).slice(0, 160);
  const payload = {
    name: live.name,
    tagline: tagline.slice(0, 120) || live.name,
    description: live.description || `${live.name} is a free viewport split layout for Render Studio.`,
    category: "viewport-layouts",
    access_mode: "free",
    license: "cc-by",
    price_cents: 0,
    download_enabled: true,
    thumbnail: { data_url: layoutDiagramSvgDataUrl(live.tree) },
    files: [{
      name: "viewport-layout.json",
      product_type: VIEWPORT_LAYOUT_KIND,
      layout: live,
    }],
  };
  const created = await fetchApi("/api/model-listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const listing = created.listing || created;
  if (pinProfile && listing?.id) {
    try {
      const { pinToPublicProfile } = await import("../marketplace/public-profile-showcase.js?v=20260915-marketplace3");
      await pinToPublicProfile({ kind: "model", listing_id: listing.id, category: "viewport-layouts" }, { api: fetchApi });
    } catch {
      /* optional */
    }
  }
  return listing;
}

function hideMenu(menu) {
  menu?.remove();
}

export function mountViewportLayoutSaves({
  tabBarEl,
  docTabs,
  api,
  getViewportLabel = () => "Viewport",
  onRestore,
  onImportDestination,
  onReset,
  onStatus,
} = {}) {
  let popup = null;
  let hint = null;
  let contextMenu = null;
  let selectedId = "";
  let libraryQuery = "";
  let libraryView = readLibraryView();
  let lastLayouts = [];
  let destinationChoicePromise = null;

  function status(message, kind = "ok") {
    const el = popup?.querySelector("[data-vp-layout-status]");
    if (el) el.textContent = message || "";
    if (message) onStatus?.(kind, message);
  }

  function closePopup() {
    popup?.remove();
    popup = null;
    hideMenu(contextMenu);
    contextMenu = null;
  }

  async function snapshotForm() {
    const capture = captureCurrentLayout({ docTabs, viewportLabel: getViewportLabel() });
    const name = popup?.querySelector("[data-vp-layout-name]")?.value || "";
    const description = popup?.querySelector("[data-vp-layout-desc]")?.value || "";
    const extraLinks = String(popup?.querySelector("[data-vp-layout-links]")?.value || "")
      .split(/\n+/)
      .map((row) => row.trim())
      .filter(Boolean);
    return { ...capture, name, description, extraLinks };
  }

  function readUiState() {
    libraryQuery = popup?.querySelector("[data-vp-layout-search]")?.value ?? libraryQuery;
    const viewBtn = popup?.querySelector("[data-vp-layout-view].is-active")?.dataset?.vpLayoutView;
    if (viewBtn) libraryView = writeLibraryView(viewBtn);
    return { query: libraryQuery, view: libraryView };
  }

  function paintLibrary() {
    if (!popup) return;
    const saved = popup.querySelector("[data-vp-layout-saved]");
    const popular = popup.querySelector("[data-vp-layout-popular-list]");
    if (saved) saved.innerHTML = savedLayoutsHtml({ layouts: lastLayouts, selectedId, query: libraryQuery, view: libraryView });
    if (popular) popular.innerHTML = popularTemplatesHtml(libraryQuery);
    popup.querySelector("[data-vp-layout-library]")?.setAttribute("data-view", libraryView);
    popup.querySelectorAll("[data-vp-layout-view]").forEach((btn) => {
      const on = btn.dataset.vpLayoutView === libraryView;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    bindLibrary();
  }

  async function refreshPopup() {
    if (!popup) return;
    readUiState();
    const store = await loadViewportLayoutStore(api);
    lastLayouts = store.layouts || [];
    const capture = captureCurrentLayout({ docTabs, viewportLabel: getViewportLabel() });
    const name = popup.querySelector("[data-vp-layout-name]")?.value || "";
    const description = popup.querySelector("[data-vp-layout-desc]")?.value || "";
    const extraLinks = String(popup.querySelector("[data-vp-layout-links]")?.value || "").split(/\n+/).map((row) => row.trim()).filter(Boolean);
    popup.innerHTML = layoutSavesPopupHtml({
      name,
      description,
      tree: capture.tree,
      layouts: store.layouts,
      extraLinks: extraLinks.length ? extraLinks : store.extraLinks,
      selectedId,
      query: libraryQuery,
      view: libraryView,
    });
    bindPopup();
  }

  function showLayoutMenu(event, layout) {
    hideMenu(contextMenu);
    const live = sanitizeSavedLayout(layout);
    const menu = document.createElement("div");
    menu.className = "dxf-tab-context-menu folder-context-menu vp-layout-context-menu";
    menu.innerHTML = `
      <button type="button" data-vp-layout-act="copy">Copy link</button>
      <button type="button" data-vp-layout-act="profile">Add to public profile</button>
      <button type="button" data-vp-layout-act="market">Add to marketplace</button>
      <button type="button" data-vp-layout-act="public">Make public on marketplace</button>
    `;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX || 8, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(event.clientY || 8, window.innerHeight - rect.height - 8)}px`;
    menu.addEventListener("click", async (ev) => {
      const act = ev.target?.closest?.("[data-vp-layout-act]")?.dataset?.vpLayoutAct;
      if (!act) return;
      hideMenu(menu);
      contextMenu = null;
      try {
        if (act === "copy") {
          const shared = await copyLayoutShareLink(api, live, location.origin);
          status("Share link copied.");
          selectedId = live.id;
          live.shareToken = shared.token;
        } else if (act === "profile") {
          const listing = await publishLayoutToMarketplace(api, live, { pinProfile: true });
          status(listing?.status === "approved" ? "Pinned to your public profile." : "Listed and pinned (pending review).");
        } else if (act === "market" || act === "public") {
          const listing = await publishLayoutToMarketplace(api, live, { pinProfile: false });
          status(listing?.status === "approved" ? "Published to the marketplace." : "Submitted as a free viewport layout (pending review).");
        }
      } catch (err) {
        status(err?.message || "Could not complete that action.", "error");
      }
    });
    contextMenu = menu;
  }

  function bindPopup() {
    popup?.querySelectorAll("[data-vp-layout-close]").forEach((el) => {
      el.addEventListener("click", closePopup);
    });
    popup?.querySelector("[data-vp-layout-reset]")?.addEventListener("click", () => {
      onReset?.();
      status("Returned to the default viewport.");
      closePopup();
    });
    popup?.querySelector("[data-vp-layout-save]")?.addEventListener("click", async () => {
      const form = await snapshotForm();
      const name = String(form.name || "").trim();
      if (!name) {
        popup.querySelector("[data-vp-layout-name]")?.reportValidity?.();
        status("Name is required.", "error");
        return;
      }
      const store = await loadViewportLayoutStore(api);
      const saved = sanitizeSavedLayout({
        id: selectedId || undefined,
        name,
        description: form.description,
        tree: form.tree,
        tabs: form.tabs,
      });
      const next = mergeImportedLayout(store, saved);
      next.extraLinks = form.extraLinks;
      await saveViewportLayoutStore(api, next);
      selectedId = saved.id;
      status("Layout saved to your Studio settings.");
      await refreshPopup();
    });
    popup?.querySelector("[data-vp-layout-copy]")?.addEventListener("click", async () => {
      const form = await snapshotForm();
      const name = String(form.name || "").trim() || "Untitled layout";
      try {
        const shared = await copyLayoutShareLink(api, { ...form, name, tree: form.tree, tabs: form.tabs }, location.origin);
        status("Share link copied.");
        selectedId = shared.layout?.id || selectedId;
      } catch (err) {
        status(err?.message || "Could not copy share link.", "error");
      }
    });
    popup?.querySelector("[data-vp-layout-import-go]")?.addEventListener("click", async () => {
      const raw = popup.querySelector("[data-vp-layout-import]")?.value || "";
      try {
        await importFromRaw(raw);
        await refreshPopup();
      } catch (err) {
        status(err?.message || "Could not import that layout.", "error");
      }
    });
    popup?.querySelector("[data-vp-layout-links]")?.addEventListener("change", async (ev) => {
      const extraLinks = String(ev.target.value || "").split(/\n+/).map((row) => row.trim()).filter(Boolean);
      const store = await loadViewportLayoutStore(api);
      store.extraLinks = extraLinks;
      await saveViewportLayoutStore(api, store);
    });
    bindLibrary();
    popup?.querySelector("[data-vp-layout-search]")?.addEventListener("input", (ev) => {
      libraryQuery = ev.target.value || "";
      paintLibrary();
    });
    popup?.querySelectorAll("[data-vp-layout-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        libraryView = writeLibraryView(btn.dataset.vpLayoutView);
        paintLibrary();
      });
    });
  }

  function bindLibrary() {
    popup?.querySelectorAll("[data-vp-layout-load]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.vpLayoutLoad;
        const store = await loadViewportLayoutStore(api);
        const layout = store.layouts.find((row) => row.id === id);
        if (!layout) return;
        selectedId = id;
        try {
          await onRestore?.(sanitizeSavedLayout(layout));
          status(`Loaded “${layout.name}”.`);
        } catch (err) {
          status(err?.message || "Could not restore that layout.", "error");
        }
      });
    });
    popup?.querySelectorAll("[data-vp-layout-menu]").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = btn.dataset.vpLayoutMenu;
        const store = await loadViewportLayoutStore(api);
        const layout = store.layouts.find((row) => row.id === id);
        if (layout) showLayoutMenu(ev, layout);
      });
    });
    popup?.querySelectorAll(".vp-layout-row").forEach((row) => {
      row.addEventListener("contextmenu", async (ev) => {
        ev.preventDefault();
        const id = row.dataset.vpLayoutId;
        const store = await loadViewportLayoutStore(api);
        const layout = store.layouts.find((item) => item.id === id);
        if (layout) showLayoutMenu(ev, layout);
      });
    });
    popup?.querySelectorAll("[data-vp-layout-import-popular]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const url = btn.dataset.vpLayoutImportPopular || "";
        const field = popup.querySelector("[data-vp-layout-import]");
        if (field) field.value = url;
        try {
          await importFromRaw(url);
          await refreshPopup();
        } catch (err) {
          status(err?.message || "Could not import that template.", "error");
        }
      });
    });
  }

  async function importFromRaw(raw) {
    const json = parseViewportLayoutPayload(raw);
    if (json) {
      await importLayoutIntoStore(api, json);
      selectedId = json.id;
      status("Imported layout into your Studio settings.");
      await chooseImportDestination(json);
      return json;
    }
    const token = parseViewportLayoutShareUrl(raw);
    if (!token) throw new Error("Paste a /share/… link or layout JSON.");
    const shipped = POPULAR_LAYOUT_TEMPLATES.find((row) => row.token === token);
    if (shipped) {
      const imported = sanitizeSavedLayout({ id: shipped.token, name: shipped.name, description: shipped.description, tree: shipped.tree, shareToken: token });
      await importLayoutIntoStore(api, imported);
      selectedId = shipped.token;
      await chooseImportDestination(imported);
      status("Imported layout into your Studio settings.");
      return imported;
    }
    const meta = await (typeof api === "function" ? api : defaultApi)(`/api/share/${encodeURIComponent(token)}`);
    const layout = meta.layout || meta;
    if (!layout?.tree && !layout?.name) throw new Error("That link is not a viewport layout.");
    const imported = sanitizeSavedLayout({ ...layout, shareToken: token });
    await importLayoutIntoStore(api, imported);
    selectedId = imported.id;
    await chooseImportDestination(imported);
    status("Imported layout into your Studio settings.");
    return imported;
  }

  function chooseImportDestination(layout) {
    if (typeof onImportDestination !== "function") return Promise.resolve(null);
    if (destinationChoicePromise) return destinationChoicePromise;
    destinationChoicePromise = new Promise((resolve, reject) => {
      const modal = document.createElement("div");
      modal.className = "auth-modal vp-layout-import-modal";
      modal.innerHTML = layoutImportDestinationHtml(layout);
      document.body.appendChild(modal);
      const options = modal.querySelector("[data-vp-import-tab-options]");
      const sync = () => {
        const tab = modal.querySelector('input[name="vp-import-destination"]:checked')?.value === "tab";
        if (options) options.hidden = !tab;
      };
      modal.querySelectorAll('input[name="vp-import-destination"]').forEach((input) => input.addEventListener("change", sync));
      const finish = async (choice) => {
        modal.remove();
        if (!choice) {
          destinationChoicePromise = null;
          resolve(null);
          return;
        }
        const destination = modal.querySelector('input[name="vp-import-destination"]:checked')?.value || "viewport";
        const name = String(modal.querySelector("[data-vp-import-tab-name]")?.value || layout.name || "Layout").trim() || "Layout";
        const pinned = !!modal.querySelector("[data-vp-import-pin]")?.checked;
        try {
          await onImportDestination(layout, { destination, name, pinned });
          resolve({ destination, name, pinned });
        } catch (err) {
          reject(err);
        } finally {
          destinationChoicePromise = null;
        }
      };
      modal.querySelectorAll("[data-vp-import-cancel]").forEach((el) => el.addEventListener("click", () => void finish(false)));
      modal.querySelector("[data-vp-import-confirm]")?.addEventListener("click", () => void finish(true));
      sync();
    });
    return destinationChoicePromise;
  }

  async function openPopup() {
    closePopup();
    const store = await loadViewportLayoutStore(api);
    lastLayouts = store.layouts || [];
    const capture = captureCurrentLayout({ docTabs, viewportLabel: getViewportLabel() });
    const modal = document.createElement("div");
    modal.className = "auth-modal vp-layout-saves-modal";
    modal.innerHTML = layoutSavesPopupHtml({
      name: "",
      description: "",
      tree: capture.tree,
      layouts: store.layouts,
      extraLinks: store.extraLinks,
      selectedId,
      query: libraryQuery,
      view: libraryView,
    });
    document.body.appendChild(modal);
    popup = modal;
    bindPopup();
    popup.querySelector("[data-vp-layout-name]")?.focus();
  }

  function showCaretMenu(event) {
    hideMenu(contextMenu);
    loadViewportLayoutStore(api).then((store) => {
      const menu = document.createElement("div");
      menu.className = "dxf-tab-context-menu folder-context-menu vp-layout-context-menu";
      const rows = (store.layouts || []).slice(0, 12).map((layout) => (
        `<button type="button" data-vp-layout-load="${escapeHtml(layout.id)}">${escapeHtml(layout.name)}</button>`
      )).join("");
      menu.innerHTML = `${rows || `<button type="button" disabled>No saved layouts</button>`}
        <hr />
        <button type="button" data-vp-layout-act="reset">Close current layout</button>
        <button type="button" data-vp-layout-act="open">Save / import…</button>
        <a href="/marketplace.html#/browse?category=viewport-layouts">Marketplace layouts</a>`;
      document.body.appendChild(menu);
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.min(event.clientX || 8, window.innerWidth - rect.width - 8)}px`;
      menu.style.top = `${Math.min(event.clientY || 8, window.innerHeight - rect.height - 8)}px`;
      menu.addEventListener("click", async (ev) => {
        const open = ev.target?.closest?.("[data-vp-layout-act='open']");
        const loadId = ev.target?.closest?.("[data-vp-layout-load]")?.dataset?.vpLayoutLoad;
        if (open) {
          hideMenu(menu);
          void openPopup();
          return;
        }
        const reset = ev.target?.closest?.("[data-vp-layout-act='reset']");
        if (reset) {
          hideMenu(menu);
          onReset?.();
          return;
        }
        if (!loadId) return;
        hideMenu(menu);
        const layout = store.layouts.find((row) => row.id === loadId);
        if (layout) await onRestore?.(sanitizeSavedLayout(layout));
      });
      contextMenu = menu;
    });
  }

  function ensureButton() {
    if (!tabBarEl) return null;
    let wrap = tabBarEl.querySelector("[data-vp-layout-saves]");
    if (!wrap) {
      tabBarEl.insertAdjacentHTML("beforeend", layoutSavesButtonHtml());
      wrap = tabBarEl.querySelector("[data-vp-layout-saves]");
    } else {
      tabBarEl.appendChild(wrap);
    }
    return wrap;
  }

  tabBarEl?.addEventListener("click", (event) => {
    const caret = event.target.closest?.("[data-vp-layout-caret]");
    if (caret) {
      event.preventDefault();
      event.stopPropagation();
      showCaretMenu(event);
      return;
    }
    if (event.target.closest?.("[data-vp-layout-open]")) {
      event.preventDefault();
      event.stopPropagation();
      void openPopup();
    }
  });

  tabBarEl?.addEventListener("contextmenu", (event) => {
    if (!event.target.closest?.("[data-vp-layout-saves]")) return;
    event.preventDefault();
    showCaretMenu(event);
  });

  document.addEventListener("click", (event) => {
    if (contextMenu && !contextMenu.contains(event.target)) {
      hideMenu(contextMenu);
      contextMenu = null;
    }
  });

  function showImportHint() {
    hint?.remove();
    const el = document.createElement("div");
    el.innerHTML = layoutImportHintHtml();
    hint = el.firstElementChild;
    document.body.appendChild(hint);
    hint.querySelector("[data-vp-layout-hint-close]")?.addEventListener("click", () => hint.remove());
    window.setTimeout(() => hint?.remove(), 14000);
  }

  return {
    ensureButton,
    openPopup,
    closePopup,
    showImportHint,
    importFromRaw,
    captureCurrentLayout: () => captureCurrentLayout({ docTabs, viewportLabel: getViewportLabel() }),
  };
}

export const viewportLayoutSettingsFieldHtml = `
  <div class="profile-pref-section" id="pref-viewport-layouts" data-vp-layout-settings>
    <h3 class="profile-pref-section-title">Saved split views</h3>
    <p class="muted small profile-preferences-note">These layouts are a general Studio setting. They are not tied to a project. Use the Layouts button at the end of the viewport tab strip, or paste share links below.</p>
    <label class="app-dialog-label">Extra view config links
      <textarea id="pref-viewport-layout-links" rows="4" placeholder="https://render3d.app/share/…"></textarea>
    </label>
    <p class="muted small">One URL per line. Opening a link imports that layout here — no workspace picker.</p>
  </div>
`;
