import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFERENCE_FILES_GRID_CLASS,
  collectProjectReferenceItems,
  filterBrowserEntriesByName,
  formatReferenceTimestamp,
  isReferenceFolderOpen,
  isReferenceVirtualFolder,
  nestReferenceFolderItems,
  referenceFolderKey,
  sortReferenceEntries,
  kindFromName,
  isReferenceFilename,
  referenceDiskPath,
  resolveViewerKind,
  isTextLikeKind,
  containFitSize,
  imageEditorPaneSize,
  imageMarkupToolFromCanvasShortcut,
} from "./reference-files.js";
import { highlightSource, highlightJsonLine } from "../wiring/code-highlight.js";
import { parseCsvText } from "./spreadsheet-preview.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
const browser = readFileSync(join(here, "../workspace/workspace-browser.js"), "utf8");

test("sortReferenceEntries defaults to newest first and can reverse", () => {
  const nested = nestReferenceFolderItems([
    { name: "old.png", folder: "Images", mtime: 10 },
    { name: "new.png", folder: "Images", mtime: 30 },
    { name: "mid.png", folder: "Images", mtime: 20 },
  ]);
  const newest = sortReferenceEntries(nested, "newest");
  const images = newest.find((row) => row.id === "folder:Images");
  assert.ok(images);
  assert.deepEqual((images.children || []).map((c) => c.name), ["new.png", "mid.png", "old.png"]);

  const oldest = sortReferenceEntries(nested, "oldest");
  const oldImages = oldest.find((row) => row.id === "folder:Images");
  assert.deepEqual((oldImages.children || []).map((c) => c.name), ["old.png", "mid.png", "new.png"]);
});

test("search keeps matching files inside nested folders", () => {
  const nested = collectProjectReferenceItems({
    references: [
      { name: "clip-edited.webm", folder: "Video Editor/Harbor Cut", mtime: 5 },
      { name: "Autoprep X Showme.Gif", mtime: 2 },
    ],
  });
  const hit = filterBrowserEntriesByName(nested, "harbor");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].id, "folder:Video Editor");
  assert.equal(hit[0].children[0].name, "Harbor Cut");
  assert.equal(hit[0].children[0].children[0].name, "clip-edited.webm");
});

test("nested folder collapse keys stay independent", () => {
  const parent = { folder: "Canvas", virtual_folder: true, children: [{ name: "a.png", mtime: 1 }] };
  const child = { folder: "Canvas/Harbor", virtual_folder: true, children: [{ name: "b.png", mtime: 2 }] };
  const parentKey = referenceFolderKey("proj-1", parent);
  const childKey = referenceFolderKey("proj-1", child);
  assert.notEqual(parentKey, childKey);
  const expanded = new Set();
  assert.equal(isReferenceFolderOpen(expanded, parentKey), false);
  assert.equal(isReferenceFolderOpen(expanded, childKey), false);
  expanded.add(parentKey);
  assert.equal(isReferenceFolderOpen(expanded, parentKey), true);
  assert.equal(isReferenceFolderOpen(expanded, childKey), false);
  assert.equal(isReferenceVirtualFolder(child), true);
  const ve = nestReferenceFolderItems([
    { name: "clip.webm", folder: "Video Editor/Harbor Cut", mtime: 1 },
  ]).find((row) => row.id === "folder:Video Editor");
  assert.equal(ve?.default_collapsed, true);
  assert.equal(ve?.children?.[0]?.default_collapsed, true);
  assert.equal(isReferenceFolderOpen(new Set(), referenceFolderKey("p", ve)), false);
  assert.equal(isReferenceFolderOpen(new Set(), referenceFolderKey("p", ve.children[0])), false);
});

test("grid class and timestamps are wired for the refs pane", () => {
  assert.equal(REFERENCE_FILES_GRID_CLASS, "refs-files-grid");
  assert.match(css, /\.refs-files-grid\b/);
  assert.match(browser, /REFERENCE_FILES_GRID_CLASS/);
  assert.match(browser, /refs-files-grid/);
  assert.match(browser, /proj-hierarchy-item-time/);
  assert.match(browser, /aria-expanded/);
  const when = formatReferenceTimestamp({ name: "shot.png", mtime: 1_700_000_000 });
  assert.match(when, /\d/);
});

test("Reference Files tab and implementation remain wired", () => {
  assert.match(app, /reference-files\.js/);
  assert.match(html, /data-explorer-pane="references"/);
  assert.match(html, /Reference Files/);
});

test("image editor fits to the viewer and reuses canvas shortcuts", () => {
  const src = readFileSync(join(here, "reference-files.js"), "utf8");
  const fitted = containFitSize(800, 400, 400, 400, 0);
  assert.equal(fitted.width, 400);
  assert.equal(fitted.height, 200);
  assert.equal(fitted.scale, 0.5);
  assert.deepEqual(imageEditorPaneSize({ clientWidth: 12, clientHeight: 8 }, { clientWidth: 900, clientHeight: 640 }), { width: 900, height: 640 });
  assert.deepEqual(imageEditorPaneSize({ clientWidth: 800, clientHeight: 500 }), { width: 800, height: 500 });
  assert.match(css, /\.ref-viewer-main\s*>\s*\.ref-split-pane[\s\S]{0,180}flex:\s*1/);
  assert.equal(imageMarkupToolFromCanvasShortcut("v"), "select");
  assert.equal(imageMarkupToolFromCanvasShortcut("p"), "pen");
  assert.equal(imageMarkupToolFromCanvasShortcut("a"), "arrow");
  assert.equal(imageMarkupToolFromCanvasShortcut("t"), "text");
  assert.equal(imageMarkupToolFromCanvasShortcut("r"), "rect");
  assert.equal(imageMarkupToolFromCanvasShortcut("n"), "note");
  assert.match(src, /CANVAS_TOOL_SHORTCUTS/);
  assert.match(src, /object-fit: contain|containFitSize/);
  assert.match(src, /fitImageToPane/);
  assert.match(src, /canvas-text-input/);
  assert.match(src, /Select \/ move \(V\)/);
  assert.match(src, /Connector arrow \(A\)/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /data-shell-tab="image".*#canvas-workspace/s);
  assert.match(css, /\.ref-markup-toolbar[\s\S]*flex-wrap:\s*nowrap/);
  const canvasImport = src.match(/canvas-mode\.js\?v=[^"']+/)?.[0];
  const appCanvasImport = app.match(/canvas-mode\.js\?v=[^"']+/)?.[0];
  assert.equal(canvasImport, appCanvasImport);
});

test("kindFromName maps json csv xlsx and code like the wiring editor", () => {
  assert.equal(kindFromName("notes.txt"), "text");
  assert.equal(kindFromName("schema.json"), "json");
  assert.equal(kindFromName("Canvas/Board/canvas.json"), "json");
  assert.equal(kindFromName("parts.csv"), "csv");
  assert.equal(kindFromName("bom.xlsx"), "spreadsheet");
  assert.equal(kindFromName("main.py"), "code");
  assert.equal(kindFromName("app.ts"), "code");
  assert.equal(kindFromName("styles.css"), "code");
  assert.equal(kindFromName("index.html"), "code");
  assert.equal(kindFromName("readme.md"), "code");
  assert.equal(kindFromName("config.yml"), "code");
  assert.equal(kindFromName("setup.sh"), "code");
  assert.equal(isTextLikeKind("json"), true);
  assert.equal(isTextLikeKind("spreadsheet"), false);
  assert.equal(resolveViewerKind("canvas.json", "text"), "json");
  assert.equal(resolveViewerKind("shot.png", "image"), "image");
  assert.equal(isReferenceFilename("main.js"), true);
  assert.equal(isReferenceFilename("script.py"), true);
  assert.equal(isReferenceFilename("IMG_1234.heic"), true);
  assert.equal(isReferenceFilename("scan.HEIF"), true);
  assert.equal(kindFromName("IMG_1234.heic"), "image");
  assert.equal(kindFromName("scan.heif"), "image");
  assert.equal(kindFromName("lozee 2.Mp3"), "audio");
  assert.equal(kindFromName("bed.wav"), "audio");
  assert.equal(resolveViewerKind("lozee 2.Mp3", "file"), "audio");
  assert.equal(isReferenceFilename("lozee 2.Mp3"), true);
});

test("nested canvas.json uses the references/Canvas/... disk path", () => {
  const path = referenceDiskPath({
    name: "canvas.json",
    folder: "Canvas/Headset",
    url: "references/Canvas/Headset/canvas.json",
  });
  assert.equal(path, "references/Canvas/Headset/canvas.json");
  assert.equal(
    referenceDiskPath({ name: "references/Canvas/Headset/canvas.json" }),
    "references/Canvas/Headset/canvas.json",
  );
});

test("triggerBlobDownload uses triggerTrackedBlobDownload, not 60s revoke", () => {
  const src = readFileSync(join(here, "reference-files.js"), "utf8");
  assert.match(src, /import \{ triggerTrackedBlobDownload, attachPreviewObjectUrl, trackObjectUrl, revokeTrackedObjectUrls \}/);
  const start = src.indexOf("function triggerBlobDownload");
  const end = src.indexOf("\n  function ", start + 1);
  assert.ok(start >= 0 && end > start, "triggerBlobDownload missing");
  const fn = src.slice(start, end);
  assert.match(fn, /triggerTrackedBlobDownload\(blob, filename, refDownloadCreated\)/);
  assert.equal(fn.includes("60_000"), false);
  assert.equal(fn.includes("createObjectURL"), false);
});

test("reference preview blob URLs use trackObjectUrl / attachPreviewObjectUrl", () => {
  const src = readFileSync(join(here, "reference-files.js"), "utf8");
  assert.equal(src.includes("URL.createObjectURL"), false);
  assert.match(src, /trackObjectUrl\(blob, mcmThumbCreated\)/);
  assert.match(src, /trackObjectUrl\(blob, refMiniThumbCreated\)/);
  assert.match(src, /trackObjectUrl\(blob, tab\._blobCreated\)/);
  assert.match(src, /attachPreviewObjectUrl\(el, blob, tab\._previewCreated\)/);
  assert.match(src, /revokeMiniThumbs\(\)/);
  assert.match(src, /revokeTrackedObjectUrls\(refMiniThumbCreated\)/);
});

test("json highlighter and csv parser support the reference viewer", () => {
  const jsonLine = highlightJsonLine('  "name": "canvas",');
  assert.match(jsonLine, /tok-key/);
  assert.match(jsonLine, /tok-string/);
  const src = highlightSource('{"ok": true}\n{"skip": 1}', { mode: "json", query: "ok" });
  assert.match(src, /is-hit/);
  assert.deepEqual(parseCsvText("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});
