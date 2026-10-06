import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomCamera,cameraPose,CAMERA_CHANNEL} from './xr-room-camera.js';
const pose={p:[0,1,-1],q:[0,0,0,1],s:[1,1,1]};
function fixture(overrides={}) {
  let joined=true,stops=0,requests=0;const events=[],sent=[];
  const track={readyState:'live',stop(){stops++;},addEventListener(){}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const args={getUserId:()=> 'owner', getPeers:()=> [],isJoined:()=>joined,sendSignal:(...v)=>sent.push(v),
    getPose:()=>pose, getIceServers:()=>[],onStream:(...e)=>events.push(e),onPose:()=>{},RTC:class{},
    mediaDevices:{getUserMedia:async constraints=>{requests++;assert.equal(constraints.audio,false);assert.deepEqual(constraints.video.facingMode,{exact:'environment'});return stream;}},...overrides};
  return {camera:createRoomCamera(args),events,sent,stream,requests:()=>requests,stops:()=>stops,leave:()=>joined=false};
}
test('camera requires an explicit action, requests outward video only and stops on leave',async()=>{
  const f=fixture();f.camera.tick(2000);assert.equal(f.requests(),0);
  await f.camera.start();assert.equal(f.requests(),1);assert.ok(f.camera.state().sharing);
  f.leave();f.camera.tick(2100);assert.equal(f.stops(),1);assert.equal(f.camera.state().sharing,false);
});
test('cancel pending permission request stops a subsequently granted track',async()=>{
  let resolve;const f=fixture({mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});
  const task=f.camera.start();f.camera.stop();resolve(f.stream);await task;
  assert.equal(f.stops(),1);assert.equal(f.camera.state().sharing,false);assert.equal(f.events.length,0);
});
test('unavailable outward camera produces a useful error without falling back to avatar camera',async()=>{
  let calls=0;const f=fixture({mediaDevices:{getUserMedia:async()=>{calls++;throw Object.assign(new Error(),{name:'OverconstrainedError'});}}});
  await assert.rejects(f.camera.start(),/not exposing an outward camera/);assert.equal(calls,1);assert.equal(f.camera.state().pending,false);
});
test('unjoined users cannot request a camera; malformed resize and outsider signaling ignored',async()=>{
  const f=fixture();f.leave();await assert.rejects(f.camera.start(),/Join/);assert.equal(f.requests(),0);
  assert.equal(cameraPose({...pose,s:[100,1,1]}),null);assert.equal(cameraPose({...pose,p:[NaN,0,0]}),null);
  await f.camera.receive('outsider',{channel:CAMERA_CHANNEL,kind:'offer',session:'evil'});assert.equal(f.events.length,0);
});
