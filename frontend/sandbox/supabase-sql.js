/**
 * Super IDE / workshop tab: Supabase SQL (token supasql1).
 * Search project docs, run SQL-shaped queries on a sandbox store, persist findings.
 * No service_role keys in the client. No extra WebGL.
 */

export const SUPASQL1_TOKEN = "supasql1";
export const FINDINGS_PATH = "sandbox-sessions/supabase-sql-findings.json";

export const SQL_DOC_PATHS = Object.freeze([
  "PROMOTION.md",
  "examples/character-motion-scope.md",
  "context-research/README.md",
  "examples/openarm-teleop-lab.md",
  "sandbox-sessions/teaching/latest.json",
]);

const LOCAL_KEY = "render3d.sandbox.supabaseSqlFindings";

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function loadLocalFindings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalFindings(rows, storage = globalThis.localStorage) {
  const next = (rows || []).slice(-40);
  try { storage?.setItem?.(LOCAL_KEY, JSON.stringify(next)); } catch { /* optional */ }
  return next;
}

export function parseSafeSql(sql) {
  const q = String(sql || "").trim();
  if (!q) return { ok: false, reason: "empty" };
  if (/service_role|anon_key|apikey|insert\s+into\s+auth|drop\s+|alter\s+|delete\s+from|update\s+/i.test(q)) {
    return { ok: false, reason: "blocked", detail: "Sandbox SQL is read-shaped only — no secrets, no writes to remote." };
  }
  const m = q.match(/^select\s+(.+?)\s+from\s+([a-z0-9_]+)(?:\s+where\s+(.+))?$/i);
  if (!m) return { ok: false, reason: "shape", detail: "Use SELECT cols FROM findings|docs|crew_status [WHERE q='…']" };
  return {
    ok: true,
    cols: m[1].split(",").map((s) => s.trim()),
    table: m[2].toLowerCase(),
    where: String(m[3] || "").trim(),
  };
}

export function runSafeSql(sql, { findings = [], docs = [], crew = [] } = {}) {
  const parsed = parseSafeSql(sql);
  if (!parsed.ok) return { ok: false, token: SUPASQL1_TOKEN, ...parsed, rows: [] };
  const whereQ = (parsed.where.match(/q\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || "";
  let rows = [];
  if (parsed.table === "findings") rows = findings;
  else if (parsed.table === "docs") {
    rows = docs.filter((d) => !whereQ || `${d.path} ${d.text}`.toLowerCase().includes(whereQ.toLowerCase()));
  } else if (parsed.table === "crew_status") {
    rows = crew.filter((c) => !whereQ || `${c.id} ${c.status} ${c.line}`.toLowerCase().includes(whereQ.toLowerCase()));
  } else {
    return { ok: false, token: SUPASQL1_TOKEN, reason: "unknown_table", rows: [], detail: "Tables: findings, docs, crew_status" };
  }
  return { ok: true, token: SUPASQL1_TOKEN, table: parsed.table, rows: rows.slice(0, 40), stub: true };
}

export function scoreDocHit(text, query) {
  const q = String(query || "").toLowerCase().trim();
  const body = String(text || "").toLowerCase();
  if (!q) return 0;
  return q.split(/\s+/).filter((w) => w.length > 2 && body.includes(w)).length;
}

export async function searchSandboxDocs(query, { fetchImpl = globalThis.fetch } = {}) {
  const hits = [];
  for (const path of SQL_DOC_PATHS) {
    const res = await fetchImpl(`/mcp/sandbox/file?path=${encodeURIComponent(path)}&t=${Date.now()}`).catch(() => null);
    if (!res?.ok) continue;
    const data = await res.json().catch(() => ({}));
    const text = String(data.text || "");
    const score = scoreDocHit(text, query);
    if (score > 0 || !query) {
      hits.push({
        path,
        score,
        excerpt: text.replace(/\s+/g, " ").slice(0, 220),
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return { token: SUPASQL1_TOKEN, query: String(query || ""), hits: hits.slice(0, 12) };
}

async function mcpWrite(path, obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", agent: "analytics", path, text: text.slice(0, 80_000) }),
  }).catch(() => null);
  return !!(res && res.ok);
}

export async function persistFindings(rows, { note = "" } = {}) {
  const payload = {
    kind: "supabase_sql_findings",
    token: SUPASQL1_TOKEN,
    at: new Date().toISOString(),
    note: String(note || "").slice(0, 240),
    findings: (rows || []).slice(-40),
    jail: "frontend/sandbox/",
    no_service_role: true,
  };
  saveLocalFindings(payload.findings);
  const ok = await mcpWrite(FINDINGS_PATH, payload);
  return { ok, path: FINDINGS_PATH, token: SUPASQL1_TOKEN, count: payload.findings.length };
}

export function supabaseSqlMarkup() {
  return `
    <div class="sb-supa-sql" data-sb-supasql data-token="${SUPASQL1_TOKEN}">
      <p class="muted small">Supabase SQL · ${SUPASQL1_TOKEN} · sandbox store only (no service_role). Findings → ${FINDINGS_PATH} for the tech wall.</p>
      <label class="sb-dimos-field">
        <span>Search project docs</span>
        <input type="search" data-sql-q placeholder="whiteboard → any workshop, teaching, lock" />
      </label>
      <div class="sb-dimos-actions">
        <button type="button" class="sb-agent-btn" data-sql-search>Search docs</button>
      </div>
      <label class="sb-dimos-field">
        <span>SQL-shaped query</span>
        <textarea data-sql-text rows="3" spellcheck="false">SELECT * FROM findings</textarea>
      </label>
      <div class="sb-dimos-actions">
        <button type="button" class="sb-agent-btn" data-sql-run>Run query</button>
        <button type="button" class="sb-agent-btn" data-sql-save>Update findings</button>
      </div>
      <pre class="sb-file-preview" data-sql-out>Idle · ${SUPASQL1_TOKEN}</pre>
    </div>
  `;
}

export function bindSupabaseSql(root, { crew = () => [] } = {}) {
  if (!root) return null;
  const out = root.querySelector("[data-sql-out]");
  const setOut = (v) => { if (out) out.textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2); };
  let lastDocs = [];
  let findings = loadLocalFindings();

  root.querySelector("[data-sql-search]")?.addEventListener("click", async () => {
    const q = root.querySelector("[data-sql-q]")?.value || "";
    setOut("Searching sandbox docs…");
    const res = await searchSandboxDocs(q);
    lastDocs = res.hits;
    findings = saveLocalFindings([
      ...findings,
      { id: `hit_${Date.now().toString(16)}`, kind: "doc_search", query: q, hits: res.hits.length, at: new Date().toISOString() },
    ]);
    setOut(res);
  });

  root.querySelector("[data-sql-run]")?.addEventListener("click", () => {
    const sql = root.querySelector("[data-sql-text]")?.value || "";
    const result = runSafeSql(sql, { findings, docs: lastDocs, crew: crew() });
    setOut(result);
  });

  root.querySelector("[data-sql-save]")?.addEventListener("click", async () => {
    const note = root.querySelector("[data-sql-q]")?.value || "crew findings";
    const saved = await persistFindings(findings, { note });
    setOut(saved.ok ? `Saved ${saved.count} findings → ${saved.path}` : `Local only · ${saved.path} (MCP gated or offline)`);
  });

  return { token: SUPASQL1_TOKEN, findings: () => findings };
}

export function mountSupabaseSql(host, opts) {
  if (!host) return null;
  if (host.dataset.ready === "1") return host._sqlApi || null;
  host.dataset.ready = "1";
  host.dataset.token = SUPASQL1_TOKEN;
  host.innerHTML = supabaseSqlMarkup();
  const api = bindSupabaseSql(host.querySelector("[data-sb-supasql]"), opts);
  host._sqlApi = api;
  return api;
}
