import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWristHistoryFlick, createStickHistoryFlick} from './xr-history-flick.js';
const settle=(f,t=0,yaw=0)=>{for(let n=0;n<=240;n+=20)assert.equal(f.sample({yaw,now:t+n}),null);};
test('deliberate right-hand left/right flicks undo/redo once',()=>{
 for(const sign of [-1,1]){const f=createWristHistoryFlick();settle(f);
 assert.equal(f.sample({yaw:sign*.14,now:280}),null);
 assert.equal(f.sample({yaw:sign*.37,now:320}),sign<0?'undo':'redo');
 assert.equal(f.sample({yaw:0,now:360}),null,'return stroke does not reverse the action');}
});
test('normal movement and slow turns do not trigger history',()=>{
 const f=createWristHistoryFlick();settle(f);
 for(let n=1;n<=50;n++)assert.equal(f.sample({yaw:n*.01,now:240+n*20}),null);
});
test('grabs, drawing, robotics and tracking gaps reset the gesture',()=>{
 const f=createWristHistoryFlick();settle(f);f.sample({yaw:-.16,now:280});
 assert.equal(f.sample({yaw:-.4,now:310,enabled:false}),null);
 assert.equal(f.sample({yaw:-.5,now:330}),null);
 assert.equal(f.sample({yaw:.6,now:1800}),null);
});
test('right analog stick flick left/right undoes and redoes once',()=>{
 const f=createStickHistoryFlick();
 assert.equal(f.sample({x:0,now:0}),null);
 assert.equal(f.sample({x:-.4,now:40}),null);
 assert.equal(f.sample({x:-.82,now:90}),null);
 assert.equal(f.sample({x:0,now:160}),'undo');
 assert.equal(f.sample({x:.8,now:200}),null,'cooldown after undo');
 const g=createStickHistoryFlick();
 assert.equal(g.sample({x:0,now:0}),null);
 assert.equal(g.sample({x:.45,now:40}),null);
 assert.equal(g.sample({x:.8,now:90}),null);
 assert.equal(g.sample({x:0,now:150}),'redo');
});
test('stick tilt-Y and slow X hold are not history',()=>{
 const f=createStickHistoryFlick();
 assert.equal(f.sample({x:0,now:0}),null);
 for(let n=1;n<=20;n++)assert.equal(f.sample({x:n*.04,now:n*40}),null);
 assert.equal(f.sample({x:0,now:900}),null,'held tilt return is not a flick');
 const y=createStickHistoryFlick();
 assert.equal(y.sample({x:0,now:0}),null);
 assert.equal(y.sample({x:0,now:80}),null,'Y-only tilt never sampled');
});
test('draw/create do not disable stick flick when sample stays enabled',()=>{
 const f=createStickHistoryFlick();
 assert.equal(f.sample({x:0,now:0,enabled:true}),null);
 assert.equal(f.sample({x:-.75,now:50,enabled:true}),null);
 assert.equal(f.sample({x:0,now:140,enabled:true}),'undo');
});
