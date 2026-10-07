const SUBSCRIPTION_SOURCES = new Set(["chatgpt", "subscription", "cursor", "claude"]);

export function roboticsAssistantModelSummary(promptModel = {}, voiceState = {}) {
  const reasoningModel = String(promptModel.model || "Selected AI prompt model").trim();
  const voiceModel = String(voiceState.modelLabel || voiceState.modelId || "Voice auto").trim();
  const subscription = SUBSCRIPTION_SOURCES.has(String(promptModel.source || "").toLowerCase());
  return {
    label: reasoningModel,
    title: `Reasoning: ${reasoningModel}\nVoice: ${voiceModel}\nBilling: ${subscription ? "connected subscription preferred" : "selected AI key"}\nOpen the gear to change voice and context settings.`,
  };
}

export function mountRoboticsAssistantModel({ root, gear, getPromptModel, getVoiceState, openSettings } = {}) {
  if (!root || root.dataset.assistantModelBound === "true") return { refresh() {} };
  root.dataset.assistantModelBound = "true";
  const label = root.querySelector("[data-robotics-assistant-model]");
  const refresh = () => {
    const summary = roboticsAssistantModelSummary(getPromptModel?.(), getVoiceState?.());
    if (label) label.textContent = summary.label;
    root.title = summary.title;
    root.setAttribute("aria-description", summary.title.replaceAll("\n", ". "));
    if (gear) gear.title = `Voice and context settings\n${summary.title}`;
  };
  root.addEventListener("mouseenter", refresh);
  root.addEventListener("focus", refresh, true);
  gear?.addEventListener("click", (event) => { event.stopPropagation(); openSettings?.(); });
  refresh();
  return { refresh };
}
