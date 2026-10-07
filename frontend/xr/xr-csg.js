/**
 * Real triangle CSG (union / subtract / intersect) for XR massing.
 * BSP port of the classic constructive-solid algorithm (csg.js).
 * Used by the Quest Combine tool — not a mode label only.
 */

const EPSILON = 1e-5;
const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

export function combineOpFromMode(mode) {
  const m = String(mode || "").toLowerCase();
  if (m === "cut" || m === "subtract" || m === "difference") return "subtract";
  if (m === "intersect" || m === "intersection") return "intersect";
  if (m === "add" || m === "union" || m === "join") return "union";
  return "";
}

export function boxTriangles(cx, cy, cz, sx, sy, sz) {
  const hx = (Number(sx) || 1) * 0.5;
  const hy = (Number(sy) || 1) * 0.5;
  const hz = (Number(sz) || 1) * 0.5;
  const x = Number(cx) || 0;
  const y = Number(cy) || 0;
  const z = Number(cz) || 0;
  const v = [
    [x - hx, y - hy, z - hz],
    [x + hx, y - hy, z - hz],
    [x + hx, y + hy, z - hz],
    [x - hx, y + hy, z - hz],
    [x - hx, y - hy, z + hz],
    [x + hx, y - hy, z + hz],
    [x + hx, y + hy, z + hz],
    [x - hx, y + hy, z + hz],
  ];
  const faces = [
    [1, 0, 3, 2],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [3, 7, 6, 2],
    [0, 4, 7, 3],
    [1, 2, 6, 5],
  ];
  const tris = [];
  for (const f of faces) {
    tris.push([v[f[0]], v[f[1]], v[f[2]]]);
    tris.push([v[f[0]], v[f[2]], v[f[3]]]);
  }
  return tris;
}

export function solidSpecTriangles(spec) {
  if (!spec) return [];
  const p = spec.worldPosition || spec.position || {};
  const s = spec.sizeM || spec.size || {};
  const kind = String(spec.kind || "box");
  const cx = Number(p.x) || 0;
  const cy = Number(p.y) || 0;
  const cz = Number(p.z) || 0;
  let sx = Math.max(0.02, Number(s.x) || 0.08);
  let sy = Math.max(0.02, Number(s.y) || 0.08);
  let sz = Math.max(0.02, Number(s.z) || 0.08);
  if (kind === "wall") sz = 0.08;
  if (kind === "floor") sy = 0.04;
  if (kind === "sphere") {
    const r = Math.max(sx, sy, sz) * 0.5;
    return sphereTriangles(cx, cy, cz, r, 10, 8);
  }
  if (kind === "cylinder" || kind === "cone") {
    return cylinderTriangles(cx, cy, cz, sx * 0.5, kind === "cone" ? 0.001 : sx * 0.5, sy, 12);
  }
  return boxTriangles(cx, cy, cz, sx, sy, sz);
}

function sphereTriangles(cx, cy, cz, r, seg = 10, rings = 8) {
  const tris = [];
  const pt = (ti, ri) => {
    const v = ri / rings;
    const u = ti / seg;
    const phi = v * Math.PI;
    const th = u * Math.PI * 2;
    return [
      cx + r * Math.sin(phi) * Math.cos(th),
      cy + r * Math.cos(phi),
      cz + r * Math.sin(phi) * Math.sin(th),
    ];
  };
  for (let ri = 0; ri < rings; ri += 1) {
    for (let ti = 0; ti < seg; ti += 1) {
      const a = pt(ti, ri);
      const b = pt(ti + 1, ri);
      const c = pt(ti + 1, ri + 1);
      const d = pt(ti, ri + 1);
      if (ri) tris.push([a, b, d]);
      if (ri < rings - 1) tris.push([b, c, d]);
    }
  }
  return tris;
}

function cylinderTriangles(cx, cy, cz, rBottom, rTop, h, seg = 12) {
  const tris = [];
  const hy = h * 0.5;
  const ring = (r, y) => {
    const out = [];
    for (let i = 0; i < seg; i += 1) {
      const a = (i / seg) * Math.PI * 2;
      out.push([cx + r * Math.cos(a), cy + y, cz + r * Math.sin(a)]);
    }
    return out;
  };
  const top = ring(Math.max(0.001, rTop), hy);
  const bot = ring(Math.max(0.001, rBottom), -hy);
  const topC = [cx, cy + hy, cz];
  const botC = [cx, cy - hy, cz];
  for (let i = 0; i < seg; i += 1) {
    const j = (i + 1) % seg;
    tris.push([bot[i], bot[j], top[j]]);
    tris.push([bot[i], top[j], top[i]]);
    tris.push([topC, top[i], top[j]]);
    tris.push([botC, bot[j], bot[i]]);
  }
  return tris;
}

export const CSG_BSP_MAX_TRIS = 80;
export const CSG_BSP_SAFE_TRIS = 160;
export const CSG_VOXEL_RES = 20;
export const CSG_VOXEL_INPUT_MAX = 720;
export const CSG_THIN_MIN_M = 0.002;

export function boundsExtents(bounds) {
  const min = bounds?.min || [0, 0, 0];
  const max = bounds?.max || [1, 1, 1];
  return [
    Math.max(1e-9, max[0] - min[0]),
    Math.max(1e-9, max[1] - min[1]),
    Math.max(1e-9, max[2] - min[2]),
  ];
}

export function isThinBounds(bounds, isoRes = CSG_VOXEL_RES) {
  const e = boundsExtents(bounds);
  const maxE = Math.max(e[0], e[1], e[2]);
  const minE = Math.min(e[0], e[1], e[2]);
  const cell = maxE / Math.max(6, isoRes);
  return minE < cell * 1.05 || minE / maxE < 0.06 || minE < 0.012;
}

export function adaptiveVoxelAxes(bounds) {
  const e = boundsExtents(bounds);
  const maxE = Math.max(e[0], e[1], e[2]);
  const n = e.map((len) => {
    const iso = Math.round(CSG_VOXEL_RES * (len / maxE));
    const thin = len < maxE * 0.08 || len < 0.012;
    return Math.max(thin ? 4 : 8, Math.min(28, thin ? 6 : (iso || 8)));
  });
  return { nx: n[0], ny: n[1], nz: n[2] };
}

export function shouldPreferBsp(countA, countB) {
  return (Number(countA) || 0) + (Number(countB) || 0) <= CSG_BSP_SAFE_TRIS * 2;
}

export function occupancyCount(vox) {
  let n = 0;
  const grid = vox?.grid;
  if (!grid) return 0;
  for (let i = 0; i < grid.length; i += 1) if (grid[i]) n += 1;
  return n;
}

/** Cubic 20³ cell-center sample — thin shells miss this (no AABB expand / dilate). */
export function cellCenterOccupancyCount(tris, bounds, n = CSG_VOXEL_RES) {
  const res = Math.max(6, Math.min(28, Number(n) || CSG_VOXEL_RES));
  const min = bounds?.min || [0, 0, 0];
  const max = bounds?.max || [1, 1, 1];
  const sx = ((max[0] - min[0]) || 1) / res;
  const sy = ((max[1] - min[1]) || 1) / res;
  const sz = ((max[2] - min[2]) || 1) / res;
  const boxes = [];
  for (const t of tris || []) {
    if (!t?.[0] || !t[1] || !t[2]) continue;
    let tminx = Infinity;
    let tminy = Infinity;
    let tminz = Infinity;
    let tmaxx = -Infinity;
    let tmaxy = -Infinity;
    let tmaxz = -Infinity;
    for (const p of t) {
      if (p[0] < tminx) tminx = p[0];
      if (p[1] < tminy) tminy = p[1];
      if (p[2] < tminz) tminz = p[2];
      if (p[0] > tmaxx) tmaxx = p[0];
      if (p[1] > tmaxy) tmaxy = p[1];
      if (p[2] > tmaxz) tmaxz = p[2];
    }
    boxes.push({ min: [tminx, tminy, tminz], max: [tmaxx, tmaxy, tmaxz] });
  }
  let count = 0;
  for (let z = 0; z < res; z += 1) {
    const cz = min[2] + (z + 0.5) * sz;
    for (let y = 0; y < res; y += 1) {
      const cy = min[1] + (y + 0.5) * sy;
      for (let x = 0; x < res; x += 1) {
        const cx = min[0] + (x + 0.5) * sx;
        for (const b of boxes) {
          if (cx >= b.min[0] && cx <= b.max[0]
            && cy >= b.min[1] && cy <= b.max[1]
            && cz >= b.min[2] && cz <= b.max[2]) {
            count += 1;
            break;
          }
        }
      }
    }
  }
  return count;
}

export function strideTriangles(tris, max = CSG_VOXEL_INPUT_MAX) {
  const src = Array.isArray(tris) ? tris : [];
  if (src.length <= max) return src;
  const out = [];
  const step = src.length / max;
  for (let i = 0; i < max; i += 1) out.push(src[Math.floor(i * step)]);
  return out;
}

export function triangleBounds(tris) {
  let minx = Infinity;
  let miny = Infinity;
  let minz = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  let maxz = -Infinity;
  for (const t of tris || []) {
    for (const p of t || []) {
      if (!p) continue;
      if (p[0] < minx) minx = p[0];
      if (p[1] < miny) miny = p[1];
      if (p[2] < minz) minz = p[2];
      if (p[0] > maxx) maxx = p[0];
      if (p[1] > maxy) maxy = p[1];
      if (p[2] > maxz) maxz = p[2];
    }
  }
  if (!Number.isFinite(minx)) return { min: [0, 0, 0], max: [1, 1, 1] };
  return { min: [minx, miny, minz], max: [maxx, maxy, maxz] };
}

export function padBounds(bounds, pad = 0.02) {
  const min = bounds?.min || [0, 0, 0];
  const max = bounds?.max || [1, 1, 1];
  return {
    min: [min[0] - pad, min[1] - pad, min[2] - pad],
    max: [max[0] + pad, max[1] + pad, max[2] + pad],
  };
}

export function unionBounds(a, b) {
  const am = a?.min || [0, 0, 0];
  const ax = a?.max || [1, 1, 1];
  const bm = b?.min || [0, 0, 0];
  const bx = b?.max || [1, 1, 1];
  return {
    min: [Math.min(am[0], bm[0]), Math.min(am[1], bm[1]), Math.min(am[2], bm[2])],
    max: [Math.max(ax[0], bx[0]), Math.max(ax[1], bx[1]), Math.max(ax[2], bx[2])],
  };
}

function clampAxis(v, hi) {
  return Math.max(0, Math.min(hi, v));
}

function resolveVoxelAxes(res, bounds) {
  if (res && typeof res === "object") {
    return {
      nx: clampAxis(Math.round(res.nx || CSG_VOXEL_RES), 35),
      ny: clampAxis(Math.round(res.ny || CSG_VOXEL_RES), 35),
      nz: clampAxis(Math.round(res.nz || CSG_VOXEL_RES), 35),
    };
  }
  if (res === "adaptive") return adaptiveVoxelAxes(bounds);
  const n = Math.max(6, Math.min(28, Number(res) || CSG_VOXEL_RES));
  return { nx: n, ny: n, nz: n };
}

export function dilateOccupancy(grid, nx, ny, nz) {
  const out = new Uint8Array(grid.length);
  const at = (x, y, z) => grid[(z * ny + y) * nx + x];
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        if (!at(x, y, z)) continue;
        for (let dz = -1; dz <= 1; dz += 1) {
          const zz = z + dz;
          if (zz < 0 || zz >= nz) continue;
          for (let dy = -1; dy <= 1; dy += 1) {
            const yy = y + dy;
            if (yy < 0 || yy >= ny) continue;
            for (let dx = -1; dx <= 1; dx += 1) {
              const xx = x + dx;
              if (xx < 0 || xx >= nx) continue;
              out[(zz * ny + yy) * nx + xx] = 1;
            }
          }
        }
      }
    }
  }
  return out;
}

export function voxelizeTriangles(tris, bounds, res = CSG_VOXEL_RES, opts = {}) {
  const { nx, ny, nz } = resolveVoxelAxes(res, bounds);
  const min = bounds.min;
  const sx = ((bounds.max[0] - min[0]) || 1) / nx;
  const sy = ((bounds.max[1] - min[1]) || 1) / ny;
  const sz = ((bounds.max[2] - min[2]) || 1) / nz;
  let grid = new Uint8Array(nx * ny * nz);
  const fill = (x0, y0, z0, x1, y1, z1) => {
    for (let z = z0; z <= z1; z += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const row = (z * ny + y) * nx;
        for (let x = x0; x <= x1; x += 1) grid[row + x] = 1;
      }
    }
  };
  const expand = opts.expand !== false;
  const padX = expand ? Math.max(sx * 0.51, CSG_THIN_MIN_M) : 0;
  const padY = expand ? Math.max(sy * 0.51, CSG_THIN_MIN_M) : 0;
  const padZ = expand ? Math.max(sz * 0.51, CSG_THIN_MIN_M) : 0;
  for (const t of strideTriangles(tris, CSG_VOXEL_INPUT_MAX)) {
    if (!t?.[0] || !t[1] || !t[2]) continue;
    let tminx = Infinity;
    let tminy = Infinity;
    let tminz = Infinity;
    let tmaxx = -Infinity;
    let tmaxy = -Infinity;
    let tmaxz = -Infinity;
    for (const p of t) {
      if (p[0] < tminx) tminx = p[0];
      if (p[1] < tminy) tminy = p[1];
      if (p[2] < tminz) tminz = p[2];
      if (p[0] > tmaxx) tmaxx = p[0];
      if (p[1] > tmaxy) tmaxy = p[1];
      if (p[2] > tmaxz) tmaxz = p[2];
    }
    const x0 = clampAxis(Math.floor((tminx - padX - min[0]) / sx), nx - 1);
    const y0 = clampAxis(Math.floor((tminy - padY - min[1]) / sy), ny - 1);
    const z0 = clampAxis(Math.floor((tminz - padZ - min[2]) / sz), nz - 1);
    const x1 = clampAxis(Math.floor((tmaxx + padX - min[0]) / sx), nx - 1);
    const y1 = clampAxis(Math.floor((tmaxy + padY - min[1]) / sy), ny - 1);
    const z1 = clampAxis(Math.floor((tmaxz + padZ - min[2]) / sz), nz - 1);
    fill(x0, y0, z0, x1, y1, z1);
  }
  const own = triangleBounds(tris);
  const thin = opts.dilate === true || (opts.dilate !== false && isThinBounds(own, Math.max(nx, ny, nz)));
  if (thin) grid = dilateOccupancy(grid, nx, ny, nz);
  return { grid, res: Math.max(nx, ny, nz), nx, ny, nz, bounds, sx, sy, sz };
}

export function voxelCombineGrids(a, b, op) {
  const out = new Uint8Array(a.grid.length);
  const union = op === "union";
  const sub = op === "subtract";
  for (let i = 0; i < out.length; i += 1) {
    const A = a.grid[i];
    const B = b.grid[i];
    if (union) out[i] = A | B;
    else if (sub) out[i] = A && !B ? 1 : 0;
    else out[i] = A & B;
  }
  return {
    grid: out,
    res: a.res,
    nx: a.nx,
    ny: a.ny,
    nz: a.nz,
    bounds: a.bounds,
    sx: a.sx,
    sy: a.sy,
    sz: a.sz,
  };
}

export function voxelSurfaceTriangles(vox) {
  const nx = vox.nx || vox.res;
  const ny = vox.ny || vox.res;
  const nz = vox.nz || vox.res;
  const min = vox.bounds.min;
  const sx = vox.sx;
  const sy = vox.sy;
  const sz = vox.sz;
  const grid = vox.grid;
  const occ = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return 0;
    return grid[(z * ny + y) * nx + x];
  };
  const corner = (x, y, z) => [min[0] + x * sx, min[1] + y * sy, min[2] + z * sz];
  const quad = (a, b, c, d) => {
    tris.push([a, b, c], [a, c, d]);
  };
  const tris = [];
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        if (!occ(x, y, z)) continue;
        if (!occ(x - 1, y, z)) {
          quad(corner(x, y, z), corner(x, y + 1, z), corner(x, y + 1, z + 1), corner(x, y, z + 1));
        }
        if (!occ(x + 1, y, z)) {
          quad(corner(x + 1, y, z), corner(x + 1, y, z + 1), corner(x + 1, y + 1, z + 1), corner(x + 1, y + 1, z));
        }
        if (!occ(x, y - 1, z)) {
          quad(corner(x, y, z), corner(x, y, z + 1), corner(x + 1, y, z + 1), corner(x + 1, y, z));
        }
        if (!occ(x, y + 1, z)) {
          quad(corner(x, y + 1, z), corner(x + 1, y + 1, z), corner(x + 1, y + 1, z + 1), corner(x, y + 1, z + 1));
        }
        if (!occ(x, y, z - 1)) {
          quad(corner(x, y, z), corner(x + 1, y, z), corner(x + 1, y + 1, z), corner(x, y + 1, z));
        }
        if (!occ(x, y, z + 1)) {
          quad(corner(x, y, z + 1), corner(x, y + 1, z + 1), corner(x + 1, y + 1, z + 1), corner(x + 1, y, z + 1));
        }
      }
    }
  }
  return tris;
}

export function voxelCsg(trisA, trisB, op, opts = {}) {
  const bounds = padBounds(unionBounds(triangleBounds(trisA), triangleBounds(trisB)), 0.02);
  const thin = isThinBounds(triangleBounds(trisA)) || isThinBounds(triangleBounds(trisB));
  const axes = opts.iso === true
    ? CSG_VOXEL_RES
    : (opts.axes || (thin ? "adaptive" : CSG_VOXEL_RES));
  const a = voxelizeTriangles(trisA, bounds, axes, opts);
  const b = voxelizeTriangles(trisB, bounds, axes, opts);
  return voxelSurfaceTriangles(voxelCombineGrids(a, b, op));
}

export function simplifyTriangles(tris, maxTris = CSG_BSP_MAX_TRIS) {
  const src = Array.isArray(tris) ? tris : [];
  if (src.length <= maxTris) return src;
  const bounds = padBounds(triangleBounds(src), 0.01);
  let res = src.length > 480 ? 10 : src.length > 240 ? 12 : 14;
  let out = voxelSurfaceTriangles(voxelizeTriangles(src, bounds, res));
  while (out.length > Math.max(24, maxTris * 4) && res > 6) {
    res -= 2;
    out = voxelSurfaceTriangles(voxelizeTriangles(src, bounds, res));
  }
  if (out.length >= src.length) return strideTriangles(src, maxTris);
  return out;
}

export function triangleMeshVolume(tris) {
  let acc = 0;
  for (const t of tris || []) {
    const a = t[0];
    const b = t[1];
    const c = t[2];
    if (!a || !b || !c) continue;
    acc += a[0] * (b[1] * c[2] - b[2] * c[1])
      + a[1] * (b[2] * c[0] - b[0] * c[2])
      + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return Math.abs(acc) / 6;
}

function vec(x, y, z) {
  return { x, y, z };
}

function vclone(a) {
  return { x: a.x, y: a.y, z: a.z };
}

function vadd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vsub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vscale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function vdot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vcross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function vlerp(a, b, t) {
  return vadd(a, vscale(vsub(b, a), t));
}

function vunit(a) {
  const n = Math.hypot(a.x, a.y, a.z) || 1;
  return vscale(a, 1 / n);
}

function planeFromPoints(a, b, c) {
  const n = vunit(vcross(vsub(b, a), vsub(c, a)));
  return { normal: n, w: vdot(n, a) };
}

function splitPolygon(plane, polygon, coplanarFront, coplanarBack, front, back) {
  const verts = polygon.vertices;
  const types = [];
  let polygonType = 0;
  for (const v of verts) {
    const t = vdot(plane.normal, v) - plane.w;
    const type = t < -EPSILON ? BACK : t > EPSILON ? FRONT : COPLANAR;
    polygonType |= type;
    types.push(type);
  }
  if (polygonType === COPLANAR) {
    (vdot(plane.normal, polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
    return;
  }
  if (polygonType === FRONT) {
    front.push(polygon);
    return;
  }
  if (polygonType === BACK) {
    back.push(polygon);
    return;
  }
  const f = [];
  const b = [];
  for (let i = 0; i < verts.length; i += 1) {
    const j = (i + 1) % verts.length;
    const ti = types[i];
    const tj = types[j];
    const vi = verts[i];
    const vj = verts[j];
    if (ti !== BACK) f.push(vi);
    if (ti !== FRONT) b.push(ti !== BACK ? vclone(vi) : vi);
    if ((ti | tj) === SPANNING) {
      const t = (plane.w - vdot(plane.normal, vi)) / (vdot(plane.normal, vsub(vj, vi)) || 1);
      const mid = vlerp(vi, vj, t);
      f.push(mid);
      b.push(vclone(mid));
    }
  }
  if (f.length >= 3) front.push({ vertices: f, plane: polygon.plane });
  if (b.length >= 3) back.push({ vertices: b, plane: polygon.plane });
}

function Node(polygons) {
  this.plane = null;
  this.front = null;
  this.back = null;
  this.polygons = [];
  if (polygons?.length) this.build(polygons);
}

Node.prototype.clone = function clone() {
  const n = new Node();
  n.plane = this.plane ? { normal: vclone(this.plane.normal), w: this.plane.w } : null;
  n.front = this.front && this.front.clone();
  n.back = this.back && this.back.clone();
  n.polygons = this.polygons.map((p) => ({
    vertices: p.vertices.map(vclone),
    plane: { normal: vclone(p.plane.normal), w: p.plane.w },
  }));
  return n;
};

Node.prototype.invert = function invert() {
  for (const p of this.polygons) {
    p.vertices.reverse();
    p.plane = { normal: vscale(p.plane.normal, -1), w: -p.plane.w };
  }
  if (this.plane) this.plane = { normal: vscale(this.plane.normal, -1), w: -this.plane.w };
  this.front?.invert();
  this.back?.invert();
  const tmp = this.front;
  this.front = this.back;
  this.back = tmp;
};

Node.prototype.clipPolygons = function clipPolygons(polygons) {
  if (!this.plane) return polygons.slice();
  const front = [];
  const back = [];
  for (const p of polygons) splitPolygon(this.plane, p, front, back, front, back);
  const keptFront = this.front ? this.front.clipPolygons(front) : front;
  const keptBack = this.back ? this.back.clipPolygons(back) : [];
  return keptFront.concat(keptBack);
};

Node.prototype.clipTo = function clipTo(bsp) {
  this.polygons = bsp.clipPolygons(this.polygons);
  this.front?.clipTo(bsp);
  this.back?.clipTo(bsp);
};

Node.prototype.allPolygons = function allPolygons() {
  let list = this.polygons.slice();
  if (this.front) list = list.concat(this.front.allPolygons());
  if (this.back) list = list.concat(this.back.allPolygons());
  return list;
};

Node.prototype.build = function build(polygons) {
  if (!polygons.length) return;
  if (!this.plane) this.plane = { normal: vclone(polygons[0].plane.normal), w: polygons[0].plane.w };
  const front = [];
  const back = [];
  for (const p of polygons) splitPolygon(this.plane, p, this.polygons, this.polygons, front, back);
  if (front.length) {
    if (!this.front) this.front = new Node();
    this.front.build(front);
  }
  if (back.length) {
    if (!this.back) this.back = new Node();
    this.back.build(back);
  }
};

function polygonsFromTriangles(tris) {
  const out = [];
  for (const t of tris || []) {
    if (!t?.[0] || !t[1] || !t[2]) continue;
    const a = vec(t[0][0], t[0][1], t[0][2]);
    const b = vec(t[1][0], t[1][1], t[1][2]);
    const c = vec(t[2][0], t[2][1], t[2][2]);
    const plane = planeFromPoints(a, b, c);
    if (Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z) < 1e-8) continue;
    out.push({ vertices: [a, b, c], plane });
  }
  return out;
}

function trianglesFromPolygons(polygons) {
  const tris = [];
  for (const p of polygons || []) {
    const vs = p.vertices;
    for (let i = 2; i < vs.length; i += 1) {
      tris.push([
        [vs[0].x, vs[0].y, vs[0].z],
        [vs[i - 1].x, vs[i - 1].y, vs[i - 1].z],
        [vs[i].x, vs[i].y, vs[i].z],
      ]);
    }
  }
  return tris;
}

function bspCsg(trisA, trisB, operation) {
  const a = new Node(polygonsFromTriangles(trisA));
  const b = new Node(polygonsFromTriangles(trisB));
  if (operation === "union") {
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
  } else if (operation === "subtract") {
    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    a.invert();
  } else if (operation === "intersect") {
    a.invert();
    b.clipTo(a);
    b.invert();
    a.clipTo(b);
    b.clipTo(a);
    a.build(b.allPolygons());
    a.invert();
  } else {
    return (trisA || []).slice();
  }
  return trianglesFromPolygons(a.allPolygons());
}

function tryBsp(trisA, trisB, operation) {
  const out = bspCsg(trisA, trisB, operation);
  if (out.length && triangleMeshVolume(out) > 1e-8) return out;
  return null;
}

export function csgTriangles(trisA, trisB, op, opts = {}) {
  const operation = combineOpFromMode(op) || op;
  if (!trisA?.length) return operation === "union" ? (trisB || []) : [];
  if (!trisB?.length) return operation === "subtract" || operation === "union" ? (trisA || []) : [];
  const total = (trisA.length || 0) + (trisB.length || 0);
  if (!opts.forceVoxel && shouldPreferBsp(trisA.length, trisB.length)) {
    try {
      const hit = tryBsp(trisA, trisB, operation);
      if (hit) return hit;
    } catch {
      /* simplify + BSP, then voxel */
    }
  }
  if (!opts.forceVoxel && total <= CSG_BSP_SAFE_TRIS * 3) {
    const a = simplifyTriangles(trisA, CSG_BSP_SAFE_TRIS);
    const b = simplifyTriangles(trisB, CSG_BSP_SAFE_TRIS);
    if (shouldPreferBsp(a.length, b.length)) {
      try {
        const hit = tryBsp(a, b, operation);
        if (hit) return hit;
      } catch {
        /* voxel fallback */
      }
    }
  }
  const a = total > CSG_BSP_SAFE_TRIS ? simplifyTriangles(trisA, CSG_BSP_MAX_TRIS * 2) : trisA;
  const b = total > CSG_BSP_SAFE_TRIS ? simplifyTriangles(trisB, CSG_BSP_MAX_TRIS * 2) : trisB;
  return voxelCsg(a, b, operation, opts);
}

export function csgTwoSolids(specA, specB, mode) {
  const op = combineOpFromMode(mode);
  if (!op) return { ok: false, error: "Combine is off", triangles: [] };
  const tris = csgTriangles(solidSpecTriangles(specA), solidSpecTriangles(specB), op);
  const volume = triangleMeshVolume(tris);
  if (!tris.length || volume < 1e-6) return { ok: false, error: "Boolean is empty", triangles: [], op, volume };
  return { ok: true, op, triangles: tris, volume };
}

function vecFrom(point) {
  if (!point) return vec(0, 0, 0);
  if (Array.isArray(point)) return vec(Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0);
  return vec(Number(point.x) || 0, Number(point.y) || 0, Number(point.z) || 0);
}

function capTrianglesFromPoints(pts, normal) {
  const uniq = [];
  const seen = new Set();
  for (const p of pts || []) {
    if (!p) continue;
    const key = `${p.x.toFixed(4)}|${p.y.toFixed(4)}|${p.z.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
  }
  if (uniq.length < 3) return [];
  const c = vec(0, 0, 0);
  for (const p of uniq) {
    c.x += p.x;
    c.y += p.y;
    c.z += p.z;
  }
  const inv = 1 / uniq.length;
  c.x *= inv;
  c.y *= inv;
  c.z *= inv;
  const n = vunit(normal);
  const helper = Math.abs(n.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
  const u = vunit(vcross(n, helper));
  const v = vcross(n, u);
  uniq.sort((a, b) => Math.atan2(vdot(vsub(a, c), v), vdot(vsub(a, c), u))
    - Math.atan2(vdot(vsub(b, c), v), vdot(vsub(b, c), u)));
  const cap = [];
  for (let i = 0; i < uniq.length; i += 1) {
    const a = uniq[i];
    const b = uniq[(i + 1) % uniq.length];
    const ab = vsub(a, c);
    const ac = vsub(b, c);
    const cross = vcross(ab, ac);
    const outward = vscale(n, -1);
    const tri = vdot(cross, outward) >= 0
      ? [[c.x, c.y, c.z], [a.x, a.y, a.z], [b.x, b.y, b.z]]
      : [[c.x, c.y, c.z], [b.x, b.y, b.z], [a.x, a.y, a.z]];
    cap.push(tri);
  }
  return cap;
}

/** Keep the FRONT side of a plane and cap the cut. Arkio / Gravity Sketch cut-plane. */
export function sliceTrianglesByPlane(tris, origin, normal) {
  const n = vunit(vecFrom(normal));
  if (Math.hypot(n.x, n.y, n.z) < 1e-8) return (tris || []).slice();
  const o = vecFrom(origin);
  const plane = { normal: n, w: vdot(n, o) };
  const front = [];
  const capPts = [];
  const onPlane = (v) => Math.abs(vdot(n, v) - plane.w) <= EPSILON * 12;
  for (const p of polygonsFromTriangles(tris)) {
    const f = [];
    const b = [];
    const cf = [];
    const cb = [];
    splitPolygon(plane, p, cf, cb, f, b);
    for (const poly of f.concat(cf)) front.push(poly);
    for (const poly of f.concat(b)) {
      for (const v of poly.vertices || []) {
        if (onPlane(v)) capPts.push(v);
      }
    }
  }
  const kept = trianglesFromPolygons(front);
  if (!kept.length) return [];
  return kept.concat(capTrianglesFromPoints(capPts, n));
}
