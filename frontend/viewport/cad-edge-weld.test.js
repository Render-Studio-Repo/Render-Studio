import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneShortEdgeSegments, weldColinearEdgePositions } from "./cad-edge-weld.js";

function segs(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i += 6) {
    out.push([
      [arr[i], arr[i + 1], arr[i + 2]],
      [arr[i + 3], arr[i + 4], arr[i + 5]],
    ]);
  }
  return out;
}

test("colinear tessellation along an extrusion collapses to one segment", () => {
  const pos = [];
  for (let i = 0; i < 8; i++) {
    pos.push(i, 0, 0, i + 1, 0, 0);
  }
  const welded = weldColinearEdgePositions(pos);
  assert.equal(welded.length, 6);
  assert.deepEqual([...welded], [0, 0, 0, 8, 0, 0]);
});

test("L-corners stay two feature edges", () => {
  const pos = [
    0, 0, 0, 1, 0, 0,
    1, 0, 0, 2, 0, 0,
    2, 0, 0, 2, 1, 0,
  ];
  const welded = weldColinearEdgePositions(pos);
  assert.equal(segs(welded).length, 2);
});

test("triangle feature edges are not merged", () => {
  const pos = [
    0, 0, 0, 1, 0, 0,
    1, 0, 0, 0, 1, 0,
    0, 1, 0, 0, 0, 0,
  ];
  const welded = weldColinearEdgePositions(pos);
  assert.equal(segs(welded).length, 3);
});

test("pruneShortEdgeSegments drops tessellation crumbs", () => {
  const pos = [
    0, 0, 0, 1, 0, 0,
    0, 0, 0, 0.0001, 0, 0,
  ];
  const kept = pruneShortEdgeSegments(pos, 0.01);
  assert.deepEqual([...kept], [0, 0, 0, 1, 0, 0]);
});
