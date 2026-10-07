import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReferenceFilesTree,
  flattenReferenceEntries,
  formatReferenceTimestamp,
  normalizeUserUpdateRows,
  REF_FILES_PANE_CACHE,
  sortReferenceEntriesNewestFirst,
} from "./reference-files-pane.js";

const here = dirname(fileURLToPath(import.meta.url));
const pane = readFileSync(join(here, "reference-files-pane.js"), "utf8");
const refs = readFileSync(join(here, "reference-files.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
const resize = readFileSync(join(here, "../studio/panel-resize.js"), "utf8");

test("default sort is newest → oldest", () => {
  const rows = sortReferenceEntriesNewestFirst([
    { name: "old.png", mtime: 100 },
    { name: "new.png", mtime: 300 },
    { name: "mid.png", mtime: 200 },
  ]);
  assert.deepEqual(rows.map((r) => r.name), ["new.png", "mid.png", "old.png"]);
  const tree = buildReferenceFilesTree([
    { name: "old.png", folder: "Screenshots", mtime: 10 },
    { name: "new.png", folder: "Screenshots", mtime: 90 },
  ]);
  const shots = tree.find((row) => row.id === "folder:Screenshots");
  assert.ok(shots);
  assert.deepEqual((shots.children || []).map((c) => c.name), ["new.png", "old.png"]);
});

test("Recent tab is a flat newest-first list", () => {
  const tree = buildReferenceFilesTree([
    { name: "a.png", folder: "Screenshots", mtime: 1 },
    { name: "b.webm", folder: "Screen Recordings", mtime: 5 },
    { name: "c.md", folder: "Documents", mtime: 3 },
  ]);
  const recent = flattenReferenceEntries(tree);
  assert.deepEqual(sortReferenceEntriesNewestFirst(recent).map((r) => r.name), [
    "b.webm",
    "c.md",
    "a.png",
  ]);
  assert.match(pane, /data-ref-pane-tab="recent"/);
  assert.match(pane, /ref-files-recent-list/);
  assert.match(html, /id="reference-files-pane"/);
  assert.match(html, /workspace-browser-section/);
  assert.match(html, /cad-connections/);
});

test("nested folders collapse with a chevron", () => {
  const tree = buildReferenceFilesTree([
    { name: "clip.webm", folder: "Video Editor/Harbor Cut", mtime: 8 },
    { name: "note.txt", folder: "My Docs/Inbox", mtime: 4 },
  ]);
  const video = tree.find((row) => row.id === "folder:Video Editor");
  assert.ok(video?.virtual_folder);
  assert.ok((video.children || []).some((child) => child.virtual_folder && child.name === "Harbor Cut"));
  const custom = tree.find((row) => /My Docs/i.test(row.id || row.name || ""));
  assert.ok(custom?.virtual_folder);
  assert.match(pane, /ref-file-folder-toggle/);
  assert.match(pane, /aria-expanded/);
  assert.match(pane, /ref-file-chevron/);
  assert.match(pane, /toggleFolder/);
});

test("timestamps, search, and grid toggle ship on the pane", () => {
  const when = formatReferenceTimestamp({ mtime: 1_800_000_000 });
  assert.match(when, /2026|Sep|AM|PM|\d/);
  assert.match(pane, /id="ref-files-search"/);
  assert.match(pane, /data-ref-view="grid"/);
  assert.match(pane, /data-ref-view="list"/);
  assert.match(pane, /ref-file-time/);
  assert.match(css, /\.ref-files-pane/);
  assert.match(css, /\.ref-files-grid/);
});

test("resize handle persists left pane width", () => {
  assert.match(resize, /left-split/);
  assert.match(resize, /render3d:leftPanelWidth/);
  assert.match(resize, /Resize left panel/);
  assert.match(pane, /LEFT_PANEL_WIDTH_KEY = "render3d:leftPanelWidth"/);
  assert.match(css, /panel-gutter-v\[data-gutter="left-split"\]/);
});

test("notes close with X and toolbar Close is gone", () => {
  assert.match(refs, /data-ref-action="hide-notes"/);
  assert.match(refs, /ref-notes-close/);
  assert.match(refs, /aria-label="Close notes"/);
  assert.equal(/data-ref-action="close" title="Close tab"/.test(refs), false);
  assert.match(refs, /data-ref-action="save"/);
  assert.match(refs, /save-edited-video/);
  assert.match(refs, /showNotesPanel/);
});

test("sidebar dropdown reopens notes, hides files, and pops updates", () => {
  assert.match(pane, /data-sidebar-chrome="notes"/);
  assert.match(pane, /Reopen notes/);
  assert.match(pane, /data-sidebar-chrome="files"/);
  assert.match(pane, /Hide files pane/);
  assert.match(pane, /data-sidebar-chrome="updates"/);
  assert.match(pane, /Show updates/);
  assert.match(html, /id="updates-activity-dock"/);
  const rows = normalizeUserUpdateRows([
    { who: "Ada", what: "edited CAD", created_at: "2026-09-15T12:00:00Z" },
    { who: "Sam", what: "added notes", created_at: "2026-09-14T12:00:00Z" },
  ]);
  assert.equal(rows[0].who, "Ada");
  assert.equal(rows[1].who, "Sam");
});

test("reference files pane remains wired into the Studio app", () => {
  assert.equal(typeof REF_FILES_PANE_CACHE, "string");
  assert.match(app, /createReferenceFilesPane/);
});
