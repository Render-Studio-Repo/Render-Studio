import { test } from "node:test";
import assert from "node:assert/strict";
import { createXrAgentRoom, xrAgentRoomPresence, XR_AGENT_ROOM_CHANNEL, XR_AGENT_GUEST_MIC_MS } from "./xr-agent-room.js";

class MockPC {
  static all = [];
  constructor() { this.tracks = []; this.candidates = []; this.connectionState = "new"; MockPC.all.push(this); }
  addTrack(track, stream) { this.tracks.push({ track, stream }); }
  async createOffer() { return { type: "offer", sdp: "test-offer" }; }
  async createAnswer() { return { type: "answer", sdp: "test-answer" }; }
  async setLocalDescription(value) { this.localDescription = value; }
  async setRemoteDescription(value) { this.remoteDescription = value; }
  async addIceCandidate(value) { this.candidates.push(value); }
  close() { this.connectionState = "closed"; }
}
function stream(name = "audio") {
  const track = { kind: "audio", readyState: "live", id: name, stopped: false, stop() { this.stopped = true; this.readyState = "ended"; } };
  return { id: name, getAudioTracks: () => [track], getTracks: () => [track], track };
}
function fixtures(extra = {}) {
  MockPC.all = [];
  let state = { settings: { name: "Astra", shareWithRoom: false, allowOtherUsersTrigger: false }, visible: true, live: true };
  let peers = [{ id: "peer-1" }];
  const output = stream("assistant-output");
  const microphone = stream("owner-mic");
  const sent = [], states = [], errors = [], sounds = [], timers = new Map();
  let timerId = 0;
  const room = createXrAgentRoom({
    RTC: MockPC, iceServers: [], getPeers: () => peers, getState: () => state,
    getOutputStream: () => output, getMicStream: () => microphone,
    sendSignal: (peerId, signal) => sent.push({ peerId, signal }),
    onRemoteState: (peerId, value) => states.push({ peerId, value }),
    onError: (error) => errors.push(error.message),
    createAudio: () => { const audio = { dataset: {}, play: async () => {}, pause() { this.paused = true; }, remove() {} }; sounds.push(audio); return audio; },
    setTimer: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimer: (id) => timers.delete(id),
    ...extra,
  });
  return { room, output, microphone, sent, states, errors, sounds, timers, get state() { return state; }, setState: (value) => { state = { ...state, ...value }; }, setPeers: (value) => { peers = value; } };
}
const signal = (type, fields = {}) => ({ channel: XR_AGENT_ROOM_CHANNEL, type, ...fields });
const visiblePeer = (extra = {}) => ({ visible: true, live: true, shareWithRoom: true, allowOtherUsersTrigger: true, name: "Nova", ...extra });

test("room presence is whitelisted and requires opt-in plus an active visible agent", () => {
  const publicState = xrAgentRoomPresence({ visible: true, live: true, level: .72, settings: { name: "Nova", avatar: "robot", shareWithRoom: true, prompt: "private", apiKey: "private-key" }, history: ["secret"], pose: { position: [1,2,3], quaternion: [0,0,0,1] } });
  assert.equal(publicState.visible, true);
  assert.equal(publicState.level, .7);
  assert.deepEqual(publicState.pose.position, [1,2,3]);
  assert.equal(JSON.stringify(publicState).includes("private"), false);
  assert.equal(JSON.stringify(publicState).includes("secret"), false);
  assert.equal(xrAgentRoomPresence({ visible: true, live: true }).visible, false);
  assert.equal(xrAgentRoomPresence({ visible: true, live: false, shareWithRoom: true }).visible, false);
});

test("off-by-default sharing creates no WebRTC connection and rejects unknown peers", async () => {
  const f = fixtures();
  await f.room.sync();
  assert.equal(MockPC.all.length, 0);
  assert.equal(f.sent[0].signal.state.visible, false);
  assert.equal(await f.room.receiveSignal("stranger", signal("state", { state: visiblePeer() })), false);
  assert.equal(await f.room.receiveSignal("peer-1", { channel: "other", type: "state" }), false);
  f.room.dispose();
  assert.equal(f.microphone.track.stopped, false);
});

test("sharing sends only assistant output and revoking sharing closes the dedicated connection", async () => {
  const f = fixtures();
  f.state.settings.shareWithRoom = true;
  await f.room.sync();
  assert.equal(MockPC.all.length, 1);
  assert.deepEqual(MockPC.all[0].tracks.map((entry) => entry.track.id), ["assistant-output"]);
  assert.equal(f.sent.find((entry) => entry.signal.type === "offer").signal.kind, "assistant");
  await f.room.sync();
  assert.equal(MockPC.all.length, 1);
  f.state.settings.shareWithRoom = false;
  await f.room.sync();
  assert.equal(MockPC.all[0].connectionState, "closed");
  assert.equal(f.output.track.stopped, false);
  assert.equal(f.microphone.track.stopped, false);
  f.room.dispose();
});

test("received assistant speech has independent local volume/mute and accepts queued ICE", async () => {
  const f = fixtures();
  await f.room.receiveSignal("peer-1", signal("state", { state: visiblePeer() }));
  await f.room.receiveSignal("peer-1", signal("ice", { kind: "assistant", sessionId: "speech-1", candidate: { candidate: "candidate:abc" } }));
  assert.equal(await f.room.receiveSignal("peer-1", signal("offer", { kind: "assistant", sessionId: "speech-1", sdp: "remote-offer" })), true);
  const pc = MockPC.all[0];
  assert.equal(pc.tracks.length, 0);
  assert.equal(pc.candidates.length, 1);
  const speech = stream("remote-assistant");
  pc.ontrack({ track: speech.track, streams: [speech] });
  f.room.setRemoteVolume("peer-1", .35);
  f.room.mutePeer("peer-1", true);
  assert.equal(f.sounds[0].srcObject, speech);
  assert.equal(f.sounds[0].volume, .35);
  assert.equal(f.sounds[0].muted, true);
  assert.equal(f.states.at(-1).value.volume, .35);
  await f.room.receiveSignal("peer-1", signal("state", { state: visiblePeer({ shareWithRoom: false }) }));
  assert.equal(pc.connectionState, "closed");
  assert.equal(f.sounds[0].srcObject, null);
  f.room.dispose();
});

test("guest microphone starts only on explicit invoke, times out, and does not stop a borrowed room microphone", async () => {
  let requests = 0;
  const f = fixtures({ getUserMedia: async () => { requests++; return stream("requested"); } });
  await f.room.receiveSignal("peer-1", signal("state", { state: visiblePeer() }));
  await f.room.sync();
  assert.equal(MockPC.all.length, 0);
  assert.equal(requests, 0);
  assert.equal(await f.room.invoke("peer-1"), true);
  assert.equal(MockPC.all[0].tracks[0].track.id, "owner-mic");
  assert.equal(f.sent.find((entry) => entry.signal.type === "offer").signal.kind, "guest-mic");
  assert.equal(f.timers.values().next().value.ms, XR_AGENT_GUEST_MIC_MS);
  f.timers.values().next().value.fn();
  assert.equal(MockPC.all[0].connectionState, "closed");
  assert.equal(f.microphone.track.stopped, false);
  await f.room.receiveSignal("peer-1", signal("state", { state: visiblePeer({ allowOtherUsersTrigger: false }) }));
  assert.equal(await f.room.invoke("peer-1"), false);
  assert.match(f.errors.at(-1), /not enabled guest/);
  f.room.dispose();
});

test("microphones requested for an invocation are stopped when toggled off or dismissed during permission", async () => {
  const owned = stream("owned-mic");
  const f = fixtures({ getMicStream: () => null, getUserMedia: async () => owned });
  await f.room.receiveSignal("peer-1", signal("state", { state: visiblePeer() }));
  await f.room.invoke("peer-1");
  assert.equal(owned.track.stopped, false);
  await f.room.invoke("peer-1");
  assert.equal(owned.track.stopped, true);
  f.room.dispose();
  let resolve;
  const late = stream("late-permission");
  const g = fixtures({ getMicStream: () => null, getUserMedia: () => new Promise((done) => { resolve = done; }) });
  await g.room.receiveSignal("peer-1", signal("state", { state: visiblePeer() }));
  const pending = g.room.invoke("peer-1");
  await Promise.resolve();
  g.room.dispose();
  resolve(late);
  assert.equal(await pending, false);
  assert.equal(late.track.stopped, true);
});

test("incoming guest audio requires owner opt-in and is mixed into agent input without playing to speakers", async () => {
  const received = [];
  const mixed = stream("mixed-guests");
  class MockAudioContext {
    createMediaStreamDestination() { return { stream: mixed }; }
    createMediaStreamSource(input) { return { input, connect() {}, disconnect() {} }; }
    async resume() {}
    async close() {}
  }
  const f = fixtures({ AudioContext: MockAudioContext, onRemoteMicStream: (stream) => received.push(stream) });
  const offer = signal("offer", { kind: "guest-mic", sessionId: "guest-1", sdp: "guest-offer" });
  assert.equal(await f.room.receiveSignal("peer-1", offer), false);
  f.state.settings.allowOtherUsersTrigger = true;
  assert.equal(await f.room.receiveSignal("peer-1", offer), true);
  const guest = stream("remote-real-microphone");
  MockPC.all[0].ontrack({ track: guest.track, streams: [guest] });
  assert.equal(received.at(-1), mixed);
  assert.equal(f.sounds.length, 0);
  assert.equal(MockPC.all[0].tracks.length, 0);
  f.state.settings.allowOtherUsersTrigger = false;
  await f.room.sync();
  assert.equal(received.at(-1), null);
  assert.equal(MockPC.all[0].connectionState, "closed");
  f.room.dispose();
});

test("leaving peers are removed, malformed SDP rejected, and sessions are released on disposal", async () => {
  const f = fixtures();
  f.state.settings.shareWithRoom = true;
  await f.room.receiveSignal("peer-1", signal("state", { state: visiblePeer() }));
  assert.equal(await f.room.receiveSignal("peer-1", signal("offer", { kind: "assistant", sessionId: "oversize", sdp: "x".repeat(128001) })), false);
  await f.room.sync();
  f.setPeers([]);
  await f.room.sync();
  assert.equal(MockPC.all[0].connectionState, "closed");
  assert.equal(f.states.at(-1).value, null);
  f.room.dispose();
  assert.equal(await f.room.receiveSignal("peer-1", signal("state", { state: visiblePeer() })), false);
});

test('repeated remote track events replace audio instead of layering playback',async()=>{const f=fixtures();await f.room.receiveSignal('peer-1',signal('state',{state:visiblePeer()}));await f.room.receiveSignal('peer-1',signal('offer',{kind:'assistant',sessionId:'one',sdp:'offer'}));const speech=stream();const pc=MockPC.all[0];pc.ontrack({track:speech.track,streams:[speech]});pc.ontrack({track:speech.track,streams:[speech]});assert.equal(f.sounds[0].paused,true);assert.equal(f.sounds[0].srcObject,null);assert.equal(f.sounds.filter(a=>a.srcObject).length,1);f.room.dispose();});
test('visual-only sharing creates presence without opening audio or guest access',async()=>{const f=fixtures();f.state.settings.showToRoom=true;await f.room.sync();const state=f.sent[0].signal.state;assert.equal(state.visible,true);assert.equal(state.shareWithRoom,false);assert.equal(state.allowOtherUsersTrigger,false);assert.equal(MockPC.all.length,0);f.room.dispose();});
