import test from "node:test";
import assert from "node:assert/strict";
import { clampWorkshopHeadToFloor, workshopAssetRotation, workshopStandingHead } from "./workshop-desktop-navigation.js";

test("desktop Workshop starts upright at standing height over the floor", () => {
  assert.deepEqual(
    workshopStandingHead({ x: 2, y: 12, z: -4, yaw: 1.25 }),
    { x: 2, y: 1.65, z: -4, yaw: 1.25, pitch: 0, floorY: 0 },
  );
});

test("desktop Workshop movement cannot put the viewer through the floor", () => {
  assert.deepEqual(
    clampWorkshopHeadToFloor({ x: 1, y: -50, z: 2 }),
    { x: 1, y: 1.65, z: 2 },
  );
  assert.deepEqual(
    clampWorkshopHeadToFloor({ x: 1, y: 2.1, z: 2 }),
    { x: 1, y: 2.1, z: 2 },
  );
});

test("desktop Workshop flips the supplied scene upright without changing VR", () => {
  assert.deepEqual(workshopAssetRotation([0.1, 0.2, 0.3], { desktop: true }), [0.1 + Math.PI, 0.2, 0.3]);
  assert.deepEqual(workshopAssetRotation([0.1, 0.2, 0.3], { desktop: false }), [0.1, 0.2, 0.3]);
});
