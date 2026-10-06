import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterBrowserEntriesByName,
  inferReferenceVirtualFolder,
  nestReferenceFolderItems,
  nestScreenRecordingsUnderVideoEditor,
  videoEditorHubItems,
  viewerAcceptsDroppedFile,
  entryOpensInVideoEditor,
  isVideoEditorBrowserFolder,
  videoEditorActionEntry,
} from "./reference-files.js";

const here = dirname(fileURLToPath(import.meta.url));

test("electronics markdown and loose images nest under virtual folders", () => {
  assert.equal(
    inferReferenceVirtualFolder({ name: "Electronics Build Sourcing.Md" }),
    "Electronics wiring",
  );
  assert.equal(
    inferReferenceVirtualFolder({ name: "electronics_build_sourcing_2.md" }),
    "Electronics wiring",
  );
  assert.equal(
    inferReferenceVirtualFolder({ name: "Autoprep X Showme.Gif" }),
    "Images",
  );
  const nested = nestReferenceFolderItems([
    { name: "Electronics Build Sourcing.Md" },
    { name: "Electronics Build Sourcing 2.Md" },
    { name: "Autoprep X Showme.Gif" },
    { name: "Viewport-recording.webm", folder: "Screen Recordings" },
  ]);
  const ids = nested.map((row) => row.id || row.name);
  assert.ok(ids.includes("folder:Electronics wiring"));
  assert.ok(ids.includes("folder:Images"));
  assert.ok(ids.includes("folder:Screen Recordings"));
  assert.equal(nested.some((row) => !row.virtual_folder && /electr|gif/i.test(row.name || "")), false);
});

test("Screen Recordings stay a visible Reference Files folder", () => {
  const nested = nestReferenceFolderItems([
    { name: "Fullscreen-recording.webm", folder: "Screen Recordings", mtime: 2 },
    { name: "Viewport-recording.webm", folder: "Screen Recordings", mtime: 1 },
  ]);
  const rec = nested.find((row) => row.id === "folder:Screen Recordings");
  assert.ok(rec);
  assert.equal(rec.virtual_folder, true);
  assert.deepEqual((rec.children || []).map((c) => c.name), [
    "Fullscreen-recording.webm",
    "Viewport-recording.webm",
  ]);
});

test("Video Editor virtual folder nests editor clips and skips empty dirs", () => {
  assert.equal(
    inferReferenceVirtualFolder({ name: "clip-edited.webm", folder: "Video Editor" }),
    "Video Editor",
  );
  const looseCopies = nestReferenceFolderItems([
    { name: "clip-edited.webm", folder: "Video Editor" },
  ]);
  assert.equal(looseCopies.some((row) => row.id === "folder:Video Editor"), false);
  const nestedChild = nestReferenceFolderItems([
    {
      name: "Fullscreen Recording.webm",
      folder: "Video Editor/Fullscreen Recording",
      path_ref: true,
      source_path: "Screen Recordings/Fullscreen Recording.webm",
    },
  ]);
  assert.ok(nestedChild.some((row) => row.id === "folder:Video Editor"));
  const project = nestedChild.find((row) => row.id === "folder:Video Editor")?.children?.[0];
  assert.equal(project?.name, "Fullscreen Recording");
  assert.equal(project?.default_collapsed, true);
  assert.equal(project?.children?.[0]?.name, "Fullscreen Recording.webm");
  assert.equal(nestReferenceFolderItems([]).some((row) => /Video Editor/i.test(row.id || row.name || "")), false);
  const withMeta = nestReferenceFolderItems([
    { name: "editor.json", folder: "Video Editor/Harbor Cut" },
  ]);
  const ve = withMeta.find((row) => row.id === "folder:Video Editor");
  assert.ok(ve);
  const store = (ve.children || []).find((c) => c.name === "Harbor Cut");
  assert.ok(store);
  assert.equal((store.children || []).some((c) => c.name === "editor.json"), false);
  const src = readFileSync(join(here, "reference-files.js"), "utf8");
  assert.match(src, /id: "Video Editor"/);
});

test("Video Editor folders and video files open in the video editor, not the code IDE", () => {
  const hub = { virtual_folder: true, id: "folder:Video Editor", folder: "Video Editor", name: "Video Editor" };
  const clipFolder = {
    virtual_folder: true,
    folder: "Video Editor/Viewport clip",
    name: "Viewport clip",
    children: [{ name: "clip.webm", kind: "video" }],
  };
  const rec = {
    virtual_folder: true,
    id: "folder:Screen Recordings",
    folder: "Screen Recordings",
    name: "Screen Recordings",
    children: [{ name: "Viewport-recording.webm" }],
  };
  const code = { virtual_folder: true, folder: "Project Code/Robot", name: "Robot", children: [{ name: "main.py" }] };
  assert.equal(isVideoEditorBrowserFolder(hub), true);
  assert.equal(isVideoEditorBrowserFolder(clipFolder), true);
  assert.equal(isVideoEditorBrowserFolder(rec), true);
  assert.equal(isVideoEditorBrowserFolder(code), false);
  assert.equal(entryOpensInVideoEditor(hub), true);
  assert.equal(entryOpensInVideoEditor({ name: "take.mp4" }), true);
  assert.equal(entryOpensInVideoEditor({ name: "take.webm", mime: "video/webm" }), true);
  assert.equal(entryOpensInVideoEditor({ name: "main.py" }), false);
  assert.equal(videoEditorActionEntry(clipFolder).name, "Viewport clip");
  assert.equal(videoEditorActionEntry(rec).name, "Viewport-recording.webm");
});

test("Screen Recordings nest under Video Editor when the editor folder exists", () => {
  const nested = nestReferenceFolderItems([
    { name: "Viewport-recording.webm", folder: "Screen Recordings", mtime: 2 },
    { name: "clip.webm", folder: "Video Editor/Viewport clip", mtime: 3, path_ref: true },
    { name: "cut.webm", folder: "Video Editor/Jump-cut the B-roll", mtime: 4, path_ref: true },
  ]);
  assert.equal(nested.some((row) => row.id === "folder:Screen Recordings"), false);
  const ve = nested.find((row) => row.id === "folder:Video Editor");
  assert.ok(ve);
  const rec = (ve.children || []).find((row) => row.id === "folder:Screen Recordings" || row.name === "Screen Recordings");
  assert.ok(rec);
  assert.equal(rec.parent_folder, "Video Editor");
  assert.ok((rec.children || []).some((c) => c.name === "Viewport-recording.webm"));
  const hub = videoEditorHubItems(ve);
  assert.ok(hub.some((row) => /Viewport clip/i.test(row.label)));
  assert.ok(hub.some((row) => /Jump-cut/i.test(row.label)));
  assert.ok(hub.some((row) => /Viewport-recording/i.test(row.label)));
  const projectRow = hub.find((row) => /Viewport clip/i.test(row.label));
  assert.equal(projectRow.entry.virtual_folder, true);
  assert.equal(projectRow.entry.folder, "Video Editor/Viewport clip");
  assert.equal(projectRow.mediaEntry.name, "clip.webm");
  const onlyRec = nestScreenRecordingsUnderVideoEditor([
    { id: "folder:Screen Recordings", name: "Screen Recordings", virtual_folder: true, children: [] },
  ]);
  assert.ok(onlyRec.some((row) => row.id === "folder:Screen Recordings"));
});

test("filterBrowserEntriesByName combines name and type tokens", () => {
  const nested = nestReferenceFolderItems([
    { name: "canvas-board.js" },
    { name: "canvas.png" },
    { name: "notes.py" },
  ]);
  const hit = filterBrowserEntriesByName(nested, "js canvas");
  const names = JSON.stringify(hit);
  assert.match(names, /canvas-board\.js/);
  assert.equal(names.includes("canvas.png"), false);
});

test("image viewer Esc-to-select, Send-to-AI stay, and drops stay in the overlay", () => {
  const src = readFileSync(join(here, "reference-files.js"), "utf8");
  assert.match(src, /toolBtn\("select"/);
  assert.match(src, /Select \/ move \(V\)/);
  assert.match(src, /function exitTextToSelect/);
  assert.match(src, /isCanvasEscapeToMove/);
  assert.match(src, /canvasToolFromShortcutEvent/);
  assert.match(src, /stopViewerFileDrag/);
  assert.match(src, /addEventListener\("drop"/);
  assert.match(src, /onDropFiles/);
  assert.match(src, /data-ref-action="hide-notes"/);
  assert.equal(/data-ref-action="close" title="Close tab"/.test(src), false);
  assert.equal(viewerAcceptsDroppedFile({ name: "pan.png", type: "image/png" }), true);
  assert.equal(viewerAcceptsDroppedFile({ name: "notes.md", type: "text/markdown" }), true);
  assert.equal(viewerAcceptsDroppedFile({ name: "clip.webm", type: "video/webm" }), true);
});
