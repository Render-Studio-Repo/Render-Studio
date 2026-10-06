import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  wilsonLower,
  nextTrainingStep,
  TRAIN1_TOKEN,
  ROBOTICS_EPISODE_DIR,
  episodeDirForSource,
  dimosFrameToSample,
  createTrainingLoop,
  recordingSampleChunks,
  recordingCaptureMetadata,
  MAX_EPISODE_SAMPLES,
} from "./openarm-training-loop.js";

test("chunked UTF-8 sample files preserve every row above the old 400-sample cap", () => {
  const samples = Array.from({ length: 450 }, (_, sequence) => ({ sequence, note: "機".repeat(250) }));
  const chunks = recordingSampleChunks(samples, "openarm-robotics/episodes/ep_test");
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].path, "openarm-robotics/episodes/ep_test.jsonl");
  assert.equal(chunks[1].path, "openarm-robotics/episodes/ep_test.part-0002.jsonl");
  assert.ok(chunks.every((chunk) => new TextEncoder().encode(chunk.text).length <= 90_000));
  assert.equal(chunks.reduce((n, chunk) => n + chunk.sample_count, 0), 450);
  assert.deepEqual(chunks.flatMap((chunk) => chunk.text.trim().split("\n").map(JSON.parse)), samples);
});

test("capture metadata does not claim telemetry and commands are complete training datasets", () => {
  assert.equal(recordingCaptureMetadata("viser").capture_kind, "telemetry_only");
  assert.ok(recordingCaptureMetadata("viser").missing_fields.includes("commanded_actions"));
  assert.equal(recordingCaptureMetadata("dimos").capture_kind, "commanded_ee_poses");
  assert.ok(recordingCaptureMetadata("dimos").missing_fields.includes("measured_joint_state"));
  assert.equal(recordingCaptureMetadata("mujoco").capture_kind, "simulation_telemetry");
  for (const source of ["viser", "dimos", "mujoco"]) assert.equal(recordingCaptureMetadata(source).training_ready, false);
});

test("an active MuJoCo recording ingests the bounded live run stream", async () => {
  const old = { window: globalThis.window, document: globalThis.document };
  let onMessage;
  globalThis.window = {
    addEventListener(type, handler) { if (type === "message") onMessage = handler; },
    removeEventListener() {},
  };
  globalThis.document = { querySelectorAll: () => [] };
  try {
    const loop = createTrainingLoop();
    await loop.startDemo({ source: "mujoco", projectId: "p1", demo: "cell/demo.xml" });
    onMessage({ data: { type: "openarm-mujoco-live-sample", sample: {
      scene: "cell/demo.xml",
      joints: [{ name: "openarm_left_joint1", qpos: 0.25 }],
      observed_at: "2026-09-23T23:01:00.000Z",
    } } });
    assert.equal(loop.getState().samples, 1);
    loop.dispose();
  } finally { Object.assign(globalThis, old); }
});

test("capacity stops capture explicitly and failed chunk retry preserves outcome and rows", async () => {
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const writes = new Map();
  let failChunk = true;
  let status = "";
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { querySelectorAll: () => [] };
  globalThis.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (body.action === "write") {
      if (failChunk && body.path.endsWith(".part-0002.jsonl")) return { ok: false };
      writes.set(body.path, body.text);
    }
    return { ok: true, json: async () => ({ text: "" }) };
  };
  try {
    const loop = createTrainingLoop({ onStatus: (value) => { status = value; } });
    await loop.startRobotDemo({ source: "viser" });
    for (let i = 0; i < MAX_EPISODE_SAMPLES; i += 1) assert.equal(loop.ingestSample({ value: i }), true);
    assert.equal(loop.ingestSample({ value: "overflow" }), false);
    assert.equal(loop.getState().recording, false);
    assert.equal(loop.getState().samples, MAX_EPISODE_SAMPLES);
    assert.match(status, /capacity reached/);
    const first = await loop.markSuccess();
    assert.equal(first.ok, false);
    assert.equal(writes.has("openarm-robotics/episodes/latest.json"), false);
    assert.equal(loop.attachPiTake({ name: "late" }), false);
    failChunk = false;
    const saved = await loop.markFail("changed after save failed");
    assert.equal(saved.ok, true);
    assert.equal(saved.episode.outcome.success, true);
    assert.equal(saved.episode.ended_at, first.episode.ended_at);
    assert.equal(saved.episode.capture_stopped_reason, "recording_capacity_reached");
    const rows = saved.episode.sample_chunks.flatMap((chunk) => writes.get(chunk.path).trim().split("\n").map(JSON.parse));
    assert.equal(rows.length, MAX_EPISODE_SAMPLES);
    assert.equal(rows.at(-1).value, MAX_EPISODE_SAMPLES - 1);
    loop.dispose();
  } finally { Object.assign(globalThis, old); }
});

test("failed saves retain samples for retry and Stop does not label success", async () => {
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const writes = [];
  let fail = true;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { querySelectorAll: () => [] };
  globalThis.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (body.action === "write") { writes.push(body); return { ok: !fail }; }
    return { ok: true, json: async () => ({ text: "" }) };
  };
  try {
    const loop = createTrainingLoop();
    await loop.startRobotDemo({ source: "viser", projectId: "p1", demo: "cell/demo.xml", robot: "pi" });
    for (let i = 0; i < 3; i += 1) loop.ingestViserQpos({ openarm_left_joint1: i / 10 });
    const episodeId = loop.getState().episodeId;
    assert.equal((await loop.saveRecording()).ok, false);
    assert.equal(loop.getState().samples, 3);
    assert.equal((await loop.startRobotDemo({ source: "dimos" })).reason, "unsaved_episode");
    assert.equal(loop.getState().episodeId, episodeId);
    fail = false;
    const saved = await loop.retrySave();
    assert.equal(saved.ok, true);
    assert.equal(saved.episode.outcome.success, null);
    assert.equal(saved.episode.project_id, "p1");
    assert.equal(saved.episode.demo, "cell/demo.xml");
    assert.equal(saved.episode.robot, "pi");
    assert.equal(saved.episode.data_source, "viser");
    assert.equal(loop.getState().episodeId, null);
    const stream = writes.find((w) => w.path.endsWith(".jsonl"));
    assert.equal(stream.text.trim().split("\n").length, 3);
    loop.dispose();
  } finally { Object.assign(globalThis, old); }
});

test("wilson lower and holdout gate match training_plan intent", () => {
  assert.equal(TRAIN1_TOKEN, "train1");
  assert.ok(wilsonLower(16, 20) >= 0.55);
  assert.ok(wilsonLower(0, 0) === 0);
  const early = nextTrainingStep([]);
  assert.equal(early.action, "run_5_more_heldout_trials");
  const ready = nextTrainingStep(
    Array.from({ length: 20 }, () => ({ success: true, valid: true, hard_limit_violations: 0 })),
  );
  assert.equal(ready.action, "stop_and_report_heldout_success");
  const broken = nextTrainingStep([{ success: false, valid: true, hard_limit_violations: 1, failure_mode: "collision" }]);
  assert.equal(broken.action, "repair_harness_or_safety_gate");
});

test("robotics hardware episodes use separate MCP dir", () => {
  assert.equal(ROBOTICS_EPISODE_DIR, "openarm-robotics/episodes");
  assert.equal(episodeDirForSource("mujoco"), "openarm-mujoco/episodes");
  assert.equal(episodeDirForSource("dimos"), ROBOTICS_EPISODE_DIR);
  const sample = dimosFrameToSample({ leftPose: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 } }, 1, "demo");
  assert.equal(sample.action.action_space, "dimos_ee_pose");
});

test("agent bar and repair loop wire train controls", () => {
  const bar = readFileSync(new URL("./sandbox-agent-bar.js", import.meta.url), "utf8");
  const repair = readFileSync(new URL("./repair-loop.js", import.meta.url), "utf8");
  assert.match(bar, /getSharedTrainingLoop|createTrainingLoop/);
  assert.match(bar, /data-sb-train-demo/);
  assert.match(bar, /data-sb-train-policy/);
  assert.match(repair, /openarm\.train_episode/);
  assert.match(repair, /openarm\.train_gate/);
});
