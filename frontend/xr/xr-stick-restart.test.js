import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bothThumbsticksClicked,
  bothSticksHeld,
  debuggerEnterHeld,
  leftStickOnlyHeld,
  leftMenuOnlyHeld,
  leftMenuButtonDown,
  leftMenuHoldSource,
  leftMenuSourcesPosed,
  thumbstickTiltOnly,
  tickStickRestart,
  tickLeftMenuRestart,
  tickExitVrHold,
  emptyStickRestartState,
  emptyLeftMenuRestartState,
  paintExitVrHoldCircle,
  consumeXrSoftResume,
  xrSoftReloadHref,
  stripXrSoftResumeQuery,
  offerXrSessionForSoftReload,
  xrSoftResumeShouldRestart,
  xrIgnoreStickyPress,
  XR_DEBUGGER_HOLD_LABEL,
  XR_STICK_RESTART_LABEL,
  XR_LEFT_MENU_BUTTON,
  XR_LEFT_MENU_EXTRA,
  XR_LEFT_MENU_RESTART_HOLD_MS,
  XR_LEFT_MENU_RESTART_EVENT,
  XR_EXIT_VR_HOLD_MS,
  XR_EXIT_VR_HOLD_EVENT,
  XR_DEBUGGER_CACHE,
  XR_LEFT_MENU_RESTART_CACHE,
  XR_IN_SESSION_RESTART_CACHE,
  XR_LEFT_MENU_RESTART_SETTLE_FRAMES,
  XR_ENTER_STICKY_IGNORE_MS,
  XR_SOFT_RESUME_KEY,
} from "./xr-stick-restart.js";

const here = dirname(fileURLToPath(import.meta.url));

function buttons({ stick = false, menu = false, extra = false, x = false, n = 8 } = {}) {
  const list = [];
  for (let i = 0; i < n; i += 1) {
    const on = (i === 3 && stick)
      || (i === 4 && x)
      || (i === XR_LEFT_MENU_BUTTON && menu)
      || (i === XR_LEFT_MENU_EXTRA && extra);
    list.push({ pressed: on, value: on ? 1 : 0 });
  }
  return list;
}

function pad({
  handedness = "right",
  pressed = false,
  axes = [0, 0, 0, 0],
  menu = false,
  extra = false,
  x = false,
  n = 8,
} = {}) {
  return {
    handedness,
    gamepad: {
      mapping: "xr-standard",
      buttons: buttons({ stick: pressed, menu, extra, x, n }),
      axes,
    },
  };
}

test("tilt / stick Y-up is never debugger; L3+R3 click is", () => {
  const tilted = [
    pad({ handedness: "left", pressed: false, axes: [0, -0.95, 0, 0] }),
    pad({ handedness: "right", pressed: false, axes: [0, -0.9, 0, 0] }),
  ];
  assert.equal(bothThumbsticksClicked(tilted), false);
  assert.equal(thumbstickTiltOnly(tilted[0].gamepad), true);
  assert.equal(bothSticksHeld(tilted), true);
  assert.equal(debuggerEnterHeld(tilted), false);
  assert.equal(leftMenuOnlyHeld(tilted), false);
  const oneClick = [
    pad({ handedness: "left", pressed: true }),
    pad({ handedness: "right", pressed: false }),
  ];
  assert.equal(debuggerEnterHeld(oneClick), false);
  const both = [
    pad({ handedness: "left", pressed: true }),
    pad({ handedness: "right", pressed: true }),
  ];
  assert.equal(bothThumbsticksClicked(both), true);
  assert.equal(debuggerEnterHeld(both), true);
});

test("left stick tilt is not the restart gesture", () => {
  const leftOnly = [
    pad({ handedness: "left", pressed: false, axes: [0.9, 0, 0, 0] }),
    pad({ handedness: "right", pressed: false, axes: [0, 0, 0, 0] }),
  ];
  assert.equal(leftStickOnlyHeld(leftOnly), true);
  assert.equal(leftMenuOnlyHeld(leftOnly), false);
  assert.equal(debuggerEnterHeld(leftOnly), false);
});

test("left menu 3s hold completes restart; early release cancels", () => {
  const leftMenu = [
    pad({ handedness: "left", menu: true }),
    pad({ handedness: "right" }),
  ];
  assert.equal(XR_LEFT_MENU_BUTTON, 7);
  assert.equal(leftMenuButtonDown(leftMenu[0].gamepad), true);
  assert.equal(leftMenuOnlyHeld(leftMenu), true);
  assert.equal(debuggerEnterHeld(leftMenu), false);

  let tick = tickStickRestart({
    bothDown: true,
    now: 10,
    state: emptyStickRestartState(),
    holdMs: XR_LEFT_MENU_RESTART_HOLD_MS,
  });
  assert.equal(tick.showing, true);
  assert.equal(tick.complete, false);
  tick = tickStickRestart({
    bothDown: true,
    now: 10 + XR_LEFT_MENU_RESTART_HOLD_MS,
    state: tick.next,
    holdMs: XR_LEFT_MENU_RESTART_HOLD_MS,
  });
  assert.equal(tick.complete, true);
  assert.equal(tick.progress, 1);

  let early = tickStickRestart({
    bothDown: true,
    now: 10,
    state: emptyStickRestartState(),
    holdMs: XR_LEFT_MENU_RESTART_HOLD_MS,
  });
  early = tickStickRestart({
    bothDown: false,
    now: 800,
    state: early.next,
    holdMs: XR_LEFT_MENU_RESTART_HOLD_MS,
  });
  assert.equal(early.cancelled, true);
  assert.equal(early.complete, false);
  assert.equal(early.showing, false);
});

test("enter VR with menu already down does not restart", () => {
  const settle = 3;
  const hold = XR_LEFT_MENU_RESTART_HOLD_MS;
  let state = emptyLeftMenuRestartState();
  let tick = tickLeftMenuRestart({
    held: true, posed: false, now: 0, state, holdMs: hold, settleFrames: settle,
  });
  state = tick.next;
  assert.equal(tick.complete, false);
  for (let i = 0; i < settle + 8; i += 1) {
    tick = tickLeftMenuRestart({
      held: true, posed: true, now: 50 + i * 16, state, holdMs: hold, settleFrames: settle,
    });
    state = tick.next;
    assert.equal(tick.complete, false);
    assert.equal(tick.showing, false);
  }
  tick = tickLeftMenuRestart({
    held: true, posed: true, now: 50 + hold + 400, state, holdMs: hold, settleFrames: settle,
  });
  assert.equal(tick.complete, false);
  assert.equal(tick.showing, false);
});

test("rising-edge 3s left menu restarts once; release before 3s does not", () => {
  const settle = 2;
  const hold = XR_LEFT_MENU_RESTART_HOLD_MS;
  let state = emptyLeftMenuRestartState();
  for (let i = 0; i < settle; i += 1) {
    const arm = tickLeftMenuRestart({
      held: false, posed: true, now: 20 + i, state, holdMs: hold, settleFrames: settle,
    });
    state = arm.next;
    assert.equal(arm.complete, false);
  }
  let tick = tickLeftMenuRestart({
    held: true, posed: true, now: 100, state, holdMs: hold, settleFrames: settle,
  });
  state = tick.next;
  assert.equal(tick.showing, true);
  assert.equal(tick.complete, false);

  tick = tickLeftMenuRestart({
    held: true, posed: true, now: 100 + 1200, state, holdMs: hold, settleFrames: settle,
  });
  state = tick.next;
  assert.equal(tick.complete, false);
  assert.equal(tick.showing, true);

  tick = tickLeftMenuRestart({
    held: true, posed: true, now: 100 + hold, state, holdMs: hold, settleFrames: settle,
  });
  state = tick.next;
  assert.equal(tick.complete, true);
  assert.equal(tick.progress, 1);

  tick = tickLeftMenuRestart({
    held: true, posed: true, now: 100 + hold + 80, state, holdMs: hold, settleFrames: settle,
  });
  assert.equal(tick.complete, false);

  let early = emptyLeftMenuRestartState();
  for (let i = 0; i < settle; i += 1) {
    early = tickLeftMenuRestart({
      held: false, posed: true, now: 10 + i, state: early, holdMs: hold, settleFrames: settle,
    }).next;
  }
  let rel = tickLeftMenuRestart({
    held: true, posed: true, now: 40, state: early, holdMs: hold, settleFrames: settle,
  });
  rel = tickLeftMenuRestart({
    held: false, posed: true, now: 800, state: rel.next, holdMs: hold, settleFrames: settle,
  });
  assert.equal(rel.cancelled, true);
  assert.equal(rel.complete, false);
  assert.equal(rel.showing, false);
});

test("now=0 then large now does not instantly complete left-menu restart", () => {
  const settle = 1;
  const hold = XR_LEFT_MENU_RESTART_HOLD_MS;
  let state = tickLeftMenuRestart({
    held: false, posed: true, now: 1, state: emptyLeftMenuRestartState(), holdMs: hold, settleFrames: settle,
  }).next;
  let tick = tickLeftMenuRestart({
    held: true, posed: true, now: 0, state, holdMs: hold, settleFrames: settle,
  });
  tick = tickLeftMenuRestart({
    held: true, posed: true, now: hold + 500, state: tick.next, holdMs: hold, settleFrames: settle,
  });
  assert.equal(tick.complete, false);
});

test("touchpad is not left-menu restart; unposed sources are not posed", () => {
  const touch = pad({ handedness: "left" });
  touch.gamepad.buttons[2] = { pressed: true, value: 1 };
  assert.equal(leftMenuButtonDown(touch.gamepad), false);
  assert.equal(leftMenuOnlyHeld([touch, pad({ handedness: "right" })]), false);
  assert.equal(leftMenuSourcesPosed([touch]), false);
  touch.targetRaySpace = {};
  assert.equal(leftMenuSourcesPosed([touch]), true);
  assert.ok(XR_LEFT_MENU_RESTART_SETTLE_FRAMES >= 24);
  assert.equal(XR_ENTER_STICKY_IGNORE_MS, 400);
});

test("right A / left X do not restart; left ☰ does", () => {
  const rightA = [
    pad({ handedness: "left" }),
    pad({ handedness: "right", x: true }),
  ];
  assert.equal(leftMenuButtonDown(rightA[1].gamepad), false);
  assert.equal(leftMenuOnlyHeld(rightA), false);

  const leftX = [
    pad({ handedness: "left", x: true }),
    pad({ handedness: "right" }),
  ];
  assert.equal(leftMenuButtonDown(leftX[0].gamepad), false);
  assert.equal(leftMenuOnlyHeld(leftX), false);

  const extraMenu = [
    pad({ handedness: "left", extra: true, n: 8 }),
    pad({ handedness: "right", x: true }),
  ];
  assert.equal(leftMenuButtonDown(extraMenu[0].gamepad), true);
  assert.equal(leftMenuOnlyHeld(extraMenu), true);
});

test("click-hold both sticks enters debugger and does not imply restart", () => {
  const both = [
    pad({ handedness: "left", pressed: true }),
    pad({ handedness: "right", pressed: true }),
  ];
  assert.equal(bothThumbsticksClicked(both), true);
  assert.equal(debuggerEnterHeld(both), true);
  assert.equal(leftMenuOnlyHeld(both), false);
  let tick = tickStickRestart({ bothDown: true, now: 10, state: emptyStickRestartState(), holdMs: 1000 });
  tick = tickStickRestart({ bothDown: false, now: 400, state: tick.next, holdMs: 1000 });
  assert.equal(tick.cancelled, true);
  assert.equal(tick.complete, false);
  assert.equal(XR_DEBUGGER_HOLD_LABEL, "Loading debugger mode");
  assert.equal(XR_STICK_RESTART_LABEL, "Restart VR scene");
  assert.equal(XR_LEFT_MENU_RESTART_EVENT, "lmenu");
  assert.equal(XR_LEFT_MENU_RESTART_HOLD_MS, 3000);
});

test("Exit VR tap exits; 1.5s hold refreshes the scene inside VR", () => {
  assert.equal(XR_EXIT_VR_HOLD_MS, 1500);
  assert.equal(XR_EXIT_VR_HOLD_EVENT, "exitvr");
  let state = emptyStickRestartState();
  let tick = tickExitVrHold({ held: true, now: 1000, state });
  assert.equal(tick.showing, false);
  assert.equal(tick.tap, false);
  state = tick.next;
  tick = tickExitVrHold({ held: false, now: 1180, state });
  assert.equal(tick.tap, true);
  assert.equal(tick.complete, false);
  state = emptyStickRestartState();
  tick = tickExitVrHold({ held: true, now: 1000, state });
  state = tick.next;
  tick = tickExitVrHold({ held: true, now: 1400, state });
  assert.equal(tick.showing, true);
  assert.equal(tick.complete, false);
  tick = tickExitVrHold({ held: false, now: 1600, state: tick.next });
  assert.equal(tick.tap, false);
  assert.equal(tick.cancelled, true);
  state = emptyStickRestartState();
  tick = tickExitVrHold({ held: true, now: 1000, state });
  tick = tickExitVrHold({ held: true, now: 2500, state: tick.next });
  assert.equal(tick.complete, true);
  assert.equal(tick.tap, false);
  const calls = [];
  paintExitVrHoldCircle({
    clearRect: () => calls.push("clear"),
    beginPath() {},
    arc() { calls.push("arc"); },
    stroke() {},
  }, { progress: 0.5, size: 128 });
  assert.ok(calls.includes("clear"));
  assert.ok(calls.includes("arc"));
});

test("soft resume payload expires and reload href cache-busts xrsr", () => {
  assert.equal(consumeXrSoftResume({ t: 1 }, 50000), null);
  assert.equal(consumeXrSoftResume({ t: 10000 }, 12000).t, 10000);
  const href = xrSoftReloadHref("https://render3d.app/#viewport");
  assert.match(href, /xrsr=/);
  assert.match(href, /#viewport/);
  assert.equal(XR_SOFT_RESUME_KEY, "render3d:xrSoftResume");
  assert.equal(offerXrSessionForSoftReload({}), false);
  let offered = false;
  assert.equal(offerXrSessionForSoftReload({
    offerSession() { offered = true; },
  }), true);
  assert.equal(offered, true);
  assert.equal(xrSoftResumeShouldRestart(), false);
  const stripped = stripXrSoftResumeQuery(href);
  assert.equal(stripped.consumed, true);
  assert.equal(stripped.href.includes("xrsr"), false);
});

test("cache-bust xrrest2 merges with xrstick1 xrctl1 xrclick1 xrclick2", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const docs = readFileSync(join(here, "../site/vr-controls-docs.js"), "utf8");
  assert.equal(XR_LEFT_MENU_RESTART_CACHE, "xrrest2");
  assert.ok(html.includes("xrctl1"));
  assert.ok(html.includes("xrstick1"));
  assert.ok(html.includes("xrclick1"));
  assert.ok(html.includes("xrclick2"));
  assert.ok(html.includes("xrrest1"));
  assert.ok(html.includes("xrrest2"));
  assert.ok(html.includes("xrmap1"));
  assert.ok(html.includes("xrdbg1"));
  assert.ok(html.includes("xrdbg2"));
  assert.ok(html.includes("20260915-xrdbg1"));
  assert.ok(html.includes("20260915-xrdbg2"));
  assert.equal(XR_DEBUGGER_CACHE, "xrdbg2");
  assert.ok(html.includes("render3d:xrSoftResume"));
  assert.ok(html.includes("sessiongranted"));
  assert.ok(html.includes("Resuming VR"));
  assert.ok(html.includes('searchParams.delete("xrsr")'));
  assert.ok(html.includes("__xrSoftResumeConsumed"));
  assert.ok(app.includes("xrstick1"));
  assert.ok(app.includes("xrrest1"));
  assert.ok(app.includes("xrrest2"));
  assert.ok(app.includes("xrclick1"));
  assert.ok(app.includes("xrclick2"));
  assert.ok(app.includes("cams1"));
  assert.ok(xr.includes("pollLeftMenuRestart"));
  assert.ok(xr.includes("tickLeftMenuRestart"));
  assert.ok(xr.includes("leftMenuSourcesPosed"));
  assert.ok(xr.includes("leftRestartInputPosed"));
  assert.ok(xr.includes("softRefreshArmed"));
  assert.ok(xr.includes("leftMenuOnlyHeld"));
  assert.ok(xr.includes("leftMenuHoldSource"));
  assert.ok(xr.includes("xrIgnoreStickyPress"));
  assert.ok(xr.includes("XR_ENTER_STICKY_IGNORE_MS"));
  assert.ok(!xr.includes("pollLeftStickRestart"));
  assert.ok(!xr.includes("if (tick.complete) {\n      leftRestartPromptOpen = true"));
  assert.ok(xr.includes("XR_LEFT_MENU_RESTART_EVENT"));
  assert.ok(xr.includes("softRefreshVrStayInHeadset"));
  assert.ok(xr.includes("XR_STICK_RESTART_LABEL"));
  assert.ok(docs.includes("Hold the left indented Menu button"));
  assert.ok(!docs.includes("Hold the left analog stick only"));
});

test("XR scene refresh controls stay in immersive-vr and do not navigate", () => {
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const docs = readFileSync(join(here, "../site/vr-controls-docs.js"), "utf8");
  const soft = xr.slice(xr.indexOf("function softRefreshVrStayInHeadset"), xr.indexOf("function findExitVrHudButton"));
  const keep = xr.slice(xr.indexOf("async function restartVrSceneKeepSession"), xr.indexOf("function softRefreshVrStayInHeadset"));
  assert.ok(soft.includes("restartVrSceneKeepSession"));
  assert.equal(soft.includes("location.replace"), false);
  assert.equal(soft.includes("location.href"), false);
  assert.equal(soft.includes("offerXrSessionForSoftReload"), false);
  assert.equal(soft.includes("writeXrSoftResume"), false);
  assert.equal(xr.includes("function fullReloadVrAndResume"), false);
  assert.ok(xr.includes("softRefreshVrStayInHeadset({ ev: XR_EXIT_VR_HOLD_EVENT })"));
  assert.equal(keep.includes("session.end()"), false);
  assert.ok(keep.includes("Stay in this immersive-vr session"));
  assert.ok(docs.includes("immersive-vr session"));
  assert.ok(docs.includes("no splash"));
  assert.equal(XR_IN_SESSION_RESTART_CACHE, "20260915-xrmenu3");
  assert.ok(xr.includes("20260915-xrmenu3"));
  assert.ok(app.includes("exitvr=20260927-3"));
  assert.ok(html.includes("exitvr=20260927-3"));
});

test("touchpad [2] and X [4] are not left-menu restart", () => {
  const gp = { buttons: [{}, {}, { pressed: true, value: 1 }, {}, { pressed: false }, {}] };
  assert.equal(leftMenuButtonDown(gp), false);
  assert.equal(leftMenuButtonDown({ buttons: [{}, {}, {}, {}, { pressed: true, value: 1 }, {}] }), false);
  const menu = [];
  for (let i = 0; i < 8; i += 1) menu.push({ pressed: i === 7, value: i === 7 ? 1 : 0 });
  assert.equal(leftMenuButtonDown({ buttons: menu }), true);
  const rest = [];
  for (let i = 0; i < 8; i += 1) rest.push({ pressed: i === 6, value: i === 6 ? 1 : 0 });
  assert.equal(leftMenuButtonDown({ buttons: rest }), false);
  const analogMenu = [];
  for (let i = 0; i < 13; i += 1) analogMenu.push({ pressed: false, value: i >= 7 ? 0.9 : 0 });
  assert.equal(leftMenuButtonDown({ buttons: analogMenu }), false);
  assert.equal(leftMenuHoldSource({ buttons: analogMenu, axes: [0, 0, 0, 0] }), "analog");
  assert.equal(leftMenuHoldSource({ buttons: analogMenu, axes: [0.9, 0, 0, 0] }), "axes");
  assert.equal(leftMenuOnlyHeld([
    { handedness: "left", gamepad: { buttons: analogMenu, axes: [0, 0, 0, 0] } },
    pad({ handedness: "right" }),
  ]), false);
  const analogOnlyMenu = [];
  for (let i = 0; i < 13; i += 1) analogOnlyMenu.push({ pressed: false, value: i === 7 ? 0.95 : 0 });
  assert.equal(leftMenuButtonDown({ buttons: analogOnlyMenu }), false);
  assert.equal(leftMenuHoldSource({ buttons: analogOnlyMenu, axes: [0, 0, 0, 0] }), "analog");
  assert.equal(leftMenuHoldSource({
    mapping: "xr-standard",
    buttons: analogOnlyMenu.map((b, i) => (i === 4 ? { pressed: true, value: 1 } : b)),
    axes: [0, 0, 0, 0],
  }), "x");
  assert.equal(leftMenuOnlyHeld([
    { handedness: "left", gamepad: { buttons: analogOnlyMenu, axes: [0, 0, 0, 0] } },
    pad({ handedness: "right" }),
  ]), false);
  const stickClick = [];
  for (let i = 0; i < 13; i += 1) stickClick.push({ pressed: i === 3, value: i === 3 ? 1 : 0 });
  assert.equal(leftMenuButtonDown({ buttons: stickClick }), false);
});

test("enter sticky ignore covers 300-500ms; analog menu is not a hold", () => {
  assert.equal(xrIgnoreStickyPress({ enteredAt: 100, now: 350, ignoreMs: 400 }), true);
  assert.equal(xrIgnoreStickyPress({ enteredAt: 100, now: 550, ignoreMs: 400 }), false);
  assert.equal(xrIgnoreStickyPress({ enteredAt: 0, now: 50 }), false);
});

test("analog-only Menu jitter never spins or restarts; a digital hold fires once", () => {
  const gp = { mapping: "xr-standard", buttons: Array.from({ length: 13 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  const sources = [{ handedness: "left", gamepad: gp, targetRaySpace: {} }];
  let state = emptyLeftMenuRestartState();
  let now = 1000;
  const tick = () => {
    const next = tickLeftMenuRestart({ held: leftMenuOnlyHeld(sources), posed: true, now, state });
    state = next.next;
    now += 14;
    return next;
  };
  // Settle while released, then replay values either side of the old .82 gate
  // and several seconds of analog-high with no digital click.
  for (let frame = 0; frame < 40; frame += 1) tick();
  for (let frame = 0; frame < 900; frame += 1) {
    gp.buttons[7].value = frame < 300 ? [0, 0.81, 0.82, 0.9, 1][frame % 5] : 0.95;
    gp.buttons[8].value = frame % 11 === 0 ? 0.9 : 0;
    gp.axes[2] = frame % 13 === 0 ? 0.8 : 0;
    const result = tick();
    assert.equal(result.showing, false);
    assert.equal(result.complete, false);
  }
  gp.axes[2] = 0;
  gp.buttons[7].pressed = true;
  let completions = 0;
  for (let frame = 0; frame < 500; frame += 1) {
    if (tick().complete) completions += 1;
  }
  assert.equal(completions, 1, "holding the real menu button restarts once until release");
  assert.equal(tick().showing, false);
  gp.buttons[7].pressed = false;
  assert.equal(tick().showing, false, "digital release cancels even if analog stays high");
});

function settleLeftMenu({ held = false, posed = true, now = 1, state = emptyLeftMenuRestartState() } = {}) {
  let tick = { next: state };
  const frames = XR_LEFT_MENU_RESTART_SETTLE_FRAMES;
  for (let i = 0; i < frames; i += 1) {
    tick = tickLeftMenuRestart({
      held,
      posed,
      now: now + i,
      state: tick.next,
      holdMs: XR_LEFT_MENU_RESTART_HOLD_MS,
      settleFrames: frames,
    });
  }
  return tick;
}

test("xrrest2: already-down menu does not auto-fire; rising edge after release holds 3s", () => {
  const hold = XR_LEFT_MENU_RESTART_HOLD_MS;
  let tick = settleLeftMenu({ held: true, posed: true, now: 1 });
  assert.equal(tick.showing, false);
  assert.equal(tick.complete, false);
  assert.equal(tick.next.sawRelease, false);

  tick = tickLeftMenuRestart({
    held: true,
    posed: true,
    now: 1 + hold,
    state: tick.next,
    holdMs: hold,
  });
  assert.equal(tick.complete, false);
  assert.equal(tick.showing, false);

  tick = tickLeftMenuRestart({
    held: false,
    posed: true,
    now: 1 + hold + 20,
    state: tick.next,
    holdMs: hold,
  });
  assert.equal(tick.next.sawRelease, true);
  assert.equal(tick.cancelled, false);

  tick = tickLeftMenuRestart({
    held: true,
    posed: true,
    now: 5000,
    state: tick.next,
    holdMs: hold,
  });
  assert.equal(tick.showing, true);
  assert.equal(tick.complete, false);

  tick = tickLeftMenuRestart({
    held: true,
    posed: true,
    now: 5100,
    state: tick.next,
    holdMs: hold,
  });
  assert.equal(tick.showing, true);
  assert.equal(tick.complete, false);
  assert.ok(tick.progress > 0);

  tick = tickLeftMenuRestart({
    held: true,
    posed: true,
    now: 5000 + hold,
    state: tick.next,
    holdMs: hold,
  });
  assert.equal(tick.complete, true);
  assert.equal(tick.progress, 1);
});

test("xrrest2: unposed left pad never starts the restart hold", () => {
  let tick = settleLeftMenu({ held: true, posed: false, now: 1 });
  tick = tickLeftMenuRestart({
    held: true,
    posed: false,
    now: 1 + XR_LEFT_MENU_RESTART_HOLD_MS,
    state: tick.next,
    holdMs: XR_LEFT_MENU_RESTART_HOLD_MS,
  });
  assert.equal(tick.showing, false);
  assert.equal(tick.complete, false);
});

test("xrdbg2: L3+R3 exit flushes log; both lasers exist; enter VR does not restart", () => {
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const main = readFileSync(join(here, "../../backend/main.py"), "utf8");
  assert.ok(html.includes("xrdbg2"));
  assert.ok(html.includes("xrrest2"));
  assert.ok(html.includes("xrclick2"));
  assert.ok(html.includes("camsx1"));
  assert.ok(app.includes("20260915-xrdbg2"));
  assert.ok(app.includes("xr.debugger.log"));
  assert.ok(app.includes("fetchXrDebuggerLogText(name)"));
  assert.ok(xr.includes("ensureControllerPickLaser"));
  assert.ok(xr.includes("presentingPickLasersOn"));
  assert.ok(xr.includes('closeXrDebugger({ sendLog: true })'));
  assert.ok(xr.includes("exitFlush"));
  assert.ok(xr.includes("laserPickNode"));
  const poll = xr.slice(xr.indexOf("function pollStickDebugger"), xr.indexOf("function pollRemappedRestart"));
  assert.ok(poll.includes("bothThumbsticksClicked"));
  assert.ok(poll.includes("debuggerEnterHeld"));
  assert.ok(!poll.includes("bothSticksHeld"));
  const write = main.slice(main.indexOf("def xr_debugger_log_write"), main.indexOf("def xr_debugger_log_list"));
  assert.ok(write.includes("_notify_user"));
  assert.ok(write.includes('"xr.debugger.log"'));
});
