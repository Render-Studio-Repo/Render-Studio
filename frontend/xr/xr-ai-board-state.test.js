import test from "node:test";
import assert from "node:assert/strict";
import { createXrAiBoardStore, normalizeBoardState, XR_AI_BOARD_LIMITS } from "./xr-ai-board-state.js";
import { boardConnectedGraph, boardPromptContext, boardMentionItems, organizeBoardPrompt, createBoardSnapshot } from "./xr-ai-board-graph.js";
import { createXrAiBoardPersistence } from "./xr-ai-board-persistence.js";
import { normalizeDrawAssets } from "./xr-ai-draw-assets.js";

const model = (id = "part") => ({ id, kind: "model", name: "Bracket", source: { projectId: "project", filename: "bracket.glb", revision: "v1", units: "mm", dimensions: [100, 60, 40] } });
const region = { id: "split", nodeId: "part", anchor: { nodeId: "part", instanceId: "part", sourceRevision: "v1", faceId: "face-17", localPoints: [[0, 0, 0], [10, 0, 0], [10, 10, 0]], localNormal: [0, 0, 1] } };
function fixture() {
  const board = createXrAiBoardStore();
  board.dispatch({ type: "batch", commands: [
    { type: "node.add", node: model() }, { type: "region.add", region },
    { type: "note.add", note: { id: "intent", regionId: "split", text: "Split the part for printing and assemble afterward." } },
    { type: "node.add", node: { id: "photo", kind: "image", name: "Finished example", finalLook: true, source: { filename: "look.jpg" } } },
    { type: "node.add", node: { id: "memo", kind: "memo", name: "Assembly memo", transcript: "Keep the flange aligned." } },
    { type: "link.add", link: { id: "l1", fromId: "split", toId: "photo", caption: "The final look is @{photo}" } },
    { type: "link.add", link: { id: "l2", fromId: "photo", toId: "memo", caption: "Assembly requirements" } },
    { type: "link.add", link: { id: "l3", fromId: "memo", toId: "part", caption: "Same part" } },
  ] });
  return board;
}

test("completed commands share unchanged immutable records and batch is one undo", () => {
  const board = fixture(), previous = board.getState();
  assert.equal(Object.keys(previous.nodes).length, 3);
  assert.equal(board.undo(), true);
  assert.equal(Object.keys(board.getState().nodes).length, 0);
  assert.equal(board.redo(), true);
  const before = board.getState();
  board.dispatch({ type: "note.update", id: "intent", patch: { text: "Use locating pins." } });
  const after = board.getState();
  assert.equal(after.nodes, before.nodes);
  assert.equal(after.regions, before.regions);
  assert.notEqual(after.notes, before.notes);
  assert.equal(Object.isFrozen(after.notes.intent), true);
  assert.throws(() => { after.notes.intent.text = "mutated"; }, TypeError);
});

test("selection and no-ops do not dirty history or notify persistent subscribers", () => {
  const board = fixture(), events = [];
  board.subscribe((_s, event) => events.push(event));
  const revision = board.getState().revision;
  board.dispatch({ type: "selection.set", ids: ["split"] });
  assert.equal(board.getState().revision, revision);
  assert.equal(events[0].persistent, false);
  assert.equal(board.dispatch({ type: "node.update", id: "part", patch: { name: "Bracket" } }).changed, false);
  assert.equal(events.length, 1);
});

test("rename retains all references; graph traverses full cyclic chains exactly once", () => {
  const board = fixture();
  board.dispatch({ type: "node.update", id: "photo", patch: { name: "Painted bracket" } });
  const state = board.getState(), graph = boardConnectedGraph(state, ["split"]);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.links.length, 3);
  assert.equal(graph.notes[0].id, "intent");
  assert.match(boardPromptContext(state, { seedIds: ["split"] }).text, /@Painted bracket \[photo\]/);
  assert.equal(boardMentionItems(state).find((x) => x.id === "photo").token, "@{photo}");
});

test("model transformations preserve local anchors and original CAD dimensions; changed revisions require reattachment", () => {
  const board = fixture(), anchor = board.getState().regions.split.anchor;
  board.dispatch({ type: "node.transform", id: "part", transform: { position: [2, 3, 4], scale: [0.002, 0.002, 0.002] } });
  assert.equal(board.getState().regions.split.anchor, anchor);
  assert.deepEqual(board.getState().nodes.part.source.dimensions, [100, 60, 40]);
  board.dispatch({ type: "node.update", id: "part", patch: { source: { ...board.getState().nodes.part.source, revision: "v2" } } });
  assert.equal(board.getState().regions.split.anchor.needsReattach, true);
  assert.equal(board.getState().regions.split.anchor.faceId, "face-17");
  board.undo();
  assert.equal(board.getState().regions.split.anchor.needsReattach, false);
});

test("removal cascades only board references and undo restores notes/links", () => {
  const board = fixture();
  board.dispatch({ type: "node.remove", id: "part" });
  assert.equal(board.getState().regions.split, undefined);
  assert.equal(board.getState().notes.intent, undefined);
  assert.equal(board.getState().links.l1, undefined);
  assert.ok(board.getState().nodes.photo);
  board.undo();
  assert.equal(board.getState().notes.intent.regionId, "split");
});

test("limits reject entire overflowing batch and history remains bounded", () => {
  const board = createXrAiBoardStore();
  const failed = board.dispatch({ type: "batch", commands: Array.from({ length: XR_AI_BOARD_LIMITS.nodes + 1 }, (_, i) => ({ type: "node.add", node: model(`n${i}`) })) });
  assert.match(failed.error, /limit/);
  assert.equal(Object.keys(board.getState().nodes).length, 0);
  board.dispatch({ type: "node.add", node: model() });
  for (let i = 0; i < 70; i += 1) board.dispatch({ type: "node.update", id: "part", patch: { name: `Name ${i}` } });
  let undos = 0; while (board.undo()) undos += 1;
  assert.equal(undos, XR_AI_BOARD_LIMITS.history);
});

test("organizing preserves draft and existing attachments; explicit snapshot cannot change afterward", () => {
  const board = fixture(), existing = [{ id: "earlier", name: "Original photo" }];
  const organized = organizeBoardPrompt(board.getState(), { prompt: "Keep my exact initial idea.", seedIds: ["split"], attachments: existing });
  assert.match(organized.prompt, /^Keep my exact initial idea\./);
  assert.equal(organized.attachments[0], existing[0]);
  assert.equal(organized.attachments.length, 4);
  const snap = createBoardSnapshot(board.getState(), organized);
  board.dispatch({ type: "note.update", id: "intent", patch: { text: "Changed after Generate" } });
  assert.equal(snap.graph.notes[0].text, "Split the part for printing and assemble afterward.");
  assert.equal(Object.isFrozen(snap.graph.notes), true);
});

test("persistence round-trips unrelated Canvas fields, saves newer edits, and uses revisions", async () => {
  const board = createXrAiBoardStore(), calls = [], stored = new Map();
  let release, saving = false, revision = "r1";
  const api = async (_url, options) => {
    if (!options) return { storage_revision: revision, state: { elements: [{ id: "desktop", type: "note" }], spatial_board: fixture().exportState() } };
    const body = JSON.parse(options.body); calls.push(body);
    if (!saving) { saving = true; await new Promise((resolve) => { release = resolve; }); }
    revision = `r${calls.length + 1}`;
    return { storage_revision: revision };
  };
  const persistence = createXrAiBoardPersistence({ board, api, delay: 100000, storage: { setItem: (k, v) => stored.set(k, v), getItem: (k) => stored.get(k), removeItem: (k) => stored.delete(k) } });
  await persistence.load("p");
  board.dispatch({ type: "node.update", id: "part", patch: { name: "First edit" } });
  const savingPromise = persistence.flush();
  board.dispatch({ type: "node.update", id: "part", patch: { name: "Second edit" } });
  release(); await savingPromise;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].expected_revision, "r1");
  assert.equal(calls[1].expected_revision, "r2");
  assert.equal(calls[1].state.spatial_board.nodes.part.name, "Second edit");
  assert.equal(calls[1].state.elements[0].id, "desktop");
  assert.equal(persistence.isDirty(), false);
  assert.equal(stored.size, 0);
  persistence.dispose();
});

test("storage conflict retains edits and stops autosave instead of overwriting another session", async () => {
  const board = fixture(), statuses = [];
  const api = async (_url, options) => {
    if (!options) return { storage_revision: "r1", state: { spatial_board: fixture().exportState() } };
    throw Object.assign(new Error("changed in another session"), { status: 409 });
  };
  const persistence = createXrAiBoardPersistence({ board, api, delay: 100000, storage: null, onStatus: (s) => statuses.push(s.phase) });
  await persistence.load("p");
  board.dispatch({ type: "note.update", id: "intent", patch: { text: "Keep this edit" } });
  assert.equal(await persistence.flush(), false);
  assert.equal(persistence.isBlocked(), true);
  assert.equal(persistence.isDirty(), true);
  assert.equal(board.getState().notes.intent.text, "Keep this edit");
  assert.ok(statuses.includes("conflict"));
  persistence.dispose();
});

test("normalization strips opaque GPU/audio fields and down-samples stored points", () => {
  const state = normalizeBoardState({ nodes: { n: { ...model("n"), geometry: { huge: true }, audioUrl: "blob:secret", source: { filename: "a.glb", bytes: "SECRET" } } }, drawings: [{ id: "ink", points: Array.from({ length: 10000 }, (_, i) => [i, 0, 0]) }] });
  assert.equal(state.drawings.ink.points.length, XR_AI_BOARD_LIMITS.points);
  assert.equal(JSON.stringify(state).includes("SECRET"), false);
  assert.equal(state.nodes.n.audioUrl, "");
});

test("project assets flatten folders, retain revisions and deduplicate without reading file bytes", () => {
  const assets = normalizeDrawAssets({ files: [{ filename: "bracket.glb", revision: "sha256-123", units: "mm", dimensions: [100, 30, 20] }, "bracket.glb"],
    references: [{ virtual_folder: true, folder: "Product photos", children: [{ name: "finish.jpg" }, { name: "voice.wav", transcript: "Keep the flange" }] }] }, "project-1");
  assert.equal(assets.length, 3);
  assert.equal(assets[0].source.revision, "sha256-123");
  assert.deepEqual(assets[0].source.dimensions, [100, 30, 20]);
  assert.equal(assets[1].source.filename, "references/Product photos/finish.jpg");
  assert.equal(assets[2].kind, "memo");
  assert.equal(assets[2].transcript, "Keep the flange");
  assert.equal(assets[2].audioUrl, "/api/projects/project-1/files/references/Product%20photos/voice.wav");
});

test("immutable spatial manifest excludes large image and audio bytes", () => {
  const snapshot = createBoardSnapshot(fixture().getState(), { attachments: [{ id: "photo", data_url: "data:image/png;base64,SECRET", audio: "SECRET", url: "blob:SECRET" }] });
  assert.equal(JSON.stringify(snapshot).includes("SECRET"), false);
  assert.equal(snapshot.attachments[0].id, "photo");
});

test("malformed saved vectors cannot feed non-finite or extreme coordinates into VR", () => {
  assert.ok(normalizeBoardState(null).id);
  const state = normalizeBoardState({ selectedIds: {}, nodes: [{ id: "n", source: null, transform: null },
    { id: "huge", transform: { position: [1e300, -1e300, "oops"], scale: [Infinity, -5, 1e300] } }] });
  assert.deepEqual(state.nodes.huge.transform.position, [1e6, -1e6, 0]);
  assert.deepEqual(state.nodes.huge.transform.scale, [1, 0.000001, 1000]);
});
