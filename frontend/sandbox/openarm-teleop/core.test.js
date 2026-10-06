import test from "node:test";
import assert from "node:assert/strict";
import { trainingDecision, validateSample, wilsonLower } from "./core.js";

test("wilson lower bound is zero with no trials", () => {
  assert.equal(wilsonLower(0, 0), 0);
});

test("validateSample rejects non-monotonic sequences", () => {
  const a = {
    sequence: 1,
    timestamp_ms: 10,
    head_pose: { position: [0, 1, 0], quaternion: [0, 0, 0, 1] },
    left_grip_pose: { position: [0, 1, 0], quaternion: [0, 0, 0, 1] },
    right_grip_pose: { position: [0, 1, 0], quaternion: [0, 0, 0, 1] },
  };
  const b = { ...a, sequence: 1, timestamp_ms: 20 };
  assert.ok(validateSample(b, a).includes("non_monotonic"));
});

test("trainingDecision asks for more trials when empty", () => {
  const d = trainingDecision([]);
  assert.equal(d.action, "run_5_more_heldout_trials");
});
