import test from "node:test";
import assert from "node:assert/strict";
import { bindRoboticsContextTools, isRoboticsHomeActive, syncRoboticsContextTools } from "./robotics-context-tools.js";

function classList() {
  const values = new Set();
  return {
    toggle(name, enabled) { enabled ? values.add(name) : values.delete(name); },
    contains(name) { return values.has(name); },
  };
}

function button(active = false) {
  const attrs = new Map();
  const classes = classList();
  classes.toggle("active", active);
  return {
    classList: classes,
    setAttribute(name, value) { attrs.set(name, value); },
    removeAttribute(name) { attrs.delete(name); },
    hasAttribute(name) { return attrs.has(name); },
  };
}

test("Robotics Home alone switches the shared Tools panel to robotics", () => {
  const panel = { classList: classList(), setAttribute(name, value) { this[name] = value; } };
  const tabButton = button();
  assert.equal(syncRoboticsContextTools({ panel, tabButton, activeTab: { id: "robot-home", kind: "robotics-home" }, roboticsHomeTabId: "robot-home" }), true);
  assert.equal(panel.classList.contains("robotics-home-tools"), true);
  assert.equal(panel["aria-label"], "Robotics tools");
  assert.equal(tabButton.classList.contains("hidden"), false);
  assert.equal(tabButton.hasAttribute("hidden"), false);
  assert.equal(syncRoboticsContextTools({ panel, tabButton, activeTab: { id: "viewport", kind: "viewport" }, roboticsHomeTabId: "robot-home" }), false);
  assert.equal(panel.classList.contains("robotics-home-tools"), false);
  assert.equal(panel["aria-label"], "Direct modeling tools");
  assert.equal(tabButton.classList.contains("hidden"), true);
  assert.equal(tabButton.hasAttribute("hidden"), true);
  assert.equal(isRoboticsHomeActive({ id: "viewport" }, "robot-home"), false);
});

test("leaving Robotics Home returns an open Robotics rail to AI", () => {
  const tabButton = button(true);
  let fallbackClicks = 0;
  syncRoboticsContextTools({
    panel: { classList: classList(), setAttribute() {} },
    tabButton,
    fallbackTabButton: { click: () => { fallbackClicks += 1; } },
    activeTab: { id: "viewport", kind: "viewport" },
    roboticsHomeTabId: "robot-home",
  });
  assert.equal(fallbackClicks, 1);
});

test("robotics tool clicks route through the shared action boundary", async () => {
  let listener;
  let action = "";
  const button = { dataset: { roboticsToolAction: "open_cameras" } };
  const panel = {
    dataset: {},
    contains: () => true,
    addEventListener: (_name, next) => { listener = next; },
  };
  bindRoboticsContextTools({ panel, runAction: (id) => { action = id; } });
  listener({ target: { closest: (selector) => selector === "[data-robotics-tool-action]" ? button : null } });
  await Promise.resolve();
  assert.equal(action, "open_cameras");
});
