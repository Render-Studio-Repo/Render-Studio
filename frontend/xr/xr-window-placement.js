// Newly opened XR windows sit at arm's reach, slightly below eye height.
export const XR_WINDOW_SPAWN_DIST_M = 0.55;
export const XR_WINDOW_SPAWN_UP_M = -0.08;
export const XR_WINDOW_SPAWN_MAX_M = 0.70;
export const XR_WINDOW_Y180 = { x: 0, y: 1, z: 0, w: 0 };
const GAP = 0.10;

export function windowFootprint({
  width = .5,
  height = .4,
  distance = XR_WINDOW_SPAWN_DIST_M,
  yaw = 0,
  up = XR_WINDOW_SPAWN_UP_M,
} = {}) {
  return { yaw, up, halfAngle: Math.atan2(Math.max(.12, width) / 2, Math.max(.3, distance)), height: Math.max(.12, height) };
}
export function windowsOverlap(a, b) {
  return Math.abs(a.yaw - b.yaw) < a.halfAngle + b.halfAngle + GAP
    && Math.abs(a.up - b.up) < (a.height + b.height) / 2 + GAP;
}
export function findWindowPlacement({
  width,
  height,
  occupied = [],
  preferred = null,
  distance = XR_WINDOW_SPAWN_DIST_M,
} = {}) {
  const shape = windowFootprint({ width, height, distance });
  const desired = { yaw: preferred?.yaw || 0, up: preferred?.up ?? XR_WINDOW_SPAWN_UP_M };
  const angles = new Set([0, desired.yaw]);
  const levels = new Set([XR_WINDOW_SPAWN_UP_M, desired.up]);
  for (const other of occupied) {
    angles.add(other.yaw - other.halfAngle - shape.halfAngle - GAP - .001);
    angles.add(other.yaw + other.halfAngle + shape.halfAngle + GAP + .001);
    levels.add(other.up - (other.height + shape.height) / 2 - GAP - .001);
    levels.add(other.up + (other.height + shape.height) / 2 + GAP + .001);
  }
  const candidates = [];
  for (const yaw of angles) for (const up of levels) {
    if (Math.abs(yaw) > 1.15 || up > .4) continue;
    const slot = { ...shape, yaw, up };
    if (occupied.some(other => windowsOverlap(slot, other))) continue;
    candidates.push(slot);
  }
  // Prefer the saved/opened position, then a nearby side slot, then another row.
  const cost = p => Math.abs(p.yaw - desired.yaw) + 2 * Math.abs(p.up - desired.up);
  candidates.sort((a, b) => cost(a) - cost(b));
  const result = candidates[0] || { ...shape, yaw: 0, up: Math.min(XR_WINDOW_SPAWN_UP_M, ...occupied.map(p => p.up - p.height / 2)) - shape.height / 2 - GAP - .001 };
  return { ...result, right: Math.sin(result.yaw) * distance, forward: Math.cos(result.yaw) * distance };
}

function quatMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function quatFromTo(ax, ay, az, bx, by, bz) {
  const len = Math.hypot(bx, by, bz) || 1;
  bx /= len; by /= len; bz /= len;
  const dot = ax * bx + ay * by + az * bz;
  if (dot < -0.999999) return { ...XR_WINDOW_Y180 };
  const q = {
    x: ay * bz - az * by,
    y: az * bx - ax * bz,
    z: ax * by - ay * bx,
    w: 1 + dot,
  };
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

export function rotateByQuat(q, v) {
  const ux = q.x, uy = q.y, uz = q.z, s = q.w;
  const vx = v.x, vy = v.y, vz = v.z;
  const tx = 2 * (uy * vz - uz * vy);
  const ty = 2 * (uz * vx - ux * vz);
  const tz = 2 * (ux * vy - uy * vx);
  return {
    x: vx + s * tx + (uy * tz - uz * ty),
    y: vy + s * ty + (uz * tx - ux * tz),
    z: vz + s * tz + (ux * ty - uy * tx),
  };
}

/** Three.js lookAt: object's +Z points from the target back toward the object (away from the head). */
export function windowLookAtQuaternion(position, target) {
  const dx = (position?.x || 0) - (target?.x || 0);
  const dz = (position?.z || 0) - (target?.z || 0);
  if (dx * dx + dz * dz < 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  return quatFromTo(0, 0, 1, dx, 0, dz);
}

export function plusZTowardHead(quat, position, head) {
  const z = rotateByQuat(quat, { x: 0, y: 0, z: 1 });
  const tx = (head?.x || 0) - (position?.x || 0);
  const tz = (head?.z || 0) - (position?.z || 0);
  return z.x * tx + z.z * tz;
}

export function ensureReadableFaceTowardHead(quat, position, head) {
  if (plusZTowardHead(quat, position, head) < 0) return quatMul(quat, XR_WINDOW_Y180);
  return quat;
}

/** lookAt(head), then 180° around Y so PlaneGeometry +Z is the readable face toward the HMD. */
/** Pull a far/lost panel back to arm's reach in front of the headset. */
export function clampPanelNearHead(pos, head = {}, {
  distance = XR_WINDOW_SPAWN_DIST_M,
  max = XR_WINDOW_SPAWN_MAX_M,
  up = XR_WINDOW_SPAWN_UP_M,
} = {}) {
  const hx = Number(head.x) || 0;
  const hy = Number.isFinite(Number(head.y)) ? Number(head.y) : 1.55;
  const hz = Number(head.z) || 0;
  const px = Number(pos?.x);
  const pz = Number(pos?.z);
  if (!Number.isFinite(px) || !Number.isFinite(pz)) {
    return { x: hx, y: hy + up, z: hz - distance };
  }
  const dx = px - hx;
  const dz = pz - hz;
  const horiz = Math.hypot(dx, dz);
  if (horiz <= max && horiz >= 0.28) {
    return { x: px, y: hy + up, z: pz };
  }
  const fx = horiz > 0.02 ? dx / horiz : 0;
  const fz = horiz > 0.02 ? dz / horiz : -1;
  return { x: hx + fx * distance, y: hy + up, z: hz + fz * distance };
}

export function windowFaceTowardHead(position, head) {
  return ensureReadableFaceTowardHead(
    quatMul(windowLookAtQuaternion(position, head), XR_WINDOW_Y180),
    position,
    head,
  );
}
