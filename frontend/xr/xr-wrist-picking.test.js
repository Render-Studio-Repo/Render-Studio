import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from '../../backend/skills/img2threejs/scripts/vendor/three/build/three.module.js';
import { createXrWristPicker } from "./xr-wrist-picking.js";
import { preferUiHoverHit, wristYieldsToWorldMenu } from "./xr-hot-path.js?v=roboticsworkspace3";

test("both sides of rotated wrist pucks work despite disabled overlay raycasts", () => {
  const wrist = new THREE.Group();
  wrist.position.set(.3, 1.2, -.4);
  wrist.quaternion.setFromEuler(new THREE.Euler(.7, -.3, .4));
  const puck = new THREE.Mesh(new THREE.CircleGeometry(.016, 16));
  puck.userData.xrTool = "view";
  puck.userData.xrRaycast = false;
  puck.raycast = () => {};
  wrist.add(puck); wrist.updateMatrixWorld(true);
  const center = puck.getWorldPosition(new THREE.Vector3());
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(puck.getWorldQuaternion(new THREE.Quaternion()));
  const pick = createXrWristPicker(THREE);
  for (const side of [-1, 1]) {
    const ray = new THREE.Raycaster(center.clone().addScaledVector(normal, side * .4), normal.clone().multiplyScalar(-side));
    const hit = pick(ray, [puck]);
    assert.equal(hit.tool, "view");
    assert.ok(Math.abs(hit.distance - .4) < 1e-6);
  }
});
test("empty plate areas and hidden-parent buttons cannot produce ghost clicks", () => {
  const parent = new THREE.Group();
  const puck = new THREE.Mesh(new THREE.CircleGeometry(.02, 16));
  puck.userData.xrTool = "menu";
  parent.add(puck);
  const pick = createXrWristPicker(THREE);
  assert.equal(pick(new THREE.Raycaster(new THREE.Vector3(.03, 0, .4), new THREE.Vector3(0, 0, -1)), [puck]), null);
  parent.visible = false;
  assert.equal(pick(new THREE.Raycaster(new THREE.Vector3(0, 0, .4), new THREE.Vector3(0, 0, -1)), [puck]), null);
});
test("nearest actual UI wins with wrist and window on the same ray", () => {
  const wrist = { kind: "tool", tool: "view", source: "wrist", distance: .4 };
  const behind = { kind: "menu-tab", distance: .8 };
  const front = { kind: "menu-tab", distance: .2 };
  assert.equal(preferUiHoverHit(wrist, behind), wrist);
  assert.equal(preferUiHoverHit(wrist, front), front);
  assert.equal(wristYieldsToWorldMenu({ wristHit: wrist, worldHit: behind, nearMenu: true }), false);
  assert.equal(wristYieldsToWorldMenu({ wristHit: wrist, worldHit: front }), true);
});
