import * as THREE from "three";

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
    const pos = cornerPickPosition(hit, meshRoot, offset);
    const picked = [pos.x, pos.y, pos.z];
    return references.find((r) => r.type === "corner" && positionsClose(r.position, picked, tol)) || null;
  }

  if (mode === "edge") {
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

function showHoverFace(hit) {
  if (!hit.face) return;
  const group = collectCoplanarGroup(hit);
  const mesh = buildFaceHighlightMesh(hit.object, group, 0x58a6ff, 0.4);
  if (!mesh) return;
  mesh.renderOrder = 998;
  hoverGroup.add(mesh);
  hoverFace = mesh;
}

function showHoverCorner(localPoint, scale) {
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
}

function showHoverEdge(edge, scale, meshRoot, offset) {
  disposeGroup(hoverGroup);
  const marker = addEdgeMarker(edge, scale, meshRoot, offset, null, {
    label: true,
    opacity: 0.72,
    target: hoverGroup,
  });
  hoverEdge = marker;
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
  return hits[0] || null;
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
  lassoDraft = null;
  return { toggle: "add", ref };
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
    const hit = hits[0];
    const normal = faceNormal(hit);
    const world = hit.point.clone().addScaledVector(normal, (lineDraft?.scale || 0.01) * 0.12);
    const modelNormal = worldDirectionToModel(normal, meshRoot);
    return { world, model: worldToModel(world, meshRoot, offset), normal: modelNormal, onSurface: true };
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
  const dot = addLineDot(p.world, lineDraft.scale);
  lineDraft.group.add(dot);
  lineDraft.dots.push(dot);
  updatePathLine(lineDraft);
  return { count: lineDraft.worldPoints.length };
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
  lineDraft = null;
  return { toggle: "add", ref };
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

export function updateHover(event, { camera, domElement, meshRoot, meshCenterOffset }) {
  if (pickMode === "off" || pickMode === "lasso" || !meshRoot) {
    clearHover();
    return;
  }
  const hits = raycast(event, camera, domElement, meshRoot);
  clearHover();
  if (!hits.length) return;

  const hit = hits[0];
  const offset = meshCenterOffset || new THREE.Vector3();
  const scale = scaleForMesh(meshRoot);

  if (pickMode === "face") {
    showHoverFace(hit);
  } else if (pickMode === "object") {
    showHoverObject(hit.object);
  } else if (pickMode === "corner") {
    const modelPos = worldToModel(hit.point, meshRoot, offset);
    const corner = nearestBBoxCorner(meshRoot, modelPos, offset);
    const local = modelToLocal(corner.position, meshRoot, offset);
    showHoverCorner(local, scale);
  } else if (pickMode === "edge") {
    const edge = nearestEdge(hit, meshRoot, offset);
    if (edge) showHoverEdge(edge, scale, meshRoot, offset);
  }
}

export function pickGeometry(event, { camera, domElement, meshRoot, meshCenterOffset, references = [] }) {
  if (pickMode === "off" || !meshRoot) return null;

  const hits = raycast(event, camera, domElement, meshRoot);
  if (!hits.length) return null;

  const hit = hits[0];
  const offset = meshCenterOffset || new THREE.Vector3();
  const scale = scaleForMesh(meshRoot);

  const existing = findMatchingReference(references, hit, pickMode, meshRoot, offset);
  if (existing) {
    removeReferenceMarker(existing.id);
    return { toggle: "remove", ref: existing };
  }

  refCounter += 1;
  let type = pickMode;
  let position;
  let normal;
  let localPoint;
  let planarKey = null;
  let faceGroup = null;

  if (pickMode === "face") {
    faceGroup = collectCoplanarGroup(hit);
    position = groupCentroidModel(hit, faceGroup, meshRoot, offset);
    normal = faceNormal(hit);
    localPoint = modelToLocal(position, meshRoot, offset);
    planarKey = planarFaceKey(hit.object, faceGroup, position);
    hit._groupArea = computeGroupArea(hit.object, faceGroup);
  } else if (pickMode === "corner") {
    const modelPos = worldToModel(hit.point, meshRoot, offset);
    const vtx = nearestVertex(hit, meshRoot, offset);
    const corner = nearestBBoxCorner(meshRoot, modelPos, offset);
    const useVtx = vtx && vtx.distanceTo(modelPos) < corner.distance;
    position = useVtx ? vtx : corner.position;
    normal = corner.normal;
    localPoint = modelToLocal(position, meshRoot, offset);
  } else if (pickMode === "edge") {
    const edge = nearestEdge(hit, meshRoot, offset);
    if (!edge) return null;
    position = edge.position;
    normal = new THREE.Vector3(...edge.normal);
    localPoint = edge.localPoint;
    hit._edgePick = edge;
  } else {
    return null;
  }

  const id = `${type}-${refCounter}`;
  const edgePick = hit._edgePick;
  const ref = {
    id,
    type,
    position: [position.x, position.y, position.z],
    normal: [normal.x, normal.y, normal.z],
    face_index: pickMode === "face" ? (faceGroup?.[0] ?? hit.faceIndex ?? null) : (hit.faceIndex ?? null),
    face_indices: pickMode === "face" ? faceGroup : null,
    face_key: pickMode === "face" ? facePickKey(hit) : null,
    planar_key: pickMode === "face" ? planarKey : null,
    mesh_uuid: pickMode === "face" ? hit.object.uuid : null,
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

  if (pickMode === "face" && faceGroup?.length) {
    const highlight = buildFaceHighlightMesh(hit.object, faceGroup, 0x58a6ff, 0.5);
    if (highlight) {
      const markerGroup = new THREE.Group();
      markerGroup.userData.refId = id;
      highlight.userData.refId = id;
      markerGroup.add(highlight);
      markerGroup.add(addFaceLabel(localPoint, normal, scale, id, meshRoot));
      markersGroup.add(markerGroup);
      markerByRefId.set(id, markerGroup);
    }
  } else if (pickMode === "edge" && edgePick) {
    addEdgeMarker(edgePick, scale, meshRoot, offset, id, { label: true });
  } else {
    addMarker(
      localPoint,
      type === "edge" ? 0x58a6ff : 0xff7b72,
      scale,
      type === "corner" ? "box" : "sphere",
      id,
      meshRoot
    );
  }
  return { toggle: "add", ref };
}

function showHoverObject(mesh) {
  clearHover();
  if (!mesh?.isMesh) return;
  const box = new THREE.BoxHelper(mesh, 0x58a6ff);
  box.userData.isHover = true;
  hoverGroup.add(box);
}

/** Raycast pick for object/body selection (Fusion-style select tool). */
export function pickObject(event, { camera, domElement, meshRoot }) {
  if (!meshRoot) return null;
  const hits = raycast(event, camera, domElement, meshRoot);
  if (!hits.length) return null;
  const hit = hits[0];
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

/** Fusion-style measure pick: auto-detect vertex, edge, or face under the cursor. */
export function pickMeasureEntity(event, { camera, domElement, meshRoot, meshCenterOffset }) {
  if (!meshRoot) return null;
  const hits = raycast(event, camera, domElement, meshRoot);
  if (!hits.length) return null;

  const hit = hits[0];
  const offset = meshCenterOffset || new THREE.Vector3();
  const scale = scaleForMesh(meshRoot);
  const clickModel = worldToModel(hit.point, meshRoot, offset);
  const vtx = nearestVertex(hit, meshRoot, offset);
  const edge = nearestEdge(hit, meshRoot, offset);
  const vtxDist = vtx ? vtx.distanceTo(clickModel) : Infinity;
  const edgeDist = edge?.pick_distance ?? Infinity;
  const pickTol = scale * 4;

  if (vtx && vtxDist < pickTol * 0.45) {
    return {
      type: "vertex",
      position: vtx.clone(),
      normal: faceNormal(hit),
      vertex: vtx.clone(),
      edge: null,
      face: null,
    };
  }

  if (edge && edgeDist < pickTol) {
    const dir = edge.direction || new THREE.Vector3(...(edge.normal || [0, 1, 0]));
    return {
      type: "edge",
      position: edge.edge_mid.clone(),
      normal: dir.clone(),
      vertex: null,
      edge: {
        start: edge.edge_start.clone(),
        end: edge.edge_end.clone(),
        length: edge.edge_length,
        direction: dir.clone(),
      },
      face: null,
    };
  }

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

export function updateMeasureHover(event, { camera, domElement, meshRoot, meshCenterOffset, onPreview }) {
  if (!meshRoot) {
    clearHover();
    return null;
  }
  const entity = pickMeasureEntity(event, { camera, domElement, meshRoot, meshCenterOffset });
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
  if (!Array.isArray(ref?.position) || ref.position.length < 3) return null;
  return new THREE.Vector3(ref.position[0], ref.position[1], ref.position[2]);
}

function _disposeMesh(m) {
  m.geometry?.dispose();
  if (m.material) {
    m.material.map?.dispose();
    m.material.dispose();
  }
}

function _clearGroup(g) {
  const kids = [...g.children];
  for (const k of kids) {
    _disposeMesh(k);
    g.remove(k);
  }
}

function _makeDimLabelSprite(text, scale) {
  const W = 320, H = 96;
  const pixelScale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * pixelScale;
  canvas.height = H * pixelScale;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(pixelScale, pixelScale);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(9, 18, 32, 0.92)";
    roundedRect(ctx, 5, 5, W - 10, H - 10, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(88, 166, 255, 0.96)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#dbeafe";
    ctx.font = "800 34px 'Segoe UI', system-ui, sans-serif";
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
  // Scale sprite to sit nicely in model space; bias slightly above the midpoint
  const sw = (W / 1024) * scale * 34;
  const sh = (H / 1024) * scale * 34;
  sprite.scale.set(sw, sh, 1);
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

function _addDimSegment(group, a, b, label, scale, color = 0x58a6ff) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const mat = new THREE.LineDashedMaterial({
    color,
    dashSize: scale * 4,
    gapSize: scale * 2,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  line.renderOrder = 999;
  group.add(line);
  const mid = a.clone().lerp(b, 0.5);
  const up = new THREE.Vector3(0, 1, 0);
  const perp = new THREE.Vector3().crossVectors(b.clone().sub(a), up).normalize();
  if (perp.lengthSq() < 0.001) perp.set(1, 0, 0);
  const sprite = _makeDimLabelSprite(label, scale);
  sprite.position.copy(mid).addScaledVector(perp, scale * 3);
  group.add(sprite);
}

function _edgeEndpoints(ref) {
  if (Array.isArray(ref?.edge_start) && Array.isArray(ref?.edge_end) && ref.edge_start.length >= 3 && ref.edge_end.length >= 3) {
    return {
      start: new THREE.Vector3(...ref.edge_start),
      end: new THREE.Vector3(...ref.edge_end),
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

  if (refs.length === 1) {
    const r = refs[0];
    if (r.type === "edge") {
      const ends = _edgeEndpoints(r);
      const a = ends?.start || _refVec(r);
      const b = ends?.end;
      const lenModel = Number.isFinite(r.edge_length)
        ? r.edge_length
        : ends
          ? ends.start.distanceTo(ends.end)
          : null;
      if (a && b && Number.isFinite(lenModel)) {
        _addDimSegment(target, a, b, fmt(lenModel * mmPerUnit), scale, color);
      } else if (a && Number.isFinite(lenModel)) {
        const sprite = _makeDimLabelSprite(fmt(lenModel * mmPerUnit), scale);
        sprite.position.copy(a);
        target.add(sprite);
      }
      return;
    }
    if (r.type === "face" && Number.isFinite(r.face_area)) {
      const p = _refVec(r);
      if (!p) return;
      const areaMm2 = r.face_area * mmPerUnit * mmPerUnit;
      const sprite = _makeDimLabelSprite(fmtArea(areaMm2), scale);
      const n = Array.isArray(r.normal) ? new THREE.Vector3(...r.normal).normalize() : new THREE.Vector3(0, 0, 1);
      sprite.position.copy(p).addScaledVector(n, scale * 4);
      target.add(sprite);
      target.add(_makeEndcap(p, scale, color));
      return;
    }
    if (r.type === "corner" || r.type === "vertex") {
      const p = _refVec(r);
      if (!p) return;
      const label = `X ${fmt(p.x * mmPerUnit)}  Y ${fmt(p.y * mmPerUnit)}  Z ${fmt(p.z * mmPerUnit)}`;
      const sprite = _makeDimLabelSprite(label, scale * 1.15);
      sprite.position.copy(p).add(new THREE.Vector3(0, 0, scale * 4));
      target.add(sprite);
      target.add(_makeEndcap(p, scale, color));
    }
    return;
  }

  if (refs.length === 2 && refs[0].type === "edge" && refs[1].type === "edge") {
    for (const r of refs) {
      const ends = _edgeEndpoints(r);
      if (!ends) continue;
      const lenModel = Number.isFinite(r.edge_length) ? r.edge_length : ends.start.distanceTo(ends.end);
      _addDimSegment(target, ends.start, ends.end, fmt(lenModel * mmPerUnit), scale, 0x58a6ff);
    }
    const a = _refVec(refs[0]);
    const b = _refVec(refs[1]);
    if (a && b) {
      _addDimSegment(target, a, b, fmt(a.distanceTo(b) * mmPerUnit), scale, color);
      const d0 = _edgeEndpoints(refs[0]);
      const d1 = _edgeEndpoints(refs[1]);
      if (d0 && d1) {
        const dir0 = d0.end.clone().sub(d0.start).normalize();
        const dir1 = d1.end.clone().sub(d1.start).normalize();
        const ang = (Math.acos(Math.max(-1, Math.min(1, Math.abs(dir0.dot(dir1))))) * 180) / Math.PI;
        const mid = a.clone().lerp(b, 0.5);
        const sprite = _makeDimLabelSprite(`${ang.toFixed(1)}°`, scale);
        sprite.position.copy(mid).add(new THREE.Vector3(0, 0, scale * 5));
        target.add(sprite);
      }
    }
    return;
  }

  const pairs = [];
  if (refs.length === 2) {
    pairs.push([0, 1]);
  } else {
    for (let i = 0; i < refs.length - 1; i++) pairs.push([i, i + 1]);
    if (refs.length >= 3) pairs.push([0, refs.length - 1]);
  }

  for (const [i, j] of pairs) {
    const a = _refVec(refs[i]);
    const b = _refVec(refs[j]);
    if (!a || !b) continue;
    _addDimSegment(target, a, b, fmt(a.distanceTo(b) * mmPerUnit), scale, color);
  }
}

export function clearMeasureAnnotations() {
  _clearGroup(measureAnnotGroup);
}

/**
 * Draw persisted (saved) measurements into their own overlay group.
 * Each item is `{ refs: [...] }` using the same ref shape as live picks.
 */
export function setSavedMeasureAnnotations(items, mmPerUnit, meshRoot, formatFn, formatAreaFn) {
  _clearGroup(savedMeasureGroup);
  if (!meshRoot || !items?.length) return;
  for (const item of items) {
    const refs = item?.refs || [];
    if (!refs.length) continue;
    setMeasureAnnotations(refs, mmPerUnit, meshRoot, formatFn, formatAreaFn, {
      clear: false,
      target: savedMeasureGroup,
      color: item.color ?? 0x3fb950,
    });
  }
}

export function clearSavedMeasureAnnotations() {
  _clearGroup(savedMeasureGroup);
}

/**
 * Update the live preview line from `fromRef` (last picked point) to the
 * current mouse position in the scene. Call on pointermove when in measure mode.
 */
export function updateMeasureLivePreview(event, fromRef, camera, domElement, meshRoot) {
  _clearGroup(measureHoverGroup);
  if (!fromRef || !meshRoot) return;
  const from = _refVec(fromRef);
  if (!from) return;
  raycaster.setFromCamera(mouseNDC(event, domElement), camera);
  const hits = raycaster.intersectObjects(getMeshes(meshRoot), false);
  if (!hits.length) return;
  const to = hits[0].point;
  const scale = scaleForMesh(meshRoot);

  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineDashedMaterial({
    color: 0xffffff,
    dashSize: scale * 2.5,
    gapSize: scale * 1.2,
    depthTest: false,
    transparent: true,
    opacity: 0.5,
  });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  line.renderOrder = 998;
  measureHoverGroup.add(line);
}

export function clearMeasureLivePreview() {
  _clearGroup(measureHoverGroup);
}
