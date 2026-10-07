import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Architect library cards use still images instead of per-card mini viewers", () => {
  const app = readFileSync(new URL("../studio/app.js", import.meta.url), "utf8");
  const start = app.indexOf("async function renderArchitectLibrary()");
  assert.ok(start >= 0);
  const end = app.indexOf("function openArchitectLibrary(", start);
  const body = app.slice(start, end > start ? end : start + 8000);
  assert.match(body, /architectStillPreviewUrl/);
  assert.match(body, /data-architect-still/);
  assert.doesNotMatch(body, /createMiniViewer/);
  assert.doesNotMatch(body, /data-architect-glb-preview/);
});

test("Studio does not import the public share-viewer into mini previews", () => {
  const mini = readFileSync(new URL("./mini-viewer.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../studio/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(mini, /from ["'].*share-viewer/);
  const importAt = app.indexOf('from "../viewport/mini-viewer.js');
  assert.ok(importAt >= 0);
  assert.match(app.slice(Math.max(0, importAt - 80), importAt + 200), /miniview1/);
});
