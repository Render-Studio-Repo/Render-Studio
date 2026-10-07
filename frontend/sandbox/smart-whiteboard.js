/**
 * Legacy 2D motion sketch (not the shop primary). Token smartwb1.
 * Collab IDE at the top owns the viewport. 2D canvas only.
 */

import { assignTask, listTasks } from "./agent-tasks.js?v=20260923-draw-recordings1";
import { crewSeatInventory, drawSeatAvatar, inspectDesk } from "./crew-desk-status.js?v=20260923-draw-recordings1";

export const SMARTWB1_TOKEN = "smartwb1";

/** Desk roster colors (no Three import — Node-safe). */
export const WB_CREW = Object.freeze([
  { id: "cursor-engineer", label: "Cursor", color: 0x58a6ff },
  { id: "project-manager", label: "PM", color: 0x8b7355 },
  { id: "vibe-rnd", label: "RnD", color: 0x3fb950 },
  { id: "instruction-auditor", label: "Auditor", color: 0x8b949e },
  { id: "analytics", label: "Analytics", color: 0x79c0ff },
  { id: "vibe-marketing", label: "Marketing", color: 0xf0883e },
  { id: "comms", label: "Comms", color: 0xd2a8ff },
  { id: "vibe-sales", label: "Sales", color: 0xe3b341 },
  { id: "clip-bot", label: "Clip-bot", color: 0xbc8cff },
  { id: "astra", label: "Astra", color: 0x57d9b5 },
  { id: "ledger", label: "Ledger", color: 0xa3c1b5 },
  { id: "printer-bot", label: "Print-bot", color: 0xc4785b },
]);

const MOVES = [
  { id: "approach_desk", label: "Approach" },
  { id: "circle_table", label: "Orbit" },
  { id: "speak_pose", label: "Speak" },
  { id: "return_home", label: "Home" },
  { id: "whiteboard_pin", label: "Pin" },
];

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function hexColor(n) {
  return "#" + (n >>> 0).toString(16).padStart(6, "0");
}

export function defaultMotionPlan(crew = WB_CREW) {
  return (crew || []).map((c, i) => ({
    id: c.id,
    label: c.label,
    move: MOVES[i % MOVES.length].id,
    path: ["home", MOVES[i % MOVES.length].id, "speak_pose", "home"],
    agent_scope: c.id === "vibe-rnd" ? "timing/ease" : c.id === "cursor-engineer" ? "file loop hook · any workshop" : c.id === "analytics" ? "usage count" : "voice while move",
  }));
}

export async function persistMotionPlan(plan) {
  const text = JSON.stringify({
    kind: "character_motion_plan",
    token: SMARTWB1_TOKEN,
    at: new Date().toISOString(),
    plan,
  }, null, 2);
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "write",
      agent: "rnd",
      path: "examples/character-motion-plan.json",
      text,
    }),
  }).catch(() => null);
  return !!(res && res.ok);
}

export function mountSmartWhiteboard(host, { speak } = {}) {
  if (!host || host.dataset.ready === "1") return null;
  host.dataset.ready = "1";
  host.dataset.token = SMARTWB1_TOKEN;
  host.classList.add("sb-smart-wb");

  let plan = defaultMotionPlan();
  let selected = plan[0]?.id || "cursor";

  host.innerHTML = `
    <div class="sb-smart-wb-bar">
      <span class="sb-kicker">LEGACY SKETCH · ${SMARTWB1_TOKEN} · any workshop</span>
      <button type="button" class="btn secondary btn-compact" data-wb-scope>Agents scope moves</button>
      <button type="button" class="btn accent btn-compact" data-wb-save>Save plan → MCP</button>
      <button type="button" class="btn secondary btn-compact" data-wb-open-ide title="Open File IDE motion loop">Open in File IDE</button>
      <span class="muted small" data-wb-status role="status">Draw + pick a character</span>
    </div>
    <div class="sb-smart-wb-layout">
      <canvas id="sb-wb-canvas" width="720" height="360" aria-label="Smart whiteboard"></canvas>
      <aside class="sb-smart-wb-side" data-wb-side></aside>
    </div>
  `;

  const canvas = host.querySelector("#sb-wb-canvas");
  const ctx = canvas.getContext("2d");
  const side = host.querySelector("[data-wb-side]");
  const status = host.querySelector("[data-wb-status]");
  const setStatus = (m) => { if (status) status.textContent = m; };

  const tokens = plan.map((p, i) => {
    const crew = WB_CREW.find((c) => c.id === p.id) || { color: 0x58a6ff, label: p.label };
    const ang = (i / Math.max(plan.length, 1)) * Math.PI * 2;
    return {
      ...p,
      color: hexColor(crew.color || 0x58a6ff),
      x: 360 + Math.cos(ang) * 120,
      y: 180 + Math.sin(ang) * 90,
      r: 18,
    };
  });

  let drawing = false;
  let ink = "#58a6ff";

  const paintSide = () => {
    side.innerHTML = `
      <p class="sb-kicker">CHARACTER MOVES</p>
      ${tokens.map((t) => `
        <button type="button" class="sb-wb-char ${t.id === selected ? "is-on" : ""}" data-wb-char="${esc(t.id)}">
          <span class="sb-seat-avatar" style="--av:${esc(t.color)}">${esc(String(t.label || t.id).slice(0, 1))}</span>
          <b>${esc(t.label || t.id)}</b>
          <small>${esc(t.move)}</small>
        </button>
      `).join("")}
      <label class="sb-wb-move">
        <span>Move for selected</span>
        <select data-wb-move>
          ${MOVES.map((m) => `<option value="${m.id}" ${tokens.find((t) => t.id === selected)?.move === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
        </select>
      </label>
      <p class="muted small" data-wb-scope-line>${esc(tokens.find((t) => t.id === selected)?.agent_scope || "")}</p>
    `;
    side.querySelectorAll("[data-wb-char]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selected = btn.getAttribute("data-wb-char");
        paintSide();
        draw();
      });
    });
    side.querySelector("[data-wb-move]")?.addEventListener("change", (ev) => {
      const tok = tokens.find((t) => t.id === selected);
      if (tok) {
        tok.move = ev.target.value;
        tok.path = ["home", tok.move, "speak_pose", "home"];
        plan = tokens.map(({ id, label, move, path, agent_scope }) => ({ id, label, move, path, agent_scope }));
      }
      paintSide();
      draw();
    });
  };

  function draw() {
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // table ring
    ctx.strokeStyle = "#30363d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(360, 180, 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#8b949e";
    ctx.font = "11px system-ui,sans-serif";
    ctx.fillText("table", 345, 184);
    const seats = crewSeatInventory();
    tokens.forEach((t) => {
      const seat = seats.find((s) => s.id === t.id || s.name === t.label) || { id: t.id, name: t.label, avatar: { glyph: String(t.label || "?").slice(0, 1), hair: t.color, skin: "#e8c4a8", eyes: "#111", accent: t.color } };
      drawSeatAvatar(ctx, seat, t.x, t.y, t.r);
      if (t.id === selected) {
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      const desk = inspectDesk(seat.id, { tasks: listTasks() });
      ctx.fillStyle = "#e6edf3";
      ctx.font = "10px system-ui,sans-serif";
      ctx.fillText(String(t.label || t.id).slice(0, 10), t.x - 16, t.y + 28);
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(`${desk.status} · ${t.move}`, t.x - 22, t.y + 40);
    });
  }

  const pos = (ev) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (canvas.width / r.width),
      y: (ev.clientY - r.top) * (canvas.height / r.height),
    };
  };

  canvas.addEventListener("pointerdown", (ev) => {
    const p = pos(ev);
    const hit = tokens.find((t) => Math.hypot(t.x - p.x, t.y - p.y) <= t.r + 4);
    if (hit) {
      selected = hit.id;
      paintSide();
      draw();
      setStatus(`${hit.label}: ${hit.move}`);
      return;
    }
    drawing = true;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!drawing) return;
    const p = pos(ev);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    try {
      window.dispatchEvent(new CustomEvent("render3d-sandbox-draw", {
        detail: { x: p.x, y: p.y, source: "smart-whiteboard", token: SMARTWB1_TOKEN },
      }));
    } catch { /* optional */ }
  });
  window.addEventListener("pointerup", () => { drawing = false; });

  host.querySelector("[data-wb-scope]")?.addEventListener("click", async () => {
    const asks = [
      { id: "cursor-engineer", title: "Hook character moves to examples/character-motion-loop.js" },
      { id: "vibe-rnd", title: "Scope timing/ease for circle_table + approach_desk" },
      { id: "analytics", title: "Count whiteboard move usage after plan save" },
      { id: "astra", title: "Decide who speaks during speak_pose (1 male voice ok)" },
    ];
    asks.forEach((a) => assignTask(a.id, a.title, { from: "smart-whiteboard" }));
    setStatus(`Scoped ${asks.length} agent tasks`);
    if (typeof speak === "function") {
      // Text status only — no announce TTS.
    }
  });

  host.querySelector("[data-wb-save]")?.addEventListener("click", async () => {
    plan = tokens.map(({ id, label, move, path, agent_scope }) => ({ id, label, move, path, agent_scope }));
    const ok = await persistMotionPlan(plan);
    setStatus(ok ? "Saved examples/character-motion-plan.json" : "Save failed — is MCP listening?");
  });

  host.querySelector("[data-wb-open-ide]")?.addEventListener("click", () => {
    try {
      window.dispatchEvent(new CustomEvent("render3d-sandbox-fileide", { detail: { on: true, want: "examples/character-motion-loop.js" } }));
    } catch { /* optional */ }
    document.querySelector("[data-fv-sandbox]")?.click?.();
    document.querySelector('[data-sb-tab="se"][data-tab="projects"]')?.click?.();
    document.getElementById("sb-ide")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    setStatus("Sandbox File IDE (toggle) → character-motion-loop.js");
  });

  window.addEventListener("render3d-sandbox-whiteboard-scope", () => {
    setStatus("Motion scope file ready — Agents scope moves");
  });

  paintSide();
  draw();
  return { token: SMARTWB1_TOKEN, plan: () => plan };
}
