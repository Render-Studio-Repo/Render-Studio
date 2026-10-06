import assert from "node:assert/strict";
import test from "node:test";

import { createFrameBudget } from "./frame-budget.js";

test("desktop frame budget caps a 60 Hz callback near 30 FPS", () => {
  const budget = createFrameBudget(30);
  const rendered = [];
  for (let now = 0; now <= 1000; now += 1000 / 60) {
    if (budget.shouldRun(now)) rendered.push(now);
  }
  assert.ok(rendered.length >= 29 && rendered.length <= 31, `rendered ${rendered.length} frames`);
});

test("reset allows the next frame immediately", () => {
  const budget = createFrameBudget(30);
  assert.equal(budget.shouldRun(100), true);
  assert.equal(budget.shouldRun(110), false);
  budget.reset();
  assert.equal(budget.shouldRun(110), true);
});

test("invalid timestamps never consume the budget", () => {
  const budget = createFrameBudget(30);
  assert.equal(budget.shouldRun(Number.NaN), false);
  assert.equal(budget.shouldRun(0), true);
});
