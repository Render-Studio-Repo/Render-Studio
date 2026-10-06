import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWakeFallback} from './voice-wake-fallback.js';
test('wake fallback skips silence, transcribes speech and never stops the borrowed headset microphone',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval']});
 let signal=0,stops=0,requests=0;const heard=[];
 const stream={getAudioTracks:()=>[{readyState:'live'}],getTracks:()=>[{stop:()=>stops++}]};
 class Audio {createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {getFloatTimeDomainData:a=>a.fill(signal)};}resume(){return Promise.resolve();}close(){return Promise.resolve();}}
 class Recorder {constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['x'.repeat(150)])});this.onstop?.();}}
 const f=createWakeFallback({getStream:()=>stream,Recorder,Audio,transcribe:async()=>{requests++;return 'hey Astra';},onText:text=>heard.push(text)});
 assert.equal(f.start(),true);t.mock.timers.tick(3500);await Promise.resolve();assert.equal(requests,0);
 signal=.08;t.mock.timers.tick(3500);for(let i=0;i<5;i++)await Promise.resolve();
 assert.equal(requests,1);assert.deepEqual(heard,['hey Astra']);f.stop();assert.equal(stops,0);assert.equal(f.running,false);
});
test('wake fallback does not acquire an unapproved microphone',()=>{
 const f=createWakeFallback({getStream:()=>null,transcribe:()=>{throw Error('must not upload');}});
 assert.equal(f.start(),false);f.stop();
});
