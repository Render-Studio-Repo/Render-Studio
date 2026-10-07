/**
 * UPDATE_RECEIPT — Cursor leaves a ship receipt; Harness Mule reads it for guard pack.
 * Persist under sandbox-sessions/receipts/ (MCP jail). Token rcpt1.
 */

export const RCPT1_TOKEN = "rcpt1";
const LATEST = "sandbox-sessions/receipts/latest.json";
const HISTORY = "sandbox-sessions/receipts/";

function id(prefix = "RCPT") {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const slug = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${prefix}-${slug}`;
}

async function mcpWrite(path, obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  if (text.length > 110_000) throw new Error("Receipt exceeds the storage limit; link large evidence files instead.");
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", agent: "sam", path, text }),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false };
  const data = await res.json().catch(() => null);
  return { ...data, ok: data?.ok === true };
}

async function mcpRead(path) {
  const res = await fetch(`/mcp/sandbox/file?path=${encodeURIComponent(path)}&t=${Date.now()}`).catch(() => null);
  if (!res || !res.ok) return { ok: false, text: "" };
  const data = await res.json().catch(() => ({}));
  return { ok: true, text: String(data.text || "") };
}

/** @param {object} partial */
export function buildReceipt(partial = {}) {
  return {
    receipt_id: partial.receipt_id || id(),
    log_id: String(partial.log_id || "").slice(0, 80),
    at: partial.at || new Date().toISOString(),
    author: partial.author || "cursor-engineer",
    scope: partial.scope || "sandbox-only",
    pr: partial.pr || { number: null, url: "", ready: false },
    summary: String(partial.summary || "").slice(0, 400),
    feature_ids: Array.isArray(partial.feature_ids) ? [...new Set(partial.feature_ids.map(String))].slice(0, 80) : [],
    feature_map_version: Number(partial.feature_map_version || 1),
    files_touched: Array.isArray(partial.files_touched) ? partial.files_touched.slice(0, 80) : [],
    feature_board: partial.feature_board || {},
    golden_before: String(partial.golden_before || "").slice(0, 120),
    tests: Array.isArray(partial.tests) ? partial.tests : [],
    locks_ok: {
      "sam-y-engage-v2": null,
      one_webgl_viewport: null,
      dimos_8443_untouched: null,
      mcp_jail_sandbox: null,
      ...(partial.locks_ok || {}),
    },
    promote_map: Array.isArray(partial.promote_map) ? partial.promote_map : [],
    bot_verdict: partial.bot_verdict || "pending",
    bot_verdict_at: partial.bot_verdict_at || null,
    bot_checks: Array.isArray(partial.bot_checks) ? partial.bot_checks : [],
    status: partial.status || "unverified",
    environment: partial.environment || {},
    build: partial.build || {},
    evidence: Array.isArray(partial.evidence) ? partial.evidence : [],
    feature_checks: partial.feature_checks || {},
    golden_after: partial.golden_after || "",
    rollback: partial.rollback || "",
    revision_id: partial.revision_id || `${id("REV")}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`,
    token: RCPT1_TOKEN,
  };
}

export async function writeUpdateReceipt(partial = {}, { publishLatest = true } = {}) {
  const receipt = buildReceipt(partial);
  // MCP write replaces files. Each revision gets its own file, never a fake JSONL append.
  const filename = `${receipt.receipt_id}-${receipt.revision_id}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  const history = await mcpWrite(`${HISTORY}${filename}.json`, receipt);
  if (!history.ok) throw new Error("Receipt history could not be saved. This fix has not been recorded.");
  const { recordKnowledgeTurn } = await import("./agent-knowledge.js?v=kb1&teleop-y=20260922-poseconnect1");
  const knowledge = await recordKnowledgeTurn({
    kind: "receipt", agent_id: receipt.author, log_id: receipt.log_id,
    receipt, notes: receipt.summary, score: partial.score,
    label: partial.label || receipt.bot_verdict, beneficial: partial.beneficial,
  });
  if (!knowledge.ok || !knowledge.api?.ok) throw new Error("Receipt file saved, but its database record failed. Retry recording this revision.");
  if (!publishLatest) return receipt;
  const latest = await mcpWrite(LATEST, receipt);
  if (!latest.ok) throw new Error("Receipt revision saved, but the latest-receipt pointer could not be updated.");
  return receipt;
}

export async function readLatestReceipt() {
  const { ok, text } = await mcpRead(LATEST);
  if (!ok || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Review an exact revision. Return/save its verdict revision without moving the global latest pointer.
 * Callers display the returned revision; history and the lake retain the review.
 * Publishing a global review pointer requires a future server-side compare-and-swap. */
export async function setBotVerdict(verdict, checks = [], expectedReceiptId = "", expectedRevisionId = "") {
  const cur = await readLatestReceipt();
  if (!cur) throw new Error("No receipt to review.");
  if (!expectedReceiptId || cur.receipt_id !== expectedReceiptId || !expectedRevisionId || cur.revision_id !== expectedRevisionId) throw new Error("Receipt changed or target ID missing. Reload and review the intended receipt.");
  return writeUpdateReceipt({ ...cur,
    revision_id: undefined,
    bot_verdict_at: new Date().toISOString(),
    bot_verdict: ["pending", "green", "yellow", "red"].includes(verdict) ? verdict : "pending",
    bot_checks: checks.slice(0, 40),
  }, { publishLatest: false });
}

export function receiptSummaryLine(receipt) {
  if (!receipt) return "no receipt";
  const t = receipt.tests?.[0];
  const testStr = t ? `${t.pass ?? "?"} pass` : "no tests";
  return `${receipt.receipt_id} · ${receipt.bot_verdict} · ${testStr} · ${receipt.summary || ""}`.slice(0, 200);
}
