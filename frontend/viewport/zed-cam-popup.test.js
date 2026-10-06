import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowZedAllow, shouldRequestZedPermission, zedPermissionHelper, ZED_CAM_JPEG_PATH, TOP_CAM_WALL_JPEG_PATH, normalizeTopCameraStatus } from "./zed-cam-popup.js";
import { readFileSync } from "node:fs";

test("shouldShowZedAllow when usb on and not authorized", () => {
  assert.equal(shouldShowZedAllow({ usb: true, permission: "denied" }), true);
  assert.equal(shouldShowZedAllow({ usb: true, permission: "authorized", live: true }), false);
  assert.equal(shouldShowZedAllow({ usb: true, permission: "not_determined", publish: true }), false);
  assert.equal(shouldShowZedAllow({ usb: true, live: true }), false);
});

test("shouldRequestZedPermission only when usb on and not already allowed", () => {
  assert.equal(shouldRequestZedPermission({ usb: true, permission: "not_determined" }), true);
  assert.equal(shouldRequestZedPermission({ usb: true, permission: "authorized" }), false);
  assert.equal(shouldRequestZedPermission({ usb: true, live: true }), false);
  assert.equal(shouldRequestZedPermission({ usb: false, permission: "not_determined" }), false);
  assert.equal(shouldRequestZedPermission({ source: "raspberry-pi", usb: true }), false);
});

test("Pi top webcam wins over the Mac ZED fallback", () => {
  const status = normalizeTopCameraStatus({
    cameras: { zed: { live: true, label: "NexiGo N930AF FHD Webcam", age_ms: 42 } },
  }, { live: false, model: "ZED-M" });
  assert.equal(status.live, true);
  assert.equal(status.source, "raspberry-pi");
  assert.equal(status.model, "NexiGo N930AF FHD Webcam");
  assert.equal(status.framePath, TOP_CAM_WALL_JPEG_PATH);
  assert.equal(shouldRequestZedPermission(status), false);
});

test("zed helper mentions ZEDCaptureDiagnostics", () => {
  assert.match(zedPermissionHelper(), /ZEDCaptureDiagnostics/);
  assert.equal(ZED_CAM_JPEG_PATH, "/api/robotics/zed.jpg");
});

test("robot POV keeps ZED on its dedicated endpoint and camera activation is single-shot", () => {
  const pov = readFileSync(new URL("../studio/robot-pov.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../studio/app.js", import.meta.url), "utf8");
  const actionStart = app.indexOf('if (action === "cam-enable" || action === "cam-wrist")');
  const actionEnd = app.indexOf('\n  if (action === "cam-debug")', actionStart);
  assert.match(pov, /return `\$\{ROBOT_CAMERA_WALL_PATH\}\/\$\{camera\}\.jpg\?t=\$\{tick\}`/);
  assert.doesNotMatch(pov, /robot-camera\.jpg\?url/);
  assert.equal((app.slice(actionStart, actionEnd).match(/zedCamPopup\?\.show/g) || []).length, 0);
  assert.equal((app.slice(actionStart, actionEnd).match(/void window\.__activateZedTopCam\?\.\(\)/g) || []).length, 1);
});
