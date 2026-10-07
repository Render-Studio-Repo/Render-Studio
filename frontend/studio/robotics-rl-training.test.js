import test from "node:test";
import assert from "node:assert/strict";
import { mountRoboticsRlTraining } from "./robotics-rl-training.js";

test("RL panel requires its explicit API and project boundary", () => {
  assert.equal(mountRoboticsRlTraining(null, {}), null);
  assert.equal(mountRoboticsRlTraining({}, { api() {} }), null);
});

test("RL source keeps physical hardware disabled", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./robotics-rl-training.js", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /guarded.home|hardware.run|robotics\/action/i);
  assert.match(source, /api\/robotics\/rl\/start/);
});
