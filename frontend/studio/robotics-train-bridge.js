/**
 * Robotics tab training bridge — DimOS Pi recorder + Viser joints → train1 episodes.
 * MuJoCo sim demos stay on the MuJoCo tab / sandbox agent bar.
 */

import {
  ROBOTICS_LATEST_EPISODE,
  TRAIN1_TOKEN,
  dimosFrameToSample,
  getSharedTrainingLoop,
} from "../sandbox/openarm-training-loop.js?v=20260923-draw-recordings1&simrun=20260923-1";
import {
  copyDimosRecordClip,
  getDimosRecordState,
  onDimosRecordFrame,
  onDimosTeleopChange,
  peekDimosTrainingFrame,
  startDimosRecord,
  stopDimosRecord,
} from "../xr/xr-dimos-teleop.js?v=20260929-y-record1";
import { VISER_JOINT_EVENT } from "./viser-viewer.js?v=robotics-train1&vrrobot=20260927-2";

export const ROBOTICS_TRAIN_EVENT = "render3d:robotics-train";

const SAMPLE_MIN_MS = 90;

function dispatchTrain(detail) {
  globalThis.dispatchEvent?.(new CustomEvent(ROBOTICS_TRAIN_EVENT, { detail }));
}

async function fetchLatestEpisode() {
  const res = await fetch(`/mcp/sandbox/file?path=${encodeURIComponent(ROBOTICS_LATEST_EPISODE)}&t=${Date.now()}`).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data?.text) return null;
  try { return JSON.parse(data.text); } catch { return null; }
}

/** Prefer Viser qpos when joints are streaming; else DimOS EE poses from VR / Pi. */
export function pickRobotTrainSource({ selectedSource = "dimos" } = {}) {
  return ["mujoco", "viser", "dimos"].includes(selectedSource) ? selectedSource : "dimos";
}

export function mountRoboticsTrainPanel(root, {
  onStatus = () => {},
  getTrainingLoop = getSharedTrainingLoop,
  getRecordingContext = () => ({}),
} = {}) {
  if (!root) return null;

  const loop = getTrainingLoop({ onStatus: (msg) => {
    setLine(msg);
    onStatus("ok", msg);
  } });

  let activeSource = "dimos";
  let pollTimer = 0;
  let lastSampleAt = 0;
  let seenFrames = new Set();

  const taskInput = root.querySelector("[data-robotics-train-task]");
  const sourceEl = root.querySelector("[data-robotics-train-source]");
  const sourceSelect = root.querySelector("[data-robotics-train-source-select]");
  const statusEl = root.querySelector("[data-robotics-train-status]");
  const summaryEl = root.querySelector("[data-robotics-train-summary]");
  const pathEl = root.querySelector("[data-robotics-train-path]");
  const btnRecord = root.querySelector("[data-robotics-train-record]");
  const btnStop = root.querySelector("[data-robotics-train-stop]");
  const btnOk = root.querySelector("[data-robotics-train-ok]");
  const btnFail = root.querySelector("[data-robotics-train-fail]");
  const btnRefresh = root.querySelector("[data-robotics-train-refresh]");

  if (pathEl) pathEl.textContent = ROBOTICS_LATEST_EPISODE;

  const setLine = (msg) => {
    if (statusEl) statusEl.textContent = String(msg || "Idle");
  };

  const syncSourceLabel = () => {
    if (!sourceEl) return;
    const st = loop.getState();
    const label = st.recording ? (st.dataSource || activeSource) : activeSource;
    sourceEl.textContent = label === "mujoco" ? "MuJoCo simulation" : label === "viser" ? "Viser joints" : "DimOS / Quest EE";
  };

  const stopPoll = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = 0;
    }
    seenFrames.clear();
  };

  const ingestDimosIfNew = (frame) => {
    if (!frame || (!frame.leftPose && !frame.rightPose)) return;
    const key = `${frame.t}|${frame.leftPose?.x}|${frame.rightPose?.x}`;
    if (seenFrames.has(key)) return;
    seenFrames.add(key);
    if (seenFrames.size > 500) seenFrames.clear();
    loop.ingestDimosFrame(frame);
  };

  const flushClipIfNeeded = () => {
    const st = loop.getState();
    if (!st.recording || st.samples >= 3) return;
    const clip = copyDimosRecordClip();
    if (clip.length < 2) return;
    let seqBase = st.samples;
    for (const frame of clip) {
      seqBase += 1;
      loop.ingestSample(dimosFrameToSample(frame, seqBase, st.mode || "demo"));
    }
  };

  const startPoll = () => {
    stopPoll();
    pollTimer = setInterval(() => {
      const st = loop.getState();
      if (!st.recording) return;
      const now = performance.now();
      if (now - lastSampleAt < SAMPLE_MIN_MS) return;
      if (st.dataSource === "dimos") {
        const frame = peekDimosTrainingFrame();
        if (frame) {
          lastSampleAt = now;
          ingestDimosIfNew(frame);
        }
      }
      syncSourceLabel();
      dispatchTrain({ kind: "tick", state: loop.getState() });
    }, SAMPLE_MIN_MS);
  };

  const onViserJoints = (e) => {
    const qpos = e?.detail?.qpos || {};
    const keys = Object.keys(qpos).length;
    if (keys && loop.getState().recording && loop.getState().dataSource === "viser") {
      lastSampleAt = performance.now();
      loop.ingestViserQpos(qpos);
    }
    syncSourceLabel();
  };

  const onPiAction = (e) => {
    const detail = e?.detail || {};
    if (!loop.getState().recording) return;
    if (detail.action === "confirm" || detail.action === "emote_saved") {
      loop.attachPiTake(detail);
      setLine(`Pi take “${detail.name || "saved"}” · ${detail.samples || 0} samples on recorder`);
    }
  };

  const onDimosChange = () => {
    const rec = getDimosRecordState();
    if (btnRecord) btnRecord.setAttribute("aria-pressed", rec.recording ? "true" : "false");
    syncSourceLabel();
  };

  const refreshSummary = async () => {
    const latest = await fetchLatestEpisode();
    if (!summaryEl) return;
    if (!latest) {
      summaryEl.textContent = "No hardware episodes yet — record a Quest demo or open Viser with joint sliders.";
      return;
    }
    const out = latest.outcome || {};
    summaryEl.textContent = `${latest.episode_id?.slice(0, 12) || "?"} · ${latest.data_source || latest.source} · ${latest.sample_count ?? 0} samples · success=${out.success}`;
  };

  const startPolicyEvaluation = async ({ task, source = "dimos", ...context } = {}) => {
    if (loop.getState().recording) return { ok: false, reason: "recording_active", state: loop.getState() };
    const instruction = String(task || taskInput?.value || "Pick up the cube").slice(0, 200);
    loop.setTask(instruction);
    activeSource = pickRobotTrainSource({ selectedSource: source });
    const started = await loop.startPolicyTry({ ...getRecordingContext(), ...context, source: activeSource });
    if (started?.ok === false) {
      setLine("Save the pending take before starting a physical evaluation.");
      return { ok: false, error: started.reason || "pending take", started, state: loop.getState() };
    }
    if (activeSource === "dimos") startDimosRecord();
    startPoll();
    syncSourceLabel();
    setLine(`Recording physical evaluation · ${activeSource}`);
    dispatchTrain({ kind: "policy-evaluation-start", state: loop.getState() });
    return { ok: true, started, state: loop.getState() };
  };

  const pausePolicyEvaluation = () => {
    if (loop.getState().dataSource === "dimos") { stopDimosRecord(); flushClipIfNeeded(); }
    stopPoll();
    setLine("Physical run stopped · waiting for PASS / FAIL review");
    dispatchTrain({ kind: "policy-evaluation-review", state: loop.getState() });
    return loop.getState();
  };

  const finishPolicyEvaluation = async ({ result, reason = "" } = {}) => {
    pausePolicyEvaluation();
    const out = result === "pass" ? await loop.markSuccess()
      : result === "fail" ? await loop.markFail(reason || "hardware_miss")
      : await loop.saveRecording();
    setLine(out?.ok ? `Physical evaluation saved · ${result || "unlabeled"}` : "Physical evaluation save failed; retry before another run");
    void refreshSummary();
    dispatchTrain({ kind: "policy-evaluation-saved", result, out });
    return out;
  };

  btnRecord?.addEventListener("click", async () => {
    const task = String(taskInput?.value || loop.getState().task || "Pick up the cube").slice(0, 200);
    loop.setTask(task);
    activeSource = pickRobotTrainSource({ selectedSource: sourceSelect?.value });
    const started = await loop.startRobotDemo({ ...getRecordingContext(), astraTask: task, source: activeSource });
    if (started?.ok === false) {
      setLine("Save the current take before recording another. Stop / Save retries an unsaved take.");
      return;
    }
    if (activeSource === "dimos") startDimosRecord();
    startPoll();
    syncSourceLabel();
    setLine(`Recording · ${activeSource}`);
    dispatchTrain({ kind: "start", state: loop.getState() });
  });

  btnStop?.addEventListener("click", async () => {
    if (loop.getState().dataSource === "dimos") { stopDimosRecord(); flushClipIfNeeded(); }
    stopPoll();
    const out = await loop.saveRecording();
    syncSourceLabel();
    setLine(out?.ok ? `Saved without outcome label · ${out.episode?.episode_id?.slice(0, 12) || ""}` : "Save failed or no take. A failed save stays in memory; press Stop / Save to retry.");
    void refreshSummary();
    dispatchTrain({ kind: "stop", state: loop.getState(), out });
  });

  btnOk?.addEventListener("click", async () => {
    if (loop.getState().dataSource === "dimos") { stopDimosRecord(); flushClipIfNeeded(); }
    stopPoll();
    await loop.markSuccess();
    syncSourceLabel();
    void refreshSummary();
  });

  btnFail?.addEventListener("click", async () => {
    if (loop.getState().dataSource === "dimos") stopDimosRecord();
    stopPoll();
    await loop.markFail("hardware_miss");
    syncSourceLabel();
    void refreshSummary();
  });

  btnRefresh?.addEventListener("click", () => { void refreshSummary(); });

  const offFrame = onDimosRecordFrame((frame) => {
    if (loop.getState().recording && loop.getState().dataSource === "dimos") ingestDimosIfNew(frame);
  });
  const offDimos = onDimosTeleopChange(onDimosChange);
  globalThis.addEventListener(VISER_JOINT_EVENT, onViserJoints);
  globalThis.addEventListener("render3d:pi-action", onPiAction);

  onDimosChange();
  void refreshSummary();
  syncSourceLabel();

  return {
    token: TRAIN1_TOKEN,
    getLoop: () => loop,
    refreshSummary,
    startPolicyEvaluation,
    pausePolicyEvaluation,
    finishPolicyEvaluation,
    dispose: () => {
      stopPoll();
      offFrame();
      offDimos();
      globalThis.removeEventListener(VISER_JOINT_EVENT, onViserJoints);
      globalThis.removeEventListener("render3d:pi-action", onPiAction);
    },
  };
}
