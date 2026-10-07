import assert from "node:assert/strict";
import test from "node:test";
import { createPolicyRunDiagnostics } from "./policy-run-diagnostics.js";

test("a run log shows the trigger before MuJoCo starts and retains the measured outcome", () => {
  const times = [
    "2026-09-28T21:00:00.000Z",
    "2026-09-28T21:00:00.010Z",
    "2026-09-28T21:00:00.100Z",
    "2026-09-28T21:00:00.200Z",
    "2026-09-28T21:00:08.000Z",
  ];
  const log = createPolicyRunDiagnostics({ now: () => new Date(times.shift()), makeRunId: () => "policy-debug-1" });
  log.start({ policy: "Verified cube pick · Episode 0", scene: "cell/demo.xml" });

  assert.match(log.text(), /run_id=policy-debug-1/);
  assert.match(log.text(), /\[START\] trigger: Run requested for Verified cube pick · Episode 0/);
  assert.match(log.text(), /simulation_run_id=not_created/);

  log.setRun("sim-run-42");
  log.setCameras({ cameras: { left: { live: true }, right: { live: true }, zed: { live: true } } });
  log.finish("passed", { steps: 263, lift_m: "0.1004", wall_s: "8.00" }, "Cube lift held above threshold");

  const output = log.text();
  assert.match(output, /status=passed/);
  assert.match(output, /cameras=3\/3 LIVE/);
  assert.match(output, /stat_steps=263/);
  assert.match(output, /stat_lift_m=0.1004/);
  assert.match(output, /\[PASS\] outcome: Cube lift held above threshold/);
});

test("camera diagnostics identify the missing view instead of claiming readiness", () => {
  const log = createPolicyRunDiagnostics({ now: () => new Date("2026-09-28T21:00:00.000Z"), makeRunId: () => "policy-debug-2" });
  log.start({ policy: "Episode 3", scene: "cell/demo.xml" });
  log.setCameras({ cameras: { left: { live: true }, right: { live: false, reason: "no frame" }, zed: { live: true } } });

  assert.match(log.text(), /cameras=2\/3 LIVE/);
  assert.match(log.text(), /camera_right=no frame/);
  assert.match(log.text(), /\[WARN\] cameras: 2\/3 LIVE/);
});

test("simulation-only runs explicitly skip hardware cameras", () => {
  const diagnostics = createPolicyRunDiagnostics({ makeRunId: () => "policy-sim" });
  diagnostics.start({ policy: "Episode 0", scene: "cell/demo.xml" });
  diagnostics.skipCameras();
  assert.equal(diagnostics.snapshot().cameras.label, "SIMULATION ONLY");
  assert.match(diagnostics.text(), /\[SKIP\] cameras: Simulation run does not open hardware cameras/);
});
