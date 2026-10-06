import test from "node:test";
import assert from "node:assert/strict";
import { createXrAiBoardStore } from "./xr-ai-board-state.js";
import { organizeBoardPrompt, createBoardSnapshot } from "./xr-ai-board-graph.js";
import { createXrDrawPromptBridge, readDrawPromptImage, XR_DRAW_PROMPT_IMAGE_BYTES } from "./xr-ai-draw-prompt.js";

function boardFixture() {
  const board = createXrAiBoardStore({ id: "test-board" });
  board.dispatch({ type: "batch", commands: [
    { type: "node.add", node: { id: "model", name: "Bracket", kind: "model", source: { filename: "bracket.glb", projectId: "p", revision: "r1", units: "mm" } } },
    { type: "node.add", node: { id: "image", name: "Finished look", kind: "image", finalLook: true, source: { filename: "references/finish.png", projectId: "p", url: "/api/projects/p/files/references/finish.png" } } },
    { type: "region.add", region: { id: "split", name: "Split area", nodeId: "model", anchor: { nodeId: "model", sourceRevision: "r1", faceId: "cad-face-a", meshId: "mesh-7", triangleIndex: 24, localPoints: [[1, 2, 3]], localNormal: [0, 1, 0] } } },
    { type: "note.add", note: { id: "note", regionId: "split", name: "Print instruction", text: "Split and assemble afterward." } },
    { type: "link.add", link: { id: "link", fromId: "split", toId: "image", caption: "Final look @{image}" } },
  ] });
  return board;
}
function harness({ imageGate } = {}) {
  let draft = "Preserve this exact original idea.";
  const images = [{ id: "existing-image", source_filename: "earlier.png", projectId: "p" }];
  const references = [{ id: "existing-document", type: "document", label: "Keep this", text_content: "Original attachment" }];
  const calls = { images: 0, references: 0, replaced: 0 }, statuses = [];
  const bridge = createXrDrawPromptBridge({
    getDraft: () => draft, setDraft: (value) => { draft = value; }, getAttachments: () => ({ images, references }),
    appendImage: async (image) => { calls.images++; if (imageGate) await imageGate(); images.push(image); return true; },
    appendReference: (ref) => { calls.references++; const i = references.findIndex((x) => x.id === ref.id); if (i < 0) references.push(ref); else references[i] = ref; return true; },
    replaceReference: (ref) => { calls.replaced++; const i = references.findIndex((x) => x.id === ref.id); assert.ok(i >= 0); references[i] = ref; },
    onStatus: (s) => statuses.push(s),
  });
  return { bridge, images, references, calls, statuses, get draft() { return draft; }, set draft(v) { draft = v; } };
}

test("organize appends real model/image/surface references while preserving draft and existing attachments", async () => {
  const board = boardFixture(), h = harness();
  const result = organizeBoardPrompt(board.getState(), { prompt: h.draft });
  await h.bridge.organize(result);
  assert.match(h.draft, /^Preserve this exact original idea\./);
  assert.match(h.draft, /@Finished look \[image\]/);
  assert.equal(h.images.length, 2);
  assert.equal(h.images[0].id, "existing-image");
  assert.equal(h.references[0].id, "existing-document");
  const surface = h.references.find((r) => r.id === "vr-board:split");
  assert.equal(surface.geometry_context.faceId, "cad-face-a");
  assert.equal(surface.geometry_context.triangleIndex, 24);
  assert.equal(surface.face_index, undefined);
  await h.bridge.organize(organizeBoardPrompt(board.getState(), { prompt: h.draft }));
  assert.equal(h.calls.images, 1);
  assert.equal(h.references.filter((r) => r.id === "vr-board:model").length, 1);
});

test("draft edits made while an image loads are kept", async () => {
  let release;
  const h = harness({ imageGate: () => new Promise((resolve) => { release = resolve; }) }), board = boardFixture();
  const pending = h.bridge.organize(organizeBoardPrompt(board.getState(), { prompt: h.draft }));
  while (!release) await Promise.resolve();
  h.draft = "My newer edit while attaching.";
  release(); await pending;
  assert.match(h.draft, /^My newer edit while attaching\./);
  assert.match(h.draft, /VR Draw board/);
});

test("explicit prepare sends immutable spatial JSON through supported prompt and document reference fields", async () => {
  const board = boardFixture(), h = harness(), reviewed = h.draft;
  const result = await h.bridge.prepare(createBoardSnapshot(board.getState(), { prompt: reviewed }));
  assert.equal(result.ok, true);
  assert.equal(result.reviewedDraft, reviewed);
  assert.equal(h.draft, reviewed);
  assert.match(result.prompt, /VR DRAW SPATIAL SNAPSHOT/);
  assert.match(result.prompt, /cad-face-a/);
  assert.equal(result.spatialReference.type, "document");
  assert.equal(JSON.parse(result.spatialReference.text_content).graph.regions[0].anchor.triangleIndex, 24);
  board.dispatch({ type: "note.update", id: "note", patch: { text: "Changed later" } });
  assert.equal(result.snapshot.graph.notes[0].text, "Split and assemble afterward.");
  assert.ok(Object.isFrozen(result.snapshot.graph.notes[0]));
  assert.ok(Object.isFrozen(result.references));
  assert.ok(Object.isFrozen(result.references.find(ref => ref.id === "vr-board:split").geometry_context));
  assert.equal(result.references.find(ref => ref.id === "vr-board:model").geometry_context.sourceRevision, "r1");
  const second = await h.bridge.prepare(createBoardSnapshot(board.getState(), { prompt: reviewed }));
  assert.equal(second.ok, true);
  assert.equal(h.references.filter((r) => r.id.startsWith("vr-board-snapshot:")).length, 1);
  assert.equal(result.snapshot.graph.notes[0].text, "Split and assemble afterward.");
  assert.equal(JSON.parse(h.references.find((r) => r.id.startsWith("vr-board-snapshot:")).text_content).graph.notes[0].text, "Changed later");
});

test("invalid revision and unanswered split clarification block preparation before attachments", async () => {
  const board = boardFixture(), h = harness();
  board.dispatch({ type: "node.update", id: "model", patch: { source: { filename: "bracket.glb", revision: "r2" } } });
  assert.match((await h.bridge.prepare(createBoardSnapshot(board.getState(), { prompt: h.draft }))).error, /Reattach/);
  assert.equal(h.calls.images, 0);
  board.undo();
  board.dispatch({ type: "note.update", id: "note", patch: { requirements: { pending: true, missingDetails: ["printerModel", "jointStyle"] } } });
  assert.match((await h.bridge.prepare(createBoardSnapshot(board.getState(), { prompt: h.draft }))).error, /clarification/);
  assert.equal(h.calls.images, 0);
});

test("name sync only changes previously attached board references and never rewrites the draft", async () => {
  const board = boardFixture(), h = harness();
  await h.bridge.organize(organizeBoardPrompt(board.getState(), { prompt: h.draft }));
  const draft = h.draft, count = h.references.length;
  board.dispatch({ type: "node.update", id: "image", patch: { name: "New look name", finalLook: false } });
  board.dispatch({ type: "node.add", node: { id: "unattached", kind: "model", name: "Do not attach me" } });
  assert.ok(h.bridge.syncNames(board.getState()) > 0);
  assert.equal(h.references.length, count);
  assert.equal(h.draft, draft);
  assert.equal(h.references.find((r) => r.id === "vr-board:image").label, "New look name");
  assert.equal(h.references.find((r) => r.id === "vr-board:image").final_example, false);
  assert.equal(h.references.some((r) => r.id === "vr-board:unattached"), false);
});

test("surface references convert presentation-local loops back to original source mesh coordinates", async () => {
  const board = boardFixture(), h = harness();
  const anchor = board.getState().regions.split.anchor;
  board.dispatch({ type: "region.update", id: "split", patch: { anchor: { ...anchor, sourceLocalPoint: [11, 22, 33],
    boardToSourceMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1] } } });
  await h.bridge.organize(organizeBoardPrompt(board.getState(), { prompt: h.draft }));
  const ref = h.references.find((r) => r.id === "vr-board:split");
  assert.deepEqual(ref.local_point, [11, 22, 33]);
  assert.deepEqual(ref.loop_points[0], [11, 22, 33]);
});

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7HsAAAAASUVORK5CYII=", "base64"));
test("project image attachment validates container bytes and dimensions before normalization", async () => {
  let normalized = false;
  const result = await readDrawPromptImage({ name: "tiny.png", url: "/api/projects/p/files/tiny.png" }, {
    fetchFile: async () => new Response(PNG), normalizeImage: async (data_url, media_type) => { normalized = true; return { data_url, media_type }; },
  });
  assert.equal(normalized, true);
  assert.equal(result.media_type, "image/png");
  assert.match(result.data_url, /^data:image\/png;base64,/);
  const huge = PNG.slice(); new DataView(huge.buffer).setUint32(16, 100000);
  normalized = false;
  await assert.rejects(readDrawPromptImage({ name: "huge.png", url: "/api/projects/p/files/huge.png" }, { fetchFile: async () => new Response(huge), normalizeImage: async () => { normalized = true; } }), /too large|megapixel/);
  assert.equal(normalized, false);
});

test("oversized streamed data and remote image URLs cannot reach image normalization", async () => {
  let fetched = false;
  await assert.rejects(readDrawPromptImage({ name: "remote", url: "https://example.com/image.png" }, { fetchFile: () => { fetched = true; } }), /saved in this project/);
  assert.equal(fetched, false);
  await assert.rejects(readDrawPromptImage({ name: "big.png", url: "/api/projects/p/files/big.png" }, { fetchFile: async () => new Response(new Uint8Array(XR_DRAW_PROMPT_IMAGE_BYTES + 1)) }), /held off in VR/);
});
