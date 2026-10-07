import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { refreshXrReferenceSpace } from "./xr-session-restart.js";

function harness(requestReferenceSpace) {
  const session = { requestReferenceSpace };
  const current = { session, space: { original: true } };
  const xr = {
    getSession: () => current.session,
    setReferenceSpace: (space) => { current.space = space; },
  };
  return { session, xr, current };
}

test("restart uses the new local-floor space in the same session", async () => {
  const space = {};
  const h = harness(async (kind) => { assert.equal(kind, "local-floor"); return space; });
  assert.equal(await refreshXrReferenceSpace(h), space);
  assert.equal(h.current.space, space);
});

test("a stalled recenter releases recovery and ignores a late space", async () => {
  let resolve;
  const h = harness(() => new Promise((done) => { resolve = done; }));
  const original = h.current.space;
  assert.equal(await refreshXrReferenceSpace({ ...h, timeoutMs: 5 }), null);
  resolve({ late: true });
  await Promise.resolve();
  assert.equal(h.current.space, original);
});

test("a rejected recenter retains the current space", async () => {
  const h = harness(async () => { throw new Error("runtime unavailable"); });
  const original = h.current.space;
  assert.equal(await refreshXrReferenceSpace(h), null);
  assert.equal(h.current.space, original);
});

test("recenter cannot change the reference space after session replacement", async () => {
  let resolve;
  const h = harness(() => new Promise((done) => { resolve = done; }));
  const original = h.current.space;
  const pending = refreshXrReferenceSpace(h);
  h.current.session = {};
  resolve({ stale: true });
  assert.equal(await pending, null);
  assert.equal(h.current.space, original);
});

for (const change of ["exit", "replacement"]) {
  test(`scene restart does not place CAD or reopen a project after session ${change}`, async () => {
    const source = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");
    const start = source.indexOf("  async function restartVrSceneKeepSession(");
    const end = source.indexOf("\n  function ", start + 1);
    assert.ok(start >= 0 && end > start);
    let resolve, placed = 0, opened = 0;
    const session = {}, current = { session };
    const context = vm.createContext({
      presenting: true, renderer: { xr: { getSession: () => current.session } },
      xrDevStats: {}, restoreStarterControls() {}, GRID_POPUP_SPECS: {},
      hideToolWheel() {}, closeMenuConsole() {}, endGrab() {}, panelDrag: null,
      gripPressActive: [false, false], gripScaleContact: [null, null], lastNearGrip: [null, null],
      releaseGripGrab() {}, getLeftGrip() {}, getRightGrip() {},
      emptyStickRestartState: () => ({}), emptyLeftMenuRestartState: () => ({}),
      updateStickRestartHud() {}, hydrateXrSessionInputs() {}, controllers: [],
      refreshXrReferenceSpace: () => new Promise((done) => { resolve = done; }),
      placeCadForSession: () => { placed++; },
      window: { __xrDeferredProjectId: "saved-project" },
      flushDeferredXrProject: () => { opened++; },
    });
    vm.runInContext(source.slice(start, end), context);
    const pending = context.restartVrSceneKeepSession();
    if (change === "exit") context.presenting = false;
    else current.session = {};
    resolve(null);
    await pending;
    assert.equal(placed, 0);
    assert.equal(opened, 0);
  });
}
