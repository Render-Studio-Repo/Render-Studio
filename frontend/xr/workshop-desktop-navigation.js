export const WORKSHOP_FLOOR_Y_M = 0;
export const WORKSHOP_EYE_HEIGHT_M = 1.65;
export const WORKSHOP_DESKTOP_FLIP_X_RAD = Math.PI;

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function workshopStandingHead(spawn = {}, {
  floorY = WORKSHOP_FLOOR_Y_M,
  eyeHeight = WORKSHOP_EYE_HEIGHT_M,
} = {}) {
  const safeFloorY = finite(floorY, WORKSHOP_FLOOR_Y_M);
  const safeEyeHeight = Math.max(0.8, finite(eyeHeight, WORKSHOP_EYE_HEIGHT_M));
  return {
    x: finite(spawn.x, 0),
    y: safeFloorY + safeEyeHeight,
    z: finite(spawn.z, 3.2),
    yaw: finite(spawn.yaw, 0),
    pitch: 0,
    floorY: safeFloorY,
  };
}

export function clampWorkshopHeadToFloor(position = {}, {
  floorY = WORKSHOP_FLOOR_Y_M,
  eyeHeight = WORKSHOP_EYE_HEIGHT_M,
} = {}) {
  const standing = workshopStandingHead({}, { floorY, eyeHeight });
  return {
    x: finite(position.x, 0),
    y: Math.max(standing.y, finite(position.y, standing.y)),
    z: finite(position.z, 0),
  };
}

export function workshopAssetRotation(rotation = [0, 0, 0], { desktop = false } = {}) {
  return [
    finite(rotation?.[0], 0) + (desktop ? WORKSHOP_DESKTOP_FLIP_X_RAD : 0),
    finite(rotation?.[1], 0),
    finite(rotation?.[2], 0),
  ];
}
