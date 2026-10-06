function finiteBox(box) {
  if (!box?.min || !box?.max) return null;
  const values = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const size = [values[3] - values[0], values[4] - values[1], values[5] - values[2]];
  if (size.some((value) => !(value > 0))) return null;
  return { values, size, volume: size[0] * size[1] * size[2] };
}

/** Detect two independently named generation results occupying the same model envelope. */
export function nearDuplicateModelBoxes(a, b, { coverage = 0.9, sizeTolerance = 0.14 } = {}) {
  const left = finiteBox(a);
  const right = finiteBox(b);
  if (!left || !right) return false;
  const overlap = [0, 1, 2].map((axis) => Math.max(
    0,
    Math.min(left.values[axis + 3], right.values[axis + 3])
      - Math.max(left.values[axis], right.values[axis]),
  ));
  const overlapVolume = overlap[0] * overlap[1] * overlap[2];
  const smallerCoverage = overlapVolume / Math.min(left.volume, right.volume);
  if (smallerCoverage < coverage) return false;
  return left.size.every((value, axis) => {
    const ratio = value / right.size[axis];
    return ratio >= 1 - sizeTolerance && ratio <= 1 + sizeTolerance;
  });
}

/** Load an explicitly new result after its siblings so it can be placed beside them. */
export function latestGenerationLast(entries = [], latestFile = "") {
  const latest = String(latestFile || "");
  if (!latest) return [...entries];
  const rest = [];
  const matches = [];
  for (const entry of entries || []) {
    if (entry?.name === latest || entry?.viewer_filename === latest) matches.push(entry);
    else rest.push(entry);
  }
  return [...rest, ...matches];
}
