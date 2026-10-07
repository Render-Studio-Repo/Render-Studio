/**
 * Named XR window layouts — per user, not per project.
 * Pose payload matches viewport-xr savePanelPose / saveOpenWindowsLayout.
 * Thumbnails are an icon grid, never a 4K screenshot.
 */

export const LS_XR_LAYOUTS = "render3d:xr-window-layouts:v1";
export const XR_LAYOUTS_MAX = 8;
export const XR_LAYOUT_THUMB = { w: 160, h: 90 };
export const LAYOUT_NAME_PRESETS = ["Desk", "Board", "Modeling", "Social"];

export const LAYOUT_OPEN_FLAGS = [
  ["menu", "menuOpen"],
  ["ai", "aiOpen"],
  ["view", "viewOpen"],
  ["settings", "settingsOpen"],
  ["tools", "toolsOpen"],
  ["aiHub", "aiHubOpen"],
  ["socialHub", "socialHubOpen"],
  ["draw", "drawOpen"],
  ["workspace", "workspaceOpen"],
  ["avatar", "avatarOpen"],
  ["place", "placeOpen"],
  ["studio", "studioOpen"],
  ["social", "socialOpen"],
  ["robotics", "roboticsOpen"],
];

export const LAYOUT_PANEL_COLORS = {
  menu: "#e85d4c",
  ai: "#22c55e",
  view: "#38bdf8",
  settings: "#94a3b8",
  tools: "#f59e0b",
  aiHub: "#16a34a",
  socialHub: "#a855f7",
  draw: "#06b6d4",
  workspace: "#0ea5e9",
  avatar: "#c084fc",
  place: "#3b82f6",
  studio: "#f97316",
  social: "#a855f7",
  robotics: "#06b6d4",
};

export function xrLayoutsStorageKey(userId) {
  const uid = String(userId || "").trim() || "anonymous";
  return `${LS_XR_LAYOUTS}:${uid}`;
}

export function nextLayoutName(layouts = []) {
  const used = new Set((layouts || []).map((l) => String(l?.name || "").trim()));
  let n = 1;
  while (used.has(`Layout ${n}`)) n += 1;
  return `Layout ${n}`;
}

export function layoutNameSuggestions(layouts = []) {
  const next = nextLayoutName(layouts);
  const names = [next];
  for (const preset of LAYOUT_NAME_PRESETS) {
    if (!names.includes(preset)) names.push(preset);
  }
  return names.slice(0, 5);
}

function clampNum(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

export function sanitizePanelPose(raw) {
  if (!raw || typeof raw !== "object") return null;
  const pose = {
    v: 2,
    visible: raw.visible === true,
    forward: clampNum(raw.forward, 0.25, 2.4, 0.7),
    right: clampNum(raw.right, -1.6, 1.6, 0),
    up: clampNum(raw.up, -0.8, 0.5, -0.08),
  };
  if (raw.tab) pose.tab = String(raw.tab).slice(0, 24);
  return pose;
}

export function openFlagsFromPoseMap(all = {}) {
  const open = {};
  for (const [kind, flag] of LAYOUT_OPEN_FLAGS) {
    const pose = all?.[kind];
    open[flag] = all?.[flag] === true || pose?.visible === true;
  }
  return open;
}

export function openKindsFromLayout(record) {
  const open = record?.open || openFlagsFromPoseMap(record?.poses || {});
  const kinds = [];
  for (const [kind, flag] of LAYOUT_OPEN_FLAGS) {
    if (open[flag] === true || record?.poses?.[kind]?.visible === true) kinds.push(kind);
  }
  return kinds;
}

export function serializeOpenWindowsLayout(all = {}, {
  name = "",
  id = "",
  thumb = "",
  now = Date.now(),
  sceneId = "",
} = {}) {
  const poses = {};
  for (const [kind] of LAYOUT_OPEN_FLAGS) {
    const pose = sanitizePanelPose(all?.[kind]);
    if (pose) poses[kind] = pose;
  }
  const open = openFlagsFromPoseMap(all);
  const layoutName = String(name || "").trim() || "Layout 1";
  return {
    id: String(id || `lay-${now.toString(36)}`).slice(0, 32),
    name: layoutName.slice(0, 40),
    thumb: String(thumb || "").slice(0, 12000),
    createdAt: Number(all?.createdAt) || now,
    lastUsedAt: now,
    menuTab: String(all?.menuTab || poses.menu?.tab || "projects").slice(0, 24),
    sceneId: String(sceneId || all?.sceneId || "white").slice(0, 40),
    poses,
    open,
  };
}

export function applyLayoutToPoseMap(record) {
  const poses = {};
  const src = record?.poses || {};
  for (const [kind] of LAYOUT_OPEN_FLAGS) {
    const pose = sanitizePanelPose(src[kind]);
    if (pose) poses[kind] = pose;
  }
  const open = openFlagsFromPoseMap({ ...src, ...(record?.open || {}) });
  for (const [, flag] of LAYOUT_OPEN_FLAGS) {
    poses[flag] = open[flag] === true;
  }
  const menuTab = String(record?.menuTab || poses.menu?.tab || "").trim();
  if (menuTab) {
    poses.menuTab = menuTab;
    if (poses.menu) poses.menu.tab = menuTab;
  }
  return poses;
}

export function layoutThumbCells(record) {
  const kinds = openKindsFromLayout(record);
  const list = kinds.length ? kinds : ["menu"];
  const cols = Math.min(4, Math.max(1, list.length));
  const rows = Math.ceil(list.length / cols);
  return list.map((kind, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const pose = record?.poses?.[kind];
    const nx = pose ? (Number(pose.right) + 1.2) / 2.4 : (col + 0.5) / cols;
    const ny = pose ? 1 - (Number(pose.up) + 0.5) / 1.1 : (row + 0.5) / rows;
    return {
      kind,
      color: LAYOUT_PANEL_COLORS[kind] || "#64748b",
      x: Math.min(0.92, Math.max(0.08, Number.isFinite(nx) ? nx : 0.5)),
      y: Math.min(0.88, Math.max(0.12, Number.isFinite(ny) ? ny : 0.5)),
    };
  });
}

export function paintLayoutThumb(ctx, record, w = XR_LAYOUT_THUMB.w, h = XR_LAYOUT_THUMB.h) {
  if (!ctx) return;
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(6, 8, w - 12, h - 16);
  const cells = layoutThumbCells(record);
  const rw = Math.max(18, Math.round(w / (cells.length + 1.5)));
  const rh = Math.max(14, Math.round(h * 0.28));
  cells.forEach((cell) => {
    const x = 8 + cell.x * (w - rw - 16);
    const y = 10 + cell.y * (h - rh - 20);
    ctx.fillStyle = cell.color;
    ctx.fillRect(x, y, rw, rh);
  });
}

export function layoutThumbnailDataUrl(record, { document: doc } = {}) {
  const host = doc || (typeof document !== "undefined" ? document : null);
  if (!host?.createElement) return "";
  try {
    const canvas = host.createElement("canvas");
    canvas.width = XR_LAYOUT_THUMB.w;
    canvas.height = XR_LAYOUT_THUMB.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    paintLayoutThumb(ctx, record, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.55);
  } catch {
    return "";
  }
}

export function emptyLayoutStore() {
  return { v: 1, layouts: [], lastId: "" };
}

export function parseLayoutStore(raw) {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || typeof data !== "object") return emptyLayoutStore();
    const layouts = Array.isArray(data.layouts)
      ? data.layouts.map((row) => serializeOpenWindowsLayout(
        { ...(row.poses || {}), ...(row.open || {}), menuTab: row.menuTab },
        { name: row.name, id: row.id, thumb: row.thumb, sceneId: row.sceneId, now: row.lastUsedAt || row.createdAt || Date.now() },
      )).slice(0, XR_LAYOUTS_MAX)
      : [];
    const lastId = layouts.some((l) => l.id === data.lastId) ? String(data.lastId) : (layouts[0]?.id || "");
    return { v: 1, layouts, lastId };
  } catch {
    return emptyLayoutStore();
  }
}

export function stringifyLayoutStore(store) {
  const next = parseLayoutStore(store);
  return JSON.stringify(next);
}

export function upsertNamedLayout(store, record) {
  const cur = parseLayoutStore(store);
  const row = serializeOpenWindowsLayout(
    { ...(record?.poses || {}), ...(record?.open || {}), menuTab: record?.menuTab },
    { name: record?.name, id: record?.id, thumb: record?.thumb, sceneId: record?.sceneId, now: record?.lastUsedAt || Date.now() },
  );
  const idx = cur.layouts.findIndex((l) => l.id === row.id);
  if (idx >= 0) cur.layouts[idx] = row;
  else cur.layouts.unshift(row);
  cur.layouts = cur.layouts.slice(0, XR_LAYOUTS_MAX);
  cur.lastId = row.id;
  return cur;
}

export function markLayoutUsed(store, id, now = Date.now()) {
  const cur = parseLayoutStore(store);
  const row = cur.layouts.find((l) => l.id === id);
  if (row) row.lastUsedAt = now;
  if (id && cur.layouts.some((l) => l.id === id)) cur.lastId = id;
  return cur;
}

export function layoutById(store, id) {
  return parseLayoutStore(store).layouts.find((l) => l.id === String(id || "")) || null;
}

export function mergeLayoutStores(local, server) {
  const a = parseLayoutStore(local);
  const b = parseLayoutStore(server);
  const map = new Map();
  for (const row of [...b.layouts, ...a.layouts]) {
    const prev = map.get(row.id);
    if (!prev || (row.lastUsedAt || 0) >= (prev.lastUsedAt || 0)) map.set(row.id, row);
  }
  const layouts = [...map.values()]
    .sort((x, y) => (y.lastUsedAt || 0) - (x.lastUsedAt || 0))
    .slice(0, XR_LAYOUTS_MAX);
  const lastId = a.lastId && layouts.some((l) => l.id === a.lastId)
    ? a.lastId
    : (b.lastId && layouts.some((l) => l.id === b.lastId) ? b.lastId : (layouts[0]?.id || ""));
  return { v: 1, layouts, lastId };
}

/** Never auto-open 10 windows. Last layout applies only when the user picks it. */
export function shouldAutoApplyLastLayout({ userPicked = false } = {}) {
  return userPicked === true;
}
