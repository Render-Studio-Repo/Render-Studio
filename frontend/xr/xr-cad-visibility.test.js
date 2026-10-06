import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  xrCadUnhideUnits, xrAnnotateUnhideUnit, xrUnhideFramePlan,
  shouldSkipOverBudgetXrMesh, xrWalkMeshesCapped,
  XR_MESH_TRI_HARD_CAP, XR_PLACE_AABB_MESH_CAP,
} from "./xr-hot-path.js?v=roboticsworkspace3";

// Run the production visibility hooks with the same scene hierarchy the GLTF
// loader supplies. A source-only check missed the invisible wrapper regression.
const source = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");
function extract(name, next) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf(`  function ${next}(`, start);
  assert.ok(start >= 0 && end > start, `${name} hook exists`);
  return source.slice(start, end);
}
function node(name, children = [], triangles = 0) {
  const object = {
    name, children, visible: true, userData: {}, parent: null,
    layers: { value: 0, set(value) { this.value = value; } },
    getObjectByName(wanted) {
      if (this.name === wanted) return this;
      for (const child of this.children) {
        const found = child.getObjectByName(wanted);
        if (found) return found;
      }
      return null;
    },
    remove(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parent = null;
    },
  };
  if (triangles) {
    object.isMesh = true;
    object.geometry = { index: { count: triangles * 3 } };
  }
  for (const child of children) child.parent = object;
  return object;
}
function fixture() {
  const first = node("body-a", [], 1000);
  const second = node("body-b", [], 1000);
  const heavy = node("body-heavy", [], 200000);
  const wrapper = node("GLTF scene", [first, second, heavy]);
  const root = node("project assembly", [wrapper]);
  const context = vm.createContext({
    xrCadUnhideUnits, xrAnnotateUnhideUnit, xrUnhideFramePlan,
    shouldSkipOverBudgetXrMesh, xrWalkMeshesCapped,
    XR_MESH_TRI_HARD_CAP, XR_PLACE_AABB_MESH_CAP,
    setXrCadHoldLayer: (object, hold) => object.layers.set(hold ? 2 : 0),
    hideXrCadEdges() {}, isXrSelectionAabb: () => false, assignXrCadPalette() {},
  });
  vm.runInContext([
    extract("removeXrCadProxy", "parkXrCadForEnter"),
    extract("parkXrCadForEnter", "beginXrCadProgressiveUnhide"),
    extract("revealXrCadUnit", "stepXrCadUnhide"),
    extract("finishXrCadUnhide", "prepareMeshesForXr"),
  ].join("\n"), context);
  return { root, wrapper, first, second, heavy, context };
}
function drawn(object) {
  for (let current = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return object.layers.value === 0;
}

test("progressive CAD reveal opens the GLTF wrapper and keeps unbudgeted siblings hidden", () => {
  const { root, wrapper, first, second, heavy, context } = fixture();
  context.parkXrCadForEnter(root);
  assert.equal(wrapper.visible, false);
  assert.equal(drawn(first), false);
  assert.equal(drawn(second), false);
  const plan = xrUnhideFramePlan({
    remaining: xrCadUnhideUnits(root).map(xrAnnotateUnhideUnit),
    meshesPerFrame: 1, delayHighPoly: false,
  });
  context.revealXrCadUnit(plan.show[0], { root });
  assert.equal(drawn(first), true);
  assert.equal(drawn(second), false);
  assert.equal(drawn(heavy), false);
});

test("leaving XR restores the wrapper and siblings without revealing project-hidden bodies", () => {
  const { root, wrapper, first, second, heavy, context } = fixture();
  second.visible = false;
  context.parkXrCadForEnter(root);
  context.revealXrCadUnit(xrAnnotateUnhideUnit(second), { root });
  assert.equal(drawn(second), false);
  context.revealXrCadUnit(xrAnnotateUnhideUnit(first), { root });
  context.finishXrCadUnhide(root, { restore: true });
  assert.equal(wrapper.visible, true);
  assert.equal(drawn(first), true);
  assert.equal(drawn(second), false);
  assert.equal(drawn(heavy), true);
  assert.equal(wrapper.userData._xrParkedVis, undefined);
});

test("project-hidden GLTF container stays hidden during reveal and after XR", () => {
  const { root, wrapper, first, context } = fixture();
  wrapper.visible = false;
  context.parkXrCadForEnter(root);
  context.revealXrCadUnit(xrAnnotateUnhideUnit(first), { root });
  assert.equal(drawn(first), false);
  context.finishXrCadUnhide(root, { restore: true });
  assert.equal(wrapper.visible, false);
});

test("over-budget CAD stays hidden and no enclosing cube remains after unhide", () => {
  const { root, heavy, context } = fixture();
  const proxy = node("xrCadProxy");
  proxy.userData.xrCadProxy = true;
  proxy.parent = root;
  root.children.push(proxy);
  context.parkXrCadForEnter(root);
  context.revealXrCadUnit(xrAnnotateUnhideUnit(heavy), { root });
  assert.equal(drawn(heavy), false);
  root.userData._xrUnhide = { skipped: [xrAnnotateUnhideUnit(heavy)] };
  context.finishXrCadUnhide(root);
  assert.equal(root.getObjectByName("xrCadProxy"), null);
  assert.equal(root.userData._xrUnhideSkipped, 1);
});
