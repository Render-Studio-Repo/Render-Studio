/**
 * Architect Mode — 3 ft bay lattice (pure math, no Three.js).
 *
 * Atomic wall unit = one axis-aligned 3 ft segment between lattice vertices.
 * Longer walls are chains of segments. Window/door features snap onto a whole bay later.
 *
 * Safe for Design mode: this module has no side effects until callers use it.
 */

export const SEGMENT_FT = 3;
export const WALL_HEIGHT_FT = 9;
export const WALL_THICKNESS_FT = 0.5;
export const FT_TO_MM = 304.8;
export const SEGMENT_MM = SEGMENT_FT * FT_TO_MM; // 914.4

/** @typedef {[number, number]} LatticeVertex — integer indices (i, j) on the bay lattice */

/**
 * @param {number} ft
 * @returns {number} millimetres
 */
export function ftToMm(ft) {
  return Number(ft) * FT_TO_MM;
}

/**
 * @param {number} mm
 * @param {number} mmPerModelUnit — from scene heuristic (1 for mm-scale meshes, 1000 for metre-scale)
 * @returns {number} model units
 */
export function mmToModel(mm, mmPerModelUnit = 1) {
  const unit = Number(mmPerModelUnit) || 1;
  return Number(mm) / unit;
}

/**
 * Length of one wall bay in model units.
 * @param {number} mmPerModelUnit
 */
export function segmentLengthModel(mmPerModelUnit = 1) {
  return mmToModel(SEGMENT_MM, mmPerModelUnit);
}

/**
 * World XY (plan) position of a lattice vertex, in model units.
 * Convention matches the app: XY is the floor plan, Z is up.
 * @param {LatticeVertex} vertex
 * @param {number} mmPerModelUnit
 * @returns {{ x: number, y: number, z: number }}
 */
export function vertexToModel(vertex, mmPerModelUnit = 1) {
  const step = segmentLengthModel(mmPerModelUnit);
  const i = Number(vertex?.[0]) || 0;
  const j = Number(vertex?.[1]) || 0;
  return { x: i * step, y: j * step, z: 0 };
}

/**
 * Snap a plan-plane model point to the nearest lattice vertex.
 * @param {{ x: number, y: number }} point
 * @param {number} mmPerModelUnit
 * @returns {LatticeVertex}
 */
export function modelToNearestVertex(point, mmPerModelUnit = 1) {
  const step = segmentLengthModel(mmPerModelUnit);
  if (!(step > 0)) return [0, 0];
  const i = Math.round((Number(point?.x) || 0) / step);
  const j = Math.round((Number(point?.y) || 0) / step);
  return [i, j];
}

/**
 * True when a→b is exactly one axis-aligned bay (Manhattan step of 1).
 * Diagonals are rejected in v1.
 * @param {LatticeVertex} a
 * @param {LatticeVertex} b
 */
export function isValidBay(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return false;
  const di = Math.abs((Number(b[0]) || 0) - (Number(a[0]) || 0));
  const dj = Math.abs((Number(b[1]) || 0) - (Number(a[1]) || 0));
  return (di === 1 && dj === 0) || (di === 0 && dj === 1);
}

/**
 * Canonical undirected key for a bay edge (order-independent).
 * @param {LatticeVertex} a
 * @param {LatticeVertex} b
 * @returns {string | null}
 */
export function bayKey(a, b) {
  if (!isValidBay(a, b)) return null;
  const a0 = Number(a[0]) || 0;
  const a1 = Number(a[1]) || 0;
  const b0 = Number(b[0]) || 0;
  const b1 = Number(b[1]) || 0;
  if (a0 < b0 || (a0 === b0 && a1 <= b1)) return `${a0},${a1}|${b0},${b1}`;
  return `${b0},${b1}|${a0},${a1}`;
}

/**
 * Four orthogonal neighbor vertices (potential bay endpoints).
 * @param {LatticeVertex} vertex
 * @returns {LatticeVertex[]}
 */
export function neighborVertices(vertex) {
  const i = Number(vertex?.[0]) || 0;
  const j = Number(vertex?.[1]) || 0;
  return [
    [i + 1, j],
    [i - 1, j],
    [i, j + 1],
    [i, j - 1],
  ];
}

/**
 * Snap a plan-plane model point to the nearest axis-aligned bay edge.
 * Returns null when the click is too far from any edge (outside snap radius).
 * @param {{ x: number, y: number }} point
 * @param {number} mmPerModelUnit
 * @param {{ maxDistFrac?: number }} [opts] — max distance as fraction of bay length (default 0.42)
 * @returns {{ a: LatticeVertex, b: LatticeVertex, dist: number } | null}
 */
export function modelToNearestBay(point, mmPerModelUnit = 1, opts = {}) {
  const step = segmentLengthModel(mmPerModelUnit);
  if (!(step > 0)) return null;
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;
  const iFloor = Math.floor(x / step);
  const jFloor = Math.floor(y / step);
  const fx = x / step - iFloor;
  const fy = y / step - jFloor;
  const candidates = [
    { a: [iFloor, jFloor], b: [iFloor + 1, jFloor], dist: Math.abs(fy) * step },
    { a: [iFloor, jFloor + 1], b: [iFloor + 1, jFloor + 1], dist: Math.abs(1 - fy) * step },
    { a: [iFloor, jFloor], b: [iFloor, jFloor + 1], dist: Math.abs(fx) * step },
    { a: [iFloor + 1, jFloor], b: [iFloor + 1, jFloor + 1], dist: Math.abs(1 - fx) * step },
  ];
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    if (candidates[i].dist < best.dist) best = candidates[i];
  }
  const maxFrac = Number.isFinite(opts.maxDistFrac) ? opts.maxDistFrac : 0.42;
  if (best.dist > step * maxFrac) return null;
  return best;
}

/**
 * All axis-aligned bay edges whose vertices lie in [iMin,iMax] × [jMin,jMax].
 * Useful for drawing the lattice overlay.
 * @param {{ iMin?: number, iMax?: number, jMin?: number, jMax?: number }} bounds
 * @returns {Array<{ a: LatticeVertex, b: LatticeVertex, key: string }>}
 */
export function enumerateBaysInBounds(bounds = {}) {
  const iMin = Number.isFinite(bounds.iMin) ? bounds.iMin : -10;
  const iMax = Number.isFinite(bounds.iMax) ? bounds.iMax : 10;
  const jMin = Number.isFinite(bounds.jMin) ? bounds.jMin : -10;
  const jMax = Number.isFinite(bounds.jMax) ? bounds.jMax : 10;
  const out = [];
  for (let i = iMin; i <= iMax; i += 1) {
    for (let j = jMin; j <= jMax; j += 1) {
      if (i < iMax) {
        const a = [i, j];
        const b = [i + 1, j];
        const key = bayKey(a, b);
        if (key) out.push({ a, b, key });
      }
      if (j < jMax) {
        const a = [i, j];
        const b = [i, j + 1];
        const key = bayKey(a, b);
        if (key) out.push({ a, b, key });
      }
    }
  }
  return out;
}

/**
 * Default empty building stub for later persistence (Quest 2.3).
 * Not written to disk yet — schema anchor only.
 */
export function createEmptyBuilding({ levelId = "level_0", levelName = "Ground Floor" } = {}) {
  return {
    units: "ft",
    grid: { segmentFt: SEGMENT_FT, wallHeightFt: WALL_HEIGHT_FT, wallThicknessFt: WALL_THICKNESS_FT },
    levels: [
      {
        id: levelId,
        name: levelName,
        elevationFt: 0,
        heightFt: WALL_HEIGHT_FT,
      },
    ],
    activeLevelId: levelId,
    segments: [],
  };
}
