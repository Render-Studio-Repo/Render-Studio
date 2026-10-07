import { test } from "node:test";
import assert from "node:assert/strict";
import { tagSandboxShape, setSandboxShapesVisible, SANDBOX4_TOKEN } from "./viewport-shapes.js";

test("sandbox-off hides tagged shapes and does not destroy them", () => {
  const kids = [{ visible: true, userData: { sandboxShape: true } }];
  const root = {
    visible: true,
    userData: { sandboxShape: true },
    traverse(fn) {
      fn(this);
      kids.forEach(fn);
    },
  };
  tagSandboxShape(root);
  const off = setSandboxShapesVisible(root, false);
  assert.equal(off.visible, false);
  assert.equal(off.destroyed, false);
  assert.equal(off.token, SANDBOX4_TOKEN);
  assert.equal(root.visible, false);
  assert.equal(kids[0].visible, false);
  const on = setSandboxShapesVisible(root, true);
  assert.equal(on.visible, true);
  assert.equal(root.visible, true);
});
