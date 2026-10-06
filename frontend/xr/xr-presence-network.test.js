import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {poseSignature,poseMoved,shouldSendXrPose,XR_POSE_MIN_MS} from './xr-hot-path.js';

test('head and controller rotation changes are networked without translation',()=>{
 const pose={head:{p:[0,1.6,0],q:[0,0,0,1]},left:{p:[-.2,1.1,-.3],q:[0,0,0,1]}};
 const first=poseSignature(pose);
 pose.head.q=[0,.707,0,.707];assert.ok(poseMoved(first,poseSignature(pose)));
 const second=poseSignature(pose);
 pose.left.q=[.707,0,0,.707];assert.ok(poseMoved(second,poseSignature(pose)));
});

test('actual viewport sender refreshes stationary poses at one second and throttles intermediate frames',()=>{
 const source=readFileSync(new URL('./viewport-xr.js',import.meta.url),'utf8');
 const start=source.indexOf('  function sendLocalXrPose('),end=source.indexOf('\n  function ',start+1);
 let now=100;const sent=[];
 const c={presenting:true,workspaceJoin:false,performance:{now:()=>now},lastPoseSendAt:0,lastPoseBroadcastAt:0,lastPoseSig:'',
  shouldSendXrPose,XR_POSE_MIN_MS,poseSignature,poseMoved,round3:n=>Math.round(n*1000)/1000,
  getHeadPose(){},getLeftGrip:()=>null,getRightGrip:()=>null,grips:[],controllers:[],packWorldPose:()=>null,
  gripGrab:null,scaleGrab:null,grabState:null,squeezeHeld:[false,false],shouldIncludeHeldPose:()=>false,
  getAiGenerationProgress:()=>null,getAiPromptState:()=>null,xrEnterWorkSettled:()=>false,
  _headPos:{x:0,y:1.6,z:0},_headQuat:{x:0,y:0,z:0,w:1},voiceWanted:false,
  localXrDevice:'Quest',localXrMode:'vr',localXrProp:'',localAvatarSpec:{},compactAvatarForPose:()=>({}),
  poseForceSend:false,sendCollab:()=>{},sendPublicXrPose:pose=>sent.push(pose)};
 vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 c.sendLocalXrPose();assert.equal(sent.length,1);
 for(now=200;now<1100;now+=100)c.sendLocalXrPose();assert.equal(sent.length,1);
 now=1100;c.sendLocalXrPose();assert.equal(sent.length,2);
 now=1200;c._headQuat.y=.707;c._headQuat.w=.707;c.sendLocalXrPose();assert.equal(sent.length,3);
});
