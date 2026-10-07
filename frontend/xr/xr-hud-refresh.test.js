import test from 'node:test';
import assert from 'node:assert/strict';
import { createHudRefreshGate, createMenuClarityControl } from './xr-hud-refresh.js';

test('72 Hz moving controls upload at most 10 times/sec; idle panels do not upload', () => {
  const gate = createHudRefreshGate(100);
  let uploads = 0;
  for (let frame = 0; frame < 72; frame++) {
    if (gate.shouldPaint(frame * 1000 / 72, String(frame))) uploads++;
  }
  assert.ok(uploads <= 10);
  assert.equal(gate.shouldPaint(1100, 'released'), true);
  assert.equal(gate.shouldPaint(2100, 'released'), false);
  gate.reset();
  assert.equal(gate.shouldPaint(2101, 'released'), true);
});

test('a throttled change is painted on the next eligible frame', () => {
  const gate = createHudRefreshGate(100);
  assert.equal(gate.shouldPaint(0, 'idle'), true);
  assert.equal(gate.shouldPaint(20, 'pressed'), false);
  assert.equal(gate.shouldPaint(100, 'pressed'), true);
});

test('menus disable foveation once; closing restores it; a new session reapplies it', () => {
  const calls = [];
  let session = {};
  const xr = { getSession: () => session, setFoveation: value => calls.push(value) };
  const update = createMenuClarityControl(.35);
  update(xr, true);
  update(xr, true);
  update(xr, false);
  session = {};
  update(xr, false);
  session = null;
  update(xr, true);
  session = {};
  update(xr, true);
  assert.deepEqual(calls, [0, .35, .35, 0]);
});
