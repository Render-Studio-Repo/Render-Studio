import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHarnessJoints } from "../viewport/joint-data.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("parseHarnessJoints accepts VibeCAD types and axis aliases", () => {
  const rows = parseHarnessJoints({
    joints: [
      { id: "lid_hinge", type: "revolute", parent: "Base", child: "Lid", anchor: [0, 0, 20], axis: [1, 0, 0], limits: [0, 110] },
      { type: "slider", parent: "Rail", child: "Carriage", origin: { x: 10, y: 0, z: 0 } },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, "revolute");
  assert.deepEqual(rows[0].axis, [1, 0, 0]);
  assert.equal(rows[1].type, "slider");
  assert.deepEqual(rows[1].anchor, [10, 0, 0]);
});

test("ribbon keeps rig playback and Joints while omitting retired top controls", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const ribbon = readFileSync(join(here, "ribbon.js"), "utf8");
  const play = ribbon.indexOf('id: "btn-rig-play"');
  const menu = ribbon.indexOf('id: "btn-rig-play-menu"');
  const urdfBtn = ribbon.indexOf('id: "btn-urdf-visuals"');
  const joints = ribbon.indexOf('id: "btn-joints"');
  assert.ok(play >= 0 && menu > play && urdfBtn > menu && joints > urdfBtn);
  assert.equal(ribbon.includes('{ id: "btn-gizmo"'), false);
  assert.equal(ribbon.includes('{ id: "btn-articulation-drag"'), false);
  assert.equal(ribbon.includes('{ id: "btn-xr-vr-ribbon"'), false);
  assert.equal(ribbon.includes("createUnitsControl()"), false);
});

test("joint overlay does not draw a viewport name billboard", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "../viewport/joint-overlay.js"), "utf8");
  assert.equal(src.includes("makeLabelSprite"), false);
  assert.equal(src.includes("SpriteMaterial"), false);
  assert.match(src, /never a viewport billboard/i);
  assert.match(src, /jointsOverlay:v2/);
});
