import test from "node:test";
import assert from "node:assert/strict";
import {
  XR_ROBOT_PLACEMENT_KEY,
  applyRobotPlacement,
  clearRobotPlacement,
  normalizeRobotPlacement,
  readRobotPlacement,
  saveRobotPlacement,
} from "./xr-robot-placement.js";

function storage() {
  const values = new Map();
  return { values, getItem:key=>values.get(key)||null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key) };
}

function root() {
  return {
    position:{value:[1,2,3],toArray(){return this.value;},fromArray(value){this.value=[...value];}},
    quaternion:{value:[0,0,0,2],toArray(){return this.value;},fromArray(value){this.value=[...value];}},
    scale:{x:0.55,setScalar(value){this.x=value;}}, userData:{}, updateMatrixWorld(){},
  };
}

test("locked robot placement persists a normalized world pose", () => {
  const store=storage(), robot=root(), saved=saveRobotPlacement(robot,store);
  assert.deepEqual(saved,{v:1,locked:true,position:[1,2,3],quaternion:[0,0,0,1],scale:0.55});
  assert.deepEqual(readRobotPlacement(store),saved);
  const restored=root();restored.position.value=[0,0,0];
  assert.equal(applyRobotPlacement(restored,saved),true);
  assert.deepEqual(restored.position.value,[1,2,3]);
  assert.equal(restored.userData.xrPlacementLocked,true);
  clearRobotPlacement(store);
  assert.equal(store.values.has(XR_ROBOT_PLACEMENT_KEY),false);
});

test("invalid or extreme robot placements fail closed", () => {
  assert.equal(normalizeRobotPlacement({v:1,locked:true,position:[0,0,0],quaternion:[0,0,0,0],scale:1}),null);
  assert.equal(normalizeRobotPlacement({v:1,locked:true,position:[0,0,Infinity],quaternion:[0,0,0,1],scale:1}),null);
  assert.equal(normalizeRobotPlacement({v:1,locked:true,position:[0,0,0],quaternion:[0,0,0,1],scale:50}),null);
});
