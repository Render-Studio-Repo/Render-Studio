import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WRIST_CAM_LAYOUT_KEY,
  assignWristCamDevices,
  clampWristCamRect,
  WRIST_CAM_CLOSE_CACHE,
  WRIST_CAM_HOLD_CACHE,
  WRIST_CAM_POLL_MS,
  wristCamShouldHoldLive,
  WRIST_CAM_ALLOW_CACHE,
  WRIST_CAM_PIN_CACHE,
  WRIST_CAM_HOTPLUG_CACHE,
  WRIST_CAM_POSITION,
  WRIST_CAM_TOP,
  WRIST_CAM_PAD,
  WRIST_CAM_GAP,
  WRIST_CAM_GUI_INSET,
  WRIST_CAM_PARK_CACHE,
  WRIST_CAM_INERTIA,
  WRIST_CAM_MOVE_CACHE,
  wristCamFollowsViserLayout,
  wristCamWindowBounds,
  wristCamPairLayout,
  wristCamRightChromeInset,
  wristCamDragReleased,
  stopWristCamDragState,
  createWristCamPopups,
  resetHandCamPublishState,
  persistCameraPermissionGranted,
  defaultWristCamLayout,
  disconnectedCopy,
  copyWristCamLog,
  CANT_FIND_CAMERA,
  NO_STREAM_AVAILABLE,
  NO_CAMERA_PLUGGED_IN,
  emptyCameraLabel,
  wristCamFailLog,
  WRIST_CAM_SKIP_CACHE,
  WRIST_CAM_TAB_CACHE,
  WRIST_CAM_TOGGLE_SEL,
  applyWristCamToggleState,
  isWristCamLabel,
  listCameraSources,
  persistWristCamLayout,
  readWristCamLayout,
  shouldUseGetUserMedia,
  wristCamLabelScore,
} from "./wrist-cam-popups.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "wrist-cam-popups.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");

test("preferred labels match wrist / hand / Arducam / OpenArm / B0495", () => {
  assert.equal(isWristCamLabel("Arducam B0495"), true);
  assert.equal(isWristCamLabel("OpenArm left hand cam"), true);
  assert.equal(isWristCamLabel("USB 04b4:4950"), true);
  assert.equal(isWristCamLabel("FaceTime HD Camera"), false);
  assert.ok(wristCamLabelScore("Left Arducam B0495", "left") > wristCamLabelScore("Right Arducam B0495", "left"));
});

test("assignment prefers labeled wrist cams, else first two video inputs", () => {
  const labeled = assignWristCamDevices([
    { kind: "videoinput", deviceId: "a", label: "FaceTime HD Camera" },
    { kind: "videoinput", deviceId: "b", label: "Right Arducam B0495" },
    { kind: "audioinput", deviceId: "mic", label: "Mic" },
    { kind: "videoinput", deviceId: "c", label: "Left OpenArm hand cam" },
  ]);
  assert.equal(labeled.left.deviceId, "c");
  assert.equal(labeled.right.deviceId, "b");
  assert.equal(labeled.fallback, false);
  assert.match(labeled.notes.join(" "), /Left: Left OpenArm/);
  assert.match(labeled.notes.join(" "), /Right: Right Arducam/);

  const fallback = assignWristCamDevices([
    { kind: "videoinput", deviceId: "u0", label: "USB Camera" },
    { kind: "videoinput", deviceId: "u1", label: "USB Camera #2" },
  ]);
  assert.equal(fallback.left.deviceId, "u0");
  assert.equal(fallback.right.deviceId, "u1");
  assert.equal(fallback.fallback, true);
  assert.match(fallback.notes.join(" "), /first two video inputs as Left \/ Right/);

  const missing = assignWristCamDevices([]);
  assert.equal(missing.left, null);
  assert.equal(missing.right, null);
  assert.match(disconnectedCopy("right"), /No stream available/);
});

test("one preferred cam fills Left; leftover generic video becomes Right", () => {
  const mixed = assignWristCamDevices([
    { kind: "videoinput", deviceId: "lap", label: "FaceTime HD Camera" },
    { kind: "videoinput", deviceId: "wrist", label: "Arducam B0495" },
  ]);
  assert.equal(mixed.left.deviceId, "wrist");
  assert.equal(mixed.right.deviceId, "lap");
});

test("layout clamps inside the viewport and persists", () => {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const bounds = { width: 400, height: 300 };
  const left = defaultWristCamLayout("left", bounds);
  const right = defaultWristCamLayout("right", bounds);
  assert.ok(left.x >= 8);
  assert.ok(left.x + left.w <= 400);
  assert.ok(right.x + right.w <= 400);
  assert.equal(right.x + right.w, 400 - WRIST_CAM_PAD);
  assert.equal(left.x + left.w + WRIST_CAM_GAP, right.x);
  assert.equal(left.y, WRIST_CAM_TOP);
  assert.equal(right.y, WRIST_CAM_TOP);
  assert.ok(left.x + left.w <= right.x);
  const huge = clampWristCamRect({ x: 9000, y: 9000, w: 2000, h: 2000 }, bounds);
  assert.ok(huge.x + huge.w <= 400);
  assert.ok(huge.y + huge.h <= 300);
  assert.ok(left.x + left.w <= right.x);
  persistWristCamLayout({ left, right }, storage);
  assert.equal(store.has(WRIST_CAM_LAYOUT_KEY), true);
  const loaded = readWristCamLayout(storage);
  assert.equal(loaded.left.w, left.w);
  assert.equal(loaded.right.x, right.x);
});

test("left popup min-x is 0 like right and stays pinned off the Viser panel", () => {
  const windowBounds = { width: 1440, height: 900 };
  const leftEdge = clampWristCamRect({ x: -80, y: -12, w: 280, h: 188 }, windowBounds);
  const rightEdge = clampWristCamRect({ x: -80, y: -12, w: 280, h: 188 }, windowBounds);
  assert.equal(leftEdge.x, 0);
  assert.equal(rightEdge.x, 0);
  assert.equal(leftEdge.y, 0);
  const corner = clampWristCamRect({ x: 0, y: 0, w: 280, h: 188 }, windowBounds);
  assert.equal(corner.x, 0);
  assert.equal(corner.y, 0);
  const afterViserShrink = clampWristCamRect(corner, windowBounds);
  assert.equal(afterViserShrink.x, corner.x);
  assert.equal(afterViserShrink.y, corner.y);
  assert.equal(wristCamFollowsViserLayout(), false);
  assert.equal(WRIST_CAM_POSITION, "fixed");
  assert.equal(WRIST_CAM_PIN_CACHE, "campin1");
  assert.equal(WRIST_CAM_HOTPLUG_CACHE, "camhot1");
  assert.equal(WRIST_CAM_SKIP_CACHE, "camskip1");
  const win = wristCamWindowBounds({ innerWidth: 1440, innerHeight: 900 }, { width: 360, height: 900 });
  assert.equal(win.width, 1440);
  assert.equal(win.height, 900);
  assert.match(src, /position = WRIST_CAM_POSITION/);
  assert.equal(src.includes("addEventListener?.(\"resize\""), false);
  assert.match(css, /\.wrist-cam-popup\s*\{[\s\S]*?position:\s*fixed/);
  const parked = defaultWristCamLayout("right", windowBounds);
  const parkedLeft = defaultWristCamLayout("left", windowBounds);
  assert.equal(parked.x + parked.w, 1440 - WRIST_CAM_PAD);
  assert.equal(parkedLeft.x + parkedLeft.w + WRIST_CAM_GAP, parked.x);
  assert.equal(parked.y, WRIST_CAM_TOP);
  const besideGui = defaultWristCamLayout("right", windowBounds, { rightInset: 320 });
  assert.equal(besideGui.x + besideGui.w, 1440 - WRIST_CAM_PAD - 320);
  assert.equal(WRIST_CAM_GUI_INSET, 0);
  assert.equal(WRIST_CAM_PARK_CACHE, "campark1");
  const fromWindow = defaultWristCamLayout("right", wristCamWindowBounds({ innerWidth: 1440, innerHeight: 900 }, undefined, {
    getBoundingClientRect: () => ({ width: 720, height: 640, left: 280, top: 120, right: 1000, bottom: 760 }),
  }));
  assert.equal(fromWindow.x + fromWindow.w, 1440 - WRIST_CAM_PAD);
  assert.equal(fromWindow.y, WRIST_CAM_TOP);
});

test("camera windows stack on the right when they cannot sit side by side", () => {
  const pair = wristCamPairLayout({ width: 300, height: 900 });
  assert.equal(pair.stacked, true);
  assert.equal(pair.left.x, pair.right.x);
  assert.ok(pair.left.y > pair.right.y);
  assert.equal(pair.right.x + pair.right.w, 300 - WRIST_CAM_PAD);
});

test("pointerup zeros velocity and leftover rAF; mouse buttons=0 also releases", () => {
  assert.equal(WRIST_CAM_INERTIA, false);
  assert.equal(WRIST_CAM_MOVE_CACHE, "camdrag1");
  const drag = { id: 1, vx: 12, vy: -4, raf: 99 };
  assert.equal(wristCamDragReleased({ type: "pointerup", pointerId: 1 }, drag), true);
  assert.equal(wristCamDragReleased({ type: "pointermove", pointerId: 1, buttons: 1, pointerType: "mouse" }, drag), false);
  assert.equal(wristCamDragReleased({ type: "pointermove", pointerId: 1, buttons: 0, pointerType: "mouse" }, drag), true);
  assert.equal(wristCamDragReleased({ type: "pointermove", pointerId: 1, buttons: 0, pointerType: "touch" }, drag), false);
  const cancelled = [];
  stopWristCamDragState(drag, { cancelAnimationFrame: (id) => cancelled.push(id) });
  assert.equal(drag.vx, 0);
  assert.equal(drag.vy, 0);
  assert.equal(drag.raf, 0);
  assert.deepEqual(cancelled, [99]);
  assert.equal(wristCamRightChromeInset(null), 0);
  assert.equal(wristCamRightChromeInset({
    querySelector(sel) {
      if (sel === "#viser-viewer") {
        return {
          hidden: false,
          classList: { contains: (c) => c === "viser-gui-collapsed" },
          closest: () => null,
          getBoundingClientRect: () => ({ width: 900 }),
        };
      }
      return null;
    },
  }), 0);
  assert.equal(wristCamRightChromeInset({
    querySelector(sel) {
      if (sel === "#viser-viewer") {
        return {
          hidden: false,
          classList: { contains: () => false },
          closest: () => null,
          getBoundingClientRect: () => ({ width: 900 }),
        };
      }
      return null;
    },
  }), 0);
});

function fakeEl(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    className: "",
    id: "",
    style: {},
    attrs: {},
    listeners: {},
    dataset: {},
    textContent: "",
    innerHTML: "",
    srcObject: null,
    muted: false,
    classList: {
      _s: new Set(),
      add(...xs) {
        xs.forEach((x) => node.classList._s.add(x));
        node.className = [...node.classList._s].join(" ");
      },
      remove(...xs) {
        xs.forEach((x) => node.classList._s.delete(x));
        node.className = [...node.classList._s].join(" ");
      },
      toggle(c, on) {
        if (on === false) node.classList.remove(c);
        else if (on === true) node.classList.add(c);
        else if (node.classList._s.has(c)) node.classList.remove(c);
        else node.classList.add(c);
      },
      contains(c) {
        return node.classList._s.has(c);
      },
    },
    setAttribute(k, v) {
      node.attrs[k] = String(v);
      if (k === "id") node.id = String(v);
    },
    getAttribute(k) {
      return node.attrs[k] ?? (k === "id" ? node.id : "");
    },
    removeAttribute(k) {
      delete node.attrs[k];
    },
    appendChild(child) {
      node.children.push(child);
      child.parentNode = node;
      return child;
    },
    closest(sel) {
      const parts = String(sel || "").split(",").map((s) => s.trim()).filter(Boolean);
      let n = node;
      while (n) {
        if (parts.some((p) => matchSel(n, p))) return n;
        n = n.parentNode;
      }
      return null;
    },
    remove() {
      const p = node.parentNode;
      if (!p) return;
      p.children = p.children.filter((c) => c !== node);
      node.parentNode = null;
    },
    addEventListener(type, fn) {
      (node.listeners[type] ||= []).push(fn);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    querySelector(sel) {
      return queryAll(node, sel)[0] || null;
    },
    querySelectorAll(sel) {
      return queryAll(node, sel);
    },
    getBoundingClientRect() {
      return { width: 900, height: 600, left: 0, top: 0, right: 900, bottom: 600 };
    },
    play: async () => {},
  };
  node.classList.add = node.classList.add.bind(node.classList);
  return node;
}

function matchSel(node, sel) {
  if (/^[a-z][a-z0-9]*$/i.test(sel)) return node.tagName === sel.toUpperCase();
  if (sel.startsWith("#")) return node.id === sel.slice(1) || node.attrs.id === sel.slice(1);
  const data = sel.match(/^\[([^=\]]+)(?:=\"([^\"]*)\")?\]$/);
  if (data) {
    const val = node.attrs[data[1]];
    return data[2] == null ? val != null : val === data[2];
  }
  if (sel.startsWith(".")) return node.classList.contains(sel.slice(1));
  return false;
}

function queryAll(root, sel) {
  const out = [];
  const walk = (n) => {
    if (matchSel(n, sel)) out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const c of root.children) walk(c);
  return out;
}

test("Wrist Cam starts publish and uses LAN JPEGs, not FaceTime", async () => {
  resetHandCamPublishState();
  const viewport = fakeEl("main");
  viewport.id = "viewport";
  const button = fakeEl("button");
  const gumCalls = [];
  const fetchCalls = [];
  const mediaDevices = {
    enumerateDevices: async () => [
      { kind: "videoinput", deviceId: "face", label: "FaceTime HD Camera (3A71:F4B5)" },
    ],
    getUserMedia: async (c) => {
      gumCalls.push(c);
      throw new Error("getUserMedia must not run for wrist cams");
    },
  };
  const fetchFn = async (url, opts = {}) => {
    fetchCalls.push({ url: String(url), method: String(opts.method || "GET"), body: opts.body || "" });
    if (String(url).includes("request-permission")) {
      return {
        ok: true,
        json: async () => ({
          publish: true,
          app: "Python.app",
          prompted: true,
          helper: "Check the Mac for a Camera prompt for Python.",
          cli: "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python -c import cv2;c=cv2.VideoCapture(0)",
        }),
      };
    }
    if (String(url).includes("/status")) {
      return {
        ok: true,
        json: async () => ({
          captureApp: "Python.app",
          helper: "Check the Mac for a Camera prompt for Python.",
          leftReason: "camera permission denied for Studio (open timed out)",
          rightReason: "camera permission denied for Studio (open timed out)",
          devices: [],
          wristCount: 0,
        }),
      };
    }
    if (String(url).includes("/publish")) {
      if (String(opts.method || "GET") === "GET") {
        return { ok: true, json: async () => ({ publish: false }) };
      }
      return { ok: true, json: async () => ({ publish: true }) };
    }
    return { ok: false, blob: async () => ({ size: 0 }), json: async () => ({}) };
  };
  const prevUrl = globalThis.URL;
  const prevInterval = globalThis.setInterval;
  const prevClear = globalThis.clearInterval;
  globalThis.URL = { createObjectURL: () => "blob:lan", revokeObjectURL() {} };
  globalThis.setInterval = () => 7;
  globalThis.clearInterval = () => {};
  const popups = createWristCamPopups({
    viewport,
    buttonEl: button,
    mediaDevices,
    fetchFn,
    getCameraHost: () => "192.168.1.83",
    storage: { getItem: () => null, setItem: () => {} },
    document: { createElement: (tag) => fakeEl(tag) },
  });
  try {
    await popups.show();
    assert.equal(popups.isOpen(), true);
    assert.equal(gumCalls.length, 0);
    assert.ok(fetchCalls.some((c) => c.url.includes("/api/robotics/hand-cam/publish") && c.method === "POST"));
    assert.ok(fetchCalls.some((c) => /hand-cam\/left\.jpg/.test(c.url)));
    assert.ok(fetchCalls.some((c) => /hand-cam\/right\.jpg/.test(c.url)));
    const host = viewport.children[0];
    assert.equal(host.id, "wrist-cam-popups");
    assert.equal(String(host.className || "").includes("floating-panel"), false);
    assert.equal(queryAll(host, "[data-cam-rail]").length, 0);
    const titles = queryAll(host, "strong").map((n) => n.textContent);
    assert.deepEqual(titles, ["Left", "Right"]);
    const empties = queryAll(host, "[data-wrist-empty-msg]").map((n) => n.textContent).join("\n");
    assert.match(empties, /Can't find the camera/);
    assert.equal(empties.includes("FaceTime"), false);
    const allows = queryAll(host, "[data-wrist-allow]");
    assert.equal(allows.length, 2);
    assert.equal(allows.every((n) => n.hidden === false), true);
    assert.match(allows.map((n) => n.textContent).join(" "), /Allow camera/);
    const hints = queryAll(host, "[data-wrist-allow-hint]").map((n) => n.textContent).join("\n");
    assert.match(hints, /Camera prompt for Python/);
    assert.equal(hints.includes("Developer Tools"), false);
    assert.equal(hints.includes("Cmd+Shift+G"), false);
    const allowEv = {
      preventDefault() {},
      stopPropagation() {},
      target: allows[0],
      button: 0,
    };
    for (const fn of allows[0].listeners.click || []) await fn(allowEv);
    assert.ok(fetchCalls.some((c) => c.url.includes("/api/robotics/hand-cam/request-permission") && c.method === "POST"));
    const logs = queryAll(host, "[data-wrist-side]").map((n) => n.getAttribute("data-wrist-log") || "").join("\n");
    assert.match(logs, /VideoCapture/);
    assert.match(logs, /192\.168\.1\.83/);
    assert.match(popups.getAssignmentNote(), /192\.168\.1\.83:8001/);
    assert.equal(shouldUseGetUserMedia(listCameraSources()[0]), false);
    popups.hide();
    assert.equal(popups.isOpen(), false);
  } finally {
    globalThis.URL = prevUrl;
    globalThis.setInterval = prevInterval;
    globalThis.clearInterval = prevClear;
    popups.hide();
  }
});

test("desktop Wrist cam lives on Robotics ribbon, not viewport chrome", () => {
  assert.equal(html.includes('id="btn-wrist-cam"'), false);
  assert.match(html, /20260914-visersame1/);
  const ribbon = readFileSync(join(here, "../studio/ribbon.js"), "utf8");
  assert.match(ribbon, /roboticsAction: "cam-wrist"/);
  assert.match(ribbon, /ribbon-btn--wrist-cam/);
  assert.match(ribbon, /roboticsAction: "cam-debug"/);
  assert.match(ribbon, /ribbon-btn--cam-debug/);
  assert.match(app, /action === "cam-debug"/);
  assert.match(app, /openCamDebugPopup/);
  assert.match(app, /wrist-cam-popups\.js\?v=.*20260915-wristport1/);
  assert.match(app, /wrist-cam-popups\.js\?v=.*camsx1/);
  assert.match(app, /wrist-cam-popups\.js\?v=.*camdrag1/);
  assert.match(app, /wrist-cam-popups\.js\?v=.*campark1/);
  assert.match(html, /camdrag1/);
  assert.match(html, /campark1/);
  assert.equal(WRIST_CAM_INERTIA, false);
  assert.match(app, /wristCamPopups\?\.show/);
  assert.match(app, /action === "cam-wrist"/);
  assert.match(app, /activateWristCameras/);
  const wristAction = app.slice(
    app.indexOf('if (action === "cam-enable" || action === "cam-wrist")'),
    app.indexOf('if (action === "cam-debug")'),
  );
  assert.match(wristAction, /await mod\.activateWristCameras[\s\S]*restart: true/);
  assert.match(wristAction, /apiFn: api/);
  assert.match(wristAction, /await wristCamPopups\?\.show/);
  assert.ok(
    wristAction.indexOf("await mod.activateWristCameras") < wristAction.indexOf("await wristCamPopups?.show"),
    "camera publishing must restart before the wrist windows open",
  );
  assert.equal((wristAction.match(/wristCamPopups\?\.show/g) || []).length, 2);
  assert.match(app, /camre1/);
  assert.match(src, /restart: false/);
  assert.match(app, /camsx2/);
  assert.match(html, /camsx2/);
  assert.equal(WRIST_CAM_HOLD_CACHE, "camsx2");
  assert.equal(WRIST_CAM_TAB_CACHE, "camtab1");
  assert.match(WRIST_CAM_TOGGLE_SEL, /cam_enable/);
  assert.match(WRIST_CAM_TOGGLE_SEL, /data-viser-cam/);
  assert.match(app, /camtab1/);
  assert.match(html, /camtab1/);
  assert.match(ribbon, /ribbon-btn--enable-cam/);
  assert.match(ribbon, /data-wrist-cam-toggle/);
  assert.match(app, /onActivateCameras: \(\) => handleRoboticsRibbonAction\("cam-enable"\)/);
  assert.match(app, /wristCamPopups\?\.isOpen/);
  assert.match(app, /wristCamPopups\.hide/);
  assert.match(app, /action === "cam-enable"/);
  const ribbonCss = readFileSync(join(here, "../studio/ribbon.css"), "utf8");
  assert.match(ribbonCss, /ribbon-btn--enable-cam/);
  assert.match(html, /ribbon\.css\?v=.*camtab1/);
  assert.ok(WRIST_CAM_POLL_MS <= 100);
  assert.match(src, /handCamMjpegUrl/);
  assert.match(src, /data-wrist-mjpeg/);
  const pollLan = src.match(/async function pollLanSide[\s\S]*?\n  function clampAll/)?.[0] || "";
  assert.equal((pollLan.match(/\bconst panel\b/g) || []).length, 1);
  assert.equal(wristCamShouldHoldLive({ wasLive: true, ok: false, headerLive: false, misses: 2 }), true);
  assert.equal(wristCamShouldHoldLive({ wasLive: true, ok: false, headerLive: false, misses: 8 }), true);
  assert.equal(wristCamShouldHoldLive({ wasLive: true, ok: false, headerLive: false, misses: 30 }), false);
  assert.equal(wristCamShouldHoldLive({ wasLive: false, ok: false, misses: 1 }), false);
  assert.match(css, /\.wrist-cam-popup\s*\{/);
  assert.match(css, /no camera-list sidebar/);
  assert.match(css, /\.wrist-cam-popup-close[\s\S]*pointer-events:\s*auto/);
  assert.match(src, /requestHandCamPermission/);
  assert.match(src, /HAND_CAM_PERMISSION_PATH/);
  assert.match(css, /\.wrist-cam-popup-allow\s*\{/);
  assert.equal(src.includes("wrist-cam-rail"), false);
  assert.equal(src.includes("requestSession"), false);
});

test("Cam ribbon and Wrist Cams toolbar toggle the same overlays", async () => {
  const cam = fakeEl("button");
  cam.setAttribute("data-id", "cam_enable");
  cam.classList.add("ribbon-btn", "ribbon-btn--enable-cam");
  const bar = fakeEl("button");
  bar.setAttribute("data-viser-cam", "");
  const buttons = [cam, bar];
  applyWristCamToggleState(true, { querySelectorAll: () => buttons });
  assert.equal(cam.classList.contains("ribbon-btn--active"), true);
  assert.equal(cam.classList.contains("is-on"), true);
  assert.equal(bar.classList.contains("is-on"), true);
  assert.equal(cam.getAttribute("aria-pressed"), "true");
  assert.equal(bar.getAttribute("aria-pressed"), "true");
  applyWristCamToggleState(false, { querySelectorAll: () => buttons });
  assert.equal(cam.classList.contains("ribbon-btn--active"), false);
  assert.equal(bar.classList.contains("is-on"), false);
  assert.equal(bar.getAttribute("aria-pressed"), "false");

  const viewport = fakeEl("main");
  const prevInterval = globalThis.setInterval;
  const prevClear = globalThis.clearInterval;
  globalThis.setInterval = () => 7;
  globalThis.clearInterval = () => {};
  const popups = createWristCamPopups({
    viewport,
    fetchFn: async () => ({ ok: false, status: 503, headers: { get: () => "" }, json: async () => ({}) }),
    getCameraHost: () => "192.168.1.83",
    storage: { getItem: () => null, setItem: () => {} },
    document: {
      createElement: (tag) => fakeEl(tag),
      querySelectorAll: () => buttons,
    },
  });
  try {
    assert.equal(await popups.toggle(), true);
    assert.equal(popups.isOpen(), true);
    assert.equal(cam.classList.contains("ribbon-btn--active"), true);
    assert.equal(bar.classList.contains("is-on"), true);
    assert.equal(await popups.toggle(), false);
    assert.equal(popups.isOpen(), false);
    assert.equal(cam.classList.contains("ribbon-btn--active"), false);
    assert.equal(bar.classList.contains("is-on"), false);
  } finally {
    globalThis.setInterval = prevInterval;
    globalThis.clearInterval = prevClear;
    popups.hide();
  }
});

test("IP-only fail log keeps auto-appended JPEG path and 503 reason", () => {
  const log = wristCamFailLog("left", {
    host: "192.168.1.83",
    status: 503,
    reason: "no wrist USB camera for right (only 1 camera: Arducam B0495)",
  });
  assert.match(log, /host 192\.168\.1\.83/);
  assert.match(log, /port 8001/);
  assert.match(log, /http:\/\/192\.168\.1\.83:8001\/api\/robotics\/hand-cam\/left\.jpg/);
  assert.match(log, /http 503/);
  assert.match(log, /only 1 camera/);
  assert.equal(log.includes("8095"), false);
  const perm = wristCamFailLog("left", {
    host: "192.168.1.83",
    status: 503,
    reason: "ffmpeg allowed, Python.app still needs Camera",
  });
  assert.match(perm, /ffmpeg allowed, Python.app still needs Camera/);
  const skip = wristCamFailLog("left", {
    host: "192.168.1.83",
    status: 503,
    reason: "no wrist USB camera after skip FaceTime",
  });
  assert.match(skip, /no wrist USB camera plugged in/);
  assert.equal(skip.includes("skip FaceTime"), false);
  assert.equal(emptyCameraLabel("no wrist USB camera plugged in"), NO_CAMERA_PLUGGED_IN);
  assert.equal(emptyCameraLabel("no wrist USB camera plugged in (only Capture screen)"), NO_CAMERA_PLUGGED_IN);
  assert.equal(emptyCameraLabel("camera permission denied for Studio (open timed out)"), CANT_FIND_CAMERA);
});

test("Allow stays hidden when unplugged and overlay says No camera plugged in", async () => {
  resetHandCamPublishState();
  const viewport = fakeEl("main");
  const prevInterval = globalThis.setInterval;
  const prevClear = globalThis.clearInterval;
  globalThis.setInterval = () => 7;
  globalThis.clearInterval = () => {};
  const fetchFn = async (url, opts = {}) => {
    if (String(url).includes("/status") || (String(url).includes("/publish") && String(opts.method || "GET") === "POST")) {
      return {
        ok: true,
        json: async () => ({
          publish: true,
          devices: [{ name: "Capture screen 0", skipped: true }],
          wristCount: 0,
          leftReason: "no wrist USB camera plugged in (only Capture screen)",
          rightReason: "no wrist USB camera plugged in (only Capture screen)",
        }),
        headers: { get: (k) => String(k).toLowerCase().includes("reason") ? "no wrist USB camera plugged in (only Capture screen)" : null },
      };
    }
    return {
      ok: false,
      status: 503,
      blob: async () => ({ size: 0 }),
      json: async () => ({}),
      headers: { get: (k) => String(k).toLowerCase().includes("reason") ? "no wrist USB camera plugged in (only Capture screen)" : null },
    };
  };
  const popups = createWristCamPopups({
    viewport,
    fetchFn,
    getCameraHost: () => "192.168.1.83",
    storage: { getItem: () => null, setItem: () => {} },
    document: { createElement: (tag) => fakeEl(tag) },
  });
  try {
    await popups.show();
    const host = viewport.children[0];
    const empties = queryAll(host, "[data-wrist-empty-msg]").map((n) => n.textContent).join("\n");
    assert.match(empties, /No camera plugged in/);
    assert.equal(empties.includes("Allow"), false);
    const allows = queryAll(host, "[data-wrist-allow]");
    assert.ok(allows.every((n) => n.hidden || n.classList.contains("hidden")));
    const logs = queryAll(host, "[data-wrist-side]").map((n) => n.getAttribute("data-wrist-log") || "").join("\n");
    assert.match(logs, /only Capture screen/);
    assert.equal(logs.includes("skip FaceTime"), false);
  } finally {
    globalThis.setInterval = prevInterval;
    globalThis.clearInterval = prevClear;
    popups.hide();
  }
});

test("X closes a floating cam window and poll does not remount it", async () => {
  assert.equal(WRIST_CAM_CLOSE_CACHE, "camsx1");
  assert.equal(WRIST_CAM_ALLOW_CACHE, "camcli2");
  assert.match(html, /camcli2|campin1/);
  assert.match(html, /xrrest2/);
  assert.match(html, /xrclick2/);
  assert.match(html, /reftab1/);
  assert.match(html, /camsx1/);
  assert.match(html, /camvis1/);
  assert.match(html, /camvis2/);
  assert.match(html, /camprompt1/);
  assert.match(html, /camcli1|camcli2/);
  assert.match(html, /camskip1/);
  assert.match(app, /camvis1/);
  assert.match(app, /camvis2/);
  assert.match(app, /camprompt1/);
  assert.match(app, /camcli1|camcli2/);
  assert.match(app, /camskip1/);
  assert.match(app, /xrrest2/);
  assert.match(app, /xrclick2/);
  assert.match(app, /reftab1/);
  const viewport = fakeEl("main");
  const ticks = [];
  const prevInterval = globalThis.setInterval;
  const prevClear = globalThis.clearInterval;
  globalThis.setInterval = (fn) => {
    ticks.push(fn);
    return 7;
  };
  globalThis.clearInterval = () => {};
  const fetchFn = async (url, opts = {}) => {
    if (String(url).includes("request-permission")) {
      return { ok: true, json: async () => ({ publish: true, app: "Python.app", prompted: true }) };
    }
    if (String(url).includes("/status")) {
      return { ok: true, json: async () => ({ captureApp: "Python.app" }) };
    }
    if (String(opts.method || "GET") === "POST" || String(url).includes("/publish")) {
      return { ok: true, json: async () => ({ publish: true }) };
    }
    return { ok: true, blob: async () => ({ size: 120 }), json: async () => ({}) };
  };
  const prevUrl = globalThis.URL;
  globalThis.URL = { createObjectURL: () => "blob:lan", revokeObjectURL() {} };
  const popups = createWristCamPopups({
    viewport,
    fetchFn,
    getCameraHost: () => "192.168.1.83",
    storage: { getItem: () => null, setItem: () => {} },
    document: { createElement: (tag) => fakeEl(tag) },
  });
  try {
    await popups.show();
    const host = viewport.children[0];
    const liveAllows = queryAll(host, "[data-wrist-allow]");
    assert.ok(liveAllows.length === 0 || liveAllows.every((n) => n.hidden || n.classList.contains("hidden")));
    const left = queryAll(host, "[data-wrist-side]").find((n) => n.getAttribute("data-wrist-side") === "left");
    const close = queryAll(left, "[data-wrist-close]")[0];
    const ev = {
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.immediate = true; },
      target: close,
      button: 0,
    };
    for (const fn of close.listeners.pointerdown || []) fn(ev);
    assert.equal(ev.prevented, true);
    assert.equal(ev.stopped, true);
    assert.equal(left.parentNode, null);
    const sides = () => queryAll(host, "[data-wrist-side]").map((n) => n.getAttribute("data-wrist-side"));
    assert.deepEqual(sides(), ["right"]);
    await ticks[0]?.();
    assert.deepEqual(sides(), ["right"]);
  } finally {
    globalThis.URL = prevUrl;
    globalThis.setInterval = prevInterval;
    globalThis.clearInterval = prevClear;
    popups.hide();
  }
});

test("show() still opens Left/Right windows when publish fetch throws", async () => {
  const viewport = fakeEl("main");
  const prevInterval = globalThis.setInterval;
  const prevClear = globalThis.clearInterval;
  globalThis.setInterval = () => 7;
  globalThis.clearInterval = () => {};
  const fetchFn = async () => {
    throw new Error("publish 404");
  };
  const popups = createWristCamPopups({
    viewport,
    fetchFn,
    getCameraHost: () => "192.168.1.83",
    storage: { getItem: () => null, setItem: () => {} },
    document: { createElement: (tag) => fakeEl(tag) },
  });
  try {
    await popups.show();
    assert.equal(popups.isOpen(), true);
    const host = viewport.children[0];
    assert.equal(host.id, "wrist-cam-popups");
    const sides = queryAll(host, "[data-wrist-side]").map((n) => n.getAttribute("data-wrist-side"));
    assert.deepEqual(sides, ["left", "right"]);
  } finally {
    globalThis.setInterval = prevInterval;
    globalThis.clearInterval = prevClear;
    popups.hide();
  }
});

test("hotplug poll publishes without request-permission and hides Allow when live", async () => {
  resetHandCamPublishState();
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  persistCameraPermissionGranted(true);
  const viewport = fakeEl("main");
  const ticks = [];
  const fetchCalls = [];
  const prevInterval = globalThis.setInterval;
  const prevClear = globalThis.clearInterval;
  globalThis.setInterval = (fn) => {
    ticks.push(fn);
    return ticks.length;
  };
  globalThis.clearInterval = () => {};
  const fetchFn = async (url, opts = {}) => {
    fetchCalls.push({ url: String(url), method: String(opts.method || "GET") });
    if (String(url).includes("request-permission")) {
      return { ok: true, json: async () => ({ prompted: true }) };
    }
    if (String(url).includes("/status")) {
      return {
        ok: true,
        json: async () => ({
          publish: false,
          devices: [{ name: "Arducam B0495", skipped: false, side: "right", uniqueId: "0x310000004b44950" }],
          wristCount: 1,
          leftReason: "no wrist USB camera for left (cam labeled Right)",
          rightReason: "",
        }),
      };
    }
    if (String(url).includes("/publish")) {
      if (String(opts.method || "GET") === "GET") {
        return { ok: true, json: async () => ({ publish: false }) };
      }
      return { ok: true, json: async () => ({ publish: true }) };
    }
    return { ok: true, blob: async () => ({ size: 180 }), json: async () => ({}) };
  };
  const prevUrl = globalThis.URL;
  globalThis.URL = { createObjectURL: () => "blob:lan", revokeObjectURL() {} };
  const popups = createWristCamPopups({
    viewport,
    fetchFn,
    getCameraHost: () => "192.168.1.83",
    storage: { getItem: () => null, setItem: () => {} },
    document: { createElement: (tag) => fakeEl(tag) },
  });
  try {
    await popups.show();
    for (const fn of ticks) await fn();
    assert.ok(fetchCalls.some((c) => c.url.includes("/api/robotics/hand-cam/publish") && c.method === "POST"));
    assert.equal(fetchCalls.some((c) => c.url.includes("request-permission")), false);
    const host = viewport.children[0];
    const liveAllows = queryAll(host, "[data-wrist-allow]");
    assert.ok(liveAllows.every((n) => n.hidden || n.classList.contains("hidden")));
    assert.match(src, /maybeHotplugHandCamPublish/);
    assert.match(src, /HAND_CAM_HOTPLUG_MS/);
    assert.equal(src.includes("requestHandCamPermission") && src.includes("pollHotplug"), true);
    assert.equal(/pollHotplug[\s\S]{0,800}requestHandCamPermission/.test(src), false);
  assert.match(app, /camhot1/);
  assert.match(app, /camre1/);
  assert.match(app, /camskip1/);
  assert.match(html, /camskip1/);
  assert.match(app, /camdrag1/);
  } finally {
    globalThis.URL = prevUrl;
    globalThis.setInterval = prevInterval;
    globalThis.clearInterval = prevClear;
    delete globalThis.localStorage;
    popups.hide();
  }
});

test("drag stops on pointerup and does not keep moving", async () => {
  const winListeners = {};
  const win = {
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener(type, fn, opts) {
      (winListeners[type] ||= []).push({ fn, capture: !!(opts === true || opts?.capture) });
    },
    removeEventListener(type, fn, opts) {
      const cap = !!(opts === true || opts?.capture);
      winListeners[type] = (winListeners[type] || []).filter((row) => row.fn !== fn || row.capture !== cap);
    },
    cancelAnimationFrame() {},
  };
  const viewport = fakeEl("main");
  const prevInterval = globalThis.setInterval;
  const prevClear = globalThis.clearInterval;
  globalThis.setInterval = () => 7;
  globalThis.clearInterval = () => {};
  const fetchFn = async () => ({ ok: false, blob: async () => ({ size: 0 }), json: async () => ({}) });
  const popups = createWristCamPopups({
    viewport,
    fetchFn,
    getCameraHost: () => "192.168.1.83",
    storage: { getItem: () => null, setItem: () => {} },
    document: { createElement: (tag) => fakeEl(tag), defaultView: win },
  });
  function fire(type, ev) {
    for (const row of winListeners[type] || []) row.fn(ev);
  }
  try {
    await popups.show();
    const before = popups.getLayout();
    assert.equal(before.right.x + before.right.w, 1440 - WRIST_CAM_PAD);
    assert.equal(before.left.x + before.left.w + WRIST_CAM_GAP, before.right.x);
    const host = viewport.children[0];
    const left = queryAll(host, "[data-wrist-side]").find((n) => n.getAttribute("data-wrist-side") === "left");
    const title = queryAll(left, "[data-wrist-titlebar]")[0];
    const down = {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      buttons: 1,
      clientX: 400,
      clientY: 80,
      currentTarget: title,
      target: title,
      preventDefault() {},
      stopPropagation() {},
    };
    for (const fn of title.listeners.pointerdown || []) fn(down);
    fire("pointermove", { ...down, type: "pointermove", clientX: 440, clientY: 110, buttons: 1 });
    const mid = popups.getLayout().left;
    assert.equal(mid.x, before.left.x + 40);
    assert.equal(mid.y, before.left.y + 30);
    fire("pointerup", { type: "pointerup", pointerId: 7, pointerType: "mouse", buttons: 0, clientX: 440, clientY: 110 });
    const released = popups.getLayout().left;
    fire("pointermove", { type: "pointermove", pointerId: 7, pointerType: "mouse", buttons: 0, clientX: 520, clientY: 180 });
    const after = popups.getLayout().left;
    assert.equal(after.x, released.x);
    assert.equal(after.y, released.y);
    assert.equal((winListeners.pointermove || []).length, 0);
  } finally {
    globalThis.setInterval = prevInterval;
    globalThis.clearInterval = prevClear;
    popups.hide();
  }
});
