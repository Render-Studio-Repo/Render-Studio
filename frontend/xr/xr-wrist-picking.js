/** Exact, two-sided wrist button picking, independent of renderer overlay flags. */
export function createXrWristPicker(THREE) {
  const normal = new THREE.Vector3(), center = new THREE.Vector3();
  const point = new THREE.Vector3(), local = new THREE.Vector3();
  const plane = new THREE.Plane();

  function visible(button) {
    for (let node = button; node; node = node.parent) if (!node.visible) return false;
    return true;
  }

  return function pickWristUi(raycaster, buttons, maxDistance = 1.45) {
    let best = null;
    for (const button of new Set(buttons || [])) {
      if (!button?.isMesh || !button.userData?.xrTool || !visible(button)) continue;
      const params = button.geometry?.parameters;
      if (!params) continue;
      button.updateWorldMatrix(true, false);
      if (Math.abs(button.matrixWorld.determinant()) < 1e-12) continue;
      center.setFromMatrixPosition(button.matrixWorld);
      normal.set(0, 0, 1).transformDirection(button.matrixWorld);
      plane.setFromNormalAndCoplanarPoint(normal, center);
      if (!raycaster.ray.intersectPlane(plane, point)) continue;
      const distance = point.distanceTo(raycaster.ray.origin);
      // A coplanar ray returns its own origin. That is not a pointer crossing
      // a button and used to let the pointing hand click its own wrist at t=0.
      if (distance < 0.003 || distance > maxDistance || (best && distance >= best.distance)) continue;
      local.copy(point); button.worldToLocal(local);
      // Circle pucks use their real local radius; no whole-plate AABB or nearest
      // unrelated icon can turn a miss into a click. Test both sides of the plane.
      if (Number.isFinite(params.radius)) {
        if (Math.hypot(local.x, local.y) > params.radius) continue;
      } else if (Number.isFinite(params.width) && Number.isFinite(params.height)) {
        if (Math.abs(local.x) > params.width / 2 || Math.abs(local.y) > params.height / 2) continue;
      } else continue;
      best = { kind: "tool", tool: button.userData.xrTool, source: "wrist", distance, point: point.clone() };
    }
    return best;
  };
}
