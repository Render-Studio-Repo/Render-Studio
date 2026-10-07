import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(new URL("./project-code-editor.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../studio/app.js", import.meta.url), "utf8");

test("project file explorer exposes Render Agent with bounded folder metadata", () => {
  assert.match(editor, /data-ask-agent>Render Agent/);
  assert.match(editor, /onAskAgent\?\.\(\{root,files,active\}\)/);
  assert.match(app, /Indexed files \(metadata only\)/);
  assert.match(app, /Do not download until I confirm source, license, file, size, and destination/);
});

test("robot IDE opens all browser Reference Files instead of only Training Data", () => {
  assert.match(app, /onOpenIde: \(\) => openRoboticsProjectExplorer\(\{ folder: "project" \}\)/);
  assert.match(app, /await fetchAllProjects\(\)/);
  assert.match(app, /onOpenFolder: \(folder\) => openProjectCodeEditor\(\{ folder/);
  assert.match(app, /Robot Data Import & Setup checklist/);
});

test("robotics file explorer owns project selection and new-folder controls", () => {
  assert.match(editor, /data-project-select/);
  assert.match(editor, /data-new-folder/);
  assert.match(editor, /getProjects/);
  assert.match(editor, /\/folders/);
  assert.match(app, /getProjects: \(\) => allProjects/);
});
