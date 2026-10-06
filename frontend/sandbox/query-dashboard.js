/** Read-only incident investigation for the sandbox. No auto-fix or inferred blame. */
import { openPageAstra } from "./ask-astra.js?v=20260923-draw-recordings1";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FEATURE_HINTS = [
  [/trigger|button|controller/i, "vr.controllers.trigger"],
  [/webgl|gpu|context|render/i, "webgl.context"],
  [/model|viewport|mesh/i, "viewport.models"],
  [/rig|duplicate/i, "rigging.models"],
  [/api|server|network/i, "api.health"],
];

export function chooseFeature(question, features = []) {
  const q = String(question || "");
  const exact = features.find((feature) => q.toLowerCase().includes(feature.toLowerCase()));
  if (exact) return exact;
  const hinted = FEATURE_HINTS.find(([pattern]) => pattern.test(q))?.[1];
  return hinted || features.find((feature) => feature !== "unknown") || "vr.controllers.trigger";
}

export function nextProbe(feature, causeHint, hasWindow) {
  if (!hasWindow) return "Record an observed failure and identify a last working golden snapshot, then run the same action in both builds.";
  if (causeHint === "kernel-or-runtime-change") return "Reproduce with the last working runtime or kernel in sandbox. If it works there, review compatibility before changing feature code.";
  if (/trigger|controls/.test(feature)) return "Replay the same controller press in VR. Check the input edge, active mapping, UI interception, and resulting action in that order.";
  if (/webgl|viewport|models/.test(feature)) return "Check viewport boot, WebGL context, model fetch, scene attachment, visibility, and model count separately.";
  return "Inspect the prompt and code changes in the failure window, then revert one candidate change in sandbox and repeat the same smoke test.";
}

async function readJson(path, options) {
  let headers = { ...(options?.headers || {}) };
  try {
    const { authHeaders } = await import("../studio/auth.js?v=aska1-smoke1");
    headers = authHeaders(headers);
  } catch { /* Cookie session can still authorize. */ }
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
  if (!response.ok) throw new Error(response.status === 403 ? "Super admin access is required." : response.status === 401 ? "Sign in to use incident diagnostics." : `API ${response.status} at ${path.split("?")[0]}`);
  return response.json();
}

function eventLine(event) {
  if (!event) return "Not recorded";
  return `${esc(event.ts || "unknown time")} · ${esc(event.status || "unknown")} · ${esc(event.id || "")}`;
}

function searchTerm(question, feature) {
  const words = String(question || "").match(/[a-z0-9]{3,}/gi) || [];
  const parts = feature.split(".");
  const match = words.find((word) => parts.some((part) => part.toLowerCase() === word.toLowerCase()));
  return match || parts.at(-1);
}

export function mountQueryDashboard(host) {
  if (!host) return;
  host.innerHTML = `
    <form class="sb-query-form" id="sb-query-form">
      <label for="sb-query-text">Describe the problem</label>
      <div class="sb-query-row"><input id="sb-query-text" type="search" required minlength="3" placeholder="Why did the VR trigger stop working?" /><button type="submit">Investigate</button></div>
      <div class="sb-query-options"><label>Feature <select id="sb-query-feature"><option value="auto">Auto detect</option></select></label><button type="button" id="sb-query-smoke">Run system smoke check</button></div>
    </form>
    <div id="sb-query-status" class="sb-query-status" role="status">Loading feature status…</div>
    <div id="sb-query-results" aria-live="polite"></div>
    <p class="muted small">Ask Astra is the agent-bar chat (one Voice). Investigate first, then open it with this question.</p>
    <div class="sb-query-actions"><button type="button" id="sb-query-open-astra" class="sb-agent-btn sb-agent-btn--astra">Open Astra with this question</button></div>
  `;
  const form = host.querySelector("#sb-query-form");
  const status = host.querySelector("#sb-query-status");
  const result = host.querySelector("#sb-query-results");
  const featureSelect = host.querySelector("#sb-query-feature");
  const apiState = document.getElementById("sb-api-state");
  let features = [];
  let lastQuestion = "";
  let currentRequest = 0;
  let lastSmoke = null;
  let lastComparison = null;
  const closeViewport = () => {
    try { window.dispatchEvent(new CustomEvent("render3d-sandbox-close-viewport", { detail: { source: "query-dashboard" } })); }
    catch { /* optional in tests */ }
  };
  const openAstraWithQuestion = (question, extra = {}) => {
    const q = String(question || lastQuestion || "").trim();
    if (!q) return;
    const feature = featureSelect.value === "auto" ? chooseFeature(q, features) : featureSelect.value;
    openPageAstra({
      question: q,
      context: {
        source: "sandbox-query-dashboard",
        incident_api: "/api/ops/incidents/smoke",
        feature,
        smoke: lastSmoke || null,
        comparison: lastComparison?.feature === feature ? lastComparison.data : null,
        note: "Server smoke cannot verify browser WebGL, viewport models, or Quest buttons. Unknown is untested.",
        ...extra,
      },
    });
  };

  host.addEventListener("focusin", closeViewport);
  host.querySelector("#sb-query-open-astra")?.addEventListener("click", () => {
    openAstraWithQuestion(host.querySelector("#sb-query-text")?.value);
  });

  async function refresh() {
    try {
      const overview = await readJson("/api/ops/incidents/overview");
      features = Object.keys(overview.features || {}).sort();
      featureSelect.innerHTML = '<option value="auto">Auto detect</option>' + features.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
      const alerts = overview.alerts || [];
      status.textContent = `${features.length} tracked features · ${alerts.length} active alert${alerts.length === 1 ? "" : "s"} · updated ${new Date().toLocaleTimeString()}`;
      if (apiState) { apiState.textContent = "Diagnostics live"; apiState.classList.remove("is-offline"); }
    } catch (error) {
      status.textContent = error.message;
      if (apiState) { apiState.textContent = "Diagnostics unavailable"; apiState.classList.add("is-offline"); }
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = host.querySelector("#sb-query-text").value.trim();
    if (!question) return;
    lastQuestion = question;
    closeViewport();
    const feature = featureSelect.value === "auto" ? chooseFeature(question, features) : featureSelect.value;
    const request = ++currentRequest;
    status.textContent = `Checking ${feature} and related prompts…`;
    result.innerHTML = "";
    try {
      const [comparison, search, related] = await Promise.all([
        readJson("/api/ops/incidents/compare/" + encodeURIComponent(feature)),
        readJson("/api/ops/incidents/search?q=" + encodeURIComponent(searchTerm(question, feature)) + "&limit=12"),
        readJson("/api/ops/incidents/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: {}, limit: 20 }) }),
      ]);
      if (request !== currentRequest) return;
      const hits = search.hits || [];
      const otherFailures = (related.events || []).filter((row) => row.feature !== feature && ["broken", "missing", "degraded"].includes(row.status)).slice(0, 5);
      const hasWindow = Boolean(comparison.last_working && comparison.first_failure);
      lastComparison = { feature, data: comparison };
      const probe = nextProbe(feature, comparison.cause_hint, hasWindow);
      result.innerHTML = `
        <div class="sb-query-summary"><strong>${esc(feature)}</strong><span>${hasWindow ? "Failure window found" : "Insufficient timeline evidence"}</span></div>
        <div class="sb-query-paths">
          <article><span class="sb-kicker">METHOD A · FEATURE TIMELINE</span><h3>Find the change window</h3><dl><dt>Last working</dt><dd>${eventLine(comparison.last_working)}</dd><dt>First failure</dt><dd>${eventLine(comparison.first_failure)}</dd><dt>Working snapshot</dt><dd>${esc(comparison.last_working_snapshot?.label || "Not recorded")}</dd><dt>Failing snapshot</dt><dd>${esc(comparison.first_failing_snapshot?.label || "Not recorded")}</dd></dl><p>${hasWindow ? "Check changes between these timestamps, starting with the linked prompts and runtime changes." : "Capture a working snapshot and a failure event to narrow the cause."}</p><p>Layer clue: ${esc(comparison.cause_hint || "unknown")} (inference from snapshots).</p><p><strong>Next probe:</strong> ${esc(probe)}</p></article>
          <article><span class="sb-kicker">METHOD B · CROSS-FEATURE CHECK</span><h3>Look for shared failures</h3><p>${otherFailures.length ? `${otherFailures.length} other recent failing features may share a cause:` : "No other failing features in the recent event sample."}</p><ul>${otherFailures.map((row) => `<li>${esc(row.feature)} · ${esc(row.status)} · ${esc(row.ts)}</li>`).join("")}</ul><p>Run the server smoke check for API and performance signals. Browser and headset behavior still needs a live observation.</p></article>
        </div>
        <section class="sb-query-evidence"><h3>Prompt search · ${hits.length} match${hits.length === 1 ? "" : "es"}</h3><ul>${hits.map((hit) => `<li><span>${esc(hit.timestamp || "")}</span><strong>${esc(hit.prompt || hit.excerpt || "")}</strong><code>${esc(hit.log_id || "")}</code></li>`).join("") || "<li>No matching indexed prompts. This does not rule out unindexed changes.</li>"}</ul></section>
        <div class="sb-query-actions"><button type="button" id="sb-copy-packet">Copy Cursor traceback packet</button><span>Review evidence before applying a fix.</span></div>
      `;
      result.querySelector("#sb-copy-packet")?.addEventListener("click", async () => {
        await navigator.clipboard.writeText(comparison.cursor_packet || `Feature: ${feature}\nQuestion: ${lastQuestion}`);
        status.textContent = "Traceback packet copied.";
      });
      status.textContent = `Investigation completed at ${new Date().toLocaleTimeString()}.`;
    } catch (error) {
      if (request === currentRequest) status.textContent = error.message;
    }
  });

  host.querySelector("#sb-query-smoke").addEventListener("click", async () => {
    closeViewport();
    status.textContent = "Running server smoke check…";
    try {
      const check = await readJson("/api/ops/incidents/smoke", { method: "POST" });
      lastSmoke = check;
      result.innerHTML = `<section class="sb-query-evidence"><h3>Server smoke check</h3><pre>${esc(JSON.stringify(check, null, 2))}</pre><p>VR input and viewport rendering require a client observation.</p></section>`;
      lastQuestion = "Which of these server smoke checks need follow-up, and what browser or Quest observation should I record next?";
      status.textContent = "Server smoke check complete.";
    } catch (error) { status.textContent = error.message; }
  });
  void refresh();
  setInterval(refresh, 30000);
}
