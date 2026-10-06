/** Fresh GLTF parses own their resources; don't clone a material per CAD face. */
const sharedMaterials = new WeakSet();
const measuredGeometry = new WeakMap();

/** Recheck bounds after geometry edits, not after every camera/scene transform. */
export function loadedGeometryBounds(geometry) {
  if (!geometry?.computeBoundingBox) return geometry?.boundingBox || null;
  const position = geometry.getAttribute?.('position');
  const version = position?.version ?? position?.data?.version ?? 0;
  const previous = measuredGeometry.get(geometry);
  if (!geometry.boundingBox || !previous || previous.position !== position || previous.version !== version) {
    geometry.computeBoundingBox();
    measuredGeometry.set(geometry, {position, version});
  }
  return geometry.boundingBox;
}

export function prepareLoadedMeshResources(root) {
  const seenMaterials = new Set();
  const seenGeometry = new Set();
  root?.traverse?.((mesh) => {
    if (!mesh.isMesh) return;
    // Geometry edits are per mesh. Only detach actual geometry aliases; most
    // CAD faces already have their own buffers. Skinned geometry keeps its bind.
    if (mesh.geometry && !mesh.isSkinnedMesh) {
      if (seenGeometry.has(mesh.geometry)) mesh.geometry = mesh.geometry.clone();
      else seenGeometry.add(mesh.geometry);
      const position = mesh.geometry.getAttribute?.('position') || mesh.geometry.attributes?.position;
      const normal = mesh.geometry.getAttribute?.('normal') || mesh.geometry.attributes?.normal;
      if (position?.count > 0 && !normal?.count) {
        mesh.geometry.computeVertexNormals?.();
        mesh.geometry.normalizeNormals?.();
      }
    }
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      if (!material) continue;
      if (seenMaterials.has(material)) sharedMaterials.add(material);
      else seenMaterials.add(material);
    }
  });
  return root;
}

/** Isolate only the mesh being tinted or made transparent, at interaction time. */
export function ownMeshMaterials(mesh) {
  if (!mesh?.material) return;
  const copies = new Map();
  const own = (material) => {
    if (!material || !sharedMaterials.has(material) || !material.clone) return material;
    if (!copies.has(material)) copies.set(material, material.clone());
    return copies.get(material);
  };
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
}
