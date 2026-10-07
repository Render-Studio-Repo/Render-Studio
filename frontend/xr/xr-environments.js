/**
 * XR rooms + environment wraps. Built once; switching only toggles visibility
 * or swaps a single equirect texture — never a dense mesh, never per-frame
 * canvas/material rebuilds (freeze2).
 */
import * as THREE from "three";
import {
  environmentWrapPrompt,
  flashlightFromRay,
  GPT_IMAGE_MODEL_CANDIDATES,
  parseXrEnvironmentStore,
  rayHitsSphere,
  serializeXrEnvironmentStore,
  XR_ENV_STORE_KEY,
  shouldBindSceneEnvironmentWhilePresenting,
  shouldParseEnvironmentDataUrlsOnXrMenuOpen,
} from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5";

export {
  environmentWrapPrompt,
  flashlightFromRay,
  GPT_IMAGE_MODEL_CANDIDATES,
  parseXrEnvironmentStore,
  serializeXrEnvironmentStore,
  XR_ENV_STORE_KEY,
};

export const XR_ENV_META_KEY = "render3d:xrEnvironments:meta:v1";
const LOGO_URL = "/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1";
const _wrapLoader = new THREE.TextureLoader();

/** Labels only — never copy equirect dataUrls into the Settings/Environment list. */
export function environmentStoreMetaRows(items = []) {
  return (Array.isArray(items) ? items : [])
    .slice(0, 6)
    .map((row) => ({
      id: String(row?.id || ""),
      label: String(row?.label || row?.name || "Saved environment").slice(0, 48),
      url: row?.url || row?.dataUrl ? "stored" : "",
      dataUrl: "",
      kind: "wrap",
    }))
    .filter((row) => row.id && row.url);
}

export function loadXrEnvironmentStore() {
  try {
    return parseXrEnvironmentStore(localStorage.getItem(XR_ENV_STORE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function loadXrEnvironmentStoreMeta() {
  try {
    const raw = localStorage.getItem(XR_ENV_META_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return environmentStoreMetaRows(list);
  } catch {
    return [];
  }
}

/** Settings / Change scene listing. Never JSON.parse multi-MB wraps on the click frame. */
export function loadXrEnvironmentListForMenu() {
  if (shouldParseEnvironmentDataUrlsOnXrMenuOpen()) return loadXrEnvironmentStore();
  const meta = loadXrEnvironmentStoreMeta();
  return meta.length ? meta : [];
}

export function saveXrEnvironmentStore(items) {
  const next = parseXrEnvironmentStore(items);
  try { localStorage.setItem(XR_ENV_STORE_KEY, serializeXrEnvironmentStore(next)); } catch (_) {}
  try { localStorage.setItem(XR_ENV_META_KEY, JSON.stringify(environmentStoreMetaRows(next))); } catch (_) {}
  return next;
}

export function upsertSavedEnvironment(row, items = loadXrEnvironmentStore()) {
  const id = String(row?.id || `wrap-${Date.now().toString(36)}`);
  const next = [
    {
      id,
      label: String(row?.label || row?.name || "Saved environment").slice(0, 48),
      url: String(row?.url || ""),
      dataUrl: String(row?.dataUrl || ""),
      kind: "wrap",
    },
    ...items.filter((it) => it.id !== id),
  ].slice(0, 6);
  return saveXrEnvironmentStore(next);
}

export function createXrStudioLogo({ y = 1.32, z = -1.05 } = {}) {
  const group = new THREE.Group();
  group.name = "xrStudioLogo";
  group.userData.xrStudioLogo = true;
  group.visible = false;
  group.position.set(0, y, z);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.11, 28),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      depthTest: true,
      transparent: true,
      alphaTest: 0.08,
      depthWrite: false,
    }),
  );
  disc.name = "xrStudioLogoDisc";
  group.add(disc);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.112, 0.128, 28),
    new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    }),
  );
  ring.position.z = 0.002;
  ring.raycast = () => {};
  group.add(ring);

  _wrapLoader.load(LOGO_URL, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    disc.material.map = tex;
    disc.material.needsUpdate = true;
  });

  return group;
}

export function createXrRayFlashlight() {
  const target = new THREE.Object3D();
  target.name = "xrRayFlashTarget";
  const light = new THREE.SpotLight(0x9ad1ff, 0, 6.5, 0.22, 0.42, 1.05);
  light.name = "xrRayFlashlight";
  light.target = target;
  light.castShadow = false;
  light.visible = false;
  return { light, target };
}

export function applyEquirectWrap(scene, source, prevTex = null, opts = {}) {
  const url = String(source?.dataUrl || source?.url || source || "");
  if (!url || !scene) return prevTex;
  try { prevTex?.dispose?.(); } catch (_) {}
  const tex = _wrapLoader.load(url);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const presenting = !!opts.presenting;
  // Same Three.js scene as laptop CAD — never paint the wrap unless we are in XR.
  const applyToScene = opts.applyToScene != null ? !!opts.applyToScene : presenting === true;
  if (applyToScene) scene.background = tex;
  else if (scene.background === prevTex || scene.background === tex) scene.background = null;
  const bindEnv = opts.bindEnvironment === true
    && applyToScene
    && shouldBindSceneEnvironmentWhilePresenting({ presenting });
  if (bindEnv) scene.environment = tex;
  else if (scene.environment === prevTex || scene.environment === tex) scene.environment = null;
  if (!presenting && scene.environment) scene.environment = null;
  return tex;
}

export function logoWorldHit(origin, dir, logoObj, radius = 0.16) {
  if (!logoObj) return false;
  const p = logoObj.getWorldPosition?.(new THREE.Vector3()) || logoObj.position;
  return rayHitsSphere(origin, dir, p, radius);
}
