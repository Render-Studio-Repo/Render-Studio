import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  isViserSceneFurnitureName,
  viserMeshExceedsGrabExtent,
  isViserGrabMesh,
  viserAimHitsRobot,
  VISER_GRIP_CACHE,
} from "./xr-viser-grip.js";
import { createXrRoboticsWorkspace, reportXrRobotDebug } from "./xr-robotics-workspace.js";
import { createXrViserScene, applySimulationFrameToViserRoot } from "./xr-viser-scene.js";

const require = createRequire(import.meta.url);
const THREE = require("../../backend/skills/img2threejs/scripts/vendor/three/build/three.cjs");
if (typeof globalThis.addEventListener !== "function") globalThis.addEventListener = () => {};
if (typeof globalThis.removeEventListener !== "function") globalThis.removeEventListener = () => {};

test("the XR Viser model receives the active simulation run and latest sample", () => {
  const root = new THREE.Group();
  const changed = applySimulationFrameToViserRoot(root, {
    runId: "run-42",
    scene: "cell/demo.xml",
    status: "running",
    sample: { observed_at: "2026-09-23T23:01:00.000Z", joints: [{ name: "openarm_left_joint1", qpos: 0.25 }] },
  });
  assert.equal(changed, true);
  assert.equal(root.userData.simulationRun.runId, "run-42");
  assert.equal(root.userData.simulationRun.sample.joints[0].qpos, 0.25);
});

test("arming teleop opens the compact HUD without auto-loading the live robot", async () => {
  const previousDocument = globalThis.document;
  const context = new Proxy({ measureText: () => ({ width: 0 }) }, { get: (target, key) => target[key] || (() => {}) });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  const scene = new THREE.Scene();
  let apiCalls = 0;
  const workspace = createXrRoboticsWorkspace({
    THREE,
    scene,
    api: async () => { apiCalls += 1; return {}; },
    getToken: () => "",
    getUserId: () => "me",
    getHeadPose: () => ({ position: new THREE.Vector3(0, 1.5, 0), quaternion: new THREE.Quaternion() }),
    getTeleop: () => ({ armed: true }),
    getFeed: () => ({ widgets: {} }),
    isJoined: () => false,
  });
  try {
    workspace.tick({ presenting: true, now: 1000 });
    await Promise.resolve();
    assert.equal(apiCalls, 0);
    assert.equal(workspace.test.robots.size, 0);
  } finally {
    workspace.close();
    globalThis.document = previousDocument;
  }
});

test("live robot failures publish a sanitized copyable Render Studio debug event", () => {
  const priorCustomEvent = globalThis.CustomEvent;
  const priorDispatch = globalThis.dispatchEvent;
  let event;
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init.detail; } };
  globalThis.dispatchEvent = (next) => { event = next; return true; };
  try {
    const detail = reportXrRobotDebug({ message: "relay rejected", stage: "viser-load", trace: "trace-123", token: "secret" });
    assert.equal(event.type, "render3d:robotics-debug");
    assert.equal(detail.source, "xr-live-robot");
    assert.equal(detail.trace, "trace-123");
    assert.equal("token" in detail, false);
  } finally {
    globalThis.CustomEvent = priorCustomEvent;
    globalThis.dispatchEvent = priorDispatch;
  }
});

test("visergrip1 cache token", () => {
  assert.equal(VISER_GRIP_CACHE, "20260916-visergrip1");
  const src = readFileSync(new URL("./xr-viser-grip.js", import.meta.url), "utf8");
  const ws = readFileSync(new URL("./xr-robotics-workspace.js", import.meta.url), "utf8");
  assert.ok(src.includes("20260916-visergrip1"));
  assert.ok(ws.includes("20260916-visergrip1"));
});

test("scene furniture and volume boxes are not grab meshes", () => {
  assert.equal(isViserSceneFurnitureName("/Grid"), true);
  assert.equal(isViserSceneFurnitureName("/WorldAxes"), true);
  assert.equal(isViserSceneFurnitureName("/robot/arm"), false);
  assert.equal(isViserSceneFurnitureName("/targets/model/openarm"), true);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), new THREE.MeshBasicMaterial());
  arm.userData.viserGeometry = true;
  arm.geometry.computeBoundingBox();
  assert.equal(isViserGrabMesh(arm), true);
  const volume = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial());
  volume.userData.viserGeometry = true;
  volume.geometry.computeBoundingBox();
  assert.equal(viserMeshExceedsGrabExtent(volume), true);
  assert.equal(isViserGrabMesh(volume), false);
  const axes = new THREE.AxesHelper(0.14);
  axes.userData.viserGeometry = true;
  assert.equal(isViserGrabMesh(axes), false);
});

function aimFrom(origin, direction = new THREE.Vector3(0, 0, -1)) {
  const aim = new THREE.Group();
  aim.position.copy(origin);
  aim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction.clone().normalize());
  aim.updateMatrixWorld(true);
  return aim;
}

function workspaceWithArm() {
  const scene = new THREE.Scene();
  const ws = createXrRoboticsWorkspace({
    THREE,
    scene,
    getToken: () => "",
    getUserId: () => "me",
    getHeadPose: () => ({ position: new THREE.Vector3(0, 1.5, 0), quaternion: new THREE.Quaternion() }),
    getTeleop: () => ({}),
    getFeed: () => ({}),
    isJoined: () => false,
  });
  const root = new THREE.Group();
  root.name = "Live OpenArm";
  root.visible = true;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), new THREE.MeshBasicMaterial());
  arm.userData.viserGeometry = true;
  arm.geometry.computeBoundingBox();
  root.add(arm);
  root.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  ws.test.robots.set("openarm", {
    root,
    controls: new Map(),
    pick: () => null,
    pickMesh: (rc) => viserAimHitsRobot(rc, root),
    setInteracting() {},
    descriptor: { owner: "me" },
  });
  return { ws, root, arm, raycaster };
}

test("laser on the OpenArm mesh can grab; miss, volume, walk, and UI cannot", () => {
  const { ws, root } = workspaceWithArm();
  const hitAim = aimFrom(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
  assert.equal(ws.beginGrip(0, hitAim, hitAim), true);
  ws.endGrip(0);

  const missAim = aimFrom(new THREE.Vector3(2, 2, 2), new THREE.Vector3(1, 0, 0));
  assert.equal(ws.beginGrip(1, missAim, missAim), false);

  const volume = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial());
  volume.userData.viserGeometry = true;
  volume.geometry.computeBoundingBox();
  root.add(volume);
  root.updateMatrixWorld(true);
  assert.equal(ws.beginGrip(1, missAim, missAim), false);

  const walkAim = aimFrom(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
  assert.equal(ws.beginGrip(1, walkAim, walkAim, { walkHeld: true }), false);
  assert.equal(ws.beginGrip(1, walkAim, walkAim, { allowRobot: false }), false);
});

test("one-hand contact on the robot mesh grabs without a laser hit", () => {
  const { ws } = workspaceWithArm();
  const missAim = aimFrom(new THREE.Vector3(4, 4, 4), new THREE.Vector3(1, 0, 0));
  const contact = new THREE.Vector3(0, 0, 0.11);
  assert.equal(ws.beginGrip(0, missAim, missAim, { contactOrigin: contact }), true);
});

test("a locked OpenArm presentation cannot be moved with grip", () => {
  const { ws, root } = workspaceWithArm();
  root.userData.xrPlacementLocked = true;
  const hitAim = aimFrom(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
  assert.equal(ws.beginGrip(0, hitAim, hitAim), false);
});

function robotMeshMessage(name, size, position = [0, 0, 0]) {
  const geometry = new THREE.BoxGeometry(...size);
  const vertices = geometry.attributes.position.array;
  const faces = new Uint32Array(geometry.index.array);
  const binary = array => ({ base64: Buffer.from(array.buffer).toString("base64") });
  const messages = [
    { type: "MeshMessage", name, props: { vertices: binary(vertices), faces: binary(faces) } },
    { type: "SetPositionMessage", name, position },
  ];
  geometry.dispose();
  return messages;
}

for (const units of [1, 1000]) test(`live robot import fits its presentation size for source units ${units}`, async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const robot = createXrViserScene({ THREE, scene: new THREE.Scene(), getToken: () => "", api: () => { throw Error("No physical calls expected"); } });
  try {
    robot.receive({ type: "snapshot", scene: { id: "robot", pose: { position: [0, 1, -0.6], quaternion: [0, 0, 0, 1], scale: 0.55 } }, messages: [
      ...robotMeshMessage("/robot/left", [0.2 * units, 0.2 * units, 2 * units], [-0.3 * units, 0, units]),
      ...robotMeshMessage("/robot/right", [0.2 * units, 0.2 * units, 2 * units], [0.3 * units, 0, units]),
    ] });
    await robot.settled();
    const size = new THREE.Box3().setFromObject(robot.root).getSize(new THREE.Vector3());
    assert.ok(Math.abs(Math.max(size.x, size.y, size.z) - 0.55) < 1e-6, `Expected 0.55m, received ${size.toArray()}`);
    assert.deepEqual(robot.nodes.get("/robot/left").position.toArray(), [-0.3 * units, 0, units]);
    robot.root.visible = true;
    const mesh = robot.nodes.get("/robot/left").children[0];
    assert.equal(isViserGrabMesh(mesh), true, "A normalized source model remains selectable in metres or millimetres");
    const presentation = robot.root.children[0].scale.x;
    robot.receive({ messages: [{ type: "SetPositionMessage", name: "/robot/left", position: [-0.8 * units, 0, units] }] });
    await robot.settled();
    assert.equal(robot.root.children[0].scale.x, presentation, "Live joint updates must not resize the robot");
    robot.setPose({ position: [1, 1, -0.6], quaternion: [0, 0, 0, 1], scale: 0.55 });
    assert.equal(robot.root.children[0].scale.x, presentation, "Room pose updates must preserve normalized source geometry");
  } finally { robot.close(); globalThis.window = previousWindow; }
});

test("a locked OpenArm presentation ignores incoming shared room poses", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const robot = createXrViserScene({ THREE, scene: new THREE.Scene(), getToken: () => "", api: () => { throw Error("No physical calls expected"); } });
  try {
    robot.setPose({ position: [0.2, 1.1, -0.7], quaternion: [0, 0, 0, 1], scale: 0.55 });
    robot.setPlacementLocked(true);
    robot.receive({ scene: { id: "robot", pose: { position: [4, 5, 6], quaternion: [0, 0, 0, 1], scale: 2 } } });
    assert.deepEqual(robot.root.position.toArray(), [0.2, 1.1, -0.7]);
    assert.equal(robot.root.scale.x, 0.55);
  } finally { robot.close(); globalThis.window = previousWindow; }
});

test("late robot links refit once while room resizing and target coordinates stay independent", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const robot = createXrViserScene({ THREE, scene: new THREE.Scene(), getToken: () => "", api: () => { throw Error("No physical calls expected"); } });
  try {
    robot.receive({ type: "snapshot", scene: { id: "robot", pose: { position: [0, 1, -0.6], quaternion: [0, 0, 0, 1], scale: 0.55 } }, messages: [
      ...robotMeshMessage("/robot/base", [0.2, 0.2, 0.5], [0, 0, 0.25]),
      ...robotMeshMessage("/floor", [100, 100, 0.01]),
      { type: "TransformControlsMessage", name: "/target" },
    ] });
    await robot.settled();
    assert.ok(Math.abs(robot.root.children[0].scale.x - 2) < 1e-6, "Floor and target handles must not determine model sizing");
    robot.setPose({ position: [0, 1, -0.6], quaternion: [0, 0, 0, 1], scale: 0.8 });
    robot.receive({ messages: robotMeshMessage("/robot/arm", [0.2, 0.2, 1.5], [0, 0, 1.25]) });
    await robot.settled();
    assert.ok(Math.abs(robot.root.children[0].scale.x - 0.5) < 1e-6);
    assert.equal(robot.root.scale.x, 0.8, "Late geometry retains the user's presentation-size setting");
    const arm = robot.nodes.get("/robot/arm");
    robot.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(robot.nodes.get("/robot"));
    assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y - 0.8) < 1e-6);
    const sourceTarget = new THREE.Vector3(0.15, 0.1, 1.2);
    const target = robot.nodes.get("/target");
    const worldTarget = target.parent.localToWorld(sourceTarget.clone());
    const localTarget = target.parent.worldToLocal(worldTarget.clone());
    assert.ok(localTarget.distanceTo(sourceTarget) < 1e-9, "Grab inversion retains the source target coordinates");
    const armWorld = arm.getWorldPosition(new THREE.Vector3());
    assert.ok(armWorld.y > 1, "Existing Z-up conversion still places the robot above its base");
    const scale = robot.root.children[0].scale.x;
    robot.receive({ type: "snapshot", messages: [{ type: "SetPositionMessage", name: "/robot/arm", position: [0.25, 0, 1.25] }] });
    await robot.settled();
    assert.equal(robot.root.children[0].scale.x, scale);
  } finally { robot.close(); globalThis.window = previousWindow; }
});
