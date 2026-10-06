import test from "node:test";
import assert from "node:assert/strict";
import { createRoboticsVoiceCommandRouter, matchRoboticsActionRequest, roboticsVoiceTools, ROBOTICS_VOICE_ACTION_IDS } from "./robotics-voice-controls.js";

test("robotics voice exposes physical controls with confirmation-gated semantics", () => {
  const tools = roboticsVoiceTools();
  const ids = tools.find((tool) => tool.name === "run_robotics_action").parameters.properties.id.enum;
  assert.deepEqual(ids, [...ROBOTICS_VOICE_ACTION_IDS]);
  assert.ok(ids.includes("start_simulation"));
  assert.ok(ids.includes("kill_robot"));
  assert.ok(ids.includes("home_robot"));
  assert.ok(ids.includes("hardware_preflight"));
  assert.ok(ids.includes("open_cameras"));
  assert.match(tools.find((tool) => tool.name === "run_robotics_action").description, /confirmation dialog/i);
});

test("robotics navigation commands require explicit robotics context", () => {
  assert.equal(matchRoboticsActionRequest("open my project files"), "");
  assert.equal(matchRoboticsActionRequest("show the data explorer"), "");
  assert.equal(matchRoboticsActionRequest("open the cameras"), "");
  assert.equal(matchRoboticsActionRequest("open my robot project files"), "open_project_files");
  assert.equal(matchRoboticsActionRequest("show the robot cameras"), "open_cameras");
  assert.equal(matchRoboticsActionRequest("view the robot training datasets"), "open_data_explorer");
});

test("Render Agent recognizes only explicit robotics control requests", () => {
  assert.equal(matchRoboticsActionRequest("kill the robot now"), "kill_robot");
  assert.equal(matchRoboticsActionRequest("connect to my Pi"), "connect_pi");
  assert.equal(matchRoboticsActionRequest("home the OpenArm robot"), "home_robot");
  assert.equal(matchRoboticsActionRequest("recover the robot to home"), "recover_home");
  assert.equal(matchRoboticsActionRequest("run hardware preflight on the robot"), "hardware_preflight");
  assert.equal(matchRoboticsActionRequest("explain how robot homing works"), "");
  assert.equal(matchRoboticsActionRequest("open my robot project files"), "open_project_files");
  assert.equal(matchRoboticsActionRequest("show the robot cameras"), "open_cameras");
  assert.equal(matchRoboticsActionRequest("view the robot training datasets"), "open_data_explorer");
});

test("robotics voice routes setup inspection and one explicit action", async () => {
  const scope = { user: "sam", project: "p1" };
  let starts = 0;
  const route = createRoboticsVoiceCommandRouter({
    getScope: () => scope,
    getSetup: async () => ({ demo: { state: "ready" }, simulation: { open: false } }),
    getActions: () => [{ id: "start_simulation", run: async () => ({ ok: true, started: ++starts }) }],
  });
  assert.equal((await route("get_robotics_setup")).demo.state, "ready");
  assert.deepEqual(await route("run_robotics_action", { id: "start_simulation" }), { ok: true, started: 1 });
  assert.equal((await route("run_robotics_action", { id: "unknown_robot_action" })).ok, false);
});

test("robotics voice rejects a project switch while an action is running", async () => {
  const scope = { user: "sam", project: "p1" };
  const route = createRoboticsVoiceCommandRouter({
    getScope: () => scope,
    getActions: () => [{ id: "open_mujoco", run: async () => { scope.project = "p2"; return { ok: true }; } }],
  });
  const result = await route("run_robotics_action", { id: "open_mujoco" });
  assert.equal(result.ok, false);
  assert.match(result.error, /project changed/i);
});
