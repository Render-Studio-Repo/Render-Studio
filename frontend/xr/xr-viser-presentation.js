import { isViserSceneFurnitureName } from './xr-viser-grip.js?v=20260916-visergrip1&robot-size=20260927-1&vrrobot=20260927-2';

export function normalizeViserPresentation(THREE, content) {
  const bounds = new THREE.Box3();
  const scratch = new THREE.Box3();
  function visit(node, transform) {
    if (node.visible === false || node.userData.xrIgnoreBounds || node.userData.viserHelper
      || node.userData.viserTarget || isViserSceneFurnitureName(node.name)) return;
    if (node.isMesh && node.userData.viserGeometry && node.geometry) {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      if (node.geometry.boundingBox) bounds.union(scratch.copy(node.geometry.boundingBox).applyMatrix4(transform));
    }
    for (const child of node.children) {
      if (child.matrixAutoUpdate) child.updateMatrix();
      visit(child, new THREE.Matrix4().multiplyMatrices(transform, child.matrix));
    }
  }
  for (const child of content.children) {
    if (child.matrixAutoUpdate) child.updateMatrix();
    visit(child, child.matrix);
  }
  if (bounds.isEmpty()) return false;
  const size = bounds.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(extent) || extent <= 0) return false;
  content.scale.setScalar(1 / extent);
  return true;
}
