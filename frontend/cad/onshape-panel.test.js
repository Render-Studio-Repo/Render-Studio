import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterOnshapeLibrary,
  isOnshapeThumbnailFallbackUrl,
  onshapeThumbnailRequestUrl,
  shouldShow,
  isImportable,
} from "./onshape-library-ui.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.html"), "utf8");
const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../studio/app.js"), "utf8");
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "onshape-panel.js"), "utf8");

test("Onshape library refresh aborts the previous documents GET", () => {
  assert.match(src, /let onshapeDocsAbort = null; \/\/ leakfix62/);
  assert.match(src, /async function loadDocuments\(\)[\s\S]{0,1200}signal: ctl\.signal/);
});

test("Onshape openDocument aborts the previous elements GET", () => {
  assert.match(src, /let onshapeElementsAbort = null; \/\/ leakfix90/);
  assert.match(src, /async function openDocument\(doc\)[\s\S]{0,1200}signal: ctl\.signal/);
});

test("Onshape file thumbs track and revoke blob URLs on repaint and close", () => {
  assert.match(src, /trackObjectUrl\(blob, created\)/);
  assert.match(src, /revokeTrackedObjectUrls\(thumbs\)/);
  assert.match(src, /revokeTrackedObjectUrls\(filePickerModal\._onshapeThumbCreated\)/);
  assert.match(src, /function revokeOnshapeThumbsIn/);
  assert.match(src, /leakfix24/);
  assert.match(app, /leakfix24/);
});

test("Onshape thumbnail proxy URLs match Fusion fetch→blob pattern", () => {
  const docUrl = onshapeThumbnailRequestUrl({
    did: "aaaaaaaaaaaaaaaaaaaaaaaa",
    wid: "bbbbbbbbbbbbbbbbbbbbbbbb",
    fallbackUrl: "https://cad.onshape.com/api/thumbnails/d/aaaaaaaaaaaaaaaaaaaaaaaa/w/bbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assert.match(docUrl, /^\/api\/onshape\/thumbnail\?/);
  assert.match(docUrl, /did=aaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(docUrl, /wid=bbbbbbbbbbbbbbbbbbbbbbbb/);
  assert.match(docUrl, /fallback_url=/);
  assert.equal(docUrl.includes("eid="), false);

  const partUrl = onshapeThumbnailRequestUrl({
    did: "aaaaaaaaaaaaaaaaaaaaaaaa",
    wid: "bbbbbbbbbbbbbbbbbbbbbbbb",
    eid: "cccccccccccccccccccccccc",
    large: true,
  });
  assert.match(partUrl, /eid=cccccccccccccccccccccccc/);
  assert.match(partUrl, /size=300x300/);
  assert.equal(isOnshapeThumbnailFallbackUrl("https://evil.example/thumb.png"), false);
  assert.equal(isOnshapeThumbnailFallbackUrl("https://cad.onshape.com/api/thumbnails/d/x/w/y"), true);
});

test("Onshape library search filters documents and parts", () => {
  const docs = [
    { name: "Bracket plate", type: "PARTSTUDIO" },
    { name: "Motor mount", type: "ASSEMBLY" },
    { name: "notes.txt", type: "BLOB" },
  ];
  assert.deepEqual(filterOnshapeLibrary(docs, "mount").map((row) => row.name), ["Motor mount"]);
  assert.equal(filterOnshapeLibrary(docs, "").length, 3);
  assert.equal(filterOnshapeLibrary(docs, "assembly").length, 1);
});

test("Onshape importable parts hide system and app elements", () => {
  assert.equal(shouldShow({ name: "Main", type: "PARTSTUDIO" }), true);
  assert.equal(shouldShow({ name: "BOM", type: "PARTSTUDIO" }), false);
  assert.equal(isImportable({ name: "housing.step", type: "BLOB" }), true);
  assert.equal(isImportable({ name: "notes.pdf", type: "BLOB" }), false);
});

test("Onshape OAuth connect and callback stay wired", () => {
  const panel = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "./onshape-panel.js"), "utf8");
  assert.match(html, /id="btn-onshape-connect"/);
  assert.match(app, /initOnshapePanel/);
  assert.match(app, /onshape-panel\.js\?v=20260908-cad-thumbs1/);
  assert.match(html, /cad=20260908-cad-thumbs1/);
  assert.match(panel, /\/api\/onshape\/oauth-url/);
  assert.match(panel, /\/api\/onshape\/status/);
  assert.match(panel, /render3d:oauth-done/);
});
