/** Floor-relative locomotion. Reference offsets are the inverse of player motion. */
const rotate = (x, z, yaw) => [Math.cos(yaw) * x + Math.sin(yaw) * z, -Math.sin(yaw) * x + Math.cos(yaw) * z];
export const ROOM_TURN_RADIANS = Math.PI / 6;
/** Quest 3 right face B — xr-standard `buttons[5]` / `rightB`. Analog extras are never B. */
export const XR_RIGHT_B_BUTTON = 5;
export const ROOM_WALK_CACHE = "20260916-vrwalk1";
/** Modest headset-forward walk (m/s). Combined sticks cap at this, not 2×. */
export const ROOM_WALK_SPEED = 1.2;
export const ROOM_WALK_DEADZONE = 0.2;

function digitalFacePressed(gp, index) {
  return gp?.buttons?.[index]?.pressed === true;
}

export function roomFloorSeats(ids = []) {
  const unique = [...new Set(ids.filter(Boolean))].sort();
  const radius = Math.max(1.1, unique.length * .22);
  return unique.map((user_id, index) => {
    const angle = index * Math.PI * 2 / Math.max(1, unique.length);
    return {user_id, p:[Math.sin(angle) * radius, 0, Math.cos(angle) * radius], yaw:angle};
  });
}

export function roomJoinSeat(userId, users = []) {
  const seats = roomFloorSeats([userId,...users.map(u=>u.id)]);
  const preferred = seats.find(s=>s.user_id===userId);
  const clear = seat => users.every(u=>!u.xrPose?.head?.p || Math.hypot(
    seat.p[0]-u.xrPose.head.p[0],seat.p[2]-u.xrPose.head.p[2]) >= .7);
  const slot = preferred && clear(preferred) ? preferred : seats.find(clear) || preferred;
  return slot ? {...slot,user_id:userId} : null;
}

export function floorRecenter({head, headYaw = 0, loco = {}, seat = {p:[0,0,1.1],yaw:0}}) {
  const oldYaw = loco.yaw || 0, p = loco.p || [0,0,0];
  const raw = rotate(head[0], head[2], oldYaw);
  const yaw = headYaw + oldYaw - (seat.yaw || 0);
  const target = rotate(seat.p[0], seat.p[2], yaw);
  return {p:[raw[0] + p[0] - target[0], 0, raw[1] + p[2] - target[1]], yaw};
}

export function roomStickAxes(sources = []) {
  const out = {left:[0,0],right:[0,0]};
  for (const source of sources) {
    if (!['left','right'].includes(source.handedness)) continue;
    const axes = source.gamepad?.axes;
    const buttons = source.gamepad?.buttons?.length || 0;
    if (!axes?.length) continue;
    // Quest AR may set `.hand` on Touch. Pinch pads are 1–2 buttons / no stick.
    if (source.hand && buttons < 4 && axes.length < 4) continue;
    const i = axes.length >= 4 ? 2 : 0;
    out[source.handedness] = [Number(axes[i]) || 0, Number(axes[i+1]) || 0];
  }
  return out;
}

/**
 * Right Touch B only. Unlabeled pads count as right (Quest drops handedness).
 * Left Y, analog value, stick tilt, and extras 6–10 are never B.
 */
export function rightBWalkSources(sources = []) {
  const list = [...(sources || [])].filter((s) => (s?.gamepad?.buttons?.length || 0) > XR_RIGHT_B_BUTTON);
  const right = list.filter((s) => s?.handedness === "right");
  if (right.length) return right;
  return list.filter((s) => s?.handedness !== "left");
}

export function rightBHeld(sources = []) {
  return rightBWalkSources(sources).some((source) => digitalFacePressed(source.gamepad, XR_RIGHT_B_BUTTON));
}

/** Sticks only walk while right B is held. Release B → zero locomotion axes. */
export function roomWalkAxes(sources = [], { walkHeld = false } = {}) {
  if (walkHeld !== true) return { left: [0, 0], right: [0, 0] };
  return roomStickAxes(sources);
}

export function stepRoomLocomotion({
  loco = {},
  head,
  headYaw = 0,
  axes,
  dt = 0,
  turnLatched = false,
  blocked = false,
  walkHeld = false,
} = {}) {
  const rightX = Number(axes?.right?.[0]) || 0;
  if (blocked || walkHeld !== true) {
    return { loco, turnLatched: Math.abs(rightX) > .25, changed: false };
  }
  const p = [...(loco.p || [0, 0, 0])];
  const yaw = loco.yaw || 0;
  const lx = Number(axes?.left?.[0]) || 0;
  const lz = Number(axes?.left?.[1]) || 0;
  const rz = Number(axes?.right?.[1]) || 0;
  // Both sticks translate in XZ. Headset-forward; no fly; no snap-turn.
  const x = lx + rightX;
  const z = lz + rz;
  const length = Math.hypot(x, z);
  if (length <= ROOM_WALK_DEADZONE) {
    return { loco, turnLatched: false, changed: false };
  }
  const amount = Math.min(1, (length - ROOM_WALK_DEADZONE) / 0.8) * ROOM_WALK_SPEED * Math.max(0, Math.min(0.05, dt));
  const [dx, dz] = rotate(x / length * amount, z / length * amount, headYaw + yaw);
  p[0] -= dx;
  p[1] = 0;
  p[2] -= dz;
  return { loco: { p, yaw }, turnLatched: false, changed: true };
}
