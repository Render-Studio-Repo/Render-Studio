import test from "node:test";
import assert from "node:assert/strict";
import { ROBOTICS_WORKFLOW_STEPS, mountRoboticsHomeWorkflow, renderRoboticsWorkflow, workflowProgress, workflowSceneDraft, workflowSceneOptions } from "./robotics-home-workflow.js";

test("scene search filters bundled scenes and reports policy compatibility", () => {
  const cube = workflowSceneOptions("cube");
  assert.equal(cube.length, 1);
  assert.equal(cube[0].scene, "cell/demo.xml");
  assert.equal(cube[0].exampleKey, "hf-model:enactic/act-openarm-2-cell-pick_up_cube_mujoco");
  assert.equal(cube[0].policyReady, true);
  assert.ok(workflowSceneOptions("catch").some((item) => item.scene === "pedestal/catch_scene.xml" && !item.policyReady));
});

test("selected workflow scene becomes one complete simulation draft", () => {
  assert.deepEqual(workflowSceneDraft("cell/bottle_cell_scene.xml", "project-7"), {
    engine: "mujoco",
    scene: "cell/bottle_cell_scene.xml",
    label: "cell · bottle cell scene",
    sourcePath: "cell/bottle_cell_scene.xml",
    projectId: "project-7",
    hardwareTarget: "",
    exampleKey: "",
    policyReady: false,
  });
  assert.equal(workflowSceneDraft("missing.xml", "project-7"), null);
});

test("virtual-first workflow combines scene selection and example execution", () => {
  assert.deepEqual(ROBOTICS_WORKFLOW_STEPS.map(({ id }) => id), ["demo", "simulate", "train", "hardware"]);
  assert.match(ROBOTICS_WORKFLOW_STEPS[0].success, /synchronizes the robot, dataset/);
  assert.equal(ROBOTICS_WORKFLOW_STEPS[1].action, "Load and run selected scene");
  assert.match(ROBOTICS_WORKFLOW_STEPS[1].note, /ACT checkpoint automatically/);
  assert.match(ROBOTICS_WORKFLOW_STEPS[3].prerequisite, /simulation PASS is necessary but not sufficient/);
  assert.equal(ROBOTICS_WORKFLOW_STEPS[3].title, "Prepare and run physical hardware");
});

test("guide chooses one setup for later steps and expands only the selected step", () => {
  const html = renderRoboticsWorkflow("demo");
  assert.match(html, /data-workflow-profile-select/);
  assert.match(html, /Install Demo OpenArm starter/);
  assert.match(html, /data-workflow-scene-select/);
  assert.match(html, /Cube pick demo · verified example ready/);
  assert.match(html, /synchronizes the robot, dataset, camera roles/);
  assert.match(html, /data-workflow-step="demo"[\s\S]*?aria-expanded="true"/);
  assert.match(html, /data-workflow-step="simulate"[\s\S]*?aria-expanded="false"/);
  assert.match(html, /never moves the physical robot/);
});

test("scene action runs a compatible example but labels unmatched scenes as load only", () => {
  const cube = renderRoboticsWorkflow("simulate", workflowProgress({ demoInstalled: true }), "", "cell/demo.xml");
  assert.match(cube, /data-workflow-action="simulate">Load and run selected scene</);
  const bottle = renderRoboticsWorkflow("simulate", workflowProgress({ demoInstalled: true }), "", "cell/bottle_cell_scene.xml");
  assert.match(bottle, /data-workflow-action="simulate">Load selected scene</);
});

test("Step 2 sends the scene selected in its dropdown to the simulator", async () => {
  const priorDocument = globalThis.document;
  const priorObserver = globalThis.MutationObserver;
  let clickHandler = null;
  let changeHandler = null;
  const loaded = [];
  globalThis.document = { querySelector: () => null };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  const root = {
    innerHTML: "",
    querySelector: () => null,
    addEventListener(type, handler) {
      if (type === "click") clickHandler = handler;
      if (type === "change") changeHandler = handler;
    },
  };
  try {
    mountRoboticsHomeWorkflow(root, {
      onLoadScene: async (draft) => { loaded.push(draft); return { runId: "selected-scene-run" }; },
      getProjectId: () => "project-7",
    });
    changeHandler({
      target: {
        value: "cell/bottle_cell_scene.xml",
        matches: (selector) => selector === "[data-workflow-scene-select]",
      },
    });
    assert.match(root.innerHTML, /cell\/bottle_cell_scene\.xml" selected/);
    assert.match(root.innerHTML, /data-workflow-action="simulate">Load selected scene</);
    await clickHandler({
      target: {
        closest(selector) {
          return selector === "[data-workflow-action]" ? { dataset: { workflowAction: "simulate" } } : null;
        },
      },
    });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].scene, "cell/bottle_cell_scene.xml");
    assert.equal(loaded[0].projectId, "project-7");
    assert.equal(loaded[0].policyReady, false);
  } finally {
    globalThis.document = priorDocument;
    globalThis.MutationObserver = priorObserver;
  }
});

test("running example keeps combined step 2 current and locks PPO and hardware", () => {
  const progress = workflowProgress({ demoInstalled: true, sceneLoaded: true, evaluationState: "RUNNING" });
  assert.equal(progress.currentId, "simulate");
  assert.equal(progress.statuses.simulate, "running");
  assert.equal(progress.statuses.train, "locked");
  assert.equal(progress.statuses.hardware, "locked");
  assert.equal(progress.message, "Stay on step 2. The selected scene and example are still running.");
});

test("a passing evaluation makes PPO optional and unlocks physical gate review", () => {
  const progress = workflowProgress({ demoInstalled: true, sceneLoaded: true, evaluationState: "PASS" });
  assert.equal(progress.currentId, "hardware");
  assert.equal(progress.statuses.simulate, "pass");
  assert.equal(progress.statuses.train, "optional");
  assert.equal(progress.statuses.hardware, "current");
  assert.match(progress.message, /optional training.*physical deployment gates/);
  const html = renderRoboticsWorkflow("hardware", progress);
  assert.match(html, /1 · Select OpenArm Pi/);
  assert.match(html, /2 · Prepare Pi \+ check gates/);
  assert.match(html, /3 · Run guarded Home/);
  assert.match(html, /Starting position/);
  assert.match(html, /Policy loaded from Step 2/);
  assert.match(html, /Run hardware sequence · Steps 1–4/);
  assert.match(html, /ACT evaluation/);
});

test("a failed simulation keeps physical deployment review locked", () => {
  const progress = workflowProgress({ demoInstalled: true, sceneLoaded: true, evaluationState: "FAIL" });
  assert.equal(progress.currentId, "simulate");
  assert.equal(progress.statuses.simulate, "fail");
  assert.equal(progress.statuses.train, "locked");
  assert.equal(progress.statuses.hardware, "locked");
});

test("Step 4 policy action calls the dedicated hardware runner instead of the shared simulation button", async () => {
  const priorDocument = globalThis.document;
  const priorObserver = globalThis.MutationObserver;
  let clickHandler = null;
  let hardwareRuns = 0;
  globalThis.document = { querySelector: () => null };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  const root = {
    innerHTML: "",
    querySelector: () => null,
    addEventListener(type, handler) { if (type === "click") clickHandler = handler; },
  };
  try {
    mountRoboticsHomeWorkflow(root, { onRunHardwarePolicy: async () => { hardwareRuns += 1; } });
    await clickHandler({
      target: {
        closest(selector) {
          return selector === "[data-workflow-hardware]" ? { dataset: { workflowHardware: "policy" } } : null;
        },
      },
    });
    assert.equal(hardwareRuns, 1);
  } finally {
    globalThis.document = priorDocument;
    globalThis.MutationObserver = priorObserver;
  }
});

test("Step 3 uses guarded Home without starting a physical episode review", async () => {
  const priorDocument = globalThis.document;
  const priorObserver = globalThis.MutationObserver;
  let clickHandler = null;
  let guardedHomeClicks = 0;
  let realRunClicks = 0;
  const controls = {
    "[data-robotics-home-pose]": { disabled: false, click: () => { guardedHomeClicks += 1; } },
    "[data-robotics-run-real]": { disabled: false, click: () => { realRunClicks += 1; } },
  };
  globalThis.document = { querySelector: (selector) => controls[selector] || null };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  const root = {
    innerHTML: "",
    querySelector: () => null,
    addEventListener(type, handler) { if (type === "click") clickHandler = handler; },
  };
  try {
    mountRoboticsHomeWorkflow(root);
    await clickHandler({
      target: {
        closest(selector) {
          return selector === "[data-workflow-hardware]" ? { dataset: { workflowHardware: "home" } } : null;
        },
      },
    });
    assert.equal(guardedHomeClicks, 1);
    assert.equal(realRunClicks, 0);
  } finally {
    globalThis.document = priorDocument;
    globalThis.MutationObserver = priorObserver;
  }
});

test("Step 4 refreshes its copied policy label when Step 2 changes policy", () => {
  const priorDocument = globalThis.document;
  const priorObserver = globalThis.MutationObserver;
  let observerCallback = null;
  const currentPolicy = { textContent: "Verified cube pick · Episode 0 · verified demonstration" };
  const controls = {
    "[data-robotics-policy-current]": currentPolicy,
  };
  globalThis.document = { querySelector: (selector) => controls[selector] || null };
  globalThis.MutationObserver = class {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() {}
  };
  const root = {
    innerHTML: "",
    querySelector: () => null,
    addEventListener() {},
  };
  try {
    mountRoboticsHomeWorkflow(root);
    assert.match(root.innerHTML, /Verified cube pick · Episode 0 · verified demonstration/);
    currentPolicy.textContent = "Laundry folding · ACT checkpoint · validated hardware policy";
    observerCallback();
    assert.match(root.innerHTML, /Laundry folding · ACT checkpoint · validated hardware policy/);
    assert.doesNotMatch(root.innerHTML, /Verified cube pick · Episode 0 · verified demonstration/);
  } finally {
    globalThis.document = priorDocument;
    globalThis.MutationObserver = priorObserver;
  }
});
