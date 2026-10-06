import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "robotic-simulator.js"), "utf8");

test("Robotics catalog leads with live DIMOS Open Arm", () => {
  assert.match(src, /id: "openarm-dimos"/);
  assert.match(src, /action: "dimos"/);
  assert.match(src, /hardware_id openarm/);
  assert.match(src, /bindOpenArmMeshes/);
  assert.match(src, /getDimosRobot/);
  assert.match(src, /onSelectDimosRobot/);
  const openAt = src.indexOf('id: "openarm-dimos"');
  const demoAt = src.indexOf('id: "industrial-6axis"');
  assert.ok(openAt >= 0 && demoAt > openAt, "Open Arm must be first in the catalog");
});
