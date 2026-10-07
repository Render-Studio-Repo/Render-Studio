/**
 * Design-mode floor grid sizing (Z-up XY plane).
 *
 * GridHelper is a finite square. With a live model, size from the scene so a
 * 50–200 mm part is not a speck on a horizon-scale floor. After delete (no
 * content) size from camera XY + orbit so the ground is not a postage stamp.
 * Never use PerspectiveCamera.far (defaults to 20000) — that makes cells
 * larger than the view so the floor looks like empty black.
 */

export const FLOOR_GRID_MAX = 2_000_000;
export const FLOOR_GRID_MIN_HALF = 8;

export function niceLength(desired, { min = 10, max = FLOOR_GRID_MAX } = {}) {
  const v = Math.min(max, Math.max(min, Number(desired) || min));
  if (!(v > 0) || !Number.isFinite(v)) return min;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) {
    if (pow * m >= v) return Math.min(max, pow * m);
  }
  return Math.min(max, pow * 10);
}

/**
 * Half-extent of an XY square that covers the visible ground.
 * Content: follow the model (sceneRadius * N). Empty: camera reach, not a
 * 3° infinite horizon that turns every CAD part into a speck.
 */
export function floorGridHalfExtent({
  sceneRadius = 1,
  hasContent,
  cameraPosition = { x: 0, y: 0, z: 4 },
  fovDeg = 50,
  aspect = 1,
  far = 100,
  orbitDist = 8,
} = {}) {
  const height = Math.max(Math.abs(Number(cameraPosition?.z) || 0), 0.05);
  const camXY = Math.hypot(Number(cameraPosition?.x) || 0, Number(cameraPosition?.y) || 0);
  const orbit = Number(orbitDist);
  const orbitUse = Math.max(Number.isFinite(orbit) && orbit > 0 ? orbit : 8, height, 8);
  const fromScene = Math.max(Number(sceneRadius) || 0, 0);
  const content = hasContent === true || (hasContent !== false && fromScene > 1.25);
  if (content) {
    // Leftover far cameras / 3° horizon must not dwarf a 50 mm bracket.
    return Math.max(fromScene * 6, FLOOR_GRID_MIN_HALF);
  }
  const horizon = height / Math.tan((6 * Math.PI) / 180);
  return Math.max(
    camXY + orbitUse * 2.5,
    orbitUse * 4.5,
    horizon,
    FLOOR_GRID_MIN_HALF,
  );
}

export function floorGridSize(opts = {}) {
  const half = floorGridHalfExtent(opts);
  const raw = Math.max(half * 2, FLOOR_GRID_MIN_HALF * 2);
  // 1-2-5 rounding jumps 25600 → 50000 and makes GridHelper cells too coarse.
  if (raw > 2000) return Math.min(FLOOR_GRID_MAX, Math.ceil(raw / 500) * 500);
  return niceLength(raw, { min: FLOOR_GRID_MIN_HALF * 2, max: FLOOR_GRID_MAX });
}

/** Half-extent for camera near/far so the floor square is not frustum-cut. */
export function floorClipHalfExtent(gridSize, contentRadius = 1) {
  return Math.max(
    (Number(gridSize) || 0) * 0.5,
    Number(contentRadius) || 0,
    FLOOR_GRID_MIN_HALF,
  );
}

export function resetRendererView(renderer, cssW, cssH, { clearGlobalClipping = true } = {}) {
  if (!renderer) return;
  const w = Math.max(1, Math.round(Number(cssW) || 0) || 1);
  const h = Math.max(1, Math.round(Number(cssH) || 0) || 1);
  const canvas = renderer.domElement;
  const ratio = renderer.getPixelRatio?.() || 1;
  const size = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
  renderer.getSize?.(size);
  // Setting canvas.width/height, even to the same values, reallocates and
  // clears the drawing buffer. Project-open calls resize from several UI
  // hooks. Keep resetting viewport/scissor, but only resize real changes.
  if (size.x !== w || size.y !== h
      || canvas?.width !== Math.floor(w * ratio) || canvas?.height !== Math.floor(h * ratio)) {
    renderer.setSize?.(w, h, true);
  } else if (canvas?.style) {
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  // Three.js viewport units are CSS pixels (multiplied by pixel ratio internally).
  renderer.setViewport?.(0, 0, w, h);
  renderer.setScissorTest?.(false);
  if (clearGlobalClipping) renderer.clippingPlanes = [];
}

export function protectFloorChrome(object) {
  if (!object) return object;
  object.frustumCulled = false;
  object.traverse?.((child) => {
    if (!child) return;
    child.frustumCulled = false;
    const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    for (const mat of mats) {
      if (!mat) continue;
      mat.clippingPlanes = [];
      mat.clipIntersection = false;
    }
  });
  return object;
}
