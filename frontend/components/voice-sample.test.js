import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REALTIME_VOICES, cycleRealtimeVoice, normalizeRealtimeVoice, voiceSampleLine } from "./realtime-voices.js";
import { createVoiceSamplePlayer, VOICE_PREVIEW_PATH } from "./voice-sample.js";

const here = dirname(fileURLToPath(import.meta.url));
const settings = readFileSync(join(here, "xr-agent-settings.js"), "utf8");
const avatar = readFileSync(join(here, "../xr/xr-agent-avatar.js"), "utf8");
const bridge = readFileSync(join(here, "xr-agent-bridge.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const studio = readFileSync(join(here, "xr-agent-studio.js"), "utf8");
const xr = readFileSync(join(here, "../xr/viewport-xr.js"), "utf8");

function blobFor(voice) {
  return new Blob([`sample:${voice}`], { type: "audio/mpeg" });
}

function playerFixture(t, overrides = {}) {
  const old = new Map();
  function install(name, value) {
    old.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const urls = [];
  const audios = [];
  install("URL", {
    createObjectURL(blob) { const url = `blob:${urls.length}:${blob.size}`; urls.push(url); return url; },
    revokeObjectURL(url) { urls.push(["revoke", url]); },
  });
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.volume = 1;
      this.paused = true;
      this._play = 0;
      audios.push(this);
    }
    play() { this._play += 1; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() {}
    load() {}
  }
  install("Audio", FakeAudio);
  const fetches = [];
  const player = createVoiceSamplePlayer({
    getVolume: () => overrides.volume ?? 0.8,
    fetchPreview: async (voice, text) => {
      fetches.push({ voice, text });
      if (overrides.fetchPreview) return overrides.fetchPreview(voice, text, fetches);
      return blobFor(voice);
    },
    createAudio: FakeAudio,
    speakLocal: overrides.speakLocal,
    ...overrides.opts,
  });
  t.after(() => {
    player.stop();
    for (const [key, desc] of old) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  });
  return { player, fetches, audios, urls };
}

test("Realtime voice catalog stays the known OpenAI set", () => {
  assert.deepEqual([...REALTIME_VOICES], ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]);
  assert.equal(normalizeRealtimeVoice("Cedar"), "cedar");
  assert.equal(normalizeRealtimeVoice("nope"), "marin");
  assert.equal(voiceSampleLine("cedar"), "Hi, I'm Cedar. This is how I sound.");
  assert.equal(cycleRealtimeVoice("marin", 1), "cedar");
  assert.equal(cycleRealtimeVoice("alloy", -1), "cedar");
});

test("one voice sample plays at a time and Listen toggles Stop", async (t) => {
  const { player, fetches, audios } = playerFixture(t);
  const first = await player.play("alloy");
  assert.equal(first.playing, true);
  assert.equal(first.source, "tts");
  assert.equal(player.playing(), "alloy");
  assert.equal(audios.length, 1);
  const second = await player.play("cedar");
  assert.equal(second.voice, "cedar");
  assert.equal(player.playing(), "cedar");
  assert.equal(audios[0].paused, true);
  assert.equal(audios[1].paused, false);
  assert.deepEqual(fetches.map((row) => row.voice), ["alloy", "cedar"]);
  assert.equal(fetches[1].text, "Hi, I'm Cedar. This is how I sound.");
  const stopped = await player.play("cedar");
  assert.equal(stopped.playing, false);
  assert.equal(player.playing(), "");
});

test("muted listening volume does not fetch TTS or start a live session", async (t) => {
  const { player, fetches, audios } = playerFixture(t, { volume: 0 });
  const result = await player.play("sage");
  assert.equal(result.muted, true);
  assert.equal(result.playing, false);
  assert.equal(fetches.length, 0);
  assert.equal(audios.length, 0);
});

test("Hey AI settings expose one fixed Marin voice", () => {
  assert.equal(VOICE_PREVIEW_PATH, "/api/voice-mold/preview");
  assert.match(settings, /Marin is the single voice used by every Hey AI session/);
  assert.doesNotMatch(settings, /dataset\.voiceSample|Listen to a short sample|player\.play\(id\)/);
  assert.match(bridge, /agent:sample-voice/);
  assert.match(bridge, /samplePlayer\.play/);
  assert.match(avatar, /voice:sample/);
  assert.match(avatar, /Listen/);
  assert.match(avatar, /agent:sample-voice/);
  assert.doesNotMatch(avatar, /createVoiceMold|voice-mold\/ws/);
});

test("cache-bust voicesample=20260916-1 is on the settings and avatar graph", () => {
  assert.match(html, /voicesample=20260916-1/);
  assert.match(app, /voicesample=20260916-1/);
  assert.match(studio, /voicesample=20260916-1/);
  assert.match(xr, /xr-agent-avatar\.js\?[^"\s]*voicesample=20260916-1/);
  assert.match(bridge, /xr-agent-settings\.js\?[^"\s]*voicesample=20260916-1/);
  assert.match(settings, /voice-sample\.js\?voicesample=20260916-1/);
});

test("failed cloud sample never substitutes a different browser voice", async (t) => {
  let localCalls = 0;
  const { player } = playerFixture(t, {
    fetchPreview: async () => null,
    speakLocal: () => { localCalls += 1; return true; },
  });
  await assert.rejects(player.play("marin"), /unavailable/);
  assert.equal(localCalls, 0);
  assert.equal(player.playing(), "");
});
