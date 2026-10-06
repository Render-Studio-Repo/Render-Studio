import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createVoiceMold,
  DEFAULT_HEY_AI_INTRO,
  advanceAutomaticTurnVad,
  bufferedVoiceTurnContext,
  explicitTurnGenerationRequest,
  voiceConversationGenerationPrompt,
  realtimeBrowserProtocols,
  studioVoiceMoldProxyUrl,
  usesStudioRealtimeProxy,
} from "./voice-mold.js";
import { boundedVoiceContext, voiceImageUrl, voiceContextMessage, voiceWakeMatches, voiceWakePhraseHits, voiceRealtimeConfig } from "./voice-agent-protocol.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "voice-mold.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");

test("voice-mold catalog aborts the previous models GET", () => {
  assert.match(src, /let voiceMoldAbort = null; \/\/ leakfix77/);
  assert.match(src, /async function loadCatalog\(\)[\s\S]{0,700}signal: ctl\.signal/);
});

test("live socket prefers the same-origin Realtime proxy, not a browser OpenAI key subprotocol", () => {
  assert.equal(
    studioVoiceMoldProxyUrl({
      host: "127.0.0.1:8001",
      protocol: "http:",
      token: "studio-token",
      model: "gpt-realtime-mini",
      projectId: "p1",
    }),
    "ws://127.0.0.1:8001/api/voice-mold/ws?token=studio-token&model=gpt-realtime-mini&project_id=p1",
  );
  assert.equal(usesStudioRealtimeProxy({ proxy_ws_path: "/api/voice-mold/ws" }), true);
  assert.equal(usesStudioRealtimeProxy({ ws_url: "wss://api.openai.com/v1/realtime" }), false);
  const protocols = realtimeBrowserProtocols("ek_test");
  assert.equal(protocols[0], "realtime");
  assert.equal(protocols[1], "openai-insecure-api-key.ek_test");
  assert.equal(protocols.length, 2, "GA sockets must not request the retired beta protocol");
  assert.ok(src.includes("usesStudioRealtimeProxy(session)"));
  assert.ok(src.includes("studioVoiceMoldProxyUrl"));
  assert.match(app, /voice-mold\.js\?v=/);
  assert.match(app, /getToken,/);
});

test("voice mold catalog waits for first mesh instead of competing with boot GLB", () => {
  assert.match(src, /render3d:first-mesh/);
  assert.match(src, /render3d:explorer-thumbs-ready/);
  assert.match(src, /await loadCatalog\(\)/);
  assert.doesNotMatch(src, /void loadCatalog\(\);\n\n  return \{/);
});

test("proxy and direct sockets use the same full GA session configuration", () => {
  assert.match(src, /activeSession = voiceRealtimeConfig/);
  assert.match(src, /sendJson\(\{ type: "session.update", session: activeSession \}\)/);
  assert.match(src, /type === "session.updated"/);
});

test("scene reference keeps wire evidence and excludes secrets, images, cycles and scene nodes", () => {
  const wire = { id: "W12", gauge: "22 AWG", source: { url: "https://maker.example/pinout", page: 4 }, apiKey: "secret", imageUrl: "data:image/png;base64,AA==" };
  wire.parent = wire;
  const clean = boundedVoiceContext({ wire, mesh: { isObject3D: true }, parts: Array(90).fill("a"), huge: "x".repeat(100000) });
  assert.equal(clean.wire.id, "W12");
  assert.equal(clean.wire.source.url, "https://maker.example/pinout");
  assert.equal(clean.wire.apiKey, undefined);
  assert.equal(clean.wire.parent, undefined);
  assert.equal(clean.mesh, undefined);
  assert.equal(clean.parts.length, 40);
  assert.ok(JSON.stringify(clean).length <= 24000);
});

test("Realtime images use documented input_image and reject remote or oversized payloads", () => {
  const data = "data:image/jpeg;base64,AAAA";
  const message = voiceContextMessage({ selected: "W12" }, data);
  assert.deepEqual(message.item.content[1], { type: "input_image", image_url: data });
  assert.equal(voiceImageUrl("https://example.com/frame.jpg"), "");
  assert.equal(voiceImageUrl("data:image/svg+xml;base64,AAAA"), "");
  assert.equal(voiceImageUrl("data:image/png;base64," + "A".repeat(1400000)), "");
});

test("review config removes auto-edit tool and automatic VAD responses while preserving PCM", () => {
  const config = voiceRealtimeConfig("gpt-realtime", { voice: "cedar", name: "Nova", wakeName: "Nova" }, { review: true });
  assert.equal(config.audio.input.turn_detection.create_response, false);
  assert.equal(config.audio.input.turn_detection.interrupt_response, false);
  assert.equal(config.audio.input.turn_detection.threshold, 0.65);
  assert.equal(config.audio.input.turn_detection.silence_duration_ms, 650);
  assert.equal(config.audio.input.format.rate, 24000);
  assert.equal(config.audio.output.voice, "marin");
  assert.ok(config.tools.some(t => t.name === "ask_selected_model"));
  assert.ok(config.tools.some(t => t.name === "review_cad_changes"));
  assert.ok(!config.tools.some(t => t.name === "apply_micro_edit"));
  assert.match(config.instructions, /hey agent/);
  assert.match(config.instructions, /\/api\/voice-mold\/ws/);
  assert.equal(voiceWakeMatches("Hey, Nova! Tell me about this wire.", "Nova"), true);
  assert.equal(voiceWakeMatches("hey November", "Nova"), false);
  assert.equal(voiceWakeMatches("hey agent", "Astra"), true);
  assert.equal(voiceWakeMatches("Hey Astra, explain this.", "Nova"), true);
  assert.equal(voiceWakePhraseHits("hey astra", ""), true);
  assert.equal(voiceWakePhraseHits("hey agent", "Nova"), true);
  assert.equal(voiceWakePhraseHits("random chat", "Astra"), false);
});

test("all realtime modes disable server-side barge-in to prevent jumpy self-interruption", () => {
  const config = voiceRealtimeConfig("gpt-realtime", { voice: "marin" });
  assert.equal(config.audio.input.turn_detection.create_response, true);
  assert.equal(config.audio.input.turn_detection.interrupt_response, false);
});

const tick = () => new Promise(resolve => setImmediate(resolve));

function transportFixture(t, overrides = {}) {
  const old = new Map();
  function global(name, value) { old.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value }); }
  let micStopped = false, micRequests = 0;
  const track = { readyState:"live", stop() { micStopped = true; this.readyState="ended"; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  function node() { return { connect() {}, disconnect() {}, gain: { value: 1 } }; }
  class Context {
    constructor() { this.state = "running"; this.sampleRate = 24000; this.currentTime = 0; }
    createGain() { return node(); }
    createMediaStreamSource() { return node(); }
    createScriptProcessor() { return node(); }
    createAnalyser() { return { ...node(), getFloatTimeDomainData(samples) { samples.fill(0); } }; }
    createMediaStreamDestination() { return { ...node(), stream: { getTracks: () => [], getAudioTracks: () => [{ kind: "audio" }] } }; }
    close() { return Promise.resolve(); }
    resume() { return Promise.resolve(); }
  }
  class Socket extends EventTarget {
    static OPEN = 1;
    static instances = [];
    constructor() { super(); this.readyState = 1; this.sent = []; Socket.instances.push(this); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
    send(raw) { const data = JSON.parse(raw); this.sent.push(data); if (data.type === "session.update") queueMicrotask(() => this.event({ type: "session.updated" })); }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    event(data) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
  }
  global("window", { addEventListener() {}, speechSynthesis: { cancel() {} } });
  global("location", { host: "localhost", protocol: "http:" });
  global("localStorage", { getItem() { return ""; }, setItem() {} });
  global("navigator", { mediaDevices: { getUserMedia: async () => { micRequests++;return stream; } } });
  global("AudioContext", Context);
  global("WebSocket", Socket);
  if (overrides.turn) {
    class Recorder {
      static isTypeSupported() { return true; }
      constructor() { this.mimeType = "audio/webm"; this.state = "inactive"; }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([new Uint8Array(128)], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    global("MediaRecorder", Recorder);
  }
  const proposals = [], transcripts = [], applied = [], calls = [];
  const config = { name: "Nova", wakeName: "Nova", voiceModel: "gpt-realtime", includeVisualContext: true, ...overrides.settings };
  const voice = createVoiceMold({
    bindDesktop: false,
    api: async (path, options) => {
      calls.push(path);
      if (path.includes("/models")) return overrides.models || { models: [{ id: "gpt-realtime", label: "Realtime", transport: "realtime" }], has_openai_key: true };
      if (path.includes("/session")) return overrides.session || { transport: "realtime", model: JSON.parse(options.body).model, proxy_ws_path: "/api/voice-mold/ws", instructions: "legacy apply now" };
      if (path.includes("/turn")) return overrides.turnResponse || { transcript: "", speak: "" };
      if (path.includes("/speech")) return { format: "pcm16", sample_rate: 24000, audio: btoa(String.fromCharCode(...new Uint8Array(480))) };
    },
    getAgentSettings: () => config,
    getSceneContext: () => ({ selected: "W1", generationModel: "selected-cad-model", wire: { gauge: "22 AWG", sources: ["https://maker.example/pins"] } }),
    getSceneImage: async () => "data:image/jpeg;base64,AAAA",
    onChangeProposal: proposal => { proposals.push(proposal); },
    onTranscript: line => transcripts.push(line),
    applyMicroEdit: change => applied.push(change),
    ...overrides.opts,
  });
  t.after(() => { voice.stop(); for (const [key, desc] of old) if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key]; });
  return { voice, proposals, transcripts, applied, config, calls, micRequests:()=>micRequests, micStopped: () => micStopped, socket: () => Socket.instances.at(-1) };
}

test("live review transport sends selected wire evidence and frame, never auto-applies tool edits", async t => {
  const f = transportFixture(t);
  await f.voice.start(); await tick();
  assert.equal(f.voice.getState().live, true);
  const socket = f.socket();
  const context = socket.sent.find(m => m.item?.content?.some(c => c.type === "input_image"));
  assert.ok(context);
  assert.match(context.item.content[0].text, /maker.example\/pins/);
  socket.event({ type: "response.function_call_arguments.done", name: "apply_micro_edit", call_id: "edit1", arguments: JSON.stringify({ instruction: "move board 5mm", apply_now: true }) });
  await tick();
  assert.equal(f.applied.length, 0);
  assert.equal(f.proposals[0].instruction, "move board 5mm");
  assert.equal(f.proposals[0].generationModel, "selected-cad-model");
  socket.event({ type: "response.output_item.done", item: { type: "function_call", name: "apply_micro_edit", call_id: "edit1", arguments: "{}" } });
  await tick();
  assert.equal(f.proposals.length, 1);
  socket.event({ type: "response.function_call_arguments.done", name: "review_cad_changes", call_id: "review", arguments: "{}" });
  await tick();
  assert.equal(f.proposals[1].requestReview, true);
  assert.equal(f.proposals[1].instruction, "");
  assert.ok(f.voice.getOutputStream());
  assert.equal(f.voice.setVolume(3), 1);
  f.voice.stop();
  assert.equal(f.micStopped(), true);
  assert.equal(f.voice.getOutputStream(), null);
});

test("server transcript wake gate controls replies and reports transcripts without desktop UI", async t => {
  const f = transportFixture(t);
  await f.voice.start(); await tick();
  const socket = f.socket();
  socket.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "quiet", transcript: "This is unrelated conversation." });
  await tick();
  assert.ok(socket.sent.some(m => m.type === "conversation.item.delete" && m.item_id === "quiet"));
  assert.equal(socket.sent.filter(m => m.type === "response.create").length, 0);
  socket.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "wake", transcript: "Hey Nova, explain that wire." });
  await tick();
  assert.equal(socket.sent.filter(m => m.type === "response.create").length, 1);
  assert.equal(f.transcripts[1].role, "user");
  assert.equal(f.voice.getState().wakeListening, "server-transcription");
  assert.equal(f.voice.getState().wakeActive, true);
});

test("subscription-backed turn sessions automatically begin listening", async t => {
  const f = transportFixture(t, {
    turn: true,
    settings: { voiceModel: "gpt-6-astra" },
    models: { models: [{ id: "gpt-6-astra", label: "Astra", transport: "turn" }], has_openai_key: false },
    session: { transport: "turn", model: "gpt-6-astra", label: "Astra" },
  });
  await f.voice.start();
  assert.equal(f.voice.getState().live, true);
  assert.equal(f.voice.getState().listening, true);
  assert.equal(f.voice.getState().recording, true);
  assert.equal(f.voice.getState().statusMessage, "Listening…");
});

test("subscription-backed Hey AI gives one brief Render introduction before listening", async t => {
  const f = transportFixture(t, {
    turn: true,
    settings: { voiceModel: "gpt-6-astra" },
    models: { models: [{ id: "gpt-6-astra", label: "Astra", transport: "turn" }], has_openai_key: false },
    session: { transport: "turn", model: "gpt-6-astra", label: "Astra" },
  });
  await f.voice.start({ greet: true });
  assert.equal(f.calls.filter(path => path.includes("/speech")).length, 1);
  assert.match(DEFAULT_HEY_AI_INTRO, /^Hi, I’m Render, your design partner\./);
});

test("buffered explicit generation uses the same prompt handoff", async t => {
  let handoff = null;
  const f = transportFixture(t, {
    turn: true,
    settings: { voiceModel: "gpt-6-astra" },
    models: { models: [{ id: "gpt-6-astra", label: "Astra", transport: "turn" }] },
    session: { transport: "turn", model: "gpt-6-astra", label: "Astra" },
    turnResponse: { transcript: "Yes, generate what we discussed now.", speak: "" },
    opts: { onGeneratePrompt: async (args, context) => {
      handoff = { args, context };
      return { ok: true, accepted: true, generated: true, stop_after_response: true, message: "I’m starting CAD now." };
    } },
  });
  await f.voice.start();
  await f.voice.endHold();
  assert.equal(handoff.args.target_mode, "auto");
  assert.equal(handoff.context.selected, "W1");
});

test("buffered generation intent requires an explicit build request", () => {
  assert.equal(explicitTurnGenerationRequest("Yes, generate what we discussed now."), true);
  assert.equal(explicitTurnGenerationRequest("Make this for me please."), true);
  assert.equal(explicitTurnGenerationRequest("What material should we use?"), false);
});

test("buffered turn VAD hears ordinary speech and submits after silence", () => {
  let state = { noiseFloor: 0.003, consecutiveSpeechFrames: 0, speechSeen: false, lastSpeechAt: 0 };
  let step = advanceAutomaticTurnVad(state, 0.0025, 100);
  state = step.state;
  assert.equal(step.state.speechSeen, false);
  step = advanceAutomaticTurnVad(state, 0.009, 200);
  state = step.state;
  assert.equal(step.state.speechSeen, false);
  step = advanceAutomaticTurnVad(state, 0.009, 300);
  state = step.state;
  assert.equal(step.speechStarted, true);
  assert.equal(step.state.speechSeen, true);
  step = advanceAutomaticTurnVad(state, 0.002, 1199);
  assert.equal(step.shouldSubmit, false);
  step = advanceAutomaticTurnVad(step.state, 0.002, 1200);
  assert.equal(step.shouldSubmit, true);
});

test("buffered turns carry bounded design conversation into the next reply", () => {
  const context = bufferedVoiceTurnContext(
    { selected: "mounting plate" },
    [
      { role: "user", text: "Make it 80 millimeters wide." },
      { role: "assistant", text: "Should the corners be rounded?" },
      { role: "user", text: "Yes, use a 5 millimeter radius." },
    ],
  );
  assert.equal(context.selected, "mounting plate");
  assert.deepEqual(context.conversation, [
    { role: "user", text: "Make it 80 millimeters wide." },
    { role: "assistant", text: "Should the corners be rounded?" },
    { role: "user", text: "Yes, use a 5 millimeter radius." },
  ]);
});

test("voice-only design conversation becomes the generation prompt", () => {
  const prompt = voiceConversationGenerationPrompt([
    { role: "user", text: "Make a wall bracket 80 by 40 millimeters." },
    { role: "assistant", text: "I will use four countersunk mounting holes and 5 millimeter corner radii." },
    { role: "user", text: "Yes, generate what we discussed now." },
  ]);
  assert.match(prompt, /wall bracket 80 by 40 millimeters/);
  assert.match(prompt, /four countersunk mounting holes/);
  assert.doesNotMatch(prompt, /generate what we discussed now/);
  assert.match(app, /typedPrompt \|\| voiceConversationGenerationPrompt\(activeHeyAiContext\?\.transcript \|\| \[\]\)/);
  assert.match(app, /handlePromptGenerateClick\(\{/);
});

test("no microphone transcript can interrupt an active reply", async t => {
  const f = transportFixture(t);
  await f.voice.start(); await tick();
  const socket = f.socket();
  f.voice.sendText("Start answering", { respond: true });
  socket.event({ type: "response.created" });
  socket.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "echo", transcript: "continue with the details" });
  await tick();
  assert.ok(socket.sent.some(m => m.type === "conversation.item.delete" && m.item_id === "echo"));
  assert.equal(socket.sent.filter(m => m.type === "response.cancel").length, 0);
  socket.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "barge", transcript: "Hey Nova, stop and listen." });
  await tick();
  assert.equal(socket.sent.filter(m => m.type === "response.cancel").length, 0);
  assert.ok(socket.sent.some(m => m.type === "conversation.item.delete" && m.item_id === "barge"));
});

test("a follow-up spoken after greeting audio finishes receives a response", async t => {
  const f = transportFixture(t);
  await f.voice.start({ greet: true, text: "Hello." });
  await tick();
  const socket = f.socket();
  assert.equal(socket.sent.filter(m => m.type === "response.create").length, 1);

  socket.event({ type: "response.output_audio.done" });
  socket.event({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "follow-up",
    transcript: "Can you model a mounting bracket?",
  });
  socket.event({ type: "response.done" });
  await tick();

  assert.equal(socket.sent.filter(m => m.type === "response.create").length, 2);
  assert.equal(socket.sent.some(m => m.type === "conversation.item.delete" && m.item_id === "follow-up"), false);
});

test("selected CAD reasoning callback receives question and sourced context", async t => {
  let asked;
  const f = transportFixture(t, { opts: { askSelectedModel: async (question, context) => { asked = { question, context }; return { answer: "Move this bracket by 2mm." }; } } });
  await f.voice.start();
  f.socket().event({ type: "response.function_call_arguments.done", name: "ask_selected_model", call_id: "reason", arguments: '{"question":"How can the board fit?"}' });
  await tick();
  assert.equal(asked.question, "How can the board fit?");
  assert.equal(asked.context.generationModel, "selected-cad-model");
  assert.ok(f.socket().sent.some(m => m.item?.output?.includes("bracket")));
});

test("voice generation acknowledges the frozen handoff before closing the session", async t => {
  let generationArgs;
  const f = transportFixture(t, { opts: {
    onGeneratePrompt: async (args, context) => {
      generationArgs = { args, context };
      return {
        ok: true,
        accepted: true,
        generated: true,
        stop_after_response: true,
        message: "I’m starting a Mesh edit of bracket.step now.",
      };
    },
  } });
  await f.voice.start();
  const socket = f.socket();
  socket.event({
    type: "response.function_call_arguments.done",
    name: "generate_ai_prompt",
    call_id: "generate-1",
    arguments: JSON.stringify({ target_mode: "edit" }),
  });
  await tick();
  assert.equal(generationArgs.args.target_mode, "edit");
  assert.equal(f.voice.getState().live, true, "the acknowledgement must keep the realtime session alive");
  assert.ok(socket.sent.some(message => message.item?.output?.includes("starting a Mesh edit")));
  assert.ok(socket.sent.some(message => message.type === "response.create"));
  socket.event({ type: "response.done" });
  await tick();
  assert.equal(f.voice.getState().live, false, "the session closes only after the spoken acknowledgement");
});

test("room guests and non-owners cannot apply code through voice", async t => {
  const f = transportFixture(t, { opts: { canChangeCode: () => false } });
  await f.voice.start();
  f.socket().event({ type: "response.function_call_arguments.done", name: "apply_micro_edit", call_id: "guest", arguments: JSON.stringify({ instruction: "delete the bracket", apply_now: true }) });
  await tick();
  assert.equal(f.applied.length, 0);
  assert.equal(f.proposals.length, 0);
  assert.ok(f.socket().sent.some(m => m.item?.output?.includes("project owner")));
  const owner = transportFixture(t);
  await owner.voice.start();
  owner.config.allowOtherUsersTrigger = true;
  owner.voice.setRemoteInputStream({ getAudioTracks: () => [{}] });
  owner.socket().event({ type: "response.function_call_arguments.done", name: "propose_cad_change", call_id: "room", arguments: JSON.stringify({ instruction: "cut a hole" }) });
  await tick();
  assert.equal(owner.proposals.length, 0);
  assert.ok(owner.socket().sent.some(m => m.item?.output?.includes("Other people")));
});

test("visual and metadata settings suppress transfer, remote microphone is opt-in", async t => {
  let captures = 0;
  const f = transportFixture(t, { settings: { includeVisualContext: false, includeSelectionMetadata: false }, opts: { getSceneImage: () => { captures++; return "data:image/jpeg;base64,AAAA"; } } });
  await f.voice.start(); await tick();
  assert.equal(captures, 0);
  assert.ok(!f.socket().sent.some(m => m.item?.content?.[0]?.text?.includes("22 AWG")));
  const stream = { getAudioTracks: () => [{}] };
  assert.equal(f.voice.setRemoteInputStream(stream), false);
  f.config.allowOtherUsersTrigger = true;
  assert.equal(f.voice.setRemoteInputStream(stream), true);
  f.config.allowOtherUsersTrigger = false;
  f.voice.refreshSettings();
  assert.equal(f.voice.getState().remoteInputEnabled, false);
});

test("Draw realtime routes annotation tools to one shared board and blocks CAD review proposals", async t => {
  const commands = [];
  const f = transportFixture(t, { opts: {
    getSceneContext: () => ({ projectId: 'p1', spatialBoard: { active: true, selectedRegionId: 'region1', notes: [] } }),
    onDrawBoardCommand: command => { commands.push(command); return { ok: true, generated: false, noteId: 'n1' }; },
  } });
  await f.voice.start(); await tick();
  const socket = f.socket();
  assert.ok(socket.sent.find(m => m.type === 'session.update').session.tools.some(tool => tool.name === 'draw_board_command'));
  socket.event({ type: 'response.function_call_arguments.done', name: 'draw_board_command', call_id: 'note', arguments: JSON.stringify({ action: 'add_note', regionId: 'region1', text: 'Split here' }) });
  await tick();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].regionId, 'region1');
  socket.event({ type: 'response.function_call_arguments.done', name: 'propose_cad_change', call_id: 'cad', arguments: JSON.stringify({ instruction: 'Cut it now' }) });
  socket.event({ type: 'response.function_call_arguments.done', name: 'review_cad_changes', call_id: 'review', arguments: '{}' });
  await tick();
  assert.equal(f.proposals.length, 0);
  assert.equal(f.applied.length, 0);
  assert.ok(socket.sent.some(m => m.item?.output?.includes('Draw planning')));
});

test("talk-mode start greets on the realtime socket so Astra speaks", async t => {
  const f = transportFixture(t);
  await f.voice.start({ greet: true, text: "Hey Astra." }); await tick();
  assert.equal(f.voice.getState().live, true);
  assert.ok(f.socket().sent.some(m => m.item?.content?.[0]?.text === "Hey Astra."));
  assert.ok(f.socket().sent.some(m => m.type === "response.create"));
  assert.ok(f.voice.getOutputStream());
});

test("empty realtime greeting requests the same brief Render introduction", async t => {
  const f = transportFixture(t);
  await f.voice.start({ greet: true }); await tick();
  const greeting = f.socket().sent.find(m => m.item?.content?.[0]?.text)?.item.content[0].text || "";
  assert.match(greeting, /Introduce yourself once, briefly/);
  assert.match(greeting, /Render, your design partner/);
});

test("Draw annotation tool respects disabled selection metadata", async t => {
  let commands = 0;
  const f = transportFixture(t, { settings: { includeSelectionMetadata: false }, opts: { onDrawBoardCommand: () => { commands++; } } });
  await f.voice.start();
  f.socket().event({ type: 'response.function_call_arguments.done', name: 'draw_board_command', call_id: 'note', arguments: '{"action":"add_note","text":"hidden"}' });
  await tick();
  assert.equal(commands, 0);
});


test('simultaneous startup callers share one microphone acquisition',async t=>{
 const f=transportFixture(t);
 await Promise.all([f.voice.primeMedia(),f.voice.primeMedia(),f.voice.primeMedia()]);
 assert.equal(f.micRequests(),1);
 await f.voice.start({greet:true});assert.equal(f.voice.getState().live,true);assert.equal(f.micRequests(),1);
 assert.equal(f.socket().sent.filter(m=>m.type==='response.create').length,1);
});

test("desktop and VR share selected OpenAI voice and default to Marin", () => {
  for (const review of [false, true]) {
    assert.equal(voiceRealtimeConfig("gpt-realtime", {}, { review }).audio.output.voice, "marin");
    assert.equal(voiceRealtimeConfig("gpt-realtime", { voice: "cedar" }, { review }).audio.output.voice, "marin");
  }
  assert.doesNotMatch(src, /enqueueSpeak|function speakLocal/);
  assert.match(src, /\/api\/voice-mold\/speech/);
});

test("provider speech failure cannot switch to the browser default voice", () => {
  assert.doesNotMatch(src, /speakBrowserFallback|speechSynthesis\.speak/);
  assert.match(src, /speechError = error\?\.message \|\| "Voice audio is unavailable; the text reply is shown\."/);
});

test("every Voice AI transport shares one global PCM output owner", () => {
  const audioOutput = readFileSync(join(here, "voice-audio-output.js"), "utf8");
  assert.match(audioOutput, /let activeVoiceOutput = null/);
  assert.match(audioOutput, /stopAllVoiceAiOutput\(this\)/);
  assert.match(audioOutput, /speechSynthesis\?\.cancel/);
  assert.match(audioOutput, /if \(activeVoiceOutput === this\) activeVoiceOutput = null/);
});
