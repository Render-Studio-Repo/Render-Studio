/** Narrow the HUD's world AABB fallback to its actual oriented surface. */
export function createUiSurfaceRayPicker(THREE) {
  const inverse = new THREE.Matrix4(), ray = new THREE.Ray(), bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  return (mesh, origin, direction, maxDistance = 3.2) => {
    if (!mesh?.geometry) return null;
    for (let node = mesh; node; node = node.parent) if (node.visible === false) return null;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return null;
    mesh.updateWorldMatrix(true, false);
    inverse.copy(mesh.matrixWorld).invert();
    ray.set(origin, direction).applyMatrix4(inverse);
    bounds.copy(geometry.boundingBox);
    if (bounds.max.z - bounds.min.z < .002) { bounds.min.z -= .001; bounds.max.z += .001; }
    if (!ray.intersectBox(bounds, point)) return null;
    point.applyMatrix4(mesh.matrixWorld);
    const distance = point.distanceTo(origin);
    return distance <= maxDistance ? {point:point.clone(), distance} : null;
  };
}
