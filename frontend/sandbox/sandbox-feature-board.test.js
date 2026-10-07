import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FEATURE_FLAGS,
  FEATBOARD1_TOKEN,
  FEATURE_BOARD_KEY,
  readFeatureBoard,
  setFeatureFlag,
  isFeatureLive,
  featureBoardMarkup,
} from "./sandbox-feature-board.js";

test("feature board defaults sandbox-writes off and persists flags", () => {
  assert.equal(FEATBOARD1_TOKEN, "featboard1");
  assert.ok(FEATURE_FLAGS.some((f) => f.id === "viewport"));
  assert.ok(FEATURE_FLAGS.some((f) => f.id === "sandbox-writes" && f.live === false));
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  assert.equal(isFeatureLive("mujoco", storage), true);
  setFeatureFlag("mujoco", false, storage);
  assert.equal(isFeatureLive("mujoco", storage), false);
  assert.ok(store.get(FEATURE_BOARD_KEY));
  const board = readFeatureBoard(storage);
  assert.equal(board.flags.mujoco, false);
  assert.match(featureBoardMarkup(board), /data-feat="mujoco"/);
});

test("workshop mounts feature board and tech wall", () => {
  const replica = readFileSync(new URL("./studio-viewport-replica.js", import.meta.url), "utf8");
  const promo = readFileSync(new URL("./PROMOTION.md", import.meta.url), "utf8");
  assert.match(replica, /data-sbvp-mode="board"/);
  assert.match(replica, /data-sbvp-mode="wall"/);
  assert.match(promo, /feature control board/i);
  assert.match(promo, /sandbox-live-instances\.js/);
  assert.match(promo, /Do not wholesale-copy|Never.*copy wholesale/i);
});
