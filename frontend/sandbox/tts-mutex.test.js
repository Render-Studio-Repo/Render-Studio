import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASTRA_GIRL_VOICE,
  LIVE_ASTRA_FLOOR,
  TALK_MODES,
  bargeIn,
  enqueueSpeak,
  expertsForTopic,
  floorHolder,
  getTalkMode,
  isSharedMaleVoice,
  isTooMuchTalkVoice,
  isTurnTaking,
  occupyFloor,
  pickSynthVoice,
  releaseFloor,
  resolveTalkAgent,
  setSharedMaleVoice,
  setTalkMode,
  setTurnTaking,
  shouldSpeakNow,
  talkModeLabel,
  uniqueSeatVoices,
  uniqueVoiceForAgent,
} from "./tts-mutex.js";

test("alternate speaker modes are removed and every request resolves to Astra", () => {
  assert.deepEqual(TALK_MODES, ["one"]);
  for (const requested of ["one", "other", "both", "unknown"]) {
    assert.equal(setTalkMode(requested).mode, "one");
    assert.equal(getTalkMode(), "one");
  }
  assert.equal(setSharedMaleVoice(true).mode, "one");
  assert.equal(isSharedMaleVoice(), false);
  assert.equal(talkModeLabel(), "Talk · Astra only (marin)");
  assert.equal(resolveTalkAgent("cursor-engineer"), "astra");
  assert.equal(uniqueVoiceForAgent("analytics"), ASTRA_GIRL_VOICE);
  assert.deepEqual(
    uniqueSeatVoices([{ id: "astra" }, { id: "cursor-engineer" }]).map((row) => row.voice),
    [ASTRA_GIRL_VOICE, ASTRA_GIRL_VOICE],
  );
});

test("live Astra owns audio and round-table speech remains text-only", async () => {
  occupyFloor(LIVE_ASTRA_FLOOR);
  const out = await enqueueSpeak("analytics", "deep alternate voice must not play");
  assert.deepEqual(
    { spoken: out.spoken, textOnly: out.textOnly, silent: out.silent, liveVoiceOwnsOutput: out.liveVoiceOwnsOutput },
    { spoken: false, textOnly: true, silent: true, liveVoiceOwnsOutput: true },
  );
  assert.equal(floorHolder(), LIVE_ASTRA_FLOOR);
  releaseFloor(LIVE_ASTRA_FLOOR);
  assert.equal(floorHolder(), "");
});

test("browser synthesis always selects the same non-male English voice", () => {
  const voices = [
    { name: "Daniel", lang: "en-GB" },
    { name: "Samantha", lang: "en-US" },
    { name: "Kyoko", lang: "ja-JP" },
  ];
  assert.equal(pickSynthVoice("astra", voices)?.name, "Samantha");
  assert.equal(pickSynthVoice("cursor-engineer", voices)?.name, "Samantha");
});

test("talking-too-much detection keeps one expert text route", () => {
  setTurnTaking(false);
  assert.equal(isTooMuchTalkVoice("everyone talking all at once"), true);
  assert.deepEqual(expertsForTopic("CAD print on the Bambu"), ["clip-bot"]);
  occupyFloor("astra");
  const barged = bargeIn("one output");
  assert.equal(barged.ok, true);
  assert.equal(isTurnTaking(), true);
  assert.equal(floorHolder(), "");
  assert.equal(shouldSpeakNow("astra", "host the risk vote", "risk reward"), true);
  setTurnTaking(false);
});
