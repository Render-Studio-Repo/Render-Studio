import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIMOS_DEFAULT_BLUEPRINT,
  DIMOS_HEADSET_BLUEPRINTS,
  collectXrInputProfiles,
  detectDimosHeadset,
  dimosBlueprintForHeadset,
  dimosEnsurePayload,
  dimosHeadsetFallbackNote,
} from "./xr-dimos-headset.js";

test("headset → command map: Quest / Vision / Vive all OpenArm quest pipe", () => {
  assert.equal(DIMOS_HEADSET_BLUEPRINTS.quest, "teleop-quest-openarm");
  assert.equal(DIMOS_HEADSET_BLUEPRINTS.vision, "teleop-quest-openarm");
  assert.equal(DIMOS_HEADSET_BLUEPRINTS.vive, "teleop-quest-openarm");
  assert.equal(dimosBlueprintForHeadset("quest"), DIMOS_DEFAULT_BLUEPRINT);
  assert.equal(dimosBlueprintForHeadset("vision"), "teleop-quest-openarm");
  assert.equal(dimosBlueprintForHeadset("vive"), "teleop-quest-openarm");
  assert.equal(dimosBlueprintForHeadset("unknown"), "teleop-quest-openarm");
  assert.match(dimosHeadsetFallbackNote("vision"), /no teleop-vision/);
  assert.match(dimosHeadsetFallbackNote("vive"), /no teleop-vive/);
  assert.equal(dimosHeadsetFallbackNote("quest"), "");
});

test("Quest UA and Touch profiles stay quest even in immersive-ar passthrough", () => {
  assert.equal(detectDimosHeadset({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; Quest 3) OculusBrowser/36.0",
    session: {
      mode: "immersive-ar",
      environmentBlendMode: "alpha-blend",
      inputSources: [{ profiles: ["meta-quest-touch-plus", "generic-trigger-squeeze-thumbstick"] }],
    },
  }), "quest");
  assert.equal(detectDimosHeadset({
    userAgent: "Mozilla/5.0 MetaBrowser",
    profiles: ["oculus-touch-v3"],
    sessionMode: "immersive-vr",
    environmentBlendMode: "opaque",
  }), "quest");
});

test("Vision Pro: VisionOS / immersive-ar / hand-only alpha-blend", () => {
  assert.equal(detectDimosHeadset({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleVisionPro VisionOS/2.0",
    session: { mode: "immersive-ar", environmentBlendMode: "alpha-blend", inputSources: [] },
  }), "vision");
  assert.equal(detectDimosHeadset({
    userAgent: "Mozilla/5.0",
    sessionMode: "immersive-ar",
    environmentBlendMode: "alpha-blend",
    profiles: ["generic-hand"],
  }), "vision");
  assert.equal(detectDimosHeadset({
    userAgent: "Mozilla/5.0 (Macintosh) RealityApp apple-visor",
    xr: { isSessionSupported: () => true },
  }), "vision");
});

test("Vive / Index controller profiles map to vive", () => {
  assert.equal(detectDimosHeadset({
    userAgent: "Mozilla/5.0",
    profiles: ["htc-vive", "generic-trigger-squeeze-touchpad"],
    sessionMode: "immersive-vr",
    environmentBlendMode: "opaque",
  }), "vive");
  assert.equal(detectDimosHeadset({
    userAgent: "Mozilla/5.0 SteamVR Vive",
    session: {
      mode: "immersive-vr",
      environmentBlendMode: "opaque",
      inputSources: [{ profiles: ["valve-index"] }],
    },
  }), "vive");
});

test("default without XR session is quest (LAN OpenArm)", () => {
  assert.equal(detectDimosHeadset({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/129" }), "quest");
  assert.equal(detectDimosHeadset({}), "quest");
});

test("collectXrInputProfiles and ensure payload", () => {
  const session = {
    mode: "immersive-vr",
    environmentBlendMode: "opaque",
    inputSources: [
      { profiles: ["htc-vive"] },
      { profiles: ["generic-button"] },
    ],
  };
  assert.deepEqual(collectXrInputProfiles(session), ["htc-vive", "generic-button"]);
  const payload = dimosEnsurePayload(session, { userAgent: "Mozilla/5.0" });
  assert.equal(payload.headset, "vive");
  assert.equal(payload.blueprint, "teleop-quest-openarm");
  assert.match(payload.fallbackNote, /teleop-vive/);
});
