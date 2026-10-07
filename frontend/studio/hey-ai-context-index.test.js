import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHeyAiContextIndex,
  compactPromptHistory,
  compactReferenceIndex,
  readHeyAiContextIndex,
  rememberHeyAiSessionSummary,
  resolveIndexedReference,
} from "./hey-ai-context-index.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

test("prompt history is newest-first, compact, and bounded", () => {
  const rows = compactPromptHistory([
    { id: "old", prompt: "old prompt", created_at: "2026-01-01" },
    { id: "new", prompt: "new prompt", filename: "part.glb", created_at: "2026-02-01" },
  ], 1);
  assert.deepEqual(rows.map((row) => row.id), ["new"]);
  assert.equal(rows[0].output, "part.glb");
});

test("reference index omits full content unless the in-memory reference is attached", () => {
  const refs = compactReferenceIndex([
    { id: "a", filename: "references/a.md", text_content: "secretly long text" },
    { id: "b", filename: "references/b.md", text_content: "selected details" },
  ], [{ id: "b" }]);
  assert.equal(refs[0].content_loaded, true);
  assert.equal("excerpt" in refs[0], false);
  assert.equal(refs[1].excerpt, "selected details");
});

test("voice summaries persist per project and survive index rebuilds", () => {
  const storage = memoryStorage();
  rememberHeyAiSessionSummary("p1", { id: "v1", summary: "Make the wrist bracket narrower", filename: "hey.json" }, storage);
  const previous = readHeyAiContextIndex("p1", storage);
  const index = buildHeyAiContextIndex({ projectId: "p1", previous, promptHistory: [{ prompt: "Build bracket" }] });
  assert.equal(index.voice_notes[0].summary, "Make the wrist bracket narrower");
});

test("only an indexed reference can be resolved for lazy reading", () => {
  const index = { references: [{ id: "manual", path: "references/manual.md", label: "Manual" }] };
  assert.equal(resolveIndexedReference(index, "manual").path, "references/manual.md");
  assert.equal(resolveIndexedReference(index, "../../outside"), null);
});
