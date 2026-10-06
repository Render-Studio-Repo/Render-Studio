/**
 * Mobile camera AR helpers — iOS Quick Look (USDZ) + Android Scene Viewer (GLB).
 * Used when WebXR immersive-ar is unavailable (typical phone Safari / some Android).
 *
 * iOS: Quick Look needs a user-gesture click on <a rel="ar">. Async USDZ export
 * burns that gesture and Safari falls back to downloading the file — so we cache
 * the USDZ and, when cold, show a one-tap "Open in AR" control with a fresh gesture.
 */

import * as THREE from "three";
import { USDZExporter } from "three/addons/exporters/USDZExporter.js";
import { AR_CHOOSER_ACTION_IDS } from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5";

export { AR_CHOOSER_ACTION_IDS };

function isIos() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent || "");
}

function isMobileLike() {
  return isIos() || isAndroid() || ((navigator.maxTouchPoints || 0) > 1 && window.matchMedia?.("(pointer: coarse)")?.matches);
}

function absoluteUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return String(url || "");
  }
}

function supportsIosQuickLook() {
  try {
    const a = document.createElement("a");
    return !!a.relList?.supports?.("ar");
  } catch {
    return false;
  }
}

/** 1×1 transparent GIF — Quick Look requires an <img> child. */
const AR_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

let _cachedUsdzUrl = null;
let _cachedUsdzKey = null;
let _preparePromise = null;
let _arBannerEl = null;

function revokeCachedUsdz() {
  if (_cachedUsdzUrl) {
    try {
      URL.revokeObjectURL(_cachedUsdzUrl);
    } catch {
      /* ignore */
    }
  }
  _cachedUsdzUrl = null;
  _cachedUsdzKey = null;
}

/**
 * Clone the live viewport mesh into a clean scene for USDZ (no helpers/HUD).
 * USDZExporter only accepts MeshStandardMaterial — coerce others.
 */
function cloneMeshForExport(root) {
  if (!root) return null;
  const clone = root.clone(true);
  clone.traverse((obj) => {
    if (obj.isLight || obj.isCamera || obj.type === "GridHelper" || obj.type === "AxesHelper") {
      obj.visible = false;
    }
    if (obj.userData?.xrIgnore || obj.userData?.editorOnly) obj.visible = false;
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = mats.map((mat) => {
      if (!mat) return new THREE.MeshStandardMaterial({ color: 0xb0b8c0, metalness: 0.15, roughness: 0.55 });
      if (mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) return mat;
      const std = new THREE.MeshStandardMaterial({
        color: mat.color ? mat.color.clone() : new THREE.Color(0xb0b8c0),
        map: mat.map || null,
        metalness: typeof mat.metalness === "number" ? mat.metalness : 0.2,
        roughness: typeof mat.roughness === "number" ? mat.roughness : 0.55,
        transparent: !!mat.transparent,
        opacity: typeof mat.opacity === "number" ? mat.opacity : 1,
        side: mat.side ?? THREE.FrontSide,
      });
      return std;
    });
    obj.material = Array.isArray(obj.material) ? next : next[0];
  });
  return clone;
}

async function exportUsdzBlob(root) {
  const mesh = cloneMeshForExport(root);
  if (!mesh) throw new Error("Load a model before entering AR");
  const scene = new THREE.Scene();
  scene.add(mesh);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dir = new THREE.DirectionalLight(0xffffff, 0.65);
  dir.position.set(2, 4, 3);
  scene.add(dir);
  const exporter = new USDZExporter();
  const arrayBuffer = await exporter.parseAsync(scene, { quickLookCompatible: true });
  return new Blob([arrayBuffer], { type: "model/vnd.usdz+zip" });
}

function meshCacheKey(root) {
  if (!root) return null;
  try {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    let meshes = 0;
    root.traverse((o) => {
      if (o.isMesh) meshes += 1;
    });
    return `${meshes}:${size.x.toFixed(3)}:${size.y.toFixed(3)}:${size.z.toFixed(3)}`;
  } catch {
    return String(Date.now());
  }
}

function ensureArAnchor() {
  let a = document.getElementById("ios-ar-quicklook-anchor");
  if (a) return a;
  a = document.createElement("a");
  a.id = "ios-ar-quicklook-anchor";
  a.setAttribute("rel", "ar");
  a.style.cssText =
    "position:fixed;width:1px;height:1px;left:-100px;top:-100px;opacity:0;pointer-events:none;overflow:hidden;";
  const img = document.createElement("img");
  img.src = AR_PIXEL;
  img.alt = "AR";
  img.width = 1;
  img.height = 1;
  a.appendChild(img);
  document.body.appendChild(a);
  return a;
}

/**
 * Fire Quick Look. Must run inside a user gesture.
 * Do not set the download attribute — that makes Safari save the USDZ instead of opening AR.
 */
function clickIosQuickLook(href) {
  const a = ensureArAnchor();
  a.setAttribute("rel", "ar");
  a.removeAttribute("download");
  a.href = href;
  a.click();
}

function hideArBanner() {
  _arBannerEl?.remove();
  _arBannerEl = null;
}

function showOpenInArBanner(href) {
  hideArBanner();
  const bar = document.createElement("div");
  bar.className = "mobile-ar-open-banner";
  bar.innerHTML = `
    <span>AR model ready</span>
    <a rel="ar" class="mobile-ar-open-btn" href="${href}">
      <img src="${AR_PIXEL}" alt="" width="1" height="1" />
      Open in AR
    </a>
    <button type="button" class="mobile-ar-open-dismiss" aria-label="Dismiss">×</button>
  `;
  const style = document.createElement("style");
  style.textContent = `
    .mobile-ar-open-banner {
      position: fixed;
      left: 50%;
      bottom: calc(18px + env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%);
      z-index: 12000;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px 10px 14px;
      border-radius: 16px;
      border: 1px solid rgba(56, 189, 248, 0.45);
      background: rgba(8, 15, 28, 0.94);
      color: #e2e8f0;
      font-size: 0.82rem;
      font-weight: 650;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      max-width: min(92vw, 360px);
    }
    .mobile-ar-open-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(56, 189, 248, 0.22);
      border: 1px solid rgba(125, 211, 252, 0.55);
      color: #e0f2fe;
      font-weight: 800;
      text-decoration: none;
      -webkit-tap-highlight-color: transparent;
    }
    .mobile-ar-open-btn img { position: absolute; width: 1px; height: 1px; opacity: 0; }
    .mobile-ar-open-dismiss {
      border: 0;
      background: transparent;
      color: #94a3b8;
      font-size: 1.25rem;
      line-height: 1;
      padding: 4px 6px;
      cursor: pointer;
    }
  `;
  bar.appendChild(style);
  document.body.appendChild(bar);
  _arBannerEl = bar;

  bar.querySelector(".mobile-ar-open-btn")?.addEventListener("click", () => {
    // Fresh user gesture → Quick Look camera
    setTimeout(hideArBanner, 800);
  });
  bar.querySelector(".mobile-ar-open-dismiss")?.addEventListener("click", hideArBanner);
  return bar;
}

async function prepareIosUsdz(root, cacheKey) {
  if (_cachedUsdzUrl && _cachedUsdzKey === cacheKey) return _cachedUsdzUrl;
  if (_preparePromise) return _preparePromise;
  _preparePromise = (async () => {
    const blob = await exportUsdzBlob(root);
    revokeCachedUsdz();
    _cachedUsdzUrl = URL.createObjectURL(blob);
    _cachedUsdzKey = cacheKey;
    return _cachedUsdzUrl;
  })();
  try {
    return await _preparePromise;
  } finally {
    _preparePromise = null;
  }
}

/**
 * Open the current model in the device camera AR viewer.
 * @param {{ getMeshRoot: () => THREE.Object3D | null, getGlbUrl?: () => string | null, filename?: string }} opts
 */
export async function launchMobileCameraAr(opts = {}) {
  const getMeshRoot = opts.getMeshRoot;
  const getGlbUrl = opts.getGlbUrl;
  const filename = String(opts.filename || "model").replace(/\.[^.]+$/, "") || "model";

  if (isIos()) {
    const root = getMeshRoot?.();
    if (!root) throw new Error("Load a CAD model first, then tap AR");
    if (!supportsIosQuickLook()) {
      throw new Error("AR Quick Look needs Safari on iPhone / iPad");
    }
    const key = meshCacheKey(root);
    // Warm cache → sync click keeps the user gesture → camera opens (not a download).
    if (_cachedUsdzUrl && _cachedUsdzKey === key) {
      clickIosQuickLook(_cachedUsdzUrl);
      return { ok: true, mode: "ios-quicklook" };
    }
    const url = await prepareIosUsdz(root, key);
    // Gesture likely spent on export — offer a one-tap Open in AR control.
    showOpenInArBanner(url);
    return { ok: true, mode: "ios-quicklook-pending-tap" };
  }

  if (isAndroid()) {
    // Scene Viewer — places the GLB in the live camera on ARCore devices.
    // The GLB URL must be publicly fetchable (query JWT or share link) — Scene Viewer
    // cannot send Authorization headers.
    let glb = "";
    try {
      const raw = await Promise.resolve(typeof getGlbUrl === "function" ? getGlbUrl() : getGlbUrl);
      glb = absoluteUrl(raw || "");
    } catch (err) {
      throw new Error(err?.message || "Could not prepare AR model");
    }
    if (!glb) throw new Error("Load a CAD model first, then tap AR");
    const viewer = `https://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(glb)}&mode=ar_preferred&title=${encodeURIComponent(filename)}`;
    const intent =
      `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(glb)}&mode=ar_preferred&title=${encodeURIComponent(filename)}` +
      `#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;` +
      `S.browser_fallback_url=${encodeURIComponent(viewer)};end;`;
    try {
      window.location.href = intent;
    } catch {
      window.location.href = viewer;
    }
    return { ok: true, mode: "android-scene-viewer" };
  }

  // Desktop / unknown — caller should use launchDesktopCameraAr (chooser + webcam).
  throw new Error("NO_XR_DEVICE");
}

/* ── Desktop / laptop: no headset → chooser + webcam AR ─────────────────── */

let _desktopArModal = null;
let _webcamAr = null; // { stream, video, texture, savedBackground, savedFog, exitBtn, onExit }
let _workspacePass = null;

function hideDesktopArModal() {
  _desktopArModal?.remove();
  _desktopArModal = null;
}

function ensureDesktopArStyles() {
  const existing = document.getElementById("desktop-ar-styles");
  if (existing) existing.remove();
  const style = document.createElement("style");
  style.id = "desktop-ar-styles";
  style.textContent = `
    .desktop-ar-modal {
      position: fixed; inset: 0; z-index: 13000;
      display: flex; align-items: center; justify-content: center;
      padding: 20px; background: rgba(2, 6, 14, 0.62);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    }
    .desktop-ar-card {
      width: min(420px, calc(100vw - 28px));
      border-radius: 18px;
      border: 1px solid rgba(56, 189, 248, 0.4);
      background: linear-gradient(165deg, rgba(15, 23, 42, 0.98), rgba(8, 15, 28, 0.96));
      box-shadow: 0 24px 60px rgba(0,0,0,0.5);
      padding: 22px 22px 18px;
      color: #e2e8f0;
    }
    .desktop-ar-card h3 {
      margin: 0 0 8px; font-size: 1.1rem; font-weight: 800; letter-spacing: 0.02em;
    }
    .desktop-ar-card p {
      margin: 0 0 18px; color: #94a3b8; font-size: 0.88rem; line-height: 1.45;
    }
    .desktop-ar-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
    .desktop-ar-actions .btn {
      border-radius: 999px; padding: 9px 16px; font-weight: 700; font-size: 0.85rem; cursor: pointer;
      border: 1px solid rgba(148, 163, 184, 0.35); background: rgba(30, 41, 59, 0.8); color: #e2e8f0;
    }
    .desktop-ar-actions .btn-primary {
      border-color: rgba(56, 189, 248, 0.65);
      background: rgba(14, 116, 144, 0.55); color: #e0f2fe;
    }
    .desktop-ar-actions .btn:hover { filter: brightness(1.08); }
    .desktop-ar-exit {
      position: absolute; top: 14px; right: 14px; z-index: 40;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 14px; border-radius: 999px;
      border: 1px solid rgba(56, 189, 248, 0.55);
      background: rgba(8, 15, 28, 0.9); color: #e0f2fe;
      font-weight: 800; font-size: 0.78rem; letter-spacing: 0.04em;
      cursor: pointer; box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    }
    .desktop-ar-exit:hover { border-color: #7dd3fc; }
    .desktop-ar-banner {
      position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
      z-index: 39; max-width: min(420px, calc(100% - 24px));
      padding: 8px 14px; border-radius: 12px;
      border: 1px solid rgba(56, 189, 248, 0.35);
      background: rgba(8, 15, 28, 0.85); color: #cbd5e1;
      font-size: 0.75rem; text-align: center;
      pointer-events: auto; cursor: pointer;
      transition: opacity 0.35s ease, transform 0.35s ease;
    }
    .desktop-ar-banner.is-hidden {
      opacity: 0; transform: translateX(-50%) translateY(8px); pointer-events: none;
    }
    .camera-ar-tools {
      position: absolute; left: 50%; top: max(12px, env(safe-area-inset-top, 0px));
      transform: translateX(-50%); z-index: 41;
      display: flex; flex-wrap: wrap; justify-content: center; gap: 6px;
      max-width: calc(100% - 24px); padding: 6px;
      border-radius: 16px;
      border: 1px solid rgba(56, 189, 248, 0.4);
      background: rgba(8, 15, 28, 0.9);
      box-shadow: 0 10px 28px rgba(0,0,0,0.4);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    }
    body.phone-camera-ar .desktop-ar-exit {
      top: max(12px, env(safe-area-inset-top, 0px));
      right: max(10px, env(safe-area-inset-right, 0px));
    }
    body.phone-camera-ar .camera-ar-tools {
      top: auto;
      bottom: calc(18px + var(--mobile-dock-lift, env(safe-area-inset-bottom, 0px)));
      left: 50%;
      right: auto;
      max-width: calc(100% - 20px);
    }
    body.phone-camera-ar .desktop-ar-banner {
      bottom: calc(72px + var(--mobile-dock-lift, env(safe-area-inset-bottom, 0px)));
    }
    .desktop-ar-choice {
      display: grid; gap: 10px; margin: 0 0 16px;
    }
    .desktop-ar-choice button {
      text-align: left; border-radius: 14px; padding: 12px 14px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(30, 41, 59, 0.88); color: #e2e8f0;
      font-weight: 750; cursor: pointer;
    }
    .desktop-ar-choice button strong { display: block; font-size: 0.95rem; }
    .desktop-ar-choice button span { display: block; margin-top: 4px; color: #94a3b8; font-weight: 600; font-size: 0.8rem; }
    .desktop-ar-choice button:hover { border-color: rgba(56, 189, 248, 0.7); }
    .xr-workspace-hud {
      position: absolute; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%); z-index: 42;
      display: flex; flex-wrap: wrap; justify-content: center; gap: 6px;
      max-width: calc(100% - 16px); padding: 6px;
      border-radius: 16px;
      border: 1px solid rgba(56, 189, 248, 0.4);
      background: rgba(8, 15, 28, 0.92);
      box-shadow: 0 10px 28px rgba(0,0,0,0.4);
    }
    .xr-workspace-hud button {
      min-height: 44px; min-width: 44px; padding: 8px 12px; border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(30, 41, 59, 0.88); color: #e2e8f0;
      font-weight: 750; font-size: 0.75rem; cursor: pointer;
    }
    .xr-workspace-hud button.is-active {
      border-color: rgba(56, 189, 248, 0.75);
      background: rgba(14, 116, 144, 0.55); color: #e0f2fe;
    }
    .xr-workspace-hint {
      position: absolute; left: 50%; top: max(12px, env(safe-area-inset-top, 0px));
      transform: translateX(-50%); z-index: 42;
      padding: 8px 14px; border-radius: 12px;
      background: rgba(8, 15, 28, 0.85); color: #cbd5e1;
      font-size: 0.75rem; pointer-events: none;
    }
    .camera-ar-tools button {
      min-height: 44px; padding: 8px 14px; border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(30, 41, 59, 0.88); color: #e2e8f0;
      font-weight: 750; font-size: 0.78rem; cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .camera-ar-tools button.is-active {
      border-color: rgba(56, 189, 248, 0.75);
      background: rgba(14, 116, 144, 0.55); color: #e0f2fe;
    }
    .camera-ar-tools button[data-ar-tool="exit"] {
      border-color: rgba(248, 81, 73, 0.45); color: #fecaca;
    }
  `;
  document.head.appendChild(style);
}

async function probeCameraAvailable() {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: "camera" });
      if (status.state === "denied") return false;
    }
  } catch {
    /* permissions.query(camera) unsupported in some browsers */
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === "videoinput");
    // Before permission, labels are empty but devices may still be listed.
    if (cams.length > 0) return true;
  } catch {
    /* ignore */
  }
  // Optimistic: getUserMedia will confirm when the user accepts.
  return typeof navigator.mediaDevices.getUserMedia === "function";
}

/**
 * AR button chooser: camera AR vs the collab VR workspace (PC / phone).
 * Lazy-created. Action ids: ar | vr-workspace | cancel.
 * @returns {Promise<"ar"|"vr-workspace"|"cancel">}
 */
export function showArVrWorkspaceChooser({ hasCamera = true } = {}) {
  ensureDesktopArStyles();
  hideDesktopArModal();
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "desktop-ar-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Join AR or VR workspace");
    modal.innerHTML = `
      <div class="desktop-ar-card">
        <h3>Join the room</h3>
        <p>AR keeps the camera behind the model. VR Workspace puts you in the same 3D room as headset users (WASD / look on PC, tilt on phone).</p>
        <div class="desktop-ar-choice">
          <button type="button" data-ar-act="ar">
            <strong>AR</strong>
            <span>${hasCamera ? "Camera passthrough / Quick Look — place the model in your space" : "Camera AR needs a webcam or phone camera"}</span>
          </button>
          <button type="button" data-ar-act="vr-workspace">
            <strong>VR Workspace</strong>
            <span>Look around the shared studio · see people and objects · draw and move if collab is on</span>
          </button>
        </div>
        <div class="desktop-ar-actions">
          <button type="button" class="btn" data-ar-act="cancel">Cancel</button>
        </div>
      </div>
    `;
    const finish = (value) => {
      hideDesktopArModal();
      resolve(AR_CHOOSER_ACTION_IDS.includes(value) ? value : "cancel");
    };
    modal.addEventListener("click", (e) => {
      if (e.target === modal) finish("cancel");
      const act = e.target?.closest?.("[data-ar-act]")?.dataset?.arAct;
      if (act === "ar" || act === "vr-workspace" || act === "cancel") finish(act);
    });
    document.addEventListener("keydown", function onKey(ev) {
      if (ev.key === "Escape") {
        document.removeEventListener("keydown", onKey);
        finish("cancel");
      }
    });
    document.body.appendChild(modal);
    _desktopArModal = modal;
    modal.querySelector("[data-ar-act='vr-workspace']")?.focus?.();
  });
}

/**
 * Popup when no Quest/headset is available. Offers laptop camera AR when possible.
 * @returns {Promise<"camera"|"cancel">}
 */
export function showNoXrDevicePopup({ hasCamera = true } = {}) {
  ensureDesktopArStyles();
  hideDesktopArModal();
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "desktop-ar-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "No XR device found");
    modal.innerHTML = `
      <div class="desktop-ar-card">
        <h3>No XR device found</h3>
        <p>${
          hasCamera
            ? "No Quest or headset is connected. You can still use your laptop camera for an augmented preview of the model in your room."
            : "No Quest, headset, or camera was found on this computer. Connect a Meta Quest (or similar) and open Render Studio in the headset browser, or plug in a webcam."
        }</p>
        <div class="desktop-ar-actions">
          <button type="button" class="btn" data-ar-act="cancel">Cancel</button>
          ${hasCamera ? '<button type="button" class="btn btn-primary" data-ar-act="camera">Use camera</button>' : ""}
        </div>
      </div>
    `;
    const finish = (value) => {
      hideDesktopArModal();
      resolve(value);
    };
    modal.addEventListener("click", (e) => {
      if (e.target === modal) finish("cancel");
      const act = e.target?.closest?.("[data-ar-act]")?.dataset?.arAct;
      if (act === "camera") finish("camera");
      if (act === "cancel") finish("cancel");
    });
    document.addEventListener("keydown", function onKey(ev) {
      if (ev.key === "Escape") {
        document.removeEventListener("keydown", onKey);
        finish("cancel");
      }
    });
    document.body.appendChild(modal);
    _desktopArModal = modal;
    modal.querySelector("[data-ar-act='camera'], [data-ar-act='cancel']")?.focus?.();
  });
}

export function isDesktopWebcamArActive() {
  return !!_webcamAr;
}

export function stopDesktopWebcamAr() {
  const state = _webcamAr;
  if (!state) return;
  _webcamAr = null;
  try {
    state.stream?.getTracks?.().forEach((t) => t.stop());
  } catch {
    /* ignore */
  }
  try {
    state.texture?.dispose?.();
  } catch {
    /* ignore */
  }
  try {
    if (state.scene) {
      state.scene.background = state.savedBackground ?? null;
      state.scene.fog = state.savedFog ?? null;
    }
  } catch {
    /* ignore */
  }
  if (state.bannerHideTimer) {
    clearTimeout(state.bannerHideTimer);
    state.bannerHideTimer = null;
  }
  state.exitBtn?.remove?.();
  state.banner?.remove?.();
  state.video?.remove?.();
  try {
    state.tools?.dispose?.();
  } catch {
    /* ignore */
  }
  try {
    document.body.classList.remove("desktop-webcam-ar", "phone-camera-ar");
  } catch {
    /* ignore */
  }
  try {
    state.onExit?.();
  } catch {
    /* ignore */
  }
}

/**
 * Use the device camera as the viewport background (augmented preview).
 * On phones this is the in-app AR path: live camera + on-screen Move / Turn / Size tools.
 */
export async function startDesktopWebcamAr(opts = {}) {
  const {
    scene,
    getMeshRoot,
    fitCamera,
    onStarted,
    onExit,
    onStatus,
    controls = null,
    camera = null,
    rendererEl = null,
  } = opts;
  if (!scene) throw new Error("Missing scene for camera AR");
  if (isDesktopWebcamArActive()) stopDesktopWebcamAr();

  ensureDesktopArStyles();
  onStatus?.("ok", "Starting camera…");

  const phone = isMobileLike();
  let stream = null;
  const videoConstraints = phone
    ? { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints,
    });
  } catch {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: phone ? { facingMode: "environment" } : true,
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
  }

  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.srcObject = stream;
  video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(video);
  await video.play();

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const savedBackground = scene.background;
  const savedFog = scene.fog;
  scene.fog = null;
  scene.background = texture;

  const viewport = document.getElementById("viewport") || document.body;
  document.body.classList.add("desktop-webcam-ar");
  if (phone) document.body.classList.add("phone-camera-ar");

  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "desktop-ar-exit";
  exitBtn.textContent = "Exit camera AR";
  viewport.appendChild(exitBtn);

  const banner = document.createElement("div");
  banner.className = "desktop-ar-banner";
  banner.title = "Tap to dismiss";
  banner.innerHTML = phone
    ? "<strong>Camera AR</strong> · Move / Turn / Size place the model in your room · Exit when done"
    : "<strong>Camera AR</strong> · orbit / zoom the model over your live camera · Exit when done";
  viewport.appendChild(banner);

  const hideBanner = () => {
    if (!banner.isConnected || banner.classList.contains("is-hidden")) return;
    banner.classList.add("is-hidden");
    if (_webcamAr?.bannerHideTimer) {
      clearTimeout(_webcamAr.bannerHideTimer);
      _webcamAr.bannerHideTimer = null;
    }
    window.setTimeout(() => banner.remove(), 400);
  };
  banner.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    hideBanner();
  });
  const bannerHideTimer = window.setTimeout(hideBanner, phone ? 7000 : 10000);

  const tools = installCameraArTools({
    host: viewport,
    getMeshRoot,
    controls,
    camera,
    rendererEl: rendererEl || document.querySelector("#viewport canvas"),
    phone,
  });

  _webcamAr = {
    stream,
    video,
    texture,
    scene,
    savedBackground,
    savedFog,
    exitBtn,
    banner,
    bannerHideTimer,
    onExit,
    tools,
  };

  exitBtn.addEventListener("click", () => stopDesktopWebcamAr());

  try {
    const root = getMeshRoot?.();
    if (root) fitCamera?.();
  } catch {
    /* ignore */
  }

  onStarted?.();
  onStatus?.(
    "ok",
    phone
      ? "Camera AR on — use Move, Turn, and Size to place the model. Tap Exit when done."
      : "Camera AR on — model over your webcam. Click Exit camera AR when done.",
  );
  return { ok: true, mode: phone ? "phone-camera" : "desktop-webcam" };
}

function installCameraArTools({ host, getMeshRoot, controls, camera, rendererEl, phone }) {
  const root = getMeshRoot?.();
  const bar = document.createElement("div");
  bar.className = "camera-ar-tools";
  bar.innerHTML = `
    <button type="button" data-ar-tool="move">Move</button>
    <button type="button" data-ar-tool="rotate">Turn</button>
    <button type="button" data-ar-tool="scale">Size</button>
    <button type="button" data-ar-tool="look">Look</button>
    <button type="button" data-ar-tool="reset">Reset</button>
  `;
  host.appendChild(bar);

  const snapshot = root
    ? {
        position: root.position.clone(),
        quaternion: root.quaternion.clone(),
        scale: root.scale.clone(),
      }
    : null;
  let mode = phone ? "move" : "look";
  const drag = {
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    pinch: null,
  };
  const el = rendererEl || host.querySelector("canvas") || host;

  function target() {
    return getMeshRoot?.() || root;
  }

  function setMode(next) {
    mode = next;
    bar.querySelectorAll("[data-ar-tool]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.arTool === mode);
    });
    if (controls) controls.enabled = mode === "look";
  }

  function resetModel() {
    const obj = target();
    if (!obj || !snapshot) return;
    obj.position.copy(snapshot.position);
    obj.quaternion.copy(snapshot.quaternion);
    obj.scale.copy(snapshot.scale);
    obj.updateMatrixWorld?.(true);
  }

  bar.addEventListener("click", (e) => {
    const tool = e.target?.closest?.("[data-ar-tool]")?.dataset?.arTool;
    if (!tool) return;
    e.preventDefault();
    e.stopPropagation();
    if (tool === "reset") {
      resetModel();
      return;
    }
    setMode(tool);
  });

  function onPointerDown(e) {
    if (mode === "look" || e.button) return;
    if (e.target?.closest?.(".camera-ar-tools, .desktop-ar-exit, .desktop-ar-banner")) return;
    const obj = target();
    if (!obj) return;
    drag.active = true;
    drag.pointerId = e.pointerId;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (controls) controls.enabled = false;
    try { el.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
    e.stopPropagation();
  }

  function onPointerMove(e) {
    if (!drag.active || e.pointerId !== drag.pointerId) return;
    const obj = target();
    if (!obj) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    const span = Math.max(obj.scale.length?.() || 1, 0.2);
    if (mode === "move") {
      const right = new THREE.Vector3(1, 0, 0);
      const up = new THREE.Vector3(0, 1, 0);
      if (camera) {
        right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      }
      const speed = span * 0.0045;
      obj.position.addScaledVector(right, dx * speed);
      obj.position.addScaledVector(up, -dy * speed);
    } else if (mode === "rotate") {
      obj.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), dx * 0.01);
      const camRight = camera
        ? new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize()
        : new THREE.Vector3(1, 0, 0);
      obj.rotateOnWorldAxis(camRight, dy * 0.01);
    } else if (mode === "scale") {
      const factor = Math.exp(-dy * 0.006);
      obj.scale.multiplyScalar(Math.min(4, Math.max(0.08, factor)));
    }
    obj.updateMatrixWorld?.(true);
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (e.pointerId !== drag.pointerId) return;
    drag.active = false;
    drag.pointerId = null;
    try { el.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
  }

  function onTouchStart(e) {
    if (e.touches?.length === 2) {
      const [a, b] = e.touches;
      drag.pinch = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (controls) controls.enabled = false;
      e.preventDefault();
    }
  }

  function onTouchMove(e) {
    if (e.touches?.length !== 2 || !drag.pinch) return;
    const obj = target();
    if (!obj) return;
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const factor = dist / Math.max(drag.pinch, 1);
    drag.pinch = dist;
    obj.scale.multiplyScalar(Math.min(1.08, Math.max(0.92, factor)));
    obj.updateMatrixWorld?.(true);
    e.preventDefault();
  }

  function onTouchEnd() {
    drag.pinch = null;
    if (mode === "look" && controls) controls.enabled = true;
  }

  el.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  el.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
  el.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  el.addEventListener("touchend", onTouchEnd, true);

  setMode(mode);

  return {
    dispose() {
      resetModel();
      if (controls) controls.enabled = true;
      bar.remove();
      el.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      el.removeEventListener("touchstart", onTouchStart, true);
      el.removeEventListener("touchmove", onTouchMove, true);
      el.removeEventListener("touchend", onTouchEnd, true);
    },
  };
}

/**
 * Desktop AR entry: show “no device” popup, optionally start webcam AR.
 * Phones skip the chooser so the camera permission stays on the AR tap.
 */
export async function launchDesktopCameraAr(opts = {}) {
  if (isDesktopWebcamArActive()) {
    stopDesktopWebcamAr();
    return { ok: true, mode: "desktop-webcam-stopped" };
  }

  const mobile = isMobileLike();
  if (!mobile && !opts.direct) {
    const hasCamera = await probeCameraAvailable();
    const choice = await showNoXrDevicePopup({ hasCamera });
    if (choice !== "camera") {
      return { ok: false, cancelled: true, mode: "desktop-chooser" };
    }
  }
  try {
    return await startDesktopWebcamAr(opts);
  } catch (err) {
    const msg = err?.name === "NotAllowedError"
      ? (mobile
        ? "Camera permission denied — allow the camera in Safari, then tap AR again."
        : "Camera permission denied — allow the camera to use AR on this laptop.")
      : (err?.message || "Could not open the camera");
    throw new Error(msg);
  }
}

export function isWorkspacePassthroughActive() {
  return !!_workspacePass;
}

export async function startWorkspacePassthrough({ scene } = {}) {
  if (!scene) throw new Error("Missing scene for passthrough");
  if (_workspacePass) return { ok: true, mode: "workspace-pass" };
  ensureDesktopArStyles();
  const phone = isMobileLike();
  let stream = null;
  const videoConstraints = phone
    ? { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "");
  video.srcObject = stream;
  video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(video);
  await video.play();
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  _workspacePass = {
    stream,
    video,
    texture,
    scene,
    savedBackground: scene.background,
    savedFog: scene.fog,
  };
  scene.fog = null;
  scene.background = texture;
  return { ok: true, mode: "workspace-pass" };
}

export function stopWorkspacePassthrough() {
  const state = _workspacePass;
  if (!state) return;
  _workspacePass = null;
  try { state.stream?.getTracks?.().forEach((t) => t.stop()); } catch { /* ignore */ }
  try { state.texture?.dispose?.(); } catch { /* ignore */ }
  try {
    if (state.scene) {
      state.scene.background = state.savedBackground ?? null;
      state.scene.fog = state.savedFog ?? null;
    }
  } catch { /* ignore */ }
  try { state.video?.remove?.(); } catch { /* ignore */ }
}

/** Warm the iOS USDZ cache only when idle and after studio boot is gone. */
export function prefetchMobileArUsdz(getMeshRoot) {
  if (!isIos() || !supportsIosQuickLook()) return;
  if (typeof document !== "undefined" && document.body?.classList?.contains("studio-booting")) {
    return;
  }
  const run = () => {
    try {
      const root = typeof getMeshRoot === "function" ? getMeshRoot() : getMeshRoot;
      if (!root) return;
      const key = meshCacheKey(root);
      if (_cachedUsdzUrl && _cachedUsdzKey === key) return;
      // Yield so we never block first paint / boot dismiss.
      prepareIosUsdz(root, key).catch(() => {});
    } catch {
      /* ignore */
    }
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => setTimeout(run, 0), { timeout: 4000 });
  } else {
    setTimeout(run, 1500);
  }
}

export function invalidateMobileArCache() {
  revokeCachedUsdz();
  hideArBanner();
}

export function mobileArPlatformLabel() {
  if (isIos()) return "AR (camera)";
  if (isAndroid()) return "AR (camera)";
  return "AR";
}

export { isIos, isAndroid, isMobileLike };
