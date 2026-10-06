const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

export const EMOTES_FOLDER_ID = "emotes";
export const DEFAULT_TRAINING_FOLDER_ID = "training";

export function datasetFolderStorageKey(projectId = "global") {
  return `render3d:robotics:dataset-folders:v1:${String(projectId || "global")}`;
}

export function datasetDestinationStorageKey(projectId = "global") {
  return `render3d:robotics:dataset-destination:v1:${String(projectId || "global")}`;
}

const cleanId = (value, fallback = "") => String(value ?? "").trim().toLowerCase()
  .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;

export function createDatasetFolder(name, existing = []) {
  const label = String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 64);
  if (!label) return null;
  const taken = new Set(existing.map((folder) => String(folder.id)));
  const base = cleanId(label, DEFAULT_TRAINING_FOLDER_ID);
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  return { id, name: label, kind: "training", builtIn: false };
}

export function normalizeDatasetLibrary(payload = {}, savedFolders = []) {
  const folders = [{ id: EMOTES_FOLDER_ID, name: "Emotes", kind: "emote", builtIn: true }];
  const sourceRecordings = [...(payload.recordings || []), ...(payload.loops || [])];
  const recordingFolders = sourceRecordings.map((recording) => ({
    id: recording?.folder_id || recording?.folderId,
    name: recording?.folder_name || recording?.folderName,
  }));
  for (const raw of [...savedFolders, ...(payload.folders || []), ...recordingFolders]) {
    const id = cleanId(raw?.id || raw?.name);
    if (!id || id === EMOTES_FOLDER_ID || folders.some((folder) => folder.id === id)) continue;
    folders.push({ id, name: String(raw?.name || id), kind: "training", builtIn: false });
  }
  if (folders.length === 1) folders.push({ id: DEFAULT_TRAINING_FOLDER_ID, name: "Training", kind: "training", builtIn: false });
  const recordings = sourceRecordings.map((recording) => ({
    ...recording,
    folderId: cleanId(recording?.folder_id || recording?.folderId, EMOTES_FOLDER_ID),
  }));
  return { folders, recordings };
}

export function datasetDestinationPayload(folder, pending = {}) {
  const id = cleanId(folder?.id, EMOTES_FOLDER_ID);
  return {
    folder_id: id,
    folder_name: String(folder?.name || (id === EMOTES_FOLDER_ID ? "Emotes" : id)).slice(0, 64),
    recording_id: String(pending?.id || ""),
  };
}

export function selectDatasetDestination(library = {}, folderId = EMOTES_FOLDER_ID) {
  return (library.folders || []).find((folder) => folder.id === cleanId(folderId))
    || (library.folders || []).find((folder) => folder.id === EMOTES_FOLDER_ID)
    || { id: EMOTES_FOLDER_ID, name: "Emotes", kind: "emote", builtIn: true };
}

export function recordingMissingFields(item = {}) {
  if (item.trainingReady) return [];
  const missing = [];
  if (Number(item.samples) < 2) missing.push("joint actions");
  if (Number(item.cameraCount) < 3) missing.push("3 synchronized cameras");
  if (!item.hasTiming) missing.push("timestamps");
  if (!item.hasCalibration) missing.push("calibration");
  if (!item.hasOutcome) missing.push("outcome label");
  return missing;
}

export function filterRecordingLibrary(items = [], { query = "", filter = "all" } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  return items.filter((item) => {
    const missing = recordingMissingFields(item);
    if (filter === "ready" && !item.trainingReady) return false;
    if (filter === "needs-video" && !missing.includes("3 synchronized cameras")) return false;
    if (filter === "vr" && item.official) return false;
    return !needle || `${item.name} ${item.id} ${item.trainingReady ? "training ready" : missing.join(" ")}`.toLowerCase().includes(needle);
  });
}

export function recordingLibraryMarkup({ items = [], selectedIds = new Set(), query = "", filter = "all", connected = false } = {}) {
  const visible = filterRecordingLibrary(items, { query, filter });
  if (!visible.length) return `<p class="robotics-recording-library-empty">${connected ? "No recordings match this view." : "Connect the Pi to load every VR recording. Official examples remain available for reference."}</p>`;
  return visible.map((item) => {
    const selected = selectedIds.has(item.id);
    const missing = recordingMissingFields(item);
    const state = item.trainingReady ? "TRAINING READY" : "NEEDS DATA";
    const detail = item.trainingReady
      ? `${item.samples} samples · ${item.cameraCount} cameras · calibrated · outcome labeled`
      : `Missing ${missing.join(", ")}`;
    return `<article class="robotics-recording-library-row${selected ? " is-selected" : ""}" data-recording-state="${item.trainingReady ? "ready" : "incomplete"}">
      <button type="button" class="robotics-recording-library-select" data-robotics-library-select="${esc(item.id)}" aria-pressed="${selected}"><span aria-hidden="true">${selected ? "✓" : "○"}</span><span><strong>${esc(item.name)}</strong><small>${esc(detail)}</small></span></button>
      <span class="robotics-recording-library-state">${state}</span>
      ${item.official ? '<span class="robotics-recording-library-origin">Official LeRobot example</span>' : `<button type="button" class="btn secondary btn-compact" data-robotics-library-start="${esc(item.id)}">Use as start</button>`}
    </article>`;
  }).join("");
}

export function recordingLibrarySummary(items = [], selectedIds = new Set()) {
  const selected = items.filter((item) => selectedIds.has(item.id));
  const ready = items.filter((item) => item.trainingReady).length;
  return `${items.length} recordings · ${ready} training-ready · ${selected.length} selected`;
}
