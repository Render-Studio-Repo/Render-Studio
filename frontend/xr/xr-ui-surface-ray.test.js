import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createUiSurfaceRayPicker} from './xr-ui-surface-ray.js';
const require=createRequire(import.meta.url);
const THREE=require('../../backend/skills/img2threejs/scripts/vendor/three/build/three.cjs');
test('rotated HUD bounding-box corners cannot steal a gripper trigger',()=>{
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial());
  panel.rotation.z=Math.PI/4;panel.position.z=-1;panel.updateMatrixWorld(true);
  const origin=new THREE.Vector3(.65,.65,0),direction=new THREE.Vector3(0,0,-1);
  assert.ok(new THREE.Ray(origin,direction).intersectBox(new THREE.Box3().setFromObject(panel),new THREE.Vector3()));
  const pick=createUiSurfaceRayPicker(THREE);
  assert.equal(pick(panel,origin,direction),null);
  assert.ok(pick(panel,new THREE.Vector3(.15,.15,0),direction));
  const root=new THREE.Group();root.add(panel);root.visible=false;
  assert.equal(pick(panel,new THREE.Vector3(),direction),null);
});
