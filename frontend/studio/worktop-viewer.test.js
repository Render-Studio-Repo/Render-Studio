import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WORKTOP_GOD_HEIGHT_M, WORKTOP_TAB_ID, worktopSeatLayout } from "./worktop-viewer.js";
import { XR_TEAM_AGENTS } from "../xr/xr-agent-join.js";

test("worktop seats agents around the table", () => {
  const seats = worktopSeatLayout(XR_TEAM_AGENTS);
  assert.equal(seats.length, XR_TEAM_AGENTS.length);
  assert.equal(WORKTOP_TAB_ID, "worktop:open");
  assert.equal(WORKTOP_GOD_HEIGHT_M, 5.4);
  assert.ok(seats.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)));
});

test("Robotics ribbon removes PC WASD and keeps Worktop god view", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ribbon = readFileSync(new URL("./ribbon.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const xr = readFileSync(new URL("../xr/viewport-xr.js", import.meta.url), "utf8");
  assert.match(html, /id="worktop-viewer"/);
  assert.doesNotMatch(html, /id="btn-xr-pc-scene"/);
  assert.match(html, /data-worktop-god/);
  assert.match(ribbon, /Worktop:/);
  assert.doesNotMatch(ribbon, /roboticsAction: "pc-vr-scene"/);
  assert.match(ribbon, /roboticsAction: "god-view"/);
  assert.match(app, /createWorktopViewer/);
  assert.doesNotMatch(xr, /enterDesktopVrWorkspace/);
  assert.match(xr, /enterGodView/);
  assert.match(xr, /checkRoboticsProfileAfterWorkspaceUpdate/);
});
