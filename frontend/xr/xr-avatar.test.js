import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AVATAR_MESH_SOURCE,
  AVATAR_SETTINGS_ACTIONS,
  applyAvatarAction,
  avatarDeviceProp,
  avatarSpecKey,
  blinkLidScale,
  BLINK_MAX_MS,
  BLINK_MIN_MS,
  compactAvatarForPose,
  defaultAvatarSpec,
  detectXrDevice,
  deviceLabelFromUser,
  devicePropFromUser,
  deviceSupportsHandTracking,
  formatNameWithDevice,
  isXrStandardControllerProfile,
  loadAvatarSpec,
  nextBlinkDelay,
  normalizeAvatarSpec,
  parseAvatarFromPose,
  saveAvatarSpec,
  sanitizeXrDevice,
  sanitizeXrMode,
  sanitizeXrProp,
  XR_INPUT_PROFILES,
  xrHeadsetFromUa,
} from "./xr-avatar.js?v=roboticsworkspace3";

const here = dirname(fileURLToPath(import.meta.url));

test("device parser maps UA and session profiles to Quest / Pico / PC", () => {
  assert.equal(detectXrDevice({ userAgent: "Mozilla/5.0 OculusBrowser Quest 3" }).label, "Quest 3");
  assert.equal(detectXrDevice({ userAgent: "OculusBrowser Quest 3S" }).label, "Quest 3S");
  assert.equal(detectXrDevice({ userAgent: "OculusBrowser Quest 2" }).label, "Quest 2");
  assert.equal(detectXrDevice({ userAgent: "OculusBrowser", profiles: ["meta-quest-touch-pro"] }).label, "Quest Pro");
  assert.equal(detectXrDevice({ userAgent: "PicoBrowser/1.0 Pico 4" }).label, "Pico");
  assert.equal(detectXrDevice({ userAgent: "Mozilla/5.0 (Macintosh) Chrome/120" }).label, "PC");
  assert.equal(detectXrDevice({ userAgent: "iPhone OS 17 Mobile Safari" }).label, "Phone");
  assert.equal(detectXrDevice({ userAgent: "Mozilla", presenting: true, xrMode: "vr" }).label, "VR");
  assert.equal(detectXrDevice({ userAgent: "Mozilla", xrMode: "ar", presenting: true }).label, "AR");
  assert.equal(detectXrDevice({ userAgent: "AppleWebKit VisionOS" }).label, "Vision Pro");
  assert.equal(detectXrDevice({ userAgent: "Snap Spectacles" }).label, "Spectacles");
  assert.equal(detectXrDevice({ userAgent: "Chrome", profiles: ["valve-index"] }).label, "Index");
  assert.equal(sanitizeXrDevice("Quest 3!!!!!!!!!!!!!!extra-long-junk").length <= 24, true);
  assert.equal(sanitizeXrMode("AR"), "ar");
  assert.equal(sanitizeXrMode("desk"), "");
  assert.equal(sanitizeXrProp("hmd"), "hmd");
  assert.equal(sanitizeXrProp("helmet"), "");
});

test("device → head prop: Quest 3 hmd, iPhone phone, desktop none, Spectacles glasses", () => {
  assert.equal(avatarDeviceProp("Quest 3"), "hmd");
  assert.equal(avatarDeviceProp("iPhone"), "phone");
  assert.equal(avatarDeviceProp("desktop"), "none");
  assert.equal(avatarDeviceProp("Spectacles"), "glasses");
  assert.equal(avatarDeviceProp("Vision Pro"), "visor");
  assert.equal(avatarDeviceProp("PC"), "none");
  assert.equal(xrHeadsetFromUa({ userAgent: "Mozilla/5.0 OculusBrowser Quest 3" }).prop, "hmd");
  assert.equal(xrHeadsetFromUa({ userAgent: "iPhone OS 17 Mobile Safari" }).prop, "phone");
  assert.equal(xrHeadsetFromUa({ userAgent: "Mozilla/5.0 (Macintosh) Chrome/120" }).prop, "none");
  assert.equal(xrHeadsetFromUa({ userAgent: "Snap Spectacles" }).prop, "glasses");
  assert.equal(xrHeadsetFromUa({ userAgent: "Mozilla/5.0 (Macintosh)", presenting: true, xrMode: "vr" }).prop, "none");
  assert.equal(devicePropFromUser({ xr_device: "Quest 3", xr_prop: "hmd" }), "hmd");
  assert.equal(devicePropFromUser({ xrPose: { xr_device: "iPhone" }, xr_prop: "phone" }), "phone");
});

test("blink interval helper stays in 2–5s and lids close then open", () => {
  assert.equal(nextBlinkDelay(() => 0), BLINK_MIN_MS);
  assert.equal(nextBlinkDelay(() => 1), BLINK_MAX_MS);
  assert.equal(BLINK_MIN_MS, 2000);
  assert.equal(BLINK_MAX_MS, 5000);
  assert.equal(blinkLidScale(-10), 1);
  assert.equal(blinkLidScale(0), 1);
  assert.ok(blinkLidScale(35) < 0.7 && blinkLidScale(35) > 0.4);
  assert.ok(blinkLidScale(70) <= 0.1);
  assert.equal(blinkLidScale(400), 1);
});

test("input profile list includes non-Quest names and rejects hand-only", () => {
  for (const id of [
    "meta-quest-touch-plus",
    "meta-quest-touch-pro",
    "htc-vive",
    "valve-index",
    "pico-neo",
    "apple-visor",
    "snap-spectacles",
  ]) {
    assert.ok(XR_INPUT_PROFILES.includes(id), id);
  }
  assert.ok(XR_INPUT_PROFILES.some((p) => p.includes("magicleap")));
  assert.ok(XR_INPUT_PROFILES.some((p) => p.includes("samsung")));
  assert.equal(isXrStandardControllerProfile("valve-index"), true);
  assert.equal(isXrStandardControllerProfile("htc-vive"), true);
  assert.equal(isXrStandardControllerProfile("apple-visor"), true);
  assert.equal(isXrStandardControllerProfile("snap-spectacles"), true);
  assert.equal(isXrStandardControllerProfile("generic-hand-select"), false);
  assert.equal(isXrStandardControllerProfile("oculus-hand"), false);
  assert.equal(deviceSupportsHandTracking("Quest 3"), true);
  assert.equal(deviceSupportsHandTracking("Index"), false);
  assert.equal(deviceSupportsHandTracking("PC"), false);
});

test("default avatar spec and pose payload stay compact", () => {
  const spec = defaultAvatarSpec();
  assert.equal(spec.source, "studio");
  assert.equal(spec.body, "default");
  assert.equal(spec.outfit, "studio");
  assert.equal(AVATAR_MESH_SOURCE, "procedural-and-kenney-cc0");
  const pose = {
    head: { p: [0, 1.6, 0] },
    avatar: compactAvatarForPose(spec),
    xr_device: "Quest 3",
    xr_mode: "vr",
    xr_prop: "hmd",
  };
  assert.equal(pose.xr_device, "Quest 3");
  assert.equal(pose.xr_prop, "hmd");
  assert.deepEqual(parseAvatarFromPose(pose), spec);
  assert.equal(avatarSpecKey(normalizeAvatarSpec({ source: "nope", body: "x" })), "studio:default:studio");
});

test("avatar settings action ids exist in module and Social hub", () => {
  for (const id of ["avatar", "avatar-open", "avatar-body-next", "avatar-outfit-next", "avatar-source-horizon"]) {
    assert.ok(AVATAR_SETTINGS_ACTIONS.includes(id), id);
  }
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes('id: "avatar"'));
  assert.ok(xr.includes("openAvatarPanel") || xr.includes("toggleAvatarPanel"));
  assert.ok(xr.includes("xr_device"));
  assert.ok(xr.includes("xr_prop"));
  assert.ok(xr.includes("isXrStandardControllerProfile"));
  assert.ok(xr.includes("shouldRelayerOverlays"));
  assert.ok(xr.includes("shouldRebuildMenuHits"));
  const store = new Map();
  const fake = { getItem: (k) => store.get(k), setItem: (k, v) => store.set(k, v) };
  const saved = saveAvatarSpec("u1", { source: "horizon", body: "tall", outfit: "quest" }, fake);
  assert.equal(saved.source, "horizon");
  assert.equal(loadAvatarSpec("u1", fake).body, "tall");
  const hz = applyAvatarAction(saved, "avatar-source-horizon", { userAgent: "OculusBrowser Quest 3" });
  assert.match(hz.note, /Horizon mesh/i);
});

test("social device badge next to names", () => {
  assert.equal(deviceLabelFromUser({ display_name: "Ada", xr_device: "Quest 3" }), "Quest 3");
  assert.equal(deviceLabelFromUser({ xrPose: { xr_device: "Quest 3S" } }), "Quest 3S");
  assert.equal(deviceLabelFromUser({ inXr: true }), "VR");
  assert.equal(formatNameWithDevice("Ada", { xr_device: "Quest 3" }), "Ada  ·  Quest 3");
});
