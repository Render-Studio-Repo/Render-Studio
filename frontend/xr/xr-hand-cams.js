/**
 * Robotic hand-camera windows: control PC vs camera PC, wrist vs detach.
 * JPEG textures reuse the DimOS/Quest snapshot style (no QuickTime).
 * VR wrist windows stay hidden until Robotics and the explicit VR camera view
 * are both on. Wrist/Move is placement only. Hide is per-window from the
 * other controller's pointer.
 */

import { isLoopbackHost, isPrivateLanHost, hostnameOf } from "./xr-dimos-lan.js?v=20260909-dimosui1-20260914-lanpc1";

export const HAND_CAM_STORAGE_KEY = "render3d:handCamPrefs";
export const HAND_CAM_WRIST_SIZE = { w: 0.14, h: 0.088 };
/** Same Y-180 as the wrist dock so PlaneGeometry +Z faces the user, not the wrist. */
export const WRIST_CAM_HUD_Y_FLIP = Math.PI;
/** Toward-head push matching the controller HUD. */
export const WRIST_CAM_HUD_PUSH_M = 0.068;
export const WRIST_CAM_HUD_UP_M = 0.014;
/** Lateral offset: left of the left menu, right of the right menu. */
export const WRIST_CAM_LATERAL_M = 0.095;
export const WRIST_CAM_HIDE_SIZE = { w: 0.044, h: 0.018 };
export const HAND_CAM_SIZE_MIN = 0.08;
export const HAND_CAM_SIZE_MAX = 0.42;
/** 2×2 placeholder JPEGs are not a connected camera. */
export const HAND_CAM_LIVE_MIN_PX = 16;
export const SAM_CAMERA_HOST_DEFAULT = "192.168.1.83";
export const SAM_CAMERA_ACCOUNT_EMAILS = [
  "a1projects@protonmail.com",
  "a1projects@protonmail",
  "sam@render3d.app",
  "sam@smartcallusa.com",
  "samwins.stead@gmail.com",
];

/** Studio JPEG publish listen port on this Mac (same uvicorn as Render Studio). */
export const HAND_CAM_STUDIO_PORT = 8001;
export const HAND_CAM_PUBLISH_PATH = "/api/robotics/hand-cam/publish";
export const HAND_CAM_PERMISSION_PATH = "/api/robotics/hand-cam/request-permission";
export const HAND_CAM_STATUS_PATH = "/api/robotics/hand-cam/status";
export const HAND_CAM_LABELS_PATH = "/api/robotics/hand-cam/labels";
export const HAND_CAM_ENABLE_EVENT = "render3d:wrist-cam-enable";
export const HAND_CAM_PRESENTATIONS = Object.freeze({ unified: "unified", detached: "detached" });
export const HAND_CAM_CAPTURE_APP_DEFAULT = "Python.app";
export const HAND_CAM_PERMISSION_TIMEOUT_MS = 2500;
export const HAND_CAM_HOTPLUG_MS = 1500;
export const HAND_CAM_HOTPLUG_CACHE = "camhot1";
export const HAND_CAM_REINIT_CACHE = "camre1";
export const HAND_CAM_SKIP_CACHE = "camskip1";
export const CAMERA_PERMISSION_HELPER = "Check the Mac for a Camera prompt for Python.";
const PERM_DENIED_RE = /permission denied|not (?:authorized|permitted|allowed)|open timed out|\btcc\b|python\.app still needs camera/i;
const UNPLUGGED_RE = /plugged in|no usb camera found|only capture screen|only facetime|skip facetime/i;
let _sessionLive = false;

export function cameraPermissionHelper(app = HAND_CAM_CAPTURE_APP_DEFAULT) {
  void app;
  return CAMERA_PERMISSION_HELPER;
}
export const HAND_CAM_LAN_BASE = `http://${SAM_CAMERA_HOST_DEFAULT}:${HAND_CAM_STUDIO_PORT}`;
export const HAND_CAM_PUBLISH_COMMAND = `curl -sS -X POST ${HAND_CAM_LAN_BASE}${HAND_CAM_PUBLISH_PATH} -H 'Content-Type: application/json' -d '{"on":true}'`;

/** Exact Mini commands recovered from Sam's Notes + earlier USB camera sessions. */
export const MAC_USB_CAM_COMMANDS = [
  HAND_CAM_PUBLISH_COMMAND,
  "system_profiler SPCameraDataType",
  'ffmpeg -f avfoundation -list_devices true -i ""',
  "osascript -e 'tell application \"QuickTime Player\" to activate' -e 'tell application \"QuickTime Player\" to new movie recording'",
  "imagesnap -l",
  'ffmpeg -f avfoundation -framerate 30 -i "0" /tmp/wrist-left.jpg',
  'ffmpeg -f avfoundation -framerate 30 -i "1" /tmp/wrist-right.jpg',
].join("\n");

const LISTENERS = new Set();
let _publishOn = false;
let _publishPromise = null;

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function studioUserId(user = null) {
  if (user?.id) return String(user.id);
  try {
    const raw = storage()?.getItem("render3d:user");
    const parsed = raw ? JSON.parse(raw) : null;
    return String(parsed?.id || "") || "anon";
  } catch {
    return "anon";
  }
}

export function studioUserEmail(user = null) {
  if (user?.email) return String(user.email).trim().toLowerCase();
  try {
    const raw = storage()?.getItem("render3d:user");
    const parsed = raw ? JSON.parse(raw) : null;
    return String(parsed?.email || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

export function isSamCameraAccount(user = null) {
  return SAM_CAMERA_ACCOUNT_EMAILS.includes(studioUserEmail(user));
}

export function prefsStorageKey(user = null) {
  return `${HAND_CAM_STORAGE_KEY}:${studioUserId(user)}`;
}

/** First IPv4 in a pasted cam/Viser/teleop string. Drops paths and extra ports. */
export function cameraHostIpv4(raw = "") {
  const m = String(raw || "").match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
  return m ? m[1] : "";
}

/**
 * Wrist JPEG host only: 192.168.1.83 or 192.168.1.83:8001.
 * Strips Viser :8095, teleop :8443, paths, and stacked ports like :8095:8001.
 */
export function normalizeCameraHostInput(raw, { samDefault = false } = {}) {
  const s = String(raw || "").trim();
  if (!s) return samDefault ? SAM_CAMERA_HOST_DEFAULT : "";
  let host = "";
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      host = String(new URL(s).hostname || "").toLowerCase();
    }
  } catch {
    host = "";
  }
  if (!host) host = cameraHostIpv4(s) || hostnameOf(s.replace(/^\[|\]$/g, "").split("/")[0].split("?")[0]);
  if (host.includes(":") && host.split(":").length !== 2) host = cameraHostIpv4(host) || host.split(":")[0];
  if (!host) return samDefault ? SAM_CAMERA_HOST_DEFAULT : "";
  if (!isPrivateLanHost(host) && !isLoopbackHost(host)) return "";
  return host;
}

export function defaultCameraHostForUser(user = null) {
  return isSamCameraAccount(user) ? SAM_CAMERA_HOST_DEFAULT : "";
}

export function defaultCameraTitles() {
  return { left: "Left", right: "Right", pov: "Robot POV" };
}

export function cameraDeviceKeys(device = {}) {
  const keys = [];
  const uid = String(device?.uniqueId || "").trim();
  if (uid) keys.push(`uid:${uid.toLowerCase()}`);
  const usb = String(device?.usb || "").trim().toLowerCase();
  if (usb) keys.push(`usb:${usb}`);
  const name = String(device?.name || device?.label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\(usb[^)]*\)\s*$/i, "")
    .replace(/\s*\(.*\)$/, "");
  if (name) keys.push(`name:${name}`);
  for (const extra of device?.keys || []) {
    const token = String(extra || "").trim().toLowerCase();
    if (token && !keys.includes(token)) keys.push(token);
  }
  if (!keys.length && device?.index != null) keys.push(`idx:${device.index}`);
  return keys;
}

export function normalizeCameraLabelMap(raw = {}) {
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const [key, entry] of Object.entries(src)) {
    const token = String(key || "").trim().slice(0, 180);
    if (!token || !entry || typeof entry !== "object") continue;
    const requested = String(entry.side || "").toLowerCase();
    const side = requested === "right" || requested === "pov" ? requested : "left";
    const displayName = String(entry.displayName || "").trim().slice(0, 80);
    const keys = [];
    for (const item of [token, ...(entry.keys || [])]) {
      const low = String(item || "").trim().toLowerCase().slice(0, 180);
      if (low && !keys.includes(low)) keys.push(low);
    }
    out[token] = { side, displayName, keys: keys.slice(0, 16) };
  }
  return out;
}

export function normalizeCameraTitles(raw = null) {
  const titles = defaultCameraTitles();
  if (!raw || typeof raw !== "object") return titles;
  for (const side of ["left", "right", "pov"]) {
    const label = String(raw[side] || "").trim().slice(0, 80);
    if (label) titles[side] = label;
  }
  return titles;
}

export function assignCameraDeviceRole(device, role, user = null) {
  const requested = String(role || "").toLowerCase();
  const side = ["left", "right", "pov"].includes(requested) ? requested : "";
  const prev = readHandCamPrefs(user);
  const labels = { ...normalizeCameraLabelMap(prev.cameraLabels) };
  const keys = cameraDeviceKeys(device);
  // A physical camera occupies one role, and a role occupies one camera.
  for (const [key, entry] of Object.entries(labels)) {
    const sameDevice = entry.keys?.some((token) => keys.includes(token)) || keys.includes(String(key).toLowerCase());
    if (sameDevice || (side && entry.side === side)) delete labels[key];
  }
  if (side && keys.length) {
    labels[keys[0]] = { side, displayName: "", keys };
  }
  return persistHandCamPrefs({ cameraLabels: labels }, user);
}

export function lookupCameraLabel(device, labels = {}) {
  const identity = new Set(cameraDeviceKeys(device));
  for (const [key, entry] of Object.entries(labels || {})) {
    const stored = new Set([String(key).toLowerCase(), ...((entry?.keys || []).map((k) => String(k).toLowerCase()))]);
    for (const token of identity) {
      if (stored.has(token)) return entry;
    }
  }
  return null;
}

export function overlayCameraTitle(side, user = null) {
  const which = side === "right" ? "right" : "left";
  const titles = readHandCamPrefs(user).cameraTitles || defaultCameraTitles();
  return String(titles[which] || (which === "right" ? "Right" : "Left")).trim()
    || (which === "right" ? "Right" : "Left");
}

export function swapHandCamLabelMap(devices = [], user = null) {
  const prev = readHandCamPrefs(user);
  const labels = { ...normalizeCameraLabelMap(prev.cameraLabels) };
  const usable = (devices || []).filter((d) => !d?.skipped);
  const next = { ...labels };
  if (usable.length) {
    for (const device of usable) {
      const keys = cameraDeviceKeys(device);
      const primary = keys[0] || `idx:${device.index}`;
      const existing = lookupCameraLabel(device, labels);
      const defaultSide = usable.indexOf(device) === 0 ? "left" : "right";
      const current = existing?.side || device.side || defaultSide;
      const flipped = current === "right" ? "left" : "right";
      next[primary] = {
        side: flipped,
        displayName: existing?.displayName || "",
        keys: [...new Set([...(existing?.keys || []), ...keys])],
      };
    }
  } else {
    for (const [key, entry] of Object.entries(next)) {
      next[key] = { ...entry, side: entry.side === "right" ? "left" : "right" };
    }
  }
  return persistHandCamPrefs({ cameraLabels: next }, user);
}

export function isHandCamPermissionDenied(reason = "") {
  return PERM_DENIED_RE.test(String(reason || ""));
}

export function normalizeHandCamReason(reason = "") {
  const s = String(reason || "").trim();
  if (/after skip FaceTime/i.test(s) && !/only FaceTime/i.test(s)) {
    return "no wrist USB camera plugged in";
  }
  return s;
}

export function isHandCamUnplugged({ reason = "", wristCount = 0, devices = null } = {}) {
  const detail = normalizeHandCamReason(reason);
  if (isHandCamPermissionDenied(detail)) return false;
  const list = Array.isArray(devices) ? devices.filter((d) => d && !d.skipped) : null;
  const usable = list != null ? list.length : Number(wristCount) || 0;
  if (usable > 0) return false;
  if (UNPLUGGED_RE.test(detail)) return true;
  if (Array.isArray(devices) && devices.length === 0) return true;
  if (Array.isArray(devices) && devices.length > 0 && list.length === 0) return true;
  return false;
}

export function noteHandCamSessionLive(on = true) {
  _sessionLive = !!on;
}

export function hasHandCamSessionLive() {
  return _sessionLive;
}

export function resetHandCamSessionLive() {
  _sessionLive = false;
}

export function shouldShowHandCamAllow({
  live = false,
  reason = "",
  wristCount = 0,
  devices = null,
  grantedThisSession = _sessionLive,
} = {}) {
  if (live) return false;
  if (isHandCamUnplugged({ reason, wristCount, devices })) return false;
  if (isHandCamPermissionDenied(reason)) return true;
  return !grantedThisSession;
}

export function persistCameraPermissionGranted(on = true, user = null) {
  return persistHandCamPrefs({ cameraPermissionGranted: !!on }, user);
}

export function readCameraPermissionGranted(user = null) {
  return !!readHandCamPrefs(user).cameraPermissionGranted;
}

export function wristCamerasFromStatus(status = {}) {
  return (status?.devices || []).filter((d) => d && !d.skipped);
}

/** Hotplug: POST publish only. Never call request-permission / Python TCC CLI. */
export async function maybeHotplugHandCamPublish({
  status = {},
  fetchFn,
  apiFn,
  user = null,
} = {}) {
  const usable = wristCamerasFromStatus(status);
  const live = !!(status?.leftLive || status?.rightLive);
  if (live) {
    persistCameraPermissionGranted(true, user);
    noteHandCamSessionLive(true);
  }
  if (!usable.length) {
    return { action: "unplugged", publish: !!status?.publish, live: false };
  }
  const denied = isHandCamPermissionDenied(status?.leftReason)
    || isHandCamPermissionDenied(status?.rightReason);
  if (denied && !readCameraPermissionGranted(user) && !live) {
    return { action: "need-allow", publish: false, live: false };
  }
  if (live && status?.publish) {
    return { action: "live", publish: true, live: true };
  }
  const posted = await ensureHandCamPublish({ fetchFn, apiFn, on: true });
  return {
    action: "publish",
    publish: !!posted?.publish,
    live: false,
    already: !!posted?.already,
  };
}

export function persistCameraOverlayTitle(side, title, user = null) {
  const which = side === "right" ? "right" : "left";
  const prev = readHandCamPrefs(user);
  const fallback = which === "right" ? "Right" : "Left";
  const nextTitle = String(title || "").trim().slice(0, 80) || fallback;
  const titles = { ...normalizeCameraTitles(prev.cameraTitles), [which]: nextTitle };
  const labels = { ...normalizeCameraLabelMap(prev.cameraLabels) };
  for (const [key, entry] of Object.entries(labels)) {
    if (entry.side === which) labels[key] = { ...entry, displayName: nextTitle };
  }
  return persistHandCamPrefs({ cameraTitles: titles, cameraLabels: labels }, user);
}

export async function saveHandCamLabelsRemote({
  fetchFn,
  apiFn,
  headers,
  user = null,
} = {}) {
  const prefs = readHandCamPrefs(user);
  const body = {
    devices: normalizeCameraLabelMap(prefs.cameraLabels),
    titles: normalizeCameraTitles(prefs.cameraTitles),
  };
  if (typeof apiFn === "function") {
    try {
      return await apiFn(HAND_CAM_LABELS_PATH, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(headers || {}) },
        body: JSON.stringify(body),
      });
    } catch {
      /* fall through to fetch */
    }
  }
  const doFetch = fetchFn || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
  if (!doFetch) return { ok: false, error: "no fetch", labels: body };
  const hdrs = studioAuthHeaders({ ...(headers || {}) });
  try {
    const res = await doFetch(HAND_CAM_LABELS_PATH, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...hdrs },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: !!res.ok, ...data };
  } catch (err) {
    return { ok: false, error: err?.message || "labels save failed", labels: body };
  }
}

export function readHandCamPrefs(user = null) {
  const fallback = {
    cameraHost: defaultCameraHostForUser(user),
    cameraHostDraft: "",
    camMode: "wrist",
    vrScene: false,
    cameraLabels: {},
    cameraTitles: defaultCameraTitles(),
    cameraPermissionGranted: false,
  };
  try {
    const raw = storage()?.getItem(prefsStorageKey(user));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const cameraHost = normalizeCameraHostInput(parsed?.cameraHost, {
      samDefault: isSamCameraAccount(user),
    });
    return {
      cameraHost: cameraHost || fallback.cameraHost,
      cameraHostDraft: parsed?.cameraHostDraft != null ? String(parsed.cameraHostDraft) : "",
      camMode: parsed?.camMode === "detach" ? "detach" : "wrist",
      vrScene: parsed?.vrScene === true,
      cameraLabels: normalizeCameraLabelMap(parsed?.cameraLabels),
      cameraTitles: normalizeCameraTitles(parsed?.cameraTitles),
      cameraPermissionGranted: parsed?.cameraPermissionGranted === true,
    };
  } catch {
    return fallback;
  }
}

export function persistHandCamPrefs(partial = {}, user = null) {
  const prev = readHandCamPrefs(user);
  const next = {
    cameraHost: normalizeCameraHostInput(
      partial.cameraHost != null ? partial.cameraHost : prev.cameraHost,
      { samDefault: isSamCameraAccount(user) },
    ) || prev.cameraHost,
    cameraHostDraft: partial.cameraHostDraft != null
      ? String(partial.cameraHostDraft)
      : (prev.cameraHostDraft ?? ""),
    camMode: partial.camMode === "detach" || partial.camMode === "wrist"
      ? partial.camMode
      : prev.camMode,
    vrScene: partial.vrScene != null ? !!partial.vrScene : !!prev.vrScene,
    cameraLabels: partial.cameraLabels != null
      ? normalizeCameraLabelMap(partial.cameraLabels)
      : normalizeCameraLabelMap(prev.cameraLabels),
    cameraTitles: partial.cameraTitles != null
      ? normalizeCameraTitles(partial.cameraTitles)
      : normalizeCameraTitles(prev.cameraTitles),
    cameraPermissionGranted: partial.cameraPermissionGranted != null
      ? !!partial.cameraPermissionGranted
      : !!prev.cameraPermissionGranted,
  };
  try { storage()?.setItem(prefsStorageKey(user), JSON.stringify(next)); } catch { /* ignore */ }
  LISTENERS.forEach((fn) => {
    try { fn(next); } catch { /* ignore */ }
  });
  try {
    window.dispatchEvent(new CustomEvent("render3d:robotics-prefs", {
      detail: {
        cameraHost: next.cameraHost,
        camMode: next.camMode,
        cameraLabels: next.cameraLabels,
        cameraTitles: next.cameraTitles,
        cameraPermissionGranted: next.cameraPermissionGranted,
      },
    }));
  } catch { /* ignore */ }
  return next;
}

export function onHandCamPrefsChange(fn) {
  LISTENERS.add(fn);
  return () => LISTENERS.delete(fn);
}

export function resolveHandCamHost(user = null) {
  return readHandCamPrefs(user).cameraHost || defaultCameraHostForUser(user);
}

export function resolveHandCamMode(user = null) {
  return readHandCamPrefs(user).camMode === "detach" ? "detach" : "wrist";
}

export function persistHandCamHost(raw, user = null) {
  return persistHandCamPrefs({ cameraHost: raw, cameraHostDraft: String(raw ?? "") }, user);
}

/** Persist camera IP as the user types. Incomplete values stay as draft until they normalize. */
export function persistHandCamDraft(raw, user = null) {
  const draft = String(raw ?? "");
  const host = normalizeCameraHostInput(draft);
  const prev = readHandCamPrefs(user);
  return persistHandCamPrefs({
    cameraHost: host || prev.cameraHost,
    cameraHostDraft: draft,
  }, user);
}

export function displayCameraHost(prefs = null, user = null) {
  const draft = String(prefs?.cameraHostDraft || "");
  if (draft) return draft;
  return prefs?.cameraHost || defaultCameraHostForUser(user);
}

export function persistHandCamMode(mode, user = null) {
  return persistHandCamPrefs({ camMode: mode === "detach" ? "detach" : "wrist" }, user);
}

export function persistHandCamVrScene(on, user = null) {
  return persistHandCamPrefs({ vrScene: !!on }, user);
}

export function toggleHandCamVrScene(user = null) {
  return persistHandCamVrScene(!readHandCamPrefs(user).vrScene, user);
}

/** Live JPEG with real pixels — not the 2×2 disconnected placeholder. */
export function isHandCamJpegLive(image) {
  if (!image || image.complete === false) return false;
  const w = Number(image.naturalWidth) || 0;
  const h = Number(image.naturalHeight) || 0;
  return w >= HAND_CAM_LIVE_MIN_PX && h >= HAND_CAM_LIVE_MIN_PX;
}

/**
 * DIMOS remote teleop is linked: pose WS OPEN and HUD status is Connected/ENGAGED.
 * Ensure-coordinator, Enter VR, armed-only, and coordinator probe are not enough.
 */
export function isDimosTeleopLinked(state = {}) {
  if (!state || state.connected !== true) return false;
  const key = String(state.statusKey || "");
  return key === "connected" || key === "engaged";
}

/**
 * Wrist cameras require both Robotics and the explicit VR camera toggle.
 * A live feed or teleop connection alone must not add decode work to XR.
 */
export function shouldShowHandCamWindow({
  presenting = false,
  cameraLive = false,
  teleopLinked = false,
  vrScene = false,
  roboticsEnabled = false,
  hidden = false,
} = {}) {
  void cameraLive;
  void teleopLinked;
  if (!presenting || hidden) return false;
  return roboticsEnabled === true && vrScene === true;
}

export function wristCamPointerIsOtherHand(pointerHand, windowSide) {
  const pointer = pointerHand === "right" ? "right" : pointerHand === "left" ? "left" : "";
  const side = windowSide === "right" ? "right" : "left";
  return !!pointer && pointer !== side;
}

export function shouldShowWristCamHideButton({
  roboticsEnabled = false,
  windowVisible = false,
  aimingAtWindow = false,
  pointerHand = "",
  windowSide = "left",
} = {}) {
  if (!roboticsEnabled || !windowVisible || !aimingAtWindow) return false;
  return wristCamPointerIsOtherHand(pointerHand, windowSide);
}

export function wristCamHideButtonLocal(size = HAND_CAM_WRIST_SIZE) {
  const w = Number(size?.w) || HAND_CAM_WRIST_SIZE.w;
  const h = Number(size?.h) || HAND_CAM_WRIST_SIZE.h;
  return {
    x: w / 2 - WRIST_CAM_HIDE_SIZE.w / 2 - 0.004,
    y: h / 2 - WRIST_CAM_HIDE_SIZE.h / 2 - 0.004,
    z: 0.006,
  };
}

export function wristCamHideHitFromLocal(local, size = HAND_CAM_WRIST_SIZE) {
  if (!local) return null;
  const w = Number(size?.w) || HAND_CAM_WRIST_SIZE.w;
  const h = Number(size?.h) || HAND_CAM_WRIST_SIZE.h;
  if (Math.abs(Number(local.x) || 0) > w / 2 + 0.003 || Math.abs(Number(local.y) || 0) > h / 2 + 0.003) {
    return null;
  }
  const btn = wristCamHideButtonLocal(size);
  const hw = WRIST_CAM_HIDE_SIZE.w / 2;
  const hh = WRIST_CAM_HIDE_SIZE.h / 2;
  if (Math.abs((Number(local.x) || 0) - btn.x) <= hw && Math.abs((Number(local.y) || 0) - btn.y) <= hh) {
    return "hide";
  }
  return "window";
}

export function paintWristCamHideButton(ctx, { hover = false } = {}) {
  if (!ctx?.canvas) return;
  const w = ctx.canvas.width || 128;
  const h = ctx.canvas.height || 48;
  ctx.fillStyle = hover ? "#b91c1c" : "#1e293b";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = hover ? "#fecaca" : "#94a3b8";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 22px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Hide", w / 2, h / 2 + 1);
}

export function toggleHandCamMode(user = null) {
  const next = resolveHandCamMode(user) === "wrist" ? "detach" : "wrist";
  return persistHandCamMode(next, user);
}

export function cameraHostPort(host = "") {
  const name = normalizeCameraHostInput(host) || cameraHostIpv4(host);
  return { host: name, port: String(HAND_CAM_STUDIO_PORT) };
}

/** Absolute LAN JPEG URL Quest / another PC can fetch. */
export function handCamLanJpegUrl(side, host = SAM_CAMERA_HOST_DEFAULT) {
  const which = side === "right" ? "right" : "left";
  const parts = cameraHostPort(host || SAM_CAMERA_HOST_DEFAULT);
  const name = parts.host || SAM_CAMERA_HOST_DEFAULT;
  return `http://${name}:${parts.port}/api/robotics/hand-cam/${which}.jpg`;
}

function studioAuthHeaders(extra = {}) {
  try {
    const token = storage()?.getItem("render3d:token") || "";
    if (token) return { ...extra, Authorization: `Bearer ${token}` };
  } catch {
    /* ignore */
  }
  return extra;
}

export function resetHandCamPublishState() {
  _publishOn = false;
  _publishPromise = null;
  _sessionLive = false;
}

export async function requestHandCamPermission({
  fetchFn,
  headers,
  timeoutMs = HAND_CAM_PERMISSION_TIMEOUT_MS,
} = {}) {
  const doFetch = fetchFn || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
  if (!doFetch) return { ok: false, error: "no fetch", helper: cameraPermissionHelper() };
  const hdrs = studioAuthHeaders({ ...(headers || {}) });
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : HAND_CAM_PERMISSION_TIMEOUT_MS;
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer = 0;
  if (ac && typeof globalThis.setTimeout === "function") {
    timer = globalThis.setTimeout(() => {
      try { ac.abort(); } catch { /* ignore */ }
    }, ms);
  }
  try {
    const res = await doFetch(HAND_CAM_PERMISSION_PATH, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...hdrs },
      body: "{}",
      signal: ac?.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (data?.publish) _publishOn = true;
    if (res.ok || data?.prompted || data?.live) persistCameraPermissionGranted(true);
    return {
      ok: !!res.ok,
      publish: data?.publish != null ? !!data.publish : !!res.ok,
      app: data?.app || HAND_CAM_CAPTURE_APP_DEFAULT,
      helper: data?.helper || cameraPermissionHelper(data?.app),
      live: !!data?.live,
      privacyOpened: !!data?.privacyOpened,
      prompted: data?.prompted !== false,
      reason: data?.reason || "",
      cli: data?.cli || "",
    };
  } catch {
    return {
      ok: false,
      publish: true,
      app: HAND_CAM_CAPTURE_APP_DEFAULT,
      helper: cameraPermissionHelper(),
      live: false,
      prompted: true,
      reason: cameraPermissionHelper(),
      timedOut: true,
    };
  } finally {
    if (timer && typeof globalThis.clearTimeout === "function") {
      globalThis.clearTimeout(timer);
    }
  }
}

/**
 * Start the Mac JPEG publisher if it is not already on. Shared in-flight
 * promise so Wrist Cam + Viser Cameras do not double-POST.
 */
export async function ensureHandCamPublish({
  fetchFn,
  apiFn,
  headers,
  on = true,
  restart = false,
} = {}) {
  if (on && _publishOn && !_publishPromise && !restart) {
    return { publish: true, already: true };
  }
  if (_publishPromise) {
    if (!restart) return _publishPromise;
    try { await _publishPromise; } catch { /* still force recam */ }
  }
  _publishPromise = (async () => {
    const payload = { on: !!on, restart: !!restart };
    if (typeof apiFn === "function") {
      if (!restart) {
        try {
          const got = await apiFn(HAND_CAM_PUBLISH_PATH);
          if (!!got?.publish === !!on) {
            _publishOn = !!on;
            return { publish: _publishOn, already: true };
          }
        } catch {
          /* POST */
        }
      }
      try {
        const posted = await apiFn(HAND_CAM_PUBLISH_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(headers || {}) },
          body: JSON.stringify(payload),
        });
        _publishOn = posted?.publish != null ? !!posted.publish : !!on;
        return { publish: _publishOn, already: false, ...posted };
      } catch {
        /* Studio api() throws on 401/403/404 — still try fetch, then show() */
      }
    }
    const doFetch = fetchFn || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
    if (!doFetch) return { publish: false, already: false, error: "no fetch" };
    const hdrs = studioAuthHeaders({ ...(headers || {}) });
    if (!restart) {
      try {
        const getRes = await doFetch(HAND_CAM_PUBLISH_PATH, {
          method: "GET",
          credentials: "include",
          headers: hdrs,
          cache: "no-store",
        });
        const got = await getRes.json().catch(() => ({}));
        if (getRes.ok && !!got?.publish === !!on) {
          _publishOn = !!on;
          return { publish: _publishOn, already: true };
        }
      } catch {
        /* POST */
      }
    }
    try {
      const res = await doFetch(HAND_CAM_PUBLISH_PATH, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...hdrs },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      _publishOn = data?.publish != null ? !!data.publish : !!(res.ok && on);
      return { publish: _publishOn, already: false, ok: !!res.ok, ...data };
    } catch (err) {
      return { publish: false, already: false, ok: false, error: err?.message || "publish failed" };
    }
  })();
  try {
    return await _publishPromise;
  } finally {
    _publishPromise = null;
  }
}

export function emitWristCamEnable(detail = {}) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(HAND_CAM_ENABLE_EVENT, { detail }));
  } catch {
    /* ignore */
  }
  return detail;
}

/** Persist the Mac camera host, start publish, then fire the enable trigger. */
export async function activateWristCameras({
  user = null,
  host = "",
  fetchFn,
  apiFn,
  headers,
  onShow,
  restart = true,
  presentation = HAND_CAM_PRESENTATIONS.detached,
} = {}) {
  persistHandCamMode("wrist", user);
  const nextHost = normalizeCameraHostInput(host)
    || resolveHandCamHost(user)
    || SAM_CAMERA_HOST_DEFAULT;
  persistHandCamHost(nextHost, user);
  let published = { publish: false };
  try {
    published = await ensureHandCamPublish({
      fetchFn,
      apiFn,
      headers,
      on: true,
      restart,
    }) || published;
  } catch {
    published = { publish: false, error: "publish failed" };
  }
  if (!published.devices && (fetchFn || apiFn)) {
    try {
      if (typeof apiFn === "function") {
        const status = await apiFn(HAND_CAM_STATUS_PATH);
        published = { ...status, ...published };
      } else {
        const doFetch = fetchFn || globalThis.fetch?.bind(globalThis);
        const res = await doFetch?.(HAND_CAM_STATUS_PATH, { cache: "no-store", credentials: "include" });
        const status = await res?.json?.().catch?.(() => ({})) || {};
        published = { ...status, ...published };
      }
    } catch {
      /* overlays still open */
    }
  }
  const detail = {
    ...published,
    host: nextHost,
    port: HAND_CAM_STUDIO_PORT,
    leftUrl: handCamLanJpegUrl("left", nextHost),
    rightUrl: handCamLanJpegUrl("right", nextHost),
    presentation: presentation === HAND_CAM_PRESENTATIONS.unified
      ? HAND_CAM_PRESENTATIONS.unified
      : HAND_CAM_PRESENTATIONS.detached,
  };
  emitWristCamEnable(detail);
  try { await onShow?.(); } catch { /* overlay mount is best-effort */ }
  return detail;
}

/** Same-origin LAN cam proxy (HTTPS Studio must not iframe raw HTTP). */
export function camProxySrc(host = "", path = "/") {
  const parts = cameraHostPort(host);
  if (!parts.host) return "";
  const joined = String(path || "/").startsWith("/") ? path : `/${path}`;
  return `/api/cam/p/${encodeURIComponent(parts.host)}/${encodeURIComponent(parts.port)}${joined}`;
}

/** True when Cam IP is this Studio process — use same-origin JPEG, do not /api/cam/p loop. */
export function isThisStudioCameraHost(host = "", loc = globalThis.location) {
  const cam = normalizeCameraHostInput(host) || cameraHostIpv4(host);
  let studioHost = "";
  try {
    studioHost = String(loc?.hostname || "").toLowerCase();
  } catch {
    studioHost = "";
  }
  if (!cam) return true;
  if (cam === studioHost) return true;
  if (isLoopbackHost(studioHost)) return true;
  if (studioHost === "render3d.app" || studioHost.endsWith(".render3d.app")) {
    return cam === SAM_CAMERA_HOST_DEFAULT || isLoopbackHost(cam);
  }
  return false;
}

/** Snapshot URL. IP-only input becomes /api/robotics/hand-cam/{side}.jpg on this Mac. */
export function handCamJpegUrl(side, host = "", loc = globalThis.location) {
  return handCamMediaUrl(side, host, loc, "jpg");
}

/** Multipart MJPEG of the same grabber — use on LAN to skip 280ms snapshot polls. */
export function handCamMjpegUrl(side, host = "", loc = globalThis.location) {
  return handCamMediaUrl(side, host, loc, "mjpeg");
}

export function isLanStudioLocation(loc = globalThis.location) {
  let studioHost = "";
  try {
    studioHost = String(loc?.hostname || "").toLowerCase();
  } catch {
    studioHost = "";
  }
  return isLoopbackHost(studioHost) || isPrivateLanHost(studioHost);
}

export function handCamMediaUrl(side, host = "", loc = globalThis.location, ext = "jpg") {
  const which = side === "right" ? "right" : "left";
  const kind = ext === "mjpeg" ? "mjpeg" : "jpg";
  const normalized = normalizeCameraHostInput(host);
  const path = `/api/robotics/hand-cam/${which}.${kind}`;
  let https = false;
  try {
    https = String(loc?.protocol || "") === "https:";
  } catch {
    https = false;
  }
  if (isLanStudioLocation(loc) && (!normalized || isThisStudioCameraHost(normalized, loc))) {
    return path;
  }
  if (!normalized || isThisStudioCameraHost(normalized, loc)) return path;
  if (https) {
    const proxied = camProxySrc(normalized, `/${which}.${kind}`);
    if (proxied) return proxied;
  }
  return `${path}?host=${encodeURIComponent(normalized)}`;
}

export function wristCamLocalOffset(side) {
  const lateral = WRIST_CAM_LATERAL_M;
  return side === "right"
    ? { x: lateral, y: WRIST_CAM_HUD_UP_M, z: WRIST_CAM_HUD_PUSH_M }
    : { x: -lateral, y: WRIST_CAM_HUD_UP_M, z: WRIST_CAM_HUD_PUSH_M };
}

/**
 * World pose for a wrist camera: sit beside the controller HUD, pushed toward
 * the user, then offset along the user's right axis (left cam further left,
 * right cam further right). Quaternion is applied by the HUD lookAt + Y-180.
 */
export function wristCamHudPosition(side, wrist = {}, head = {}, headRight = null) {
  const wx = Number(wrist.x) || 0;
  const wy = Number(wrist.y) || 0;
  const wz = Number(wrist.z) || 0;
  const hx = Number(head.x) || 0;
  const hy = Number(head.y) || 0;
  const hz = Number(head.z) || 0;
  const tx = hx - wx;
  const ty = hy - wy;
  const tz = hz - wz;
  const dist = Math.hypot(tx, ty, tz) || 1;
  const off = wristCamLocalOffset(side);
  const pos = {
    x: wx + (tx / dist) * off.z,
    y: wy + (ty / dist) * off.z + off.y,
    z: wz + (tz / dist) * off.z,
  };
  let rx = Number(headRight?.x);
  let rz = Number(headRight?.z);
  if (!Number.isFinite(rx) || !Number.isFinite(rz) || (rx * rx + rz * rz) < 1e-8) {
    const fx = wx - hx;
    const fz = wz - hz;
    const fl = Math.hypot(fx, fz) || 1;
    rx = fz / fl;
    rz = -fx / fl;
  } else {
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
  }
  pos.x += rx * off.x;
  pos.z += rz * off.x;
  return pos;
}

export function clampHandCamSize(w, h) {
  const aspect = HAND_CAM_WRIST_SIZE.h / HAND_CAM_WRIST_SIZE.w;
  const nextW = Math.min(HAND_CAM_SIZE_MAX, Math.max(HAND_CAM_SIZE_MIN, Number(w) || HAND_CAM_WRIST_SIZE.w));
  const nextH = Math.min(HAND_CAM_SIZE_MAX * aspect, Math.max(HAND_CAM_SIZE_MIN * aspect, Number(h) || nextW * aspect));
  return { w: nextW, h: nextH };
}

export function restoreWristCamSize() {
  return { ...HAND_CAM_WRIST_SIZE };
}

export function resizeHandCamFromHandle(startSize, deltaMeters) {
  return clampHandCamSize(
    (startSize?.w || HAND_CAM_WRIST_SIZE.w) + (Number(deltaMeters) || 0),
    (startSize?.h || HAND_CAM_WRIST_SIZE.h) + (Number(deltaMeters) || 0) * (HAND_CAM_WRIST_SIZE.h / HAND_CAM_WRIST_SIZE.w),
  );
}

export function handCamCanGripMove({ mode, squeezed = false } = {}) {
  return mode === "detach" && squeezed === true;
}

export function paintHandCamFrame(ctx, box, { side = "left", image = null, host = "", live = false } = {}) {
  if (!ctx || !box) return;
  const { x, y, w, h } = box;
  ctx.fillStyle = "#040911";
  ctx.fillRect(x, y, w, h);
  if (image && image.complete && image.naturalWidth && typeof ctx.drawImage === "function") {
    ctx.drawImage(image, x + 2, y + 2, w - 4, h - 4);
  } else {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "700 22px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = side === "pov" ? "Head cam" : side === "right" ? "Right wrist cam" : "Left wrist cam";
    ctx.fillText(live ? `${label} · decoding` : `${label} · ${host || "set camera IP"}`, x + w / 2, y + h / 2);
  }
  ctx.strokeStyle = side === "pov" ? "#fbbf24" : side === "right" ? "#38bdf8" : "#86efac";
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}
