/** Per-seat goldens for the crew bench. CAD bot keeps its own mechanism goldens. Token crewscore1. */

export const CREWSCORE1_TOKEN = "crewscore1";

const SNAP_LS = "render3d.sandbox.crewSnapshot";

function captureCrewSnapshot(root) {
  const d = root && typeof root.querySelector === "function" ? root : null;
  const q = (sel) => !!(d && d.querySelector(sel));
  const sandbox_page = q(".sb-dbg-page, .sb-dbg-chrome, #sb-workspace-shell, [data-sb-enter-workspace]");
  const locks = {
    one_speaker: true,
    quest_lock: true,
    studio_theme: true,
    knowledge_lake: true,
    lan_printer_only: true,
    log_id_stamp: true,
  };
  if (!sandbox_page) return { ...locks };
  return {
    ...locks,
    sandbox_page: true,
    live_ide: q("[data-sb-ide-editor], #sb-live-ide"),
    workspace_enter: q("[data-sb-enter-workspace]"),
    workspace_editor: q("[data-sb-open-editor], #sb-super-ide"),
    hf_rack: q("[data-crew-swap], [data-hf-rack]"),
    bench: q("[data-bench-run]"),
    enter_vr: q("[data-sb-enter-vr]"),
  };
}

function rememberCrewSnapshot(snap, storage) {
  if (!snap?.sandbox_page) return;
  try {
    storage?.setItem?.(SNAP_LS, JSON.stringify({ at: Date.now(), snap }));
  } catch { /* optional */ }
}

function loadRememberedSnapshot(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(SNAP_LS) || "null");
    return parsed?.snap && typeof parsed.snap === "object" ? parsed.snap : null;
  } catch {
    return null;
  }
}

/** Live page facts. Missing keys = unknown, do not punish. Studio reuses last sandbox snapshot. */
export function crewSnapshot(root = globalThis.document, storage = globalThis.localStorage) {
  const live = captureCrewSnapshot(root);
  if (live.sandbox_page) {
    rememberCrewSnapshot(live, storage);
    return live;
  }
  return loadRememberedSnapshot(storage) || live;
}

export const SEAT_CHECKS = Object.freeze({
  "cursor-engineer": [
    { key: "live_ide", expect: true, pts: 40, change: "Keep writes in sandbox Live IDE; auto-push" },
    { key: "workspace_editor", expect: true, pts: 30, change: "Workspace editor (Super IDE) must stay enterable" },
    { key: "sandbox_page", expect: true, pts: 30, change: "Do not grow app.js / main.py; stay in sandbox" },
  ],
  astra: [
    { key: "one_speaker", expect: true, pts: 50, change: "One speaker; stay quiet unless Sam asked" },
    { key: "enter_vr", expect: true, pts: 25, change: "Do not steal Quest XR from OpenArm" },
    { key: "sandbox_page", expect: true, pts: 25, change: "Host notes on the crew bus, not extra TTS" },
  ],
  analytics: [
    { key: "bench", expect: true, pts: 40, change: "Log scores to the knowledge lake daily" },
    { key: "knowledge_lake", expect: true, pts: 40, change: "Push best set + daily tables" },
    { key: "sandbox_page", expect: true, pts: 20, change: "Stamp log_id on jobs" },
  ],
  "instruction-auditor": [
    { key: "sandbox_page", expect: true, pts: 50, change: "Flag app.js / main.py growth" },
    { key: "live_ide", expect: true, pts: 50, change: "Review sandbox writes, not prod dumps" },
  ],
  "vibe-rnd": [
    { key: "quest_lock", expect: true, pts: 50, change: "Do not steal Quest XR from OpenArm (sam-y-engage-v2)" },
    { key: "enter_vr", expect: true, pts: 30, change: "Enter VR mirrors the one viewport" },
    { key: "sandbox_page", expect: true, pts: 20, change: "Teleop labs stay under sandbox" },
  ],
  "clip-bot": [
    { key: "live_ide", expect: true, pts: 40, change: "QC empty URDF vs named lid (rigqc1)" },
    { key: "workspace_editor", expect: true, pts: 30, change: "Projects file viewer must list real meshes" },
    { key: "sandbox_page", expect: true, pts: 30, change: "Do not regen shells to hide a fat pin" },
  ],
  "printer-bot": [
    { key: "lan_printer_only", expect: true, pts: 70, change: "LAN printer probe only" },
    { key: "sandbox_page", expect: true, pts: 30, change: "No cloud print from sandbox" },
  ],
  ledger: [
    { key: "log_id_stamp", expect: true, pts: 50, change: "Stamp log_id on jobs" },
    { key: "knowledge_lake", expect: true, pts: 50, change: "Receipts fan into the lake" },
  ],
  "vibe-marketing": [
    { key: "studio_theme", expect: true, pts: 70, change: "Studio theme tokens, not DB palettes" },
    { key: "sandbox_page", expect: true, pts: 30, change: "Pitch decks stay sandbox examples" },
  ],
  "project-manager": [
    { key: "workspace_enter", expect: true, pts: 50, change: "Keep Enter workspace on the debugger chrome" },
    { key: "bench", expect: true, pts: 50, change: "Daily crew score is the ship gate" },
  ],
  comms: [
    { key: "one_speaker", expect: true, pts: 70, change: "One speaker; notes bus for the rest" },
    { key: "sandbox_page", expect: true, pts: 30, change: "No second team-chat iframe on debugger" },
  ],
  "vibe-sales": [
    { key: "studio_theme", expect: true, pts: 50, change: "Studio theme on customer surfaces" },
    { key: "sandbox_page", expect: true, pts: 50, change: "Add a golden for this seat next" },
  ],
});

export function labelForScore(score) {
  const n = Number(score) || 0;
  if (n >= 85) return "exceeded";
  if (n >= 60) return "achieved";
  if (n >= 25) return "partial";
  return "missed";
}

export function scoreSeatChecks(agentId, snapshot = {}) {
  const checks = SEAT_CHECKS[agentId];
  if (!checks?.length) {
    return { score: 50, label: "partial", change: "Add a golden for this seat", detail: "stub", misses: ["no golden"] };
  }
  let score = 0;
  const misses = [];
  for (const c of checks) {
    const got = snapshot[c.key];
    if (got === undefined) {
      score += c.pts;
      continue;
    }
    if (Boolean(got) === Boolean(c.expect)) score += c.pts;
    else misses.push(c.change);
  }
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    label: labelForScore(score),
    change: misses[0] || checks[0].change,
    detail: misses.join(" | ") || `${checks.length} checks ok`,
    misses,
  };
}
