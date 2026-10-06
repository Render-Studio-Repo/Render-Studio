/** Explicit functional terminals are diagram coordinates, never a measured PCB pinout. */
export function diagramPins(component) {
  if (component?.pin_layout_mode !== 'diagram' || !Array.isArray(component.pin_layout)) return null;
  const seen = new Set();
  return component.pin_layout.filter(pin => {
    if (!pin || !String(pin.id || '') || seen.has(String(pin.id)) || !Number.isFinite(pin.x) || !Number.isFinite(pin.y) || pin.x < 0 || pin.x > 1 || pin.y < 0 || pin.y > 1) return false;
    seen.add(String(pin.id)); return true;
  }).map(pin => ({ ...pin, label: pin.label || pin.id, title: pin.title || `${pin.label || pin.id} · functional terminal (diagram placement)` }));
}
