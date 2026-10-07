/**
 * Gravity Sketch / Arkio build helpers for the XR toolbelt:
 * snap/grid (lock vs soft), symmetry, boolean combine, wall/floor massing,
 * revolve, loft, layers, duplicate, undo last solid, wall-height pull.
 */

import { combineOpFromMode, csgTriangles, sliceTrianglesByPlane, solidSpecTriangles } from "./xr-csg.js?v=20260908-xr-ent4";
import { shouldRunCsgNow } from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5";

const COMBINES = ["new", "add", "cut", "intersect"];
const SYMS = ["off", "x", "y", "z"];

export const SNAP_PRESETS = [
  { step: 0, strength: 1, label: "Off" },
  { step: 0.01, strength: 0.4, label: "10 mm soft" },
  { step: 0.01, strength: 1, label: "10 mm lock" },
  { step: 0.05, strength: 0.4, label: "50 mm soft" },
  { step: 0.05, strength: 1, label: "50 mm lock" },
  { step: 0.1, strength: 1, label: "100 mm lock" },
];

export function snapAxis(value, step, strength = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || !step) return n;
  const snapped = Math.round(n / step) * step;
  if ((strength ?? 1) >= 0.999) return snapped;
  return Math.abs(n - snapped) <= step * strength ? snapped : n;
}

/** Blocks-style join: snap a live corner/edge to an existing body AABB corner. */
export const CORNER_JOIN_M = 0.045;

export function aabbCornersFromCenterSize(cx, cy, cz, sx, sy, sz) {
  const hx = Math.abs(Number(sx) || 0) * 0.5;
  const hy = Math.abs(Number(sy) || 0) * 0.5;
  const hz = Math.abs(Number(sz) || 0) * 0.5;
  const x0 = Number(cx) || 0;
  const y0 = Number(cy) || 0;
  const z0 = Number(cz) || 0;
  const out = [];
  for (const ix of [-1, 1]) {
    for (const iy of [-1, 1]) {
      for (const iz of [-1, 1]) {
        out.push({ x: x0 + ix * hx, y: y0 + iy * hy, z: z0 + iz * hz });
      }
    }
  }
  return out;
}

export function nearestCornerJoin(sourceCorners = [], targetCorners = [], threshold = CORNER_JOIN_M) {
  const max = Number(threshold) || CORNER_JOIN_M;
  let best = null;
  for (const s of sourceCorners) {
    if (!s) continue;
    for (const t of targetCorners) {
      if (!t) continue;
      const dx = (Number(t.x) || 0) - (Number(s.x) || 0);
      const dy = (Number(t.y) || 0) - (Number(s.y) || 0);
      const dz = (Number(t.z) || 0) - (Number(s.z) || 0);
      const d = Math.hypot(dx, dy, dz);
      if (d <= max && (!best || d < best.d)) {
        best = { dx, dy, dz, d, from: s, to: t };
      }
    }
  }
  return best;
}

export function translatePointByJoin(point, join) {
  if (!point || !join) return point;
  return {
    x: (Number(point.x) || 0) + (Number(join.dx) || 0),
    y: (Number(point.y) || 0) + (Number(join.dy) || 0),
    z: (Number(point.z) || 0) + (Number(join.dz) || 0),
  };
}

export function extrudeAabbFace(box, axis, sign, coord, minSize = 0.02) {
  const b = box || {};
  const min = [
    (Number(b.cx) || 0) - Math.abs(Number(b.sx) || 0) * 0.5,
    (Number(b.cy) || 0) - Math.abs(Number(b.sy) || 0) * 0.5,
    (Number(b.cz) || 0) - Math.abs(Number(b.sz) || 0) * 0.5,
  ];
  const max = [
    (Number(b.cx) || 0) + Math.abs(Number(b.sx) || 0) * 0.5,
    (Number(b.cy) || 0) + Math.abs(Number(b.sy) || 0) * 0.5,
    (Number(b.cz) || 0) + Math.abs(Number(b.sz) || 0) * 0.5,
  ];
  const i = axis === "y" ? 1 : axis === "z" ? 2 : 0;
  const s = Number(sign) >= 0 ? 1 : -1;
  const c = Number(coord);
  const lo = Number(minSize) || 0.02;
  if (Number.isFinite(c)) {
    if (s >= 0) max[i] = Math.max(min[i] + lo, c);
    else min[i] = Math.min(max[i] - lo, c);
  }
  return {
    cx: (min[0] + max[0]) * 0.5,
    cy: (min[1] + max[1]) * 0.5,
    cz: (min[2] + max[2]) * 0.5,
    sx: Math.max(lo, max[0] - min[0]),
    sy: Math.max(lo, max[1] - min[1]),
    sz: Math.max(lo, max[2] - min[2]),
  };
}

export function wallSizeFromDrag(dx, dy, dz, { defaultH = 0.25, pullAfter = 0.06 } = {}) {
  const x = Math.max(0.08, Number(dx) || 0, Number(dz) || 0);
  const pulling = (Number(dy) || 0) > pullAfter;
  const y = pulling ? Math.max(0.08, Number(dy) || 0) : defaultH;
  return { x, y, z: 0.08, pulling };
}

export function nextLayerFocus(layers = [], focus = "all") {
  const list = Array.isArray(layers) && layers.length
    ? layers.map((l) => ({ ...l }))
    : [{ id: "default", name: "Layer 1", visible: true }];
  const ids = ["all", ...list.map((l) => l.id)];
  const i = ids.indexOf(focus);
  let nextLayers = list;
  let nextFocus;
  if (i < 0) {
    nextFocus = "all";
  } else if (i === ids.length - 1) {
    if (list.length < 5) {
      const n = list.length + 1;
      const id = `L${n}`;
      nextLayers = [...list, { id, name: `Layer ${n}`, visible: true }];
      nextFocus = id;
    } else {
      nextFocus = "all";
    }
  } else {
    nextFocus = ids[i + 1];
  }
  const layerId = nextFocus === "all" ? (nextLayers[0]?.id || "default") : nextFocus;
  const label = nextFocus === "all"
    ? "All layers"
    : (nextLayers.find((l) => l.id === nextFocus)?.name || nextFocus);
  return { layers: nextLayers, focus: nextFocus, layerId, label };
}

export function createXrBuildTools({ THREE, scene } = {}) {
  const group = new THREE.Group();
  group.name = "xrBuildTools";
  group.renderOrder = 2560;
  try { scene?.add(group); } catch { /* ignore */ }

  let snapIndex = 1;
  let lastOnSnapIndex = 4;
  let combineIndex = 0;
  let symIndex = 0;
  let layerId = "default";
  let layerFocus = "all";
  const layers = [{ id: "default", name: "Layer 1", visible: true }];
  const solids = [];
  let grid = null;
  let snapGridWanted = false;
  let wallPull = null;

  function snapPreset() {
    return SNAP_PRESETS[snapIndex] || SNAP_PRESETS[0];
  }

  function snapStep() {
    return snapPreset().step || 0;
  }

  function snapStrength() {
    return snapPreset().strength ?? 1;
  }

  function snapLabel() {
    return snapPreset().label || "Off";
  }

  function combineMode() {
    return COMBINES[combineIndex] || "new";
  }

  function symmetryAxis() {
    return SYMS[symIndex] || "off";
  }

  function cycleSnap() {
    snapIndex = (snapIndex + 1) % SNAP_PRESETS.length;
    if (snapStep()) lastOnSnapIndex = snapIndex;
    syncGrid();
    return snapLabel();
  }

  function snapEnabled() {
    return snapStep() > 0;
  }

  function setSnapEnabled(on) {
    if (on) {
      if (!snapStep()) {
        const fallback = SNAP_PRESETS[lastOnSnapIndex]?.step ? lastOnSnapIndex : 4;
        snapIndex = fallback;
      }
    } else if (snapStep()) {
      lastOnSnapIndex = snapIndex;
      snapIndex = 0;
    }
    syncGrid();
    return snapLabel();
  }

  function cycleCombine() {
    combineIndex = (combineIndex + 1) % COMBINES.length;
    return combineMode();
  }

  function cycleSymmetry() {
    symIndex = (symIndex + 1) % SYMS.length;
    return symmetryAxis();
  }

  function snapPoint(point) {
    if (!point) return point;
    const step = snapStep();
    if (!step) return point;
    const strength = snapStrength();
    const out = point.clone ? point.clone() : new THREE.Vector3(point.x, point.y, point.z);
    out.x = snapAxis(out.x, step, strength);
    out.y = snapAxis(out.y, step, strength);
    out.z = snapAxis(out.z, step, strength);
    return out;
  }

  function bodyAabbCorners(limit = 12) {
    const corners = [];
    const n = Math.min(solids.length, Math.max(0, limit));
    for (let i = solids.length - n; i < solids.length; i += 1) {
      const s = solids[i];
      if (!s) continue;
      const pos = worldPosOf(s, s.mesh);
      const size = s.sizeM || { x: 0.08, y: 0.08, z: 0.08 };
      corners.push(...aabbCornersFromCenterSize(pos.x, pos.y, pos.z, size.x, size.y, size.z));
    }
    return corners;
  }

  function snapPointWithJoin(point, {
    box = null,
    threshold = CORNER_JOIN_M,
  } = {}) {
    if (!point) return point;
    if (!snapEnabled()) return point;
    const grid = snapPoint(point);
    const targets = bodyAabbCorners(12);
    if (!targets.length) return grid;
    const source = box
      ? aabbCornersFromCenterSize(box.cx, box.cy, box.cz, box.sx, box.sy, box.sz)
      : [{ x: grid.x, y: grid.y, z: grid.z }];
    const join = nearestCornerJoin(source, targets, threshold);
    if (!join) return grid;
    if (grid.clone) {
      grid.x += join.dx;
      grid.y += join.dy;
      grid.z += join.dz;
      return grid;
    }
    return translatePointByJoin(grid, join);
  }

  function mirrorPoint(point, axis = symmetryAxis()) {
    if (!point || axis === "off") return null;
    const m = point.clone ? point.clone() : new THREE.Vector3(point.x, point.y, point.z);
    if (axis === "x") m.x = -m.x;
    else if (axis === "y") m.y = -m.y;
    else if (axis === "z") m.z = -m.z;
    return m;
  }

  function mirrorPoints(points) {
    const axis = symmetryAxis();
    if (axis === "off" || !points?.length) return null;
    return points.map((p) => mirrorPoint(p, axis)).filter(Boolean);
  }

  function disposeSnapGrid() {
    if (!grid) return;
    group.remove(grid);
    grid.geometry?.dispose?.();
    if (Array.isArray(grid.material)) grid.material.forEach((m) => m?.dispose?.());
    else grid.material?.dispose?.();
    grid = null;
  }

  function syncGrid() {
    disposeSnapGrid();
    // Y-up GridHelper reads as a vertical grey quad in the Z-up desktop viewport.
    // Only build it while XR is presenting.
    if (!snapGridWanted) return;
    const step = snapStep();
    if (!step) return;
    const size = 2.4;
    const divs = Math.max(4, Math.round(size / step));
    grid = new THREE.GridHelper(size, divs, 0x64748b, 0x334155);
    grid.name = "xr-snap-grid";
    grid.userData.xrSnapGrid = true;
    grid.position.y = 0.001;
    grid.material.transparent = true;
    grid.material.opacity = 0.28;
    grid.renderOrder = 10;
    group.add(grid);
  }

  function setSnapGridVisible(on) {
    snapGridWanted = !!on;
    syncGrid();
  }

  function addLayer(name) {
    const id = `L${layers.length + 1}`;
    layers.push({ id, name: name || `Layer ${layers.length + 1}`, visible: true });
    layerId = id;
    return id;
  }

  function applyLayerVisibility() {
    for (const s of solids) {
      if (!s.mesh) continue;
      s.mesh.visible = layerFocus === "all" || s.layer === layerFocus;
    }
  }

  function cycleLayer() {
    const next = nextLayerFocus(layers, layerFocus);
    layers.length = 0;
    next.layers.forEach((l) => layers.push(l));
    layerFocus = next.focus;
    layerId = next.layerId;
    applyLayerVisibility();
    return next.label;
  }

  function disposeMesh(mesh) {
    if (!mesh) return;
    try { mesh.parent?.remove(mesh); } catch { /* ignore */ }
    mesh.traverse?.((o) => {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach((m) => m?.dispose?.());
      else o.material?.dispose?.();
    });
  }

  function worldPosOf(spec, mesh) {
    if (spec?.worldPosition?.clone) return spec.worldPosition.clone();
    if (spec?.worldPosition) {
      return new THREE.Vector3(spec.worldPosition.x, spec.worldPosition.y, spec.worldPosition.z);
    }
    if (mesh?.position?.clone) return mesh.position.clone();
    return new THREE.Vector3();
  }

  function noteSolid(kind, spec, mesh = null) {
    solids.push({
      kind,
      layer: layerId,
      combine: combineMode(),
      color: spec?.color,
      sizeM: spec?.sizeM ? { ...spec.sizeM } : null,
      worldPosition: worldPosOf(spec, mesh),
      mesh: mesh || null,
    });
    if (mesh) {
      mesh.userData.xrBuild = kind;
      mesh.userData.xrDrawable = true;
      mesh.userData.xrDrawSolid = true;
      mesh.userData.xrLayer = layerId;
      mesh.visible = layerFocus === "all" || layerFocus === layerId;
    }
    if (solids.length > 48) {
      const evicted = solids.shift();
      if (evicted?.mesh && evicted.mesh !== mesh) disposeMesh(evicted.mesh);
    }
    return solids[solids.length - 1];
  }

  function lastSolid() {
    return solids[solids.length - 1] || null;
  }

  function lastWall() {
    for (let i = solids.length - 1; i >= 0; i -= 1) {
      if (solids[i].kind === "wall") return solids[i];
    }
    return null;
  }

  function parkSolidMesh(mesh, parked = true) {
    if (!mesh) return;
    const u = mesh.userData || (mesh.userData = {});
    if (parked) {
      if (u.xrParkPrevVisible == null) u.xrParkPrevVisible = mesh.visible !== false;
      if (u.xrParkPrevDrawable == null) u.xrParkPrevDrawable = !!u.xrDrawable;
      mesh.visible = false;
      u.xrParked = true;
      u.xrDrawable = false;
    } else {
      mesh.visible = u.xrParkPrevVisible !== false;
      u.xrDrawable = u.xrParkPrevDrawable !== false;
      u.xrParked = false;
    }
  }

  function undoLastSolid() {
    const s = solids.pop();
    if (!s) return null;
    parkSolidMesh(s.mesh, true);
    return s;
  }

  function redoSolid(s) {
    if (!s) return null;
    parkSolidMesh(s.mesh, false);
    solids.push(s);
    return s;
  }

  function duplicateLastSolid({ offset = 0.12 } = {}) {
    const s = lastSolid();
    if (!s) return null;
    const pos = worldPosOf(s, s.mesh);
    pos.x += offset;
    return {
      kind: s.kind,
      worldPosition: pos,
      sizeM: s.sizeM ? { ...s.sizeM } : { x: 0.08, y: 0.08, z: 0.08 },
      color: s.color,
    };
  }

  /** Gravity Sketch stamp: copy last solid at a world point (controller tip) or in place. */
  function stampLastSolid(worldPosition) {
    const s = lastSolid();
    if (!s) return null;
    const pos = worldPosition
      ? new THREE.Vector3(
        Number(worldPosition.x) || 0,
        Number(worldPosition.y) || 0,
        Number(worldPosition.z) || 0,
      )
      : worldPosOf(s, s.mesh);
    return {
      kind: s.kind,
      worldPosition: pos,
      sizeM: s.sizeM ? { ...s.sizeM } : { x: 0.08, y: 0.08, z: 0.08 },
      color: s.color,
    };
  }

  /** Arkio-style linear array of the last solid along X (skips the original). */
  function arrayLastSolid({ count = 3, gap = 0.14, axis = "x" } = {}) {
    const s = lastSolid();
    if (!s) return [];
    const n = Math.max(2, Math.min(8, Number(count) || 3));
    const g = Number.isFinite(Number(gap)) ? Number(gap) : 0.14;
    const ax = axis === "y" ? "y" : axis === "z" ? "z" : "x";
    const specs = [];
    for (let i = 1; i < n; i += 1) {
      const pos = worldPosOf(s, s.mesh);
      pos[ax] += g * i;
      specs.push({
        kind: s.kind,
        worldPosition: pos,
        sizeM: s.sizeM ? { ...s.sizeM } : { x: 0.08, y: 0.08, z: 0.08 },
        color: s.color,
      });
    }
    return specs;
  }

  /** One-shot Gravity Sketch mirror: copy last solid across the live axis (X if Sym is off). */
  function mirrorLastSolid(axis) {
    const s = lastSolid();
    if (!s) return null;
    const ax = axis && axis !== "off" ? axis : (symmetryAxis() !== "off" ? symmetryAxis() : "x");
    const pos = worldPosOf(s, s.mesh);
    const mirrored = mirrorPoint(pos, ax);
    if (!mirrored) return null;
    return {
      kind: s.kind,
      worldPosition: mirrored,
      sizeM: s.sizeM ? { ...s.sizeM } : { x: 0.08, y: 0.08, z: 0.08 },
      color: s.color,
    };
  }

  /** Cut-plane: keep the FRONT side of a plane through the last solid and cap the cut. */
  function sliceLastSolid({ origin, normal } = {}) {
    const s = lastSolid();
    if (!s) return null;
    const pos = worldPosOf(s, s.mesh);
    const o = origin || pos;
    const n = normal && (Number(normal.x) || Number(normal.y) || Number(normal.z))
      ? normal
      : { x: 1, y: 0, z: 0 };
    const tris = trianglesForSolid(s);
    if (!tris.length) return null;
    const sliced = sliceTrianglesByPlane(tris, o, n);
    if (!sliced.length) return null;
    const mesh = trianglesToMesh(sliced, s.color || 0x58a6ff);
    disposeMesh(s.mesh);
    solids.pop();
    group.add(mesh);
    const row = noteSolid("slice", {
      color: mesh.material?.color?.getHex?.() || s.color,
      sizeM: s.sizeM,
      worldPosition: mesh.position,
    }, mesh);
    return { ok: true, mesh, solid: row };
  }

  function meshFromKind(kind, color = 0x58a6ff) {
    let geo;
    if (kind === "box" || kind === "wall" || kind === "floor") geo = new THREE.BoxGeometry(1, 1, 1);
    else if (kind === "sphere") geo = new THREE.SphereGeometry(0.5, 16, 12);
    else if (kind === "cylinder") geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
    else if (kind === "cone") geo = new THREE.CylinderGeometry(0.001, 0.5, 1, 16);
    else if (kind === "torus") geo = new THREE.TorusGeometry(0.5, 0.12, 8, 20);
    else geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.name = `xrSolid-${kind}`;
    mesh.userData.xrIgnoreBounds = true;
    mesh.userData.xrBuild = kind;
    mesh.userData.xrDrawable = true;
    mesh.userData.xrDrawSolid = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  function applyMeshSize(mesh, kind, sizeM) {
    if (!mesh || !sizeM) return;
    const w = Math.max(0.02, sizeM.x || 0.04);
    const h = Math.max(0.02, sizeM.y || 0.04);
    const d = Math.max(0.02, sizeM.z || 0.04);
    if (kind === "wall") mesh.scale.set(Math.max(w, d), h, 0.08);
    else if (kind === "floor") mesh.scale.set(Math.max(w, 0.16), 0.04, Math.max(d, 0.16));
    else if (kind === "sphere") {
      const s = Math.max(w, h, d);
      mesh.scale.set(s, s, s);
    } else if (kind === "cylinder" || kind === "cone") mesh.scale.set(w, h, w);
    else mesh.scale.set(w, h, d);
  }

  function commitSolid(spec) {
    if (!spec?.kind) return null;
    const mesh = meshFromKind(spec.kind, spec.color);
    applyMeshSize(mesh, spec.kind, spec.sizeM);
    if (spec.worldPosition) mesh.position.copy(worldPosOf(spec, null));
    group.add(mesh);
    noteSolid(spec.kind, spec, mesh);
    const mode = combineMode();
    if (combineOpFromMode(mode) && solids.length >= 2 && shouldRunCsgNow({})) {
      scheduleCombine(mode);
    }
    return mesh;
  }

  function meshWorldTriangles(mesh) {
    if (!mesh?.geometry) return [];
    try { mesh.updateMatrixWorld?.(true); } catch { /* ignore */ }
    const pos = mesh.geometry.getAttribute?.("position") || mesh.geometry.attributes?.position;
    if (!pos) return [];
    const idx = mesh.geometry.getIndex?.() || mesh.geometry.index;
    const m = mesh.matrixWorld;
    const apply = (i) => {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (m) {
        const e = m.elements;
        return [
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14],
        ];
      }
      return [x, y, z];
    };
    const tris = [];
    const push = (a, b, c) => {
      tris.push([apply(a), apply(b), apply(c)]);
    };
    if (idx) {
      const n = Math.min(idx.count, 1800);
      for (let i = 0; i + 2 < n; i += 3) push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    } else {
      const n = Math.min(pos.count, 600);
      for (let i = 0; i + 2 < n; i += 3) push(i, i + 1, i + 2);
    }
    return tris;
  }

  function trianglesToMesh(tris, color = 0x58a6ff) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(tris.length * 9);
    for (let i = 0; i < tris.length; i += 1) {
      const t = tris[i];
      pos.set([t[0][0], t[0][1], t[0][2], t[1][0], t[1][1], t[1][2], t[2][0], t[2][1], t[2][2]], i * 9);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.name = "xrSolid-combine";
    mesh.userData.xrBuild = "combine";
    mesh.userData.xrDrawable = true;
    mesh.userData.xrDrawSolid = true;
    mesh.userData.xrIgnoreBounds = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  function listDrawables() {
    return solids.map((s) => s.mesh).filter((m) => m && !m.userData?.xrParked && (m.userData?.xrDrawable || m.userData?.xrBuild));
  }

  function trianglesForSolid(solid) {
    if (solid?.mesh) {
      const live = meshWorldTriangles(solid.mesh);
      if (live.length) return live;
    }
    return solidSpecTriangles(solid);
  }

  function combineLastTwo(mode = combineMode()) {
    const op = combineOpFromMode(mode);
    if (!op) return null;
    if (solids.length < 2) return null;
    const a = solids[solids.length - 2];
    const b = solids[solids.length - 1];
    const tris = csgTriangles(trianglesForSolid(a), trianglesForSolid(b), op);
    if (!tris.length) return null;
    const mesh = trianglesToMesh(tris, b.color || a.color || 0x58a6ff);
    disposeMesh(a.mesh);
    disposeMesh(b.mesh);
    solids.pop();
    solids.pop();
    group.add(mesh);
    const row = noteSolid("combine", {
      color: mesh.material?.color?.getHex?.() || b.color,
      sizeM: a.sizeM || b.sizeM,
      worldPosition: mesh.position,
    }, mesh);
    return { ok: true, op, mesh, solid: row };
  }

  function runCombineLater(fn) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (typeof setTimeout === "function") setTimeout(fn, 0);
        else fn();
      });
      return;
    }
    if (typeof queueMicrotask === "function") queueMicrotask(fn);
    else fn();
  }

  function scheduleCombine(mode, onDone) {
    runCombineLater(() => {
      let out = null;
      try { out = combineLastTwo(mode); } catch { out = null; }
      try { onDone?.(out); } catch { /* ignore */ }
    });
  }

  function applyCombine({ onDone } = {}) {
    const mode = cycleCombine();
    const op = combineOpFromMode(mode);
    if (!op) return { mode, did: false, pending: false, hint: "Combine · off" };
    if (solids.length < 2) {
      return { mode, did: false, pending: false, hint: `Combine · ${mode} · draw two solids, tap Combine` };
    }
    const done = new Promise((resolve) => {
      scheduleCombine(mode, (out) => {
        const result = out?.ok
          ? { mode, did: true, pending: false, op: out.op, mesh: out.mesh, hint: `Combined · ${mode}` }
          : { mode, did: false, pending: false, op, hint: `Combine · ${mode} · overlap the two solids` };
        resolve(result);
        try { onDone?.(result); } catch { /* ignore */ }
      });
    });
    return { mode, did: false, pending: true, op, hint: `Combining · ${mode}…`, done };
  }

  function lastCombinedSolid() {
    for (let i = solids.length - 1; i >= 0; i -= 1) {
      if (solids[i].kind === "combine" && solids[i].mesh) return solids[i];
    }
    return null;
  }

  function beginWallHeight(point) {
    const s = lastWall();
    if (!s?.mesh || !point) return false;
    const h0 = s.sizeM?.y || Math.abs(s.mesh.scale.y) || 0.25;
    wallPull = {
      solid: s,
      startY: point.y,
      baseY: s.mesh.position.y - h0 * 0.5,
      height0: h0,
    };
    return true;
  }

  function pullWallHeight(point) {
    if (!wallPull?.solid?.mesh || !point) return null;
    const h = Math.max(0.08, wallPull.height0 + (point.y - wallPull.startY));
    const mesh = wallPull.solid.mesh;
    mesh.scale.y = h;
    mesh.position.y = wallPull.baseY + h * 0.5;
    wallPull.solid.sizeM = { ...(wallPull.solid.sizeM || {}), y: h };
    wallPull.solid.worldPosition = mesh.position.clone();
    return h;
  }

  function finishWallHeight() {
    const s = wallPull?.solid || null;
    wallPull = null;
    return s;
  }

  function isPullingHeight() {
    return !!wallPull;
  }

  function revolveFromStroke(points, { color = 0x67e8f9, segments = 16 } = {}) {
    if (!points || points.length < 3) return null;
    const pts = points.slice(0, 28);
    const origin = pts[0];
    const axis = new THREE.Vector3(0, 1, 0);
    const vecs = pts.map((p) => {
      const rel = p.clone().sub(origin);
      const radial = Math.hypot(rel.x, rel.z);
      return new THREE.Vector2(Math.max(0.004, radial), rel.y);
    });
    try {
      const geo = new THREE.LatheGeometry(vecs, Math.min(24, segments), 0, Math.PI * 2);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.position.copy(origin);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      mesh.name = "xrRevolve";
      mesh.userData.xrBuild = "revolve";
      mesh.userData.xrIgnoreBounds = true;
      group.add(mesh);
      noteSolid("revolve", { color, sizeM: { x: 0.08, y: 0.08, z: 0.08 }, worldPosition: origin }, mesh);
      return mesh;
    } catch {
      return null;
    }
  }

  function loftFromStrokes(a, b, { color = 0x22c55e } = {}) {
    if (!a?.length || !b?.length) return null;
    const n = Math.min(24, a.length, b.length);
    if (n < 2) return null;
    const pos = new Float32Array(n * 2 * 3);
    const idx = [];
    for (let i = 0; i < n; i += 1) {
      const p = a[Math.min(i, a.length - 1)];
      const q = b[Math.min(i, b.length - 1)];
      pos.set([p.x, p.y, p.z], i * 3);
      pos.set([q.x, q.y, q.z], (n + i) * 3);
      if (i < n - 1) {
        idx.push(i, i + 1, n + i);
        idx.push(i + 1, n + i + 1, n + i);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.62,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.name = "xrLoft";
    mesh.userData.xrBuild = "loft";
    mesh.userData.xrIgnoreBounds = true;
    group.add(mesh);
    noteSolid("loft", { color, worldPosition: mesh.position }, mesh);
    return mesh;
  }

  function toPromptAugment() {
    const lines = [];
    if (symmetryAxis() !== "off") lines.push(`Symmetry: mirror across ${symmetryAxis()}.`);
    if (snapStep()) lines.push(`Snap grid: ${snapLabel()}.`);
    if (combineMode() !== "new") lines.push(`Boolean combine: ${combineMode()}.`);
    if (solids.length) {
      lines.push("XR massing / build tools:");
      solids.slice(-8).forEach((s, i) => {
        lines.push(`Build ${i + 1}: ${s.kind}${s.sizeM ? ` ~${Math.round((s.sizeM.x || 0) * 1000)}mm` : ""} (${s.combine}).`);
      });
    }
    return lines.join("\n");
  }

  function dispose() {
    try { scene?.remove(group); } catch { /* ignore */ }
    group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }

  return {
    group,
    setSnapGridVisible,
    snapPoint,
    snapPointWithJoin,
    snapLabel,
    snapStep,
    snapStrength,
    snapEnabled,
    setSnapEnabled,
    cycleSnap,
    cycleCombine,
    cycleSymmetry,
    combineMode,
    symmetryAxis,
    mirrorPoint,
    mirrorPoints,
    addLayer,
    cycleLayer,
    layers,
    layerFocus: () => layerFocus,
    noteSolid,
    commitSolid,
    listDrawables,
    lastSolid,
    lastWall,
    undoLastSolid,
    redoSolid,
    duplicateLastSolid,
    stampLastSolid,
    arrayLastSolid,
    mirrorLastSolid,
    sliceLastSolid,
    combineLastTwo,
    applyCombine,
    lastCombinedSolid,
    beginWallHeight,
    pullWallHeight,
    finishWallHeight,
    isPullingHeight,
    revolveFromStroke,
    loftFromStrokes,
    toPromptAugment,
    dispose,
  };
}
