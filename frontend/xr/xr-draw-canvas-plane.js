/** Intersect a ray with the canvas in local meter coordinates. */
export function intersectCanvasPlaneRay(origin, direction, width = 3, height = 1.8) {
  if (![...origin, ...direction, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || Math.abs(direction[2]) < 1e-8) return null;
  const distance = -origin[2] / direction[2];
  if (distance < 0) return null;
  const x = origin[0] + direction[0] * distance;
  const y = origin[1] + direction[1] * distance;
  if (Math.abs(x) > width / 2 || Math.abs(y) > height / 2) return null;
  return { point: [x, y, 0], distance };
}

/** A lazy, stationary drawing surface. Ink coordinates remain world meters. */
export function createDrawCanvasPlane({ THREE, root, camera }) {
  const width = 3;
  const height = 1.8;
  const surface = new THREE.Group();
  surface.name = 'Draw AI 2D canvas';
  surface.visible = false;
  root.add(surface);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ color: 0x17222f, side: THREE.DoubleSide }),
  );
  board.position.z = -0.004;
  surface.add(board);
  const vertices = [];
  for (let x = -15; x <= 15; x += 1) vertices.push(x / 10, -height / 2, -0.002, x / 10, height / 2, -0.002);
  for (let y = -9; y <= 9; y += 1) vertices.push(-width / 2, y / 10, -0.002, width / 2, y / 10, -0.002);
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x557080, transparent: true, opacity: 0.55 }));
  surface.add(grid);
  let positioned = false;
  let disposed = false;

  function applyWorldPose(position, quaternion) {
    root.updateWorldMatrix(true, false);
    surface.position.copy(root.worldToLocal(position.clone()));
    const parentRotation = root.getWorldQuaternion(new THREE.Quaternion());
    surface.quaternion.copy(parentRotation.invert().multiply(quaternion));
    surface.updateWorldMatrix(true, true);
    positioned = true;
  }

  function recenter() {
    if (disposed) return;
    camera.updateWorldMatrix(true, false);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const position = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(forward, 2);
    position.y -= 0.15;
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward.clone().negate());
    applyWorldPose(position, quaternion);
  }

  function setEnabled(enabled) {
    if (disposed) return;
    if (enabled && !positioned) recenter();
    surface.visible = Boolean(enabled);
  }

  function drawingPoint(origin, direction) {
    if (!surface.visible || disposed) return null;
    surface.updateWorldMatrix(true, false);
    const localOrigin = surface.worldToLocal(origin.clone());
    const localDirection = surface.worldToLocal(origin.clone().add(direction)).sub(localOrigin);
    const hit = intersectCanvasPlaneRay(localOrigin.toArray(), localDirection.toArray(), width, height);
    if (!hit) return null;
    return surface.localToWorld(new THREE.Vector3(hit.point[0], hit.point[1], 0.002));
  }

  function frontTransform(index = 0) {
    if (!positioned) recenter();
    const slot = Math.max(0, Math.floor(Number(index) || 0)) % 12;
    surface.updateWorldMatrix(true, false);
    return {
      position: surface.localToWorld(new THREE.Vector3((slot % 4 - 1.5) * 0.65, (1 - Math.floor(slot / 4)) * 0.48, 0.006)).toArray(),
      quaternion: surface.getWorldQuaternion(new THREE.Quaternion()).toArray(),
      scale: [1, 1, 1],
    };
  }

  function getPose() {
    if (!positioned || disposed) return null;
    surface.updateWorldMatrix(true, false);
    return {
      position: surface.getWorldPosition(new THREE.Vector3()).toArray(),
      quaternion: surface.getWorldQuaternion(new THREE.Quaternion()).toArray(),
      width, height, units: 'meters',
    };
  }

  function restorePose(pose) {
    if (disposed || !pose || !Array.isArray(pose.position) || pose.position.length !== 3 || !Array.isArray(pose.quaternion) || pose.quaternion.length !== 4) return false;
    if (![...pose.position, ...pose.quaternion].every(Number.isFinite)) return false;
    const quaternion = new THREE.Quaternion().fromArray(pose.quaternion);
    if (quaternion.lengthSq() < 1e-8) return false;
    applyWorldPose(new THREE.Vector3().fromArray(pose.position), quaternion.normalize());
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    surface.visible = false;
    root.remove(surface);
    board.geometry.dispose();
    board.material.dispose();
    grid.geometry.dispose();
    grid.material.dispose();
  }

  return { setEnabled, isEnabled: () => !disposed && surface.visible, drawingPoint, frontTransform, getPose, restorePose, recenter, dispose };
}
