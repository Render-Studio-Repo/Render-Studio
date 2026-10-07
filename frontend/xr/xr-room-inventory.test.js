import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomInventory} from './xr-room-inventory.js';
test('late join inventory contains every loaded model and requests peers once per membership',()=>{
  const sent=[],items=new Map(Array.from({length:11},(_,i)=>['m'+i,{id:'m'+i,glbUrl:'/m'+i+'.glb',root:{},spec:{}}]));
  const drops={items,packPose:()=>({p:[0,1,0],q:[0,0,0,1],s:[1,1,1]}),get:id=>items.get(id)};
  const inventory=createRoomInventory({drops,getPeers:()=>[{id:'bob'}],getUserId:()=> 'alice',isJoined:()=>true,send:(...args)=>sent.push(args)});
  inventory.tick(1000);inventory.tick(1200);assert.equal(sent.length,1);
  inventory.receive('bob',{kind:'request'});assert.equal(sent.filter(([,s])=>s.kind==='item').length,11);
  inventory.receive('outsider',{kind:'request'});assert.equal(sent.length,12);
});
test('adopted components follow a held parent; remote grabs are never overridden by inventory',()=>{
  let held=true;const sent=[],root={pose:{p:[1,1,1]}},row={id:'m',adopted:true,root,spec:{}};
  const drops={items:new Map([['m',row]]),packPose:r=>r.pose};
  const inventory=createRoomInventory({drops,getPeers:()=>[],getUserId:()=> 'alice',isJoined:()=>true,send:()=>{},sendPose:m=>sent.push(m),isHeld:()=>held});
  inventory.tick(1000);assert.equal(sent[0].grabbing,true);
  row.spec={grabbing:true,grabber_id:'bob'};row.lastGrabAt=Date.now();root.pose={p:[2,1,1]};held=false;
  inventory.tick(1200);assert.equal(sent.length,1);
  row.spec.grabbing=false;inventory.tick(1400);assert.equal(sent.length,1);
});
