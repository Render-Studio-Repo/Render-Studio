import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  XR_SELECT_POINTER_M,
  bootEnterShouldCallSession,
  leftMonitorMenuPose,
  shouldReapplySavedMenuPoseOnBoot,
  xrEnterSessionMode,
  XR_LEFT_MONITOR_YAW_MIN,
  XR_LEFT_MONITOR_YAW_MAX,
  closestHudHit,
  commandCenterSlot,
  commandCenterSlots,
  enterVrButtonWired,
  formatXrBattery,
  formatXrClock,
  hoverHighlightOn,
  hoverHighlightOpacity,
  panelDragEndsOnRelease,
  panelDragShouldDrop,
  panelChromeStartsDrag,
  panelGripTranslateOnly,
  pickClipViewerChrome,
  windowChromeTooltipForId,
  windowChromeHoverId,
  panelResizeScale,
  WINDOW_CHROME_TOOLTIPS,
  rankFriendsForClipSend,
  applyClipFriendKey,
  roboticsBeatsStackedHud,
  selectPointerLengthM,
  selectPointerVisible,
  shouldPersistPanelYaw,
  xrBatteryPercent,
  xrSceneWindowsDefaultState,
  xrSceneHtmlOverlayAllowed,
  xrSceneWindowCreateCallsCadStyle,
  settingsWindowsTools,
  normalizeXrSceneUrl,
  applyXrSceneUrlKey,
  pickXrSceneWindowHit,
  readXrSceneWindowPrefs,
  writeXrSceneWindowPrefs,
  XR_SCENE_WIN_OS_LIMIT,
  XR_SCENE_WIN_PREFS_KEY,
} from "./xr-window-manager.js";

const here = dirname(fileURLToPath(import.meta.url));

test("grab ends on selectend / squeezeend for the same hand", () => {
  const controller = { id: "c-right" };
  const grip = { id: "g-right" };
  const drag = { controller, grip, hand: 1 };
  assert.equal(panelDragEndsOnRelease({ panelDrag: drag, released: controller, releasedHand: 1 }), true);
  assert.equal(panelDragEndsOnRelease({ panelDrag: drag, released: grip, releasedHand: 1 }), true);
  assert.equal(panelDragEndsOnRelease({ panelDrag: drag, released: { id: "other" }, releasedHand: 1 }), true);
  assert.equal(panelDragEndsOnRelease({ panelDrag: drag, released: { id: "left" }, releasedHand: 0 }), false);
  assert.equal(panelDragEndsOnRelease({ panelDrag: drag, released: { id: "grip" }, releasedHand: -1 }), false);
  assert.equal(panelDragEndsOnRelease({ panelDrag: null, released: controller }), false);
  assert.equal(panelDragShouldDrop({
    panelDrag: { hand: 1, sawHeld: true },
    triggers: [true, false],
    squeezes: [false, false],
  }), true);
  assert.equal(panelDragShouldDrop({
    panelDrag: { hand: 1, sawHeld: true },
    triggers: [false, true],
  }), false);
  assert.equal(panelDragShouldDrop({
    panelDrag: { hand: 1, sawHeld: false },
    requireSawHeld: true,
  }), false);
  assert.equal(panelChromeStartsDrag("robotics-chrome"), false);
  assert.equal(panelChromeStartsDrag("menu-chrome", { source: "wrist" }), false);
  assert.equal(panelGripTranslateOnly(), false);
  assert.equal(pickClipViewerChrome({ x: 0.232, y: 0.128 }, 0.52, 0.30)?.kind, "share-video-close");
  const friends = rankFriendsForClipSend(
    [{ id: "b", display_name: "Bee", online: false }, { id: "a", display_name: "Ann", online: true }],
    { recents: ["b"] },
  );
  assert.equal(friends[0].id, "a");
  assert.equal(applyClipFriendKey("SA", "back"), "S");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("panelDragEndsOnRelease"));
  assert.ok(xr.includes("panelDragShouldDrop"));
  assert.ok(xr.includes("panelChromeStartsDrag"));
  assert.ok(xr.includes("panelGripTranslateOnly"));
  assert.ok(xr.includes("selectend"));
  assert.ok(xr.includes("squeezeend"));
  assert.ok(xr.includes("finishStudioGrip(e.target)"));
  assert.ok(xr.includes("makeClipChromePuck"));
});

test("a panel releases only on its acquiring control, independent of the other button", () => {
  assert.equal(panelDragShouldDrop({ panelDrag: { hand: 1, input: "grip" },
    squeezes: [false, false], triggers: [false, true] }), true);
  assert.equal(panelDragShouldDrop({ panelDrag: { hand: 1, input: "grip" },
    squeezes: [false, true], triggers: [false, false] }), false);
  assert.equal(panelDragShouldDrop({ panelDrag: { hand: 1, input: "trigger" },
    squeezes: [false, true], triggers: [false, false] }), true);
});

test("window yaw persists after rotate release", () => {
  assert.equal(shouldPersistPanelYaw({ hasQuat: true, userRotated: true }), true);
  assert.equal(shouldPersistPanelYaw({ hasQuat: true, locked: true }), true);
  assert.equal(shouldPersistPanelYaw({ hasQuat: true, userRotated: false, locked: false }), false);
  assert.equal(shouldPersistPanelYaw({ hasQuat: false, userRotated: true }), false);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("shouldPersistPanelYaw"));
  assert.ok(xr.includes("xrUserRotated"));
});

test("pointer highlight helper lights the hovered control", () => {
  assert.equal(hoverHighlightOn({ hitKind: "robotics-action", hovered: true }), true);
  assert.equal(hoverHighlightOn({ hitKind: "menu-tab", hovered: true }), true);
  assert.equal(hoverHighlightOn({ hitKind: "tool", hovered: true }), true);
  assert.equal(hoverHighlightOn({ hitKind: "robotics-chrome", hovered: true }), true);
  assert.equal(hoverHighlightOn({ hitKind: "wheel-drag", hovered: true }), true);
  assert.equal(hoverHighlightOn({ hitKind: "robotics-action", hovered: false }), false);
  assert.equal(hoverHighlightOpacity({ hovered: true }), 0.38);
  assert.equal(hoverHighlightOpacity({ hovered: false }), 0.001);
  assert.equal(selectPointerVisible({ presenting: true, handIndex: 1 }), true);
  assert.equal(selectPointerVisible({ presenting: true, handIndex: 0 }), true);
  assert.equal(selectPointerVisible({ presenting: false, handIndex: 1 }), false);
  assert.equal(selectPointerLengthM(null), 0);
  assert.ok(selectPointerLengthM(null, { idleStub: true }) > 0.05);
  assert.ok(selectPointerLengthM({ kind: "menu-tab", distance: 0.62 }) > 0.5);
  assert.ok(selectPointerLengthM({ distance: 0.08 }) < XR_SELECT_POINTER_M);
});

test("enter VR button stays wired to WebXR session start", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.equal(enterVrButtonWired(`${html}\n${app}`), true);
  assert.ok(html.includes('id="studio-boot-enter-vr"'));
  assert.ok(html.includes("function requestXrEnter"));
  assert.ok(app.includes("window.__enterXrFromBoot"));
  assert.ok(app.includes("viewportXR.startFromUserGesture({ fromBoot: true })") || app.includes("viewportXR.startFromUserGesture()"));
  assert.ok(xr.includes("fromBoot"));
  assert.equal(bootEnterShouldCallSession({ fromBoot: true, presenting: true, lastStartAt: 9e9, now: 9e9 }), true);
  assert.equal(bootEnterShouldCallSession({ fromBoot: false, lastStartAt: 100, now: 200 }), false);
  assert.equal(xrEnterSessionMode({ fromBoot: true, probedMode: "immersive-ar" }), "immersive-ar");
  assert.equal(xrEnterSessionMode({ fromBoot: false, probedMode: "immersive-ar" }), "immersive-ar");
  assert.equal(shouldReapplySavedMenuPoseOnBoot({ fromBoot: true }), false);
});

test("default VR menu sits as a left monitor beside the CAD", () => {
  const pose = leftMonitorMenuPose({
    head: { x: 0, y: 1.6, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
    cadCenter: { x: 0, y: 1.4, z: -0.7 },
    cadRadius: 0.2,
  });
  assert.ok(pose.x < 0, "menu is left of the user");
  assert.ok(pose.yaw >= XR_LEFT_MONITOR_YAW_MIN && pose.yaw <= XR_LEFT_MONITOR_YAW_MAX);
  const reach = Math.hypot(pose.x, pose.z);
  assert.ok(reach >= 0.45 && reach <= 0.70, "menu stays in arm's reach, not across the room");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("leftMonitorMenuPose"));
  assert.ok(xr.includes("placeMenuAtDefault"));
  assert.ok(xr.includes("bootMenuLeftMonitor"));
  assert.ok(xr.includes("cadOrStageAnchorForMenu"));
  assert.ok(xr.includes("leftMonitorMenuPose"));
});

test("command-center arc fans windows instead of one stack", () => {
  const a = commandCenterSlot(0, 3);
  const b = commandCenterSlot(1, 3);
  const c = commandCenterSlot(2, 3);
  assert.ok(a.right < b.right);
  assert.ok(b.right < c.right || Math.abs(a.right - c.right) > 0.05);
  assert.notEqual(a.right, c.right);
  assert.equal(commandCenterSlots(3).length, 3);
  const stacked = roboticsBeatsStackedHud(
    { kind: "robotics-action", distance: 0.62 },
    [{ kind: "menu-chrome", distance: 0.63 }],
  );
  assert.equal(stacked, true);
  assert.equal(
    roboticsBeatsStackedHud({ distance: 0.9 }, [{ kind: "ai-action", distance: 0.4 }]),
    false,
  );
  assert.equal(
    closestHudHit([
      { kind: "menu-chrome", distance: 0.8 },
      { kind: "robotics-action", distance: 0.51, id: "enable" },
    ])?.kind,
    "robotics-action",
  );
});

test("headset clock and battery helpers", () => {
  assert.equal(formatXrClock(new Date(2026, 8, 9, 15, 4, 0)), "3:04 PM");
  assert.equal(formatXrBattery(87), "87%");
  assert.equal(formatXrBattery(null), "—");
  assert.equal(xrBatteryPercent({ navigatorBattery: { level: 0.42 } }), 42);
  assert.equal(xrBatteryPercent({ xrSession: { batteryLevel: 0.7 } }), 70);
});

test("window chrome buttons expose Anchor / Curve / Resize / Hide tooltips", () => {
  assert.equal(windowChromeTooltipForId("anchor"), WINDOW_CHROME_TOOLTIPS.anchor);
  assert.equal(windowChromeTooltipForId("curve"), WINDOW_CHROME_TOOLTIPS.curve);
  assert.equal(windowChromeTooltipForId("resize"), WINDOW_CHROME_TOOLTIPS.resize);
  assert.equal(windowChromeTooltipForId("hide"), WINDOW_CHROME_TOOLTIPS.hide);
  assert.match(WINDOW_CHROME_TOOLTIPS.anchor, /Anchor/i);
  assert.match(WINDOW_CHROME_TOOLTIPS.curve, /Curved/i);
  assert.match(WINDOW_CHROME_TOOLTIPS.resize, /Resize/i);
  assert.match(WINDOW_CHROME_TOOLTIPS.hide, /Hide/i);
  assert.equal(windowChromeHoverId({ kind: "share-video-anchor", id: "anchor" }), "anchor");
  assert.equal(windowChromeHoverId({ kind: "share-video-curve" }), "curve");
  assert.equal(windowChromeHoverId({ kind: "share-video-resize" }), "resize");
  assert.equal(windowChromeHoverId({ kind: "share-video-hide" }), "hide");
  const layClose = pickClipViewerChrome({ x: 0.232, y: 0.128 }, 0.52, 0.30);
  assert.equal(layClose?.kind, "share-video-close");
  assert.equal(pickClipViewerChrome({ x: 0.232 - 0.044 * 2, y: 0.128 }, 0.52, 0.30)?.id, "hide");
  assert.equal(pickClipViewerChrome({ x: 0.232 - 0.044 * 3, y: 0.128 }, 0.52, 0.30)?.id, "curve");
  assert.equal(pickClipViewerChrome({ x: 0.232 - 0.044 * 4, y: 0.128 }, 0.52, 0.30)?.id, "anchor");
  assert.equal(pickClipViewerChrome({ x: 0.24, y: -0.13 }, 0.52, 0.30)?.id, "resize");
  assert.ok(panelResizeScale({ startScale: 1, startCornerDist: 0.2, nowCornerDist: 0.3 }) > 1);
  assert.ok(panelResizeScale({ startScale: 1, startCornerDist: 0.2, nowCornerDist: 0.1 }) < 1);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("paintClipWindowTooltip"));
  assert.ok(xr.includes("applyClipWindowCurve"));
  assert.ok(xr.includes("beginClipResize"));
  assert.ok(xr.includes("windowChromeTooltipForId"));
});

test("Settings Windows in-scene panels: Quest cannot embed OS windows, default off", () => {
  const def = xrSceneWindowsDefaultState();
  assert.equal(def.browserOn, false);
  assert.equal(def.displayOn, false);
  assert.equal(xrSceneWindowCreateCallsCadStyle(), false);
  assert.match(XR_SCENE_WIN_OS_LIMIT, /Cannot embed Meta Browser/i);
  assert.equal(xrSceneHtmlOverlayAllowed({ presenting: true, questBrowser: false }), false);
  assert.equal(xrSceneHtmlOverlayAllowed({ presenting: false, questBrowser: true }), false);
  assert.equal(xrSceneHtmlOverlayAllowed({ presenting: false, questBrowser: false }), true);
  assert.equal(normalizeXrSceneUrl("example.com"), "https://example.com");
  assert.equal(applyXrSceneUrlKey("ex", "com"), "ex.com");
  const tools = settingsWindowsTools(def);
  assert.deepEqual(tools.map((t) => t.id), ["win_browser", "win_display", "win_add_url", "win_close", "win_pin", "win_width"]);
  assert.equal(pickXrSceneWindowHit(680, 20, { kind: "browser" })?.kind, "scene-win-close");
  assert.equal(pickXrSceneWindowHit(700, 400, { kind: "browser" })?.kind, "scene-win-resize");
  assert.equal(hoverHighlightOn({ hitKind: "scene-win-close", hovered: true }), true);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("handleWindowsSettingsAction"));
  assert.ok(xr.includes("toggleXrSceneWindow"));
  assert.ok(xr.includes("win_browser"));
  assert.equal(xr.slice(xr.indexOf("function handleWindowsSettingsAction"), xr.indexOf("function handleGridAction")).includes("applyCadStyle"), false);
  assert.equal(xr.slice(xr.indexOf("function toggleXrSceneWindow"), xr.indexOf("function beginSceneWindowResize")).includes("applyCadStyle"), false);
  const winStore = {
    data: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem(k, v) { this.data[k] = String(v); },
  };
  writeXrSceneWindowPrefs({ pinned: false, widthId: "l" }, winStore);
  assert.equal(readXrSceneWindowPrefs(winStore).pinned, false);
  assert.equal(readXrSceneWindowPrefs(winStore).widthId, "l");
  assert.ok(winStore.data[XR_SCENE_WIN_PREFS_KEY]);
  assert.ok(xr.includes("writeXrSceneWindowPrefs"));
});
