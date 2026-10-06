import assert from "node:assert/strict";
import test from "node:test";
import { latestGenerationLast, nearDuplicateModelBoxes } from "./generation-component-dedupe.js";

const box = (min, max) => ({
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] },
});

test("same-size generated deliveries at the same pose are duplicates", () => {
  assert.equal(nearDuplicateModelBoxes(box([0, 0, 0], [100, 80, 30]), box([2, 1, 0], [102, 81, 30])), true);
});

test("separate assembly parts and materially different variants stay visible", () => {
  assert.equal(nearDuplicateModelBoxes(box([0, 0, 0], [100, 80, 30]), box([80, 0, 0], [180, 80, 30])), false);
  assert.equal(nearDuplicateModelBoxes(box([0, 0, 0], [100, 80, 30]), box([0, 0, 0], [65, 80, 30])), false);
});

test("a new generation loads after existing siblings so placement has an anchor", () => {
  const existing = { name: "existing.glb" };
  const newest = { name: "new.glb" };
  assert.deepEqual(latestGenerationLast([newest, existing], "new.glb"), [existing, newest]);
});
