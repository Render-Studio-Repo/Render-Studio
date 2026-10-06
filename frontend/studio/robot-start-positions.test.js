import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStartPositions,
  readStartPosition,
  runGuardedStartSequence,
  saveStartPosition,
} from "./robot-start-positions.js";

test("starting-position folders normalize Viser presets and VR recordings", () => {
  const positions = buildStartPositions(
    { presets: [{ id: "vise-1", name: "Above tray", role: "init" }] },
    { recordings: [{ id: "take-1", name: "Pick cube" }], loops: [{ id: "loop-1", label: "Wave" }] },
  );
  assert.deepEqual(positions, [
    { type: "home", id: "home", name: "Home · arms down", runnable: true },
    { type: "viser", id: "vise-1", name: "Above tray", role: "init", runnable: false, reason: "Viser presets are visual planning targets, not validated robot trajectories." },
    { type: "emote", id: "take-1", name: "Pick cube", runnable: true },
    { type: "emote", id: "loop-1", name: "Wave", runnable: true },
  ]);
});

test("saving an Emote shares the selection with VR while a Viser target stays local to Robotics Home", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  saveStartPosition({ type: "emote", id: "take-7", name: "Reach" }, storage);
  assert.equal(readStartPosition(storage).id, "take-7");
  saveStartPosition({ type: "viser", id: "pose-2", name: "Tray", role: "init" }, storage);
  assert.deepEqual(readStartPosition(storage), { type: "viser", id: "pose-2", name: "Tray", role: "init" });
  assert.deepEqual(JSON.parse(values.get("render3d:robot-start-position:v1")), { type: "emote", id: "take-7", name: "Reach" });
});

test("a real Emote run always stops, homes, verifies Home, then plays", async () => {
  const events = [];
  const result = await runGuardedStartSequence({
    position: { type: "emote", id: "take-1", name: "Pick", runnable: true },
    stopAll: async () => events.push("stop"),
    home: async () => events.push("home"),
    waitForHome: async () => events.push("home verified"),
    playEmote: async (id) => { events.push(`play ${id}`); return { playing: true }; },
    waitForEmote: async () => events.push("motion complete"),
  });
  assert.deepEqual(events, ["stop", "home", "home verified", "play take-1", "motion complete"]);
  assert.deepEqual(result, { position: { type: "emote", id: "take-1", name: "Pick", runnable: true }, ranMotion: true });
});

test("a visual-only Viser target is rejected before any hardware operation", async () => {
  const events = [];
  await assert.rejects(() => runGuardedStartSequence({
    position: { type: "viser", id: "pose-1", runnable: false, reason: "planning only" },
    stopAll: async () => events.push("stop"),
    home: async () => events.push("home"),
  }), /planning only/);
  assert.deepEqual(events, []);
});
