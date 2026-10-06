import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHARE_MARKUP_TOOLS,
  circleBoxFromDrag,
  clientToNorm,
  commentPayloadFromMarkup,
  createShareVideoMarkup,
  markupFromComment,
  markupSvgInner,
  markupVisibleAtTime,
  shareFullscreenBlocked,
} from "./share-video-markup.js";

const here = dirname(fileURLToPath(import.meta.url));
const shareHtml = readFileSync(join(here, "../pages/share.html"), "utf8");
const shareViewer = readFileSync(join(here, "share-viewer.js"), "utf8");
const shareMode = readFileSync(join(here, "../../backend/services/share_mode.py"), "utf8");

test("markup appears once the playhead passes its time", () => {
  const mark = { t: 4, tool: "circle" };
  assert.equal(markupVisibleAtTime(mark, 3.8), false);
  assert.equal(markupVisibleAtTime(mark, 4), true);
  assert.equal(markupVisibleAtTime(mark, 6.5), true);
  assert.equal(markupVisibleAtTime(mark, 12), false);
  assert.equal(markupVisibleAtTime(mark, 3.95, 0.08), true);
});

test("circle drag stores a 1:1 pixel circle as a normalized box", () => {
  const box = circleBoxFromDrag({ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.5 }, 200, 100);
  assert.ok(Math.abs(box.w * 200 - box.h * 100) < 0.001);
  const pos = clientToNorm(150, 40, { left: 100, top: 20, width: 200, height: 80 });
  assert.equal(pos.x, 0.25);
  assert.equal(pos.y, 0.25);
});

test("comments round-trip marker geometry and skip drag-text notes", () => {
  const payload = commentPayloadFromMarkup({
    tool: "pen",
    t: 2.5,
    points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
  });
  assert.equal(payload.kind, "markup");
  assert.equal(payload.tool, "pen");
  assert.equal(payload.geometry.points.length, 2);
  const parsed = markupFromComment({ ...payload, id: "m1" });
  assert.equal(parsed.tool, "pen");
  assert.equal(parsed.points.length, 2);
  const svg = markupSvgInner([parsed], 3);
  assert.match(svg, /<path /);
  assert.equal(markupSvgInner([parsed], 1), "");
  assert.ok(SHARE_MARKUP_TOOLS.some((tool) => tool.id === "note"));
  assert.equal(SHARE_MARKUP_TOOLS.some((tool) => tool.id === "text"), false);
});

test("fullscreen is blocked on iPhone, small viewports, and coarse touch", () => {
  assert.equal(shareFullscreenBlocked({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), true);
  assert.equal(shareFullscreenBlocked({ ua: "Mozilla/5.0", innerWidth: 390 }), true);
  assert.equal(shareFullscreenBlocked({
    ua: "Mozilla/5.0",
    innerWidth: 1280,
    matchMedia: (q) => ({ matches: q.includes("pointer: coarse") }),
  }), true);
  assert.equal(shareFullscreenBlocked({ ua: "Mozilla/5.0 (Macintosh)", innerWidth: 1280 }), false);
});

test("share page wires markup overlay, note popup, and hides mobile fullscreen", () => {
  assert.match(shareHtml, /id="share-video-markup"/);
  assert.match(shareHtml, /id="share-markup-note"/);
  assert.match(shareHtml, /data-share-markup="pen"/);
  assert.match(shareHtml, /data-share-markup="note"/);
  assert.match(shareHtml, /data-share-markup="view-mark"/);
  assert.match(shareHtml, /share-no-fs/);
  assert.match(shareHtml, /#btn-share-mobile-fullscreen[\s\S]*display:\s*none\s*!important/);
  assert.match(shareViewer, /share-video-markup\.js\?v=20260915-sharemarkup1-20260915-sharelive1&leakfix34/);
  assert.match(shareViewer, /createShareVideoMarkup/);
  assert.match(shareMode, /resolved_kind = "markup"/);
});

test("pressing the same tool again or Esc returns to select", () => {
  const toolsRoot = { addEventListener() {}, querySelectorAll: () => [] };
  const overlay = { addEventListener() {}, classList: { toggle() {} }, setAttribute() {}, querySelectorAll: () => [] };
  const ctl = createShareVideoMarkup({ toolsRoot, overlay, getComments: () => [] });
  ctl.setTool("circle");
  assert.equal(ctl.getTool(), "circle");
  ctl.setTool("circle", { toggle: true });
  assert.equal(ctl.getTool(), "select");
  ctl.setTool("face-mark");
  ctl.disableTool();
  assert.equal(ctl.getTool(), "select");
});

test("markup bake revokes prior frame URL before the next rAF (leakfix34)", () => {
  const src = readFileSync(join(here, "share-video-markup.js"), "utf8");
  assert.match(src, /let markupFrameUrl = ""; \/\/ leakfix34/);
  assert.match(src, /if \(markupFrameUrl\) dropMarkupFrameUrl\(markupFrameUrl\); \/\/ leakfix34/);
  assert.match(src, /img\.onerror = \(\) => dropMarkupFrameUrl\(url\)/);
  assert.match(src, /dropMarkupFrameUrl\(markupFrameUrl\); \/\/ leakfix34/);
});
