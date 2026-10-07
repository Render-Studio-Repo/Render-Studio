import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  XR_CONTROL_HEADSETS,
  XR_CONTROL_MAP_EVENT,
  resetXrControlMapCache,
  readXrControlStore,
  setXrControlHeadset,
  remapXrControlAction,
  resetXrControlMap,
  mappedButtonIndex,
  gamepadActionPressed,
  gamepadButtonDown,
  gamepadMenuComponentHeld,
  XR_PROFILE_MENU_BUTTON,
  xrControlId,
  xrControlHudLabelFromId,
  xrAxesControlId,
  beginXrControlListen,
  tickXrControlListen,
  cancelXrControlListen,
  vrControlsSettingsLines,
  xrControlMapPrefsHtml,
  persistXrControlStore,
  applyXrLiveControlDoc,
  xrLiveSessionActive,
  XRCTRL2_CACHE,
  XR_CONTROL_MAP_KEY,
} from "./xr-control-map.js";
import { SETTINGS_PANEL_TAB_IDS } from "./xr-hot-path.js?v=roboticsworkspace3";

const here = dirname(fileURLToPath(import.meta.url));
const mem = new Map();

beforeEach(() => {
  mem.clear();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
  resetXrControlMapCache();
});

test("headset switch auto-saves a per-headset profile", () => {
  remapXrControlAction("laser", 1, "quest3");
  assert.equal(mappedButtonIndex("laser", "quest3"), 1);
  setXrControlHeadset("pico");
  assert.equal(readXrControlStore().headset, "pico");
  assert.equal(mappedButtonIndex("laser", "pico"), 5);
  assert.equal(mappedButtonIndex("laser", "quest3"), 1);
});

test("reset VR controls restores defaults for the active headset", () => {
  setXrControlHeadset("quest2");
  remapXrControlAction("menu", 0);
  assert.equal(mappedButtonIndex("menu"), 0);
  resetXrControlMap();
  assert.equal(mappedButtonIndex("menu"), 4);
  assert.equal(mappedButtonIndex("laser"), 5);
  assert.equal(mappedButtonIndex("stickClick"), 3);
});

test("listen maps the next physical press and ignores tilt axes", () => {
  beginXrControlListen("laser", { now: 0 });
  const gp = {
    buttons: [{ pressed: false }, { pressed: false }, {}, { pressed: false }, { pressed: false }, { pressed: true, value: 1 }],
    axes: [0.9, 0.2, 0, 0],
  };
  const first = tickXrControlListen({ gamepads: [gp], now: 10 });
  assert.equal(first.mapped, true);
  assert.equal(first.btn, 5);
  assert.equal(mappedButtonIndex("laser"), 5);
  cancelXrControlListen();
  beginXrControlListen("laser", { now: 0 });
  const analog = {
    buttons: [
      { pressed: false, value: 0.9 },
      { pressed: false, value: 0.8 },
      {},
      { pressed: false, value: 0.9 },
      { pressed: false, value: 0.9 },
      { pressed: false, value: 0.9 },
      { pressed: false, value: 0.9 },
      { pressed: false, value: 0.9 },
    ],
    axes: [0.9, 0.2, 0, 0],
  };
  const ignored = tickXrControlListen({ gamepads: [analog], now: 10 });
  assert.equal(ignored.listening, true);
  assert.equal(ignored.mapped, undefined);
  cancelXrControlListen();
});

test("human control ids and analog value is not a digital press", () => {
  assert.equal(xrControlId(0, "right"), "rightTrigger");
  assert.equal(xrControlId(1, "left"), "leftSqueeze");
  assert.equal(xrControlId(7, "left"), "leftMenu");
  assert.equal(xrControlId(3, "right"), "rightStickClick");
  assert.equal(xrAxesControlId("right"), "rightAxes");
  assert.equal(xrControlHudLabelFromId("rightTrigger"), "right trigger");
  assert.equal(xrControlHudLabelFromId("leftMenu"), "left menu");
  assert.equal(xrControlHudLabelFromId("rightStickClick"), "right stick click");
  assert.equal(xrControlHudLabelFromId("rightAxes"), "right stick move");
  assert.equal(xrControlHudLabelFromId("rightA"), "right A");
  assert.equal(xrControlHudLabelFromId("leftX"), "left X");
  assert.equal(gamepadButtonDown({ buttons: [{ pressed: false, value: 0.9 }] }, 0), false);
  assert.equal(gamepadButtonDown({ buttons: [{ pressed: true, value: 0.2 }] }, 0), true);
  assert.equal(XR_PROFILE_MENU_BUTTON, 7);
  const onlyMenu = [];
  for (let i = 0; i < 13; i += 1) onlyMenu.push({ pressed: false, value: i === 7 ? 0.95 : 0 });
  assert.equal(gamepadMenuComponentHeld({ buttons: onlyMenu }, 7), false);
  const ghost = [];
  for (let i = 0; i < 13; i += 1) ghost.push({ pressed: false, value: i >= 7 && i <= 10 ? 0.9 : 0 });
  assert.equal(gamepadMenuComponentHeld({ buttons: ghost }, 7), false);
  assert.equal(gamepadMenuComponentHeld({
    buttons: onlyMenu.map((b, i) => (i === 7 ? { pressed: true, value: 1 } : b)),
  }, 7), true);
});

test("VR settings lines and prefs HTML list live bindings", () => {
  const lines = vrControlsSettingsLines({ headset: "quest3", dockLeft: true });
  assert.ok(lines.some((l) => l.id === "xr_map_headset"));
  assert.ok(lines.some((l) => l.id === "xr_map:laser"));
  assert.ok(lines.some((l) => l.id === "xr_map:restart"));
  assert.ok(lines.some((l) => l.id === "xr_restart_now"));
  assert.ok(lines.some((l) => l.id === "xr_map_reset"));
  const html = xrControlMapPrefsHtml({ headset: "quest3" });
  assert.match(html, /pref-xr-headset/);
  assert.match(html, /Hold B/);
  assert.match(html, /Hold left ☰ \(indented Menu, not X\) 3s/);
  assert.match(html, /Both sticks/);
  assert.ok(lines.some((l) => /Left menu · 3s/.test(l.label)));
  assert.ok(XR_CONTROL_HEADSETS.some((h) => h.id === "quest3s"));
  assert.ok(SETTINGS_PANEL_TAB_IDS.includes("controls"));
  persistXrControlStore({ headset: "quest3" });
  assert.equal(XR_CONTROL_MAP_EVENT, "render3d:xr-control-map");
});

test("gamepadActionPressed uses remapped index", () => {
  remapXrControlAction("trigger", 2);
  const gp = { buttons: [{ pressed: false }, {}, { pressed: true, value: 1 }] };
  assert.equal(gamepadActionPressed(gp, "trigger"), true);
  assert.equal(gamepadActionPressed({ buttons: [{ pressed: true }] }, "trigger"), false);
});

test("remapped restart becomes a live button and is not the debugger hold", () => {
  assert.equal(mappedButtonIndex("restart"), 7);
  remapXrControlAction("restart", 0, "quest3");
  const store = readXrControlStore();
  assert.equal(store.profiles.quest3.restart.kind, "button");
  assert.equal(mappedButtonIndex("restart"), 0);
  assert.equal(mappedButtonIndex("stickClick"), 3);
});

test("docs and prefs chrome mention VR Controls remapper", () => {
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const gs = readFileSync(join(here, "../pages/getting-started.html"), "utf8");
  assert.match(app, /pref-xr-headset|xrControlMapPrefsHtml/);
  assert.match(app, /Reset VR controls/);
  assert.match(app, /Reset mouse controls/);
  assert.match(gs, /#vr-controls/);
});

test("live overlay remaps the current session without persisting until apply_scene", () => {
  persistXrControlStore({ headset: "quest3" });
  assert.equal(mappedButtonIndex("trigger"), 0);
  applyXrLiveControlDoc({
    simulate: true,
    listen: true,
    apply_scene: false,
    wire_status: "idle",
    rev: 3,
    headset: "quest3",
    profiles: { quest3: { trigger: { btn: 2, kind: "button" }, squeeze: { btn: 1, kind: "button" } } },
  });
  assert.equal(XRCTRL2_CACHE, "xrctrl2");
  assert.equal(xrLiveSessionActive(), true);
  assert.equal(mappedButtonIndex("trigger"), 2);
  const saved = JSON.parse(globalThis.localStorage.getItem(XR_CONTROL_MAP_KEY));
  assert.equal(saved.profiles.quest3.trigger.btn, 0);
});
