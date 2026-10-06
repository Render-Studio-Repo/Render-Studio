// Z-up CAD, Fusion ViewCube convention (millimetres, right-handed):
//   +X right, +Y back (away in Front view), +Z top
//   Front view = camera at −Y looking toward +Y  →  +X is screen-right
// CSS cube identity: +X right, +Y top, +Z toward viewer = FRONT.

export const VIEW_CUBE_FACES = {
  front: { label: "FRONT", direction: [0, -1, 0], up: [0, 0, 1] },
  back: { label: "BACK", direction: [0, 1, 0], up: [0, 0, 1] },
  top: { label: "TOP", direction: [0, 0, 1], up: [0, 1, 0] },
  bottom: { label: "BOTTOM", direction: [0, 0, -1], up: [0, -1, 0] },
  right: { label: "RIGHT", direction: [1, 0, 0], up: [0, 0, 1] },
  left: { label: "LEFT", direction: [-1, 0, 0], up: [0, 0, 1] },
};

const RAD2DEG = 180 / Math.PI;

/** Yaw 0 at Front (−Y), +π/2 at Right (+X). Pitch +π/2 at Top (+Z). */
export function viewCubeYawPitch(x, y, z) {
  const horiz = Math.hypot(x, y);
  const pitch = Math.atan2(z, horiz);
  // atan2(0, -0) is π — treat the exact Top/Bottom pole as yaw 0 (Front south).
  const yawCad = horiz < 1e-8 ? 0 : Math.atan2(x, -y);
  return { yawCad, pitch };
}

export function viewCubeSpinCss(x, y, z) {
  const { yawCad, pitch } = viewCubeYawPitch(x, y, z);
  return `rotateX(${-pitch * RAD2DEG}deg) rotateY(${-yawCad * RAD2DEG}deg)`;
}

export function nearestViewCubeFace(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  const nx = x / len;
  const ny = y / len;
  const nz = z / len;
  let best = "front";
  let bestDot = -Infinity;
  for (const [name, spec] of Object.entries(VIEW_CUBE_FACES)) {
    const [dx, dy, dz] = spec.direction;
    const dot = nx * dx + ny * dy + nz * dz;
    if (dot > bestDot) {
      bestDot = dot;
      best = name;
    }
  }
  return best;
}

/** Z-up spherical: theta = Fusion yaw (Front→Right), phi = 0 at Top. */
export function zUpSphericalFromOffset(x, y, z) {
  const radius = Math.hypot(x, y, z);
  if (radius < 1e-12) return { radius: 0, theta: 0, phi: 0 };
  const horiz = Math.hypot(x, y);
  return {
    radius,
    theta: horiz < 1e-8 ? 0 : Math.atan2(x, -y),
    phi: Math.acos(Math.min(1, Math.max(-1, z / radius))),
  };
}

export function zUpOffsetFromSpherical(radius, theta, phi) {
  const sinPhi = Math.sin(phi);
  return {
    x: radius * sinPhi * Math.sin(theta),
    y: -radius * sinPhi * Math.cos(theta),
    z: radius * Math.cos(phi),
  };
}
