import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoboticsTriggerOwnership, studioRoboticsInputAllowed, studioRoboticsUiHit} from './xr-robotics-input.js?v=roboticsworkspace3&teleopfix=20260916-1&inputfix=20260916-1&yarm1=1';

test('menu trigger stays reserved until release, even after the ray leaves the menu',()=>{
 const own=createRoboticsTriggerOwnership();
 assert.equal(own.sample('right',{armed:true,pressed:true,uiHit:true}),true);
 assert.equal(own.sample('right',{armed:true,pressed:true,uiHit:false}),true);
 assert.equal(own.sample('right',{armed:true,pressed:false,uiHit:false}),false);
 assert.equal(own.sample('right',{armed:true,pressed:true,uiHit:false}),false);
});
test('menu ownership never suppresses the other hand',()=>{
 const own=createRoboticsTriggerOwnership();own.reserve('left');
 assert.equal(own.sample('left',{armed:true,pressed:true}),true);
 assert.equal(own.sample('right',{armed:true,pressed:true}),false);
 own.reset(); assert.equal(own.sample('left',{armed:true,pressed:true}),false);
});
test('grips and trigger clicks on menus remain available to Studio while robotics owns controls',()=>{
 for(const control of ['thumbstick','A','B','X','Y','draw','teleport']){
  assert.equal(studioRoboticsInputAllowed({armed:true,control,uiHit:true}),false);
  assert.equal(studioRoboticsInputAllowed({armed:false,control,uiHit:true}),true);
 }
 assert.equal(studioRoboticsInputAllowed({armed:true,control:'grip',uiHit:false}),true);
 assert.equal(studioRoboticsInputAllowed({armed:true,control:'trigger',uiHit:true}),true);
 assert.equal(studioRoboticsInputAllowed({armed:true,control:'trigger',uiHit:false}),false);
});
test('DimOS visor overlay without a button does not steal trigger or grip',()=>{
 assert.equal(studioRoboticsUiHit({kind:'robotics-chrome'}),false);
 assert.equal(studioRoboticsUiHit({kind:'robotics-workspace-action'}),false);
 assert.equal(studioRoboticsUiHit({kind:'robotics-workspace-action',cell:{action:()=>{}}}),true);
 assert.equal(studioRoboticsInputAllowed({armed:true,control:'trigger',uiHit:true,hit:{kind:'robotics-chrome'}}),false);
 assert.equal(studioRoboticsInputAllowed({armed:true,control:'trigger',uiHit:true,hit:{kind:'robotics-workspace-action'}}),false);
 assert.equal(studioRoboticsInputAllowed({armed:true,control:'grip',hit:{kind:'robotics-workspace-action'}}),true);
 assert.equal(studioRoboticsInputAllowed({armed:true,control:'trigger',uiHit:true,hit:{kind:'robotics-action',id:'home'}}),true);
 assert.equal(studioRoboticsInputAllowed({armed:true,control:'trigger',uiHit:false,astraTalk:true}),true);
 assert.equal(studioRoboticsInputAllowed({armed:true,control:'trigger',uiHit:false,astraTalk:true,hit:{kind:'robotics-action',id:'home'}}),true);
 assert.equal(studioRoboticsInputAllowed({armed:true,control:'trigger',uiHit:false,astraTalk:true,hit:{kind:'robotics-chrome'}}),false);
});
