/**
 * Live token usage status from deeper prompt-trace lookback.
 * Token tokstat1.
 */

export const TOKSTAT1_TOKEN = "tokstat1";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function fetchTokenStatus(limit = 60) {
  const res = await fetch(`/api/sandbox/token-status?limit=${limit}&t=${Date.now()}`).catch(() => null);
  if (!res || !res.ok) {
    return {
      ok: false,
      high: false,
      warn: false,
      tokens_total: 0,
      lookback: 0,
      series: [],
      error: res ? `HTTP ${res.status}` : "network",
    };
  }
  return res.json();
}

export function tokenBars(status = {}) {
  const series = Array.isArray(status.series) ? status.series : [];
  const last = series.slice(-12);
  return last.map((row, i) => ({
    label: String(row.log_id || `#${i + 1}`).slice(-6),
    n: Number(row.tokens || 0),
    fill: row.result === "broke" ? "#f85149" : row.result === "partial" ? "#f0883e" : "#58a6ff",
  }));
}

export function tokenCaption(status = {}) {
  if (!status?.ok && status?.error) return `Token status unavailable · ${status.error}`;
  const level = status.high ? "HIGH" : status.warn ? "WARN" : "OK";
  const parts = [
    `lookback ${status.lookback || 0}`,
    `Σ≈${status.tokens_total || 0}`,
    `peak≈${status.tokens_peak || 0}`,
    level,
  ];
  if (status.by_result) {
    parts.push(Object.entries(status.by_result).map(([k, v]) => `${k}:${v}`).join(" "));
  }
  if (status.high) parts.push(`over ${status.threshold_high} — throttle crew / shorten prompts`);
  else if (status.warn) parts.push(`nearing ${status.threshold_warn}`);
  return parts.join(" · ");
}

export function tokenStatusHtml(status = {}) {
  const level = status.high ? "is-bad" : status.warn ? "is-warn" : "is-ok";
  const bars = tokenBars(status);
  const max = Math.max(1, ...bars.map((b) => b.n), 1);
  const spark = bars.map((b) => {
    const h = Math.max(4, Math.round((b.n / max) * 48));
    return `<span class="sb-tok-bar" title="${esc(b.label)}:${b.n}" style="height:${h}px;background:${b.fill}"></span>`;
  }).join("");
  return `
    <div class="sb-tok-status ${level}" data-sb-tok data-token="${TOKSTAT1_TOKEN}">
      <div class="sb-tok-head">
        <span class="sb-kicker">TOKEN USAGE · ${TOKSTAT1_TOKEN}</span>
        <strong class="${level}">${status.high ? "HIGH" : status.warn ? "WARN" : "OK"}</strong>
        <span class="muted small">deeper lookback · not just last REPORT</span>
      </div>
      <div class="sb-tok-spark" aria-hidden="true">${spark || "<span class='muted small'>no series</span>"}</div>
      <p class="sb-tok-cap">${esc(tokenCaption(status))}</p>
      <ul class="sb-tok-log">${(status.series || []).slice(-8).reverse().map((r) =>
        `<li><code>${esc(r.log_id)}</code> ≈${esc(r.tokens)} · ${esc(r.result)} · ${esc(r.prompt)}</li>`).join("") || "<li class='muted small'>No prompt-trace rows yet</li>"}</ul>
    </div>
  `;
}
