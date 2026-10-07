export const ROBOT_START_POSITION_KEY = "render3d:robot-start-position:v1";
export const ROBOTICS_HOME_START_POSITION_KEY = "render3d:robotics-home-start-position:v1";

const homePosition = () => ({ type: "home", id: "home", name: "Home · arms down", runnable: true });
const text = (value) => String(value ?? "").trim();

export function startPositionValue(position) {
  return `${position.type}:${position.id}`;
}

export function buildStartPositions(workspace = {}, emotes = {}) {
  const positions = [homePosition()];
  for (const preset of Array.isArray(workspace?.presets) ? workspace.presets : []) {
    const id = text(preset?.id);
    if (!id) continue;
    positions.push({
      type: "viser",
      id,
      name: text(preset.name) || `Viser ${id}`,
      role: ["init", "current", "home"].includes(preset.role) ? preset.role : "current",
      runnable: false,
      reason: "Viser presets are visual planning targets, not validated robot trajectories.",
    });
  }
  const seen = new Set();
  for (const emote of [...(Array.isArray(emotes?.recordings) ? emotes.recordings : []), ...(Array.isArray(emotes?.loops) ? emotes.loops : [])]) {
    const id = text(emote?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    positions.push({ type: "emote", id, name: text(emote.name || emote.label) || id, runnable: true });
  }
  return positions;
}

export function readStartPosition(storage = globalThis.localStorage) {
  for (const key of [ROBOTICS_HOME_START_POSITION_KEY, ROBOT_START_POSITION_KEY]) {
    try {
      const value = JSON.parse(storage?.getItem(key) || "null");
      if (value?.type === "emote" && text(value.id)) return { type: "emote", id: text(value.id), name: text(value.name) || text(value.id) };
      if (value?.type === "viser" && text(value.id)) return { type: "viser", id: text(value.id), name: text(value.name) || text(value.id), role: text(value.role) || "current" };
      if (value?.type === "home") return homePosition();
    } catch { /* Try the shared XR selection, then fall back to Home. */ }
  }
  return homePosition();
}

export function saveStartPosition(position, storage = globalThis.localStorage) {
  const next = position?.type === "emote"
    ? { type: "emote", id: text(position.id), name: text(position.name) || text(position.id) }
    : position?.type === "viser"
      ? { type: "viser", id: text(position.id), name: text(position.name) || text(position.id), role: text(position.role) || "current" }
      : { type: "home", id: "home", name: "Home" };
  try {
    storage?.setItem(ROBOTICS_HOME_START_POSITION_KEY, JSON.stringify(next));
    if (next.type !== "viser") storage?.setItem(ROBOT_START_POSITION_KEY, JSON.stringify(next));
  } catch { /* The selection still works for this page when storage is unavailable. */ }
  return next;
}

export async function runGuardedStartSequence({ position, stopAll, home, waitForHome, playEmote, waitForEmote }) {
  if (!position?.runnable) throw new Error(position?.reason || "This starting position cannot run on hardware.");
  await stopAll();
  await home();
  await waitForHome();
  if (position.type === "emote") {
    const accepted = await playEmote(position.id);
    await waitForEmote(accepted);
  }
  return { position, ranMotion: position.type === "emote" };
}
