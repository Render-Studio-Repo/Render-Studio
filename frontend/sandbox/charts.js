/** SVG charts from live GET /mcp/stats + deeper token lookback — Analytics desk. */
import { getJson } from "./bus.js";
import {
  fetchTokenStatus,
  tokenCaption,
  tokenStatusHtml,
  TOKSTAT1_TOKEN,
} from "./token-status.js?v=tokstat1";

function barChart(values) {
  const w = 640;
  const h = 180;
  const pad = 28;
  const max = Math.max(1, ...values.map((v) => v.n));
  const bw = (w - pad * 2) / Math.max(values.length, 1);
  const bars = values.map((v, i) => {
    const bh = ((h - pad * 2) * v.n) / max;
    const x = pad + i * bw + 8;
    const y = h - pad - bh;
    return `<rect x="${x}" y="${y}" width="${Math.max(bw - 16, 8)}" height="${bh}" fill="${v.fill || "#58a6ff"}"/>
      <text x="${x + 4}" y="${h - 8}" fill="#8b949e" font-size="11">${escapeXml(v.label)}</text>
      <text x="${x + 4}" y="${y - 4}" fill="#c9d1d9" font-size="11">${v.n}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Sandbox report chart">${bars}</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function summarizeStats(stats, reports, tokens) {
  if (!stats) return { lines: ["GET /mcp/stats failed. Recycle grok-bot if 404."], bars: [] };
  const ping = stats.reports || {};
  const loop = stats.repair_loop || {};
  const bars = [
    { label: "REPORT n", n: Number(ping.n || 0), fill: "#58a6ff" },
    { label: "avg score", n: Number(ping.avg_score || 0), fill: "#3fb950" },
    { label: "COMM-MISS", n: Number(loop.comm_miss_mentions || 0), fill: "#f85149" },
    { label: "collab files", n: Number(stats.collab_files || 0), fill: "#d2a8ff" },
    { label: "tok Σ", n: Number(tokens?.tokens_total || 0), fill: tokens?.high ? "#f85149" : tokens?.warn ? "#f0883e" : "#79c0ff" },
    { label: "tok peak", n: Number(tokens?.tokens_peak || 0), fill: "#a5d6ff" },
  ];
  const lines = [
    `REPORT n=${ping.n ?? "?"} avg=${ping.avg_score ?? "?"}`,
    `COMM-MISS mentions=${loop.comm_miss_mentions ?? "?"}`,
    `collab_files=${stats.collab_files ?? "?"}`,
    tokenCaption(tokens || {}),
  ];
  if (reports && reports.count != null) lines.push(`board-reports count=${reports.count}`);
  return { lines, bars, tokens };
}

export async function loadReportBundle() {
  const [stats, reports, index, tokens] = await Promise.all([
    getJson("/mcp/stats?t=" + Date.now()),
    getJson("/mcp/reports?t=" + Date.now()),
    getJson("/mcp/collab-index?t=" + Date.now()),
    fetchTokenStatus(60),
  ]);
  return { stats, reports, index, tokens };
}

export const CHART_OWNER = "analytics";
export { TOKSTAT1_TOKEN };

/** CanvasTexture overlay on the Analytics desk (sandbox only). */
export function attachDeskChart(THREE, desk) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 0.52),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.y = 0.72;
  desk.add(overlay);
  async function refresh() {
    const bundle = await loadReportBundle();
    const { bars } = summarizeStats(bundle.stats, bundle.reports, bundle.tokens);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = bundle.tokens?.high ? "#f85149" : "#79c0ff";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("analytics · tokens+stats", 8, 14);
    const max = Math.max(1, ...bars.map((s) => s.n));
    const slot = (w - 16) / bars.length;
    bars.forEach((s, i) => {
      const bh = Math.max(2, (s.n / max) * (h - 48));
      const x = 8 + i * slot + 6;
      const bw = Math.max(10, slot - 16);
      ctx.fillStyle = s.fill || (i === 2 ? "#f85149" : "#3fb950");
      ctx.fillRect(x, h - 18 - bh, bw, bh);
      ctx.fillStyle = "#c9d1d9";
      ctx.fillText(String(s.n), x, h - 20 - bh);
      ctx.fillStyle = "#8b949e";
      ctx.fillText(String(s.label).slice(0, 10), x, h - 6);
    });
    tex.needsUpdate = true;
  }
  refresh();
  setInterval(refresh, 8000);
  return { canvas, texture: tex, refresh };
}

export function mountCharts(host) {
  if (!host || host.dataset.ready === "1") return { paint() {} };
  host.dataset.ready = "1";
  host.className = "sb-charts";
  host.innerHTML = `
    <h3>Analytics desk · live /mcp/stats + token lookback</h3>
    <div id="sb-chart-svg"></div>
    <div id="sb-token-status"></div>
    <p class="muted small" id="sb-chart-cap"></p>
  `;
  const svg = host.querySelector("#sb-chart-svg");
  const tokHost = host.querySelector("#sb-token-status");
  const cap = host.querySelector("#sb-chart-cap");

  async function paint() {
    const bundle = await loadReportBundle();
    const { lines, bars } = summarizeStats(bundle.stats, bundle.reports, bundle.tokens);
    svg.innerHTML = barChart(bars);
    if (tokHost) tokHost.innerHTML = tokenStatusHtml(bundle.tokens || {});
    cap.textContent = lines.join(" · ");
    return { bundle, lines };
  }
  paint();
  setInterval(paint, 8000);
  return { paint };
}
