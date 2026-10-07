/** World size for the in-viewport measure chip so it tracks the dimension, not the whole assembly. */

const LABEL_ASPECT = 96 / 320;

export function dimLabelSpriteSize(scale, span) {
  const s = Math.max(Number(scale) || 0, 1e-6);
  const len = Number(span);
  if (!Number.isFinite(len) || len <= 1e-8) {
    const sw = s * 2.4;
    return { x: sw, y: sw * LABEL_ASPECT };
  }
  const lo = Math.min(s * 0.25, len * 0.9);
  const hi = Math.max(len * 0.72, lo);
  const sw = Math.min(hi, Math.max(lo, len * 0.48));
  return { x: sw, y: sw * LABEL_ASPECT };
}
