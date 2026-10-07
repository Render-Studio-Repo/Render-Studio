import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendSimulationRunLog,
  applySimulationRunSample,
  createSimulationRun,
  simulationRunStorageKey,
} from "./simulation-run-session.js";

test("a Robotics Home start creates one project-scoped observable run", () => {
  const run = createSimulationRun({
    projectId: "project-42",
    prefs: { engine: "mujoco", scene: "cell/demo.xml", simUrl: "/sandbox/openarm-mujoco/index.html?embed=1" },
    source: "robotics-home",
    runId: "run-42",
    now: "2026-09-23T23:00:00.000Z",
  });
  assert.deepEqual(run, {
    schema: "render3d.simulation-run/v1",
    runId: "run-42",
    projectId: "project-42",
    engine: "mujoco",
    scene: "cell/demo.xml",
    simUrl: "/sandbox/openarm-mujoco/index.html?embed=1",
    source: "robotics-home",
    status: "starting",
    startedAt: "2026-09-23T23:00:00.000Z",
    updatedAt: "2026-09-23T23:00:00.000Z",
    runFeed: "openarm-mujoco/runs/latest.json",
    recordingRoot: "openarm-mujoco/episodes/run-42",
    viser: { transport: "studio-event+viser-room", status: "local" },
    vrVisible: true,
    sample: null,
    logs: [{ at: "2026-09-23T23:00:00.000Z", level: "info", message: "Starting cell/demo.xml from Robotics Home" }],
  });
  assert.equal(simulationRunStorageKey({ id: "user-7" }, "project-42"), "render3d:activeSimulationRun:user-7:project:project-42");
});

test("live samples update the run and logs stay bounded", () => {
  let run = createSimulationRun({
    projectId: "p1",
    prefs: { scene: "cell/demo.xml" },
    runId: "run-1",
    now: "2026-09-23T23:00:00.000Z",
  });
  for (let index = 0; index < 130; index += 1) {
    run = appendSimulationRunLog(run, "info", `frame ${index}`, `2026-09-23T23:00:${String(index % 60).padStart(2, "0")}.000Z`);
  }
  run = applySimulationRunSample(run, {
    scene: "cell/demo.xml",
    observed_at: "2026-09-23T23:01:00.000Z",
    joints: [{ name: "openarm_left_joint1", qpos: 0.25 }],
  });
  assert.equal(run.status, "running");
  assert.equal(run.sample.joints[0].qpos, 0.25);
  assert.equal(run.logs.length, 80);
  assert.equal(run.logs.at(-1).message, "Live sample · 1 joints");
});
