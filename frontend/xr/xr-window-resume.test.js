import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { captureVisibleWindowPoses, shouldRestoreWindowPoses } from "./xr-window-resume.js";

test("headset removal snapshots only visible finite world-space windows", () => {
  const snapshot = captureVisibleWindowPoses([
    {id:"robotics", visible:true, pose:{x:1,y:1.2,z:-0.6,qx:0,qy:0,qz:0,qw:1}},
    {id:"tools", visible:false, pose:{x:2,y:1,z:-1,qx:0,qy:0,qz:0,qw:1}},
    {id:"menu", visible:true, pose:{x:NaN,y:1,z:0,qx:0,qy:0,qz:0,qw:1}},
  ]);
  assert.deepEqual([...snapshot.keys()], ["robotics"]);
  assert.deepEqual(snapshot.get("robotics"), {x:1,y:1.2,z:-0.6,qx:0,qy:0,qz:0,qw:1});
});

test("same-session visibility and reference-space recovery restore the snapshot", () => {
  const snapshot = new Map([["robotics", {x:1,y:1,z:-1,qx:0,qy:0,qz:0,qw:1}]]);
  assert.equal(shouldRestoreWindowPoses({presenting:true,becameVisible:true,snapshot}), true);
  assert.equal(shouldRestoreWindowPoses({presenting:true,referenceSpaceChanged:true,snapshot}), true);
  assert.equal(shouldRestoreWindowPoses({presenting:false,becameVisible:true,snapshot}), false);
  assert.equal(shouldRestoreWindowPoses({presenting:true,becameVisible:false,snapshot}), false);
});

test("viewport wires headset hide and resume to the world-window snapshot", () => {
  const source = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");
  assert.match(source, /if \(!becameVisible\) \{\s*captureVisibilityWindowPoses\(\)/);
  assert.match(source, /if \(becameVisible\) restoreVisibilityWindowPoses\("visibility"\)/);
  assert.match(source, /if \(restored\) restoreVisibilityWindowPoses\("refspace"\)/);
});
