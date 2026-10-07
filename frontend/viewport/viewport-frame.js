/**
 * Tight CAD framing — visible solid meshes only.
 * Never expand the camera AABB to world origin, the floor grid, or Inf/NaN boxes.
 */

export function isFiniteVec3(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function isUsableFrameBox(box, { minSpan = 1e-5 } = {}) {
  if (!box) return false;
  if (typeof box.isEmpty === "function" && box.isEmpty()) return false;
  const min = box.min;
  const max = box.max;
  if (!isFiniteVec3(min) || !isFiniteVec3(max)) return false;
  const sx = max.x - min.x;
  const sy = max.y - min.y;
  const sz = max.z - min.z;
  if (![sx, sy, sz].every(Number.isFinite)) return false;
  const span = Math.hypot(sx, sy, sz);
  return Number.isFinite(span) && span > minSpan;
}

export function boxCenter(box) {
  return {
    x: (box.min.x + box.max.x) * 0.5,
    y: (box.min.y + box.max.y) * 0.5,
    z: (box.min.z + box.max.z) * 0.5,
  };
}

export function boxSize(box) {
  return {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  };
}

export function boxSpan(box) {
  const s = boxSize(box);
  return Math.hypot(s.x, s.y, s.z);
}

/**
 * Orbit distance that frames a sphere of `radius` (CAD millimetres).
 * A 50 mm part must not produce a 50 m or 0.05 mm home pose.
 */
export function fitOrbitDistance(radius, { fovDeg = 50, aspect = 1 } = {}) {
  const r = Math.max(Number(radius) || 0, 1e-4);
  const vFov = ((Number(fovDeg) || 50) * Math.PI) / 180;
  const asp = Math.max(Number(aspect) || 1, 1e-4);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * asp);
  const distV = r / Math.sin(Math.max(vFov / 2, 1e-4));
  const distH = r / Math.sin(Math.max(hFov / 2, 1e-4));
  const dist = Math.max(distV, distH, r * 1.6, 0.15) * 1.18;
  return Number.isFinite(dist) ? dist : 0.15;
}

export function boxVolume(box) {
  const s = boxSize(box);
  return Math.max(s.x, 1e-9) * Math.max(s.y, 1e-9) * Math.max(s.z, 1e-9);
}

export function unionBoxes(boxes = []) {
  const usable = (boxes || []).filter((b) => isUsableFrameBox(b));
  if (!usable.length) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const box of usable) {
    min.x = Math.min(min.x, box.min.x);
    min.y = Math.min(min.y, box.min.y);
    min.z = Math.min(min.z, box.min.z);
    max.x = Math.max(max.x, box.max.x);
    max.y = Math.max(max.y, box.max.y);
    max.z = Math.max(max.z, box.max.z);
  }
  const out = { min, max };
  return isUsableFrameBox(out) ? out : null;
}

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Keep the designed / exploded cluster. Drop a tiny origin orphan that would
 * pull the camera back to frame empty sky between (0,0,0) and the part.
 *
 * Do not use this for Exploded-mode overview: spread parts sit farther than
 * seedSpan and this returns only the largest body, which punches the camera in.
 */
export function dominantClusterBox(boxes = [], { orphanScale = 1.55 } = {}) {
  const usable = (boxes || []).filter((b) => isUsableFrameBox(b));
  if (!usable.length) return null;
  if (usable.length === 1) return { min: { ...usable[0].min }, max: { ...usable[0].max } };

  const ranked = [...usable].sort((a, b) => boxVolume(b) - boxVolume(a) || boxSpan(b) - boxSpan(a));
  const seed = ranked[0];
  const seedCenter = boxCenter(seed);
  const seedSpan = Math.max(boxSpan(seed), 1e-6);
  const cluster = usable.filter((box) => dist3(boxCenter(box), seedCenter) <= seedSpan * 1.35);
  const clusterUnion = unionBoxes(cluster);
  const allUnion = unionBoxes(usable);
  if (!clusterUnion) return allUnion;
  if (!allUnion) return clusterUnion;

  const allSpan = boxSpan(allUnion);
  const clusterSpan = boxSpan(clusterUnion);
  if (allSpan > clusterSpan * orphanScale) return clusterUnion;

  const origin = { x: 0, y: 0, z: 0 };
  const clusterFar = dist3(boxCenter(clusterUnion), origin) > clusterSpan * 0.85;
  const unionTouchesOrigin = (
    allUnion.min.x <= 0 && allUnion.max.x >= 0
    && allUnion.min.y <= 0 && allUnion.max.y >= 0
    && allUnion.min.z <= 0 && allUnion.max.z >= 0
  );
  if (clusterFar && unionTouchesOrigin && allSpan > clusterSpan * 1.15) return clusterUnion;
  return allUnion;
}

/**
 * explfit1 — full exploded overview. Union every CAD-sized mesh so wheels,
 * plates, and bars that were spaced apart stay in frame. Drop only tiny origin
 * orphans (leftover dummies), never the largest-body neighborhood.
 */
export function explodedOverviewBox(boxes = []) {
  const usable = (boxes || []).filter((b) => isUsableFrameBox(b));
  if (!usable.length) return null;
  if (usable.length === 1) return { min: { ...usable[0].min }, max: { ...usable[0].max } };

  const origin = { x: 0, y: 0, z: 0 };
  const ranked = [...usable].sort((a, b) => boxVolume(b) - boxVolume(a) || boxSpan(b) - boxSpan(a));
  const seed = ranked[0];
  const seedSpan = Math.max(boxSpan(seed), 1e-6);
  const seedVol = Math.max(boxVolume(seed), 1e-12);

  const cad = usable.filter((box) => {
    const span = boxSpan(box);
    const vol = boxVolume(box);
    const nearOrigin = dist3(boxCenter(box), origin) <= Math.max(span, 1e-4) * 1.75;
    const tiny = vol < seedVol * 0.012 && span < seedSpan * 0.22;
    return !(tiny && nearOrigin);
  });
  return unionBoxes(cad.length ? cad : usable);
}

/** Z lift so the visible AABB base sits on z = 0. 0 when already seated or unusable. */
export function floorDeltaZ(box) {
  if (!isUsableFrameBox(box)) return 0;
  const z = box.min.z;
  if (!Number.isFinite(z) || Math.abs(z) <= 1e-9) return 0;
  return -z;
}

export function isJakeStepPreviewName(name = "") {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop() || "";
  return base.startsWith(".") && /\.ste?p\.glb$/i.test(base);
}

/** Hidden CADJS assembled mesh for a catalog STEP stem (`.Bracket.step.glb`). */
export function jakeAssembledPreviewForStem(stem, filenames = []) {
  const s = String(stem || "").replace(/^\./, "").replace(/_edited(?:_\d+)?$/i, "").trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  const names = (filenames || []).map((n) => String(n || "")).filter(Boolean);
  const exact = names.find((n) => {
    const base = (n.replace(/\\/g, "/").split("/").pop() || "").toLowerCase();
    return base === `.${lower}.step.glb` || base === `.${lower}.stp.glb`;
  });
  if (exact) return exact;
  return names.find((n) => {
    const base = n.replace(/\\/g, "/").split("/").pop() || "";
    if (!isJakeStepPreviewName(base)) return false;
    const inner = base.slice(1).replace(/\.ste?p\.glb$/i, "");
    return inner.toLowerCase() === lower;
  }) || null;
}
