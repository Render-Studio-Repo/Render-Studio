/**
 * Network of minds — personalities develop from surroundings.
 * Teach one move → taught agent + paired trainee invent better robot training.
 * Token harness2 (keeps harness1 corrections). Quiet unless they need Sam.
 */

import { OFFICE_AGENTS } from "./office-agents.js?v=office2-printer1";
import { postCrewNote } from "./crew-notes-bus.js?v=notesbus1";

export const HARNESS2_TOKEN = "harness2";
export const PERSONALITIES_PATH = "sandbox-sessions/personalities.json";
export const ROUTES_PATH = "sandbox-sessions/harness-routes.json";

export const SKILL_LANES = Object.freeze([
  { id: "shop-pack", label: "Shop pack" },
  { id: "printer", label: "Printer monitor" },
  { id: "wiring", label: "Wiring" },
  { id: "marketing-desk", label: "Marketing desk" },
  { id: "teaching", label: "Teaching / moves" },
  { id: "sql", label: "SQL findings" },
  { id: "electronics", label: "Electronics virtual-run" },
]);

const LS_P = "render3d.sandbox.personalities";
const LS_R = "render3d.sandbox.harnessRoutes";
const LS_S = "render3d.sandbox.seatSkills";

function nowIso() {
  return new Date().toISOString();
}

export function defaultPersonality(agent) {
  return {
    id: agent.id,
    name: agent.name,
    token: HARNESS2_TOKEN,
    interests: [agent.role || "shop"],
    traits: ["quiet", "learns-from-room"],
    pair: agent.id === "astra" ? "vibe-rnd" : "astra",
    developed_at: nowIso(),
  };
}

export function loadPersonalities(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LS_P);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.agents) return parsed;
  } catch { /* seed */ }
  const agents = {};
  for (const a of OFFICE_AGENTS) agents[a.id] = defaultPersonality(a);
  return { token: HARNESS2_TOKEN, at: nowIso(), agents };
}

export function loadRoutes(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LS_R);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed?.routes)) return parsed;
  } catch { /* seed */ }
  return { token: HARNESS2_TOKEN, at: nowIso(), routes: [] };
}

export function loadSeatSkills(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LS_S);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function skillFor(agentId, storage = globalThis.localStorage) {
  return loadSeatSkills(storage)[agentId] || "shop-pack";
}

export function setSeatSkill(agentId, lane, storage = globalThis.localStorage) {
  const next = loadSeatSkills(storage);
  const id = SKILL_LANES.some((s) => s.id === lane) ? lane : "shop-pack";
  next[agentId] = id;
  try { storage?.setItem?.(LS_S, JSON.stringify(next)); } catch { /* optional */ }
  return id;
}

export function absorbSurroundings(personalities, { teaching, sql, printer, electronics, move } = {}) {
  const next = { ...personalities, at: nowIso(), agents: { ...personalities.agents } };
  const crumbs = [
    teaching && "teaching-sessions",
    sql && "sql-findings",
    printer && `printer:${printer}`,
    electronics && "electronics-virtual-run",
    move && `move:${move}`,
  ].filter(Boolean);
  for (const id of Object.keys(next.agents)) {
    const row = { ...next.agents[id] };
    const mix = new Set([...(row.interests || []), ...crumbs]);
    row.interests = [...mix].slice(-8);
    row.developed_at = nowIso();
    next.agents[id] = row;
  }
  return next;
}

export function inventBetterTraining({ move, trainee = "astra", pair = "vibe-rnd" } = {}) {
  const taught = String(move || "approach_desk");
  const a = String(trainee || "astra");
  const b = String(pair || "vibe-rnd");
  return [
    {
      from: a,
      idea: `Replay ${taught} slower with a hold-out check before policy try`,
      quiet: true,
    },
    {
      from: b,
      idea: `Pair ${taught} with a second sample in MuJoCo (same instance) then score mimic`,
      quiet: true,
    },
  ];
}

export function routeForInterest(interest = "") {
  const s = String(interest || "").toLowerCase();
  if (/print/.test(s)) return { go: "printer", lane: "printer" };
  if (/market|shoot|music/.test(s)) return { go: "marketing-desk", lane: "marketing-desk" };
  if (/wir/.test(s)) return { go: "wiring", lane: "wiring" };
  if (/sql|finding/.test(s)) return { go: "sql", lane: "sql" };
  if (/electron/.test(s)) return { go: "electronics", lane: "electronics" };
  if (/teach|move/.test(s)) return { go: "teaching", lane: "teaching" };
  return { go: "viewport", lane: "shop-pack" };
}

export function generateHarnessRoutes(personalities) {
  const routes = Object.values(personalities.agents || {}).map((row) => {
    const interest = row.interests?.[row.interests.length - 1] || row.interests?.[0] || "shop";
    return {
      agent: row.id,
      ...routeForInterest(interest),
      interest,
      at: nowIso(),
    };
  });
  return { token: HARNESS2_TOKEN, at: nowIso(), routes };
}

export function onTeachOne({ move, trainee = "astra", pair = "vibe-rnd", surroundings = {} } = {}, storage = globalThis.localStorage) {
  let personalities = absorbSurroundings(loadPersonalities(storage), { ...surroundings, move });
  const a = personalities.agents[trainee] || defaultPersonality({ id: trainee, name: trainee, role: "trainee" });
  const b = personalities.agents[pair] || defaultPersonality({ id: pair, name: pair, role: "pair" });
  a.pair = pair;
  b.pair = trainee;
  a.interests = [...new Set([...(a.interests || []), `train:${move}`])].slice(-8);
  b.interests = [...new Set([...(b.interests || []), `train:${move}`])].slice(-8);
  personalities.agents[trainee] = a;
  personalities.agents[pair] = b;
  const ideas = inventBetterTraining({ move, trainee, pair });
  const routes = generateHarnessRoutes(personalities);
  try { storage?.setItem?.(LS_P, JSON.stringify(personalities)); } catch { /* optional */ }
  try { storage?.setItem?.(LS_R, JSON.stringify(routes)); } catch { /* optional */ }
  for (const idea of ideas) {
    postCrewNote({ from: idea.from, to: "crew", kind: "train-idea", text: idea.idea, storage });
  }
  return { token: HARNESS2_TOKEN, personalities, routes, ideas, quiet: true };
}

export async function persistHarness(personalities, routes) {
  const write = async (path, obj) => {
    const res = await fetch("/mcp/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "write", agent: "vibe-rnd", path, text: JSON.stringify(obj, null, 2).slice(0, 80_000) }),
    }).catch(() => null);
    return !!(res && res.ok);
  };
  const a = await write(PERSONALITIES_PATH, personalities);
  const b = await write(ROUTES_PATH, routes);
  return { ok: a || b, personalities: PERSONALITIES_PATH, routes: ROUTES_PATH, token: HARNESS2_TOKEN };
}
