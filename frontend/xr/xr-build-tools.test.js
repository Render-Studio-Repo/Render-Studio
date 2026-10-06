import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  nextLayerFocus,
  snapAxis,
  SNAP_PRESETS,
  wallSizeFromDrag,
} from "./xr-build-tools.js";
import { nametagAnchorFromHead } from "./xr-hot-path.js?v=roboticsworkspace3";

const here = dirname(fileURLToPath(import.meta.url));

test("XR snap grid is not built until setSnapGridVisible(true)", () => {
  const src = readFileSync(join(here, "xr-build-tools.js"), "utf8");
  assert.ok(src.includes("setSnapGridVisible"));
  assert.ok(src.includes("xr-snap-grid"));
  assert.ok(src.includes("if (!snapGridWanted) return"));
  assert.ok(src.includes("redoSolid"));
  assert.ok(src.includes("parkSolidMesh"));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("setSnapGridVisible?.(true)"));
  assert.ok(xr.includes("setSnapGridVisible?.(false)"));
});

test("grid snap lock always snaps; soft only when close", () => {
  assert.equal(SNAP_PRESETS[0].label, "Off");
  assert.equal(snapAxis(0.037, 0.01, 1), 0.04);
  assert.equal(snapAxis(0.035, 0.01, 0.4), 0.035);
  assert.equal(snapAxis(0.032, 0.01, 0.4), 0.03);
});

test("wall drag stays at default height until you pull up", () => {
  const footprint = wallSizeFromDrag(0.4, 0.02, 0.1);
  assert.equal(footprint.pulling, false);
  assert.equal(footprint.y, 0.25);
  assert.equal(footprint.x, 0.4);
  const pulled = wallSizeFromDrag(0.4, 0.8, 0.1);
  assert.equal(pulled.pulling, true);
  assert.equal(pulled.y, 0.8);
});

test("layer cycle adds a group then returns to all", () => {
  const a = nextLayerFocus([{ id: "default", name: "Layer 1", visible: true }], "all");
  assert.equal(a.focus, "default");
  assert.equal(a.label, "Layer 1");
  const b = nextLayerFocus(a.layers, a.focus);
  assert.equal(b.focus, "L2");
  assert.equal(b.layers.length, 2);
  const c = nextLayerFocus(b.layers, b.focus);
  assert.equal(c.focus, "L3");
  let cur = c;
  cur = nextLayerFocus(cur.layers, cur.focus);
  cur = nextLayerFocus(cur.layers, cur.focus);
  cur = nextLayerFocus(cur.layers, cur.focus);
  assert.equal(cur.focus, "all");
  assert.equal(cur.label, "All layers");
});

test("nametag sits above the head toward the viewer, not behind the skull", () => {
  const [x, y, z] = nametagAnchorFromHead([0, 1.6, 0], [0, 1.6, 2]);
  assert.ok(y > 1.75);
  assert.ok(z > 0);
  assert.ok(Math.abs(x) < 0.02);
});

test("Quest wheel and presence ship copy, layer, height, and world nametags", () => {
  const wheel = readFileSync(join(here, "xr-tool-wheel.js"), "utf8");
  assert.ok(wheel.includes('id: "duplicate"'));
  assert.ok(wheel.includes('id: "stamp"'));
  assert.ok(wheel.includes('id: "array"'));
  assert.ok(wheel.includes('id: "slice"'));
  assert.ok(wheel.includes('id: "mirror"'));
  assert.ok(wheel.includes('id: "layer"'));
  assert.ok(wheel.includes('id: "wall_height"'));
  const presence = readFileSync(join(here, "xr-presence.js"), "utf8");
  assert.equal(presence.includes("head.add(name)"), false);
  assert.ok(presence.includes("placeNametag"));
  assert.ok(presence.includes("TorusGeometry"));
  assert.ok(presence.includes("samplePoseTrack"));
  assert.ok(presence.includes("function tick("));
  assert.ok(presence.includes("BoxGeometry"));
  const view = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(view.includes("xrPresence.tick"));
  assert.ok(view.includes("nametagBeatsDock"));
  assert.ok(view.includes("pickWristUi"));
  assert.equal(view.includes("if (!obj?.visible) return null;"), false);
  assert.ok(view.includes("undoLastSolid"));
  assert.ok(view.includes("duplicateLastSolid"));
  assert.ok(view.includes("stampLastSolid"));
  assert.ok(view.includes("arrayLastSolid"));
  assert.ok(view.includes("sliceLastSolid"));
  assert.ok(view.includes("mirrorLastSolid"));
  assert.ok(view.includes("beginWallHeight"));
});
