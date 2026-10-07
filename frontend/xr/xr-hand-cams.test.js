import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAM_CAMERA_HOST_DEFAULT,
  HAND_CAM_WRIST_SIZE,
  clampHandCamSize,
  defaultCameraHostForUser,
  handCamCanGripMove,
  HAND_CAM_STUDIO_PORT,
  HAND_CAM_PUBLISH_PATH,
  HAND_CAM_STATUS_PATH,
  HAND_CAM_PERMISSION_PATH,
  HAND_CAM_HOTPLUG_MS,
  HAND_CAM_HOTPLUG_CACHE,
  HAND_CAM_CAPTURE_APP_DEFAULT,
  cameraPermissionHelper,
  HAND_CAM_PERMISSION_TIMEOUT_MS,
  HAND_CAM_PUBLISH_COMMAND,
  HAND_CAM_ENABLE_EVENT,
  HAND_CAM_PRESENTATIONS,
  activateWristCameras,
  ensureHandCamPublish,
  handCamLanJpegUrl,
  resetHandCamPublishState,
  handCamJpegUrl,
  handCamMjpegUrl,
  camProxySrc,
  isThisStudioCameraHost,
  isLanStudioLocation,
  MAC_USB_CAM_COMMANDS,
  isSamCameraAccount,
  normalizeCameraHostInput,
  persistHandCamDraft,
  persistHandCamHost,
  persistHandCamMode,
  persistHandCamVrScene,
  toggleHandCamVrScene,
  isHandCamJpegLive,
  isDimosTeleopLinked,
  shouldShowHandCamWindow,
  shouldShowWristCamHideButton,
  wristCamPointerIsOtherHand,
  wristCamHideHitFromLocal,
  wristCamHideButtonLocal,
  wristCamHudPosition,
  wristCamLocalOffset,
  WRIST_CAM_HUD_Y_FLIP,
  WRIST_CAM_LATERAL_M,
  prefsStorageKey,
  readHandCamPrefs,
  displayCameraHost,
  resizeHandCamFromHandle,
  restoreWristCamSize,
  toggleHandCamMode,
  shouldShowHandCamAllow,
  isHandCamPermissionDenied,
  isHandCamUnplugged,
  maybeHotplugHandCamPublish,
  persistCameraPermissionGranted,
  readCameraPermissionGranted,
  swapHandCamLabelMap,
  HAND_CAM_SKIP_CACHE,
  resetHandCamSessionLive,
} from "./xr-hand-cams.js?v=roboticsworkspace3";

test("control IP stays separate from camera host helpers", () => {
  assert.equal(normalizeCameraHostInput("192.168.1.50"), "192.168.1.50");
  assert.equal(normalizeCameraHostInput("192.168.1.50:8089"), "192.168.1.50");
  assert.equal(normalizeCameraHostInput("http://192.168.1.50:8001/api/robotics/hand-cam/left.jpg"), "192.168.1.50");
  assert.equal(normalizeCameraHostInput("8.8.8.8"), "");
  assert.equal(normalizeCameraHostInput(""), "");
  assert.equal(normalizeCameraHostInput("", { samDefault: true }), SAM_CAMERA_HOST_DEFAULT);
});

test("cam IP field stores host only and strips hand-cam paths", () => {
  assert.equal(normalizeCameraHostInput("192.168.1.83"), "192.168.1.83");
  assert.equal(normalizeCameraHostInput("192.168.1.83:8001"), "192.168.1.83");
  assert.equal(normalizeCameraHostInput("http://192.168.1.83:8001"), "192.168.1.83");
  assert.equal(normalizeCameraHostInput("http://192.168.1.83:8001/api/robotics/hand-cam/"), "192.168.1.83");
  assert.equal(normalizeCameraHostInput("http://192.168.1.83:8001/api/robotics/hand-cam/left.jpg"), "192.168.1.83");
  assert.equal(normalizeCameraHostInput("192.168.1.83:8001/api/robotics/hand-cam/"), "192.168.1.83");
  assert.equal(handCamLanJpegUrl("left", "192.168.1.83"), "http://192.168.1.83:8001/api/robotics/hand-cam/left.jpg");
  assert.equal(handCamLanJpegUrl("right", "192.168.1.83:8001"), "http://192.168.1.83:8001/api/robotics/hand-cam/right.jpg");
  assert.equal(normalizeCameraHostInput("192.168.1.83:8095"), "192.168.1.83");
  assert.equal(normalizeCameraHostInput("192.168.1.83:8095:8001"), "192.168.1.83");
  assert.equal(normalizeCameraHostInput("http://192.168.1.83:8095/"), "192.168.1.83");
  assert.equal(handCamLanJpegUrl("left", "192.168.1.83:8095"), "http://192.168.1.83:8001/api/robotics/hand-cam/left.jpg");
  assert.equal(handCamLanJpegUrl("left", "192.168.1.83:8095:8001").includes("8095"), false);
  assert.equal(handCamLanJpegUrl("left", "192.168.1.83:8095:8001").includes("8095:8001"), false);
});

test("Sam account defaults camera host to this Mac LAN", () => {
  assert.equal(isSamCameraAccount({ email: "sam@render3d.app" }), true);
  assert.equal(isSamCameraAccount({ email: "other@example.com" }), false);
  assert.equal(defaultCameraHostForUser({ email: "sam@render3d.app" }), SAM_CAMERA_HOST_DEFAULT);
  assert.equal(defaultCameraHostForUser({ email: "ada@example.com" }), "");
  assert.equal(SAM_CAMERA_HOST_DEFAULT, "192.168.1.83");
});

test("persist camera host and wrist/detach per user id", () => {
  const store = new Map();
  const user = { id: "u-sam", email: "sam@render3d.app" };
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const saved = persistHandCamHost("192.168.1.44", user);
  assert.equal(saved.cameraHost, "192.168.1.44");
  assert.equal(store.get(prefsStorageKey(user)).includes("192.168.1.44"), true);
  assert.equal(readHandCamPrefs(user).camMode, "wrist");
  persistHandCamDraft("192.168.1.91", user);
  assert.equal(readHandCamPrefs(user).cameraHost, "192.168.1.91");
  persistHandCamDraft("192.168.1.", user);
  assert.equal(readHandCamPrefs(user).cameraHostDraft, "192.168.1.");
  assert.equal(readHandCamPrefs(user).cameraHost, "192.168.1.91");
  assert.equal(displayCameraHost(readHandCamPrefs(user), user), "192.168.1.");
  const detached = persistHandCamMode("detach", user);
  assert.equal(detached.camMode, "detach");
  const toggled = toggleHandCamMode(user);
  assert.equal(toggled.camMode, "wrist");
  assert.equal(readHandCamPrefs(user).vrScene, false);
  persistHandCamVrScene(true, user);
  assert.equal(readHandCamPrefs(user).vrScene, true);
  toggleHandCamVrScene(user);
  assert.equal(readHandCamPrefs(user).vrScene, false);
  assert.deepEqual(restoreWristCamSize(), HAND_CAM_WRIST_SIZE);
  delete globalThis.localStorage;
});

test("wrist is default; detach allows grip move; restore set size", () => {
  assert.equal(handCamCanGripMove({ mode: "wrist", squeezed: true }), false);
  assert.equal(handCamCanGripMove({ mode: "detach", squeezed: true }), true);
  assert.equal(handCamCanGripMove({ mode: "detach", squeezed: false }), false);
  const grown = resizeHandCamFromHandle(HAND_CAM_WRIST_SIZE, 0.05);
  assert.ok(grown.w > HAND_CAM_WRIST_SIZE.w);
  const back = clampHandCamSize(HAND_CAM_WRIST_SIZE.w, HAND_CAM_WRIST_SIZE.h);
  assert.deepEqual(back, HAND_CAM_WRIST_SIZE);
});

test("hand cam JPEG uses same-origin when camera host is this Studio", () => {
  const loc = { protocol: "http:", hostname: "192.168.1.83", host: "192.168.1.83:8001" };
  assert.equal(handCamJpegUrl("left", "192.168.1.83", loc), "/api/robotics/hand-cam/left.jpg");
  assert.equal(handCamMjpegUrl("left", "192.168.1.83", loc), "/api/robotics/hand-cam/left.mjpeg");
  assert.equal(isLanStudioLocation(loc), true);
  assert.equal(handCamJpegUrl("right", "192.168.1.50", loc), "/api/robotics/hand-cam/right.jpg?host=192.168.1.50");
  const loop = { protocol: "http:", hostname: "127.0.0.1", host: "127.0.0.1:8001" };
  assert.equal(handCamJpegUrl("left", "192.168.1.83", loop), "/api/robotics/hand-cam/left.jpg");
  const cloud = { protocol: "https:", hostname: "render3d.app", host: "render3d.app" };
  assert.equal(isThisStudioCameraHost("192.168.1.83", cloud), true);
  assert.equal(handCamJpegUrl("left", "192.168.1.83", cloud), "/api/robotics/hand-cam/left.jpg");
  assert.equal(handCamMjpegUrl("left", "192.168.1.83", cloud), "/api/robotics/hand-cam/left.mjpeg");
  assert.equal(isLanStudioLocation(cloud), false);
  assert.equal(handCamJpegUrl("left", "192.168.1.50", cloud), "/api/cam/p/192.168.1.50/8001/left.jpg");
  assert.equal(camProxySrc("192.168.1.83", "/left.jpg"), "/api/cam/p/192.168.1.83/8001/left.jpg");
  assert.equal(normalizeCameraHostInput("192.168.1.83"), "192.168.1.83");
  assert.match(handCamLanJpegUrl("left", "192.168.1.83"), /\/api\/robotics\/hand-cam\/left\.jpg$/);
  assert.match(MAC_USB_CAM_COMMANDS, /system_profiler SPCameraDataType/);
  assert.match(MAC_USB_CAM_COMMANDS, /ffmpeg -f avfoundation -list_devices true/);
  assert.match(MAC_USB_CAM_COMMANDS, /QuickTime Player/);
  assert.match(MAC_USB_CAM_COMMANDS, /imagesnap -l/);
  assert.equal(HAND_CAM_STUDIO_PORT, 8001);
  assert.equal(handCamLanJpegUrl("left"), "http://192.168.1.83:8001/api/robotics/hand-cam/left.jpg");
  assert.equal(handCamLanJpegUrl("right"), "http://192.168.1.83:8001/api/robotics/hand-cam/right.jpg");
  assert.match(HAND_CAM_PUBLISH_COMMAND, /192\.168\.1\.83:8001\/api\/robotics\/hand-cam\/publish/);
  assert.equal(HAND_CAM_PERMISSION_PATH, "/api/robotics/hand-cam/request-permission");
  assert.equal(HAND_CAM_CAPTURE_APP_DEFAULT, "Python.app");
  assert.equal(HAND_CAM_PERMISSION_TIMEOUT_MS, 2500);
  assert.match(cameraPermissionHelper("Python.app"), /Camera prompt for Python/);
  assert.equal(cameraPermissionHelper("Python.app").includes("Developer Tools"), false);
  assert.equal(cameraPermissionHelper("Python.app").includes("Cmd+Shift+G"), false);
  assert.match(MAC_USB_CAM_COMMANDS, /hand-cam\/publish/);
});

test("activateWristCameras POSTs publish once and persists the Mac host", async () => {
  resetHandCamPublishState();
  const store = new Map();
  const calls = [];
  const user = { id: "u-sam", email: "sam@render3d.app" };
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const details = [];
  const prevAdd = globalThis.addEventListener;
  const prevDispatch = globalThis.dispatchEvent;
  globalThis.addEventListener = () => {};
  globalThis.dispatchEvent = (ev) => {
    if (ev?.type === HAND_CAM_ENABLE_EVENT) details.push(ev.detail);
    return true;
  };
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: String(opts.method || "GET"), body: opts.body || "" });
    if (String(opts.method || "GET") === "GET") {
      return { ok: true, json: async () => ({ publish: calls.some((c) => c.method === "POST") }) };
    }
    return { ok: true, json: async () => ({ publish: true }) };
  };
  try {
    const first = await activateWristCameras({ user, fetchFn, restart: true });
    const second = await ensureHandCamPublish({ fetchFn });
    assert.equal(first.host, "192.168.1.83");
    assert.equal(first.port, 8001);
    assert.equal(first.leftUrl, "http://192.168.1.83:8001/api/robotics/hand-cam/left.jpg");
    assert.equal(first.publish, true);
    assert.equal(second.already, true);
    const publishPosts = calls.filter((c) => c.method === "POST" && c.url === HAND_CAM_PUBLISH_PATH);
    assert.equal(publishPosts.length, 1);
    assert.match(String(publishPosts[0].body || ""), /"restart":true/);
    const recam = await activateWristCameras({ user, fetchFn, restart: true });
    assert.equal(recam.publish, true);
    const recamPosts = calls.filter((c) => c.method === "POST" && c.url === HAND_CAM_PUBLISH_PATH);
    assert.equal(recamPosts.length, 2);
    assert.match(String(recamPosts[1].body || ""), /"restart":true/);
    assert.ok(calls.some((c) => c.url === HAND_CAM_STATUS_PATH || String(c.url).includes("/status")));
    assert.match(store.get(prefsStorageKey(user)) || "", /192\.168\.1\.83/);
    assert.equal(details.length >= 1, true);
  } finally {
    globalThis.addEventListener = prevAdd;
    globalThis.dispatchEvent = prevDispatch;
    delete globalThis.localStorage;
  }
});

test("unified activation publishes camera URLs without requesting detached windows", async () => {
  resetHandCamPublishState();
  const details = [];
  const previousDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (event) => { details.push(event.detail); return true; };
  try {
    const result = await activateWristCameras({
      presentation: HAND_CAM_PRESENTATIONS.unified,
      fetchFn: async (_url, options = {}) => ({
        ok: true,
        json: async () => options.method === "POST" ? { publish: true } : { leftLive: true, rightLive: true },
      }),
    });
    assert.equal(result.presentation, "unified");
    assert.equal(details.at(-1).presentation, "unified");
    assert.match(result.leftUrl, /hand-cam\/left\.jpg$/);
    assert.match(result.rightUrl, /hand-cam\/right\.jpg$/);
  } finally {
    globalThis.dispatchEvent = previousDispatch;
  }
});

test("activateWristCameras still onShow when apiFn POST throws", async () => {
  resetHandCamPublishState();
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const prevDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = () => true;
  let shown = 0;
  const apiFn = async (_url, opts = {}) => {
    if (String(opts.method || "GET") === "POST") throw new Error("404");
    return { publish: false };
  };
  const fetchFn = async (url, opts = {}) => {
    if (String(opts.method || "GET") === "POST" || String(url).includes("/publish")) {
      return { ok: true, json: async () => ({ publish: true }) };
    }
    return { ok: false, json: async () => ({}) };
  };
  try {
    const detail = await activateWristCameras({
      user: { id: "u1", email: "sam@render3d.app" },
      apiFn,
      fetchFn,
      onShow: async () => { shown += 1; },
    });
    assert.equal(shown, 1);
    assert.equal(detail.host, "192.168.1.83");
    assert.equal(detail.publish, true);
  } finally {
    globalThis.dispatchEvent = prevDispatch;
    delete globalThis.localStorage;
  }
});

test("VR wrist windows require Robotics and the explicit camera toggle", () => {
  assert.equal(isHandCamJpegLive(null), false);
  assert.equal(isHandCamJpegLive({ complete: true, naturalWidth: 2, naturalHeight: 2 }), false);
  assert.equal(isHandCamJpegLive({ complete: true, naturalWidth: 320, naturalHeight: 240 }), true);
  assert.equal(isDimosTeleopLinked({ connected: true, statusKey: "connected" }), true);
  assert.equal(isDimosTeleopLinked({ connected: true, statusKey: "engaged" }), true);
  assert.equal(isDimosTeleopLinked({ connected: false, statusKey: "connected" }), false);
  assert.equal(isDimosTeleopLinked({ connected: true, statusKey: "armed" }), false);
  assert.equal(isDimosTeleopLinked({ connected: false, statusKey: "connecting", ensureStatus: "already_running" }), false);
  assert.equal(isDimosTeleopLinked({ recognized: true, coordinatorUp: true, presenting: true, statusKey: "off" }), false);
  assert.equal(shouldShowHandCamWindow({ presenting: true, cameraLive: true, teleopLinked: true }), false);
  assert.equal(shouldShowHandCamWindow({ presenting: true, cameraLive: true, vrScene: true }), false);
  assert.equal(shouldShowHandCamWindow({ presenting: true, cameraLive: true }), false);
  assert.equal(shouldShowHandCamWindow({ presenting: true, roboticsEnabled: true }), false);
  assert.equal(shouldShowHandCamWindow({ presenting: true, roboticsEnabled: true, vrScene: true, cameraLive: false }), true);
  assert.equal(shouldShowHandCamWindow({ presenting: true, roboticsEnabled: true, vrScene: true, hidden: true }), false);
  assert.equal(shouldShowHandCamWindow({ presenting: false, roboticsEnabled: true, vrScene: true }), false);
  assert.equal(shouldShowHandCamWindow({ presenting: true, cameraLive: true, teleopLinked: false, vrScene: false }), false);
});

test("wrist cams sit beside the HUD, face the user, and hide from the other pointer", () => {
  assert.equal(WRIST_CAM_HUD_Y_FLIP, Math.PI);
  const leftOff = wristCamLocalOffset("left");
  const rightOff = wristCamLocalOffset("right");
  assert.ok(leftOff.x < 0);
  assert.ok(rightOff.x > 0);
  assert.equal(Math.abs(leftOff.x), WRIST_CAM_LATERAL_M);
  const head = { x: 0, y: 1.6, z: 0 };
  const leftWrist = { x: -0.25, y: 1.2, z: -0.3 };
  const rightWrist = { x: 0.25, y: 1.2, z: -0.3 };
  const right = { x: 1, y: 0, z: 0 };
  const leftPos = wristCamHudPosition("left", leftWrist, head, right);
  const rightPos = wristCamHudPosition("right", rightWrist, head, right);
  assert.ok(leftPos.x < leftWrist.x);
  assert.ok(rightPos.x > rightWrist.x);
  assert.equal(wristCamPointerIsOtherHand("right", "left"), true);
  assert.equal(wristCamPointerIsOtherHand("left", "right"), true);
  assert.equal(wristCamPointerIsOtherHand("left", "left"), false);
  assert.equal(wristCamPointerIsOtherHand("right", "right"), false);
  assert.equal(shouldShowWristCamHideButton({
    roboticsEnabled: true, windowVisible: true, aimingAtWindow: true, pointerHand: "right", windowSide: "left",
  }), true);
  assert.equal(shouldShowWristCamHideButton({
    roboticsEnabled: true, windowVisible: true, aimingAtWindow: true, pointerHand: "left", windowSide: "left",
  }), false);
  assert.equal(shouldShowWristCamHideButton({
    roboticsEnabled: false, windowVisible: true, aimingAtWindow: true, pointerHand: "right", windowSide: "left",
  }), false);
  const hideAt = wristCamHideButtonLocal();
  assert.equal(wristCamHideHitFromLocal(hideAt), "hide");
  assert.equal(wristCamHideHitFromLocal({ x: 0, y: 0, z: 0 }), "window");
  assert.equal(wristCamHideHitFromLocal({ x: 2, y: 0, z: 0 }), null);
});

test("Allow is hidden when unplugged; shown on TCC deny or never granted this session", () => {
  resetHandCamSessionLive();
  assert.equal(shouldShowHandCamAllow({ live: true, reason: "camera permission denied for Studio" }), false);
  assert.equal(shouldShowHandCamAllow({ live: false, wristCount: 1, reason: "", grantedThisSession: true }), false);
  assert.equal(shouldShowHandCamAllow({ live: false, wristCount: 1, reason: "", grantedThisSession: false }), true);
  assert.equal(shouldShowHandCamAllow({ live: false, wristCount: 0, devices: [], reason: "no wrist USB camera plugged in" }), false);
  assert.equal(shouldShowHandCamAllow({
    live: false,
    wristCount: 0,
    devices: [{ name: "Capture screen 0", skipped: true }],
    reason: "no wrist USB camera plugged in (only Capture screen)",
  }), false);
  assert.equal(shouldShowHandCamAllow({ live: false, wristCount: 0, reason: "no wrist USB camera after skip FaceTime" }), false);
  assert.equal(shouldShowHandCamAllow({ live: false, reason: "camera permission denied for Studio (open timed out)" }), true);
  assert.equal(isHandCamUnplugged({ devices: [], reason: "no wrist USB camera plugged in" }), true);
  assert.equal(isHandCamPermissionDenied("ffmpeg allowed, Python.app still needs Camera"), true);
  assert.equal(HAND_CAM_HOTPLUG_MS, 1500);
  assert.equal(HAND_CAM_HOTPLUG_CACHE, "camhot1");
  assert.equal(HAND_CAM_SKIP_CACHE, "camskip1");
});

test("hotplug publish does not call request-permission", async () => {
  resetHandCamPublishState();
  const store = new Map();
  const user = { id: "u-hot", email: "ada@example.com" };
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  persistCameraPermissionGranted(true, user);
  assert.equal(readCameraPermissionGranted(user), true);
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: String(opts.method || "GET") });
    if (String(opts.method || "GET") === "GET") {
      return { ok: true, json: async () => ({ publish: false }) };
    }
    return { ok: true, json: async () => ({ publish: true }) };
  };
  const plugged = await maybeHotplugHandCamPublish({
    user,
    fetchFn,
    status: {
      publish: false,
      devices: [{ name: "Arducam B0495", skipped: false, side: "right", uniqueId: "0x310000004b44950" }],
      leftLive: false,
      rightLive: false,
    },
  });
  assert.equal(plugged.action, "publish");
  assert.equal(plugged.publish, true);
  assert.ok(calls.some((c) => c.url === HAND_CAM_PUBLISH_PATH && c.method === "POST"));
  assert.equal(calls.some((c) => c.url.includes("request-permission")), false);

  const empty = await maybeHotplugHandCamPublish({
    user,
    fetchFn,
    status: { devices: [{ name: "Capture screen 0", skipped: true }], publish: false },
  });
  assert.equal(empty.action, "unplugged");

  const denied = await maybeHotplugHandCamPublish({
    user: { id: "u-new", email: "ada@example.com" },
    fetchFn,
    status: {
      devices: [{ name: "Arducam B0495", skipped: false }],
      leftReason: "camera permission denied for Studio (open timed out)",
      rightReason: "camera permission denied for Studio (open timed out)",
    },
  });
  assert.equal(denied.action, "need-allow");
  assert.equal(calls.filter((c) => c.url.includes("request-permission")).length, 0);

  const swapped = swapHandCamLabelMap([
    { name: "Arducam B0495", uniqueId: "0x310000004b44950", skipped: false },
  ], user);
  assert.equal(Object.values(swapped.cameraLabels)[0].side, "right");
  delete globalThis.localStorage;
});
