import { test } from "node:test";
import assert from "node:assert/strict";
import { dimLabelSpriteSize } from "./measure-dim-label.js";

test("measure chip follows the dimension, not the whole assembly", () => {
  const largeRobot = 0.024;
  const fortyMm = 0.03978;
  const size = dimLabelSpriteSize(largeRobot, fortyMm);
  assert.ok(size.x < fortyMm * 0.75, `chip ${size.x} should stay under the 40mm span`);
  assert.ok(size.x > fortyMm * 0.25, `chip ${size.x} should stay readable`);
  const oldAssemblySized = (320 / 1024) * largeRobot * 34;
  assert.ok(size.x < oldAssemblySized * 0.2, "must not scale from the full mesh bbox");
});

test("millimetre-unit models keep a compact 40mm chip", () => {
  const size = dimLabelSpriteSize(2.4, 40);
  assert.ok(size.x < 28);
  assert.ok(size.x > 12);
});
