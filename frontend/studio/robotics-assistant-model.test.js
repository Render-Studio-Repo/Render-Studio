import test from "node:test";
import assert from "node:assert/strict";
import { mountRoboticsAssistantModel, roboticsAssistantModelSummary } from "./robotics-assistant-model.js";

test("robotics assistant hover reports the selected prompt model and subscription preference", () => {
  assert.deepEqual(roboticsAssistantModelSummary(
    { model: "gpt-6-astra", source: "chatgpt" },
    { modelLabel: "Astra", transport: "turn" },
  ), {
    label: "gpt-6-astra",
    title: "Reasoning: gpt-6-astra\nVoice: Astra\nBilling: connected subscription preferred\nOpen the gear to change voice and context settings.",
  });
});

test("robotics assistant gear opens settings without toggling the Hey AI control", () => {
  const listeners = new Map();
  const label = { textContent: "" };
  const root = {
    dataset: {},
    title: "",
    querySelector: () => label,
    addEventListener(type, fn) { listeners.set(type, fn); },
    setAttribute() {},
  };
  const gear = {
    title: "",
    addEventListener(type, fn) { listeners.set(`gear:${type}`, fn); },
  };
  let opened = 0;
  let stopped = 0;
  mountRoboticsAssistantModel({
    root,
    gear,
    getPromptModel: () => ({model: "gpt-6-astra", source: "chatgpt"}),
    getVoiceState: () => ({modelLabel: "Astra"}),
    openSettings: () => { opened += 1; },
  });
  listeners.get("gear:click")({stopPropagation() { stopped += 1; }});
  assert.equal(opened, 1);
  assert.equal(stopped, 1);
  assert.equal(label.textContent, "gpt-6-astra");
});
