import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HARNESS1_TOKEN,
  LIVE_CORRECTION_PATH,
  isSamCorrectionVoice,
  parseSamCorrection,
} from "./sam-correct.js";

test("Sam correction phrases and file path stay in sandbox", () => {
  assert.equal(HARNESS1_TOKEN, "harness1");
  assert.equal(isSamCorrectionVoice("That's wrong, change the title to Sandbox only"), true);
  assert.equal(isSamCorrectionVoice("that is wrong fix that"), true);
  assert.equal(isSamCorrectionVoice("enable sandbox please"), false);
  const parsed = parseSamCorrection("That's wrong, change the kicker in examples/hello.md");
  assert.equal(parsed.path, "examples/hello.md");
  assert.match(parsed.change, /kicker|hello/i);
  assert.equal(parseSamCorrection("VOICE: that's not right, change X").path, LIVE_CORRECTION_PATH);
});
