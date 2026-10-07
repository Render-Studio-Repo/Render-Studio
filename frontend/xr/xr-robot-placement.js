export const XR_ROBOT_PLACEMENT_KEY = "render3d:xr-robot-placement:v1";

const finiteArray = (value, length) => Array.isArray(value)
  && value.length === length
  && value.every(Number.isFinite);

export function normalizeRobotPlacement(value) {
  if (!value || value.v !== 1 || value.locked !== true
    || !finiteArray(value.position, 3)
    || !finiteArray(value.quaternion, 4)
    || !Number.isFinite(value.scale)) return null;
  const norm = Math.hypot(...value.quaternion);
  if (norm < 1e-6 || value.scale < 0.05 || value.scale > 5) return null;
  return {
    v: 1,
    locked: true,
    position: value.position.map(Number),
    quaternion: value.quaternion.map(component => Number(component) / norm),
    scale: Number(value.scale),
  };
}

export function readRobotPlacement(storage = globalThis.localStorage) {
  try { return normalizeRobotPlacement(JSON.parse(storage?.getItem?.(XR_ROBOT_PLACEMENT_KEY) || "null")); }
  catch { return null; }
}

export function saveRobotPlacement(root, storage = globalThis.localStorage) {
  const placement = normalizeRobotPlacement({
    v: 1,
    locked: true,
    position: root?.position?.toArray?.(),
    quaternion: root?.quaternion?.toArray?.(),
    scale: Number(root?.scale?.x),
  });
  if (!placement) return null;
  try { storage?.setItem?.(XR_ROBOT_PLACEMENT_KEY, JSON.stringify(placement)); } catch {}
  return placement;
}

export function clearRobotPlacement(storage = globalThis.localStorage) {
  try { storage?.removeItem?.(XR_ROBOT_PLACEMENT_KEY); } catch {}
}

export function applyRobotPlacement(root, placement) {
  const value = normalizeRobotPlacement(placement);
  if (!root || !value) return false;
  root.position.fromArray(value.position);
  root.quaternion.fromArray(value.quaternion);
  root.scale.setScalar(value.scale);
  root.userData.xrPlacementLocked = true;
  root.updateMatrixWorld?.(true);
  return true;
}
