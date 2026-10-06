/** Trigger ownership is per hand and lasts until the physical trigger is released. */
export function createRoboticsTriggerOwnership() {
  const owned = new Set();
  const valid = hand => hand === 'left' || hand === 'right';
  return {
    reserve(hand) { if (valid(hand)) owned.add(hand); },
    sample(hand, { armed = false, pressed = false, uiHit = false } = {}) {
      if (!valid(hand)) return armed && uiHit;
      if (!armed || !pressed) owned.delete(hand);
      if (armed && pressed && uiHit) owned.add(hand);
      return armed && (uiHit || owned.has(hand));
    },
    reset() { owned.clear(); },
  };
}

/** Empty DimOS visor / Viser overlay planes are not menu clicks. */
export function studioRoboticsUiHit(hit = null) {
  if (!hit?.kind) return false;
  if (hit.kind === "robotics-chrome") return false;
  if (hit.kind === "robotics-workspace-action") return !!(hit.cell || hit.id);
  return ["robotics-action", "robotics-drag", "robotics-rotate"].includes(hit.kind);
}

/** Face buttons/sticks stay with robotics; Studio keeps grip and real menu triggers. */
export function studioRoboticsInputAllowed({ armed = false, control = "", uiHit = false, hit = null, astraTalk = false } = {}) {
  if (!armed) return true;
  if (control === "grip") return true;
  if (control !== "trigger") return false;
  const kind = String(hit?.kind || "");
  if (kind.startsWith("robotics")) return studioRoboticsUiHit(hit);
  // xrctrl1: empty DimOS visor must not eat trigger while Astra is live.
  if (astraTalk === true && !studioRoboticsUiHit(hit)) return true;
  return uiHit === true;
}
