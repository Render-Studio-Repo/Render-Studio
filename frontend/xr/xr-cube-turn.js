/** Pure world-up cube turn used by XR buttons and unit tests. */
export function worldYawQuaternion(quaternion, degrees = 15) {
  const [x = 0, y = 0, z = 0, w = 1] = Array.isArray(quaternion) ? quaternion.map(Number) : [];
  const half = ((Number(degrees) || 0) * Math.PI / 180) / 2;
  const sy = Math.sin(half);
  const cy = Math.cos(half);
  const out = [
    cy * x + sy * z,
    cy * y + sy * w,
    cy * z - sy * x,
    cy * w - sy * y,
  ];
  const mag = Math.hypot(...out) || 1;
  return out.map((n) => n / mag);
}
