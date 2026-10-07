import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createXrAgentStore, XR_AGENT_STORAGE_KEY, XR_AGENT_HISTORY_LIMIT,
  XR_AGENT_CHANGE_LIMIT, XR_AGENT_STORAGE_BYTES, XR_AGENT_THROW_AUDIO_BYTES,
  validateXrAgentThrowSound, xrAgentAccountStorageKey, createXrAgentAccountStorage,
  readXrAgentAccountSnapshot, xrAgentRemoteSyncDelayMs,
} from "./xr-agent-state.js";

function memoryStorage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => { value = next; }, read: () => value };
}

test("toggling agent settings writes storage immediately without a Save action", () => {
  const storage = memoryStorage();
  const store = createXrAgentStore({ storage });
  store.updateSettings({
    showToRoom: true, shareWithRoom: true, allowOtherUsersTrigger: true,
    includeVisualContext: false, includeSelectionMetadata: false, throwSoundEnabled: false,
    avatar: "gem", voiceModel: "gpt-realtime-mini", volume: 0.35,
  });
  const saved = JSON.parse(storage.read());
  assert.equal(saved.settings.showToRoom, true);
  assert.equal(saved.settings.shareWithRoom, true);
  assert.equal(saved.settings.allowOtherUsersTrigger, true);
  assert.equal(saved.settings.includeVisualContext, false);
  assert.equal(saved.settings.throwSoundEnabled, false);
  assert.equal(saved.settings.avatar, "gem");
  assert.equal(saved.settings.voiceModel, "gpt-realtime-mini");
  assert.equal(saved.settings.volume, 0.35);
  assert.equal(createXrAgentStore({ storage: memoryStorage(storage.read()) }).getState().settings.showToRoom, true);
  assert.equal(xrAgentRemoteSyncDelayMs({}, { showToRoom: true }), 0);
  assert.equal(xrAgentRemoteSyncDelayMs({ volume: 0.8 }, { volume: 0.4 }), 150);
  assert.equal(xrAgentRemoteSyncDelayMs({ name: "Astra" }, { name: "Nova" }), 150);
  assert.equal(xrAgentRemoteSyncDelayMs({ name: "Astra" }, { name: "Astra" }), 800);
});

test("account-scoped agent storage isolates preferences per signed-in user", () => {
  assert.equal(xrAgentAccountStorageKey("ada"), `${XR_AGENT_STORAGE_KEY}:ada`);
  const backend = {
    data: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem(k, v) { this.data[k] = String(v); },
  };
  const ada = createXrAgentStore({ storage: createXrAgentAccountStorage("ada", backend) });
  ada.updateSettings({ showToRoom: true, name: "Ada" });
  assert.equal(JSON.parse(backend.data[`${XR_AGENT_STORAGE_KEY}:ada`]).settings.showToRoom, true);
  assert.equal(readXrAgentAccountSnapshot("ada", backend).settings.name, "Ada");
  assert.equal(createXrAgentStore({ storage: createXrAgentAccountStorage("bob", backend) }).getState().settings.showToRoom, false);
});

test("agent preferences are opt-in, validated, detached and do not save credentials", () => {
  const storage = memoryStorage();
  const store = createXrAgentStore({ storage });
  assert.equal(store.getState().settings.shareWithRoom, false);
  assert.equal(store.getState().settings.allowOtherUsersTrigger, false);
  store.updateSettings({ name: " Ada ", wakeName: "Ada", avatar: "robot", volume: 30, apiKey: "private", arbitrary: "ignored" });
  assert.equal(store.getState().settings.name, "Ada");
  assert.equal(store.getState().settings.volume, 1);
  assert.equal(storage.read().includes("private"), false);
  const snapshot = store.getState(); snapshot.settings.name = "Changed outside store";
  assert.equal(store.getState().settings.name, "Ada");
  assert.equal(createXrAgentStore({ storage }).getState().settings.avatar, "robot");
  store.updateSettings({ avatar: "unsafe-model-path", volume: -1, name: "" });
  assert.equal(store.getState().settings.avatar, "orb");
  assert.equal(store.getState().settings.volume, 0);
  assert.equal(store.getState().settings.name, "Astra");
});

test("store tolerates corrupt, future-version and inaccessible local storage", () => {
  for (const value of ["not JSON", JSON.stringify({ version: 100, settings: { name: "Unsupported" } })]) {
    assert.equal(createXrAgentStore({ storage: memoryStorage(value) }).getState().settings.name, "Astra");
  }
  const store = createXrAgentStore({ storage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } } });
  store.updateSettings({ name: "Local" });
  assert.equal(store.getState().settings.name, "Local");
  assert.match(store.getPersistenceError(), /could not save/);
  assert.equal(createXrAgentStore({ storage: null }).getState().version, 1);
});

test("change review must follow execution and feedback transitions", () => {
  const store = createXrAgentStore({ storage: null });
  const change = store.queueChange({ title: "Adjust mount", prompt: "Move the sensor mounting holes", context: { objectId: "sensor-mount" } });
  assert.equal(change.status, "pending");
  assert.throws(() => store.updateChange(change.id, { status: "accepted" }), /Cannot change pending/);
  store.updateChange(change.id, { prompt: "Move only the sensor holes 3 mm" });
  store.updateChange(change.id, { status: "running" });
  store.updateChange(change.id, { prompt: "Must not change executing request" });
  assert.equal(store.getState().changes[0].prompt, "Move only the sensor holes 3 mm");
  store.updateChange(change.id, { status: "succeeded", result: "Moved two holes" });
  store.updateChange(change.id, { status: "rejected", feedback: "Wrong direction", correction: "Move toward the front" });
  const correction = store.queueChange({ title: "Correct direction", prompt: "Move toward the front", parentId: change.id });
  assert.equal(correction.parentId, change.id);
  assert.equal(correction.status, "pending");
  assert.throws(() => store.updateChange(change.id, { status: "running" }), /Cannot change rejected/);
  assert.throws(() => store.queueChange({ prompt: " " }), /needs a prompt/);
});

test("interrupted work restores as failed, retries explicitly, and retains running work during clear", () => {
  const storage = memoryStorage();
  const before = createXrAgentStore({ storage });
  const interrupted = before.queueChange({ prompt: "Route the wire" });
  before.updateChange(interrupted.id, { status: "running" });
  const after = createXrAgentStore({ storage });
  assert.equal(after.getState().changes[0].status, "failed");
  assert.match(after.getState().changes[0].result, /Interrupted/);
  after.updateChange(interrupted.id, { status: "running" });
  after.queueChange({ prompt: "Reposition battery" });
  after.clearChanges();
  assert.deepEqual(after.getState().changes.map((item) => item.id), [interrupted.id]);
  after.updateChange(interrupted.id, { status: "succeeded" });
  after.updateChange(interrupted.id, { status: "accepted" });
  after.clearChanges();
  assert.equal(after.getState().changes.length, 0);
});

test("subscribers receive detached snapshots and can unsubscribe without breaking other listeners", () => {
  const store = createXrAgentStore({ storage: null });
  let seen = 0;
  store.subscribe(() => { throw new Error("bad UI"); });
  const unsubscribe = store.subscribe((snapshot) => { seen++; snapshot.settings.name = "No effect"; });
  store.addTranscript({ role: "assistant", text: "Ready" });
  unsubscribe();
  store.updateSettings({ name: "Astra" });
  assert.equal(seen, 1);
  assert.equal(store.getState().settings.name, "Astra");
});

test("history and changes are capped by count and UTF-8 bytes and metadata strips credentials", () => {
  const storage = memoryStorage();
  const store = createXrAgentStore({ storage });
  for (let i = 0; i < XR_AGENT_HISTORY_LIMIT + 10; i++) store.addTranscript({ role: "user", text: `Note ${i}`, metadata: { api_key: "secret-value", connector: { accessToken: "nested-secret", pin: "GPIO17" } } });
  assert.equal(store.getState().history.length, XR_AGENT_HISTORY_LIMIT);
  assert.equal(store.getState().history[0].text, "Note 10");
  assert.equal(storage.read().includes("secret-value"), false);
  assert.equal(storage.read().includes("nested-secret"), false);
  assert.equal(store.getState().history[0].metadata.connector.pin, "GPIO17");
  for (let i = 0; i < XR_AGENT_CHANGE_LIMIT + 4; i++) store.queueChange({ prompt: `Change ${i}` });
  assert.equal(store.getState().changes.length, XR_AGENT_CHANGE_LIMIT);
  for (let i = 0; i < 90; i++) store.addTranscript({ role: "assistant", text: "🤖".repeat(3000) });
  assert.ok(new TextEncoder().encode(storage.read()).byteLength <= XR_AGENT_STORAGE_BYTES);
  assert.ok(store.getState().changes.length > 0);
  store.clearHistory();
  assert.equal(store.getState().history.length, 0);
});

test("throw sound accepts supported audio, rejects non-audio and oversized clips", () => {
  assert.equal(validateXrAgentThrowSound({ name: "dismiss.mp3", size: 1200, type: "audio/mpeg" }), true);
  assert.equal(validateXrAgentThrowSound({ name: "dismiss.wav", size: XR_AGENT_THROW_AUDIO_BYTES, type: "" }), true);
  assert.throws(() => validateXrAgentThrowSound({ name: "large.wav", size: XR_AGENT_THROW_AUDIO_BYTES + 1, type: "audio/wav" }), /3 MB/);
  assert.throws(() => validateXrAgentThrowSound({ name: "page.html", size: 100, type: "text/html" }), /audio file/);
  assert.throws(() => validateXrAgentThrowSound({ name: "empty.mp3", size: 0, type: "audio/mpeg" }), /nonempty/);
});

test("companion merge preserves remote running work and IDs without sync loops or overwriting newer local edits", () => {
  const desktop = createXrAgentStore({ storage: null });
  const headset = createXrAgentStore({ storage: null });
  desktop.updateSettings({ name: "Nova" });
  desktop.addTranscript({ role: "user", text: "Move the sensor" });
  const change = desktop.queueChange({ prompt: "Move the sensor mount 3 mm" });
  desktop.updateChange(change.id, { status: "running" });
  let notifications = 0;
  headset.subscribe(() => notifications++);
  assert.equal(headset.mergeRemote(desktop.getState()), true);
  assert.equal(headset.getState().changes[0].status, "running");
  assert.equal(headset.getState().changes[0].id, change.id);
  assert.equal(headset.getState().settings.name, "Nova");
  assert.equal(headset.mergeRemote(desktop.getState()), false);
  assert.equal(notifications, 1);
  desktop.updateChange(change.id, { status: "succeeded" });
  headset.mergeRemote(desktop.getState());
  assert.equal(headset.getState().changes[0].status, "succeeded");
  const stale = desktop.getState();
  headset.updateSettings({ name: "Orbit" });
  headset.updateChange(change.id, { status: "accepted" });
  assert.equal(headset.mergeRemote(stale), false);
  assert.equal(headset.getState().settings.name, "Orbit");
  assert.equal(headset.getState().changes[0].status, "accepted");
  assert.equal(headset.getState().history.length, 1);
});

test("account reset removes running work and preferences and replaces with only the new account snapshot", () => {
  const store = createXrAgentStore({ storage: null });
  store.updateSettings({ name: "First account", prompt: "Private preferences" });
  const change = store.queueChange({ prompt: "Private edit" });
  store.updateChange(change.id, { status: "running" });
  store.reset();
  assert.equal(store.getState().settings.name, "Astra");
  assert.equal(store.getState().history.length, 0);
  assert.equal(store.getState().changes.length, 0);
  const other = createXrAgentStore({ storage: null });
  other.updateSettings({ name: "Second account" });
  const otherChange = other.queueChange({ prompt: "Another edit" });
  other.updateChange(otherChange.id, { status: "running" });
  store.reset(other.getState());
  assert.equal(store.getState().settings.name, "Second account");
  assert.equal(store.getState().changes[0].id, otherChange.id);
  assert.equal(store.getState().changes[0].status, "running");
  assert.equal(JSON.stringify(store.getState()).includes("Private"), false);
});

test("oversized context keeps the project and generation target references", () => {
  const store = createXrAgentStore({ storage: null });
  const change = store.queueChange({ prompt: "Move mount", context: { projectId: 42, targetFile: "assembly.py", generationModel: "chosen-cad-model", targetIds: ["sensor-mount"], workspace: "design", huge: Array.from({ length: 40 }, () => "x".repeat(4000)) } });
  assert.equal(change.context.truncated, true);
  assert.equal(change.context.projectId, 42);
  assert.equal(change.context.targetFile, "assembly.py");
  assert.deepEqual(change.context.targetIds, ["sensor-mount"]);
  assert.equal(change.context.generationModel, "chosen-cad-model");
  assert.equal(change.context.workspace, "design");
});
