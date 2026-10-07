import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { trainingDecision, validateSample } from "./core.js";
import { physicalControllerSources, rightTriggerPressed, controllerInputStatus } from "./xr-controller-input.js?v=quest-input-1";
import { hydrateXrSessionInputs } from "../../xr/xr-input-session.js?v=quest-input-1";
import {
  probeHarness,
  harnessStart,
  harnessSample,
  harnessEnd,
  harnessTrials,
  publishEpisodeSummary,
  publishLiveKeyframe,
  notifyAgents,
  compactSample,
} from "./agent-bridge.js";

const $ = (id) => document.getElementById(id);
const viewport = $("viewport");
const packet = $("packet");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1b24);
scene.fog = new THREE.Fog(0x0c1b24, 7, 15);
const camera = new THREE.PerspectiveCamera(52, 1, 0.01, 40);
camera.position.set(3.9, 2.6, 4.4);
camera.lookAt(0, 1.0, -0.2);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
viewport.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, -0.2);
controls.enableDamping = true;
controls.update();
scene.add(new THREE.HemisphereLight(0xbcecf2, 0x10212b, 2));
const key = new THREE.DirectionalLight(0xffffff, 2.1);
key.position.set(1.5, 4, 2);
scene.add(key);
const grid = new THREE.GridHelper(7, 28, 0x3a6670, 0x22404c);
scene.add(grid);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(7, 7),
  new THREE.MeshStandardMaterial({ color: 0x0d252b, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.015;
scene.add(floor);

function mesh(geometry, color, metalness = 0) {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.4 }));
  scene.add(m);
  return m;
}
function sphere(r, color) {
  return mesh(new THREE.SphereGeometry(r, 20, 12), color);
}
function segment(color, r = 0.037) {
  return mesh(new THREE.CylinderGeometry(r, r, 1, 10), color, 0.3);
}
const tmp = new THREE.Vector3();
function placeSegment(m, a, b) {
  const dir = tmp.subVectors(b, a);
  const len = dir.length();
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.scale.set(1, len, 1);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}
function makeRig(offset, color, accent) {
  const chest = mesh(new THREE.BoxGeometry(0.43, 0.46, 0.24), color, 0.15);
  const head = sphere(0.135, accent);
  const left = {
    hand: sphere(0.07, accent),
    elbow: sphere(0.055, color),
    upper: segment(color),
    lower: segment(accent, 0.029),
  };
  const right = {
    hand: sphere(0.07, accent),
    elbow: sphere(0.055, color),
    upper: segment(color),
    lower: segment(accent, 0.029),
  };
  const jointMarkers = Array.from({ length: 7 }, () => sphere(0.024, 0xe2f4f2));
  function update(headPose, leftPose, rightPose) {
    chest.position.set(offset, 1.35, 0);
    head.position.set(offset + headPose[0], headPose[1], headPose[2]);
    for (const [side, pose, sign] of [
      [left, leftPose, -1],
      [right, rightPose, 1],
    ]) {
      const shoulder = new THREE.Vector3(offset + sign * 0.24, 1.48, 0);
      const hand = new THREE.Vector3(offset + pose[0], pose[1], pose[2]);
      const elbow = shoulder.clone().lerp(hand, 0.52).add(new THREE.Vector3(sign * 0.08, -0.12, 0.09));
      side.hand.position.copy(hand);
      side.elbow.position.copy(elbow);
      placeSegment(side.upper, shoulder, elbow);
      placeSegment(side.lower, elbow, hand);
      if (side === right) {
        jointMarkers.forEach((joint, i) =>
          joint.position.copy(i < 3 ? shoulder.clone().lerp(elbow, (i + 1) / 4) : elbow.clone().lerp(hand, (i - 2) / 5)),
        );
      }
    }
  }
  return { update, left, right, head };
}
const avatar = makeRig(-1.35, 0x186776, 0x59e7e7);
const robot = makeRig(1.05, 0x9b5632, 0xffbd7b);

/** Parent pane can drive identical joint names from OpenArm 2.0 / Viser map. */
let jointOverride = null;
window.addEventListener("message", (ev) => {
  const data = ev?.data;
  if (!data || data.type !== "openarm-joint-map") return;
  const q = data.qpos || {};
  const L1 = Number(q.openarm_left_joint1) || 0;
  const L2 = Number(q.openarm_left_joint2) || 0;
  const L4 = Number(q.openarm_left_joint4) || 0;
  const R1 = Number(q.openarm_right_joint1) || 0;
  const R2 = Number(q.openarm_right_joint2) || 0;
  const R4 = Number(q.openarm_right_joint4) || 0;
  const reach = (j1, j2, j4, sign) => {
    const len = 0.55 + Math.sin(j2) * 0.12;
    return [
      sign * (0.28 + Math.sin(j1) * len),
      1.35 + Math.cos(j2) * 0.35 + Math.sin(j4) * 0.08,
      -0.25 - Math.cos(j1) * len * 0.55,
    ];
  };
  jointOverride = {
    left: reach(L1, L2, L4, -1),
    right: reach(R1, R2, R4, 1),
    grip: Math.max(Number(q.left_gripper) || 0, Number(q.right_gripper) || 0),
  };
});
const table = mesh(new THREE.BoxGeometry(1.75, 0.08, 1.25), 0x35515a);
table.position.set(1.62, 0.66, -0.43);
const cube = mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), 0x51baf4);
cube.position.set(1.56, 0.78, -0.32);
const tray = mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.045, 28), 0xefae5c);
tray.position.set(2.01, 0.73, -0.72);
const targetRing = mesh(new THREE.RingGeometry(0.25, 0.27, 36), 0x67e6d9);
targetRing.rotation.x = -Math.PI / 2;
targetRing.position.set(2.01, 0.76, -0.72);
const linkMaterial = new THREE.LineDashedMaterial({
  color: 0x4dacae,
  dashSize: 0.08,
  gapSize: 0.05,
  transparent: true,
  opacity: 0.7,
});
const link = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  linkMaterial,
);
link.computeLineDistances();
scene.add(link);

let rig = { head: [0, 1.68, 0], left: [-0.4, 1.2, -0.4], right: [0.52, 1.22, -0.4], grip: 0 };
let recording = false;
let episodeId = null;
let sequence = 0;
let previous = null;
let lastCapture = 0;
let lastKeyframe = 0;
let demos = [];
let trials = [];
let animation = null;
let attached = false;
let serviceOnline = false;
let agentOnline = false;
let observedTrigger = false;
let triggerHeld = false;
let recordNeedsXrController = false;
let recordSawXrController = false;

const pose = (p) => ({ position: p, quaternion: [0, 0, 0, 1] });

function setConnection() {
  if (serviceOnline) $("connection").textContent = "HARNESS";
  else if (agentOnline) $("connection").textContent = "AGENT FEED";
  else $("connection").textContent = "LOCAL";
}

async function refreshLinks() {
  serviceOnline = await probeHarness();
  setConnection();
}
void refreshLinks();

function currentSample(edges = []) {
  const rightSource = physicalControllerSources(xrControllers).right?.source;
  const controllerStatus = controllerInputStatus({ presenting: renderer.xr.isPresenting, rightSource, observedTrigger });
  return {
    episode_id: episodeId || "local",
    sequence: sequence++,
    timestamp_ms: performance.now(),
    prompt_id: "sandbox-teleop",
    rig_version: "0.1-sandbox",
    head_pose: pose(rig.head),
    left_grip_pose: pose(rig.left),
    right_grip_pose: pose(rig.right),
    controller_edges: edges,
    scene: { object_ids: ["cube-1", "tray-1"], collision_count: 0 },
    feature_checks: {
      "viewport.boot": "ok",
      "viewport.models": "ok",
      "vr.controllers.input": controllerStatus.input,
      "vr.controllers.trigger": controllerStatus.trigger,
    },
    gripper: rig.grip,
  };
}

function showPacket(sample) {
  packet.textContent = JSON.stringify(
    {
      episode_id: sample.episode_id,
      sequence: sample.sequence,
      head: sample.head_pose.position,
      right: sample.right_grip_pose.position,
      gripper: sample.gripper,
      feature_checks: sample.feature_checks,
      feed: serviceOnline ? "harness" : agentOnline ? "mcp+chat" : "local-buffer",
    },
    null,
    2,
  );
}

function capture(force = false, edges = []) {
  if (!recording) return;
  const now = performance.now();
  if (!force && now - lastCapture < 100) return;
  lastCapture = now;
  const sample = currentSample(edges);
  const problems = validateSample(sample, previous);
  if (problems.length) {
    $("scene-status").textContent = `Rejected sample: ${problems.join(",")}`;
    return;
  }
  previous = sample;
  demos.at(-1).samples.push(sample);
  $("frame").textContent = `${demos.at(-1).samples.length} frames`;
  showPacket(sample);
  if (serviceOnline) void harnessSample(sample).catch(() => { serviceOnline = false; setConnection(); });
  if (!serviceOnline && now - lastKeyframe > 1000) {
    lastKeyframe = now;
    void publishLiveKeyframe(sample)
      .then(() => { agentOnline = true; setConnection(); })
      .catch(() => { agentOnline = false; setConnection(); });
  }
}

async function startRecord() {
  recordNeedsXrController = renderer.xr.isPresenting;
  recordSawXrController = false;
  episodeId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  sequence = 0;
  previous = null;
  demos.push({ id: episodeId, goal: $("goal").value, samples: [] });
  recording = true;
  $("record").textContent = "Stop recording";
  $("scene-status").textContent = "Recording pose and grip";
  await refreshLinks();
  if (serviceOnline) {
    try {
      await harnessStart({ episode_id: episodeId, prompt: $("goal").value, rig_version: "0.1-sandbox" });
    } catch {
      serviceOnline = false;
    }
  }
  if (!serviceOnline) {
    try {
      await notifyAgents(
        `OpenArm teleop recording started · episode ${episodeId} · prompt="${$("goal").value.slice(0, 100)}" · simulation only`,
      );
      agentOnline = true;
    } catch {
      agentOnline = false;
    }
  }
  setConnection();
  capture(true);
  updateMetrics();
}

async function stopRecord() {
  capture(true);
  recording = false;
  $("record").textContent = "Record demo";
  const demo = demos.at(-1);
  const count = demo?.samples.length || 0;
  if (count < 2 || (recordNeedsXrController && !recordSawXrController)) {
    demos.pop();
    $("scene-status").textContent = recordNeedsXrController && !recordSawXrController
      ? "Demo discarded: no right Quest controller input was observed"
      : "Demo discarded: move the hand and record at least two samples";
    if (serviceOnline) {
      try { await harnessEnd({ episode_id: episodeId, success: false }); }
      catch { serviceOnline = false; }
    }
  } else {
    const success = attached || cube.position.distanceTo(tray.position) < 0.23;
    $("scene-status").textContent = `Demo saved · ${count} samples`;
    if (serviceOnline) {
      try {
        await harnessEnd({ episode_id: episodeId, success });
      } catch {
        serviceOnline = false;
      }
    }
    try {
      await publishEpisodeSummary({
        episodeId,
        prompt: demo.goal,
        samples: demo.samples,
        trials,
        status: "closed",
        success,
      });
      agentOnline = true;
      $("scene-status").textContent = `Demo saved · ${count} samples · sent to agent feed`;
    } catch (err) {
      agentOnline = false;
      $("scene-status").textContent = `Demo saved locally · agent feed failed: ${err.message}`;
    }
  }
  setConnection();
  updateMetrics();
}

$("record").onclick = () => (recording ? void stopRecord() : void startRecord());

for (const [id, key, i] of [
  ["hand-x", "right", 0],
  ["hand-y", "right", 1],
  ["hand-z", "right", 2],
]) {
  $(id).oninput = (e) => {
    rig[key][i] = Number(e.target.value);
    capture();
  };
}
$("grip").oninput = (e) => {
  rig.grip = Number(e.target.value);
  capture(true, [{ hand: "right", control: "trigger", edge: rig.grip > 0.5 ? "down" : "up" }]);
};

const exampleKeys = [
  { t: 0, p: [0.52, 1.22, -0.4], g: 0 },
  { t: 1, p: [0.52, 0.88, -0.32], g: 0 },
  { t: 1.3, p: [0.52, 0.82, -0.32], g: 1 },
  { t: 2.1, p: [0.54, 1.18, -0.4], g: 1 },
  { t: 3, p: [0.97, 1.0, -0.72], g: 1 },
  { t: 3.4, p: [0.97, 0.84, -0.72], g: 1 },
  { t: 3.6, p: [0.97, 0.84, -0.72], g: 0 },
  { t: 4, p: [0.6, 1.25, -0.4], g: 0 },
];

function interpolate(keys, t) {
  let a = keys[0];
  let b = keys.at(-1);
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }
  const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t || 1)));
  return { p: a.p.map((v, i) => v + (b.p[i] - v) * u), g: a.g + (b.g - a.g) * u };
}

$("example").onclick = () => {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const samples = [];
  for (let i = 0; i <= 100; i++) {
    const v = interpolate(exampleKeys, i * 0.04);
    samples.push({
      episode_id: id,
      sequence: i,
      timestamp_ms: i * 40,
      prompt_id: "example",
      rig_version: "0.1-sandbox",
      head_pose: pose([0, 1.68, 0]),
      left_grip_pose: pose([-0.4, 1.2, -0.4]),
      right_grip_pose: pose(v.p),
      controller_edges: [],
      scene: { object_ids: ["cube-1", "tray-1"], collision_count: 0 },
      feature_checks: {
        "viewport.boot": "ok",
        "viewport.models": "ok",
        "vr.controllers.trigger": "unknown",
      },
      gripper: v.g,
    });
  }
  demos.push({ id, goal: $("goal").value, samples, synthetic: true });
  $("scene-status").textContent = "Synthetic example loaded · 101 samples";
  packet.textContent = JSON.stringify(
    { episode_id: id, synthetic: true, samples: samples.length, last: compactSample(samples.at(-1)) },
    null,
    2,
  );
  updateMetrics();
};

function updateMetrics() {
  const d = trainingDecision(trials);
  $("demos").textContent = demos.length;
  $("trials").textContent = d.trials;
  $("lower").textContent = `${Math.round(d.lower * 100)}%`;
  const labels = {
    run_5_more_heldout_trials: "Run five more untouched simulation trials.",
    collect_5_new_demos_for_failure_mode_then_retrain: `Collect five new demonstrations focused on ${d.priorityFailureMode}; retrain a real policy, then retest.`,
    stop_and_report_heldout_success: "Stop this evaluation batch: target lower bound met in simulation.",
    stop_budget_exhausted_and_review: "Stop at budget; inspect failure modes before more data.",
    repair_harness_or_safety_gate: "Repair invalid data or safety checks before continuing.",
  };
  $("recommendation").textContent = `${labels[d.action]} · ${d.wins}/${d.trials} successes`;
}

$("rollout").onclick = () => {
  if (!demos.length) {
    $("scene-status").textContent = "Load or record a demonstration first";
    return;
  }
  const seed = demos.at(-1);
  const samples = seed.samples;
  if (samples.length < 2) {
    $("scene-status").textContent = "Need at least two demo samples";
    return;
  }
  const t0 = samples[0].timestamp_ms;
  const duration = Math.max(0.1, (samples.at(-1).timestamp_ms - t0) / 1000);
  const keys = samples.map((s) => ({
    t: (s.timestamp_ms - t0) / 1000,
    p: s.right_grip_pose.position,
    g: s.gripper || 0,
  }));
  const grasp = keys.find((k) => k.g > 0.75);
  const release = keys.find((k, i) => i > keys.indexOf(grasp) && k.g < 0.25);
  const cubeLocal = new THREE.Vector3(0.51, 0.78, -0.32);
  const trayLocal = new THREE.Vector3(0.96, 0.73, -0.72);
  const graspError = grasp ? new THREE.Vector3(...grasp.p).distanceTo(cubeLocal) : Infinity;
  const releaseError = release ? new THREE.Vector3(...release.p).distanceTo(trayLocal) : Infinity;
  const batch = [];
  for (let i = 0; i < 5; i++) {
    const shift = (Math.random() - 0.5) * 0.24;
    const success = graspError + Math.abs(shift) < 0.19 && releaseError < 0.25;
    batch.push({
      valid: true,
      success,
      hardLimitViolations: 0,
      failureMode: success ? null : !grasp ? "missing_grasp" : !release ? "missing_release" : "reach_variation",
    });
  }
  trials.push(...batch);
  animation = { started: performance.now(), duration: duration * 1000, keys };
  $("scene-status").textContent = "Retargeting demo trajectory · five synthetic geometry trials";
  updateMetrics();
  if (!seed.synthetic && serviceOnline) {
    void harnessTrials({ episode_id: seed.id, results: batch });
  }
};

$("send-agent").onclick = async () => {
  const demo = demos.at(-1);
  if (!demo?.samples?.length) {
    $("scene-status").textContent = "Nothing to send — record or load an example first";
    return;
  }
  try {
    const summary = await publishEpisodeSummary({
      episodeId: demo.id,
      prompt: demo.goal,
      samples: demo.samples,
      trials,
      status: recording ? "recording" : "closed",
      success: null,
    });
    agentOnline = true;
    setConnection();
    packet.textContent = JSON.stringify(summary, null, 2);
    $("scene-status").textContent = `Sent to agent · ${demo.samples.length} samples → openarm-teleop/runs/latest.json`;
  } catch (err) {
    agentOnline = false;
    setConnection();
    $("scene-status").textContent = `Agent send failed: ${err.message}`;
  }
};

$("reset").onclick = () => {
  recording = false;
  animation = null;
  attached = false;
  rig.right = [0.52, 1.22, -0.4];
  rig.grip = 0;
  cube.position.set(1.56, 0.78, -0.32);
  trials = [];
  demos = [];
  $("record").textContent = "Record demo";
  $("frame").textContent = "0 frames";
  $("scene-status").textContent = "Reset";
  packet.textContent = "Awaiting observations…";
  updateMetrics();
};

$("xr").onclick = async () => {
  if (!navigator.xr) {
    $("scene-status").textContent = "WebXR unavailable in this browser";
    return;
  }
  try {
    const session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor"],
    });
    await renderer.xr.setSession(session);
    observedTrigger = false;
    triggerHeld = false;
    $("mode").textContent = "Live headset pose · simulation only";
    session.addEventListener("end", () => {
      $("mode").textContent = "Desktop pose control";
      triggerHeld = false;
      rig.grip = 0;
    });
  } catch (e) {
    $("scene-status").textContent = `XR session unavailable: ${e.message}`;
  }
};

const xrControllers = Array.from({ length: 4 }, (_, i) => renderer.xr.getController(i));
scene.add(...xrControllers);

function setRightTrigger(pressed) {
  if (triggerHeld === pressed) return;
  triggerHeld = pressed;
  rig.grip = pressed ? 1 : 0;
  if (pressed) observedTrigger = true;
  capture(true, [{ hand: "right", control: "trigger", edge: pressed ? "down" : "up" }]);
}

for (const controller of xrControllers) {
  controller.addEventListener("connected", (event) => {
    controller.userData.inputSource = event.data;
  });
  controller.addEventListener("disconnected", () => {
    if (controller.userData.inputSource?.handedness === "right") {
      setRightTrigger(false);
      observedTrigger = false;
    }
    controller.userData.inputSource = null;
  });
  controller.addEventListener("selectstart", (event) => {
    const source = event.data || controller.userData.inputSource;
    if (source?.handedness === "right" && source.gamepad) setRightTrigger(true);
  });
  controller.addEventListener("selectend", (event) => {
    const source = event.data || controller.userData.inputSource;
    if (source?.handedness === "right" && source.gamepad) setRightTrigger(false);
  });
}

const tempV = new THREE.Vector3();
function frame() {
  controls.update();
  if (renderer.xr.isPresenting) {
    const session = renderer.xr.getSession();
    hydrateXrSessionInputs({ session, controllers: xrControllers });
    const xrCamera = renderer.xr.getCamera(camera);
    xrCamera.getWorldPosition(tempV);
    rig.head = [tempV.x, tempV.y, tempV.z];
    const sources = physicalControllerSources(xrControllers);
    for (const side of ["left", "right"]) {
      const controller = sources[side]?.controller;
      if (controller) {
        controller.getWorldPosition(tempV);
        rig[side] = [tempV.x, tempV.y, tempV.z];
      }
    }
    if (sources.right) recordSawXrController = true;
    setRightTrigger(rightTriggerPressed(sources.right?.source));
    capture();
  }
  const status = controllerInputStatus({
    presenting: renderer.xr.isPresenting,
    rightSource: physicalControllerSources(xrControllers).right?.source,
    observedTrigger,
  });
  if ($("controller-status").textContent !== status.message) $("controller-status").textContent = status.message;
  if (animation) {
    const t = (performance.now() - animation.started) / 1000;
    if (t >= animation.duration / 1000) {
      animation = null;
      rig.grip = 0;
    } else {
      const v = interpolate(animation.keys, t);
      rig.right = v.p;
      rig.grip = v.g;
    }
  }
  avatar.update(rig.head, rig.left, rig.right);
  if (jointOverride) {
    robot.update([0, 1.68, 0], jointOverride.left, jointOverride.right);
    rig.grip = jointOverride.grip;
  } else {
    robot.update([0, 1.68, 0], rig.left, rig.right);
  }
  const hand = robot.right.hand.position;
  if (!attached && rig.grip > 0.75 && hand.distanceTo(cube.position) < 0.18) attached = true;
  if (attached) {
    cube.position.copy(hand).add(new THREE.Vector3(0, -0.08, 0));
    if (rig.grip < 0.25) {
      attached = false;
      $("scene-status").textContent =
        cube.position.distanceTo(tray.position) < 0.28 ? "Object placed in tray" : "Object released outside tray";
    }
  }
  link.geometry.setFromPoints([avatar.right.hand.position, robot.right.hand.position]);
  link.computeLineDistances();
  renderer.render(scene, camera);
}

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();
renderer.setAnimationLoop(frame);
updateMetrics();
