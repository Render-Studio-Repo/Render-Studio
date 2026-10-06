import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAuthorizedAgents, remainingTone, formatUsd, RA_AGENTS_TOKEN, parseHarnessMonitor, RA_HARNESS_TOKEN, grokBotCards, parseAgentChat, agentChatPostBody, RA_AGENT_CHAT_FEED, renderAgentTabView, selectedThreadRefreshId } from "./render-agent-agents-tab.js";

test("authorized roster maps Studio, Astra, Grok remaining %", () => {
  const roster = parseAuthorizedAgents({
    listing: {
      usage: { remaining_pct: 82, spent_today_usd: 1.2, spent_week_usd: 4.5 },
      credits: { balance_cents: 2370 },
      chatgpt: { signed_in: true, plan_label: "Plus" },
      providers: [
        { id: "cloud", connected: true, plan_label: "$23.70 credits" },
        { id: "openai", connected: true, auth_status: "signed_in", plan_label: "Plus" },
      ],
    },
    grok: { connected: true, model: "grok-4", detail: "Grok chat ready" },
    tasks: [{ agent_id: "gpt-astra", title: "Pi network help" }],
  });
  assert.equal(roster.token, RA_AGENTS_TOKEN);
  assert.equal(roster.meter.remaining_pct, 82);
  assert.equal(remainingTone(82), "green");
  assert.equal(formatUsd(1.2), "$1.20");
  const astra = roster.agents.find((a) => a.id === "gpt-astra");
  assert.equal(astra.authorized, true);
  assert.equal(astra.task, "Pi network help");
  const grok = roster.agents.find((a) => a.id === "grok-bot");
  assert.equal(grok.authorized, true);
});

test("connected grok whois nicks replace the static Grok bot label", () => {
  const cards = grokBotCards({
    who: {
      sam: { nick: "Sam" },
      "vibe-rnd": { nick: "Rick", role: "RnD" },
      ledger: { nick: "Ledger", role: "relay" },
    },
  }, { connected: true });
  assert.equal(cards.find((c) => c.id === "grok:sam"), undefined);
  assert.equal(cards.find((c) => c.id === "grok:vibe-rnd").label, "Rick");
  const roster = parseAuthorizedAgents({
    grok: { connected: true, model: "grok-4" },
    who: { "grok-bot": { nick: "GrokBot" }, ledger: { nick: "Ledger", role: "relay" } },
  });
  assert.equal(roster.agents.find((a) => a.id === "grok-bot").label, "GrokBot");
  assert.equal(roster.agents.find((a) => a.id === "grok:ledger").label, "Ledger");
});

test("harness usage monitor lists cloud PRs and grok spins without inventing dollars", () => {
  const mon = parseHarnessMonitor({
    listing: { usage: { remaining_pct: 12, spent_today_usd: 2, spent_week_usd: 9 } },
    grok: { connected: true, model: "grok-4.5" },
    health: { ok: true, name: "grok-bot", version: "20260916-26" },
    stats: { help_requests: 3 },
    chat: {
      messages: [
        { agent: "code", ts: "2026-09-18T12:00:00", text: "CURRENT warehouse · spinning cursor/job-warehouse-mvp-20260918-6885 PR #23" },
        { agent: "grok-bot", ts: "2026-09-18T12:01:00", text: "HARNESS_WAKE cloud agent for #26 marketplace" },
      ],
    },
  });
  assert.equal(mon.token, RA_HARNESS_TOKEN);
  assert.equal(mon.cursor_line_items, "unknown");
  assert.equal(mon.grok.up, true);
  assert.ok(mon.active.some((a) => a.label === "PR #23"));
  assert.ok(mon.active.some((a) => String(a.label).includes("warehouse")));
  assert.ok(mon.spinning.some((s) => s.agent === "grok-bot"));
});

test("Render Agent tabs have exclusive content ownership", () => {
  assert.deepEqual(renderAgentTabView("chat"), { chat: true, agentChat: false, usage: false });
  assert.deepEqual(renderAgentTabView("agent-chat"), { chat: false, agentChat: true, usage: false });
  assert.deepEqual(renderAgentTabView("usage"), { chat: false, agentChat: false, usage: true });
});

test("agent chat normalizes only conversation messages in chronological order", () => {
  assert.deepEqual(parseAgentChat({ messages: [
    { sender: "grok-bot", body: "second", created_at: "2026-09-23T10:01:00Z" },
    { agent: "render-agent", text: "first", ts: "2026-09-23T10:00:00Z" },
    { agent: "empty", text: "" },
  ] }), [
    { agent: "render-agent", text: "first", at: "2026-09-23T10:00:00Z" },
    { agent: "grok-bot", text: "second", at: "2026-09-23T10:01:00Z" },
  ]);
});

test("Agent chat uses the live harness feed and posts bounded Sam messages", () => {
  assert.equal(RA_AGENT_CHAT_FEED, "/mcp/team-chat/feed?limit=120");
  assert.deepEqual(agentChatPostBody("  hello harness  "), { agent: "sam", text: "hello harness" });
  assert.equal(agentChatPostBody("x".repeat(1700)).text.length, 1500);
});

test("the selected thread reloads when it still exists in the refreshed list", () => {
  const threads = [{ id: "newer" }, { id: "selected" }];
  assert.equal(selectedThreadRefreshId(threads, "selected"), "selected");
  assert.equal(selectedThreadRefreshId(threads, "missing"), "newer");
  assert.equal(selectedThreadRefreshId([], "selected"), "");
});
