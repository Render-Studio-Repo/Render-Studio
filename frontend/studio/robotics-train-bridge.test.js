import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickRobotTrainSource } from "./robotics-train-bridge.js";
import {
  dimosFrameToSample,
  viserQposToSample,
  episodeDirForSource,
  ROBOTICS_EPISODE_DIR,
} from "../sandbox/openarm-training-loop.js";

test("recording source is explicit and ignores stale Viser telemetry", () => {
  assert.equal(pickRobotTrainSource({ viserJointCount: 0 }), "dimos");
  assert.equal(pickRobotTrainSource({ viserJointCount: 4 }), "dimos");
  assert.equal(pickRobotTrainSource({ selectedSource: "viser" }), "viser");
  assert.equal(pickRobotTrainSource({ selectedSource: "mujoco" }), "mujoco");
});

test("DimOS commands and Viser telemetry remain distinct", () => {
  const dimos = dimosFrameToSample({
    t: 120,
    leftPose: { x: 0, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
    rightPose: { x: 0.2, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
    leftJoy: { axes: [0, 0, 0.5, 0], buttons: [] },
    rightJoy: { axes: [0, 0, 0, 0], buttons: [] },
  }, 1, "demo");
  assert.equal(dimos.action.action_space, "dimos_ee_pose");
  assert.ok(dimos.action.left_grip_pose);

  const viser = viserQposToSample({ openarm_left_joint1: 0.1, openarm_right_joint4: 1.2 }, 2, "demo");
  assert.equal(viser.action, null);
  assert.equal(viser.observation.joints[0].qpos, 0.1);
});

test("hardware episodes persist under openarm-robotics", () => {
  assert.equal(episodeDirForSource("dimos"), ROBOTICS_EPISODE_DIR);
  assert.equal(episodeDirForSource("viser"), ROBOTICS_EPISODE_DIR);
});

test("robotics panel and bridge are wired in Studio", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const bridge = readFileSync(new URL("./robotics-train-bridge.js", import.meta.url), "utf8");
  const teleop = readFileSync(new URL("../xr/xr-dimos-teleop.js", import.meta.url), "utf8");
  const viser = readFileSync(new URL("./viser-viewer.js", import.meta.url), "utf8");
  assert.match(html, /data-robotics-train-record/);
  assert.match(html, /openarm-robotics\/episodes/);
  assert.match(bridge, /mountRoboticsTrainPanel/);
  assert.match(bridge, /startDimosRecord/);
  assert.match(teleop, /peekDimosTrainingFrame/);
  assert.match(viser, /openarm-viser-joints/);
});
