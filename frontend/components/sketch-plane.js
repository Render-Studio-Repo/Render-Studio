/** Sketch work-plane helpers — standard axes (XY/XZ/YZ) and arbitrary face planes. */

import * as THREE from "three";

export function vec3(arr) {
  const a = arr || [0, 0, 0];
  return new THREE.Vector3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
}

export function vec3ToArray(v) {
  return [v.x, v.y, v.z];
}

export function standardPlaneSpec(name = "XY") {
  const label = String(name || "XY").toUpperCase();
  if (label === "XZ") {
    return {
      kind: "standard",
      label: "XZ",
      origin: [0, 0, 0],
      u_axis: [1, 0, 0],
      v_axis: [0, 0, 1],
      normal: [0, 1, 0],
    };
  }
  if (label === "YZ") {
    return {
      kind: "standard",
      label: "YZ",
      origin: [0, 0, 0],
      u_axis: [0, 1, 0],
      v_axis: [0, 0, 1],
      normal: [1, 0, 0],
    };
  }
  return {
    kind: "standard",
    label: "XY",
    origin: [0, 0, 0],
    u_axis: [1, 0, 0],
    v_axis: [0, 1, 0],
    normal: [0, 0, 1],
  };
}

export function normalizePlaneRef(ref) {
  if (!ref || !Array.isArray(ref.origin)) return standardPlaneSpec("XY");
  let u = vec3(ref.u_axis);
  let v = vec3(ref.v_axis);
  let n = vec3(ref.normal);
  if (u.lengthSq() < 1e-8) u.set(1, 0, 0);
  if (n.lengthSq() < 1e-8) n.set(0, 0, 1);
  u.normalize();
  n.normalize();
  v.copy(new THREE.Vector3().crossVectors(n, u));
  if (v.lengthSq() < 1e-8) {
    v.set(0, 1, 0);
    u.copy(new THREE.Vector3().crossVectors(v, n)).normalize();
    v.copy(new THREE.Vector3().crossVectors(n, u)).normalize();
  } else {
    v.normalize();
    u.copy(new THREE.Vector3().crossVectors(v, n)).normalize();
  }
  return {
    kind: ref.kind || "face",
    label: ref.label || "Face",
    origin: ref.origin.map(Number),
    u_axis: vec3ToArray(u),
    v_axis: vec3ToArray(v),
    normal: vec3ToArray(n),
    face: ref.face || null,
  };
}

export function planeSpecFromData(data) {
  if (data?.plane_ref) return normalizePlaneRef(data.plane_ref);
  return standardPlaneSpec(data?.plane || "XY");
}

export function planeSpecToRef(spec) {
  if (!spec || spec.kind === "standard") return null;
  return {
    kind: spec.kind || "face",
    label: spec.label || "Face",
    origin: [...spec.origin],
    u_axis: [...spec.u_axis],
    v_axis: [...spec.v_axis],
    normal: [...spec.normal],
    face: spec.face || null,
  };
}

export function planeAxes(spec) {
  return { u: vec3(spec.u_axis), v: vec3(spec.v_axis) };
}

export function planeNormal(spec) {
  return vec3(spec.normal);
}

export function fromUV(spec, u, v) {
  const o = vec3(spec.origin);
  const ax = planeAxes(spec);
  return o.clone().add(ax.u.clone().multiplyScalar(u)).add(ax.v.clone().multiplyScalar(v));
}

export function toUV(spec, point) {
  const p = point.clone().sub(vec3(spec.origin));
  const ax = planeAxes(spec);
  return { u: p.dot(ax.u), v: p.dot(ax.v) };
}

export function applyPlaneBasis(object, spec) {
  const u = vec3(spec.u_axis);
  const v = vec3(spec.v_axis);
  const n = vec3(spec.normal);
  const o = vec3(spec.origin);
  const m = new THREE.Matrix4().makeBasis(u, v, n);
  m.setPosition(o);
  object.matrix.copy(m);
  object.matrixAutoUpdate = false;
}

export function orientObjectToPlane(object, spec, { offsetNormal = 0 } = {}) {
  const u = vec3(spec.u_axis);
  const v = vec3(spec.v_axis);
  const n = vec3(spec.normal);
  const o = vec3(spec.origin);
  if (offsetNormal) o.add(n.clone().multiplyScalar(offsetNormal));
  object.position.copy(o);
  object.setRotationFromMatrix(new THREE.Matrix4().makeBasis(u, v, n));
}

/** Build a sketch plane from a raycast hit on a mesh face. */
export function computeFacePlaneRef(hit, camera) {
  const mesh = hit.object;
  let normal = new THREE.Vector3();
  if (hit.face?.normal) {
    normal.copy(hit.face.normal);
    normal.transformDirection(mesh.matrixWorld).normalize();
  } else {
    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    const fi = hit.faceIndex;
    const idx = geom.index;
    const ia = idx ? idx.getX(fi * 3) : fi * 3;
    const ib = idx ? idx.getX(fi * 3 + 1) : fi * 3 + 1;
    const ic = idx ? idx.getX(fi * 3 + 2) : fi * 3 + 2;
    const vA = new THREE.Vector3().fromBufferAttribute(pos, ia);
    const vB = new THREE.Vector3().fromBufferAttribute(pos, ib);
    const vC = new THREE.Vector3().fromBufferAttribute(pos, ic);
    normal.crossVectors(vB.clone().sub(vA), vC.clone().sub(vA)).normalize();
    normal.transformDirection(mesh.matrixWorld).normalize();
  }

  const origin = hit.point.clone();
  const toCam = camera.position.clone().sub(origin);
  if (normal.dot(toCam) < 0) normal.negate();

  let u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(normal.dot(u)) > 0.9) u.set(0, 1, 0);
  u.sub(normal.clone().multiplyScalar(normal.dot(u))).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();

  return normalizePlaneRef({
    kind: "face",
    label: "Face",
    origin: vec3ToArray(origin),
    u_axis: vec3ToArray(u),
    v_axis: vec3ToArray(v),
    normal: vec3ToArray(normal),
    face: {
      face_index: hit.faceIndex ?? null,
      catalog_filename: mesh.userData?.catalogFilename || null,
    },
  });
}

export function profileWorldData(profile, sketchData) {
  const spec = planeSpecFromData(
    typeof sketchData === "string" ? { plane: sketchData } : sketchData || { plane: "XY" }
  );
  const verts = profile.map(([u, v]) => fromUV(spec, u, v));
  const tris = [];
  for (let i = 1; i < verts.length - 1; i++) tris.push([0, i, i + 1]);
  const boundary = verts.map((_, i) => [i, (i + 1) % verts.length]);
  const centroid = verts.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / verts.length);
  let normal = planeNormal(spec).clone();
  return { verts, tris, boundary, normal, centroid, scale: 1, plane_spec: spec };
}
