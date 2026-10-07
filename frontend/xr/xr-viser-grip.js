/** Aim-only OpenArm / Viser grab: visible robot mesh, never helpers or scene volumes. */
export const VISER_GRIP_CACHE = "20260916-visergrip1";
export const VISER_GRAB_MAX_EXTENT_M = 3.5;

export function isViserSceneFurnitureName(name = "") {
  const n = String(name || "");
  if (/\/(ghost|collision)\//i.test(n) || n.startsWith("/targets/model/")) return true;
  return /(^|\/)(grid|worldaxes|world_axes|world-axes|camerafrustum|camera_frustum|ground|floor)(\/|$)/i.test(n);
}

export function viserMeshExceedsGrabExtent(obj) {
  const box = obj?.geometry?.boundingBox;
  if (!box) return false;
  const e = obj.matrixWorld?.elements;
  const x = box.max.x - box.min.x, y = box.max.y - box.min.y, z = box.max.z - box.min.z;
  const sx = e ? Math.abs(e[0]) * x + Math.abs(e[4]) * y + Math.abs(e[8]) * z : x * Math.abs(obj.scale?.x || 1);
  const sy = e ? Math.abs(e[1]) * x + Math.abs(e[5]) * y + Math.abs(e[9]) * z : y * Math.abs(obj.scale?.y || 1);
  const sz = e ? Math.abs(e[2]) * x + Math.abs(e[6]) * y + Math.abs(e[10]) * z : z * Math.abs(obj.scale?.z || 1);
  return sx > VISER_GRAB_MAX_EXTENT_M || sy > VISER_GRAB_MAX_EXTENT_M || sz > VISER_GRAB_MAX_EXTENT_M;
}

export function muteViserHelperRaycast(obj) {
  if (!obj) return;
  obj.userData.xrIgnoreBounds = true;
  obj.raycast = () => {};
}

/** Visible robot link / target handle only — never Lines, helpers, or scene volumes. */
export function isViserGrabMesh(obj) {
  if (!obj?.isMesh || obj.visible === false || obj.isLine || obj.isLineSegments || obj.isPoints || obj.isSprite) return false;
  const u = obj.userData || {};
  if (u.xrIgnoreBounds || u.xrCadProxy || u.viserHelper) return false;
  const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  if (mat?.colorWrite === false) return false;
  const op = Number(mat?.opacity);
  if (Number.isFinite(op) && op > 0 && op < 0.05) return false;
  if (isViserSceneFurnitureName(obj.name)) return false;
  let tagged = !!(u.viserGeometry || u.viserTarget);
  for (let p = obj.parent; p; p = p.parent) {
    if (p.visible === false) return false;
    if (isViserSceneFurnitureName(p.name)) return false;
    if (p.userData?.viserGeometry || p.userData?.viserTarget) tagged = true;
    if (p.name === "Live OpenArm") break;
  }
  if (!tagged) return false;
  if (!obj.geometry?.boundingBox) obj.geometry?.computeBoundingBox?.();
  return !viserMeshExceedsGrabExtent(obj);
}

export function viserAimHitsRobot(raycaster, root) {
  if (!raycaster || !root || root.visible === false) return null;
  const hits = raycaster.intersectObject(root, true);
  return hits.find((h) => isViserGrabMesh(h.object)) || null;
}
