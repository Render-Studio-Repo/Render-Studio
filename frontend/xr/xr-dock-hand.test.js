import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LS_DOCK_HAND,
  LS_UI_HAND,
  LS_UI_HAND_V2,
  normalizeDockHand,
  otherDockHand,
  dockHandLabel,
  readPreferredDockHand,
  restorePreferredDockHand,
  seedDefaultDockHand,
  writePreferredDockHand,
  togglePreferredDockHand,
  xrMenuHand,
  xrDrawHand,
  migrateMenuHandToLeft,
} from "./xr-dock-hand.js";

function memStore(init = {}) {
  const data = { ...init };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

test("defaults to left and ignores junk", () => {
  assert.equal(normalizeDockHand(""), "left");
  assert.equal(normalizeDockHand(null), "left");
  assert.equal(normalizeDockHand("none"), "left");
  assert.equal(normalizeDockHand("RIGHT"), "right");
  assert.equal(readPreferredDockHand(memStore()), "left");
  assert.equal(readPreferredDockHand(null), "left");
});

test("labels and opposite hand", () => {
  assert.equal(dockHandLabel("left"), "Left hand");
  assert.equal(dockHandLabel("right"), "Right hand");
  assert.equal(otherDockHand("left"), "right");
  assert.equal(otherDockHand("right"), "left");
  assert.equal(xrMenuHand("left"), "left");
  assert.equal(xrDrawHand("left"), "right");
  assert.equal(xrDrawHand("right"), "left");
});

test("migrateMenuHandToLeft resets leftover right once", () => {
  const store = memStore({ [LS_UI_HAND]: "right" });
  assert.equal(migrateMenuHandToLeft(store), "left");
  assert.equal(store.getItem(LS_UI_HAND_V2), "1");
  assert.equal(readPreferredDockHand(store), "left");
  writePreferredDockHand(store, "right");
  assert.equal(migrateMenuHandToLeft(store), "right");
});

test("Settings key xr-ui-hand wins over legacy dock-hand", () => {
  const store = memStore({ "render3d:xr-dock-hand": "left", "render3d:xr-ui-hand": "right" });
  assert.equal(readPreferredDockHand(store), "right");
});

test("manual toggle persists; simulated headset reorder does not overwrite", () => {
  const store = memStore();
  assert.equal(writePreferredDockHand(store, "left"), "left");
  assert.equal(store.getItem(LS_UI_HAND), "left");
  assert.equal(store.getItem(LS_DOCK_HAND), "left");

  // Headset off/on / inputSources reorder must not write a new preference.
  assert.equal(restorePreferredDockHand(store), "left");
  assert.equal(readPreferredDockHand(store), "left");

  assert.equal(togglePreferredDockHand(store, "left"), "right");
  assert.equal(restorePreferredDockHand(store), "right");
  assert.equal(togglePreferredDockHand(store, "right"), "left");
  assert.equal(readPreferredDockHand(store), "left");
});

test("unset Settings seeds left; session restore never infers right", () => {
  const store = memStore();
  assert.equal(seedDefaultDockHand(store), "left");
  assert.equal(store.getItem(LS_UI_HAND), "left");
  assert.equal(restorePreferredDockHand(store), "left");
  const saved = memStore({ "render3d:xr-ui-hand": "right" });
  assert.equal(seedDefaultDockHand(saved), "right");
  assert.equal(restorePreferredDockHand(saved), "right");
});
