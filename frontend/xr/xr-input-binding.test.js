import { test } from "node:test";
import assert from "node:assert/strict";
import { connectedSourceForSlot, controllerSlotForSource, controllerSlotForHand } from "./xr-input-binding.js";

test("controller identity survives a reordered session list", () => {
  const left = { handedness: "left" }, right = { handedness: "right" };
  const nodes = [right, left].map(inputSource => ({userData: {inputSource}}));
  for (const sessionSources of [[left, right], [right, left]]) {
    for (const source of sessionSources) {
      assert.equal(connectedSourceForSlot(nodes, controllerSlotForSource(nodes, source)), source);
    }
    assert.equal(controllerSlotForHand(nodes, "left"), 1);
    assert.equal(controllerSlotForHand(nodes, "right"), 0);
  }
});

test("disconnect and reconnect update only the renderer slot receiving the event", () => {
  const left = {handedness: "left"}, right = {handedness: "right"};
  const nodes = [left, right].map(inputSource => ({userData: {inputSource}}));
  nodes[0].userData.inputSource = null;
  assert.equal(controllerSlotForHand(nodes, "left"), -1);
  assert.equal(controllerSlotForHand(nodes, "right"), 1);
  const replacement = {handedness: "left"};
  nodes[0].userData.inputSource = replacement;
  assert.equal(controllerSlotForSource(nodes, left), -1);
  assert.equal(controllerSlotForSource(nodes, replacement), 0);
});

test("unlabeled sources are never assigned to the missing hand", () => {
  const nodes = [{userData: {inputSource: {handedness: "none"}}}];
  assert.equal(controllerSlotForHand(nodes, "left"), -1);
  assert.equal(controllerSlotForHand(nodes, "right"), -1);
});

test("rtrig2: sticky stamp and gamepad identity still find the right slot", () => {
  const pad = { buttons: [{ pressed: true }] };
  const live = { handedness: "", gamepad: pad };
  const nodes = [{ userData: { inputSource: { handedness: "", gamepad: pad }, handedness: "right" } }];
  assert.equal(controllerSlotForHand(nodes, "right"), 0);
  assert.equal(controllerSlotForSource(nodes, live), 0);
});
