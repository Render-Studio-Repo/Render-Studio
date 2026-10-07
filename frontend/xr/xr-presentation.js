import * as THREE from "three";

export function configurePromptTexture(texture, maxAnisotropy = 1) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = Math.max(1, Math.min(8, maxAnisotropy));
  texture.needsUpdate = true;
  return texture;
}

// Aggregate each loaded part's cached bounds, including parts beyond the XR
// render budget. Only uncached branches need a geometry walk, at placement time.
export function cachePresentationBounds(root) {
  const bounds = new THREE.Box3();
  const scratch = new THREE.Box3();
  function visit(node, transform, useCache) {
    if (node.name === "xrModelMarker" || node.userData?.xrIgnoreBounds
      || node.userData?.isEdge || node.userData?.isSilhouette || node.userData?.isObjectHighlight) return;
    const cached = useCache && node.userData?._xrLocalBox;
    if (cached && [...cached.min, ...cached.max].every(Number.isFinite)) {
      scratch.min.fromArray(cached.min);
      scratch.max.fromArray(cached.max);
      bounds.union(scratch.applyMatrix4(transform));
      return;
    }
    if (node.isMesh && node.geometry) {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      if (node.geometry.boundingBox) bounds.union(scratch.copy(node.geometry.boundingBox).applyMatrix4(transform));
    }
    for (const child of node.children || []) {
      if (child.matrixAutoUpdate) child.updateMatrix();
      visit(child, new THREE.Matrix4().multiplyMatrices(transform, child.matrix), true);
    }
  }
  visit(root, new THREE.Matrix4(), false);
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) return false;
  root.userData._xrLocalBox = { min: bounds.min.toArray(), max: bounds.max.toArray() };
  return true;
}
