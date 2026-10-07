import assert from "node:assert/strict";
import test from "node:test";
import { clearRoboticsMonitorSplitPresentation, prepareRoboticsMonitorReplacement, setRoboticsMonitorSideSplit } from "./robotics-monitor-split.js";

function fakeNode(classes = []) {
  const values = new Set(classes);
  const removed = [];
  return {
    classList: { remove: (...names) => names.forEach((name) => values.delete(name)) },
    style: { removeProperty: (name) => removed.push(name) },
    values,
    removed,
  };
}

test("leaving Robotics monitor split restores viewport and clears forced pane layout", () => {
  const column = fakeNode(["robotics-monitor-split"]);
  const nodes = {
    "robotics-home-viewer": fakeNode(),
    "viser-viewer": fakeNode(),
    "simulation-viewer": fakeNode(),
    viewport: fakeNode(),
  };
  clearRoboticsMonitorSplitPresentation({
    querySelector: (selector) => selector === ".main-column" ? column : null,
    getElementById: (id) => nodes[id] || null,
  });

  assert.equal(column.values.has("robotics-monitor-split"), false);
  for (const id of ["robotics-home-viewer", "viser-viewer", "simulation-viewer"]) {
    assert.ok(nodes[id].removed.includes("display"));
    assert.ok(nodes[id].removed.includes("grid-column"));
    assert.ok(nodes[id].removed.includes("visibility"));
  }
  assert.deepEqual(nodes.viewport.removed, ["display"]);
});

test("Robotics monitor replaces the previous live viewer beside Home without creating a quad", () => {
  const calls = [];
  const simulationPane = fakeNode();
  const docTabs = {
    has: (id) => id === "simulation:open",
    remove: (...args) => calls.push(["remove", ...args]),
    split: (...args) => { calls.push(["split", ...args]); return true; },
    setActive: (...args) => calls.push(["active", ...args]),
  };
  prepareRoboticsMonitorReplacement(docTabs, {
    replaceId: "simulation:open",
    onReplace: () => calls.push(["close", "simulation"]),
    documentRef: {
      querySelector: () => null,
      getElementById: (id) => id === "simulation-viewer" ? simulationPane : null,
    },
  });
  assert.equal(setRoboticsMonitorSideSplit(docTabs, {
    homeId: "robotics:home",
    liveId: "viser:open",
  }), true);
  assert.deepEqual(calls, [
    ["close", "simulation"],
    ["remove", "simulation:open"],
    ["split", "right", "viser:open", { ratio: 0.46, notify: false }],
    ["active", "robotics:home", { notify: false }],
  ]);
  assert.ok(simulationPane.removed.includes("display"));
  assert.ok(simulationPane.removed.includes("grid-column"));
  assert.equal(calls.some((call) => call.includes("down")), false);
});
