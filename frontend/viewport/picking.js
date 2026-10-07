import * as THREE from "three";
import { surfaceEditContext } from "./edit-reference-context.js?v=20260915-edit-context1&editscale=20260915-1";
import { dimLabelSpriteSize } from "./measure-dim-label.js?v=20260915-measure1";

const raycaster = new THREE.Raycaster();
raycaster.params.Line = { threshold: 0.008 };
raycaster.params.Points = { threshold: 0.015 };

let refCounter = 0;
let pickMode = "off"; // off | object | corner | face | edge | lasso

const markersGroup = new THREE.Group();
markersGroup.name = "ref-markers";

const hoverGroup = new THREE.Group();
hoverGroup.name = "hover-preview";

let hoverFace = null;
let hoverCorner = null;
let hoverEdge = null;
let lassoDraft = null;
let lineDraft = null;

/** @type {Map<string, THREE.Object3D>} */
const markerByRefId = new Map();

export function getMarkerRefIds() {
  return [...markerByRefId.keys()];
}

export function removeReferenceMarker(refId) {
  const marker = markerByRefId.get(refId);
  if (!marker) return;
  disposeObject(marker);
  markersGroup.remove(marker);
  markerByRefId.delete(refId);
}

export function getMarkersGroup() {
  return markersGroup;
}

export function getHoverGroup() {
  return hoverGroup;
}

export function resetRefCounter() {
  refCounter = 0;
  for (const id of [...markerByRefId.keys()]) {
    removeReferenceMarker(id);
  }
  disposeGroup(markersGroup);
}

export function resetRefCounterValue() {
  refCounter = 0;
}

export function setPickMode(mode) {
  pickMode = mode;
  clearHover();
  if (mode === "off") markersGroup.visible = true;
}

export function getPickMode() {
  return pickMode;
}

export function clearHover() {
  disposeGroup(hoverGroup);
}

function disposeGroup(g) {
  while (g.children.length) {
    const c = g.children[0];
    disposeObject(c);
    g.remove(c);
  }
}

function disposeObject(obj) {
  obj.traverse?.((child) => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach((m) => {
        m.map?.dispose?.();
        m.dispose?.();
      });
    } else {
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    }
  });
  obj.geometry?.dispose?.();
  if (Array.isArray(obj.material)) {
    obj.material.forEach((m) => {
      m.map?.dispose?.();
      m.dispose?.();
    });
  } else {
    obj.material?.map?.dispose?.();
    obj.material?.dispose?.();
  }
}

function getMeshes(meshRoot) {
  const meshes = [];
  meshRoot.traverse((c) => {
    if (!c.isMesh || !c.geometry) return;
    if (c.userData.isEdge || c.userData.isSilhouette) return;
    meshes.push(c);
  });
  return meshes;
}

function faceCenterModel(hit, meshRoot, offset) {
  return faceCenter(hit, meshRoot, offset);
}

const adjacencyCache = new WeakMap();

function quantKey(v) {
  return `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
}

function getTriangleVertexIndices(geom, faceIndex) {
  const index = geom.index;
  if (index) {
    return [
      index.getX(faceIndex * 3),
      index.getX(faceIndex * 3 + 1),
      index.getX(faceIndex * 3 + 2),
    ];
  }
  const base = faceIndex * 3;
  return [base, base + 1, base + 2];
}

function buildTriangleAdjacency(geom) {
  const pos = geom.attributes.position;
  const triCount = geom.index ? geom.index.count / 3 : pos.count / 3;
  const edgeToTris = new Map();

  for (let fi = 0; fi < triCount; fi += 1) {
    const [a, b, c] = getTriangleVertexIndices(geom, fi);
    for (const [i, j] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const v0 = new THREE.Vector3().fromBufferAttribute(pos, i);
      const v1 = new THREE.Vector3().fromBufferAttribute(pos, j);
      const ek0 = quantKey(v0);
      const ek1 = quantKey(v1);
      const ek = ek0 < ek1 ? `${ek0}|${ek1}` : `${ek1}|${ek0}`;
      if (!edgeToTris.has(ek)) edgeToTris.set(ek, []);
      edgeToTris.get(ek).push(fi);
    }
  }

  const adj = Array.from({ length: triCount }, () => []);
  for (const tris of edgeToTris.values()) {
    for (let i = 0; i < tris.length; i += 1) {
      for (let j = i + 1; j < tris.length; j += 1) {
        adj[tris[i]].push(tris[j]);
        adj[tris[j]].push(tris[i]);
      }
    }
  }
  return adj;
}

function getAdjacency(geom) {
  if (!adjacencyCache.has(geom)) {
    adjacencyCache.set(geom, buildTriangleAdjacency(geom));
  }
  return adjacencyCache.get(geom);
}

function triangleNormalAt(geom, mesh, faceIndex) {
  const pos = geom.attributes.position;
  const [a, b, c] = getTriangleVertexIndices(geom, faceIndex);
  const vA = new THREE.Vector3().fromBufferAttribute(pos, a);
  const vB = new THREE.Vector3().fromBufferAttribute(pos, b);
  const vC = new THREE.Vector3().fromBufferAttribute(pos, c);
  const n = new THREE.Vector3().crossVectors(vB.clone().sub(vA), vC.clone().sub(vA)).normalize();
  n.transformDirection(mesh.matrixWorld).normalize();
  return n;
}

/** Connected coplanar triangles = one logical CAD face (works with STL/OBJ tessellation). */
function computeGroupArea(meshObject, faceIndices) {
  if (!meshObject?.geometry || !faceIndices?.length) return 0;
  const geom = meshObject.geometry;
  const pos = geom.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0;
  for (const fi of faceIndices) {
    const [ia, ib, ic] = getTriangleVertexIndices(geom, fi);
    a.fromBufferAttribute(pos, ia).applyMatrix4(meshObject.matrixWorld);
    b.fromBufferAttribute(pos, ib).applyMatrix4(meshObject.matrixWorld);
    c.fromBufferAttribute(pos, ic).applyMatrix4(meshObject.matrixWorld);
    area += b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
  }
  return area;
}

function collectCoplanarGroup(hit, normalThreshold = 0.02) {
  const mesh = hit.object;
  const geom = mesh.geometry;
  const adj = getAdjacency(geom);
  const startFi = hit.faceIndex;
  const startNormal = faceNormal(hit);
  const minDot = 1 - normalThreshold;
  const visited = new Set();
  const group = [];
  const queue = [startFi];

  while (queue.length) {
    const fi = queue.pop();
    if (visited.has(fi)) continue;
    const n = fi === startFi ? startNormal : triangleNormalAt(geom, mesh, fi);
    if (startNormal.dot(n) < minDot) continue;
    visited.add(fi);
    group.push(fi);
    for (const nb of adj[fi] || []) {
      if (!visited.has(nb)) queue.push(nb);
    }
  }
  return group;
}

function groupCentroidModel(hit, group, meshRoot, offset) {
  const geom = hit.object.geometry;
  const pos = geom.attributes.position;
  const center = new THREE.Vector3();
  for (const fi of group) {
    const [a, b, c] = getTriangleVertexIndices(geom, fi);
    const vA = new THREE.Vector3().fromBufferAttribute(pos, a);
    const vB = new THREE.Vector3().fromBufferAttribute(pos, b);
    const vC = new THREE.Vector3().fromBufferAttribute(pos, c);
    const tri = new THREE.Vector3().add(vA).add(vB).add(vC).divideScalar(3);
    hit.object.localToWorld(tri);
    center.add(worldToModel(tri, meshRoot, offset));
  }
  return center.divideScalar(group.length || 1);
}

function planarFaceKey(mesh, group, centroid) {
  const sorted = [...group].sort((a, b) => a - b);
  const sig =
    sorted.length <= 24
      ? sorted.join(",")
      : `${sorted[0]},${sorted[sorted.length >> 1]},${sorted[sorted.length - 1]},n${sorted.length}`;
  const c = centroid;
  return `${mesh.uuid}:${sig}:${c.x.toFixed(5)},${c.y.toFixed(5)},${c.z.toFixed(5)}`;
}

/** Stable id for toggle-deselect (mesh + triangle, not just faceIndex). */
function facePickKey(hit) {
  if (!hit?.face) return null;
  const { a, b, c } = hit.face;
  const verts = [a, b, c].sort((x, y) => x - y);
  return `${hit.object.uuid}:${hit.faceIndex}:${verts.join(",")}`;
}

function mouseNDC(event, domElement) {
  const rect = domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
}

function raycast(event, camera, domElement, meshRoot) {
  raycaster.setFromCamera(mouseNDC(event, domElement), camera);
  return raycaster.intersectObjects(getMeshes(meshRoot), false);
}

function worldToModel(point, meshRoot, offset) {
  const local = meshRoot.worldToLocal(point.clone());
  return local.add(offset || new THREE.Vector3());
}

function worldDirectionToModel(direction, meshRoot) {
  const origin = new THREE.Vector3();
  const end = direction.clone().normalize();
  meshRoot.worldToLocal(origin);
  meshRoot.worldToLocal(end);
  return end.sub(origin).normalize();
}

function modelToLocal(modelPos, meshRoot, offset) {
  return new THREE.Vector3(modelPos.x, modelPos.y, modelPos.z).sub(offset || new THREE.Vector3());
}

function faceNormal(hit) {
  const n = new THREE.Vector3();
  if (hit.face?.normal) {
    n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
  } else {
    n.set(0, 1, 0);
  }
  return n;
}

function faceCenter(hit, meshRoot, offset) {
  const geom = hit.object.geometry;
  const pos = geom.attributes.position;
  const a = hit.face.a;
  const b = hit.face.b;
  const c = hit.face.c;
  const vA = new THREE.Vector3().fromBufferAttribute(pos, a);
  const vB = new THREE.Vector3().fromBufferAttribute(pos, b);
  const vC = new THREE.Vector3().fromBufferAttribute(pos, c);
  const center = new THREE.Vector3().add(vA).add(vB).add(vC).divideScalar(3);
  hit.object.localToWorld(center);
  return worldToModel(center, meshRoot, offset);
}

function nearestVertex(hit, meshRoot, offset) {
  const geom = hit.object.geometry;
  const pos = geom.attributes.position;
  const click = hit.point.clone();
  let best = null;
  let bestD = Infinity;
  for (const idx of [hit.face.a, hit.face.b, hit.face.c]) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, idx);
    hit.object.localToWorld(v);
    const d = v.distanceTo(click);
    if (d < bestD) {
      bestD = d;
      best = worldToModel(v, meshRoot, offset);
    }
  }
  return best;
}

function nearestBBoxCorner(meshRoot, modelPoint, offset) {
  const box = new THREE.Box3().setFromObject(meshRoot);
  const min = box.min.clone().add(offset);
  const max = box.max.clone().add(offset);
  const corners = [
    [min.x, min.y, min.z],
    [max.x, min.y, min.z],
    [min.x, max.y, min.z],
    [max.x, max.y, min.z],
    [min.x, min.y, max.z],
    [max.x, min.y, max.z],
    [min.x, max.y, max.z],
    [max.x, max.y, max.z],
  ];
  const center = box.getCenter(new THREE.Vector3()).add(offset);
  let best = { distance: Infinity, position: modelPoint.clone(), normal: new THREE.Vector3(0, 1, 0) };
  const mp = modelPoint;
  for (const [x, y, z] of corners) {
    const c = new THREE.Vector3(x, y, z);
    const d = c.distanceTo(mp);
    if (d < best.distance) {
      best = {
        distance: d,
        position: c,
        normal: c.clone().sub(center).normalize(),
      };
    }
  }
  return best;
}

function nearestEdge(hit, meshRoot, offset) {
  const geom = hit.object.geometry;
  const pos = geom.attributes.position;
  const click = hit.point.clone();
  const edges = [
    [hit.face.a, hit.face.b],
    [hit.face.b, hit.face.c],
    [hit.face.c, hit.face.a],
  ];
  let best = null;
  let bestD = Infinity;
  for (const [i, j] of edges) {
    const v0 = new THREE.Vector3().fromBufferAttribute(pos, i);
    const v1 = new THREE.Vector3().fromBufferAttribute(pos, j);
    hit.object.localToWorld(v0);
    hit.object.localToWorld(v1);
    const line = new THREE.Line3(v0, v1);
    const closest = new THREE.Vector3();
    line.closestPointToPoint(click, true, closest);
    const d = closest.distanceTo(click);
    if (d < bestD) {
      bestD = d;
      const mid = v0.clone().add(v1).multiplyScalar(0.5);
      const dir = v1.clone().sub(v0).normalize();
      const start = worldToModel(v0, meshRoot, offset);
      const end = worldToModel(v1, meshRoot, offset);
      best = {
        position: worldToModel(closest, meshRoot, offset),
        localPoint: meshRoot.worldToLocal(closest.clone()),
        normal: [dir.x, dir.y, dir.z],
        direction: dir.clone(),
        edge_mid: worldToModel(mid, meshRoot, offset),
        edge_start: start,
        edge_end: end,
        edge_length: start.distanceTo(end),
        edge_key: edgeKey(start, end),
        pick_distance: d,
      };
    }
  }
  return best;
}

function edgeKey(a, b) {
  if (!a || !b) return "";
  const ak = quantKey(a);
  const bk = quantKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function edgeRefKey(ref) {
  if (ref?.edge_key) return String(ref.edge_key);
  if (Array.isArray(ref?.edge_start) && Array.isArray(ref?.edge_end)) {
    return edgeKey(new THREE.Vector3(...ref.edge_start), new THREE.Vector3(...ref.edge_end));
  }
  return "";
}

function scaleForMesh(meshRoot) {
  const box = new THREE.Box3().setFromObject(meshRoot);
  return Math.max(box.getSize(new THREE.Vector3()).length() * 0.012, 0.003);
}

function mmPerModelUnitForMesh(meshRoot) {
  const box = new THREE.Box3().setFromObject(meshRoot);
  const extent = box.getSize(new THREE.Vector3()).length();
  return Number.isFinite(extent) && extent >= 1 ? 1 : 1000;
}

function formatEdgeLengthMm(modelLength, meshRoot) {
  const mm = Number(modelLength) * mmPerModelUnitForMesh(meshRoot);
  if (!Number.isFinite(mm)) return "";
  const decimals = mm >= 100 ? 1 : mm >= 10 ? 2 : 3;
  return `${parseFloat(mm.toFixed(decimals))} mm`;
}

function addMarker(localPoint, color, scale, shape = "sphere", refId = null, meshRoot = null) {
  const s = scale || 0.006;
  let geo;
  if (shape === "box") geo = new THREE.BoxGeometry(s * 1.2, s * 1.2, s * 1.2);
  else geo = new THREE.SphereGeometry(s, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 1000;
  const world = localPoint.clone();
  if (meshRoot) meshRoot.localToWorld(world);
  m.position.copy(world);
  if (refId) m.userData.refId = refId;
  markersGroup.add(m);
  if (refId) markerByRefId.set(refId, m);
  return m;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function referenceLabelText(id) {
  const [type, number] = String(id).split("-");
  return number ? `${type} ${number}` : String(id);
}

function addFaceLabel(localPoint, normal, scale, refId, meshRoot, { removable = false } = {}) {
  const pixelScale = 2;
  const logicalW = removable ? 340 : 280;
  const logicalH = 104;
  const canvas = document.createElement("canvas");
  canvas.width = logicalW * pixelScale;
  canvas.height = logicalH * pixelScale;
  const ctx = canvas.getContext("2d");
  const label = referenceLabelText(refId);
  if (ctx) {
    ctx.scale(pixelScale, pixelScale);
    ctx.clearRect(0, 0, logicalW, logicalH);
    ctx.fillStyle = "rgba(13, 17, 23, 0.88)";
    roundedRect(ctx, 10, 14, logicalW - 20, 72, 16);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(88, 166, 255, 0.95)";
    ctx.stroke();
    ctx.font = "800 40px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#e6edf3";
    ctx.fillText(label, removable ? 126 : logicalW / 2, 52);
    if (removable) {
      ctx.beginPath();
      ctx.arc(286, 52, 23, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(248, 81, 73, 0.94)";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(276, 42);
      ctx.lineTo(296, 62);
      ctx.moveTo(296, 42);
      ctx.lineTo(276, 62);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 1004;
  sprite.userData.refId = refId;
  if (removable) sprite.userData.removeRefId = refId;
  sprite.scale.set(removable ? scale * 13.25 : scale * 10.9, scale * 4.05, 1);
  const world = localPoint.clone();
  if (meshRoot) meshRoot.localToWorld(world);
  const lift = normal?.clone?.().normalize?.() || new THREE.Vector3(0, 1, 0);
  world.add(lift.multiplyScalar(scale * 2.5));
  sprite.position.copy(world);
  return sprite;
}

function makeEdgeLabelSprite(text, scale) {
  const pixelScale = 2;
  const W = 360;
  const H = 112;
  const canvas = document.createElement("canvas");
  canvas.width = W * pixelScale;
  canvas.height = H * pixelScale;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(pixelScale, pixelScale);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(9, 18, 32, 0.92)";
    roundedRect(ctx, 8, 12, W - 16, H - 24, 18);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(88, 166, 255, 0.96)";
    ctx.stroke();
    ctx.font = "800 38px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#dbeafe";
    ctx.fillText(text, W / 2, H / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 1004;
  sprite.scale.set(scale * 9.8, scale * 3.05, 1);
  return sprite;
}

function modelPointToWorld(point, meshRoot, offset) {
  const local = modelToLocal(point, meshRoot, offset);
  meshRoot.localToWorld(local);
  return local;
}

function makeEdgeTube(startWorld, endWorld, scale, color = 0x58a6ff, opacity = 0.98) {
  const delta = endWorld.clone().sub(startWorld);
  const len = delta.length();
  if (!Number.isFinite(len) || len <= 1e-9) return null;
  const radius = Math.max(scale * 0.045, len * 0.004);
  const geo = new THREE.CylinderGeometry(radius, radius, len, 10, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(startWorld).add(endWorld).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  mesh.renderOrder = 1002;
  return mesh;
}

function addEdgeMarker(edgeOrRef, scale, meshRoot, offset, refId = null, { label = true, opacity = 0.98, target = markersGroup } = {}) {
  const start = edgeOrRef.edge_start?.isVector3
    ? edgeOrRef.edge_start
    : Array.isArray(edgeOrRef.edge_start)
      ? new THREE.Vector3(...edgeOrRef.edge_start)
      : null;
  const end = edgeOrRef.edge_end?.isVector3
    ? edgeOrRef.edge_end
    : Array.isArray(edgeOrRef.edge_end)
      ? new THREE.Vector3(...edgeOrRef.edge_end)
      : null;
  if (!start || !end) return null;
  const group = new THREE.Group();
  if (refId) group.userData.refId = refId;
  const startWorld = modelPointToWorld(start, meshRoot, offset);
  const endWorld = modelPointToWorld(end, meshRoot, offset);
  const tube = makeEdgeTube(startWorld, endWorld, scale, 0x58a6ff, opacity);
  if (tube) {
    if (refId) tube.userData.refId = refId;
    group.add(tube);
  }
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([startWorld, endWorld]),
    new THREE.LineBasicMaterial({
      color: 0xa5d6ff,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.98,
    })
  );
  line.renderOrder = 1003;
  if (refId) line.userData.refId = refId;
  group.add(line);
  if (label) {
    const len = Number.isFinite(edgeOrRef.edge_length) ? edgeOrRef.edge_length : start.distanceTo(end);
    const text = formatEdgeLengthMm(len, meshRoot);
    if (text) {
      const sprite = makeEdgeLabelSprite(text, scale);
      if (refId) sprite.userData.refId = refId;
      const mid = startWorld.clone().lerp(endWorld, 0.5);
      const dir = endWorld.clone().sub(startWorld).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(dir, up);
      if (side.lengthSq() < 0.001) side.set(1, 0, 0);
      sprite.position.copy(mid).addScaledVector(side.normalize(), scale * 2.2).add(new THREE.Vector3(0, scale * 0.9, 0));
      group.add(sprite);
    }
  }
  target.add(group);
  if (refId) markerByRefId.set(refId, group);
  return group;
}

function addRemoveButton(localPoint, normal, scale, refId, meshRoot) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.arc(48, 48, 24, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(248, 81, 73, 0.94)";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(39, 39);
    ctx.lineTo(57, 57);
    ctx.moveTo(57, 39);
    ctx.lineTo(39, 57);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 1004;
  sprite.userData.refId = refId;
  sprite.userData.removeRefId = refId;
  sprite.scale.set(scale * 1.75, scale * 1.75, 1);
  const world = localPoint.clone();
  if (meshRoot) meshRoot.localToWorld(world);
  const lift = normal?.clone?.().normalize?.() || new THREE.Vector3(0, 1, 0);
  world.add(lift.multiplyScalar(scale * 2.8));
  world.x += scale * 4.7;
  world.y += scale * 1.35;
  sprite.position.copy(world);
  return sprite;
}

export function pickReferenceRemove(event, { camera, domElement }) {
  raycaster.setFromCamera(mouseNDC(event, domElement), camera);
  const hits = raycaster.intersectObjects(markersGroup.children, true);
  hits.sort((a, b) => (b.object.renderOrder || 0) - (a.object.renderOrder || 0));
  for (const hit of hits) {
    let obj = hit.object;
    while (obj) {
      if (obj.userData?.removeRefId) return obj.userData.removeRefId;
      obj = obj.parent;
    }
  }
  return pickReferenceRemoveScreen(event, { camera, domElement });
}

function pickReferenceRemoveScreen(event, { camera, domElement }) {
  const rect = domElement.getBoundingClientRect();
  const sx = event.clientX - rect.left;
  const sy = event.clientY - rect.top;
  let bestId = null;
  let bestDist = Infinity;
  markersGroup.traverse((obj) => {
    if (!obj.userData?.removeRefId || !obj.isSprite) return;
    const projected = obj.position.clone().project(camera);
    if (projected.z > 1) return;
    const px = (projected.x * 0.5 + 0.5) * rect.width;
    const py = (-projected.y * 0.5 + 0.5) * rect.height;
    const halfW = Math.max(24, obj.scale.x * rect.height * 0.045);
    const xBtnX = px - halfW + halfW * 2 * (268 / 320);
    const radius = Math.max(20, halfW * 0.38);
    const d = Math.hypot(sx - xBtnX, sy - py);
    if (d <= radius && d < bestDist) {
      bestDist = d;
      bestId = obj.userData.removeRefId;
    }
  });
  return bestId;
}

function positionsClose(a, b, tol) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dy, dz) <= tol;
}

function cornerPickPosition(hit, meshRoot, offset) {
  const modelPos = worldToModel(hit.point, meshRoot, offset);
  const vtx = nearestVertex(hit, meshRoot, offset);
  const corner = nearestBBoxCorner(meshRoot, modelPos, offset);
  const useVtx = vtx && vtx.distanceTo(modelPos) < corner.distance;
  return useVtx ? vtx : corner.position;
}

function findMatchingReference(references, hit, mode, meshRoot, offset) {
  if (!references?.length) return null;
  const tol = Math.max(scaleForMesh(meshRoot) * 0.25, 0.0005);

  if (mode === "face") {
    const kernelFace = hit._kernelFace;
    if (kernelFace && Number.isInteger(kernelFace.index)) {
      const matched = references.find((r) => (
        r.type === "face"
        && (r.kernel_face_index === kernelFace.index || r.face_key === `kernel:${kernelFace.index}`)
      ));
      if (matched) return matched;
    }
    const group = collectCoplanarGroup(hit);
    const centroid = groupCentroidModel(hit, group, meshRoot, offset);
    const planarKey = planarFaceKey(hit.object, group, centroid);
    return (
      references.find((r) => {
        if (r.type !== "face") return false;
        if (r.planar_key && r.planar_key === planarKey) return true;
        if (r.mesh_uuid !== hit.object.uuid) return false;
        if (r.face_key && r.face_key === facePickKey(hit)) return true;
        if (
          r.face_index != null &&
          hit.faceIndex != null &&
          group.includes(r.face_index)
        ) {
          return true;
        }
        return false;
      }) || null
    );
  }

  if (mode === "corner") {
    const kernelVertex = hit._kernelVertex;
    if (kernelVertex && Number.isInteger(kernelVertex.index)) {
      const matched = references.find((r) => r.type === "corner" && r.kernel_vertex_index === kernelVertex.index);
      if (matched) return matched;
    }
    const pos = cornerPickPosition(hit, meshRoot, offset);
    const picked = [pos.x, pos.y, pos.z];
    return references.find((r) => r.type === "corner" && positionsClose(r.position, picked, tol)) || null;
  }

  if (mode === "edge") {
    const kernelEdge = hit._kernelEdge;
    if (kernelEdge && Number.isInteger(kernelEdge.index)) {
      const matched = references.find((r) => r.type === "edge" && (r.kernel_edge_index === kernelEdge.index || r.edge_key === `kernel:${kernelEdge.index}`));
      if (matched) return matched;
    }
    const edge = nearestEdge(hit, meshRoot, offset);
    if (!edge) return null;
    const pickedKey = edge.edge_key || edgeKey(edge.edge_start, edge.edge_end);
    if (pickedKey) {
      const matched = references.find((r) => r.type === "edge" && edgeRefKey(r) === pickedKey);
      if (matched) return matched;
    }
    const picked = [edge.position.x, edge.position.y, edge.position.z];
    return references.find((r) => r.type === "edge" && positionsClose(r.position, picked, tol)) || null;
  }

  return null;
}

/** Highlight mesh for a logical face (world-space, ready to add to scene). */
export function buildFaceHighlightMesh(meshObject, faceIndices, color = 0x58a6ff, opacity = 0.45) {
  if (!meshObject?.geometry || !faceIndices?.length) return null;
  const geom = meshObject.geometry;
  const posAttr = geom.attributes.position;
  const positions = [];
  const indices = [];
  let vi = 0;

  for (const fi of faceIndices) {
    const verts = getTriangleVertexIndices(geom, fi).map((i) =>
      new THREE.Vector3().fromBufferAttribute(posAttr, i)
    );
    positions.push(
      verts[0].x, verts[0].y, verts[0].z,
      verts[1].x, verts[1].y, verts[1].z,
      verts[2].x, verts[2].y, verts[2].z
    );
    indices.push(vi, vi + 1, vi + 2);
    vi += 3;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthTest: false,
    })
  );
  mesh.renderOrder = 999;
  meshObject.updateWorldMatrix(true, false);
  mesh.applyMatrix4(meshObject.matrixWorld);
  return mesh;
}

export function catalogPointFromHit(hit, catalogRoot) {
  if (!hit?.point || !catalogRoot?.worldToLocal) return null;
  catalogRoot.updateMatrixWorld?.(true);
  return catalogRoot.worldToLocal(hit.point.clone());
}

export function catalogNormalFromHit(hit, catalogRoot) {
  const world = faceNormal(hit);
  if (!catalogRoot) return world;
  catalogRoot.updateMatrixWorld?.(true);
  return world.clone().transformDirection(new THREE.Matrix4().copy(catalogRoot.matrixWorld).invert()).normalize();
}

function kernelBodyByIndex(topo, index) {
  const bodies = topo?.bodies;
  if (!Array.isArray(bodies) || !Number.isInteger(index)) return null;
  return bodies.find((body) => Number(body?.index) === index) || bodies[index] || null;
}

export function pickKernelFace(topo, point, normal) {
  const faces = topo?.faces;
  if (!faces?.length || !point) return null;
  const nx = normal?.x || 0;
  const ny = normal?.y || 0;
  const nz = normal?.z || 0;
  const nlen = Math.hypot(nx, ny, nz) || 1;
  const nnx = nx / nlen;
  const nny = ny / nlen;
  const nnz = nz / nlen;
  const pad = 1.5;
  let best = null;
  for (const face of faces) {
    const bb = face?.bbox;
    if (!Array.isArray(bb) || bb.length < 6) continue;
    if (
      !(bb[0] - pad <= point.x && point.x <= bb[3] + pad
        && bb[1] - pad <= point.y && point.y <= bb[4] + pad
        && bb[2] - pad <= point.z && point.z <= bb[5] + pad)
    ) {
      continue;
    }
    const c = face.center;
    if (!Array.isArray(c) || c.length < 3) continue;
    const dist = Math.hypot(point.x - c[0], point.y - c[1], point.z - c[2]);
    const fn = face.normal;
    let align = 0;
    if (Array.isArray(fn) && fn.length >= 3) {
      align = Math.abs(fn[0] * nnx + fn[1] * nny + fn[2] * nnz);
    }
    const area = Math.abs(Number(face.area) || 0);
    const score = dist - 40 * align + area * 1e-9;
    if (!best || score < best.score) best = { face, score };
  }
  return best?.face || null;
}

function pickKernelEdge(topo, point, maxDist) {
  const edges = topo?.edges;
  if (!edges?.length || !point) return null;
  let best = null;
  for (const edge of edges) {
    const start = edge?.start;
    const end = edge?.end;
    if (!Array.isArray(start) || start.length < 3 || !Array.isArray(end) || end.length < 3) continue;
    const ax = start[0];
    const ay = start[1];
    const az = start[2];
    const bx = end[0] - ax;
    const by = end[1] - ay;
    const bz = end[2] - az;
    const denom = bx * bx + by * by + bz * bz;
    const t = denom < 1e-18 ? 0 : Math.max(0, Math.min(1, ((point.x - ax) * bx + (point.y - ay) * by + (point.z - az) * bz) / denom));
    const dist = Math.hypot(point.x - (ax + t * bx), point.y - (ay + t * by), point.z - (az + t * bz));
    if (Number.isFinite(maxDist) && dist > maxDist) continue;
    if (!best || dist < best.dist) best = { edge, dist };
  }
  return best?.edge || null;
}

function pickKernelVertex(topo, point, maxDist) {
  const vertices = topo?.vertices;
  if (!vertices?.length || !point) return null;
  let best = null;
  for (const vertex of vertices) {
    const pos = vertex?.position;
    if (!Array.isArray(pos) || pos.length < 3) continue;
    const dist = Math.hypot(point.x - pos[0], point.y - pos[1], point.z - pos[2]);
    if (Number.isFinite(maxDist) && dist > maxDist) continue;
    if (!best || dist < best.dist) best = { vertex, dist };
  }
  return best?.vertex || null;
}

function kernelEdgeOverlay(edge) {
  const start = new THREE.Vector3(...edge.start);
  const end = new THREE.Vector3(...edge.end);
  const mid = Array.isArray(edge.mid) ? new THREE.Vector3(...edge.mid) : start.clone().add(end).multiplyScalar(0.5);
  const dir = end.clone().sub(start);
  if (dir.lengthSq() > 1e-12) dir.normalize();
  else dir.set(0, 0, 1);
  return {
    position: mid,
    localPoint: mid.clone(),
    normal: [dir.x, dir.y, dir.z],
    direction: dir,
    edge_start: start,
    edge_end: end,
    edge_length: Number(edge.length) || start.distanceTo(end),
    edge_key: `kernel:${edge.index}`,
    kernel_edge_index: edge.index,
    body_index: edge.body_index,
  };
}

function showHoverKernelBody(body, catalogRoot, color = 0xffb020) {
  const bb = body?.bbox;
  if (!Array.isArray(bb) || bb.length < 6 || !catalogRoot) return false;
  catalogRoot.updateMatrixWorld?.(true);
  const box = new THREE.Box3(
    new THREE.Vector3(bb[0], bb[1], bb[2]),
    new THREE.Vector3(bb[3], bb[4], bb[5]),
  );
  box.applyMatrix4(catalogRoot.matrixWorld);
  const helper = new THREE.Box3Helper(box, color);
  helper.userData.isHover = true;
  helper.userData.isHoverBody = true;
  if (helper.material) {
    helper.material.depthTest = false;
    helper.material.depthWrite = false;
    helper.material.transparent = true;
    helper.material.opacity = 0.95;
  }
  helper.renderOrder = 1001;
  hoverGroup.add(helper);
  return true;
}

function buildKernelFaceMesh(face, catalogRoot) {
  const tris = face?.tris;
  if (!Array.isArray(tris) || tris.length < 9 || !catalogRoot) return null;
  catalogRoot.updateMatrixWorld?.(true);
  const positions = [];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const a = new THREE.Vector3(tris[i], tris[i + 1], tris[i + 2]).applyMatrix4(catalogRoot.matrixWorld);
    const b = new THREE.Vector3(tris[i + 3], tris[i + 4], tris[i + 5]).applyMatrix4(catalogRoot.matrixWorld);
    const c = new THREE.Vector3(tris[i + 6], tris[i + 7], tris[i + 8]).applyMatrix4(catalogRoot.matrixWorld);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const overlay = new THREE.Mesh(
    geom,
    new THREE.MeshBasicMaterial({
      color: 0x58a6ff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthTest: false,
    }),
  );
  overlay.renderOrder = 998;
  return overlay;
}

function showHoverKernelFace(face, catalogRoot) {
  const overlay = buildKernelFaceMesh(face, catalogRoot);
  if (!overlay) return false;
  hoverGroup.add(overlay);
  hoverFace = overlay;
  return true;
}

function attachKernelHoverBody(topo, entity, catalogRoot, mesh) {
  const body = kernelBodyByIndex(topo, entity?.body_index);
  if (body && showHoverKernelBody(body, catalogRoot)) return;
  if (mesh) showHoverBody(mesh);
}

function bindKernelHit(hit, { kernelTopo, catalogRoot, scale }) {
  if (!kernelTopo || kernelTopo.kernel !== "freecad" || !catalogRoot || !hit) return hit;
  const point = catalogPointFromHit(hit, catalogRoot);
  if (!point) return hit;
  const normal = catalogNormalFromHit(hit, catalogRoot);
  const maxDist = Math.max(scale || 0.01, 0.5) * 8;
  hit._kernelPoint = point;
  hit._kernelNormal = normal;
  hit._kernelFace = pickKernelFace(kernelTopo, point, normal);
  hit._kernelEdge = pickKernelEdge(kernelTopo, point, maxDist);
  hit._kernelVertex = pickKernelVertex(kernelTopo, point, maxDist * 0.45);
  hit._kernelTopo = kernelTopo;
  hit._catalogRoot = catalogRoot;
  return hit;
}

function kernelBodyIndexFromPoint(topo, point) {
  if (!point || !topo?.bodies?.length) return null;
  const pad = 1.5;
  let best = null;
  for (const body of topo.bodies) {
    const bb = body?.bbox;
    const index = Number(body?.index);
    if (!Array.isArray(bb) || bb.length < 6 || !Number.isInteger(index)) continue;
    if (
      !(bb[0] - pad <= point.x && point.x <= bb[3] + pad
        && bb[1] - pad <= point.y && point.y <= bb[4] + pad
        && bb[2] - pad <= point.z && point.z <= bb[5] + pad)
    ) continue;
    const volume = Math.abs((bb[3] - bb[0]) * (bb[4] - bb[1]) * (bb[5] - bb[2]));
    if (!best || volume < best.volume) best = { index, volume };
  }
  return best?.index ?? null;
}

function resolveKernelCatalogRoot(hit, catalogRoot, meshRoot, getCatalogRoot) {
  if (typeof getCatalogRoot === "function" && hit?.object) {
    return getCatalogRoot(hit.object) || catalogRoot || meshRoot;
  }
  return catalogRoot || meshRoot;
}

function showHoverFace(hit) {
  if (!hit.face && !hit.object) return;
  if (hit.face) {
    const group = collectCoplanarGroup(hit);
    const mesh = buildFaceHighlightMesh(hit.object, group, 0x58a6ff, 0.4);
    if (mesh) {
      mesh.renderOrder = 998;
      hoverGroup.add(mesh);
      hoverFace = mesh;
    }
  }
  showHoverBody(hit.object);
}

function showHoverCorner(localPoint, scale, mesh = null) {
  disposeGroup(hoverGroup);
  const s = scale * 1.5;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(s, s, s),
    new THREE.MeshBasicMaterial({ color: 0xff7b72, wireframe: true, depthTest: false })
  );
  m.position.copy(localPoint);
  m.renderOrder = 999;
  hoverGroup.add(m);
  hoverCorner = m;
  if (mesh) showHoverBody(mesh);
}

function showHoverEdge(edge, scale, meshRoot, offset, mesh = null) {
  disposeGroup(hoverGroup);
  const marker = addEdgeMarker(edge, scale, meshRoot, offset, null, {
    label: true,
    opacity: 0.72,
    target: hoverGroup,
  });
  hoverEdge = marker;
  if (mesh) showHoverBody(mesh);
}

function xrPresentingDom() {
  try {
    return typeof document !== "undefined" && !!document.body?.classList?.contains("xr-presenting");
  } catch {
    return false;
  }
}

function showHoverObject(mesh) {
  if (xrPresentingDom()) return;
  clearHover();
  if (!mesh?.isMesh) return;
  const box = new THREE.BoxHelper(mesh, 0x58a6ff);
  box.userData.isHover = true;
  if (box.material) {
    box.material.depthTest = false;
    box.material.depthWrite = false;
  }
  hoverGroup.add(box);
}

function screenPoint(event) {
  return new THREE.Vector2(event.clientX, event.clientY);
}

function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const crosses =
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / ((pj.y - pi.y) || 1e-9) + pi.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function projectToScreen(worldPoint, camera, domElement) {
  const rect = domElement.getBoundingClientRect();
  const ndc = worldPoint.clone().project(camera);
  return new THREE.Vector2(
    rect.left + ((ndc.x + 1) * 0.5) * rect.width,
    rect.top + ((1 - ndc.y) * 0.5) * rect.height
  );
}

function updateLassoLine() {
  if (!lassoDraft?.line) return;
  const points = lassoDraft.worldPoints.slice();
  if (points.length > 2) points.push(points[0].clone());
  lassoDraft.line.geometry.dispose();
  lassoDraft.line.geometry = new THREE.BufferGeometry().setFromPoints(points);
  lassoDraft.line.computeLineDistances();
}

function makeLassoLine(scale) {
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({
      color: 0x3fb950,
      dashSize: scale * 0.7,
      gapSize: scale * 0.38,
      depthTest: false,
      transparent: true,
      opacity: 0.98,
    })
  );
  line.renderOrder = 1003;
  return line;
}

function lassoHit(event, { camera, domElement, meshRoot }) {
  const hits = raycast(event, camera, domElement, meshRoot);
  return preferredHit(hits);
}

function addLassoSample(event, opts, force = false) {
  if (!lassoDraft) return false;
  const hit = lassoHit(event, opts);
  if (!hit) return false;
  const offset = opts.meshCenterOffset || new THREE.Vector3();
  const model = worldToModel(hit.point, opts.meshRoot, offset);
  const normal = faceNormal(hit);
  const lifted = hit.point.clone().addScaledVector(normal, lassoDraft.scale * 0.18);
  const screen = screenPoint(event);
  const last = lassoDraft.screenPoints.at(-1);
  if (!force && last && last.distanceTo(screen) < 6) return false;
  lassoDraft.worldPoints.push(lifted);
  lassoDraft.surfacePoints.push([model.x, model.y, model.z]);
  lassoDraft.normals.push([normal.x, normal.y, normal.z]);
  lassoDraft.screenPoints.push(screen);
  lassoDraft.mesh = hit.object || lassoDraft.mesh;
  lassoDraft.faceIndex = hit.faceIndex ?? lassoDraft.faceIndex;
  lassoDraft.point = hit.point?.clone?.() || lassoDraft.point;
  updateLassoLine();
  return true;
}

function selectedGeometryForLasso({ camera, domElement, meshRoot, meshCenterOffset }) {
  const polygon = lassoDraft?.screenPoints || [];
  if (polygon.length < 3) return { faceIndices: [], vertices: [], targetPosition: null, targetNormal: null };
  const offset = meshCenterOffset || new THREE.Vector3();
  const selectedFaces = [];
  const vertexMap = new Map();
  const cameraPos = camera.getWorldPosition(new THREE.Vector3());
  const loopCenter = new THREE.Vector3();
  (lassoDraft?.surfacePoints || []).forEach((p) => loopCenter.add(new THREE.Vector3(...p)));
  if (lassoDraft?.surfacePoints?.length) loopCenter.divideScalar(lassoDraft.surfacePoints.length);
  let bestTarget = null;
  let bestTargetD = Infinity;

  for (const mesh of getMeshes(meshRoot)) {
    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    const triCount = geom.index ? geom.index.count / 3 : pos.count / 3;
    for (let fi = 0; fi < triCount; fi += 1) {
      const indices = getTriangleVertexIndices(geom, fi);
      const verts = indices.map((idx) => new THREE.Vector3().fromBufferAttribute(pos, idx));
      const worldVerts = verts.map((v) => {
        const w = v.clone();
        mesh.localToWorld(w);
        return w;
      });
      const centroid = worldVerts[0].clone().add(worldVerts[1]).add(worldVerts[2]).divideScalar(3);
      const screen = projectToScreen(centroid, camera, domElement);
      if (!pointInPolygon(screen, polygon)) continue;
      const n = new THREE.Vector3()
        .crossVectors(worldVerts[1].clone().sub(worldVerts[0]), worldVerts[2].clone().sub(worldVerts[0]))
        .normalize();
      if (n.dot(cameraPos.clone().sub(centroid).normalize()) < -0.1) continue;
      selectedFaces.push(fi);
      const centroidModel = worldToModel(centroid, meshRoot, offset);
      const d = centroidModel.distanceTo(loopCenter);
      if (d < bestTargetD) {
        bestTargetD = d;
        bestTarget = {
          position: [centroidModel.x, centroidModel.y, centroidModel.z],
          normal: [n.x, n.y, n.z],
        };
      }
      for (const w of worldVerts) {
        const model = worldToModel(w, meshRoot, offset);
        const key = quantKey(model);
        if (!vertexMap.has(key)) vertexMap.set(key, [model.x, model.y, model.z]);
      }
    }
  }
  return {
    faceIndices: selectedFaces.slice(0, 400),
    vertices: [...vertexMap.values()].slice(0, 400),
    targetPosition: bestTarget?.position || null,
    targetNormal: bestTarget?.normal || null,
  };
}

export function beginLasso(event, opts) {
  if (pickMode !== "lasso" || !opts.meshRoot) return false;
  cancelLasso();
  const scale = scaleForMesh(opts.meshRoot);
  lassoDraft = {
    group: new THREE.Group(),
    line: makeLassoLine(scale),
    worldPoints: [],
    surfacePoints: [],
    normals: [],
    screenPoints: [],
    scale,
  };
  lassoDraft.group.name = "lasso-draft";
  lassoDraft.group.add(lassoDraft.line);
  markersGroup.add(lassoDraft.group);
  return addLassoSample(event, opts, true);
}

export function updateLasso(event, opts) {
  if (!lassoDraft) return false;
  return addLassoSample(event, opts);
}

export function cancelLasso() {
  if (!lassoDraft) return;
  disposeObject(lassoDraft.group);
  markersGroup.remove(lassoDraft.group);
  lassoDraft = null;
}

export function finishLasso(event, opts) {
  if (!lassoDraft) return null;
  addLassoSample(event, opts);
  if (lassoDraft.surfacePoints.length < 3) {
    cancelLasso();
    return null;
  }

  refCounter += 1;
  const id = `lasso-${refCounter}`;
  const center = new THREE.Vector3();
  lassoDraft.surfacePoints.forEach((p) => center.add(new THREE.Vector3(...p)));
  center.divideScalar(lassoDraft.surfacePoints.length);
  const avgNormal = new THREE.Vector3();
  lassoDraft.normals.forEach((n) => avgNormal.add(new THREE.Vector3(...n)));
  avgNormal.normalize();
  const selected = selectedGeometryForLasso(opts);
  if (selected.targetPosition) center.set(...selected.targetPosition);
  if (selected.targetNormal) avgNormal.set(...selected.targetNormal).normalize();
  const localPoint = modelToLocal(center, opts.meshRoot, opts.meshCenterOffset || new THREE.Vector3());
  const localLoopPoints = (lassoDraft.surfacePoints || []).map((p) => {
    const local = modelToLocal(new THREE.Vector3(p[0], p[1], p[2]), opts.meshRoot, opts.meshCenterOffset || new THREE.Vector3());
    return [local.x, local.y, local.z];
  });
  lassoDraft.group.userData.refId = id;
  lassoDraft.group.add(addFaceLabel(localPoint, avgNormal, lassoDraft.scale, id, opts.meshRoot, { removable: true }));
  markerByRefId.set(id, lassoDraft.group);

  const ref = {
    id,
    type: "lasso",
    position: [center.x, center.y, center.z],
    normal: [avgNormal.x, avgNormal.y, avgNormal.z],
    face_index: selected.faceIndices[0] ?? null,
    face_indices: selected.faceIndices,
    selected_vertices: selected.vertices,
    loop_points: lassoDraft.surfacePoints,
    label: `lasso · ${lassoDraft.surfacePoints.length} pts · ${selected.faceIndices.length} faces`,
    token: `@${id}`,
    localPoint,
    local_point: [localPoint.x, localPoint.y, localPoint.z],
    local_loop_points: localLoopPoints,
  };
  const pickHit = {
    object: lassoDraft.mesh || null,
    faceIndex: lassoDraft.faceIndex ?? selected.faceIndices[0] ?? null,
    point: lassoDraft.point || null,
  };
  lassoDraft = null;
  return geometryPickResult("add", ref, pickHit);
}

/* ---------------------------------------------------------------------------
 * Line / path tool — click multiple points (e.g. between two parts) to build a
 * polyline, then reference it in the prompt ("create wire ducts between these
 * 2 points", "wire loops to feed them through", ...).
 * ------------------------------------------------------------------------- */

const LINE_COLOR = 0x58a6ff;

function makePathLine(scale) {
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: LINE_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.98,
    })
  );
  line.renderOrder = 1003;
  return line;
}

function updatePathLine(draft, extraWorldPoint = null) {
  if (!draft?.line) return;
  const pts = draft.worldPoints.slice();
  if (extraWorldPoint) pts.push(extraWorldPoint.clone());
  draft.line.geometry.dispose();
  draft.line.geometry = new THREE.BufferGeometry().setFromPoints(
    pts.length ? pts : [new THREE.Vector3()]
  );
}

/** World/model point for a click: prefer a surface hit, else project onto a
 *  horizontal plane through the last point (lets you route points in space). */
function pointForLineEvent(event, opts) {
  const { camera, domElement, meshRoot } = opts;
  const offset = opts.meshCenterOffset || new THREE.Vector3();
  const hits = raycast(event, camera, domElement, meshRoot);
  if (hits.length) {
    const hit = preferredHit(hits);
    const normal = faceNormal(hit);
    const world = hit.point.clone().addScaledVector(normal, (lineDraft?.scale || 0.01) * 0.12);
    const modelNormal = worldDirectionToModel(normal, meshRoot);
    return { world, model: worldToModel(world, meshRoot, offset), normal: modelNormal, onSurface: true, mesh: hit.object, faceIndex: hit.faceIndex ?? null, point: hit.point.clone() };
  }
  const anchor =
    lineDraft?.worldPoints?.at(-1)?.clone() ||
    new THREE.Box3().setFromObject(meshRoot).getCenter(new THREE.Vector3());
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -anchor.y);
  raycaster.setFromCamera(mouseNDC(event, domElement), camera);
  const target = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, target)) return null;
  return { world: target, model: worldToModel(target, meshRoot, offset), onSurface: false };
}

export function hasLineDraft() {
  return !!lineDraft && lineDraft.worldPoints.length > 0;
}

export function lineDraftPointCount() {
  return lineDraft ? lineDraft.worldPoints.length : 0;
}

/** Add one point to the line path. Starts the draft on the first click.
 *  Returns { count } when a point was added, or null when ignored. */
export function addLinePoint(event, opts) {
  if (pickMode !== "line" || !opts.meshRoot) return null;
  if (!lineDraft) {
    const scale = scaleForMesh(opts.meshRoot);
    lineDraft = {
      group: new THREE.Group(),
      line: makePathLine(scale),
      preview: makePathPreviewSegment(scale),
      worldPoints: [],
      modelPoints: [],
      modelNormals: [],
      surfaceFlags: [],
      dots: [],
      scale,
    };
    lineDraft.group.name = "line-draft";
    lineDraft.group.add(lineDraft.line);
    lineDraft.group.add(lineDraft.preview);
    markersGroup.add(lineDraft.group);
  }
  const p = pointForLineEvent(event, opts);
  if (!p) return null;
  const screen = projectToScreen(p.world, opts.camera, opts.domElement);
  const last = lineDraft.screenLast;
  if (last && last.distanceTo(screen) < 6) return null; // de-dupe (e.g. dblclick)
  lineDraft.screenLast = screen;
  lineDraft.worldPoints.push(p.world.clone());
  lineDraft.modelPoints.push([p.model.x, p.model.y, p.model.z]);
  lineDraft.modelNormals.push(p.normal ? [p.normal.x, p.normal.y, p.normal.z] : null);
  lineDraft.surfaceFlags.push(Boolean(p.onSurface));
  if (p.mesh) {
    lineDraft.mesh = p.mesh;
    lineDraft.faceIndex = p.faceIndex ?? lineDraft.faceIndex;
    lineDraft.point = p.point || lineDraft.point;
  }
  const dot = addLineDot(p.world, lineDraft.scale);
  lineDraft.group.add(dot);
  lineDraft.dots.push(dot);
  updatePathLine(lineDraft);
  return {
    count: lineDraft.worldPoints.length,
    mesh: p.mesh || lineDraft.mesh || null,
    faceIndex: p.faceIndex ?? lineDraft.faceIndex ?? null,
    point: p.point || lineDraft.point || null,
  };
}

function makePathPreviewSegment(scale) {
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({
      color: LINE_COLOR,
      dashSize: scale * 0.6,
      gapSize: scale * 0.4,
      depthTest: false,
      transparent: true,
      opacity: 0.7,
    })
  );
  line.renderOrder = 1002;
  line.visible = false;
  return line;
}

function addLineDot(worldPoint, scale) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(scale * 0.7, 14, 14),
    new THREE.MeshBasicMaterial({ color: LINE_COLOR, depthTest: false })
  );
  m.renderOrder = 1004;
  m.position.copy(worldPoint);
  return m;
}

/** Rubber-band preview from the last placed point to the cursor. */
export function updateLinePreview(event, opts) {
  if (!lineDraft || !lineDraft.worldPoints.length) return;
  const p = pointForLineEvent(event, opts);
  if (!p) return;
  const last = lineDraft.worldPoints.at(-1);
  lineDraft.preview.visible = true;
  lineDraft.preview.geometry.dispose();
  lineDraft.preview.geometry = new THREE.BufferGeometry().setFromPoints([last.clone(), p.world.clone()]);
  lineDraft.preview.computeLineDistances();
}

export function cancelLinePath() {
  if (!lineDraft) return;
  disposeObject(lineDraft.group);
  markersGroup.remove(lineDraft.group);
  lineDraft = null;
}

/** Finalize the path into a reference. Needs >= 2 points. */
export function finishLinePath(opts) {
  if (!lineDraft || lineDraft.worldPoints.length < 2) {
    cancelLinePath();
    return null;
  }
  const offset = opts.meshCenterOffset || new THREE.Vector3();
  const meshRoot = opts.meshRoot;
  const pts = lineDraft.modelPoints.slice();
  const surfaceNormals = lineDraft.modelNormals.slice();
  const surfaceLocked = lineDraft.surfaceFlags.some(Boolean);

  refCounter += 1;
  const id = `path-${refCounter}`;

  const center = new THREE.Vector3();
  pts.forEach((p) => center.add(new THREE.Vector3(...p)));
  center.divideScalar(pts.length);
  const normal = new THREE.Vector3();
  surfaceNormals.forEach((n) => {
    if (Array.isArray(n) && n.length === 3) normal.add(new THREE.Vector3(n[0], n[1], n[2]));
  });
  if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
  else normal.normalize();
  const localPoint = modelToLocal(center, meshRoot, offset);
  const localLoopPoints = pts.map((p) => {
    const local = modelToLocal(new THREE.Vector3(p[0], p[1], p[2]), meshRoot, offset);
    return [local.x, local.y, local.z];
  });

  // freeze preview + clean up rubber band
  lineDraft.preview.visible = false;
  lineDraft.preview.geometry.dispose();
  lineDraft.preview.geometry = new THREE.BufferGeometry();
  updatePathLine(lineDraft);

  const group = lineDraft.group;
  group.userData.refId = id;
  group.add(addFaceLabel(localPoint, normal, lineDraft.scale, id, meshRoot, { removable: true }));
  markerByRefId.set(id, group);

  const ref = {
    id,
    type: "path",
    position: [center.x, center.y, center.z],
    normal: [normal.x, normal.y, normal.z],
    loop_points: pts,
    surface_normals: surfaceNormals,
    surface_locked: surfaceLocked,
    endpoints: [pts[0], pts[pts.length - 1]],
    label: `wire path · ${pts.length} pts${surfaceLocked ? " · face-snapped" : ""}`,
    token: `@${id}`,
    localPoint,
    local_point: [localPoint.x, localPoint.y, localPoint.z],
    local_loop_points: localLoopPoints,
  };
  const pickHit = {
    object: lineDraft.mesh || null,
    faceIndex: lineDraft.faceIndex ?? null,
    point: lineDraft.point || null,
  };
  lineDraft = null;
  return geometryPickResult("add", ref, pickHit);
}

function makeStoredPathLine(ref, meshRoot, offset) {
  const useLocal = Array.isArray(ref.local_loop_points) && ref.local_loop_points.length > 0;
  const rawPoints = useLocal ? ref.local_loop_points : ref.loop_points || [];
  const localPoints = [];
  const points = rawPoints
    .filter((p) => Array.isArray(p) && p.length === 3)
    .map((p) => {
      const local = useLocal
        ? new THREE.Vector3(p[0], p[1], p[2])
        : modelToLocal(new THREE.Vector3(p[0], p[1], p[2]), meshRoot, offset);
      localPoints.push([local.x, local.y, local.z]);
      const world = local.clone();
      meshRoot.localToWorld(world);
      return world;
    });
  if (!useLocal && localPoints.length) ref.local_loop_points = localPoints;
  if (points.length < 2) return { line: null, points };
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: LINE_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.98,
    })
  );
  line.renderOrder = 1003;
  return { line, points };
}

function firstPickMesh(meshRoot) {
  return getMeshes(meshRoot)[0] || null;
}

function refLocalPoint(ref, meshRoot, offset) {
  if (ref.local_point?.length === 3) {
    return new THREE.Vector3(ref.local_point[0], ref.local_point[1], ref.local_point[2]);
  }
  if (ref.position?.length === 3) {
    return modelToLocal(new THREE.Vector3(ref.position[0], ref.position[1], ref.position[2]), meshRoot, offset);
  }
  return null;
}

function makeStoredLassoLine(ref, meshRoot, offset, scale) {
  const useLocal = Array.isArray(ref.local_loop_points) && ref.local_loop_points.length > 0;
  const rawPoints = useLocal ? ref.local_loop_points : ref.loop_points || [];
  const localPoints = [];
  const points = rawPoints
    .filter((p) => Array.isArray(p) && p.length === 3)
    .map((p) => {
      const local = useLocal
        ? new THREE.Vector3(p[0], p[1], p[2])
        : modelToLocal(new THREE.Vector3(p[0], p[1], p[2]), meshRoot, offset);
      localPoints.push([local.x, local.y, local.z]);
      const world = local.clone();
      meshRoot.localToWorld(world);
      return world;
    });
  if (!useLocal && localPoints.length) ref.local_loop_points = localPoints;
  if (points.length < 3) return null;
  points.push(points[0].clone());
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineDashedMaterial({
      color: 0x3fb950,
      dashSize: scale * 0.7,
      gapSize: scale * 0.38,
      depthTest: false,
      transparent: true,
      opacity: 0.98,
    })
  );
  line.computeLineDistances();
  line.renderOrder = 1003;
  return line;
}

export function restoreReferenceMarkers(refs = [], { meshRoot, meshCenterOffset }) {
  if (!meshRoot) return;
  const offset = meshCenterOffset || new THREE.Vector3();
  const scale = scaleForMesh(meshRoot);
  const mesh = firstPickMesh(meshRoot);
  for (const ref of refs) {
    if (!ref?.id || markerByRefId.has(ref.id)) continue;
    const idNum = Number(String(ref.id).split("-").at(-1));
    if (Number.isFinite(idNum)) refCounter = Math.max(refCounter, idNum);
    const localPoint = refLocalPoint(ref, meshRoot, offset);
    if (!localPoint) continue;
    const normal = new THREE.Vector3(...(ref.normal || [0, 1, 0]));
    if (ref.type === "face" && ref.face_indices?.length && mesh) {
      const highlight = buildFaceHighlightMesh(mesh, ref.face_indices, 0x58a6ff, 0.5);
      if (highlight) {
        const group = new THREE.Group();
        group.userData.refId = ref.id;
        highlight.userData.refId = ref.id;
        group.add(highlight);
        group.add(addFaceLabel(localPoint, normal, scale, ref.id, meshRoot));
        markersGroup.add(group);
        markerByRefId.set(ref.id, group);
        continue;
      }
    }
    if (ref.type === "path") {
      const group = new THREE.Group();
      const { line, points } = makeStoredPathLine(ref, meshRoot, offset);
      group.userData.refId = ref.id;
      if (line) group.add(line);
      for (const wp of points) group.add(addLineDot(wp, scale));
      group.add(addFaceLabel(localPoint, normal, scale, ref.id, meshRoot, { removable: true }));
      markersGroup.add(group);
      markerByRefId.set(ref.id, group);
      continue;
    }
    if (ref.type === "lasso") {
      const group = new THREE.Group();
      const line = makeStoredLassoLine(ref, meshRoot, offset, scale);
      group.userData.refId = ref.id;
      if (line) group.add(line);
      group.add(addFaceLabel(localPoint, normal, scale, ref.id, meshRoot, { removable: true }));
      markersGroup.add(group);
      markerByRefId.set(ref.id, group);
      continue;
    }
    if (ref.type === "edge") {
      if (addEdgeMarker(ref, scale, meshRoot, offset, ref.id, { label: true })) continue;
    }
    addMarker(
      localPoint,
      ref.type === "edge" ? 0x58a6ff : 0xff7b72,
      scale,
      ref.type === "corner" ? "box" : "sphere",
      ref.id,
      meshRoot
    );
  }
}

export function updateHover(event, { camera, domElement, meshRoot, meshCenterOffset, kernelTopo = null, catalogRoot = null, getCatalogRoot = null }) {
  if (pickMode === "off" || !meshRoot) {
    clearHover();
    return;
  }
  const hits = raycast(event, camera, domElement, meshRoot);
  clearHover();
  if (!hits.length) return;

  const hit = preferredHit(hits);
  const offset = meshCenterOffset || new THREE.Vector3();
  const scale = scaleForMesh(meshRoot);
  const root = resolveKernelCatalogRoot(hit, catalogRoot, meshRoot, getCatalogRoot);
  bindKernelHit(hit, { kernelTopo, catalogRoot: root, scale });

  if (pickMode === "face") {
    if (hit.face) showHoverFace(hit);
    else if (hit._kernelFace) showHoverKernelFace(hit._kernelFace, root);
    if (hit._kernelFace) attachKernelHoverBody(kernelTopo, hit._kernelFace, root, hit.object);
  } else if (pickMode === "object") {
    const body = kernelBodyByIndex(kernelTopo, hit._kernelFace?.body_index ?? kernelBodyIndexFromPoint(kernelTopo, hit._kernelPoint));
    if (!(body && showHoverKernelBody(body, root, 0x58a6ff))) showHoverObject(hit.object);
  } else if (pickMode === "corner") {
    if (hit._kernelVertex) {
      const world = new THREE.Vector3(...hit._kernelVertex.position);
      root.updateMatrixWorld?.(true);
      root.localToWorld(world);
      showHoverCorner(world, scale, null);
      attachKernelHoverBody(kernelTopo, hit._kernelVertex, root, hit.object);
    } else {
      const modelPos = worldToModel(hit.point, meshRoot, offset);
      const corner = nearestBBoxCorner(meshRoot, modelPos, offset);
      const local = modelToLocal(corner.position, meshRoot, offset);
      showHoverCorner(local, scale, hit.object);
    }
  } else if (pickMode === "edge") {
    if (hit._kernelEdge) {
      showHoverEdge(kernelEdgeOverlay(hit._kernelEdge), scale, root, new THREE.Vector3(), null);
      attachKernelHoverBody(kernelTopo, hit._kernelEdge, root, hit.object);
    } else {
      const edge = nearestEdge(hit, meshRoot, offset);
      if (edge) showHoverEdge(edge, scale, meshRoot, offset, hit.object);
    }
  } else if (pickMode === "line" || pickMode === "lasso") {
    if (hit._kernelFace) attachKernelHoverBody(kernelTopo, hit._kernelFace, root, hit.object);
    else if (hit.object) showHoverBody(hit.object);
  }
}

export function pickGeometry(event, { camera, domElement, meshRoot, meshCenterOffset, references = [], kernelTopo = null, catalogRoot = null, getCatalogRoot = null }) {
  if (pickMode === "off" || !meshRoot) return null;

  const hits = raycast(event, camera, domElement, meshRoot);
  if (!hits.length) return null;

  const hit = preferredHit(hits);
  const offset = meshCenterOffset || new THREE.Vector3();
  const scale = scaleForMesh(meshRoot);
  const root = resolveKernelCatalogRoot(hit, catalogRoot, meshRoot, getCatalogRoot);
  bindKernelHit(hit, { kernelTopo, catalogRoot: root, scale });

  const existing = findMatchingReference(references, hit, pickMode, meshRoot, offset);
  if (existing) {
    removeReferenceMarker(existing.id);
    return geometryPickResult("remove", existing, hit);
  }

  refCounter += 1;
  let type = pickMode;
  let position;
  let normal;
  let localPoint;
  let planarKey = null;
  let faceGroup = null;
  const kernelOffset = new THREE.Vector3();

  if (pickMode === "face") {
    if (hit.face) {
      faceGroup = collectCoplanarGroup(hit);
      position = groupCentroidModel(hit, faceGroup, meshRoot, offset);
      normal = faceNormal(hit);
      localPoint = modelToLocal(position, meshRoot, offset);
      planarKey = planarFaceKey(hit.object, faceGroup, position);
      hit._groupArea = computeGroupArea(hit.object, faceGroup);
    }
    if (hit._kernelFace) {
      planarKey = `kernel:${hit._kernelFace.index}`;
      if (Number.isFinite(hit._kernelFace.area)) hit._groupArea = hit._kernelFace.area;
      if (!position) {
        position = new THREE.Vector3(...hit._kernelFace.center);
        normal = new THREE.Vector3(...(hit._kernelFace.normal || [0, 0, 1]));
        localPoint = position.clone();
      }
    }
    if (!position) return null;
  } else if (pickMode === "corner") {
    if (hit._kernelVertex) {
      position = new THREE.Vector3(...hit._kernelVertex.position);
      normal = hit._kernelNormal || new THREE.Vector3(0, 0, 1);
      localPoint = position.clone();
    } else {
      const modelPos = worldToModel(hit.point, meshRoot, offset);
      const vtx = nearestVertex(hit, meshRoot, offset);
      const corner = nearestBBoxCorner(meshRoot, modelPos, offset);
      const useVtx = vtx && vtx.distanceTo(modelPos) < corner.distance;
      position = useVtx ? vtx : corner.position;
      normal = corner.normal;
      localPoint = modelToLocal(position, meshRoot, offset);
    }
  } else if (pickMode === "edge") {
    if (hit._kernelEdge) {
      const edge = kernelEdgeOverlay(hit._kernelEdge);
      position = edge.position;
      normal = new THREE.Vector3(...edge.normal);
      localPoint = edge.localPoint;
      hit._edgePick = edge;
    } else {
      const edge = nearestEdge(hit, meshRoot, offset);
      if (!edge) return null;
      position = edge.position;
      normal = new THREE.Vector3(...edge.normal);
      localPoint = edge.localPoint;
      hit._edgePick = edge;
    }
  } else {
    return null;
  }

  const id = `${type}-${refCounter}`;
  const edgePick = hit._edgePick;
  const kernelFace = hit._kernelFace;
  const kernelEdge = hit._kernelEdge;
  const kernelVertex = hit._kernelVertex;
  const ref = {
    id,
    type,
    kernel: kernelFace || kernelEdge || kernelVertex ? "freecad" : null,
    position: [position.x, position.y, position.z],
    normal: [normal.x, normal.y, normal.z],
    face_index: kernelFace ? kernelFace.index : (pickMode === "face" ? (faceGroup?.[0] ?? hit.faceIndex ?? null) : (hit.faceIndex ?? null)),
    face_indices: (pickMode === "face" && faceGroup?.length) ? faceGroup : null,
    kernel_face_index: kernelFace ? kernelFace.index : null,
    kernel_edge_index: kernelEdge ? kernelEdge.index : null,
    kernel_vertex_index: kernelVertex ? kernelVertex.index : null,
    body_index: kernelFace?.body_index ?? kernelEdge?.body_index ?? kernelVertex?.body_index ?? null,
    face_key: kernelFace ? `kernel:${kernelFace.index}` : (pickMode === "face" ? facePickKey(hit) : null),
    planar_key: pickMode === "face" ? planarKey : null,
    mesh_uuid: pickMode === "face" ? hit.object.uuid : null,
    geometry_context: surfaceEditContext(hit, root),
    face_area: pickMode === "face" ? (hit._groupArea ?? null) : null,
    edge_length: pickMode === "edge" && edgePick ? edgePick.edge_length : null,
    edge_start: pickMode === "edge" && edgePick?.edge_start
      ? [edgePick.edge_start.x, edgePick.edge_start.y, edgePick.edge_start.z]
      : null,
    edge_end: pickMode === "edge" && edgePick?.edge_end
      ? [edgePick.edge_end.x, edgePick.edge_end.y, edgePick.edge_end.z]
      : null,
    edge_key: pickMode === "edge" && edgePick ? edgePick.edge_key : null,
    label: formatRefLabel(type, [position.x, position.y, position.z]),
    token: `@${id}`,
    localPoint,
    local_point: [localPoint.x, localPoint.y, localPoint.z],
  };

  if (pickMode === "face") {
    const glbHighlight = faceGroup?.length ? buildFaceHighlightMesh(hit.object, faceGroup, 0x58a6ff, 0.5) : null;
    const kernelHighlight = (!glbHighlight && kernelFace) ? buildKernelFaceMesh(kernelFace, root) : null;
    const highlight = glbHighlight || kernelHighlight;
    if (highlight) {
      const markerGroup = new THREE.Group();
      markerGroup.userData.refId = id;
      highlight.userData.refId = id;
      markerGroup.add(highlight);
      markerGroup.add(addFaceLabel(localPoint, normal, scale, id, glbHighlight ? meshRoot : root));
      markersGroup.add(markerGroup);
      markerByRefId.set(id, markerGroup);
    }
  } else if (pickMode === "edge" && edgePick) {
    addEdgeMarker(edgePick, scale, kernelEdge ? root : meshRoot, kernelEdge ? kernelOffset : offset, id, { label: true });
  } else {
    addMarker(
      localPoint,
      type === "edge" ? 0x58a6ff : 0xff7b72,
      scale,
      type === "corner" ? "box" : "sphere",
      id,
      kernelVertex || kernelEdge || kernelFace ? root : meshRoot
    );
  }
  return geometryPickResult("add", ref, hit);
}

function geometryPickResult(toggle, ref, hit) {
  if (!hit) return { toggle, ref };
  return {
    toggle,
    ref,
    mesh: hit.object || null,
    faceIndex: hit.faceIndex ?? null,
    point: hit.point?.clone?.() || null,
    normal: faceNormal(hit),
  };
}

function showHoverBody(mesh, color = 0xffb020) {
  if (xrPresentingDom()) return;
  if (!mesh?.isMesh) return;
  const box = new THREE.BoxHelper(mesh, color);
  box.userData.isHover = true;
  box.userData.isHoverBody = true;
  if (box.material) {
    box.material.depthTest = false;
    box.material.depthWrite = false;
    box.material.transparent = true;
    box.material.opacity = 0.95;
  }
  box.renderOrder = 1001;
  hoverGroup.add(box);
}

function preferredHit(hits) {
  if (!hits?.length) return null;
  const first = hits[0];
  const depthEps = Math.max(1e-4, Number(first.distance) * 0.004);
  let hit = first;
  let bestVol = meshWorldVolume(first.object);
  for (const candidate of hits) {
    if (candidate === first) continue;
    if (Math.abs(candidate.distance - first.distance) > depthEps) continue;
    const vol = meshWorldVolume(candidate.object);
    if (vol < bestVol * 0.85) {
      hit = candidate;
      bestVol = vol;
    }
  }
  return hit;
}

function meshWorldVolume(mesh) {
  if (!mesh) return Infinity;
  mesh.updateMatrixWorld?.(true);
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return Infinity;
  const size = box.getSize(new THREE.Vector3());
  return Math.max(1e-12, Math.abs(size.x * size.y * size.z));
}

/** Raycast pick for object/body selection (Fusion-style select tool).
 *  Overlapping solids prefer the smallest body under the cursor, not the parent shell. */
export function pickObject(event, { camera, domElement, meshRoot }) {
  if (!meshRoot) return null;
  const hits = raycast(event, camera, domElement, meshRoot);
  if (!hits.length) return null;
  const hit = preferredHit(hits);
  return {
    mesh: hit.object,
    faceIndex: hit.faceIndex ?? null,
    point: hit.point.clone(),
    normal: faceNormal(hit),
  };
}

export function formatRefLabel(type, pos) {
  const p = pos.map((v) => (v * 1000).toFixed(1) + "mm").join(", ");
  return `${type} · (${p})`;
}

/** Pick a face for extrude without adding a prompt reference marker. */
export function pickFaceAt(event, { camera, domElement, meshRoot, meshCenterOffset }) {
  if (!meshRoot) return null;
  const hits = raycast(event, camera, domElement, meshRoot);
  if (!hits.length || !hits[0].face) return null;
  const hit = hits[0];
  const offset = meshCenterOffset || new THREE.Vector3();
  const faceGroup = collectCoplanarGroup(hit);
  const position = groupCentroidModel(hit, faceGroup, meshRoot, offset);
  const normal = faceNormal(hit);
  const localPoint = modelToLocal(position, meshRoot, offset);
  return {
    type: "face",
    position,
    normal,
    localPoint,
    face_index: faceGroup?.[0] ?? hit.faceIndex ?? null,
    face_indices: faceGroup,
    mesh_uuid: hit.object.uuid,
    mesh_object: hit.object,
    hit,
  };
}

function measureFaceEntity(hit, meshRoot, offset) {
  const faceGroup = collectCoplanarGroup(hit);
  const centroid = groupCentroidModel(hit, faceGroup, meshRoot, offset);
  const normal = faceNormal(hit);
  const area = computeGroupArea(hit.object, faceGroup);
  return {
    type: "face",
    position: centroid,
    normal,
    vertex: null,
    edge: null,
    face: {
      centroid: centroid.clone(),
      normal: normal.clone(),
      area,
      face_indices: faceGroup,
    },
    hit,
  };
}

function measureEdgeEntity(hit, meshRoot, offset) {
  const edge = nearestEdge(hit, meshRoot, offset);
  if (!edge) return null;
  const dir = edge.direction || new THREE.Vector3(...(edge.normal || [0, 1, 0]));
  return {
    type: "edge",
    position: edge.position.clone(),
    normal: dir.clone(),
    vertex: null,
    edge: {
      start: edge.edge_start.clone(),
      end: edge.edge_end.clone(),
      length: edge.edge_length,
      direction: dir.clone(),
    },
    face: null,
    hit,
  };
}

function measureVertexEntity(hit, meshRoot, offset) {
  const modelPos = worldToModel(hit.point, meshRoot, offset);
  const vtx = nearestVertex(hit, meshRoot, offset);
  if (!vtx) return null;
  return {
    type: "vertex",
    position: vtx.clone(),
    normal: faceNormal(hit),
    vertex: vtx.clone(),
    edge: null,
    face: null,
    hit,
    _vtxDist: vtx.distanceTo(modelPos),
  };
}

/** Fusion-style measure pick. Pass `prefer: "face"|"edge"|"corner"` to lock the tool. */
export function pickMeasureEntity(event, { camera, domElement, meshRoot, meshCenterOffset, prefer = null, pickMode = null } = {}) {
  if (!meshRoot) return null;
  const hits = raycast(event, camera, domElement, meshRoot);
  if (!hits.length) return null;

  const hit = hits[0];
  const offset = meshCenterOffset || new THREE.Vector3();
  const scale = scaleForMesh(meshRoot);
  const want = String(prefer || pickMode || "").toLowerCase();
  const pickTol = scale * 4;

  if (want === "face") return measureFaceEntity(hit, meshRoot, offset);
  if (want === "edge") return measureEdgeEntity(hit, meshRoot, offset) || measureFaceEntity(hit, meshRoot, offset);
  if (want === "corner" || want === "vertex") {
    const vtx = measureVertexEntity(hit, meshRoot, offset);
    if (vtx) return vtx;
  }

  const vtx = measureVertexEntity(hit, meshRoot, offset);
  const edge = measureEdgeEntity(hit, meshRoot, offset);
  const vtxDist = vtx?._vtxDist ?? Infinity;
  const edgeDist = edge?.edge ? (nearestEdge(hit, meshRoot, offset)?.pick_distance ?? Infinity) : Infinity;
  const modelPos = worldToModel(hit.point, meshRoot, offset);
  const midDist = edge?.edge?.start && edge.edge.end
    ? modelPos.distanceTo(edge.edge.start.clone().add(edge.edge.end).multiplyScalar(0.5))
    : Infinity;

  if (vtx && vtxDist < pickTol * 0.45) return vtx;
  if (edge && Number.isFinite(midDist) && midDist < pickTol * 0.4) {
    const mid = edge.edge.start.clone().add(edge.edge.end).multiplyScalar(0.5);
    return {
      type: "vertex",
      position: mid,
      normal: edge.normal?.clone?.() || faceNormal(hit),
      vertex: mid.clone(),
      edge: null,
      face: null,
      hit,
      snap: "midpoint",
    };
  }
  if (edge && edgeDist < pickTol) return edge;
  return measureFaceEntity(hit, meshRoot, offset);
}

export function updateMeasureHover(event, { camera, domElement, meshRoot, meshCenterOffset, prefer = null, pickMode = null, onPreview } = {}) {
  if (!meshRoot) {
    clearHover();
    return null;
  }
  const entity = pickMeasureEntity(event, { camera, domElement, meshRoot, meshCenterOffset, prefer, pickMode });
  clearHover();
  if (!entity) return null;
  const scale = scaleForMesh(meshRoot);
  const offset = meshCenterOffset || new THREE.Vector3();
  const local = modelToLocal(entity.position, meshRoot, offset);

  if (entity.type === "edge" && entity.edge) {
    showHoverEdge({
      edge_start: entity.edge.start,
      edge_end: entity.edge.end,
      edge_length: entity.edge.length,
    }, scale, meshRoot, offset);
  } else if (entity.type === "vertex") {
    showHoverCorner(local, scale);
  } else if (entity.type === "face" && entity.hit) {
    showHoverFace(entity.hit);
  }
  onPreview?.(entity);
  return entity;
}

// ─── Measure annotation groups (dimension lines + live preview) ──────────────

const measureAnnotGroup = new THREE.Group();
measureAnnotGroup.name = "measureAnnotations";
const measureHoverGroup = new THREE.Group();
measureHoverGroup.name = "measureHoverLine";
const savedMeasureGroup = new THREE.Group();
savedMeasureGroup.name = "savedMeasureAnnotations";

export function getMeasureAnnotGroup() { return measureAnnotGroup; }
export function getMeasureHoverGroup() { return measureHoverGroup; }
export function getSavedMeasureGroup() { return savedMeasureGroup; }


/** World-space edge nearest to a mesh raycast hit (for XR measure). */
export function nearestWorldEdgeFromHit(hit) {
  if (!hit?.face || !hit?.object?.geometry?.attributes?.position) return null;
  const geom = hit.object.geometry;
  const pos = geom.attributes.position;
  const click = hit.point.clone();
  const edges = [
    [hit.face.a, hit.face.b],
    [hit.face.b, hit.face.c],
    [hit.face.c, hit.face.a],
  ];
  let best = null;
  let bestD = Infinity;
  for (const [i, j] of edges) {
    const v0 = new THREE.Vector3().fromBufferAttribute(pos, i);
    const v1 = new THREE.Vector3().fromBufferAttribute(pos, j);
    hit.object.localToWorld(v0);
    hit.object.localToWorld(v1);
    const line = new THREE.Line3(v0, v1);
    const closest = new THREE.Vector3();
    line.closestPointToPoint(click, true, closest);
    const d = closest.distanceTo(click);
    if (d < bestD) {
      bestD = d;
      best = {
        start: v0.clone(),
        end: v1.clone(),
        mid: v0.clone().add(v1).multiplyScalar(0.5),
        closest: closest.clone(),
        length: v0.distanceTo(v1),
        pick_distance: d,
      };
    }
  }
  return best;
}

export { scaleForMesh };

function _refVec(ref) {
  if (Array.isArray(ref?.local_point) && ref.local_point.length >= 3) {
    return new THREE.Vector3(ref.local_point[0], ref.local_point[1], ref.local_point[2]);
  }
  if (ref?.localPoint?.isVector3) return ref.localPoint.clone();
  if (!Array.isArray(ref?.position) || ref.position.length < 3) return null;
  return new THREE.Vector3(ref.position[0], ref.position[1], ref.position[2]);
}

function _toWorld(meshRoot, vec) {
  if (!vec) return null;
  const v = vec.clone();
  if (meshRoot) {
    meshRoot.updateMatrixWorld?.(true);
    meshRoot.localToWorld(v);
  }
  return v;
}

function _arrToWorld(meshRoot, arr) {
  if (!Array.isArray(arr) || arr.length < 3) return null;
  return _toWorld(meshRoot, new THREE.Vector3(Number(arr[0]), Number(arr[1]), Number(arr[2])));
}

function _disposeMesh(m) {
  m.geometry?.dispose();
  if (m.material) {
    m.material.map?.dispose();
    m.material.dispose();
  }
}

function _clearGroup(g) {
  const kids = [...(g?.children || [])];
  for (const k of kids) {
    if (k.children?.length) _clearGroup(k);
    _disposeMesh(k);
    g.remove(k);
  }
}

function _makeDimLabelSprite(text, scale, span) {
  const W = 320, H = 96;
  const pixelScale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * pixelScale;
  canvas.height = H * pixelScale;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(pixelScale, pixelScale);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(13, 18, 26, 0.94)";
    roundedRect(ctx, 18, 26, W - 36, H - 52, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(88, 166, 255, 0.55)";
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.fillStyle = "#e6edf3";
    ctx.font = "650 32px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, W / 2, H / 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const size = dimLabelSpriteSize(scale, span);
  sprite.scale.set(size.x, size.y, 1);
  sprite.renderOrder = 1003;
  return sprite;
}

function _makeEndcap(pos, scale, color = 0x58a6ff) {
  const geo = new THREE.SphereGeometry(scale * 0.35, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 1001;
  m.position.copy(pos);
  return m;
}

function _measureLine(a, b, color, opacity = 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const mat = new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    transparent: opacity < 0.999,
    opacity,
  });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 1002;
  return line;
}

function _fusionDimLayout(a, b, camera, scale) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  if (len < 1e-9) return null;
  dir.multiplyScalar(1 / len);
  const mid = a.clone().lerp(b, 0.5);
  const offsetDir = new THREE.Vector3();
  if (camera?.position) {
    const eye = camera.position.clone().sub(mid);
    if (eye.lengthSq() > 1e-12) offsetDir.crossVectors(eye.normalize(), dir);
  }
  if (offsetDir.lengthSq() < 1e-8) offsetDir.crossVectors(new THREE.Vector3(0, 1, 0), dir);
  if (offsetDir.lengthSq() < 1e-8) offsetDir.set(1, 0, 0);
  offsetDir.normalize();
  const offset = Math.min(Math.max(len * 0.12, scale * 1.35), Math.max(len * 0.26, scale * 2));
  const tickLen = Math.min(Math.max(len * 0.04, scale * 0.65), offset * 0.8);
  return {
    dir,
    len,
    w1: a.clone().addScaledVector(offsetDir, offset),
    w2: b.clone().addScaledVector(offsetDir, offset),
    tickLen,
  };
}

function _addDimSegment(group, a, b, label, scale, color = 0x58a6ff, opts = {}) {
  group.add(_makeEndcap(a, scale, color));
  group.add(_makeEndcap(b, scale, color));
  const layout = _fusionDimLayout(a, b, opts.camera, scale);
  if (!layout) {
    group.userData.measureAnchor = [a.x, a.y, a.z];
    group.userData.measureP1 = [a.x, a.y, a.z];
    group.userData.measureP2 = [b.x, b.y, b.z];
    return;
  }
  const { w1, w2, dir, tickLen, len } = layout;
  group.add(_measureLine(a, w1, color, 0.72));
  group.add(_measureLine(b, w2, color, 0.72));
  const halfTick = dir.clone().multiplyScalar(tickLen * 0.5);
  group.add(_measureLine(w1.clone().sub(halfTick), w1.clone().add(halfTick), color));
  group.add(_measureLine(w2.clone().sub(halfTick), w2.clone().add(halfTick), color));
  const labelMid = w1.clone().lerp(w2, 0.5);
  group.userData.measureAnchor = [labelMid.x, labelMid.y, labelMid.z];
  group.userData.measureP1 = [a.x, a.y, a.z];
  group.userData.measureP2 = [b.x, b.y, b.z];
  const along = w2.clone().sub(w1);
  const dimLen = along.length();
  const gap = opts.skipLabelSprites ? 0 : Math.min(dimLen * 0.28, Math.max(scale * 4.5, len * 0.16));
  if (gap > 0 && dimLen > gap * 1.35) {
    along.multiplyScalar(1 / dimLen);
    const g1 = w1.clone().addScaledVector(along, (dimLen - gap) * 0.5);
    const g2 = w2.clone().addScaledVector(along, -(dimLen - gap) * 0.5);
    group.add(_measureLine(w1, g1, color));
    group.add(_measureLine(g2, w2, color));
  } else {
    group.add(_measureLine(w1, w2, color));
  }
  if (opts.skipLabelSprites) return;
  const sprite = _makeDimLabelSprite(label, scale, len);
  sprite.position.copy(labelMid);
  group.add(sprite);
}

function _addEdgeGuide(group, a, b, color = 0x58a6ff) {
  group.add(_measureLine(a, b, color, 0.55));
}

function _edgeEndpoints(ref, meshRoot = null) {
  if (Array.isArray(ref?.edge_start) && Array.isArray(ref?.edge_end) && ref.edge_start.length >= 3 && ref.edge_end.length >= 3) {
    const start = new THREE.Vector3(...ref.edge_start);
    const end = new THREE.Vector3(...ref.edge_end);
    return {
      start: _toWorld(meshRoot, start) || start,
      end: _toWorld(meshRoot, end) || end,
    };
  }
  return null;
}

/**
 * Rebuild Fusion-style dimension overlays for picked geometry.
 * - 1 face → area label
 * - 1 edge → edge length
 * - 2+ picks → distance (and angle for 2 edges)
 */
export function setMeasureAnnotations(refs, mmPerUnit, meshRoot, formatFn, formatAreaFn, opts = {}) {
  const target = opts.target || measureAnnotGroup;
  if (opts.clear !== false) _clearGroup(target);
  if (!meshRoot || !refs?.length) return;
  const scale = scaleForMesh(meshRoot);
  const fmt = formatFn || ((mm) => `${mm.toFixed(2)} mm`);
  const fmtArea = formatAreaFn || ((mm2) => `${mm2.toFixed(2)} mm²`);
  const color = opts.color ?? 0x58a6ff;
  const skipLabelSprites = !!opts.skipLabelSprites;
  const dimOpts = { skipLabelSprites, camera: opts.camera };

  if (refs.length === 1) {
    const r = refs[0];
    if (r.type === "edge") {
      const ends = _edgeEndpoints(r, meshRoot);
      const a = ends?.start || _toWorld(meshRoot, _refVec(r));
      const b = ends?.end;
      const lenModel = Number.isFinite(r.edge_length)
        ? r.edge_length
        : ends
          ? ends.start.distanceTo(ends.end)
          : null;
      if (a && b && Number.isFinite(lenModel)) {
        _addDimSegment(target, a, b, fmt(lenModel * mmPerUnit), scale, color, dimOpts);
      } else if (a && Number.isFinite(lenModel) && !skipLabelSprites) {
        const sprite = _makeDimLabelSprite(fmt(lenModel * mmPerUnit), scale, lenModel);
        sprite.position.copy(a);
        target.add(sprite);
      }
      return;
    }
    if (r.type === "face") {
      const p = _toWorld(meshRoot, _refVec(r));
      if (p && Number.isFinite(r.face_area) && !skipLabelSprites) {
        const areaMm2 = r.face_area * mmPerUnit * mmPerUnit;
        const sprite = _makeDimLabelSprite(fmtArea(areaMm2), scale, scale * 5);
        const n = Array.isArray(r.normal) ? new THREE.Vector3(...r.normal).normalize() : new THREE.Vector3(0, 0, 1);
        sprite.position.copy(p).addScaledVector(n, scale * 4);
        target.add(sprite);
      }
      const highlight = _faceHighlightFromRef(r, meshRoot, color);
      if (highlight) target.add(highlight);
      else if (p) target.add(_makeEndcap(p, scale, color));
      if (p) {
        target.userData.measureAnchor = [p.x, p.y, p.z];
        target.userData.measureP1 = [p.x, p.y, p.z];
        target.userData.measureP2 = [p.x, p.y, p.z];
      }
      return;
    }
    if (r.type === "corner" || r.type === "vertex") {
      const p = _toWorld(meshRoot, _refVec(r));
      if (!p) return;
      if (!skipLabelSprites) {
        const label = `X ${fmt(p.x * mmPerUnit)}  Y ${fmt(p.y * mmPerUnit)}  Z ${fmt(p.z * mmPerUnit)}`;
        const sprite = _makeDimLabelSprite(label, scale, scale * 6);
        sprite.position.copy(p).add(new THREE.Vector3(0, 0, scale * 4));
        target.add(sprite);
      }
      target.add(_makeEndcap(p, scale, color));
      target.userData.measureAnchor = [p.x, p.y, p.z];
      target.userData.measureP1 = [p.x, p.y, p.z];
      target.userData.measureP2 = [p.x, p.y, p.z];
    }
    return;
  }

  if (refs.length === 2 && refs[0].type === "edge" && refs[1].type === "edge") {
    for (const r of refs) {
      const ends = _edgeEndpoints(r, meshRoot);
      if (ends) _addEdgeGuide(target, ends.start, ends.end, 0x58a6ff);
    }
    const d0 = _edgeEndpoints(refs[0], meshRoot);
    const d1 = _edgeEndpoints(refs[1], meshRoot);
    let a = _toWorld(meshRoot, _refVec(refs[0]));
    let b = _toWorld(meshRoot, _refVec(refs[1]));
    if (d0 && d1) {
      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      const line0 = new THREE.Line3(d0.start, d0.end);
      const line1 = new THREE.Line3(d1.start, d1.end);
      line0.closestPointToPoint(d1.start.clone().lerp(d1.end, 0.5), true, p0);
      line1.closestPointToPoint(p0, true, p1);
      line0.closestPointToPoint(p1, true, p0);
      a = p0;
      b = p1;
    }
    if (a && b) {
      _addDimSegment(target, a, b, fmt(a.distanceTo(b) * mmPerUnit), scale, color, dimOpts);
      if (d0 && d1 && !skipLabelSprites) {
        const dir0 = d0.end.clone().sub(d0.start).normalize();
        const dir1 = d1.end.clone().sub(d1.start).normalize();
        const ang = (Math.acos(Math.max(-1, Math.min(1, Math.abs(dir0.dot(dir1))))) * 180) / Math.PI;
        if (ang > 0.4 && ang < 89.6) {
          const sprite = _makeDimLabelSprite(`${ang.toFixed(1)}°`, scale, a.distanceTo(b));
          sprite.position.copy(a.clone().lerp(b, 0.5)).addScaledVector(new THREE.Vector3(0, 1, 0), scale * 2.4);
          target.add(sprite);
        }
      }
    }
    return;
  }

  if (refs.length >= 2) {
    const a = _toWorld(meshRoot, _refVec(refs[0]));
    const b = _toWorld(meshRoot, _refVec(refs[1]));
    if (a && b) _addDimSegment(target, a, b, fmt(a.distanceTo(b) * mmPerUnit), scale, color, dimOpts);
  }
  for (const r of refs) {
    if (r?.type !== "face") continue;
    const highlight = _faceHighlightFromRef(r, meshRoot, color);
    if (highlight) target.add(highlight);
  }
}

export function clearMeasureAnnotations() {
  _clearGroup(measureAnnotGroup);
}

/**
 * Draw persisted (saved) measurements into their own overlay group.
 * Each item is `{ refs: [...] }` using the same ref shape as live picks.
 */
function _meshByUuid(root, uuid) {
  if (!root || !uuid) return null;
  let found = null;
  root.traverse?.((child) => {
    if (!found && child?.uuid === uuid && child.isMesh) found = child;
  });
  return found;
}

function _faceHighlightFromRef(ref, meshRoot, color = 0x3fb950) {
  const indices = ref?.face_indices;
  if (!meshRoot || !Array.isArray(indices) || !indices.length) return null;
  const mesh = _meshByUuid(meshRoot, ref.mesh_uuid) || (meshRoot.isMesh ? meshRoot : null);
  if (mesh?.geometry) return buildFaceHighlightMesh(mesh, indices, color, 0.32);
  let first = null;
  meshRoot.traverse?.((child) => {
    if (!first && child?.isMesh && child.geometry) first = child;
  });
  return first ? buildFaceHighlightMesh(first, indices, color, 0.32) : null;
}

export function setSavedMeasureAnnotations(items, mmPerUnit, meshRoot, formatFn, formatAreaFn, opts = {}) {
  _clearGroup(savedMeasureGroup);
  if (!meshRoot || !items?.length) return;
  for (const item of items) {
    const refs = item?.refs || [];
    if (!refs.length) continue;
    const group = new THREE.Group();
    group.userData.measureId = item.id;
    group.userData.measureColor = item.color ?? 0x3fb950;
    savedMeasureGroup.add(group);
    setMeasureAnnotations(refs, mmPerUnit, meshRoot, formatFn, formatAreaFn, {
      clear: false,
      target: group,
      color: item.color ?? 0x3fb950,
      skipLabelSprites: true,
      camera: opts.camera,
    });
    copyMeasurePoseToGroup(group);
  }
}

function storedMeasureVec(group, key) {
  if (!group) return null;
  let stored = group.userData?.[key];
  if (!Array.isArray(stored) || stored.length < 3) {
    group.traverse((child) => {
      if (Array.isArray(child.userData?.[key]) && child.userData[key].length >= 3) {
        stored = child.userData[key];
      }
    });
  }
  if (!Array.isArray(stored) || stored.length < 3) return null;
  return [Number(stored[0]), Number(stored[1]), Number(stored[2])];
}

function copyMeasurePoseToGroup(group) {
  if (!group) return;
  const anchor = storedMeasureVec(group, "measureAnchor");
  const p1 = storedMeasureVec(group, "measureP1");
  const p2 = storedMeasureVec(group, "measureP2");
  if (anchor) group.userData.measureAnchor = anchor;
  if (p1) group.userData.measureP1 = p1;
  if (p2) group.userData.measureP2 = p2;
  if (!group.userData.measureAnchor && p1 && p2) {
    group.userData.measureAnchor = [
      (p1[0] + p2[0]) / 2,
      (p1[1] + p2[1]) / 2,
      (p1[2] + p2[2]) / 2,
    ];
  }
  if (!group.userData.measureAnchor) {
    const box = new THREE.Box3().setFromObject(group);
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3());
      group.userData.measureAnchor = [c.x, c.y, c.z];
    }
  }
}

export function savedMeasureWorldAnchor(id) {
  const group = savedMeasureGroup.children.find((child) => child.userData?.measureId === id);
  if (!group) return null;
  copyMeasurePoseToGroup(group);
  const stored = storedMeasureVec(group, "measureAnchor");
  if (stored) return stored;
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return null;
  const c = box.getCenter(new THREE.Vector3());
  return [c.x, c.y, c.z];
}

export function savedMeasureWorldEnds(id) {
  const group = savedMeasureGroup.children.find((child) => child.userData?.measureId === id);
  if (!group) return { p1: null, p2: null };
  copyMeasurePoseToGroup(group);
  return {
    p1: storedMeasureVec(group, "measureP1"),
    p2: storedMeasureVec(group, "measureP2"),
  };
}

export function pickMeasureIdFromGroup(rootGroup, event, { camera, domElement, meshRoot = null } = {}) {
  if (!rootGroup?.children?.length || !camera || !domElement) return null;
  const scale = meshRoot ? scaleForMesh(meshRoot) : 0.02;
  raycaster.setFromCamera(mouseNDC(event, domElement), camera);
  const prev = raycaster.params.Line.threshold;
  raycaster.params.Line.threshold = Math.max(scale * 3, 0.02);
  const hits = raycaster.intersectObject(rootGroup, true);
  raycaster.params.Line.threshold = prev;
  for (const hit of hits) {
    let obj = hit.object;
    while (obj) {
      if (obj.userData?.measureId) return obj.userData.measureId;
      obj = obj.parent;
    }
  }
  return null;
}

export function pickSavedMeasureId(event, { camera, domElement, meshRoot = null } = {}) {
  return pickMeasureIdFromGroup(savedMeasureGroup, event, { camera, domElement, meshRoot });
}

export function clearSavedMeasureAnnotations() {
  _clearGroup(savedMeasureGroup);
}

export function setSavedMeasureHover(id) {
  const hoverId = id || null;
  for (const group of savedMeasureGroup.children) {
    const on = group.userData.measureId === hoverId;
    const base = group.userData.measureColor || 0x3fb950;
    group.traverse((child) => {
      if (!child.material?.color) return;
      child.material.opacity = on ? 1 : 0.9;
      child.material.color.setHex(on ? 0x56d364 : base);
    });
  }
}

/**
 * Update the live preview line from `fromRef` (last picked point) to the
 * current mouse position in the scene. Call on pointermove when in measure mode.
 */
export function updateMeasureLivePreview(event, fromRef, camera, domElement, meshRoot, opts = {}) {
  _clearGroup(measureHoverGroup);
  if (!fromRef || !meshRoot) return;
  const from = _toWorld(meshRoot, _refVec(fromRef));
  if (!from) return;
  raycaster.setFromCamera(mouseNDC(event, domElement), camera);
  const hits = raycaster.intersectObjects(getMeshes(meshRoot), false);
  if (!hits.length) return;
  const to = hits[0].point;
  const scale = scaleForMesh(meshRoot);
  const mmPer = Number(opts.mmPerUnit);
  const fmt = opts.formatFn;
  let label = "";
  if (typeof fmt === "function" && Number.isFinite(mmPer)) {
    label = fmt(from.distanceTo(to) * mmPer);
  }
  _addDimSegment(measureHoverGroup, from, to, label || " ", scale, 0x9ecbff, {
    camera,
    skipLabelSprites: !label,
  });
}

export function clearMeasureLivePreview() {
  _clearGroup(measureHoverGroup);
}
