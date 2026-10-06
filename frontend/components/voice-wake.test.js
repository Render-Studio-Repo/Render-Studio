import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVoiceWake, isVoiceOrderControl, speechRecognitionCtor } from "./voice-wake.js";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const xr = readFileSync(join(here, "../xr/viewport-xr.js"), "utf8");
const audio = readFileSync(join(here, "./voice-audio-output.js"), "utf8");

test("Order / Hey chip and compose mic start Voice Mold, not the Agent popup", () => {
  assert.match(html, /id="btn-voice-order"/);
  assert.match(html, /data-voice-order="1"/);
  assert.match(html, /class="prompt-voice-order"/);
});

test("wake listener starts the session on hey agent / hey Astra", async () => {
  const wakes = [];
  let live = false;
  const voice = createVoiceWake({
    getWakeName: () => "Astra",
    isSessionLive: () => live,
    recognitionCtor: () => null,
    onWake: (event) => wakes.push(event),
  });
  assert.equal(voice.handleText("please fillet this corner"), false);
  assert.equal(voice.handleText("hey agent, what is this part?"), true);
  assert.equal(wakes[0].source, "wake");
  live = true;
  assert.equal(voice.handleText("hey Astra"), false);
});

test("SpeechRecognition helper prefers webkit when needed", () => {
  assert.equal(speechRecognitionCtor({ webkitSpeechRecognition: function WebkitSpeech() {} }).name, "WebkitSpeech");
  assert.equal(speechRecognitionCtor({}), null);
});

test("VR Talk / puck starts Astra talk-mode with headset audio, not prompt-improve", () => {
  assert.match(xr, /function beginAstraTalk/);
  assert.match(xr, /primeAstraTalkMedia/);
  assert.doesNotMatch(xr.slice(xr.indexOf("function primeAstraTalkMedia"), xr.indexOf("function beginAstraTalk")), /xrVoice.prepareMic/);
  assert.match(xr, /if \(id === "talk"\) \{[\s\S]*beginAstraTalk\(\{ toggle: false \}\)/);
  assert.match(xr, /if \(id === "voice_mold"\) \{[\s\S]*beginAstraTalk\(\{ toggle: true \}\)/);
  assert.doesNotMatch(xr, /if \(id === "talk"\) \{[\s\S]*onTalkToAi\?\.\(\)/);
  assert.match(audio, /attachHeadsetElement/);
  assert.match(audio, /playsinline/);
  assert.match(xr, /yHoldHud/);
  assert.match(xr, /data-ws-tool="walk"/);
  assert.match(xr, /id === "share"/);
});

test("Order control matcher covers the Hey chip and compose mic", () => {
  const order = { closest: (sel) => sel.includes("btn-voice-order") ? {} : null };
  const other = { closest: () => null };
  assert.equal(isVoiceOrderControl(order), true);
  assert.equal(isVoiceOrderControl(other), false);
});

test("idle Studio viewport does not enable wake listening or arm it on every click", () => {
  const src = readFileSync(join(here, "./voice-wake.js"), "utf8");
  assert.doesNotMatch(app, /voiceWake\.enable\(\)/);
  assert.doesNotMatch(app, /armWake/);
  assert.doesNotMatch(app, /pointerdown[\s\S]{0,120}voiceWake\?\.enable/);
  assert.doesNotMatch(src, /setInterval\(sync/);
  assert.doesNotMatch(src, /restarting\s*=\s*setTimeout/);
  assert.match(html, /app\.js\?v=.*20260916-macmic1/);
  assert.match(app, /voice-wake\.js\?v=.*20260916-macmic1/);
});

test("wake enable does not construct SpeechRecognition or acquire a microphone", () => {
  let constructed = 0;
  let mediaCalls = 0;
  const voice = createVoiceWake({
    getWakeName: () => "Astra",
    isSessionLive: () => false,
    getMicStream: () => { mediaCalls++; return null; },
    recognitionCtor: () => {
      constructed++;
      return function FakeRec() {};
    },
    transcribe: () => { throw new Error("must not transcribe"); },
  });
  assert.equal(voice.enable(), false);
  assert.equal(voice.wanted, true);
  assert.equal(voice.running, false);
  assert.equal(constructed, 0);
  assert.equal(mediaCalls, 1);
});

test("wake listening meters a borrowed headset stream and never stops its tracks", () => {
  let stops = 0;
  const stream = {
    getAudioTracks: () => [{ readyState: "live" }],
    getTracks: () => [{ stop: () => stops++ }],
  };
  class Audio {
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { getFloatTimeDomainData: (a) => a.fill(0), fftSize: 512 }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  class Recorder {
    constructor() { this.state = "inactive"; this.mimeType = "audio/webm"; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.onstop?.(); }
  }
  const voice = createVoiceWake({
    getWakeName: () => "Astra",
    isSessionLive: () => false,
    getMicStream: () => stream,
    transcribe: async () => "hey Astra",
    Audio,
    Recorder,
  });
  assert.equal(voice.enable(), true);
  assert.equal(voice.running, true);
  voice.disable();
  assert.equal(voice.running, false);
  assert.equal(stops, 0);
});
