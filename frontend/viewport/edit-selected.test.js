import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../studio/app.js", import.meta.url), "utf8");
const start = app.indexOf("    // Edit / overwrite: swap the changed component in place and keep siblings.");
const end = app.indexOf("\n  }\n\n  if (comps.length)", start);
assert.ok(start >= 0 && end > start);
const swapBody = app.slice(start, end);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

for (const mode of ["false", "throw"]) {
  test(`failed in-place edit (${mode}) retains selection and reports failure`, async () => {
    const assembly = new Map([["cradle.glb", {}], ["headset.glb", {}]]);
    assembly.getRoot = () => ({});
    const statuses = [];
    const run = new AsyncFunction("loadModel", "projectAssembly", "setEditStatus", `
      const replaceCatalog = "cradle.glb", modelLatestFile = "cradle_edited.glb";
      const comps = [], projectId = "project", fitView = false, orientationMode = null;
      const projectFileUrl = () => "fixture.glb", hasBakedPlacement = () => false;
      const captureEditPlacement = () => null;
      const console = { warn() {} };
      let selectedFile = "cradle.glb";
      try { ${swapBody} } catch (error) { return { selectedFile, error: error.message }; }
      throw new Error("Failed edit silently fell through to full reload");
    `);
    const result = await run(async () => {
      if (mode === "throw") throw new Error("Corrupt GLB");
      return false;
    }, assembly, (...args) => statuses.push(args));
    assert.equal(result.selectedFile, "cradle.glb");
    assert.ok(result.error);
    assert.equal(statuses.at(-1)[0], "error");
    assert.deepEqual([...assembly.keys()], ["cradle.glb", "headset.glb"]);
  });
}

test("overlap cleanup is restricted to the same model lineage", () => {
  const start = app.indexOf("function hideOverlappingScaledDuplicates(");
  const end = app.indexOf("\nfunction ", start + 1);
  assert.match(app.slice(start, end), /if \(!sameModelLineage\(name, keepName\)\) continue;/);
});

test("edit reload carries source placement rather than fitting new bounds", async () => {
  const placement = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];
  let loadOptions;
  const run = new AsyncFunction("loadModel", "placement", `
    const replaceCatalog = "cradle.glb", modelLatestFile = "cradle_edited.glb";
    const comps = [], projectId = "project", reloadPid = projectId, fitView = true, orientationMode = null;
    const old = {};
    const projectAssembly = { get: () => old, getRoot: () => ({}), count: () => 1, has: () => true };
    const captureEditPlacement = root => { if (root !== old) throw new Error("Wrong target"); return placement; };
    const projectFileUrl = () => "fixture.glb", hasBakedPlacement = () => false;
    const ensureMissingBrowserComponentsLoaded = async () => {};
    const projectTree = { setSelected() {} }, featureEditor = { setModel() {} }, viewerOverlay = { clearError() {} };
    const safeRestoreActiveModelPromptState = () => {}, setEditStatus = () => {}, refreshObjectHistory = async () => {};
    const fitCameraToComponent = () => {}, fitCamera = () => {};
    const seatAssemblyToFloor = () => { throw new Error("Edit moved the assembly"); };
    let selectedFile = "cradle.glb";
    ${swapBody}
  `);
  await run(async (_url, _filename, options) => { loadOptions = options; return true; }, placement);
  assert.deepEqual(loadOptions.editPlacement, placement);
  assert.equal(loadOptions.append, true);
});

test("Improve and Generate share the captured edit target and face references", () => {
  assert.match(app, /editContext: \{ targetMode, baseFilename: targetBaseFilename, references: promptReferences \}/);
  assert.match(app, /references: editContext\?\.references \|\| promptReferencesForSubmit\(\)/);
  assert.match(app, /selectedGeometryPromptReferences\(selection, projectId, selectionGeometryContext\)/);
});
