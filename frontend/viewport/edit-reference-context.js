import * as THREE from "three";

// Capture file-space placement before viewport centering/orientation changes.
export function captureSourceFrames(root) {
  if (!root) return;
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry || mesh.userData.editSourceFrame) return;
    mesh.geometry.computeBoundingBox();
    mesh.userData.editSourceFrame = {
      matrix: inverse.clone().multiply(mesh.matrixWorld).toArray(),
      geometryCenter: mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).toArray(),
    };
  });
  if (!root.userData.editSourceBounds) {
    const bounds = new THREE.Box3();
    root.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.userData.editSourceFrame) return;
      bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().fromArray(mesh.userData.editSourceFrame.matrix)));
    });
    if (!bounds.isEmpty()) root.userData.editSourceBounds = { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new THREE.Vector3()).toArray() };
  }
}

function meshSourceToWorld(mesh) {
  const source = mesh?.userData?.editSourceFrame;
  if (!source || !mesh.geometry) return null;
  mesh.updateWorldMatrix(true, false);
  mesh.geometry.computeBoundingBox();
  const delta = mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).sub(new THREE.Vector3().fromArray(source.geometryCenter));
  return mesh.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z))
    .multiply(new THREE.Matrix4().fromArray(source.matrix).invert());
}

export function captureMaterializedSourceFrame(root) {
  root.updateWorldMatrix(true, true);
  let sourceToWorld = null;
  root.traverse(mesh => { if (!sourceToWorld && mesh.isMesh) sourceToWorld = meshSourceToWorld(mesh); });
  if (sourceToWorld) root.userData.editSourceToRoot = root.matrixWorld.clone().invert().multiply(sourceToWorld).toArray();
}

export function modelGeometryContext(root) {
  if (!root) return null;
  root.updateWorldMatrix(true, true);
  const frame = root.userData.editSourceToRoot;
  let sourceToWorld = frame ? root.matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(frame)) : null;
  if (!sourceToWorld) root.traverse((mesh) => { if (!sourceToWorld && mesh.isMesh) sourceToWorld = meshSourceToWorld(mesh); });
  return {
    version: 2, matrix_layout: "column-major",
    model_to_world: root.matrixWorld.toArray(),
    ...(sourceToWorld ? { source_to_world: sourceToWorld.toArray() } : {}),
    ...(root.userData.editSourceBounds ? { source_bounds: root.userData.editSourceBounds } : {}),
    coordinate_note: "Source bounds/points use file-native units, not viewport size. Verify STEP units and mesh correspondence. Never normalize CAD to a hand-size, unit cube, or printer envelope.",
  };
}

// Preserve source coordinates, including the old pivot correction, rather than
// copying a bounds-centered pivot that changes when an extension grows the model.
export function captureEditPlacement(root, assemblyRoot) {
  const context = modelGeometryContext(root);
  if (!context?.source_to_world) return null;
  assemblyRoot?.updateWorldMatrix(true, false);
  const parentInverse = assemblyRoot ? assemblyRoot.matrixWorld.clone().invert() : new THREE.Matrix4();
  return parentInverse.multiply(new THREE.Matrix4().fromArray(context.source_to_world)).toArray();
}

export function applyEditPlacement(root, matrix) {
  root.matrix.fromArray(matrix);
  root.matrix.decompose(root.position, root.quaternion, root.scale);
  root.matrixAutoUpdate = true;
  root.updateMatrixWorld(true);
}

export function selectionGeometryContext(selection) {
  const { mesh, root, faceIndex } = selection || {};
  const geometry = mesh?.geometry;
  const positions = geometry?.attributes?.position;
  const index = geometry?.index;
  const offset = faceIndex * 3;
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || !positions || offset + 2 >= (index?.count ?? positions.count)) return modelGeometryContext(root);
  const points = [0, 1, 2].map(i => new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(offset + i) : offset + i));
  const center = points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3);
  const normal = new THREE.Triangle(...points).getNormal(new THREE.Vector3());
  return { ...surfaceEditContext({ object: mesh, point: mesh.localToWorld(center), faceIndex, face: { normal } }, root), point_kind: "selected_triangle_centroid" };
}

export function surfaceEditContext(hit, root) {
  if (!hit?.object || !hit?.point || !root) return null;
  const mesh = hit.object;
  root.updateWorldMatrix(true, true);
  const local = mesh.worldToLocal(hit.point.clone());
  const context = {
    ...modelGeometryContext(root),
    matrix_layout: "column-major",
    point_world: hit.point.toArray(),
    point_mesh_local: local.toArray(),
    mesh_to_world: mesh.matrixWorld.toArray(),
    model_to_world: root.matrixWorld.toArray(),
    mesh_name: mesh.name || "",
    mesh_uuid: mesh.uuid,
    triangle_index: hit.faceIndex ?? null,
    coordinate_note: "World coordinates include viewport placement. Mesh-local coordinates are not STEP coordinates. Source units must be verified from the referenced file.",
  };
  const source = mesh.userData.editSourceFrame;
  if (source) {
    mesh.geometry.computeBoundingBox();
    const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
    // Pivot normalization translates geometry; undo that translation in the pick.
    const sourceLocal = local.clone().sub(center).add(new THREE.Vector3().fromArray(source.geometryCenter));
    context.point_source = sourceLocal.applyMatrix4(new THREE.Matrix4().fromArray(source.matrix)).toArray();
    context.mesh_to_source = [...source.matrix];
    if (hit.face?.normal) context.normal_source = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(new THREE.Matrix4().fromArray(source.matrix))).toArray();
  }
  return context;
}

export function sameModelLineage(a, b) {
  const stem = value => String(value || "").replace(/\.[^.\/]+$/, "").replace(/_edited(?:_\d+)?$/i, "").toLowerCase();
  return !!a && !!b && stem(a) === stem(b);
}
