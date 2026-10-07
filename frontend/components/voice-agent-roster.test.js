import { test } from "node:test";
import assert from "node:assert/strict";
import {
  voiceCatalog,
  saveVoiceAgentPref,
  prefFor,
  pickAddressedAgent,
  cloudSpeechSplit,
  agentMentioned,
} from "./voice-agent-roster.js";

function memory() {
  const bag = new Map();
  return {
    getItem: (k) => bag.get(k) || null,
    setItem: (k, v) => bag.set(k, v),
  };
}

test("voice catalog hides ElevenLabs until that provider is connected", () => {
  const open = voiceCatalog({ openai: true, elevenlabs: false });
  assert.equal(open.some((row) => row.provider === "elevenlabs"), false);
  assert.ok(open.some((row) => row.id === "marin"));
  const both = voiceCatalog({ openai: true, elevenlabs: true });
  assert.ok(both.some((row) => row.provider === "elevenlabs" && row.id === "rachel"));
});

test("voice and avatar choices save per agent", () => {
  const store = memory();
  const all = saveVoiceAgentPref("vibe-rnd", { provider: "elevenlabs", voice: "rachel", form: "avatar" }, store);
  const saved = prefFor("vibe-rnd", all);
  assert.equal(saved.voice, "rachel");
  assert.equal(saved.provider, "elevenlabs");
  assert.equal(saved.form, "avatar");
  assert.equal(prefFor("missing", all).form, "voice");
});

test("a named agent is the only speaker; others hold", () => {
  const roster = [
    { id: "vibe-rnd", name: "Rick" },
    { id: "vibe-marketing", name: "Fry" },
  ];
  assert.equal(agentMentioned("hey Rick check the arm", roster[0]), true);
  assert.equal(pickAddressedAgent("hey Rick check the arm", roster, "vibe-marketing").id, "vibe-rnd");
  const plan = cloudSpeechSplit([
    { agent_id: "vibe-rnd", text: "on it" },
    { agent_id: "vibe-marketing", text: "me too" },
  ], { utterance: "Rick the arm", roster });
  assert.equal(plan.cloud, "one");
  assert.equal(plan.speak.length, 1);
  assert.equal(plan.speak[0].listener, "vibe-rnd");
  assert.equal(plan.hold[0].silent, true);
  assert.equal(plan.hold[0].agentId, "vibe-marketing");
});

test("unnamed room lines queue on one cloud and keep each listener", () => {
  const lines = [
    { agent_id: "analytics", text: "one" },
    { agent_id: "clip-bot", text: "two" },
  ];
  const plan = cloudSpeechSplit(lines, { utterance: "what is next", roster: [] });
  assert.equal(plan.reason, "unaddressed");
  assert.equal(plan.speak.length, 2);
  assert.equal(plan.speak[1].listener, "clip-bot");
  assert.equal(plan.speak[0].queue, true);
  assert.equal(plan.hold.length, 0);
});
