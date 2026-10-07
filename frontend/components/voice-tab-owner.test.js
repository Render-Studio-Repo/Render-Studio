import {test} from 'node:test';import assert from 'node:assert/strict';
import {createVoiceTabOwner} from './voice-tab-owner.js';
class Channel {static entries=new Set();constructor(){Channel.entries.add(this);}postMessage(data){for(const c of Channel.entries)if(c!==this)queueMicrotask(()=>c.onmessage?.({data}));}close(){Channel.entries.delete(this);}}
test('VR takes ownership from a PC tab and prevents a background tab taking it back',async()=>{
 let pcLive=false,vrLive=false;
 const pc=createVoiceTabOwner({Channel,getUser:()=> 'sam',isVr:()=>false,isActive:()=>pcLive,stop:()=>{pcLive=false;}});
 const vr=createVoiceTabOwner({Channel,getUser:()=> 'sam',isVr:()=>true,isActive:()=>vrLive,stop:()=>{vrLive=false;}});
 await pc.claim();pcLive=true;await vr.claim();vrLive=true;assert.equal(pcLive,false);
 await assert.rejects(pc.claim(),/another Studio window/);assert.equal(vrLive,true);
 vr.release();vrLive=false;await pc.claim();pc.dispose();vr.dispose();
});
test('different accounts do not stop one another',async()=>{let stopped=0;const one=createVoiceTabOwner({Channel,getUser:()=> 'a',isVr:()=>false,isActive:()=>true,stop:()=>stopped++});const two=createVoiceTabOwner({Channel,getUser:()=> 'b',isVr:()=>true,isActive:()=>false});await two.claim();assert.equal(stopped,0);one.dispose();two.dispose();});
