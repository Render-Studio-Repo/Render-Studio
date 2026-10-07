/** WebRTC headset voice over the project collab WebSocket. */

import {
  extraIceServersFromWindow,
  iceRestartOfferOptions,
  iceServersFromApiPayload,
  listenerAxesFromQuat,
  peerVoiceOutputGain,
  shouldQueueRemoteIce,
  shouldRestartIce,
  shouldRunXrVoiceIceWork,
  shouldSendIceCandidate,
  XR_ICE_API,
  xrIceFetchInit,
  xrIceServers,
} from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5";

export { peerVoiceOutputGain, xrIceServers, shouldRestartIce, iceRestartOfferOptions };

export const XR_VOICE_PANNER = {
  panningModel: "HRTF",
  distanceModel: "inverse",
  refDistance: 1.2,
  maxDistance: 20,
  rolloffFactor: 0.85,
};

function polite(localId, remoteId) {
  return String(localId || "") < String(remoteId || "");
}

export function createXrVoice() {
  /** @type {Map<string, RTCPeerConnection>} */
  const peers = new Map();
  /** @type {Map<string, HTMLAudioElement>} */
  const speakers = new Map();
  /** @type {Map<string, { source: AudioNode, panner: PannerNode, gain: GainNode }>} */
  const peerNodes = new Map();
  let localStream = null;
  let localUserId = "";
  let sendSignal = null;
  let enabled = false;
  let speaking = false;
  let analyser = null;
  let analyserCtx = null;
  let analyserData = null;
  let lastSpeakAt = 0;
  let micPromise = null;
  let micDenied = false;
  let startLock = Promise.resolve();
  /** Offers that arrived while the mic prompt was still open. */
  const pendingSignals = [];
  let lastPeerIds = [];
  let reconnectTimer = 0;
  let iceServers = xrIceServers(extraIceServersFromWindow());
  /** @type {Map<string, { lastRestartAt: number, restartCount: number, remoteSet: boolean, pendingIce: object[] }>} */
  const peerIce = new Map();
  let gpuBusyFn = () => false;

  function setGpuBusy(fnOrBool) {
    if (typeof fnOrBool === "function") gpuBusyFn = fnOrBool;
    else gpuBusyFn = () => !!fnOrBool;
  }

  function rtcGpuBusy() {
    try {
      return gpuBusyFn() === true;
    } catch {
      return false;
    }
  }

  function teardownPeer(id) {
    const pc = peers.get(id);
    if (pc) {
      try { pc.close(); } catch { /* ignore */ }
      peers.delete(id);
    }
    const el = speakers.get(id);
    if (el) {
      try {
        el.pause();
        el.srcObject = null;
        el.remove();
      } catch { /* ignore */ }
      speakers.delete(id);
    }
    const nodes = peerNodes.get(id);
    if (nodes) {
      try { nodes.source.disconnect(); } catch { /* ignore */ }
      try { nodes.panner.disconnect(); } catch { /* ignore */ }
      try { nodes.gain.disconnect(); } catch { /* ignore */ }
      peerNodes.delete(id);
    }
    peerIce.delete(id);
  }

  function iceMeta(id) {
    let row = peerIce.get(id);
    if (!row) {
      row = { lastRestartAt: 0, restartCount: 0, remoteSet: false, pendingIce: [] };
      peerIce.set(id, row);
    }
    return row;
  }

  function addLocalTracks(pc) {
    if (!pc || !localStream) return;
    const have = new Set(pc.getSenders().map((s) => s.track).filter(Boolean));
    for (const track of localStream.getAudioTracks()) {
      if (!have.has(track)) pc.addTrack(track, localStream);
    }
  }

  function attachRemoteAudio(userId, track) {
    let el = speakers.get(userId);
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true;
      el.playsInline = true;
      el.setAttribute("data-xr-voice", userId);
      document.body.appendChild(el);
      speakers.set(userId, el);
    }
    const stream = el.srcObject instanceof MediaStream ? el.srcObject : new MediaStream();
    if (!stream.getTracks().includes(track)) stream.addTrack(track);
    el.srcObject = stream;
    hookSpatialGraph(userId, stream);
    applyPeerAudio(userId);
    void el.play?.().then(() => applyPeerAudio(userId)).catch(() => {});
  }

  function ensureAudioCtx() {
    if (analyserCtx) return analyserCtx;
    try {
      analyserCtx = new AudioContext();
      return analyserCtx;
    } catch {
      return null;
    }
  }

  function hookSpatialGraph(userId, stream) {
    if (peerNodes.has(userId) || !stream) return;
    const ctx = ensureAudioCtx();
    if (!ctx?.createPanner || !ctx.createMediaStreamSource) return;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const panner = ctx.createPanner();
      panner.panningModel = XR_VOICE_PANNER.panningModel;
      panner.distanceModel = XR_VOICE_PANNER.distanceModel;
      panner.refDistance = XR_VOICE_PANNER.refDistance;
      panner.maxDistance = XR_VOICE_PANNER.maxDistance;
      panner.rolloffFactor = XR_VOICE_PANNER.rolloffFactor;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 360;
      const gain = ctx.createGain();
      source.connect(panner);
      panner.connect(gain);
      gain.connect(ctx.destination);
      peerNodes.set(userId, { source, panner, gain });
    } catch {
      /* stereo HTMLAudio fallback */
    }
  }

  function clamp01(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 1;
    return Math.max(0, Math.min(1, v));
  }

  const peerVol = new Map();
  const peerMuted = new Map();
  const peerPan = new Map();
  const _listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };

  function applyPeerAudio(userId) {
    const el = speakers.get(userId);
    if (!el) return;
    const muted = !!peerMuted.get(userId);
    const base = clamp01(peerVol.has(userId) ? peerVol.get(userId) : 1);
    const out = peerVoiceOutputGain(muted, base);
    const nodes = peerNodes.get(userId);
    const pannerLive = !!(nodes?.gain && analyserCtx && analyserCtx.state === "running");
    if (pannerLive) {
      el.muted = true;
      el.volume = 0;
      nodes.gain.gain.value = out;
    } else {
      el.muted = muted;
      el.volume = out;
      if (nodes?.gain) nodes.gain.gain.value = muted ? 0 : out;
    }
  }

  function setListenerPose(pos, quat) {
    if (!pos) return;
    _listener.x = pos.x;
    _listener.y = pos.y;
    _listener.z = pos.z;
    const axes = quat ? listenerAxesFromQuat(quat) : null;
    if (axes) {
      _listener.rx = axes.fx;
      _listener.rz = axes.fz;
    }
    const ctx = analyserCtx;
    const listener = ctx?.listener;
    if (!listener) return;
    try {
      if (listener.positionX) {
        listener.positionX.value = pos.x;
        listener.positionY.value = pos.y;
        listener.positionZ.value = pos.z;
        if (axes) {
          listener.forwardX.value = axes.fx;
          listener.forwardY.value = axes.fy;
          listener.forwardZ.value = axes.fz;
          listener.upX.value = axes.ux;
          listener.upY.value = axes.uy;
          listener.upZ.value = axes.uz;
        }
      } else {
        listener.setPosition?.(pos.x, pos.y, pos.z);
        if (axes) listener.setOrientation?.(axes.fx, axes.fy, axes.fz, axes.ux, axes.uy, axes.uz);
      }
    } catch {
      /* AudioListener locked */
    }
  }

  function setPannerPos(panner, pos) {
    if (!panner || !pos) return;
    const x = pos.x || 0;
    const y = pos.y || 0;
    const z = pos.z || 0;
    try {
      if (panner.positionX) {
        panner.positionX.value = x;
        panner.positionY.value = y;
        panner.positionZ.value = z;
      } else {
        panner.setPosition?.(x, y, z);
      }
    } catch {
      /* ignore */
    }
  }

  function setPeerPose(userId, pos) {
    const id = String(userId || "");
    if (!id || !pos) return;
    const nodes = peerNodes.get(id);
    if (nodes?.panner) {
      setPannerPos(nodes.panner, pos);
      peerPan.set(id, { panner: true, x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 });
      return;
    }
    const dx = (pos.x || 0) - _listener.x;
    const dy = (pos.y || 0) - _listener.y;
    const dz = (pos.z || 0) - _listener.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    peerPan.set(id, { gain: Math.max(0.55, clamp01(1.2 - dist * 0.1)), dist });
    applyPeerAudio(id);
  }

  function setPeerVolume(userId, vol) {
    const id = String(userId || "");
    if (!id) return 1;
    const next = clamp01(vol);
    peerVol.set(id, next);
    applyPeerAudio(id);
    return next;
  }

  function setPeerMuted(userId, muted) {
    const id = String(userId || "");
    if (!id) return false;
    const on = !!muted;
    peerMuted.set(id, on);
    applyPeerAudio(id);
    return on;
  }

  function getPeerVolume(userId) {
    const id = String(userId || "");
    return clamp01(peerVol.has(id) ? peerVol.get(id) : 1);
  }

  function isPeerMuted(userId) {
    return !!peerMuted.get(String(userId || ""));
  }

  function getMicStream() {
    return hasLiveMic() ? localStream : null;
  }

  function sendIce(remoteId, candidate) {
    if (!sendSignal || !shouldSendIceCandidate(candidate)) return;
    sendSignal({
      type: "rtc.signal",
      target_user_id: remoteId,
      signal: { kind: "ice", candidate },
    });
  }

  async function flushQueuedIce(remoteId, pc) {
    const meta = iceMeta(remoteId);
    if (!meta.remoteSet || !pc) return;
    const queued = meta.pendingIce.splice(0);
    for (const cand of queued) {
      try { await pc.addIceCandidate(cand); } catch { /* stale */ }
    }
  }

  async function sendOffer(remoteId, pc, { iceRestart = false } = {}) {
    if (!localStream || !sendSignal) return;
    if (peers.get(remoteId) !== pc) return;
    if (pc.signalingState !== "stable") return;
    if (iceRestart && rtcGpuBusy()) return;
    addLocalTracks(pc);
    const opts = iceRestart ? iceRestartOfferOptions() : { offerToReceiveAudio: true };
    const offer = await pc.createOffer(opts);
    await pc.setLocalDescription(offer);
    sendSignal({
      type: "rtc.signal",
      target_user_id: remoteId,
      signal: { kind: "offer", sdp: pc.localDescription, iceRestart: !!iceRestart },
    });
  }

  async function repairPeer(remoteId, pc) {
    if (!enabled || peers.get(remoteId) !== pc) return;
    const meta = iceMeta(remoteId);
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const action = shouldRestartIce({
      iceConnectionState: pc.iceConnectionState,
      connectionState: pc.connectionState,
      lastRestartAt: meta.lastRestartAt,
      now,
      restartCount: meta.restartCount,
      gpuBusy: rtcGpuBusy(),
    });
    if (!action) return;
    meta.lastRestartAt = now;
    meta.restartCount += 1;
    if (action === "recreate") {
      teardownPeer(remoteId);
      if (enabled) void ensurePc(remoteId);
      return;
    }
    try {
      if (typeof pc.restartIce === "function") pc.restartIce();
      await sendOffer(remoteId, pc, { iceRestart: true });
    } catch {
      teardownPeer(remoteId);
      if (enabled) void ensurePc(remoteId);
    }
  }

  async function ensurePc(remoteId) {
    let pc = peers.get(remoteId);
    if (pc) {
      addLocalTracks(pc);
      return pc;
    }
    pc = new RTCPeerConnection({ iceServers });
    peers.set(remoteId, pc);
    iceMeta(remoteId);
    addLocalTracks(pc);
    pc.onicecandidate = (ev) => {
      sendIce(remoteId, ev.candidate ? ev.candidate.toJSON() : null);
    };
    pc.ontrack = (ev) => {
      const track = ev.track || ev.streams?.[0]?.getAudioTracks?.()?.[0];
      if (track) attachRemoteAudio(remoteId, track);
      void resumeAudio();
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        void repairPeer(remoteId, pc);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        void repairPeer(remoteId, pc);
      }
    };
    pc.onnegotiationneeded = () => {
      if (polite(localUserId, remoteId)) void sendOffer(remoteId, pc);
    };
    if (polite(localUserId, remoteId) && localStream) {
      await sendOffer(remoteId, pc);
    } else if (localStream) {
      setTimeout(() => { void sendOffer(remoteId, pc); }, 1600);
    }
    return pc;
  }

  async function handleSignal(msg) {
    if (!enabled) {
      if (pendingSignals.length < 48) pendingSignals.push(msg);
      return;
    }
    const from = String(msg?.user_id || "");
    if (!from || from === localUserId) return;
    const target = String(msg?.target_user_id || "");
    if (target && target !== localUserId) return;
    const signal = msg.signal;
    if (!signal || typeof signal !== "object") return;
    const pc = await ensurePc(from);
    const kind = String(signal.kind || "");
    const meta = iceMeta(from);
    try {
      if (kind === "offer" && signal.sdp) {
        const colliding = pc.signalingState !== "stable";
        if (colliding) {
          if (!polite(localUserId, from)) return;
          try { await pc.setLocalDescription({ type: "rollback" }); } catch { /* Quest may lack rollback */ }
        }
        addLocalTracks(pc);
        await pc.setRemoteDescription(signal.sdp);
        meta.remoteSet = true;
        await flushQueuedIce(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal?.({
          type: "rtc.signal",
          target_user_id: from,
          signal: { kind: "answer", sdp: pc.localDescription },
        });
      } else if (kind === "answer" && signal.sdp) {
        if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(signal.sdp);
          meta.remoteSet = true;
          await flushQueuedIce(from, pc);
        }
      } else if (kind === "ice") {
        const cand = signal.candidate;
        if (cand === undefined) return;
        if (shouldQueueRemoteIce({ remoteDescriptionSet: meta.remoteSet })) {
          if (meta.pendingIce.length < 32) meta.pendingIce.push(cand);
          return;
        }
        try {
          await pc.addIceCandidate(cand);
        } catch {
          /* ignore late ICE */
        }
      }
    } catch (err) {
      console.warn("[xr-voice] signal", err);
    }
  }

  function tickSpeaking() {
    if (!analyser || !analyserData) {
      speaking = false;
      return false;
    }
    analyser.getByteTimeDomainData(analyserData);
    let sum = 0;
    for (let i = 0; i < analyserData.length; i += 1) {
      const v = (analyserData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / analyserData.length);
    if (rms > 0.04) lastSpeakAt = performance.now();
    speaking = performance.now() - lastSpeakAt < 280;
    return speaking;
  }

  function hasLiveMic() {
    return !!(localStream && localStream.getAudioTracks().some((t) => t.readyState === "live"));
  }

  function watchMicPermission() {
    try {
      const q = navigator.permissions?.query?.({ name: "microphone" });
      if (!q || typeof q.then !== "function") return;
      q.then((st) => {
        const apply = () => {
          const state = String(st?.state || "");
          if (state === "granted") micDenied = false;
          else if (state === "denied") micDenied = true;
        };
        apply();
        st.onchange = apply;
      }).catch(() => {});
    } catch {
      /* Permissions API missing */
    }
  }

  watchMicPermission();

  async function queryMicPermission() {
    try {
      const st = await navigator.permissions?.query?.({ name: "microphone" });
      return String(st?.state || "");
    } catch {
      return "";
    }
  }

  function setupAnalyser() {
    if (!localStream || analyser) return;
    try {
      const ctx = ensureAudioCtx();
      if (!ctx) return;
      const src = ctx.createMediaStreamSource(localStream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      analyserData = new Uint8Array(analyser.fftSize);
    } catch {
      analyser = null;
    }
  }

  async function acquireMic() {
    if (hasLiveMic()) return localStream;
    if (micDenied) {
      const err = new Error("Microphone permission denied");
      err.name = "NotAllowedError";
      throw err;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone unavailable");
    }
    if (!micPromise) {
      micPromise = (async () => {
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          });
        } catch (err) {
          if (err?.name === "NotAllowedError" || err?.name === "SecurityError") throw err;
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
        localStream = stream;
        setupAnalyser();
        return stream;
      })().catch(async (err) => {
        micPromise = null;
        const state = await queryMicPermission();
        if (state === "denied" || err?.name === "NotAllowedError" || err?.name === "SecurityError") {
          if (state === "denied") micDenied = true;
        }
        throw err;
      });
    }
    return micPromise;
  }

  /** Fire getUserMedia without waiting — call from page load and from the Enter VR tap. */
  async function prepareMic() {
    if (micDenied) return false;
    try {
      await acquireMic();
      await resumeAudio();
      return hasLiveMic();
    } catch {
      return false;
    }
  }

  async function resumeAudio() {
    try { await analyserCtx?.resume?.(); } catch { /* ignore */ }
    for (const el of speakers.values()) {
      try { void el.play?.(); } catch { /* ignore */ }
    }
  }

  function clearMicBlock() {
    micDenied = false;
  }

  function releaseMic() {
    if (enabled) return;
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    micPromise = null;
    if (analyserCtx) {
      try { void analyserCtx.close(); } catch { /* ignore */ }
      analyserCtx = null;
      analyser = null;
      analyserData = null;
    }
  }

  function isPreparing() {
    return !!micPromise && !hasLiveMic();
  }

  async function startUnlocked({ userId, send, peerIds = [], iceServers: extraIce, getToken } = {}) {
    if (rtcGpuBusy() || !shouldRunXrVoiceIceWork({
      presenting: true,
      enterSettled: true,
      unhideBusy: rtcGpuBusy(),
    })) {
      const err = new Error("xr-voice-deferred");
      err.name = "XrVoiceDeferred";
      throw err;
    }
    localUserId = String(userId || "");
    sendSignal = typeof send === "function" ? send : null;
    let fromApi = [];
    try {
      let token = "";
      try { token = typeof getToken === "function" ? (getToken() || "") : ""; } catch { token = ""; }
      const res = await fetch(XR_ICE_API, xrIceFetchInit(token));
      if (res?.ok) fromApi = iceServersFromApiPayload(await res.json());
    } catch {
      fromApi = [];
    }
    iceServers = xrIceServers([...(extraIce || []), ...fromApi, ...extraIceServersFromWindow()]);
    await acquireMic();
    if (!localStream) throw new Error("Microphone unavailable");
    localMuted = false;
    applyLocalMute();
    setupAnalyser();
    await resumeAudio();
    enabled = true;
    lastPeerIds = [...peerIds];
    startReconnectWatch();
    for (const pc of peers.values()) addLocalTracks(pc);
    const queued = pendingSignals.splice(0);
    for (const id of peerIds) {
      if (id && id !== localUserId) void ensurePc(id);
    }
    for (const msg of queued) {
      try { await handleSignal(msg); } catch { /* ignore */ }
    }
  }

  function start(opts) {
    const run = startLock.then(() => startUnlocked(opts), () => startUnlocked(opts));
    startLock = run.catch(() => {});
    return run;
  }

  function startReconnectWatch() {
    stopReconnectWatch();
    reconnectTimer = setInterval(() => {
      if (enabled && lastPeerIds.length) syncPeers(lastPeerIds);
    }, 1600);
  }

  function stopReconnectWatch() {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = 0;
    }
  }

  function syncPeers(peerIds = []) {
    if (!enabled) return;
    lastPeerIds = [...(peerIds || [])];
    const want = new Set((peerIds || []).filter((id) => id && id !== localUserId));
    for (const id of [...peers.keys()]) {
      if (!want.has(id)) teardownPeer(id);
    }
    for (const id of want) {
      const pc = peers.get(id);
      if (pc && pc.connectionState === "closed") teardownPeer(id);
      else if (pc && ["failed", "disconnected"].includes(pc.connectionState || pc.iceConnectionState)) {
        void repairPeer(id, pc);
        continue;
      }
      if (!peers.has(id)) void ensurePc(id);
    }
  }

  let localMuted = false;

  function applyLocalMute() {
    localStream?.getAudioTracks().forEach((t) => { t.enabled = !localMuted; });
  }

  function setMuted(muted) {
    localMuted = !!muted;
    applyLocalMute();
  }

  function isLocalMuted() {
    if (localMuted) return true;
    const tracks = localStream?.getAudioTracks?.() || [];
    if (!tracks.length) return true;
    return tracks.every((t) => t.enabled === false);
  }

  function stop() {
    enabled = false;
    speaking = false;
    lastPeerIds = [];
    stopReconnectWatch();
    pendingSignals.length = 0;
    for (const id of [...peers.keys()]) teardownPeer(id);
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    micPromise = null;
    if (analyserCtx) {
      try { void analyserCtx.close(); } catch { /* ignore */ }
      analyserCtx = null;
      analyser = null;
      analyserData = null;
    }
    sendSignal = null;
  }

  return {
    start,
    stop,
    prepareMic,
    releaseMic,
    resumeAudio,
    clearMicBlock,
    handleSignal,
    syncPeers,
    setMuted,
    isLocalMuted,
    setPeerVolume,
    setPeerMuted,
    getPeerVolume,
    isPeerMuted,
    getMicStream,
    tickSpeaking,
    hasMic: hasLiveMic,
    isPreparing,
    queryPermission: queryMicPermission,
    isMicDenied: () => micDenied,
    isEnabled: () => enabled,
    isSpeaking: () => speaking,
    setGpuBusy,
    setListenerPose,
    setPeerPose,
    hasPeerPanner: (userId) => peerNodes.has(String(userId || "")),
    getIceServers: () => iceServers,
  };
}
