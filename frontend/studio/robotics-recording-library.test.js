import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetFolder, datasetDestinationPayload, datasetDestinationStorageKey, datasetFolderStorageKey, filterRecordingLibrary, normalizeDatasetLibrary, recordingLibraryMarkup, recordingLibrarySummary, recordingMissingFields, selectDatasetDestination } from "./robotics-recording-library.js";

const ready = { id: "ready", name: "Ready demo", samples: 300, cameraCount: 3, hasTiming: true, hasCalibration: true, hasOutcome: true, trainingReady: true, official: true };
const motion = { id: "vr-1", name: "Quest cube take", samples: 90, cameraCount: 0, hasTiming: true, hasCalibration: false, hasOutcome: false, trainingReady: false, official: false };

test("recording readiness names every missing LeRobot field", () => {
  assert.deepEqual(recordingMissingFields(motion), ["3 synchronized cameras", "calibration", "outcome label"]);
  assert.deepEqual(recordingMissingFields(ready), []);
});

test("dataset library keeps Emotes built in and normalizes legacy Pi recordings", () => {
  const library = normalizeDatasetLibrary({ recordings: [{ id: "old", name: "Old take" }, { id: "train", folder_id: "cube-picks" }] }, [{ id: "cube-picks", name: "Cube picks" }]);
  assert.deepEqual(library.folders, [
    { id: "emotes", name: "Emotes", kind: "emote", builtIn: true },
    { id: "cube-picks", name: "Cube picks", kind: "training", builtIn: false },
  ]);
  assert.deepEqual(library.recordings.map(({ id, folderId }) => ({ id, folderId })), [{ id: "old", folderId: "emotes" }, { id: "train", folderId: "cube-picks" }]);
});

test("dataset library reconstructs a Pi training folder from saved recording metadata", () => {
  const library = normalizeDatasetLibrary({
    recordings: [{ id: "take-8", name: "Cube pick", folder_id: "cube-picks", folder_name: "Cube Picks" }],
  });
  assert.deepEqual(library.folders, [
    { id: "emotes", name: "Emotes", kind: "emote", builtIn: true },
    { id: "cube-picks", name: "Cube Picks", kind: "training", builtIn: false },
  ]);
  assert.equal(library.recordings[0].folderId, "cube-picks");
});

test("dataset folders get stable unique ids and destination payloads", () => {
  const folder = createDatasetFolder("Cube Picks", [{ id: "cube-picks" }]);
  assert.deepEqual(folder, { id: "cube-picks-2", name: "Cube Picks", kind: "training", builtIn: false });
  assert.deepEqual(datasetDestinationPayload(folder, { id: "take-7" }), { folder_id: "cube-picks-2", folder_name: "Cube Picks", recording_id: "take-7" });
});

test("destination payload keeps the legacy Emotes folder explicit", () => {
  assert.deepEqual(datasetDestinationPayload({ id: "emotes", name: "Emotes" }, { id: "take-1" }), {
    folder_id: "emotes", folder_name: "Emotes", recording_id: "take-1",
  });
});

test("active recording destination is project-scoped and falls back to Emotes", () => {
  const library = normalizeDatasetLibrary({}, [{ id: "cube-test", name: "Cube test" }]);
  assert.equal(datasetFolderStorageKey("project-7"), "render3d:robotics:dataset-folders:v1:project-7");
  assert.equal(datasetDestinationStorageKey("project-7"), "render3d:robotics:dataset-destination:v1:project-7");
  assert.equal(selectDatasetDestination(library, "cube-test").name, "Cube test");
  assert.equal(selectDatasetDestination(library, "deleted-folder").id, "emotes");
});

test("recording library filters VR takes separately from training-ready data", () => {
  assert.deepEqual(filterRecordingLibrary([ready, motion], { filter: "ready" }).map((item) => item.id), ["ready"]);
  assert.deepEqual(filterRecordingLibrary([ready, motion], { filter: "needs-video" }).map((item) => item.id), ["vr-1"]);
  assert.deepEqual(filterRecordingLibrary([ready, motion], { filter: "vr" }).map((item) => item.id), ["vr-1"]);
});

test("recording library exposes selection, starting pose, and honest readiness", () => {
  const html = recordingLibraryMarkup({ items: [ready, motion], selectedIds: new Set(["vr-1"]), connected: true });
  assert.match(html, /Ready demo[\s\S]*TRAINING READY/);
  assert.match(html, /Quest cube take[\s\S]*Missing 3 synchronized cameras, calibration, outcome label/);
  assert.match(html, /data-robotics-library-select="vr-1" aria-pressed="true"/);
  assert.match(html, /data-robotics-library-start="vr-1"/);
  assert.equal(recordingLibrarySummary([ready, motion], new Set(["ready", "vr-1"])), "2 recordings · 1 training-ready · 2 selected");
});
