/**
 * Share-throw lock: squeeze a model + press the right (or grabbing-hand)
 * thumbstick in (xr-standard buttons[3] click). Shows a name plate + share
 * glyph, then a short fly-and-dive toward a person or printer — Hank-style
 * Quest throw-to-print, cheap meshes only.
 */

export const SHARE_THROW_STICK_AXIS = "xr-standard axes[2]/axes[3] unused; lock is thumbstick click buttons[3]";
export const SHARE_THROW_MIN_SPEED = 0.55;
export const SHARE_THROW_ANIM_MS = 520;
export const SHARE_THROW_LOCK_MS = 140;

/** Quest Touch / xr-standard: buttons[3] is thumbstick click (press stick inward). */
export function xrThumbstickClicked(gamepad) {
  const btns = gamepad?.buttons || [];
  const mapping = String(gamepad?.mapping || "");
  const n = btns.length;
  const pressed = (i) => btns[i]?.pressed === true;
  if (mapping === "xr-standard" && n >= 6) return pressed(3);
  if (mapping === "xr-standard" && n === 5) return pressed(2);
  return pressed(3) || pressed(4);
}

/** Grip + hold B (throwHeld) enters throw-at-printer. Stick-in stays a fallback. */
export function shareThrowArmed({ squeezing = false, throwHeld = false, thumbstickIn = false } = {}) {
  return squeezing === true && (throwHeld === true || thumbstickIn === true);
}

/** Walk is hold-B only when no CAD/share mesh is gripped. */
export function shareThrowWalkBlocked({ gripping = false } = {}) {
  return gripping === true;
}

export function isThrowPrintMesh(mesh) {
  if (!mesh) return false;
  if (mesh.userData?.viserGeometry === true) return false;
  return true;
}

export function shareThrowNameplate({ name = "", kind = "person" } = {}) {
  const label = String(name || (kind === "printer" ? "My printer" : "Share")).trim() || "Share";
  return {
    title: label.slice(0, 28),
    glyph: "share",
    kind: kind === "printer" ? "printer" : "person",
  };
}

/**
 * Pick the closest in-front person (accepts print) or printer volume.
 * `users` are world positions; `printer` is an optional AABB center.
 */
export function pickShareThrowTarget({
  origin = [0, 1.4, 0],
  forward = [0, 0, -1],
  users = [],
  printer = null,
  maxAngle = 0.72,
  maxDist = 6,
} = {}) {
  const ox = Number(origin[0]) || 0;
  const oy = Number(origin[1]) || 0;
  const oz = Number(origin[2]) || 0;
  let fx = Number(forward[0]) || 0;
  let fy = Number(forward[1]) || 0;
  let fz = Number(forward[2]) || 0;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;

  let best = null;
  let bestScore = Infinity;
  const consider = (id, name, kind, pos, accept) => {
    if (kind === "person" && accept !== true) return;
    const dx = (Number(pos?.[0]) || 0) - ox;
    const dy = (Number(pos?.[1]) || 0) - oy;
    const dz = (Number(pos?.[2]) || 0) - oz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.12 || dist > maxDist) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;
    const dot = nx * fx + ny * fy + nz * fz;
    if (dot < maxAngle) return;
    const score = dist * (1.15 - dot);
    if (score < bestScore) {
      bestScore = score;
      best = { id, name, kind, pos: [ox + dx, oy + dy, oz + dz], accept: !!accept };
    }
  };

  for (const u of users || []) {
    consider(
      String(u.id || ""),
      u.display_name || u.name || u.handle || "Friend",
      "person",
      u.pos || u.position,
      u.accept_sends === true || u.acceptPrint === true,
    );
  }
  if (printer?.pos || printer?.position) {
    consider(
      String(printer.id || "local-printer"),
      printer.name || "My printer",
      "printer",
      printer.pos || printer.position,
      true,
    );
  }
  return best;
}

/** Ease-out cubic then a late dive (scale + sink) toward the chest / bed. */
export function shareThrowPoseAt(t, from, to) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const ease = 1 - (1 - u) ** 3;
  const lift = Math.sin(Math.min(1, u / 0.62) * Math.PI) * 0.22;
  const dive = u > 0.62 ? (u - 0.62) / 0.38 : 0;
  const fx = Number(from?.[0]) || 0;
  const fy = Number(from?.[1]) || 0;
  const fz = Number(from?.[2]) || 0;
  const tx = Number(to?.[0]) || 0;
  const ty = Number(to?.[1]) || 0;
  const tz = Number(to?.[2]) || 0;
  const x = fx + (tx - fx) * ease;
  const y = fy + (ty - fy) * ease + lift * (1 - dive);
  const z = fz + (tz - fz) * ease;
  const scale = 1 - dive * 0.88;
  return { x, y, z, scale: Math.max(0.08, scale) };
}

export function shareThrowFinished(t) {
  return (Number(t) || 0) >= 1;
}

export function printerVolumeFromProfile(profile) {
  const specs = profile?.specs || profile || {};
  const raw = specs.volume_mm || specs.bed_mm || profile?.volume_mm || [];
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const x = Math.max(0.06, (Number(raw[0]) || 0) / 1000);
  const z = Math.max(0.06, (Number(raw[1]) || 0) / 1000);
  const y = Math.max(0.06, (Number(raw[2] ?? raw[1]) || 0) / 1000);
  if (!(x > 0 && y > 0 && z > 0)) return null;
  return { x, y, z };
}

/** Ray vs axis-aligned printer volume. Used when the toss heads at the box. */
export function printerBoxHit({
  origin = [0, 1.4, 0],
  direction = [0, 0, -1],
  center = [0, 0.13, -0.7],
  size = [0.256, 0.256, 0.256],
  maxDist = 8,
} = {}) {
  const ox = Number(origin[0] ?? origin?.x) || 0;
  const oy = Number(origin[1] ?? origin?.y) || 0;
  const oz = Number(origin[2] ?? origin?.z) || 0;
  let dx = Number(direction[0] ?? direction?.x) || 0;
  let dy = Number(direction[1] ?? direction?.y) || 0;
  let dz = Number(direction[2] ?? direction?.z) || 0;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  const cx = Number(center[0] ?? center?.x) || 0;
  const cy = Number(center[1] ?? center?.y) || 0;
  const cz = Number(center[2] ?? center?.z) || 0;
  const hx = Math.max(0.04, (Number(size[0] ?? size?.x) || 0.256) / 2);
  const hy = Math.max(0.04, (Number(size[1] ?? size?.y) || 0.256) / 2);
  const hz = Math.max(0.04, (Number(size[2] ?? size?.z) || 0.256) / 2);
  const min = [cx - hx, cy - hy, cz - hz];
  const max = [cx + hx, cy + hy, cz + hz];
  let tmin = 0;
  let tmax = Number(maxDist) > 0 ? Number(maxDist) : 8;
  const originA = [ox, oy, oz];
  const dirA = [dx, dy, dz];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(dirA[i]) < 1e-8) {
      if (originA[i] < min[i] || originA[i] > max[i]) return null;
      continue;
    }
    const inv = 1 / dirA[i];
    let t1 = (min[i] - originA[i]) * inv;
    let t2 = (max[i] - originA[i]) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return null;
  }
  return { t: tmin, pos: [ox + dx * tmin, oy + dy * tmin, oz + dz * tmin] };
}
