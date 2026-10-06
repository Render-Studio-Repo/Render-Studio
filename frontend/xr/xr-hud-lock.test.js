import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LS_XR_HUD_LOCKS,
  isXrHudLocked,
  writeXrHudLocked,
  toggleXrHudLocked,
  pickHudHeader,
  shouldFollowBeltHud,
  hudOverflowMenuLayout,
} from "./xr-hud-lock.js";

function memStore(init = {}) {
  const data = { ...init };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

test("Lock in place persists per HUD kind", () => {
  const store = memStore();
  assert.equal(isXrHudLocked("settings", store), false);
  writeXrHudLocked("settings", true, store);
  assert.equal(isXrHudLocked("settings", store), true);
  assert.ok(store.getItem(LS_XR_HUD_LOCKS).includes("settings"));
  assert.equal(toggleXrHudLocked("settings", store), false);
  assert.equal(isXrHudLocked("robotics", store), false);
  writeXrHudLocked("robotics", true, store);
  assert.equal(isXrHudLocked("robotics", store), true);
});

test("only the top bar manipulates a panel; content edges are inert", () => {
  const close = pickHudHeader(900, 20, 960, 76);
  assert.equal(close?.id, "hide");
  const overflow = pickHudHeader(800, 20, 960, 76);
  assert.equal(overflow?.id, "overflow");
  const drag = pickHudHeader(40, 20, 960, 76);
  assert.equal(drag?.id, "drag");
  const rotate = pickHudHeader(10, 200, 960, 76);
  assert.equal(rotate, null);
  const menu = hudOverflowMenuLayout(960, 76, { locked: false });
  const lock = pickHudHeader(menu.lock.x + 10, menu.lock.y + 10, 960, 76, { overflowOpen: true, locked: false });
  assert.equal(lock?.id, "lock");
  assert.ok(!menu.rows.some(r => ['rotate','move-this','move-set'].includes(r.id)));
  assert.equal(shouldFollowBeltHud({ locked: true }), false);
  assert.equal(shouldFollowBeltHud({ locked: false, dragging: false }), true);
  assert.equal(shouldFollowBeltHud({ kind: "ai" }), false);
  assert.equal(shouldFollowBeltHud({ laserAim: true }), false);
  assert.equal(shouldFollowBeltHud({ parked: true }), false);
});
