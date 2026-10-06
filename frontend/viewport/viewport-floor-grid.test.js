import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  floorGridHalfExtent,
  floorGridSize,
  floorClipHalfExtent,
  niceLength,
} from "./viewport-floor-grid.js";

test("floor grid after delete is sized from camera reach, not leftover bbox", () => {
  // Camera still at a CAD viewing pose; sceneRadius collapses to 1 when objects go.
  const half = floorGridHalfExtent({
    sceneRadius: 1,
    cameraPosition: { x: 400, y: -400, z: 280 },
    fovDeg: 50,
    aspect: 1.5,
    far: 100,
    orbitDist: 640,
  });
  const bboxStyle = Math.max(1 * 7, 10) / 2;
  assert.ok(half > 400, `half=${half} should cover camera XY + orbit, not a 10-unit square`);
  assert.ok(half > bboxStyle * 10, "must dwarf the old sceneRadius*7 GridHelper");
  const size = floorGridSize({
    sceneRadius: 1,
    cameraPosition: { x: 400, y: -400, z: 280 },
    fovDeg: 50,
    aspect: 1.5,
    far: 20000,
    orbitDist: 640,
  });
  // Default PerspectiveCamera.far (20000) must not explode cell size.
  assert.ok(size < 80_000, `size=${size} should stay in a drawable GridHelper range`);
  const cell = size / 400;
  assert.ok(cell < 80, `cell=${cell} should still be visible at orbit 640`);
  assert.ok(size >= half * 2 * 0.99);
  assert.equal(floorClipHalfExtent(size, 1) >= size * 0.5 - 1e-6, true);
});

test("low-angle look-across pose does not keep a postage-stamp floor", () => {
  const half = floorGridHalfExtent({
    sceneRadius: 1,
    cameraPosition: { x: 6, y: -6, z: 4.5 },
    fovDeg: 50,
    aspect: 1.51,
    far: 100,
    orbitDist: 9.6,
  });
  // tan(25°)*orbit*2.6/2 ≈ 6 — the old target-plane radius. Ground must be larger.
  assert.ok(half > 40, `half=${half}`);
});

test("niceLength rounds up and clip half never shrinks below the grid", () => {
  assert.equal(niceLength(64), 100);
  assert.equal(floorClipHalfExtent(200, 0.05), 100);
});

test("app.js uses floor-grid helper after delete/move and resets the renderer view", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(app, /viewport-floor-grid\.js\?v=20260908-iphone4-grid9/);
  assert.match(app, /floorGridSize\(/);
  assert.match(app, /resetRendererView\(/);
  assert.match(app, /protectFloorChrome\(/);
  assert.match(app, /restoreFullViewportAfterInteraction\(\{ rebuildFloor: true \}\)/);
  assert.match(html, /app\.js\?[^"\n]*projectperf=20260915-3/);
});

test("50mm part keeps a model-scaled floor, not a leftover horizon grid", () => {
  const leftover = {
    cameraPosition: { x: 400, y: -400, z: 280 },
    fovDeg: 50,
    aspect: 1.5,
    far: 20000,
    orbitDist: 640,
  };
  const half = floorGridHalfExtent({
    sceneRadius: 33, // ~50 mm AABB
    hasContent: true,
    ...leftover,
  });
  assert.ok(half >= 33 * 5, `half=${half} should still pad around the part`);
  assert.ok(half < 800, `half=${half} must not use camera/horizon (that made CAD look like a speck)`);
  const emptyHalf = floorGridHalfExtent({ sceneRadius: 1, hasContent: false, ...leftover });
  assert.ok(emptyHalf > 400, `empty half=${emptyHalf} still covers the view after delete`);
});

test('repeated viewport restores preserve the drawing buffer but reset scissor/clipping', async () => {
  const { resetRendererView } = await import('./viewport-floor-grid.js');
  let resizes = 0; let scissors = 0;
  const canvas = { width: 1600, height: 1200, style: {} };
  const renderer = {
    domElement: canvas, width: 800, height: 600, ratio: 2,
    getSize(v) { return v.set(this.width, this.height); },
    getPixelRatio() { return this.ratio; },
    setSize(w, h) { resizes++; this.width = w; this.height = h; canvas.width = w * this.ratio; canvas.height = h * this.ratio; },
    setViewport() {}, setScissorTest(on) { assert.equal(on, false); scissors++; },
    clippingPlanes: ['old'],
  };
  for (let i = 0; i < 10; i++) resetRendererView(renderer, 800, 600);
  assert.equal(resizes, 0);
  assert.equal(scissors, 10);
  assert.deepEqual(renderer.clippingPlanes, []);
  resetRendererView(renderer, 900, 600);
  assert.equal(resizes, 1);
  // A recording/XR path may change the backing buffer without the CSS size.
  canvas.width = 1;
  resetRendererView(renderer, 900, 600);
  assert.equal(resizes, 2);
  renderer.ratio = 1;
  renderer.clippingPlanes = ['section'];
  resetRendererView(renderer, 900, 600, { clearGlobalClipping: false });
  assert.equal(resizes, 3);
  assert.deepEqual(renderer.clippingPlanes, ['section']);
});
