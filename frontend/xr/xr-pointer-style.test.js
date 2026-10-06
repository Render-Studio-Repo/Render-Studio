import { test } from "node:test";
import assert from "node:assert/strict";
import { xrPointerStyle, XR_POINTER_IDLE_M, XR_POINTER_BRIGHT_M } from "./xr-pointer-style.js";

const live = { presenting: true, posed: true };
test("idle or CAD aim keeps a thin near-controller laser", () => {
  for (const hit of [null, { kind: "mesh", distance: .8 }]) {
    const p = xrPointerStyle({ ...live, hit });
    assert.equal(p.visible, true);
    assert.equal(p.beam, true);
    assert.equal(p.distance, XR_POINTER_IDLE_M);
    assert.ok(p.radius * 2 < .001);
  }
});
test("nearby UI uses a submillimeter line ending at the actual hit", () => {
  for (const distance of [.008, .4, 2.8]) {
    const p = xrPointerStyle({ ...live, ui: true, hit: { distance } });
    assert.equal(p.beam, true);
    assert.equal(p.distance, distance);
    assert.ok(p.radius * 2 < .001);
  }
  const far = xrPointerStyle({ ...live, ui: true, hit: { distance: 4 } });
  assert.equal(far.beam, true);
  assert.equal(far.distance, XR_POINTER_IDLE_M);
});
test("Hold B brightens and lengthens the idle laser", () => {
  const p = xrPointerStyle({ ...live, bright: true });
  assert.equal(p.beam, true);
  assert.equal(p.distance, XR_POINTER_BRIGHT_M);
  assert.ok(p.opacity > 0.8);
});
test("untracked or held controllers cannot leave floating pointers behind", () => {
  for (const state of [{ posed: false }, { presenting: false }, { holding: true }]) {
    const p = xrPointerStyle({ ...live, ...state, ui: true, hit: { distance: .5 } });
    assert.equal(p.visible, false);
    assert.equal(p.beam, false);
  }
});

test("draw/pen hideLaser is a short tip; grab keeps the idle laser", () => {
  const pen = xrPointerStyle({ ...live, hideLaser: true });
  assert.equal(pen.visible, true);
  assert.equal(pen.beam, false);
  assert.ok(pen.distance > 0 && pen.distance < 0.04);
  const grab = xrPointerStyle({ ...live, hideLaser: false });
  assert.equal(grab.beam, true);
  assert.equal(grab.distance, XR_POINTER_IDLE_M);
});
