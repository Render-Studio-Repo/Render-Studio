import test from "node:test";
import assert from "node:assert/strict";
import { checklistCanRun, createRobotRunDiagnostics, robotRunChecklist } from "./robot-run-diagnostics.js";

test("Home is the default runnable guarded action", () => {
  const rows = robotRunChecklist({ demoLoaded: true, target: "http://pi/config", selectionType: "home", macReachable: true, piReachable: true, guardedHomeSupported: true });
  const recording = rows.find((row) => row.id === "recording");
  assert.equal(recording.state, "pass");
  assert.equal(recording.detail, "Default action: guarded arms-down Home only.");
  assert.equal(checklistCanRun(rows), true);
});

test("readiness passes automated gates while preserving the manual E-stop check", () => {
  const rows = robotRunChecklist({
    demoLoaded: true, target: "http://pi/config", selectionType: "emote", selectionName: "Take 006",
    emoteAvailable: true, macReachable: true, piReachable: true, guardedHomeSupported: true, piStatus: { calibrated: true },
  });
  assert.equal(checklistCanRun(rows), true);
  assert.equal(rows.find((row) => row.id === "estop").state, "manual");
});

test("copyable diagnostics contain ordered boundary outcomes without raw objects", () => {
  const times = [new Date("2026-09-23T20:00:00Z"), new Date("2026-09-23T20:00:01Z"), new Date("2026-09-23T20:00:02Z")];
  const log = createRobotRunDiagnostics({ now: () => times.shift() || new Date("2026-09-23T20:00:03Z") });
  log.add("Mac ping", "PASS", "API answered");
  log.add("Pi ping", "FAIL", "status timeout");
  assert.match(log.text({ target: "192.168.1.77", selection: "Take 006" }), /\[PASS\] Mac ping · API answered[\s\S]*\[FAIL\] Pi ping · status timeout/);
});
