import test from "node:test";
import assert from "node:assert/strict";
import { shouldTrustAuthoredCadZUp } from "./cad-orientation-policy.js";

test("Jake text-to-CAD previews preserve their authored STEP +Z-up frame", () => {
  assert.equal(shouldTrustAuthoredCadZUp("v2-upright"), true);
});

test("untagged imports still use the established axis heuristic", () => {
  assert.equal(shouldTrustAuthoredCadZUp(null), false);
  assert.equal(shouldTrustAuthoredCadZUp(""), false);
});
