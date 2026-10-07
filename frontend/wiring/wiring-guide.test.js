import test from 'node:test';
import assert from 'node:assert/strict';
import {createWiringGuide,wiringGuideVoiceActions} from './wiring-guide.js';
test('voice advances the same guided wire and records installation without electrical verification',()=>{
 const wires=[{id:'a',label:'A',from:{pin:'1'},to:{pin:'2'}},{id:'b',label:'B',from:{pin:'3'},to:{pin:'4'}}];let selected;
 const guide=createWiringGuide({getProjectId:()=> 'p',getContext:()=>({wires}),storage:null,selectWire:id=>selected=id});
 const actions=wiringGuideVoiceActions(()=>({guide,requestedMode:'immersive-ar'}));const run=id=>actions.find(a=>a.id===id).run();
 assert.equal(run('wiring_start').wire.id,'a');assert.equal(run('wiring_next').wire.id,'b');assert.equal(selected,'b');
 const done=run('wiring_mark_installed');assert.equal(done.installed,true);assert.match(done.verification,/not an electrical test/);
 assert.equal(run('wiring_previous').wire.id,'a');assert.equal(run('wiring_stop').ok,true);assert.equal(guide.state().guided,false);
});
test('voice cannot operate an unloaded wiring overlay',()=>{
 const actions=wiringGuideVoiceActions(()=>null);for(const action of actions)assert.equal(action.run().ok,false);
});
