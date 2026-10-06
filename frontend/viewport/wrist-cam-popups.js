/**
 * Desktop floating wrist-camera tiles (PC Studio).
 * LAN JPEGs from 192.168.1.83:8001 via /api/robotics/hand-cam/{side}.jpg.
 * Wrist Cam / Viser Cameras never open FaceTime via getUserMedia.
 * No camera-list sidebar — only live video windows.
 */

import {
  SAM_CAMERA_HOST_DEFAULT,
  HAND_CAM_ENABLE_EVENT,
  HAND_CAM_PRESENTATIONS,
  HAND_CAM_PERMISSION_PATH,
  HAND_CAM_PUBLISH_PATH,
  HAND_CAM_STATUS_PATH,
  HAND_CAM_STUDIO_PORT,
  HAND_CAM_CAPTURE_APP_DEFAULT,
  activateWristCameras,
  cameraHostPort,
  cameraPermissionHelper,
  handCamJpegUrl,
  handCamLanJpegUrl,
  handCamMjpegUrl,
  normalizeCameraHostInput,
  requestHandCamPermission,
  resolveHandCamHost,
  overlayCameraTitle,
  persistCameraPermissionGranted,
  shouldShowHandCamAllow,
  maybeHotplugHandCamPublish,
  isHandCamUnplugged,
  noteHandCamSessionLive,
  normalizeHandCamReason,
  HAND_CAM_HOTPLUG_MS,
  resetHandCamPublishState,
} from "../xr/xr-hand-cams.js?v=roboticsworkspace3-camera-window1";

export { resetHandCamPublishState, persistCameraPermissionGranted };

export const WRIST_CAM_LAYOUT_KEY = "render3d:wristCamPopups:v3";
export const WRIST_CAM_MIN = { w: 180, h: 128 };
export const WRIST_CAM_DEFAULT = { w: 280, h: 188 };
export const WRIST_CAM_MAX = { w: 360, h: 240 };
export const WRIST_CAM_GAP = 12;
export const WRIST_CAM_PAD = 8;
export const WRIST_CAM_TOP = 52;
export const WRIST_CAM_GUI_INSET = 0;
export const WRIST_CAM_PARK_CACHE = "campark1";
export const WRIST_CAM_INERTIA = false;
export const WRIST_CAM_MOVE_CACHE = "camdrag1";
export const NO_STREAM_AVAILABLE = "No stream available";
export const CANT_FIND_CAMERA = "Can't find the camera";
export const NO_CAMERA_PLUGGED_IN = "No camera plugged in";
export const WRIST_CAM_POLL_MS = 90;
export const WRIST_CAM_CLOSE_CACHE = "camsx1";
export const WRIST_CAM_ALLOW_CACHE = "camcli2";
export const WRIST_CAM_PIN_CACHE = "campin1";
export const WRIST_CAM_LABEL_CACHE = "camlab1";
export const WRIST_CAM_HOTPLUG_CACHE = "camhot1";
export const WRIST_CAM_REINIT_CACHE = "camre1";
export const WRIST_CAM_SKIP_CACHE = "camskip1";
export const WRIST_CAM_HOLD_CACHE = "camsx2";
export const WRIST_CAM_TAB_CACHE = "camtab1";
export const WRIST_CAM_TOGGLE_SEL = '.ribbon-btn[data-id="cam_enable"], .ribbon-btn[data-id="cam_wrist"], .ribbon-btn--enable-cam, [data-wrist-cam-toggle], [data-viser-cam], [data-enable-cameras]';
export const WRIST_CAM_LIVE_MISS = 16;
export const WRIST_CAM_POSITION = "fixed";

export function applyWristCamToggleState(open, doc = typeof document !== "undefined" ? document : null, extra = null) {
  const on = !!open;
  const seen = new Set();
  const buttons = [];
  const add = (el) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    buttons.push(el);
  };
  try {
    const found = doc?.querySelectorAll?.(WRIST_CAM_TOGGLE_SEL);
    if (found) {
      for (let i = 0; i < found.length; i += 1) add(found[i]);
    }
  } catch {
    /* ignore */
  }
  add(extra);
  for (const btn of buttons) {
    btn.classList?.toggle?.("active", on);
    btn.classList?.toggle?.("ribbon-btn--active", on);
    btn.classList?.toggle?.("is-on", on);
    btn.setAttribute?.("aria-pressed", on ? "true" : "false");
  }
  return buttons;
}

export function wristCamShouldHoldLive({
  wasLive = false,
  ok = false,
  headerLive = true,
  misses = 0,
} = {}) {
  if (ok && headerLive) return false;
  if (!wasLive) return false;
  return Number(misses) < WRIST_CAM_LIVE_MISS;
}

export function wristCamFollowsViserLayout() {
  return false;
}

export function wristCamWindowBounds(win = globalThis, fallback = { width: 1200, height: 800 }, viewportEl = null) {
  void viewportEl;
  // Park against the window, not #viewport / Viser canvas. On the Viser tab
  // #viewport is visibility:hidden and the 3D grid is centered — using that
  // rect plus a GUI inset stacked LEFT/RIGHT in the middle of the scene.
  try {
    const ww = Number(win?.innerWidth) || 0;
    const wh = Number(win?.innerHeight) || 0;
    if (ww > 80 && wh > 80) {
      return { width: ww, height: wh, left: 0, top: 0, parkWidth: ww, parkHeight: wh };
    }
  } catch {
    /* ignore */
  }
  const width = Number(fallback.width) > 0 ? Number(fallback.width) : 1200;
  const height = Number(fallback.height) > 0 ? Number(fallback.height) : 800;
  return { width, height, left: 0, top: 0, parkWidth: width, parkHeight: height };
}

export function wristCamRightChromeInset(doc = null, bounds = {}) {
  void doc;
  void bounds;
  return 0;
}

export function wristCamDragReleased(event = {}, drag = null) {
  if (!drag) return false;
  if (event.pointerId != null && drag.id != null && event.pointerId !== drag.id) return false;
  const type = String(event.type || event.eventType || "");
  if (
    type === "pointerup"
    || type === "mouseup"
    || type === "touchend"
    || type === "touchcancel"
    || type === "pointercancel"
    || type === "lostpointercapture"
  ) return true;
  if (event.buttons === 0 && event.pointerType !== "touch" && event.pointerType !== "pen") return true;
  return false;
}

export function stopWristCamDragState(drag = null, win = globalThis) {
  if (!drag || typeof drag !== "object") return drag;
  drag.vx = 0;
  drag.vy = 0;
  drag.velocityX = 0;
  drag.velocityY = 0;
  if (drag.raf) {
    try { win?.cancelAnimationFrame?.(drag.raf); } catch { /* ignore */ }
    drag.raf = 0;
  }
  return drag;
}

const WRIST_LABEL_RE = /wrist|hand\s*cam|hand[-_ ]?cam|arducam|openarm|b0495|04b4:?4950|ov9782|ov9281/i;
const QUEST_HINT_RE = /quest|meta\s*quest|oculus/i;
const LEFT_RE = /\bleft\b|\bcam(?:era)?\s*0\b|\b0\s*[:.#-]\s*(?:left|wrist|hand)/i;
const RIGHT_RE = /\bright\b|\bcam(?:era)?\s*1\b|\b1\s*[:.#-]\s*(?:right|wrist|hand)/i;

function storageApi(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function videoInputDevices(devices = []) {
  return (devices || []).filter((d) => {
    const kind = String(d?.kind || "").toLowerCase();
    return kind === "videoinput" || kind === "video";
  });
}

export function isWristCamLabel(label = "") {
  const s = String(label || "");
  if (WRIST_LABEL_RE.test(s)) return true;
  if (QUEST_HINT_RE.test(s) && /wrist|hand|cam/i.test(s)) return true;
  return false;
}

export function wristCamLabelScore(label = "", side = "left") {
  const s = String(label || "");
  let score = 0;
  if (isWristCamLabel(s)) score += 12;
  else if (QUEST_HINT_RE.test(s)) score += 4;
  if (side === "left") {
    if (LEFT_RE.test(s)) score += 8;
    if (RIGHT_RE.test(s)) score -= 10;
  } else {
    if (RIGHT_RE.test(s)) score += 8;
    if (LEFT_RE.test(s)) score -= 10;
  }
  return score;
}

function deviceKey(device, index = 0) {
  return String(device?.deviceId || device?.label || `video-${index}`);
}

function pickBest(pool, side, taken) {
  const available = pool.filter((d, i) => !taken.has(deviceKey(d, i)));
  if (!available.length) return null;
  available.sort((a, b) => {
    const sa = wristCamLabelScore(a.label, side);
    const sb = wristCamLabelScore(b.label, side);
    if (sb !== sa) return sb - sa;
    return pool.indexOf(a) - pool.indexOf(b);
  });
  return available[0];
}

export function assignWristCamDevices(devices = []) {
  const videos = videoInputDevices(devices);
  const result = {
    left: null,
    right: null,
    fallback: false,
    notes: [],
  };
  if (!videos.length) {
    result.notes.push("No video inputs found.");
    return result;
  }

  const preferred = videos.filter((d) => isWristCamLabel(d.label));
  const taken = new Set();
  const pool = preferred.length ? preferred : videos;
  result.fallback = preferred.length === 0;

  for (const side of ["left", "right"]) {
    const pick = pickBest(pool, side, taken);
    if (!pick) continue;
    result[side] = pick;
    taken.add(deviceKey(pick, videos.indexOf(pick)));
  }

  for (const side of ["left", "right"]) {
    if (result[side]) continue;
    const pick = pickBest(videos, side, taken);
    if (!pick) continue;
    result[side] = pick;
    taken.add(deviceKey(pick, videos.indexOf(pick)));
    if (preferred.length) result.fallback = true;
  }

  if (preferred.length === 0 && videos.length) {
    result.notes.push("No wrist/hand/Arducam/OpenArm/B0495 labels — using first two video inputs as Left / Right.");
  }
  if (result.left) {
    result.notes.push(`Left: ${result.left.label || result.left.deviceId || "camera"}`);
  } else {
    result.notes.push("Left: not connected");
  }
  if (result.right) {
    result.notes.push(`Right: ${result.right.label || result.right.deviceId || "camera"}`);
  } else {
    result.notes.push("Right: not connected");
  }
  return result;
}

export function disconnectedCopy(side = "left", { reason = "" } = {}) {
  void side;
  if (reason === "permission") return CANT_FIND_CAMERA;
  if (reason === "unsupported") return CANT_FIND_CAMERA;
  if (reason === "busy") return CANT_FIND_CAMERA;
  if (reason === "lan" || reason === "missing") return CANT_FIND_CAMERA;
  return NO_STREAM_AVAILABLE;
}

/** Compact on-screen empty label. Debug details belong on the clipboard. */
export function emptyCameraLabel(reason = "lan") {
  const detail = normalizeHandCamReason(reason);
  if (isHandCamUnplugged({ reason: detail })) return NO_CAMERA_PLUGGED_IN;
  return CANT_FIND_CAMERA;
}

export function wristCamFailLog(side = "left", {
  host = "",
  url = "",
  status = "",
  publish = "",
  reason = "",
  notes = "",
} = {}) {
  const which = side === "right" ? "Right" : "Left";
  const parts = cameraHostPort(host || SAM_CAMERA_HOST_DEFAULT);
  const name = parts.host || SAM_CAMERA_HOST_DEFAULT;
  const feed = url || handCamLanJpegUrl(side, name);
  return [
    `${which} wrist cam`,
    CANT_FIND_CAMERA,
    `host ${name}`,
    `port ${parts.port}`,
    `jpeg ${feed}`,
    status !== "" && status != null ? `http ${status}` : "",
    reason ? normalizeHandCamReason(reason) : "",
    publish !== "" && publish != null ? `publish ${publish}` : "",
    notes,
  ].filter(Boolean).join("\n");
}

export function listCameraSources({ devices = [], includeThisDevice = false } = {}) {
  const wrist = [
    { id: "wrist-left", group: "wrist", kind: "lan", side: "left", label: "Left wrist", thisDevice: false },
    { id: "wrist-right", group: "wrist", kind: "lan", side: "right", label: "Right wrist", thisDevice: false },
  ];
  void devices;
  if (!includeThisDevice) return wrist;
  return wrist;
}

export function shouldUseGetUserMedia(source = null) {
  return source?.thisDevice === true || source?.kind === "local";
}

export async function copyWristCamLog(text, clip = globalThis.navigator?.clipboard) {
  const payload = String(text ?? "");
  if (!clip?.writeText) return false;
  await clip.writeText(payload);
  return true;
}

export function wristCamPairLayout(bounds = { width: 960, height: 640 }, { rightInset = 0 } = {}) {
  const parkW = Number(bounds.parkWidth) > 0 ? Number(bounds.parkWidth) : (Number(bounds.width) || 960);
  const originX = Number.isFinite(Number(bounds.left)) ? Number(bounds.left) : 0;
  const originY = Number.isFinite(Number(bounds.top)) ? Number(bounds.top) : 0;
  const inset = Math.max(0, Number(rightInset) || 0);
  const y = WRIST_CAM_TOP;
  const usableW = parkW - WRIST_CAM_PAD * 2 - inset;
  const sideBySide = usableW >= WRIST_CAM_MIN.w * 2 + WRIST_CAM_GAP;
  const w = Math.max(
    WRIST_CAM_MIN.w,
    Math.min(
      WRIST_CAM_DEFAULT.w,
      Math.floor(sideBySide ? (usableW - WRIST_CAM_GAP) / 2 : Math.max(WRIST_CAM_MIN.w, usableW)),
    ),
  );
  const h = WRIST_CAM_DEFAULT.h;
  const rightX = originX + parkW - WRIST_CAM_PAD - inset - w;
  const clampBox = {
    width: Number(bounds.width) > 0 ? Number(bounds.width) : originX + parkW,
    height: Number(bounds.height) > 0 ? Number(bounds.height) : originY + (Number(bounds.parkHeight) || h * 2),
  };
  const right = { x: rightX, y, w, h };
  const left = sideBySide
    ? { x: rightX - WRIST_CAM_GAP - w, y, w, h }
    : { x: rightX, y: y + h + WRIST_CAM_GAP, w, h };
  return {
    left: clampWristCamRect(left, clampBox),
    right: clampWristCamRect(right, clampBox),
    stacked: !sideBySide,
  };
}

export function defaultWristCamLayout(side = "left", bounds = { width: 960, height: 640 }, opts = {}) {
  const pair = wristCamPairLayout(bounds, opts);
  return side === "right" ? pair.right : pair.left;
}

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clampWristCamRect(rect, bounds = {}, min = WRIST_CAM_MIN) {
  const vw = Number(bounds.width) > 0 ? Number(bounds.width) : 1200;
  const vh = Number(bounds.height) > 0 ? Number(bounds.height) : 800;
  const maxW = Math.min(WRIST_CAM_MAX.w, Math.max(min.w, vw));
  const maxH = Math.min(WRIST_CAM_MAX.h, Math.max(min.h, vh));
  const w = Math.min(Math.max(finiteOr(rect?.w, WRIST_CAM_DEFAULT.w), min.w), maxW);
  const h = Math.min(Math.max(finiteOr(rect?.h, WRIST_CAM_DEFAULT.h), min.h), maxH);
  const maxX = Math.max(0, vw - w);
  const maxY = Math.max(0, vh - h);
  const x = Math.min(Math.max(finiteOr(rect?.x, 0), 0), maxX);
  const y = Math.min(Math.max(finiteOr(rect?.y, 0), 0), maxY);
  return { x, y, w, h };
}

export function readWristCamLayout(storage, bounds, opts = {}) {
  const pair = wristCamPairLayout(bounds, opts);
  const fallback = {
    left: pair.left,
    right: pair.right,
  };
  try {
    const raw = storageApi(storage)?.getItem(WRIST_CAM_LAYOUT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      left: clampWristCamRect(parsed?.left || fallback.left, bounds),
      right: clampWristCamRect(parsed?.right || fallback.right, bounds),
    };
  } catch {
    return fallback;
  }
}

export function persistWristCamLayout(layout, storage, bounds = wristCamWindowBounds()) {
  const next = {
    left: clampWristCamRect(layout?.left, bounds),
    right: clampWristCamRect(layout?.right, bounds),
  };
  try {
    storageApi(storage)?.setItem(WRIST_CAM_LAYOUT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}

function stopStream(stream) {
  try {
    for (const track of stream?.getTracks?.() || []) track.stop();
  } catch {
    /* ignore */
  }
}

function el(doc, tag, attrs = {}) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (typeof value === "boolean") node[key] = value;
    else node.setAttribute(key, value);
  }
  return node;
}

function applyOverlayTitle(panel, side) {
  const title = overlayCameraTitle(side);
  const strong = panel?.querySelector?.("[data-wrist-title]");
  if (strong) strong.textContent = title;
  if (panel) {
    panel.setAttribute("aria-label", `${title} wrist camera`);
  }
}

function applyRect(node, rect, zIndex = "") {
  node.style.position = WRIST_CAM_POSITION;
  node.style.left = `${rect.x}px`;
  node.style.top = `${rect.y}px`;
  node.style.right = "auto";
  node.style.bottom = "auto";
  node.style.margin = "0";
  node.style.transform = "none";
  node.style.width = `${rect.w}px`;
  node.style.height = `${rect.h}px`;
  if (zIndex !== "" && zIndex != null) node.style.zIndex = String(zIndex);
}

function viewportBounds(viewportEl, win = globalThis) {
  return wristCamWindowBounds(win, undefined, viewportEl);
}

function setCopyVisible(panel, on) {
  const copy = panel?.querySelector?.("[data-wrist-copy]");
  if (!copy) return;
  copy.classList.toggle("hidden", !on);
  copy.hidden = !on;
  copy.setAttribute("aria-hidden", on ? "false" : "true");
}

function setAllowVisible(panel, on, { app = "", helper = "" } = {}) {
  const wrap = panel?.querySelector?.("[data-wrist-allow-wrap]");
  const btn = panel?.querySelector?.("[data-wrist-allow]");
  const hint = panel?.querySelector?.("[data-wrist-allow-hint]");
  const name = String(app || HAND_CAM_CAPTURE_APP_DEFAULT).trim() || HAND_CAM_CAPTURE_APP_DEFAULT;
  if (hint) hint.textContent = helper || cameraPermissionHelper(name);
  if (btn) {
    btn.hidden = !on;
    btn.classList.toggle("hidden", !on);
    btn.setAttribute("title", `Allow for ${name}`);
    btn.setAttribute("aria-label", `Allow camera for ${name}`);
  }
  if (!wrap) return;
  wrap.classList.toggle("hidden", !on);
  wrap.hidden = !on;
  wrap.setAttribute("aria-hidden", on ? "false" : "true");
}

function setLive(panel, device) {
  const empty = panel.querySelector("[data-wrist-empty]");
  const video = panel.querySelector("video");
  const img = panel.querySelector("[data-wrist-lan]");
  const meta = panel.querySelector("[data-wrist-meta]");
  empty?.classList.add("hidden");
  const useLan = !!device?.lan;
  video?.classList.toggle("hidden", useLan);
  img?.classList.toggle("hidden", !useLan);
  if (useLan) img?.setAttribute("data-wrist-live", "1");
  else video?.setAttribute("data-wrist-live", "1");
  if (meta) meta.textContent = device?.label || "connected";
  panel.classList.remove("is-empty");
  panel.classList.add("is-live");
  panel.setAttribute("data-wrist-status", "connected");
  panel.removeAttribute("data-wrist-log");
  setCopyVisible(panel, false);
  setAllowVisible(panel, false);
  persistCameraPermissionGranted(true);
  noteHandCamSessionLive(true);
}

export function createWristCamPopups({
  viewport = null,
  buttonEl = null,
  mediaDevices = null,
  storage = null,
  document: doc = typeof document !== "undefined" ? document : null,
  getCameraHost = null,
  fetchFn = null,
} = {}) {
  const hostDoc = doc;
  let host = null;
  let open = false;
  let zCursor = 12050;
  const streams = { left: null, right: null };
  const panels = { left: null, right: null };
  const dismissed = { left: false, right: false };
  const lanUrls = { left: "", right: "" };
  const liveMiss = { left: 0, right: 0 };
  const mjpegOn = { left: false, right: false };
  const retryAt = { left: 0, right: 0 };
  const polling = { left: false, right: false };
  const tabs = { left: null, right: null };
  let pollTimer = 0;
  let hotplugTimer = 0;
  let layout = readWristCamLayout(
    storage,
    viewport ? viewportBounds(viewport, hostDoc?.defaultView || globalThis) : undefined,
    { rightInset: wristCamRightChromeInset(hostDoc) },
  );
  let assignNote = "";
  let lastStatus = {};
  const stopDrags = [];

  function eventWin() {
    return hostDoc?.defaultView || globalThis;
  }

  function parkBounds() {
    return viewportBounds(viewport, eventWin());
  }

  function cameraHost() {
    try {
      return normalizeCameraHostInput(getCameraHost?.() || resolveHandCamHost() || SAM_CAMERA_HOST_DEFAULT, {
        samDefault: true,
      }) || SAM_CAMERA_HOST_DEFAULT;
    } catch {
      return normalizeCameraHostInput(resolveHandCamHost() || SAM_CAMERA_HOST_DEFAULT, { samDefault: true })
        || SAM_CAMERA_HOST_DEFAULT;
    }
  }

  function setEmpty(panel, side, reason = "lan", extra = {}) {
    if (!panel) return;
    const empty = panel.querySelector("[data-wrist-empty]");
    const video = panel.querySelector("video");
    const img = panel.querySelector("[data-wrist-lan]");
    const meta = panel.querySelector("[data-wrist-meta]");
    if (video) {
      video.classList.add("hidden");
      video.removeAttribute("data-wrist-live");
    }
    if (img) {
      img.classList.add("hidden");
      img.removeAttribute("data-wrist-live");
    }
    const hostVal = cameraHost();
    const feed = handCamLanJpegUrl(side, hostVal);
    const detail = extra.reason || reason;
    const log = wristCamFailLog(side, {
      host: hostVal,
      url: extra.url || feed,
      status: extra.status,
      publish: extra.publish,
      reason: extra.reason,
      notes: extra.notes || assignNote,
    });
    if (empty) {
      const msg = empty.querySelector?.("[data-wrist-empty-msg]") || empty;
      const label = emptyCameraLabel(detail || "lan");
      if (msg === empty) empty.textContent = label;
      else msg.textContent = label;
      empty.classList.remove("hidden");
    }
    if (meta) meta.textContent = "no stream";
    panel.classList.add("is-empty");
    panel.classList.remove("is-live");
    panel.setAttribute("data-wrist-status", "no-stream");
    panel.setAttribute("data-wrist-log", log);
    setCopyVisible(panel, true);
    const devices = extra.devices || lastStatus.devices;
    const wristCount = extra.wristCount != null ? extra.wristCount : lastStatus.wristCount;
    setAllowVisible(panel, shouldShowHandCamAllow({
      live: false,
      reason: extra.reason,
      wristCount,
      devices,
    }));
  }

  function fetcher() {
    return fetchFn || globalThis.fetch?.bind(globalThis) || null;
  }

  function media() {
    if (mediaDevices) return mediaDevices;
    try {
      return navigator?.mediaDevices || null;
    } catch {
      return null;
    }
  }

  function syncButton() {
    applyWristCamToggleState(open, hostDoc, buttonEl);
  }

  function saveLayout() {
    layout = persistWristCamLayout(layout, storage, parkBounds());
  }

  function stopSide(side) {
    stopStream(streams[side]);
    streams[side] = null;
    const video = panels[side]?.querySelector("video");
    if (video) {
      try { video.srcObject = null; } catch { /* ignore */ }
    }
  }

  function destroy() {
    for (const stop of stopDrags) {
      try { stop(); } catch { /* ignore */ }
    }
    tabs.left?.remove?.();
    tabs.right?.remove?.();
    tabs.left = tabs.right = null;
    stopPoll();
    stopHotplug();
    stopSide("left");
    stopSide("right");
    dismissed.left = true;
    dismissed.right = true;
    host?.remove?.();
    host = null;
    panels.left = null;
    panels.right = null;
    open = false;
    syncButton();
  }

  function stopPoll() {
    if (pollTimer) {
      try { globalThis.clearInterval?.(pollTimer); } catch { /* ignore */ }
      pollTimer = 0;
    }
  }

  function stopHotplug() {
    if (hotplugTimer) {
      try { globalThis.clearInterval?.(hotplugTimer); } catch { /* ignore */ }
      hotplugTimer = 0;
    }
  }

  async function pollHotplug() {
    if (!open) return;
    const doFetch = fetcher();
    if (!doFetch) return;
    try {
      const res = await doFetch(HAND_CAM_STATUS_PATH, { cache: "no-store" });
      const data = await res?.json?.().catch?.(() => ({})) || {};
      lastStatus = data;
      const wristCount = Number(data.wristCount);
      const count = Number.isFinite(wristCount)
        ? wristCount
        : (data.devices || []).filter((d) => d && !d.skipped).length;
      await maybeHotplugHandCamPublish({ status: data, fetchFn: doFetch });
      for (const side of ["left", "right"]) {
        const panel = panels[side];
        if (!panel) continue;
        const live = panel.classList?.contains?.("is-live");
        const reason = side === "right" ? data.rightReason : data.leftReason;
        if (!live) {
          const msg = panel.querySelector?.("[data-wrist-empty-msg]");
          if (msg) msg.textContent = emptyCameraLabel(reason || "lan");
          const log = panel.getAttribute("data-wrist-log") || "";
          if (reason && log) {
            panel.setAttribute("data-wrist-log", wristCamFailLog(side, {
              host: cameraHost(),
              url: lanUrls[side] || handCamLanJpegUrl(side, cameraHost()),
              reason,
              notes: assignNote,
            }));
          }
        }
        setAllowVisible(panel, shouldShowHandCamAllow({
          live,
          reason,
          wristCount: count,
          devices: data.devices,
        }), {
          app: data.captureApp || HAND_CAM_CAPTURE_APP_DEFAULT,
          helper: data.helper,
        });
      }
    } catch {
      /* status miss must not spawn TCC */
    }
  }

  function hideSide(side, { destroyIfNone = true } = {}) {
    dismissed[side] = true;
    tabs[side]?.remove?.();
    tabs[side] = null;
    stopSide(side);
    mjpegOn[side] = false;
    const img = panels[side]?.querySelector("[data-wrist-lan]");
    const blob = img?.getAttribute?.("data-wrist-blob") || "";
    if (blob) {
      try { URL.revokeObjectURL(blob); } catch { /* ignore */ }
    }
    panels[side]?.remove?.();
    panels[side] = null;
    if (destroyIfNone && !panels.left && !panels.right) destroy();
  }

  function ensurePanel(side) {
    if (dismissed[side]) return null;
    if (panels[side]) return panels[side];
    if (!host || !hostDoc) return null;
    const panel = buildPanel(side);
    panels[side] = panel;
    host.appendChild(panel);
    applyRect(panel, layout[side], zCursor);
    setEmpty(panel, side, "lan", {
      reason: side === "right" ? lastStatus.rightReason : lastStatus.leftReason,
      devices: lastStatus.devices,
      wristCount: lastStatus.wristCount,
    });
    return panel;
  }

  function attachMjpeg(side) {
    if (dismissed[side] || !open) return;
    const panel = ensurePanel(side);
    const img = panel?.querySelector?.("[data-wrist-lan]");
    if (!img) return;
    const hostVal = cameraHost();
    const url = handCamMjpegUrl(side, hostVal);
    lanUrls[side] = url;
    // A pending multipart request owns this image too: load may not fire
    // until the stream ends. Never replace its src on every JPEG poll.
    if (img.getAttribute("data-wrist-mjpeg") === "1" || Date.now() < retryAt[side]) return;
    img.onload = () => {
      if (dismissed[side] || !open || img.getAttribute("data-wrist-mjpeg") !== "1") return;
      const w = Number(img.naturalWidth) || 0;
      if (w < 8) return;
      mjpegOn[side] = true;
      liveMiss[side] = 0;
      setLive(panel, { lan: true, label: `${cameraHostPort(hostVal).host || SAM_CAMERA_HOST_DEFAULT}:${HAND_CAM_STUDIO_PORT} · live` });
    };
    img.onerror = () => {
      mjpegOn[side] = false;
      retryAt[side] = Date.now() + 5000;
      img.removeAttribute("data-wrist-mjpeg");
    };
    img.setAttribute("data-wrist-mjpeg", "1");
    img.src = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  }

  async function pollLanSide(side) {
    if (polling[side]) return false;
    polling[side] = true;
    try { return await fetchLanSide(side); }
    finally { polling[side] = false; }
  }

  async function fetchLanSide(side) {
    if (dismissed[side] || !open) return false;
    const hostVal = cameraHost();
    if (mjpegOn[side]) return true;
    const url = handCamJpegUrl(side, hostVal);
    lanUrls[side] = url;
    const doFetch = fetcher();
    if (!doFetch || !url) {
      if (dismissed[side] || !open) return false;
      setEmpty(ensurePanel(side), side, "lan");
      return false;
    }
    try {
      const res = await doFetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
      if (dismissed[side] || !open) return false;
      const liveHeader = res?.headers?.get?.("X-Hand-Cam-Live") || res?.headers?.get?.("x-hand-cam-live");
      const headerLive = liveHeader == null || liveHeader === "" ? !!res?.ok : liveHeader === "1";
      const existing = panels[side] || null;
      const wasLive = !!existing?.classList?.contains?.("is-live");
      if (!res?.ok || !headerLive) {
        liveMiss[side] += 1;
        if (wristCamShouldHoldLive({ wasLive, ok: !!res?.ok, headerLive, misses: liveMiss[side] })) {
          return true;
        }
        const headerReason = res?.headers?.get?.("X-Hand-Cam-Reason") || res?.headers?.get?.("x-hand-cam-reason") || "";
        const sideReason = side === "right" ? lastStatus.rightReason : lastStatus.leftReason;
        setEmpty(ensurePanel(side), side, "lan", {
          status: res?.status ?? "error",
          url: handCamLanJpegUrl(side, hostVal),
          reason: headerReason || sideReason,
          devices: lastStatus.devices,
          wristCount: lastStatus.wristCount,
        });
        return false;
      }
      liveMiss[side] = 0;
      const blob = await res.blob();
      if (dismissed[side] || !open) return false;
      if (!blob || blob.size < 80) {
        liveMiss[side] += 1;
        if (wristCamShouldHoldLive({ wasLive, ok: true, headerLive: false, misses: liveMiss[side] })) {
          return true;
        }
        setEmpty(ensurePanel(side), side, "lan");
        return false;
      }
      const panel = ensurePanel(side);
      if (!panel) return false;
      const img = panel.querySelector("[data-wrist-lan]");
      if (img && img.getAttribute("data-wrist-mjpeg") !== "1") {
        const prev = img.getAttribute("data-wrist-blob") || "";
        const next = URL.createObjectURL(blob);
        img.src = next;
        img.setAttribute("data-wrist-blob", next);
        if (prev) {
          try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
        }
      }
      setLive(panel, { lan: true, label: `${cameraHostPort(hostVal).host || SAM_CAMERA_HOST_DEFAULT}:${HAND_CAM_STUDIO_PORT} · connected` });
      attachMjpeg(side);
      return true;
    } catch {
      if (dismissed[side] || !open) return false;
      liveMiss[side] += 1;
      const existing = panels[side] || null;
      const wasLive = !!existing?.classList?.contains?.("is-live");
      if (wristCamShouldHoldLive({ wasLive, ok: false, headerLive: false, misses: liveMiss[side] })) {
        return true;
      }
      setEmpty(ensurePanel(side), side, "lan");
      return false;
    }
  }

  function clampAll() {
    const bounds = parkBounds();
    layout.left = clampWristCamRect(layout.left, bounds);
    layout.right = clampWristCamRect(layout.right, bounds);
    if (panels.left) applyRect(panels.left, layout.left);
    if (panels.right) applyRect(panels.right, layout.right);
  }

  function bindMoveResize(panel, side) {
    const title = panel.querySelector("[data-wrist-titlebar]");
    const handle = panel.querySelector("[data-wrist-resize]");
    const win = eventWin();
    const moveOpts = { capture: true };
    const upOpts = { capture: true };
    let drag = null;

    function unbindWin() {
      try {
        win.removeEventListener?.("pointermove", onMove, moveOpts);
        win.removeEventListener?.("pointerup", onUp, upOpts);
        win.removeEventListener?.("pointercancel", onUp, upOpts);
        win.removeEventListener?.("lostpointercapture", onUp, upOpts);
        win.removeEventListener?.("mouseup", onUp, upOpts);
        win.removeEventListener?.("touchend", onUp, upOpts);
        win.removeEventListener?.("touchcancel", onUp, upOpts);
      } catch {
        /* ignore */
      }
    }

    function finishDrag() {
      if (!drag) return;
      const session = drag;
      drag = null;
      stopWristCamDragState(session, win);
      try { session.target?.releasePointerCapture?.(session.id); } catch { /* ignore */ }
      panel.classList.remove("is-dragging");
      unbindWin();
      saveLayout();
    }

    function onMove(e) {
      if (!drag) return;
      if (e.pointerId != null && e.pointerId !== drag.id) return;
      if (wristCamDragReleased(e, drag)) {
        finishDrag();
        return;
      }
      e.preventDefault?.();
      const bounds = parkBounds();
      if (drag.kind === "move") {
        layout[side] = clampWristCamRect({
          ...layout[side],
          x: drag.x + (e.clientX - drag.sx),
          y: drag.y + (e.clientY - drag.sy),
        }, bounds);
      } else {
        layout[side] = clampWristCamRect({
          ...layout[side],
          w: drag.w + (e.clientX - drag.sx),
          h: drag.h + (e.clientY - drag.sy),
        }, bounds);
      }
      applyRect(panel, layout[side]);
    }

    function onUp(e) {
      if (!drag) return;
      if (e.pointerId != null && e.pointerId !== drag.id) return;
      finishDrag();
    }

    function chromeHit(e) {
      const t = e?.target;
      if (!t) return false;
      if (typeof t.closest === "function") {
        return !!t.closest("[data-wrist-close], [data-wrist-copy], [data-wrist-allow], [data-wrist-minimize], .wrist-cam-popup-close, .wrist-cam-popup-copy, .wrist-cam-popup-allow");
      }
      let n = t;
      while (n) {
        if (n.getAttribute?.("data-wrist-close") != null || n.getAttribute?.("data-wrist-copy") != null || n.getAttribute?.("data-wrist-allow") != null) return true;
        n = n.parentNode;
      }
      return false;
    }

    function start(kind, e) {
      if (e.button != null && e.button !== 0) return;
      if (chromeHit(e)) return;
      e.preventDefault?.();
      e.stopPropagation?.();
      finishDrag();
      zCursor += 1;
      panel.style.zIndex = String(zCursor);
      drag = {
        kind,
        id: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        x: layout[side].x,
        y: layout[side].y,
        w: layout[side].w,
        h: layout[side].h,
        target: e.currentTarget,
        vx: 0,
        vy: 0,
        raf: 0,
      };
      panel.classList.add("is-dragging");
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      try {
        win.addEventListener?.("pointermove", onMove, moveOpts);
        win.addEventListener?.("pointerup", onUp, upOpts);
        win.addEventListener?.("pointercancel", onUp, upOpts);
        win.addEventListener?.("lostpointercapture", onUp, upOpts);
        win.addEventListener?.("mouseup", onUp, upOpts);
        win.addEventListener?.("touchend", onUp, upOpts);
        win.addEventListener?.("touchcancel", onUp, upOpts);
      } catch {
        /* ignore */
      }
    }

    title?.addEventListener("pointerdown", (e) => start("move", e));
    title?.addEventListener("pointerup", onUp);
    title?.addEventListener("pointercancel", onUp);
    title?.addEventListener("lostpointercapture", onUp);
    handle?.addEventListener("pointerdown", (e) => start("resize", e));
    handle?.addEventListener("pointerup", onUp);
    handle?.addEventListener("pointercancel", onUp);
    handle?.addEventListener("lostpointercapture", onUp);

    panel.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      zCursor += 1;
      panel.style.zIndex = String(zCursor);
    });

    stopDrags.push(finishDrag);
  }

  function buildPanel(side) {
    const label = side === "right" ? "Right" : "Left";
    const panel = el(hostDoc, "div", {
      className: `wrist-cam-popup wrist-cam-popup--${side} is-empty`,
      "data-wrist-side": side,
      role: "dialog",
      "aria-label": `${label} wrist camera`,
    });
    const title = el(hostDoc, "div", {
      className: "wrist-cam-popup-titlebar",
      "data-wrist-titlebar": "1",
      role: "button",
      "aria-label": `Move ${label} wrist camera`,
    });
    const names = el(hostDoc, "div", { className: "wrist-cam-popup-titles" });
    names.appendChild(el(hostDoc, "strong", { "data-wrist-title": "1", text: overlayCameraTitle(side) }));
    names.appendChild(el(hostDoc, "span", { className: "wrist-cam-popup-meta", "data-wrist-meta": "1", text: "connecting" }));
    const copy = el(hostDoc, "button", {
      type: "button",
      className: "wrist-cam-popup-copy hidden",
      "data-wrist-copy": side,
      hidden: true,
      title: "Copy camera debug log",
      "aria-label": `Copy ${label} camera debug log`,
      "aria-hidden": "true",
      text: "Copy",
    });
    const close = el(hostDoc, "button", {
      type: "button",
      className: "wrist-cam-popup-close",
      "data-wrist-close": side,
      "aria-label": `Close ${label} wrist camera`,
      text: "✕",
    });
    title.appendChild(names);
    title.appendChild(copy);
    const minimize = el(hostDoc, "button", {
      type: "button", className: "wrist-cam-popup-close",
      "data-wrist-minimize": side, "aria-label": `Minimize ${label} wrist camera`,
      title: "Minimize to Viser", text: "−",
    });
    minimize.addEventListener("pointerdown", (e) => e.stopPropagation());
    minimize.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (tabs[side]) return;
      saveLayout();
      // Keep the media node mounted and its request alive while tucked away.
      panel.style.visibility = "hidden";
      panel.style.pointerEvents = "none";
      const tab = el(hostDoc, "button", {
        type: "button", className: `wrist-cam-restore wrist-cam-restore--${side}`,
        "data-wrist-restore": side, text: `${label} camera ↗`,
        "aria-label": `Restore ${label} wrist camera`,
      });
      tabs[side] = tab;
      const dock = hostDoc.querySelector?.("#viser-viewer .viser-stage") || viewport || host;
      dock.appendChild(tab);
      tab.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        tab.remove(); tabs[side] = null;
        layout[side] = clampWristCamRect(layout[side], parkBounds());
        applyRect(panel, layout[side], ++zCursor);
        panel.style.visibility = "visible";
        panel.style.pointerEvents = "auto";
        minimize.focus?.();
      });
      tab.focus?.();
    });
    title.appendChild(minimize);
    title.appendChild(close);
    copy.addEventListener("pointerdown", (e) => {
      e.stopPropagation?.();
    });
    copy.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const log = panel.getAttribute("data-wrist-log") || wristCamFailLog(side, {
        host: cameraHost(),
        url: lanUrls[side] || handCamLanJpegUrl(side, cameraHost()),
        notes: assignNote,
      });
      const ok = await copyWristCamLog(log);
      copy.textContent = ok ? "Copied" : "Copy failed";
      globalThis.setTimeout?.(() => { copy.textContent = "Copy"; }, 1400);
    });
    const body = el(hostDoc, "div", { className: "wrist-cam-popup-body" });
    const video = el(hostDoc, "video", {
      className: "wrist-cam-popup-video hidden",
      autoplay: true,
      muted: true,
      playsInline: true,
    });
    video.setAttribute("playsinline", "");
    video.muted = true;
    const img = el(hostDoc, "img", {
      className: "wrist-cam-popup-video hidden",
      "data-wrist-lan": "1",
      alt: `${label} LAN camera`,
    });
    const empty = el(hostDoc, "div", {
      className: "wrist-cam-popup-empty hidden",
      "data-wrist-empty": "1",
    });
    empty.appendChild(el(hostDoc, "p", {
      className: "wrist-cam-popup-empty-msg",
      "data-wrist-empty-msg": "1",
      text: "",
    }));
    const allowWrap = el(hostDoc, "div", {
      className: "wrist-cam-popup-allow-wrap hidden",
      "data-wrist-allow-wrap": "1",
      hidden: true,
      "aria-hidden": "true",
    });
    const allow = el(hostDoc, "button", {
      type: "button",
      className: "wrist-cam-popup-allow",
      "data-wrist-allow": side,
      hidden: true,
      title: `Allow for ${HAND_CAM_CAPTURE_APP_DEFAULT}`,
      "aria-label": `Allow camera for ${HAND_CAM_CAPTURE_APP_DEFAULT}`,
      text: "Allow camera",
    });
    const hint = el(hostDoc, "p", {
      className: "wrist-cam-popup-allow-hint",
      "data-wrist-allow-hint": "1",
      text: cameraPermissionHelper(HAND_CAM_CAPTURE_APP_DEFAULT),
    });
    allowWrap.appendChild(allow);
    allowWrap.appendChild(hint);
    empty.appendChild(allowWrap);
    body.appendChild(video);
    body.appendChild(img);
    body.appendChild(empty);
    allow.addEventListener("pointerdown", (e) => {
      e.stopPropagation?.();
    });
    allow.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (allow.disabled) return;
      allow.disabled = true;
      allow.textContent = "Allowing…";
      setAllowVisible(panel, true, { helper: cameraPermissionHelper() });
      try {
        const asked = await requestHandCamPermission({ fetchFn: fetcher() });
        persistCameraPermissionGranted(true);
        const app = asked?.app || HAND_CAM_CAPTURE_APP_DEFAULT;
        const helper = asked?.helper || asked?.reason || cameraPermissionHelper(app);
        if (asked?.cli) {
          assignNote = [assignNote, `cli ${asked.cli}`].filter(Boolean).join("\n");
        }
        const stillEmpty = panel.classList.contains("is-empty");
        setAllowVisible(panel, shouldShowHandCamAllow({
          live: !stillEmpty,
          reason: asked?.reason,
        }), { app, helper });
        await activateWristCameras({
          host: cameraHost(),
          fetchFn: fetcher(),
        });
        await pollLanSide("left");
        await pollLanSide("right");
      } catch {
        setAllowVisible(panel, true, { helper: cameraPermissionHelper() });
      } finally {
        allow.disabled = false;
        allow.textContent = "Allow camera";
      }
    });
    const handle = el(hostDoc, "button", {
      type: "button",
      className: "wrist-cam-popup-resize",
      "data-wrist-resize": "1",
      title: "Resize",
      "aria-label": `Resize ${label} wrist camera`,
    });
    panel.appendChild(title);
    panel.appendChild(body);
    panel.appendChild(handle);
    function onClose(e) {
      e.preventDefault?.();
      e.stopPropagation?.();
      try { e.stopImmediatePropagation?.(); } catch { /* ignore */ }
      hideSide(side);
    }
    close.addEventListener("pointerdown", onClose);
    close.addEventListener("pointerup", (e) => {
      e.preventDefault?.();
      e.stopPropagation?.();
    });
    close.addEventListener("click", onClose);
    bindMoveResize(panel, side);
    applyRect(panel, layout[side], zCursor);
    return panel;
  }

  async function connectCameras() {
    let published = {};
    try {
      published = await activateWristCameras({
        host: cameraHost(),
        fetchFn: fetcher(),
        restart: false,
      }) || {};
    } catch {
      /* publish 404/401 must not skip the floating windows */
    }
    lastStatus = published;
    ensurePanel("left");
    ensurePanel("right");
    attachMjpeg("left");
    attachMjpeg("right");
    const leftLan = await pollLanSide("left");
    const rightLan = await pollLanSide("right");
    try {
      const doFetch = fetcher();
      const res = doFetch ? await doFetch(HAND_CAM_STATUS_PATH, { cache: "no-store" }) : null;
      const data = await res?.json?.().catch?.(() => ({})) || {};
      lastStatus = { ...lastStatus, ...data };
      const app = data.captureApp || HAND_CAM_CAPTURE_APP_DEFAULT;
      const wristCount = Number(data.wristCount);
      const count = Number.isFinite(wristCount)
        ? wristCount
        : (data.devices || []).filter((d) => d && !d.skipped).length;
      await maybeHotplugHandCamPublish({ status: data, fetchFn: doFetch });
      for (const side of ["left", "right"]) {
        const panel = panels[side];
        if (!panel) continue;
        const live = panel.classList?.contains?.("is-live");
        const reason = side === "right" ? data.rightReason : data.leftReason;
        if (!live) {
          const msg = panel.querySelector?.("[data-wrist-empty-msg]");
          if (msg) msg.textContent = emptyCameraLabel(reason || "lan");
        }
        setAllowVisible(panel, shouldShowHandCamAllow({
          live,
          reason,
          wristCount: count,
          devices: data.devices,
        }), { app, helper: data.helper });
      }
    } catch {
      /* helper stays on Python.app */
    }
    stopPoll();
    stopHotplug();
    pollTimer = globalThis.setInterval?.(() => {
      void pollLanSide("left");
      void pollLanSide("right");
    }, WRIST_CAM_POLL_MS) || 0;
    hotplugTimer = globalThis.setInterval?.(() => {
      void pollHotplug();
    }, HAND_CAM_HOTPLUG_MS) || 0;
    assignNote = [
      `LAN ${cameraHost()}:${HAND_CAM_STUDIO_PORT}`,
      `POST ${HAND_CAM_PUBLISH_PATH}`,
      `left ${leftLan ? "connected" : "no stream"}`,
      `right ${rightLan ? "connected" : "no stream"}`,
      handCamLanJpegUrl("left", cameraHost()),
      handCamLanJpegUrl("right", cameraHost()),
    ].join(" · ");
  }

  function mount() {
    if (!hostDoc) return false;
    if (!viewport && !hostDoc.body) return false;
    const bounds = parkBounds();
    layout = readWristCamLayout(storage, bounds, { rightInset: wristCamRightChromeInset(hostDoc, bounds) });
    layout.left = clampWristCamRect(layout.left, bounds);
    layout.right = clampWristCamRect(layout.right, bounds);
    host = el(hostDoc, "div", {
      id: "wrist-cam-popups",
      className: "wrist-cam-popups",
      "aria-label": "Wrist cameras",
    });
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "22150";
    host.style.pointerEvents = "none";
    host.style.overflow = "visible";
    host.style.transform = "none";
    const mountEl = hostDoc.body || hostDoc.documentElement || viewport;
    mountEl?.appendChild?.(host);
    open = true;
    syncButton();
    return true;
  }

  let showing = null;
  async function show() {
    if (showing) return showing;
    showing = (async () => {
      dismissed.left = false;
      dismissed.right = false;
      const attached = !!(host && (host.isConnected !== false) && (host.parentNode || host.parentElement));
      if (!open || !host || !attached) {
        if (host && !attached) {
          try { host.remove?.(); } catch { /* ignore */ }
          host = null;
        }
        if (!mount()) return false;
      }
      ensurePanel("left");
      ensurePanel("right");
      await connectCameras();
      return true;
    })();
    try {
      return await showing;
    } finally {
      showing = null;
    }
  }

  function onEnableTrigger(event) {
    if (event?.detail?.presentation === HAND_CAM_PRESENTATIONS.unified) return;
    void show();
  }
  function onPrefsRefresh(ev) {
    if (!open) return;
    const next = normalizeCameraHostInput(ev?.detail?.cameraHost || "");
    if (next && next !== cameraHost()) {
      void connectCameras();
      return;
    }
    applyOverlayTitle(panels.left, "left");
    applyOverlayTitle(panels.right, "right");
    // Permission/live updates emit this event too. The regular poll owns
    // frames; polling here creates a left/right promise feedback loop.
  }
  try {
    globalThis.addEventListener?.(HAND_CAM_ENABLE_EVENT, onEnableTrigger);
    globalThis.addEventListener?.("render3d:robotics-prefs", onPrefsRefresh);
  } catch {
    /* ignore */
  }

  function hide() {
    destroy();
  }

  async function toggle() {
    if (open) {
      hide();
      return false;
    }
    await show();
    return open;
  }

  buttonEl?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void toggle();
  });

  return {
    show,
    hide,
    toggle,
    isOpen: () => open,
    getAssignmentNote: () => assignNote,
    getLayout: () => ({ left: { ...layout.left }, right: { ...layout.right } }),
    getStatus: () => ({
      left: panels.left?.getAttribute?.("data-wrist-status") || "no-stream",
      right: panels.right?.getAttribute?.("data-wrist-status") || "no-stream",
    }),
  };
}
