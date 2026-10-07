import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isGhostLocalCatalogName,
  isPersistedProjectCatalogName,
  persistedDeleteTargets,
  projectFileDeleteApiPath,
} from "./viewport-object-delete.js";

test("ghost Create catalogs stay local-only", () => {
  assert.equal(isGhostLocalCatalogName("__create_box_1.local"), true);
  assert.equal(isPersistedProjectCatalogName("__create_box_1.local"), false);
});

test("engine-folder models are persisted catalogs", () => {
  assert.equal(isPersistedProjectCatalogName("mesh/helmet.glb"), true);
  assert.equal(isPersistedProjectCatalogName("vibecad/openarm.step"), true);
  assert.equal(isGhostLocalCatalogName("mesh/helmet.glb"), false);
});

test("delete URL keeps engine-folder slashes", () => {
  assert.equal(
    projectFileDeleteApiPath("p1", "mesh/helmet.glb"),
    "/api/projects/p1/files/mesh/helmet.glb",
  );
  assert.equal(
    projectFileDeleteApiPath("p1", "mesh/terminator skull.glb"),
    "/api/projects/p1/files/mesh/terminator%20skull.glb",
  );
});

test("persistedFilename is a delete target even when the live key is .local", () => {
  const targets = persistedDeleteTargets({
    catalogName: "__create_box_2.local",
    object: { userData: { persistedFilename: "vibecad/Box.glb" } },
  });
  assert.deepEqual(targets, ["vibecad/Box.glb"]);
});
