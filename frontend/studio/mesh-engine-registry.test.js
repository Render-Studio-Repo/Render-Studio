import test from "node:test";
import assert from "node:assert/strict";

import { MESH_ENGINES, meshEngineLabel, meshModeForEngine, normalizeMeshEngine } from "./mesh-engine-registry.js";

test("one Mesh registry owns modes and displayed runtime versions", () => {
  assert.equal(normalizeMeshEngine("unknown"), "stable");
  assert.equal(meshModeForEngine("stable"), "mesh");
  assert.equal(meshModeForEngine("beta"), "mesh_beta");
  assert.equal(meshEngineLabel("beta", { withVersion: true }), "Beta (2.0.0)");
  assert.deepEqual(Object.keys(MESH_ENGINES), ["stable", "beta"]);
});
