import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createXrPublicLobby} from './xr-public-lobby.js';

let originals,now,timers,sockets,status,poses,lobby,nextTimer;
function advance(ms){
 const end=now+ms;
 for(;;){const pending=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pending)break;
  const [id,t]=pending;now=t.at;timers.delete(id);if(t.interval)timers.set(id,{...t,at:now+t.interval});t.fn();
 }now=end;
}
const emit=(s,type,data={})=>s.emit(type,data);
const sync=(s,users=[])=>{s.readyState=1;emit(s,'open');emit(s,'message',{data:JSON.stringify({type:'presence.sync',users})});};
beforeEach(()=>{
 originals={window:globalThis.window,location:globalThis.location,WebSocket:globalThis.WebSocket,dateNow:Date.now};
 now=0;nextTimer=0;timers=new Map();sockets=[];status=[];poses=[];Date.now=()=>now;
 const schedule=(fn,ms,interval=0)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms,interval});return id;};
 globalThis.window={setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>schedule(fn,ms,ms),clearInterval:id=>timers.delete(id)};
 globalThis.location={protocol:'https:',host:'render3d.app'};
 globalThis.WebSocket=class{
  static OPEN=1;static CONNECTING=0;
  constructor(url){this.url=url;this.readyState=0;this.listeners={};this.sent=[];sockets.push(this);}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
  emit(type,event){for(const fn of this.listeners[type]||[])fn(event);}
  close(){this.readyState=3;this.closed=true;}
  send(data){this.sent.push(JSON.parse(data));}
 };
 lobby=createXrPublicLobby({getToken:()=> 'test-token',getCurrentUser:()=>({id:'self',display_name:'Self'}),onStatus:(...s)=>status.push(s),onXrPose:p=>poses.push(p)});
});
afterEach(()=>{lobby.leave();Date.now=originals.dateNow;for(const key of ['window','location','WebSocket'])globalThis[key]=originals[key];});

test('Join uses one socket and waits for server presence, then relays pose data',async()=>{
 const a=lobby.join(),b=lobby.join();assert.equal(a,b);assert.equal(sockets.length,1);assert.equal(lobby.isJoining(),true);
 const s=sockets[0];s.readyState=1;emit(s,'open');assert.equal(lobby.isJoined(),false);
 emit(s,'message',{data:JSON.stringify({type:'presence.sync',users:[{id:'peer',xrPose:{head:{p:[0,1.6,0]}}}]})});advance(80);
 assert.equal((await a).ok,true);assert.equal(lobby.isJoined(),true);assert.equal(lobby.isJoining(),false);assert.equal(poses.length,1);
 lobby.sendPose({head:{p:[1,2,3]}});assert.equal(s.sent[0].type,'xr.pose');
});

test('a socket stuck connecting times out, closes, and a second Join succeeds',async()=>{
 const first=lobby.join(),old=sockets[0];advance(8100);
 assert.match((await first).error,/timed out/);assert.equal(old.closed,true);assert.equal(lobby.isJoining(),false);
 const retry=lobby.join();assert.equal(sockets.length,2);sync(sockets[1]);advance(80);assert.equal((await retry).ok,true);
 emit(old,'message',{data:JSON.stringify({type:'presence.sync',users:[{id:'stale'}]})});emit(old,'close',{code:4409});
 assert.equal(lobby.isJoined(),true);assert.equal(lobby.getOccupants().length,0);
});

test('an open socket without the room acknowledgement also times out',async()=>{
 const result=lobby.join();sockets[0].readyState=1;emit(sockets[0],'open');advance(8100);
 assert.equal((await result).ok,false);assert.equal(sockets[0].closed,true);assert.equal(lobby.isJoined(),false);
});

test('auth failures return their useful reason immediately and allow a fresh retry',async()=>{
 const result=lobby.join();emit(sockets[0],'close',{code:4401});advance(80);
 assert.match((await result).error,/Sign in again/);assert.equal(lobby.isJoining(),false);
 const retry=lobby.join();sync(sockets[1]);advance(80);assert.equal((await retry).ok,true);
});

test('socket errors release the pending Join instead of leaving it stuck',async()=>{
 const result=lobby.join();emit(sockets[0],'error');advance(80);
 assert.match((await result).error,/connection failed/);assert.equal(lobby.isJoining(),false);
});

test('leave during Join cancels it without overriding a newer join',async()=>{
 const first=lobby.join();lobby.leave();const next=lobby.join();sync(sockets[1]);advance(80);
 assert.equal((await first).cancelled,true);assert.equal((await next).ok,true);assert.equal(lobby.isJoined(),true);
});

test('established rooms reconnect and replace stale occupants from the new presence snapshot',async()=>{
 const result=lobby.join();sync(sockets[0],[{id:'old-peer'}]);advance(80);await result;
 emit(sockets[0],'close',{code:1006});advance(1200);assert.equal(sockets.length,2);
 sync(sockets[1],[{id:'new-peer'}]);assert.deepEqual(lobby.getOccupants().map(p=>p.id),['new-peer']);
 assert.equal(lobby.isJoined(),true);
});

test('a recent stationary pose is published on initial join and reconnect',async()=>{
 const pose={head:{p:[0,1.6,0],q:[0,0,0,1]}};
 lobby.sendPose(pose);assert.equal(sockets.length,0);
 const result=lobby.join();sync(sockets[0]);advance(80);await result;
 assert.deepEqual(sockets[0].sent,[{type:'xr.pose',pose}]);
 emit(sockets[0],'close',{code:1006});advance(1200);sync(sockets[1]);
 assert.deepEqual(sockets[1].sent,[{type:'xr.pose',pose}]);
});

test('joining later does not resurrect a stale headset pose',async()=>{
 lobby.sendPose({head:{p:[0,1.6,0]}});advance(3000);
 const result=lobby.join();sync(sockets[0]);advance(80);await result;
 assert.deepEqual(sockets[0].sent,[]);
});

test('public import shares a model without privately opening the peer project',async()=>{
 const drops=[],opened=[];
 lobby=createXrPublicLobby({getToken:()=> 'test-token',getCurrentUser:()=>({id:'self'}),
  onDropProject:async id=>{drops.push(id);return {ok:true,message:'Shared'};},onImportProject:id=>opened.push(id)});
 assert.equal((await lobby.importProject('robot')).ok,true);assert.deepEqual(drops,['robot']);assert.deepEqual(opened,[]);
 const joining=lobby.join();sync(sockets[0]);advance(80);await joining;
 emit(sockets[0],'message',{data:JSON.stringify({type:'project.announce',user_id:'peer',project_id:'private-project'})});
 assert.deepEqual(opened,[]);
});
