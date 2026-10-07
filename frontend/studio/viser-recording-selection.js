export const VISER_RECORDING_LIBRARY_VERSION = 1;
export const VISER_RECORDING_EVENT = "render3d:viser-recording-selection";
export const VISER_RECORDING_LOADED_EVENT = "render3d:viser-recording-loaded";
export const MAX_VISER_RECORDING_SAMPLES = 5000;

const SOURCES = new Set(["mujoco", "viser", "dimos"]);
const CAPTURE_KINDS = new Set(["simulation_snapshots", "telemetry_only", "commanded_ee_poses"]);

function safePath(value, extension = "") {
  const path = String(value || "").trim().replace(/\\/g, "/");
  if (!path || path.startsWith("/") || path.split("/").includes("..")) return "";
  if (extension && !path.toLowerCase().endsWith(extension)) return "";
  return path;
}

function cleanProjectId(value) {
  return String(value || "").trim().slice(0, 160);
}

export function viserRecordingStorageKey(projectId) {
  const id = cleanProjectId(projectId);
  if (!id) return "";
  return `render3d:viser-recordings:v${VISER_RECORDING_LIBRARY_VERSION}:${encodeURIComponent(id)}`;
}

export function normalizeViserRecordingDescriptor(raw, { manifestPath = "", projectId = "" } = {}) {
  const source = String(raw?.data_source || raw?.source || "").trim().toLowerCase();
  const captureKind = String(raw?.capture_kind || "").trim();
  const descriptorProjectId = cleanProjectId(raw?.project_id || projectId);
  const expectedProjectId = cleanProjectId(projectId);
  const resolvedManifestPath = safePath(manifestPath || raw?.manifest_path, ".json");
  const episodeId = String(raw?.episode_id || "").trim().slice(0, 180);
  if (!["openarm_training_episode", "render3d_viser_recording/v1"].includes(raw?.kind) || !SOURCES.has(source) || !CAPTURE_KINDS.has(captureKind)) return null;
  if (!descriptorProjectId || (expectedProjectId && descriptorProjectId !== expectedProjectId)) return null;
  if (!resolvedManifestPath || !episodeId) return null;
  const sampleChunks = (Array.isArray(raw?.sample_chunks) ? raw.sample_chunks : [])
    .map((chunk) => ({
      path: safePath(typeof chunk === "string" ? chunk : chunk?.path, ".jsonl"),
      sample_count: Math.max(0, Math.floor(Number(typeof chunk === "string" ? 0 : chunk?.sample_count) || 0)),
    }))
    .filter((chunk) => chunk.path);
  if (!sampleChunks.length) return null;
  const missingFields = [...new Set((Array.isArray(raw?.missing_fields) ? raw.missing_fields : [])
    .map((field) => String(field || "").trim()).filter(Boolean).slice(0, 40))];
  return {
    kind: "render3d_viser_recording/v1",
    id: resolvedManifestPath,
    project_id: descriptorProjectId,
    episode_id: episodeId,
    source,
    manifest_path: resolvedManifestPath,
    sample_chunks: sampleChunks,
    capture_kind: captureKind,
    training_ready: raw?.training_ready === true && missingFields.length === 0,
    missing_fields: missingFields,
    task: String(raw?.task || "").trim().slice(0, 240),
    recorded_at: String(raw?.ended_at || raw?.started_at || "").trim().slice(0, 80),
  };
}

export function recordingDescriptorFromText(text, options = {}) {
  try {
    return normalizeViserRecordingDescriptor(JSON.parse(String(text || "")), options);
  } catch {
    return null;
  }
}

function storeOrDefault(store) {
  if (store) return store;
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function readViserRecordingLibrary(projectId, store) {
  const key = viserRecordingStorageKey(projectId);
  if (!key) return { project_id: "", active_id: "", recordings: [] };
  try {
    const parsed = JSON.parse(storeOrDefault(store)?.getItem(key) || "{}");
    const recordings = (Array.isArray(parsed?.recordings) ? parsed.recordings : [])
      .map((row) => normalizeViserRecordingDescriptor(row, { manifestPath: row?.manifest_path, projectId }))
      .filter(Boolean);
    const active = recordings.some((row) => row.id === parsed?.active_id) ? String(parsed.active_id) : (recordings[0]?.id || "");
    return { project_id: cleanProjectId(projectId), active_id: active, recordings };
  } catch {
    return { project_id: cleanProjectId(projectId), active_id: "", recordings: [] };
  }
}

function writeLibrary(library, store) {
  const key = viserRecordingStorageKey(library?.project_id);
  if (!key) throw new Error("A project is required before selecting a Viser recording.");
  storeOrDefault(store)?.setItem(key, JSON.stringify(library));
  return library;
}

export function addViserRecording(descriptor, { store, dispatch = true } = {}) {
  const normalized = normalizeViserRecordingDescriptor(descriptor, {
    manifestPath: descriptor?.manifest_path,
    projectId: descriptor?.project_id,
  });
  if (!normalized) throw new Error("This file is not a project-scoped robot recording manifest.");
  const previous = readViserRecordingLibrary(normalized.project_id, store);
  const recordings = [normalized, ...previous.recordings.filter((row) => row.id !== normalized.id)].slice(0, 40);
  const library = writeLibrary({ project_id: normalized.project_id, active_id: normalized.id, recordings }, store);
  if (dispatch) dispatchRecordingEvent(normalized);
  return library;
}

export function selectViserRecording(projectId, recordingId, { store, dispatch = true } = {}) {
  const previous = readViserRecordingLibrary(projectId, store);
  const selected = previous.recordings.find((row) => row.id === String(recordingId || ""));
  if (!selected) throw new Error("The selected recording is not saved for this project.");
  const library = writeLibrary({ ...previous, active_id: selected.id }, store);
  if (dispatch) dispatchRecordingEvent(selected);
  return library;
}

export function activeViserRecording(projectId, store) {
  const library = readViserRecordingLibrary(projectId, store);
  return library.recordings.find((row) => row.id === library.active_id) || null;
}

export function recordingVisualizationKind(descriptor) {
  return descriptor?.source === "mujoco" && descriptor?.capture_kind === "simulation_snapshots"
    ? "simulation"
    : "telemetry";
}

export function viserRecordingLabel(descriptor) {
  const source = descriptor?.source === "mujoco" ? "Simulation" : descriptor?.source === "viser" ? "Viser telemetry" : "Hardware capture";
  const task = String(descriptor?.task || descriptor?.episode_id || "Recording").trim();
  return `${source} · ${task}`;
}

export async function loadViserRecording(descriptor, readText, { maxSamples = MAX_VISER_RECORDING_SAMPLES } = {}) {
  const normalized = normalizeViserRecordingDescriptor(descriptor, {
    manifestPath: descriptor?.manifest_path,
    projectId: descriptor?.project_id,
  });
  if (!normalized) throw new Error("The selected recording descriptor is invalid.");
  if (typeof readText !== "function") throw new Error("A recording file reader is required.");
  const samples = [];
  let invalid_lines = 0;
  let total_sample_count = 0;
  for (const chunk of normalized.sample_chunks) {
    total_sample_count += chunk.sample_count;
    if (samples.length >= maxSamples) continue;
    const raw = await readText(chunk.path);
    for (const line of String(raw || "").split("\n")) {
      if (!line.trim()) continue;
      if (samples.length >= maxSamples) break;
      try { samples.push(JSON.parse(line)); } catch { invalid_lines += 1; }
    }
  }
  return {
    kind: "render3d_viser_recording/v1",
    visualization_kind: recordingVisualizationKind(normalized),
    recording: normalized,
    samples,
    total_sample_count: Math.max(total_sample_count, samples.length),
    truncated: total_sample_count > samples.length,
    invalid_lines,
    can_replay_hardware: false,
    training_ready: normalized.training_ready,
    missing_fields: [...normalized.missing_fields],
  };
}

export function deliverViserRecording(payload, { frameWindow, eventTarget = globalThis, CustomEventClass = globalThis.CustomEvent } = {}) {
  if (!payload || payload.kind !== "render3d_viser_recording/v1") throw new Error("A loaded Viser recording payload is required.");
  const message = { type: "studio-viser-recording", token: "recording-v1", ...payload };
  frameWindow?.postMessage?.(message, "*");
  if (typeof eventTarget?.dispatchEvent === "function" && typeof CustomEventClass === "function") {
    eventTarget.dispatchEvent(new CustomEventClass(VISER_RECORDING_LOADED_EVENT, { detail: payload }));
  }
  return message;
}

function dispatchRecordingEvent(descriptor) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(VISER_RECORDING_EVENT, { detail: { descriptor } }));
  } catch { /* storage remains the source of truth */ }
}
