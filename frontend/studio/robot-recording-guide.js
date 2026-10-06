const RECOMMENDED_VISER_SETTINGS = Object.freeze({
  playbackSpeed: 1,
  showTrajectory: true,
  showCameraFrustums: true,
  showCoordinateFrames: true,
  followRobot: false,
});

const GUIDE_STEPS = Object.freeze([
  Object.freeze({
    id: "save",
    title: "Save the episode",
    nextButton: "Stop & save",
    body: "Finish the current take with Stop & save. Render keeps the episode in Robot recording files. Render Agent will never start or stop a robot recording for you.",
    autoAction: "open-explorer",
    autoLabel: "Open saved recordings",
  }),
  Object.freeze({
    id: "select",
    title: "Choose a recording",
    nextButton: "Robot recording files",
    body: "Open Robot recording files and select one episode or manifest. Check its source, outcome, missing fields, and camera coverage before visualizing it.",
    autoAction: "open-explorer",
    autoLabel: "Open and choose",
    requiresSelection: true,
  }),
  Object.freeze({
    id: "visualize",
    title: "Load it in Viser",
    nextButton: "Open Viser",
    body: "Load the selected recording with trajectory, camera frustums, coordinate frames, and 1× playback. This only changes visualization settings. It does not move hardware or start training.",
    autoAction: "open-viser",
    autoLabel: "Load in Viser",
    requiresSelection: true,
  }),
  Object.freeze({
    id: "review",
    title: "Review before training",
    nextButton: "Play in Viser",
    body: "Play the full episode. Verify camera timing, joint order and units, measured state, commanded actions, and the success label. Repair incomplete episodes before adding them to a training split.",
    autoAction: "open-viser",
    autoLabel: "Show recommended view",
    requiresSelection: true,
  }),
]);

function validSelection(value) {
  if (typeof value === "string") return value.trim() ? { path: value.trim() } : null;
  if (!value || typeof value !== "object") return null;
  const path = String(value.manifest_path || value.path || value.file || "").trim();
  if (!path) return null;
  return { ...value, path };
}

export function createRobotRecordingGuide({ openExplorer, openViser, getSelection, onSelectRecording, onStatus, onChange } = {}) {
  let stepIndex = validSelection(getSelection?.()) ? 2 : 0;
  let open = false;
  let busy = false;

  const selection = () => validSelection(getSelection?.());
  const snapshot = () => ({
    open,
    busy,
    stepIndex,
    step: GUIDE_STEPS[stepIndex],
    selection: selection(),
    complete: stepIndex === GUIDE_STEPS.length - 1,
  });
  const changed = () => {
    const value = snapshot();
    onChange?.(value);
    return value;
  };
  const status = (message, kind = "ok") => onStatus?.(kind, message);

  function setOpen(value) {
    open = Boolean(value);
    return changed();
  }

  function setStep(id) {
    const next = GUIDE_STEPS.findIndex((step) => step.id === id);
    if (next < 0) return snapshot();
    stepIndex = next;
    return changed();
  }

  function selectionChanged() {
    if (selection() && stepIndex < 2) stepIndex = 2;
    return changed();
  }

  function recordingSaved() {
    if (stepIndex < 1) stepIndex = 1;
    open = true;
    status("Recording saved. Next, choose it in Robot recording files.");
    return changed();
  }

  function next() {
    const current = GUIDE_STEPS[stepIndex];
    if (current.requiresSelection && !selection()) {
      status("Select a saved recording in Robot recording files before continuing.", "error");
      return snapshot();
    }
    stepIndex = Math.min(GUIDE_STEPS.length - 1, stepIndex + 1);
    return changed();
  }

  async function doItForMe() {
    if (busy) return snapshot();
    const current = GUIDE_STEPS[stepIndex];
    const selected = selection();
    if (current.requiresSelection && !selected) {
      status("Select a saved recording first. Opening Robot recording files.", "error");
      await Promise.resolve(openExplorer?.({ purpose: "select-recording" }));
      return snapshot();
    }
    busy = true;
    changed();
    try {
      if (current.autoAction === "open-explorer") {
        await Promise.resolve(openExplorer?.({ purpose: "select-recording" }));
        if (stepIndex === 0) stepIndex = 1;
        status("Robot recording files opened. Select the episode you want to inspect.");
      } else if (current.autoAction === "open-viser") {
        const request = { recording: selected, settings: { ...RECOMMENDED_VISER_SETTINGS } };
        await Promise.resolve(onSelectRecording?.(request));
        await Promise.resolve(openViser?.(request));
        stepIndex = Math.max(stepIndex, 3);
        status("Recording loaded in Viser with the recommended review settings.");
      }
    } catch (error) {
      status(error?.message || "Render Agent could not complete this safe step.", "error");
    } finally {
      busy = false;
      changed();
    }
    return snapshot();
  }

  return { snapshot, setOpen, setStep, next, doItForMe, selectionChanged, recordingSaved };
}

function button(doc, label, action, className) {
  const node = doc.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  node.addEventListener("click", action);
  return node;
}

export function mountRobotRecordingGuide({ root, openExplorer, openViser, getSelection, onSelectRecording, onStatus } = {}) {
  if (!root?.append || !root.ownerDocument) return null;
  root.querySelector?.("[data-robot-recording-guide]")?.remove?.();
  const doc = root.ownerDocument;
  const host = doc.createElement("aside");
  host.className = "robot-recording-guide";
  host.dataset.robotRecordingGuide = "";
  host.setAttribute("aria-label", "Render Agent recording guide");

  const fab = button(doc, "", () => controller.setOpen(!controller.snapshot().open), "robot-recording-guide__fab");
  fab.setAttribute("aria-label", "Open Render Agent recording guide");
  fab.setAttribute("aria-expanded", "false");
  const logo = doc.createElement("img");
  logo.src = "/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1";
  logo.alt = "";
  logo.width = 32;
  logo.height = 32;
  const badge = doc.createElement("span");
  badge.className = "robot-recording-guide__badge";
  badge.textContent = "1";
  const tooltip = doc.createElement("span");
  tooltip.className = "robot-recording-guide__tooltip";
  tooltip.setAttribute("role", "tooltip");
  fab.append(logo, badge, tooltip);

  const card = doc.createElement("section");
  card.className = "robot-recording-guide__card";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Recording next steps");
  const eyebrow = doc.createElement("small");
  eyebrow.textContent = "RENDER AGENT · RECORDING WORKFLOW";
  const title = doc.createElement("strong");
  const body = doc.createElement("p");
  const exact = doc.createElement("p");
  exact.className = "robot-recording-guide__next";
  const actions = doc.createElement("div");
  actions.className = "robot-recording-guide__actions";
  const close = button(doc, "Close", () => controller.setOpen(false), "btn secondary btn-compact");
  const next = button(doc, "Next", () => controller.next(), "btn secondary btn-compact");
  const auto = button(doc, "Do it for me", () => void controller.doItForMe(), "btn accent btn-compact");
  actions.append(close, next, auto);
  card.append(eyebrow, title, body, exact, actions);
  host.append(fab, card);
  root.append(host);

  const controller = createRobotRecordingGuide({
    openExplorer,
    openViser,
    getSelection,
    onSelectRecording,
    onStatus,
    onChange: render,
  });

  function render(state) {
    fab.setAttribute("aria-expanded", String(state.open));
    card.hidden = !state.open;
    badge.hidden = state.open;
    tooltip.textContent = `Next: click ${state.step.nextButton}.`;
    title.textContent = state.step.title;
    body.textContent = state.step.body;
    exact.textContent = `Next button: ${state.step.nextButton}`;
    next.disabled = state.busy || (state.step.requiresSelection && !state.selection);
    auto.disabled = state.busy;
    auto.textContent = state.busy ? "Working…" : state.step.autoLabel;
  }

  render(controller.snapshot());
  return {
    ...controller,
    element: host,
    destroy() { host.remove(); },
  };
}

export { GUIDE_STEPS as ROBOT_RECORDING_GUIDE_STEPS, RECOMMENDED_VISER_SETTINGS };
