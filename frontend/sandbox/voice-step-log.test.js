import test from "node:test";
import assert from "node:assert/strict";
import { isSandboxVoiceLogPhrase, VOICEMAP1_TOKEN } from "./voice-step-log.js";
import { isSamCorrectionVoice } from "./sam-correct.js";

test("voice log phrases and corrective phrases are distinct", () => {
  assert.equal(VOICEMAP1_TOKEN, "voicemap1");
  assert.equal(isSandboxVoiceLogPhrase("log this step"), true);
  assert.equal(isSandboxVoiceLogPhrase("mark a checkpoint"), true);
  assert.equal(isSandboxVoiceLogPhrase("generate a cube"), false);
  assert.equal(isSamCorrectionVoice("that's wrong, change the grip to closed"), true);
  assert.equal(isSamCorrectionVoice("log this step"), false);
});
