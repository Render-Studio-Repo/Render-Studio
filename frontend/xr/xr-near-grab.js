/** Physical grip acquisition: touch a visible surface, never the scene's AABB. */
export const XR_GRAB_REACH_M = 0.06;

export function createXrNearGrabPicker(THREE) {
  const bounds = new THREE.Box3();
  const triangle = new THREE.Triangle();
  const closest = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const instance = new THREE.Matrix4();

  return function pickNearSurface(origin, candidates = [], maxDistance = XR_GRAB_REACH_M) {
    if (!origin || ![origin.x, origin.y, origin.z].every(Number.isFinite)) return null;
    let best = null;
    let limit = maxDistance * maxDistance;
    const visit = (node, target) => {
      const u = node?.userData || {};
      if (!node || node.visible === false || u.xrIgnoreBounds || u.xrCadProxy
        || u.isEdge || u.isSilhouette || u.isObjectHighlight || u.isHover || u.isHoverBody
        || u.xrHudPlane) return;
      const nodeName = String(node.name || "");
      if (nodeName === "selectionBox" || nodeName === "SelectionBox" || nodeName === "xrCadProxy") return;
      if (node.isMesh && node.geometry && !u.xrControllerOverlayStyled) {
        const geometry = node.geometry;
        const position = geometry.attributes?.position;
        if (position) {
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          const count = node.isInstancedMesh ? node.count : 1;
          for (let n = 0; n < count; n += 1) {
            matrix.copy(node.matrixWorld);
            if (node.isInstancedMesh) {
              node.getMatrixAt(n, instance);
              matrix.multiply(instance);
            }
            bounds.copy(geometry.boundingBox).applyMatrix4(matrix);
            if (bounds.distanceToPoint(origin) ** 2 > limit) continue;
            const index = geometry.index;
            const length = index ? index.count : position.count;
            const start = geometry.drawRange?.start || 0;
            const end = Math.min(length, start + (geometry.drawRange?.count ?? Infinity));
            for (let i = start; i + 2 < end; i += 3) {
              triangle.a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
              triangle.b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
              triangle.c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);
              triangle.closestPointToPoint(origin, closest);
              const d2 = closest.distanceToSquared(origin);
              if (d2 <= limit) {
                limit = d2;
                best = { target, object: node, distance: Math.sqrt(d2) };
              }
            }
          }
        }
      }
      for (const child of node.children || []) visit(child, target);
    };
    for (const row of candidates) {
      const root = row?.root || row;
      if (!root) continue;
      let visible = true;
      for (let p = root; p; p = p.parent) if (p.visible === false) { visible = false; break; }
      if (!visible) continue;
      root.updateWorldMatrix?.(true, true);
      visit(root, row?.target || root);
    }
    return best;
  };
}
