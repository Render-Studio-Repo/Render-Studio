import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_WORKSHOP_PROFILE,
  canonicalRoomTransform,
  canonicalWorkshopSpawn,
  migrateCanonicalWorkshop,
  resolveCanonicalWorkshopLayout,
  shouldMigrateCanonicalWorkshop,
} from "./workshop-scene-profile.js";

test("canonical Workshop is meters, Z-up converted once, with the requested entry", () => {
  const config = migrateCanonicalWorkshop({ scene: { background: "#123456", walkSpeed: 2 }, monitors: { editor: "screen_editor_ide" } }, "current");
  assert.deepEqual(canonicalRoomTransform(config), { position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [1, 1, 1] });
  assert.deepEqual(canonicalRoomTransform(config, { desktop: true }), { position: [0, 0, 0], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 1] });
  assert.deepEqual(canonicalWorkshopSpawn(config), { x: 0, y: 1.65, z: 5.2, yaw: Math.PI });
  assert.equal(config.scene.background, "#123456");
  assert.equal(config.scene.walkSpeed, 2);
  assert.deepEqual(config.world.pieces, []);
  assert.equal(config.manifest.assets[0].metersPerUnit, 1);
});

test("migration is targeted and leaves unrelated custom scene orientation alone", () => {
  const custom = { manifest: { assets: [{ projectId: "p", filename: "mesh/custom.glb", transform: { rotation: [1, 2, 3] } }] } };
  assert.equal(shouldMigrateCanonicalWorkshop(custom), false);
  assert.equal(migrateCanonicalWorkshop(custom), custom);
});

test("named node layout prefers converted geometry and has measured fallbacks", () => {
  const config = migrateCanonicalWorkshop();
  const layout = resolveCanonicalWorkshopLayout(config, (name) => name === "Composite_worktop_2" ? [4.2, 0.9, -4.7] : null);
  assert.deepEqual(layout.robot.position, [0, 0.938, -1.8]);
  assert.deepEqual(layout.cad.position, [4.2, 0.9, -4.7]);
  assert.equal(layout.cad.yaw, CANONICAL_WORKSHOP_PROFILE.cad.yaw);
});
