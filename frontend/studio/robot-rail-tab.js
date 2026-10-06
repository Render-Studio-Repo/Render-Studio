/** Right-rail Robot tab (ROBOT TELEOP) — auto-activate without fighting AI clicks. */

const RELEVANT_STATUS = new Set(["armed", "connecting", "connected", "engaged"]);

export function isRobotTeleopRelevant(snap = {}) {
  if (!snap || typeof snap !== "object") return false;
  if (snap.armed || snap.connected || snap.presenting) return true;
  if (RELEVANT_STATUS.has(String(snap.statusKey || ""))) return true;
  if (snap.showViewer) return true;
  const viewer = snap.viewer || {};
  if (viewer.hasVideo || viewer.leftLive || viewer.rightLive) return true;
  return false;
}

export function shouldShowRobotRailTab(snap, { currentTab = "", roboticsDesignTab = false, force = false } = {}) {
  return force || roboticsDesignTab || currentTab === "robot" || isRobotTeleopRelevant(snap);
}

export function shouldAutoActivateRobotTab(snap, {
  currentTab = "",
  userPinned = false,
  wasRelevant = false,
  force = false,
} = {}) {
  if (force) return true;
  if (!isRobotTeleopRelevant(snap)) return false;
  if (currentTab === "robot") return false;
  if (userPinned) return false;
  if (wasRelevant) return false;
  return true;
}

export function createRobotRailTabController({
  getCurrentTab,
  isRoboticsDesignTab,
  activateRobotTab,
  revealRobotTab,
  hideRobotTab,
} = {}) {
  let userPinned = false;
  let wasRelevant = false;

  function noteUserTab(tab) {
    userPinned = !!(tab && tab !== "robot");
  }

  function sync(snap = {}, { force = false } = {}) {
    const currentTab = getCurrentTab?.() || "";
    const roboticsDesignTab = !!isRoboticsDesignTab?.();
    const relevant = isRobotTeleopRelevant(snap);
    const show = shouldShowRobotRailTab(snap, { currentTab, roboticsDesignTab, force });
    if (show) revealRobotTab?.();
    else hideRobotTab?.();

    const should = shouldAutoActivateRobotTab(snap, {
      currentTab,
      userPinned,
      wasRelevant,
      force,
    });
    if (should) {
      userPinned = false;
      activateRobotTab?.();
    }
    wasRelevant = relevant;
    if (!relevant && !force) userPinned = false;
    return should;
  }

  return {
    noteUserTab,
    sync,
    get userPinned() { return userPinned; },
    get wasRelevant() { return wasRelevant; },
  };
}
