import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEACH1_TOKEN, TEACH_DIR, teachingMarkup } from "./sandbox-teaching-record.js";

test("teaching record writes sandbox-sessions and hooks draw events", () => {
  assert.equal(TEACH1_TOKEN, "teach1");
  assert.equal(TEACH_DIR, "sandbox-sessions/teaching");
  const html = teachingMarkup();
  assert.match(html, /Record teaching session/);
  assert.match(html, /data-sb-teach-record/);
  assert.match(html, /Run sim unattended/);
  assert.match(html, /cook-like|Cook:/);
  assert.match(html, /data-sb-teach-moves/);
  assert.match(html, /data-sb-teach-mail/);
  const src = readFileSync(new URL("./sandbox-teaching-record.js", import.meta.url), "utf8");
  assert.match(src, /render3d-sandbox-draw/);
  assert.match(src, /draw_strokes/);
  assert.match(src, /latest-draw\.json/);
  const wb = readFileSync(new URL("./smart-whiteboard.js", import.meta.url), "utf8");
  assert.match(wb, /render3d-sandbox-draw/);
});
