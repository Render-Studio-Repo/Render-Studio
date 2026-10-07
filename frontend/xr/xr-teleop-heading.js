/** One fixed operator heading shared by both hands for each teleop engagement. */
export function createTeleopHeadingFrame() {
  let basis = null;
  let invalid = false;

  function clear() {
    basis?.referenceSpace?.removeEventListener?.('reset', invalidate);
    basis = null;
    invalid = false;
  }

  function invalidate() { clear(); invalid = true; }

  function capture(viewerTransform, referenceSpace) {
    clear();
    const q = viewerTransform?.orientation;
    if (!referenceSpace || !q || ![q.x, q.y, q.z, q.w].every(Number.isFinite)) return false;
    const norm = Math.hypot(q.x, q.y, q.z, q.w);
    if (norm < 1e-6) return false;
    const x = q.x / norm, y = q.y / norm, z = q.z / norm, w = q.w / norm;
    const forwardX = -2 * (x * z + y * w);
    const forwardZ = -(1 - 2 * (x * x + y * y));
    if (Math.hypot(forwardX, forwardZ) < 0.1) return false;
    const yaw = Math.atan2(-forwardX, -forwardZ);
    basis = { referenceSpace, cos: Math.cos(yaw), sin: Math.sin(yaw), qy: -Math.sin(yaw / 2), qw: Math.cos(yaw / 2) };
    referenceSpace.addEventListener?.('reset', invalidate);
    return true;
  }

  function transform(pose, referenceSpace) {
    if (!basis) return null;
    if (referenceSpace !== basis.referenceSpace) {
      invalidate();
      return null;
    }
    if (!pose || ![pose.x, pose.y, pose.z, pose.qx, pose.qy, pose.qz, pose.qw].every(Number.isFinite)) return null;
    const norm = Math.hypot(pose.qx, pose.qy, pose.qz, pose.qw);
    if (norm < 1e-6) return null;
    const { cos, sin, qy, qw } = basis;
    return {
      x: cos * pose.x - sin * pose.z,
      y: pose.y,
      z: sin * pose.x + cos * pose.z,
      qx: (qw * pose.qx + qy * pose.qz) / norm,
      qy: (qw * pose.qy + qy * pose.qw) / norm,
      qz: (qw * pose.qz - qy * pose.qx) / norm,
      qw: (qw * pose.qw - qy * pose.qy) / norm,
    };
  }

  return { capture, transform, clear, ready: () => basis !== null, invalidated: () => invalid };
}
