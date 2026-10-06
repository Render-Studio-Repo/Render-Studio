/** Repair Table — new agent desk for OpenArm 2.0 / sandbox blocker diagnosis. Token repair1. */

export const REPAIR1_TOKEN = "repair1";
export const OPENARM_VERSION = "2.0";

/** Seated repair crew — skills are sandbox-only instruction files. */
export const REPAIR_AGENTS = Object.freeze([
  {
    id: "intake",
    label: "Intake",
    skill: "skills/repair-intake.md",
    ask: "What exactly can Sam not do? Capture symptom, last ok, environment.",
    weight: 1,
  },
  {
    id: "investigator",
    label: "Investigator",
    skill: "skills/repair-investigator.md",
    ask: "Two competing causes with discriminating tests. No single-cause lock-in.",
    weight: 1,
  },
  {
    id: "skeptic",
    label: "Skeptic",
    skill: "skills/repair-skeptic.md",
    ask: "Find contradictions and collateral risk before any patch.",
    weight: 1,
  },
  {
    id: "test-runner",
    label: "Test runner",
    skill: "skills/repair-test-runner.md",
    ask: "Run sandbox checks only. Emit observed results, not prose grades.",
    weight: 2,
  },
  {
    id: "adjudicator",
    label: "Adjudicator",
    skill: "skills/repair-adjudicator.md",
    ask: "Gate before score. Confirm only with before/after + mandatory features.",
    weight: 1,
  },
]);

export const REPAIR_FEATURE_CHECKS = Object.freeze([
  "viewport.boot",
  "viewport.models",
  "vr.controllers.trigger",
  "webgl.context",
  "sandbox.map",
  "sandbox.mcp_write",
  "openarm.teleop_lab",
  "openarm.mujoco_web",
  "openarm.mujoco_scenes",
  "openarm.ik_converged",
  "openarm.agent_feed",
  "openarm.rig_2_0",
  "openarm.train_episode",
  "openarm.train_gate",
]);

export function repairTableLayout({ radius = 0.72, height = 0.78 } = {}) {
  const n = REPAIR_AGENTS.length;
  return {
    token: REPAIR1_TOKEN,
    openArm: OPENARM_VERSION,
    table: { radius, height, shape: "pentagon_repair", seats: n },
    seats: REPAIR_AGENTS.map((agent, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        agent_id: agent.id,
        label: agent.label,
        skill: agent.skill,
        x: Math.cos(a) * (radius + 0.28),
        y: 0.02,
        z: Math.sin(a) * (radius + 0.28),
        yaw: a + Math.PI,
      };
    }),
  };
}

export function makeRepairButton(id) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = id;
  btn.dataset.repairTableToggle = "1";
  btn.setAttribute("aria-pressed", "false");
  btn.textContent = "Repair";
  btn.title = `Repair Table · OpenArm ${OPENARM_VERSION} · diagnose why Sam can't proceed`;
  return btn;
}

export function ensureRepairPromptButton() {
  const trail = document.querySelector("#prompt-pane-compose .prompt-skills-trail");
  if (trail && !document.getElementById("btn-repair-table")) {
    const sandbox = trail.querySelector("#btn-sandbox");
    const btn = makeRepairButton("btn-repair-table");
    if (sandbox?.nextSibling) trail.insertBefore(btn, sandbox.nextSibling);
    else trail.appendChild(btn);
  }
  const row = document.querySelector("#prompt-pane-compose .prompt-generate-row");
  if (row && !document.getElementById("btn-repair-table-gen")) {
    const sandbox = row.querySelector("#btn-sandbox-gen");
    const btn = makeRepairButton("btn-repair-table-gen");
    if (sandbox?.nextSibling) row.insertBefore(btn, sandbox.nextSibling);
    else row.insertBefore(btn, row.firstChild);
  }
  return !!document.getElementById("btn-repair-table");
}

export function setRepairButtonsPressed(on) {
  document.querySelectorAll("#btn-repair-table, #btn-repair-table-gen, [data-repair-table-toggle]").forEach((el) => {
    el.setAttribute("aria-pressed", on ? "true" : "false");
    el.classList.toggle("is-active", !!on);
  });
}

let repairOpen = false;

export function isRepairTableOpen() {
  return repairOpen;
}

export function setRepairTableOpen(on) {
  repairOpen = !!on;
  setRepairButtonsPressed(repairOpen);
  const panel = document.getElementById("sb-repair-panel");
  if (panel) panel.hidden = !repairOpen;
  if (repairOpen) {
    // Repair XOR Sandbox — kill sandbox map while repair is up.
    try {
      if (globalThis.Render3DSandbox?.isOpen?.()) globalThis.Render3DSandbox.close();
    } catch { /* optional */ }
  }
  try {
    window.dispatchEvent(new CustomEvent("render3d-repair-table-toggle", {
      detail: { open: repairOpen, token: REPAIR1_TOKEN, openArm: OPENARM_VERSION },
    }));
  } catch { /* optional */ }
  return { visible: repairOpen, token: REPAIR1_TOKEN, layout: repairTableLayout() };
}

export function toggleRepairTable() {
  return setRepairTableOpen(!repairOpen);
}

export function bindRepairPromptButtons(onToggle) {
  ensureRepairPromptButton();
  document.querySelectorAll("#btn-repair-table, #btn-repair-table-gen, [data-repair-table-toggle]").forEach((btn) => {
    if (!btn || btn.dataset.repair1Bound) return;
    btn.dataset.repair1Bound = "1";
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const next = toggleRepairTable();
      void import("./sandbox-context-log.js?v=ctxlog1").then(({ postContextEvent }) =>
        postContextEvent({
          source: "studio-vr",
          feature_id: "sandbox.ui.click",
          event_kind: next?.visible ? "repair_on" : "repair_off",
          target_id: btn.id || "btn-repair-table",
          context: {
            href: String(location.pathname || "").slice(0, 80),
            xr: document.body.classList.contains("xr-presenting") ? "1" : "0",
          },
        }),
      );
      if (typeof onToggle === "function") await onToggle(next);
    });
  });
}
