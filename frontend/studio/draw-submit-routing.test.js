import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDrawSubmitMode } from './draw-submit-routing.js';
test('explicit model submits in Draw route to CAD, including voice sketches', () => {
  for (const options of [{}, { source: 'xr', legacyDrawCommand: true }, { hasSpatialSketch: true, legacyDrawCommand: true }, { canvasAttached: true }]) {
    assert.equal(resolveDrawSubmitMode({ mode: 'draw', ...options }), 'v2');
  }
});
test('legacy face/route edits and other explicit generation modes remain intact', () => {
  assert.equal(resolveDrawSubmitMode({ mode: 'draw', source: 'ui', legacyDrawCommand: true }), 'draw');
  for (const mode of ['mesh', 'render', 'architect', 'v2']) assert.equal(resolveDrawSubmitMode({ mode, source: 'xr' }), mode);
});
