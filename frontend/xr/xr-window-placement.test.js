import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findWindowPlacement,
  windowFootprint,
  windowsOverlap,
  windowLookAtQuaternion,
  windowFaceTowardHead,
  plusZTowardHead,
} from './xr-window-placement.js';
test('new windows of different sizes do not cover existing windows', () => {
  const occupied = [];
  for (const width of [.5, .8, .46, 1.2, .6, .55, .8, .46]) {
    const slot = findWindowPlacement({width, height:.4, occupied});
    assert.ok(occupied.every(other => !windowsOverlap(slot, other)));
    assert.ok(Math.abs(Math.hypot(slot.right, slot.forward) - .55) < .001);
    occupied.push(slot);
  }
});
test('keeps a free preferred pose and finds space around anchored windows', () => {
  const anchored = windowFootprint({width: .9, height:.5});
  const before = {...anchored};
  const slot = findWindowPlacement({width:.4, height:.4, occupied:[anchored], preferred:{yaw:0,up:-.08}});
  assert.equal(windowsOverlap(slot, anchored),false);
  assert.deepEqual(anchored,before);
  const saved = findWindowPlacement({width:.4,height:.3, preferred:{yaw:.5,up:.1}});
  assert.equal(saved.yaw,.5); assert.equal(saved.up,.1);
});

test('lookAt without a Y flip points the readable face away; spawn faces the head', () => {
  const head = { x: 0, y: 1.6, z: 0 };
  const inFront = { x: 0, y: 1.48, z: -0.82 };
  const behind = { x: 0, y: 1.48, z: 0.82 };
  const look = windowLookAtQuaternion(inFront, head);
  assert.ok(plusZTowardHead(look, inFront, head) < 0, 'raw lookAt aims +Z away from the HMD');
  const face = windowFaceTowardHead(inFront, head);
  assert.ok(plusZTowardHead(face, inFront, head) > 0, 'spawn quaternion aims +Z at the head');
  const other = windowFaceTowardHead(behind, head);
  assert.ok(plusZTowardHead(other, behind, head) > 0, 'turned-around spawn still faces the head');
});
