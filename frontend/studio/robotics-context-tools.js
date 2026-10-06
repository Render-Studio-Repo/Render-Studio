export function isRoboticsHomeActive(tab, roboticsHomeTabId) {
  return Boolean(tab && (tab.id === roboticsHomeTabId || tab.kind === "robotics-home"));
}

export function syncRoboticsContextTools({ panel, tabButton, fallbackTabButton, activeTab, roboticsHomeTabId } = {}) {
  const active = isRoboticsHomeActive(activeTab, roboticsHomeTabId);
  panel?.classList.toggle("robotics-home-tools", active);
  panel?.setAttribute("aria-label", active ? "Robotics tools" : "Direct modeling tools");
  tabButton?.classList.toggle("hidden", !active);
  if (active) tabButton?.removeAttribute("hidden");
  else {
    tabButton?.setAttribute("hidden", "");
    tabButton?.setAttribute("aria-hidden", "true");
    if (tabButton?.classList.contains("active")) fallbackTabButton?.click?.();
  }
  if (active) tabButton?.removeAttribute("aria-hidden");
  return active;
}

export function bindRoboticsContextTools({ panel, runAction, openHeyAi, openRenderAgent } = {}) {
  if (!panel || panel.dataset.roboticsToolsBound === "true") return;
  panel.dataset.roboticsToolsBound = "true";
  panel.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-robotics-tool-action]");
    if (actionButton && panel.contains(actionButton)) {
      void runAction?.(actionButton.dataset.roboticsToolAction, actionButton);
      return;
    }
    if (event.target.closest("[data-robotics-tool-hey-ai]")) openHeyAi?.();
    if (event.target.closest("[data-robotics-tool-agent]")) openRenderAgent?.();
  });
}
