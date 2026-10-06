import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeleopHeadingFrame } from './xr-teleop-heading.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const h = Math.SQRT1_2;
const pose = (position, q = [0, 0, 0, 1]) => ({ x: position[0], y: position[1], z: position[2], qx: q[0], qy: q[1], qz: q[2], qw: q[3] });
const viewer = q => ({ orientation: { x: q[0], y: q[1], z: q[2], w: q[3] } });
function close(actual, expected) {
  assert.ok(actual, 'a tracked pose is returned');
  for (const [key, value] of Object.entries(expected)) assert.ok(Math.abs(actual[key] - value) < 1e-9, `${key}: ${actual[key]} expected ${value}`);
}

for (const sample of [
  { name: 'zero', q: [0,0,0,1], forward: [0,0,-1], right: [1,0,0] },
  { name: 'left 90', q: [0,h,0,h], forward: [-1,0,0], right: [0,0,-1] },
  { name: 'right 90', q: [0,-h,0,h], forward: [1,0,0], right: [0,0,1] },
  { name: '180', q: [0,1,0,0], forward: [0,0,1], right: [-1,0,0] },
]) {
  test(`${sample.name} starting heading preserves forward, right and up in both hands`, () => {
    const reference = new EventTarget();
    const frame = createTeleopHeadingFrame();
    assert.equal(frame.capture(viewer(sample.q), reference), true);
    for (const origin of [[0.3, 1.2, -0.4], [-0.3, 1.2, -0.4]]) {
      const base = frame.transform(pose(origin, sample.q), reference);
      for (const [delta, expected] of [[sample.forward, [0,0,-1]], [sample.right, [1,0,0]], [[0,1,0], [0,1,0]]]) {
        const moved = frame.transform(pose(origin.map((v, i) => v + delta[i]), sample.q), reference);
        close({ x: moved.x-base.x, y: moved.y-base.y, z: moved.z-base.z }, { x: expected[0], y: expected[1], z: expected[2] });
        close(moved, { qx:0, qy:0, qz:0, qw:1 });
      }
    }
    frame.clear();
  });
}

test('heading remains fixed while hand orientation changes and keeps pitch', () => {
  const reference = new EventTarget(), frame = createTeleopHeadingFrame();
  frame.capture(viewer([0,h,0,h]), reference);
  close(frame.transform(pose([-1,0,0], [0.5,0.5,-0.5,0.5]), reference), { x:0,y:0,z:-1,qx:h,qy:0,qz:0,qw:h });
  close(frame.transform(pose([-1,0,0]), reference), { x:0,y:0,z:-1,qx:0,qy:-h,qz:0,qw:h });
  frame.clear();
});

test('missing and invalid tracking cannot produce robot poses', () => {
  const reference = new EventTarget(), frame = createTeleopHeadingFrame();
  assert.equal(frame.transform(pose([1,2,3]), reference), null);
  assert.equal(frame.capture(viewer([0,0,0,0]), reference), false);
  assert.equal(frame.capture(viewer([h,0,0,h]), reference), false);
  assert.equal(frame.capture(null, reference), false);
  assert.equal(frame.capture(viewer([0,0,0,1]), reference), true);
  assert.equal(frame.transform(null, reference), null);
  assert.equal(frame.transform(pose([NaN,0,0]), reference), null);
  assert.equal(frame.transform(pose([0,0,0], [0,0,0,0]), reference), null);
  close(frame.transform(pose([1,2,3]), reference), {x:1,y:2,z:3,qw:1});
  frame.clear();
});

test('reference-space replacement and recenter require explicit fresh capture', () => {
  const reference = new EventTarget(), next = new EventTarget(), frame = createTeleopHeadingFrame();
  frame.capture(viewer([0,0,0,1]), reference);
  reference.dispatchEvent(new Event('reset'));
  assert.equal(frame.ready(), false);
  assert.equal(frame.transform(pose([1,2,3]), reference), null);
  frame.capture(viewer([0,h,0,h]), reference);
  assert.equal(frame.transform(pose([-1,0,0]), next), null);
  assert.equal(frame.ready(), false);
  frame.capture(viewer([0,h,0,h]), next);
  reference.dispatchEvent(new Event('reset'));
  close(frame.transform(pose([-1,0,0], [0,h,0,h]), next), {x:0,y:0,z:-1,qw:1});
  frame.clear();
  assert.equal(frame.transform(pose([-1,0,0]), next), null);
});

function runtime() {
  const source = readFileSync(new URL('./xr-dimos-teleop.js', import.meta.url), 'utf8');
  const reference = new EventTarget();
  const sent = [], errors = [];
  const sources = ['left','right'].map(handedness => ({handedness, gripSpace:{handedness}}));
  let tracked = true, head = [0,h,0,h];
  const context = {
    performance: {now: () => 1000}, Date, Set, AbortController,
    recordMode: 'idle', armed: true, presenting: true,
    pendingYStart: true, startingPositionReady:false,homeAndDisarmPromise:null, startingPositionTask:null, startingPositionController:null,
    connectGeneration:1, ws:{readyState:1}, WebSocket:{OPEN:1},
    teleopHeading:createTeleopHeadingFrame(),
    roboticsIntegratedProfile:()=>({}), shouldRunDimosTeleopWork:()=>true,
    preferredRoboticsSources: sources=>sources, teleopStop:{blocksMotion:()=>false},
    piRecordPulse:{timedOut:()=>false,clear:()=>{},busy:()=>false}, piDiscardPulse:{timedOut:()=>false,clear:()=>{}}, piQueuedStop:false, piSaveIntent:null,
    lastSendTime:0, SEND_INTERVAL_MS:0, recordStartedAt:0, leftYMissingSince:0,
    piUi:{retainHands:()=>{}}, looksLikeController:()=>false,
    poseFromXrPose:value=>value ? pose(Object.values(value.transform.position), Object.values(value.transform.orientation)) : null,
    sendPose:(hand,value)=>sent.push({hand,...value}),
    sendJoyMsg:()=>{}, getDimosRecordState:()=>({}), notePosePacket:()=>{},
    leftPrimaryHeld:false,rightPrimaryHeld:false,notify:()=>{},
    applyStartingPosition:async()=>true, postProfileY:action=>sent.push({action}), yPoseSocketOpen:()=>true,
    setStatus:(status,text)=>errors.push(text), emitPiAction:()=>{},
  };
  context.setDimosTeleopArmed=value=>{context.armed=value;};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function flushPendingYStart()'), source.indexOf('/** XR enter / leave:')), context);
  vm.runInContext(source.slice(source.indexOf('export function tickDimosTeleop('), source.indexOf('\nfunction robotPickerLabel(')).replace('export function','function'), context);
  const renderer={xr:{
    getFrame:()=>({
      getViewerPose:()=>({transform:viewer(head)}),
      getPose:()=>tracked ? {transform:{position:{x:-0.1,y:0,z:0},orientation:{x:0,y:h,z:0,w:h}}} : null,
    }),
    getReferenceSpace:()=>reference,
    getControllerGrip:index=>({userData:{handedness:index?'right':'left'},matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,99,99,99,1]}}),
  }};
  const tick=()=>context.tickDimosTeleop({renderer,session:{inputSources:sources}});
  return {context,sent,errors,reference,tick,setTracked:value=>{tracked=value;},setHead:value=>{head=value;}};
}

test('actual tick sends both normalized poses before first engage and retains heading', async () => {
  const r=runtime();
  r.tick();
  assert.deepEqual(r.sent.map(value=>value.hand||value.action), ['left','right']);
  close(r.sent[0], {x:0,y:0,z:-0.1,qw:1});
  await new Promise(setImmediate);
  r.tick();
  assert.deepEqual(r.sent.map(value=>value.hand||value.action), ['left','right','left','right','tap']);
  r.setHead([0,0,0,1]);
  r.tick();
  close(r.sent.at(-1), {x:0,y:0,z:-0.1,qw:1});
  r.reference.dispatchEvent(new Event('reset'));
  const count=r.sent.length;
  r.tick();
  assert.equal(r.context.armed,false);
  assert.equal(r.sent.length,count);
  assert.match(r.errors.at(-1),/reference space changed/);
});

test('actual tick never engages from missing tracking or cached grip matrices', async () => {
  const r=runtime();
  r.setTracked(false);
  r.tick();
  await new Promise(setImmediate);
  assert.deepEqual(r.sent,[]);
  assert.equal(r.context.pendingYStart,true);
  r.setTracked(true);
  r.tick();
  assert.deepEqual(r.sent.map(value=>value.hand||value.action), ['left','right']);
  await new Promise(setImmediate);
  r.tick();
  assert.equal(r.sent.at(-1).action,'tap');
  r.context.teleopHeading.clear();
});

test('HUD-activated first tap queues until the first current pose pair is sent', () => {
  const r=runtime(), source=readFileSync(new URL('./xr-dimos-teleop.js', import.meta.url),'utf8');
  r.context.teleopHeading.capture(viewer([0,h,0,h]),r.reference);
  Object.assign(r.context, {
    pendingYStart:false, yFollowActive:false,
    dimosYCommandUrl:()=>'/teleop/y',
    teleopStop:{phase:()=>'',resume:()=>true},
  });
  vm.runInContext(source.slice(source.indexOf('function postProfileY('),source.indexOf('\nfunction handleProfileY(')),r.context);
  r.context.postProfileY('tap',{});
  assert.equal(r.context.pendingYStart,true);
  assert.deepEqual(r.sent,[]);
  r.context.teleopHeading.clear();
});

test('a stopped Y tap invalidates the old heading and queues a fresh controller calibration', () => {
  const r=runtime(), source=readFileSync(new URL('./xr-dimos-teleop.js', import.meta.url),'utf8');
  r.context.teleopHeading.capture(viewer([0,h,0,h]),r.reference);
  Object.assign(r.context, {
    pendingYStart:false, yFollowActive:false, homeAndDisarmPromise:null,
    profileY:{clear(){}}, lastHudAction:'NONE',
    handleProfileY:action=>r.sent.push({action}), notify:()=>{},
  });
  vm.runInContext(source.slice(source.indexOf('function applyLeftYAction('),source.indexOf('\nconst START_POSITION_KEY')),r.context);
  r.context.applyLeftYAction('tap',{},{});
  assert.equal(r.context.teleopHeading.ready(),false);
  assert.equal(r.context.pendingYStart,true);
  assert.equal(r.sent.some(value=>value.action==='tap'),false);
});

test('failed starting position never proceeds into engage', async () => {
  const r=runtime();
  r.context.applyStartingPosition=async()=>{throw Error('Home feedback not confirmed');};
  r.tick();
  await new Promise(setImmediate);
  assert.equal(r.context.pendingYStart,false);
  assert.equal(r.context.startingPositionReady,false);
  assert.match(r.errors.at(-1),/Home feedback not confirmed/);
  r.tick();
  assert.equal(r.sent.some(value=>value.action==='tap'),false);
  assert.equal(r.sent.filter(value=>value.hand).length,4);
  r.context.teleopHeading.clear();
});

test('a cancelled or disconnected starting-position task cannot arm a new session', async () => {
  for (const reason of ['cancel','disconnect']) {
    const r=runtime();
    let finish;
    r.context.applyStartingPosition=()=>new Promise(resolve=>{finish=resolve;});
    r.tick();
    assert.equal(r.context.startingPositionReady,false);
    if(reason==='cancel')r.context.startingPositionController.abort();
    else r.context.connectGeneration++;
    finish(true);
    await new Promise(setImmediate);
    assert.equal(r.context.startingPositionReady,false);
    assert.deepEqual(r.sent.map(value=>value.hand||value.action),['left','right']);
    r.context.teleopHeading.clear();
  }
});


test('Home blocks actual tick pose transmission before its reset microtask begins', () => {
  const r=runtime();
  r.context.homeAndDisarmPromise=Promise.resolve();
  r.tick();
  assert.deepEqual(r.sent,[]);
  r.context.teleopHeading.clear();
});

test('explicit Stop aborts saved startup before any delayed Home can continue', () => {
  const r=runtime(), source=readFileSync(new URL('./xr-dimos-teleop.js', import.meta.url),'utf8');
  r.context.teleopHeading.capture(viewer([0,h,0,h]),r.reference);
  const startup=new AbortController(), home=new AbortController();
  Object.assign(r.context, {startingPositionController:startup, startingPositionTask:{},
    startingPositionReady:true, homeAndDisarmController:home,
    handleProfileY:action=>r.sent.push({action}), notify:()=>{}});
  vm.runInContext(source.slice(source.indexOf('export function requestDimosSafeHome()'),source.indexOf('let homeAndDisarmPromise = null;')).replace('export function','function'),r.context);
  r.context.requestDimosSafeHome();
  assert.equal(startup.signal.aborted,true);
  assert.equal(home.signal.aborted,true);
  assert.equal(r.context.pendingYStart,false);
  assert.equal(r.context.startingPositionReady,false);
  assert.equal(r.context.teleopHeading.ready(),false);
  assert.deepEqual(r.sent.map(s=>s.action),['session_reset']);
});
