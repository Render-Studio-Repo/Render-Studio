import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  historyProjectFileUrl,
  historyImageSrc,
  historyEntryThumbImages,
} from "./prompt-history.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "prompt-history.js"), "utf8");

test("unified history rows keep CAD entries and render Imagine/wiring thumbs", () => {
  const url = historyProjectFileUrl("proj-1", "imagine/kettle.png");
  assert.equal(url, "/api/projects/proj-1/files/imagine/kettle.png");
  assert.equal(
    historyImageSrc({ url: "/api/projects/proj-1/files/imagine/kettle.png" }),
    "/api/projects/proj-1/files/imagine/kettle.png",
  );
  const thumbs = historyEntryThumbImages({
    id: "im1",
    kind: "imagine",
    filename: "imagine/kettle.png",
    images: [{ name: "kettle.png", source_filename: "imagine/kettle.png" }],
  }, "proj-1");
  assert.equal(thumbs.length, 1);
  assert.match(thumbs[0].src, /imagine\/kettle\.png$/);
  const fromFile = historyEntryThumbImages({
    id: "im2",
    kind: "imagine",
    filename: "imagine/lamp.png",
    images: [],
  }, "proj-1");
  assert.equal(fromFile.length, 1);
  assert.match(src, /data-kind=/);
  assert.match(src, /ph-thumbs/);
  assert.match(src, /applyReuseTab/);
  assert.match(src, /historyKindLabel/);
});
