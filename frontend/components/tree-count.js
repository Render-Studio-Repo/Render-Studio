/**
 * Outliner / browser section counts.
 * 0–999 stay full digits so a single 0 is never compacted.
 * ≥1000 → 1k / 1.2k, ≥1e6 → 1M, ≥1e9 → 1B.
 */
export function treeCountValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function compactUnit(q, suffix, overflowLabel) {
  const rounded = q >= 10 ? Math.round(q) : Math.round(q * 10) / 10;
  if (overflowLabel && rounded >= 1000) return overflowLabel;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${text}${suffix}`;
}

export function formatTreeCount(value) {
  const v = treeCountValue(value);
  if (v < 1000) return String(v);
  if (v < 1e6) return compactUnit(v / 1e3, "k", "1M");
  if (v < 1e9) return compactUnit(v / 1e6, "M", "1B");
  return compactUnit(v / 1e9, "B", null);
}
