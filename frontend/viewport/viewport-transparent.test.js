import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTransparentToolSkipObject,
  collectTransparentTargets,
  applyAllTransparentSelection,
  restoreAllTransparentSelection,
  transparentModeAfterDisable,
} from "./viewport-transparent.js";

test("All objects collects assembly CAD and skips UI / gizmos / grid / sky", () => {
  const cadA = { name: "body", visible: true, userData: {} };
  const cadB = { name: "housing", visible: true, userData: {} };
  const hidden = { name: "spare", visible: false, userData: {} };
  const grid = { name: "grid", visible: true, userData: { isGrid: true } };
  const gizmo = { name: "transform-controls", visible: true, userData: { isGizmo: true } };
  const sky = { name: "sky", visible: true, userData: { isSky: true } };
  const fence = { name: "printer-fence", visible: true, userData: { isPrinterFence: true } };
  const hud = { name: "xr-dock", visible: true, userData: { xrUi: true } };
  const entries = [
    ["a", cadA],
    ["b", cadB],
    ["h", hidden],
    ["g", grid],
    ["z", gizmo],
    ["s", sky],
    ["f", fence],
    ["u", hud],
  ];
  assert.equal(isTransparentToolSkipObject(grid), true);
  assert.deepEqual(collectTransparentTargets(entries), [cadA, cadB]);
  assert.deepEqual(collectTransparentTargets([], [cadA]), [cadA]);
});

test("apply all transparent then restore empties the selection", () => {
  const a = { name: "a" };
  const b = { name: "b" };
  const selected = new Set();
  const applied = applyAllTransparentSelection(selected, [a, b, null]);
  assert.deepEqual(applied, [a, b]);
  assert.equal(selected.size, 2);
  assert.equal(selected.has(a) && selected.has(b), true);
  const restored = restoreAllTransparentSelection(selected);
  assert.deepEqual(restored, [a, b]);
  assert.equal(selected.size, 0);
  assert.equal(transparentModeAfterDisable(), "click");
});

test("viewport Transparent control has a ▾ All objects menu", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(html, /id="btn-transparent-viewport"/);
  assert.match(html, /id="btn-transparent-options"/);
  assert.match(html, /viewport-transparent-menu/);
  assert.match(html, /data-transparent-mode="entire"/);
  assert.match(html, />All objects</);
  assert.match(html, /alltrans=20260916-1/);
  assert.match(app, /alltrans=20260916-1/);
  assert.match(app, /collectTransparentTargets/);
  assert.match(app, /applyAllTransparentSelection/);
  assert.match(app, /transparentModeAfterDisable/);
  const off = app.slice(
    app.indexOf("function setTransparentPickEnabled"),
    app.indexOf("function toggleTransparentPick"),
  );
  assert.match(off, /clearViewportTransparent\(\)/);
  assert.match(off, /transparentModeAfterDisable\(\)/);
  const setMode = app.slice(
    app.indexOf("function setTransparentMode"),
    app.indexOf("function setTransparentPickEnabled"),
  );
  assert.match(setMode, /setTransparentPickEnabled\(true\)/);
  const menuStart = app.indexOf('document.getElementById("viewport-transparent-menu")');
  assert.ok(menuStart >= 0);
  const menu = app.slice(menuStart, app.indexOf("document.addEventListener(\"click\"", menuStart));
  assert.match(menu, /setTransparentMode\("entire"\)/);
  assert.match(app, /id === "transparent_all"/);
});
