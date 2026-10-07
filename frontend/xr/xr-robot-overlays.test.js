import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");

function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test("robot overlays open together and close when teleop is disarmed", () => {
  const lifecycle = between("onDimosTeleopChange((snap) => {", "const next = nextToolAfterDimosArmChange");
  assert.match(lifecycle, /openRoboticsPanel\(\{ forcePlace: true \}\)/);
  assert.match(lifecycle, /enableRoboticsWristCameras\(\)/);
  assert.match(lifecycle, /hideHandCamWindows\(\)/);
  assert.match(lifecycle, /closeRoboticsPanel\(\)/);
  assert.match(lifecycle, /roboticsWorkspace\.close\(\)/);
});

test("left wrist, right wrist, and head camera are placed in the left overlay cluster", () => {
  assert.match(source, /const ROBOT_CAMERA_SIDES = \["left", "right", "pov"\]/);
  const placement = between("function placeHandCamWindowsInRoom()", "function forgetRoboticsTransientWindows()");
  assert.match(placement, /left: \{ x: -0\.58, y: 0\.10 \}/);
  assert.match(placement, /right: \{ x: -0\.58, y: -0\.02 \}/);
  assert.match(placement, /pov: \{ x: -0\.58, y: -0\.14 \}/);
  assert.match(placement, /tabbedWindows\?\.forget\(win\.group\)/);
});

test("temporary robot overlays are excluded from dockable window groups", () => {
  const groups = between("function allWindowGroups()", "function visibleWindowGroups()");
  assert.doesNotMatch(groups, /kind: "robotics"/);
  assert.doesNotMatch(groups, /kind: "camera-/);
  assert.doesNotMatch(groups, /roboticsWorkspace\.groups/);
});

test("right controller card paints hold-Y progress and save picker follows the controller", () => {
  assert.match(source, /Math\.round\(ui\.yHoldProgress \* 20\)/);
  assert.match(source, /Math\.PI \* 2 \* ui\.yHoldProgress/);
  assert.match(source, /getRightController: \(\) => getRightGrip\(\)/);
  const workspace = readFileSync(new URL("./xr-robotics-workspace.js", import.meta.url), "utf8");
  assert.match(workspace, /function placeAtRightController\(group\)/);
  assert.match(workspace, /confirmPanel\?\.group\.visible/);
  assert.match(workspace, /render3d:robotics-recording-saved/);
});
