import { SIMULATION_SCENES } from "./simulation-viewer.js?v=20260928-act-grasp-fix1";
import { hardwareRunEventJournalMarkup } from "./hardware-run-event-journal.js?v=20260929-step4-debug1";

export const ROBOTICS_WORKFLOW_STEPS = [
  { id: "demo", number: 1, title: "Choose the robotics setup", action: "Use selected setup", target: ".robotics-dataset-panel", control: "[data-robotics-profile-load]", purpose: "Loads one matched robot-learning package for the remaining steps.", prerequisite: "Open a project. Use Demo OpenArm for the printed cube workflow.", success: "The profile synchronizes the robot, dataset, camera roles, action schema, MuJoCo scene, pinned checkpoint revision, and safety target.", note: "Demo OpenArm is the verified cube setup. Loading it never moves the physical robot. Recordings are examples, not setups." },
  { id: "simulate", number: 2, title: "Select and run a virtual scene", action: "Load and run selected scene", target: "[data-robotics-deployment]", control: "[data-robotics-start-sim]", purpose: "Searches the bundled MuJoCo scenes, starts the selected workcell, and runs its matched verified example when one exists.", prerequisite: "Load a robotics setup first, then choose a scene. Keep the operating mode on Simulation.", success: "The selected scene opens with a new run ID. A compatible example runs in that same scene and reports PASS or FAIL.", note: "Cube pick runs the ACT checkpoint automatically so a PASS can be prepared for the Pi. Scenes without a matched policy open as passive simulations and are labeled before you start them." },
  { id: "train", number: 3, title: "Configure a new PPO policy", action: "Run RL preflight", target: "[data-robotics-rl]", control: "[data-rl-preflight]", purpose: "Checks the actor/critic runtime, reward setup, scene, and demonstration data before training.", prerequisite: "Save the training profile. Install every dependency that preflight marks FAIL.", success: "Every preflight row says PASS and Start PPO training becomes available.", note: "ACT demonstrations can bootstrap the actor. PPO then improves it from rewards. A trained result must still pass fixed-seed evaluation." },
  { id: "hardware", number: 4, title: "Prepare and run physical hardware", action: "Open full hardware controls", target: ".robotics-start-position", control: null, purpose: "Selects the Pi, checks calibration and deployment gates, then exposes the guarded Home and policy run controls.", prerequisite: "A simulation PASS is necessary but not sufficient. Select OpenArm Pi and pass every deployment gate before motion.", success: "The Pi reports READY, guarded Home succeeds, and each physical episode pauses for PASS or FAIL review.", note: "Every motion button still requires the workspace-clear confirmation and keeps the physical E-stop path in force." },
];

const SCENE_LABELS = Object.freeze({
  "cell/demo.xml": "Cube pick demo · verified example ready",
  "cell/cell.xml": "Empty cell",
  "openarm_bimanual.xml": "OpenArm bimanual",
});

const SCENE_EXAMPLES = Object.freeze({
  "cell/demo.xml": "hf-model:enactic/act-openarm-2-cell-pick_up_cube_mujoco",
});

export function workflowSceneOptions(query = "") {
  const needle = String(query || "").trim().toLowerCase();
  return SIMULATION_SCENES.map((scene) => ({
    scene,
    label: SCENE_LABELS[scene] || scene.replace(/\.xml$/i, "").replaceAll("_", " ").replaceAll("/", " · "),
    exampleKey: SCENE_EXAMPLES[scene] || "",
    policyReady: !!SCENE_EXAMPLES[scene],
  })).filter((item) => !needle || `${item.scene} ${item.label}`.toLowerCase().includes(needle));
}

export function workflowSceneDraft(scene, projectId = "") {
  const selected = workflowSceneOptions().find((item) => item.scene === String(scene || ""));
  if (!selected) return null;
  return {
    engine: "mujoco",
    scene: selected.scene,
    label: selected.label,
    sourcePath: selected.scene,
    projectId: String(projectId || ""),
    hardwareTarget: "",
    exampleKey: selected.exampleKey,
    policyReady: selected.policyReady,
  };
}

const workflowPresetKey = () => {
  const project = new URLSearchParams(globalThis.location?.search || "").get("project") || "global";
  return `render3d:robotics:workflow-preset:${project}`;
};

export function workflowProgress({ demoInstalled = false, sceneLoaded = false, evaluationState = "NOT RUN", rlReady = false, hardwareReady = false } = {}) {
  const evaluation = String(evaluationState || "NOT RUN").toUpperCase();
  const passed = evaluation === "PASS";
  const failed = evaluation === "FAIL";
  const currentId = !demoInstalled && !sceneLoaded ? "demo" : passed ? "hardware" : "simulate";
  const statuses = {
    demo: demoInstalled || sceneLoaded ? "complete" : "current",
    simulate: evaluation === "RUNNING" ? "running" : passed ? "pass" : failed ? "fail" : currentId === "simulate" ? "current" : "locked",
    train: rlReady ? "complete" : passed ? "optional" : "locked",
    hardware: hardwareReady ? "complete" : passed ? "current" : "locked",
  };
  const message = evaluation === "RUNNING" ? "Stay on step 2. The selected scene and example are still running."
    : passed ? "Step 2 passed. Step 3 is optional training; step 4 is available to review the separate physical deployment gates."
    : failed ? "Step 2 failed. Retry the simulation before reviewing physical deployment gates."
    : currentId === "simulate" ? "Choose a scene, then load it and run its compatible example in one step."
    : currentId === "demo" ? "Start by preparing Demo OpenArm." : "Review the next unlocked step.";
  return { currentId, statuses, message };
}

function workflowProfileOptions() {
  const source = globalThis.document?.querySelector?.("[data-robotics-profile-select]");
  const rows = [...(source?.options || [])].filter((option) => option.value);
  const profiles = rows.map((option) => `<option value="${option.value.replace(/&/g, "&amp;").replace(/\"/g, "&quot;")}"${option.selected ? " selected" : ""}>Profile · ${option.textContent}</option>`).join("")
    || '<option value="__install__">Install Demo OpenArm starter</option>';
  return profiles;
}

function sceneChooser(query = "", selected = "cell/demo.xml") {
  const options = workflowSceneOptions(query);
  return `<div class="robotics-workflow-scene-picker"><label class="muted small">Search scenes<input class="profile-pretty-input" type="search" data-workflow-scene-search value="${String(query).replace(/\"/g, "&quot;")}" placeholder="Cube, bottle, valve, peg…" /></label><label class="muted small">Scene<select class="profile-pretty-input" data-workflow-scene-select>${options.map((item) => `<option value="${item.scene}"${item.scene === selected ? " selected" : ""}>${item.label}${item.policyReady ? "" : " · no validated policy"}</option>`).join("") || '<option value="">No matching scenes</option>'}</select></label></div>`;
}

function simulationResult() {
  const policy = globalThis.document?.querySelector?.("[data-robotics-policy-current]")?.textContent || "No policy selected";
  const state = globalThis.document?.querySelector?.("[data-robotics-policy-stat-state]")?.textContent || "NOT RUN";
  const reason = globalThis.document?.querySelector?.("[data-robotics-policy-stat-reason]")?.textContent || "Run the selected policy to evaluate it.";
  return `<div class="robotics-workflow-evaluation" data-workflow-evaluation><small>ACT evaluation</small><strong data-workflow-evaluation-state>${state}</strong><span data-workflow-evaluation-policy>${policy}</span><p data-workflow-evaluation-reason>${reason}</p></div>`;
}

function hardwareControls() {
  const start = globalThis.document?.querySelector?.("[data-robotics-start-position]");
  const startOptions = [...(start?.options || [])].map((option) => `<option value="${String(option.value).replace(/&/g, "&amp;").replace(/\"/g, "&quot;")}"${option.selected ? " selected" : ""}>${option.textContent}</option>`).join("")
    || '<option value="home:home">Home · arms down</option>';
  const policy = globalThis.document?.querySelector?.("[data-robotics-policy-current]")?.textContent || "No policy loaded from Step 2";
  return `<div class="robotics-workflow-hardware-setup">
    <label class="muted small">Starting position<select class="profile-pretty-input" data-workflow-hardware-start>${startOptions}</select></label>
    <div class="robotics-workflow-loaded-policy"><small>Policy loaded from Step 2</small><strong data-workflow-hardware-policy>${policy}</strong></div>
  </div><div class="robotics-workflow-hardware-actions" aria-label="Physical hardware run controls">
    <button type="button" class="btn secondary btn-compact" data-workflow-hardware="select">1 · Select OpenArm Pi</button>
    <button type="button" class="btn secondary btn-compact" data-workflow-hardware="prepare">2 · Prepare Pi + check gates</button>
    <button type="button" class="btn secondary btn-compact" data-workflow-hardware="home">3 · Run guarded Home</button>
    <button type="button" class="btn accent btn-compact" data-workflow-hardware="policy">Run hardware sequence · Steps 1–4</button>
  </div>${hardwareRunEventJournalMarkup()}`;
}

function stepMarkup(step, active, status = "locked", sceneQuery = "", selectedScene = "cell/demo.xml") {
  const locked = status === "locked";
  const label = { complete: "DONE", current: "NEXT", running: "RUNNING", pass: "PASS", fail: "FAIL", optional: "OPTIONAL", locked: "LOCKED" }[status];
  const chooser = step.id === "demo" ? `<label class="muted small">Setup for every step<select class="profile-pretty-input" data-workflow-profile-select>${workflowProfileOptions()}</select></label>` : "";
  const scenes = step.id === "simulate" ? `${sceneChooser(sceneQuery, selectedScene)}${simulationResult()}` : "";
  const hardware = step.id === "hardware" ? hardwareControls() : "";
  const action = step.id === "simulate" && !workflowSceneDraft(selectedScene)?.policyReady ? "Load selected scene" : step.action;
  return `<article class="robotics-workflow-step is-${status}${active ? " is-active" : ""}" data-workflow-step="${step.id}"><button type="button" class="robotics-workflow-step-head" data-workflow-select="${step.id}" aria-expanded="${active}"${locked ? " disabled" : ""}><span>${step.number}</span><div><strong>${step.title}</strong><small>${step.purpose}</small></div><em>${label}</em><b aria-hidden="true">${active ? "−" : "+"}</b></button><div class="robotics-workflow-step-body"${active ? "" : " hidden"}><dl><div><dt>Before</dt><dd>${step.prerequisite}</dd></div><div><dt>Working when</dt><dd>${step.success}</dd></div><div><dt>Important</dt><dd>${step.note}</dd></div></dl>${chooser}${scenes}${hardware}<button type="button" class="btn ${step.control ? "accent" : "secondary"} btn-compact" data-workflow-action="${step.id}">${action}</button></div></article>`;
}

export function renderRoboticsWorkflow(activeId = "demo", progress = workflowProgress(), sceneQuery = "", selectedScene = "cell/demo.xml") {
  return `<p class="robotics-workflow-now"><strong>Current instruction</strong><span>${progress.message}</span></p>${ROBOTICS_WORKFLOW_STEPS.map((step) => stepMarkup(step, step.id === activeId, progress.statuses[step.id], sceneQuery, selectedScene)).join("")}`;
}

export function mountRoboticsHomeWorkflow(root, { onLoadScene = null, onRunHardwarePolicy = null, getProjectId = null, hardwareRunJournal = null } = {}) {
  if (!root) return null;
  let activeId = "demo";
  let progress = workflowProgress();
  let sceneQuery = "";
  let selectedScene = "cell/demo.xml";
  let signature = "";
  const readProgress = () => workflowProgress({
    demoInstalled: /installed/i.test(document.querySelector("[data-robotics-demo-state]")?.textContent || ""),
    sceneLoaded: !/no demo loaded/i.test(document.querySelector("[data-robotics-deployment-label]")?.textContent || "No demo loaded"),
    // Robotics Home owns the verified example result. Prefer it over a stale
    // experimental ACT panel that is not part of the working Examples list.
    evaluationState: document.querySelector("[data-robotics-policy-stat-state]")?.textContent || document.querySelector("[data-simulation-eval-state]")?.textContent || "NOT RUN",
    rlReady: /ready/i.test(document.querySelector("[data-rl-state]")?.textContent || ""),
    hardwareReady: /ready/i.test(document.querySelector("[data-robotics-policy-stat-hardware]")?.textContent || ""),
  });
  const paintDebug = () => {
    const output = root.querySelector("[data-step4-debug-output]");
    if (output) output.textContent = hardwareRunJournal?.snapshot?.().length ? hardwareRunJournal.text() : "No Step 4 events yet.";
  };
  const render = () => { root.innerHTML = renderRoboticsWorkflow(activeId, progress, sceneQuery, selectedScene); paintDebug(); };
  const activateWorkflowProfile = () => {
    const selected = root.querySelector("[data-workflow-profile-select]")?.value || "";
    try { globalThis.localStorage?.setItem(workflowPresetKey(), selected); } catch { /* optional preference */ }
    if (selected === "__install__") return document.querySelector("[data-robotics-demo-install]")?.click();
    const canonical = document.querySelector("[data-robotics-profile-select]");
    if (!selected || !canonical) return;
    canonical.value = selected;
    canonical.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("[data-robotics-profile-load]")?.click();
  };
  const sync = () => {
    const next = readProgress();
    const profiles = [...(document.querySelector("[data-robotics-profile-select]")?.options || [])].map((option) => [option.value, option.textContent, option.selected]);
    // Step 4 mirrors the canonical Step 2 selection. Include that label in the
    // signature so its MutationObserver can repaint after a scene/policy swap.
    const policy = document.querySelector("[data-robotics-policy-current]")?.textContent || "";
    const reason = document.querySelector("[data-robotics-policy-stat-reason]")?.textContent || "";
    const nextSignature = JSON.stringify([next, profiles, policy, reason]);
    if (nextSignature === signature) return;
    signature = nextSignature; progress = next; activeId = next.currentId; render();
  };
  root.addEventListener("click", async (event) => {
    const hardwareAction = event.target.closest("[data-workflow-hardware]")?.dataset.workflowHardware;
    if (hardwareAction) {
      hardwareRunJournal?.add?.("button", "PRESS", `Step 4 ${hardwareAction}`);
      const selectors = { prepare: "[data-robotics-policy-validate]", home: "[data-robotics-home-pose]" };
      if (hardwareAction === "select") {
        const target = document.querySelector("[data-robotics-hardware-target]");
        const first = [...(target?.options || [])].find((option) => option.value);
        if (target && first) {
          target.value = first.value;
          target.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
      if (hardwareAction === "policy") {
        await onRunHardwarePolicy?.();
        return;
      }
      const control = document.querySelector(selectors[hardwareAction]);
      if (control && !control.disabled) control.click();
      else {
        document.querySelector(".robotics-start-position")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
        document.querySelector(".robotics-start-position")?.classList.add("robotics-workflow-attention");
      }
      return;
    }
    if (event.target.closest("[data-step4-debug-copy]")) {
      await globalThis.navigator?.clipboard?.writeText?.(hardwareRunJournal?.text?.() || "No Step 4 events yet.");
      hardwareRunJournal?.add?.("debug log", "PASS", "Copied Step 4 debug logs");
      return;
    }
    if (event.target.closest("[data-step4-debug-clear]")) {
      hardwareRunJournal?.clear?.();
      return;
    }
    const select = event.target.closest("[data-workflow-select]");
    const action = event.target.closest("[data-workflow-action]");
    const id = select?.dataset.workflowSelect || action?.dataset.workflowAction;
    const step = ROBOTICS_WORKFLOW_STEPS.find((candidate) => candidate.id === id);
    if (!step) return;
    if (select) { activeId = activeId === id ? "" : id; render(); return; }
    if (step.id === "demo") { activateWorkflowProfile(); return; }
    if (step.id === "simulate") {
      const draft = workflowSceneDraft(selectedScene, getProjectId?.());
      if (!draft) return;
      const button = root.querySelector('[data-workflow-action="simulate"]');
      if (button) { button.disabled = true; button.textContent = "Loading scene…"; }
      try {
        const run = await onLoadScene?.(draft);
        if (!run || !draft.policyReady) return;
        const policySelect = document.querySelector("[data-robotics-policy-select]");
        if (policySelect) {
          policySelect.value = draft.exampleKey;
          policySelect.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          document.querySelector(`[data-policy-key="${draft.exampleKey}"]`)?.click();
        }
        await Promise.resolve();
        const runButton = document.querySelector("[data-robotics-run-policy]");
        if (runButton && !runButton.disabled) runButton.click();
      }
      finally {
        if (button?.isConnected) { button.disabled = false; button.textContent = step.action; }
      }
      return;
    }
    const target = document.querySelector(step.target);
    target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    if (step.control) {
      const control = document.querySelector(step.control);
      if (control && !control.disabled) {
        control.click();
      }
      else target?.classList.add("robotics-workflow-attention");
    }
  });
  root.addEventListener("change", (event) => {
    if (event.target?.matches?.("[data-workflow-profile-select]")) activateWorkflowProfile();
    if (event.target?.matches?.("[data-workflow-scene-select]")) {
      selectedScene = event.target.value;
      render();
    }
    if (event.target?.matches?.("[data-workflow-hardware-start]")) {
      const canonical = document.querySelector("[data-robotics-start-position]");
      if (canonical) {
        canonical.value = event.target.value;
        canonical.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  });
  root.addEventListener("input", (event) => {
    if (!event.target?.matches?.("[data-workflow-scene-search]")) return;
    sceneQuery = event.target.value;
    const matches = workflowSceneOptions(sceneQuery);
    if (!matches.some((item) => item.scene === selectedScene)) selectedScene = matches[0]?.scene || "";
    render();
    root.querySelector("[data-workflow-scene-search]")?.focus?.();
  });
  const observer = new MutationObserver(sync);
  const unsubscribeDebug = hardwareRunJournal?.subscribe?.(paintDebug) || (() => {});
  ["[data-robotics-demo-state]", "[data-robotics-profile-select]", "[data-robotics-deployment-label]", "[data-simulation-eval-state]", "[data-robotics-policy-stat-state]", "[data-robotics-policy-stat-reason]", "[data-robotics-policy-current]", "[data-robotics-start-detail]", "[data-rl-state]", "[data-robotics-policy-stat-hardware]"].forEach((selector) => {
    const element = document.querySelector(selector); if (element) observer.observe(element, { childList: true, characterData: true, subtree: true });
  });
  sync();
  return { get activeId() { return activeId; }, steps: ROBOTICS_WORKFLOW_STEPS, destroy: () => { unsubscribeDebug(); observer.disconnect(); } };
}
