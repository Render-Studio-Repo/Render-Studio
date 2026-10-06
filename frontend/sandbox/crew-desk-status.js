/**
 * Shop seats: one avatar each, Marketing desk you can walk up to,
 * other seats show status. Print-bot monitors the printer.
 * Token crewdesk1. No extra WebGL / talk bar.
 */

import { OFFICE_AGENTS, agentById } from "./office-agents.js?v=office2-printer1";
import { CREW_SHOP_PACK, listTasks } from "./agent-tasks.js?v=20260923-draw-recordings1";
import { shopPrintFindings, shopStatusLine } from "./sandbox-shop-task.js?v=shoptask1&singlevoice1";

export const CREWDESK1_TOKEN = "crewdesk1";
export const SEAT_STATUSES = Object.freeze(["idle", "working", "blocked", "waiting-on-Sam"]);

/** Distinct face sprites — never a color blob alone. */
export const SEAT_AVATARS = Object.freeze({
  astra: { glyph: "A", hair: "#57d9b5", skin: "#f3d2b3", eyes: "#16332c", accent: "#7fe0c3" },
  "cursor-engineer": { glyph: "C", hair: "#1f3a5c", skin: "#e8c4a8", eyes: "#0b1b2b", accent: "#78b7eb" },
  "project-manager": { glyph: "P", hair: "#5c4320", skin: "#d7b48c", eyes: "#2a2114", accent: "#e7c76d" },
  "vibe-rnd": { glyph: "R", hair: "#2f5a28", skin: "#c9a27a", eyes: "#142214", accent: "#94c681" },
  "instruction-auditor": { glyph: "U", hair: "#6b7280", skin: "#ead7c0", eyes: "#1f2933", accent: "#b6c2cb" },
  analytics: { glyph: "N", hair: "#1d4e63", skin: "#f0d0b0", eyes: "#0c2830", accent: "#69c5cb" },
  "vibe-marketing": { glyph: "M", hair: "#7a3040", skin: "#e2b89a", eyes: "#2a1016", accent: "#ec9ca6" },
  comms: { glyph: "O", hair: "#4a3a6b", skin: "#f2c9a8", eyes: "#1b1430", accent: "#beb0dd" },
  "vibe-sales": { glyph: "S", hair: "#6b5420", skin: "#d8b48c", eyes: "#2a220c", accent: "#d4b97b" },
  "cad-bot": { glyph: "D", hair: "#245c32", skin: "#e8c4a8", eyes: "#102010", accent: "#7ee787" },
  "clip-bot": { glyph: "L", hair: "#3a5160", skin: "#cfd8dc", eyes: "#102027", accent: "#94b1c7" },
  ledger: { glyph: "G", hair: "#35584c", skin: "#e6d2b8", eyes: "#14241e", accent: "#a3c1b5" },
  "printer-bot": { glyph: "3", hair: "#6a3a28", skin: "#d9c4b0", eyes: "#2a140e", accent: "#c4785b" },
});

export const KEEP_SHOP_REFS = Object.freeze([
  { name: "Mechanical parts list.json", kind: "json" },
  { name: "electronics_build_sourcing.md", kind: "md" },
  { name: "electronics_build_sourcing_2.md", kind: "md" },
  { name: "parts_list.md", kind: "md" },
  { name: "90576A119.glb", kind: "glb" },
]);

function hex(n) {
  return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
}

export function crewSeatInventory(agents = OFFICE_AGENTS) {
  return (agents || []).map((a) => {
    const av = SEAT_AVATARS[a.id] || {
      glyph: String(a.name || a.id || "?").slice(0, 1).toUpperCase(),
      hair: hex(a.color || 0x8b949e),
      skin: "#e8c4a8",
      eyes: "#111827",
      accent: hex(a.color || 0x8b949e),
    };
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      color: a.color,
      desk: a.id === "vibe-marketing" ? "walk-up" : a.id === "printer-bot" ? "printer" : "status",
      avatar: { ...av, token: CREWDESK1_TOKEN },
    };
  });
}

export function seatHasAvatar(id, seats = crewSeatInventory()) {
  const row = seats.find((s) => s.id === id);
  return !!(row?.avatar?.glyph);
}

export function deriveSeatStatus(agentId, tasks = []) {
  const mine = (tasks || []).filter((t) => t.agent_id === agentId && t.status !== "done");
  const title = String(mine[0]?.title || "").toLowerCase();
  if (!mine.length) return { status: "idle", line: "No open task" };
  if (/jam|blocked|fail|error|cannot/i.test(title)) return { status: "blocked", line: mine[0].title };
  if (/waiting on sam|need sam|ask sam/i.test(title)) return { status: "waiting-on-Sam", line: mine[0].title };
  return { status: "working", line: mine[0].title };
}

export function marketingDeskWork({ tasks = [], files = [], findings = [] } = {}) {
  const pack = CREW_SHOP_PACK.find((r) => r.agent_id === "vibe-marketing") || {};
  const mine = (tasks || []).filter((t) => t.agent_id === "vibe-marketing");
  const open = mine.filter((t) => t.status !== "done");
  const shoot = files.filter((f) => /\.(mp4|mov|webm|png|jpg|gif)$/i.test(String(f.name || f)));
  const music = files.filter((f) => /\.(mp3|wav|aac|m4a)$/i.test(String(f.name || f)));
  const { status, line } = deriveSeatStatus("vibe-marketing", tasks);
  return {
    token: CREWDESK1_TOKEN,
    desk: "marketing",
    walk_up: true,
    shop_pack: pack.title || "Shoot project files + pick music for video production",
    shoot_files: shoot.length ? shoot.map((f) => f.name || f) : ["(no shoot files on bench yet)"],
    music: music.length ? music.map((f) => f.name || f) : ["(music pick pending)"],
    findings: (findings || []).slice(0, 6),
    status,
    line: open[0]?.title || line,
    copy: "Walk up to Marketing's desk in any workshop — see shoot, music, shop-pack, findings.",
  };
}

export function printerBotMonitor({ probe = {}, shopFiles = [] } = {}) {
  const print = shopPrintFindings(shopFiles, { limit: 3 });
  const jammed = /jam|offline|unreachable|fail/i.test(String(probe.message || probe.status || ""));
  const status = jammed ? "waiting-on-Sam" : print.alerts.length ? "blocked" : probe.host ? "working" : "idle";
  return {
    token: CREWDESK1_TOKEN,
    agent_id: "printer-bot",
    name: "Print-bot",
    status,
    line: jammed
      ? "Printer jammed / unreachable — waiting on Sam"
      : shopStatusLine(print),
    job: probe.job || probe.name || "no active job",
    host: probe.host || probe.lan_ip || "",
    errors: jammed ? [probe.message || "probe failed"] : print.alerts.map((a) => a.text),
    quiet: status === "idle" || status === "working",
  };
}

export function inspectDesk(agentId, extra = {}) {
  const agent = agentById(agentId) || { id: agentId, name: String(agentId) };
  const tasks = extra.tasks || (typeof listTasks === "function" ? listTasks(agent.id) : []);
  if (agent.id === "vibe-marketing") {
    return marketingDeskWork({ tasks, files: extra.files || [], findings: extra.findings || [] });
  }
  if (agent.id === "printer-bot") {
    return printerBotMonitor({ probe: extra.probe || {}, shopFiles: extra.files || [] });
  }
  const { status, line } = deriveSeatStatus(agent.id, tasks);
  return {
    token: CREWDESK1_TOKEN,
    desk: agent.id,
    name: agent.name,
    walk_up: false,
    status,
    line,
    copy: "Inspect / approach — status only, no second talk bar.",
  };
}

/** 2D face (canvas). Callers must use getContext("2d") only. */
export function drawSeatAvatar(ctx, seat, x, y, r = 16) {
  if (!ctx) return;
  const av = seat?.avatar || SEAT_AVATARS[seat?.id] || { hair: "#64748b", skin: "#e8c4a8", eyes: "#111", accent: "#94a3b8", glyph: "?" };
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = av.accent;
  ctx.arc(x, y + r * 0.55, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = av.skin;
  ctx.arc(x, y - r * 0.15, r * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = av.hair;
  ctx.ellipse(x, y - r * 0.55, r * 0.7, r * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = av.eyes;
  ctx.fillRect(x - r * 0.28, y - r * 0.22, r * 0.16, r * 0.16);
  ctx.fillRect(x + r * 0.12, y - r * 0.22, r * 0.16, r * 0.16);
  ctx.fillStyle = "#0b1220";
  ctx.font = `${Math.max(8, Math.round(r * 0.7))}px system-ui,sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(av.glyph, x, y + r * 1.45);
  ctx.restore();
}

export function avatarChipHtml(seat) {
  const av = seat.avatar || SEAT_AVATARS[seat.id] || { glyph: "?", accent: "#64748b", skin: "#e8c4a8" };
  const label = String(seat.name || seat.id || "");
  return `<span class="sb-seat-avatar" data-seat="${label}" title="${label}" style="--av:${av.accent};--sk:${av.skin}">${av.glyph}</span>`;
}
