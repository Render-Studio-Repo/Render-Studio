import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createXrTabbedWindows,
  tabStripActionAt,
  XR_TAB_DETACH_M,
  XR_TAB_STRIP_GAP_M,
  XR_TAB_STRIP_HEIGHT_M,
  XR_TAB_HIT_PAD_M,
  XR_TAB_HIT_DEPTH_M,
  XR_TAB_STRIP_CANVAS,
} from './xr-tabbed-windows.js';

function vec(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; },
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
    clone() { return vec(this.x, this.y, this.z); },
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; },
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; },
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; },
    multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; },
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; },
    applyQuaternion() { return this; },
    setScalar(s) { return this.set(s, s, s); },
    clampScalar(min, max) {
      const clamp = (n) => Math.min(max, Math.max(min, n));
      return this.set(clamp(this.x), clamp(this.y), clamp(this.z));
    },
    distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); },
  };
}

function quat() {
  return {
    x: 0, y: 0, z: 0, w: 1,
    copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; },
    clone() { const q = quat(); return q.copy(this); },
    set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; },
  };
}

function mat() {
  return {
    copy() { return this; },
    equals() { return false; },
    makeScale() { return this; },
    setPosition() { return this; },
    premultiply() { return this; },
    invert() { return this; },
    decompose(p, q, s) { p.set(0, 0, 0); q.set(0, 0, 0, 1); s.set(1, 1, 1); return this; },
  };
}

class Object3D {
  constructor() {
    this.position = vec();
    this.quaternion = quat();
    this.scale = vec(1, 1, 1);
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.visible = true;
    this.matrixWorld = mat();
    this.name = '';
    this.renderOrder = 0;
  }
  add(obj) {
    if (obj.parent) obj.parent.remove(obj);
    obj.parent = this;
    this.children.push(obj);
    return this;
  }
  remove(obj) {
    this.children = this.children.filter((child) => child !== obj);
    if (obj.parent === this) obj.parent = null;
  }
  removeFromParent() { this.parent?.remove(this); }
  attach(obj) { this.add(obj); }
  updateWorldMatrix() {}
  getWorldPosition(out) { return out.copy(this.position); }
  getWorldQuaternion(out) { return out.copy(this.quaternion); }
  getWorldScale(out) { return out.copy(this.scale); }
}

class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
  }
}

function mockThree() {
  return {
    Group: Object3D,
    Mesh,
    Vector3: function Vector3(x, y, z) { return vec(x, y, z); },
    Quaternion: function Quaternion() { return quat(); },
    Matrix4: function Matrix4() { return mat(); },
    PlaneGeometry: function PlaneGeometry(width, height) {
      return { parameters: { width, height }, dispose() {} };
    },
    BoxGeometry: function BoxGeometry(width, height, depth) {
      return { parameters: { width, height, depth }, dispose() {} };
    },
    MeshBasicMaterial: function MeshBasicMaterial(opts) {
      return { ...opts, map: null, dispose() {} };
    },
    CanvasTexture: function CanvasTexture(canvas) {
      return {
        image: canvas,
        needsUpdate: false,
        generateMipmaps: false,
        minFilter: null,
        magFilter: null,
        anisotropy: 1,
        colorSpace: null,
        dispose() {},
      };
    },
    DoubleSide: 2,
    LinearFilter: 1006,
    SRGBColorSpace: 'srgb',
  };
}

function mockDocument() {
  globalThis.document = {
    createElement() {
      const ctx = {
        fillStyle: '',
        strokeStyle: '',
        font: '',
        lineWidth: 1,
        lineCap: '',
        lineJoin: '',
        miterLimit: 2,
        imageSmoothingEnabled: true,
        setTransform() {},
        fillRect() {},
        strokeRect() {},
        fillText() {},
        strokeText() {},
        save() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
      };
      return { width: 0, height: 0, getContext: () => ctx };
    },
  };
}

function panel(name) {
  const group = new Object3D();
  group.name = name;
  group.visible = true;
  group.userData = {};
  return group;
}

test('tab strip sits above the panel with a headset-scale backing store', () => {
  mockDocument();
  const THREE = mockThree();
  const scene = new Object3D();
  const tabs = createXrTabbedWindows(THREE, { scene, place() {} });
  const menu = panel('menu');
  scene.add(menu);
  tabs.update([{ kind: 'menu', group: menu, label: 'Menu' }], true);
  const strip = tabs.root.children.find((child) => child.material?.map);
  const pad = tabs.root.children.find((child) => child.userData?.xrTabHitPad);
  const stripY = strip?.position.y;
  const height = 0.46;
  assert.ok(stripY - height / 2 - XR_TAB_STRIP_HEIGHT_M / 2 >= XR_TAB_STRIP_GAP_M - 1e-6);
  assert.ok(XR_TAB_STRIP_GAP_M >= 0.012);
  assert.ok(XR_TAB_STRIP_HEIGHT_M >= 0.08);
  assert.ok(XR_TAB_HIT_PAD_M >= 0.016);
  assert.ok(XR_TAB_HIT_DEPTH_M >= 0.018);
  assert.ok(pad?.geometry?.parameters?.height > XR_TAB_STRIP_HEIGHT_M);
  assert.ok(XR_TAB_STRIP_CANVAS.w >= 2048);
  assert.ok(XR_TAB_STRIP_CANVAS.h >= 256);
  assert.equal(strip?.material.map.image.width, XR_TAB_STRIP_CANVAS.w);
});

test('empty tab chrome moves the window; tab, close, and undock stay distinct', () => {
  mockDocument();
  const THREE = mockThree();
  const scene = new Object3D();
  const tabs = createXrTabbedWindows(THREE, { scene, place() {} });
  const menu = panel('menu');
  const view = panel('view');
  scene.add(menu); scene.add(view);
  tabs.update([{ kind: 'menu', group: menu, label: 'Menu' }, { kind: 'view', group: view, label: 'View' }], true);
  const cells = tabs.cells();
  assert.equal(tabStripActionAt(cells, 40, 30), 'move');
  assert.equal(tabStripActionAt(cells, 200, 100), 'tab');
  assert.equal(tabStripActionAt(cells, 330, 100), 'undock');
  assert.equal(tabStripActionAt(cells, 390, 100), 'close');
  assert.ok(cells.some((cell) => cell.action === 'undock'));
  assert.ok(!cells.some((cell) => cell.action === 'move'), 'move is the default, not a tiny handle cell');
});

test('undock icon and trigger-drag both detach; a tap does not', () => {
  mockDocument();
  const THREE = mockThree();
  const scene = new Object3D();
  const placed = [];
  const tabs = createXrTabbedWindows(THREE, {
    scene,
    place(root) { placed.push(root); root.position.set(0, 1.48, -0.82); },
  });
  const menu = panel('menu');
  const view = panel('view');
  scene.add(menu); scene.add(view);
  tabs.update([{ kind: 'menu', group: menu, label: 'Menu' }, { kind: 'view', group: view, label: 'View' }], true);
  const controller = new Object3D();
  controller.position.set(0.2, 1.2, -0.2);
  tabs.select({ kind: 'viewport-tab', action: 'tab', id: 'view' }, controller);
  tabs.update([{ kind: 'menu', group: menu, label: 'Menu' }, { kind: 'view', group: view, label: 'View' }], true);
  assert.deepEqual(tabs.state().detached, []);
  tabs.release(controller);

  tabs.select({ kind: 'viewport-tab', action: 'undock', id: 'view' }, controller);
  assert.deepEqual(tabs.state().detached, ['view']);
  tabs.dock('view');
  assert.deepEqual(tabs.state().detached, []);

  tabs.select({ kind: 'viewport-tab', action: 'tab', id: 'view' }, controller);
  controller.position.x += XR_TAB_DETACH_M - 0.01;
  tabs.update([{ kind: 'menu', group: menu, label: 'Menu' }, { kind: 'view', group: view, label: 'View' }], true);
  assert.deepEqual(tabs.state().detached, [], 'sub-threshold hold keeps the tab docked');
  controller.position.x += 0.03;
  tabs.update([{ kind: 'menu', group: menu, label: 'Menu' }, { kind: 'view', group: view, label: 'View' }], true);
  assert.deepEqual(tabs.state().detached, ['view']);
  assert.ok(XR_TAB_DETACH_M === 0.07);
  assert.equal(placed.length > 0, true);
});

test('robotics stays docked; popped windows sit in front beside the dock', () => {
  mockDocument();
  const THREE = mockThree();
  const scene = new Object3D();
  const tabs = createXrTabbedWindows(THREE, {
    scene,
    place(root) { root.position.set(0, 1.48, -0.82); },
  });
  const robotics = panel('robotics');
  robotics.userData.xrHudParked = true;
  robotics.userData.xrUserRotated = true;
  const view = panel('view');
  view.userData.xrHudParked = true;
  scene.add(robotics);
  scene.add(view);
  tabs.update([
    { kind: 'robotics', group: robotics, label: 'Robotics' },
    { kind: 'view', group: view, label: 'View' },
  ], true);
  assert.deepEqual(tabs.state().tabs, ['robotics']);
  assert.deepEqual(tabs.state().detached, ['view']);
  assert.ok(Math.abs(view.position.x) > 0.5, 'undocked window opens beside the dock');
  assert.ok(Math.abs(view.position.x - tabs.root.position.x) > 0.5);
  const back = tabs.root.children.find((child) => child.userData?.xrDockBack);
  assert.equal(back?.visible, false, 'dock fill must not cover the project model');
});

test('tabface cache and foveation gate stay on the viewport path', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const tabs = readFileSync(join(here, 'xr-tabbed-windows.js'), 'utf8');
  const xr = readFileSync(join(here, 'viewport-xr.js'), 'utf8');
  const hud = readFileSync(join(here, 'xr-hud-refresh.js'), 'utf8');
  const app = readFileSync(join(here, '../studio/app.js'), 'utf8');
  const html = readFileSync(join(here, '../index.html'), 'utf8');
  assert.ok(tabs.includes("action:'undock'"));
  assert.ok(tabs.includes('XR_TAB_DETACH_M'));
  assert.ok(tabs.includes('XR_TAB_STRIP_GAP_M'));
  assert.ok(tabs.includes('XR_TAB_HIT_PAD_M'));
  assert.ok(tabs.includes("action = 'move'"));
  assert.ok(xr.includes('windowFaceTowardHead'));
  assert.ok(xr.includes('tabface=20260916-2'));
  assert.ok(xr.includes('createMenuClarityControl'));
  assert.ok(xr.includes('hasOpenWindows()'));
  assert.ok(hud.includes('setFoveation(level)'));
  assert.ok(app.includes('tabface=20260916-2'));
  assert.ok(html.includes('tabface=20260916-2'));
  assert.ok(app.includes('vrtabs=20260916-1'));
  assert.ok(app.includes('compactwindows=20260916-2'));
  assert.ok(app.includes('uisharp=20260916-1'));
  assert.ok(html.includes('uisharp=20260916-1'));
});
