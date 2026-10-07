import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createVoiceStartGate } from '../../frontend/components/voice-start-gate.js';

const app = readFileSync(new URL('../../frontend/studio/app.js', import.meta.url), 'utf8');
const start = app.indexOf('function activateStudioVoiceAgent(options');
const end = app.indexOf('\nfunction syncVoiceOrderControls', start);
assert.ok(start > 0 && end > start);
const source = app.slice(start, end);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture() {
  const state = { live: false, connecting: false };
  const events = [];
  const stream = { id: 'existing-headset-mic' };
  const voice = { getState: () => state, greet: text => events.push(['greet', text]) };
  const agent = { getState: () => state, start: async () => { state.live = true; }, stop: async () => { state.live = false; events.push(['stop']); } };
  const context = vm.createContext({
    voiceStartGate: createVoiceStartGate(), voiceMold: voice, xrAgent: agent,
    viewportXR: { getVoiceMicStream: () => stream },
    voiceWake: { stop: () => events.push(['wake-stop']), sync: () => events.push(['wake-sync']) },
    stopPromptDictation: () => events.push(['dictation-stop']),
    syncVoiceOrderControls: live => events.push(['ui', live]),
    setEditStatus: (kind, message) => events.push([kind, message]),
  });
  vm.runInContext(source, context);
  return { activate: context.activateStudioVoiceAgent, state, events, stream, voice, agent, context };
}

test('actual Studio Talk starts synchronously and coalesces clicks during settings/mic wait', async () => {
  const f = fixture(), ready = deferred(); let calls = 0, options;
  f.agent.start = value => { calls++; options = value; return ready.promise.then(() => { f.state.live = true; }); };
  const first = f.activate(), repeated = f.activate({ toggle: true });
  assert.equal(calls, 1, 'media startup must run in the click, before a microtask');
  assert.equal(first, repeated);
  assert.equal(options.stream, f.stream);
  assert.equal(options.greet, true);
  assert.ok(!f.events.some(row => row[0] === 'ui' && row[1]));
  ready.resolve();
  assert.equal((await first).live, true);
});

test('microphone failure is reported and a later Talk retries', async () => {
  const f = fixture(); let calls = 0;
  f.agent.start = async () => { calls++; throw new Error('Microphone permission denied'); };
  const result = await f.activate();
  assert.equal(result.ok, false);
  assert.match(result.error, /Microphone permission denied/);
  assert.ok(!f.events.some(row => row[0] === 'ui' && row[1]));
  f.agent.start = async () => { calls++; f.state.live = true; };
  assert.equal((await f.activate()).live, true);
  assert.equal(calls, 2);
});

test('a resolved start without a live session cannot claim listening', async () => {
  const f = fixture();
  f.agent.start = async () => { f.state.statusMessage = 'API key unavailable'; };
  assert.equal((await f.activate()).error, 'API key unavailable');
  f.agent.start = async () => { f.state.connecting = true; };
  const result = await f.activate();
  assert.equal(result.live, false);
  assert.equal(result.connecting, true);
});

test('Talk reuses a live session and toggle stops it once', async () => {
  const f = fixture(); f.state.live = true;
  f.agent.start = () => { throw new Error('must not open another session'); };
  assert.equal((await f.activate({ text: 'hello' })).live, true);
  assert.deepEqual(f.events[0], ['greet', 'hello']);
  assert.equal((await f.activate({ toggle: true })).live, false);
  assert.equal(f.events.filter(row => row[0] === 'stop').length, 1);
});

test('missing startup service reports unavailable instead of false success', async () => {
  const f = fixture(); f.context.xrAgent = null;
  const result = await f.activate();
  assert.equal(result.ok, false);
  assert.match(result.error, /not ready/);
});

test('actual wake callback stays disabled while Talk loads settings and while voice is live', async () => {
  const f = fixture(), ready = deferred();
  const callback = app.match(/isSessionLive: (\(\) => [^\n]+),\n/);
  assert.ok(callback, 'production wake predicate must be tested');
  const isSessionLive = vm.runInContext(`(${callback[1]})`, f.context);
  assert.equal(isSessionLive(), false);
  f.agent.start = () => ready.promise.then(() => { f.state.live = true; });
  const pending = f.activate();
  assert.equal(f.state.connecting, false, 'settings still loading before transport startup');
  assert.equal(isSessionLive(), true, 'wake capture cannot compete for the pending Talk microphone');
  ready.resolve(); await pending;
  assert.equal(isSessionLive(), true);
  await f.activate({ toggle: true });
  assert.equal(isSessionLive(), false);
});
