/**
 * Astra temporary prompts + work distribution to sandbox agents.
 * Token astradist1.
 */

import { assignTask, TASK_AGENTS } from "./agent-tasks.js?v=20260923-draw-recordings1";
import { autoPushSandboxCode } from "./sandbox-push.js?v=20260923-draw-recordings1";

export const ASTRADIST1_TOKEN = "astradist1";

function workCrew() {
  return TASK_AGENTS
    .map((a) => a.id)
    .filter((id) => id !== "ledger" && id !== "instruction-auditor");
}

/** Pull actionable lines from Astra's answer into task titles. */
export function extractWorkItems(answer = "", question = "") {
  const text = String(answer || "");
  const items = [];
  const bullet = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/gm;
  let m;
  while ((m = bullet.exec(text)) && items.length < 8) {
    const line = String(m[1] || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (line.length < 12) continue;
    if (/^none vs yesterday/i.test(line)) continue;
    if (/^Daily crew score/i.test(line)) continue;
    if (/^Render Agent distributes/i.test(line)) continue;
    items.push(line);
  }
  const assignRe = /(?:assign|task|please)\s+([a-z][\w-]*)[:\s—-]+(.{12,160})/gi;
  while ((m = assignRe.exec(text)) && items.length < 10) {
    items.push(`${m[1]}: ${String(m[2]).trim().slice(0, 140)}`);
  }
  if (!items.length && question) {
    items.push(`Follow up: ${String(question).trim().slice(0, 140)}`);
  }
  if (!items.length && text.trim()) {
    items.push(text.replace(/\s+/g, " ").trim().slice(0, 140));
  }
  return [...new Set(items)].slice(0, 6);
}

export function pickAgent(title, i) {
  const lower = String(title).toLowerCase();
  const crew = workCrew();
  if (/\b(cad-bot|hinge|tolerance|open\/shut|open and shut|clamp click|pin fit)\b/.test(lower)) return "cad-bot";
  if (/\b(cursor|file|ide|code|patch|mcp|app\.js|main\.py)\b/.test(lower)) return "cursor-engineer";
  if (/\b(audit|census)\b/.test(lower)) return "instruction-auditor";
  if (/\b(rnd|openarm|mujoco|vr|quest|dimos)\b/.test(lower)) return "vibe-rnd";
  if (/\b(market|deck|pitch|social|theme|palette)\b/.test(lower)) return "vibe-marketing";
  if (/\b(sales|deal|customer)\b/.test(lower)) return "vibe-sales";
  if (/\b(analytic|stats|gauge|metric|score|lake|bench)\b/.test(lower)) return "analytics";
  if (/\b(printer|bambu|lan print)\b/.test(lower)) return "printer-bot";
  if (/\b(print|cad|mesh|clip|urdf|lid)\b/.test(lower)) return "clip-bot";
  if (/\b(pm|ship|gate|timeline)\b/.test(lower)) return "project-manager";
  if (/\b(ledger|receipt|log_id)\b/.test(lower)) return "ledger";
  if (/\b(comms|speaker|tts)\b/.test(lower)) return "comms";
  if (/\b(astra|host|voice)\b/.test(lower)) return "astra";
  return crew[i % Math.max(crew.length, 1)] || "cursor-engineer";
}

/**
 * Write a temporary prompt file and distribute work items to agents.
 */
export async function distributeAstraWork({
  question = "",
  answer = "",
  proposals = [],
  provider = "astra",
} = {}) {
  const at = new Date().toISOString();
  const stamp = at.replace(/[:.]/g, "-").slice(0, 19);
  const from = provider === "render-agent" ? "render-agent" : "astra-distribute";
  const promptPath = provider === "render-agent"
    ? `live/prompts/render-agent-daily-${stamp}.md`
    : `live/prompts/astra-temp-${stamp}.md`;
  const items = [...new Set([
    ...extractWorkItems(answer, question),
    ...((Array.isArray(proposals) ? proposals : [])
      .map((p) => String(p?.title || p?.text || p?.prompt || "").trim())
      .filter((t) => t.length >= 8)
      .slice(0, 4)),
  ])].slice(0, 8);

  const md = [
    provider === "render-agent" ? `# Render Agent distribute` : `# Astra temporary prompt`,
    ``,
    `- token: \`${ASTRADIST1_TOKEN}\``,
    `- at: ${at}`,
    `- provider: ${provider}`,
    ``,
    `## Sam asked`,
    ``,
    String(question || "(none)").slice(0, 2000),
    ``,
    provider === "render-agent" ? `## Render Agent tables` : `## Astra answer`,
    ``,
    String(answer || "(empty)").slice(0, 6000),
    ``,
    `## Distributed work`,
    ``,
    ...items.map((t, i) => `${i + 1}. ${t}`),
    ``,
    `_Ephemeral — agents read this from sandbox live/prompts/_`,
  ].join("\n");

  const push = await autoPushSandboxCode({
    path: promptPath,
    text: md,
    agent: provider === "render-agent" ? "analytics" : "astra",
    note: provider === "render-agent" ? "Render Agent daily distribute" : "Astra temp prompt + distribute",
  });

  const tasks = items.map((title, i) => {
    const agent = pickAgent(title, i);
    return assignTask(agent, title, { from });
  });

  if (provider === "render-agent") {
    assignTask("analytics", `Daily score live → ${promptPath} (${tasks.length} tasks)`, { from });
  } else {
    assignTask("astra", `Temp prompt live → ${promptPath} (${tasks.length} tasks)`, { from });
  }

  return {
    ok: !!push.ok,
    token: ASTRADIST1_TOKEN,
    promptPath,
    push,
    tasks,
    items,
  };
}
