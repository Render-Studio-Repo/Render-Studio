import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  applyNotesFilter,
  filterNoteText,
  filterNotesList,
  looksLikeSecret,
  notesFabHtml,
  notesIconSvg,
  notesPanelHtml,
  notesToolbarHtml,
  serializeNoteHtml,
} from "./studio-notes.js";

const here = dirname(fileURLToPath(import.meta.url));
const sample = `# Sam's Notes\n\nRun DimOS\ndimos --viewer none run teleop-quest-openarm\nsetup can0\n`;

test("search filters note lines as you type", () => {
  const all = filterNoteText(sample, "");
  assert.equal(all.filtered, false);
  assert.match(all.text, /can0/);
  const hits = filterNoteText(sample, "openarm");
  assert.equal(hits.filtered, true);
  assert.equal(hits.matchCount, 1);
  assert.match(hits.text, /openarm/);
  assert.equal(hits.text.includes("can0"), false);
  assert.equal(filterNoteText(sample, "nope").matchCount, 0);
});

test("panel search toggles filtered view", () => {
  assert.match(notesPanelHtml({ kind: "personal", title: "Your notes", embedded: true }), /Search notes/);
  assert.match(notesIconSvg(), /viewBox="0 0 16 16"/);
  const filtered = { textContent: "", hidden: true, classList: { toggle() {} } };
  const editor = { value: sample, hidden: false, classList: { toggle() {} } };
  const meta = { textContent: "" };
  const root = {
    querySelector(sel) {
      if (sel === ".studio-notes-editor") return editor;
      if (sel === ".studio-notes-filtered") return filtered;
      if (sel === "[data-notes-meta]") return meta;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const result = applyNotesFilter(root, "dimos");
  assert.equal(result.filtered, true);
  assert.ok(result.matchCount >= 1);
  assert.equal(editor.hidden, true);
  assert.equal(filtered.hidden, false);
});

test("notes FAB is a slim floating button", () => {
  const html = notesFabHtml({ kind: "workstation" });
  assert.match(html, /id="studio-notes-fab"/);
  assert.match(html, /class="studio-notes-fab"/);
  assert.match(html, /data-studio-notes="workstation"/);
  assert.match(html, /viewBox="0 0 16 16"/);
});

test("picker and formatting toolbar ship in the notes panel", () => {
  const html = notesPanelHtml({ kind: "workstation" });
  assert.match(html, /New note/);
  assert.match(html, /Select an existing note or create a new one/);
  assert.match(html, /data-notes-cmd="bold"/);
  assert.match(html, /data-notes-cmd="photo"/);
  assert.match(html, /contenteditable="true"/);
  assert.match(notesToolbarHtml(), /Insert photo/);
  const notes = [
    { id: "n1", title: "Hardware", preview: "can0" },
    { id: "n2", title: "Commands", preview: "teleop" },
  ];
  assert.equal(filterNotesList(notes, "can0").length, 1);
  assert.equal(filterNotesList(notes, "").length, 2);
  assert.equal(looksLikeSecret("run the bench on can0"), false);
  assert.equal(looksLikeSecret("App Secret\nplaceholder"), true);
  assert.match(serializeNoteHtml('<p>ok</p><script>alert(1)</script>'), /ok/);
  assert.equal(serializeNoteHtml('<p>ok</p><script>alert(1)</script>').includes("script"), false);
});

test("notes remount and modal close revoke image blob URLs", () => {
  const src = readFileSync(join(here, "studio-notes.js"), "utf8");
  assert.match(src, /function revokeMountedNotesUrls\(\) \{ \/\/ leakfix29/);
  assert.match(src, /revokeMountedNotesUrls\(\); \/\/ leakfix29 remount/);
  assert.match(src, /revokeMountedNotesUrls\(\); \/\/ leakfix29/);
  assert.match(src, /mountedNotesRevoke = revokeUrls;/);
  assert.match(src, /leakfix29/);
});

test("notes live on management dashboard FAB, not viewport chrome", () => {
  const admin = readFileSync(join(here, "../admin/admin-dashboard.js"), "utf8");
  const prefs = readFileSync(join(here, "../studio/app.js"), "utf8");
  const foundry = readFileSync(join(here, "../admin/foundry.js"), "utf8");
  const dashHtml = readFileSync(join(here, "../pages/admin-dashboard.html"), "utf8");
  const index = readFileSync(join(here, "../index.html"), "utf8");
  const css = readFileSync(join(here, "studio-notes.css"), "utf8");
  const ui = readFileSync(join(here, "../admin/admin-dashboard-ui.css"), "utf8");
  assert.ok(admin.includes("mountNotesFab"));
  assert.ok(!admin.includes("admin-topbar-notes"));
  assert.ok(!index.includes("btn-studio-notes-toolbar"));
  assert.ok(!index.includes('data-studio-notes="auto"'));
  assert.ok(prefs.includes("pref-developer-notes"));
  assert.ok(foundry.includes("data-studio-notes"));
  assert.ok(css.includes(".studio-notes-fab"));
  assert.ok(css.includes("position: fixed"));
  assert.ok(css.includes(".studio-notes-toolbar"));
  assert.ok(ui.includes(".studio-notes-fab"));
  assert.ok(dashHtml.includes("studio-notes.css?v=20260909-notesapp1"));
  assert.match(dashHtml, /admin-dashboard\.js\?v=[^"']*leakfix29/);
  assert.match(dashHtml, /admin-dashboard-ui\.css\?v=/);
  assert.match(admin, /studio-notes\.js\?v=[^"']*leakfix29/);
});
