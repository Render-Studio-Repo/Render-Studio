import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listedDownloadExports,
  timeoutDownloadExports,
  missingSourceDownloadMessage,
  stripExportTraceId,
} from "./file-download-list.js";

test("listed downloads drop empty files unless they are convertible", () => {
  const rows = listedDownloadExports([
    { name: "mesh/skull.glb", format: "glb", size: 1200 },
    { name: "mesh/skull.stl", format: "stl", size: 0 },
    { name: "mesh/skull.3mf", format: "3mf", size: 0, convertible: true },
    { name: "mesh/skull.step", format: "step", size: null },
  ]);
  assert.deepEqual(rows.map((r) => r.format), ["glb", "3mf", "step"]);
});

test("listed downloads keep convertible STEP with size 0", () => {
  const rows = listedDownloadExports([
    { name: "8020-1020-BLACK X 36_edited.glb", format: "glb", size: 181000 },
    { name: "8020-1020-BLACK X 36_edited.step", format: "step", size: 0, convertible: true },
  ]);
  assert.deepEqual(rows.map((r) => r.format), ["glb", "step"]);
});

test("timeout fallback keeps the nested path and does not invent STEP/STL/3MF", () => {
  const rows = timeoutDownloadExports("mesh/skull.glb");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "mesh/skull.glb");
  assert.equal(rows[0].format, "glb");
  assert.equal(timeoutDownloadExports("visible assembly").length, 0);
});

test("missing source message prefers the server reason and strips trace ids", () => {
  assert.equal(stripExportTraceId("File not found [trace #1ae3b256]"), "File not found");
  const msg = missingSourceDownloadMessage("mesh/skull.step", {
    message: "STEP was never generated for this model. Generation wrote GLB only. [trace #1ae3b256]",
  });
  assert.match(msg, /STEP was never generated/);
  assert.equal(msg.includes("trace #"), false);
  assert.match(
    missingSourceDownloadMessage("part.glb", { message: "File not found [trace #abc]" }),
    /never wrote this file/,
  );
});

test("export menu no longer invents missing GLB/STL/STEP/3MF on a 404", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "./file-actions.js"), "utf8");
  assert.equal(src.includes("Click a format to download"), false);
  assert.match(src, /timeoutDownloadExports/);
  assert.match(src, /let fusionExportAbort = null; \/\/ leakfix81/);
  assert.match(src, /const loadFolders = async \(\) => \{[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(src, /let exportShareWorkspaceAbort = null; \/\/ leakfix82/);
  assert.match(src, /async function showShareWorkspacePicker\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(src, /let exportOnshapeSourceAbort = null; \/\/ leakfix91/);
  assert.match(src, /onshape-source`, \{ headers: authHeaders\(\), signal: ctl\.signal \}/);
  assert.match(src, /missingSourceDownloadMessage/);
  assert.equal(/file-export-solidworks" title=/.test(src), false);
});

test("export menu paints before awaiting Onshape/Fusion link checks", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "./file-actions.js"), "utf8");
  const start = src.indexOf("export async function openFileExportMenu");
  const end = src.indexOf("\nfunction detectClientOs", start);
  assert.ok(start >= 0 && end > start, "openFileExportMenu block missing");
  const fn = src.slice(start, end);
  const appendAt = fn.indexOf("document.body.appendChild(menu)");
  assert.ok(appendAt > 0, "menu must be appended to the document");
  const beforePaint = fn.slice(0, appendAt);
  assert.equal(beforePaint.includes("await checkOnshapeLinked"), false);
  assert.equal(beforePaint.includes("await checkAutodeskLinked"), false);
  assert.equal(beforePaint.includes("onshape-source"), false);
  assert.equal(beforePaint.includes("autodesk-source"), false);
  assert.match(fn, /renderExportPlaceholders\(list\)/);
  assert.match(fn, /Preparing exports…/);
  assert.match(src, /CAD_LINK_CACHE_MS/);
  const afterPaint = fn.slice(appendAt);
  assert.match(afterPaint, /checkOnshapeLinked/);
  assert.match(afterPaint, /checkAutodeskLinked/);
  assert.match(fn, /projectFileApiPath\(projectId, filename\)/);
  assert.match(src, /function projectFileApiPath[\s\S]*encodeProjectFilePath\(filename\)/);
  assert.equal(src.includes("Export preparation is taking too long."), false);
  assert.equal(src.includes("await withTimeout("), false);
});

test("Fusion export picker can create a folder via existing Autodesk Data Management route", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "./file-actions.js"), "utf8");
  assert.match(src, /data-fusion-new-folder/);
  assert.match(src, /file-export-fusion-new-folder-icon/);
  assert.match(src, /\/api\/autodesk\/projects\/\$\{encodeURIComponent\(apsProjectId\)\}\/folders/);
  assert.match(src, /parent_folder_id/);
  assert.match(src, /createFusionFolder/);
  assert.equal(src.includes("developer.api.autodesk.com"), false);
});

test("downloadFile and baked GLB use triggerTrackedBlobDownload, not 60s revoke", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "./file-actions.js"), "utf8");
  const start = src.indexOf("export async function downloadFile");
  const end = src.indexOf("\nasync function copyText", start);
  assert.ok(start >= 0 && end > start, "downloadFile block missing");
  const fn = src.slice(start, end);
  assert.match(fn, /triggerTrackedBlobDownload\(blob, filename, fileDownloadCreated\)/);
  assert.equal(fn.includes("60_000"), false);
  assert.equal(fn.includes("createObjectURL"), false);
  const bakeAt = src.indexOf("if (item.format === \"glb\" && typeof bakeGlbFn");
  assert.ok(bakeAt >= 0, "baked GLB branch missing");
  const bake = src.slice(bakeAt, bakeAt + 900);
  assert.match(bake, /triggerTrackedBlobDownload\(baked\.blob, dlName, fileDownloadCreated\)/);
  assert.equal(bake.includes("60_000"), false);
});

test("sidebar exportProject opens the menu before fetching project files", () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../studio/app.js"), "utf8");
  const start = app.indexOf("async function exportProject");
  const end = app.indexOf("async function refreshFiles", start);
  assert.ok(start >= 0 && end > start, "exportProject block missing");
  const fn = app.slice(start, end);
  const openAt = fn.indexOf("openFileExportMenu");
  const fetchAt = fn.indexOf("projectApiPath(pid)");
  assert.ok(openAt >= 0, "exportProject must open the export menu");
  assert.ok(fetchAt > openAt, "project file fetch must run after menu open (resolveExportTarget)");
  assert.match(fn, /resolveExportTarget/);
  assert.match(fn, /sidebarGuess/);
});

test("cross-device slicer handoff uses the server-issued public artifact URL", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "./file-actions.js"), "utf8");
  const start = src.indexOf("async function sendToPreferredSlicer");
  const end = src.indexOf("\nfunction ", start + 20);
  const fn = src.slice(start, end > start ? end : src.length);
  assert.match(fn, /const fileUrl = share\.file_url/);
  assert.doesNotMatch(fn, /const fileUrl = `\$\{window\.location\.origin\}/);
});

test("desktop slicer export asks to open on the clicking device without a laptop relay", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "./file-actions.js"), "utf8");
  const start = src.indexOf("async function sendToPreferredSlicer");
  const end = src.indexOf("\n/** Back-compat alias", start);
  const fn = src.slice(start, end);
  assert.doesNotMatch(fn, /requestSlicerOnPersonalLaptop/);
  assert.match(fn, /showSlicerFollowUp\(btn/);
  assert.doesNotMatch(fn, /personal laptop|this Mac|your laptop/i);
  assert.match(src, /Open in \$\{escText\(name\)\} on this device\?/);
});
