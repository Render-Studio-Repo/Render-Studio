/** Render Agent daily crew ping + distribute. Token dailyscore1. */

import { dailyCrewScore, persistDailyFiles, scoreTablesMarkdown } from "./agent-bench-board.js?v=20260923-draw-recordings1";
import { distributeAstraWork } from "./astra-distribute.js?v=20260923-draw-recordings1";
import { crewSnapshot } from "./agent-score-rubrics.js?v=crewscore1";

export const DAILYSCORE1_TOKEN = "dailyscore1";

export function crewScoreWorkItems(report) {
  const items = [];
  for (const row of report.table || []) {
    if (row.score < 70 || row.delta < 0) {
      const d = row.delta >= 0 ? `+${row.delta}` : String(row.delta);
      items.push(`${row.agent_id}: ${row.change} (score ${row.score} Δ${d})`);
    }
  }
  if (!items.length) {
    items.push("analytics: log today's crew table to the knowledge lake");
  }
  return [...new Set(items)].slice(0, 8);
}

export async function distributeCrewScore(report) {
  const items = crewScoreWorkItems(report);
  return distributeAstraWork({
    question: `Daily crew score ${report.day} avg ${report.avg}`,
    answer: [
      "Distribute these score follow-ups:",
      ...items.map((t) => `- ${t}`),
      "",
      report.markdown || scoreTablesMarkdown(report),
    ].join("\n"),
    proposals: items.map((title) => ({ title })),
    provider: "render-agent",
  });
}

export async function maybePingDailyCrew({
  announce,
  force = false,
  root,
  storage,
  now,
} = {}) {
  const report = dailyCrewScore({
    force,
    snapshot: crewSnapshot(root, storage),
    storage,
    now,
  });
  if (report.already && !force) {
    return { ...report, pinged: false, distributed: null };
  }
  const markdown = report.markdown || scoreTablesMarkdown(report);
  announce?.(markdown, { ping: true, openPanel: false });
  const files = await persistDailyFiles(report);
  const distributed = await distributeCrewScore(report);
  return { ...report, markdown, pinged: true, files, distributed };
}
