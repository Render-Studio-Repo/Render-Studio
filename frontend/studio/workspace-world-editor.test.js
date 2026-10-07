import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WORKSPACE_TAB_ID } from "./workspace-world-editor.js";
import { emptyWorkspaceWorld, normalizeWorkspaceWorld, WORKSPACE_WORLD_PIECES } from "../xr/xr-workspace-world.js";

test("workspace world does not seed a stock workshop into every project", () => {
  const world = emptyWorkspaceWorld();
  assert.equal(world.schema, "render-studio-workspace-world/v1");
  assert.equal(world.pieces.length, 0);
  assert.equal(normalizeWorkspaceWorld(null).pieces.length, 0);
  assert.equal(normalizeWorkspaceWorld({
    pieces: [
      { id: "floor", kind: "floor" },
      { id: "round_table", kind: "round_table" },
      { id: "spawn", kind: "spawn", z: 2.4 },
    ],
  }).pieces.length, 0);
  assert.equal(normalizeWorkspaceWorld({
    pieces: [
      { id: "floor", kind: "floor" },
      { id: "lamp-1", kind: "lamp", y: 0, z: -1 },
    ],
  }).pieces.length, 2);
  assert.ok(WORKSPACE_WORLD_PIECES.length >= 6);
});

test("Workspace world editor stays available off the CAD ribbon", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ribbon = readFileSync(new URL("./ribbon.js", import.meta.url), "utf8");
  const modes = readFileSync(new URL("../workspace/workspace-modes.js", import.meta.url), "utf8");
  const tabs = readFileSync(new URL("./document-tabs.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.equal(WORKSPACE_TAB_ID, "workspace:open");
  assert.ok(!modes.slice(modes.indexOf("DESIGN_RIBBON_TAB_IDS"), modes.indexOf("const DESIGN_TAB_LABELS")).includes('"WORKSPACE"'));
  assert.match(ribbon, /WORKSPACE_CATALOG|Workspace:/);
  assert.doesNotMatch(ribbon, /workspaceAction: "enter-pc"/);
  assert.doesNotMatch(html, /id="studio-boot-enter-pc"/);
  assert.match(html, /Enter VR/);
  assert.match(tabs, /WORKSPACE_TAB_ID/);
  assert.match(app, /createWorkspaceWorldEditor/);
  assert.match(app, /tab === "WORKSPACE"/);
});

test("Robotics opens its lightweight home without eagerly starting live tools", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const start = app.indexOf("async function showRoboticsTabUi()");
  const end = app.indexOf("\nfunction handleWorkspaceRibbonAction", start);
  const body = app.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(body, /setActive\?\.\(ROBOTICS_HOME_TAB_ID\)/);
  assert.doesNotMatch(body, /roboticSimulator\?\.show/);
  assert.doesNotMatch(body, /\.connect\?\.\(/);
  assert.doesNotMatch(body, /\.syncList\?\.\(/);
  assert.doesNotMatch(body, /mountRoboticsPrinterTab/);
});

test("workspace geometry is deferred until Workshop or God View is opened", () => {
  const viewport = readFileSync(new URL("../xr/viewport-xr.js", import.meta.url), "utf8");
  const creation = viewport.indexOf("const workspaceWorld = createWorkspaceWorld");
  const nextSection = viewport.indexOf("let lastDropSendAt", creation);
  assert.ok(creation >= 0 && nextSection > creation);
  assert.doesNotMatch(viewport.slice(creation, nextSection), /workspaceWorld\.rebuild/);
  assert.match(viewport, /if \(workshopConfig\?\.world\) workspaceWorld\?\.rebuild/);
});
