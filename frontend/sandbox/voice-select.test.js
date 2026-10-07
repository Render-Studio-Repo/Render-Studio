import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyVoiceCommand,
  isVoiceExampleVoice,
  parseVoiceSelection,
  playVoiceExamples,
  VOICE_EXAMPLES,
} from "./voice-select.js";

test("voice samples stay behind an explicit request", () => {
  assert.equal(isVoiceExampleVoice("sample other voices"), true);
  assert.equal(isVoiceExampleVoice("what voices can I hear"), true);
  assert.equal(isVoiceExampleVoice("start the robot"), false);
  assert.equal(isVoiceExampleVoice("do not play other voices"), false);
});

test("a spoken choice selects one global Hey AI voice", async () => {
  const calls = [];
  const action = async (id, payload) => { calls.push([id, payload]); return id === "voice:sample" ? { playing: true } : { voice: payload.voice }; };
  assert.deepEqual(parseVoiceSelection("change the voice to cedar"), { voice: "cedar", token: "singlevoice2" });
  const out = await applyVoiceCommand("use cedar", { action });
  assert.equal(out.ok, true);
  assert.equal(out.voice, "cedar");
  assert.deepEqual(calls.map(([id]) => id), ["agent:setting", "voice:sample"]);
});

test("each request previews only one voice and advances the chooser", async () => {
  const order = [];
  const action = async (_id, { voice }) => { order.push(voice); return { playing: true }; };
  const first = await playVoiceExamples({ action });
  const second = await playVoiceExamples({ action });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(order.length, 2);
  assert.equal(order[0], first.voice);
  assert.equal(order[1], second.voice);
  assert.notEqual(first.voice, second.voice);
  assert.deepEqual(first.available, VOICE_EXAMPLES);
});
