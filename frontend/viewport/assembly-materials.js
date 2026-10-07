/** Match stable leaf names across assembled/exploded exports, never traversal order. */
export function captureAssemblyMaterials(root) {
  const materials = new Map();
  const duplicate = new Set();
  root?.traverse?.((mesh) => {
    if (!mesh.isMesh || !mesh.name || mesh.userData?.isSilhouette || mesh.userData?.isEdge) return;
    if (materials.has(mesh.name)) {
      duplicate.add(mesh.name);
      for (const m of materials.get(mesh.name)) m?.dispose?.();
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.set(mesh.name, mats.map((m) => m?.clone?.() || null));
  });
  for (const name of duplicate) {
    for (const m of materials.get(name)) m?.dispose?.();
    materials.delete(name);
  }
  return materials;
}

export function restoreAssemblyMaterials(root, materials) {
  if (!materials?.size) return;
  const counts = new Map();
  root?.traverse?.((mesh) => { if (mesh.isMesh) counts.set(mesh.name, (counts.get(mesh.name) || 0) + 1); });
  root?.traverse?.((mesh) => {
    if (!mesh.isMesh || counts.get(mesh.name) !== 1 || mesh.userData?.isSilhouette || mesh.userData?.isEdge) return;
    const saved = materials.get(mesh.name);
    if (!saved?.length || saved.some((m) => !m)) return;
    mesh.material = Array.isArray(mesh.material) ? saved.map((m) => m.clone()) : saved[0].clone();
    const color = saved[0].color;
    if (color?.getHexString) {
      mesh.userData ||= {};
      mesh.userData.render3dCadColorHex = `#${color.getHexString()}`;
    }
  });
}
export function disposeAssemblyMaterials(materials) {
  for (const mats of materials?.values?.() || []) for (const m of mats) m?.dispose?.();
}
