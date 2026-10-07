import { test } from "node:test";
import assert from "node:assert/strict";
import { runCadBotBenchmark, scoreCadBotTurn, CAD_BOT_ID, CAD_BOT_GOLDEN } from "./cad-bot-bench.js";

test("CAD bot bench: purse pin fails, fused shell will not open, on-spec pin passes", () => {
  const bench = runCadBotBenchmark();
  assert.equal(CAD_BOT_GOLDEN.length, 3);
  assert.equal(bench.agent_id, CAD_BOT_ID);
  const purse = bench.rows.find((r) => r.case_id === "purse-0009c214");
  assert.equal(purse.mech.will_open, true);
  assert.equal(purse.mech.pin_fits, false);
  assert.ok(purse.score >= 85);
  const fused = bench.rows.find((r) => r.case_id === "fused-shell-no-lid");
  assert.equal(fused.mech.will_open, false);
  const pinOk = bench.rows.find((r) => r.case_id === "pin-on-spec");
  assert.equal(pinOk.mech.pin_fits, true);
  assert.ok(bench.avg >= 80);
});

test("looping after two identical fails costs score", () => {
  const mech = { will_open: true, will_shut: true, pin_fits: false, summary: "OPEN/SHUT yes. TOLERANCE fat. leftover McMaster clamp" };
  const once = scoreCadBotTurn(mech, {
    expected: { will_open: true, will_shut: true, pin_fits: false, leftover_clamp: true, change: "scale pin" },
    loopRepeats: 0,
  });
  const looped = scoreCadBotTurn(mech, {
    expected: { will_open: true, will_shut: true, pin_fits: false, leftover_clamp: true, change: "scale pin" },
    loopRepeats: 3,
  });
  assert.ok(looped.score < once.score);
  assert.match(looped.notes, /looped/);
});
