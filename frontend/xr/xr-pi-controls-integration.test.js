import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import * as teleop from './xr-dimos-teleop.js?v=roboticsworkspace3-20260915-dimosvr1-20260915-dimosy1-picontrols1-pistopsave1-pitriggerviser2-20260916-yreset1-teleophud1&xrtalk=20260916-1&robotemote=20260916-1&astra=20260916-5&teleopfix=20260916-1&inputfix=20260916-1&yarm1=1';
import {mergePiTeleopStatus,createPiRecordPulse,piTeleopEndpoint,requestPiTeleop} from './pi-teleop-client.js?v=picontrols1';
import {DEFAULT_ROBOTICS_PROFILE} from './robotics-profile.js?v=roboticsworkspace3';

const globals={};let sockets,packets,requests,events,now,session,renderer,left,right,reply;
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const pad=()=>({mapping:'xr-standard',axes:[0,0,0,0],buttons:Array.from({length:7},()=>({pressed:false,value:0}))});
const button=(hand,index,pressed)=>{hand.gamepad.buttons[index]={pressed,value:pressed?1:0};};
function tick(ms=20){now+=ms;teleop.tickDimosTeleop({renderer,session});}
function message(value){sockets[0].onmessage({data:JSON.stringify(value)});}
function joys(){return packets.filter(p=>typeof p!=='string'&&new DataView(p.buffer).getBigUint64(0)===teleop.FP_JOY).map(p=>{
 const d=new DataView(p.buffer),n=d.getUint32(28),hand=new TextDecoder().decode(p.slice(32,32+n-1));
 const axes=d.getInt32(8),offset=32+n+axes*4;
 return {hand,axes:Array.from({length:axes},(_,i)=>d.getFloat32(32+n+i*4)),buttons:Array.from({length:d.getInt32(12)},(_,i)=>d.getInt32(offset+i*4))};
});}
beforeEach(()=>{
 for(const key of ['localStorage','WebSocket','fetch','performance','dispatchEvent'])globals[key]=globalThis[key];
 sockets=[];packets=[];requests=[];events=[];now=(now||0)+10000;reply={armed:false,holding:true};
 globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
 globalThis.WebSocket=class {static OPEN=1;static CONNECTING=0;constructor(url){this.url=url;this.readyState=0;sockets.push(this);}send(data){packets.push(data);}close(){this.readyState=3;}};
 globalThis.performance={now:()=>now};globalThis.dispatchEvent=e=>events.push(e.detail);
 globalThis.fetch=async(url,options={})=>{requests.push({url,options});return {ok:true,json:async()=>String(url).endsWith('/teleop/status')?{type:'hello',y_map:'tap_pause_hold3_kill',armed:false}:reply};};
 left={handedness:'left',gamepad:pad(),gripSpace:{}};right={handedness:'right',gamepad:pad(),gripSpace:{}};
 session={inputSources:[right,left],addEventListener(){},removeEventListener(){}};
 // Deliberately no tracked poses: buttons must still operate.
 renderer={xr:{getFrame:()=>({getPose:()=>null}),getReferenceSpace:()=>({})}};
});
afterEach(()=>{teleop.resetDimosTeleopOnXrBoundary();Object.assign(globalThis,globals);});
function connect(){teleop.setDimosTeleopArmed(true,session);sockets[0].readyState=1;sockets[0].onopen();}

test('Pi hello enables Y hold; 2s hold is WS session_reset only',async()=>{
 connect();message({type:'hello',armed:false,mock:false,y_map:'tap_pause_hold3_kill',json_control:true});
 button(left,5,true);tick();tick(3000);tick(1000);button(left,5,false);tick();await flush();
 assert.deepEqual(packets.filter(p=>typeof p==='string').map(JSON.parse),[{type:'y',action:'session_reset'}]);
 assert.deepEqual(requests.filter(r=>r.options.method==='POST').map(r=>JSON.parse(r.options.body).action),[]);
 assert.ok(joys().every(j=>j.hand!=='left'||j.buttons[5]===0));
 assert.equal(sockets.length,1);
});

test('hold stops Joy immediately, preserves real status until acknowledgement, and requires a fresh Y tap to resume',async()=>{
 connect();message({type:'hello',armed:true,mock:false,y_map:'tap_pause_hold3_kill',json_control:true});
 button(left,5,true);tick();const count=joys().length;
 tick(3000);tick(1000);await flush();
 assert.equal(joys().length,count);
 assert.equal(teleop.getDimosTeleopState().stopPhase,'pending');
 assert.equal(teleop.getDimosTeleopState().teleop.armed,true,'no optimistic arms-off claim');
 message({type:'teleop_status',armed:false,holding:false,pending_arm:false});
 button(left,5,false);tick();
 assert.equal(teleop.getDimosTeleopState().stopPhase,'stopped');
 assert.equal(joys().length,count);
 button(left,5,true);tick();button(left,5,false);tick();await flush();
 assert.deepEqual(packets.filter(p=>typeof p==='string').map(JSON.parse).map(x=>x.action),['session_reset','tap']);
 assert.ok(joys().length>count);
});

test('silent WebSocket reset falls back to HTTP once and surfaces missing confirmation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 connect();message({type:'hello',armed:true,mock:false,y_map:'tap_pause_hold3_kill',json_control:true});
 reply={armed:true};button(left,5,true);tick();tick(3000);
 await Promise.resolve();t.mock.timers.tick(750);
 for(let i=0;i<15;i++)await Promise.resolve();
 assert.equal(requests.filter(r=>r.options.method==='POST').length,1);
 assert.equal(teleop.getDimosTeleopState().stopPhase,'failed');
 assert.match(teleop.getDimosTeleopState().label,/Stop not confirmed/);
 const count=joys().length;tick();assert.equal(joys().length,count);
});

test('HTTP firmware session_reset after a pose disconnect; release before 3s is tap',async()=>{
 connect();message({type:'hello',armed:true,y_map:'tap_pause_hold3_kill'});
 button(left,5,true);tick();await flush();
 assert.equal(teleop.getDimosTeleopState().teleop.y_map,'tap_pause_hold3_kill');
 assert.equal(requests.filter(r=>r.options.method==='POST').length,0);
 sockets[0].readyState=3;sockets[0].onclose({code:1006});tick(3000);await flush();
 assert.deepEqual(requests.filter(r=>r.options.method==='POST').map(r=>JSON.parse(r.options.body).action),['session_reset']);
});

test('a tap during socket connection is not repeated when the socket opens',async()=>{
 teleop.setDimosTeleopArmed(true,session);button(left,5,true);tick();button(left,5,false);tick();await flush();
 sockets[0].readyState=1;sockets[0].onopen();await flush();
 assert.equal(requests.filter(r=>r.options.method==='POST').length,1);
});

test('following does not force X/A; X opens picker and physical A requests one record pulse',async()=>{
 connect();message({type:'hello',armed:true,y_map:'tap_pause_hold3_kill'});message({type:'episode_status',state:'idle'});
 button(left,4,true);button(right,4,true);tick();button(left,4,false);button(right,4,false);tick();await flush();
 assert.equal(events.filter(e=>e?.action==='emote_picker').length,1);
 for(let i=0;i<20;i++)tick();const a=joys().filter(j=>j.hand==='right').map(j=>j.buttons[4]);
 assert.equal(a.filter((v,i)=>v===1&&a[i-1]!==1).length,1);
 assert.ok(joys().filter(j=>j.hand==='left').every(j=>j.buttons[4]===0));
});

test('Record and Stop/Save use the Pi A button stream and authoritative episode status',async()=>{
 connect();message({type:'hello',armed:true,y_map:'tap_pause_hold3_kill'});message({type:'episode_status',state:'idle'});
 assert.equal(teleop.startDimosRecord(),true);assert.equal(teleop.startDimosRecord(),false);
 for(let i=0;i<20;i++)tick(20);
 const initial=joys().filter(j=>j.hand==='right').map(j=>j.buttons[4]);
 assert.equal(initial.filter((value,index)=>value===1&&initial[index-1]!==1).length,1);
 assert.equal(teleop.getDimosRecordState().recording,false,'no optimistic local recording');
 message({type:'episode_status',state:'recording'});assert.equal(teleop.getDimosRecordState().recording,true);
 packets.length=0;assert.equal(teleop.stopDimosRecord(),true);for(let i=0;i<20;i++)tick(20);
 const stop=joys().filter(j=>j.hand==='right').map(j=>j.buttons[4]);assert.equal(stop.filter((v,i)=>v===1&&stop[i-1]!==1).length,1);
 message({type:'episode_status',state:'idle',episodes_saved:1});message({type:'emote_confirm',name:'Take 1'});
 assert.equal(teleop.getDimosRecordState().recording,false);await flush();assert.equal(events.at(-1).action,'emote_saved');
 assert.equal(requests.filter(r=>r.url.endsWith('/emote/accept')).length,1);
 assert.equal(sockets.length,1);await flush();
});

test('saved OpenArm profile session_reset on hold even before live hello',async()=>{
 connect();button(left,5,true);tick();tick(3000);await flush();
 const actions=packets.filter(p=>typeof p==='string').map(JSON.parse).map(p=>p.action);
 assert.deepEqual(actions,['session_reset']);
});

test('menu A remains reserved and clear cancels queued record clicks',()=>{
 const pulse=createPiRecordPulse();pulse.request(true,1000);assert.equal(pulse.sample(0,1000,true),0);pulse.clear();assert.equal(pulse.sample(0,1100,true),0);
 connect();message({type:'episode_status',state:'idle'});teleop.setDimosProfileUiState({confirmOpen:true});assert.equal(teleop.startDimosRecord(),false);
});

test('status merge keeps the advertised map, handles hello fields and rejects malformed booleans',()=>{
 const status=mergePiTeleopStatus({y_map:'tap_pause_hold3_kill',armed:true},{armed:false,holding:true,y_map:''});
 assert.equal(status.y_map,'tap_pause_hold3_kill');assert.equal(status.armed,false);
 assert.equal(mergePiTeleopStatus(status,{armed:'yes'}).armed,false);
});

test('emote endpoints stay on the selected Pi and surface protocol errors',async()=>{
 assert.equal(piTeleopEndpoint(DEFAULT_ROBOTICS_PROFILE,'/emotes'),'https://192.168.1.77:8443/emotes');
 assert.throws(()=>piTeleopEndpoint({...DEFAULT_ROBOTICS_PROFILE,controllers:{http_backups:{emotes:{url:'https://example.com/emotes'}}}},'/emotes'));
 globalThis.fetch=async(url,opts)=>{assert.equal(opts.credentials,'omit');assert.equal(opts.headers?.Authorization,undefined);return {ok:true,status:200,json:async()=>({ok:false,error:'Pause before playing'})};};
 await assert.rejects(requestPiTeleop(DEFAULT_ROBOTICS_PROFILE,'/emote/play',{body:{id:'one'}}),/Pause before playing/);
});

test('physical A starts, A again saves; B while recording is Pi discard not save',async()=>{
 connect();message({type:'episode_status',state:'idle'});
 button(right,4,true);tick();for(let i=0;i<20;i++)tick();
 message({type:'episode_status',state:'recording'});
 button(right,4,false);tick();button(right,4,true);tick();
 for(let i=0;i<20;i++)tick();button(right,4,false);tick();
 message({type:'episode_status',state:'idle',episodes_saved:1});message({type:'emote_confirm',name:'Take A'});
 await flush();
 assert.equal(requests.filter(r=>r.url.endsWith('/emote/accept')).length,1);
 message({type:'episode_status',state:'recording'});
 packets.length=0;button(right,5,true);tick();
 const j=joys().filter(j=>j.hand==='right');
 assert.ok(j.some(v=>v.buttons[5]===1),'recording B stays on the joy stream so the Pi discards');
 assert.equal(requests.filter(r=>r.url.endsWith('/emote/discard')).length,0);
});

test('quick B during record-start acknowledgement leaves discard on the joy stream',async()=>{
 connect();message({type:'episode_status',state:'idle'});
 button(right,4,true);tick();button(right,4,false);button(right,5,true);tick();
 message({type:'episode_status',state:'recording'});for(let i=0;i<45;i++)tick();
 const j=joys().filter(j=>j.hand==='right');
 assert.ok(j.some(v=>v.buttons[5]===1));
 assert.equal(requests.filter(r=>r.url.endsWith('/emote/accept')).length,0);
});

test('idle B and unsolicited saved-take messages never accept a take automatically',async()=>{
 connect();message({type:'episode_status',state:'idle'});button(right,5,true);tick();
 message({type:'emote_confirm',name:'Previously pending take'});await flush();
 assert.equal(requests.filter(r=>r.options.method==='POST').length,0);
 assert.equal(events.at(-1).action,'confirm');
 assert.ok(joys().filter(j=>j.hand==='right').some(j=>j.buttons[5]===1));
});

test('a failed emote save keeps the take available for an explicit retry',async()=>{
 connect();message({type:'episode_status',state:'recording'});teleop.stopDimosRecord();
 for(let i=0;i<20;i++)tick();reply={ok:false,error:'Recorder disk full'};
 message({type:'emote_confirm',name:'Retry me',samples:30});await flush();
 assert.match(teleop.getDimosTeleopState().label,/could not add.*disk full/);
 assert.equal(events.at(-1).action,'confirm');assert.equal(events.at(-1).name,'Retry me');
 assert.equal(requests.filter(r=>r.url.endsWith('/emote/discard')).length,0);
});

test('reset and expired stop intent cannot auto-accept a later unrelated take',async()=>{
 connect();message({type:'hello',y_map:'tap_pause_hold3_kill',json_control:true});
 message({type:'episode_status',state:'recording'});teleop.stopDimosRecord();
 for(let i=0;i<20;i++)tick();message({type:'episode_status',state:'idle'});tick(16000);
 message({type:'emote_confirm',name:'Late confirmation'});await flush();
 assert.equal(requests.filter(r=>r.url.endsWith('/emote/accept')).length,0);
 message({type:'episode_status',state:'recording'});teleop.stopDimosRecord();
 button(left,5,true);tick();tick(3000);message({type:'emote_confirm',name:'After reset'});await flush();
 assert.equal(requests.filter(r=>r.url.endsWith('/emote/accept')).length,0);
});

test('trigger pinches on each hand away from menus and releases menu capture despite sensor noise',()=>{
 connect();message({type:'hello',armed:true,y_map:'tap_pause_hold3_kill'});
 button(left,0,true);button(right,0,true);
 teleop.setDimosStudioUiOverride({left:true,right:false,nearMenuRight:true});tick();
 let j=joys().slice(-2);assert.equal(j.find(j=>j.hand==='left').axes[2],0);
 assert.equal(j.find(j=>j.hand==='right').axes[2],1,'near a menu is not pointing at it');
 teleop.setDimosStudioUiOverride({});tick();
 assert.equal(joys().slice(-2).find(j=>j.hand==='left').axes[2],0,'finish the original menu press first');
 left.gamepad.buttons[0]={pressed:false,value:.18};tick();
 left.gamepad.buttons[0]={pressed:true,value:.75};tick();
 j=joys().slice(-2);assert.equal(j.find(j=>j.hand==='left').axes[2],.75);assert.equal(j.find(j=>j.hand==='left').buttons[0],1);
 assert.equal(j.find(j=>j.hand==='right').axes[2],1);
});

test('gripper buttons close only the selected hand, window grip is reserved, and reset blocks UI closes',()=>{
 connect();message({type:'hello',armed:true,y_map:'tap_pause_hold3_kill',json_control:true});
 teleop.setDimosStudioUiOverride({left:true,right:true});
 button(left,1,true);button(right,1,true);tick();
 assert.ok(joys().slice(-2).every(j=>j.axes[2]===0&&j.axes[3]===0));
 button(left,1,false);button(right,1,false);
 assert.equal(teleop.requestDimosGripperClose('left'),'gripper_close');tick();
 let latest=joys().slice(-2);
 assert.equal(latest.find(j=>j.hand==='left').axes[2],1);
 assert.equal(latest.find(j=>j.hand==='right').axes[2],0);
 tick(500);assert.ok(joys().slice(-2).every(j=>j.axes[2]===0));
 teleop.requestDimosSafeHome();
 assert.equal(teleop.requestDimosGripperClose('right'),false);
});

test('HUD gripper click closes on the live Joy stream; a DimOS overlay flag does not eat the other trigger',()=>{
 connect();message({type:'hello',armed:true,y_map:'tap_pause_hold3_kill',json_control:true});
 assert.equal(teleop.requestDimosGripperClose('right'),'gripper_close');
 tick();
 const closed=joys().filter(j=>j.hand==='right').at(-1);
 assert.equal(closed.axes[2],1);assert.equal(closed.buttons[0],1);
 teleop.setDimosStudioUiOverride({uiHit:true,nearMenu:true});
 button(left,0,true);tick();
 assert.equal(joys().filter(j=>j.hand==='left').at(-1).axes[2],1,'global overlay is not this hand on a button');
});

test('squeeze off a window closes the gripper; trigger analog stays on Joy axis 2',()=>{
 connect();message({type:'hello',armed:true,y_map:'tap_pause_hold3_kill',json_control:true});
 button(left,1,true);tick();
 assert.equal(joys().filter(j=>j.hand==='left').at(-1).axes[2],1);
 button(left,1,false);button(left,0,true);tick();
 assert.equal(joys().filter(j=>j.hand==='left').at(-1).axes[2],1);
});

test('hold Y kills on the pose JSON socket before hello',async()=>{
 connect();
 button(left,5,true);tick();tick(3000);await flush();
 assert.deepEqual(packets.filter(p=>typeof p==='string').map(JSON.parse),[{type:'y',action:'session_reset'}]);
});

test('Home and a 2s Y hold both send session_reset; a dropped left pad does not swallow the hold',async()=>{
 connect();message({type:'hello',armed:true,mock:false,y_map:'tap_pause_hold3_kill',json_control:true});
 assert.equal(teleop.requestDimosSafeHome(),'session_reset');
 await flush();
 assert.deepEqual(packets.filter(p=>typeof p==='string').map(JSON.parse),[{type:'y',action:'session_reset'}]);
 message({type:'teleop_status',armed:false,holding:false,pending_arm:false});
 packets.length=0;
 button(left,5,true);tick();
 session.inputSources=[right];
 tick(500);tick(500);
 assert.equal(packets.filter(p=>typeof p==='string').length,0,'missing pad must not tap or reset early');
 session.inputSources=[right,left];
 tick(2200);
 assert.deepEqual(packets.filter(p=>typeof p==='string').map(JSON.parse),[{type:'y',action:'session_reset'}]);
});
