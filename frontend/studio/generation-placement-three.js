import { resolveGenerationPlacement } from './generation-placement.js?v=20260923-spawn1';

export function usesWorkshopGenerationPlacement({ presenting, workspaceJoin, sceneKind }) {
  return !!(presenting || workspaceJoin) && sceneKind === 'workshop';
}

export function applyGenerationPlacement(THREE, mesh, { placement, sceneBounds } = {}) {
  if (!mesh) return false;
  mesh.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(mesh);
  const resolved = resolveGenerationPlacement({ placement, modelBounds: { min: box.min.toArray(), max: box.max.toArray() }, sceneBounds });
  if (!resolved) return false;
  mesh.scale.multiplyScalar(resolved.scaleMultiplier);
  mesh.updateWorldMatrix(true, true);
  box.setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const target = new THREE.Vector3(...resolved.center);
  if (mesh.parent) {
    mesh.parent.worldToLocal(center);
    mesh.parent.worldToLocal(target);
  }
  mesh.position.add(target.sub(center));
  mesh.updateWorldMatrix(true, true);
  return true;
}

export function generationSurfaceFromHit(THREE, hit) {
  if (!hit?.face?.normal || !hit.object || !hit.point) return null;
  const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
  return {
    position: hit.point.toArray(), normal: normal.toArray(),
    surfaceId: `${hit.object.name || hit.object.uuid}:${hit.faceIndex ?? 'face'}`,
    label: hit.object.name || 'Selected model face',
  };
}
