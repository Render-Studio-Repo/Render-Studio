/**
 * DimOS Quest teleop viewer widgets reused from
 * integrations/dimos/dimos/teleop/quest/web/static (teleop.js HUD + JPEG stream).
 * Studio mounts these on Enable Robotics — no second WebXR session, no :8443 tab.
 */

import { dimosConnectPolicy } from "./xr-dimos-lan.js?v=20260909-dimosui1-20260914-lanpc1";
import {
  displayCameraHost,
  HAND_CAM_HOTPLUG_MS,
  HAND_CAM_STATUS_PATH,
  handCamJpegUrl,
  onHandCamPrefsChange,
  persistHandCamDraft,
  persistHandCamHost,
  readHandCamPrefs,
  resolveHandCamHost,
  SAM_CAMERA_HOST_DEFAULT,
} from "./xr-hand-cams.js?v=roboticsworkspace3";

const JPEG_MAGIC = [0xff, 0xd8, 0xff];

let episodeStatus = null;
let episodeStatusReceivedAtMs = 0;
let hudOffline = true;
let videoObjectUrl = "";
let videoImg = null;
let rightVideoImg = null;
let povVideoImg = null;
let frameRequest = null;
let rightVideoUrl = "";
let povVideoUrl = "";
let leftLive = false;
let rightLive = false;
let povLive = false;
let lastHandCamStatus = null;
let camPollTimer = 0;
let camStatusTimer = 0;
const listeners = new Set();

export function onDimosViewerChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyViewer() {
  const snap = getDimosViewerSnapshot();
  listeners.forEach((fn) => {
    try { fn(snap); } catch { /* ignore */ }
  });
}

export function resetDimosViewer() {
  episodeStatus = null;
  episodeStatusReceivedAtMs = 0;
  hudOffline = true;
  stopDimosHandCamPoll();
  leftLive = false;
  rightLive = false;
  povLive = false;
  lastHandCamStatus = null;
  if (videoObjectUrl) {
    try { URL.revokeObjectURL(videoObjectUrl); } catch { /* ignore */ }
    videoObjectUrl = "";
  }
  if (rightVideoUrl) {
    try { URL.revokeObjectURL(rightVideoUrl); } catch { /* ignore */ }
    rightVideoUrl = "";
  }
  if (povVideoUrl) {
    try { URL.revokeObjectURL(povVideoUrl); } catch { /* ignore */ }
    povVideoUrl = "";
  }
  if (videoImg) videoImg.src = "";
  if (rightVideoImg) rightVideoImg.src = "";
  if (povVideoImg) povVideoImg.src = "";
  notifyViewer();
}

export function bytesLookLikeJpeg(bytes) {
  if (!bytes || bytes.length < 3) return false;
  return bytes[0] === JPEG_MAGIC[0] && bytes[1] === JPEG_MAGIC[1] && bytes[2] === JPEG_MAGIC[2];
}

export function parseDimosViewerMessage(data) {
  if (data == null) return { kind: "ignore" };
  if (typeof data === "string") {
    try {
      const msg = JSON.parse(data);
      if (msg && msg.type === "episode_status") return { kind: "episode", message: msg };
    } catch {
      return { kind: "ignore" };
    }
    return { kind: "ignore" };
  }
  let bytes = null;
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes && bytesLookLikeJpeg(bytes)) return { kind: "jpeg", bytes };
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return { kind: "blob", blob: data };
  }
  return { kind: "ignore" };
}

function collectionElapsedSeconds(status = episodeStatus, receivedAt = episodeStatusReceivedAtMs) {
  if (!status || status.state !== "recording") return 0;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const sinceUpdate = (now - (receivedAt || now)) / 1000;
  return Math.max(0, Math.floor(Number(status.elapsed_s || 0) + sinceUpdate));
}

function formatElapsed(seconds) {
  const n = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(n / 60).toString().padStart(2, "0");
  const remainder = (n % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function dimosEpisodeWidgets(status = episodeStatus, { offline = hudOffline } = {}) {
  if (!status) {
    return {
      state: offline ? "OFFLINE" : "READY",
      take: "001",
      elapsed: offline ? "--:--" : "00:00",
      saved: "000",
      discarded: "000",
      lastAction: "NONE",
    };
  }
  const saved = Number(status.episodes_saved) || 0;
  const discarded = Number(status.episodes_discarded) || 0;
  const recording = status.state === "recording";
  const last = status.last_event === "init" || !status.last_event ? "NONE" : String(status.last_event).toUpperCase();
  return {
    state: offline ? "OFFLINE" : recording ? "RECORDING" : "READY",
    take: String(saved + discarded + 1).padStart(3, "0"),
    elapsed: offline ? "--:--" : formatElapsed(collectionElapsedSeconds(status)),
    saved: String(saved).padStart(3, "0"),
    discarded: String(discarded).padStart(3, "0"),
    lastAction: last,
  };
}

export function getDimosViewerSnapshot() {
  return {
    hasVideo: leftLive || rightLive || povLive || !!videoObjectUrl || !!rightVideoUrl || !!povVideoUrl,
    leftLive,
    rightLive,
    povLive,
    videoUrl: videoObjectUrl,
    rightVideoUrl,
    povVideoUrl,
    episode: episodeStatus,
    widgets: dimosEpisodeWidgets(),
    offline: hudOffline,
    videoImage: videoImg,
    rightVideoImage: rightVideoImg,
    povVideoImage: povVideoImg,
    camStatus: lastHandCamStatus,
  };
}

export function setDimosViewerEpisode(message) {
  if (!message || message.type !== "episode_status") return getDimosViewerSnapshot();
  episodeStatus = message;
  episodeStatusReceivedAtMs = typeof performance !== "undefined" ? performance.now() : Date.now();
  hudOffline = false;
  notifyViewer();
  return getDimosViewerSnapshot();
}

export function setDimosViewerOffline(on = true) {
  hudOffline = !!on;
  notifyViewer();
}

function ensureVideoImg() {
  if (videoImg) return videoImg;
  if (typeof Image === "undefined") return null;
  videoImg = new Image();
  videoImg.alt = "DimOS camera stream";
  return videoImg;
}

export function setDimosViewerJpegBytes(bytes) {
  if (typeof Blob === "undefined" || typeof URL === "undefined") return getDimosViewerSnapshot();
  const blob = new Blob([bytes], { type: "image/jpeg" });
  return setDimosViewerVideoBlob(blob);
}

export function setDimosViewerVideoBlob(blob) {
  if (!blob || typeof URL === "undefined") return getDimosViewerSnapshot();
  const next = URL.createObjectURL(blob);
  const prev = videoObjectUrl;
  videoObjectUrl = next;
  const img = ensureVideoImg();
  if (img) img.src = next;
  if (prev) {
    try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
  }
  hudOffline = false;
  notifyViewer();
  return getDimosViewerSnapshot();
}

export function ingestDimosViewerMessage(data) {
  const parsed = parseDimosViewerMessage(data);
  if (parsed.kind === "episode") return setDimosViewerEpisode(parsed.message);
  /* JPEG from the robot WS is ignored — video is Cam IP / /api/cam/p/… */
  return getDimosViewerSnapshot();
}

export function stopDimosHandCamPoll() {
  if (camPollTimer) {
    try { globalThis.clearInterval?.(camPollTimer); } catch { /* ignore */ }
    camPollTimer = 0;
  }
  if (camStatusTimer) {
    try { globalThis.clearInterval?.(camStatusTimer); } catch { /* ignore */ }
    camStatusTimer = 0;
  }
}

function makeObjectUrl(blob) {
  if (!blob || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return "";
  try {
    return URL.createObjectURL(blob);
  } catch {
    return "";
  }
}

/** GET /status only — never POST Camera permission / TCC. Hotplug publish is another path. */
export async function refreshDimosHandCamStatus(fetchFn = globalThis.fetch) {
  const doFetch = fetchFn?.bind?.(globalThis) || fetchFn;
  if (!doFetch) return lastHandCamStatus;
  try {
    const res = await doFetch(HAND_CAM_STATUS_PATH, { cache: "no-store" });
    if (res?.ok && typeof res.json === "function") {
      lastHandCamStatus = await res.json();
    }
  } catch {
    /* keep last */
  }
  return lastHandCamStatus;
}

export function refreshDimosHandCamFrames(fetchFn = globalThis.fetch) {
  if (frameRequest) return frameRequest;
  frameRequest = fetchDimosHandCamFrames(fetchFn).finally(() => { frameRequest = null; });
  return frameRequest;
}

async function fetchDimosHandCamFrames(fetchFn = globalThis.fetch) {
  const host = resolveHandCamHost() || SAM_CAMERA_HOST_DEFAULT;
  const doFetch = fetchFn?.bind?.(globalThis) || fetchFn;
  const grab = async (side) => {
    const url = side === "pov" ? "/api/robotics/zed.jpg" : handCamJpegUrl(side, host);
    try {
      const res = await doFetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
      if (!res?.ok) return null;
      const blob = await res.blob();
      return blob && blob.size >= 80 ? blob : null;
    } catch {
      return null;
    }
  };
  const [left, right, pov] = await Promise.all([grab("left"), grab("right"), grab("pov")]);
  leftLive = !!left;
  rightLive = !!right;
  povLive = !!pov;
  const nextL = left ? (makeObjectUrl(left) || "live") : "";
  const nextR = right ? (makeObjectUrl(right) || "live") : "";
  const nextP = pov ? (makeObjectUrl(pov) || "live") : "";
  if (typeof document !== "undefined") {
    document.querySelectorAll("[data-dimos-viewer]").forEach((root) => {
      const leftImg = root.querySelector("[data-dimos-video]");
      const rightImg = root.querySelector("[data-dimos-video-right]");
      const leftEmpty = root.querySelector('[data-dimos-no-feed="left"]');
      const rightEmpty = root.querySelector('[data-dimos-no-feed="right"]');
      if (leftImg) {
        if (nextL && nextL !== "live") leftImg.src = nextL;
        leftImg.hidden = !leftLive;
        if (nextL) leftImg.setAttribute("data-blob", nextL);
        else {
          leftImg.removeAttribute?.("src");
          leftImg.src = "";
        }
      }
      if (rightImg) {
        if (nextR && nextR !== "live") rightImg.src = nextR;
        rightImg.hidden = !rightLive;
        if (nextR) rightImg.setAttribute("data-blob", nextR);
        else {
          rightImg.removeAttribute?.("src");
          rightImg.src = "";
        }
      }
      if (leftEmpty) leftEmpty.hidden = leftLive;
      if (rightEmpty) rightEmpty.hidden = rightLive;
    });
  }
  if (left && nextL && nextL !== "live") {
    const img = ensureVideoImg(); if (img) img.src = nextL;
  }
  if (right && nextR && nextR !== "live" && typeof Image !== "undefined") {
    rightVideoImg ||= new Image(); rightVideoImg.src = nextR;
  }
  if (pov && nextP && nextP !== "live" && typeof Image !== "undefined") {
    povVideoImg ||= new Image(); povVideoImg.src = nextP;
  }
  if (!left && videoImg) videoImg.removeAttribute?.("src");
  if (!right && rightVideoImg) rightVideoImg.removeAttribute?.("src");
  if (!pov && povVideoImg) povVideoImg.removeAttribute?.("src");
  if (videoObjectUrl && videoObjectUrl !== nextL && videoObjectUrl !== "live") {
    try { URL.revokeObjectURL(videoObjectUrl); } catch { /* ignore */ }
  }
  if (rightVideoUrl && rightVideoUrl !== nextR && rightVideoUrl !== "live") {
    try { URL.revokeObjectURL(rightVideoUrl); } catch { /* ignore */ }
  }
  if (povVideoUrl && povVideoUrl !== nextP && povVideoUrl !== "live") {
    try { URL.revokeObjectURL(povVideoUrl); } catch { /* ignore */ }
  }
  videoObjectUrl = nextL;
  rightVideoUrl = nextR;
  povVideoUrl = nextP;
  hudOffline = !(leftLive || rightLive || povLive);
  notifyViewer();
  return getDimosViewerSnapshot();
}

export function startDimosHandCamPoll() {
  if (camPollTimer) return;
  if (typeof window === "undefined") return;
  void refreshDimosHandCamStatus();
  void refreshDimosHandCamFrames();
  camPollTimer = globalThis.setInterval?.(() => { void refreshDimosHandCamFrames(); }, 280) || 0;
  camStatusTimer = globalThis.setInterval?.(() => {
    void refreshDimosHandCamStatus().then(() => { void refreshDimosHandCamFrames(); });
  }, HAND_CAM_HOTPLUG_MS) || 0;
}

export function paintDimosCollectionHud(ctx, box, snap = getDimosViewerSnapshot()) {
  if (!ctx || !box) return;
  const { x, y, w, h } = box;
  ctx.fillStyle = "rgba(4, 9, 17, 0.88)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(188, 210, 235, 0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  const widgets = snap.widgets || dimosEpisodeWidgets();
  const cols = [
    ["STATE", widgets.state],
    ["TAKE", widgets.take],
    ["ELAPSED", widgets.elapsed],
    ["SAVED", widgets.saved],
    ["DISCARDED", widgets.discarded],
    ["LAST", widgets.lastAction],
  ];
  const cw = w / cols.length;
  cols.forEach(([label, value], i) => {
    const cx = x + i * cw + 8;
    ctx.fillStyle = "#c0cfdf";
    ctx.font = "700 11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(label, cx, y + 8);
    ctx.fillStyle = label === "STATE" && widgets.state === "RECORDING" ? "#ff6b6b" : "#f4f7fb";
    ctx.font = "600 16px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(String(value || ""), cx, y + h / 2 - 2);
  });
}

export function paintDimosVideoBox(ctx, box, snap = getDimosViewerSnapshot()) {
  if (!ctx || !box) return;
  const { x, y, w, h } = box;
  ctx.fillStyle = "#040911";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(188, 210, 235, 0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  const img = snap.videoImage;
  if (img && img.complete && img.naturalWidth && typeof ctx.drawImage === "function") {
    ctx.drawImage(img, x + 4, y + 4, w - 8, h - 8);
    return;
  }
  ctx.fillStyle = "#94a3b8";
  ctx.font = "700 16px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(snap.hasVideo ? "Stream decoding…" : "No feed", x + w / 2, y + h / 2);
}

export function dimosCameraHostValue(raw = "") {
  const typed = String(raw || "").trim();
  if (typed) return typed;
  return displayCameraHost(readHandCamPrefs()) || resolveHandCamHost() || SAM_CAMERA_HOST_DEFAULT;
}

export function sizeDimosHugInput(el) {
  if (!el) return 0;
  const text = String(el.value || el.placeholder || SAM_CAMERA_HOST_DEFAULT);
  const n = Math.max(10, text.length);
  try { el.size = n; } catch { /* ignore */ }
  try { el.setAttribute?.("size", String(n)); } catch { /* ignore */ }
  const supportsFieldSizing = typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");
  if (!supportsFieldSizing && el.style) {
    el.style.width = `calc(${n}ch + 1.25rem)`;
  }
  return n;
}

function bindDimosHugInputs(root) {
  const nodes = root?.querySelectorAll?.("[data-dimos-host-input], [data-dimos-cam-ip]");
  if (!nodes) return;
  nodes.forEach((el) => {
    sizeDimosHugInput(el);
    if (el.dataset?.hugBound === "1") return;
    if (el.dataset) el.dataset.hugBound = "1";
    el.addEventListener("input", () => sizeDimosHugInput(el));
  });
}

let camPrefsBound = false;
function bindHandCamPrefsForViewer() {
  if (camPrefsBound) return;
  camPrefsBound = true;
  onHandCamPrefsChange(() => {
    if (typeof document !== "undefined") {
      document.querySelectorAll("[data-dimos-cam-ip]").forEach((el) => {
        if (document.activeElement !== el) {
          el.value = dimosCameraHostValue();
        }
        sizeDimosHugInput(el);
      });
    }
    if (camPollTimer) void refreshDimosHandCamFrames();
  });
}

function bindDimosCameraIpField(root) {
  const input = root?.querySelector?.("[data-dimos-cam-ip]");
  if (!input) return;
  if (document.activeElement !== input && !String(input.value || "").trim()) {
    input.value = dimosCameraHostValue();
  }
  sizeDimosHugInput(input);
  if (input.dataset?.camBound === "1") return;
  if (input.dataset) input.dataset.camBound = "1";
  input.addEventListener("input", () => {
    persistHandCamDraft(input.value);
    sizeDimosHugInput(input);
    const logEl = root.querySelector("[data-dimos-debug-log]");
    if (logEl) logEl.textContent = dimosCameraDebugLog({ cameraIp: input.value }, getDimosViewerSnapshot());
  });
  input.addEventListener("change", () => {
    const saved = persistHandCamHost(input.value);
    persistHandCamDraft(saved.cameraHost || SAM_CAMERA_HOST_DEFAULT);
    input.value = saved.cameraHost || SAM_CAMERA_HOST_DEFAULT;
    sizeDimosHugInput(input);
    void refreshDimosHandCamFrames();
  });
}

export function shouldShowDimosCameraLog(viewer = getDimosViewerSnapshot()) {
  return !(viewer?.leftLive && viewer?.rightLive);
}

export function dimosCameraDebugLog(teleopSnap = {}, viewer = getDimosViewerSnapshot()) {
  const lines = [];
  const label = String(teleopSnap.label || "").trim();
  const key = String(teleopSnap.statusKey || "").trim();
  lines.push(label ? `status: ${label}` : "status: no stream");
  if (key) lines.push(`key: ${key}`);
  if (teleopSnap.wsUrl) lines.push(`ws: ${teleopSnap.wsUrl}`);
  if (teleopSnap.ensureStatus) lines.push(`ensure: ${teleopSnap.ensureStatus}`);
  if (teleopSnap.connected === true) lines.push("socket: open");
  else if (teleopSnap.connected === false) lines.push("socket: closed");
  const host = dimosCameraHostValue(teleopSnap.cameraIp);
  lines.push(`cam host: ${host || "(unset)"}`);
  const leftOk = !!viewer?.leftLive;
  const rightOk = !!viewer?.rightLive;
  lines.push(`left: ${handCamJpegUrl("left", host)} ${leftOk ? "live" : "no feed"}`);
  lines.push(`right: ${handCamJpegUrl("right", host)} ${rightOk ? "live" : "no feed"}`);
  if (leftOk && rightOk) lines.push("camera: connected");
  else if (leftOk || rightOk) lines.push("camera: split — one side no feed");
  else lines.push("camera: no feed");
  const st = viewer?.camStatus || lastHandCamStatus;
  const leftReason = String(st?.leftReason || "").trim();
  const rightReason = String(st?.rightReason || "").trim();
  if (!leftOk && leftReason) lines.push(`left reason: ${leftReason}`);
  if (!rightOk && rightReason) lines.push(`right reason: ${rightReason}`);
  const reason = String(teleopSnap.policy?.reason || "").trim();
  if (reason && !/Lowest latency/i.test(reason)) lines.push(reason);
  return lines.join("\n");
}

export async function copyDimosCameraLog(text, clip = globalThis.navigator?.clipboard) {
  const payload = String(text ?? "");
  if (!clip?.writeText) return false;
  await clip.writeText(payload);
  return true;
}

function bindDimosCameraCopyLog(root) {
  const btn = root.querySelector("[data-dimos-copy-log]");
  if (!btn || btn.dataset?.bound === "1") return;
  if (btn.dataset) btn.dataset.bound = "1";
  btn.addEventListener("click", async () => {
    const log = root.querySelector("[data-dimos-debug-log]")?.textContent || "";
    const ok = await copyDimosCameraLog(log);
    const prev = btn.textContent || "Copy";
    btn.textContent = ok ? "Copied" : "Copy failed";
    globalThis.setTimeout?.(() => { btn.textContent = prev; }, 1400);
  });
}

export function dimosViewerInnerHtml() {
  return `
    <div class="dimos-viewer-head">
      <h3>DimOS Quest teleop</h3>
      <strong data-dimos-viewer-status>Off</strong>
    </div>
    <div class="dimos-connect-robot">
      <label class="dimos-teleop-url-label" for="dimos-connect-host">Connect robot PC</label>
      <input data-dimos-host-input class="dimos-connect-host dimos-hug-input" type="text" spellcheck="false" autocomplete="off" placeholder="wss://192.168.1.77:8443/ws" />
      <button type="button" class="btn accent full" data-dimos-connect-pc>Connect robot PC</button>
      <p class="muted small" data-dimos-colocated-hint></p>
    </div>
    <div class="dimos-viewer-stream">
      <div class="dimos-camera-head"><strong>DimOS camera stream</strong></div>
      <input data-dimos-cam-ip data-hand-cam-ip class="dimos-camera-ip dimos-hug-input" type="text" spellcheck="false" autocomplete="off" inputmode="decimal" aria-label="Camera IP" placeholder="192.168.1.83" />
      <div class="dimos-camera-frame dimos-camera-split" data-dimos-camera-split>
        <div class="dimos-camera-pane" data-dimos-pane="left">
          <span class="dimos-camera-pane-label">Left</span>
          <img data-dimos-video alt="Left wrist camera" hidden />
          <div class="dimos-camera-empty" data-dimos-no-feed="left">
            <strong>No feed</strong>
          </div>
        </div>
        <div class="dimos-camera-pane" data-dimos-pane="right">
          <span class="dimos-camera-pane-label">Right</span>
          <img data-dimos-video-right alt="Right wrist camera" hidden />
          <div class="dimos-camera-empty" data-dimos-no-feed="right">
            <strong>No feed</strong>
          </div>
        </div>
      </div>
      <div class="dimos-camera-log-row" data-dimos-log-row>
        <pre class="dimos-camera-log" data-dimos-debug-log></pre>
        <button type="button" class="btn secondary btn-compact" data-dimos-copy-log>Copy</button>
      </div>
      <canvas data-dimos-episode-hud class="dimos-episode-hud" width="1024" height="128" aria-label="DimOS collection HUD"></canvas>
    </div>
    <ul class="dimos-viewer-widgets">
      <li><span>STATE</span><strong data-dimos-ep-state>READY</strong></li>
      <li><span>TAKE</span><strong data-dimos-ep-take>001</strong></li>
      <li><span>ELAPSED</span><strong data-dimos-ep-elapsed>00:00</strong></li>
      <li><span>SAVED</span><strong data-dimos-ep-saved>000</strong></li>
      <li><span>DISCARDED</span><strong data-dimos-ep-discarded>000</strong></li>
      <li><span>LAST ACTION</span><strong data-dimos-ep-last>NONE</strong></li>
    </ul>
  `;
}

export function shouldShowDimosViewerUi({ armed = false } = {}) {
  return armed === true;
}

export function syncDimosViewerDom(teleopSnap = {}) {
  if (typeof document === "undefined") return;
  const show = shouldShowDimosViewerUi({ armed: !!teleopSnap.armed });
  const viewer = getDimosViewerSnapshot();
  const policy = teleopSnap.policy || dimosConnectPolicy(undefined, teleopSnap.wsUrl || "");
  const widgets = viewer.widgets;
  document.querySelectorAll("[data-dimos-viewer]").forEach((root) => {
    root.hidden = !show;
    root.classList.toggle("is-on", show);
    const status = root.querySelector("[data-dimos-viewer-status]");
    if (status) status.textContent = teleopSnap.label || (show ? "On" : "Off");
    const path = root.querySelector("[data-dimos-viewer-path]");
    if (path) {
      path.hidden = true;
      path.textContent = "";
    }
    const hint = root.querySelector("[data-dimos-colocated-hint]");
    if (hint) {
      hint.textContent = policy.colocatedHint
        ? `Same-origin hint: DimOS on this box is ${policy.colocatedHint}`
        : "Paste the robot PC LAN IP (127.0.0.1 or 192.168.x.x).";
    }
    const input = root.querySelector("[data-dimos-host-input]");
    if (input && document.activeElement !== input && teleopSnap.wsUrl) {
      input.value = teleopSnap.wsUrl;
    }
    sizeDimosHugInput(input);
    const camInput = root.querySelector("[data-dimos-cam-ip]");
    if (camInput && document.activeElement !== camInput) {
      camInput.value = dimosCameraHostValue(teleopSnap.cameraIp);
    }
    sizeDimosHugInput(camInput);
    bindDimosCameraIpField(root);
    bindDimosHugInputs(root);
    const cameraIp = document.activeElement === camInput ? camInput?.value : dimosCameraHostValue(teleopSnap.cameraIp);
    const img = root.querySelector("[data-dimos-video]");
    if (img) {
      img.hidden = !viewer.leftLive;
      if (viewer.leftLive && viewer.videoUrl && viewer.videoUrl !== "live" && img.src !== viewer.videoUrl) {
        img.src = viewer.videoUrl;
      } else if (!viewer.leftLive) {
        img.removeAttribute?.("src");
        img.src = "";
      }
    }
    const imgR = root.querySelector("[data-dimos-video-right]");
    if (imgR) {
      imgR.hidden = !viewer.rightLive;
      if (viewer.rightLive && viewer.rightVideoUrl && viewer.rightVideoUrl !== "live" && imgR.src !== viewer.rightVideoUrl) {
        imgR.src = viewer.rightVideoUrl;
      } else if (!viewer.rightLive) {
        imgR.removeAttribute?.("src");
        imgR.src = "";
      }
    }
    const emptyL = root.querySelector('[data-dimos-no-feed="left"]');
    if (emptyL) emptyL.hidden = !!viewer.leftLive;
    const emptyR = root.querySelector('[data-dimos-no-feed="right"]');
    if (emptyR) emptyR.hidden = !!viewer.rightLive;
    const emptyLegacy = root.querySelector("[data-dimos-no-feed]:not([data-dimos-no-feed='left']):not([data-dimos-no-feed='right'])");
    if (emptyLegacy) emptyLegacy.hidden = !!(viewer.leftLive || viewer.rightLive);
    const showLog = shouldShowDimosCameraLog(viewer);
    const logRow = root.querySelector("[data-dimos-log-row]");
    if (logRow) logRow.hidden = !showLog;
    const logEl = root.querySelector("[data-dimos-debug-log]");
    if (logEl) logEl.textContent = showLog ? dimosCameraDebugLog({ ...teleopSnap, cameraIp }, viewer) : "";
    bindDimosCameraCopyLog(root);
    const hud = root.querySelector("[data-dimos-episode-hud]");
    if (hud?.getContext) {
      paintDimosCollectionHud(hud.getContext("2d"), { x: 0, y: 0, w: hud.width, h: hud.height }, viewer);
    }
    const set = (sel, val) => {
      const el = root.querySelector(sel);
      if (el) el.textContent = val;
    };
    set("[data-dimos-ep-state]", widgets.state);
    set("[data-dimos-ep-take]", widgets.take);
    set("[data-dimos-ep-elapsed]", widgets.elapsed);
    set("[data-dimos-ep-saved]", widgets.saved);
    set("[data-dimos-ep-discarded]", widgets.discarded);
    set("[data-dimos-ep-last]", widgets.lastAction);
  });
  document.getElementById("dimos-teleop-panel")?.classList.toggle("dimos-ui-on", show);
  document.getElementById("robotics-panel")?.classList.toggle("dimos-ui-on", show);
  if (show) {
    if (!camPollTimer) startDimosHandCamPoll();
  } else {
    stopDimosHandCamPoll();
  }
}

export function mountDimosViewerRoots() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("[data-dimos-viewer]").forEach((root) => {
    if (root.dataset.dimosMounted === "1") {
      bindDimosCameraCopyLog(root);
      bindDimosCameraIpField(root);
      bindDimosHugInputs(root);
      bindHandCamPrefsForViewer();
      return;
    }
    if (!root.querySelector("[data-dimos-connect-pc]")) {
      root.innerHTML = dimosViewerInnerHtml();
    }
    root.dataset.dimosMounted = "1";
    bindDimosCameraCopyLog(root);
    bindDimosCameraIpField(root);
    bindDimosHugInputs(root);
    bindHandCamPrefsForViewer();
  });
}
