import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTeleopStop} from './xr-teleop-stop.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('reset blocks motion until confirmed and explicitly resumed',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let sends=0,backups=0;
  const stop=createTeleopStop();
  stop.request({send:()=>{sends++;},fallback:()=>{backups++;}});
  assert.equal(sends,1);assert.equal(stop.blocksMotion(),true);
  assert.equal(stop.resume(),false);
  stop.accept({armed:true});assert.equal(stop.phase(),'pending');
  stop.accept({armed:false,holding:false,pending_arm:false});
  t.mock.timers.tick(1000);await flush();assert.equal(backups,0);
  assert.equal(stop.blocksMotion(),true);assert.equal(stop.resume(),true);
  assert.equal(stop.blocksMotion(),false);
});
test('unacknowledged reset falls back once, surfaces failure and permits a reset retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let backups=0,errors=0;
  const stop=createTeleopStop({onError:()=>errors++});
  stop.request({send:()=>null,fallback:()=>{backups++;throw Error('offline');}});
  await flush();t.mock.timers.tick(750);await flush();
  assert.equal(backups,1);assert.equal(errors,1);assert.equal(stop.phase(),'failed');
  assert.equal(stop.resume(),false);assert.equal(stop.blocksMotion(),true);
  stop.request({send:()=>({armed:false}),fallback:()=>assert.fail('already acknowledged')});
  await flush();assert.equal(stop.phase(),'stopped');stop.clear();
});
test('clearing XR session ignores late HTTP replies and cancels the retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let resolve,updates=0;
  const stop=createTeleopStop({onStatus:()=>updates++});
  stop.request({send:()=>new Promise(r=>resolve=r),fallback:()=>assert.fail('cancelled')});
  stop.clear();resolve({armed:false});await flush();t.mock.timers.tick(1000);
  assert.equal(updates,0);assert.equal(stop.blocksMotion(),false);
});
