import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_IDS,
  LAUNCH_POINTS,
  liveSrc,
  MUJOCO_EMBED_SRC,
  VIEWPORT_EMBED_SRC,
  SBLIVE1_TOKEN,
} from "./sandbox-live-instances.js";

test("one src each for viewport viser mujoco dimos", () => {
  assert.equal(SBLIVE1_TOKEN, "sblive1");
  assert.deepEqual([...LIVE_IDS], ["viewport", "viser", "mujoco", "dimos"]);
  assert.match(liveSrc("viewport"), /sandboxViewport=1/);
  assert.equal(liveSrc("mujoco"), MUJOCO_EMBED_SRC);
  assert.match(liveSrc("viser"), /\/api\/viser\/p\//);
  assert.equal(VIEWPORT_EMBED_SRC.includes("sandboxViewport=1"), true);
  assert.equal(LAUNCH_POINTS.control_schema, "sam-y-engage-v2");
  assert.equal(LAUNCH_POINTS.instances.dimos.port, 8443);
  assert.equal(LAUNCH_POINTS.logs.teaching, "sandbox-sessions/teaching/latest.json");
});
