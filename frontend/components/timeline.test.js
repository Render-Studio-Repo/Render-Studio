import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { timelineEntryUsedCanvas, timelineCanvasIconLabel } from "./timeline.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "timeline.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
const overlay = readFileSync(join(here, "../viewport/viewer-overlay.js"), "utf8");
const backend = readFileSync(join(here, "../../backend/main.py"), "utf8");

test("canvas-backed timeline steps use CAD/MESH plus painting, others keep ✦", () => {
  assert.equal(timelineEntryUsedCanvas({ kind: "prompt" }), false);
  assert.equal(timelineEntryUsedCanvas({ kind: "prompt", from_canvas: true }), true);
  assert.equal(timelineEntryUsedCanvas({ kind: "prompt", meta: { from_canvas: true } }), true);
  assert.equal(timelineEntryUsedCanvas({ kind: "prompt", request_body: { from_canvas: true } }), true);
  assert.equal(timelineCanvasIconLabel({ kind: "prompt", mode: "v2", from_canvas: true }), "CAD 🎨");
  assert.equal(timelineCanvasIconLabel({ kind: "prompt", mode: "mesh", from_canvas: true }), "MESH 🎨");
  assert.match(src, /k === "import" \|\| k === "autodesk_import"/);
  assert.match(src, /k === "fusion_sync"/);
  assert.match(src, /timeline-canvas-paint/);
  assert.match(src, /timeline-step--canvas/);
  assert.match(css, /timeline-step--canvas/);
  assert.match(css, /timeline-canvas-paint/);
  assert.match(app, /from_canvas: true/);
  assert.match(app, /usedCanvas/);
  assert.match(app, /canvashist1/);
  assert.match(overlay, /generationUsedCanvas/);
  assert.match(backend, /from_canvas: bool/);
  assert.match(backend, /meta\["from_canvas"\] = True/);
});
