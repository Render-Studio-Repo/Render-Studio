import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { physicalControllerSources, rightTriggerPressed, controllerInputStatus } from "./xr-controller-input.js";

const node = (handedness, gamepad = true) => ({
  userData: { inputSource: { handedness, ...(gamepad ? { gamepad: { buttons: [{ pressed: false, value: 0 }] } } : {}) } },
});

test("Quest controllers are selected by handedness even when slots arrive reversed", () => {
  const right = node("right"), left = node("left"), hand = node("right", false);
  const sources = physicalControllerSources([right, hand, left]);
  assert.equal(sources.left.controller, left);
  assert.equal(sources.right.controller, right);
});

test("right trigger reads gamepad value and never marks mere XR entry as verified", () => {
  const source = node("right").userData.inputSource;
  assert.equal(rightTriggerPressed(source), false);
  assert.equal(controllerInputStatus({ presenting: true, rightSource: source, observedTrigger: false }).trigger, "unknown");
  source.gamepad.buttons[0].value = 0.8;
  assert.equal(rightTriggerPressed(source), true);
  assert.equal(controllerInputStatus({ presenting: true, rightSource: source, observedTrigger: true }).trigger, "ok");
  assert.equal(controllerInputStatus({ presenting: true, rightSource: null, observedTrigger: false }).input, "broken");
});

test("headset capture page loads its controller script instead of redirecting to keyboard MuJoCo", () => {
  const page = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.doesNotMatch(page, /http-equiv="refresh"|location\.replace/);
  assert.match(page, /main\.js\?v=quest-input-1/);
  for (const [, id] of main.matchAll(/\$\("([^"]+)"\)/g)) {
    assert.match(page, new RegExp(`id="${id}"`), `missing ${id}`);
  }
});
