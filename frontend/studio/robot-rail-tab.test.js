import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isRobotTeleopRelevant,
  shouldShowRobotRailTab,
  shouldAutoActivateRobotTab,
  createRobotRailTabController,
} from "./robot-rail-tab.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "styles.css"), "utf8");
const app = readFileSync(join(here, "app.js"), "utf8");

test("Robot teleop is relevant when armed, connected, headset-pending, or cameras live", () => {
  assert.equal(isRobotTeleopRelevant({}), false);
  assert.equal(isRobotTeleopRelevant({ armed: true, statusKey: "armed" }), true);
  assert.equal(isRobotTeleopRelevant({ connected: true, statusKey: "connected" }), true);
  assert.equal(isRobotTeleopRelevant({ statusKey: "engaged" }), true);
  assert.equal(isRobotTeleopRelevant({ presenting: true }), true);
  assert.equal(isRobotTeleopRelevant({ showViewer: true }), true);
  assert.equal(isRobotTeleopRelevant({ viewer: { leftLive: true } }), true);
  assert.equal(isRobotTeleopRelevant({ viewer: { hasVideo: true } }), true);
  assert.equal(isRobotTeleopRelevant({ recognized: true, statusKey: "off" }), false);
});

test("Robot tab auto-activates on entry, not after the user pins AI", () => {
  const armed = { armed: true, statusKey: "armed" };
  assert.equal(shouldAutoActivateRobotTab(armed, { currentTab: "prompt" }), true);
  assert.equal(shouldAutoActivateRobotTab(armed, { currentTab: "robot" }), false);
  assert.equal(shouldAutoActivateRobotTab(armed, { currentTab: "prompt", wasRelevant: true }), false);
  assert.equal(shouldAutoActivateRobotTab(armed, { currentTab: "prompt", userPinned: true }), false);
  assert.equal(shouldAutoActivateRobotTab(armed, { currentTab: "prompt", userPinned: true, force: true }), true);
  assert.equal(shouldAutoActivateRobotTab({ statusKey: "off" }, { currentTab: "prompt" }), false);
  assert.equal(shouldShowRobotRailTab(armed, { currentTab: "prompt" }), true);
  assert.equal(shouldShowRobotRailTab({}, { currentTab: "prompt" }), false);
  assert.equal(shouldShowRobotRailTab({}, { roboticsDesignTab: true }), true);
});

test("controller activates Robot once per teleop session and honors AI clicks", () => {
  const tabs = { current: "prompt", robotics: false };
  const log = [];
  const ctl = createRobotRailTabController({
    getCurrentTab: () => tabs.current,
    isRoboticsDesignTab: () => tabs.robotics,
    activateRobotTab: () => { tabs.current = "robot"; log.push("activate"); },
    revealRobotTab: () => log.push("reveal"),
    hideRobotTab: () => log.push("hide"),
  });

  assert.equal(ctl.sync({ statusKey: "off" }), false);
  assert.ok(log.includes("hide"));

  log.length = 0;
  assert.equal(ctl.sync({ armed: true, statusKey: "armed" }), true);
  assert.deepEqual(log.filter((x) => x === "activate"), ["activate"]);
  assert.equal(tabs.current, "robot");

  log.length = 0;
  assert.equal(ctl.sync({ armed: true, statusKey: "connected", connected: true }), false);
  assert.equal(log.includes("activate"), false);

  ctl.noteUserTab("prompt");
  tabs.current = "prompt";
  log.length = 0;
  assert.equal(ctl.sync({ armed: true, statusKey: "armed" }), false);
  assert.equal(log.includes("activate"), false);

  log.length = 0;
  tabs.robotics = true;
  assert.equal(ctl.sync({ armed: true, statusKey: "armed" }, { force: true }), true);
  assert.ok(log.includes("activate"));
});

test("studio wires Robot rail auto-activate and cache-busts robotauto1", () => {
  assert.match(html, /data-right-tab="robot"/);
  assert.match(html, /data-right-panel="robot"/);
  assert.match(html, /robotauto1/);
  assert.match(app, /createRobotRailTabController/);
  assert.match(app, /robotRailTab\.sync/);
  assert.match(app, /robotRailTab\.noteUserTab/);
  assert.match(app, /robot-rail-tab\.js\?v=robotauto1/);
  assert.match(css, /#app\.robot-rail-tab \.right-panel-tab\[data-right-tab="robot"\]/);
  assert.match(css, /#app\.robot-rail-tab \.right-panel-tabs/);
});
