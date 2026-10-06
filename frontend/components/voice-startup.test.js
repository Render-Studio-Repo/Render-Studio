import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceMold } from './voice-mold.js';

function fixture(t) {
  const saved = new Map(), contexts = [], calls = [], grants = [], denials = [];
  let gesture = true, microphoneRequests = 0;
  const install = (key, value) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); };
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 } });
  const stream = () => { const track = { readyState: 'live', kind: 'audio', stop() { this.readyState = 'ended'; } }; return { getTracks: () => [track], getAudioTracks: () => [track] }; };
  class Context {
    constructor() { this.state = 'suspended'; this.sampleRate = 24000; contexts.push(this); }
    createGain() { return node(); }
    createAnalyser() { return { ...node(), getFloatTimeDomainData() {} }; }
    createMediaStreamDestination() { return { ...node(), stream: stream() }; }
    createMediaStreamSource() { return node(); }
    createScriptProcessor() { return node(); }
    async resume() { if (!gesture) throw new Error('AudioContext resume lost controller activation'); this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  class Socket extends EventTarget {
    static OPEN = 1;
    constructor() { super(); this.readyState = 1; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(raw) { if (JSON.parse(raw).type === 'session.update') queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: '{"type":"session.updated"}' }))); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  install('window', { addEventListener() {}, speechSynthesis: { cancel() {} } });
  install('localStorage', { getItem: () => '', setItem() {} });
  install('location', { host: 'localhost', protocol: 'http:' });
  install('navigator', { mediaDevices: { getUserMedia() { microphoneRequests++; return new Promise((resolve, reject) => { grants.push(resolve); denials.push(reject); }); } } });
  install('AudioContext', Context); install('WebSocket', Socket);
  const voice = createVoiceMold({ bindDesktop: false, getAgentSettings: () => ({ voiceModel: 'gpt-realtime-mini', includeVisualContext: false }),
    api: async path => { calls.push(path); return path.includes('/models')
      ? { models: [{ id: 'gpt-realtime-mini', transport: 'realtime' }] }
      : { transport: 'realtime', model: 'gpt-realtime-mini', proxy_ws_path: '/api/voice-mold/ws' }; },
  });
  t.after(() => { voice.stop(); for (const [key, value] of saved) if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; });
  return { voice, contexts, calls, stream, grants, denials, leaveGesture: () => { gesture = false; }, requests: () => microphoneRequests };
}

test('capture reuses the gesture-unlocked context after delayed microphone permission and socket startup', async t => {
  const f = fixture(t), starting = f.voice.start({ greet: true });
  assert.equal(f.contexts.length, 1); assert.equal(f.contexts[0].state, 'running');
  assert.equal(f.requests(), 1);
  f.leaveGesture(); const mic = f.stream(); f.grants[0](mic);
  await starting;
  assert.equal(f.voice.getState().live, true, f.voice.getState().statusMessage);
  assert.equal(f.contexts.length, 1, 'No second suspended context is constructed after network awaits');
  f.voice.stop(); assert.equal(mic.getTracks()[0].readyState, 'ended'); assert.equal(f.contexts[0].state, 'closed');
});

test('overlapping gesture priming requests share one microphone permission request', async t => {
  const f = fixture(t), first = f.voice.primeMedia(), second = f.voice.primeMedia();
  assert.equal(first, second); assert.equal(f.requests(), 1); assert.equal(f.contexts.length, 1);
  const mic = f.stream(); f.grants[0](mic); assert.equal(await first, true);
  f.voice.stop(); assert.equal(mic.getTracks()[0].readyState, 'ended');
});

test('Stop during microphone permission releases a late owned stream without restarting voice', async t => {
  const f = fixture(t), starting = f.voice.start();
  f.voice.stop(); const mic = f.stream(); f.grants[0](mic);
  await starting;
  assert.equal(mic.getTracks()[0].readyState, 'ended'); assert.equal(f.voice.getState().live, false);
  assert.equal(f.contexts[0].state, 'closed');
  assert.ok(!f.calls.includes('/api/voice-mold/session'));
});

test('borrowing a room microphone avoids another permission prompt and never stops the room track', async t => {
  const f = fixture(t), mic = f.stream(), starting = f.voice.start({ stream: mic });
  f.leaveGesture(); await starting;
  assert.equal(f.voice.getState().live, true, f.voice.getState().statusMessage); assert.equal(f.requests(), 0);
  f.voice.stop(); assert.equal(mic.getTracks()[0].readyState, 'live');
  assert.equal(f.contexts[0].state, 'closed');
});

test('missing microphone fails clearly before any voice catalog or session request', async t => {
  const f = fixture(t), starting = f.voice.start();
  f.denials[0](Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' }));
  await starting;
  assert.equal(f.voice.getState().live, false); assert.match(f.voice.getState().statusMessage, /No microphone is available/);
  assert.equal(f.calls.length, 0); assert.equal(f.contexts[0].state, 'closed');
});

test('muted room microphone stays muted while Talk acquires and releases its private microphone', async t => {
  const f = fixture(t), room = f.stream(); room.getAudioTracks()[0].enabled = false;
  const starting = f.voice.start({ stream: room });
  assert.equal(f.requests(), 1);
  const owned = f.stream(); f.grants[0](owned); f.leaveGesture(); await starting;
  assert.equal(f.voice.getState().live, true, f.voice.getState().statusMessage);
  f.voice.stop(); assert.equal(owned.getAudioTracks()[0].readyState, 'ended');
  assert.equal(room.getAudioTracks()[0].readyState, 'live'); assert.equal(room.getAudioTracks()[0].enabled, false);
});

test('a later room stream cannot replace and leak the privately primed microphone', async t => {
  const f = fixture(t), first = f.voice.primeMedia(), owned = f.stream();
  f.grants[0](owned); await first;
  const room = f.stream(); await f.voice.primeMedia({ stream: room });
  await f.voice.start({ stream: room });
  assert.equal(f.voice.getState().live, true); assert.equal(f.requests(), 1);
  f.voice.stop(); assert.equal(owned.getAudioTracks()[0].readyState, 'ended');
  assert.equal(room.getAudioTracks()[0].readyState, 'live');
});
