import test from "node:test";
import assert from "node:assert/strict";
import { scoreSeatChecks, crewSnapshot, CREWSCORE1_TOKEN } from "./agent-score-rubrics.js";
import { dailyCrewScore, scoreTablesMarkdown, benchAgents } from "./agent-bench-board.js";
import { pickAgent } from "./astra-distribute.js";
import { crewScoreWorkItems, DAILYSCORE1_TOKEN } from "./render-agent-crew-score.js";

const mem = {
  store: {},
  getItem(k) { return this.store[k] ?? null; },
  setItem(k, v) { this.store[k] = String(v); },
};

test("seat checks pass unknown keys and deduct known misses", () => {
  assert.equal(CREWSCORE1_TOKEN, "crewscore1");
  const full = scoreSeatChecks("analytics", {});
  assert.equal(full.score, 100);
  const miss = scoreSeatChecks("analytics", { bench: false, knowledge_lake: true, sandbox_page: true });
  assert.equal(miss.score, 60);
  assert.match(miss.change, /knowledge lake/i);
});

test("Studio snapshot does not fake-fail sandbox chrome", () => {
  const studio = { querySelector: () => null };
  const snap = crewSnapshot(studio, mem);
  assert.equal(snap.sandbox_page, undefined);
  assert.equal(snap.live_ide, undefined);
  assert.equal(snap.one_speaker, true);
});

test("daily crew score tables and once-per-day", () => {
  const storage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); } };
  const now = new Date("2026-09-18T12:00:00.000Z");
  const first = dailyCrewScore({
    force: true,
    snapshot: {},
    storage,
    now,
  });
  assert.equal(first.already, false);
  assert.equal(first.day, "2026-09-18");
  assert.ok(first.table.some((r) => r.agent_id === "cad-bot"));
  assert.match(scoreTablesMarkdown(first), /Daily crew score/);
  assert.match(first.markdown, /\| Agent \| Score \|/);
  const second = dailyCrewScore({ snapshot: {}, storage, now });
  assert.equal(second.already, true);
  const nextDay = dailyCrewScore({
    force: true,
    snapshot: { bench: false, knowledge_lake: true, sandbox_page: true },
    storage,
    now: new Date("2026-09-19T12:00:00.000Z"),
  });
  const analytics = nextDay.table.find((r) => r.agent_id === "analytics");
  assert.ok(analytics.delta < 0);
  assert.match(nextDay.markdown, /Changes \/ slips/);
});

test("Render Agent pickAgent routes CAD and scores to seats", () => {
  assert.equal(DAILYSCORE1_TOKEN, "dailyscore1");
  assert.equal(pickAgent("cad-bot: check hinge tolerance and clamp click", 0), "cad-bot");
  assert.equal(pickAgent("analytics: log scores to the knowledge lake daily", 0), "analytics");
  assert.equal(pickAgent("cursor patch Live IDE auto-push", 0), "cursor-engineer");
  const report = {
    day: "2026-09-18",
    avg: 71,
    table: [
      { agent_id: "printer-bot", name: "Print-bot", score: 60, delta: 0, change: "LAN printer probe only" },
      { agent_id: "cad-bot", name: "CAD bot", score: 100, delta: 0, change: "ok" },
    ],
  };
  const items = crewScoreWorkItems(report);
  assert.ok(items.some((t) => /printer-bot/.test(t)));
  assert.ok(!items.some((t) => /^cad-bot:/.test(t)));
});

test("bot bench still names a best set from goldens", () => {
  const bench = benchAgents({
    runs: 1,
    agents: [{ id: "cad-bot", name: "CAD bot" }, { id: "analytics", name: "Analytics" }],
    snapshot: {},
  });
  assert.ok(bench.best_set.includes("cad-bot") || bench.best_set.includes("analytics"));
  assert.equal(bench.rows.length, 2);
});
