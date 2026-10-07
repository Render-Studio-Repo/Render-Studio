import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeViserRecording,
  addViserRecording,
  deliverViserRecording,
  loadViserRecording,
  normalizeViserRecordingDescriptor,
  readViserRecordingLibrary,
  recordingDescriptorFromText,
  selectViserRecording,
  viserRecordingStorageKey,
} from "./viser-recording-selection.js";

function episode(overrides = {}) {
  return {
    kind: "openarm_training_episode",
    episode_id: "ep_demo_1",
    project_id: "project-a",
    data_source: "viser",
    capture_kind: "telemetry_only",
    training_ready: false,
    missing_fields: ["commanded_actions", "synchronized_camera_frames"],
    sample_chunks: [{ path: "openarm-robotics/episodes/ep_demo_1.jsonl", sample_count: 2 }],
    task: "Inspect a grasp",
    ...overrides,
  };
}

function memoryStore() {
  const rows = new Map();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
  };
}

test("episode manifests become truthful project-scoped visualization descriptors", () => {
  const descriptor = recordingDescriptorFromText(JSON.stringify(episode()), {
    manifestPath: "openarm-robotics/episodes/ep_demo_1.json",
    projectId: "project-a",
  });
  assert.deepEqual(descriptor, {
    kind: "render3d_viser_recording/v1",
    id: "openarm-robotics/episodes/ep_demo_1.json",
    project_id: "project-a",
    episode_id: "ep_demo_1",
    source: "viser",
    manifest_path: "openarm-robotics/episodes/ep_demo_1.json",
    sample_chunks: [{ path: "openarm-robotics/episodes/ep_demo_1.jsonl", sample_count: 2 }],
    capture_kind: "telemetry_only",
    training_ready: false,
    missing_fields: ["commanded_actions", "synchronized_camera_frames"],
    task: "Inspect a grasp",
    recorded_at: "",
  });
  assert.equal(normalizeViserRecordingDescriptor(episode(), { manifestPath: "../secret.json" }), null);
  assert.equal(normalizeViserRecordingDescriptor(episode(), { manifestPath: "safe.json", projectId: "project-b" }), null);
  assert.equal(normalizeViserRecordingDescriptor(episode({ training_ready: true }), { manifestPath: "safe.json" }).training_ready, false);
});

test("recording choices stay isolated per project and retain an explicit active item", () => {
  const store = memoryStore();
  const first = normalizeViserRecordingDescriptor(episode(), { manifestPath: "openarm-robotics/episodes/ep_demo_1.json" });
  const second = normalizeViserRecordingDescriptor(episode({ episode_id: "ep_demo_2", sample_chunks: [{ path: "openarm-robotics/episodes/ep_demo_2.jsonl", sample_count: 1 }] }), { manifestPath: "openarm-robotics/episodes/ep_demo_2.json" });
  addViserRecording(first, { store, dispatch: false });
  addViserRecording(second, { store, dispatch: false });
  assert.equal(readViserRecordingLibrary("project-a", store).active_id, second.id);
  selectViserRecording("project-a", first.id, { store, dispatch: false });
  assert.equal(activeViserRecording("project-a", store).episode_id, "ep_demo_1");
  assert.deepEqual(readViserRecordingLibrary("project-b", store).recordings, []);
  assert.match(viserRecordingStorageKey("project-a"), /project-a$/);
});

test("loading a recording yields simulation or telemetry data without hardware replay", async () => {
  const descriptor = normalizeViserRecordingDescriptor(episode(), { manifestPath: "openarm-robotics/episodes/ep_demo_1.json" });
  const files = new Map([[descriptor.sample_chunks[0].path, '{"sequence":1,"observation":{"joints":[1]}}\nnot-json\n{"sequence":2,"observation":{"joints":[2]}}\n']]);
  const payload = await loadViserRecording(descriptor, async (path) => files.get(path), { maxSamples: 1 });
  assert.deepEqual(payload.samples, [{ sequence: 1, observation: { joints: [1] } }]);
  assert.equal(payload.visualization_kind, "telemetry");
  assert.equal(payload.total_sample_count, 2);
  assert.equal(payload.truncated, true);
  assert.equal(payload.can_replay_hardware, false);
  assert.equal(payload.training_ready, false);
  assert.deepEqual(payload.missing_fields, ["commanded_actions", "synchronized_camera_frames"]);
  const posted = [];
  const events = [];
  class TestEvent {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  }
  const message = deliverViserRecording(payload, {
    frameWindow: { postMessage: (value, origin) => posted.push([value, origin]) },
    eventTarget: { dispatchEvent: (event) => events.push(event) },
    CustomEventClass: TestEvent,
  });
  assert.equal(message.type, "studio-viser-recording");
  assert.equal(message.can_replay_hardware, false);
  assert.equal(posted[0][1], "*");
  assert.equal(events[0].detail.recording.project_id, "project-a");
});
