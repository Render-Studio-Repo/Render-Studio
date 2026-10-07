/** Always-on crew knowledge lake: scores + receipts + jobs. Token kb1. */

export const KB1_TOKEN = "kb1";

async function mcpWrite(path, obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", agent: "sam", path, text: text.slice(0, 110_000) }),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false };
  return { ok: true };
}

async function postIngest(body) {
  const res = await fetch("/api/agent-knowledge/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false, status: res?.status || 0 };
  const data = await res.json().catch(() => null);
  const matches = body.kind !== "receipt" || (data?.record?.kind === "receipt"
    && data.record.receipt_id === body.receipt.receipt_id
    && (!body.score?.id || data.record.id === body.score.id));
  return { ...data, ok: data?.ok === true && matches };
}

/** Call after every prompt: score + optional receipt. */
export async function recordKnowledgeTurn({
  score,
  label,
  beneficial,
  notes,
  log_id,
  receipt,
  agent_id = "cursor-engineer",
  kind = "score",
} = {}) {
  const payload = {
    kind,
    agent_id,
    log_id,
    score,
    label,
    beneficial: beneficial ?? (Number(score) >= 60),
    notes,
    receipt_id: receipt?.receipt_id || "",
    at: new Date().toISOString(),
    token: KB1_TOKEN,
  };
  await mcpWrite("sandbox-sessions/knowledge/latest-score.json", payload);
  const apiBody = receipt
    ? { kind: "receipt", receipt, score: { ...payload, id: receipt.revision_id || undefined } }
    : payload;
  const api = await postIngest(apiBody);
  return { ok: api.ok === true, api, payload };
}

export async function knowledgeStatus() {
  const res = await fetch("/api/agent-knowledge/status").catch(() => null);
  if (res && res.ok) return res.json();
  const listed = await fetch("/mcp/sandbox?action=list&t=" + Date.now()).catch(() => null);
  const data = listed && listed.ok ? await listed.json().catch(() => ({})) : {};
  const kb = (data.files || [])
    .map((f) => String(f.path || f))
    .filter((p) => p.includes("sandbox-sessions/knowledge/"));
  const known = ["sandbox-sessions/knowledge/best-set.json", "sandbox-sessions/knowledge/latest-score.json"];
  for (const path of known) {
    if (kb.includes(path)) continue;
    const r = await fetch("/mcp/sandbox/file?path=" + encodeURIComponent(path) + "&t=" + Date.now()).catch(() => null);
    if (r && r.ok) kb.push(path);
  }
  return {
    ok: true,
    fallback: true,
    total: kb.length,
    counts: { local: kb.length },
    need_8tb: true,
    layout: {
      hot: "frontend/sandbox/sandbox-sessions/knowledge",
      agents: kb.slice(0, 12),
    },
    api: "offline",
  };
}
