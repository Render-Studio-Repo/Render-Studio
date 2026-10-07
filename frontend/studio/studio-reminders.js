/** First-run “don’t show again” tips shared by Welcome, Canvas, AI setup, and similar Studio popups. */

export const STUDIO_REMINDER_KEY_PREFIXES = [
  "render3d:welcomeSeen:v1",
  "render3d:vrEnterSpotlightSeen:v1",
  "render3d:aiSetupIntroDismissed:v1",
  "render3d:trialCreditsPopupSeen:v1",
  "render3d:modelPickRecommendSeen:v2",
  "render3d:firstProjectPromptOnboarding:v1",
  "render3d:googleNewUserWalkthrough:v1",
  "render3d:fusionUnlinkHowtoDismissed:v1",
  "render3d:canvasSaveHintSeen:v1",
  "render3d:recordDoneHintSeen:v1",
  "render3d:sharedProjectsHintSeen:v1",
];

export const CANVAS_SAVE_HINT_KEY = "render3d:canvasSaveHintSeen:v1";
export const RECORD_DONE_HINT_KEY = "render3d:recordDoneHintSeen:v1";
export const SHARED_PROJECTS_HINT_KEY = "render3d:sharedProjectsHintSeen:v1";

export const RESTORE_REMINDERS_TIP =
  "Brings back Welcome, Canvas save location, recording editor tip, shared-projects location, AI setup, model picker, Fusion unlink, trial credits, and similar Don’t show again tips for this profile.";

function storageKey(prefix, userId) {
  return userId ? `${prefix}:${userId}` : prefix;
}

export function reminderHasSeen(prefix, userId) {
  try {
    if (localStorage.getItem(prefix) === "1") return true;
    if (userId && localStorage.getItem(storageKey(prefix, userId)) === "1") return true;
    return false;
  } catch {
    return false;
  }
}

export function reminderMarkSeen(prefix, userId) {
  try {
    localStorage.setItem(prefix, "1");
    if (userId) localStorage.setItem(storageKey(prefix, userId), "1");
  } catch {
    /* ignore */
  }
}

export function restoreStudioReminders(userId) {
  const removed = [];
  try {
    const extra = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("render3d:")) continue;
      if (STUDIO_REMINDER_KEY_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) {
        extra.push(key);
      }
    }
    for (const prefix of STUDIO_REMINDER_KEY_PREFIXES) {
      extra.push(prefix);
      if (userId) extra.push(storageKey(prefix, userId));
    }
    for (const key of new Set(extra)) {
      if (localStorage.getItem(key) != null) {
        localStorage.removeItem(key);
        removed.push(key);
      }
    }
  } catch {
    /* ignore */
  }
  return removed;
}
