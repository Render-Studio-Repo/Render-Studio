import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function functionSource(path, start, end) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  const at = text.indexOf(start);
  assert.ok(at >= 0, `Missing function ${start}`);
  const next = text.indexOf(end, at + start.length);
  assert.ok(next > at, `Missing boundary ${end}`);
  return text.slice(at, next);
}

test('closing an avatar preview releases its context once without disposing shared peer geometry', () => {
  const events = [];
  const material = { dispose() { events.push('material'); } };
  const geometry = { dispose() { events.push('shared-geometry'); } };
  const preview = {
    figure: { traverse(fn) { fn({ geometry, material: [material, material] }); } },
    renderer: {
      dispose() { events.push('renderer'); throw new Error('Already lost'); },
      forceContextLoss() { events.push('lose'); },
      domElement: { remove() { events.push('remove'); } },
    },
  };
  const source = functionSource('../social/social-network-ui.js', '  function stopAvatarPreview()', '\n  function startAvatarPreview(');
  const stop = runInNewContext(`let avatarRaf = 2; let avatarPreview = preview; ${source}; stopAvatarPreview`, {
    preview, cancelAnimationFrame: value => events.push(`cancel:${value}`),
  });
  stop(); stop();
  assert.deepEqual(events, ['cancel:2', 'material', 'renderer', 'lose', 'remove']);
});

test('recording cleanup disposes the spectator without forceContextLoss on the live XR GPU', () => {
  const events = [];
  const recording = {
    renderer: {
      dispose() { events.push('dispose'); throw new Error('Already lost'); },
      forceContextLoss() { events.push('lose'); },
    },
    canvas: { remove() { events.push('remove'); } },
  };
  const source = functionSource('../xr/viewport-xr.js', '  function disposeRecordSpectator()', '\n  /**');
  const stop = runInNewContext(`let recordSpectator = recording; let recordOverlay = null; let lastRecordPaintAt = 5; ${source}; disposeRecordSpectator`, { recording });
  stop(); stop();
  assert.deepEqual(events, ['dispose', 'remove']);
  assert.equal(events.includes('lose'), false);
});

test('mini-viewer shares one offscreen WebGLRenderer and blits to a 2D canvas', () => {
  const mini = readFileSync(new URL('./mini-viewer.js', import.meta.url), 'utf8');
  assert.match(mini, /function getSharedOffscreenRenderer/);
  assert.match(mini, /new THREE\.WebGLRenderer/);
  assert.match(mini, /drawImage/);
  assert.match(mini, /getContext\(["']2d["']\)/);
  assert.doesNotMatch(mini, /forceContextLoss/);
  assert.doesNotMatch(mini, /from ["'].*share-viewer/);
  assert.doesNotMatch(mini, /#viewport/);
  assert.equal([...mini.matchAll(/new THREE\.WebGLRenderer/g)].length, 1);
});

test('wiring thumbs keep a single snapshot renderer', () => {
  const top = readFileSync(new URL('../wiring/wiring-top-view.js', import.meta.url), 'utf8');
  assert.match(top, /new THREE\.WebGLRenderer/);
  assert.equal([...top.matchAll(/new THREE\.WebGLRenderer/g)].length, 1);
});
