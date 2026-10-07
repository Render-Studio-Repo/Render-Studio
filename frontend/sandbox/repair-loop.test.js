import test from "node:test";
import assert from "node:assert/strict";
import { REPAIR_AGENTS, repairTableLayout, REPAIR1_TOKEN } from "./repair-table.js";
import { buildHypotheses, adjudicateRepair, voteRepairRoles } from "./repair-loop.js";

test("no supported hypothesis does not clear unknown interaction checks", () => {
  assert.equal(adjudicateRepair([], { "sandbox.mcp_write": "ok", "vr.controllers.trigger": "unknown" }).gate, "unverified");
});

test("repair table seats five agents with skills", () => {
  assert.equal(REPAIR1_TOKEN, "repair1");
  assert.equal(REPAIR_AGENTS.length, 5);
  const layout = repairTableLayout();
  assert.equal(layout.seats.length, 5);
  assert.equal(layout.openArm, "2.0");
  assert.ok(REPAIR_AGENTS.every((a) => a.skill.startsWith("skills/repair-")));
});

test("repair loop eliminates mcp hypothesis when write is ok", () => {
  const checks = {
    "sandbox.mcp_write": "ok",
    "openarm.teleop_lab": "ok",
    "openarm.agent_feed": "unknown",
    "openarm.rig_2_0": "ok",
    "webgl.context": "ok",
  };
  const hyps = buildHypotheses({ checks });
  assert.equal(hyps.find((h) => h.hypothesis_id === "mcp-write-blocked").status, "eliminated");
  assert.equal(hyps.find((h) => h.hypothesis_id === "no-demo-packet").status, "supported");
  const adj = adjudicateRepair(hyps, checks);
  assert.equal(adj.gate, "actionable");
  const votes = voteRepairRoles(hyps, adj);
  assert.equal(votes.length, 5);
});
