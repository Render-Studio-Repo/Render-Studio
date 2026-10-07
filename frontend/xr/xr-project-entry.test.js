import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  xrBootEnterPayload, xrViewportEnterPayload, xrEnterNeedsDeferredOpen,
  resolveSelectedProjectIdForXrEnter, selectedProjectIsInXrScene,
} from "../workspace/workspace-list.js";

// Execute the production hooks: projectId changes before the old assembly is
// disposed, so a nonempty viewport alone does not establish mesh ownership.
const app = readFileSync(new URL("../studio/app.js", import.meta.url), "utf8");
const xr = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");
const appStart = app.indexOf("function prepareXrEnterSelectedProject(");
const appEnd = app.indexOf("\nwindow.__enterXrFromBoot =", appStart);
assert.ok(appStart >= 0 && appEnd > appStart);

function entryHarness({ meshProjectId = "latest", hasMesh = true } = {}) {
  const calls = { opened: [], saved: [], ribbon: [], swaps: 0, places: 0 };
  const context = vm.createContext({
    projectId: "latest", viewportMeshProjectId: meshProjectId,
    currentMesh: hasMesh ? { name: "loaded assembly" } : null,
    projectAssembly: { count: () => hasMesh ? 1 : 0 },
    allProjects: [{ id: "latest" }, { id: "previous" }],
    window: {},
    xrBootEnterPayload, xrViewportEnterPayload, xrEnterNeedsDeferredOpen,
    resolveSelectedProjectIdForXrEnter, selectedProjectIsInXrScene,
    readLastProjectId: () => "latest",
    saveLastProjectId: (id) => calls.saved.push(id),
    ribbon: { setProjectId: (id) => calls.ribbon.push(id) },
    shouldOpenLastProjectOnXrEnterHotPath: () => false,
    openProjectById: async (id) => { calls.opened.push(id); },
    viewportXR: {
      isPresenting: () => true,
      beginProjectSwap: () => { calls.swaps += 1; },
      placeAfterProjectLoad: async () => { calls.places += 1; },
    },
    console: { warn() {} },
  });
  vm.runInContext(app.slice(appStart, appEnd), context);
  return { context, calls };
}

for (const hook of ["prepareXrEnterSelectedProject", "prepareXrEnterLastProject"]) {
  test(`${hook}: previous project's mesh cannot suppress the intended project's deferred open`, () => {
    const { context, calls } = entryHarness({ meshProjectId: "previous" });
    const result = context[hook]();
    assert.equal(result.lastId, "latest");
    assert.equal(result.needOpen, true);
    assert.equal(context.window.__xrDeferredProjectId, "latest");
    assert.equal(context.window.__xrBootEnter.emptyScene, false);
    assert.deepEqual(calls.saved, ["latest"]);
    assert.deepEqual(calls.opened, []);
    if (hook === "prepareXrEnterSelectedProject") assert.equal(result.alreadyInXr, false);
  });

  test(`${hook}: live intended project avoids a deferred reload`, () => {
    const { context, calls } = entryHarness();
    const result = context[hook]();
    assert.equal(result.needOpen, false);
    assert.equal(context.window.__xrDeferredProjectId, undefined);
    assert.deepEqual(calls.opened, []);
    assert.deepEqual(calls.saved, []);
    if (hook === "prepareXrEnterSelectedProject") assert.equal(result.alreadyInXr, true);
  });
}

test("syncSelectedProjectIntoXr reloads a stale assembly even when the selected id already matches", async () => {
  const { context, calls } = entryHarness({ meshProjectId: "previous" });
  assert.equal(await context.syncSelectedProjectIntoXr("latest"), true);
  assert.deepEqual(calls.opened, ["latest"]);
  assert.equal(calls.places, 1);
});

test("syncSelectedProjectIntoXr reuses the intended project's live geometry", async () => {
  const { context, calls } = entryHarness();
  assert.equal(await context.syncSelectedProjectIntoXr("latest"), true);
  assert.deepEqual(calls.opened, []);
  assert.equal(calls.places, 1);
});

function xrFunction(name) {
  const start = xr.indexOf(`  function ${name}(`);
  const end = xr.indexOf("\n  function ", start + 1);
  assert.ok(start >= 0 && end > start, name);
  return xr.slice(start, end);
}

function placementHarness({ presenting = true } = {}) {
  const timers = new Map();
  let nextTimer = 0;
  const state = { mesh: null, placed: 0 };
  const context = vm.createContext({
    presenting, worldAnchored: false, projectSwapActive: true,
    sizeRescueUntil: 0, placeAfterLoadGen: 0, placeAfterLoadTimer: 0,
    bootEnter: { emptyScene: true, projectId: "" },
    performance: { now: () => 1000 },
    getLiveMesh: () => state.mesh,
    getProjectId: () => "latest",
    placeInFront: () => { state.placed += 1; return true; },
    onPlaceDesktop: () => true,
    showLayoutGalleryOnProjectEnter() {},
    setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    console: { warn() {} },
  });
  vm.runInContext([
    xrFunction("cancelPlaceAfterProjectLoad"),
    xrFunction("placeAfterProjectLoad"),
  ].join("\n"), context);
  const tick = () => {
    const pending = timers.entries().next().value;
    assert.ok(pending, "placement schedules another attempt");
    timers.delete(pending[0]);
    pending[1]();
  };
  return { context, state, tick };
}

test("successful delayed project load clears the boot empty-room latch", async () => {
  const { context, state, tick } = placementHarness();
  const placed = context.placeAfterProjectLoad({ attempts: 3 });
  tick(); // The first attempt runs while the GLB is still loading.
  assert.equal(context.bootEnter.emptyScene, true);
  assert.equal(state.placed, 0);
  state.mesh = { name: "latest project's GLTF" };
  tick();
  assert.equal(await placed, true);
  assert.equal(context.bootEnter.emptyScene, false);
  assert.equal(context.bootEnter.projectId, "latest");
  assert.equal(context.projectSwapActive, false);
  assert.equal(state.placed, 1);
});

test("failed placement does not mark an empty room as a loaded project", async () => {
  const { context, tick } = placementHarness();
  const placed = context.placeAfterProjectLoad({ attempts: 1 });
  tick();
  assert.equal(await placed, false);
  assert.equal(context.bootEnter.emptyScene, true);
  assert.equal(context.bootEnter.projectId, "");
});

test("desktop placement leaves XR boot intent unchanged", async () => {
  const { context, state, tick } = placementHarness({ presenting: false });
  state.mesh = { name: "desktop project" };
  const placed = context.placeAfterProjectLoad();
  tick();
  assert.equal(await placed, true);
  assert.equal(context.bootEnter.emptyScene, true);
  assert.equal(context.bootEnter.projectId, "");
});
