/**
 * Tech wall — one extraction surface. No extra WebGL / DIMOS spawn.
 * Reads live instances + existing feeds. Token techwall1.
 */

import { LAUNCH_POINTS, liveInventory, SBLIVE1_TOKEN } from "./sandbox-live-instances.js?v=sblive1&teleop-y=20260922-poseconnect1&dimos-viser-local1&vrrobot=20260927-2";
import { readFeatureBoard } from "./sandbox-feature-board.js?v=20260923-draw-recordings1";
import { printerBotMonitor } from "./crew-desk-status.js?v=20260923-draw-recordings1";
import { loadElRun, elRunMarkup, bindElRun } from "./electronics-virtual-run.js?v=20260923-draw-recordings1";

export const TECHWALL1_TOKEN = "techwall1";

async function getJson(path) {
  const res = await fetch(`${path}${path.includes("?") ? "&" : "?"}t=${Date.now()}`, { credentials: "same-origin" }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

async function mcpRead(path) {
  const res = await fetch(`/mcp/sandbox/file?path=${encodeURIComponent(path)}&t=${Date.now()}`).catch(() => null);
  if (!res || !res.ok) return { ok: false, text: "" };
  const data = await res.json().catch(() => ({}));
  return { ok: true, text: String(data.text || "") };
}

function preview(text, n = 180) {
  return String(text || "").replace(/\s+/g, " ").slice(0, n);
}

/** Snapshot extraction points for launch / debug. Does not start coordinators. */
export async function collectTechWall() {
  const [health, coord, mujoco, teach, draw, sqlFindings, moves, receiptRaw] = await Promise.all([
    getJson("/api/health"),
    getJson("/api/dimos/coordinator"),
    mcpRead("openarm-mujoco/runs/latest.json"),
    mcpRead("sandbox-sessions/teaching/latest.json"),
    mcpRead("sandbox-sessions/teaching/latest-draw.json"),
    mcpRead("sandbox-sessions/supabase-sql-findings.json"),
    mcpRead("sandbox-sessions/teaching/character-moves.json"),
    mcpRead("sandbox-sessions/receipts/latest.json"),
  ]);
  let receipt = null;
  if (receiptRaw.ok && receiptRaw.text.trim()) {
    try {
      receipt = JSON.parse(receiptRaw.text);
    } catch { receipt = null; }
  }
  const printer = printerBotMonitor({});
  let shopAlert = "";
  try {
    shopAlert = String(globalThis.document?.querySelector?.("[data-fv-shop-out]")?.textContent || "");
  } catch { shopAlert = ""; }
  return {
    token: TECHWALL1_TOKEN,
    live_token: SBLIVE1_TOKEN,
    at: new Date().toISOString(),
    features: readFeatureBoard().flags,
    instances: liveInventory(),
    health: {
      ok: health?.status === "ok" || health?.ok === true,
      status: health?.status || health?.detail || "unreachable",
    },
    webgl: liveInventory().filter((i) => i.spawned && i.id !== "dimos").map((i) => `${i.id}:${i.live ? "live" : "parked"}`).join(" · ") || "none spawned",
    dimos: {
      up: !!(coord?.up || coord?.listening || coord?.running),
      detail: coord?.blueprint || coord?.status || (coord ? "present" : "not polled"),
      port: coord?.port || 8443,
    },
    mujoco_feed: mujoco.ok ? preview(mujoco.text) : "openarm-mujoco/runs/latest.json missing",
    teaching: teach.ok ? preview(teach.text) : "no teaching session",
    latest_draw: draw.ok ? preview(draw.text) : "no latest-draw",
    sql_findings: sqlFindings.ok ? preview(sqlFindings.text) : "no supabase-sql findings yet",
    character_moves: moves.ok ? preview(moves.text) : "no taught character moves yet",
    printer: `${printer.status} · ${printer.line}`,
    electronics: loadElRun().devices.map((d) => `${d.id}:${d.status}`).join(" · "),
    shop_alert: shopAlert || "shop quiet",
    receipt: receipt
      ? `${receipt.receipt_id} · bot=${receipt.bot_verdict} · ${receipt.summary || ""}`.slice(0, 220)
      : "no UPDATE_RECEIPT yet — see Getting-Started/agents/UPDATE-RECEIPT-PLAN.md",
    points: LAUNCH_POINTS,
  };
}

export function techWallMarkup() {
  return `
    <div class="sb-tech-wall" data-sb-tech-wall data-token="${TECHWALL1_TOKEN}">
      <p class="sb-teleop-copy">
        Tech wall — viewport, models, VR trigger, chat, DIMOS, Viser, MuJoCo, teaching records.
        Same instances as the workshop (no second WebGL / no second :8443).
      </p>
      <div data-wall-elrun>${elRunMarkup()}</div>
      <div class="sb-dimos-actions">
        <button type="button" class="sb-agent-btn" data-wall-refresh>Refresh wall</button>
      </div>
      <pre class="sb-file-preview" data-wall-body>Loading extraction points…</pre>
    </div>
  `;
}

export function bindTechWall(root) {
  if (!root) return null;
  const body = root.querySelector("[data-wall-body]");
  const paint = async () => {
    if (body) body.textContent = "Reading health / DIMOS / feeds…";
    const snap = await collectTechWall();
    if (body) {
      body.textContent = [
        `techwall1 · ${snap.at}`,
        `health ${snap.health.ok ? "ok" : "need"} · ${snap.health.status}`,
        `webgl ${snap.webgl}`,
        `dimos ${snap.dimos.up ? "up" : "down"} · ${snap.dimos.detail} · :${snap.dimos.port}`,
        `instances ${snap.instances.map((i) => `${i.id}${i.duplicates > 1 ? " DUPE" : ""}`).join(" · ")}`,
        `shop ${snap.shop_alert}`,
        `mujoco ${snap.mujoco_feed}`,
        `teach ${snap.teaching}`,
        `draw ${snap.latest_draw}`,
        `sql ${snap.sql_findings}`,
        `moves ${snap.character_moves}`,
        `printer ${snap.printer}`,
        `electronics ${snap.electronics}`,
        `receipt ${snap.receipt}`,
        `flags ${JSON.stringify(snap.features)}`,
      ].join("\n");
    }
    return snap;
  };
  bindElRun(root.querySelector("[data-sb-elrun]"));
  root.querySelector("[data-wall-refresh]")?.addEventListener("click", () => { void paint(); });
  void paint();
  return { token: TECHWALL1_TOKEN, refresh: paint };
}

export function mountTechWall(host) {
  if (!host) return null;
  host.innerHTML = techWallMarkup();
  return bindTechWall(host.querySelector("[data-sb-tech-wall]"));
}
