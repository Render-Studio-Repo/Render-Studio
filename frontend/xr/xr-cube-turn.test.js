import test from "node:test";
import assert from "node:assert/strict";
import { worldYawQuaternion } from "./xr-cube-turn.js";

test("cube turn composes fixed 15 degree world-up increments", () => {
  const right = worldYawQuaternion([0, 0, 0, 1], 15);
  assert.ok(Math.abs(right[1] - Math.sin(Math.PI / 24)) < 1e-12);
  assert.ok(Math.abs(right[3] - Math.cos(Math.PI / 24)) < 1e-12);
  const restored = worldYawQuaternion(right, -15);
  assert.ok(Math.hypot(restored[0], restored[1], restored[2]) < 1e-12);
  assert.ok(Math.abs(restored[3] - 1) < 1e-12);
});

test("cube turn keeps a normalized tilted orientation", () => {
  const out = worldYawQuaternion([0.2, 0.3, 0.1, 0.9], 15);
  assert.ok(Math.abs(Math.hypot(...out) - 1) < 1e-12);
});
