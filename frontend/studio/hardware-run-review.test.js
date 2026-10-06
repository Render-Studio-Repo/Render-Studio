import assert from "node:assert/strict";
import test from "node:test";
import { createHardwareRunReview, hardwareReviewMarkup } from "./hardware-run-review.js";

test("a physical run pauses for review and cannot reset before labeling and checklist approval", () => {
  const writes = [];
  const review = createHardwareRunReview({ now: () => new Date("2026-09-28T22:00:00Z"), storage: { getItem: () => "[]", setItem: (_key, value) => writes.push(JSON.parse(value)) } });
  review.stage({ startingPosition: "Home · arms down", target: "OpenArm Pi", policy: "Cube pick" });
  review.start({ runId: "physical-1" });
  review.complete({ result: "uncertain", confidence: 0.62, reason: "Cube partly occluded", evidence: ["3 cameras live"] });

  assert.equal(review.snapshot().phase, "review");
  assert.equal(review.canReset(), false);
  assert.match(hardwareReviewMarkup(review.snapshot()), /Accept UNCERTAIN/);

  review.review({ result: "pass" });
  for (const key of ["workspaceClear", "objectReset", "camerasReady"]) review.setResetCheck(key, true);
  assert.equal(review.canReset(), false, "saved training episode is part of the reset interlock");
  review.markEpisodeSaved(true);
  assert.equal(review.canReset(), true);
  assert.equal(writes.at(-1).at(-1).finalResult, "pass");
  review.beginReset();
  review.resetComplete();
  assert.equal(review.snapshot().phase, "staged");
});

test("a safety fault forces fail review and blocks reset even after operator labeling", () => {
  const review = createHardwareRunReview({ now: () => new Date("2026-09-28T22:00:00Z"), storage: { getItem: () => "[]", setItem: () => {} } });
  review.stage({ startingPosition: "Home" });
  review.start();
  review.latchFault("Joint limit fault");
  review.review({ result: "fail", failureReason: "joint_limit" });
  for (const key of ["workspaceClear", "objectReset", "camerasReady"]) review.setResetCheck(key, true);

  assert.equal(review.snapshot().automatic.result, "fail");
  assert.equal(review.snapshot().faultLatched, true);
  assert.equal(review.canReset(), false);
  assert.match(hardwareReviewMarkup(review.snapshot()), /Safety fault latched/);

  review.markEpisodeSaved(true);
  review.clearFaultAfterRecovery();
  assert.equal(review.snapshot().faultLatched, false);
  assert.equal(review.canReset(), true, "verified recovery clears only the fault latch; review and checklist still gate reset");
});

test("hardware review is visibly identified as the LeRobot episode console", () => {
  const review = createHardwareRunReview();
  const markup = hardwareReviewMarkup(review.snapshot());
  assert.match(markup, /LEROBOT · PHYSICAL EPISODE/);
  assert.match(markup, /Hardware PASS \/ FAIL review/);
});
