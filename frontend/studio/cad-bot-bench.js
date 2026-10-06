/** CAD-bot benchmark + training rows (`cadbot1`). Judge only — not clip-bot, not Astra regen. */

import { analyzeMechanismFit, CAD_MECH_TOKEN } from "./cad-mechanism.js";

export const CAD_BOT_ID = "cad-bot";
export const CAD_BOT_BENCH_TOKEN = "cadbot1";

/** Golden cases the CAD bot is scored against. */
export const CAD_BOT_GOLDEN = [
  {
    id: "purse-0009c214",
    prompt: "will the purse open and shut, will the clamps click, enough tolerance",
    snap: {
      kind: "rigging",
      bodies: [
        { name: "shell_base", size_mm: [229.62, 192, 46] },
        { name: "shell_lid", size_mm: [229.62, 188.15, 43] },
        { name: "retained_pin", size_mm: [55.4, 8.6, 8.6] },
        { name: "90576A119", size_mm: [19, 21.94, 12] },
      ],
      joints: [{ type: "revolute", child: "shell_lid", lower: 0, upper: 1.91986 }],
      spec: { pin_diameter_mm: 4, pin_clearance_mm: 0.2, snap_clearance_mm: 0.28 },
      files: ["part_02_shell_lid.glb"],
      urdfText: `<link name="shell_lid"></link>`,
    },
    expect: {
      will_open: true,
      will_shut: true,
      pin_fits: false,
      leftover_clamp: true,
      change: "Scale retained_pin to Ø4 mm. Do not regen shells. Stop after 2 identical pin fails.",
    },
  },
  {
    id: "fused-shell-no-lid",
    prompt: "open the purse",
    snap: {
      kind: "rigging",
      bodies: [{ name: "Shell_Clutch_Purse_Matching_Both", size_mm: [230, 192, 75] }],
      joints: [],
      files: ["Shell_Clutch_Purse_Matching_Both.glb"],
    },
    expect: {
      will_open: false,
      will_shut: false,
      pin_fits: null,
      leftover_clamp: false,
      change: "Keep shell_lid as its own solid and bind Play to it.",
    },
  },
  {
    id: "pin-on-spec",
    prompt: "pin tolerance",
    snap: {
      kind: "rigging",
      bodies: [
        { name: "shell_lid", size_mm: [220, 180, 40] },
        { name: "retained_pin", size_mm: [55, 4, 4] },
      ],
      joints: [{ type: "revolute", child: "shell_lid", lower: 0, upper: 1.92 }],
      spec: { pin_diameter_mm: 4, pin_clearance_mm: 0.2 },
    },
    expect: {
      will_open: true,
      will_shut: true,
      pin_fits: true,
      leftover_clamp: false,
      change: "",
    },
  },
];

export function labelForScore(score) {
  const n = Number(score) || 0;
  if (n >= 85) return "exceeded";
  if (n >= 60) return "achieved";
  if (n >= 25) return "partial";
  return "missed";
}

/**
 * Score one CAD-bot turn vs golden expect (or completeness if no expect).
 * loopRepeats: identical FAIL ticks (2+ costs points — he should stop).
 */
export function scoreCadBotTurn(mech = {}, { expected = null, loopRepeats = 0 } = {}) {
  let score = 0;
  const notes = [];
  if (expected) {
    if (Boolean(mech.will_open) === Boolean(expected.will_open)) score += 30;
    else notes.push("open mismatch");
    if (Boolean(mech.will_shut) === Boolean(expected.will_shut)) score += 20;
    else notes.push("shut mismatch");
    if (mech.pin_fits === expected.pin_fits) score += 30;
    else notes.push("tolerance mismatch");
    const leftover = /McMaster|leftover|not the clasp|not the latch/i.test(String(mech.summary || ""));
    if (expected.leftover_clamp === true) {
      if (leftover) score += 10;
      else notes.push("clamp leftover miss");
    } else {
      score += 10;
    }
    if (expected.change) {
      const hay = `${(mech.edits || []).join(" ")} ${mech.summary || ""}`.toLowerCase();
      const pinScale = /scale|ø4|o4|4 mm/.test(hay) && /pin/.test(hay);
      if (pinScale || hay.includes("lid")) score += 10;
      else notes.push("missing repair edit");
    } else {
      score += 10;
    }
  } else {
    if (mech.will_open != null && mech.will_shut != null) score += 40;
    if (mech.snap_click_spec != null || /CLICK/i.test(mech.summary || "")) score += 20;
    if (mech.pin_fits != null || /TOLERANCE/i.test(mech.summary || "")) score += 30;
    if ((mech.edits || []).length) score += 10;
  }
  if (loopRepeats >= 2) {
    score = Math.max(0, score - 15);
    notes.push("looped after 2 identical fails");
  }
  score = Math.max(0, Math.min(100, score));
  const change = expected?.change
    || (loopRepeats >= 2 ? "Stop the CAD loop; hop cursor-engineer with the smallest edit." : "")
    || (mech.edits || [])[0]
    || "";
  return {
    token: CAD_BOT_BENCH_TOKEN,
    agent_id: CAD_BOT_ID,
    score,
    label: labelForScore(score),
    beneficial: score >= 60,
    notes: notes.join("; ") || "ok",
    change,
    summary: mech.summary || "",
  };
}

export function runCadBotBenchmark({ cases = CAD_BOT_GOLDEN, loopRepeatsById = {} } = {}) {
  const rows = cases.map((row) => {
    const mech = analyzeMechanismFit({ prompt: row.prompt, ...row.snap });
    const scored = scoreCadBotTurn(mech, {
      expected: row.expect,
      loopRepeats: Number(loopRepeatsById[row.id] || 0),
    });
    return {
      case_id: row.id,
      mech,
      ...scored,
    };
  });
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0;
  return {
    token: CAD_BOT_BENCH_TOKEN,
    agent_id: CAD_BOT_ID,
    n: rows.length,
    avg,
    label: labelForScore(avg),
    beneficial: avg >= 60,
    rows,
    change: rows.filter((r) => r.change).map((r) => `${r.case_id}: ${r.change}`).join(" | "),
  };
}

export function cadBotTrainingPayload(bench, extra = {}) {
  return {
    kind: "training",
    agent_id: CAD_BOT_ID,
    log_id: extra.log_id || "",
    score: bench.avg,
    label: bench.label,
    beneficial: bench.beneficial,
    notes: extra.notes || `CAD bot bench ${CAD_MECH_TOKEN} avg ${bench.avg}`,
    body: {
      change: bench.change,
      rows: (bench.rows || []).map((r) => ({
        case_id: r.case_id,
        score: r.score,
        notes: r.notes,
        change: r.change,
      })),
      token: CAD_BOT_BENCH_TOKEN,
    },
  };
}

export async function ingestCadBotTraining(bench, extra = {}) {
  const payload = cadBotTrainingPayload(bench, extra);
  const res = await fetch("/api/agent-knowledge/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false, payload };
  return { ok: true, payload, ...(await res.json().catch(() => ({}))) };
}
