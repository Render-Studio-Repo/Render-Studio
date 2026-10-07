function finitePose(value = {}) {
  const numbers = [value.x, value.y, value.z, value.qx, value.qy, value.qz, value.qw].map(Number);
  if (!numbers.every(Number.isFinite)) return null;
  return {
    x: numbers[0], y: numbers[1], z: numbers[2],
    qx: numbers[3], qy: numbers[4], qz: numbers[5], qw: numbers[6],
  };
}

export function captureVisibleWindowPoses(rows = []) {
  const snapshot = new Map();
  for (const row of rows) {
    if (!row?.id || row.visible !== true) continue;
    const pose = finitePose(row.pose);
    if (pose) snapshot.set(String(row.id), pose);
  }
  return snapshot;
}

export function shouldRestoreWindowPoses({ presenting = false, becameVisible = false, referenceSpaceChanged = false, snapshot } = {}) {
  return presenting === true
    && (becameVisible === true || referenceSpaceChanged === true)
    && snapshot instanceof Map
    && snapshot.size > 0;
}

