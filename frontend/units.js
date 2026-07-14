/**
 * Global document units (mm / cm / m / in / ft) with Fusion-style value parsing.
 *
 * Every length input in the app accepts strings like "25", "25mm", "1in",
 * "0.5 in", '1.5"', "1/2in", "12.7 mm", "2cm", "3ft", "1.2m" — converted
 * internally to mm. Bare numbers use the current document unit.
 */

const LS_KEY = "render3d:units";

export const MM_PER_IN = 25.4;
export const MM_PER_FT = 304.8;

/** @typedef {"mm"|"cm"|"m"|"in"|"ft"} UnitId */

export const UNIT_OPTIONS = [
  { id: "mm", label: "mm", toMm: 1, precision: 3 },
  { id: "cm", label: "cm", toMm: 10, precision: 3 },
  { id: "m", label: "m", toMm: 1000, precision: 4 },
  { id: "in", label: "in", toMm: MM_PER_IN, precision: 4 },
  { id: "ft", label: "ft", toMm: MM_PER_FT, precision: 4 },
];

const UNIT_MAP = Object.fromEntries(UNIT_OPTIONS.map((u) => [u.id, u]));

function normalizeUnit(u) {
  const id = String(u || "").toLowerCase();
  if (UNIT_MAP[id]) return id;
  if (id === "inch" || id === "inches" || id === '"') return "in";
  if (id === "feet" || id === "foot" || id === "'") return "ft";
  if (id === "meter" || id === "meters" || id === "metre" || id === "metres") return "m";
  if (id === "centimeter" || id === "centimeters" || id === "centimetre" || id === "centimetres") return "cm";
  if (id === "millimeter" || id === "millimeters" || id === "millimetre" || id === "millimetres") return "mm";
  return "mm";
}

let current = "mm";
try {
  current = normalizeUnit(localStorage.getItem(LS_KEY) || "mm");
} catch (_) {
  current = "mm";
}

export function getUnits() {
  return current;
}

export function setUnits(u) {
  const next = normalizeUnit(u);
  if (next === current) return;
  current = next;
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
    const def = UNIT_MAP[normalizeUnit(defaultUnit)] || UNIT_MAP.mm;
    return text * def.toMm;
  }
  const s = String(text ?? "").trim().toLowerCase().replace(/”|″/g, '"').replace(/’|′/g, "'");
  if (!s) return NaN;
  const m = s.match(
    /^(-?(?:\d+\s+)?\d*\.?\d+(?:\s*\/\s*\d*\.?\d+)?)\s*(mm|millimetres?|millimeters?|cm|centimetres?|centimeters?|m|metres?|meters?|in|inch|inches|"|ft|feet|foot|')?$/
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

  const unit = normalizeUnit(m[2] || defaultUnit);
  return value * (UNIT_MAP[unit]?.toMm ?? 1);
}

/** mm → numeric value in the current display unit. */
export function displayValue(mm, precision) {
  if (!Number.isFinite(mm)) return NaN;
  const def = UNIT_MAP[current] || UNIT_MAP.mm;
  const v = mm / def.toMm;
  const p = precision ?? def.precision;
  return parseFloat(v.toFixed(p));
}

/** mm → "12.7 mm" / "0.5 in" in the current unit. */
export function formatLength(mm, precision) {
  if (!Number.isFinite(mm)) return "—";
  const def = UNIT_MAP[current] || UNIT_MAP.mm;
  return `${displayValue(mm, precision)} ${def.label}`;
}

/** mm² → area string in the current unit. */
export function formatArea(mm2, precision) {
  if (!Number.isFinite(mm2)) return "—";
  const def = UNIT_MAP[current] || UNIT_MAP.mm;
  const scale = def.toMm * def.toMm;
  const v = mm2 / scale;
  const p = precision ?? (current === "m" || current === "ft" ? 4 : 2);
  return `${parseFloat(v.toFixed(p))} ${def.label}²`;
}

/** Suffix for labels, e.g. `Distance (${unitSuffix()})`. */
export function unitSuffix() {
  return (UNIT_MAP[current] || UNIT_MAP.mm).label;
}

/**
 * Heuristic model-unit scale: kernel/exported parts are mm-scale (extent >= 1),
 * legacy uploaded meshes are metres. Returns mm per 1 model unit.
 */
export function mmPerModelUnit(maxExtent) {
  return Number.isFinite(maxExtent) && maxExtent >= 1.0 ? 1 : 1000;
}

/** Fill a <select> with unit options and keep it synced. */
export function fillUnitSelect(selectEl) {
  if (!selectEl) return;
  const prev = selectEl.value;
  selectEl.innerHTML = UNIT_OPTIONS.map(
    (u) => `<option value="${u.id}">${u.label}</option>`
  ).join("");
  selectEl.value = UNIT_MAP[prev] ? prev : current;
}

/**
 * Mount global unit switcher(s). Accepts one element or a NodeList/array.
 * All `.unit-select` elements stay in sync.
 */
export function initUnitSwitcher(selectElOrList) {
  const list = selectElOrList
    ? Array.from(selectElOrList.length != null && !selectElOrList.tagName ? selectElOrList : [selectElOrList])
    : Array.from(document.querySelectorAll(".unit-select, [data-unit-select]"));
  if (!list.length) return;

  for (const el of list) {
    fillUnitSelect(el);
    el.value = current;
    el.addEventListener("change", () => setUnits(el.value));
  }
  onUnitsChanged((u) => {
    for (const el of list) {
      if (el.value !== u) el.value = u;
    }
    document.querySelectorAll(".unit-select, [data-unit-select]").forEach((el) => {
      if (el.value !== u) {
        fillUnitSelect(el);
        el.value = u;
      }
    });
  });
}
