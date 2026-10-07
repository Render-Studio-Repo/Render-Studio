import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  FILEVIEW1_TOKEN,
  CODE_UPDATE_LINK,
  CODE_UPDATE_JSON,
  SANDBOX_TOGGLE_KEY,
  isSandboxProgrammingOn,
  setSandboxProgrammingOn,
  studioFileUrl,
} from "./project-file-viewer.js";

const here = dirname(fileURLToPath(import.meta.url));

test("file viewer exposes code-update link paths", () => {
  assert.equal(FILEVIEW1_TOKEN, "fileview1");
  assert.equal(CODE_UPDATE_LINK, "live/code-updates-link.md");
  assert.equal(CODE_UPDATE_JSON, "live/code-updates-link.json");
});

test("sandbox programming is off unless Sam toggles it", () => {
  const store = new Map([[SANDBOX_TOGGLE_KEY, "0"]]);
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  assert.equal(isSandboxProgrammingOn(storage), false);
  assert.equal(setSandboxProgrammingOn(true, storage), true);
  assert.equal(isSandboxProgrammingOn(storage), true);
  assert.equal(studioFileUrl("abc", "refs/part.stl"), "/api/projects/abc/files/refs/part.stl");
});

test("super IDE mounts one Projects viewer — File IDE is not a second tab", () => {
  const src = readFileSync(join(here, "super-ide.js"), "utf8");
  const viewer = readFileSync(join(here, "project-file-viewer.js"), "utf8");
  assert.match(src, /mountProjectFileViewer/);
  assert.match(src, /sb-pane-projects/);
  assert.match(src, /fileview1|FILEVIEW1/);
  assert.match(src, /Projects/);
  assert.doesNotMatch(src, /data-tab="code"|label: "File IDE"/);
  assert.match(viewer, /data-fv-sandbox/);
  assert.match(viewer, /90576A119\.glb|electronics_build_sourcing|parts_list\.md/);
  assert.match(viewer, /fetchStudioProjectFiles/);
  assert.match(viewer, /createShopCrew/);
  assert.match(viewer, /Real Studio project files/);
});
