import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "fusion-panel.js"), "utf8");

test("Fusion library refresh aborts the previous status GET", () => {
  assert.match(src, /let fusionLibraryAbort = null; \/\/ leakfix61/);
  assert.match(src, /async function loadAllMirrors\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(src, /async function loadHubs\(\{ skipPush = false \} = \{\}\)[\s\S]{0,1200}signal: ctl\.signal/);
});

test("Fusion file thumbs track and revoke blob URLs on repaint and close", () => {
  assert.match(src, /trackObjectUrl\(blob, created\)/);
  assert.match(src, /revokeTrackedObjectUrls\(thumbs\)/);
  assert.match(src, /revokeTrackedObjectUrls\(fusionFilePickerModal\._fusionThumbCreated\)/);
  assert.match(src, /leakfix23/);
});

test("Fusion library import lands in the open Render project", () => {
  assert.match(src, /if \(currentId\) body\.target_project_id = currentId/);
  assert.match(src, /importInFlight/);
  assert.doesNotMatch(
    src,
    /onImported\?\.\(result\.project_id, result\.filename, result\.name\);\s*onView\?\.\(result\.project_id/,
  );
});

test("Fusion library waits for studio-ready before leftover hub walks", () => {
  assert.match(src, /function afterStudioBoot/);
  assert.match(src, /render3d:studio-ready/);
  const boot = src.slice(src.indexOf("function afterStudioBoot"), src.indexOf('window.addEventListener("render3d:open-fusion-library"'));
  assert.match(boot, /window\.__studioReady/);
  const open = src.slice(
    src.indexOf('window.addEventListener("render3d:open-fusion-library"'),
    src.indexOf('window.addEventListener("render3d:autodesk-linked"'),
  );
  assert.match(open, /afterStudioBoot/);
  assert.doesNotMatch(src, /new IntersectionObserver/);
});

test("Fusion panel does not rebuild chrome on project swap", () => {
  const fn = src.slice(
    src.indexOf('window.addEventListener("render3d:project-changed"'),
    src.indexOf('window.addEventListener("render3d:fusion-mirror-changed"'),
  );
  assert.doesNotMatch(fn, /renderControls\(\)/);
  assert.doesNotMatch(fn, /loadHubs/);
});
