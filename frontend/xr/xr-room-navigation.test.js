import {test} from 'node:test';
import assert from 'node:assert/strict';
import {floorRecenter,roomFloorSeats,roomJoinSeat,roomStickAxes,roomWalkAxes,rightBHeld,stepRoomLocomotion,ROOM_WALK_CACHE,XR_RIGHT_B_BUTTON} from './xr-room-navigation.js';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
function world(raw,loco) {
 const x=raw[0]-loco.p[0],z=raw[2]-loco.p[2],a=-loco.yaw;
 return [Math.cos(a)*x+Math.sin(a)*z,raw[1]-loco.p[1],-Math.sin(a)*x+Math.cos(a)*z];
}
test('room recenter removes accumulated elevation while preserving real headset height',()=>{
 const seats=roomFloorSeats(['bob','alice','bob']);assert.equal(seats.length,2);
 for(const [i,height] of [1.55,1.88].entries()) {
  const raw=[3,height,-4],loco={p:[1,-3,2],yaw:.7};
  const next=floorRecenter({head:world(raw,loco),headYaw:.2,loco,seat:seats[i]});
  const actual=world(raw,next);near(actual[0],seats[i].p[0]);near(actual[1],height);near(actual[2],seats[i].p[2]);
  near(.2+loco.yaw-next.yaw,seats[i].yaw);
 }
});
test('left and right axes follow handedness across reversed and reconnecting source slots',()=>{
 const sources=[{handedness:'right',gamepad:{axes:[0,0,.9,0]}},{handedness:'left',gamepad:{axes:[0,0,.4,-.7]}}];
 assert.deepEqual(roomStickAxes(sources),{left:[.4,-.7],right:[.9,0]});
 assert.deepEqual(roomStickAxes(sources.reverse()),{left:[.4,-.7],right:[.9,0]});
 assert.deepEqual(roomStickAxes([{handedness:'none',gamepad:{axes:[1,1]}}]),{left:[0,0],right:[0,0]});
 assert.deepEqual(roomStickAxes([{handedness:'left',hand:{},gamepad:{buttons:[{},{},{},{},{},{}],axes:[0,0,.3,-.5]}}]),{left:[.3,-.5],right:[0,0]});
 assert.deepEqual(roomStickAxes([{handedness:'left',hand:{},gamepad:{buttons:[{}],axes:[.9,.9]}}]),{left:[0,0],right:[0,0]});
});

test('newcomers do not spawn inside an existing user when roster sorting changes',()=>{
 const seat=roomJoinSeat('alice',[{id:'bob',xrPose:{head:{p:[0,1.7,1.1]}}}]);
 assert.equal(seat.user_id,'alice');assert.ok(seat.p[2]<0);assert.equal(seat.p[1],0);
});
test('walk is planar, frame-rate bounded, head-directed, and diagonal speed is capped',()=>{
 const loco={p:[0,0,0],yaw:0},head=[0,1.7,0];
 const step=axes=>stepRoomLocomotion({loco,head,headYaw:Math.PI/2,axes:{left:axes,right:[0,0]},dt:.05,walkHeld:true});
 const f=world(head,step([0,-1]).loco);near(f[0],-.06);near(f[1],1.7);near(f[2],0);
 const diag=world(head,step([1,-1]).loco);near(Math.hypot(diag[0],diag[2]),.06);
 assert.equal(step([.1,.1]).changed,false);
});
test('right stick walks in the plane like the left stick — no snap-turn, no fly',()=>{
 const loco={p:[0,0,0],yaw:0},head=[0,1.7,0];
 const left=stepRoomLocomotion({loco,head,headYaw:Math.PI/2,axes:{left:[0,-1],right:[0,0]},dt:.05,walkHeld:true});
 const right=stepRoomLocomotion({loco,head,headYaw:Math.PI/2,axes:{left:[0,0],right:[0,-1]},dt:.05,walkHeld:true});
 near(world(head,left.loco)[0],world(head,right.loco)[0]);
 near(world(head,right.loco)[1],1.7);
 near(left.loco.yaw,0);near(right.loco.yaw,0);
});
test('both sticks add in XZ and cap at one-stick speed',()=>{
 const loco={p:[0,0,0],yaw:0},head=[0,1.7,0];
 const one=stepRoomLocomotion({loco,head,headYaw:Math.PI/2,axes:{left:[0,-1],right:[0,0]},dt:.05,walkHeld:true});
 const both=stepRoomLocomotion({loco,head,headYaw:Math.PI/2,axes:{left:[0,-1],right:[0,-1]},dt:.05,walkHeld:true});
 near(world(head,one.loco)[0],world(head,both.loco)[0]);
});
test('sticks do not walk unless right B is held',()=>{
 const loco={p:[0,0,0],yaw:0};
 const idle=stepRoomLocomotion({loco,head:[0,1.6,0],axes:{left:[1,-1],right:[1,-1]},dt:.05,walkHeld:false});
 assert.equal(idle.loco,loco);assert.equal(idle.changed,false);
 assert.deepEqual(roomWalkAxes([{handedness:'left',gamepad:{axes:[0,0,.9,-.7]}}],{walkHeld:false}),{left:[0,0],right:[0,0]});
 assert.deepEqual(roomWalkAxes([{handedness:'left',gamepad:{axes:[0,0,.9,-.7]}}],{walkHeld:true}),{left:[.9,-.7],right:[0,0]});
});
test('right B is digital buttons[5] — analog extras, left Y, and tilt are not B',()=>{
 const btn=(pressed,value=pressed?1:0)=>({pressed,value});
 const pad=(hand,buttons,axes=[0,0,0,0])=>({handedness:hand,gamepad:{buttons,axes}});
 const face=[btn(false),btn(false),btn(false),btn(false),btn(false)];
 assert.equal(XR_RIGHT_B_BUTTON,5);
 assert.equal(rightBHeld([pad('right',[...face,btn(true)])]),true);
 assert.equal(rightBHeld([pad('right',[...face,btn(false,0.95)])]),false);
 assert.equal(rightBHeld([pad('right',[...face,btn(false),btn(true),btn(true),btn(true)])]),false);
 assert.equal(rightBHeld([pad('left',[...face,btn(true)])]),false);
 assert.equal(rightBHeld([pad('right',[...face,btn(false)],[0,0,1,-1])]),false);
 assert.equal(rightBHeld([{handedness:'',gamepad:{buttons:[...face,btn(true)]}}]),true);
});
test('teleop or menu ownership blocks movement and defers held turn until neutral',()=>{
 const loco={p:[0,0,0],yaw:0};
 const s=stepRoomLocomotion({loco,head:[0,1.6,0],axes:{left:[1,-1],right:[1,0]},dt:.05,blocked:true,walkHeld:true});
 assert.equal(s.loco,loco);assert.equal(s.changed,false);assert.equal(s.turnLatched,true);
});
test('cache-bust 20260916-vrwalk1 is on the XR walk graph',()=>{
 const here=new URL('.',import.meta.url).pathname;
 const html=readFileSync(join(here,'../index.html'),'utf8');
 const app=readFileSync(join(here,'../studio/app.js'),'utf8');
 const xr=readFileSync(join(here,'viewport-xr.js'),'utf8');
 assert.equal(ROOM_WALK_CACHE,'20260916-vrwalk1');
 assert.match(html,/app\.js\?v=.*20260916-vrwalk1/);
 assert.match(app,/viewport-xr\.js\?v=.*20260916-vrwalk1/);
 assert.match(xr,/xr-room-navigation\.js\?v=.*20260916-vrwalk1/);
 assert.match(xr,/rightBHeld/);
 assert.match(xr,/walkHeld/);
 assert.equal(xr.includes('framebufferScale: 1'),false);
});
