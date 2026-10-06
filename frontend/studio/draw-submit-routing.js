// Keep explicit legacy face/route editing, but send model sketches to CAD.
export function resolveDrawSubmitMode({ mode, source, canvasAttached, hasSpatialSketch, legacyDrawCommand } = {}) {
  if (mode !== 'draw') return mode;
  if (source === 'xr' || canvasAttached || hasSpatialSketch || !legacyDrawCommand) return 'v2';
  return 'draw';
}
