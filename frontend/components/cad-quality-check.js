/** CAD generation sanity — useful part, constraints, rigging, repair-edit instructions. */

import { analyzeMechanismFit, cadBotMechanismLines } from "../studio/cad-mechanism.js";

export const CADQ1_TOKEN = "cadq1";

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function span(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 6) return null;
  return {
    x: Math.abs(bbox[3] - bbox[0]),
    y: Math.abs(bbox[4] - bbox[1]),
    z: Math.abs(bbox[5] - bbox[2]),
  };
}

function volumeMm3(s) {
  if (!s) return 0;
  return s.x * s.y * s.z;
}

/**
 * @param {object} snap
 * @param {object[]} [snap.bodies] { name, bbox, volume }
 * @param {number} [snap.constraints]
 * @param {object[]} [snap.joints]
 * @param {string} [snap.prompt]
 * @param {string} [snap.kind] cad|mesh|rigging
 */
export function analyzeCadQuality(snap = {}) {
  const prompt = String(snap.prompt || "").toLowerCase();
  const bodies = Array.isArray(snap.bodies) ? snap.bodies : [];
  const constraints = num(snap.constraints, 0);
  const joints = Array.isArray(snap.joints) ? snap.joints : [];
  const kind = String(snap.kind || "cad").toLowerCase();
  const checks = [];
  const edits = [];

  if (!bodies.length) {
    checks.push({ id: "bodies", ok: false, label: "Useful part", detail: "No solid bodies on the viewport." });
    edits.push("Re-run CAD with a closed solid (pad/revolve) — empty scene is not a part.");
  } else {
    let printable = 0;
    for (const body of bodies) {
      const s = span(body.bbox);
      const vol = num(body.volume, volumeMm3(s));
      const minDim = s ? Math.min(s.x, s.y, s.z) : 0;
      if (vol > 50 && minDim >= 0.8) printable += 1;
      if (s && minDim < 0.8 && minDim > 0) {
        checks.push({
          id: "thin",
          ok: false,
          label: "Printable thickness",
          detail: `${body.name || "Body"} min dim ${minDim.toFixed(2)} mm (< 0.8 mm).`,
        });
        edits.push("Thicken walls to ≥ 1.2 mm; fillet knife edges before reprint.");
      }
      if (s) {
        const aspect = Math.max(s.x, s.y, s.z) / Math.max(0.001, Math.min(s.x, s.y, s.z));
        if (aspect > 80) {
          checks.push({
            id: "sliver",
            ok: false,
            label: "Useful part",
            detail: `${body.name || "Body"} is a sliver (aspect ${aspect.toFixed(0)}:1) — likely a failed loft/boolean.`,
          });
          edits.push("Rebuild as stacked primitives (clamp jaw + screw + trough) instead of one skinny loft.");
        }
      }
    }
    if (printable === 0 && bodies.length) {
      checks.push({ id: "useful", ok: false, label: "Useful part", detail: "Bodies exist but none look printable/useful." });
    } else if (printable) {
      checks.push({ id: "useful", ok: true, label: "Useful part", detail: `${printable} body(ies) look printable.` });
    }
    if (/clamp|c-clamp|desk.?clamp|phone.?holder|trough/.test(prompt) && bodies.length < 3) {
      checks.push({
        id: "clamp-parts",
        ok: false,
        label: "Useful part",
        detail: "Clamp-style prompt usually needs jaw + screw + rest as separate constrained solids.",
      });
      edits.push("Split: (1) C-frame with through-hole, (2) screw coaxial to hole, (3) trough/saddle on a pad. Constrain coaxial + mate.");
    }
  }

  const wantsSketch = /hole|mount|align|coaxial|concentric|dimension|mm\b/.test(prompt) || kind === "cad";
  if (wantsSketch && constraints < 1 && bodies.length) {
    checks.push({
      id: "constraints",
      ok: false,
      label: "Constraints",
      detail: "No sketch constraints recorded — holes and screws will drift on repair.",
    });
    edits.push("Add coincident/coaxial on screw vs jaw hole, and one dimension for clamp opening.");
  } else if (constraints >= 1) {
    checks.push({ id: "constraints", ok: true, label: "Constraints", detail: `${constraints} constraint(s).` });
  }

  const wantsMotion = /hinge|joint|rig|rotate|spin|articulated/.test(prompt) || kind === "rigging";
  if (wantsMotion && joints.length < 1) {
    checks.push({
      id: "rigging",
      ok: false,
      label: "Rigging setup",
      detail: "Prompt implies motion but no joints/rig are on the part.",
    });
    edits.push("Add a revolute on the screw axis (or slider along clamp opening) and name the parent jaw.");
  } else if (joints.length) {
    checks.push({ id: "rigging", ok: true, label: "Rigging setup", detail: `${joints.length} joint(s).` });
  } else {
    checks.push({ id: "rigging", ok: true, label: "Rigging setup", detail: "Static part — no rig required." });
  }

  const wantsMech = /hinge|joint|rig|rotate|open|shut|purse|clamp|click|tolerance|lid/.test(prompt) || kind === "rigging";
  let mechanism = null;
  if (wantsMech) {
    mechanism = analyzeMechanismFit(snap);
    for (const row of mechanism.checks || []) checks.push(row);
    for (const edit of mechanism.edits || []) edits.push(edit);
  }

  const failed = checks.filter((c) => c.ok === false);
  const score = Math.max(0, 100 - failed.length * 22);
  const repair_edit = failed.length
    ? `Repair edit (${CADQ1_TOKEN}):\n${edits.map((e, i) => `${i + 1}. ${e}`).join("\n")}`
    : "CAD sanity passed. No repair edit.";
  return {
    token: CADQ1_TOKEN,
    score,
    ok: failed.length === 0,
    checks,
    repair_edit,
    prompt_working: score >= 60,
    mechanism,
    cad_bot_lines: mechanism ? cadBotMechanismLines(mechanism) : [],
  };
}

export function cadQualityWatchdogPacket(result, extra = {}) {
  return {
    kind: "cad_quality_watch",
    to: ["cad-bot", "cursor-engineer", "harness-mule", "instruction-auditor"],
    log_id: extra.log_id || "",
    score: result.score,
    prompt_working: result.prompt_working,
    repair_edit: result.repair_edit,
    checks: result.checks,
    mechanism: result.mechanism || null,
  };
}
