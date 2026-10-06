import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SIMULATION_DEFAULT_SCENE,
  SIMULATION_EMBED_SRC,
  SIMULATION_TAB_ID,
  SIMULATION_FEED_PATH,
  createSimulationDeploymentDraft,
  emitSimulationFeed,
  evaluateSimulationWatchdog,
  normalizeScene,
  normalizeSimUrl,
  simUrlWithScene,
  persistSimulationPrefs,
  readSimulationPrefs,
  simulationPrefsKey,
  simulationSettingsPayload,
  readDeploymentDraft,
  simulationPrefsForActiveRun,
  headlessEvaluationView,
  officialReplayEvaluation,
  simulationCalibrationReport,
  simulationFailureDebugText,
  cubeActSceneCompatible,
} from "./simulation-viewer.js";

test("MuJoCo defaults to arms-only scene and bundled WASM URL", () => {
  assert.equal(SIMULATION_DEFAULT_SCENE, "openarm_bimanual.xml");
  assert.equal(normalizeScene(""), SIMULATION_DEFAULT_SCENE);
  assert.equal(normalizeScene("nope.xml"), SIMULATION_DEFAULT_SCENE);
  assert.equal(normalizeScene("cell/demo.xml"), "cell/demo.xml");
  assert.equal(SIMULATION_EMBED_SRC, "/sandbox/openarm-mujoco/index.html?embed=1");
  assert.equal(SIMULATION_TAB_ID, "simulation:open");
  assert.equal(SIMULATION_FEED_PATH, "openarm-mujoco/runs/latest.json");
});

test("cube ACT evaluation only accepts its trained scene", () => {
  assert.equal(cubeActSceneCompatible("cell/demo.xml"), true);
  assert.equal(cubeActSceneCompatible("pedestal/catch_scene.xml"), false);
});

test("MuJoCo panel does not expose a separate replay button", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /data-simulation-replay-eval/);
});

test("MuJoCo panel reports startup instead of showing a blank stage", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("./simulation-viewer.js", import.meta.url), "utf8");
  assert.match(html, /data-simulation-boot-state[^>]+role="status"/);
  assert.match(html, /data-simulation-boot-title>Loading MuJoCo/);
  assert.match(viewer, /showSimulatorBoot\(p\.scene\)/);
  assert.match(viewer, /openarm-mujoco-ready[\s\S]+hideSimulatorBoot\(\)/);
  assert.match(viewer, /MuJoCo is still starting/);
});

test("simulation viewer exposes physics pause without hiding the interactive viewport", () => {
  const viewer = readFileSync(new URL("./simulation-viewer.js", import.meta.url), "utf8");
  assert.match(viewer, /function setPaused\(on\)/);
  assert.match(viewer, /openarm-mujoco-pause/);
  assert.match(viewer, /setPaused,/);
});

test("sim URL normalizes and appends scene for iframe", () => {
  assert.equal(normalizeSimUrl(""), SIMULATION_EMBED_SRC);
  assert.match(normalizeSimUrl("http://localhost:5173/"), /^http:\/\/localhost:5173\/?$/);
  assert.match(simUrlWithScene(SIMULATION_EMBED_SRC, "openarm_bimanual.xml"), /embed=1/);
  assert.match(simUrlWithScene(SIMULATION_EMBED_SRC, "openarm_bimanual.xml"), /openarm_bimanual\.xml/);
});

test("watchdog is off in simplified MuJoCo tab", () => {
  assert.equal(evaluateSimulationWatchdog().code, "off");
});

test("simulation prefs persist scene, gravity, and custom sim URL", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const user = { id: "u-sim" };
  const saved = persistSimulationPrefs({
    gravity: -9.81,
    timestep: 0.002,
    simUrl: "http://127.0.0.1:5173/?embed=1",
    scene: "cell/demo.xml",
  }, user);
  assert.equal(saved.engine, "mujoco");
  assert.equal(saved.scene, "cell/demo.xml");
  assert.equal(readSimulationPrefs(user).simUrl, "http://127.0.0.1:5173/?embed=1");
  assert.ok(simulationPrefsKey(user).startsWith("render3d:simulationPrefs:"));
  const payload = simulationSettingsPayload(saved);
  assert.equal(payload.scene, "cell/demo.xml");
  assert.equal(payload.gravity, -9.81);
  delete globalThis.localStorage;
});

test("loading a selected scene creates one persisted simulation-only deployment draft", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  const draft = createSimulationDeploymentDraft({ scene: "cell/demo.xml" }, "project-42");
  assert.deepEqual(draft, {
    engine: "mujoco",
    scene: "cell/demo.xml",
    label: "cell/demo.xml",
    sourcePath: "cell/demo.xml",
    projectId: "project-42",
    hardwareTarget: "",
  });
  assert.deepEqual(readDeploymentDraft(), draft);
  delete globalThis.localStorage;
});

test("feed event carries MuJoCo settings", () => {
  const events = [];
  globalThis.window = {
    dispatchEvent(ev) { events.push(ev); return true; },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  };
  const detail = emitSimulationFeed({ scene: "cell/demo.xml", gravity: -9.81 });
  assert.equal(detail.engine, "mujoco");
  assert.equal(events[0].type, "render3d:simulation-feed");
  assert.equal(events[0].detail.scene, "cell/demo.xml");
  delete globalThis.window;
  delete globalThis.CustomEvent;
});

test("Open live sim prefers the active Robotics Home run over stale tab preferences", () => {
  const prefs = simulationPrefsForActiveRun({
    engine: "mujoco",
    scene: "openarm_bimanual.xml",
    simUrl: "/sandbox/openarm-mujoco/index.html?embed=1",
  }, {
    runId: "run-9",
    status: "running",
    scene: "cell/demo.xml",
    simUrl: "http://127.0.0.1:5173/?embed=1",
  });
  assert.equal(prefs.scene, "cell/demo.xml");
  assert.equal(prefs.simUrl, "http://127.0.0.1:5173/?embed=1");
});

test("headless evaluation view reports literal pass metrics separately from the browser viewport", () => {
  assert.deepEqual(headlessEvaluationView({
    status: "completed",
    simulationPassed: true,
    result: {
      success: true,
      reason: "cube_lift_sustained",
      steps: 412,
      sim_seconds: 13.596,
      wall_seconds: 22.4,
      initial_cube_z: 1.05,
      peak_cube_z: 1.121,
      max_abs_joint_change: 0.5437376,
      device: "mps",
    },
  }, 0), {
    state: "PASS",
    stateKey: "pass",
    reason: "cube_lift_sustained",
    progress: 100,
    steps: "412 steps",
    lift: "0.0710 m / 0.060 m",
    time: "13.60 s / 22.40 s",
    joint: "0.5437 rad max",
    device: "mps",
  });
});

test("verified episode replay reports RUNNING then PASS with its measured lift", () => {
  const running = headlessEvaluationView(officialReplayEvaluation({ episode: 0, index: 210, total: 263, liftM: 0.1, fps: 30 }));
  assert.equal(running.state, "RUNNING");
  assert.equal(running.steps, "210 steps");
  assert.equal(running.device, "Verified replay");

  const passed = headlessEvaluationView(officialReplayEvaluation({ episode: 0, index: 263, total: 263, liftM: 0.1, fps: 30 }));
  assert.equal(passed.state, "PASS");
  assert.equal(passed.lift, "0.1000 m / 0.060 m");
  assert.equal(passed.reason, "Verified Episode 0 replay completed.");
});

test("running headless evaluation shows bounded elapsed progress", () => {
  const view = headlessEvaluationView({ status: "running", startedAt: "2026-09-27T22:00:00.000Z" }, Date.parse("2026-09-27T22:00:05.000Z"));
  assert.equal(view.state, "RUNNING");
  assert.equal(view.progress, 25);
  assert.equal(view.steps, "5.0 s elapsed");
  assert.equal(view.time, "— / 5.0 s");
});

test("running calibration does not diagnose an incomplete evaluation", () => {
  const evaluation = { status: "running" };
  const diagnostics = {
    cube_xyz_m: [0.45, 0, 1.025],
    right_tool_xyz_m: [0.45, -0.02, 1.12],
    left_tool_distance_m: 0.4,
    right_tool_distance_m: 0.097,
  };
  const report = simulationCalibrationReport(evaluation, diagnostics);
  assert.equal(report.verdict, "EVALUATION RUNNING");
  assert.match(report.recommendation, /completed closest-approach/);
});

test("failed policy calibration reports an observed high tool with no cube contact", () => {
  const evaluation = { status: "completed", result: { success: false, reason: "timeout_before_cube_lift", min_right_tool_distance_m: 0.1126, max_cube_contacts: 0 } };
  const diagnostics = {
    cube_xyz_m: [0.45, 0, 1.025],
    left_tool_xyz_m: [0.36, 0.34, 1.17],
    right_tool_xyz_m: [0.455, -0.03, 1.133],
    left_tool_distance_m: 0.37,
    right_tool_distance_m: 0.1126,
    cube_gripper_contacts: 0,
  };
  const report = simulationCalibrationReport(evaluation, diagnostics);
  assert.equal(report.verdict, "FRAME / REACH CALIBRATION NEEDED");
  assert.equal(report.closestTool, "right");
  assert.ok(Math.abs(report.verticalOffsetM - 0.108) < 0.0001);
  const debug = simulationFailureDebugText({ evaluation, diagnostics, prefs: { scene: "cell/demo.xml" } });
  assert.match(debug, /reason=timeout_before_cube_lift/);
  assert.match(debug, /vertical_offset_m=0\.108/);
  assert.match(debug, /hardware_motion=none/);
});

test("calibration uses one closest-approach frame instead of mixing minimum distance with final XYZ", () => {
  const report = simulationCalibrationReport({
    status: "completed",
    result: {
      success: false,
      max_cube_contacts: 0,
      closest_tool_side: "right",
      closest_tool_distance_m: 0.1126,
      closest_tool_vertical_offset_m: 0.1084,
      closest_cube_xyz_m: [0.45, 0, 1.025],
      closest_tool_xyz_m: [0.455, -0.03, 1.1334],
    },
  }, {
    cube_xyz_m: [0.45, 0, 1.025],
    right_tool_xyz_m: [0.3935, -0.2129, 1.1924],
    right_tool_distance_m: 0.2767,
  });
  assert.equal(report.sampleFrame, "closest approach");
  assert.equal(report.closestDistanceM, 0.1126);
  assert.equal(report.verticalOffsetM, 0.1084);
});

test("completed calibration reports peak contacts instead of a zero-contact final frame", () => {
  const evaluation = {
    status: "completed",
    result: { success: false, max_cube_contacts: 2 },
  };
  const diagnostics = { cube_gripper_contacts: 0 };
  const report = simulationCalibrationReport(evaluation, diagnostics);
  assert.equal(report.contacts, 2);
  assert.equal(report.verdict, "GRIPPER CONTACT WITHOUT LIFT");
  assert.match(report.recommendation, /closure timing/);
  assert.match(
    simulationFailureDebugText({ evaluation, diagnostics }),
    /cube_gripper_contacts=2/,
  );
});

test("Robotics ribbon exposes MuJoCo next to Viser and Teleop", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ribbon = readFileSync(new URL("./ribbon.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(html, /id="simulation-viewer"/);
  assert.match(html, /data-simulation-live-slot/);
  assert.match(html, /data-simulation-url/);
  assert.match(html, /data-simulation-connect/);
  assert.match(html, /data-simulation-load-home/);
  assert.match(html, /data-simulation-run-logs/);
  assert.match(html, /data-simulation-calibration-check/);
  assert.match(html, /data-simulation-copy-debug/);
  assert.match(html, /data-simulation-rerun-eval/);
  assert.match(html, /openarm-mujoco\/runs\/latest\.json/);
  assert.match(html, /openarm_bimanual\.xml/);
  assert.match(html, />MuJoCo</);
  assert.match(ribbon, /MuJoCo:/);
  assert.match(ribbon, /roboticsAction: "sim-tab"/);
  assert.match(ribbon, /roboticsAction: "sim-connect"/);
  assert.match(app, /createSimulationViewer/);
  assert.match(app, /action === "sim-tab"/);
  assert.match(app, /kind === "simulation"/);
  const viewer = readFileSync(new URL("./simulation-viewer.js", import.meta.url), "utf8");
  assert.match(viewer, /if \(activatingTab\) docTabs\?\.setActive\(SIMULATION_TAB_ID, \{ notify: false \}\)/);
  assert.match(viewer, /openarm-mujoco-ready/);
  assert.match(viewer, /openarm-mujoco-activate/);
  assert.match(viewer, /pendingOfficialReplay/);
  assert.match(viewer, /mujocoReadyScene !== replay\.scene/);
  assert.doesNotMatch(viewer, /addEventListener\?\.\("load", sendReplay/);
  assert.match(app, /activateViewport\?\.\(\{ taskView: true \}\)/);
});
