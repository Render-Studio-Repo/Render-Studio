import test from "node:test";
import assert from "node:assert/strict";
import { shouldRenderViewportFrame } from "./viewport-render-activity.js";

test("desktop viewport frame activity follows visibility while XR always renders", () => {
  assert.equal(shouldRenderViewportFrame({ presenting: false, documentHidden: false, viewportHidden: false }), true);
  assert.equal(shouldRenderViewportFrame({ presenting: false, documentHidden: false, viewportHidden: true }), false);
  assert.equal(shouldRenderViewportFrame({ presenting: false, documentHidden: true, viewportHidden: false }), false);
  assert.equal(shouldRenderViewportFrame({ presenting: true, documentHidden: true, viewportHidden: true }), true);
});
