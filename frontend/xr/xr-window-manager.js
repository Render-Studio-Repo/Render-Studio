/**
 * XR command-center windows: arc layout, grab-release, short select pointer,
 * closest HUD pick, headset clock / battery.
 */

import {
  XR_WINDOW_SPAWN_DIST_M,
  XR_WINDOW_SPAWN_MAX_M,
  XR_WINDOW_SPAWN_UP_M,
} from "./xr-window-placement.js?v=vrnear1";

export const XR_SELECT_POINTER_M = 0.16;
export const XR_SELECT_POINTER_MAX_M = 0.22;
export const XR_WM_ARC_FORWARD = XR_WINDOW_SPAWN_DIST_M;
export const XR_WM_ARC_RADIUS = 0.46;

export const WINDOW_OVERFLOW_ACTION_IDS = [
  "lock",
  "unlock",
  "move-this",
  "move-set",
  "rotate",
  "hide",
];

export const WINDOW_CHROME_TOOLTIPS = {
  anchor: "Anchor — save this spot for next session",
  curve: "Curved screen",
  resize: "Resize — drag the corner",
  hide: "Hide from other users",
};

export function windowChromeTooltipForId(id = "") {
  return WINDOW_CHROME_TOOLTIPS[String(id || "")] || "";
}

export function windowChromeHoverId(hit = null) {
  const id = String(hit?.id || hit?.chromeId || "");
  if (WINDOW_CHROME_TOOLTIPS[id]) return id;
  const kind = String(hit?.kind || "");
  if (kind === "share-video-hide" || kind === "wm-hide") return "hide";
  if (kind === "share-video-curve" || kind === "wm-curve") return "curve";
  if (kind === "share-video-anchor" || kind === "wm-anchor") return "anchor";
  if (kind === "share-video-resize" || kind === "wm-resize") return "resize";
  return "";
}

export function commandCenterSlot(index, count, {
  forward = XR_WM_ARC_FORWARD,
  radius = XR_WM_ARC_RADIUS,
  up = XR_WINDOW_SPAWN_UP_M,
} = {}) {
  const n = Math.max(1, Number(count) || 1);
  const i = Math.max(0, Number(index) || 0);
  const span = Math.min(1.45, 0.34 * Math.max(0, n - 1));
  const t = n === 1 ? 0 : (i / (n - 1) - 0.5);
  const yaw = t * span;
  const row = i % 2 === 1 ? 0.07 : 0;
  return {
    forward: Math.max(0.45, forward * Math.cos(yaw * 0.42)),
    right: Math.sin(yaw) * radius,
    up: up + row,
    yaw,
  };
}

export function commandCenterSlots(count, opts) {
  const n = Math.max(0, Number(count) || 0);
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(commandCenterSlot(i, n, opts));
  return out;
}

export function closestHudHit(hits = []) {
  let best = null;
  let bestD = Infinity;
  for (const hit of hits) {
    if (!hit || typeof hit !== "object") continue;
    const d = Number(hit.distance);
    if (!Number.isFinite(d) || d < 0 || d >= bestD) continue;
    best = hit;
    bestD = d;
  }
  return best;
}

export function roboticsBeatsStackedHud(roboticsHit, otherHits = []) {
  if (!roboticsHit || typeof roboticsHit !== "object") return false;
  const d = Number(roboticsHit.distance);
  if (!Number.isFinite(d) || d < 0) return false;
  for (const hit of otherHits) {
    if (!hit) continue;
    const od = Number(hit.distance);
    if (Number.isFinite(od) && od + 0.012 < d) return false;
  }
  return true;
}

/** Short stub from the controller — never a room-length beam. idleStub = Select tool miss. */
export function selectPointerLengthM(hit, {
  stub = XR_SELECT_POINTER_M,
  max = 3,
  idleStub = false,
} = {}) {
  const d = Number(hit?.distance);
  const hi = Number(max);
  const maxM = Number.isFinite(hi) && hi > 0 ? hi : 3;
  const lo = Number(stub);
  const stubM = Number.isFinite(lo) && lo > 0 ? lo : XR_SELECT_POINTER_M;
  if (Number.isFinite(d) && d > 0) return Math.min(Math.max(d, 0.04), maxM);
  if (hit && String(hit.kind || "").trim()) return Math.min(stubM, maxM);
  if (idleStub === true) return Math.min(stubM, maxM);
  return 0;
}

/** Both hands get a tip while presenting. Beam length is hit-only (see selectPointerLengthM). */
export function selectPointerVisible({ presenting = false, handIndex = 1 } = {}) {
  void handIndex;
  return presenting === true;
}

export function hoverHighlightOn({ hitKind = "", hovered = false } = {}) {
  if (hovered !== true) return false;
  const kind = String(hitKind || "");
  if (!kind) return false;
  return (
    kind === "tool"
    || kind === "color"
    || kind === "wheel-drag"
    || kind.endsWith("-action")
    || kind.endsWith("-tab")
    || kind.endsWith("-row")
    || kind.endsWith("-chrome")
    || kind.endsWith("-drag")
    || kind.endsWith("-rotate")
    || kind.startsWith("scene-win")
    || kind === "menu-close"
    || kind === "menu-tab"
    || kind === "menu-row"
    || kind === "share-video-hide"
    || kind === "share-video-curve"
    || kind === "share-video-anchor"
    || kind === "share-video-resize"
  );
}

export function hoverHighlightOpacity({ hovered = false } = {}) {
  return hovered === true ? 0.38 : 0.001;
}

export function panelDragEndsOnRelease({
  panelDrag = null,
  released = null,
  releasedHand = -1,
} = {}) {
  if (!panelDrag) return false;
  if (released && (
    panelDrag.controller === released
    || panelDrag.grip === released
    || panelDrag.aim === released
    || panelDrag.handObj === released
    || panelDrag.pinch === released
  )) return true;
  const hi = Number(panelDrag.hand);
  const rh = Number(releasedHand);
  if (hi >= 0 && rh >= 0 && hi === rh) return true;
  return false;
}

/** Drop when the grabbing hand's trigger / grip / pinch is up. Other hand must not keep it stuck. */
export function panelDragShouldDrop({
  panelDrag = null,
  triggers = [false, false],
  squeezes = [false, false],
  pinches = [false, false],
  requireSawHeld = false,
} = {}) {
  if (!panelDrag) return false;
  const hi = Number(panelDrag.hand);
  if (hi !== 0 && hi !== 1) return false;
  const held = panelDrag.input === "grip" ? !!squeezes[hi]
    : panelDrag.input === "trigger" ? !!(triggers[hi] || pinches[hi])
      : !!(triggers[hi] || squeezes[hi] || pinches[hi]);
  if (held) return false;
  if (requireSawHeld === true && panelDrag.sawHeld !== true) return false;
  return true;
}

/** Background clicks never move windows. Grip or explicit move handles do. */
export function panelChromeStartsDrag(kind = "", hit = null) {
  return false;
}

/** Grip on a window = move + yaw (full attach). Trigger on chrome stays translate-only. */
export function panelGripTranslateOnly() {
  return false;
}

export const XR_CLIP_SEND_RECENTS_KEY = "render3d:xr-clip-send-recents:v1";

export function clipViewerChromeLayout(planeW = 0.52, planeH = 0.30) {
  const r = 0.018;
  const close = { x: planeW / 2 - 0.028, y: planeH / 2 - 0.022, r };
  const menu = { x: close.x - 0.044, y: close.y, r };
  const hide = { x: menu.x - 0.044, y: close.y, r, id: "hide", tip: WINDOW_CHROME_TOOLTIPS.hide };
  const curve = { x: hide.x - 0.044, y: close.y, r, id: "curve", tip: WINDOW_CHROME_TOOLTIPS.curve };
  const anchor = { x: curve.x - 0.044, y: close.y, r, id: "anchor", tip: WINDOW_CHROME_TOOLTIPS.anchor };
  const resize = {
    x: planeW / 2 - 0.02,
    y: -planeH / 2 + 0.02,
    r: 0.016,
    id: "resize",
    tip: WINDOW_CHROME_TOOLTIPS.resize,
  };
  return { close, menu, hide, curve, anchor, resize, btn: r * 2 };
}

export function clipViewerOverflowItems(planeW = 0.52, planeH = 0.30) {
  const lay = clipViewerChromeLayout(planeW, planeH);
  const w = 0.24;
  const h = 0.04;
  const x = lay.menu.x - w + 0.018;
  const top = lay.menu.y - 0.03;
  return [
    { id: "share-x", label: "Share to X" },
    { id: "download", label: "Download to headset" },
    { id: "send-friend", label: "Send to friend" },
  ].map((row, i) => ({
    ...row,
    x,
    y: top - (i + 1) * (h + 0.007),
    w,
    h,
  }));
}

function inDisk(local, cell) {
  const dx = Number(local?.x) - Number(cell?.x);
  const dy = Number(local?.y) - Number(cell?.y);
  const r = Number(cell?.r) + 0.008;
  return dx * dx + dy * dy <= r * r;
}

export function pickClipViewerChrome(local, planeW = 0.52, planeH = 0.30, { menuOpen = false } = {}) {
  if (!local) return null;
  const lay = clipViewerChromeLayout(planeW, planeH);
  if (inDisk(local, lay.close)) return { kind: "share-video-close" };
  if (inDisk(local, lay.menu)) return { kind: "share-video-menu" };
  if (inDisk(local, lay.hide)) return { kind: "share-video-hide", id: "hide" };
  if (inDisk(local, lay.curve)) return { kind: "share-video-curve", id: "curve" };
  if (inDisk(local, lay.anchor)) return { kind: "share-video-anchor", id: "anchor" };
  if (inDisk(local, lay.resize)) return { kind: "share-video-resize", id: "resize" };
  if (menuOpen) {
    for (const item of clipViewerOverflowItems(planeW, planeH)) {
      if (
        local.x >= item.x && local.x <= item.x + item.w
        && local.y >= item.y && local.y <= item.y + item.h
      ) {
        return { kind: "share-video-action", id: item.id };
      }
    }
  }
  if (local.y > planeH / 2 - 0.055) return { kind: "share-video-drag" };
  return null;
}

export function readClipSendRecents(storage = null) {
  try {
    const raw = (storage || (typeof localStorage !== "undefined" ? localStorage : null))
      ?.getItem?.(XR_CLIP_SEND_RECENTS_KEY);
    const list = JSON.parse(String(raw || "[]"));
    return Array.isArray(list) ? list.map((id) => String(id || "")).filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function writeClipSendRecent(userId, storage = null) {
  const id = String(userId || "").trim();
  if (!id) return readClipSendRecents(storage);
  const next = [id, ...readClipSendRecents(storage).filter((x) => x !== id)].slice(0, 12);
  try {
    (storage || (typeof localStorage !== "undefined" ? localStorage : null))
      ?.setItem?.(XR_CLIP_SEND_RECENTS_KEY, JSON.stringify(next));
  } catch { /* private mode */ }
  return next;
}

export function friendMatchesClipSearch(person, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const p = person && typeof person === "object" ? person : {};
  const hay = [p.display_name, p.name, p.handle, p.email, p.id].map((v) => String(v || "").toLowerCase());
  return hay.some((s) => s.includes(q));
}

/** Online first, then frequent recipients, then A–Z. Search filters the list. */
export function rankFriendsForClipSend(people = [], { query = "", recents = [] } = {}) {
  const recentSet = new Set((recents || []).map((id) => String(id)));
  const filtered = (people || []).filter((p) => p && friendMatchesClipSearch(p, query));
  return filtered.slice().sort((a, b) => {
    const ao = a.online === true ? 0 : 1;
    const bo = b.online === true ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const ar = recentSet.has(String(a.id || "")) ? 0 : 1;
    const br = recentSet.has(String(b.id || "")) ? 0 : 1;
    if (ar !== br) return ar - br;
    return String(a.display_name || a.name || "").localeCompare(String(b.display_name || b.name || ""));
  });
}

export function clipFriendKeyLayout(canvasW = 720, startY = 518) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const extras = [
    { id: "space", label: "space" },
    { id: "back", label: "⌫" },
  ];
  const keys = [...letters.map((ch) => ({ id: ch, label: ch })), ...extras];
  const cols = 10;
  const gap = 6;
  const keyW = (canvasW - 28 - (cols - 1) * gap) / cols;
  const keyH = 36;
  return keys.map((key, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      ...key,
      x: 14 + col * (keyW + gap),
      y: startY + row * (keyH + 5),
      w: keyW,
      h: keyH,
    };
  });
}

export function applyClipFriendKey(search = "", keyId = "") {
  const cur = String(search || "");
  const id = String(keyId || "");
  if (id === "back") return cur.slice(0, -1);
  if (id === "space") return `${cur} `;
  if (/^[A-Z]$/.test(id)) return `${cur}${id}`;
  return cur;
}

export function shouldPersistPanelYaw({ hasQuat = false, userRotated = false, locked = false } = {}) {
  if (hasQuat !== true) return false;
  return userRotated === true || locked === true;
}

export function formatXrClock(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "--:--";
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const hh = h % 12 || 12;
  const ap = h >= 12 ? "PM" : "AM";
  return `${hh}:${m} ${ap}`;
}

export function xrBatteryPercent({ xrSession = null, navigatorBattery = null } = {}) {
  const sessionLevel = Number(
    xrSession?.batteryLevel
    ?? xrSession?.battery?.level
    ?? xrSession?.inputSources?.[0]?.gamepad?.hapticActuators?.length,
  );
  void sessionLevel;
  const fromSession = Number(xrSession?.batteryLevel ?? xrSession?.battery?.level);
  if (Number.isFinite(fromSession)) {
    return Math.round(fromSession <= 1 ? fromSession * 100 : fromSession);
  }
  const level = Number(navigatorBattery?.level);
  if (Number.isFinite(level)) return Math.round(Math.max(0, Math.min(1, level)) * 100);
  return null;
}

export function formatXrBattery(pct) {
  if (!Number.isFinite(pct)) return "—";
  return `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
}

export function bootEnterShouldCallSession({
  lastStartAt = 0,
  now = 0,
  fromBoot = false,
  presenting = false,
} = {}) {
  if (fromBoot === true && presenting === true) return true;
  if (fromBoot === true) return true;
  return Number(now) - Number(lastStartAt) >= 400;
}

/** Keep AR sessions on supported headsets so passthrough can toggle without re-entry. */
export function xrEnterSessionMode({ fromBoot = false, probedMode = "immersive-ar" } = {}) {
  void fromBoot;
  return String(probedMode || "") === "immersive-vr" ? "immersive-vr" : "immersive-ar";
}

/** Boot auto-open must not restore a saved pose that parks the menu on the CAD. */
export function shouldReapplySavedMenuPoseOnBoot({ fromBoot = false } = {}) {
  return fromBoot !== true;
}

export const XR_LEFT_MONITOR_YAW = 0.52;
export const XR_LEFT_MONITOR_YAW_MIN = 0.35;
export const XR_LEFT_MONITOR_YAW_MAX = 0.70;

/**
 * Left-monitor pose: beside the CAD (or a cheap in-front stage), yawed inward
 * toward the head. Never centered on the mesh.
 */
export function leftMonitorMenuPose({
  head = { x: 0, y: 1.6, z: 0 },
  forward = { x: 0, y: 0, z: -1 },
  right = { x: 1, y: 0, z: 0 },
  cadCenter = null,
  cadRadius = 0.18,
  yaw = XR_LEFT_MONITOR_YAW,
} = {}) {
  const yawClamped = Math.min(
    XR_LEFT_MONITOR_YAW_MAX,
    Math.max(XR_LEFT_MONITOR_YAW_MIN, Number(yaw) || XR_LEFT_MONITOR_YAW),
  );
  const hx = Number(head.x) || 0;
  const hy = Number.isFinite(Number(head.y)) ? Number(head.y) : 1.6;
  const hz = Number(head.z) || 0;
  const fx = Number(forward.x) || 0;
  const fy = Number(forward.y) || 0;
  const fz = Number(forward.z) || -1;
  const rx = Number(right.x) || 1;
  const ry = Number(right.y) || 0;
  const rz = Number(right.z) || 0;
  const anchor = cadCenter && Number.isFinite(Number(cadCenter.x))
    ? {
        x: Number(cadCenter.x),
        y: Number.isFinite(Number(cadCenter.y)) ? Number(cadCenter.y) : hy - 0.08,
        z: Number(cadCenter.z) || 0,
      }
    : {
        x: hx + fx * XR_WINDOW_SPAWN_DIST_M,
        y: hy + XR_WINDOW_SPAWN_UP_M,
        z: hz + fz * XR_WINDOW_SPAWN_DIST_M,
      };
  const side = Math.max(0.32, Math.min(0.42, Number(cadRadius) + 0.22));
  let x = anchor.x - rx * side + fx * 0.04;
  let z = anchor.z - rz * side + fz * 0.04;
  const dx = x - hx;
  const dz = z - hz;
  const horiz = Math.hypot(dx, dz);
  if (horiz > XR_WINDOW_SPAWN_MAX_M || horiz < 0.40) {
    const scale = XR_WINDOW_SPAWN_DIST_M / Math.max(horiz, 0.01);
    x = hx + dx * scale;
    z = hz + dz * scale;
  }
  return {
    x,
    y: hy + XR_WINDOW_SPAWN_UP_M,
    z,
    yaw: yawClamped,
  };
}

export function panelResizeScale({
  startScale = 1,
  startCornerDist = 0.2,
  nowCornerDist = 0.2,
  min = 0.45,
  max = 2.2,
} = {}) {
  const start = Number(startCornerDist);
  const now = Number(nowCornerDist);
  const base = Number(startScale);
  const lo = Number(min);
  const hi = Number(max);
  const s0 = Number.isFinite(base) && base > 0.05 ? base : 1;
  const d0 = Number.isFinite(start) && start > 0.02 ? start : 0.2;
  const d1 = Number.isFinite(now) && now > 0.02 ? now : d0;
  const next = s0 * (d1 / d0);
  const minS = Number.isFinite(lo) && lo > 0.1 ? lo : 0.45;
  const maxS = Number.isFinite(hi) && hi > minS ? hi : 2.2;
  return Math.min(maxS, Math.max(minS, next));
}

export function curvedScreenRadiusM(planeW = 0.52, amount = 0.42) {
  const w = Math.max(0.12, Number(planeW) || 0.52);
  const a = Math.min(0.85, Math.max(0.12, Number(amount) || 0.42));
  return w / (2 * Math.sin(a * 0.5));
}

export function enterVrButtonWired(src = "") {
  const text = String(src || "");
  const enterAt = text.indexOf("function requestXrEnter");
  const bindAt = text.indexOf("function bindBootXrBtn");
  const enterFn = enterAt >= 0 && bindAt > enterAt ? text.slice(enterAt, bindAt) : "";
  return text.includes("studio-boot-enter-vr")
    && text.includes("requestXrEnter")
    && text.includes("__enterXrFromBoot")
    && text.includes("startFromUserGesture")
    && !/location\.hash\s*=/.test(enterFn)
    && !enterFn.includes("fab.click()")
    && !enterFn.includes("setShellTab")
    && !enterFn.includes("enterStudioViewportShell");
}

/** Quest Browser WebXR cannot host the OS Meta Browser app or Horizon Virtual Display. */
export const XR_SCENE_WIN_OS_LIMIT =
  "Cannot embed Meta Browser or Horizon Virtual Display as OS windows.";

export const XR_SCENE_WIN_URL_KEY = "render3d:xr-scene-win-url:v1";
export const XR_SCENE_WIN_PREFS_KEY = "render3d:xr-scene-win-prefs:v1";
export const XR_SCENE_WIN_CANVAS = { w: 720, h: 420, headerEnd: 56 };
export const XR_SCENE_WIN_PLANE = { w: 0.52, h: 0.304 };

export function xrSceneWindowsDefaultState() {
  return {
    browserOn: false,
    displayOn: false,
    pinned: true,
    widthId: "m",
    url: "",
  };
}

export function readXrSceneWindowPrefs(storage = null) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  try {
    const raw = JSON.parse(store?.getItem?.(XR_SCENE_WIN_PREFS_KEY) || "null");
    if (!raw || typeof raw !== "object") return { pinned: true, widthId: "m" };
    return {
      pinned: raw.pinned !== false,
      widthId: ["s", "m", "l"].includes(raw.widthId) ? raw.widthId : "m",
    };
  } catch {
    return { pinned: true, widthId: "m" };
  }
}

export function writeXrSceneWindowPrefs(partial = {}, storage = null) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  const next = { ...readXrSceneWindowPrefs(store), ...partial };
  next.pinned = next.pinned !== false;
  next.widthId = ["s", "m", "l"].includes(next.widthId) ? next.widthId : "m";
  try { store?.setItem?.(XR_SCENE_WIN_PREFS_KEY, JSON.stringify({ pinned: next.pinned, widthId: next.widthId })); } catch { /* ignore */ }
  return next;
}

export function xrSceneWindowCreateCallsCadStyle() {
  return false;
}

/** CSS3D / iframe overlays crash Quest immersive WebXR — never on headset or while presenting. */
export function xrSceneHtmlOverlayAllowed({ presenting = false, questBrowser = false } = {}) {
  return presenting !== true && questBrowser !== true;
}

export function xrSceneWindowWidthScale(id = "m") {
  if (id === "s") return 0.82;
  if (id === "l") return 1.28;
  return 1;
}

export function nextXrSceneWindowWidthId(id = "m") {
  if (id === "s") return "m";
  if (id === "m") return "l";
  return "s";
}

export function xrSceneWindowWidthLabel(id = "m") {
  if (id === "s") return "Narrow";
  if (id === "l") return "Wide";
  return "Med";
}

export function normalizeXrSceneUrl(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return s;
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(s)) return `https://${s}`;
  return s;
}

export function isXrSceneWindowHitKind(kind = "") {
  const k = String(kind || "");
  return k.startsWith("scene-win");
}

export function settingsWindowsTools({
  browserOn = false,
  displayOn = false,
  pinned = true,
  widthId = "m",
} = {}) {
  return [
    {
      id: "win_browser",
      label: browserOn ? "Browser on" : "Browser",
      icon: "knowledge",
      color: browserOn ? 0x22c55e : 0x64748b,
    },
    {
      id: "win_display",
      label: displayOn ? "Display on" : "Display",
      icon: "view",
      color: displayOn ? 0x22c55e : 0x64748b,
    },
    { id: "win_add_url", label: "Add URL", icon: "plus", color: 0x0ea5e9 },
    { id: "win_close", label: "Close", icon: "restore", color: 0xf97316 },
    {
      id: "win_pin",
      label: pinned ? "Pinned" : "Follow",
      icon: "place",
      color: pinned ? 0x22c55e : 0x38bdf8,
    },
    {
      id: "win_width",
      label: xrSceneWindowWidthLabel(widthId),
      icon: "front",
      color: 0xa855f7,
    },
  ];
}

function inRect(px, py, cell) {
  if (!cell) return false;
  return px >= cell.x && px <= cell.x + cell.w && py >= cell.y && py <= cell.y + cell.h;
}

export function xrSceneWindowChromeRects(canvasW = XR_SCENE_WIN_CANVAS.w, canvasH = XR_SCENE_WIN_CANVAS.h, headerEnd = XR_SCENE_WIN_CANVAS.headerEnd) {
  return {
    close: { x: canvasW - 88, y: 8, w: 80, h: headerEnd - 12 },
    drag: { x: 8, y: 8, w: canvasW - 188, h: headerEnd - 12 },
    resize: { x: canvasW - 48, y: canvasH - 48, w: 44, h: 44 },
    url: { x: 16, y: 64, w: canvasW - 220, h: 44 },
    go: { x: canvasW - 196, y: 64, w: 84, h: 44 },
    open: { x: canvasW - 104, y: 64, w: 88, h: 44 },
    keysY: 122,
  };
}

export function xrSceneUrlKeyLayout(canvasW = XR_SCENE_WIN_CANVAS.w, startY = 122) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const extras = [
    { id: "https", label: "https" },
    { id: "www", label: "www" },
    { id: "dot", label: "." },
    { id: "slash", label: "/" },
    { id: "dash", label: "-" },
    { id: "colon", label: ":" },
    { id: "com", label: ".com" },
    { id: "space", label: "space" },
    { id: "back", label: "⌫" },
    { id: "go", label: "Go" },
  ];
  const keys = [...letters.map((ch) => ({ id: ch, label: ch })), ...extras];
  const cols = 10;
  const gap = 6;
  const keyW = (canvasW - 28 - (cols - 1) * gap) / cols;
  const keyH = 36;
  return keys.map((key, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      ...key,
      x: 14 + col * (keyW + gap),
      y: startY + row * (keyH + 5),
      w: keyW,
      h: keyH,
    };
  });
}

export function applyXrSceneUrlKey(draft = "", keyId = "") {
  const cur = String(draft || "");
  const id = String(keyId || "");
  if (id === "back") return cur.slice(0, -1);
  if (id === "space") return `${cur} `;
  if (id === "dot") return `${cur}.`;
  if (id === "slash") return `${cur}/`;
  if (id === "dash") return `${cur}-`;
  if (id === "colon") return `${cur}:`;
  if (id === "com") return `${cur}.com`;
  if (id === "www") return cur.includes("www.") ? cur : `${cur}www.`;
  if (id === "https") {
    if (/^https?:\/\//i.test(cur)) return cur;
    return `https://${cur}`;
  }
  if (id === "go") return cur;
  if (/^[A-Z]$/.test(id)) return `${cur}${id.toLowerCase()}`;
  return cur;
}

export function pickXrSceneWindowHit(px, py, {
  kind = "browser",
  kbOpen = false,
  canvasW = XR_SCENE_WIN_CANVAS.w,
  canvasH = XR_SCENE_WIN_CANVAS.h,
  headerEnd = XR_SCENE_WIN_CANVAS.headerEnd,
} = {}) {
  const chrome = xrSceneWindowChromeRects(canvasW, canvasH, headerEnd);
  if (inRect(px, py, chrome.close)) return { kind: "scene-win-close" };
  if (inRect(px, py, chrome.resize)) return { kind: "scene-win-resize" };
  if (inRect(px, py, chrome.drag)) return { kind: "scene-win-drag" };
  if (kind === "browser") {
    if (inRect(px, py, chrome.url)) return { kind: "scene-win-url" };
    if (inRect(px, py, chrome.go)) return { kind: "scene-win-action", id: "go" };
    if (inRect(px, py, chrome.open)) return { kind: "scene-win-action", id: "open" };
    if (kbOpen === true) {
      for (const key of xrSceneUrlKeyLayout(canvasW, chrome.keysY)) {
        if (inRect(px, py, key)) {
          return { kind: "scene-win-action", id: key.id === "go" ? "go" : `key:${key.id}` };
        }
      }
    }
  }
  return { kind: "scene-win-chrome" };
}

export function readXrSceneWindowUrl(storage = null) {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    return normalizeXrSceneUrl(store?.getItem?.(XR_SCENE_WIN_URL_KEY) || "");
  } catch {
    return "";
  }
}

export function writeXrSceneWindowUrl(url, storage = null) {
  const next = normalizeXrSceneUrl(url);
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return next;
    if (next) store.setItem(XR_SCENE_WIN_URL_KEY, next);
    else store.removeItem(XR_SCENE_WIN_URL_KEY);
  } catch { /* private mode */ }
  return next;
}
