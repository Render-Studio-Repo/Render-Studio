import { test } from "node:test";
import assert from "node:assert/strict";
import {
  finiteBbox,
  finiteNumber,
  jsonTextNeedsSanitize,
  parseGlbJsonFinite,
  parseJsonFinite,
  readGlbJsonChunkText,
  sanitizeGltfAccessors,
} from "./glb-json-finite.js";

test("parseJsonFinite accepts RFC-invalid Infinity bbox tokens", () => {
  const payload = '{"count":1083,"max":[Infinity,75.0,115.0],"min":[Infinity,-75.0,0]}';
  assert.throws(() => JSON.parse(payload), /Infinity|not valid JSON/);
  const parsed = parseJsonFinite(payload);
  assert.equal(parsed.count, 1083);
  assert.equal(parsed.max[0], null);
  assert.equal(parsed.max[1], 75);
  assert.equal(parsed.min[1], -75);
});

test("sanitizeGltfAccessors drops non-finite min/max so GLTFLoader recomputes verts", () => {
  const gltf = {
    accessors: [
      { type: "VEC3", min: [Infinity, -75, 0], max: [Infinity, 75, 115] },
    ],
  };
  // Simulate parseJsonFinite output (Infinity → null)
  gltf.accessors[0].min[0] = null;
  gltf.accessors[0].max[0] = null;
  assert.equal(sanitizeGltfAccessors(gltf), true);
  assert.equal("min" in gltf.accessors[0], false);
  assert.equal("max" in gltf.accessors[0], false);
});

test("sanitizeGltfAccessors leaves finite accessor bbox in place", () => {
  const gltf = {
    accessors: [
      { type: "VEC3", min: [-10, -75, 0], max: [10, 75, 115] },
    ],
  };
  assert.equal(sanitizeGltfAccessors(gltf), false);
  assert.deepEqual(gltf.accessors[0].min, [-10, -75, 0]);
});

test("finiteBbox never returns Infinity", () => {
  const box = finiteBbox([Infinity, -75, 0], [Infinity, 75, 115]);
  assert.deepEqual(box.min, [0, -75, 0]);
  assert.deepEqual(box.max, [0, 75, 115]);
  assert.equal(finiteNumber(Infinity, 0), 0);
  assert.equal(finiteNumber(Number.NaN), 0);
});

test("parseGlbJsonFinite round-trips a GLB JSON snippet for GLTFLoader", () => {
  const text = '{"accessors":[{"count":1083,"max":[Infinity,75.0,115.0],"min":[Infinity,-75.0,0]}]}';
  const { json, repaired } = parseGlbJsonFinite(text);
  assert.equal(repaired, true);
  JSON.parse(JSON.stringify(json));
  assert.equal("min" in json.accessors[0], false);
  assert.equal("max" in json.accessors[0], false);
});

test("jsonTextNeedsSanitize only flags Infinity/NaN tokens", () => {
  assert.equal(jsonTextNeedsSanitize('{"max":[1,2,3]}'), false);
  assert.equal(jsonTextNeedsSanitize('{"max":[Infinity,2,3]}'), true);
  assert.equal(jsonTextNeedsSanitize('{"max":[NaN,2,3]}'), true);
});

test("readGlbJsonChunkText reads JSON without the BIN payload", async () => {
  const json = '{"asset":{"version":"2.0"}}';
  const jsonBytes = new TextEncoder().encode(json);
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = new Uint8Array(jsonBytes.length + pad);
  jsonChunk.set(jsonBytes);
  jsonChunk.fill(0x20, jsonBytes.length);
  const bin = new Uint8Array(64 * 1024).fill(7);
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out[0] = 0x67; out[1] = 0x6c; out[2] = 0x54; out[3] = 0x46;
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  const binOff = 20 + jsonChunk.length;
  view.setUint32(binOff, bin.length, true);
  view.setUint32(binOff + 4, 0x004e4942, true);
  out.set(bin, binOff + 8);
  const text = await readGlbJsonChunkText(new Blob([out]));
  assert.equal(text, json);
  assert.equal(jsonTextNeedsSanitize(text), false);
});
