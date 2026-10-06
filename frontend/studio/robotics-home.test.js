import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CURATED_OPENARM_SUCCESS_EXAMPLES, emotePickerItems, guardedHomeVerified, mountRoboticsHome, policyCatalogItems, policyDebugText, policyEvaluationStats, policyPrograms, teleopExampleItems } from "./robotics-home.js";
import { createHardwareRunEventJournal } from "./hardware-run-event-journal.js";

const VERIFIED_HOME = {
  home_reached: true,
  home_safe_hold: true,
  home_max_error_rad: 0.008,
  home_target_joint_count: 16,
  home_feedback_joint_count: 16,
};

test("Robotics Home exposes folder creation and an explicit active dataset destination", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("./robotics-home.js", import.meta.url), "utf8");
  assert.match(html, /data-robotics-dataset-folder-add[^>]*>📁＋ Folder/);
  assert.match(html, /Select Emotes for replayable takes, or a training folder for data recordings/);
  assert.match(source, /datasetDestinationStorageKey\(projectId\)/);
  assert.match(source, /created and selected as the recording destination/);
  assert.doesNotMatch(source, /mkdir|createDirectory|writeFile/);
});

test("guarded Home requires convergence, complete feedback, and actuator hold", () => {
  assert.equal(guardedHomeVerified({ ...VERIFIED_HOME }), true);
  assert.equal(guardedHomeVerified({ ...VERIFIED_HOME, home_safe_hold: false }), false);
  assert.equal(guardedHomeVerified({ ...VERIFIED_HOME, home_feedback_joint_count: 14 }), false);
  assert.equal(guardedHomeVerified({ ...VERIFIED_HOME, home_max_error_rad: null }), false);
});

class FakeElement {
  constructor(selector, { mode, value = "" } = {}) {
    this.selector = selector;
    this.dataset = mode ? { roboticsMode: mode } : {};
    this.value = value;
    this.textContent = "";
    this.disabled = false;
    this.attributes = new Map();
    this.classes = new Set(mode === "simulation" ? ["is-active"] : []);
    this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
  }
  closest(selector) { return selector === this.selector ? this : null; }
  focus() { this.focused = true; }
  click() { this.clicked = true; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); if (name === "disabled") this.disabled = false; }
}

function harness(api, { draft = { engine: "mujoco", scene: "cell/demo.xml", label: "cell/demo.xml", sourcePath: "cell/demo.xml", projectId: "p1", hardwareTarget: "http://pi:8450/robotics/config" }, onActivateCameras, onCloseCameras, onOpenSimulation, onOpenViser, onOpenSplitView, onOpenHardwareWorkspace, onOpenDatasets, onStartSimulation, onSetSimulationPaused, onEvaluatePolicy, onPrepareHardwareCandidate, onStopPolicy, onGetPolicyDebug, onReplayExample, onStartEvaluationRecording, hardwareRunJournal } = {}) {
  const elements = new Map();
  const add = (selector, options) => {
    const element = new FakeElement(selector, options);
    elements.set(options?.mode ? `${selector}:${options.mode}` : selector, element);
    return element;
  };
  add("[data-robotics-home-status]");
  add("[data-robotics-home-state]");
  add("[data-robotics-home-config]", { value: "http://pi:8450/robotics/config" });
  add("[data-robotics-home-connect]");
  add("[data-robotics-home-sync]");
  add("[data-robotics-home-pose]");
  add("[data-robotics-home-recover]");
  add("[data-robotics-y-tap]");
  add("[data-robotics-task-robot]");
  add("[data-robotics-home-sim]");
  add("[data-robotics-start-sim]");
  add("[data-robotics-camera-activate]");
  add("[data-robotics-deployment]");
  add("[data-robotics-deployment-label]");
  add("[data-robotics-deployment-source]");
  add("[data-robotics-hardware-target]", { value: draft?.hardwareTarget || "" });
  add("[data-robotics-start-position]", { value: "home:home" });
  add("[data-robotics-start-detail]");
  add("[data-robotics-start-refresh]");
  add("[data-robotics-open-start-viser]");
  add("[data-robotics-open-start-emotes]");
  add("[data-robotics-run-real]");
  add("[data-robotics-run-policy]");
  add("[data-robotics-stop-policy]");
  add("[data-robotics-policy-select]");
  add("[data-robotics-hardware-policy-select]");
  add("[data-robotics-policy-live-view]", { value: "viser" });
  add("[data-robotics-policy-open-live]");
  add("[data-robotics-policy-copy-debug]");
  add("[data-robotics-policy-validate]");
  add("[data-robotics-policy-debug]");
  for (const name of ["state", "reason", "steps", "sim", "wall", "lift", "joint", "hardware", "run-id", "cameras"]) add(`[data-robotics-policy-stat-${name}]`);
  add("[data-robotics-split-live]", { value: "viser" }).dataset.roboticsSplitLive = "viser";
  add("[data-robotics-policy-current]");
  add("[data-robotics-policy-state]");
  add("[data-robotics-policy-detail]");
  add("[data-robotics-policy-search]");
  add("[data-robotics-policy-list]");
  add("[data-robotics-run-diagnose]");
  add("[data-robotics-run-copy]");
  add("[data-robotics-run-checklist]");
  add("[data-robotics-run-debug]");
  add("[data-robotics-dataset-select]");
  add("[data-robotics-dataset-list]");
  add("[data-robotics-demo-folder]");
  add("[data-robotics-profile-select]", { value: "references/Robots/Base" });
  add("[data-robotics-profile-name]", { value: "Cube Run" });
  add("[data-robotics-profile-save]");
  add("[data-robotics-profile-load]");
  for (const mode of ["simulation", "shadow", "hardware"]) add("[data-robotics-mode]", { mode });
  let clickHandler;
  let changeHandler;
  const root = {
    dataset: {},
    querySelector(selector) { return elements.get(selector) || null; },
    querySelectorAll(selector) {
      return selector === "[data-robotics-mode]"
        ? ["simulation", "shadow", "hardware"].map((mode) => elements.get(`${selector}:${mode}`))
        : [];
    },
    addEventListener(type, handler) {
      if (type === "click") clickHandler = handler;
      if (type === "change") changeHandler = handler;
    },
  };
  let savedDraft = draft;
  const mountResult = mountRoboticsHome({
    root,
    api,
    getProjectId: () => "p1",
    readDeploymentDraft: () => savedDraft,
    saveDeploymentDraft: (next) => { savedDraft = next; return next; },
    onActivateCameras,
    onCloseCameras,
    onOpenSimulation,
    onOpenViser,
    onOpenSplitView,
    onOpenHardwareWorkspace,
    onOpenDatasets,
    onStartSimulation,
    onSetSimulationPaused,
    onEvaluatePolicy,
    onPrepareHardwareCandidate,
    onStopPolicy,
    onGetPolicyDebug,
    onReplayExample,
    onStartEvaluationRecording, hardwareRunJournal,
  });
  const click = async (selector, mode) => {
    clickHandler({ target: elements.get(mode ? `${selector}:${mode}` : selector) });
    for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const change = async (selector, value) => {
    const element = elements.get(selector);
    element.value = value;
    changeHandler({ target: element });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const settle = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); };
  const mounted = mountResult;
  return { click, change, settle, get: (selector, mode) => elements.get(mode ? `${selector}:${mode}` : selector), savedDraft: () => savedDraft, mounted };
}

test("Open Cameras invokes one unified camera action", async () => {
  let opened = 0;
  const view = harness(async () => ({}), { onActivateCameras: () => { opened += 1; } });
  await view.click("[data-robotics-camera-activate]");
  assert.equal(opened, 1);
});

test("Stop policy ends the active evaluator before another scene can start", async () => {
  const events = [];
  const view = harness(async (path) => path === "/api/robotics/camera-wall/status"
    ? { cameras: { left: { live: true }, right: { live: true }, zed: { live: true } } }
    : {}, {
    onStartSimulation: () => ({ runId: "scene-run", scene: "cell/demo.xml" }),
    onEvaluatePolicy: async () => ({ status: "running", scene: "cell/demo.xml" }),
    onStopPolicy: async () => { events.push("stop"); return { status: "stopped", scene: "cell/demo.xml" }; },
  });
  await view.change("[data-robotics-policy-select]", "hf-model:enactic/act-openarm-2-cell-pick_up_cube_mujoco");
  await view.click("[data-robotics-run-policy]");
  await view.click("[data-robotics-stop-policy]");
  assert.deepEqual(events, ["stop"]);
  assert.match(view.get("[data-robotics-home-status]").textContent, /fresh policy session.*currently selected scene/i);
});

test("robotics live split delegates the selected Viser or MuJoCo target", async () => {
  const opened = [];
  const view = harness(async () => ({}), { onOpenSplitView: (kind) => opened.push(kind) });
  await view.click("[data-robotics-split-live]");
  assert.deepEqual(opened, ["viser"]);
});

test("policyPrograms keeps one normalized entry per Pi program", () => {
  assert.deepEqual(policyPrograms({
    deployment: { scene: "cell/demo.xml" },
    program: { id: "pick", name: "Cube pick", validated: true, samples: 5 },
    programs: [{ id: "pick", name: "duplicate" }, { id: "place", validated: true, source: "emote:2" }],
  }), [
    { id: "pick", name: "Cube pick", validated: true, scene: "cell/demo.xml", source: "", samples: 5, kind: "joint_trajectory", checkpoint: "", actionSchema: "", requiredCameras: [], blockers: [] },
    { id: "place", name: "place", validated: true, scene: "cell/demo.xml", source: "emote:2", samples: 0, kind: "joint_trajectory", checkpoint: "", actionSchema: "", requiredCameras: [], blockers: [] },
  ]);
});

test("policy catalog retains experimental sources while the working UI can select only validated examples", () => {
  const items = policyCatalogItems({
    runnable: true,
    program: { id: "smoke", name: "Smoke policy", validated: true, samples: 5 },
    programs: [{ id: "smoke", name: "Smoke policy", validated: true, samples: 5 }],
  }, [{
    name: "Demo OpenArm",
    root: "references/Robots/OpenArm 2.0/Demos/Demo OpenArm",
    profile: {
      model: { repo_id: "enactic/act-openarm-cube", revision: "policy456", installed: false },
      dataset: { repo_id: "enactic/openarm-cube-lerobot" },
      simulation: { scene: "cell/demo.xml" },
    },
  }]);
  assert.deepEqual(items.slice(0, 2).map(({ name, kind, location, runnable, dataset }) => ({ name, kind, location, runnable, dataset })), [
    { name: "Smoke policy", kind: "program", location: "Raspberry Pi", runnable: true, dataset: "" },
    { name: "act-openarm-cube", kind: "checkpoint", location: "Hugging Face", runnable: false, dataset: "enactic/openarm-cube-lerobot" },
  ]);
  assert.equal(items.some((item) => item.name === "Validated cube pick · ACT checkpoint" && item.kind === "checkpoint" && item.validationScope === "simulation" && item.validated === true), true);
  assert.deepEqual(items.filter((item) => item.kind === "replay").map((item) => [item.episodeIndex, item.validated]), [[0, true], [3, true]]);
  assert.equal(items.filter((item) => item.kind === "dataset").length, 5);
  assert.equal(policyCatalogItems({}, [], "distractor").map((item) => item.id).includes("qualia-robotics/openarm-cube-distractor-lang-v3"), true);
  assert.deepEqual(policyCatalogItems({}, [], "folding").map((item) => [item.kind, item.dataset]), [
    ["recipe", "lerobot/high_quality_folding"],
    ["dataset", "lerobot/high_quality_folding"],
  ]);
});

test("verified example runs its measured motion with the validated ACT option available", async () => {
  const events = [];
  const view = harness(async (path) => path === "/api/robotics/camera-wall/status"
    ? { cameras: { left: { live: true }, right: { live: true }, zed: { live: true } } }
    : {}, {
    onActivateCameras: async () => events.push(["cameras"]),
    onCloseCameras: () => events.push(["close-cameras"]),
    onOpenSplitView: async (kind) => events.push(["split", kind]),
    onStopPolicy: async () => { events.push(["stop-experimental"]); return { status: "idle" }; },
    onReplayExample: async (episode) => { events.push(["replay", episode]); return true; },
    onEvaluatePolicy: async () => { events.push(["evaluate"]); return { status: "failed" }; },
  });
  await view.change("[data-robotics-policy-select]", "verified-replay:openarm-official-success-0");
  assert.equal(view.get("[data-robotics-run-policy]").textContent, "Run example");
  assert.match(view.get("[data-robotics-policy-select]").innerHTML, /Validated cube pick/);
  await view.click("[data-robotics-run-policy]");
  assert.deepEqual(events, [["close-cameras"], ["replay", 0], ["split", "mujoco"]]);
  assert.equal(view.get("[data-robotics-policy-stat-state]").textContent, "PASS");
  assert.match(view.get("[data-robotics-policy-stat-run-id]").textContent, /^policy-/);
  assert.equal(view.get("[data-robotics-policy-stat-cameras]").textContent, "SIMULATION ONLY");
  assert.match(view.get("[data-robotics-policy-debug]").textContent, /\[START\] trigger: Run requested/);
  assert.match(view.get("[data-robotics-policy-debug]").textContent, /\[PASS\] outcome: Verified demonstration met the cube-lift pass rule/);
  assert.match(view.get("[data-robotics-home-status]").textContent, /PASS.*10\.0 cm measured cube lift/);
});

test("validated ACT evaluation is selectable in simulation without a Pi connection", async () => {
  const events = [];
  const view = harness(async () => ({}), {
    onStartSimulation: (draft) => {
      events.push(["start", draft.scene, draft.policyCheckpoint]);
      return { runId: "eval-42", scene: draft.scene };
    },
    onSetSimulationPaused: (on) => events.push(["browser-physics-paused", on]),
    onOpenSplitView: (kind) => events.push(["split", kind]),
    onEvaluatePolicy: async (body) => {
      events.push(["evaluate", body.scene, body.runId]);
      return { status: "running" };
    },
  });
  await view.change("[data-robotics-policy-select]", "hf-model:enactic/act-openarm-2-cell-pick_up_cube_mujoco");
  assert.equal(view.get("[data-robotics-run-policy]").textContent, "Run ACT evaluation");
  assert.equal(view.get("[data-robotics-run-policy]").disabled, false);
  await view.click("[data-robotics-run-policy]");
  assert.deepEqual(events, [
    ["start", "cell/demo.xml", "enactic/act-openarm-2-cell-pick_up_cube_mujoco"],
    ["split", "mujoco"],
    ["browser-physics-paused", true],
    ["evaluate", "cell/demo.xml", "eval-42"],
    ["browser-physics-paused", false],
  ]);
});

test("simulation-passed guarded ACT program becomes hardware-ready when Pi cameras are live", async () => {
  const requests = [];
  const checkpoint = "enactic/act-openarm-2-cell-pick_up_cube_mujoco";
  const candidate = {
    id: "act_openarm_cube_pick_candidate",
    name: "Guarded ACT cube pick hardware program",
    kind: "act_trajectory",
    validated: true,
    checkpoint,
    scene: "cell/demo.xml",
    positions: [[0, 0]],
    times: [0],
    blockers: [],
    required_cameras: ["top", "wrist_left", "wrist_right"],
  };
  const initial = { ok: true, runnable: false, programs: [], deployment: { scene: "cell/demo.xml" } };
  const stored = { ok: true, runnable: true, program: candidate, programs: [candidate], deployment: { scene: "cell/demo.xml", programId: candidate.id } };
  const view = harness(async (path, options = {}) => {
    requests.push([path, options.method || "GET"]);
    if (path === "/api/robotics/config/discover") return { profile: "openarm" };
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/robotics/policy/program")) return stored;
    if (path.endsWith("/robotics/policy/cameras")) return { ok: true, ready: true, missing: [] };
    if (path.endsWith("/robotics/policy/bind") || path.endsWith("/robotics/policy")) return initial;
    return { ok: true };
  }, {
    onStartSimulation: () => ({ runId: "eval-pass", scene: "cell/demo.xml" }),
    onEvaluatePolicy: async () => ({
      status: "completed",
      simulationPassed: true,
      checkpoint,
      hardwareValidated: false,
      hardwareBlockers: [],
      result: { success: true, reason: "cube_lift_sustained", initial_cube_z: 0.05, peak_cube_z: 0.16, success_threshold_z: 0.11 },
    }),
    onPrepareHardwareCandidate: async () => candidate,
  });

  await view.click("[data-robotics-home-connect]");
  await view.change("[data-robotics-policy-select]", `hf-model:${checkpoint}`);
  await view.click("[data-robotics-run-policy]");
  await view.click("[data-robotics-policy-validate]");

  assert.deepEqual(requests.filter(([path]) => path.endsWith("/robotics/policy/program") || path.endsWith("/robotics/policy/cameras")), [
    ["/api/teleop/p/ticket/8443/robotics/policy/program", "POST"],
    ["/api/teleop/p/ticket/8443/robotics/policy/cameras", "GET"],
  ]);
  assert.equal(view.get("[data-robotics-run-policy]").disabled, false);
  assert.equal(view.get("[data-robotics-policy-state]").textContent, "READY");
  assert.equal(view.get("[data-robotics-hardware-policy-select]").value, candidate.id);
  assert.match(view.get("[data-robotics-hardware-policy-select]").innerHTML, /Guarded ACT cube pick hardware program · READY/);
  assert.match(view.get("[data-robotics-home-status]").textContent, /Hardware program ready/);
  assert.equal(requests.some(([path]) => /\/robotics\/(kill|home|policy\/run)$/.test(path)), false);
});

test("selected policy opens the camera and Viser review split before the guarded physical sequence", () => withBrowserGlobals(async () => {
  const requests = [];
  const opened = [];
  const recordings = [];
  const journal = createHardwareRunEventJournal({ now: () => new Date("2026-09-29T12:00:00.000Z") });
  const snapshot = {
    ok: true,
    runnable: true,
    deployment: { scene: "cell/demo.xml", programId: "pick" },
    program: { id: "pick", name: "Cube pick", validated: true, scene: "cell/demo.xml", samples: 5 },
    programs: [{ id: "pick", name: "Cube pick", validated: true, scene: "cell/demo.xml", samples: 5 }],
  };
  const view = harness(async (path, options = {}) => {
    requests.push([path, options.body ? JSON.parse(options.body) : null]);
    if (path === "/api/robotics/config/discover") return { profile: "openarm" };
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/robotics/policy") || path.endsWith("/robotics/policy/bind")) return snapshot;
    if (path.endsWith("/robotics/kill")) return { ok: true, armed: false, homing: false, pending_arm: false, playing: false };
    if (path.endsWith("/robotics/home")) return { ok: true, homing: true };
    if (path.endsWith("/robotics/status")) return { ok: true, armed: false, homing: false, pending_arm: false, playing: false, ...VERIFIED_HOME };
    if (path.endsWith("/robotics/policy/run")) return { ok: true, completed: true, armed: false, homing: false, pending_arm: false, playing: false };
    return { ok: true };
  }, {
    onActivateCameras: () => opened.push("cameras"),
    onOpenSplitView: (kind) => opened.push(`split:${kind}`),
    onStartEvaluationRecording: (context) => { recordings.push(context); return { ok: true }; },
    hardwareRunJournal: journal,
  });

  await view.click("[data-robotics-home-connect]");
  assert.equal(view.get("[data-robotics-hardware-policy-select]").disabled, false);
  assert.match(view.get("[data-robotics-hardware-policy-select]").innerHTML, /Cube pick · READY/);
  await view.change("[data-robotics-hardware-policy-select]", "pick");
  assert.equal(view.get("[data-robotics-policy-current]").textContent, "Cube pick · 5 samples");
  assert.equal(view.get("[data-robotics-policy-state]").textContent, "READY");
  await view.click("[data-robotics-run-policy]");

  assert.deepEqual(opened, ["split:viser", "cameras"]);
  assert.equal(recordings[0].source, "viser");
  assert.deepEqual(requests.filter(([path]) => /\/robotics\/(kill|home|policy\/run)$/.test(path)).map(([path]) => path.split("/").slice(-2).join("/")), [
    "robotics/kill",
    "robotics/home",
    "policy/run",
  ]);
  assert.match(view.get("[data-robotics-home-status]").textContent, /policy complete/i);
  assert.deepEqual(journal.snapshot().filter((event) => ["live view", "cameras"].includes(event.category)).map((event) => `${event.category}:${event.outcome}`), [
    "live view:START", "live view:PASS", "cameras:START", "cameras:PASS",
  ]);
  assert.match(journal.text(), /Policy playback complete\. PASS \/ FAIL review is ready/);
  assert.match(journal.text(), /operator confirmed workspace clear/i);
}));

test("one hardware workflow action connects, homes, and runs the prepared Pi policy in order", () => withBrowserGlobals(async () => {
  const requests = [];
  const journal = createHardwareRunEventJournal({ now: () => new Date("2026-09-29T23:30:00.000Z") });
  const program = { id: "pick", name: "Cube pick", validated: true, scene: "cell/demo.xml", samples: 5, blockers: [] };
  const snapshot = { ok: true, runnable: true, deployment: { scene: "cell/demo.xml", programId: program.id }, program, programs: [program] };
  const view = harness(async (path, options = {}) => {
    requests.push(path);
    if (path === "/api/robotics/config/discover") return { profile: "openarm" };
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/robotics/policy") || path.endsWith("/robotics/policy/bind")) return snapshot;
    if (path.endsWith("/robotics/kill")) return { ok: true, armed: false, homing: false, pending_arm: false, playing: false };
    if (path.endsWith("/robotics/home")) return { ok: true, homing: true };
    if (path.endsWith("/robotics/status")) return { ok: true, armed: false, homing: false, pending_arm: false, playing: false, ...VERIFIED_HOME };
    if (path.endsWith("/robotics/policy/run")) return { ok: true, completed: true, armed: false, homing: false, pending_arm: false, playing: false };
    return { ok: true };
  }, {
    onActivateCameras: () => true,
    onOpenSplitView: () => true,
    onStartEvaluationRecording: () => ({ ok: true }),
    hardwareRunJournal: journal,
  });

  const completed = await view.mounted.runLoadedPolicyHardwareWorkflow();

  assert.equal(completed, true);
  assert.deepEqual(requests.filter((path) => /\/robotics\/(kill|home|policy\/run)$/.test(path)).map((path) => path.split("/").slice(-2).join("/")), [
    "robotics/kill",
    "robotics/home",
    "policy/run",
  ]);
  assert.match(journal.text(), /Step 1 · Select OpenArm Pi/);
  assert.match(journal.text(), /Step 2 · Prepare Pi \+ check gates/);
  assert.match(journal.text(), /Steps 3–4 · Guarded Home then policy/);
}));

test("Step 4 blocks a simulation-only example before opening hardware surfaces or sending a Pi command", async () => {
  const requests = [];
  const opened = [];
  const journal = createHardwareRunEventJournal({ now: () => new Date("2026-09-29T19:43:15.068Z") });
  const view = harness(async (path, options = {}) => {
    requests.push([path, options.method || "GET"]);
    return {};
  }, {
    onOpenHardwareWorkspace: () => opened.push("right:robotics"),
    onOpenSplitView: async (kind) => { opened.push(`split:${kind}`); return true; },
    onActivateCameras: async () => { opened.push("cameras"); return true; },
    hardwareRunJournal: journal,
  });

  await view.change("[data-robotics-policy-select]", "verified-replay:openarm-official-success-0");
  const first = view.mounted.runSimulationPolicyOnRobot();
  const second = view.mounted.runSimulationPolicyOnRobot();
  await Promise.all([first, second]);

  assert.deepEqual(opened, []);
  assert.match(view.get("[data-robotics-home-status]").textContent, /not yet a Pi hardware program/);
  assert.match(journal.text(), /\[BLOCKED\] run: Physical policy blocked/);
  assert.match(journal.text(), /Verified cube pick · Episode 0 is simulation-only/);
  assert.equal(requests.some(([path]) => /\/robotics\/(kill|home|policy\/run)$/.test(path)), false);
});

test("Step 4 uses the validated Pi executable after bind even when the Step 2 replay label is still selected", () => withBrowserGlobals(async () => {
  globalThis.confirm = () => false;
  const requests = [];
  const opened = [];
  const journal = createHardwareRunEventJournal({ now: () => new Date("2026-09-29T22:53:46.141Z") });
  const program = { id: "act_openarm_cube_pick_candidate", name: "Guarded ACT cube pick hardware program", validated: true, scene: "cell/demo.xml", samples: 69, blockers: [] };
  const snapshot = {
    ok: true,
    runnable: true,
    deployment: { scene: "cell/demo.xml", programId: program.id },
    program,
    programs: [program],
  };
  const view = harness(async (path, options = {}) => {
    requests.push([path, options.method || "GET"]);
    if (path === "/api/robotics/config/discover") return { profile: "openarm" };
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/robotics/policy") || path.endsWith("/robotics/policy/bind")) return snapshot;
    return { ok: true };
  }, {
    onOpenSplitView: async (kind) => { opened.push(`split:${kind}`); return true; },
    onActivateCameras: async () => { opened.push("cameras"); return true; },
    hardwareRunJournal: journal,
  });

  await view.change("[data-robotics-policy-select]", "verified-replay:openarm-official-success-0");
  await view.click("[data-robotics-home-connect]");
  await view.mounted.runSimulationPolicyOnRobot();

  assert.deepEqual(opened, ["split:viser", "cameras"]);
  assert.doesNotMatch(journal.text(), /\[BLOCKED\] run: Physical policy blocked/);
  assert.match(journal.text(), /Workspace-clear confirmation requested.*Guarded ACT cube pick hardware program/);
  assert.equal(requests.some(([path]) => /\/robotics\/(kill|home|policy\/run)$/.test(path)), false);
}));

test("Start Simulation sends the loaded demo to MuJoCo without calling a hardware API", async () => {
  const requests = [];
  const starts = [];
  const view = harness(async (...args) => { requests.push(args); return {}; }, {
    onStartSimulation: (draft) => { starts.push(draft); return { runId: "run-42", scene: draft.scene }; },
  });
  await view.click("[data-robotics-start-sim]");
  assert.deepEqual(starts.map((draft) => draft.scene), ["cell/demo.xml"]);
  assert.deepEqual(requests.filter(([path]) => /robotics\/(kill|home)|teleop/.test(path)), []);
  assert.equal(view.get("[data-robotics-home-status]").textContent, "Simulation started · cell/demo.xml · run run-42. Use the separate policy button for a guarded physical run.");
});

test("policy debug distinguishes passive browser samples from the headless evaluator", async () => {
  let copied = "";
  const priorNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text) => { copied = text; } } } });
  try {
    const view = harness(async () => ({}), {
      onGetPolicyDebug: async () => ({
        evaluator: { status: "completed", checkpoint: "enactic/act-openarm-2-cell-pick_up_cube_mujoco", scene: "cell/demo.xml", exitCode: 2, result: { success: false, reason: "timeout_before_cube_lift", steps: 600, max_abs_joint_change: 0.985 } },
        simulation: { prefs: { scene: "cell/demo.xml" }, activeRun: { runId: "eval-42", status: "live" }, lastAnalysis: { sample: { joint_count: 14, qvel_max: 0, standstill: true } }, feedPath: "openarm-mujoco/runs/latest.json" },
      }),
    });
    await view.change("[data-robotics-policy-select]", "hf-model:enactic/act-openarm-2-cell-pick_up_cube_mujoco");
    await view.click("[data-robotics-policy-copy-debug]");
    assert.match(copied, /browser_qvel_max=0/);
    assert.match(copied, /evaluator_reason=timeout_before_cube_lift/);
    assert.match(copied, /visible_motion_bridge=not_connected/);
    assert.equal(view.get("[data-robotics-policy-debug]").textContent, copied);
  } finally {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: priorNavigator });
  }
});

test("policy debug text never claims passive telemetry is policy motion", () => {
  const text = policyDebugText({ simulation: { activeRun: { runId: "r1" }, lastAnalysis: { sample: { qvel_max: 1e-8 } } } });
  assert.match(text, /visible_motion_bridge=not_connected/);
  assert.match(text, /Browser live samples do not prove policy actions are applied/);
});

test("policy evaluation statistics expose the task predicate and separate hardware validation", () => {
  const stats = policyEvaluationStats({ status: "completed", hardwareValidated: false, hardwareBlockers: ["adapter missing"], result: {
    success: false, reason: "timeout_before_cube_lift", steps: 600, sim_seconds: 20, wall_seconds: 31.25,
    initial_cube_z: 0.05, peak_cube_z: 0.071, success_threshold_z: 0.11, max_abs_joint_change: 0.985,
  } });
  assert.deepEqual(stats, {
    state: "FAIL", reason: "timeout_before_cube_lift", steps: 600, simSeconds: "20.00", wallSeconds: "31.25",
    liftMeters: "0.0210", requiredLiftMeters: "0.0600", jointChange: "0.9850", hardwareValidated: false, blockers: ["adapter missing"],
  });
});

test("stopped policy evaluation is not reported as a failure", () => {
  const stats = policyEvaluationStats({ status: "stopped", scene: "cell/tool_cell_scene.xml" });
  assert.equal(stats.state, "STOPPED");
  assert.equal(stats.reason, "Stopped by user");
});

test("Emote picker deduplicates, searches, and keeps pinned recordings first", () => {
  const items = emotePickerItems({
    recordings: [{ id: "b", name: "Weld pass" }, { id: "a", name: "Cube pick", pinned: true }],
    loops: [{ id: "b", name: "Duplicate" }, { id: "c", name: "Cube place" }],
  }, "cube");
  assert.deepEqual(items, [
    { id: "a", name: "Cube pick", pinned: true },
    { id: "c", name: "Cube place", pinned: false },
  ]);
});

test("teleop example picker distinguishes replay-only Emotes from training-ready episodes", () => {
  const items = teleopExampleItems({ recordings: [
    { id: "motion", name: "Motion only", samples: 120, joint_count: 16 },
    { id: "ready", name: "Cube success", samples: 180, joint_count: 16, camera_count: 3, fps: 30, calibration_id: "cal-4", success: true },
  ] });
  assert.deepEqual(items.filter((item) => !item.official).map((item) => [item.id, item.trainingReady]), [["ready", true], ["motion", false]]);
  assert.equal(items.filter((item) => item.official && item.trainingReady).length, 2);
  assert.deepEqual(CURATED_OPENARM_SUCCESS_EXAMPLES.map((item) => item.samples), [263, 264]);
});

test("saved dataset folder is restored and Open selected folder uses it", async () => {
  const opened = [];
  const rootPath = "references/Robots/OpenArm 2.0/Training Data/My recent run";
  const view = harness(async (path) => {
    if (path === "/api/users/me/robotics-prefs") return {prefs:{activeDatasetRoot:rootPath}};
    if (path.endsWith("/robotics/datasets")) return {datasets:[{name:"My recent run",root:rootPath,files:4,bytes:100,episodes:2,videos:1}]};
    return {};
  }, {onOpenDatasets:(root) => opened.push(root)});
  await view.settle();
  assert.equal(view.get("[data-robotics-dataset-select]").value, rootPath);
  await view.click("[data-robotics-demo-folder]");
  assert.deepEqual(opened, [rootPath]);
});

test("Save as new stores current Robotics Home settings and opens its Project Explorer folder", async () => {
  const requests = [];
  const opened = [];
  const savedRoot = "references/Robots/Saved Profiles/Cube-Run";
  const view = harness(async (path, options = {}) => {
    requests.push([path, options.body ? JSON.parse(options.body) : null]);
    if (path === "/api/users/me/robotics-prefs" && !options.method) return { prefs: { activeDatasetRoot: "references/Robots/Data/Cubes" } };
    if (path.endsWith("/robotics/datasets")) return { datasets: [{ name: "Cubes", root: "references/Robots/Data/Cubes" }] };
    if (path.endsWith("/robotics/profiles") && options.method === "POST") return { saved: { name: "Cube Run", root: savedRoot } };
    if (path.endsWith("/robotics/profiles")) return { profiles: [{ name: "Cube Run", root: savedRoot }] };
    return {};
  }, { onOpenDatasets: (root) => opened.push(root) });
  await view.settle();
  await view.click("[data-robotics-profile-save]");

  const save = requests.find(([path, body]) => path.endsWith("/robotics/profiles") && body);
  assert.equal(save[1].name, "Cube Run");
  assert.equal(save[1].settings.dataset_root, "references/Robots/Data/Cubes");
  assert.equal(save[1].settings.config_url, "http://pi:8450/robotics/config");
  assert.deepEqual(opened, [savedRoot]);
  assert.match(view.get("[data-robotics-home-status]").textContent, /saved in Project Explorer/);
});

test("loading a project profile synchronizes its dataset scene checkpoint and robot config", async () => {
  const rootPath = "references/Robots/OpenArm 2.0/Demos/Demo OpenArm";
  const view = harness(async (path, options = {}) => {
    if (path === "/api/users/me/robotics-prefs" && !options.method) return { prefs: {} };
    if (path.endsWith("/robotics/profiles/activate")) return { selected: { name: "Demo OpenArm", profile: {
      task: "pick up cube",
      dataset: { root: "hf://official", repo_id: "enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot" },
      simulation: { scene: "cell/demo.xml" },
      model: { repo_id: "enactic/act-openarm-2-cell-pick_up_cube_mujoco" },
      home: { config_url: "http://openarm.local:8450/robotics/config" },
    } } };
    if (path.endsWith("/robotics/profiles")) return { profiles: [{ name: "Demo OpenArm", root: rootPath }] };
    if (path.endsWith("/robotics/datasets")) return { datasets: [{ name: "Official", root: "hf://official" }] };
    return {};
  }, { draft: null });
  await view.settle();
  view.get("[data-robotics-profile-select]").value = rootPath;
  await view.click("[data-robotics-profile-load]");
  assert.equal(view.savedDraft().scene, "cell/demo.xml");
  assert.equal(view.savedDraft().policyCheckpoint, "enactic/act-openarm-2-cell-pick_up_cube_mujoco");
  assert.equal(view.savedDraft().policyDataset, "enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot");
  assert.equal(view.get("[data-robotics-home-config]").value, "http://openarm.local:8450/robotics/config");
  assert.equal(view.get("[data-robotics-policy-select]").value, "hf-model:enactic/act-openarm-2-cell-pick_up_cube_mujoco");
  assert.match(view.get("[data-robotics-home-status]").textContent, /profile ACT checkpoint is selected for simulation evaluation/);
});

function withBrowserGlobals(run) {
  const priorDocument = globalThis.document;
  const priorConfirm = globalThis.confirm;
  globalThis.document = { querySelector: () => ({ value: "https://pi:8443/teleop" }) };
  globalThis.confirm = () => true;
  return Promise.resolve(run()).finally(() => {
    globalThis.document = priorDocument;
    globalThis.confirm = priorConfirm;
  });
}

test("offline physical Home connects to Pi and never resets MuJoCo", () => withBrowserGlobals(async () => {
  const requests = [];
  const view = harness(async (path, options = {}) => {
    requests.push([path, options.body ? JSON.parse(options.body) : null]);
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/robotics/home")) return { ok: true, homing: true };
    if (path.endsWith("/robotics/status")) return { ok: true, armed: false, homing: false, pending_arm: false, playing: false, ...VERIFIED_HOME };
    return { ok: true };
  });

  await view.click("[data-robotics-mode]", "hardware");
  assert.equal(view.get("[data-robotics-home-status]").textContent, "Hardware needs a Pi connection. Connect the Pi, then choose Hardware again.");
  assert.equal(view.get("[data-robotics-home-connect]").focused, true);
  await view.click("[data-robotics-home-pose]");
  assert.equal(view.get("[data-robotics-home-status]").textContent, "Physical arms-down home verified. Teleop is OFF; the robot will not follow controllers until Hardware preflight.");
  assert.equal(requests.some(([path]) => path.endsWith("/robotics/home")), true);
  assert.equal(view.get("[data-robotics-mode]", "hardware").attributes.get("aria-pressed"), "true");
}));

test("Enable Resume sends the same Pi Y tap and reports controller-pose wait", () => withBrowserGlobals(async () => {
  const requests = [];
  const view = harness(async (path, options = {}) => {
    requests.push([path, options.body ? JSON.parse(options.body) : null]);
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/teleop/y")) return { ok: true, armed: false, pending_arm: true, holding: false };
    return { ok: true };
  });
  await view.click("[data-robotics-y-tap]");
  assert.deepEqual(requests.at(-1), ["/api/teleop/p/ticket/8443/teleop/y", { action: "tap" }]);
  assert.equal(view.get("[data-robotics-home-status]").textContent, "Y accepted. The Pi is waiting for fresh left and right controller poses before enabling the arms.");
}));

test("Hardware preflight refuses missing demo and target without sending requests", () => withBrowserGlobals(async () => {
  const requests = [];
  const noDemo = harness(async (...args) => { requests.push(args); }, { draft: null });
  await noDemo.click("[data-robotics-mode]", "hardware");
  assert.equal(noDemo.get("[data-robotics-home-status]").textContent, "Load a MuJoCo demo to Robotics Home before running Hardware preflight.");
  assert.equal(noDemo.get("[data-robotics-home-sim]").focused, true);

  const noTarget = harness(async (...args) => { requests.push(args); }, {
    draft: { engine: "mujoco", scene: "cell/demo.xml", label: "cell/demo.xml", sourcePath: "cell/demo.xml", projectId: "p1", hardwareTarget: "" },
  });
  await noTarget.click("[data-robotics-mode]", "hardware");
  assert.equal(noTarget.get("[data-robotics-home-status]").textContent, "Select a hardware target before running Hardware preflight.");
  assert.equal(noTarget.get("[data-robotics-hardware-target]").focused, true);
  assert.deepEqual(requests.filter(([path]) => path.includes("/api/teleop/") || path.includes("/api/robotics/config/")), []);
}));

test("assigning the OpenArm Pi persists the draft and never calls hardware APIs", () => withBrowserGlobals(async () => {
  const requests = [];
  const view = harness(async (...args) => { requests.push(args); }, {
    draft: { engine: "mujoco", scene: "cell/demo.xml", label: "cell/demo.xml", sourcePath: "cell/demo.xml", projectId: "p1", hardwareTarget: "" },
  });
  await view.change("[data-robotics-hardware-target]", "http://192.168.1.77:8450/robotics/config");
  assert.equal(view.savedDraft().hardwareTarget, "http://192.168.1.77:8450/robotics/config");
  assert.equal(view.get("[data-robotics-home-status]").textContent, "Hardware target assigned. No motion was sent. Connect the Pi when you are ready to run preflight.");
  assert.deepEqual(requests.filter(([path]) => path.includes("/api/teleop/") || path.includes("/api/robotics/config/")), []);
}));

test("Hardware click runs reset and controller-independent guarded home before selecting Hardware", () => withBrowserGlobals(async () => {
  const requests = [];
  const api = async (path, options = {}) => {
    requests.push([path, options.body ? JSON.parse(options.body) : null]);
    if (path === "/api/robotics/config/discover") return { profile: "openarm" };
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/robotics/home")) return { ok: true, homing: true };
    if (path.endsWith("/robotics/status")) return { ok: true, armed: false, homing: false, pending_arm: false, playing: false, ...VERIFIED_HOME };
    return { ok: true };
  };
  const view = harness(api);

  await view.click("[data-robotics-home-connect]");
  await view.click("[data-robotics-mode]", "hardware");

  assert.deepEqual(requests.filter(([path]) => /\/robotics\/(kill|home|status)$/.test(path)), [
    ["/api/teleop/p/ticket/8443/robotics/kill", { source: "robotics_home_preflight" }],
    ["/api/teleop/p/ticket/8443/robotics/home", { action: "home", pose: "arms_down", orientation: "canonical", both_arms: true, require_clear: true, require_calibrated: true, require_controller_poses: false, verify_joint_limits: true, speed_scale: 0.15 }],
    ["/api/teleop/p/ticket/8443/robotics/status", null],
  ]);
  assert.equal(view.get("[data-robotics-home-state]").textContent, "HARDWARE · PI ONLINE");
  assert.equal(view.get("[data-robotics-home-status]").textContent, "Hardware ready. This downloaded MuJoCo scene has no validated hardware program, so it cannot be run on the robot.");
}));

test("failed guarded home stops preflight, latches KILL, and returns to Simulation", () => withBrowserGlobals(async () => {
  const requests = [];
  const api = async (path, options = {}) => {
    requests.push(path);
    if (path === "/api/robotics/config/discover") return {};
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/home")) throw new Error("encoder mismatch");
    return { ok: true };
  };
  const view = harness(api);

  await view.click("[data-robotics-home-connect]");
  await view.click("[data-robotics-mode]", "hardware");

  assert.deepEqual(requests.filter((path) => /\/robotics\/(kill|home)$/.test(path)), [
    "/api/teleop/p/ticket/8443/robotics/kill",
    "/api/teleop/p/ticket/8443/robotics/home",
  ]);
  assert.equal(view.get("[data-robotics-home-state]").textContent, "FAULT · KILL LATCHED");
  assert.equal(view.get("[data-robotics-mode]", "simulation").attributes.get("aria-pressed"), "true");
  assert.equal(view.get("[data-robotics-home-status]").textContent, "Preflight failed; physical run blocked and KILL remains latched: encoder mismatch.");
}));

test("teleop open response must explicitly succeed before connection becomes available", () => withBrowserGlobals(async () => {
  const view = harness(async (path) => {
    if (path === "/api/robotics/config/discover") return {};
    if (path === "/api/teleop/open") return { ok: false, iframe: "/api/teleop/p/ticket/8443/teleop", detail: "not authorized" };
    return { ok: true };
  });

  await view.click("[data-robotics-home-connect]");
  assert.equal(view.get("[data-robotics-home-state]").textContent, "DISCONNECTED");
  assert.match(view.get("[data-robotics-home-status]").textContent, /^not authorized/);
}));

test("selected demo target drives both discovery and teleop connection", () => withBrowserGlobals(async () => {
  const requests = [];
  const view = harness(async (path, options = {}) => {
    requests.push([path, options.body ? JSON.parse(options.body) : null]);
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    return { ok: true };
  });
  await view.change("[data-robotics-hardware-target]", "http://192.168.1.77:8450/robotics/config");
  await view.click("[data-robotics-home-connect]");
  assert.deepEqual(requests.find(([path]) => path === "/api/robotics/config/discover"), ["/api/robotics/config/discover", { url: "http://192.168.1.77:8450/robotics/config" }]);
  assert.deepEqual(requests.find(([path]) => path === "/api/teleop/open"), ["/api/teleop/open", { url: "https://192.168.1.77:8443/teleop" }]);
  await view.change("[data-robotics-hardware-target]", "http://192.168.1.78:8450/robotics/config");
  await view.click("[data-robotics-mode]", "hardware");
  assert.equal(requests.filter(([path]) => path === "/api/robotics/config/discover").length, 1);
  assert.equal(view.get("[data-robotics-home-state]").textContent, "DISCONNECTED");
}));

test("Run on real robot always stops and homes before replaying the selected VR Emote", () => withBrowserGlobals(async () => {
  const requests = [];
  let playbackStatus = 0;
  const view = harness(async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push([path, body]);
    if (path === "/api/robotics/workspace") return { presets: [{ id: "viser-1", name: "Tray", role: "init" }] };
    if (path === "/api/robotics/config/discover") return { profile: "openarm" };
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/emotes")) return { recordings: [{ id: "take-1", name: "Pick cube" }], loops: [] };
    if (path.endsWith("/robotics/kill")) return { ok: true, armed: false, homing: false, pending_arm: false, playing: false };
    if (path.endsWith("/robotics/home")) return { ok: true, homing: true };
    if (path.endsWith("/emote/play")) return { ok: true, playing: true };
    if (path.endsWith("/robotics/status")) {
      playbackStatus += 1;
      return playbackStatus === 1
        ? { ok: true, home_supported: true, calibrated: true, armed: false, homing: false, pending_arm: false, playing: false, ...VERIFIED_HOME }
        : { ok: true, home_supported: true, calibrated: true, armed: false, homing: false, pending_arm: false, playing: false, ...VERIFIED_HOME };
    }
    return { ok: true };
  });

  await view.click("[data-robotics-home-connect]");
  await view.change("[data-robotics-start-position]", "emote:take-1");
  await view.click("[data-robotics-run-real]");

  assert.deepEqual(requests.filter(([path]) => /\/(robotics\/kill|robotics\/home|emote\/play|robotics\/status)$/.test(path)), [
    ["/api/teleop/p/ticket/8443/robotics/status", null],
    ["/api/teleop/p/ticket/8443/robotics/kill", { source: "robotics_home_real_run" }],
    ["/api/teleop/p/ticket/8443/robotics/home", { action: "home", pose: "arms_down", orientation: "canonical", both_arms: true, require_clear: true, require_calibrated: true, require_controller_poses: false, verify_joint_limits: true, speed_scale: 0.15 }],
    ["/api/teleop/p/ticket/8443/robotics/status", null],
    ["/api/teleop/p/ticket/8443/emote/play", { id: "take-1" }],
    ["/api/teleop/p/ticket/8443/robotics/status", null],
  ]);
  assert.equal(view.get("[data-robotics-home-status]").textContent, "Real run complete: Home was verified before “Pick cube”, and all motion producers are stopped.");
}));

test("default Home run stops and homes without requiring or replaying an Emote", () => withBrowserGlobals(async () => {
  const requests = [];
  const view = harness(async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push([path, body]);
    if (path === "/api/robotics/config/discover") return { profile: "openarm" };
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/robotics/kill")) return { ok: true, armed: false, homing: false, pending_arm: false, playing: false };
    if (path.endsWith("/robotics/home")) return { ok: true, homing: true };
    if (path.endsWith("/robotics/status")) return { ok: true, guarded_home: true, calibrated: true, armed: false, homing: false, pending_arm: false, playing: false, ...VERIFIED_HOME };
    return { ok: true };
  });

  await view.click("[data-robotics-home-connect]");
  assert.equal(view.get("[data-robotics-run-real]").textContent, "Run guarded Home");
  const emoteLookupsBeforeRun = requests.filter(([path]) => path.endsWith("/emotes")).length;
  await view.click("[data-robotics-run-real]");

  assert.equal(requests.filter(([path]) => path.endsWith("/emotes")).length, emoteLookupsBeforeRun);
  assert.equal(requests.some(([path]) => path.endsWith("/emote/play")), false);
  assert.deepEqual(requests.filter(([path]) => /\/robotics\/(kill|home)$/.test(path)).map(([path]) => path.split("/").at(-1)), ["kill", "home"]);
  assert.match(view.get("[data-robotics-home-status]").textContent, /Home verified/);
}));

test("old Pi without guarded Home is pinged and blocked with a copyable debug reason", () => withBrowserGlobals(async () => {
  const requests = [];
  const view = harness(async (path, options = {}) => {
    requests.push(path);
    if (path === "/api/robotics/config/discover") return { profile: "openarm" };
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/emotes")) return { recordings: [{ id: "take-1", name: "Pick cube" }], loops: [] };
    if (path.endsWith("/robotics/status")) return { ok: true, version: "1.0.1", armed: false, playing: false };
    return { ok: true };
  });
  await view.click("[data-robotics-home-connect]");
  await view.change("[data-robotics-start-position]", "emote:take-1");
  await view.click("[data-robotics-run-real]");
  assert.equal(requests.some((path) => path.endsWith("/robotics/status")), true);
  assert.equal(requests.some((path) => path.endsWith("/robotics/kill") || path.endsWith("/robotics/home") || path.endsWith("/emote/play")), false);
  assert.match(view.get("[data-robotics-home-status]").textContent, /does not advertise guarded Home/);
  assert.match(view.get("[data-robotics-run-debug]").textContent, /guarded_home=false/);
}));

test("a stopped Pi without verified Home never reports success or enables Hardware", () => withBrowserGlobals(async () => {
  const requests = [];
  const view = harness(async (path, options = {}) => {
    requests.push(path);
    if (path === "/api/robotics/config/discover") return { profile: "openarm" };
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/robotics/kill")) return { ok: true, armed: false, homing: false, pending_arm: false, playing: false };
    if (path.endsWith("/robotics/home")) return { ok: true, homing: true };
    if (path.endsWith("/robotics/status")) {
      return { ok: true, guarded_home: true, calibrated: true, armed: false, holding: false, homing: false, pending_arm: false, playing: false };
    }
    return { ok: true };
  });

  await view.click("[data-robotics-home-connect]");
  await view.click("[data-robotics-run-real]");

  assert.equal(view.get("[data-robotics-home-state]").textContent, "FAULT · KILL LATCHED");
  assert.equal(view.get("[data-robotics-mode]", "simulation").attributes.get("aria-pressed"), "true");
  assert.match(view.get("[data-robotics-home-status]").textContent, /without verifying arms-down convergence and actuator safe hold/);
  assert.equal(requests.filter((path) => path.endsWith("/robotics/kill")).length, 2);
}));

test("a selected Viser position opens planning guidance without touching hardware", () => withBrowserGlobals(async () => {
  const requests = [];
  let viserOpened = 0;
  const view = harness(async (path, options = {}) => {
    requests.push([path, options]);
    if (path === "/api/robotics/workspace") return { presets: [{ id: "viser-1", name: "Tray", role: "init" }] };
    return { ok: true };
  }, { onOpenViser: () => { viserOpened += 1; } });
  await view.settle();
  await view.change("[data-robotics-start-position]", "viser:viser-1");
  await view.click("[data-robotics-run-real]");
  assert.match(view.get("[data-robotics-home-status]").textContent, /visual planning target only/);
  assert.equal(view.get("[data-robotics-open-start-viser]").focused, true);
  assert.deepEqual(requests.filter(([path]) => path.includes("/api/teleop/")), []);
  assert.equal(viserOpened, 0);
}));

test("a rejected guarded home acknowledgement never enables Hardware", () => withBrowserGlobals(async () => {
  const requests = [];
  const view = harness(async (path) => {
    requests.push(path);
    if (path === "/api/teleop/open") return { ok: true, iframe: "/api/teleop/p/ticket/8443/teleop" };
    if (path.endsWith("/home")) return { ok: false, detail: "robot calibration unavailable" };
    return { ok: true };
  });
  await view.click("[data-robotics-home-connect]");
  await view.click("[data-robotics-mode]", "hardware");
  assert.equal(requests.some((path) => path.endsWith("/calibrate")), false);
  assert.equal(requests.some((path) => path.endsWith("/home")), true);
  assert.equal(view.get("[data-robotics-home-state]").textContent, "FAULT · KILL LATCHED");
  assert.match(view.get("[data-robotics-home-status]").textContent, /robot calibration unavailable/);
}));
