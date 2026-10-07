/** Bounded, local-only voice-agent preferences and reviewed change history.
 * No credentials belong here. getState() and subscription values are detached
 * snapshots; changing one never changes the store.
 */
export const XR_AGENT_STORAGE_KEY = "render3d:xr-agent:v1";
export const XR_AGENT_HISTORY_LIMIT = 200;
export const XR_AGENT_CHANGE_LIMIT = 100;
export const XR_AGENT_STORAGE_BYTES = 384 * 1024;
export const XR_AGENT_THROW_AUDIO_BYTES = 3 * 1024 * 1024;
export const XR_AGENT_THROW_AUDIO_SECONDS = 3;

export const XR_AGENT_DEFAULT_SETTINGS = Object.freeze({
  name: "Astra", wakeName: "Astra", voiceProvider: "openai",
  voiceModel: "gpt-realtime", voice: "marin", volume: 0.8,
  shareWithRoom: false, allowOtherUsersTrigger: false, showToRoom: false, avatar: "orb",
  prompt: "", includeVisualContext: true, includeSelectionMetadata: true,
  throwSoundEnabled: true, throwSoundName: "",
});

const statuses = new Set(["pending", "running", "succeeded", "failed", "accepted", "rejected"]);
const transitions = {
  pending: new Set(["running", "rejected"]),
  running: new Set(["succeeded", "failed"]),
  succeeded: new Set(["accepted", "rejected"]),
  failed: new Set(["running", "rejected"]),
  accepted: new Set(), rejected: new Set(),
};
const copy = (value) => JSON.parse(JSON.stringify(value));
const text = (value, limit = 4000) => typeof value === "string" ? value.slice(0, limit).trim() : "";
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const secretKey = /(?:api.?key|access.?token|refresh.?token|password|authorization|secret)/i;

function cleanData(value, depth = 0) {
  if (depth > 6) return null;
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => cleanData(item, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).slice(0, 80)
    .filter(([key]) => !secretKey.test(key) && !["__proto__", "constructor", "prototype"].includes(key))
    .map(([key, item]) => [key.slice(0, 100), cleanData(item, depth + 1)]));
}

function context(value) {
  const clean = cleanData(value || {});
  // Metadata is a compact reference, never a saved screenshot/audio payload.
  if (bytes(clean) <= 24 * 1024) return clean;
  const references = {};
  for (const key of ["projectId", "project_id", "targetFile", "generationModel", "targetIds", "workspace"]) {
    if (clean && typeof clean === "object" && key in clean) references[key] = key === "targetIds" && Array.isArray(clean[key]) ? clean[key].slice(0, 40).map((item) => text(item, 200)) : typeof clean[key] === "string" ? text(clean[key], 500) : typeof clean[key] === "number" ? clean[key] : null;
  }
  return { ...references, truncated: true, summary: "Context exceeded the local history limit. Project and target references were retained." };
}

export function xrAgentAccountStorageKey(userId) {
  const id = String(userId || "").trim();
  return id ? `${XR_AGENT_STORAGE_KEY}:${id}` : XR_AGENT_STORAGE_KEY;
}

/** localStorage adapter keyed by signed-in user so toggles survive reload without a Save click. */
export function createXrAgentAccountStorage(userId, backend) {
  let store = backend;
  if (store === undefined) {
    try { store = globalThis.localStorage; } catch { store = null; }
  }
  if (!store) return null;
  const key = xrAgentAccountStorageKey(userId);
  return {
    getItem: () => { try { return store.getItem(key); } catch { return null; } },
    setItem: (_ignored, value) => { try { store.setItem(key, value); } catch { /* ignore */ } },
  };
}

export function createXrAgentLiveAccountStorage(getUserId, backend) {
  let store = backend;
  if (store === undefined) {
    try { store = globalThis.localStorage; } catch { store = null; }
  }
  if (!store) return null;
  return {
    getItem() {
      const uid = String(getUserId?.() || "").trim();
      if (!uid) return null;
      try { return store.getItem(xrAgentAccountStorageKey(uid)); } catch { return null; }
    },
    setItem(_ignored, value) {
      const uid = String(getUserId?.() || "").trim();
      if (!uid) return;
      try { store.setItem(xrAgentAccountStorageKey(uid), value); } catch { /* ignore */ }
    },
  };
}

export function readXrAgentAccountSnapshot(userId, backend) {
  try {
    const store = backend === undefined ? globalThis.localStorage : backend;
    const raw = JSON.parse(store?.getItem?.(xrAgentAccountStorageKey(userId)) || "null");
    return raw?.version === 1 ? raw : null;
  } catch { return null; }
}

const INSTANT_SETTING_KEYS = new Set([
  "shareWithRoom", "allowOtherUsersTrigger", "showToRoom", "includeVisualContext",
  "includeSelectionMetadata", "throwSoundEnabled", "avatar", "voiceModel", "voice",
]);
const DEBOUNCED_SETTING_KEYS = new Set(["volume", "name", "wakeName", "prompt", "throwSoundName"]);

/** Immediate for toggles/pickers; short debounce for volume/text; slower for history-only commits. */
export function xrAgentRemoteSyncDelayMs(prev = {}, next = {}) {
  const keys = [...new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])]
    .filter((key) => JSON.stringify(prev?.[key]) !== JSON.stringify(next?.[key]));
  if (!keys.length) return 800;
  if (keys.some((key) => INSTANT_SETTING_KEYS.has(key) || typeof next?.[key] === "boolean")) return 0;
  if (keys.some((key) => DEBOUNCED_SETTING_KEYS.has(key))) return 150;
  return 0;
}

function settings(value = {}) {
  const result = { ...XR_AGENT_DEFAULT_SETTINGS };
  for (const key of Object.keys(result)) {
    if (!(key in value)) continue;
    if (typeof result[key] === "boolean") result[key] = value[key] === true;
    else if (key === "volume") result[key] = Number.isFinite(Number(value[key])) ? Math.max(0, Math.min(1, Number(value[key]))) : result[key];
    else result[key] = text(value[key], key === "prompt" ? 8000 : key === "throwSoundName" ? 160 : 80);
  }
  result.name ||= XR_AGENT_DEFAULT_SETTINGS.name;
  result.wakeName ||= result.name;
  result.voiceProvider = "openai";
  result.voiceModel ||= XR_AGENT_DEFAULT_SETTINGS.voiceModel;
  if (!["marin","cedar","alloy","ash","ballad","coral","echo","sage","shimmer","verse"].includes(result.voice)) result.voice = XR_AGENT_DEFAULT_SETTINGS.voice;
  if (!["orb", "robot", "gem"].includes(result.avatar)) result.avatar = "orb";
  return result;
}

function now() { return new Date().toISOString(); }
function makeId() { return globalThis.crypto?.randomUUID?.() || `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function timestamp(value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0; }
function cleanHistory(item) {
  return { id: text(item.id, 100) || makeId(), at: text(item.at, 40), role: ["user", "assistant", "system"].includes(item.role) ? item.role : "system", text: text(item.text, 6000), metadata: context(item.metadata) };
}
function cleanChange(item, interrupted = false) {
  return { id: text(item.id, 100) || makeId(), title: text(item.title, 160) || "Proposed change", prompt: text(item.prompt, 12000), context: context(item.context), parentId: text(item.parentId, 100), at: text(item.at, 40), updatedAt: text(item.updatedAt, 40), status: interrupted && item.status === "running" ? "failed" : statuses.has(item.status) ? item.status : "pending", result: interrupted && item.status === "running" ? "Interrupted before a result was confirmed. Review before retrying." : text(item.result, 6000), feedback: text(item.feedback, 6000), correction: text(item.correction, 6000) };
}

function trimState(state) {
  state.history = state.history.slice(-XR_AGENT_HISTORY_LIMIT);
  while (state.changes.length > XR_AGENT_CHANGE_LIMIT) {
    const completed = state.changes.findIndex((item) => ["accepted", "rejected", "failed"].includes(item.status));
    const inactive = completed < 0 ? state.changes.findIndex((item) => item.status !== "running") : completed;
    state.changes.splice(inactive < 0 ? 0 : inactive, 1);
  }
  while (bytes(state) > XR_AGENT_STORAGE_BYTES && (state.history.length || state.changes.length)) {
    // Preserve open work over older discussion. Once history is exhausted,
    // discard the oldest completed change before an unreviewed proposal.
    if (state.history.length) state.history.shift();
    else {
      const completed = state.changes.findIndex((item) => ["accepted", "rejected", "failed"].includes(item.status));
      const inactive = completed < 0 ? state.changes.findIndex((item) => item.status !== "running") : completed;
      state.changes.splice(inactive < 0 ? 0 : inactive, 1);
    }
  }
}

/**
 * createXrAgentStore({storage?, key?})
 * - storage: localStorage-compatible object; null disables persistence.
 * - subscribe(fn): fires after mutation, returns unsubscribe.
 * - queueChange({title,prompt,context?,parentId?}): returns a pending change.
 * - updateChange(id,{status?,result?,feedback?,correction?,prompt?,title?})
 *   applies legal review/execution transitions, returns the updated change.
 */
export function createXrAgentStore(options = {}) {
  let storage = options.storage;
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  const key = options.key || XR_AGENT_STORAGE_KEY;
  const subscribers = new Set();
  let state = { version: 1, settings: settings(), settingsUpdatedAt: "", history: [], changes: [] };
  let persistenceError = "";
  try {
    const saved = JSON.parse(storage?.getItem(key) || "null");
    if (saved?.version === 1) {
      state.settings = settings(saved.settings);
      state.settingsUpdatedAt = timestamp(saved.settingsUpdatedAt) ? text(saved.settingsUpdatedAt, 40) : "";
      state.history = (Array.isArray(saved.history) ? saved.history : []).slice(-XR_AGENT_HISTORY_LIMIT)
        .filter((item) => item && typeof item.text === "string")
        .map(cleanHistory);
      state.changes = (Array.isArray(saved.changes) ? saved.changes : []).slice(-XR_AGENT_CHANGE_LIMIT)
        .filter((item) => item && text(item.prompt, 12000))
        .map((item) => cleanChange(item, true));
    }
  } catch { /* A corrupt or unavailable store must not block VR. */ }
  trimState(state);
  const getState = () => copy(state);
  function commit() {
    trimState(state);
    try { storage?.setItem(key, JSON.stringify(state)); persistenceError = ""; }
    catch { persistenceError = "Preferences remain available for this session, but this browser could not save them."; }
    for (const listener of subscribers) { try { listener(getState()); } catch { /* Isolate UI subscribers. */ } }
  }
  return {
    getState,
    getPersistenceError: () => persistenceError,
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    /** Account-switch reset: unlike clearChanges, this also drops running work.
     * A supplied snapshot must belong to the newly authenticated user.
     */
    reset(snapshot = null) {
      state = { version: 1, settings: settings(), settingsUpdatedAt: "", history: [], changes: [] };
      if (snapshot?.version === 1) {
        state.settings = settings(snapshot.settings);
        state.settingsUpdatedAt = timestamp(snapshot.settingsUpdatedAt) ? text(snapshot.settingsUpdatedAt, 40) : "";
        state.history = (Array.isArray(snapshot.history) ? snapshot.history : []).slice(-XR_AGENT_HISTORY_LIMIT).filter((item) => item && text(item.text, 6000)).map(cleanHistory);
        state.changes = (Array.isArray(snapshot.changes) ? snapshot.changes : []).slice(-XR_AGENT_CHANGE_LIMIT).filter((item) => item && text(item.prompt, 12000)).map((item) => cleanChange(item));
      }
      commit(); return getState();
    },
    updateSettings(patch = {}) {
      const previousPrompt = state.settings.prompt;
      const next = settings({ ...state.settings, ...patch });
      if (JSON.stringify(next) === JSON.stringify(state.settings)) return copy(state.settings);
      state.settings = next;
      state.settingsUpdatedAt = new Date(Math.max(Date.now(), timestamp(state.settingsUpdatedAt) + 1)).toISOString();
      if (state.settings.prompt !== previousPrompt) {
        state.history.push({ id: makeId(), at: now(), role: "system", text: state.settings.prompt ? `Agent instructions updated:\n${state.settings.prompt}` : "Custom agent instructions cleared.", metadata: { kind: "prompt-config", previousPrompt: previousPrompt.slice(0, 4000) } });
      }
      commit(); return copy(state.settings);
    },
    /** Merge the same user's companion device snapshot. Transport authenticates
     * ownership; never call this with another room participant's settings.
     * IDs and update timestamps prevent duplicate history and sync loops.
     */
    mergeRemote(remote) {
      if (!remote || remote.version !== 1) return false;
      const before = JSON.stringify(state);
      const remoteSettingsTime = timestamp(remote.settingsUpdatedAt);
      if (remote.settings && (remoteSettingsTime > timestamp(state.settingsUpdatedAt) || !state.settingsUpdatedAt)) {
        state.settings = settings(remote.settings);
        state.settingsUpdatedAt = remoteSettingsTime ? text(remote.settingsUpdatedAt, 40) : state.settingsUpdatedAt;
      }
      const historyById = new Map(state.history.map((item) => [item.id, item]));
      for (const item of (Array.isArray(remote.history) ? remote.history : []).slice(-XR_AGENT_HISTORY_LIMIT)) {
        if (!item || !text(item.id, 100) || !text(item.text, 6000)) continue;
        if (!historyById.has(item.id)) historyById.set(item.id, cleanHistory(item));
      }
      state.history = [...historyById.values()].sort((a, b) => timestamp(a.at) - timestamp(b.at));
      const changesById = new Map(state.changes.map((item) => [item.id, item]));
      for (const item of (Array.isArray(remote.changes) ? remote.changes : []).slice(-XR_AGENT_CHANGE_LIMIT)) {
        if (!item || !text(item.id, 100) || !text(item.prompt, 12000)) continue;
        const previous = changesById.get(item.id);
        if (!previous || timestamp(item.updatedAt) > timestamp(previous.updatedAt)) changesById.set(item.id, cleanChange(item));
      }
      state.changes = [...changesById.values()].sort((a, b) => timestamp(a.at) - timestamp(b.at));
      trimState(state);
      if (JSON.stringify(state) === before) return false;
      commit(); return true;
    },
    addTranscript(item = {}) {
      const entry = { id: makeId(), at: now(), role: ["user", "assistant", "system"].includes(item.role) ? item.role : "system", text: text(item.text, 6000), metadata: context(item.metadata) };
      if (!entry.text) return null;
      state.history.push(entry); commit(); return copy(entry);
    },
    queueChange(item = {}) {
      const prompt = text(item.prompt, 12000);
      if (!prompt) throw new Error("A proposed change needs a prompt.");
      const entry = { id: makeId(), title: text(item.title, 160) || prompt.slice(0, 100), prompt, context: context(item.context), parentId: text(item.parentId, 100), at: now(), updatedAt: now(), status: "pending", result: "", feedback: "", correction: "" };
      state.changes.push(entry); commit(); return copy(entry);
    },
    updateChange(id, patch = {}) {
      const entry = state.changes.find((item) => item.id === id);
      if (!entry) throw new Error("That proposed change is no longer in the local history.");
      if (patch.status && patch.status !== entry.status) {
        if (!transitions[entry.status]?.has(patch.status)) throw new Error(`Cannot change ${entry.status} to ${patch.status}.`);
        entry.status = patch.status;
      }
      for (const field of ["result", "feedback", "correction"]) if (field in patch) entry[field] = text(patch[field], 6000);
      if (entry.status === "pending") {
        if ("prompt" in patch) entry.prompt = text(patch.prompt, 12000) || entry.prompt;
        if ("title" in patch) entry.title = text(patch.title, 160) || entry.title;
      }
      entry.updatedAt = new Date(Math.max(Date.now(), timestamp(entry.updatedAt) + 1)).toISOString(); commit(); return copy(entry);
    },
    clearHistory() { state.history = []; commit(); },
    clearChanges() { state.changes = state.changes.filter((item) => item.status === "running"); commit(); },
  };
}

/** Validation is exported so file limits can also be checked before upload. */
export function validateXrAgentThrowSound(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new Error("Choose a nonempty audio file.");
  if (file.size > XR_AGENT_THROW_AUDIO_BYTES) throw new Error("Choose an audio clip of 3 MB or less.");
  if (!(String(file.type || "").startsWith("audio/") || (!file.type && /\.(mp3|wav|ogg|m4a|aac|webm|flac)$/i.test(file.name || "")))) throw new Error("Choose an audio file such as MP3, WAV, or OGG.");
  return true;
}

function soundDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("This browser cannot store a local audio clip.")); return; }
    const request = indexedDB.open("render3d-xr-agent", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("assets")) request.result.createObjectStore("assets"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Could not open the local audio library."));
  });
}

async function soundTransaction(mode, action) {
  const db = await soundDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("assets", mode);
    let result;
    try {
      const request = action(transaction.objectStore("assets"));
      request.onsuccess = () => { result = request.result; };
    } catch (error) { db.close(); reject(error); return; }
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(new Error("Could not save or read the local audio clip.")); };
  });
}

export async function saveXrAgentThrowSound(file) {
  validateXrAgentThrowSound(file);
  await soundTransaction("readwrite", (store) => store.put({ blob: file, name: text(file.name || "Dismiss sound", 160) }, "throw"));
  return { name: file.name || "Dismiss sound", size: file.size, seconds: XR_AGENT_THROW_AUDIO_SECONDS };
}
export const getXrAgentThrowSound = () => soundTransaction("readonly", (store) => store.get("throw"));
export const deleteXrAgentThrowSound = () => soundTransaction("readwrite", (store) => store.delete("throw"));

/** Play at most the first three seconds; returns a stop function. */
export async function playXrAgentThrowSound({ volume = 0.8 } = {}) {
  const asset = await getXrAgentThrowSound();
  if (!asset?.blob) return null;
  const url = URL.createObjectURL(asset.blob);
  const audio = new Audio(url);
  audio.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.8;
  let timer;
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; clearTimeout(timer); audio.pause(); audio.removeAttribute("src"); URL.revokeObjectURL(url); };
  audio.onended = stop;
  audio.ontimeupdate = () => { if (audio.currentTime >= XR_AGENT_THROW_AUDIO_SECONDS) stop(); };
  audio.onerror = stop;
  try { await audio.play(); timer = setTimeout(stop, XR_AGENT_THROW_AUDIO_SECONDS * 1000); }
  catch (error) { stop(); throw error; }
  return stop;
}
