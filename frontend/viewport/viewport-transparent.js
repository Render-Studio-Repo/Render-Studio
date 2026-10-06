/**
 * Transparent / Ghost tool helpers.
 * Desktop: click items one-by-one, or ▾ → All objects for a global see-through toggle.
 * Unclicking Transparent restores previous (opaque) materials.
 */

export function isTransparentToolSkipObject(obj) {
  if (!obj) return true;
  if (obj.visible === false) return true;
  const ud = obj.userData || {};
  if (
    ud.xrUi
    || ud.isGizmo
    || ud.isGrid
    || ud.isSky
    || ud.isBounder
    || ud.isPrinterFence
    || ud.isController
    || ud.isSection
    || ud.skipTransparentTool
  ) {
    return true;
  }
  const name = String(obj.name || "");
  if (/^(grid|sky|gizmo|bounder|printer|controller|xr-|transform-controls)/i.test(name)) return true;
  return false;
}

/**
 * CAD / mesh objects the Transparent tool may ghost.
 * `entries` is typically `projectAssembly.list()` rows `[name, object]`.
 */
export function collectTransparentTargets(entries = [], fallback = []) {
  const targets = [];
  const seen = new Set();
  const push = (obj) => {
    if (isTransparentToolSkipObject(obj) || seen.has(obj)) return;
    seen.add(obj);
    targets.push(obj);
  };
  for (const item of entries) {
    push(Array.isArray(item) ? item[1] : item);
  }
  if (!targets.length) {
    for (const obj of fallback) push(obj);
  }
  return targets;
}

/** Replace the live selection with every eligible object. */
export function applyAllTransparentSelection(selected, targets) {
  const next = selected instanceof Set ? selected : new Set();
  next.clear();
  for (const obj of targets || []) {
    if (!obj) continue;
    next.add(obj);
  }
  return [...next];
}

/** Empty the selection and return objects that should restore to solid. */
export function restoreAllTransparentSelection(selected) {
  const previous = selected instanceof Set ? [...selected] : [];
  selected?.clear?.();
  return previous;
}

/** Unclicking Transparent turns All-objects mode off (back to click items). */
export function transparentModeAfterDisable() {
  return "click";
}
