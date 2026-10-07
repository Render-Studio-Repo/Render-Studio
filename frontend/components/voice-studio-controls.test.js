import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStudioCommandRouter,agentVoiceControls,studioVoiceTools} from './voice-studio-controls.js';
import {runVoiceCaptureAction} from './voice-studio-capture.js';
import {createXrAgentStore} from '../xr/xr-agent-state.js';

test('commands validate scope, serialize setters and are idempotent',async()=>{
 const session={},scope={user:'u',project:'p',session};let value=false,writes=0;
 const route=createStudioCommandRouter({getScope:()=>scope,getControls:()=>[{id:'pass',type:'boolean',read:()=>value,write:async v=>{await new Promise(r=>setTimeout(r,5));writes++;value=v;}}],getActions:()=>[]});
 const results=await Promise.all([route('set_studio_setting',{id:'pass',value:true}),route('set_studio_setting',{id:'pass',value:true})]);
 assert.ok(results.every(r=>r.ok));assert.equal(writes,1);
 assert.equal((await route('set_studio_setting',{id:'pass',value:'true'})).ok,false);
 scope.session=null;assert.equal((await route('get_studio_controls')).ok,false);
});
test('queued commands cannot cross project or session changes; failed writes do not claim success',async()=>{
 let scope={user:'u',project:'p',session:{}},release;
 const route=createStudioCommandRouter({getScope:()=>scope,getControls:()=>[{id:'pass',type:'boolean',read:()=>false,write:()=>new Promise(r=>release=r)}],getActions:()=>[]});
 const first=route('set_studio_setting',{id:'pass',value:true});await Promise.resolve();
 const second=route('set_studio_setting',{id:'pass',value:true});scope={...scope,project:'other'};release();
 assert.equal((await first).ok,false);assert.equal((await second).ok,false);
});
test('room visibility, audio and guest permissions are independently saved',()=>{
 const backend={data:{},getItem(k){return Object.prototype.hasOwnProperty.call(this.data,k)?this.data[k]:null;},setItem(k,v){this.data[k]=String(v);}};
 const store=createXrAgentStore({storage:backend}),rows=agentVoiceControls(store);
 rows.find(r=>r.id==='astra.showToRoom').write(true);
 assert.equal(store.getState().settings.showToRoom,true);
 assert.equal(store.getState().settings.shareWithRoom,false);
 assert.equal(store.getState().settings.allowOtherUsersTrigger,false);
 assert.equal(JSON.parse(backend.data['render3d:xr-agent:v1']).settings.showToRoom,true);
 const actions=studioVoiceTools()[2].parameters.properties.id.enum;
 assert.ok(actions.includes('reset_scene'));
 assert.ok(actions.includes('voice_examples'));
 assert.equal(actions.includes('swap_voice'),false);
});
test('screenshot uses POV capture, original project and PC popup confirmation',async()=>{
 const calls=[];const blob=new Blob(['png']);
 const out=await runVoiceCaptureAction('screenshot_to_pc',{viewport:{isPresenting:()=>true,paintRecordOverlayCanvas:()=>({toBlob:cb=>cb(blob)}),disposeRecordSpectator:()=>{},isPassthroughOn:()=>true},recorder:{isRecording:()=>false},projectId:'p',token:'test',clientId:'xr',isCurrent:()=>true,upload:async(b,opts)=>{assert.equal(b,blob);assert.equal(opts.projectId,'p');return {filename:'shot.png',url:'/shot'};},api:async(path,opts)=>{calls.push([path,JSON.parse(opts.body)]);return {capture:{id:'saved'}};}});
 assert.equal(out.ok,true);assert.equal(out.pcQueued,true);assert.match(out.captureNote,/not included/);assert.equal(calls[0][0],'/api/projects/p/xr-capture-ready');assert.equal(calls[0][1].share_x,false);
});
test('recording reports actual start failure and pause is idempotent',async()=>{
 let paused=false,count=0;const opts={viewport:{isPresenting:()=>true},recorder:{startRecording:async()=>{},isRecording:()=>false,isPaused:()=>paused,togglePause:()=>{count++;paused=!paused;}},projectId:'p',token:'t',isCurrent:()=>true};
 assert.equal((await runVoiceCaptureAction('start_recording',opts)).ok,false);opts.recorder.isRecording=()=>true;
 await runVoiceCaptureAction('pause_recording',opts);await runVoiceCaptureAction('pause_recording',opts);assert.equal(count,1);
});
