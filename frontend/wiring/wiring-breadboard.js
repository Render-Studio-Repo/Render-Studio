/** Stored connector coordinates use the same 0..1 drawing space as the SVG. */
export function physicalPins(component) {
  if (component?.breadboard?.status !== "library" || !Array.isArray(component.pin_layout)) return null;
  const seen = new Set();
  const pins = component.pin_layout.filter(pin => {
    if (!pin?.id || seen.has(pin.id) || !Number.isFinite(pin.x) || !Number.isFinite(pin.y) || pin.x < 0 || pin.x > 1 || pin.y < 0 || pin.y > 1) return false;
    seen.add(pin.id); return true;
  });
  return pins.length ? pins.map(pin => ({ ...pin, title: `${pin.label} · ${pin.connector_id || pin.id}` })) : null;
}

export function breadboardImage(profile) {
  const svg = profile?.svg;
  if (typeof svg !== "string" || svg.length > 900000 || !/<(?:svg|\w+:svg)\b/.test(svg)) return "";
  // SVG is loaded as an image, never inserted into the page's live DOM.
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

export function pinStatus(component) {
  return component?.breadboard?.status === "library"
    ? "Library pin map · confirm hardware revision"
    : "Illustration · pinout unverified";
}
