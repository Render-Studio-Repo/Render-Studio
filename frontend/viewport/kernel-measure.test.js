import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatKernelSummary,
  kernelPicksFromRefs,
  measureFromKernelTopo,
  measureFromOccResult,
  refToKernelPick,
  isCompleteMeasureRefs,
  isInProgressMeasureRefs,
  measurementAuthorFromUser,
  createSavedMeasurement,
} from "./kernel-measure.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const shareHtml = readFileSync(join(here, "../pages/share.html"), "utf8");
const shareViewer = readFileSync(join(here, "share-viewer.js"), "utf8");

const boxTopo = {
  kernel: "freecad",
  faces: [
    { index: 0, center: [20, 10, 0], normal: [0, 0, -1], area: 800, planar: true, bbox: [0, 0, -0.1, 40, 20, 0.1] },
    { index: 1, center: [20, 10, 10], normal: [0, 0, 1], area: 800, planar: true, bbox: [0, 0, 9.9, 40, 20, 10.1] },
  ],
  edges: [
    { index: 0, start: [0, 0, 0], end: [40, 0, 0], mid: [20, 0, 0], length: 40 },
    { index: 1, start: [0, 0, 10], end: [40, 0, 10], mid: [20, 0, 10], length: 40 },
  ],
  vertices: [{ index: 0, position: [0, 0, 0] }, { index: 1, position: [40, 20, 10] }],
};

test("kernel picks come from FreeCAD entity indices", () => {
  const face = refToKernelPick({ type: "face", kernel_face_index: 3 });
  assert.deepEqual(face, { kind: "face", index: 3 });
  const edge = refToKernelPick({ type: "edge", kernel_edge_index: 2 });
  assert.deepEqual(edge, { kind: "edge", index: 2 });
  const corner = refToKernelPick({ type: "corner", kernel_vertex_index: 1 });
  assert.deepEqual(corner, { kind: "vertex", index: 1 });
  assert.equal(refToKernelPick({ type: "face", face_index: 9 }), null);
});

test("topo measure uses OCC edge length and parallel-face gap", () => {
  const edge = measureFromKernelTopo(
    [{ type: "edge", kernel_edge_index: 0, position: [20, 0, 0] }],
    boxTopo,
  );
  assert.equal(edge.source, "freecad-topo");
  assert.equal(edge.valueMm, 40);
  const faces = measureFromKernelTopo(
    [
      { type: "face", kernel_face_index: 0, position: [20, 10, 0] },
      { type: "face", kernel_face_index: 1, position: [20, 10, 10] },
    ],
    boxTopo,
  );
  assert.equal(faces.label, "Face distance");
  assert.ok(Math.abs(faces.valueMm - 10) < 1e-6);
});

test("OCC result formatter prefers distance_mm", () => {
  const measured = measureFromOccResult({
    kernel: "freecad",
    kind: "length",
    label: "Face distance",
    distance_mm: 10,
    point1: [0, 0, 0],
    point2: [0, 0, 10],
  });
  const summary = formatKernelSummary(measured, {
    formatLength: (mm) => `${mm} mm`,
  });
  assert.equal(summary.value, "10 mm");
  assert.equal(summary.meta, "Face distance");
  assert.deepEqual(kernelPicksFromRefs([
    { type: "edge", kernel_edge_index: 0 },
    { type: "edge", kernel_edge_index: 1 },
  ]), [{ kind: "edge", index: 0 }, { kind: "edge", index: 1 }]);
});

test("cache-bust measkeep1 is on studio app, share viewer, and share html", () => {
  assert.match(html, /app\.js\?v=20260908-.*measkeep1/);
  assert.match(html, /styles\.css\?v=.*measkeep1/);
  assert.match(app, /kernel-measure\.js\?v=20260909-measkeep1/);
  assert.match(app, /createMeasureLabelOverlay/);
  assert.match(app, /cancelInProgressMeasure/);
  assert.match(shareHtml, /share-viewer\.js\?v=20260908-.*measkeep1/);
  assert.match(shareHtml, /id="btn-share-measure"/);
  assert.match(shareViewer, /share-measure\.js\?v=20260909-measkeep1/);
  assert.match(shareViewer, /createShareMeasure/);
  assert.match(shareViewer, /getAuthor/);
});

test("one pair is complete; a single pick stays live", () => {
  assert.equal(isCompleteMeasureRefs([{ type: "edge" }, { type: "face" }]), true);
  assert.equal(isCompleteMeasureRefs([{ type: "edge" }]), false);
  assert.equal(isCompleteMeasureRefs([{ type: "edge" }], "edge"), false);
  assert.equal(isCompleteMeasureRefs([{ type: "face" }], "face"), false);
  assert.equal(isCompleteMeasureRefs([{ type: "face" }, { type: "face" }], "face"), true);
  assert.equal(isCompleteMeasureRefs([{ type: "corner" }], "corner"), false);
  assert.equal(isInProgressMeasureRefs([{ type: "corner" }], "corner"), true);
  assert.equal(isInProgressMeasureRefs([{ type: "face" }], "face"), true);
  assert.equal(isInProgressMeasureRefs([{ type: "edge" }]), true);
  const guest = measurementAuthorFromUser(null);
  assert.equal(guest.guest, true);
  assert.equal(guest.display_name, "Guest");
  const me = measurementAuthorFromUser({ id: "u1", display_name: "Sam", handle: "sam" });
  assert.equal(me.id, "u1");
  const saved = createSavedMeasurement({
    refs: [{ type: "edge", position: [0, 0, 0] }, { type: "face", position: [0, 0, 10] }],
    value: "10 mm",
    author: { id: "u1", display_name: "Sam" },
    measured: { point1: [0, 0, 0], point2: [0, 0, 10] },
  });
  assert.ok(saved.id);
  assert.deepEqual(saved.anchor, [0, 0, 5]);
});

test("Esc keeps saved measurements and does not end measure mode", () => {
  assert.match(app, /cancelInProgressMeasure\(\{ keepMode: true \}\)/);
  assert.match(app, /Canceled current pick\. Existing dimensions kept/);
  assert.match(app, /showSavedMeasureToast|showMeasureHudToast/);
  assert.match(app, /isCompleteMeasureRefs\(measureReferences/);
  assert.doesNotMatch(app, /setEditStatus\("ok", "Saved measurement\. Click to add another\."\)/);
  const overlaySrc = readFileSync(join(here, "measure-label-overlay.js"), "utf8");
  assert.match(overlaySrc, /showMeasureHudToast|showMeasurePanelToast/);
  assert.match(overlaySrc, /hoveredId === item\.id/);
  assert.match(overlaySrc, /data-measure-pin/);
  assert.match(overlaySrc, /data-measure-move/);
  assert.match(overlaySrc, /measure-label-leaders/);
  assert.match(overlaySrc, /measure-label-x/);
  assert.match(overlaySrc, /data-measure-kebab/);
  assert.match(overlaySrc, /data-measure-rename/);
  assert.match(overlaySrc, /data-measure-author/);
  const shareMeasure = readFileSync(join(here, "share-measure.js"), "utf8");
  assert.match(shareMeasure, /cancelInProgress/);
  assert.match(shareMeasure, /Existing dimensions kept/);
  assert.match(shareMeasure, /prefer: pickMode/);
  const profile = readFileSync(join(here, "../components/user-profile.js"), "utf8");
  assert.match(profile, /user-profile-overlay--compact/);
  assert.match(profile, /Public profile/);
  assert.match(profile, /Friend request/);
  assert.match(profile, /Send message/);
});
