/** Dedicated assistant-audio channel over the authenticated room transport.
 * Never publishes the owner's microphone. Guest microphones are sent only by
 * an explicit invoke() gesture, stop after 20 seconds, and never feed speakers.
 */
import { extraIceServersFromWindow, iceServersFromApiPayload, xrIceServers, xrIceFetchInit, XR_ICE_API } from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5";

export const XR_AGENT_ROOM_CHANNEL = "xr-agent-v1";
export const XR_AGENT_GUEST_MIC_MS = 20000;
const MAX_PEERS = 32;
const cleanText = (value, limit = 80) => typeof value === "string" ? value.slice(0, limit).trim() : "";
const clamp = (value, fallback = 0.8) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
const id = () => globalThis.crypto?.randomUUID?.() || `agent-rtc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const tracks = (stream) => (stream?.getAudioTracks?.() || []).filter((track) => track.readyState !== "ended");

function pose(value) {
  const vector = (item, length) => {
    const values = Array.isArray(item) ? item : length === 3 ? [item?.x, item?.y, item?.z] : [item?.x, item?.y, item?.z, item?.w];
    return values.length === length && values.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100000) ? values : null;
  };
  const position = vector(value?.position, 3);
  const quaternion = vector(value?.quaternion, 4);
  return position && quaternion ? { position, quaternion } : null;
}

/** Whitelist public presence; no prompts, CAD context, sources or credentials. */
export function xrAgentRoomPresence(value = {}) {
  const settings = value.settings || value;
  const live = value.live === true;
  const visible = value.visible === true && live && (settings.showToRoom === true || settings.shareWithRoom === true || settings.allowOtherUsersTrigger === true);
  return {
    name: cleanText(settings.name) || "Astra", wakeName: cleanText(settings.wakeName) || cleanText(settings.name) || "Astra",
    avatar: ["orb", "robot", "gem"].includes(settings.avatar) ? settings.avatar : "orb",
    visible, live: visible && live, level: visible ? Math.round(clamp(value.level, 0) * 20) / 20 : 0,
    showToRoom: visible && settings.showToRoom === true,
    shareWithRoom: visible && settings.shareWithRoom === true,
    allowOtherUsersTrigger: visible && settings.allowOtherUsersTrigger === true,
    pose: visible ? pose(value.pose) : null,
  };
}

/**
 * createXrAgentRoom({getPeers,sendSignal,getState,getOutputStream,getMicStream,
 *   getToken?,onRemoteState,onRemoteMicStream,onError})
 * - receiveSignal(peerId,signal): peerId MUST come from authenticated transport.
 * - sync(): broadcast current public state / reconcile room membership.
 * - invoke(peerId): explicit user action; toggle max-20-second guest mic send.
 * - setRemoteVolume / mutePeer: affect only this listener.
 * Dependency injection (RTC,AudioContext,createAudio,getUserMedia,fetch,setTimer,
 * clearTimer) keeps tests deterministic; normal callers use browser defaults.
 */
export function createXrAgentRoom(options = {}) {
  const RTC = options.RTC || globalThis.RTCPeerConnection;
  const AudioContextClass = options.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
  const schedule = options.setTimer || globalThis.setTimeout.bind(globalThis);
  const cancelTimer = options.clearTimer || globalThis.clearTimeout.bind(globalThis);
  const sessions = new Map();
  const remote = new Map();
  const audioPrefs = new Map();
  const sentState = new Map();
  const earlyIce = new Map();
  let disposed = false;
  let syncing = null;
  let resync = false;
  let icePromise = null;
  let mixer = null;
  let invokePending = new Set();

  const report = (error) => options.onError?.(error instanceof Error ? error : new Error(String(error)));
  const peerIds = () => new Set((options.getPeers?.() || []).slice(0, MAX_PEERS).map((peer) => cleanText(typeof peer === "string" ? peer : peer.id || peer.user_id, 120)).filter(Boolean));
  const allowed = (peerId) => peerIds().has(peerId);
  const own = () => xrAgentRoomPresence(options.getState?.() || {});
  const prefs = (peerId) => audioPrefs.get(peerId) || { volume: 0.8, muted: false };
  function notify(peerId) {
    const value = remote.get(peerId);
    options.onRemoteState?.(peerId, value?.visible ? { ...value, ...prefs(peerId), invoking: [...sessions.values()].some((entry) => entry.peerId === peerId && entry.outgoing && entry.kind === "guest-mic") } : null);
  }
  function send(peerId, signal) {
    if (disposed || !allowed(peerId)) return;
    try {
      const result = options.sendSignal?.(peerId, { channel: XR_AGENT_ROOM_CHANNEL, ...signal });
      result?.catch?.(report);
    } catch (error) { report(error); }
  }
  async function iceServers() {
    if (!icePromise) icePromise = (async () => {
      if (options.iceServers) return options.iceServers;
      const fallback = xrIceServers(extraIceServersFromWindow());
      const fetcher = options.fetch || globalThis.fetch;
      if (!fetcher || !options.getToken) return fallback;
      try {
        const token = await options.getToken();
        if (!token) return fallback;
        const response = await fetcher(XR_ICE_API, xrIceFetchInit(token));
        if (!response.ok) return fallback;
        return xrIceServers([...extraIceServersFromWindow(), ...iceServersFromApiPayload(await response.json())]);
      } catch { return fallback; }
    })();
    return icePromise;
  }
  function attachGuest(entry, stream) {
    if (!own().allowOtherUsersTrigger || !own().live) return;
    if (!mixer) {
      if (!AudioContextClass) { report(new Error("This browser cannot mix a guest microphone into the agent.")); return; }
      const context = new AudioContextClass();
      mixer = { context, destination: context.createMediaStreamDestination(), sources: new Map() };
    }
    if (mixer.sources.has(entry.id)) return;
    const source = mixer.context.createMediaStreamSource(stream);
    source.connect(mixer.destination);
    mixer.sources.set(entry.id, source);
    void mixer.context.resume?.().catch?.(() => {});
    options.onRemoteMicStream?.(mixer.destination.stream);
  }
  function detachGuest(entry) {
    if (!mixer?.sources.has(entry.id)) return;
    try { mixer.sources.get(entry.id)?.disconnect(); } catch { /* disconnected */ }
    mixer.sources.delete(entry.id);
    if (mixer.sources.size) return;
    options.onRemoteMicStream?.(null);
    void mixer.context.close?.().catch?.(() => {});
    mixer = null;
  }
  function applyAudio(entry) {
    if (!entry.audio) return;
    const value = prefs(entry.peerId);
    entry.audio.volume = value.volume;
    entry.audio.muted = value.muted;
  }
  function attachAssistant(entry, stream) {
    if (!remote.get(entry.peerId)?.shareWithRoom) return;
    const audio = options.createAudio?.() || globalThis.document?.createElement("audio");
    if (!audio) return;
    if (entry.audio) { entry.audio.pause?.(); entry.audio.srcObject=null; entry.audio.remove?.(); }
    entry.audio = audio;
    audio.autoplay = true; audio.playsInline = true; audio.srcObject = stream;
    audio.dataset && (audio.dataset.xrAgentPeer = entry.peerId);
    applyAudio(entry);
    void audio.play?.().catch?.(() => report(new Error("Select the shared agent’s volume control to enable its audio.")));
  }
  function closeSession(entry, tellPeer = true) {
    if (!entry || !sessions.has(entry.id)) return;
    if (tellPeer) send(entry.peerId, { type: "end", kind: entry.kind, sessionId: entry.id });
    sessions.delete(entry.id); earlyIce.delete(entry.id);
    cancelTimer(entry.timer);
    entry.pc.onicecandidate = entry.pc.ontrack = entry.pc.onconnectionstatechange = null;
    try { entry.pc.close(); } catch { /* already closed */ }
    if (entry.audio) { entry.audio.pause?.(); entry.audio.srcObject = null; entry.audio.remove?.(); }
    detachGuest(entry);
    if (entry.ownedStream) for (const track of entry.stream?.getTracks?.() || []) track.stop();
    notify(entry.peerId);
  }
  async function connection(peerId, kind, sessionId, outgoing) {
    if (!RTC) throw new Error("This browser does not support WebRTC room audio.");
    const servers = await iceServers();
    if (disposed || !allowed(peerId)) return null;
    if (sessions.size >= MAX_PEERS * 4) throw new Error("The agent room has reached its audio connection limit.");
    const pc = new RTC({ iceServers: servers });
    const entry = { id: sessionId, peerId, kind, outgoing, pc, pendingIce: [], remoteSet: false, audio: null, stream: null, ownedStream: false, timer: null };
    sessions.set(sessionId, entry);
    pc.onicecandidate = (event) => { if (event.candidate) send(peerId, { type: "ice", kind, sessionId, candidate: event.candidate.toJSON?.() || event.candidate }); };
    pc.ontrack = (event) => {
      if (outgoing || event.track?.kind !== "audio") return;
      const stream = event.streams?.[0] || (globalThis.MediaStream ? new MediaStream([event.track]) : null);
      if (!stream) return;
      if (kind === "assistant") attachAssistant(entry, stream);
      else attachGuest(entry, stream);
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) closeSession(entry);
    };
    return entry;
  }
  async function offer(peerId, kind, stream, ownedStream = false) {
    const entry = await connection(peerId, kind, id(), true);
    if (!entry) { if (ownedStream) for (const track of stream?.getTracks?.() || []) track.stop(); return null; }
    entry.stream = stream; entry.ownedStream = ownedStream;
    try {
      for (const track of tracks(stream)) entry.pc.addTrack(track, stream);
      const description = await entry.pc.createOffer();
      if (!sessions.has(entry.id)) return null;
      await entry.pc.setLocalDescription(description);
      send(peerId, { type: "offer", kind, sessionId: entry.id, sdp: entry.pc.localDescription?.sdp || description.sdp });
      if (kind === "guest-mic") entry.timer = schedule(() => closeSession(entry), XR_AGENT_GUEST_MIC_MS);
      notify(peerId);
      return entry;
    } catch (error) { closeSession(entry); throw error; }
  }
  async function setRemote(entry, type, sdp) {
    await entry.pc.setRemoteDescription({ type, sdp });
    entry.remoteSet = true;
    for (const candidate of [...(earlyIce.get(entry.id) || []), ...entry.pendingIce]) {
      try { await entry.pc.addIceCandidate(candidate); } catch { /* stale ICE */ }
    }
    earlyIce.delete(entry.id); entry.pendingIce = [];
  }
  async function receiveSignal(peerId, signal) {
    peerId = cleanText(peerId, 120);
    if (disposed || !allowed(peerId) || signal?.channel !== XR_AGENT_ROOM_CHANNEL) return false;
    if (signal.type === "state") {
      const value = xrAgentRoomPresence(signal.state);
      remote.set(peerId, value);
      for (const entry of [...sessions.values()]) {
        if (entry.peerId !== peerId) continue;
        if ((!entry.outgoing && entry.kind === "assistant" && !value.shareWithRoom) || (entry.outgoing && entry.kind === "guest-mic" && !value.allowOtherUsersTrigger)) closeSession(entry);
      }
      notify(peerId); return true;
    }
    const sessionId = cleanText(signal.sessionId, 120);
    const kind = signal.kind;
    if (!sessionId || !["assistant", "guest-mic"].includes(kind)) return false;
    let entry = sessions.get(sessionId);
    if (entry && (entry.peerId !== peerId || entry.kind !== kind)) return false;
    if (signal.type === "end") { closeSession(entry, false); earlyIce.delete(sessionId); return true; }
    if (signal.type === "ice") {
      if (!signal.candidate || JSON.stringify(signal.candidate).length > 5000) return false;
      if (entry?.remoteSet) { try { await entry.pc.addIceCandidate(signal.candidate); } catch { /* stale candidate */ } }
      else if (entry) { if (entry.pendingIce.length < 50) entry.pendingIce.push(signal.candidate); }
      else if (earlyIce.size < MAX_PEERS * 4) {
        const list = earlyIce.get(sessionId) || [];
        if (list.length < 50) list.push(signal.candidate);
        earlyIce.set(sessionId, list);
      }
      return true;
    }
    if (!["offer", "answer"].includes(signal.type) || typeof signal.sdp !== "string" || signal.sdp.length > 128000) return false;
    try {
      if (signal.type === "offer") {
        if (entry) return false;
        if (kind === "assistant" ? !remote.get(peerId)?.shareWithRoom : !own().allowOtherUsersTrigger) return false;
        for (const previous of [...sessions.values()]) if (previous.peerId === peerId && previous.kind === kind && !previous.outgoing) closeSession(previous);
        entry = await connection(peerId, kind, sessionId, false);
        if (!entry) return false;
        await setRemote(entry, "offer", signal.sdp);
        const description = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(description);
        send(peerId, { type: "answer", kind, sessionId, sdp: entry.pc.localDescription?.sdp || description.sdp });
        if (kind === "guest-mic") entry.timer = schedule(() => closeSession(entry), XR_AGENT_GUEST_MIC_MS + 1000);
        return true;
      }
      if (!entry?.outgoing) return false;
      await setRemote(entry, "answer", signal.sdp); return true;
    } catch (error) { closeSession(entry); report(error); return false; }
  }
  async function reconcile() {
    const peers = peerIds();
    const state = own();
    const output = options.getOutputStream?.();
    const signature = JSON.stringify(state);
    for (const peerId of [...remote.keys()]) if (!peers.has(peerId)) { remote.delete(peerId); sentState.delete(peerId); audioPrefs.delete(peerId); options.onRemoteState?.(peerId, null); }
    for (const entry of [...sessions.values()]) {
      const stop = !peers.has(entry.peerId)
        || (entry.outgoing && entry.kind === "assistant" && (!state.shareWithRoom || entry.stream !== output || !tracks(output).length))
        || (!entry.outgoing && entry.kind === "guest-mic" && !state.allowOtherUsersTrigger);
      if (stop) closeSession(entry);
    }
    for (const peerId of peers) {
      if (sentState.get(peerId) !== signature) { send(peerId, { type: "state", state }); sentState.set(peerId, signature); }
      if (!state.shareWithRoom || !tracks(output).length) continue;
      if (![...sessions.values()].some((entry) => entry.peerId === peerId && entry.kind === "assistant" && entry.outgoing)) {
        try { await offer(peerId, "assistant", output); } catch (error) { report(error); }
      }
    }
  }
  function sync() {
    if (disposed) return Promise.resolve();
    if (syncing) { resync = true; return syncing; }
    syncing = (async () => { do { resync = false; await reconcile(); } while (resync && !disposed); })().finally(() => { syncing = null; });
    return syncing;
  }
  async function invoke(peerId) {
    if (disposed || !allowed(peerId)) return false;
    const existing = [...sessions.values()].find((entry) => entry.peerId === peerId && entry.outgoing && entry.kind === "guest-mic");
    if (existing) { closeSession(existing); return false; }
    if (invokePending.has(peerId)) return false;
    if (!remote.get(peerId)?.allowOtherUsersTrigger) { report(new Error("That agent’s owner has not enabled guest requests.")); return false; }
    invokePending.add(peerId);
    let stream = null; let ownedStream = false;
    try {
      stream = await options.getMicStream?.();
      if (!tracks(stream).length) {
        const requestMic = options.getUserMedia || ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
        stream = await requestMic({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        ownedStream = true;
      }
      if (disposed || !allowed(peerId) || !remote.get(peerId)?.allowOtherUsersTrigger) {
        if (ownedStream) for (const track of stream?.getTracks?.() || []) track.stop();
        return false;
      }
      if (!tracks(stream).length) throw new Error("No microphone audio is available for this request.");
      await offer(peerId, "guest-mic", stream, ownedStream);
      return true;
    } catch (error) {
      if (ownedStream) for (const track of stream?.getTracks?.() || []) track.stop();
      report(error); return false;
    } finally { invokePending.delete(peerId); }
  }
  function setRemoteVolume(peerId, volume) {
    audioPrefs.set(peerId, { ...prefs(peerId), volume: clamp(volume) });
    for (const entry of sessions.values()) if (entry.peerId === peerId && entry.audio) { applyAudio(entry); void entry.audio.play?.().catch?.(() => {}); }
    notify(peerId);
  }
  function mutePeer(peerId, muted = true) {
    audioPrefs.set(peerId, { ...prefs(peerId), muted: !!muted });
    for (const entry of sessions.values()) if (entry.peerId === peerId) applyAudio(entry);
    notify(peerId);
  }
  function dispose() {
    if (disposed) return;
    const hidden = { ...own(), visible: false, live: false, shareWithRoom: false, allowOtherUsersTrigger: false, level: 0, pose: null };
    for (const peerId of peerIds()) send(peerId, { type: "state", state: hidden });
    for (const entry of [...sessions.values()]) closeSession(entry);
    disposed = true; earlyIce.clear(); sentState.clear(); invokePending.clear();
    for (const peerId of remote.keys()) options.onRemoteState?.(peerId, null);
    remote.clear(); audioPrefs.clear();
  }
  return { sync, receiveSignal, handleSignal: (message) => receiveSignal(message?.user_id, message?.signal), invoke, setRemoteVolume, mutePeer, dispose };
}
