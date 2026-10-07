/** Deterministic repair loop — diagnose why Sam can't proceed. Token repair1. */

import {
  REPAIR_AGENTS,
  REPAIR_FEATURE_CHECKS,
  REPAIR1_TOKEN,
  OPENARM_VERSION,
  repairTableLayout,
} from "./repair-table.js?v=repair1";

function nowIso() {
  return new Date().toISOString();
}

function id() {
  return (globalThis.crypto?.randomUUID?.() || `r${Date.now()}`).replace(/-/g, "").slice(0, 14);
}

async function mcpRead(path) {
  const res = await fetch(`/mcp/sandbox/file?path=${encodeURIComponent(path)}&t=${Date.now()}`).catch(() => null);
  if (!res || !res.ok) return { ok: false, text: "" };
  const data = await res.json().catch(() => ({}));
  return { ok: true, text: String(data.text || "") };
}

async function mcpWrite(path, obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", agent: "sam", path, text: text.slice(0, 110_000) }),
  }).catch(() => null);
  return !!(res && res.ok);
}

async function notify(text) {
  await fetch("/mcp/group-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "post",
      agent: "sam",
      text: `@cursor-engineer @vibe-rnd @analytics ${text}`.slice(0, 1400),
    }),
  }).catch(() => null);
}

/** Probe environment for OpenArm / sandbox / XR blockers. */
export async function collectRepairObservations(symptom = "") {
  const checks = {};
  const facts = [];

  const bootOk = typeof document !== "undefined" && !!(document.getElementById("prompt-pane-compose") || document.querySelector("[data-sb-ask-astra]"));
  checks["viewport.boot"] = bootOk ? "ok" : "broken";
  facts.push({ id: "obs-boot", kind: "client", feature: "viewport.boot", status: checks["viewport.boot"] });

  let webgl = "unknown";
  try {
    const c = document.createElement("canvas");
    webgl = c.getContext("webgl2") || c.getContext("webgl") ? "ok" : "broken";
  } catch {
    webgl = "broken";
  }
  checks["webgl.context"] = webgl;
  facts.push({ id: "obs-webgl", kind: "client", feature: "webgl.context", status: webgl });

  const { sandboxControlObservation } = await import("./sandbox-xr-enter.js?v=20260923-draw-recordings1&vrrobot=20260927-2");
  const input = sandboxControlObservation();
  const xr = input.session && input.trigger === "ok" ? "ok" : "unknown";
  checks["vr.controllers.trigger"] = xr;
  facts.push({ id: "obs-xr", kind: "client-input", feature: "vr.controllers.trigger", status: xr, evidence: input });

  const sandboxOn = typeof window !== "undefined" && window.Render3DSandbox?.isOpen?.() === true;
  checks["sandbox.map"] = sandboxOn ? "ok" : "unknown";
  facts.push({ id: "obs-sandbox", kind: "client", feature: "sandbox.map", status: checks["sandbox.map"], sandboxOn });

  const probePath = `sandbox-sessions/repair-probe-${id()}.json`;
  const wrote = await mcpWrite(probePath, { kind: "repair_probe", at: nowIso(), token: REPAIR1_TOKEN });
  checks["sandbox.mcp_write"] = wrote ? "ok" : "broken";
  facts.push({ id: "obs-mcp", kind: "server", feature: "sandbox.mcp_write", status: checks["sandbox.mcp_write"] });

  const latest = await mcpRead("openarm-mujoco/runs/latest.json");
  const legacy = latest.ok && latest.text ? null : await mcpRead("openarm-teleop/runs/latest.json");
  const feed = latest.ok && latest.text ? latest : legacy;
  checks["openarm.agent_feed"] = feed.ok && feed.text ? "ok" : "unknown";
  facts.push({ id: "obs-feed", kind: "server", feature: "openarm.agent_feed", status: checks["openarm.agent_feed"] });

  let mujocoFeed = null;
  try {
    mujocoFeed = feed.ok && feed.text ? JSON.parse(feed.text) : null;
  } catch { mujocoFeed = null; }
  if (mujocoFeed?.feature_checks) {
    for (const [k, v] of Object.entries(mujocoFeed.feature_checks)) {
      if (k.startsWith("vr.controllers.")) continue; // Server simulations cannot verify this client's hands.
      checks[k] = v;
      facts.push({ id: `obs-${k}`, kind: "mujoco", feature: k, status: v });
    }
  }

  const rig = await mcpRead("openarm-teleop/rig.schema.json");
  const rigOk = rig.ok && /2\.0|"robot_version"\s*:\s*"2\.0"/.test(rig.text);
  checks["openarm.rig_2_0"] = checks["openarm.rig_2_0"] || (rigOk ? "ok" : rig.ok ? "broken" : "unknown");
  facts.push({ id: "obs-rig", kind: "server", feature: "openarm.rig_2_0", status: checks["openarm.rig_2_0"] });

  const lab = await fetch(`/sandbox/openarm-mujoco/index.html?t=${Date.now()}`).catch(() => null);
  checks["openarm.mujoco_web"] = lab && lab.ok ? "ok" : "broken";
  facts.push({ id: "obs-mujoco", kind: "server", feature: "openarm.mujoco_web", status: checks["openarm.mujoco_web"] });

  const teleopLegacy = await fetch(`/sandbox/openarm-teleop/index.html?t=${Date.now()}`).catch(() => null);
  checks["openarm.teleop_lab"] = (lab && lab.ok) || (teleopLegacy && teleopLegacy.ok) ? "ok" : "broken";
  facts.push({ id: "obs-lab", kind: "server", feature: "openarm.teleop_lab", status: checks["openarm.teleop_lab"] });

  const scenes = await fetch(`/sandbox/openarm-mujoco/v2/scenes.json?t=${Date.now()}`).catch(() => null);
  checks["openarm.mujoco_scenes"] = scenes && scenes.ok ? "ok" : "broken";
  facts.push({ id: "obs-scenes", kind: "server", feature: "openarm.mujoco_scenes", status: checks["openarm.mujoco_scenes"] });

  const trainLatest = await mcpRead("openarm-mujoco/episodes/latest.json");
  checks["openarm.train_episode"] = trainLatest.ok && trainLatest.text ? "ok" : "unknown";
  facts.push({ id: "obs-train-ep", kind: "server", feature: "openarm.train_episode", status: checks["openarm.train_episode"] });

  const trainManifest = await mcpRead("openarm-mujoco/episodes/manifest.json");
  let promote = "unknown";
  if (trainManifest.ok && trainManifest.text) {
    try {
      const m = JSON.parse(trainManifest.text);
      promote = m.promote_gate === "candidate_ready_for_external_retrain_compare" ? "ok" : "unknown";
      checks["openarm.train_gate"] = promote;
      facts.push({
        id: "obs-train-gate",
        kind: "server",
        feature: "openarm.train_gate",
        status: promote,
        action: m.plan?.action || null,
      });
    } catch {
      checks["openarm.train_gate"] = "broken";
    }
  } else {
    checks["openarm.train_gate"] = "unknown";
  }

  checks["viewport.models"] = mujocoFeed?.feature_checks?.["viewport.models"] || "unknown";

  return {
    symptom: String(symptom || "Sam cannot proceed — symptom incomplete").slice(0, 500),
    openArm: OPENARM_VERSION,
    checks,
    facts,
    at: nowIso(),
  };
}

/**
 * Competing hypotheses for "why I can't …".
 * Elimination follows context-research kit: contradict required prediction → eliminate.
 */
export function buildHypotheses(obs) {
  const c = obs.checks || {};
  return [
    {
      hypothesis_id: "mcp-write-blocked",
      claim: "Sandbox MCP write path is failing so agents never see packets",
      predicts: { "sandbox.mcp_write": "broken" },
      status: c["sandbox.mcp_write"] === "broken" ? "supported" : c["sandbox.mcp_write"] === "ok" ? "eliminated" : "untested",
      next_test: "POST /mcp/sandbox action=write probe file as agent=sam",
    },
    {
      hypothesis_id: "teleop-lab-unreachable",
      claim: "OpenArm MuJoCo web lab HTML is not served (SPA swallow or 404)",
      predicts: { "openarm.mujoco_web": "broken" },
      status: c["openarm.mujoco_web"] === "broken" || c["openarm.teleop_lab"] === "broken"
        ? "supported"
        : c["openarm.mujoco_web"] === "ok" || c["openarm.teleop_lab"] === "ok"
          ? "eliminated"
          : "untested",
      next_test: "GET /sandbox/openarm-mujoco/index.html and /v2/scenes.json",
    },
    {
      hypothesis_id: "mujoco-scenes-missing",
      claim: "v2 MJCF scenes failed to load (mesh/XML 404)",
      predicts: { "openarm.mujoco_scenes": "broken" },
      status: c["openarm.mujoco_scenes"] === "broken" ? "supported" : c["openarm.mujoco_scenes"] === "ok" ? "eliminated" : "untested",
      next_test: "GET /sandbox/openarm-mujoco/v2/openarm_bimanual.xml",
    },
    {
      hypothesis_id: "ik-not-converged",
      claim: "MuJoCo pose IK error is high — end effectors not tracking targets",
      predicts: { "openarm.ik_converged": "broken" },
      status: c["openarm.ik_converged"] === "broken" ? "supported" : c["openarm.ik_converged"] === "ok" ? "eliminated" : "untested",
      next_test: "Open MuJoCo lab, wait for settle, re-read openarm-mujoco/runs/latest.json",
    },
    {
      hypothesis_id: "no-demo-packet",
      claim: "No MuJoCo analysis packet yet — agent feed empty",
      predicts: { "openarm.agent_feed": "unknown" },
      status: c["openarm.agent_feed"] === "unknown" ? "supported" : c["openarm.agent_feed"] === "ok" ? "eliminated" : "untested",
      next_test: "Load /sandbox/openarm-mujoco/?embed=1 until analysis bridge writes runs/latest.json",
    },
    {
      hypothesis_id: "rig-not-2-0",
      claim: "Rig contract / joint names are not OpenArm 2.0",
      predicts: { "openarm.rig_2_0": "broken" },
      status: c["openarm.rig_2_0"] === "broken" ? "supported" : c["openarm.rig_2_0"] === "ok" ? "eliminated" : "untested",
      next_test: "Confirm openarm_*_joint1..7 in MuJoCo analysis joints[]",
    },
    {
      hypothesis_id: "train-data-missing",
      claim: "No synced training episode yet — policy cannot improve from empty demos",
      predicts: { "openarm.train_episode": "unknown" },
      status: c["openarm.train_episode"] === "unknown" ? "supported" : c["openarm.train_episode"] === "ok" ? "eliminated" : "untested",
      next_test: "Train demo → mark Success/Fail; read openarm-mujoco/episodes/latest.json",
    },
    {
      hypothesis_id: "holdout-gate-not-ready",
      claim: "Holdout Wilson gate has not cleared promote — do not ship policy to live arm",
      predicts: { "openarm.train_gate": "unknown" },
      status: c["openarm.train_gate"] === "ok" ? "eliminated" : "supported",
      next_test: "Run policy tries + intervene corrections until manifest promote_gate is candidate_ready",
    },
    {
      hypothesis_id: "webgl-or-xr-missing",
      claim: "Browser lacks WebGL so MuJoCo Three renderer can't run",
      predicts: { "webgl.context": "broken" },
      status: c["webgl.context"] === "broken" ? "supported" : "eliminated",
      next_test: "Desktop Chrome/Edge with WebGL2; check console for @mujoco/mujoco WASM errors",
    },
  ];
}

export function adjudicateRepair(hypotheses, checks) {
  const surviving = hypotheses.filter((h) => h.status === "supported" || h.status === "untested");
  const supported = hypotheses.filter((h) => h.status === "supported");
  const mandatoryBroken = REPAIR_FEATURE_CHECKS.filter((f) => checks[f] === "broken");
  let gate = "unverified";
  if (mandatoryBroken.includes("sandbox.mcp_write") || mandatoryBroken.includes("openarm.teleop_lab")) {
    gate = "blocked";
  } else if (supported.length && mandatoryBroken.length === 0) {
    gate = "actionable";
  } else if (!supported.length && !surviving.length && REPAIR_FEATURE_CHECKS.every(f => checks[f] === "ok")) {
    gate = "cleared";
  }
  const primary = supported[0] || surviving.find((h) => h.status === "untested") || null;
  return {
    gate,
    primary,
    mandatory_broken: mandatoryBroken,
    recommendation: primary
      ? `Next: ${primary.next_test}`
      : "No supported blocker. Record an OpenArm 2.0 demo and Send to agent, then re-run Repair.",
  };
}

export function voteRepairRoles(hypotheses, adjudication) {
  return REPAIR_AGENTS.map((role) => {
    let vote = "abstain";
    let evidence = [];
    if (role.id === "intake") vote = adjudication.primary ? "support" : "abstain";
    if (role.id === "investigator") {
      vote = hypotheses.some((h) => h.status === "supported") ? "support" : "abstain";
      evidence = hypotheses.filter((h) => h.status === "supported").map((h) => h.hypothesis_id);
    }
    if (role.id === "skeptic") {
      vote = hypotheses.some((h) => h.status === "eliminated") ? "support" : "abstain";
      evidence = hypotheses.filter((h) => h.status === "eliminated").map((h) => h.hypothesis_id);
    }
    if (role.id === "test-runner") {
      vote = adjudication.gate === "blocked" || adjudication.gate === "actionable" ? "support" : "abstain";
    }
    if (role.id === "adjudicator") {
      vote = adjudication.gate !== "unverified" ? "support" : "reject";
    }
    return { role: role.id, label: role.label, skill: role.skill, vote, weight: role.weight, evidence };
  });
}

export async function runRepairLoop(symptom = "") {
  const runId = id();
  const observations = await collectRepairObservations(symptom);
  const hypotheses = buildHypotheses(observations);
  const adjudication = adjudicateRepair(hypotheses, observations.checks);
  const votes = voteRepairRoles(hypotheses, adjudication);
  const layout = repairTableLayout();
  const report = {
    kind: "repair_loop_report",
    token: REPAIR1_TOKEN,
    run_id: runId,
    open_arm: OPENARM_VERSION,
    symptom: observations.symptom,
    at: nowIso(),
    checks: observations.checks,
    facts: observations.facts,
    hypotheses,
    adjudication,
    votes,
    layout,
    agents: REPAIR_AGENTS,
    note: "Simulation / sandbox diagnosis only. Does not command OpenArm hardware.",
  };
  await mcpWrite(`sandbox-sessions/repair-${runId}.json`, report);
  await mcpWrite("sandbox-sessions/latest-repair.json", report);
  await notify(
    `Repair loop ${runId.slice(0, 8)} · gate=${adjudication.gate} · ${adjudication.recommendation} · OpenArm ${OPENARM_VERSION} · read sandbox-sessions/latest-repair.json`,
  );
  return report;
}

export function paintRepairPanel(host, report) {
  if (!host) return;
  const h = report?.hypotheses || [];
  const c = report?.checks || {};
  host.innerHTML = `
    <header class="sb-repair-head">
      <div>
        <span class="sb-kicker">REPAIR TABLE · ${REPAIR1_TOKEN}</span>
        <h3>Why can't we proceed?</h3>
      </div>
      <button type="button" class="btn secondary btn-compact" data-repair-run>Run loop</button>
    </header>
    <p class="sb-repair-copy">OpenArm <strong>${OPENARM_VERSION}</strong> · gate <strong>${report?.adjudication?.gate || "idle"}</strong> · ${report?.adjudication?.recommendation || "Press Run loop after stating the symptom."}</p>
    <label class="sb-repair-label">Symptom<input id="sb-repair-symptom" type="text" placeholder="e.g. I can't send teleop demos to the agent" value="${String(report?.symptom || "").replace(/"/g, "&quot;")}" /></label>
    <div class="sb-repair-grid">
      <section><h4>Checks</h4><ul>${Object.entries(c).map(([k, v]) => `<li><code>${k}</code> · ${v}</li>`).join("") || "<li>No run yet</li>"}</ul></section>
      <section><h4>Hypotheses</h4><ul>${h.map((x) => `<li><strong>${x.status}</strong> · ${x.hypothesis_id}<br/><span>${x.claim}</span></li>`).join("") || "<li>No run yet</li>"}</ul></section>
      <section><h4>Crew</h4><ul>${(report?.votes || REPAIR_AGENTS.map((a) => ({ role: a.id, label: a.label, vote: "—", skill: a.skill }))).map((v) => `<li>${v.label || v.role} · ${v.vote} · <code>${v.skill || ""}</code></li>`).join("")}</ul></section>
    </div>
  `;
  host.querySelector("[data-repair-run]")?.addEventListener("click", async () => {
    const symptom = host.querySelector("#sb-repair-symptom")?.value || "";
    host.querySelector("[data-repair-run]").disabled = true;
    const next = await runRepairLoop(symptom);
    paintRepairPanel(host, next);
  });
}
