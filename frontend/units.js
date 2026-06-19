/**
 * Global document units (mm / in) with Fusion-style value parsing.
 *
 * Every length input in the app accepts strings like "25", "25mm", "1in",
 * "0.5 in", '1.5"', "1/2in", "12.7 mm", "2cm" — converted internally to mm.
 * Bare numbers are interpreted in the current document unit.
 */

const LS_KEY = "render3d:units";
export const MM_PER_IN = 25.4;

let current = "mm";
try {
  current = localStorage.getItem(LS_KEY) === "in" ? "in" : "mm";
} catch (_) {}

export function getUnits() {
  return current;
}

export function setUnits(u) {
  current = u === "in" ? "in" : "mm";
  try {
    localStorage.setItem(LS_KEY, current);
  } catch (_) {}
  window.dispatchEvent(new CustomEvent("render3d:units-changed", { detail: { units: current } }));
}

export function onUnitsChanged(fn) {
  window.addEventListener("render3d:units-changed", (e) => fn(e.detail.units));
}

/**
 * Parse a length expression into millimetres. Returns NaN when invalid.
 * Bare numbers use `defaultUnit` (document unit unless overridden).
 */
export function parseLength(text, { defaultUnit = current } = {}) {
  if (typeof text === "number") {
    return defaultUnit === "in" ? text * MM_PER_IN : text;
  }
  const s = String(text ?? "").trim().toLowerCase().replace(/”|″/g, '"');
  if (!s) return NaN;
  const m = s.match(
    /^(-?(?:\d+\s+)?\d*\.?\d+(?:\s*\/\s*\d*\.?\d+)?)\s*(mm|millimetres?|millimeters?|cm|m|in|inch|inches|")?$/
  );
  if (!m) return NaN;

  let raw = m[1].trim();
  let value;
  const whole = raw.match(/^(-?\d+)\s+(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/); // "1 1/2"
  if (whole) {
    const sign = whole[1].startsWith("-") ? -1 : 1;
    value = sign * (Math.abs(parseFloat(whole[1])) + parseFloat(whole[2]) / parseFloat(whole[3]));
  } else if (raw.includes("/")) {
    const [a, b] = raw.split("/");
    value = parseFloat(a) / parseFloat(b);
  } else {
    value = parseFloat(raw);
  }
  if (!Number.isFinite(value)) return NaN;

  const unit = m[2] || defaultUnit;
  switch (unit) {
    case "in":
    case "inch":
    case "inches":
    case '"':
      return value * MM_PER_IN;
    case "cm":
      return value * 10;
    case "m":
      return value * 1000;
    default:
      return value;
  }
}

/** mm → numeric value in the current display unit. */
export function displayValue(mm, precision) {
  if (!Number.isFinite(mm)) return NaN;
  const v = current === "in" ? mm / MM_PER_IN : mm;
  const p = precision ?? (current === "in" ? 4 : 3);
  return parseFloat(v.toFixed(p));
}

/** mm → "12.7 mm" / "0.5 in" in the current unit. */
export function formatLength(mm, precision) {
  if (!Number.isFinite(mm)) return "—";
  return `${displayValue(mm, precision)} ${current}`;
}

/** Suffix for labels, e.g. `Distance (${unitSuffix()})`. */
export function unitSuffix() {
  return current;
}

/**
 * Heuristic model-unit scale: kernel/exported parts are mm-scale (extent >= 1),
 * legacy uploaded meshes are metres. Returns mm per 1 model unit.
 */
export function mmPerModelUnit(maxExtent) {
  return Number.isFinite(maxExtent) && maxExtent >= 1.0 ? 1 : 1000;
}

/** Mount the global mm/in switcher (header select). */
export function initUnitSwitcher(selectEl) {
  if (!selectEl) return;
  selectEl.value = current;
  selectEl.addEventListener("change", () => setUnits(selectEl.value));
  onUnitsChanged((u) => {
    if (selectEl.value !== u) selectEl.value = u;
  });
}
