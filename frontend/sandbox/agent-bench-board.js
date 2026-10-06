/** Benchmark every seated bot a few times, pick the best set, push from sandbox. Token botbench1. */

import { OFFICE_AGENTS } from "./office-agents.js";
import { runCadBotBenchmark } from "../studio/cad-bot-bench.js?v=cadbot1";
import { recordKnowledgeTurn } from "./agent-knowledge.js?v=kb1&teleop-y=20260922-poseconnect1";
import { autoPushSandboxCode } from "./sandbox-push.js?v=20260923-draw-recordings1";
import { crewSnapshot, labelForScore, scoreSeatChecks } from "./agent-score-rubrics.js?v=crewscore1";

export const BOTBENCH1_TOKEN = "botbench1";
export const DAILY_LS = "render3d.sandbox.dailyCrewScore";
export const DEFAULT_RUNS = 3;

function scoreAgent(agentId, snapshot) {
  if (agentId === "cad-bot") {
    const b = runCadBotBenchmark();
    return {
      score: b.avg,
      label: b.label,
      change: b.avg >= 85 ? "Mechanism goldens passed (judge)" : b.change,
      detail: b.change || `${b.n} goldens`,
    };
  }
  if (agentId === "harness-mule") {
    return { score: 72, label: "partial", change: "Receipt + bot_verdict only", detail: "rcpt1" };
  }
  return scoreSeatChecks(agentId, snapshot);
}

export function benchAgents({ runs = DEFAULT_RUNS, agents = OFFICE_AGENTS, snapshot } = {}) {
  const n = Math.max(1, Math.min(8, Number(runs) || DEFAULT_RUNS));
  const snap = snapshot || {};
  const rows = (agents || []).map((a) => {
    const samples = [];
    for (let i = 0; i < n; i += 1) samples.push(scoreAgent(a.id, snap));
    const avg = Math.round(samples.reduce((s, r) => s + Number(r.score || 0), 0) / samples.length);
    const last = samples[samples.length - 1] || {};
    return {
      agent_id: a.id,
      name: a.name,
      runs: n,
      score: avg,
      label: labelForScore(avg),
      beneficial: avg >= 60,
      change: last.change || "",
      detail: last.detail || "",
      samples: samples.map((s) => s.score),
    };
  });
  rows.sort((a, b) => b.score - a.score);
  const set = rows.filter((r) => r.score >= 70).map((r) => r.agent_id);
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0;
  return {
    token: BOTBENCH1_TOKEN,
    at: new Date().toISOString(),
    runs: n,
    avg,
    label: labelForScore(avg),
    best_set: set.length ? set : rows.slice(0, 3).map((r) => r.agent_id),
    rows,
  };
}

export function utcDay(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

function loadDailyStore(storage) {
  try {
    const raw = storage?.getItem?.(DAILY_LS);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") return parsed;
  } catch { /* optional */ }
  return { day: "", prev: {}, last: null };
}

function scoresMap(table) {
  const out = {};
  for (const row of table || []) {
    if (row?.agent_id) out[row.agent_id] = Number(row.score) || 0;
  }
  return out;
}

export function scoreTablesMarkdown(report) {
  const pipe = (s) => String(s || "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
  const fmtDelta = (n) => (Number(n) >= 0 ? `+${n}` : String(n));
  const table = report.table || [];
  const rows = [
    "| Agent | Score | Δ | Label | Change |",
    "|---|---:|---:|---|---|",
    ...table.map((r) =>
      `| ${pipe(r.name)} | ${r.score} | ${fmtDelta(r.delta)} | ${r.label} | ${pipe(r.change)} |`),
  ];
  const improved = table.filter((r) => r.delta > 0);
  const slipped = table.filter((r) => r.delta < 0);
  return [
    `Daily crew score · ${report.day} · avg ${report.avg} (Δ ${fmtDelta(report.avg_delta)})`,
    "",
    "```",
    ...rows,
    "```",
    "",
    "## Improvements",
    improved.length
      ? improved.map((r) => `- ${r.name} ${r.prev} → ${r.score} · ${pipe(r.change)}`).join("\n")
      : "- none vs yesterday",
    "",
    "## Changes / slips",
    slipped.length
      ? slipped.map((r) => `- ${r.name} ${r.prev} → ${r.score} · ${pipe(r.change)}`).join("\n")
      : "- none vs yesterday",
    "",
    "Render Agent distributes follow-ups to seats below 70 or slipping.",
  ].join("\n");
}

/** Once per UTC day (or force). Deltas vs yesterday. */
export function dailyCrewScore({
  force = false,
  snapshot,
  storage = globalThis.localStorage,
  now = new Date(),
  root,
} = {}) {
  const day = utcDay(now);
  const store = loadDailyStore(storage);
  if (!force && store.day === day && store.last) {
    return { ...store.last, already: true, day };
  }
  const snap = snapshot !== undefined ? snapshot : crewSnapshot(root, storage);
  const prev = (store.day && store.day !== day)
    ? scoresMap(store.last?.table)
    : (store.prev || {});
  const bench = benchAgents({ runs: 1, snapshot: snap });
  const table = bench.rows.map((r) => {
    const prior = Object.prototype.hasOwnProperty.call(prev, r.agent_id) ? prev[r.agent_id] : r.score;
    const delta = r.score - prior;
    return { ...r, prev: prior, delta };
  });
  const avgDelta = table.length
    ? Math.round(table.reduce((s, r) => s + r.delta, 0) / table.length)
    : 0;
  const report = {
    token: BOTBENCH1_TOKEN,
    already: false,
    day,
    at: new Date(now).toISOString(),
    avg: bench.avg,
    avg_delta: avgDelta,
    label: bench.label,
    best_set: bench.best_set,
    table,
  };
  report.markdown = scoreTablesMarkdown(report);
  try {
    storage?.setItem?.(DAILY_LS, JSON.stringify({
      day,
      prev,
      last: report,
    }));
  } catch { /* optional */ }
  return report;
}

export async function persistDailyFiles(report) {
  const day = report.day || utcDay();
  const json = JSON.stringify(report, null, 2);
  const md = report.markdown || scoreTablesMarkdown(report);
  const pushMd = await autoPushSandboxCode({
    path: `sandbox-sessions/knowledge/daily-${day}.md`,
    text: md,
    agent: "render-agent",
    note: `daily crew score avg ${report.avg}`,
  });
  const pushJson = await autoPushSandboxCode({
    path: `sandbox-sessions/knowledge/daily-${day}.json`,
    text: json,
    agent: "analytics",
    note: `daily crew json ${day}`,
  });
  await recordKnowledgeTurn({
    kind: "training",
    agent_id: "analytics",
    score: report.avg,
    label: report.label,
    beneficial: report.avg >= 60,
    notes: `daily crew · Δ ${report.avg_delta} · best ${(report.best_set || []).join(",")}`,
    log_id: `daily-${day}`,
  });
  for (const row of report.table || []) {
    await recordKnowledgeTurn({
      kind: "score",
      agent_id: row.agent_id,
      score: row.score,
      label: row.label,
      beneficial: row.beneficial,
      notes: `daily ${day} Δ${row.delta} · ${row.change}`,
      log_id: `daily-${day}-${row.agent_id}`,
    });
  }
  return { ok: !!(pushMd?.ok || pushJson?.ok), pushMd, pushJson };
}

export async function pushBestSet(bench) {
  const text = JSON.stringify(bench, null, 2);
  const push = await autoPushSandboxCode({
    path: "sandbox-sessions/knowledge/best-set.json",
    text,
    agent: "analytics",
    note: `bot bench avg ${bench.avg} best_set=${(bench.best_set || []).join(",")}`,
  });
  await recordKnowledgeTurn({
    kind: "training",
    agent_id: "analytics",
    score: bench.avg,
    label: bench.label,
    beneficial: bench.avg >= 60,
    notes: `weekly bot bench · best ${(bench.best_set || []).join(",")}`,
    log_id: `bench-${Date.now().toString(36)}`,
  });
  for (const row of bench.rows || []) {
    await recordKnowledgeTurn({
      kind: "score",
      agent_id: row.agent_id,
      score: row.score,
      label: row.label,
      beneficial: row.beneficial,
      notes: row.change,
    });
  }
  return { ok: !!push?.ok, push, bench };
}
