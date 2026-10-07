import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canOpenRemoteSlicerUrl,
  getSlicerById,
  slicerOpenUrls,
} from "./slicer-prefs.js";

test("macOS Bambu handoff uses its registered remote import protocol", () => {
  const slicer = getSlicerById("bambu");
  const urls = slicerOpenUrls(slicer, "https://render3d.app/api/share/token/files/model.3mf");
  assert.equal(urls.macos, "bambustudioopen://https%3A%2F%2Frender3d.app%2Fapi%2Fshare%2Ftoken%2Ffiles%2Fmodel.3mf");
  assert.equal(canOpenRemoteSlicerUrl(slicer, "macos", urls), true);
});

test("Bambu remote protocol remains available on supported desktop platforms", () => {
  const slicer = getSlicerById("bambu");
  const urls = slicerOpenUrls(slicer, "https://render3d.app/api/share/token/files/model.3mf");
  assert.equal(canOpenRemoteSlicerUrl(slicer, "windows", urls), true);
  assert.equal(canOpenRemoteSlicerUrl(slicer, "linux", urls), true);
});

test("slicers without protocol support always use the downloaded file", () => {
  const slicer = getSlicerById("generic");
  const urls = slicerOpenUrls(slicer, "https://render3d.app/model.3mf");
  assert.equal(canOpenRemoteSlicerUrl(slicer, "macos", urls), false);
  assert.equal(canOpenRemoteSlicerUrl(slicer, "windows", urls), false);
});

test("native slicer receives a fresh share that permits downloading the generated 3MF", () => {
  const source = readFileSync(new URL("./file-actions.js", import.meta.url), "utf8");
  assert.match(source, /body:\s*JSON\.stringify\(\{ force_new: true, allow_download: true \}\)/);
  assert.match(source, /data-slicer-open/);
  assert.match(source, /data-slicer-open href="\$\{escAttr\(openHref\)\}"/);
  assert.match(source, /const slicerRow = btn\.closest\("\.file-export-slicer-row"\)/);
  assert.match(source, /\(slicerRow \|\| btn\)\.insertAdjacentElement\("afterend", panel\)/);
});
