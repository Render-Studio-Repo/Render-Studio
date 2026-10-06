import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfileYControl, preferredRoboticsSources, profileYMap, Y_HOLD_MS, HOLD_MS } from './xr-robotics-profile-controls.js';
import { createXrUiPressLatch } from './xr-ui-press-latch.js';

test('Y tap is release-before-2s; hold is session_reset; never both', () => {
  const y = createProfileYControl(), status = {y_map:'tap_pause_hold3_kill'};
  assert.equal(HOLD_MS, 2000);
  assert.equal(Y_HOLD_MS, 2000);
  assert.equal(y.sample(true,0,status),null);
  assert.equal(y.holdProgress(1500),0.75);
  assert.equal(y.sample(false,100,status),'tap');
  assert.equal(y.holdProgress(200),0);
  assert.equal(y.sample(false,110,status),null);
  assert.equal(y.sample(true,200,{...status,armed:true}),null);
  assert.equal(y.sample(false,400,{...status,armed:true}),'tap');
  assert.equal(y.sample(true,500,status),null);
  assert.equal(y.sample(true,2499,status),null);
  assert.equal(y.sample(true,2500,status),'session_reset');
  assert.equal(y.holdProgress(2500),1);
  assert.equal(y.sample(true,4000,status),null);
  assert.equal(y.sample(false,4010,status),null);
});
test('release after 1s is still tap (not only a 350ms click)', () => {
  const y = createProfileYControl(), status = {y_map:'tap_pause_hold3_kill'};
  assert.equal(y.sample(true,0,status),null);
  assert.equal(y.sample(false,1200,status),'tap');
});
test('saved profile y_map can session_reset before live hello arrives', () => {
  const y = createProfileYControl(), status = {profile_y_map:'tap_pause_hold3_kill'};
  y.sample(true,0,status);
  assert.equal(y.sample(true,3000,status),'session_reset');
});
test('OpenArm nested y_map is enough before hello', () => {
  const y = createProfileYControl();
  const status = {profile_y_map: profileYMap({controllers:{buttons:{y_map:'tap_pause_hold3_kill'}}})};
  y.sample(true,0,status);
  assert.equal(y.sample(true,3000,status),'session_reset');
});
test('a 2s hold is never a tap on release', () => {
  const y = createProfileYControl(), status = {y_map:'tap_pause_hold3_kill'};
  assert.equal(y.sample(true,0,status),null);
  assert.equal(y.sample(true,3000,status),'session_reset');
  assert.equal(y.sample(false,3010,status),null);
});
test('unknown firmware cannot reset and disconnect drops unfinished holds', () => {
  const y=createProfileYControl();
  y.sample(true,0); assert.equal(y.sample(true,3000),'reset_unavailable');
  y.clear(); assert.equal(y.sample(false,3100),null);
  y.sample(true,4000); assert.equal(y.sample(false,4500),'tap');
});
test('holding Y while already paused never resumes before resetting',()=>{
  const y=createProfileYControl(),status={armed:true,holding:true,y_map:'tap_pause_hold3_kill'};
  assert.equal(y.sample(true,0,status),null);
  assert.equal(y.sample(true,3000,status),'session_reset');
  assert.equal(y.sample(false,3010,status),null);
});
test('actual handedness survives reordered and duplicate hand/controller sources', () => {
  const right={handedness:'right',gamepad:{}}, left={handedness:'left',gamepad:{}};
  assert.deepEqual(preferredRoboticsSources([{handedness:'left',hand:{}},right,left,{handedness:'none'}]),[left,right]);
});
test('studio UI press latch never owns Y; 2s hold is still session_reset', () => {
  const y = createProfileYControl(), status = {y_map:'tap_pause_hold3_kill'};
  const latch = createXrUiPressLatch();
  latch.commit(0);
  assert.equal(latch.held(0), true);
  assert.equal(y.sample(true,0,status),null);
  assert.equal(y.sample(true,3000,status),'session_reset');
  assert.equal(y.sample(false,3010,status),null);
});
