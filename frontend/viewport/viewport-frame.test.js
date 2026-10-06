import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  boxSpan,
  dominantClusterBox,
  explodedOverviewBox,
  fitOrbitDistance,
  floorDeltaZ,
  isJakeStepPreviewName,
  jakeAssembledPreviewForStem,
  isUsableFrameBox,
  unionBoxes,
} from "./viewport-frame.js";

const here = dirname(fileURLToPath(import.meta.url));

test("isUsableFrameBox rejects empty, Inf, and collapsed boxes", () => {
  assert.equal(isUsableFrameBox(null), false);
  assert.equal(isUsableFrameBox({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }), false);
  assert.equal(isUsableFrameBox({
    min: { x: -Infinity, y: 0, z: 0 },
    max: { x: 10, y: 10, z: 10 },
  }), false);
  assert.equal(isUsableFrameBox({
    min: { x: -1, y: -1, z: 0 },
    max: { x: 1, y: 1, z: 2 },
  }), true);
});

test("dominantClusterBox ignores an origin orphan under a high exploded cluster", () => {
  const originBlob = { min: { x: -0.01, y: -0.01, z: -0.01 }, max: { x: 0.01, y: 0.01, z: 0.01 } };
  const cluster = { min: { x: -0.12, y: -0.08, z: 1.85 }, max: { x: 0.12, y: 0.22, z: 2.25 } };
  const box = dominantClusterBox([originBlob, cluster]);
  assert.ok(box);
  assert.ok(box.min.z > 1.5, `min.z=${box.min.z} should stay on the exploded cluster`);
  assert.ok(box.max.z < 2.4);
  assert.equal(floorDeltaZ(box) < -1.8, true);
});

test("dominantClusterBox keeps an assembled model that already spans the origin", () => {
  const rail = { min: { x: -115, y: -40, z: -40 }, max: { x: 115, y: 40, z: 0 } };
  const bracket = { min: { x: -75, y: -40, z: 0 }, max: { x: 75, y: 116, z: 155 } };
  const motor = { min: { x: -43, y: 116, z: 57 }, max: { x: 43, y: 210, z: 143 } };
  const box = dominantClusterBox([rail, bracket, motor]);
  assert.ok(box);
  assert.equal(box.min.x, -115);
  assert.equal(box.max.z, 155);
  const union = unionBoxes([rail, bracket, motor]);
  assert.equal(box.min.y, union.min.y);
  assert.equal(box.max.y, union.max.y);
});

test("isJakeStepPreviewName matches CADJS hidden assembled viewers", () => {
  assert.equal(isJakeStepPreviewName(".NEMA_34_Offset_Bracket.step.glb"), true);
  assert.equal(isJakeStepPreviewName("NEMA_34_Offset_Bracket.glb"), false);
  assert.equal(isJakeStepPreviewName(".generation.lock"), false);
});

test("jakeAssembledPreviewForStem finds hidden .{stem}.step.glb", () => {
  const files = ["Bracket.step", ".Bracket.step.glb", "exploded.glb"];
  assert.equal(jakeAssembledPreviewForStem("Bracket", files), ".Bracket.step.glb");
  assert.equal(jakeAssembledPreviewForStem("Missing", files), null);
});

test("explodedOverviewBox unions spread CAD parts instead of punching into the largest body", () => {
  const chassis = { min: { x: -80, y: -60, z: 0 }, max: { x: 80, y: 60, z: 20 } };
  const wheelL = { min: { x: -400, y: -40, z: 0 }, max: { x: -340, y: 20, z: 50 } };
  const wheelR = { min: { x: 340, y: -40, z: 0 }, max: { x: 400, y: 20, z: 50 } };
  const bar = { min: { x: -20, y: 360, z: 10 }, max: { x: 20, y: 440, z: 18 } };
  const parts = [chassis, wheelL, wheelR, bar];
  const clustered = dominantClusterBox(parts);
  const overview = explodedOverviewBox(parts);
  assert.ok(overview);
  assert.equal(overview.min.x, -400);
  assert.equal(overview.max.x, 400);
  assert.equal(overview.max.y, 440);
  assert.ok(
    boxSpan(overview) > boxSpan(clustered) * 1.2,
    "cluster fit punches in on the chassis; overview must keep exploded wheels/bars",
  );
});

test("explodedOverviewBox still drops a tiny origin orphan", () => {
  const originBlob = { min: { x: -0.01, y: -0.01, z: -0.01 }, max: { x: 0.01, y: 0.01, z: 0.01 } };
  const cluster = { min: { x: -0.12, y: -0.08, z: 1.85 }, max: { x: 0.12, y: 0.22, z: 2.25 } };
  const box = explodedOverviewBox([originBlob, cluster]);
  assert.ok(box);
  assert.ok(box.min.z > 1.5, `min.z=${box.min.z} should stay on the CAD cluster`);
});

test("versioned framing helpers are wired on app and assembly", () => {
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const assembly = readFileSync(join(here, "../components/project-assembly.js"), "utf8");
  assert.match(app, /viewport-frame\.js\?v=20260908-cadframe2-projvp1&explfit1/);
  assert.match(assembly, /viewport-frame\.js\?v=20260908-cadframe2-projvp1&explfit1/);
  assert.match(app, /function fitExplodedOverview\(/);
  assert.match(app, /boundingBox\(\{ force: true, union: true \}\)/);
  assert.match(html, /app\.js\?v=[^"\n]*projvp1/);
  assert.match(html, /app\.js\?v=[^"\n]*explfit1/);
});

test("fitOrbitDistance does not treat a 50mm part as 50 metres or 0.05mm", () => {
  const part50mm = { min: { x: -25, y: -20, z: 0 }, max: { x: 25, y: 20, z: 12 } };
  const span = boxSpan(part50mm);
  assert.ok(span > 40 && span < 80, `span=${span}`);
  const radius = span * 0.5;
  const dist = fitOrbitDistance(radius);
  assert.ok(dist > 20 && dist < 400, `orbit=${dist} should frame a 50 mm part`);
  const asMetres = fitOrbitDistance(radius * 1000);
  assert.ok(asMetres > 5000, "50 m mis-scale would pull the camera kilometres back");
  const asMicrons = fitOrbitDistance(radius / 1000);
  assert.ok(asMicrons < 2, "0.05 mm mis-scale would sit on the near clip");
});
