export const CENTER_DESK_SURFACE = Object.freeze([0, 0.83, -1.8]);

const vector = (value, fallback) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? [...value] : [...fallback];

export function normalizeGenerationPlacement(raw = {}) {
  const surface = raw?.target === "surface";
  const normal = vector(raw?.normal, [0, 1, 0]);
  const length = Math.hypot(...normal);
  return {
    target: surface ? "surface" : "center-desk-plate",
    position: surface ? vector(raw?.position, CENTER_DESK_SURFACE) : [...CENTER_DESK_SURFACE],
    normal: surface && length > 0.00001 ? normal.map((n) => n / length) : [0, 1, 0],
    sizeMeters: Number.isFinite(Number(raw?.sizeMeters)) && Number(raw.sizeMeters) > 0 ? Math.min(10, Math.max(0.01, Number(raw.sizeMeters))) : 0.6,
    clearanceMeters: 0.005,
    surfaceId: surface ? String(raw?.surfaceId || "").slice(0, 200) : "center-desk-plate",
    label: surface ? String(raw?.label || "Selected surface").slice(0, 120) : "Middle desk plate",
  };
}

export function generationPlacementFromSurface(surface, previous = {}) {
  if (!surface || !Array.isArray(surface.position) || !Array.isArray(surface.normal) || surface.position.length !== 3 || surface.normal.length !== 3 || !surface.position.every(Number.isFinite) || !surface.normal.every(Number.isFinite) || Math.hypot(...surface.normal) < 0.00001) return null;
  return normalizeGenerationPlacement({ ...previous, ...surface, target: "surface" });
}

export function resolveGenerationPlacement({ placement, modelBounds, sceneBounds, active = true } = {}) {
  if (!active) return null;
  const config = normalizeGenerationPlacement(placement);
  const min = modelBounds?.min;
  const max = modelBounds?.max;
  if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3 || !min.every(Number.isFinite) || !max.every(Number.isFinite)) return null;
  const size = max.map((value, i) => value - min[i]);
  if (size.some((n) => n < 0) || Math.max(...size) <= 0) return null;
  let scaleMultiplier = config.sizeMeters / Math.max(...size);
  if (config.target === "center-desk-plate") scaleMultiplier = Math.min(scaleMultiplier, 0.64 / Math.max(size[0], size[2], 0.00001));
  const half = size.map((n) => n * scaleMultiplier / 2);
  const support = half.reduce((sum, n, i) => sum + n * Math.abs(config.normal[i]), 0);
  const center = config.position.map((n, i) => n + config.normal[i] * (support + config.clearanceMeters));
  if (sceneBounds) {
    const limits = [Number(sceneBounds.width) / 2, Number(sceneBounds.height), Number(sceneBounds.depth) / 2];
    if (limits.every((n) => Number.isFinite(n) && n > 0) && (Math.abs(center[0]) + half[0] > limits[0] || Math.abs(center[2]) + half[2] > limits[2] || center[1] - half[1] < 0 || center[1] + half[1] > limits[1])) return null;
  }
  return { scaleMultiplier, center, normal: config.normal, target: config.target, clearanceMeters: config.clearanceMeters };
}
