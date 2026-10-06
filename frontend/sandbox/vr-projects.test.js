import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxEnabled, sandboxMenuProjects, SANDBOX2_TOKEN, SANDBOX1_KEEP } from "./vr-projects.js";

test("sandbox projects stay off until the Sandbox toggle is pressed", () => {
  assert.equal(SANDBOX2_TOKEN, "sandbox2");
  assert.equal(SANDBOX1_KEEP, "sandbox1");
  assert.equal(sandboxEnabled(), false);
  assert.equal(sandboxMenuProjects(), null);
});
