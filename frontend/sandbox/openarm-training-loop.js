/** OpenArm training loop: MuJoCo sim + DimOS/Pi hardware + Viser joint stream.
 * Does not train NN weights or command joints. Token train1.
 * Refs: LeRobot HIL/DAgger · OpenArm MuJoCo · DimOS Pi recorder · Viser.
 */

import { postContextEvent } from "./sandbox-context-log.js?v=ctxlog1";

export const TRAIN1_TOKEN = "train1";
export const EPISODE_DIR = "openarm-mujoco/episodes";
export const LATEST_EPISODE = `${EPISODE_DIR}/latest.json`;
export const ROBOTICS_EPISODE_DIR = "openarm-robotics/episodes";
export const ROBOTICS_LATEST_EPISODE = `${ROBOTICS_EPISODE_DIR}/latest.json`;
export const HOLDOUT_PATH = `${EPISODE_DIR}/holdout.jsonl`;
export const MANIFEST_PATH = `${EPISODE_DIR}/manifest.json`;
export const MAX_EPISODE_SAMPLES = 20_000;
const MAX_EPISODE_BYTES = 16_000_000;
const SAMPLE_CHUNK_BYTES = 90_000;

export function recordingCaptureMetadata(source) {
  const missing = source === "dimos" ? ["measured_joint_state", "synchronized_camera_frames"]
    : source === "viser" ? ["commanded_actions", "synchronized_camera_frames", "robot_calibration"]
      : ["commanded_actions", "synchronized_camera_frames"];
  return {
    capture_kind: source === "dimos" ? "commanded_ee_poses" : source === "viser" ? "telemetry_only" : "simulation_telemetry",
    training_ready: false,
    missing_fields: missing,
    dataset_format: "render-studio-recording/v1",
  };
}

export function recordingSampleChunks(samples, basePath) {
  const chunks = [];
  let text = "";
  let count = 0;
  let bytes = 0;
  const flush = () => {
    if (!count) return;
    chunks.push({ path: chunks.length ? `${basePath}.part-${String(chunks.length + 1).padStart(4, "0")}.jsonl` : `${basePath}.jsonl`, text, sample_count: count });
    text = ""; count = 0; bytes = 0;
  };
  for (const sample of samples) {
    const line = `${JSON.stringify(sample)}\n`;
    const size = new TextEncoder().encode(line).length;
    if (size > SAMPLE_CHUNK_BYTES) throw new Error("A sample exceeds the recording chunk size");
    if (bytes + size > SAMPLE_CHUNK_BYTES) flush();
    text += line; count += 1; bytes += size;
  }
  flush();
  return chunks;
}

/** @typedef {"mujoco"|"dimos"|"viser"} TrainDataSource */

function id() {
  return (globalThis.crypto?.randomUUID?.() || `ep${Date.now()}`).replace(/-/g, "").slice(0, 14);
}

function nowIso() {
  return new Date().toISOString();
}

async function mcpWrite(path, obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  if (text.length > 110_000) return false;
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", agent: "sam", path, text: text.slice(0, 110_000) }),
  }).catch(() => null);
  return !!(res && res.ok);
}

async function mcpRead(path) {
  const res = await fetch(`/mcp/sandbox/file?path=${encodeURIComponent(path)}&t=${Date.now()}`).catch(() => null);
  if (!res || !res.ok) return { ok: false, text: "" };
  const data = await res.json().catch(() => ({}));
  return { ok: true, text: String(data.text || "") };
}

/** Wilson 95% lower bound — same rule as demos/openarm-teleop-training/training_plan.py */
export function wilsonLower(successes, trials, z = 1.96) {
  if (trials <= 0) return 0;
  const p = successes / trials;
  const z2 = z * z;
  const den = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) / trials) + z2 / (4 * trials * trials));
  return Math.max(0, (centre - margin) / den);
}

export function nextTrainingStep(holdout, {
  targetLower = 0.8,
  minTrials = 20,
  maxTrials = 60,
} = {}) {
  const n = holdout.length;
  const successes = holdout.filter((r) => r.success === true).length;
  const hard = holdout.reduce((a, r) => a + Number(r.hard_limit_violations || 0), 0);
  const invalid = holdout.filter((r) => r.valid !== true).length;
  const lower = wilsonLower(successes, n);
  const failures = holdout.filter((r) => r.success === false).map((r) => r.failure_mode || "unknown");
  const mode = failures.length
    ? failures.sort((a, b) => failures.filter((x) => x === b).length - failures.filter((x) => x === a).length)[0]
    : null;
  let action = "run_5_more_heldout_trials";
  if (invalid || hard) action = "repair_harness_or_safety_gate";
  else if (n >= minTrials && lower >= targetLower) action = "stop_and_report_heldout_success";
  else if (n >= maxTrials) action = "stop_budget_exhausted_and_review";
  else if (mode) action = "collect_5_new_demos_for_failure_mode_then_retrain";
  return {
    action,
    heldout_trials: n,
    successes,
    wilson_95_lower: Math.round(lower * 1000) / 1000,
    target_lower: targetLower,
    hard_limit_violations: hard,
    invalid_trials: invalid,
    priority_failure_mode: mode,
    note: "Gate only — train weights externally (LeRobot). Never promote on synthetic viewport geometry alone.",
    token: TRAIN1_TOKEN,
  };
}

export function jointsToAction(joints = [], actionSpace = "mujoco_qpos") {
  const sideVals = { left: Array(8).fill(0), right: Array(8).fill(0) };
  for (const j of joints) {
    const m = String(j.name || "").match(/^openarm_(left|right)_joint(\d)$/);
    if (!m) continue;
    const idx = Number(m[2]) - 1;
    if (idx >= 0 && idx < 7) sideVals[m[1]][idx] = Number(j.qpos) || 0;
  }
  return {
    action_space: actionSpace,
    left: sideVals.left,
    right: sideVals.right,
  };
}

function gripPoseFromDimos(pose) {
  if (!pose) return null;
  return {
    position: [pose.x, pose.y, pose.z],
    quaternion: [pose.qx, pose.qy, pose.qz, pose.qw],
  };
}

/** VR / DimOS recordBuf frame → train sample (EE poses, not sim qpos). */
export function dimosFrameToSample(frame, seq, mode) {
  return {
    sequence: seq,
    timestamp_ms: performance.now(),
    observed_at: nowIso(),
    mode,
    observation: {
      left_pose: frame?.leftPose || null,
      right_pose: frame?.rightPose || null,
      left_joy: frame?.leftJoy || null,
      right_joy: frame?.rightJoy || null,
      t_ms: frame?.t,
    },
    action: {
      action_space: "dimos_ee_pose",
      left_grip_pose: gripPoseFromDimos(frame?.leftPose),
      right_grip_pose: gripPoseFromDimos(frame?.rightPose),
      left_gripper: Number(frame?.leftJoy?.axes?.[2]) || 0,
      right_gripper: Number(frame?.rightJoy?.axes?.[2]) || 0,
    },
  };
}

/** Viser / hardware joint map → train sample. */
export function viserQposToSample(qpos = {}, seq, mode) {
  const joints = Object.entries(qpos).map(([name, val]) => ({
    name,
    qpos: Number(val) || 0,
  }));
  return {
    sequence: seq,
    timestamp_ms: performance.now(),
    observed_at: nowIso(),
    mode,
    observation: { joints: joints.slice(0, 16), source: "viser" },
    action: null,
  };
}

export function episodeDirForSource(source = "mujoco") {
  return source === "mujoco" ? EPISODE_DIR : ROBOTICS_EPISODE_DIR;
}

export function latestEpisodePathForSource(source = "mujoco") {
  return source === "mujoco" ? LATEST_EPISODE : ROBOTICS_LATEST_EPISODE;
}

export function sourceLabelForDataSource(source = "mujoco") {
  if (source === "viser") return "dimos/viser_hardware";
  if (source === "dimos") return "dimos/pi_hardware";
  return "enactic/openarm_mujoco";
}

function sampleFromAnalysis(analysis, seq, mode) {
  return {
    sequence: seq,
    timestamp_ms: performance.now(),
    observed_at: nowIso(),
    mode,
    observation: {
      scene: analysis?.scene || "unknown",
      joints: (analysis?.joints || []).slice(0, 16),
      ik_errors: analysis?.ik_errors || {},
      feature_checks: analysis?.feature_checks || {},
    },
    action: null,
  };
}

/**
 * Create a training-loop controller. Parent page listens for MuJoCo analysis postMessages.
 */
export function createTrainingLoop({ onStatus = () => {}, speak } = {}) {
  let episode = null;
  let recording = false;
  let mode = "idle"; // idle | demo | policy | intervene
  let task = "Hey Astra, pick up the cube";
  let lastAnalysis = null;
  let seq = 0;
  let sampleBytes = 0;
  let pendingSave = null;

  const setStatus = (msg) => onStatus(msg);

  const onMessage = (ev) => {
    const type = ev?.data?.type;
    if (type === "openarm-mujoco-analysis" || type === "openarm-mujoco-live-sample") {
      lastAnalysis = ev.data.sample || null;
      if (!recording || !episode || episode.data_source !== "mujoco" || !lastAnalysis) return;
      ingestSample(sampleFromAnalysis(lastAnalysis, seq + 1, mode));
      return;
    }
    if (type === "openarm-viser-joints" && ev.data?.token === TRAIN1_TOKEN) {
      if (!recording || !episode || episode.data_source !== "viser") return;
      ingestSample(viserQposToSample(ev.data.qpos || {}, seq + 1, mode));
    }
  };
  window.addEventListener("message", onMessage);

  function setMujocoTrainHot(on) {
    document.querySelectorAll("iframe").forEach((frame) => {
      try {
        frame.contentWindow?.postMessage({ type: "openarm-train-hot", on: !!on, token: TRAIN1_TOKEN }, "*");
        if (on) frame.contentWindow?.postMessage({ type: "openarm-mujoco-request", token: TRAIN1_TOKEN }, "*");
      } catch { /* optional */ }
    });
  }

  function ingestSample(sample) {
    if (!recording || !episode || !sample) return false;
    const stored = JSON.parse(JSON.stringify({ ...sample, sequence: seq + 1 }));
    const bytes = new TextEncoder().encode(JSON.stringify(stored)).length + 1;
    if (episode.samples.length >= MAX_EPISODE_SAMPLES || sampleBytes + bytes > MAX_EPISODE_BYTES || bytes > SAMPLE_CHUNK_BYTES) {
      recording = false;
      episode.capture_stopped_reason = "recording_capacity_reached";
      if (episode.data_source === "mujoco") setMujocoTrainHot(false);
      setStatus("Recording capacity reached. Capture stopped; save this take before continuing.");
      return false;
    }
    seq += 1;
    sampleBytes += bytes;
    episode.samples.push(stored);
    setStatus(`${mode} · ${episode.data_source} · ${episode.samples.length} ticks · ${task.slice(0, 36)}`);
    return true;
  }

  async function persistEpisode() {
    if (!episode) return { ok: false };
    const dir = episode.episode_dir || EPISODE_DIR;
    const latest = dir === EPISODE_DIR ? LATEST_EPISODE : ROBOTICS_LATEST_EPISODE;
    const chunks = recordingSampleChunks(episode.samples, `${dir}/${episode.episode_id}`);
    const slim = {
      ...episode,
      sample_count: episode.samples.length,
      samples_preview: episode.samples.slice(0, 3).filter((sample) => JSON.stringify(sample).length < 10_000),
      samples: undefined,
      episode_dir: dir,
      sample_chunks: chunks.map(({ path, sample_count }) => ({ path, sample_count })),
    };
    for (const chunk of chunks) {
      if (!await mcpWrite(chunk.path, chunk.text)) return { ok: false, slim };
    }
    const okMeta = await mcpWrite(`${dir}/${episode.episode_id}.json`, slim);
    const okLatest = okMeta && await mcpWrite(latest, slim);
    return { ok: okMeta && okLatest, slim };
  }

  async function startEpisode(nextMode, { astraTask, source = "mujoco", projectId = "", demo = "", robot = "" } = {}) {
    if (episode) return { ok: false, reason: "unsaved_episode" };
    if (astraTask) task = String(astraTask).slice(0, 200);
    const dataSource = source === "dimos" || source === "viser" ? source : "mujoco";
    mode = nextMode;
    recording = true;
    seq = 0;
    sampleBytes = 0;
    episode = {
      kind: "openarm_training_episode",
      token: TRAIN1_TOKEN,
      episode_id: `ep_${id()}`,
      mode: nextMode,
      task,
      astra_instruction: task,
      started_at: nowIso(),
      open_arm: "2.0",
      source: sourceLabelForDataSource(dataSource),
      data_source: dataSource,
      ...recordingCaptureMetadata(dataSource),
      project_id: String(projectId),
      demo: String(demo),
      robot: String(robot),
      episode_dir: episodeDirForSource(dataSource),
      samples: [],
      outcome: null,
      feature_checks: {},
      note: dataSource === "mujoco"
        ? "Bounded live simulation telemetry. Commanded actions and synchronized camera frames are still required before training."
        : "Partial recording. Inspect missing_fields before dataset conversion or training.",
    };
    if (dataSource === "mujoco") setMujocoTrainHot(true);
    setStatus(`Recording ${nextMode} · ${dataSource} · “${task}”`);
    void postContextEvent({
      source: "sandbox-train",
      feature_id: "openarm.train.episode",
      event_kind: `${nextMode}_start`,
      target_id: episode.episode_id,
      context: { task: task.slice(0, 80), data_source: dataSource },
    });
    if (typeof speak === "function" && nextMode === "demo") {
      await speak("astra", `Demonstrate: ${task}`);
    }
    return structuredClone(episode);
  }

  async function stopEpisode({ success = null, failureMode = "", hardLimitViolations = 0 } = {}) {
    if (!episode) return { ok: false, reason: "no_episode" };
    recording = false;
    if (episode.data_source === "mujoco") setMujocoTrainHot(false);
    episode.ended_at ||= nowIso();
    episode.mode = mode;
    const valid = episode.samples.length >= 3;
    episode.outcome ||= {
      success: success === null ? null : success === true,
      failure_mode: success === false ? (failureMode || "unknown") : null,
      hard_limit_violations: Number(hardLimitViolations) || 0,
      valid,
      labeled_at: nowIso(),
    };
    if (!episode.feature_checks_saved) {
      episode.feature_checks = episode.data_source === "mujoco" ? structuredClone(lastAnalysis?.feature_checks || {}) : {};
      episode.feature_checks_saved = true;
    }
    const saved = await persistEpisode();
    if (!saved.ok) {
      setStatus("Save failed. Recording retained in memory. Retry saving before starting another take.");
      return { ok: false, reason: "save_failed", episode: structuredClone(saved.slim) };
    }

    // Append holdout row only for policy / intervene evaluation attempts.
    if ((mode === "policy" || mode === "intervene") && episode.outcome.success !== null) {
      const row = {
        episode_id: episode.episode_id,
        success: episode.outcome.success,
        failure_mode: episode.outcome.failure_mode,
        hard_limit_violations: episode.outcome.hard_limit_violations,
        valid: episode.outcome.valid,
        task,
        at: nowIso(),
      };
      const prev = await mcpRead(HOLDOUT_PATH);
      const next = `${prev.ok ? prev.text : ""}${JSON.stringify(row)}\n`;
      await mcpWrite(HOLDOUT_PATH, next.slice(-80_000));
    }

    const plan = await evaluateHoldout();
    void postContextEvent({
      source: "sandbox-train",
      feature_id: "openarm.train.episode",
      event_kind: "episode_end",
      target_id: episode.episode_id,
      context: { success: String(episode.outcome.success), mode, samples: String(episode.samples.length) },
    });

    const out = { ok: true, episode: saved.slim || episode, plan, token: TRAIN1_TOKEN };
    mode = "idle";
    episode = null;
    setStatus(`Saved · next: ${plan.action}`);
    return out;
  }

  function saveEpisode(options = {}) {
    if (pendingSave) return pendingSave;
    pendingSave = stopEpisode(options).finally(() => { pendingSave = null; });
    return pendingSave;
  }

  async function evaluateHoldout() {
    const raw = await mcpRead(HOLDOUT_PATH);
    const rows = [];
    if (raw.ok) {
      for (const line of raw.text.split("\n")) {
        if (!line.trim()) continue;
        try { rows.push(JSON.parse(line)); } catch { /* skip */ }
      }
    }
    const plan = nextTrainingStep(rows);
    await mcpWrite(MANIFEST_PATH, {
      kind: "openarm_train_manifest",
      token: TRAIN1_TOKEN,
      updated_at: nowIso(),
      holdout_count: rows.length,
      plan,
      paths: {
        episodes: EPISODE_DIR,
        robotics_episodes: ROBOTICS_EPISODE_DIR,
        holdout: HOLDOUT_PATH,
        latest: LATEST_EPISODE,
        robotics_latest: ROBOTICS_LATEST_EPISODE,
        mujoco_feed: "openarm-mujoco/runs/latest.json",
        policy_runner: "demos/openarm-teleop-training/openarm2_mujoco_policy.py",
      },
      promote_gate: plan.action === "stop_and_report_heldout_success"
        ? "candidate_ready_for_external_retrain_compare"
        : "do_not_promote",
    });
    return plan;
  }

  return {
    token: TRAIN1_TOKEN,
    getState: () => ({
      recording,
      mode,
      task,
      episodeId: episode?.episode_id || null,
      samples: episode?.samples?.length || 0,
      dataSource: episode?.data_source || null,
      episodeDir: episode?.episode_dir || null,
      captureStoppedReason: episode?.capture_stopped_reason || null,
      saving: !!pendingSave,
    }),
    setTask: (t) => { task = String(t || task).slice(0, 200); },
    startDemo: (opts) => startEpisode("demo", opts),
    startPolicyTry: (opts) => startEpisode("policy", opts),
    startIntervene: (opts) => startEpisode("intervene", opts),
    startRobotDemo: (opts) => startEpisode("demo", { ...opts, source: opts?.source || "dimos" }),
    ingestSample,
    ingestDimosFrame: (frame) => ingestSample(dimosFrameToSample(frame, seq + 1, mode)),
    ingestViserQpos: (qpos) => ingestSample(viserQposToSample(qpos, seq + 1, mode)),
    attachPiTake: (detail = {}) => {
      if (!recording || !episode) return false;
      episode.pi_take = {
        name: String(detail.name || ""),
        samples: Number(detail.samples) || 0,
        at: nowIso(),
      };
      return ingestSample({
        sequence: seq + 1,
        timestamp_ms: performance.now(),
        observed_at: nowIso(),
        mode,
        observation: { pi_take: episode.pi_take },
        action: { action_space: "pi_take_ref", ref: episode.pi_take.name },
      });
    },
    markSuccess: () => saveEpisode({ success: true }),
    saveRecording: () => saveEpisode(),
    retrySave: () => saveEpisode(),
    markFail: (failureMode = "miss") => saveEpisode({ success: false, failureMode }),
    evaluateHoldout,
    dispose: () => window.removeEventListener("message", onMessage),
  };
}

let sharedLoop = null;

/** One train loop for agent bar + teaching record (single analysis listener). */
export function getSharedTrainingLoop(opts = {}) {
  if (!sharedLoop) sharedLoop = createTrainingLoop(opts);
  return sharedLoop;
}
