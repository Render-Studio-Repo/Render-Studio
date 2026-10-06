import {test} from 'node:test';import assert from 'node:assert/strict';
import {createPiUiInput,piServerUiAction} from './xr-pi-ui-input.js?v=20260929-ab-recorder2';
const pad=(buttons={},axes=[0,0,.4,.8])=>({buttons:Array.from({length:7},(_,i)=>buttons[i]||0),axes:[...axes]});
test('X opens emotes once, leaving Y available and grip reserved for Studio',()=>{
 const events=[],ui=createPiUiInput(e=>events.push(e));const m=pad({4:1,5:1,1:1});ui.sample('left',m,0);
 assert.deepEqual(events,[{action:'emote_picker'}]);assert.equal(m.buttons[4],0);assert.equal(m.buttons[5],1);assert.equal(m.buttons[1],0);assert.equal(m.axes[3],0);assert.equal(m.axes[2],.4);
 ui.sample('left',pad({4:1,5:1}),1000);assert.equal(events.length,1);assert.equal(ui.holdProgress(1500),.5);ui.clear();assert.equal(ui.holdProgress(2000),0);
});
test('A starts then saves, and B never falls through to Robotics menus',()=>{
 const events=[],ui=createPiUiInput(e=>events.push(e));let m=pad({4:1});ui.sample('right',m,10);assert.equal(m.buttons[4],0);assert.equal(events[0].action,'record_start');
 ui.sample('right',pad(),20);ui.setState({recording:true});m=pad({4:1});ui.sample('right',m,25);assert.equal(events[1].action,'record_stop');
 ui.clear();ui.setState({confirmOpen:true});m=pad({5:1});ui.sample('right',m,30);assert.equal(m.buttons[5],0);assert.equal(events.length,2);
 ui.clear();ui.setState({emoteOpen:true});m=pad({4:1});ui.sample('right',m,40);assert.equal(m.buttons[4],0);assert.equal(events[2].action,'record_start');
});

test('A owns recording and B emits one discard action without raw fallthrough',()=>{
 const events=[],ui=createPiUiInput(e=>events.push(e));
 let m=pad({4:1});ui.sample('right',m,10);assert.equal(events[0].action,'record_start');assert.equal(m.buttons[4],0);
 ui.sample('right',pad(),20);ui.setState({recording:true});m=pad({4:1});ui.sample('right',m,30);assert.equal(events[1].action,'record_stop');
 m=pad({5:1});ui.sample('right',m,40);assert.equal(m.buttons[5],0);assert.equal(events[2].action,'record_discard');
 assert.equal(events.some(e=>['start','pause'].includes(e.action)),false);
});

test("Pi emote_confirm opens the saved-take decision UI",()=>{assert.equal(piServerUiAction({type:"emote_confirm",name:"Take 3",samples:24}).action,"confirm");assert.equal(piServerUiAction({type:"episode_status"}),null);});

test('closing a menu while A is held does not start a second take',()=>{
 const events=[],ui=createPiUiInput(e=>events.push(e));ui.setState({confirmOpen:true});ui.sample('right',pad({4:1}),0);
 ui.setState({confirmOpen:false});let m=pad({4:1});ui.sample('right',m,20);assert.equal(m.buttons[4],0);
 ui.sample('right',pad(),40);m=pad({4:1});ui.sample('right',m,60);assert.equal(m.buttons[4],0);assert.deepEqual(events.map(e=>e.action),['record_start','record_start']);
});
test('idle B is swallowed and recording B becomes an explicit discard',()=>{
 const events=[],ui=createPiUiInput(e=>events.push(e));
 let m=pad({5:1});ui.sample('right',m,0);assert.equal(m.buttons[5],0);assert.equal(events.length,0);
 ui.sample('right',pad(),5);ui.setState({recording:true});m=pad({5:1});ui.sample('right',m,10);assert.equal(m.buttons[5],0);assert.equal(events[0].action,'record_discard');
 ui.sample('left',pad({5:1}),100);ui.retainHands(new Set(['right']));assert.equal(ui.holdProgress(2000),0);
});
