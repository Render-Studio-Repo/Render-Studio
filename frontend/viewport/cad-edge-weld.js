/**
 * EdgesGeometry emits one segment per tessellated triangle edge.
 * Extruded T-slots (80/20) become hundreds of colinear 1px Line2 bits that
 * alias into jagged / moiré ink. Collapse colinear runs to one segment.
 */

function vertexKey(x, y, z, quantize) {
  return `${Math.round(x * quantize)},${Math.round(y * quantize)},${Math.round(z * quantize)}`;
}

function hypot3(dx, dy, dz) {
  return Math.hypot(dx, dy, dz);
}

function addAdj(adj, a, b) {
  let list = adj.get(a);
  if (!list) {
    list = [];
    adj.set(a, list);
  }
  if (!list.includes(b)) list.push(b);
}

/**
 * @param {ArrayLike<number>} positions packed xyzxyz per segment
 * @param {{ quantize?: number, colinearDot?: number }} [opts]
 * @returns {Float32Array}
 */
export function weldColinearEdgePositions(positions, opts = {}) {
  const src = positions;
  const n = src?.length ? (src.length / 6) | 0 : 0;
  if (n < 2) {
    return src instanceof Float32Array ? src : new Float32Array(src || []);
  }
  const quantize = Number.isFinite(opts.quantize) ? opts.quantize : 1e5;
  const colinearDot = Number.isFinite(opts.colinearDot) ? opts.colinearDot : 0.99925;

  const verts = [];
  const idOf = new Map();
  const intern = (x, y, z) => {
    const k = vertexKey(x, y, z, quantize);
    let id = idOf.get(k);
    if (id === undefined) {
      id = verts.length / 3;
      idOf.set(k, id);
      verts.push(x, y, z);
    }
    return id;
  };

  const adj = new Map();
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const a = intern(src[o], src[o + 1], src[o + 2]);
    const b = intern(src[o + 3], src[o + 4], src[o + 5]);
    if (a === b) continue;
    addAdj(adj, a, b);
    addAdj(adj, b, a);
  }

  const used = new Set();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const out = [];

  const emit = (a, b) => {
    if (a === b) return;
    out.push(verts[a * 3], verts[a * 3 + 1], verts[a * 3 + 2], verts[b * 3], verts[b * 3 + 1], verts[b * 3 + 2]);
  };

  const dirFrom = (a, b) => {
    const ax = verts[a * 3];
    const ay = verts[a * 3 + 1];
    const az = verts[a * 3 + 2];
    const bx = verts[b * 3];
    const by = verts[b * 3 + 1];
    const bz = verts[b * 3 + 2];
    const len = hypot3(bx - ax, by - ay, bz - az);
    if (len < 1e-18) return null;
    return [(bx - ax) / len, (by - ay) / len, (bz - az) / len];
  };

  const sameLine = (d0, d1) => {
    if (!d0 || !d1) return false;
    return Math.abs(d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2]) >= colinearDot;
  };

  const unusedNeighbors = (id) => (adj.get(id) || []).filter((nb) => !used.has(edgeKey(id, nb)));

  const walk = (start, next) => {
    if (used.has(edgeKey(start, next))) return;
    let a = start;
    let b = next;
    let runStart = start;
    let runDir = dirFrom(a, b);
    used.add(edgeKey(a, b));
    while (true) {
      const nbs = unusedNeighbors(b);
      if (nbs.length !== 1) {
        emit(runStart, b);
        return;
      }
      const c = nbs[0];
      const stepDir = dirFrom(b, c);
      if (!sameLine(runDir, stepDir)) {
        emit(runStart, b);
        runStart = b;
        runDir = stepDir;
      }
      used.add(edgeKey(b, c));
      a = b;
      b = c;
    }
  };

  const ids = [...adj.keys()].sort((x, y) => x - y);
  for (const id of ids) {
    const degree = (adj.get(id) || []).length;
    if (degree === 2) continue;
    for (const nb of unusedNeighbors(id)) walk(id, nb);
  }
  // Remaining cycles (all degree 2).
  for (const id of ids) {
    for (const nb of unusedNeighbors(id)) walk(id, nb);
  }

  if (out.length < 6) {
    return src instanceof Float32Array ? src : new Float32Array(src);
  }
  return new Float32Array(out);
}

/**
 * Drop crumbs shorter than minLength (world units).
 * @param {ArrayLike<number>} positions
 * @param {number} minLength
 */
export function pruneShortEdgeSegments(positions, minLength) {
  const min = Number(minLength);
  if (!(min > 0) || !positions?.length) {
    return positions instanceof Float32Array ? positions : new Float32Array(positions || []);
  }
  const n = (positions.length / 6) | 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const len = hypot3(
      positions[o + 3] - positions[o],
      positions[o + 4] - positions[o + 1],
      positions[o + 5] - positions[o + 2],
    );
    if (len < min) continue;
    out.push(
      positions[o],
      positions[o + 1],
      positions[o + 2],
      positions[o + 3],
      positions[o + 4],
      positions[o + 5],
    );
  }
  if (out.length < 6) {
    return positions instanceof Float32Array ? positions : new Float32Array(positions);
  }
  return new Float32Array(out);
}
