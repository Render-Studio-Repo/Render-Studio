import { extraIceServersFromWindow, iceServersFromApiPayload, xrIceServers, xrIceFetchInit, XR_ICE_API } from './xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5';
/** Explicit, video-only outward-camera sharing over the authenticated room relay. */
export const CAMERA_CHANNEL = 'xr-camera-v1';
export function cameraPose(value) {
  if (!value || !['p','q','s'].every((k) => Array.isArray(value[k]) && value[k].length === (k === 'q' ? 4 : 3) && value[k].every(n => Number.isFinite(n) && Math.abs(n) < 10000))) return null;
  if (value.s.some(n => n < .15 || n > 4)) return null;
  return {p:[...value.p], q:[...value.q], s:[...value.s]};
}
export function createRoomCamera({getPeers, getUserId, isJoined, sendSignal, getIceServers, getToken, onStream, onPose, onStatus, getPose,
  mediaDevices = globalThis.navigator?.mediaDevices, RTC = globalThis.RTCPeerConnection} = {}) {
  const calls = new Map(), queues = new Map(), stopped = new Set();
  let icePromise;
  const ice = () => getIceServers ? getIceServers() : (icePromise ||= (async()=>{
    const fallback=xrIceServers(extraIceServersFromWindow());
    try {const token=await getToken?.();if(!token)return fallback;
      const r=await fetch(XR_ICE_API,xrIceFetchInit(token));
      return r.ok ? xrIceServers([...extraIceServersFromWindow(),...iceServersFromApiPayload(await r.json())]) : fallback;
    } catch {return fallback;}
  })());
  let local = null, pending = false, epoch = 0, lastSync = 0, known = new Set();
  const peers = () => new Set((getPeers?.() || []).map(p => String(p.id || p.user_id || p)).filter(id => id && id !== getUserId()));
  const send = (peer, data) => { if (isJoined()) sendSignal(peer, {channel:CAMERA_CHANNEL, ...data}); };
  const key = (peer, owner) => `${peer}:${owner}`;
  function close(k) {
    const row = calls.get(k); if (!row) return;
    calls.delete(k); row.pc.close();
    if (row.owner !== getUserId()) onStream(row.owner, null);
  }
  function stop() {
    epoch++; pending = false;
    if (local) {
      for (const peer of peers()) send(peer, {kind:'stop', session:local.id});
      local.stream.getTracks().forEach(t => t.stop());
      onStream(getUserId(), null); local = null;
    }
    for (const [k,r] of calls) if (r.owner === getUserId()) close(k);
    onStatus?.('ok', 'Camera sharing off');
  }
  async function connection(peer, owner, session) {
    const k = key(peer,owner), existing = calls.get(k);
    if (existing?.session === session) return existing;
    if (existing) close(k);
    const pc = new RTC({iceServers: await ice()});
    const row = {pc, peer, owner, session}; calls.set(k,row);
    pc.onicecandidate = e => { if(e.candidate) send(peer,{kind:'ice',owner,session,candidate:e.candidate.toJSON()}); };
    pc.ontrack = e => {
      if (calls.get(k) !== row || owner === getUserId()) return;
      onStream(owner, e.streams[0] || new MediaStream([e.track]));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { close(k); onStatus?.('error','Camera connection failed; retrying while sharing is enabled.'); }
    };
    return row;
  }
  async function offer(peer) {
    const active = local; if (!active || calls.has(key(peer,getUserId()))) return;
    // Reserve before ICE credentials resolve so frame reconciliation cannot duplicate offers.
    const token = epoch;
    const row = await connection(peer,getUserId(),active.id);
    if (token !== epoch || local !== active || !peers().has(peer)) { close(key(peer,getUserId())); return; }
    active.stream.getVideoTracks().forEach(track => {
      const sender = row.pc.addTrack(track,active.stream);
      const params = sender.getParameters(); params.encodings = [{maxBitrate:650000,maxFramerate:15}];
      void sender.setParameters(params).catch(() => {});
    });
    await row.pc.setLocalDescription(await row.pc.createOffer());
    send(peer,{kind:'offer',owner:getUserId(),session:active.id,sdp:row.pc.localDescription.toJSON(),pose:active.pose});
  }
  const offering = new Set();
  function offerOnce(peer) {
    if (offering.has(peer)) return;
    offering.add(peer); void offer(peer).catch(e => { close(key(peer,getUserId())); onStatus?.('error',e.message); }).finally(()=>offering.delete(peer));
  }
  async function start() {
    if (local || pending) return;
    if (!isJoined()) throw new Error('Join a public room before sharing your camera.');
    if (!mediaDevices?.getUserMedia || !RTC) throw new Error('This browser does not expose headset camera sharing.');
    const token = ++epoch; pending = true;
    onStatus?.('ok','Allow outward camera access to share your surroundings with this room.');
    try {
      const stream = await mediaDevices.getUserMedia({audio:false,video:{facingMode:{exact:'environment'},width:{ideal:640},height:{ideal:480},frameRate:{ideal:15,max:15}}});
      if (token !== epoch || !isJoined()) { stream.getTracks().forEach(t=>t.stop()); return; }
      if (!stream.getVideoTracks().length) { stream.getTracks().forEach(t=>t.stop()); throw new Error('No outward-facing camera was provided.'); }
      local = {id:crypto.randomUUID(),stream,pose:cameraPose(getPose())};
      stream.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{if(local?.stream===stream)stop();},{once:true}));
      onStream(getUserId(),stream); onPose(getUserId(),local.pose);
      for (const peer of peers()) offerOnce(peer);
      onStatus?.('ok','Outward camera shared with the room. Grip to move; use − / + to resize.');
    } catch(e) {
      if (token === epoch) throw new Error(e.name === 'OverconstrainedError' || e.name === 'NotFoundError'
        ? 'This headset browser is not exposing an outward camera. Passthrough itself cannot be captured as a canvas video. Update the browser and check camera permissions.'
        : e.name === 'NotAllowedError' ? 'Camera access was denied. Allow it in browser permissions, then press Share camera again.' : e.message);
    } finally { if(token===epoch) pending=false; }
  }
  async function receive(peer, signal) {
    if (!isJoined() || !peers().has(peer) || signal?.channel !== CAMERA_CHANNEL) return;
    const {kind,session} = signal;
    if (kind === 'hello') { if(local) offerOnce(peer); return; }
    if (kind === 'move') {
      if (local && signal.session === local.id && cameraPose(signal.pose)) setPose(getUserId(),signal.pose);
      return;
    }
    if (kind === 'pose') {
      const row = calls.get(key(peer,peer));
      if (row?.session===session && cameraPose(signal.pose)) onPose(peer,signal.pose);
      return;
    }
    if (kind === 'stop') { stopped.add(`${peer}:${session}`); if(stopped.size>128)stopped.delete(stopped.values().next().value); const row=calls.get(key(peer,peer)); if(row?.session===session)close(key(peer,peer)); return; }
    if (typeof session !== 'string' || session.length > 100 || stopped.has(`${peer}:${session}`)) return;
    const owner = kind === 'offer' ? peer : signal.owner;
    if (owner !== peer && owner !== getUserId()) return;
    if (owner === getUserId() && local?.id !== session) return;
    const k=key(peer,owner);
    if (kind === 'ice' && !calls.get(k)?.pc.remoteDescription) {
      const q=queues.get(session)||[]; if(q.length<64)q.push(signal.candidate);
      if(queues.size<64||queues.has(session))queues.set(session,q); return;
    }
    if (kind === 'offer') {
      const row=await connection(peer,peer,session);
      if(!isJoined() || stopped.has(`${peer}:${session}`)){close(key(peer,peer));return;}
      await row.pc.setRemoteDescription(signal.sdp);
      for(const c of queues.get(session)||[])await row.pc.addIceCandidate(c);
      queues.delete(session);
      if(cameraPose(signal.pose)) onPose(peer,signal.pose);
      await row.pc.setLocalDescription(await row.pc.createAnswer());
      send(peer,{kind:'answer',owner:peer,session,sdp:row.pc.localDescription.toJSON()});
    } else {
      const row=calls.get(k); if(row?.session!==session)return;
      if(kind==='answer') {
        await row.pc.setRemoteDescription(signal.sdp);
        for(const c of queues.get(session)||[])await row.pc.addIceCandidate(c);
        queues.delete(session);
      } else if(kind==='ice') await row.pc.addIceCandidate(signal.candidate);
    }
  }
  function setPose(owner, value) {
    const pose=cameraPose(value); if(!pose)return;
    if(owner===getUserId() && local) {
      local.pose=pose; onPose(owner,pose);
      for(const peer of peers())send(peer,{kind:'pose',session:local.id,pose});
    } else {
      const row=calls.get(key(owner,owner));
      if(row)send(owner,{kind:'move',session:row.session,pose});
    }
  }
  function reset() { stop(); for(const k of [...calls.keys()])close(k); queues.clear(); stopped.clear(); known.clear(); icePromise=null; }
  function tick(now) {
    if(!isJoined()) { if(local||pending||calls.size)reset(); known.clear(); return; }
    if(now-lastSync<1500)return; lastSync=now;
    const current=peers();
    for(const [k,row] of calls)if(!current.has(row.peer))close(k);
    for(const peer of current) {
      if(!known.has(peer))send(peer,{kind:'hello'});
      if(local)offerOnce(peer);
    }
    known=current;
  }
  return {start,stop,reset,receive,setPose,tick,state:()=>({sharing:!!local,pending})};
}
