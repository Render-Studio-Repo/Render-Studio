/**
 * Persist which controller/hand the XR tool dock follows.
 * Headset doff/don and inputSources reorder must never change this.
 */

export const LS_DOCK_HAND = "render3d:xr-dock-hand";
/** Settings panel key — same preference as the dock follow hand. */
export const LS_UI_HAND = "render3d:xr-ui-hand";
/** One-time migrate: leftover "right" from backwards controller mapping. */
export const LS_UI_HAND_V2 = "render3d:xr-ui-hand:v2";

export function normalizeDockHand(value) {
  return String(value || "").trim().toLowerCase() === "right" ? "right" : "left";
}

export function otherDockHand(hand) {
  return normalizeDockHand(hand) === "right" ? "left" : "right";
}

export function dockHandLabel(hand) {
  return normalizeDockHand(hand) === "right" ? "Right hand" : "Left hand";
}

/** Belt / HUD follow this hand. Draw / snap / pencil follow the other. */
export function xrMenuHand(dockHand = "left") {
  return normalizeDockHand(dockHand);
}

export function xrDrawHand(dockHand = "left") {
  return otherDockHand(dockHand);
}

/**
 * Quest sessions stored menu=right when controllers were mapped backwards.
 * Reset once to menu=left, draw=right. Settings Left/Right still persist after.
 */
export function migrateMenuHandToLeft(storage) {
  try {
    if (storage?.getItem?.(LS_UI_HAND_V2) === "1") return readPreferredDockHand(storage);
    writePreferredDockHand(storage, "left");
    storage?.setItem?.(LS_UI_HAND_V2, "1");
    return "left";
  } catch {
    return "left";
  }
}

export function readStoredDockHandRaw(storage) {
  try {
    const ui = storage?.getItem?.(LS_UI_HAND);
    if (ui != null && String(ui).trim() !== "") return String(ui);
    const dock = storage?.getItem?.(LS_DOCK_HAND);
    if (dock != null && String(dock).trim() !== "") return String(dock);
  } catch {
    /* private mode / missing storage */
  }
  return "";
}

export function readPreferredDockHand(storage) {
  return normalizeDockHand(readStoredDockHandRaw(storage));
}

/** Session start / headset resume: leftover XR sources must not change this. */
export function restorePreferredDockHand(storage) {
  return readPreferredDockHand(storage);
}

/** First launch: persist left so later reads are not empty. Never write right here. */
export function seedDefaultDockHand(storage) {
  if (readStoredDockHandRaw(storage)) return readPreferredDockHand(storage);
  return writePreferredDockHand(storage, "left");
}

export function writePreferredDockHand(storage, hand) {
  const next = normalizeDockHand(hand);
  try {
    storage?.setItem?.(LS_UI_HAND, next);
    storage?.setItem?.(LS_DOCK_HAND, next);
  } catch {
    /* private mode / missing storage */
  }
  return next;
}

export function togglePreferredDockHand(storage, current) {
  return writePreferredDockHand(storage, otherDockHand(current));
}
