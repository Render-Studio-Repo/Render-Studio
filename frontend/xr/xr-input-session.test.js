import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../../backend/skills/img2threejs/scripts/vendor/three/build/three.module.js';
import { WebXRManager } from '../../backend/skills/img2threejs/scripts/vendor/three/src/renderers/webxr/WebXRManager.js';
import * as policy from './xr-hot-path.js?v=roboticsworkspace3';
import * as binding from './xr-input-binding.js';
import { hydrateXrSessionInputs } from './xr-input-session.js';

const source = readFileSync(new URL('./viewport-xr.js', import.meta.url), 'utf8');
function viewportFunction(name) {
  const start = source.indexOf(`  function ${name}(`), end = source.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}

class Session extends EventTarget {
  visibilityState = 'visible'; enabledFeatures = []; inputSources = []; renderState = {};
  requestReferenceSpace() { return Promise.resolve({}); }
  updateRenderState(state) { Object.assign(this.renderState, state); }
  requestAnimationFrame(callback) { this.nextFrame = callback; return 1; }
  cancelAnimationFrame() {}
  sourceEvent(added, removed = []) {
    const event = new Event('inputsourceschange');
    Object.assign(event, { session: this, added, removed });
    this.dispatchEvent(event);
  }
}

function input(hand) {
  return {
    handedness: hand, profiles: ['meta-quest-touch-plus'], targetRayMode: 'tracked-pointer',
    targetRaySpace: { hand, kind: 'aim' }, gripSpace: { hand, kind: 'grip' },
    gamepad: { mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: [
      { pressed: true, value: 1 }, { pressed: true, value: 1 }, {}, {}, {}, {},
    ] },
  };
}

async function fixture({ early = true } = {}) {
  globalThis.XRWebGLLayer = class {
    constructor() { this.framebufferWidth = 2; this.framebufferHeight = 2; this.framebuffer = {}; }
  };
  const session = new Session(), right = input('right'), left = input('left');
  const renderer = {
    getRenderTarget: () => null, getPixelRatio: () => 1, getSize: out => out.set(2, 2),
    setPixelRatio() {}, setSize() {}, setRenderTarget() {}, outputColorSpace: THREE.SRGBColorSpace,
  };
  renderer.xr = new WebXRManager(renderer, {
    getContextAttributes: () => ({ xrCompatible: true, depth: false, stencil: false, antialias: false }),
  });
  const controllers = [0, 1].map(i => renderer.xr.getController(i));
  const grips = [0, 1].map(i => renderer.xr.getControllerGrip(i));
  const hands = [0, 1].map(i => renderer.xr.getHand(i));
  const native = { connected: 0, select: 0, squeeze: 0 };
  for (let i = 0; i < 2; i++) {
    controllers[i].addEventListener('connected', event => {
      native.connected++;
      controllers[i].userData.inputSource = event.data;
      controllers[i].userData.handedness = event.data.handedness;
      grips[i].userData.inputSource = event.data;
      grips[i].userData.handedness = event.data.handedness;
    });
    controllers[i].addEventListener('selectstart', () => native.select++);
    controllers[i].addEventListener('squeezestart', () => native.squeeze++);
  }
  if (early) { session.inputSources = [right, left]; session.sourceEvent([right, left]); }
  await renderer.xr.setSession(session);
  if (!early) { session.inputSources = [right, left]; session.sourceEvent([right, left]); }

  const group = new THREE.Group();
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(.8, .5), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  group.position.set(0, 1.2, -1); group.add(plane); group.updateMatrixWorld(true);
  const context = vm.createContext({
    ...policy, ...binding, THREE, renderer, controllers, grips, hands, presenting: true,
    pinchAnchors: [{}, {}], squeezeHeld: [false, false], isXrStandardControllerProfile: () => true,
    gamepadActionPressed: () => false, updateHandPinchLatch: () => false,
    pickCache: new Map(), pickFrameGen: 1, _mat: new THREE.Matrix4(), raycaster: new THREE.Raycaster(), lastMenuAimNear: false,
    controllerNearWorldMenu: () => false, xrBusyState: () => ({}), laserPointerActive: () => false, bButtonHeld: false,
    dock: new THREE.Group(), captureDock: new THREE.Group(), statusDock: new THREE.Group(),
    dockButtons: [], captureDockButtons: [], dockPalette: {}, toolHand: null, toolWheel: null,
    mapWristAabbHit: () => null, mapDockIntersection: () => null, roboticsPanel: null,
    explorerPanel: { group, plane }, aiPanel: null, viewPanel: null, workspacePanel: null,
    sharePanel: null, avatarPanel: null, placePanel: null, guidesPanel: null, xrStudio: null,
    GRID_POPUP_SPECS: {}, sceneWindows: {}, debuggerOpen: false, shareInvitePanel: null, sharedVideo: null,
    mapRoboticsHitMeshes: () => null, MENU_PLANE: { w: .8, h: .5 },
    pickMenuFromLocalPoint: () => ({ kind: 'menu-tab', tab: 'projects' }),
    _uiPlaneN: new THREE.Vector3(), _uiPlanePt: new THREE.Vector3(), _uiPlane: new THREE.Plane(), _uiLocal: new THREE.Vector3(),
  });
  for (const name of [
    'sourceHandedness', 'liveHandednessAlong', 'xrIndexOf', 'squeezeHandIndex', 'xrNodeForHand',
    'sessionIndexForHand', 'getLeftGrip', 'getRightGrip', 'getLeftHand', 'getRightHand',
    'bindHandednessFromSession', 'objectIsPosed', 'syncControllerAimFromXrFrame', 'posedControllerForHand',
    'gamepadTrigger', 'gamepadSqueeze', 'sampleXrHands', 'isPhysicalControllerSource', 'isHandTrackedSource',
    'isHandsOnlySource', 'inferHandIndexForSource', 'handIndexForSource', 'getHandJoint',
    'pickWithController', 'geometricPlaneHit',
  ]) vm.runInContext(viewportFunction(name), context);
  const frame = {
    session, getViewerPose: () => null,
    getPose(space) {
      const position = { x: space.hand === 'right' ? 0 : -.3, y: 1.2, z: space.kind === 'grip' ? .05 : 0 };
      return { transform: {
        position, orientation: { x: 0, y: 0, z: 0, w: 1 },
        matrix: new THREE.Matrix4().makeTranslation(position.x, position.y, position.z).toArray(),
      } };
    },
  };
  let result;
  renderer.xr.setAnimationLoop(() => {
    context.pickFrameGen++;
    const sample = context.sampleXrHands(), pointer = context.posedControllerForHand(1);
    result = { sample, pointer, hit: pointer ? context.pickWithController(pointer) : null };
  });
  return {
    session, controllers, native, right, left,
    tick() { session.nextFrame(100, frame); return result; },
    press(type) { const event = new Event(type); Object.assign(event, { inputSource: right, frame }); session.dispatchEvent(event); },
  };
}

test('late connection reproduces raw buttons with dead poses; hydration restores Three raycast and native events', async () => {
  const app = await fixture();
  const before = app.tick();
  assert.equal(before.sample.triggers[1], true);
  assert.equal(before.sample.squeezes[1], true);
  assert.equal(before.pointer, null);
  assert.equal(before.hit, null);
  assert.deepEqual(app.controllers[0].position.toArray(), [0, 0, 0]);
  app.press('selectstart'); app.press('squeezestart');
  assert.deepEqual(app.native, { connected: 0, select: 0, squeeze: 0 });
  const result = hydrateXrSessionInputs({ session: app.session, controllers: app.controllers, now: 1000 });
  assert.deepEqual(result, { attempted: true, missing: 0, recovered: 2 });
  const after = app.tick();
  assert.equal(after.hit.kind, 'menu-tab');
  assert.equal(after.hit.distance, 1);
  assert.deepEqual(app.controllers[0].position.toArray(), [0, 1.2, 0]);
  app.press('selectstart'); app.press('squeezestart');
  assert.deepEqual(app.native, { connected: 2, select: 1, squeeze: 1 });
});

test('normal connection and reordered live arrays do not reconnect or synthesize presses', async () => {
  const app = await fixture({ early: false });
  assert.equal(app.tick().hit.kind, 'menu-tab');
  app.session.inputSources.reverse();
  for (const now of [1000, 1001, 2000]) {
    assert.equal(hydrateXrSessionInputs({ session: app.session, controllers: app.controllers, now, force: true }).attempted, false);
  }
  assert.deepEqual(app.native, { connected: 2, select: 0, squeeze: 0 });
});

test('recovery is reentrant-safe and retries missing connections at a bounded rate', () => {
  const session = new Session(), controllers = [{ userData: {} }];
  session.inputSources = [input('right')];
  let events = 0;
  session.addEventListener('inputsourceschange', event => {
    events++;
    assert.equal(event.added[0], session.inputSources[0]);
    assert.deepEqual(event.removed, []);
    assert.equal(hydrateXrSessionInputs({ session, controllers, now: 1000, force: true }).attempted, false);
  });
  assert.equal(hydrateXrSessionInputs({ session, controllers, now: 1000 }).attempted, true);
  assert.equal(hydrateXrSessionInputs({ session, controllers, now: 1100 }).attempted, false);
  assert.equal(hydrateXrSessionInputs({ session, controllers, now: 1300 }).attempted, true);
  assert.equal(events, 2);
});
