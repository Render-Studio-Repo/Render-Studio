import test from "node:test";
import assert from "node:assert/strict";

import { createMobileOverlayCoordinator } from "./mobile-overlay-coordinator.js";

test("opening one mobile surface closes every competing surface exactly once", () => {
  const closed = [];
  const coordinator = createMobileOverlayCoordinator({
    tools: () => closed.push("tools"),
    select: () => closed.push("select"),
    ai: () => closed.push("ai"),
    panel: () => closed.push("panel"),
  });

  assert.equal(coordinator.activate("ai"), "ai");
  assert.deepEqual(closed, ["tools", "select", "panel"]);
  assert.equal(coordinator.active(), "ai");
  coordinator.closeAll();
  assert.deepEqual(closed, ["tools", "select", "panel", "tools", "select", "ai", "panel"]);
  assert.equal(coordinator.active(), null);
});
