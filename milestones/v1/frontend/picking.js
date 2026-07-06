import * as THREE from "three";

const raycaster = new THREE.Raycaster();
raycaster.params.Line = { threshold: 0.008 };
raycaster.params.Points = { threshold: 0.015 };

let refCounter = 0;
let pickMode = "off"; // off | corner | face | edge

const markersGroup = new THREE.Group();
markersGroup.name = "ref-markers";

const hoverGroup = new THREE.Group();
hoverGroup.name = "hover-preview";

let hoverFace = null;
let hoverCorner = null;
let hoverEdge = null;

/** @type {Map<string, THREE.Object3D>} */
const markerByRefId = new Map();

export function removeReferenceMarker(refId) {
  const marker = markerByRefId.get(refId);
  if (!marker) return;
  marker.geometry?.dispose();
  marker.material?.dispose();
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
    c.geometry?.dispose();
    c.material?.dispose();
    g.remove(c);
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
      best = {
        position: worldToModel(closest, meshRoot, offset),
        localPoint: meshRoot.worldToLocal(closest.clone()),
        normal: [dir.x, dir.y, dir.z],
        edge_mid: worldToModel(mid, meshRoot, offset),
      };
    }
  }
  return best;
}

function scaleForMesh(meshRoot) {
  const box = new THREE.Box3().setFromObject(meshRoot);
  return Math.max(box.getSize(new THREE.Vector3()).length() * 0.012, 0.003);
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

function showHoverEdge(localPoint, scale) {
  disposeGroup(hoverGroup);
  const m = addMarker(localPoint, 0xd29922, scale * 1.2, "sphere");
  hoverGroup.add(m);
  hoverEdge = m;
}

export function updateHover(event, { camera, domElement, meshRoot, meshCenterOffset }) {
  if (pickMode === "off" || !meshRoot) {
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
  } else if (pickMode === "corner") {
    const modelPos = worldToModel(hit.point, meshRoot, offset);
    const corner = nearestBBoxCorner(meshRoot, modelPos, offset);
    const local = modelToLocal(corner.position, meshRoot, offset);
    showHoverCorner(local, scale);
  } else if (pickMode === "edge") {
    const edge = nearestEdge(hit, meshRoot, offset);
    if (edge) showHoverEdge(edge.localPoint, scale);
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
  } else {
    return null;
  }

  const id = `${type}-${refCounter}`;
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
    label: formatRefLabel(type, [position.x, position.y, position.z]),
    token: `@${id}`,
    localPoint,
    local_point: [localPoint.x, localPoint.y, localPoint.z],
  };

  if (pickMode === "face" && faceGroup?.length) {
    const highlight = buildFaceHighlightMesh(hit.object, faceGroup, 0x58a6ff, 0.5);
    if (highlight) {
      highlight.userData.refId = id;
      markersGroup.add(highlight);
      markerByRefId.set(id, highlight);
    }
  } else {
    addMarker(
      localPoint,
      type === "edge" ? 0xd29922 : 0xff7b72,
      scale,
      type === "corner" ? "box" : "sphere",
      id,
      meshRoot
    );
  }
  return { toggle: "add", ref };
}

export function formatRefLabel(type, pos) {
  const p = pos.map((v) => (v * 1000).toFixed(1) + "mm").join(", ");
  return `${type} · (${p})`;
}
