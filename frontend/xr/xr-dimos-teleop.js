import { runGuardedHome } from './xr-teleop-home.js?v=20260927-home1&vrrobot=20260927-2';
import { createTeleopHeadingFrame } from './xr-teleop-heading.js?v=20260927-heading1&vrrobot=20260927-2';
import { createPiUiInput, piServerUiAction } from './xr-pi-ui-input.js?v=20260929-ab-recorder2';
import { openPiTeleopWebSocketRelay, requestPiTeleop, mergePiTeleopStatus, createPiRecordPulse } from './pi-teleop-client.js?v=20260927-teleop-auth2&devicesession=20260927-1&vrrobot=20260927-2&recordfeedback=20260927-1';
import { createProfileYControl, profileUsesYCommands, profileYMap, preferredRoboticsSources } from "./xr-robotics-profile-controls.js?v=profilecontrols1-picontrols1-pitriggerviser2-20260916-yreset1-teleophud1&robotemote=20260916-1&astra=20260916-5&teleopfix=20260916-1&yhold2s=1";
import { createRoboticsTriggerOwnership } from "./xr-robotics-input.js?v=roboticsworkspace3&teleopfix=20260916-1&inputfix=20260916-1";
import { readRoboticsProfile, roboticsOwnsExternalSession, roboticsLaunchUrl, roboticsIntegratedProfile, roboticsControllerUrl } from "./robotics-profile.js?v=roboticsworkspace3&dimos-viser-local1";
import { createTeleopStop } from './xr-teleop-stop.js?v=20260916-inputfix1';
/**
 * DIMOS Quest teleop from Studio. Default OFF — never auto-connects.
 * Reuses the live WebXR session (no requestSession, no :8443 iframe).
 * Integrated Quest profiles use Studio's authenticated same-origin Pi relay so
 * the headset never has to trust the Pi's self-signed certificate.
 * Binary frames match teleop.js / @dimos/msgs@0.1.4 LCM PoseStamped + Joy.
 * Enable Robotics / Activate POSTs /api/dimos/ensure-coordinator so Studio
 * can start `dimos run teleop-*` when :8443 is down (never kills a live one).
 */

import {
  detectDimosHeadset,
  dimosBlueprintForHeadset,
  dimosEnsurePayload,
} from "./xr-dimos-headset.js?v=20260909-dimostart1-20260909-robotrec1";
import {
  applyDimosControlBindings,
  getDimosControlPrefs,
} from "./xr-dimos-controls.js?v=20260929-y-calibrate1";
import {
  dimosShouldForwardSelect,
  studioUiOverridesDimosSelect,
  shouldIngestDimosJpeg,
} from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5";
import {
  colocatedDimosHint,
  dimosConnectPolicy,
  dimosDirectLanWsUrl,
  isPublicDimosHost,
  isPrivateLanHost,
  isLoopbackHost,
  hostnameOf,
} from "./xr-dimos-lan.js?v=20260909-dimosui1-20260914-lanpc1-20260915-dimosvr1-20260915-dimosy1";
import {
  getDimosViewerSnapshot,
  ingestDimosViewerMessage,
  mountDimosViewerRoots,
  resetDimosViewer,
  setDimosViewerOffline,
  shouldShowDimosViewerUi,
  syncDimosViewerDom,
} from "./xr-dimos-viewer.js?v=roboticsworkspace3";
export {
  colocatedDimosHint,
  dimosConnectPolicy,
  isCloudStudioOrigin,
  studioCanProxyDimos,
  dimosDirectLanWsUrl,
} from "./xr-dimos-lan.js?v=20260909-dimosui1-20260914-lanpc1-20260915-dimosvr1-20260915-dimosy1";
export { shouldShowDimosViewerUi } from "./xr-dimos-viewer.js?v=roboticsworkspace3";

export const DIMOS_WS_DEFAULT = "wss://192.168.1.77:8443/ws";
export const DIMOS_Y_HOLD_CACHE = "20260916-yreset1-robotemote1-teleopfix1-yarm1";
export const TELEOP_HUD_CACHE = "teleophud1";
/** Mac Mini Studio LAN — no Peak CAN. Do not treat this host as the robot. */
export const DIMOS_STUDIO_LAN_HOST = "192.168.1.83";

/** Pi / robot PC on Wi-Fi, not this Mac and not loopback. */
export function isDimosRobotLanHost(host) {
  const h = hostnameOf(host);
  if (!h || isPublicDimosHost(h) || isLoopbackHost(h)) return false;
  if (h === DIMOS_STUDIO_LAN_HOST) return false;
  return isPrivateLanHost(h);
}

/**
 * Mock only when we know hardware is mock. A live Quest→Pi socket is CAN
 * (teleop-quest-openarm --left-can-port can1 --right-can-port can0).
 * Mac `ps` without CAN flags must not paint the Pi session as mock.
 */
export function inferDimosHardwareMode({
  coordinatorMode = "",
  teleopStatus = {},
  wsUrl = "",
} = {}) {
  const blob = [
    teleopStatus.hardware_mode,
    teleopStatus.adapter,
    teleopStatus.adapter_type,
    teleopStatus.hardware,
  ].map((v) => String(v || "").toLowerCase()).join(" ");
  if (/\bmock(_whole_body)?\b/.test(blob) || blob.includes("simulation")) return "mock";
  if (blob.includes("damiao") || blob.includes("openarm_damiao") || /\bcan\b/.test(blob)) return "can";
  if (teleopStatus.can === true || teleopStatus.can_ok === true) return "can";
  if (teleopStatus.can === false || teleopStatus.mock === true) return "mock";
  const coord = String(coordinatorMode || "").toLowerCase();
  const host = hostnameOf(wsUrl);
  if (isDimosRobotLanHost(host)) return "can";
  if (coord === "can") return "can";
  if (coord === "mock") return "mock";
  return "unknown";
}

export function dimosHardwareStatusLabel({
  statusKey = "off",
  hardwareMode = "unknown",
  robotName = "Open Arm",
  recognized = false,
  yFollow = false,
} = {}) {
  const mode = String(hardwareMode || "unknown").toLowerCase();
  const robot = String(robotName || "Open Arm");
  const key = String(statusKey || "off");
  if (mode === "mock") return `${robot} · mock / no CAN`;
  if (key === "engaged" || yFollow) return mode === "can" ? "ENGAGED · CAN" : "ENGAGED";
  if (key === "connecting") return "Connecting";
  if (key === "connected") return mode === "can" ? `${robot} · Connected (CAN)` : `${robot} · Connected`;
  if (recognized && mode === "can") return `${robot} · CAN`;
  if (key === "error" || key === "disconnected") return "DIMOS not running";
  if (key === "armed") return "Armed — enter VR, tap left Y";
  return "Off";
}
export const DIMOS_WS_STORAGE_KEY = "render3d:dimosWs";
export const DIMOS_STUDIO_PIPE_PATH = "/api/dimos/ws";
export const DIMOS_ENSURE_PATH = "/api/dimos/ensure-coordinator";
export const DIMOS_COORDINATOR_PATH = "/api/dimos/coordinator";
export const DIMOS_SEND_HZ = 80;
export const GRIPPER_PINCH_DISTANCE_METERS = 0.04;
export { detectDimosHeadset, dimosBlueprintForHeadset, dimosEnsurePayload };

const START_CONNECT_DELAY_MS = 1600;
const COORDINATOR_WAIT_MS = 24000;
const COORDINATOR_POLL_MS = 8000;
export const DIMOS_OPENARM_ROBOT_ID = "openarm";
export const DIMOS_OPENARM_ROBOT_NAME = "Open Arm";

const SEND_INTERVAL_MS = 1000 / DIMOS_SEND_HZ;
/** One try while DIMOS is already up. After an auto-start we poll, then try once more. */
const MAX_CONNECT_ATTEMPTS = 1;

const MASK = 0xffffffffffffffffn;
function lcmRotate(n) {
  return (((n << 1n) & MASK) + (n >> 63n)) & MASK;
}
function hashLeaf(hash) {
  return lcmRotate(hash);
}
function hashWith(hash, child) {
  return lcmRotate((hash + child) & MASK);
}

const HASH_TIME = 0xde1d24a3a8ecb648n;
const HASH_HEADER = 0xdbb33f5b4c19b8ean;
const HASH_POINT = 0x573f2fdd2f76508fn;
const HASH_QUAT = 0x9b1dee9dfc8c0515n;
const HASH_POSE = 0x2d70dd60bd541272n;
const HASH_POSE_STAMPED = 0xe10feebec5c97663n;
const HASH_JOY = 0x209d2c19077a692fn;

const FP_TIME = hashLeaf(HASH_TIME);
const FP_HEADER = hashWith(HASH_HEADER, FP_TIME);
const FP_POINT = hashLeaf(HASH_POINT);
const FP_QUAT = hashLeaf(HASH_QUAT);
const FP_POSE = hashWith((HASH_POSE + FP_POINT) & MASK, FP_QUAT);
export const FP_POSE_STAMPED = hashWith((HASH_POSE_STAMPED + FP_HEADER) & MASK, FP_POSE);
export const FP_JOY = hashWith(HASH_JOY, FP_HEADER);

const textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

function writeFingerprint(view, offset, fp) {
  view.setBigUint64(offset, fp, false);
  return offset + 8;
}

function writeTime(view, offset, sec, nsec) {
  view.setInt32(offset, sec | 0, false);
  view.setInt32(offset + 4, nsec | 0, false);
  return offset + 8;
}

function writeHeader(view, offset, seq, sec, nsec, frameId) {
  view.setInt32(offset, seq | 0, false);
  offset += 4;
  offset = writeTime(view, offset, sec, nsec);
  const bytes = textEncoder.encode(String(frameId || ""));
  view.setUint32(offset, bytes.length + 1, false);
  offset += 4;
  new Uint8Array(view.buffer, view.byteOffset + offset).set(bytes);
  offset += bytes.length;
  view.setUint8(offset, 0);
  return offset + 1;
}

function headerEncodedSize(frameId) {
  const n = textEncoder.encode(String(frameId || "")).length;
  return 4 + 8 + 4 + n + 1;
}

export function encodePoseStamped({ frameId, x, y, z, qx, qy, qz, qw, nowMs }) {
  const ms = Number.isFinite(nowMs) ? nowMs : Date.now();
  const sec = Math.floor(ms / 1000);
  const nsec = (ms % 1000) * 1_000_000;
  const fid = frameId === "right" ? "right" : "left";
  const size = 8 + headerEncodedSize(fid) + 24 + 32;
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  let o = writeFingerprint(view, 0, FP_POSE_STAMPED);
  o = writeHeader(view, o, 0, sec, nsec, fid);
  view.setFloat64(o, Number(x) || 0, false); o += 8;
  view.setFloat64(o, Number(y) || 0, false); o += 8;
  view.setFloat64(o, Number(z) || 0, false); o += 8;
  view.setFloat64(o, Number(qx) || 0, false); o += 8;
  view.setFloat64(o, Number(qy) || 0, false); o += 8;
  view.setFloat64(o, Number(qz) || 0, false); o += 8;
  view.setFloat64(o, Number(qw) || 0, false); o += 8;
  return buf;
}

export function encodeJoy({ frameId, axes, buttons, nowMs }) {
  const ms = Number.isFinite(nowMs) ? nowMs : Date.now();
  const sec = Math.floor(ms / 1000);
  const nsec = (ms % 1000) * 1_000_000;
  const fid = frameId === "right" ? "right" : "left";
  const ax = Array.isArray(axes) ? axes : [];
  const bt = Array.isArray(buttons) ? buttons : [];
  const axesLen = ax.length;
  const buttonsLen = bt.length;
  const size = 8 + 4 + 4 + headerEncodedSize(fid) + axesLen * 4 + buttonsLen * 4;
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  let o = writeFingerprint(view, 0, FP_JOY);
  view.setInt32(o, axesLen, false); o += 4;
  view.setInt32(o, buttonsLen, false); o += 4;
  o = writeHeader(view, o, 0, sec, nsec, fid);
  for (let i = 0; i < axesLen; i += 1) {
    view.setFloat32(o, Number(ax[i]) || 0, false);
    o += 4;
  }
  for (let i = 0; i < buttonsLen; i += 1) {
    view.setInt32(o, bt[i] ? 1 : 0, false);
    o += 4;
  }
  return buf;
}

function isButtonDown(button) {
  return !!(button && (button.pressed || button.value > 0.5));
}

/** Same mapping as dimos/teleop/quest/web/static/teleop.js */
export function mapDimosController(gamepad, { blockTrigger = false, physical = false } = {}) {
  const raw = gamepad?.buttons || [];
  const n = raw.length;
  const xr = gamepad?.mapping === "xr-standard";
  const stickX = (xr ? gamepad.axes[2] : gamepad.axes[0]) ?? 0.0;
  const stickY = (xr ? gamepad.axes[3] : gamepad.axes[1]) ?? 0.0;

  let touchpad = false;
  let thumbstick = false;
  let primary = false;
  let secondary = false;
  let menu = false;

  if (xr && n >= 6) {
    touchpad = isButtonDown(raw[2]);
    thumbstick = isButtonDown(raw[3]);
    primary = isButtonDown(raw[4]);
    secondary = isButtonDown(raw[5]);
    menu = isButtonDown(raw[7]);
  } else if (xr && n === 5) {
    thumbstick = isButtonDown(raw[2]);
    primary = isButtonDown(raw[3]);
    secondary = isButtonDown(raw[4]);
  } else {
    primary = isButtonDown(raw[2]);
    secondary = isButtonDown(raw[3]);
    thumbstick = isButtonDown(raw[4]);
    menu = isButtonDown(raw[5]) || isButtonDown(raw[6]);
  }

  if (!primary) {
    primary = isButtonDown(raw[4]) || (!xr && isButtonDown(raw[2]));
  }

  const mapped = {
    primary,
    axes: [
      stickX,
      stickY,
      blockTrigger ? 0 : (raw[0]?.value ?? 0.0),
      raw[1]?.value ?? 0.0,
    ],
    buttons: [
      !blockTrigger && isButtonDown(raw[0]) ? 1 : 0,
      isButtonDown(raw[1]) ? 1 : 0,
      touchpad ? 1 : 0,
      thumbstick ? 1 : 0,
      primary ? 1 : 0,
      secondary ? 1 : 0,
      menu ? 1 : 0,
    ],
  };
  return physical || roboticsIntegratedProfile() ? mapped : applyDimosControlBindings(mapped, getDimosControlPrefs());
}

/** Expand LAN IP / host:8443 / http(s) into the DIMOS /ws URL Enable Robotics uses. */
export function normalizeDimosWsInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return DIMOS_WS_DEFAULT;
  let candidate = s;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = `wss://${candidate.replace(/^\[|\]$/g, "")}`;
  } else if (/^https:/i.test(candidate)) {
    candidate = candidate.replace(/^https:/i, "wss:");
  } else if (/^http:/i.test(candidate)) {
    candidate = candidate.replace(/^http:/i, "ws:");
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return DIMOS_WS_DEFAULT;
    const host = u.hostname;
    if (!host) return DIMOS_WS_DEFAULT;
    if (isPublicDimosHost(host)) return DIMOS_WS_DEFAULT;
    const port = u.port || "8443";
    const scheme = u.protocol === "ws:" ? "ws:" : "wss:";
    return `${scheme}//${host}:${port}/ws`;
  } catch {
    return DIMOS_WS_DEFAULT;
  }
}

export function resolveDimosWsUrl() {
  const profileUrl = roboticsControllerUrl();
  if (profileUrl) return normalizeDimosWsInput(profileUrl);
  try {
    const q = new URLSearchParams(window.location.search).get("dimosWs");
    if (q && String(q).trim()) return normalizeDimosWsInput(q);
  } catch {
    /* ignore */
  }
  try {
    const stored = localStorage.getItem(DIMOS_WS_STORAGE_KEY);
    if (stored && String(stored).trim()) return normalizeDimosWsInput(stored);
  } catch {
    /* ignore */
  }
  return DIMOS_WS_DEFAULT;
}

/** Hostname + port from a saved DimOS /ws URL or a typed LAN IP. */
export function parseDimosHost(raw) {
  const ws = normalizeDimosWsInput(raw);
  try {
    const u = new URL(ws);
    return { host: u.hostname, port: u.port || "8443" };
  } catch {
    return { host: "192.168.1.77", port: "8443" };
  }
}

/** IPv4 / host for the Robotics preference field (omit :8443 when default). */
export function formatDimosHostInput(raw) {
  const { host, port } = parseDimosHost(raw);
  return port === "8443" ? host : `${host}:${port}`;
}

/** Quest browser page — no in-VR IP form on that DIMOS page. */
export function dimosQuestTeleopUrl(raw) {
  const { host, port } = parseDimosHost(raw);
  return `https://${host}:${port}/teleop`;
}

export function isDesktopQuestOpen() {
  try {
    return !document.documentElement.classList.contains("vr-headset-browser");
  } catch {
    return true;
  }
}

export function syncDimosQuestConnectUi(raw) {
  const url = dimosQuestTeleopUrl(raw || resolveDimosWsUrl());
  try {
    document.querySelectorAll("[data-robotics-quest-url]").forEach((el) => {
      el.textContent = url;
    });
    document.querySelectorAll("[data-robotics-quest-open]").forEach((btn) => {
      btn.hidden = !isDesktopQuestOpen();
    });
  } catch {
    /* ignore */
  }
  return url;
}

export function persistDimosWsUrl(url) {
  const next = normalizeDimosWsInput(url);
  const hostText = formatDimosHostInput(next);
  try { localStorage.setItem(DIMOS_WS_STORAGE_KEY, next); } catch { /* ignore */ }
  try {
    const panel = document.getElementById("dimos-teleop-url");
    if (panel) panel.value = next;
    const pref = document.getElementById("pref-dimos-ws-url") || document.getElementById("pref-dimos-host");
    if (pref) pref.value = hostText;
    document.querySelectorAll("[data-dimos-host-input]").forEach((el) => {
      if (document.activeElement !== el) el.value = next;
    });
    syncDimosQuestConnectUi(next);
  } catch {
    /* ignore */
  }
  return next;
}

export function isStudioDimosPipeUrl(url) {
  return /\/api\/dimos\/ws(?:\?|$)/.test(String(url || ""));
}

/**
 * Quest → Pi LAN wss (like cameras). Page origin may be https://render3d.app;
 * command traffic still goes wss://<robot-lan>:8443/ws. Never Cloudflare pipe.
 */
export function dimosQuestWsUrl(upstream) {
  const up = String(upstream || resolveDimosWsUrl() || DIMOS_WS_DEFAULT).trim();
  const rawHost = hostnameOf(up);
  if (rawHost && isPublicDimosHost(rawHost) && !isStudioDimosPipeUrl(up)) return "";
  if (isStudioDimosPipeUrl(up)) {
    try {
      const u = new URL(up, "http://local.invalid");
      const nested = u.searchParams.get("upstream");
      if (nested) return dimosQuestWsUrl(nested);
    } catch { /* ignore */ }
    return dimosQuestWsUrl(resolveDimosWsUrl());
  }
  const direct = dimosDirectLanWsUrl(up);
  if (direct) return direct;
  const normalized = normalizeDimosWsInput(up);
  if (isPublicDimosHost(hostnameOf(up))) return "";
  return dimosDirectLanWsUrl(normalized);
}

/** @deprecated Use dimosQuestWsUrl — kept so existing callers open the Pi, not Cloudflare. */
export function studioDimosPipeUrl(upstream) {
  return dimosQuestWsUrl(upstream);
}

function poseFromXrPose(pose) {
  const pos = pose?.transform?.position;
  const rot = pose?.transform?.orientation;
  if (!pos || !rot) return null;
  return { x: pos.x, y: pos.y, z: pos.z, qx: rot.x, qy: rot.y, qz: rot.z, qw: rot.w };
}

function poseFromMatrix(matrix) {
  if (!matrix) return null;
  const e = matrix.elements || matrix;
  if (!e || e.length < 16) return null;
  const x = e[12];
  const y = e[13];
  const z = e[14];
  const m11 = e[0]; const m12 = e[4]; const m13 = e[8];
  const m21 = e[1]; const m22 = e[5]; const m23 = e[9];
  const m31 = e[2]; const m32 = e[6]; const m33 = e[10];
  const trace = m11 + m22 + m33;
  let qw;
  let qx;
  let qy;
  let qz;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    qw = 0.25 / s;
    qx = (m32 - m23) * s;
    qy = (m13 - m31) * s;
    qz = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    qw = (m32 - m23) / s;
    qx = 0.25 * s;
    qy = (m12 + m21) / s;
    qz = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    qw = (m13 - m31) / s;
    qx = (m12 + m21) / s;
    qy = 0.25 * s;
    qz = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = (m13 + m31) / s;
    qy = (m23 + m32) / s;
    qz = 0.25 * s;
  }
  return { x, y, z, qx, qy, qz, qw };
}

function looksLikeController(gamepad) {
  return !!(gamepad && gamepad.buttons && gamepad.buttons.length >= 4);
}

const STATUS = {
  off: "Off",
  armed: "Armed — enter VR, tap left Y to Engage",
  connecting: "Connecting",
  connected: "Connected",
  engaged: "ENGAGED",
  disconnected: "Disconnected",
  error: "Disconnected — DIMOS not running",
};

const listeners = new Set();
const handSelectActive = new Map();

let armed = false;
let presenting = false;
let ws = null;
let statusKey = "off";
let statusDetail = "";
let lastSendTime = 0;
let leftPrimaryHeld = false;
let rightPrimaryHeld = false;
let connectAttempts = 0;
let reconnectTimer = 0;
let connectGeneration = 0;
let sessionListeners = null;
let panelEls = null;
let ensureInFlight = null;
let coordinatorWait = null;
let lastEnsureStatus = "";
let lastHeadset = "quest";
let lastCoordinator = null;
let selectedRobotId = DIMOS_OPENARM_ROBOT_ID;
let coordTimer = 0;

/** Local IWER-style pose tape — DIMOS has no first-class VR replay. */
let recordMode = "idle"; // idle | recording | playing | looping
let recordBuf = [];
let lastTrainingFrame = null;
const recordFrameListeners = new Set();
let recordStartedAt = 0;
let playStartedAt = 0;
let playOffsetMs = 0;
const statsSamples = [];
let posePackets = 0;
let lastPoseCountAt = 0;
let poseCountWindow = 0;
let engageAccumMs = 0;
let engageMarkAt = 0;
let lastLeftTrack = false;
let lastRightTrack = false;

function notePosePacket(now, { left = false, right = false } = {}) {
  posePackets += 1;
  poseCountWindow += 1;
  lastLeftTrack = !!left;
  lastRightTrack = !!right;
  if (!lastPoseCountAt) lastPoseCountAt = now;
  if (now - lastPoseCountAt >= 250) {
    const hz = poseCountWindow / ((now - lastPoseCountAt) / 1000);
    statsSamples.push({ t: now, hz, left: lastLeftTrack, right: lastRightTrack });
    while (statsSamples.length > 48) statsSamples.shift();
    poseCountWindow = 0;
    lastPoseCountAt = now;
  }
}

export function getDimosTeleopStats() {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const last = statsSamples[statsSamples.length - 1];
  let engageMs = engageAccumMs;
  if (statusKey === "engaged" || (armed && leftPrimaryHeld && rightPrimaryHeld)) {
    if (engageMarkAt) engageMs += Math.max(0, now - engageMarkAt);
  }
  return {
    poseHz: last ? Number(last.hz) || 0 : 0,
    engageSec: engageMs / 1000,
    leftTrack: lastLeftTrack,
    rightTrack: lastRightTrack,
    packets: posePackets,
    samples: statsSamples.slice(),
    recording: recordMode === "recording",
    playing: recordMode === "playing",
    looping: recordMode === "looping",
    clipMs: recordBuf.length ? (recordBuf[recordBuf.length - 1].t - recordBuf[0].t) : 0,
    clipFrames: recordBuf.length,
  };
}

export function onDimosRecordFrame(fn) {
  recordFrameListeners.add(fn);
  return () => recordFrameListeners.delete(fn);
}

export function peekDimosTrainingFrame() {
  return lastTrainingFrame ? { ...lastTrainingFrame } : null;
}

export function copyDimosRecordClip() {
  return recordBuf.map((frame) => ({ ...frame }));
}

function notifyRecordFrame(frame) {
  for (const fn of recordFrameListeners) {
    try { fn(frame); } catch { /* ignore */ }
  }
}

export function getDimosRecordState() {
  if (roboticsIntegratedProfile()) {
    const episode = getDimosViewerSnapshot().episode;
    const recording = episode?.state === 'recording';
    return {mode:recording?'recording':'idle',recording,playing:!!profileTeleopStatus.playing,
      looping:false,frames:0,hasClip:false,source:'pi',pending:piRecordPulse.busy(),
      pendingIntent:piRecordPulse.pending()};
  }
  return {
    mode: recordMode,
    recording: recordMode === "recording",
    playing: recordMode === "playing" || recordMode === "looping",
    looping: recordMode === "looping",
    frames: recordBuf.length,
    hasClip: recordBuf.length > 1,
  };
}

export function startDimosRecord() {
  lastHudAction = "RECORD";
  if (roboticsIntegratedProfile()) return requestPiRecording(true);
  recordMode = "recording";
  recordBuf = [];
  recordStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  playOffsetMs = 0;
  notify();
}

export function stopDimosRecord() {
  lastHudAction = "SAVE";
  if (roboticsIntegratedProfile()) return requestPiRecording(false);
  if (recordMode === "recording" || recordMode === "playing" || recordMode === "looping") {
    recordMode = "idle";
    playOffsetMs = 0;
    notify();
  }
}

export function discardDimosRecord({ confirm = true } = {}) {
  if (!roboticsIntegratedProfile() || !getDimosRecordState().recording) return false;
  if (confirm && globalThis.confirm?.('Discard this recording? This cannot be undone.') !== true) return false;
  if (!piDiscardPulse.request(false, performance.now())) return false;
  emitPiAction({action:'recording_status',recording:true,pending:true,discarding:true,state:'discarding'});
  lastHudAction = 'DISCARD';
  notify();
  return true;
}

export function playDimosRecord({ loop = false } = {}) {
  if (roboticsIntegratedProfile()) {
    globalThis.dispatchEvent?.(new CustomEvent('render3d:pi-action',{detail:{action:'emote_picker'}}));
    return false;
  }
  if (recordBuf.length < 2) return false;
  recordMode = loop ? "looping" : "playing";
  playStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  playOffsetMs = 0;
  notify();
  return true;
}

export function setDimosLoop(on) {
  if (roboticsIntegratedProfile()) return playDimosRecord();
  if (on) return playDimosRecord({ loop: true });
  if (recordMode === "looping") {
    recordMode = "idle";
    notify();
  }
  return recordMode === "looping";
}

function clipDurationMs() {
  if (recordBuf.length < 2) return 0;
  return Math.max(1, recordBuf[recordBuf.length - 1].t - recordBuf[0].t);
}

function frameAtElapsed(elapsedMs) {
  if (!recordBuf.length) return null;
  const dur = clipDurationMs();
  let t = elapsedMs;
  if (recordMode === "looping" && dur > 0) t = elapsedMs % dur;
  const start = recordBuf[0].t;
  const want = start + t;
  let lo = 0;
  let hi = recordBuf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (recordBuf[mid].t < want) lo = mid + 1;
    else hi = mid;
  }
  return recordBuf[Math.max(0, lo - 1)] || recordBuf[0];
}

function notify() {
  const snap = getDimosTeleopState();
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (snap.statusKey === "engaged") {
    if (!engageMarkAt) engageMarkAt = now;
  } else if (engageMarkAt) {
    engageAccumMs += Math.max(0, now - engageMarkAt);
    engageMarkAt = 0;
  }
  listeners.forEach((fn) => {
    try { fn(snap); } catch { /* ignore */ }
  });
  syncPanel(snap);
}

export function getDimosTeleopState() {
  const profile = roboticsIntegratedProfile();
  const recordingState = getDimosRecordState();
  const both = !profile && leftPrimaryHeld && rightPrimaryHeld;
  const wsOpen = !!(ws && ws.readyState === WebSocket.OPEN);
  let datasetFolder = "Emotes";
  try {
    const project = new URLSearchParams(globalThis.location?.search || "").get("project") || "global";
    const selected = localStorage.getItem(`render3d:robotics:dataset-destination:v1:${project}`) || "emotes";
    const folders = JSON.parse(localStorage.getItem(`render3d:robotics:dataset-folders:v1:${project}`) || "[]");
    datasetFolder = selected === "emotes" ? "Emotes" : (folders.find(folder => folder.id === selected)?.name || selected);
  } catch { /* storage is optional */ }
  let key = statusKey;
  if (statusKey === 'error') key = 'error';
  else if (armed && presenting && wsOpen && (both || yFollowActive)) key = "engaged";
  else if (armed && presenting && wsOpen) key = "connected";
  else if (armed && presenting && (statusKey === "connecting" || (ws && ws.readyState === WebSocket.CONNECTING))) {
    key = "connecting";
  }
  const label = key === "engaged"
    ? STATUS.engaged
    : key === "connected" && !profile && (leftPrimaryHeld || rightPrimaryHeld)
      ? (leftPrimaryHeld && !rightPrimaryHeld ? "Connected — hold A (right) too" : !leftPrimaryHeld && rightPrimaryHeld ? "Connected — hold X (left) too" : STATUS.connected)
      : (STATUS[key] || STATUS.off);
  return {
    armed,
    teleop: {...profileTeleopStatus, stopPhase:teleopStop.phase()},
    stopPhase: teleopStop.phase(),
    yHoldProgress: Math.max(profileY.holdProgress(performance.now()), piUi.holdProgress(performance.now())),
    lastAction: lastHudAction,
    recording: recordingState.recording,
    pendingIntent: recordingState.pendingIntent || '',
    datasetFolder,
    presenting,
    statusKey: key,
    label: teleopStop.phase() === 'pending' ? 'Stopping arms — waiting for Pi confirmation'
      : teleopStop.phase() === 'stopped' ? 'Teleop stopped · Y starts a fresh session · Pi homing unavailable'
      : statusDetail && statusKey === 'error' ? statusDetail
      : statusDetail && key === 'disconnected' ? `${label} (${statusDetail})` : label,
    wsUrl: resolveDimosWsUrl(),
    leftPrimaryHeld,
    rightPrimaryHeld,
    connected: wsOpen,
    headset: lastHeadset,
    ensureStatus: lastEnsureStatus,
    showViewer: shouldShowDimosViewerUi({ armed }),
    policy: dimosConnectPolicy(undefined, resolveDimosWsUrl()),
    viewer: getDimosViewerSnapshot(),
    ...coordinatorRobotFields(),
    ...getDimosRecordState(),
    stats: getDimosTeleopStats(),
  };
}

export function isDimosTeleopArmed() {
  return !!armed;
}

/**
 * Stolen only while armed (Activate). Quest xr-standard:
 * - Profile button meanings remain owned by the Pi.
 * - Studio grip, face-button, and thumbstick actions are disabled.
 * Thumbs and pose WS are not stolen when off; pose WS runs only while armed+presenting.
 */
export const DIMOS_STOLEN_WHEN_ARMED = Object.freeze({
  face: ["X", "Y", "A", "B"],
  faceButtonIndex: 4,
  squeeze: false,
  thumbs: true,
});

export function isDimosStealingFaceButtons() {
  return !!armed;
}

/** Walk / throw B stay Studio unless a take is recording (B = discard then). */
export function isDimosBlockingWalk() {
  return !!armed && !!(getDimosRecordState().recording || piRecordPulse.busy());
}

export function isDimosStealingGrip() {
  return false;
}

const piControlDebugEvents = [];
let lastPiStatusDebugSignature = "";
function notePiControlDebug(kind, detail = {}) {
  const row = {
    t: Math.round(typeof performance !== "undefined" ? performance.now() : Date.now()),
    kind: String(kind || "").slice(0, 24),
    action: String(detail.action || detail.type || "").slice(0, 32),
    state: String(detail.state || "").slice(0, 24),
  };
  for (const key of ["armed", "pending_arm", "holding", "homing", "recording", "discarded", "pending"]) {
    if (detail[key] != null) row[key] = detail[key] === true;
  }
  if (detail.error) row.error = String(detail.error).slice(0, 120);
  if (detail.code != null) row.code = Number(detail.code) || 0;
  piControlDebugEvents.push(row);
  while (piControlDebugEvents.length > 80) piControlDebugEvents.shift();
}
const emitPiAction = detail => {
  notePiControlDebug("studio-event", detail);
  globalThis.dispatchEvent(new CustomEvent('render3d:pi-action', {detail}));
};
const piUi = createPiUiInput(detail => {
  if (detail.action === 'record_start') requestPiRecording(true);
  else if (detail.action === 'record_stop') requestPiRecording(false);
  else if (detail.action === 'record_discard') discardDimosRecord({confirm:false});
  else emitPiAction(detail);
});
export function setDimosProfileUiState(state) { piUi.setState(state); }
const profileY = createProfileYControl();
const piRecordPulse = createPiRecordPulse();
const piDiscardPulse = createPiRecordPulse();
let piSaveIntent = null, piQueuedStop = false;
const piSaveSeen = new Set();
let profileTeleopStatus = {};
let profileStatusRevision = 0;
let profileRequest = null;
let profileAccess = null;
let yFollowActive = false;
const gripperAwaitRelease = { left: true, right: true };
let leftYMissingSince = 0;
let pendingYStart = false;
const teleopHeading = createTeleopHeadingFrame();
let startingPositionReady = false;
let startingPositionTask = null;
let startingPositionController = null;
let lastHudAction = "NONE";
let yAwaitRelease = true;
let yInputDebug = { build: "y-idle-20260918-1", sampledAt: 0, pressed: false, action: "none" };
let networkDebug = { transport: "idle", target: "", socketState: "closed", opens: 0, closes: 0, errors: 0, lastError: "", closeCode: 0, closeReason: "", statusAt: 0, packets: 0 };
export function getDimosYControlDebug() {
  return { ...yInputDebug, armed, pendingStart: pendingYStart, stopPhase: teleopStop.phase(),
    profileMap: String(profileYMap(roboticsIntegratedProfile()) || "").slice(0, 64),
    liveMap: String(profileTeleopStatus.y_map || "").slice(0, 64) };
}
export function getDimosNetworkDebug() {
  return { ...networkDebug, armed, presenting, y: getDimosYControlDebug(), profileStatus: { ...profileTeleopStatus } };
}
export function getDimosControlDebug() {
  const record = getDimosRecordState();
  return {
    contract: "Y tap calibrate/activate or pause/resume; Y hold reset/home; A start/stop+save; B discard; triggers grippers",
    studio: { armed, presenting, following: yFollowActive, pendingYStart, stopPhase: teleopStop.phase() },
    pi: {
      armed: profileTeleopStatus.armed === true,
      pendingArm: profileTeleopStatus.pending_arm === true,
      holding: profileTeleopStatus.holding === true,
      homing: profileTeleopStatus.homing === true,
      hardware: String(profileTeleopStatus.hardware || "").slice(0, 40),
      yMap: String(profileTeleopStatus.y_map || "").slice(0, 64),
    },
    recording: { active: record.recording === true, pending: String(record.pendingIntent || "").slice(0, 24) },
    routing: {
      faceButtonsToPi: armed,
      studioFaceButtons: !armed,
      triggerToGripper: armed && yFollowActive,
      triggerReleaseRequired: { ...gripperAwaitRelease },
    },
    events: piControlDebugEvents.slice(),
  };
}
const profileRequests = new Set();
let stopRequest = null;
function releaseStopRequest() {
  stopRequest?.abort(); profileRequests.delete(stopRequest); stopRequest = null;
}
const teleopStop = createTeleopStop({
  onStatus: status => acceptProfileStatus(status),
  onError: error => {
    releaseStopRequest();
    setStatus('error', `Stop not confirmed by the Pi: ${error.message}. Motion streaming is blocked; hold Y to retry.`);
  },
});
export function configureDimosProfileTransport(request) { profileRequest = request; }
function clearProfileControls() {
  startingPositionController?.abort(); startingPositionController = null;
  teleopHeading.clear(); startingPositionReady = false; startingPositionTask = null;
  homeAndDisarmController?.abort();
  yAwaitRelease = true;
  teleopStop.clear();
  releaseStopRequest();
  piSaveIntent=null; piQueuedStop=false; piSaveSeen.clear();
  yInputDebug = { build: "y-idle-20260918-1", sampledAt: 0, pressed: false, action: "none" };
  profileY.clear(); piUi.clear(); piRecordPulse.clear(); piDiscardPulse.clear(); profileTeleopStatus = {}; profileStatusRevision++; profileAccess = null; yFollowActive = false; leftYMissingSince = 0; pendingYStart = false; lastHudAction = "NONE";
  gripperPulseUntil.left = 0; gripperPulseUntil.right = 0;
  gripperAwaitRelease.left = true; gripperAwaitRelease.right = true;
  for (const request of profileRequests) request.abort();
  profileRequests.clear();
}

function acceptProfileStatus(status) {
  if (teleopStop.accept(status)) releaseStopRequest();
  const wasFollowing = yFollowActive;
  profileTeleopStatus = mergePiTeleopStatus(profileTeleopStatus, status);
  profileStatusRevision++;
  yFollowActive = currentHardwareMode() !== 'mock'
    && !!(profileTeleopStatus.armed || profileTeleopStatus.pending_arm)
    && !profileTeleopStatus.holding;
  const debugSignature = JSON.stringify([
    !!profileTeleopStatus.armed, !!profileTeleopStatus.pending_arm, !!profileTeleopStatus.holding,
    !!profileTeleopStatus.homing, String(profileTeleopStatus.hardware || ""), String(profileTeleopStatus.y_map || ""),
  ]);
  if (debugSignature !== lastPiStatusDebugSignature) {
    lastPiStatusDebugSignature = debugSignature;
    notePiControlDebug("pi-status", profileTeleopStatus);
  }
  if (yFollowActive && !wasFollowing) {
    // A trigger may still be down after using the paused menu. Require a
    // release before either gripper follows again, so resume starts at the
    // Pi's 0.5 half-open rest instead of closing unexpectedly.
    gripperAwaitRelease.left = true;
    gripperAwaitRelease.right = true;
  }
  if (profileTeleopStatus.armed || profileTeleopStatus.pending_arm) emitPiAction({action:'robot_started',pending:!!profileTeleopStatus.pending_arm,armed:!!profileTeleopStatus.armed});
  notify();
}

function requestPiRecording(recording) {
  notePiControlDebug("record-request", { action: recording ? "start" : "stop_save", recording });
  if (teleopStop.blocksMotion()) return false;
  if (!armed || !presenting || !ws || ws.readyState !== WebSocket.OPEN) {
    setStatus('error','Connect robotics in VR before recording a Pi take.'); return false;
  }
  const episode = getDimosViewerSnapshot().episode;
  if (!episode) { setStatus('error','Waiting for the Pi recorder status.'); return false; }
  if (!recording && episode.state !== 'recording' && piRecordPulse.busy()) { piQueuedStop=true; return true; }
  if ((episode.state === 'recording') === recording) return true;
  if (recording && (piUi.ownsRightButtons() || piSaveIntent)) { setStatus('error','Finish saving the take and close Data Sets before recording.'); return false; }
  const queued = piRecordPulse.request(recording, performance.now());
  if (queued) {
    if (recording) { piSaveSeen.clear(); emitPiAction({action:'recording_status',recording:true,pending:true,state:'starting'}); }
    else piSaveIntent={profile:roboticsIntegratedProfile(),generation:connectGeneration,deadline:performance.now()+15000};
    notify();
  } else if (!recording) piQueuedStop=true;
  return queued;
}

// Only an explicit Stop owns the following saved-take confirmation. A pending
// take received on reconnect still requires the user's onscreen decision.
function handlePiSavedTake(detail) {
  const key=JSON.stringify([detail.name,detail.samples]);
  if (piSaveSeen.has(key)) return;
  piSaveSeen.add(key);
  const intent=piSaveIntent;
  if (!intent || performance.now()>intent.deadline) { piSaveIntent=null; emitPiAction(detail); return; }
  piSaveIntent=null;
  emitPiAction({...detail,action:'confirm',destinationRequired:true});
  notify();
}

function refreshProfileStatus(profile, socket, generation) {
  const controller = new AbortController(), revision = profileStatusRevision;
  profileRequests.add(controller);
  void requestPiTeleop(profile, '/teleop/status', {signal:controller.signal}).then(status => {
    if (armed && ws === socket && generation === connectGeneration && revision === profileStatusRevision) acceptProfileStatus(status);
  }).catch(() => { /* Older Pi firmware sends status only over the existing socket. */ })
    .finally(() => profileRequests.delete(controller));
}

/** Validate the selected LAN Y target; requests are sent through Studio's relay. */
export function dimosYCommandUrl(profile = roboticsIntegratedProfile()) {
  const raw = profile?.controllers?.http_backups?.y?.url;
  if (raw) {
    try {
      const url = new URL(raw);
      if (
        url.pathname === "/teleop/y"
        && url.protocol === "https:"
        && !url.username && !url.password && !url.search && !url.hash
        && !isPublicDimosHost(url.hostname)
      ) return url.toString();
    } catch { /* fall through */ }
  }
  const { host, port } = parseDimosHost(resolveDimosWsUrl());
  if (!host || isPublicDimosHost(host)) return "";
  return `https://${host}:${port || "8443"}/teleop/y`;
}

function ySampleStatus(profile) {
  const saved = profileYMap(profile);
  return {
    ...profileTeleopStatus,
    y_map: profileTeleopStatus.y_map || saved,
    profile_y_map: saved,
  };
}

function postYHttp(action, profile, controller) {
  const dest = dimosYCommandUrl(profile);
  if (!dest) throw new Error("No LAN Y endpoint");
  const url = new URL(dest);
  if (url.pathname !== "/teleop/y" || url.protocol !== "https:") throw new Error("Invalid Pi Y endpoint");
  return requestPiTeleop(profile || {ui:new URL('/teleop',dest).href}, '/teleop/y', {
    body:{action},signal:controller.signal,
  });
}

function yPoseSocketOpen() {
  return ws?.readyState === WebSocket.OPEN;
}

function sendYOnPoseSocket(action) {
  if (!yPoseSocketOpen()) return false;
  ws.send(JSON.stringify({ type: "y", action, source: "quest_left_y", inputHand: "left", inputButton: "Y" }));
  notePiControlDebug("pi-send", { action });
  return true;
}

async function sendProfileY(action, profile, controller) {
  if (controller.signal.aborted) return profileTeleopStatus;
  if (!armed && action !== "session_reset") return profileTeleopStatus;
  // Same JSON WebSocket as live pose/joy. Do not wait for hello.json_control —
  // Quest hold-Y used to no-op until HTTPS (Pi cert) succeeded.
  if (sendYOnPoseSocket(action)) return null;
  if (action === 'tap' && profile && !yFollowActive) throw new Error('Fresh controller poses and an open pose socket are required to engage');
  return postYHttp(action, profile, controller);
}

function currentHardwareMode() {
  return inferDimosHardwareMode({
    coordinatorMode: lastCoordinator?.hardware_mode,
    teleopStatus: profileTeleopStatus,
    wsUrl: resolveDimosWsUrl(),
  });
}

function applyYFollowFromAction(action, status = profileTeleopStatus, { fromServer = false } = {}) {
  const mode = inferDimosHardwareMode({
    coordinatorMode: lastCoordinator?.hardware_mode,
    teleopStatus: status,
    wsUrl: resolveDimosWsUrl(),
  });
  if (mode === "mock") {
    yFollowActive = false;
    notify();
    return mode;
  }
  if (action === "session_reset") yFollowActive = false;
  else if (action === "tap") {
    if (fromServer) {
      yFollowActive = !!(status?.armed || status?.pending_arm) && !status?.holding;
    } else {
      yFollowActive = !yFollowActive;
    }
  }
  notify();
  return mode;
}

function postProfileY(action, profile, { freshPoses = false } = {}) {
  if (!armed && action !== "session_reset") return;
  const dest = dimosYCommandUrl(profile);
  if (!presenting) return;
  const wasStopped = teleopStop.phase() === 'stopped';
  if (action === 'tap' && !teleopStop.resume()) {
    setStatus('error', 'Stop is not confirmed. Hold Y again to retry.');
    return;
  }
  if (action === 'tap' && profile && (!teleopHeading.ready() || (!yFollowActive && !freshPoses))) {
    pendingYStart = true;
    return;
  }
  if (action === 'tap' && wasStopped) setStatus('connected');
  if (!profile) applyYFollowFromAction(action);
  lastHudAction = String(action || '').toUpperCase();
  if (action === 'session_reset') {
    if (teleopStop.phase() === 'pending') return;
    // A status GET started before this command cannot acknowledge this reset.
    profileStatusRevision++;
    yFollowActive=false; piRecordPulse.clear(); piSaveIntent=null; piQueuedStop=false;
    gripperPulseUntil.left = 0; gripperPulseUntil.right = 0;
    recordMode = 'idle';
    const controller = new AbortController();
    releaseStopRequest(); stopRequest = controller;
    profileRequests.add(controller);
    teleopStop.request({
      send: () => sendProfileY(action, profile, controller),
      fallback: () => postYHttp(action, profile, controller),
    });
    notify(); return;
  }
  if (!dest && !yPoseSocketOpen()) return;
  const controller = new AbortController();
  profileRequests.add(controller);
  void sendProfileY(action, profile, controller)
    .then(status => {
      if (!armed || controller.signal.aborted || !status) return;
      acceptProfileStatus(status);
    })
    .catch(error => {
      if (controller.signal.aborted) return;
      const mode = currentHardwareMode();
      if (mode === "mock") {
        yFollowActive = false;
        setStatus("error", "Open Arm is mock / no CAN — Y will not move hardware. Run teleop-quest-openarm --left-can-port can1 --right-can-port can0 on the Pi.");
        return;
      }
      const { host } = parseDimosHost(resolveDimosWsUrl());
      setStatus("error", `Y relay could not reach ${host}:8443. Confirm Studio and the Pi are on the same LAN, then tap Y again. ${error?.message || ""}`.trim());
    })
    .finally(() => profileRequests.delete(controller));
}
function handleProfileY(action, profile) {
  if (!action) return;
  if (action === 'reset_unavailable') {
    setStatus('error','Pi has not confirmed the Y hold reset command. Reconnect to its current teleop service.'); return;
  }
  if (shouldStream() && !(ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) {
    connectSocket();
  }
  postProfileY(action, profile);
}

/** Compatibility API: the live Pi advertises session reset, explicitly NOT joint homing. */
export function requestDimosSafeHome() {
  startingPositionController?.abort(); startingPositionController = null;
  startingPositionTask = null; startingPositionReady = false; pendingYStart = false;
  teleopHeading.clear();
  homeAndDisarmController?.abort();
  handleProfileY("session_reset", roboticsIntegratedProfile());
  lastHudAction = "SESSION_RESET";
  notify();
  return "session_reset";
}

let homeAndDisarmPromise = null;
let homeAndDisarmController = null;

/** Block follow, acknowledge reset, then wait for guarded Home feedback before disarming. */
export function requestDimosHomeAndDisarm() {
  if (homeAndDisarmPromise) return homeAndDisarmPromise;
  startingPositionController?.abort(); startingPositionController = null;
  startingPositionTask = null; startingPositionReady = false;
  teleopHeading.clear();
  const profile = roboticsIntegratedProfile();
  const controller = new AbortController();
  homeAndDisarmController = controller;
  profileStatusRevision++;
  yFollowActive = false;
  pendingYStart = false;
  piRecordPulse.clear(); piSaveIntent = null; piQueuedStop = false;
  gripperPulseUntil.left = 0; gripperPulseUntil.right = 0;
  recordMode = 'idle';
  releaseStopRequest();
  teleopStop.clear();
  emitPiAction({ action: "home_disarm_started" });
  homeAndDisarmPromise = Promise.resolve().then(async () => {
    try {
      if (!profile) throw new Error("Connect a Pi profile before homing the robot");
      const result = await runGuardedHome({
        signal: controller.signal,
        request: (path, options) => {
          const pending = requestPiTeleop(profile, path, options);
          if (path === '/teleop/y') {
            // The fallback shares this request so a delayed reset cannot cancel Home.
            teleopStop.request({ send: () => pending, fallback: () => pending });
          }
          return pending;
        },
      });
      emitPiAction({ action: "home_disarm_complete" });
      return result;
    } catch (error) {
      emitPiAction({ action: "home_disarm_failed", error: error?.message || String(error) });
      throw error;
    } finally {
      setDimosTeleopArmed(false);
      homeAndDisarmController = null;
      homeAndDisarmPromise = null;
    }
  });
  return homeAndDisarmPromise;
}

const gripperPulseUntil = { left: 0, right: 0 };
export function resolveDimosGripperTrigger(rawTrigger, { following = false, awaitRelease = true } = {}) {
  const trigger = Math.max(0, Math.min(1, Number(rawTrigger) || 0));
  if (!following) return { trigger: 0, awaitRelease: true };
  if (awaitRelease) return { trigger: 0, awaitRelease: trigger > 0.05 };
  return { trigger, awaitRelease: false };
}

/** HUD / Viser gripper click: close on the live Joy stream (trigger analog). */
export function requestDimosGripperClose(hand = "both") {
  if (!armed || !yFollowActive || !presenting || teleopStop.blocksMotion() || !yPoseSocketOpen()) return false;
  if (!['left','right','both'].includes(hand)) return false;
  const until = performance.now() + 450;
  if (hand !== "right") gripperPulseUntil.left = until;
  if (hand !== "left") gripperPulseUntil.right = until;
  lastHudAction = "GRIP";
  notify();
  return "gripper_close";
}

function applyGripperClose(mapped, handedness, now) {
  if (!mapped) return mapped;
  const onUi = dimosUiGateForHand(handedness).uiHit;
  const gripper = resolveDimosGripperTrigger(mapped.axes[2], {
    following: yFollowActive,
    awaitRelease: gripperAwaitRelease[handedness],
  });
  gripperAwaitRelease[handedness] = gripper.awaitRelease;
  mapped.axes[2] = gripper.trigger;
  if (!yFollowActive || gripper.awaitRelease) {
    mapped.buttons[0] = 0;
  }
  if (onUi) {
    // Window / HUD grip stays with Studio. Do not also pinch the arm.
    mapped.axes[3] = 0;
    mapped.buttons[1] = 0;
  } else if (yFollowActive && !gripperAwaitRelease[handedness]) {
    // Sam profile: grip is HUD-only — never merge squeeze onto jaw.
    // Trigger alone pinches; grip analog stays for panel grab, not arm close.
    mapped.axes[2] = Number(mapped.axes[2]) || 0;
  }
  if (yFollowActive && !gripperAwaitRelease[handedness] && now < (gripperPulseUntil[handedness] || 0)) {
    mapped.axes[2] = 1;
    mapped.buttons[0] = 1;
  }
  return mapped;
}
const menuTriggerOwnership = createRoboticsTriggerOwnership();
const menuSelectActive = new Set();
export function reserveDimosMenuTrigger(handedness) {
  if (armed) { menuTriggerOwnership.reserve(handedness); menuSelectActive.add(handedness); }
}

export function releaseDimosMenuTrigger(handedness) {
  menuSelectActive.delete(handedness);
}

export function mapDimosControllerForHand(gamepad, handedness) {
  const trigger = gamepad?.buttons?.[0];
  const gate = dimosUiGateForHand(handedness);
  const blockTrigger = menuTriggerOwnership.sample(handedness, {
    armed,
    pressed: typeof trigger?.pressed === 'boolean' ? trigger.pressed : Number(trigger?.value || 0) > 0.5,
    // Being near a window is not a menu click. Only this hand's actual ray
    // target can claim its trigger in the integrated Pi profile.
    // While the Pi is following, the trigger is exclusively a gripper input.
    // Pause with Y before using that trigger on Studio menus.
    uiHit: roboticsIntegratedProfile() ? (!yFollowActive && gate.uiHit) : studioUiOverridesDimosSelect(gate),
  });
  // Gate the physical trigger before user mapping can move it to the gripper slot.
  return mapDimosController(gamepad, {blockTrigger});
}

let studioUiOverride = {
  uiHit: false,
  nearMenu: false,
  left: false,
  right: false,
  nearMenuLeft: false,
  nearMenuRight: false,
};

/** Viewport hover: Studio HUD/menu wins trigger/select over the arm. */
export function setDimosStudioUiOverride(next = {}) {
  studioUiOverride = {
    uiHit: next.uiHit === true,
    nearMenu: next.nearMenu === true,
    left: next.left === true,
    right: next.right === true,
    nearMenuLeft: next.nearMenuLeft === true,
    nearMenuRight: next.nearMenuRight === true,
  };
  return getDimosStudioUiOverride();
}

export function getDimosStudioUiOverride() {
  return { ...studioUiOverride };
}

export function dimosUiGateForHand(handedness, extra = {}) {
  const left = handedness === "left";
  const right = handedness === "right";
  if (!left && !right) {
    return {
      uiHit: extra.uiHit === true || studioUiOverride.uiHit === true,
      nearMenu: extra.nearMenu === true || studioUiOverride.nearMenu === true,
    };
  }
  const uiHit = extra.uiHit === true
    || (left && (extra.uiHitLeft === true || studioUiOverride.left))
    || (right && (extra.uiHitRight === true || studioUiOverride.right));
  const nearMenu = extra.nearMenu === true
    || (left && (extra.nearMenuLeft === true || studioUiOverride.nearMenuLeft))
    || (right && (extra.nearMenuRight === true || studioUiOverride.nearMenuRight));
  return { uiHit: !!uiHit, nearMenu: !!nearMenu };
}

/** Zero trigger digital + analog so a menu click is not an Open Arm command. */
export function gateDimosJoyForStudioUi(mapped, gate = {}) {
  if (!mapped || !studioUiOverridesDimosSelect(gate)) return mapped;
  const axes = Array.isArray(mapped.axes) ? mapped.axes.slice() : [0, 0, 0, 0];
  const buttons = Array.isArray(mapped.buttons) ? mapped.buttons.slice() : [0, 0, 0, 0, 0, 0, 0];
  while (axes.length < 4) axes.push(0);
  while (buttons.length < 7) buttons.push(0);
  axes[2] = 0;
  buttons[0] = 0;
  return { ...mapped, axes, buttons };
}

export { studioUiOverridesDimosSelect, dimosShouldForwardSelect };

function samplePhysicalLeftY(sess, now, profile) {
  const sources = preferredRoboticsSources(sess.inputSources || []);
  const leftPad = sources.find((source) => source.handedness === "left" && source.gamepad);
  if (!leftPad) {
    if (!leftYMissingSince) leftYMissingSince = now;
    return null;
  }
  leftYMissingSince = 0;
  const physical = mapDimosController(leftPad.gamepad, { physical: true });
  const pressed = !!physical.buttons[5];
  // Disable/session entry requires a neutral sample before a fresh engage gesture.
  if (yAwaitRelease) {
    profileY.clear();
    yAwaitRelease = pressed;
    yInputDebug = { ...yInputDebug, sampledAt: Math.round(now), pressed };
    return null;
  }
  const action = profileY.sample(pressed, now, ySampleStatus(profile));
  yInputDebug = { ...yInputDebug, sampledAt: Math.round(now), pressed,
    ...(action ? { action, actionAt: Math.round(now) } : {}) };
  return action;
}

function applyLeftYAction(action, profile, sess) {
  if (!action || homeAndDisarmPromise) return;
  // A rejected/unknown action must never fall through into Activate.
  if (action !== "tap" && action !== "session_reset") {
    handleProfileY("reset_unavailable", profile);
    return;
  }
  if (action === "session_reset") {
    void requestDimosHomeAndDisarm().catch(error => {
      setStatus("error", `Robot disarmed; Home was not confirmed: ${error?.message || error}`);
    });
    return;
  }
  if (action === "tap" && (!armed || !yFollowActive)) {
    teleopHeading.clear();
    pendingYStart = true;
    if (!armed) setDimosTeleopArmed(true, sess);
    lastHudAction = "CALIBRATE";
    notify();
    return;
  }
  handleProfileY(action, profile);
}

const START_POSITION_KEY = "render3d:robot-start-position:v1";

function readStartingPosition() {
  try {
    const raw = globalThis.localStorage?.getItem(START_POSITION_KEY);
    if (!raw) return null; // Pi's guarded default startup remains authoritative until the user saves a profile.
    const value = JSON.parse(raw);
    if (value?.type === "emote" && value.id) return value;
    if (value?.type === "home") return { type: "home", id: "home", name: "Home" };
  } catch { /* use Home */ }
  return null;
}

async function applyStartingPosition(profile, signal) {
  if (!profile) return true;
  const start = readStartingPosition();
  if (!start) return true;
  lastHudAction = "START POSE";
  notify();
  if (start.type === "emote") {
    await requestPiTeleop(profile, "/emote/play", { body: { id: start.id }, signal });
  } else {
    await runGuardedHome({
      signal,
      request: (path, options) => requestPiTeleop(profile, path, options),
    });
  }
  emitPiAction({ action: "starting_position_applied", position: start });
  return true;
}

async function flushPendingYStart() {
  if (!pendingYStart || !armed) return;
  const profile = roboticsIntegratedProfile();
  if (startingPositionReady) {
    if (!yPoseSocketOpen()) return;
    pendingYStart = false;
    postProfileY("tap", profile, { freshPoses: true });
    return;
  }
  if (startingPositionTask) return;
  const sock = ws, generation = connectGeneration;
  const controller = new AbortController(); startingPositionController = controller;
  const task = applyStartingPosition(profile, controller.signal);
  startingPositionTask = task;
  try {
    await task;
    if (!controller.signal.aborted && armed && ws === sock && connectGeneration === generation) startingPositionReady = true;
  } catch (error) {
    if (controller.signal.aborted || !armed || ws !== sock || connectGeneration !== generation) return;
    pendingYStart = false;
    setStatus("error", `Starting position failed; robot remains stopped: ${error?.message || error}`);
    emitPiAction({ action: "starting_position_failed", error: error?.message || String(error) });
  } finally {
    if (startingPositionTask === task) startingPositionTask = null;
    if (startingPositionController === controller) startingPositionController = null;
  }
}

/** XR enter / leave: hard-off. Never persist armed across a session boundary. */
export function resetDimosTeleopOnXrBoundary() {
  armed = false;
  pendingYStart = false;
  clearProfileControls();
  menuTriggerOwnership.reset();
  menuSelectActive.clear();
  presenting = false;
  connectAttempts = 0;
  lastEnsureStatus = "";
  lastCoordinator = null;
  ensureInFlight = null;
  coordinatorWait = null;
  clearReconnect();
  stopDimosCoordinatorWatch();
  detachSessionListeners();
  closeSocket();
  leftPrimaryHeld = false;
  rightPrimaryHeld = false;
  resetDimosViewer();
  setDimosStudioUiOverride({});
  setStatus("off");
}

/** XR hot path: false until Activate. */
export function shouldRunDimosTeleopWork({ armed: armedFlag = armed } = {}) {
  return armedFlag === true;
}

export function onDimosTeleopChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function clearReconnect() {
  if (reconnectTimer) {
    try { clearTimeout(reconnectTimer); } catch { /* ignore */ }
    reconnectTimer = 0;
  }
}

function closeSocket(reason = "") {
  clearReconnect();
  const sock = ws;
  ws = null;
  if (sock) {
    try { sock.onopen = null; sock.onclose = null; sock.onerror = null; sock.onmessage = null; } catch { /* ignore */ }
    try { sock.close(); } catch { /* ignore */ }
  }
  leftPrimaryHeld = false;
  rightPrimaryHeld = false;
  if (reason) statusDetail = reason;
}

function setStatus(key, detail = "") {
  statusKey = key;
  statusDetail = detail || "";
  notify();
  if (key === "error" || key === "disconnected") {
    const debug = getDimosNetworkDebug();
    globalThis.dispatchEvent?.(new CustomEvent("render3d:robotics-debug", {
      detail: {
        source: "vr-enable",
        at: new Date().toISOString(),
        status: key,
        message: statusDetail || STATUS[key] || key,
        transport: debug.transport,
        target: debug.target,
        socketState: debug.socketState,
        closeCode: debug.closeCode,
        closeReason: debug.closeReason,
        profileVersion: debug.profileStatus?.version || debug.profileStatus?.service_version || "unknown",
        yMap: debug.y?.liveMap || debug.y?.profileMap || "unknown",
      },
    }));
  }
}

function shouldStream() {
  return armed && presenting;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Safe start: POST ensure-coordinator if :8443 is down. Never arms, never kills. */
export function ensureDimosCoordinatorIfDown({ session = null } = {}) {
  if (roboticsOwnsExternalSession()) return Promise.resolve({status:"external-profile"});
  return kickCoordinator(session);
}

export async function ensureDimosCoordinator({ headset = "", session = null } = {}) {
  const payload = dimosEnsurePayload(session);
  const id = String(headset || payload.headset || "quest");
  lastHeadset = id;
  if (typeof fetch !== "function") {
    return { ok: false, status: "unknown", headset: id, blueprint: dimosBlueprintForHeadset(id) };
  }
  try {
    const res = await fetch(DIMOS_ENSURE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        headset: id,
        blueprint: payload.blueprint || dimosBlueprintForHeadset(id),
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: !!res.ok, headset: id, ...data };
  } catch (err) {
    return { ok: false, status: "unknown", headset: id, error: err?.message || "ensure failed" };
  }
}

export async function fetchDimosCoordinatorStatus() {
  if (typeof fetch !== "function") return { up: false };
  try {
    const res = await fetch(DIMOS_COORDINATOR_PATH);
    const data = await res.json();
    if (!data || typeof data !== "object" || data.detail || data.port == null && data.up == null) {
      return { up: false };
    }
    return data;
  } catch {
    return { up: false };
  }
}

export function selectDimosRobot(id = DIMOS_OPENARM_ROBOT_ID) {
  selectedRobotId = String(id || DIMOS_OPENARM_ROBOT_ID);
  notify();
  return selectedRobotId;
}

function coordinatorRobotFields(coord = lastCoordinator) {
  const st = coord && typeof coord === "object" ? coord : {};
  const mode = inferDimosHardwareMode({
    coordinatorMode: st.hardware_mode,
    teleopStatus: profileTeleopStatus,
    wsUrl: resolveDimosWsUrl(),
  });
  const piLive = isDimosRobotLanHost(resolveDimosWsUrl());
  const recognized = mode === "can"
    ? true
    : !!(st.recognized || st.up || st.process);
  return {
    robotId: st.robot_id || DIMOS_OPENARM_ROBOT_ID,
    robotName: st.robot || DIMOS_OPENARM_ROBOT_NAME,
    hardwareId: st.hardware_id || DIMOS_OPENARM_ROBOT_ID,
    hardwareMode: mode,
    recognized: mode === "mock" ? false : (recognized || piLive),
    selectedRobot: selectedRobotId,
    coordinatorUp: !!st.up || piLive,
    coordinatorProcess: !!st.process,
    coordinatorPids: Array.isArray(st.pids) ? st.pids : [],
    yFollow: !!yFollowActive,
  };
}

export async function refreshDimosCoordinatorWatch() {
  lastCoordinator = await fetchDimosCoordinatorStatus();
  notify();
  return lastCoordinator;
}

export function startDimosCoordinatorWatch() {
  if (roboticsOwnsExternalSession() || roboticsIntegratedProfile()) return;
  if (coordTimer) return;
  void refreshDimosCoordinatorWatch();
  try {
    coordTimer = setInterval(() => {
      void refreshDimosCoordinatorWatch();
    }, COORDINATOR_POLL_MS);
  } catch {
    /* node tests */
  }
}

export function stopDimosCoordinatorWatch() {
  if (coordTimer) {
    try { clearInterval(coordTimer); } catch { /* ignore */ }
    coordTimer = 0;
  }
}

async function waitUntilCoordinatorThenConnect() {
  setStatus("connecting", "starting DIMOS");
  const deadline = Date.now() + COORDINATOR_WAIT_MS;
  try {
    while (Date.now() < deadline && shouldStream()) {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      const st = await fetchDimosCoordinatorStatus();
      if (st?.up) {
        connectAttempts = 0;
        connectSocket();
        return;
      }
      await sleepMs(START_CONNECT_DELAY_MS);
    }
    if (shouldStream() && !(ws && ws.readyState === WebSocket.OPEN)) {
      connectAttempts = 0;
      connectSocket();
    }
  } finally {
    coordinatorWait = null;
  }
}

function kickCoordinator(session) {
  if (roboticsIntegratedProfile()) {
    return Promise.resolve({status:"profile-ready"});
  }
  if (ensureInFlight) return ensureInFlight;
  const headset = detectDimosHeadset({ session });
  lastHeadset = headset;
  ensureInFlight = ensureDimosCoordinator({ headset, session }).then((info) => {
    lastEnsureStatus = String(info?.status || "");
    notify();
    if (!shouldStream()) return info;
    const busy = !!(ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING));
    if (busy) return info;
    if (info?.status === "starting" || info?.status === "already_running") {
      if (!coordinatorWait) coordinatorWait = waitUntilCoordinatorThenConnect();
    }
    return info;
  }).finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

export function applyDimosRobotPcHost(raw) {
  const hint = colocatedDimosHint();
  const incoming = String(raw || "").trim() || resolveDimosWsUrl() || hint || DIMOS_WS_DEFAULT;
  const next = persistDimosWsUrl(incoming);
  const policy = dimosConnectPolicy(undefined, next);
  if (!policy.canProxy) {
    setStatus("error", policy.reason || "DimOS host is not a LAN address");
    return next;
  }
  if (armed) {
    closeSocket();
    connectAttempts = 0;
    if (shouldStream()) connectSocket();
    else setStatus("armed");
  } else {
    notify();
  }
  return next;
}

async function connectSocket() {
  if (roboticsOwnsExternalSession()) return;
  if (!shouldStream()) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const upstreamUrl = dimosQuestWsUrl(resolveDimosWsUrl());
  const integratedProfile = roboticsIntegratedProfile();
  if (!upstreamUrl || isStudioDimosPipeUrl(upstreamUrl)) {
    const policy = dimosConnectPolicy(undefined, resolveDimosWsUrl());
    setStatus("error", policy.reason || "DimOS host is not a LAN address");
    return;
  }
  connectAttempts += 1;
  const gen = ++connectGeneration;
  setStatus("connecting");
  networkDebug = { ...networkDebug, socketState: "resolving", target: upstreamUrl, lastError: "" };

  let url = upstreamUrl;
  if (integratedProfile) {
    try {
      url = await openPiTeleopWebSocketRelay(integratedProfile, "/ws");
    } catch (error) {
      if (gen !== connectGeneration) return;
      const detail = error?.message || "Could not authenticate the Pi relay";
      networkDebug = { ...networkDebug, transport: "relay-error", socketState: "error", errors: networkDebug.errors + 1, lastError: detail };
      setStatus("error", detail);
      return;
    }
    if (gen !== connectGeneration || !shouldStream()) return;
    networkDebug = { ...networkDebug, transport: "studio-relay", target: upstreamUrl };
  } else {
    networkDebug = { ...networkDebug, transport: "direct-lan", target: upstreamUrl };
  }

  let sock;
  try {
    sock = new WebSocket(url);
  } catch (err) {
    setStatus("error", err?.message || "invalid WebSocket URL");
    return;
  }
  ws = sock;
  sock.binaryType = "arraybuffer";

  sock.onmessage = (ev) => {
    if (gen !== connectGeneration || ws !== sock) return;
    if (typeof ev?.data === "string" && roboticsIntegratedProfile()) {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "teleop_status" || msg.type === "hello") {
          networkDebug = { ...networkDebug, statusAt: Math.round(performance.now()) };
          acceptProfileStatus(msg);
        }
        if (msg.type === 'episode_status') {
          ingestDimosViewerMessage(ev.data);
          piRecordPulse.acknowledge(msg.state === 'recording');
          piDiscardPulse.acknowledge(msg.state === 'recording');
          emitPiAction({
            action: 'recording_status', state: msg.state,
            recording: msg.state === 'recording', discarded: msg.last_event === 'discard', name: msg.name || msg.take || '',
          });
          notify(); return;
        }
        const uiAction=piServerUiAction(msg);
        if(uiAction)handlePiSavedTake(uiAction);
      } catch {}
    }
    const rec = getDimosRecordState();
    if (!shouldIngestDimosJpeg({ armed, recording: !!rec?.recording, playing: !!rec?.playing })) return;
    try {
      const data = ev?.data;
      if (typeof data === "string") ingestDimosViewerMessage(data);
    } catch { /* ignore */ }
  };

  sock.onopen = () => {
    if (gen !== connectGeneration || ws !== sock) return;
    connectAttempts = 0;
    statusDetail = "";
    setDimosViewerOffline(false);
    setStatus("connected");
    networkDebug = { ...networkDebug, socketState: "open", opens: networkDebug.opens + 1, lastError: "", closeCode: 0, closeReason: "" };
    notePiControlDebug("socket", { state: "open" });
    const profile = roboticsIntegratedProfile();
    if (profile) refreshProfileStatus(profile, sock, gen);
  };
  sock.onerror = () => {
    if (gen !== connectGeneration) return;
    networkDebug = { ...networkDebug, socketState: "error", errors: networkDebug.errors + 1, lastError: "WebSocket error" };
    notePiControlDebug("socket", { state: "error", error: "WebSocket error" });
    /* onclose follows with the real result */
  };
  sock.onclose = (ev) => {
    if (gen !== connectGeneration) return;
    if (ws === sock) ws = null;
    networkDebug = { ...networkDebug, socketState: "closed", closes: networkDebug.closes + 1, closeCode: Number(ev?.code) || 0, closeReason: String(ev?.reason || ""), lastError: String(ev?.reason || networkDebug.lastError || "") };
    notePiControlDebug("socket", { state: "closed", code: ev?.code, error: ev?.reason || "" });
    // Keep live firmware capabilities and an in-progress Y hold: HTTP reset
    // must still work if the pose socket drops while the user is holding Y.
    piRecordPulse.clear(); piSaveIntent=null; piQueuedStop=false; piSaveSeen.clear(); yFollowActive=false;
    leftPrimaryHeld = false;
    rightPrimaryHeld = false;
    setDimosViewerOffline(true);
    if (!armed) {
      setStatus("off");
      return;
    }
    if (!presenting) {
      setStatus("armed");
      return;
    }
    const { host } = parseDimosHost(upstreamUrl);
    const why = ev?.code === 1008
      ? "another Quest client is already connected"
      : (ev?.reason || (integratedProfile
        ? `Studio relay could not reach ${host}:8443. Check the Pi connection in Robotics, then tap Y.`
        : `Quest could not open ${url}. Trust https://${host}:8443/teleop or http://${host}:8450/trust once, then tap Y.`));
    // MAX_CONNECT_ATTEMPTS is 1 — never retry. DIMOS down must not reconnect-storm.
    if (connectAttempts < MAX_CONNECT_ATTEMPTS && shouldStream()) {
      setStatus("connecting", "retrying once");
      reconnectTimer = setTimeout(() => {
        reconnectTimer = 0;
        if (shouldStream()) connectSocket();
      }, 1200);
      return;
    }
    clearReconnect();
    setStatus("error", why);
  };
}

function sendBytes(bytes) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !bytes) return false;
  try {
    ws.send(bytes);
    networkDebug = { ...networkDebug, packets: networkDebug.packets + 1 };
    return true;
  } catch {
    return false;
  }
}

function sendRecordedFrame(frame, nowMs) {
  if (!frame) return;
  const t = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (frame.leftPose) sendPose("left", frame.leftPose, t);
  if (frame.rightPose) sendPose("right", frame.rightPose, t);
  if (frame.leftJoy) sendJoyMsg("left", frame.leftJoy.axes, frame.leftJoy.buttons, t);
  if (frame.rightJoy) sendJoyMsg("right", frame.rightJoy.axes, frame.rightJoy.buttons, t);
}

function sendPose(handedness, poseLike, nowMs) {
  if (homeAndDisarmPromise || teleopStop.blocksMotion()) return;
  sendBytes(encodePoseStamped({ frameId: handedness, nowMs, ...poseLike }));
}

function sendJoyMsg(handedness, axes, buttons, nowMs) {
  if (homeAndDisarmPromise || teleopStop.blocksMotion()) return;
  sendBytes(encodeJoy({ frameId: handedness, axes, buttons, nowMs }));
}

function detachSessionListeners() {
  if (!sessionListeners) return;
  const { session, onSelectStart, onSelectEnd } = sessionListeners;
  try { session.removeEventListener("selectstart", onSelectStart); } catch { /* ignore */ }
  try { session.removeEventListener("selectend", onSelectEnd); } catch { /* ignore */ }
  sessionListeners = null;
  handSelectActive.clear();
}

function attachSessionListeners(session) {
  detachSessionListeners();
  if (!armed || !session) return;
  const onSelectStart = (event) => {
    const { handedness, hand } = event.inputSource || {};
    const gate = dimosUiGateForHand(handedness);
    if (!dimosShouldForwardSelect(gate)) return;
    if (hand && (handedness === "left" || handedness === "right")) {
      handSelectActive.set(handedness, true);
    }
  };
  const onSelectEnd = (event) => {
    const { handedness, hand } = event.inputSource || {};
    if (hand && (handedness === "left" || handedness === "right")) {
      handSelectActive.set(handedness, false);
    }
  };
  session.addEventListener("selectstart", onSelectStart);
  session.addEventListener("selectend", onSelectEnd);
  sessionListeners = { session, onSelectStart, onSelectEnd };
}

export function setDimosTeleopPresenting(on, session = null) {
  const next = !!on;
  if (!armed) {
    if (presenting) {
      presenting = false;
      detachSessionListeners();
      closeSocket();
      connectAttempts = 0;
      setStatus("off");
    }
    return;
  }
  if (presenting === next) {
    if (next && session) attachSessionListeners(session);
    // XR marks the session as presenting before the first Y activation. When
    // Y later arms teleop, this branch must open the pose socket instead of
    // returning with only the HTTP command path available.
    if (next && shouldStream()) connectSocket();
    return;
  }
  presenting = next;
  if (!presenting) {
    detachSessionListeners();
    clearProfileControls();
    closeSocket();
    connectAttempts = 0;
    setStatus("armed");
    return;
  }
  attachSessionListeners(session);
  connectAttempts = 0;
  kickCoordinator(session);
  connectSocket();
}

export function setDimosTeleopArmed(on, session = null) {
  if (on && homeAndDisarmPromise) return;
  if (!on) homeAndDisarmController?.abort();
  const profile = readRoboticsProfile();
  if (on && roboticsOwnsExternalSession(profile)) {
    // The Pi owns the only /ws client. Stop our socket before handing over.
    setDimosTeleopArmed(false);
    globalThis.dispatchEvent?.(new CustomEvent("render3d:robotics-launch", {detail: {url: roboticsLaunchUrl(profile)}}));
    return;
  }
  const next = !!on;
  if (armed === next) {
    if (!next) {
      presenting = false;
      detachSessionListeners();
    } else if (session) {
      setDimosTeleopPresenting(true, session);
    } else {
      kickCoordinator(session);
    }
    return;
  }
  armed = next;
  connectAttempts = 0;
  clearReconnect();
  if (!armed) {
    clearProfileControls();
    menuTriggerOwnership.reset();
    menuSelectActive.clear();
    presenting = false;
    lastEnsureStatus = "";
    detachSessionListeners();
    closeSocket();
    stopDimosCoordinatorWatch();
    setStatus("off");
    return;
  }
  startDimosCoordinatorWatch();
  kickCoordinator(session);
  if (session) {
    setDimosTeleopPresenting(true, session);
    return;
  }
  if (!presenting) {
    setStatus("armed");
    return;
  }
  connectSocket();
}

/** Idle-frame input only: no pose work, connection or control ownership until a Y tap. */
export function pollDimosYControl({ renderer, session = null } = {}) {
  const sess = session || renderer?.xr?.getSession?.() || null;
  if (!sess) return;
  const profile = roboticsIntegratedProfile();
  applyLeftYAction(samplePhysicalLeftY(sess, performance.now(), profile), profile, sess);
}

export function tickDimosTeleop({ renderer, session = null } = {}) {
  const rec = recordMode === "recording" || recordMode === "playing" || recordMode === "looping";
  const sess = session || renderer?.xr?.getSession?.() || null;
  if (!sess) {
    if (presenting) setDimosTeleopPresenting(false);
    return;
  }
  const now = performance.now();
  const profile = roboticsIntegratedProfile();
  // XR enter clears Activate. Left Y must still arm + start — it is not Studio laser (right B).
  if (!shouldRunDimosTeleopWork({ armed }) && !rec) {
    pollDimosYControl({ renderer, session: sess });
    return;
  }
  if (armed && !presenting) setDimosTeleopPresenting(true, sess);

  let frame = null, refSpace = null;
  try { frame = renderer?.xr?.getFrame?.() || null; } catch {}
  try { refSpace = renderer?.xr?.getReferenceSpace?.() || null; } catch {}
  if (profile && armed) {
    if (refSpace) teleopHeading.transform(null, refSpace);
    if (teleopHeading.invalidated()) {
      setDimosTeleopArmed(false);
      setStatus('error', 'VR reference space changed. Robot pose streaming stopped. Face your working direction and tap Y to start again.');
      return;
    }
    if (!teleopHeading.ready() && frame && refSpace) {
      try { teleopHeading.capture(frame.getViewerPose(refSpace)?.transform, refSpace); } catch {}
    }
  }

  const sources = preferredRoboticsSources(sess.inputSources || []);
  const leftPad = sources.find(source => source.handedness === 'left' && source.gamepad);
  // Stop has priority over replay, UI handlers and editable legacy bindings.
  // Missing tracking is not a button release; sample only the physical pad.
  if (leftPad && (profileUsesYCommands(profile) || profile || dimosYCommandUrl(profile) || pendingYStart)) {
    applyLeftYAction(samplePhysicalLeftY(sess, now, profile), profile, sess);
  }
  if (profile && armed && !teleopHeading.ready()) return;
  if (piRecordPulse.timedOut(now)) {
    piSaveIntent=null; piQueuedStop=false;
    setStatus('error','The Pi did not confirm the recording change. Check its recorder before trying again.');
  }
  if (piDiscardPulse.timedOut(now)) setStatus('error','The Pi did not confirm the recording discard. Check its recorder before trying again.');
  if (piQueuedStop && !piRecordPulse.busy() && getDimosViewerSnapshot().episode?.state==='recording') {
    piQueuedStop=false; requestPiRecording(false);
  }
  if (piSaveIntent && now>piSaveIntent.deadline) {
    piSaveIntent=null; setStatus('error','The Pi did not confirm a saved take. Check Emotes before recording again.');
  }
  const canSend = !!(ws && ws.readyState === WebSocket.OPEN);
  const replaying = recordMode === "playing" || recordMode === "looping";
  const shouldSend = canSend && !homeAndDisarmPromise && !teleopStop.blocksMotion() && now - lastSendTime >= SEND_INTERVAL_MS;
  if (shouldSend) lastSendTime = now;

  if (replaying) {
    const elapsed = now - playStartedAt;
    const dur = clipDurationMs();
    if (recordMode === "playing" && elapsed >= dur) {
      const frame = recordBuf[recordBuf.length - 1];
      if (shouldSend) sendRecordedFrame(frame, Date.now());
      recordMode = "idle";
      notify();
      return;
    }
    if (shouldSend) sendRecordedFrame(frameAtElapsed(elapsed), Date.now());
    notePosePacket(now, { left: true, right: true });
    return;
  }

  let sawLeft = false;
  let sawRight = false;
  const nowMs = Date.now();
  const live = { t: now - (recordStartedAt || now), leftPose: null, rightPose: null, leftJoy: null, rightJoy: null };

  const grips = [
    renderer?.xr?.getControllerGrip?.(0),
    renderer?.xr?.getControllerGrip?.(1),
  ];

  const controllerHands = new Set(sources.filter(source=>source.gamepad).map(source=>source.handedness));
  piUi.retainHands(controllerHands);
  if (!controllerHands.has('right')) piRecordPulse.clear();
  const hasLeftPad = sources.some(source => source.handedness === "left" && source.gamepad);
  if (!hasLeftPad) {
    // Keep an in-progress 2s hold across Quest gamepad dropouts. Never treat a
    // missing pad as Y-up — that used to restart the timer and swallow hold-reset.
    if (!leftYMissingSince) leftYMissingSince = now;
  } else leftYMissingSince = 0;
  for (const inputSource of sources) {
    const handedness = inputSource.handedness;
    if (handedness !== "left" && handedness !== "right") continue;
    const gamepad = inputSource.gamepad;
    const controller = looksLikeController(gamepad);
    const hand = inputSource.hand;

    if (hand && !controller) {
      let poseLike = null;
      if (frame && refSpace && typeof frame.getJointPose === "function") {
        const wristPose = frame.getJointPose(hand.get("wrist"), refSpace);
        const thumbTipPose = frame.getJointPose(hand.get("thumb-tip"), refSpace);
        const middleTipPose = frame.getJointPose(hand.get("middle-finger-tip"), refSpace);
        poseLike = poseFromXrPose(wristPose);
        if (profile) poseLike = teleopHeading.transform(poseLike, refSpace);
        const gate = dimosUiGateForHand(handedness);
        const uiWins = menuTriggerOwnership.sample(handedness, {armed, pressed: !!handSelectActive.get(handedness) || menuSelectActive.has(handedness), uiHit: studioUiOverridesDimosSelect(gate)});
        const primary = !uiWins && !!handSelectActive.get(handedness);
        if (handedness === "left") sawLeft = sawLeft || primary;
        else sawRight = sawRight || primary;
        const thumb = thumbTipPose?.transform?.position;
        const middle = middleTipPose?.transform?.position;
        const pinched = !uiWins && !!(thumb && middle) && Math.hypot(
          thumb.x - middle.x,
          thumb.y - middle.y,
          thumb.z - middle.z,
        ) < GRIPPER_PINCH_DISTANCE_METERS;
        const joy = {
          axes: [0, 0, pinched ? 1 : 0, 0],
          buttons: [0, 0, 0, 0, primary ? 1 : 0, 0, 0],
        };
        if (handedness === "left") {
          live.leftPose = poseLike;
          live.leftJoy = joy;
        } else {
          live.rightPose = poseLike;
          live.rightJoy = joy;
        }
        if (shouldSend && poseLike && armed) {
          sendPose(handedness, poseLike, nowMs);
          sendJoyMsg(handedness, joy.axes, joy.buttons, nowMs);
        }
      }
      continue;
    }

    let mapped = null;
    if (gamepad) {
      mapped = mapDimosControllerForHand(gamepad, handedness);
      // Merge physical squeeze onto gripper analog before Pi UI zeroes grip
      // (Studio window grab). Empty visor overlay is not a UI hit.
      if (armed) applyGripperClose(mapped, handedness, now);
      if (profile && armed) {
        piUi.setState({recording: !!getDimosRecordState().recording || piRecordPulse.busy()});
        piUi.sample(handedness, mapped, now);
      }
      if (handedness === 'left' && (armed || profileY.holdProgress(now) > 0) && (profileUsesYCommands(profile) || !!profile || !!dimosYCommandUrl(profile))) {
        mapped.buttons[5] = 0;
      }
      if (profile && handedness === 'right') {
        mapped.buttons[4] = piRecordPulse.sample(mapped.buttons[4], now, shouldSend);
        mapped.buttons[5] = piDiscardPulse.sample(mapped.buttons[5], now, shouldSend);
      }
      // Only legacy Studio bindings use X+A as a deadman. The Pi profile's
      // right A is Record/Save and must never be synthesized by Y follow.
      if (!profile && yFollowActive && currentHardwareMode() !== 'mock') mapped.buttons[4] = 1;
      mapped.primary = !!mapped.buttons[4];
    }

    let poseLike = null;
    if (frame && refSpace) {
      const space = inputSource.gripSpace || inputSource.targetRaySpace;
      if (space) poseLike = poseFromXrPose(frame.getPose(space, refSpace));
    }
    if (profile) poseLike = teleopHeading.transform(poseLike, refSpace);
    if (!poseLike && !profile) {
      const grip = grips.find(g => (g?.userData?.inputSource?.handedness || g?.userData?.handedness) === handedness);
      if (grip?.matrixWorld) poseLike = poseFromMatrix(grip.matrixWorld);
    }
    if (gamepad) {
      if (handedness === "left") sawLeft = sawLeft || mapped.primary;
      else sawRight = sawRight || mapped.primary;
      if (handedness === "left") {
        live.leftPose = poseLike;
        live.leftJoy = { axes: mapped.axes, buttons: mapped.buttons };
      } else {
        live.rightPose = poseLike;
        live.rightJoy = { axes: mapped.axes, buttons: mapped.buttons };
      }
      if (shouldSend && armed) {
        if (poseLike) sendPose(handedness, poseLike, nowMs);
        sendJoyMsg(handedness, mapped.axes, mapped.buttons, nowMs);
      }
    } else if (shouldSend && armed && poseLike) {
      sendPose(handedness, poseLike, nowMs);
      if (handedness === "left") live.leftPose = poseLike;
      else live.rightPose = poseLike;
    } else if (handedness === "left") live.leftPose = poseLike;
    else live.rightPose = poseLike;
  }

  // Engage only after both current poses reached this socket in the same heading frame.
  if (shouldSend && live.leftPose && live.rightPose && pendingYStart && armed) void flushPendingYStart();
  const recState = getDimosRecordState();
  if (armed || recordMode === "recording" || recState.recording) {
    lastTrainingFrame = { ...live };
  }
  if (recordMode === "recording" && (live.leftPose || live.rightPose)) {
    recordBuf.push(live);
    if (recordBuf.length > 80 * 120) recordBuf.shift();
    notifyRecordFrame(live);
  } else if (recState.recording && (live.leftPose || live.rightPose)) {
    notifyRecordFrame(live);
  }
  if (live.leftPose || live.rightPose) {
    notePosePacket(now, { left: !!live.leftPose, right: !!live.rightPose });
  }

  const prevL = leftPrimaryHeld;
  const prevR = rightPrimaryHeld;
  leftPrimaryHeld = sawLeft;
  rightPrimaryHeld = sawRight;
  if (prevL !== sawLeft || prevR !== sawRight) notify();
}

function robotPickerLabel(snap) {
  if (snap.hardwareMode === "mock") return "mock / no CAN";
  if (snap.hardwareMode === "can") return snap.recognized || snap.connected ? "Connected (CAN)" : "CAN";
  if (snap.coordinatorProcess) return "Starting";
  return "Off";
}

function syncRobotPicker(snap) {
  if (!panelEls) return;
  const { pickerModeEl, robotCard, robotDetail } = panelEls;
  if (pickerModeEl) pickerModeEl.textContent = robotPickerLabel(snap);
  if (robotCard) {
    const selected = snap.selectedRobot === DIMOS_OPENARM_ROBOT_ID;
    robotCard.classList.toggle("is-selected", selected);
    robotCard.classList.toggle("is-connected", !!snap.recognized);
    robotCard.setAttribute("aria-pressed", selected ? "true" : "false");
  }
  if (robotDetail) {
    robotDetail.textContent = snap.hardwareMode === "can"
      ? "CAN"
      : snap.hardwareMode === "mock"
        ? "mock / no CAN — Y will not move hardware"
        : "checking hardware";
  }
}

function syncPanel(snap) {
  syncDimosViewerDom(snap);
  if (!panelEls) return;
  const { statusEl, toggleBtn, urlInput, hintEl, chartEl, recordBtn, stopBtn, playBtn, loopBtn } = panelEls;
  if (statusEl) {
    statusEl.textContent = snap.statusKey === 'error' ? snap.label : dimosHardwareStatusLabel(snap);
    statusEl.dataset.dimosStatus = snap.hardwareMode === "mock" ? "mock" : snap.statusKey;
  }
  syncRobotPicker(snap);
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-pressed", armed ? "true" : "false");
    toggleBtn.textContent = armed ? "Turn off" : "Activate";
  }
  if (urlInput && document.activeElement !== urlInput) {
    const profile = readRoboticsProfile();
    urlInput.value = roboticsOwnsExternalSession(profile) ? (profile.profile.controllers?.websocket || profile.profile.websocket || "") : snap.wsUrl;
  }
  if (recordBtn) {
    recordBtn.setAttribute("aria-pressed", snap.recording ? "true" : "false");
    recordBtn.textContent = snap.recording ? "Recording…" : "Record";
  }
  if (loopBtn) {
    loopBtn.setAttribute("aria-pressed", snap.looping ? "true" : "false");
  }
  if (roboticsIntegratedProfile()) {
    if (stopBtn) stopBtn.textContent='Save take';
    if (playBtn) playBtn.textContent='Emotes';
    if (loopBtn) loopBtn.textContent='Saved loops';
  } else {
    if (stopBtn) stopBtn.textContent='Stop';
    if (playBtn) playBtn.textContent='Play';
    if (loopBtn) loopBtn.textContent='Loop';
  }
  if (playBtn) playBtn.disabled = roboticsIntegratedProfile() ? !armed || !presenting : !snap.hasClip && !snap.playing;
  if (chartEl) paintDesktopDimosChart(chartEl, snap.stats);
  if (hintEl) {
    const selectedProfile = readRoboticsProfile();
    if (roboticsIntegratedProfile(selectedProfile)) {
      hintEl.textContent = "VR Studio owns the Pi controller connection. Enable Robotics turns on passthrough. Point and trigger-click a menu to disable; other controls route to the Pi using the saved profile.";
    } else if (roboticsOwnsExternalSession(selectedProfile)) {
      hintEl.textContent = "DimOS Quest OpenArm profile: Activate opens the Pi’s passthrough UI. Y tap calibrates + activates, pauses, or reactivates · Y hold Home/reset · A Record / Stop + Save · B Discard · X Data Sets · triggers = jaw. Studio does not open a second control socket.";
    } else if (!armed && snap.hardwareMode === "mock") {
      hintEl.textContent = "Open Arm is mock / no CAN — Y will not move hardware. On the Pi run teleop-quest-openarm --left-can-port can1 --right-can-port can0.";
    } else if (!armed && snap.recognized) {
      hintEl.textContent = `Open Arm recognized (${snap.hardwareMode === "can" ? "CAN" : "Pi"}). Activate or Enable Robotics, then tap Y to start the arms.`;
    } else if (!armed) {
      hintEl.textContent = "Teleop stays off until you Activate (desktop) or Enable Robotics (Quest HUD). That turns on the full DimOS viewer (status, connect, streams). Studio starts dimos run teleop-quest-openarm if :8443 is down.";
    } else if (snap.policy?.cloud) {
      hintEl.textContent = snap.policy.cloudCopy;
    } else if (lastEnsureStatus === "starting" || lastEnsureStatus === "already_running") {
      hintEl.textContent = "Starting the DIMOS coordinator on this machine… stay in Studio (no :8443/teleop tab).";
    } else if (!presenting) {
      hintEl.textContent = roboticsIntegratedProfile() ? "Enter VR. Y calibrate + activate · A Record / Stop + Save · B Discard · X Data Sets." : "Robot mode is armed. Enter VR, then tap Y to calibrate and engage.";
    } else if ((snap.statusKey === "error" || snap.statusKey === "disconnected") && snap.recognized) {
      hintEl.textContent = snap.hardwareMode === "mock"
        ? "Open Arm is mock / no CAN — Y will not move hardware."
        : "Open Arm is up but Quest could not open wss://<Pi>:8443/ws. Trust the Pi cert once, then tap Y.";
    } else if (snap.statusKey === "error" || snap.statusKey === "disconnected") {
      hintEl.textContent = "Quest opens wss://192.168.1.77:8443/ws on this Wi-Fi (not through Cloudflare). Trust https://192.168.1.77:8443/teleop once, then tap Y to start the arms.";
    } else if (snap.statusKey === "engaged") {
      hintEl.textContent = "ENGAGED — A Record / Stop + Save · B Discard · Y tap Pause · Y hold Reset.";
    } else if (snap.statusKey === "connected") {
      hintEl.textContent = roboticsIntegratedProfile() ? "Y calibrate + activate · A Record / Stop + Save · B Discard · X Data Sets · Grip moves Studio objects." : "Streaming poses at ~80 Hz. Tap Y to calibrate and activate.";
    } else {
      hintEl.textContent = "Connecting to the Pi on this Wi-Fi… tap Y to start the arms.";
    }
  }
}

function paintDesktopDimosChart(canvas, stats = {}) {
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return;
  const w = canvas.width || 360;
  const h = canvas.height || 88;
  ctx.fillStyle = "#0f1720";
  ctx.fillRect(0, 0, w, h);
  const samples = Array.isArray(stats.samples) ? stats.samples : [];
  if (!samples.length) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 13px Arial,sans-serif";
    const mode = inferDimosHardwareMode({
      coordinatorMode: lastCoordinator?.hardware_mode,
      teleopStatus: profileTeleopStatus,
      wsUrl: resolveDimosWsUrl(),
    });
    ctx.fillText(
      mode === "mock"
        ? "Open Arm mock / no CAN · Y will not move hardware"
        : mode === "can" ? "Open Arm CAN · tap Y to start arms" : "No teleop data · DIMOS off or not running",
      12,
      h / 2 + 4,
    );
    return;
  }
  const hz = samples.map((s) => Number(s.hz) || 0);
  const maxHz = Math.max(20, ...hz, 1);
  ctx.beginPath();
  hz.forEach((v, i) => {
    const x = 8 + (i / Math.max(1, hz.length - 1)) * (w - 16);
    const y = h - 10 - (v / maxHz) * (h - 22);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

export function bindDimosTeleopPanel() {
  const statusEl = document.getElementById("dimos-teleop-status");
  const toggleBtn = document.getElementById("btn-dimos-teleop-toggle");
  const urlInput = document.getElementById("dimos-teleop-url");
  const saveBtn = document.getElementById("btn-dimos-teleop-url-save");
  const hintEl = document.getElementById("dimos-teleop-hint");
  const chartEl = document.getElementById("dimos-teleop-chart");
  const recordBtn = document.getElementById("btn-dimos-record");
  const stopBtn = document.getElementById("btn-dimos-stop");
  const playBtn = document.getElementById("btn-dimos-play");
  const loopBtn = document.getElementById("btn-dimos-loop");
  const pickerModeEl = document.getElementById("dimos-robot-picker-mode");
  const robotCard = document.getElementById("dimos-robot-card-openarm");
  const robotDetail = document.getElementById("dimos-robot-card-openarm-detail");
  bindDimosQuestConnectUi();
  if (!statusEl && !toggleBtn) return;
  panelEls = { statusEl, toggleBtn, urlInput, hintEl, chartEl, recordBtn, stopBtn, playBtn, loopBtn, pickerModeEl, robotCard, robotDetail };
  mountDimosViewerRoots();
  document.querySelectorAll("[data-dimos-connect-pc]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const root = btn.closest("[data-dimos-viewer]");
      const input = root?.querySelector("[data-dimos-host-input]");
      applyDimosRobotPcHost(input?.value || "");
    });
  });
  document.querySelectorAll("[data-dimos-host-input]").forEach((input) => {
    if (input.dataset?.hostBound === "1") return;
    if (input.dataset) input.dataset.hostBound = "1";
    input.addEventListener("change", () => applyDimosRobotPcHost(input.value || ""));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyDimosRobotPcHost(input.value || "");
      }
    });
  });
  // Do not poll /api/dimos/coordinator on every page load. That tick used to
  // refresh robot artifacts on every tab and starve login + /api/projects.
  robotCard?.addEventListener("click", () => {
    startDimosCoordinatorWatch();
    selectDimosRobot(DIMOS_OPENARM_ROBOT_ID);
    void refreshDimosCoordinatorWatch();
    void ensureDimosCoordinatorIfDown();
  });
  if (urlInput) {
    urlInput.value = resolveDimosWsUrl();
    urlInput.placeholder = DIMOS_WS_DEFAULT;
  }
  toggleBtn?.addEventListener("click", () => {
    startDimosCoordinatorWatch();
    if (urlInput?.value) persistDimosWsUrl(urlInput.value);
    setDimosTeleopArmed(!armed);
  });
  saveBtn?.addEventListener("click", () => {
    persistDimosWsUrl(urlInput?.value || DIMOS_WS_DEFAULT);
    notify();
  });
  urlInput?.addEventListener("change", () => {
    persistDimosWsUrl(urlInput.value);
  });
  recordBtn?.addEventListener("click", () => startDimosRecord());
  stopBtn?.addEventListener("click", () => stopDimosRecord());
  playBtn?.addEventListener("click", () => playDimosRecord({ loop: false }));
  loopBtn?.addEventListener("click", () => {
    if (recordMode === "looping") setDimosLoop(false);
    else playDimosRecord({ loop: true });
  });
  window.addEventListener("pagehide", () => {
    closeSocket();
    if (armed) setStatus(presenting ? "disconnected" : "armed");
  });
  notify();
}

function bindDimosQuestConnectUi() {
  syncDimosQuestConnectUi();
  const copyBtn = document.querySelector("[data-robotics-quest-copy]");
  const openBtn = document.querySelector("[data-robotics-quest-open]");
  if (copyBtn && !copyBtn.dataset.bound) {
    copyBtn.dataset.bound = "1";
    copyBtn.addEventListener("click", async () => {
      const url = dimosQuestTeleopUrl();
      try {
        await navigator.clipboard?.writeText(url);
        copyBtn.textContent = "Copied";
        window.setTimeout(() => { copyBtn.textContent = "Copy"; }, 1400);
      } catch {
        copyBtn.textContent = "Copy failed";
        window.setTimeout(() => { copyBtn.textContent = "Copy"; }, 1400);
      }
    });
  }
  if (openBtn && !openBtn.dataset.bound) {
    openBtn.dataset.bound = "1";
    openBtn.addEventListener("click", () => {
      if (!isDesktopQuestOpen()) return;
      const url = dimosQuestTeleopUrl();
      try { window.open(url, "_blank", "noopener,noreferrer"); } catch { /* ignore */ }
    });
  }
}
