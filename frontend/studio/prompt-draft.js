/** Pure helpers for AI compose draft restore (no DOM). */

/** Global localStorage keys that copied one prompt into every project. */
export const LEAKED_GLOBAL_COMPOSE_KEYS = Object.freeze([
  "render3d:aiComposeDraft:v1",
  "render3d:lastPrompt",
  "render3d:lastPrompt:v1",
  "promptDraft",
  "render3d:promptDraft",
]);

export function pickComposeRestorePrompt({ stored = "", live = "", allowLiveFallback = false } = {}) {
  const storedText = String(stored ?? "");
  const liveText = String(live ?? "");
  if (storedText.trim()) return storedText;
  if (allowLiveFallback) return liveText;
  return "";
}

export function shouldPersistComposeSnapshot(snapshot, existing, { forceEmpty = false, protectExisting = false } = {}) {
  if (forceEmpty) return true;
  if (!protectExisting) return true;
  const next = String(snapshot?.prompt ?? "");
  const prev = String(existing?.prompt ?? "");
  if (!next.trim() && prev.trim()) return false;
  return true;
}

/**
 * Switching projects always wipes the live box, then restore loads that
 * project's stored draft or empty. Same-project reopen keeps the box.
 */
export function shouldWipeComposeUiOnProjectOpen({
  prevProjectId = "",
  nextProjectId = "",
} = {}) {
  const prev = String(prevProjectId || "").trim();
  const next = String(nextProjectId || "").trim();
  if (!next) return false;
  return prev !== next;
}
