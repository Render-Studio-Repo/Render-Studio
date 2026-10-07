/** Per-agent task lists for Sam. Token rndemo1 → rnddemo1. Collective speaks as Astra. */
export const RNDDEMO1_TOKEN = "rnddemo1";
import { openPageAstra } from "./ask-astra.js?v=20260923-draw-recordings1";
import { OFFICE_AGENTS, activeOfficeAgent, selectOfficeAgent, onOfficeAgentChange, openOfficeAgent, officeModelLabel, selectedAstraModel } from "./office-agents.js?v=office2&astraoffice=20260917-1";
import { DEFAULT_AI_MODEL } from "../components/ai-model-defaults.js?v=astra-default1&astraoffice=20260917-1&gpt61sol=20261001-1";
export const TASK_AGENTS = OFFICE_AGENTS;

const LS = "render3d.agentTasks.rnddemo1";
const LS_ASTRA_MODEL = "render3d.sandbox.astraModel";
let rows = loadLocal();
const listeners = new Set();
let subCache = { loaded: false, signedIn: false, email: "", plan: "", model: DEFAULT_AI_MODEL, error: "" };

function loadLocal() {
  try {
    const raw = globalThis.localStorage?.getItem?.(LS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadAstraModel() {
  return selectedAstraModel();
}

function storeAstraModel(value) {
  const next = value === "gpt-6-astra-pro" ? "gpt-6-astra-pro" : DEFAULT_AI_MODEL;
  try { globalThis.localStorage?.setItem?.(LS_ASTRA_MODEL, next); } catch { /* optional */ }
  subCache.model = next;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("render3d-astra-model"));
  return next;
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Normalize /api/ai-subscriptions listing into the Agents-tab Astra strip. */
export function parseAstraSubscription(data = {}) {
  const chatgpt = data.chatgpt || {};
  const openai = (data.providers || []).find((p) => p.id === "openai" || p.id === "chatgpt") || {};
  const status = String(chatgpt.status || openai.auth_status || "");
  const signedIn = !!(
    chatgpt.signed_in
    || status === "signed_in"
    || openai.auth_status === "signed_in"
    || openai.connected
  );
  return {
    loaded: true,
    signedIn,
    email: String(chatgpt.account_email || openai.account_email || "").trim(),
    plan: String(chatgpt.plan_label || openai.plan_label || "").trim(),
    model: loadAstraModel(),
    error: "",
    authStatus: status || (signedIn ? "signed_in" : "not_signed_in"),
  };
}

async function refreshSubscription() {
  try {
    const res = await fetch("/api/ai-subscriptions?t=" + Date.now(), { credentials: "same-origin" }).catch(() => null);
    if (!res) {
      subCache = { ...subCache, loaded: true, error: "network", signedIn: false };
      return subCache;
    }
    if (res.status === 401) {
      subCache = { ...subCache, loaded: true, error: "sign_in", signedIn: false };
      return subCache;
    }
    if (!res.ok) {
      subCache = { ...subCache, loaded: true, error: `HTTP ${res.status}`, signedIn: false };
      return subCache;
    }
    const data = await res.json().catch(() => ({}));
    subCache = { ...subCache, ...parseAstraSubscription(data) };
  } catch (err) {
    subCache = { ...subCache, loaded: true, error: String(err?.message || err).slice(0, 60), signedIn: false };
  }
  return subCache;
}

function persist() {
  try { globalThis.localStorage?.setItem?.(LS, JSON.stringify(rows.slice(-80))); } catch { /* optional */ }
  for (const fn of listeners) {
    try { fn(snapshot()); } catch { /* */ }
  }
}

export function onTasksChange(fn) {
  if (typeof fn === "function") listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listTasks(agentId) {
  const id = String(agentId || "");
  return rows.filter((t) => !id || t.agent_id === id);
}

export function snapshot() {
  const byAgent = {};
  for (const a of TASK_AGENTS) {
    const mine = listTasks(a.id);
    byAgent[a.id] = {
      queued: mine.filter((t) => t.status !== "done").length,
      done: mine.filter((t) => t.status === "done").length,
      latest: mine.slice(-3),
    };
  }
  return {
    token: RNDDEMO1_TOKEN,
    keep: ["mktpres1", "rndbench1"],
    tasks: rows.slice(-40),
    byAgent,
    astraSub: { ...subCache },
    ts: new Date().toISOString(),
  };
}

/** Shop pack: video + wiring benches + model experiments (not File IDE programming). */
export const CREW_SHOP_PACK = Object.freeze([
  { agent_id: "vibe-marketing", title: "Shoot project files + pick music for video production" },
  { agent_id: "clip-bot", title: "Cut shot files to a timeline and bed the music" },
  { agent_id: "cursor-engineer", title: "Help wiring simulator — nets, connectors, OpenArm harness" },
  { agent_id: "vibe-rnd", title: "Help wiring simulator — continuity + Quest cable clearance" },
  { agent_id: "analytics", title: "Help wiring simulator — log pass/fail on each net" },
  { agent_id: "instruction-auditor", title: "Help wiring simulator — review safety labels before power" },
  { agent_id: "project-manager", title: "Model experiment: block-in / scan / clay — not File IDE CAD" },
  { agent_id: "comms", title: "Draft emails that speed the teaching cook sequence" },
  { agent_id: "printer-bot", title: "Set up Sam's 3D printer and monitor job / jam (quiet unless waiting-on-Sam)" },
]);

export function seedShopCrewTasks({ from = "shop-pack" } = {}) {
  const created = [];
  for (const row of CREW_SHOP_PACK) {
    const exists = rows.some((t) => t.agent_id === row.agent_id && t.title === row.title && t.status !== "done");
    if (exists) continue;
    created.push(assignTask(row.agent_id, row.title, { from }));
  }
  return created;
}

export function assignTask(agentId, title, { from = "sam" } = {}) {
  const agent = TASK_AGENTS.find((a) => a.id === String(agentId || "")) || { id: String(agentId || "vibe-rnd"), name: String(agentId || "RnD") };
  const rec = {
    id: "tsk_" + Math.random().toString(16).slice(2, 10),
    agent_id: agent.id,
    agent_name: agent.name,
    title: String(title || "").trim().slice(0, 160) || "untitled",
    status: "queued",
    from,
    ts: new Date().toISOString(),
    token: RNDDEMO1_TOKEN,
  };
  rows.push(rec);
  persist();
  return rec;
}

export function completeTask(taskId, { note = "" } = {}) {
  const rec = rows.find((t) => t.id === String(taskId || ""));
  if (!rec) return null;
  rec.status = "done";
  rec.done_ts = new Date().toISOString();
  rec.note = String(note || "").slice(0, 160);
  persist();
  return rec;
}

export function ledgerStatusLine(rec) {
  if (!rec) return "";
  const st = rec.status === "done" ? "DONE" : String(rec.status || "queued").toUpperCase();
  return `LEDGER ${RNDDEMO1_TOKEN}: task ${rec.id} for ${rec.agent_id} ${st} — ${rec.title}`.slice(0, 240);
}

export function liveFeedPayload() {
  const snap = snapshot();
  return {
    token: RNDDEMO1_TOKEN,
    keep: snap.keep,
    live: true,
    source: "agent-tasks",
    tasks: snap.tasks.map((t) => ({
      id: t.id,
      agent_id: t.agent_id,
      status: t.status,
      title: t.title,
    })),
    byAgent: snap.byAgent,
  };
}

async function postRemote(action, extra) {
  try {
    const res = await fetch("/mcp/sandbox/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token: RNDDEMO1_TOKEN, ...extra }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function paintLiveStats(host, extra = {}) {
  if (!host) return null;
  const feed = { ...liveFeedPayload(), ...extra };
  let box = host.querySelector("#os-live-tasks");
  if (!box) {
    box = document.createElement("div");
    box.id = "os-live-tasks";
    host.append(box);
  }
  const lines = (feed.tasks || []).slice(-12).map((t) => `${t.agent_id} ${t.status}: ${t.title}`).join("\n") || "(no agent tasks yet)";
  box.innerHTML = `
    <p class="muted small">Live data feed · ${esc(feed.token)} · keep mktpres1/rndbench1</p>
    <pre class="sb1-code" data-live-json>${esc(JSON.stringify(feed, null, 2))}</pre>
    <p class="muted small">${esc(lines)}</p>
  `;
  return feed;
}

function astraSubBannerHtml() {
  const model = subCache.model || loadAstraModel();
  const brands = `<span class="sb-ask-astra-brands sb-ask-astra-brands--inline" aria-label="ChatGPT VR Grok">
    <img class="sb-ask-mark" src="/assets/brands/preferences/openai.svg" alt="ChatGPT" width="22" height="22" />
    <img class="sb-ask-mark sb-ask-mark--vr" src="/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1" alt="Render VR" width="22" height="22" />
    <img class="sb-ask-mark" src="/assets/brands/preferences/grok.svg" alt="Grok" width="22" height="22" />
  </span>`;
  if (!subCache.loaded) {
    return `<div class="sb-astra-sub" data-astra-sub>${brands}<span class="sb-kicker">ASTRA SUBSCRIPTION</span><span class="muted small">Loading ChatGPT…</span></div>`;
  }
  if (subCache.error === "sign_in") {
    return `<div class="sb-astra-sub is-bad" data-astra-sub>
      ${brands}
      <span class="sb-kicker">ASTRA SUBSCRIPTION</span>
      <strong>Not signed in</strong>
      <span class="muted small">Studio → Subscriptions → Sign in with ChatGPT for Astra / Astra Pro.</span>
      <a class="sb-agent-btn" href="/" target="_blank" rel="noopener">Open Studio</a>
    </div>`;
  }
  if (subCache.error) {
    return `<div class="sb-astra-sub is-bad" data-astra-sub>
      ${brands}
      <span class="sb-kicker">ASTRA SUBSCRIPTION</span>
      <strong>Unavailable</strong>
      <span class="muted small">${esc(subCache.error)}</span>
      <button type="button" class="sb-agent-btn" data-astra-sub-refresh>Retry</button>
    </div>`;
  }
  if (!subCache.signedIn) {
    return `<div class="sb-astra-sub is-bad" data-astra-sub>
      ${brands}
      <span class="sb-kicker">ASTRA SUBSCRIPTION</span>
      <strong>ChatGPT not connected</strong>
      <span class="muted small">Astra / Astra Pro need ChatGPT Plus/Pro under Studio Subscriptions. Grok mark shows bot fallback.</span>
      <a class="sb-agent-btn" href="/" target="_blank" rel="noopener">Connect</a>
      <button type="button" class="sb-agent-btn" data-astra-sub-refresh>Refresh</button>
    </div>`;
  }
  return `<div class="sb-astra-sub is-ok" data-astra-sub>
    ${brands}
    <span class="sb-kicker">ASTRA SUBSCRIPTION</span>
    <strong>ChatGPT on</strong>
    <span class="muted small">${esc(subCache.email || "signed in")}${subCache.plan ? ` · ${esc(subCache.plan)}` : ""}</span>
    <label class="sb-astra-model">
      <span>Collective model</span>
      <select data-astra-model>
        <option value="gpt-6-astra"${model === "gpt-6-astra" ? " selected" : ""}>Astra</option>
        <option value="gpt-6-astra-pro"${model === "gpt-6-astra-pro" ? " selected" : ""}>Astra Pro</option>
      </select>
    </label>
    <span class="muted small">Crew speaks as one — Astra (marin). Grok available as fallback.</span>
    <button type="button" class="sb-agent-btn" data-astra-sub-refresh>Refresh</button>
  </div>`;
}

export function mountAgentTaskBoard(host, { onAssign, onComplete } = {}) {
  if (!host) return null;
  host.classList?.add?.("sb-agent-tasks");
  subCache.model = loadAstraModel();
  host.innerHTML = `<header class="sb-active-agent"><label>Agent <select data-active-agent aria-label="Selected agent">${TASK_AGENTS.map(a => `<option value="${a.id}">${a.name}</option>`).join("")}</select></label><span data-active-model></span></header><p class="muted small" data-astra-chat>Astra chat lives in the agent bar — one Voice, one speaker.</p><form data-team-message hidden><label data-team-label></label><textarea aria-label="Message for selected agent" required maxlength="4000"></textarea><button type="submit" class="sb-agent-btn">Send to team chat</button><span role="status" data-team-status></span></form><div data-agent-task-content></div>`;
  const content = host.querySelector("[data-agent-task-content]");
  const syncSelection = () => {
    const agent = activeOfficeAgent();
    host.querySelector("[data-active-agent]").value = agent.id;
    host.querySelector("[data-active-model]").textContent = officeModelLabel(agent);
    host.querySelector("[data-astra-chat]").hidden = agent.id !== "astra";
    host.querySelector("[data-team-message]").hidden = agent.id === "astra";
    host.querySelector("[data-team-label]").textContent = `Message ${agent.name}`;
    content.querySelectorAll("[data-agent]").forEach(el => el.classList.toggle("is-selected", el.dataset.agent === agent.id));
  };
  host.querySelector("[data-active-agent]").onchange = e => selectOfficeAgent(e.target.value);
  const stopSelection = onOfficeAgentChange(syncSelection);
  const openAgent = () => {
    for (let el = host; el; el = el.parentElement) {
      if (el.dataset.sbPanel && el.dataset.pane) document.querySelector(`[data-sb-tab="${el.dataset.sbPanel}"][data-tab="${el.dataset.pane}"]`)?.click();
    }
    syncSelection();
    if (activeOfficeAgent().id === "astra") openPageAstra();
    else host.querySelector("[data-team-message] textarea").focus();
  };
  window.addEventListener("render3d-sandbox-open-agent", openAgent);
  window.addEventListener("render3d-astra-model", syncSelection);
  host.querySelector("[data-team-message]").onsubmit = async e => {
    e.preventDefault();
    const form = e.currentTarget, button = form.querySelector("button"), input = form.querySelector("textarea");
    const agent = activeOfficeAgent(), text = input.value.trim(), status = form.querySelector("[data-team-status]");
    if (!text || button.disabled) return;
    button.disabled = true; status.textContent = `Sending to ${agent.name}...`;
    try {
      const res = await fetch("/mcp/group-chat", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "post", agent: "sam", text: `@${agent.id} ${text}` }) });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      status.textContent = `Sent to ${agent.name}; replies appear in Team chat`;
      if (input.value.trim() === text) input.value = "";
    } catch (error) { status.textContent = `Not sent: ${error.message}`; }
    finally { button.disabled = false; }
  };

  const paint = () => {
    content.innerHTML = `
      ${astraSubBannerHtml()}
      <p class="muted small">Agents · collective voice = Astra · ${RNDDEMO1_TOKEN}</p>
      <button type="button" class="sb-agent-btn" data-shop-pack>Assign shop pack (video + wiring + model experiments)</button>
      <div class="sb-task-grid">
        ${TASK_AGENTS.map((a) => {
          const mine = listTasks(a.id);
          const open = mine.filter((t) => t.status !== "done");
          const done = mine.filter((t) => t.status === "done");
          return `<section class="sb-task-seat" data-agent="${esc(a.id)}">
            <header><strong>${esc(a.name)}</strong> <span class="muted small">${a.role ? esc(a.role) + " · " : ""}${open.length} open · ${done.length} done</span></header>
            <button type="button" class="sb-agent-btn" data-agent-open="${a.id}" ${a.id === "astra" ? "data-astra-open" : ""}>${a.id === "astra" ? "Ask Astra" : "Message " + a.name}</button>
            <form data-assign="${esc(a.id)}" class="sb-ide-tools">
              <input name="title" placeholder="Send ${esc(a.name)} a task" />
              <button type="submit" class="btn accent btn-compact">Assign</button>
            </form>
            <ul class="sb-log">${mine.slice(-6).map((t) => `
              <li data-task="${esc(t.id)}">${esc(t.status)} · ${esc(t.title)}
                ${t.status !== "done" ? `<button type="button" class="btn secondary btn-compact" data-done="${esc(t.id)}">Done</button>` : ""}
              </li>`).join("") || "<li class=\"muted small\">No tasks</li>"}</ul>
          </section>`;
        }).join("")}
      </div>
    `;
    content.querySelector("[data-shop-pack]")?.addEventListener("click", () => {
      seedShopCrewTasks();
      paint();
    });
    content.querySelectorAll("[data-agent-open]").forEach(btn => btn.addEventListener("click", () => openOfficeAgent(btn.dataset.agentOpen)));
    syncSelection();
    host.querySelector("[data-astra-sub-refresh]")?.addEventListener("click", () => {
      void refreshSubscription().then(paint);
    });
    host.querySelector("[data-astra-model]")?.addEventListener("change", (ev) => {
      storeAstraModel(ev.target.value);
      paint();
    });
    host.querySelectorAll("form[data-assign]").forEach((form) => {
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const id = form.getAttribute("data-assign");
        const title = form.querySelector("input")?.value || "";
        const rec = assignTask(id, title);
        void postRemote("assign", { agent: id, title: rec.title, id: rec.id });
        onAssign?.(rec);
        paint();
      });
    });
    host.querySelectorAll("[data-done]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rec = completeTask(btn.getAttribute("data-done"));
        void postRemote("complete", { id: rec?.id, note: rec?.note || "" });
        onComplete?.(rec);
        paint();
      });
    });
  };

  const stopTasks = onTasksChange(paint);
  paint();
  void refreshSubscription().then(paint);
  return { token: RNDDEMO1_TOKEN, snapshot, assignTask, completeTask, refreshSubscription, destroy() { stopTasks(); stopSelection(); window.removeEventListener("render3d-sandbox-open-agent", openAgent); window.removeEventListener("render3d-astra-model", syncSelection); } };
}
