import test from 'node:test';
import assert from 'node:assert/strict';
import { intersectCanvasPlaneRay } from './xr-draw-canvas-plane.js';

test('laser lands at the correct canvas position in meters', () => {
  assert.deepEqual(intersectCanvasPlaneRay([0, 0, 2], [0.25, -0.1, -1]), { point: [0.5, -0.2, 0], distance: 2 });
});

test('laser cannot draw outside the board or behind the controller', () => {
  assert.equal(intersectCanvasPlaneRay([0, 0, 2], [1, 0, -1]), null);
  assert.equal(intersectCanvasPlaneRay([0, 0, 2], [0, 1, -1]), null);
  assert.equal(intersectCanvasPlaneRay([0, 0, 2], [0, 0, 1]), null);
  assert.equal(intersectCanvasPlaneRay([0, 0, 2], [1, 0, 0]), null);
  assert.equal(intersectCanvasPlaneRay([NaN, 0, 2], [0, 0, -1]), null);
});

test('the entire 3 by 1.8 meter canvas remains drawable through its edges', () => {
  assert.deepEqual(intersectCanvasPlaneRay([1.5, 0.9, 2], [0, 0, -1])?.point, [1.5, 0.9, 0]);
  assert.deepEqual(intersectCanvasPlaneRay([-1.5, -0.9, 2], [0, 0, -1])?.point, [-1.5, -0.9, 0]);
});
