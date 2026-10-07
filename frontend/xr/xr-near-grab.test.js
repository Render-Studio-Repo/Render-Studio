import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createXrNearGrabPicker } from './xr-near-grab.js';
import { isStudioModelGrabMesh, studioAimHitsModel, isXrPanelGripHandleKind, isXrSqueezeOverlayKind, resolveSelectAim } from './xr-hot-path.js';
const require = createRequire(import.meta.url);
const THREE = require('../../backend/skills/img2threejs/scripts/vendor/three/build/three.cjs');
const pick = createXrNearGrabPicker(THREE);
const v = (x, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const box = () => new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .2), new THREE.MeshBasicMaterial());

test('trigger laser moves only when the ray hits the model mesh', () => {
  const model = box();
  model.geometry.computeBoundingBox();
  const scene = new THREE.Scene();
  scene.add(model);
  scene.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.ray.origin.set(0, 0, 1);
  raycaster.ray.direction.set(0, 0, -1);
  assert.equal(isStudioModelGrabMesh(model), true);
  assert.equal(studioAimHitsModel(raycaster, model)?.object, model);
  raycaster.ray.origin.set(2, 2, 2);
  raycaster.ray.direction.set(1, 0, 0);
  assert.equal(studioAimHitsModel(raycaster, model), null);
  const axes = new THREE.AxesHelper(0.14);
  axes.userData.viserHelper = true;
  assert.equal(isStudioModelGrabMesh(axes), false);
});

test('grip reaches a surface only within 6cm, never a distant ray target', () => {
  const model = box();
  assert.equal(pick(v(.14), [model]).target, model);
  assert.equal(pick(v(.3), [model]), null);
  assert.equal(pick(v(2), [model]), null);
});
test('empty space inside an assembly bounding box is not a grab', () => {
  const assembly = new THREE.Group();
  const a = box(), b = box();
  a.position.x = -1; b.position.x = 1; assembly.add(a, b);
  assert.equal(pick(v(0), [assembly]), null);
  assert.equal(pick(v(.88), [assembly]).object, b);
});
test('window contact works at front, back, and edge without pointing at it', () => {
  const window = new THREE.Group();
  window.add(new THREE.Mesh(new THREE.PlaneGeometry(.8, .5), new THREE.MeshBasicMaterial()));
  for (const point of [v(0, 0, .03), v(0, 0, -.03), v(.42)]) {
    assert.equal(pick(point, [window]).target, window);
  }
});
test('hidden windows, hidden parent trees, and proxies cannot capture a grip', () => {
  const root = new THREE.Group(), model = box(); root.add(model);
  root.visible = false; assert.equal(pick(v(.1), [model]), null);
  root.visible = true; model.userData.xrCadProxy = true;
  assert.equal(pick(v(.1), [root]), null);
});
test('contact respects rotation, scale, instances and closest physical surface', () => {
  const a = box(), b = box(); b.position.x = .04;
  assert.equal(pick(v(.145), [a, b]).target, b);
  const group = new THREE.Group(); group.rotation.z = Math.PI / 4; group.scale.set(2, 1, 1);
  group.add(a); group.updateMatrixWorld(true);
  const contact = v(.1, 0, 0).applyMatrix4(a.matrixWorld);
  assert.equal(pick(contact, [group]).target, group);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(.2,.2,.2), new THREE.MeshBasicMaterial(), 1);
  inst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(2,0,0));
  assert.equal(pick(v(2.12), [inst]).target, inst);
  assert.equal(pick(v(.1), [inst]), null);
});

const source = readFileSync(new URL('./viewport-xr.js', import.meta.url), 'utf8');
function realFunction(name, next, deps) {
  deps = {
    agentAvatar:{beginGrip:()=>false,endGrip:()=>false},
    roomCameraView:{beginGrip:()=>false},
    roboticsWorkspace:{beginGrip:()=>false},
    aiDrawWorkspace:{beginGrip:()=>false},
    xrWiringView:{isActive:()=>false},
    grabAttachObject:()=>null,
    posedControllerForHand:()=>null,
    objectIsPosed:()=>false,
    worldPosOf:()=>null,
    viserRobotGripBlocked:()=>false,
    roomWalkHeld:false,
    lastPointerHoverHit:null,
    pickGrabMesh:()=>null,
    pickTriggerMoveMesh:()=>null,
    pickNearGrabMesh:()=>null,
    pickWithController:()=>null,
    cadHoverGrabMesh:()=>null,
    noteGrabDebug() {},
    studioGripAim:(controller)=>controller,
    panelDrag: null,
    scaleGrab: null,
    grabState: null,
    resolveSelectAim,
    isXrSqueezeOverlayKind,
    panelGroupFromHit:()=>null,
    tabbedWindows:null,
    viserOpenArmGripAllowed:()=>true,
    isXrPanelGripHandleKind,
    ...deps,
  };
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf(`  function ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return new Function(...Object.keys(deps), `${source.slice(start,end)};return ${name};`)(...Object.values(deps));
}
test('one squeeze gets one acquisition; a held miss retries CAD without requiring trigger', () => {
  const active = [false,false], calls = [];
  const start = realFunction('startStudioGrip', 'finishStudioGrip', {
    squeezeHandIndex: c => c.hand, gripPressActive: active, gripScaleContact: [null,null],
    gripGrab: null, panelDrag: null, scaleGrab: null, grabState: null,
    tryBeginPanelGrip: () => { calls.push('panel'); return false; },
    isDimosStealingGrip: () => false, pickWithController: () => null, uiPickBlocksGripGrab: () => false,
    startGripGrabOn: () => calls.push('model'),
  });
  start({hand:1}); start({hand:1}); assert.deepEqual(calls,['panel','model','model']);
  active[1] = false; start({hand:1}); assert.equal(calls.length,5);
});
test('second held grip only arms scale on physical contact at press time', () => {
  const model = box(), contact = [null,null], active = [false,false]; let near = null;
  const start = realFunction('startStudioGrip', 'finishStudioGrip', {
    squeezeHandIndex: c => c.hand, gripPressActive: active, gripScaleContact: contact,
    gripGrab: { hand:0, target:model }, grabAttachObject: () => ({}), objectIsPosed: () => true,
    worldPosOf: () => v(.1), pickNearSurface: () => near, pickTriggerMoveMesh: () => null,
  });
  start({hand:1}); assert.equal(contact[1],null);
  near = {target:model}; start({hand:1}); assert.equal(contact[1],null);
  active[1] = false; start({hand:1}); assert.equal(contact[1],model);
});

for (const hoverSource of ['same-hand ray', 'other-hand hover']) {
  test(`real window grip ignores a distant ${hoverSource} without physical contact`, () => {
    const controller = { hand: 1 }, window = { visible: true }, drags = [];
    const hit = { kind: 'studio-chrome', distance: 2, group: window };
    const begin = realFunction('tryBeginPanelGrip', 'startStudioGrip', {
      panelDrag: null, gripGrab: null, grabState: null, scaleGrab: null,
      squeezeHandIndex: node => node.hand,
      posedControllerForHand: () => controller,
      pickWithController: () => hoverSource === 'same-hand ray' ? hit : null,
      lastPointerHoverHit: hoverSource === 'other-hand hover' ? hit : null,
      remapHudChromeHit: value => value,
      panelGroupFromHit: value => value?.group || null,
      grabAttachObject: () => controller,
      nearGripPanel: () => null,
      panelGripTranslateOnly: () => false,
      tabbedWindows: { root: {} },
      beginPanelDrag: (...args) => drags.push(args),
    });
    begin(controller);
    assert.equal(drags.length, 0, 'grip must not start a window drag when the hand touches no window');
  });
}

test('HUD overlay in front of CAD does not steal a grip-only model grab', () => {
  const controller = { hand: 1 }, window = { visible: true }, drags = [];
  const model = box();
  const begin = realFunction('tryBeginPanelGrip', 'startStudioGrip', {
    panelDrag: null, gripGrab: null, grabState: null, scaleGrab: null,
    squeezeHandIndex: node => node.hand,
    posedControllerForHand: () => controller,
    pickWithController: () => ({ kind: 'howto-drag', fromAabb: true, distance: 0.4, group: window }),
    panelGroupFromHit: value => value?.group || null,
    grabAttachObject: () => controller,
    pickNearGrabMesh: () => null,
    pickTriggerMoveMesh: () => model,
    nearGripPanel: () => window,
    panelGripTranslateOnly: () => false,
    tabbedWindows: { root: {} },
    beginPanelDrag: (...args) => drags.push(args),
  });
  assert.equal(begin(controller), false);
  assert.equal(drags.length, 0, 'full-panel overlay / AABB must not eat squeeze');
});

test('grip on a title-bar handle starts window move/rotate without touching the panel', () => {
  const controller = { hand: 1 }, window = { visible: true }, drags = [];
  const begin = realFunction('tryBeginPanelGrip', 'startStudioGrip', {
    panelDrag: null, gripGrab: null, grabState: null, scaleGrab: null,
    squeezeHandIndex: node => node.hand,
    posedControllerForHand: () => controller,
    pickWithController: () => ({ kind: 'explorer-drag', distance: 0.7, group: window }),
    panelGroupFromHit: value => value?.group || null,
    grabAttachObject: () => controller,
    nearGripPanel: () => null,
    panelGripTranslateOnly: () => false,
    tabbedWindows: { root: {} },
    beginPanelDrag: (...args) => drags.push(args),
  });
  begin(controller);
  assert.equal(drags.length, 1);
  assert.equal(drags[0][2].input, 'grip');
  assert.equal(drags[0][2].translateOnly, false);
});

test('real model grip ignores a far ray hit when there is no near surface', () => {
  const controller = new THREE.Group(), model = box(), anchor = new THREE.Group();
  controller.position.set(.3, 1.2, -.2);
  model.position.set(2, 1.2, -2);
  controller.updateMatrixWorld(true); model.updateMatrixWorld(true);
  const acquisitions = [];
  const begin = realFunction('startGripGrabOn', 'releaseGripGrab', {
    blurXrDom() {},
    scaleGrab: null, gripGrab: null, grabState: null, panelDrag: null,
    squeezeHandIndex: () => 1, grabAttachObject: () => controller,
    objectIsPosed: () => true,
    pickGrabMesh: () => model,
    pickNearGrabMesh: () => null,
    pickTriggerMoveMesh: () => null,
    getLiveMesh: () => model,
    resolveStudioGripTarget: ({ hitMesh }) => hitMesh || null,
    copyWorldPose: () => acquisitions.push(model),
    gripGrabAnchor: anchor,
    _grabInv: new THREE.Matrix4(), _grabWorld: new THREE.Matrix4(),
    _v: new THREE.Vector3(), _q: new THREE.Quaternion(), _s: new THREE.Vector3(),
    publicDrops: { setLocalGrabId() {} }, tossSamples: [], sampleTossPoint() {},
    presentationScale: 1,
  });
  begin(controller);
  assert.equal(acquisitions.length, 0, 'laser intersection alone must not acquire a grip target');
});

test('real grip press still checks touched models when its ray points at distant UI', () => {
  const attempts = [];
  const start = realFunction('startStudioGrip', 'finishStudioGrip', {
    squeezeHandIndex: node => node.hand,
    gripPressActive: [false, false], gripScaleContact: [null, null],
    gripGrab: null, panelDrag: null,
    tryBeginPanelGrip: () => false,
    isDimosStealingGrip: () => false,
    pickWithController: () => ({ kind: 'studio-chrome', distance: 2 }),
    uiPickBlocksGripGrab: () => true,
    startGripGrabOn: () => attempts.push('physical-contact-check'),
  });
  start({ hand: 1 });
  assert.deepEqual(attempts, ['physical-contact-check'], 'unrelated distant UI cannot block physical model acquisition');
});
