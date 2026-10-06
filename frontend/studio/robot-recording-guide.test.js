import { test } from "node:test";
import assert from "node:assert/strict";
import { createRobotRecordingGuide } from "./robot-recording-guide.js";

test("guide names the exact safe button sequence", () => {
  let selected = null;
  const guide = createRobotRecordingGuide({ getSelection: () => selected });
  assert.equal(guide.snapshot().step.nextButton, "Stop & save");
  guide.recordingSaved();
  assert.equal(guide.snapshot().step.nextButton, "Robot recording files");
  selected = { path: "openarm-robotics/episodes/run-42.json" };
  guide.selectionChanged();
  assert.equal(guide.snapshot().step.nextButton, "Open Viser");
});

test("Do it for me opens saved files but never records or controls hardware", async () => {
  const actions = [];
  const guide = createRobotRecordingGuide({
    getSelection: () => null,
    openExplorer: (request) => actions.push(["explorer", request]),
  });
  await guide.doItForMe();
  assert.deepEqual(actions, [["explorer", { purpose: "select-recording" }]]);
  assert.equal(guide.snapshot().step.id, "select");
});

test("Do it for me passes one selected recording and literal recommended Viser settings", async () => {
  const actions = [];
  const selected = { id: "run-42", manifest_path: "openarm-robotics/episodes/run-42.json", source: "viser" };
  const normalized = { ...selected, path: selected.manifest_path };
  const guide = createRobotRecordingGuide({
    getSelection: () => selected,
    onSelectRecording: (request) => actions.push(["select", request]),
    openViser: (request) => actions.push(["viser", request]),
  });
  assert.equal(guide.snapshot().step.id, "visualize");
  await guide.doItForMe();
  assert.deepEqual(actions, [
    ["select", { recording: normalized, settings: { playbackSpeed: 1, showTrajectory: true, showCameraFrustums: true, showCoordinateFrames: true, followRobot: false } }],
    ["viser", { recording: normalized, settings: { playbackSpeed: 1, showTrajectory: true, showCameraFrustums: true, showCoordinateFrames: true, followRobot: false } }],
  ]);
  assert.equal(guide.snapshot().step.id, "review");
});

test("missing selection keeps the guide on choose recording and reopens the explorer", async () => {
  const statuses = [];
  let opens = 0;
  const guide = createRobotRecordingGuide({
    getSelection: () => null,
    openExplorer: () => { opens += 1; },
    onStatus: (kind, message) => statuses.push([kind, message]),
  });
  guide.setStep("select");
  await guide.doItForMe();
  assert.equal(opens, 1);
  assert.deepEqual(statuses[0], ["error", "Select a saved recording first. Opening Robot recording files."]);
  assert.equal(guide.snapshot().step.id, "select");
});
