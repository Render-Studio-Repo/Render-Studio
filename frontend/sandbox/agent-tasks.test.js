import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TASK_AGENTS,
  assignTask,
  completeTask,
  listTasks,
  ledgerStatusLine,
  liveFeedPayload,
  parseAstraSubscription,
  CREW_SHOP_PACK,
  seedShopCrewTasks,
  RNDDEMO1_TOKEN,
} from "./agent-tasks.js";

test("each seated agent has a task list Sam can assign", () => {
  assert.ok(TASK_AGENTS.some((a) => a.id === "vibe-rnd"));
  assert.ok(TASK_AGENTS.some((a) => a.id === "ledger"));
  assert.ok(TASK_AGENTS.some((a) => a.id === "astra" && /assistant/i.test(a.role || "")));
  const rec = assignTask("vibe-rnd", "Walk the Voice Bench PDF");
  assert.equal(rec.token, RNDDEMO1_TOKEN);
  assert.equal(rec.status, "queued");
  assert.ok(listTasks("vibe-rnd").some((t) => t.id === rec.id));
});

test("Agents tab parses ChatGPT Astra subscription from listing", () => {
  const on = parseAstraSubscription({
    chatgpt: { signed_in: true, status: "signed_in", account_email: "sam@example.com", plan_label: "Plus" },
    providers: [{ id: "openai", connected: true, auth_status: "signed_in", account_email: "sam@example.com", plan_label: "Plus" }],
  });
  assert.equal(on.signedIn, true);
  assert.equal(on.email, "sam@example.com");
  assert.equal(on.plan, "Plus");
  assert.equal(on.error, "");

  const off = parseAstraSubscription({
    chatgpt: { signed_in: false, status: "not_signed_in" },
    providers: [{ id: "openai", connected: false, auth_status: "not_signed_in", cad_ready: true }],
  });
  assert.equal(off.signedIn, false);
});

test("shop pack assigns video, wiring crew, and model experiments", () => {
  assert.ok(CREW_SHOP_PACK.some((r) => r.agent_id === "vibe-marketing" && /music|shoot/i.test(r.title)));
  assert.ok(CREW_SHOP_PACK.some((r) => r.agent_id === "clip-bot"));
  assert.ok(CREW_SHOP_PACK.filter((r) => /wiring simulator/i.test(r.title)).length >= 3);
  assert.ok(CREW_SHOP_PACK.some((r) => /not File IDE/i.test(r.title)));
  assert.ok(CREW_SHOP_PACK.some((r) => r.agent_id === "printer-bot" && /printer/i.test(r.title)));
  const made = seedShopCrewTasks({ from: "test" });
  assert.ok(made.length >= 1);
  const again = seedShopCrewTasks({ from: "test" });
  assert.equal(again.length, 0);
});

test("completing a task yields a Ledger status line for the live feed", () => {
  const rec = assignTask("analytics", "Load live stats");
  const done = completeTask(rec.id, { note: "ok" });
  assert.equal(done.status, "done");
  const line = ledgerStatusLine(done);
  assert.match(line, /LEDGER rnddemo1/);
  assert.match(line, /analytics/);
  assert.match(line, /DONE/);
  const feed = liveFeedPayload();
  assert.equal(feed.live, true);
  assert.ok(feed.tasks.some((t) => t.id === rec.id && t.status === "done"));
  assert.ok(feed.keep.includes("mktpres1"));
  assert.ok(feed.keep.includes("rndbench1"));
});
