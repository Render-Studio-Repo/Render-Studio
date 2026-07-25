/**
 * Mobile / constrained-WebGL lighting fallback for Mesh look-dev.
 *
 * Look-dev hides CAD lights and relies on RoomEnvironment IBL + near-zero
 * ambient. On many phones PMREM/IBL fails or is incomplete, so high-metalness
 * PBR materials shade pure black. This module bumps fill lights and softens
 * envMap dependence when the viewport is constrained or IBL is missing.
 */

const MOBILE_MQ = "(max-width: 820px), (pointer: coarse) and (max-width: 1024px)";

const LOOKDEV_DESKTOP = {
  hemi: 0.32,
  ambient: 0.05,
  envIntensity: 1.05,
};

const LOOKDEV_FALLBACK = {
  hemi: 0.78,
  ambient: 0.52,
  key: 1.55,
  fill: 0.62,
  rim: 0.7,
  envIntensity: 0.55,
};

function matchConstrained() {
  try {
    return !!window.matchMedia?.(MOBILE_MQ)?.matches;
  } catch {
    return false;
  }
}

/** True on phone/tablet-ish viewports (same MQ as Studio mobile shell). */
export function isConstrainedWebGLViewport() {
  return matchConstrained();
}

/**
 * Whether look-dev needs a non-IBL fill path.
 * @param {{ hasEnv?: boolean }} opts
 */
export function needsLookdevLightingFallback({ hasEnv = false } = {}) {
  return !hasEnv || matchConstrained();
}

function setLightIntensity(light, value) {
  if (!light || !("intensity" in light)) return;
  light.intensity = value;
}

/**
 * Apply or restore look-dev light intensities for the active environment.
 * Safe to call repeatedly after setViewportShadingMode("lookdev").
 *
 * @param {{ scene?: object, lookdevGroup?: object, hasEnv?: boolean }} opts
 * @returns {boolean} true if fallback lighting was applied
 */
export function applyLookdevMobileFallback({ scene = null, lookdevGroup = null, hasEnv = false } = {}) {
  const useFallback = needsLookdevLightingFallback({ hasEnv });
  const lights = [];
  lookdevGroup?.traverse?.((child) => {
    if (child?.isLight) lights.push(child);
  });

  const hemi = lights.find((l) => l.isHemisphereLight);
  const ambient = lights.find((l) => l.isAmbientLight);
  const directionals = lights.filter((l) => l.isDirectionalLight);
  const key = directionals[0];
  const fill = directionals[1];
  const rim = directionals[2];

  if (useFallback) {
    setLightIntensity(hemi, LOOKDEV_FALLBACK.hemi);
    setLightIntensity(ambient, LOOKDEV_FALLBACK.ambient);
    setLightIntensity(key, LOOKDEV_FALLBACK.key);
    setLightIntensity(fill, LOOKDEV_FALLBACK.fill);
    setLightIntensity(rim, LOOKDEV_FALLBACK.rim);
    // Soften shadow maps on constrained GPUs (black / blank canvases).
    if (key?.shadow?.mapSize) {
      const size = matchConstrained() ? 1024 : 2048;
      key.shadow.mapSize.set(size, size);
    }
    if (scene && "environmentIntensity" in scene) {
      scene.environmentIntensity = hasEnv ? LOOKDEV_FALLBACK.envIntensity : 1;
    }
    // When IBL is missing, keep CAD fill visible under look-dev so metals aren't black.
    if (!hasEnv && lookdevGroup?.parent) {
      const cad = lookdevGroup.parent.getObjectByName?.("CadStudioLights");
      if (cad) cad.visible = true;
    }
  } else {
    setLightIntensity(hemi, LOOKDEV_DESKTOP.hemi);
    setLightIntensity(ambient, LOOKDEV_DESKTOP.ambient);
    // Key/fill/rim stay at authored setupSceneLighting defaults when desktop+IBL.
    if (scene && "environmentIntensity" in scene) {
      scene.environmentIntensity = LOOKDEV_DESKTOP.envIntensity;
    }
  }

  return useFallback;
}

/**
 * Lower envMapIntensity on authored materials when IBL is unavailable so
 * metalness doesn't zero out diffuse response.
 */
export function softenAuthoredEnvMaps(object3d, { hasEnv = false } = {}) {
  if (!object3d || hasEnv) return object3d;
  object3d.traverse?.((child) => {
    if (!child?.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat || !("envMapIntensity" in mat)) continue;
      mat.envMapIntensity = Math.min(Number(mat.envMapIntensity) || 0.4, 0.45);
      mat.needsUpdate = true;
    }
  });
  return object3d;
}
