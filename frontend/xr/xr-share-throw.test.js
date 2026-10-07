import { test } from "node:test";
import assert from "node:assert/strict";
import {
  xrThumbstickClicked,
  shareThrowArmed,
  shareThrowWalkBlocked,
  isThrowPrintMesh,
  printerBoxHit,
  shareThrowNameplate,
  pickShareThrowTarget,
  shareThrowPoseAt,
  printerVolumeFromProfile,
} from "./xr-share-throw.js";
import { xrSharePanelLines, printerVolumeBoxM } from "./xr-share-print.js";

test("thumbstick click is xr-standard buttons[3]", () => {
  assert.equal(xrThumbstickClicked({ mapping: "xr-standard", buttons: [{}, {}, {}, { pressed: true }] }), true);
  assert.equal(xrThumbstickClicked({ mapping: "xr-standard", buttons: [{}, {}, {}, { pressed: false }] }), false);
  assert.equal(xrThumbstickClicked({ mapping: "xr-standard", buttons: [{}, {}, {}, { pressed: false, value: 0.9 }] }), false);
});

test("share throw arms with squeeze + B hold or stick-in", () => {
  assert.equal(shareThrowArmed({ squeezing: true, throwHeld: true }), true);
  assert.equal(shareThrowArmed({ squeezing: true, thumbstickIn: true }), true);
  assert.equal(shareThrowArmed({ squeezing: true, throwHeld: false, thumbstickIn: false }), false);
  assert.equal(shareThrowWalkBlocked({ gripping: true }), true);
  assert.equal(shareThrowWalkBlocked({ gripping: false }), false);
  assert.equal(isThrowPrintMesh({ userData: { viserGeometry: true } }), false);
  assert.equal(isThrowPrintMesh({ userData: {} }), true);
});

test("nameplate is short and tagged", () => {
  const plate = shareThrowNameplate({ name: "Ada Lovelace", kind: "person" });
  assert.equal(plate.glyph, "share");
  assert.ok(plate.title.includes("Ada"));
});

test("throw target requires accept_sends and stays in cone", () => {
  const hit = pickShareThrowTarget({
    origin: [0, 1.4, 0],
    forward: [0, 0, -1],
    users: [
      { id: "no", display_name: "No", pos: [0, 1.4, -2], accept_sends: false },
      { id: "yes", display_name: "Yes", pos: [0.1, 1.4, -1.4], accept_sends: true },
    ],
  });
  assert.equal(hit?.id, "yes");
});

test("fly-and-dive collapses scale at the end", () => {
  const mid = shareThrowPoseAt(0.4, [0, 1, 0], [0, 1, -2]);
  const end = shareThrowPoseAt(1, [0, 1, 0], [0, 1, -2]);
  assert.ok(mid.scale > 0.6);
  assert.ok(end.scale < 0.2);
  assert.ok(Math.abs(end.z + 2) < 0.05);
});

test("printer box hit detects a toss aimed at the volume", () => {
  const hit = printerBoxHit({
    origin: [0, 0.2, 1],
    direction: [0, 0, -1],
    center: [0, 0.13, 0],
    size: [0.3, 0.3, 0.3],
  });
  assert.ok(hit);
  assert.equal(printerBoxHit({
    origin: [2, 0.2, 1],
    direction: [0, 0, -1],
    center: [0, 0.13, 0],
    size: [0.3, 0.3, 0.3],
  }), null);
});

test("printer volume comes from Context Lab specs only", () => {
  assert.equal(printerVolumeFromProfile({}), null);
  const box = printerVolumeFromProfile({ specs: { volume_mm: [256, 256, 256] } });
  assert.equal(box.x, 0.256);
  assert.equal(printerVolumeBoxM([]), null);
});

test("share sheet includes friends search discord X bambu and print opt-in", () => {
  const lines = xrSharePanelLines({
    friends: [{ id: "a", display_name: "Ada" }],
    includeX: true,
    acceptSends: false,
    roomPrintTargets: [{ id: "b", display_name: "Sam" }],
  });
  const ids = lines.map((l) => l.id);
  assert.ok(ids.includes("share-friend:a"));
  assert.ok(ids.includes("share-search"));
  assert.ok(ids.includes("share-discord"));
  assert.ok(ids.includes("share-x"));
  assert.ok(ids.includes("share-bambu"));
  assert.ok(ids.includes("print-send:b"));
  assert.ok(ids.includes("printer_accept"));
});
