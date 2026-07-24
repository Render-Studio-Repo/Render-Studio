/** Fusion-style 2D sketch editor — locked ortho view, entities, constraints. */

import * as THREE from "three";
import {
  applyPlaneBasis,
  fromUV as fromUVSpec,
  normalizePlaneRef,
  orientObjectToPlane,
  planeAxes as planeAxesFromSpec,
  planeNormal as planeNormalFromSpec,
  planeSpecFromData,
  planeSpecToRef,
  standardPlaneSpec,
  toUV as toUVSpec,
} from "./sketch-plane.js";

/** Fusion 360 sketch palette — light canvas, blue geometry, colored axes. */
const SKETCH_COLOR = 0x0066cc;
const SKETCH_SEL = 0x0696d7;
const PREVIEW_COLOR = 0x00a651;
const CONSTRAINT_COLOR = 0x5c2d91;
const AXIS_X = 0xe53935;
const AXIS_Y = 0x43a047;
const GRID_MINOR = 0xdcdcdc;
const GRID_MAJOR = 0xababab;
const CANVAS_PLANE = 0xf0f0f0;
const SNAP = 1;
const ENDPOINT_SNAP = 2.5;
const AXIS_SNAP_DEG = 8;
const ORTHO_HALF = 100;
const POINT_EQ_TOL = 0.05;
const INCH_TO_MM = 25.4;

const SKETCH_SHORTCUTS = {
  a: "arc",
  c: "circle",
  d: "dimension",
  e: "equal",
  h: "horizontal",
  l: "line",
  o: "offset",
  p: "point",
  r: "rectangle",
  s: "spline",
  t: "trim",
  v: "select",
};

const SHIFT_SKETCH_SHORTCUTS = {
  c: "coincident",
  e: "equal",
  f: "fix",
  h: "horizontal",
  p: "parallel",
  v: "vertical",
  x: "perpendicular",
};

function uid(prefix = "s") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createSketchEditor({
  scene,
  camera,
  renderer,
  controls,
  viewport,
  onStatus,
  onFinished,
  onModeChange,
  onOverlay,
}) {
  const dom = renderer.domElement;
  const group = new THREE.Group();
  group.name = "sketch-editor";
  group.visible = false;
  scene.add(group);

  const overlayGroup = new THREE.Group();
  overlayGroup.name = "sketch-overlay";
  overlayGroup.visible = false;
  scene.add(overlayGroup);

  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  const constraintGroup = new THREE.Group();
  group.add(constraintGroup);
  let snapIndicator = null;
  let finishedPlane = "XY";
  let lastFinished = null;
  let activeViewportId = null;
  /** @type {Map<string, { group: THREE.Group, visible: boolean, data: object }>} */
  const viewportSketches = new Map();
  let globalSketchesVisible = true;

  let active = false;
  let tool = "line";
  let plane = "XY";
  let planeSpec = standardPlaneSpec("XY");
  let entities = [];
  let constraints = [];
  let selectedId = null;
  let pickRefs = [];
  let preview = null;
  let dragStart = null;
  let pointerDown = null;
  let pointerUv = null;
  let arcPts = [];
  let splinePts = [];
  let savedView = null;
  let panning = false;
  let panStart = null;
  let orthoZoom = 1;
  let panOffset = new THREE.Vector2(0, 0);
  let undoStack = [];
  let redoStack = [];

  function planeNormal() {
    return planeNormalFromSpec(planeSpec);
  }

  function planeAxes() {
    return planeAxesFromSpec(planeSpec);
  }

  function fromUVOnPlane(spec, u, v) {
    return fromUVSpec(spec, u, v);
  }

  function lineMeshLocal(a, b, color = SKETCH_COLOR) {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.u, a.v, 0),
      new THREE.Vector3(b.u, b.v, 0),
    ]);
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 50;
    line.frustumCulled = false;
    return line;
  }

  function polyMeshLocal(uvPoints, color = SKETCH_COLOR, closed = false) {
    const pts = uvPoints.map((p) => new THREE.Vector3(p.u, p.v, 0));
    if (closed && pts.length) pts.push(pts[0].clone());
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 51;
    line.frustumCulled = false;
    return line;
  }

  function toUV(v) {
    return toUVSpec(planeSpec, v);
  }

  function fromUV(u, v) {
    return fromUVSpec(planeSpec, u, v);
  }

  function snapUV(u, v) {
    return { u: Math.round(u / SNAP) * SNAP, v: Math.round(v / SNAP) * SNAP };
  }

  function pointsEqual(a, b, tol = POINT_EQ_TOL) {
    return Math.hypot(a.u - b.u, a.v - b.v) <= tol;
  }

  function collectSnapPoints(exclude = null) {
    const pts = [];
    for (const e of entities) {
      for (const p of entityPoints(e)) {
        if (exclude && exclude.entityId === e.id && exclude.key === p.key) continue;
        pts.push({ u: p.u, v: p.v, entityId: e.id, key: p.key });
      }
    }
    return pts;
  }

  function snapLineAxis(from, to) {
    const dx = to.u - from.u;
    const dy = to.v - from.v;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return to;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const nearH =
      Math.abs(deg) < AXIS_SNAP_DEG ||
      Math.abs(Math.abs(deg) - 180) < AXIS_SNAP_DEG;
    const nearV = Math.abs(Math.abs(deg) - 90) < AXIS_SNAP_DEG;
    if (nearH) return { u: to.u, v: from.v };
    if (nearV) return { u: from.u, v: to.v };
    return to;
  }

  function snapUVEnhanced(u, v, opts = {}) {
    let pt = snapUV(u, v);
    const candidates = collectSnapPoints(opts.exclude);
    let best = null;
    let bestD = ENDPOINT_SNAP;
    for (const p of candidates) {
      const d = Math.hypot(pt.u - p.u, pt.v - p.v);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) pt = { u: best.u, v: best.v };
    if (opts.chainFrom) pt = snapLineAxis(opts.chainFrom, pt);
    return { point: pt, snapped: best };
  }

  function showSnapIndicator(uv) {
    if (!uv) {
      if (snapIndicator) {
        group.remove(snapIndicator);
        snapIndicator.geometry?.dispose?.();
        snapIndicator.material?.dispose?.();
        snapIndicator = null;
      }
      return;
    }
    if (!snapIndicator) {
      snapIndicator = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.4, 24),
        new THREE.MeshBasicMaterial({ color: 0x00a651, depthTest: false, side: THREE.DoubleSide })
      );
      snapIndicator.renderOrder = 15;
    }
    snapIndicator.position.copy(fromUV(uv.u, uv.v));
    snapIndicator.position.add(planeNormal().clone().multiplyScalar(0.2));
    if (!snapIndicator.parent) group.add(snapIndicator);
  }

  function snapWorld(v, opts = {}) {
    const uv = toUV(v);
    const { point } = snapUVEnhanced(uv.u, uv.v, opts);
    return fromUV(point.u, point.v);
  }

  function ndc(event) {
    const rect = dom.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  function getRenderCamera() {
    return active ? orthoCam : null;
  }

  function updateOrthoProjection() {
    const w = dom.clientWidth || 1;
    const h = dom.clientHeight || 1;
    const aspect = w / h;
    const half = (ORTHO_HALF / orthoZoom);
    orthoCam.left = -half * aspect;
    orthoCam.right = half * aspect;
    orthoCam.top = half;
    orthoCam.bottom = -half;
    orthoCam.updateProjectionMatrix();
  }

  function lockCamera2D() {
    savedView = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      up: camera.up.clone(),
      target: controls.target.clone(),
    };
    orthoZoom = 1;
    panOffset.set(0, 0);
    positionOrthoCamera();
    updateOrthoProjection();
    emitOverlay();
  }

  function positionOrthoCamera() {
    const n = planeNormal();
    const ax = planeAxes();
    const dist = 300;
    const center = fromUV(panOffset.x, panOffset.y);
    orthoCam.position.copy(center).add(n.clone().multiplyScalar(dist));
    orthoCam.up.copy(ax.v);
    orthoCam.lookAt(center);
    orthoCam.updateProjectionMatrix();
  }

  function unlockCamera2D() {
    if (!savedView) return;
    camera.position.copy(savedView.position);
    camera.quaternion.copy(savedView.quaternion);
    camera.up.copy(savedView.up);
    controls.target.copy(savedView.target);
    controls.update();
    savedView = null;
    emitOverlay({ visible: false });
  }

  function focusCameraOnSketchPlane(spec = planeSpec) {
    savedView = null;
    const n = planeNormalFromSpec(spec);
    const ax = planeAxesFromSpec(spec);
    const o = new THREE.Vector3(spec.origin[0], spec.origin[1], spec.origin[2]);
    const dist = 380;
    camera.position.copy(o).add(n.clone().multiplyScalar(dist));
    camera.up.copy(ax.v);
    controls.target.copy(o);
    controls.update();
  }

  function toolHint(t = tool) {
    const hints = {
      line: "Line (L): click to place points · Esc or double-click to end chain",
      rectangle: "Rectangle (R): click first corner, drag to opposite corner",
      circle: "Circle (C): click center, drag to set radius",
      arc: "Arc (A): click three points on the arc",
      polygon: "Click center, drag to set radius",
      point: "Point (P): click to place a point",
      spline: "Spline (S): click fit points · double-click to finish",
      select: "Select (V): click sketch geometry to select",
      trim: "Trim (T): click a segment to remove it",
      offset: "Offset (O): click a line to offset 5 mm",
      coincident: "Click two points to make coincident",
      horizontal: "Horizontal (H): click a line",
      vertical: "Vertical (Shift+V): click a line",
      parallel: "Parallel (Shift+P): click two lines",
      perpendicular: "Perpendicular (Shift+X): click two lines",
      equal: "Equal (E): click two lines or circles",
      dimension: "Sketch Dimension (D): click a line/circle, then press Enter to keep or type a value",
      angle: "Click two lines, enter angle in degrees",
      fix: "Fix (Shift+F): click geometry to lock it in place",
    };
    return hints[t] || `Tool: ${String(t).replace(/_/g, " ")}`;
  }

  function emitOverlay(extra = {}) {
    onOverlay?.({
      visible: active,
      plane,
      tool,
      hint: extra.hint ?? toolHint(),
      entities: entities.length,
      constraints: constraints.length,
      ...extra,
    });
  }

  function buildSketchEnvironment() {
    const env = new THREE.Group();
    env.name = "sketch-env";

    const canvasPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 520),
      new THREE.MeshBasicMaterial({ color: CANVAS_PLANE, depthWrite: false })
    );
    canvasPlane.renderOrder = 0;
    orientObjectToPlane(canvasPlane, planeSpec);
    env.add(canvasPlane);

    const minorPts = [];
    const majorPts = [];
    const extent = 220;
    for (let i = -extent; i <= extent; i += 1) {
      const dst = i % 10 === 0 ? majorPts : minorPts;
      dst.push(fromUV(i, -extent), fromUV(i, extent));
      dst.push(fromUV(-extent, i), fromUV(extent, i));
    }
    if (minorPts.length) {
      const g = new THREE.BufferGeometry().setFromPoints(minorPts);
      const lines = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: GRID_MINOR, depthTest: false })
      );
      lines.renderOrder = 1;
      env.add(lines);
    }
    if (majorPts.length) {
      const g = new THREE.BufferGeometry().setFromPoints(majorPts);
      const lines = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: GRID_MAJOR, depthTest: false })
      );
      lines.renderOrder = 2;
      env.add(lines);
    }

    const axLen = 28;
    const xAxis = lineMesh({ u: 0, v: 0 }, { u: axLen, v: 0 }, AXIS_X);
    const yAxis = lineMesh({ u: 0, v: 0 }, { u: 0, v: axLen }, AXIS_Y);
    xAxis.renderOrder = 4;
    yAxis.renderOrder = 4;
    env.add(xAxis, yAxis);

    const origin = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 20),
      new THREE.MeshBasicMaterial({ color: 0x2b2b2b, depthTest: false })
    );
    origin.position.copy(fromUV(0, 0));
    origin.renderOrder = 5;
    orientObjectToPlane(origin, planeSpec, { offsetNormal: 0.05 });
    env.add(origin);

    group.add(env);
  }

  function snapshotState() {
    return {
      entities: JSON.parse(JSON.stringify(entities.map(({ id, type, data, fixed }) => ({ id, type, data, fixed })))),
      constraints: JSON.parse(JSON.stringify(constraints)),
    };
  }

  function pushUndo() {
    undoStack.push(snapshotState());
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
  }

  function applySnapshot(snap) {
    entities = snap.entities;
    constraints = snap.constraints;
    selectedId = null;
    dragStart = null;
    pickRefs = [];
    clearPreview();
    rebuildMeshes();
    renderConstraints();
    emitOverlay();
  }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(snapshotState());
    applySnapshot(undoStack.pop());
    return true;
  }

  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(snapshotState());
    applySnapshot(redoStack.pop());
    return true;
  }

  function clearPreview() {
    if (preview) {
      group.remove(preview);
      preview.geometry?.dispose?.();
      preview.material?.dispose?.();
      preview = null;
    }
  }

  function entityById(id) {
    return entities.find((e) => e.id === id) || null;
  }

  function disposeMesh(mesh) {
    if (!mesh) return;
    group.remove(mesh);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }

  function lineMesh(a, b, color = SKETCH_COLOR, width = 1) {
    const geom = new THREE.BufferGeometry().setFromPoints([fromUV(a.u, a.v), fromUV(b.u, b.v)]);
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: width });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 8;
    return line;
  }

  function polyMesh(uvPoints, color = SKETCH_COLOR, closed = false) {
    const pts = uvPoints.map((p) => fromUV(p.u, p.v));
    if (closed && pts.length) pts.push(pts[0].clone());
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 8;
    return line;
  }

  function rebuildMeshes() {
    for (const e of entities) disposeMesh(e.mesh);
    for (const e of entities) {
      const col = e.id === selectedId ? SKETCH_SEL : SKETCH_COLOR;
      if (e.type === "line") {
        e.mesh = lineMesh(e.data.a, e.data.b, col);
      } else if (e.type === "circle") {
        const pts = [];
        for (let i = 0; i <= 48; i++) {
          const t = (i / 48) * Math.PI * 2;
          pts.push({ u: e.data.c.u + Math.cos(t) * e.data.r, v: e.data.c.v + Math.sin(t) * e.data.r });
        }
        e.mesh = polyMesh(pts, col, true);
      } else if (e.type === "arc") {
        e.mesh = polyMesh(e.data.points, col, false);
      } else if (e.type === "rect") {
        e.mesh = polyMesh(e.data.corners, col, true);
      } else if (e.type === "point") {
        const g = new THREE.SphereGeometry(0.6, 8, 8);
        const m = new THREE.MeshBasicMaterial({ color: col, depthTest: false });
        const mesh = new THREE.Mesh(g, m);
        mesh.position.copy(fromUV(e.data.p.u, e.data.p.v));
        mesh.renderOrder = 9;
        e.mesh = mesh;
      } else if (e.type === "spline") {
        e.mesh = polyMesh(e.data.points, col, false);
      }
      if (e.mesh) group.add(e.mesh);
    }
  }

  function maybeAutoCoincident(lineEnt, endKey, snapped) {
    if (!snapped?.entityId) return;
    constraints.push({
      id: uid("c"),
      type: "coincident",
      a: { entityId: lineEnt.id, key: endKey },
      b: { entityId: snapped.entityId, key: snapped.key },
    });
  }

  function maybeAutoAxisConstraint(lineEnt) {
    const dx = lineEnt.data.b.u - lineEnt.data.a.u;
    const dy = lineEnt.data.b.v - lineEnt.data.a.v;
    if (Math.abs(dy) < 0.02) {
      constraints.push({ id: uid("c"), type: "horizontal", entityId: lineEnt.id });
    } else if (Math.abs(dx) < 0.02) {
      constraints.push({ id: uid("c"), type: "vertical", entityId: lineEnt.id });
    }
  }

  function addEntity(type, data) {
    pushUndo();
    const ent = { id: uid("e"), type, data, fixed: false, mesh: null };
    entities.push(ent);
    rebuildMeshes();
    renderConstraints();
    emitOverlay();
    return ent;
  }

  function hitTestEntity(event, threshold = 8) {
    const hit = raycastPlane(event, { showSnap: false });
    if (!hit) return null;
    const h = hit.uv;
    let best = null;
    let bestD = threshold;
    for (const e of entities) {
      if (e.type === "line") {
        const d = distToSegment(h, e.data.a, e.data.b);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      } else if (e.type === "circle") {
        const d = Math.abs(Math.hypot(h.u - e.data.c.u, h.v - e.data.c.v) - e.data.r);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      } else if (e.type === "rect") {
        const corners = e.data.corners || [];
        for (let i = 0; i < corners.length; i++) {
          const a = corners[i];
          const b = corners[(i + 1) % corners.length];
          const d = distToSegment(h, a, b);
          if (d < bestD) {
            bestD = d;
            best = e;
          }
        }
      } else if (e.type === "point") {
        const d = Math.hypot(h.u - e.data.p.u, h.v - e.data.p.v);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
    return best;
  }

  function hitTestPoint(event, threshold = 10) {
    const hit = raycastPlane(event, { showSnap: false });
    if (!hit) return null;
    const h = hit.uv;
    let best = null;
    let bestD = threshold;
    for (const e of entities) {
      const pts = entityPoints(e);
      for (const p of pts) {
        const d = Math.hypot(h.u - p.u, h.v - p.v);
        if (d < bestD) {
          bestD = d;
          best = { entity: e, point: p, key: p.key };
        }
      }
    }
    return best;
  }

  function entityPoints(e) {
    if (e.type === "line") {
      return [
        { ...e.data.a, key: "a" },
        { ...e.data.b, key: "b" },
      ];
    }
    if (e.type === "circle") return [{ ...e.data.c, key: "c" }];
    if (e.type === "point") return [{ ...e.data.p, key: "p" }];
    if (e.type === "rect") return e.data.corners.map((p, i) => ({ ...p, key: `c${i}` }));
    if (e.type === "arc") return e.data.points.map((p, i) => ({ ...p, key: `p${i}` }));
    return [];
  }

  function distToSegment(p, a, b) {
    const dx = b.u - a.u;
    const dy = b.v - a.v;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-8) return Math.hypot(p.u - a.u, p.v - a.v);
    let t = ((p.u - a.u) * dx + (p.v - a.v) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.u - (a.u + t * dx), p.v - (a.v + t * dy));
  }

  function raycastPlane(event, opts = {}) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc(event), orthoCam);
    const n = planeNormal();
    const origin = fromUV(panOffset.x, panOffset.y);
    const denom = n.dot(rc.ray.direction);
    if (Math.abs(denom) < 1e-8) return null;
    const t = origin.clone().sub(rc.ray.origin).dot(n) / denom;
    const hit = rc.ray.origin.clone().addScaledVector(rc.ray.direction, t);
    const uv = toUV(hit);
    const chainFrom = opts.chainFrom ?? (tool === "line" && dragStart ? dragStart : null);
    const { point, snapped } = snapUVEnhanced(uv.u, uv.v, { chainFrom, exclude: opts.exclude });
    if (opts.showSnap !== false) showSnapIndicator(snapped ? point : null);
    return { world: fromUV(point.u, point.v), uv: point, snapped };
  }

  function chainLinesToProfile(lines) {
    if (lines.length < 3) return null;
    const unused = new Set(lines.map((l) => l.id));
    const ordered = [];
    let current = lines[0];
    unused.delete(current.id);
    let start = { ...current.data.a };
    let end = { ...current.data.b };
    ordered.push([start.u, start.v], [end.u, end.v]);

    while (unused.size) {
      let next = null;
      let flip = false;
      for (const id of unused) {
        const ln = lines.find((l) => l.id === id);
        if (!ln) continue;
        if (pointsEqual(ln.data.a, end)) {
          next = ln;
          flip = false;
          break;
        }
        if (pointsEqual(ln.data.b, end)) {
          next = ln;
          flip = true;
          break;
        }
      }
      if (!next) break;
      unused.delete(next.id);
      end = flip ? { ...next.data.a } : { ...next.data.b };
      if (!pointsEqual(end, start)) ordered.push([end.u, end.v]);
    }

    if (ordered.length < 3) return null;
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    if (!pointsEqual({ u: first[0], v: first[1] }, { u: last[0], v: last[1] })) {
      if (ordered.length >= 3 && unused.size === 0) {
        ordered.push([first[0], first[1]]);
      } else {
        return null;
      }
    } else {
      ordered.pop();
    }
    return ordered.length >= 3 ? ordered : null;
  }

  function profileFromEntities() {
    const rect = entities.find((e) => e.type === "rect");
    if (rect?.data?.corners?.length >= 3) {
      return rect.data.corners.map((p) => [p.u, p.v]);
    }
    const circle = entities.find((e) => e.type === "circle");
    if (circle) {
      const pts = [];
      for (let i = 0; i < 32; i++) {
        const t = (i / 32) * Math.PI * 2;
        pts.push([
          circle.data.c.u + Math.cos(t) * circle.data.r,
          circle.data.c.v + Math.sin(t) * circle.data.r,
        ]);
      }
      return pts;
    }
    const lines = entities.filter((e) => e.type === "line");
    if (lines.length >= 3) {
      const chained = chainLinesToProfile(lines);
      if (chained) return chained;
    }
    return null;
  }

  function disposeGroupTree(root) {
    root.traverse?.((obj) => {
      obj.geometry?.dispose?.();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
        else obj.material.dispose?.();
      }
    });
  }

  function createSketchMeshGroup(data) {
    const spec = planeSpecFromData(data);
    const profile = data.profile || [];
    const entityList = data.entities || [];
    if (!profile.length || profile.length < 3) return null;

    const container = new THREE.Group();
    container.name = `sketch-${data.id || "view"}`;
    applyPlaneBasis(container, spec);

    const shape = new THREE.Shape();
    shape.moveTo(profile[0][0], profile[0][1]);
    for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
    shape.closePath();

    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color: SKETCH_COLOR,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    fill.renderOrder = 48;
    fill.frustumCulled = false;
    fill.position.z = 0.08;

    const edgePts = profile.map(([u, v]) => new THREE.Vector3(u, v, 0.1));
    edgePts.push(edgePts[0].clone());
    const outline = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(edgePts),
      new THREE.LineBasicMaterial({ color: SKETCH_COLOR, depthTest: false, linewidth: 2 })
    );
    outline.renderOrder = 52;
    outline.frustumCulled = false;

    const sketchMeta = {
      id: data.id,
      name: data.name,
      plane: spec.label,
      profile,
      entities: entityList,
      constraints: data.constraints || [],
    };
    const planeRef = planeSpecToRef(spec);
    if (planeRef) sketchMeta.plane_ref = planeRef;
    container.userData.sketchData = sketchMeta;
    container.add(fill, outline);

    for (const ent of entityList) {
      if (ent.type === "line") {
        container.add(lineMeshLocal(ent.data.a, ent.data.b, SKETCH_COLOR));
      } else if (ent.type === "circle") {
        const cpts = [];
        for (let i = 0; i <= 48; i++) {
          const t = (i / 48) * Math.PI * 2;
          cpts.push({ u: ent.data.c.u + Math.cos(t) * ent.data.r, v: ent.data.c.v + Math.sin(t) * ent.data.r });
        }
        container.add(polyMeshLocal(cpts, SKETCH_COLOR, true));
      } else if (ent.type === "rect" && ent.data?.corners) {
        container.add(polyMeshLocal(ent.data.corners, SKETCH_COLOR, true));
      }
    }
    return container;
  }

  function syncOverlayVisibility() {
    overlayGroup.visible = globalSketchesVisible && viewportSketches.size > 0;
  }

  function removeViewportSketch(id) {
    const rec = viewportSketches.get(id);
    if (!rec) return;
    overlayGroup.remove(rec.group);
    disposeGroupTree(rec.group);
    viewportSketches.delete(id);
    if (activeViewportId === id) activeViewportId = null;
    syncOverlayVisibility();
  }

  function setViewportSketchVisible(id, visible) {
    const rec = viewportSketches.get(id);
    if (!rec) return;
    rec.visible = visible;
    rec.group.visible = visible && globalSketchesVisible;
  }

  function setAllViewportSketchesVisible(visible) {
    globalSketchesVisible = visible;
    for (const rec of viewportSketches.values()) {
      rec.group.visible = rec.visible && globalSketchesVisible;
    }
    syncOverlayVisibility();
  }

  function addViewportSketch(id, data, { visible = true, focus = false } = {}) {
    if (!id || !data?.profile?.length) return null;
    removeViewportSketch(id);
    const group = createSketchMeshGroup({ ...data, id });
    if (!group) return null;
    group.visible = visible && globalSketchesVisible;
    overlayGroup.add(group);
    viewportSketches.set(id, { group, visible, data: { ...data, id } });
    activeViewportId = id;
    lastFinished = { ...data, id };
    finishedPlane = data.plane || planeSpec.label || "XY";
    syncOverlayVisibility();
    if (focus) focusCameraOnSketchPlane(planeSpecFromData(data));
    return id;
  }

  function updateViewportSketchId(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    const rec = viewportSketches.get(oldId);
    if (!rec) return;
    const data = { ...rec.data, id: newId };
    addViewportSketch(newId, data, { visible: rec.visible, focus: false });
    removeViewportSketch(oldId);
    if (activeViewportId === oldId) activeViewportId = newId;
  }

  function clearViewportSketches() {
    for (const id of [...viewportSketches.keys()]) removeViewportSketch(id);
    lastFinished = null;
    activeViewportId = null;
  }

  function clearOverlay() {
    clearViewportSketches();
  }

  function buildProfileOverlay(profile, entityList = [], id = null) {
    const sketchId = id || `sketch_local_${Date.now()}`;
    const data = {
      id: sketchId,
      plane: planeSpec.label,
      profile,
      entities: entityList,
      constraints: [],
    };
    const planeRef = planeSpecToRef(planeSpec);
    if (planeRef) data.plane_ref = planeRef;
    addViewportSketch(sketchId, data, { visible: true, focus: true });
    return sketchId;
  }

  async function loadProjectSketches(projectId, apiFn, entries = []) {
    clearViewportSketches();
    if (!projectId || !apiFn) return;
    const sketchEntries = (entries || []).filter((e) => e.format === "sketch");
    for (const entry of sketchEntries) {
      const sid = entry.stem || entry.id;
      if (!sid) continue;
      try {
        const data = await apiFn(`/api/projects/${projectId}/sketches/${encodeURIComponent(sid)}`);
        const id = data?.id || sid;
        addViewportSketch(id, { ...data, id }, { visible: true, focus: false });
      } catch (_) {
        /* skip missing/corrupt sketch files */
      }
    }
    if (viewportSketches.size && document.getElementById("app")?.classList.contains("sketch-design-tab")) {
      const last = lastFinished ? planeSpecFromData(lastFinished) : standardPlaneSpec(finishedPlane);
      focusCameraOnSketchPlane(last);
    }
  }

  function getActiveViewportSketch() {
    if (activeViewportId && viewportSketches.has(activeViewportId)) {
      return viewportSketches.get(activeViewportId).data;
    }
    return lastFinished;
  }

  function countVisibleSketches() {
    let n = 0;
    for (const rec of viewportSketches.values()) {
      if (rec.visible && rec.group.visible) n += 1;
    }
    return n;
  }

  function pickViewportSketch(event, renderCamera = camera) {
    if (!globalSketchesVisible || viewportSketches.size === 0) return null;
    const rect = dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, renderCamera);
    const meshes = [];
    for (const rec of viewportSketches.values()) {
      if (!rec.visible || !rec.group.visible) continue;
      rec.group.traverse((obj) => {
        if (obj.isMesh && obj.geometry) meshes.push(obj);
      });
    }
    if (!meshes.length) return null;
    const hits = rc.intersectObjects(meshes, false);
    if (!hits.length) return null;
    let node = hits[0].object;
    while (node && node !== overlayGroup) {
      if (node.userData?.sketchData?.profile?.length) return node.userData.sketchData;
      node = node.parent;
    }
    for (const rec of viewportSketches.values()) {
      if (rec.group === hits[0].object || rec.group.contains(hits[0].object)) {
        return rec.data?.profile?.length ? rec.data : null;
      }
    }
    return null;
  }

  function isGlobalSketchesVisible() {
    return globalSketchesVisible;
  }

  function applyConstraints() {
    for (const c of constraints) {
      if (c.type === "horizontal") applyHorizontal(c);
      else if (c.type === "vertical") applyVertical(c);
      else if (c.type === "coincident") applyCoincident(c);
      else if (c.type === "parallel") applyParallel(c);
      else if (c.type === "perpendicular") applyPerpendicular(c);
      else if (c.type === "equal") applyEqual(c);
      else if (c.type === "collinear") applyCollinear(c);
      else if (c.type === "concentric") applyConcentric(c);
      else if (c.type === "dimension") applyDimension(c);
      else if (c.type === "angle") applyAngle(c);
    }
    rebuildMeshes();
    renderConstraints();
  }

  function lineEntity(id) {
    const e = entityById(id);
    return e?.type === "line" ? e : null;
  }

  function applyHorizontal(c) {
    const e = lineEntity(c.entityId);
    if (!e) return;
    const avg = (e.data.a.v + e.data.b.v) / 2;
    e.data.a.v = avg;
    e.data.b.v = avg;
  }

  function applyVertical(c) {
    const e = lineEntity(c.entityId);
    if (!e) return;
    const avg = (e.data.a.u + e.data.b.u) / 2;
    e.data.a.u = avg;
    e.data.b.u = avg;
  }

  function applyCoincident(c) {
    const ea = entityById(c.a.entityId);
    const eb = entityById(c.b.entityId);
    if (!ea || !eb) return;
    const pa = getPointRef(ea, c.a.key);
    const pb = getPointRef(eb, c.b.key);
    if (!pa || !pb) return;
    setPointRef(eb, c.b.key, pa);
  }

  function getPointRef(e, key) {
    if (e.type === "line") return key === "a" ? e.data.a : e.data.b;
    if (e.type === "point") return e.data.p;
    if (e.type === "circle") return e.data.c;
    return null;
  }

  function setPointRef(e, key, p) {
    if (e.type === "line") {
      if (key === "a") e.data.a = { u: p.u, v: p.v };
      else e.data.b = { u: p.u, v: p.v };
    } else if (e.type === "point") e.data.p = { u: p.u, v: p.v };
    else if (e.type === "circle") e.data.c = { u: p.u, v: p.v };
  }

  function applyParallel(c) {
    const e1 = lineEntity(c.a);
    const e2 = lineEntity(c.b);
    if (!e1 || !e2) return;
    const dx = e1.data.b.u - e1.data.a.u;
    const dy = e1.data.b.v - e1.data.a.v;
    const len = Math.hypot(dx, dy) || 1;
    const len2 = Math.hypot(e2.data.b.u - e2.data.a.u, e2.data.b.v - e2.data.a.v) || 1;
    e2.data.b.u = e2.data.a.u + (dx / len) * len2;
    e2.data.b.v = e2.data.a.v + (dy / len) * len2;
  }

  function applyPerpendicular(c) {
    const e1 = lineEntity(c.a);
    const e2 = lineEntity(c.b);
    if (!e1 || !e2) return;
    const dx = e1.data.b.u - e1.data.a.u;
    const dy = e1.data.b.v - e1.data.a.v;
    const len = Math.hypot(dx, dy) || 1;
    const len2 = Math.hypot(e2.data.b.u - e2.data.a.u, e2.data.b.v - e2.data.a.v) || 1;
    e2.data.b.u = e2.data.a.u + (-dy / len) * len2;
    e2.data.b.v = e2.data.a.v + (dx / len) * len2;
  }

  function applyEqual(c) {
    const e1 = entityById(c.a);
    const e2 = entityById(c.b);
    if (!e1 || !e2) return;
    if (e1.type === "line" && e2.type === "line") {
      const len1 = Math.hypot(e1.data.b.u - e1.data.a.u, e1.data.b.v - e1.data.a.v);
      const dx = e2.data.b.u - e2.data.a.u;
      const dy = e2.data.b.v - e2.data.a.v;
      const len2 = Math.hypot(dx, dy) || 1;
      e2.data.b.u = e2.data.a.u + (dx / len2) * len1;
      e2.data.b.v = e2.data.a.v + (dy / len2) * len1;
    } else if (e1.type === "circle" && e2.type === "circle") {
      e2.data.r = e1.data.r;
    }
  }

  function applyCollinear(c) {
    const e1 = lineEntity(c.a);
    const e2 = lineEntity(c.b);
    if (!e1 || !e2) return;
    const dx = e1.data.b.u - e1.data.a.u;
    const dy = e1.data.b.v - e1.data.a.v;
    const len = Math.hypot(dx, dy) || 1;
    const pu = -dy / len;
    const pv = dx / len;
    const mid = { u: (e2.data.a.u + e2.data.b.u) / 2, v: (e2.data.a.v + e2.data.b.v) / 2 };
    const half = Math.hypot(e2.data.b.u - e2.data.a.u, e2.data.b.v - e2.data.a.v) / 2;
    e2.data.a = { u: mid.u - (dx / len) * half, v: mid.v - (dy / len) * half };
    e2.data.b = { u: mid.u + (dx / len) * half, v: mid.v + (dy / len) * half };
    void pu;
    void pv;
  }

  function applyConcentric(c) {
    const e1 = entityById(c.a);
    const e2 = entityById(c.b);
    if (e1?.type === "circle" && e2?.type === "circle") {
      e2.data.c = { ...e1.data.c };
    }
  }

  function applyDimension(c) {
    if (c.value == null) return;
    const e = entityById(c.entityId);
    if (!e) return;
    if (e.type === "line") {
      const dx = e.data.b.u - e.data.a.u;
      const dy = e.data.b.v - e.data.a.v;
      const len = Math.hypot(dx, dy) || 1;
      const scale = c.value / len;
      e.data.b.u = e.data.a.u + dx * scale;
      e.data.b.v = e.data.a.v + dy * scale;
    } else if (e.type === "circle") {
      e.data.r = c.value;
    }
  }

  function measuredDimensionValue(e) {
    if (!e) return null;
    if (e.type === "line") {
      return Math.hypot(e.data.b.u - e.data.a.u, e.data.b.v - e.data.a.v);
    }
    if (e.type === "circle") {
      return e.data.r * 2;
    }
    return null;
  }

  function parseDimensionInput(input) {
    const raw = String(input || "").trim().toLowerCase();
    if (!raw) return null;
    const match = raw.match(/^(-?\d+(?:\.\d+)?)(?:\s*(mm|millimeter|millimeters|cm|centimeter|centimeters|in|inch|inches|"))?$/);
    if (!match) return Number.NaN;
    let value = parseFloat(match[1]);
    const unit = match[2] || "mm";
    if (unit === "cm" || unit === "centimeter" || unit === "centimeters") value *= 10;
    if (unit === "in" || unit === "inch" || unit === "inches" || unit === "\"") value *= INCH_TO_MM;
    return value;
  }

  function setDrivenDimension(ent, value) {
    if (!ent || !Number.isFinite(value) || value <= 0) return false;
    const normalizedValue = ent.type === "circle" ? value / 2 : value;
    pushUndo();
    const existing = constraints.find((c) => c.type === "dimension" && c.entityId === ent.id);
    if (existing) {
      existing.value = normalizedValue;
    } else {
      constraints.push({ id: uid("c"), type: "dimension", entityId: ent.id, value: normalizedValue });
    }
    applyConstraints();
    return true;
  }

  function promptDimension(ent) {
    const current = measuredDimensionValue(ent);
    if (!Number.isFinite(current) || current <= 0) {
      onStatus?.("error", "Dimension: click a line or circle.");
      return false;
    }
    const label = ent.type === "circle" ? "Diameter" : "Distance";
    const input = window.prompt(`${label} (mm):`, `${current.toFixed(1)}mm`);
    if (input == null) return false;
    const num = parseDimensionInput(input);
    if (!Number.isFinite(num) || num <= 0) {
      onStatus?.("error", "Invalid dimension. Try values like 25mm or 1in.");
      return false;
    }
    if (!setDrivenDimension(ent, num)) return false;
    selectedId = ent.id;
    onStatus?.("ok", `${label} set to ${num.toFixed(2)} mm.`);
    return true;
  }

  function lineAngleDeg(e) {
    const dx = e.data.b.u - e.data.a.u;
    const dy = e.data.b.v - e.data.a.v;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  }

  function setLineAngle(e, targetDeg, anchorKey = "a") {
    const anchor = anchorKey === "b" ? e.data.b : e.data.a;
    const other = anchorKey === "b" ? e.data.a : e.data.b;
    const len = Math.hypot(other.u - anchor.u, other.v - anchor.v) || 1;
    const rad = (targetDeg * Math.PI) / 180;
    other.u = anchor.u + Math.cos(rad) * len;
    other.v = anchor.v + Math.sin(rad) * len;
  }

  function applyAngle(c) {
    if (c.value == null) return;
    const e1 = lineEntity(c.a);
    const e2 = lineEntity(c.b);
    if (!e1 || !e2) return;
    const base = lineAngleDeg(e1);
    setLineAngle(e2, base + c.value, "a");
  }

  function renderConstraints() {
    while (constraintGroup.children.length) {
      const child = constraintGroup.children[0];
      constraintGroup.remove(child);
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    }
    for (const c of constraints) {
      const label = constraintLabel(c);
      if (!label) continue;
      const pos = constraintPosition(c);
      if (!pos) continue;
      const sprite = makeTextSprite(label);
      sprite.position.copy(fromUV(pos.u, pos.v));
      sprite.renderOrder = 12;
      constraintGroup.add(sprite);
    }
  }

  function constraintLabel(c) {
    if (c.type === "dimension" && c.value != null) {
      const ent = entityById(c.entityId);
      if (ent?.type === "circle") return `Ø${(c.value * 2).toFixed(1)} mm`;
      return `${c.value.toFixed(1)} mm`;
    }
    const map = {
      horizontal: "H",
      vertical: "V",
      coincident: "●",
      parallel: "∥",
      perpendicular: "⊥",
      equal: "=",
      collinear: "—",
      concentric: "◎",
      fix: "🔒",
      dimension: "D",
      angle: c.value != null ? `${c.value.toFixed(0)}°` : "∠",
    };
    return map[c.type] || c.type[0]?.toUpperCase();
  }

  function constraintPosition(c) {
    if (c.type === "coincident" && c.a && c.b) {
      const ea = entityById(c.a.entityId);
      const pa = ea ? getPointRef(ea, c.a.key) : null;
      if (pa) return { u: pa.u, v: pa.v + 2.5 };
    }
    if (c.type === "angle" || c.type === "parallel" || c.type === "perpendicular" || c.type === "collinear" || c.type === "equal") {
      const e1 = lineEntity(c.a);
      const e2 = lineEntity(c.b);
      if (e1 && e2) {
        return {
          u: (e1.data.a.u + e1.data.b.u + e2.data.a.u + e2.data.b.u) / 4,
          v: (e1.data.a.v + e1.data.b.v + e2.data.a.v + e2.data.b.v) / 4 + 3,
        };
      }
    }
    if (c.type === "concentric") {
      const e1 = entityById(c.a);
      const e2 = entityById(c.b);
      if (e1?.type === "circle" && e2?.type === "circle") {
        return { u: (e1.data.c.u + e2.data.c.u) / 2, v: (e1.data.c.v + e2.data.c.v) / 2 + 3 };
      }
    }
    const e = entityById(c.entityId || c.a);
    if (!e) return null;
    if (e.type === "line") {
      const mid = { u: (e.data.a.u + e.data.b.u) / 2, v: (e.data.a.v + e.data.b.v) / 2 };
      if (c.type === "dimension") {
        const dx = e.data.b.u - e.data.a.u;
        const dy = e.data.b.v - e.data.a.v;
        const len = Math.hypot(dx, dy) || 1;
        return { u: mid.u + (-dy / len) * 6, v: mid.v + (dx / len) * 6 };
      }
      return { u: mid.u, v: mid.v + 3 };
    }
    if (e.type === "circle") return { u: e.data.c.u, v: e.data.c.v + e.data.r + 3 };
    return null;
  }

  function makeTextSprite(text) {
    const canvas = document.createElement("canvas");
    const width = Math.max(64, Math.ceil(String(text).length * 10 + 18));
    canvas.width = width;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#5c2d91";
    ctx.lineWidth = 3;
    ctx.fillRect(2, 2, width - 4, 28);
    ctx.strokeRect(2, 2, width - 4, 28);
    ctx.fillStyle = "#5c2d91";
    ctx.font = "bold 16px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, width / 2, 16);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set((width / 64) * 8, 4, 1);
    return sprite;
  }

  function addConstraint(type, refs, value = null) {
    pushUndo();
    constraints.push({ id: uid("c"), type, ...refs, value });
    applyConstraints();
  }

  const CONSTRAINT_TOOLS = new Set([
    "coincident", "horizontal", "vertical", "parallel", "perpendicular",
    "equal", "collinear", "concentric", "fix", "dimension", "angle", "tangent",
  ]);

  function isConstraintTool(t) {
    return CONSTRAINT_TOOLS.has(t);
  }

  function handleConstraintClick(event) {
    const ent = hitTestEntity(event);
    const pt = hitTestPoint(event);
    if (tool === "coincident") {
      if (!pt) {
        onStatus?.("error", "Coincident: click a point.");
        return;
      }
      if (pickRefs.length === 0) {
        pickRefs.push(pt);
        onStatus?.("ok", "Coincident: click second point.");
        return;
      }
      addConstraint("coincident", {
        a: { entityId: pickRefs[0].entity.id, key: pickRefs[0].key },
        b: { entityId: pt.entity.id, key: pt.key },
      });
      pickRefs = [];
      onStatus?.("ok", "Coincident constraint added.");
      return;
    }
    if (tool === "horizontal" && ent?.type === "line") {
      addConstraint("horizontal", { entityId: ent.id });
      onStatus?.("ok", "Horizontal constraint added.");
      return;
    }
    if (tool === "vertical" && ent?.type === "line") {
      addConstraint("vertical", { entityId: ent.id });
      onStatus?.("ok", "Vertical constraint added.");
      return;
    }
    if (tool === "parallel") {
      if (ent?.type !== "line") return;
      if (pickRefs.length === 0) {
        pickRefs.push(ent);
        onStatus?.("ok", "Parallel: click second line.");
        return;
      }
      addConstraint("parallel", { a: pickRefs[0].id, b: ent.id });
      pickRefs = [];
      onStatus?.("ok", "Parallel constraint added.");
      return;
    }
    if (tool === "perpendicular") {
      if (ent?.type !== "line") return;
      if (pickRefs.length === 0) {
        pickRefs.push(ent);
        onStatus?.("ok", "Perpendicular: click second line.");
        return;
      }
      addConstraint("perpendicular", { a: pickRefs[0].id, b: ent.id });
      pickRefs = [];
      onStatus?.("ok", "Perpendicular constraint added.");
      return;
    }
    if (tool === "equal") {
      if (!ent) return;
      if (pickRefs.length === 0) {
        pickRefs.push(ent);
        onStatus?.("ok", "Equal: click second line or circle.");
        return;
      }
      addConstraint("equal", { a: pickRefs[0].id, b: ent.id });
      pickRefs = [];
      onStatus?.("ok", "Equal constraint added.");
      return;
    }
    if (tool === "collinear") {
      if (ent?.type !== "line") return;
      if (pickRefs.length === 0) {
        pickRefs.push(ent);
        onStatus?.("ok", "Collinear: click second line.");
        return;
      }
      addConstraint("collinear", { a: pickRefs[0].id, b: ent.id });
      pickRefs = [];
      onStatus?.("ok", "Collinear constraint added.");
      return;
    }
    if (tool === "concentric") {
      if (ent?.type !== "circle") return;
      if (pickRefs.length === 0) {
        pickRefs.push(ent);
        onStatus?.("ok", "Concentric: click second circle.");
        return;
      }
      addConstraint("concentric", { a: pickRefs[0].id, b: ent.id });
      pickRefs = [];
      onStatus?.("ok", "Concentric constraint added.");
      return;
    }
    if (tool === "fix" && ent) {
      pushUndo();
      ent.fixed = !ent.fixed;
      constraints = constraints.filter((c) => !(c.type === "fix" && c.entityId === ent.id));
      if (ent.fixed) constraints.push({ id: uid("c"), type: "fix", entityId: ent.id });
      rebuildMeshes();
      renderConstraints();
      emitOverlay();
      onStatus?.("ok", ent.fixed ? "Geometry fixed." : "Geometry unfixed.");
      return;
    }
    if (tool === "dimension" && ent) {
      if (ent.type !== "line" && ent.type !== "circle") {
        onStatus?.("error", "Dimension: click a line or circle.");
        return;
      }
      promptDimension(ent);
      return;
    }
    if (tool === "angle") {
      if (ent?.type !== "line") return;
      if (pickRefs.length === 0) {
        pickRefs.push(ent);
        onStatus?.("ok", "Angle: click second line.");
        return;
      }
      const input = window.prompt("Angle between lines (degrees):", "90");
      if (input == null) {
        pickRefs = [];
        return;
      }
      const num = parseFloat(input);
      if (!Number.isFinite(num)) {
        onStatus?.("error", "Invalid angle.");
        pickRefs = [];
        return;
      }
      addConstraint("angle", { a: pickRefs[0].id, b: ent.id }, num);
      pickRefs = [];
      onStatus?.("ok", `Angle constraint set to ${num}°.`);
      return;
    }
    if (tool === "tangent") {
      onStatus?.("error", "Tangent constraint coming soon.");
    }
  }

  function start(nextPlane = "XY", saved = null, options = null) {
    if (options?.planeRef) {
      planeSpec = normalizePlaneRef(options.planeRef);
    } else if (saved?.plane_ref) {
      planeSpec = planeSpecFromData(saved);
    } else {
      planeSpec = standardPlaneSpec(nextPlane);
    }
    plane = planeSpec.label;
    active = true;
    entities = [];
    constraints = [];
    undoStack = [];
    redoStack = [];
    selectedId = null;
    pickRefs = [];
    arcPts = [];
    splinePts = [];
    tool = "line";
    group.clear();
    group.add(constraintGroup);
    showSnapIndicator(null);
    buildSketchEnvironment();

    if (saved?.entities?.length) {
      for (const raw of saved.entities) {
        entities.push({ id: raw.id || uid("e"), type: raw.type, data: raw.data, fixed: !!raw.fixed, mesh: null });
      }
      constraints = (saved.constraints || []).map((c) => ({ ...c, id: c.id || uid("c") }));
      applyConstraints();
      // Build THREE.js geometry for all loaded entities so they appear in the viewport.
      rebuildMeshes();
    }

    group.visible = true;
    lockCamera2D();
    onModeChange?.(true, { plane });
    emitOverlay();
    onStatus?.("ok", `Edit Sketch on ${plane} — 2D locked. Scroll zoom · Right-drag pan · Finish Sketch when done.`);
  }

  function finish() {
    try {
      applyConstraints();
    } catch (err) {
      onStatus?.("error", err?.message || "Could not apply sketch constraints.");
      emitOverlay({
        hint: err?.message || "Could not apply sketch constraints.",
        entities: entities.length,
        constraints: constraints.length,
      });
      return false;
    }

    const profile = profileFromEntities();
    if (!profile?.length) {
      const msg = entities.length
        ? "Need a closed profile — draw a Rectangle/Circle or connect line ends into a loop."
        : "Draw a closed shape first (Rectangle or Circle tool), then Finish Sketch.";
      onStatus?.("error", msg);
      emitOverlay({ hint: msg, entities: entities.length, constraints: constraints.length });
      return false;
    }

    const payload = {
      plane,
      profile,
      entities: entities.map(({ id, type, data, fixed }) => ({ id, type, data, fixed: !!fixed })),
      constraints,
    };
    const planeRef = planeSpecToRef(planeSpec);
    if (planeRef) payload.plane_ref = planeRef;

    active = false;
    dragStart = null;
    pickRefs = [];
    showSnapIndicator(null);
    clearPreview();
    unlockCamera2D();
    group.clear();
    group.visible = false;

    const viewportId = buildProfileOverlay(profile, payload.entities);
    payload.id = viewportId;
    lastFinished = payload;
    focusCameraOnSketchPlane(planeSpec);
    emitOverlay({ visible: false });
    onModeChange?.(false, payload);
    onFinished?.(payload);
    onStatus?.("ok", "Sketch finished — profile shown in viewport.");
    return true;
  }

  function cancel() {
    active = false;
    tool = "line";
    dragStart = null;
    pickRefs = [];
    arcPts = [];
    splinePts = [];
    clearPreview();
    showSnapIndicator(null);
    unlockCamera2D();
    group.clear();
    group.visible = false;
    entities = [];
    constraints = [];
    onModeChange?.(false);
    onStatus?.("", "");
  }

  function hide() {
    cancel();
  }

  function showViewportSketch(id) {
    const rec = viewportSketches.get(id);
    if (!rec) return false;
    activeViewportId = id;
    lastFinished = rec.data;
    focusCameraOnSketchPlane(planeSpecFromData(rec.data));
    return rec.data;
  }

  function setTool(next) {
    tool = next;
    dragStart = null;
    pickRefs = [];
    arcPts = [];
    splinePts = [];
    clearPreview();
    const patternTools = ["fillet", "chamfer", "mirror", "rect_pattern", "circ_pattern", "extend"];
    if (patternTools.includes(next)) {
      onStatus?.("error", `${next.replace(/_/g, " ")} coming soon.`);
      return;
    }
    if (active) {
      emitOverlay({ tool: next });
      if (isConstraintTool(next)) {
        onStatus?.("ok", `Constraint: ${next} — click geometry in the viewport.`);
      } else {
        onStatus?.("ok", `Sketch tool: ${next}`);
      }
    }
  }

  function deleteSelectedEntity() {
    if (!selectedId) return false;
    const exists = entities.some((e) => e.id === selectedId);
    if (!exists) return false;
    pushUndo();
    entities = entities.filter((e) => e.id !== selectedId);
    constraints = constraints.filter((c) => {
      if (c.entityId === selectedId || c.a === selectedId || c.b === selectedId) return false;
      if (c.a?.entityId === selectedId || c.b?.entityId === selectedId) return false;
      return true;
    });
    selectedId = null;
    rebuildMeshes();
    renderConstraints();
    emitOverlay();
    onStatus?.("ok", "Selected sketch geometry deleted.");
    return true;
  }

  function activateShortcutTool(next) {
    if (next === "dimension") {
      if (applyInlineDistance()) return true;
      setTool("dimension");
      let ent = selectedId ? entityById(selectedId) : null;
      if (!ent || (ent.type !== "line" && ent.type !== "circle")) {
        for (let i = entities.length - 1; i >= 0; i--) {
          const candidate = entities[i];
          if (candidate.type === "line" || candidate.type === "circle") {
            ent = candidate;
            selectedId = candidate.id;
            break;
          }
        }
      }
      if (ent?.type === "line" || ent?.type === "circle") {
        rebuildMeshes();
        promptDimension(ent);
      } else {
        onStatus?.("ok", "Dimension (D): click a line or circle, then press D again — or press D while drawing a line to set length.");
      }
      return true;
    }
    setTool(next);
    return true;
  }

  function applyInlineDistance() {
    const drawing =
      (tool === "line" && dragStart)
      || (tool === "circle" && dragStart && pointerUv)
      || (tool === "rectangle" && dragStart && pointerUv);
    if (!drawing) return false;
    const label = tool === "circle" ? "Diameter (mm)" : "Distance (mm)";
    const seed =
      tool === "circle" && pointerUv
        ? Math.hypot(pointerUv.u - dragStart.u, pointerUv.v - dragStart.v) * 2
        : tool === "line" && pointerUv
          ? Math.hypot(pointerUv.u - dragStart.u, pointerUv.v - dragStart.v)
          : tool === "rectangle" && pointerUv
            ? Math.abs(pointerUv.u - dragStart.u)
            : 25;
    const input = window.prompt(`${label}:`, `${Math.max(0.1, seed).toFixed(1)}mm`);
    if (input == null) return true;
    const num = parseDimensionInput(input);
    if (!Number.isFinite(num) || num <= 0) {
      onStatus?.("error", "Invalid distance. Try values like 25mm or 1in.");
      return true;
    }
    pushUndo();
    if (tool === "line") {
      const target = pointerUv || { u: dragStart.u + Math.max(num, 1), v: dragStart.v };
      let dx = target.u - dragStart.u;
      let dy = target.v - dragStart.v;
      let len = Math.hypot(dx, dy);
      if (len < 1e-6) {
        dx = 1;
        dy = 0;
        len = 1;
      }
      const end = { u: dragStart.u + (dx / len) * num, v: dragStart.v + (dy / len) * num };
      const lineEnt = addEntity("line", { a: { ...dragStart }, b: end });
      maybeAutoAxisConstraint(lineEnt);
      dragStart = end;
      pointerUv = end;
      applyConstraints();
      clearPreview();
      onStatus?.("ok", `Line length set to ${num.toFixed(2)} mm. Click next point or press D again.`);
      return true;
    }
    if (tool === "circle") {
      const radius = num / 2;
      addEntity("circle", { c: { ...dragStart }, r: radius });
      dragStart = null;
      pointerUv = null;
      pointerDown = null;
      applyConstraints();
      clearPreview();
      onStatus?.("ok", `Circle diameter set to ${num.toFixed(2)} mm.`);
      return true;
    }
    if (tool === "rectangle") {
      const target = pointerUv || { u: dragStart.u + num, v: dragStart.v + num };
      const height = Math.abs(target.v - dragStart.v) || num;
      const signedX = target.u >= dragStart.u ? num : -num;
      const signedY = target.v >= dragStart.v ? height : -height;
      const end = { u: dragStart.u + signedX, v: dragStart.v + signedY };
      const corners = rectCorners(dragStart, end);
      for (let i = 0; i < 4; i++) {
        addEntity("line", { a: corners[i], b: corners[(i + 1) % 4] });
      }
      dragStart = null;
      pointerUv = null;
      pointerDown = null;
      applyConstraints();
      clearPreview();
      onStatus?.("ok", `Rectangle width set to ${num.toFixed(2)} mm.`);
      return true;
    }
    return false;
  }

  function onPointerDown(e) {
    if (!active) return;
    if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
      panning = true;
      panStart = { x: e.clientX, y: e.clientY, offset: panOffset.clone() };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    if (isConstraintTool(tool) || tool === "trim" || tool === "fix") {
      e.preventDefault();
      e.stopPropagation();
      if (tool === "trim") {
        const ent = hitTestEntity(e);
        if (ent && !ent.fixed) {
          pushUndo();
          entities = entities.filter((x) => x.id !== ent.id);
          rebuildMeshes();
          onStatus?.("ok", "Segment trimmed (removed).");
        }
        return;
      }
      handleConstraintClick(e);
      return;
    }

    if (tool === "select") {
      selectedId = hitTestEntity(e)?.id || null;
      rebuildMeshes();
      renderConstraints();
      return;
    }

    const rc = raycastPlane(e);
    if (!rc) return;
    e.preventDefault();
    e.stopPropagation();
    const uv = rc.uv;
    pointerDown = { x: e.clientX, y: e.clientY };

    if (tool === "line") {
      if (!dragStart) {
        dragStart = uv;
        onStatus?.("ok", "Line: click next point (chain). Double-click to stop.");
        return;
      }
      const lineEnt = addEntity("line", { a: { ...dragStart }, b: { u: uv.u, v: uv.v } });
      if (rc.snapped) maybeAutoCoincident(lineEnt, "b", rc.snapped);
      maybeAutoAxisConstraint(lineEnt);
      dragStart = uv;
      applyConstraints();
      return;
    }
    if (tool === "point") {
      addEntity("point", { p: uv });
      applyConstraints();
      return;
    }
    if (tool === "arc") {
      arcPts.push(uv);
      if (arcPts.length === 3) {
        addEntity("arc", { points: arcPts.slice() });
        arcPts = [];
        applyConstraints();
      } else {
        onStatus?.("ok", `Arc: point ${arcPts.length}/3`);
      }
      return;
    }
    if (tool === "spline") {
      splinePts.push(uv);
      onStatus?.("ok", `Spline: ${splinePts.length} points — double-click to finish.`);
      return;
    }
    dragStart = uv;
    dom.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!active) return;
    if (panning && panStart) {
      const dx = (e.clientX - panStart.x) * (ORTHO_HALF / orthoZoom) / (dom.clientHeight * 0.5);
      const dy = (e.clientY - panStart.y) * (ORTHO_HALF / orthoZoom) / (dom.clientHeight * 0.5);
      panOffset.x = panStart.offset.x - dx;
      panOffset.y = panStart.offset.y + dy;
      positionOrthoCamera();
      e.preventDefault();
      return;
    }
    if (!dragStart) {
      if (tool === "line" || tool === "circle" || tool === "rectangle") {
        const hover = raycastPlane(e);
        if (hover) pointerUv = hover.uv;
      }
      return;
    }
    const rc = raycastPlane(e);
    if (!rc) return;
    const uv = rc.uv;
    pointerUv = uv;
    clearPreview();
    if (tool === "rectangle") {
      preview = polyMesh(rectCorners(dragStart, uv), PREVIEW_COLOR, true);
    } else if (tool === "circle") {
      const r = Math.hypot(uv.u - dragStart.u, uv.v - dragStart.v);
      const cpts = [];
      for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        cpts.push({ u: dragStart.u + Math.cos(t) * r, v: dragStart.v + Math.sin(t) * r });
      }
      preview = polyMesh(cpts, PREVIEW_COLOR, true);
    } else if (tool === "line") {
      preview = lineMesh(dragStart, uv, PREVIEW_COLOR);
    } else if (tool === "polygon") {
      const r = Math.hypot(uv.u - dragStart.u, uv.v - dragStart.v);
      const sides = 6;
      const cpts = [];
      for (let i = 0; i <= sides; i++) {
        const t = (i / sides) * Math.PI * 2 - Math.PI / 2;
        cpts.push({ u: dragStart.u + Math.cos(t) * r, v: dragStart.v + Math.sin(t) * r });
      }
      preview = polyMesh(cpts, PREVIEW_COLOR, true);
    }
    if (preview) {
      preview.renderOrder = 9;
      group.add(preview);
    }
  }

  function rectCorners(a, b) {
    return [
      { u: a.u, v: a.v },
      { u: b.u, v: a.v },
      { u: b.u, v: b.v },
      { u: a.u, v: b.v },
    ];
  }

  function onPointerUp(e) {
    if (!active) return;
    if (panning) {
      panning = false;
      panStart = null;
      return;
    }
    if (tool === "line") {
      pointerDown = null;
      return;
    }
    if (!dragStart) return;
    pointerDown = null;
    const rc = raycastPlane(e, { showSnap: false });
    if (!rc) {
      dragStart = null;
      clearPreview();
      return;
    }
    const uv = rc.uv;
    const uvDist = Math.hypot(uv.u - dragStart.u, uv.v - dragStart.v);
    const isShapeTool = tool === "rectangle" || tool === "circle" || tool === "polygon";

    if (isShapeTool && uvDist < 0.5) {
      dragStart = null;
      clearPreview();
      return;
    }

    clearPreview();
    if (tool === "rectangle") {
      addEntity("rect", { corners: rectCorners(dragStart, uv) });
      applyConstraints();
    } else if (tool === "circle") {
      const r = Math.hypot(uv.u - dragStart.u, uv.v - dragStart.v);
      if (r > 0.5) addEntity("circle", { c: { ...dragStart }, r });
      applyConstraints();
    } else if (tool === "polygon") {
      const r = Math.hypot(uv.u - dragStart.u, uv.v - dragStart.v);
      if (r > 0.5) {
        const sides = 6;
        const corners = [];
        for (let i = 0; i < sides; i++) {
          const t = (i / sides) * Math.PI * 2 - Math.PI / 2;
          corners.push({ u: dragStart.u + Math.cos(t) * r, v: dragStart.v + Math.sin(t) * r });
        }
        addEntity("rect", { corners });
        applyConstraints();
      }
    } else if (tool === "offset") {
      const ent = hitTestEntity(e);
      if (ent?.type === "line") {
        const dx = ent.data.b.u - ent.data.a.u;
        const dy = ent.data.b.v - ent.data.a.v;
        const len = Math.hypot(dx, dy) || 1;
        const off = 5;
        const nu = (-dy / len) * off;
        const nv = (dx / len) * off;
        addEntity("line", {
          a: { u: ent.data.a.u + nu, v: ent.data.a.v + nv },
          b: { u: ent.data.b.u + nu, v: ent.data.b.v + nv },
        });
        applyConstraints();
      }
    }
    dragStart = null;
    dom.releasePointerCapture?.(e.pointerId);
  }

  function cancelCurrentAction() {
    if (!active) return false;

    if (tool === "line" && dragStart) {
      dragStart = null;
      pointerDown = null;
      clearPreview();
      onStatus?.("ok", "Line chain ended — click to start a new line.");
      emitOverlay();
      return true;
    }
    if (tool === "spline" && splinePts.length) {
      splinePts = [];
      clearPreview();
      onStatus?.("ok", "Spline points cleared.");
      emitOverlay();
      return true;
    }
    if (tool === "arc" && arcPts.length) {
      arcPts = [];
      onStatus?.("ok", "Arc cancelled.");
      emitOverlay();
      return true;
    }
    if (pickRefs.length) {
      pickRefs = [];
      onStatus?.("ok", "Constraint selection cleared.");
      return true;
    }
    if (dragStart) {
      dragStart = null;
      pointerDown = null;
      clearPreview();
      emitOverlay();
      return true;
    }
    return false;
  }

  function onKeyDown(e) {
    if (!active || e.target.matches("textarea, input, select")) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      undo();
      return;
    }
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")) {
      e.preventDefault();
      e.stopPropagation();
      redo();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelCurrentAction();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (deleteSelectedEntity()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    const shortcut = e.shiftKey ? SHIFT_SKETCH_SHORTCUTS[key] : SKETCH_SHORTCUTS[key];
    if (shortcut) {
      e.preventDefault();
      e.stopPropagation();
      activateShortcutTool(shortcut);
    }
  }

  function onDblClick(e) {
    if (!active) return;
    if (tool === "line") {
      dragStart = null;
      clearPreview();
      onStatus?.("ok", "Line chain ended.");
    }
    if (tool === "spline" && splinePts.length >= 2) {
      addEntity("spline", { points: splinePts.slice() });
      splinePts = [];
      applyConstraints();
    }
  }

  function onWheel(e) {
    if (!active) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    orthoZoom = Math.max(0.2, Math.min(8, orthoZoom * factor));
    updateOrthoProjection();
  }

  function loadSketch(data) {
    if (!data?.profile?.length) return;
    const id = data.id || data.stem || `sketch_${Date.now()}`;
    addViewportSketch(id, { ...data, id }, { visible: true, focus: true });
  }

  function startWithPlaneRef(planeRef, saved = null) {
    start("Face", saved, { planeRef });
  }

  function applySketchData(data) {
    if (!data) return;
    if (data.plane_ref) {
      startWithPlaneRef(data.plane_ref, data);
    } else {
      start(data.plane || "XY", data);
    }
  }

  function getFinishedSketch() {
    return getActiveViewportSketch();
  }

  dom.addEventListener("pointerdown", onPointerDown, true);
  dom.addEventListener("pointermove", onPointerMove, true);
  dom.addEventListener("pointerup", onPointerUp, true);
  dom.addEventListener("dblclick", onDblClick, true);
  dom.addEventListener("wheel", onWheel, { passive: false, capture: true });
  dom.addEventListener("contextmenu", (e) => {
    if (active) e.preventDefault();
  });
  window.addEventListener("keydown", onKeyDown, true);

  return {
    start,
    startWithPlaneRef,
    finish,
    cancel,
    cancelCurrentAction,
    hide,
    setTool,
    undo,
    redo,
    isActive: () => active,
    getTool: () => tool,
    getRenderCamera,
    resize: updateOrthoProjection,
    loadSketch,
    applySketchData,
    getFinishedSketch,
    clearOverlay,
    clearViewportSketches,
    loadProjectSketches,
    updateViewportSketchId,
    getActiveViewportSketch,
    pickViewportSketch,
    countVisibleSketches,
    setViewportSketchVisible,
    setAllViewportSketchesVisible,
    isGlobalSketchesVisible,
    showViewportSketch,
    hasOverlay: () => viewportSketches.size > 0 && globalSketchesVisible,
  };
}
