import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../studio/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("desktop frames hide XR-only viewport controls, including re-parented wrist roots", () => {
  assert.match(source, /if \(!presenting\) \{\s*hideImmersiveUiForDesktop\(\);\s*return;/);
  for (const statement of [
    "xrHud.visible = false;",
    "dock.visible = false;",
    "statusDock.visible = false;",
    "captureDock.visible = false;",
    "dockAnchor.visible = false;",
    "statusAnchor.visible = false;",
    "toolHand.setVisible?.(false)",
    "toolWheel.setVisible?.(false)",
  ]) {
    assert.ok(source.includes(statement), `missing desktop XR visibility guard: ${statement}`);
  }
});

test("XR viewport desktop visibility fix is cache-busted", () => {
  assert.match(app, /viewport-xr\.js\?v=.*desktop-xr-hide=20260930-1/);
  assert.match(html, /studio\/app\.js\?v=.*desktop-xr-hide=20260930-1/);
});
