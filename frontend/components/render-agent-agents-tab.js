import { prefFor, voiceControlsMarkup } from "./voice-agent-roster.js";

export const RA_AGENTS_TOKEN = "raagents1";
export const RA_HARNESS_TOKEN = "raharness1";
export const RA_AGENT_CHAT_TOKEN = "rachat1";
export const RA_AGENT_CHAT_FEED = "/mcp/team-chat/feed?limit=120";

export function agentChatPostBody(text = "") {
  return { agent: "sam", text: String(text || "").trim().slice(0, 1500) };
}

export function renderAgentTabView(tab = "chat") {
  return {
    chat: tab === "chat",
    agentChat: tab === "agent-chat",
    usage: tab === "usage",
  };
}

export function selectedThreadRefreshId(threads = [], activeId = "") {
  const rows = Array.isArray(threads) ? threads : [];
  const selected = String(activeId || "");
  if (selected && rows.some((thread) => String(thread?.id || "") === selected)) return selected;
  return String(rows[0]?.id || "");
}

export function parseAgentChat(payload = {}) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : (Array.isArray(payload) ? payload : []);
  return messages
    .map((row) => ({
      agent: String(row?.agent || row?.sender || "agent").trim() || "agent",
      text: String(row?.text || row?.body || "").trim(),
      at: String(row?.ts || row?.created_at || ""),
    }))
    .filter((row) => row.text)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-100);
}

export function agentChatMarkup(messages = []) {
  const rows = messages.map((row) => `<article class="ra-agent-chat-message">
    <header><strong>${esc(row.agent)}</strong>${row.at ? `<time>${esc(row.at)}</time>` : ""}</header>
    <p>${esc(row.text)}</p>
  </article>`).join("");
  return `<div class="ra-agent-chat" data-token="${RA_AGENT_CHAT_TOKEN}">
    ${rows || '<p class="muted small">No agent conversation has been recorded yet.</p>'}
  </div>`;
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function remainingTone(pct) {
  if (pct == null) return "unknown";
  if (pct >= 75) return "green";
  if (pct >= 40) return "yellow";
  return "red";
}

export function formatUsd(n) {
  if (n == null || !Number.isFinite(Number(n))) return "n/a";
  return `$${Number(n).toFixed(2)}`;
}

/** Live nicks from ledger-whois / connected Grok seats. Skips Sam and the host card. */
export function grokBotCards(who, { connected = false } = {}) {
  const map = who && typeof who === "object" ? (who.who || who) : {};
  const cards = [];
  for (const [id, row] of Object.entries(map)) {
    if (!row || typeof row !== "object" || id === "sam" || id === "grok-bot") continue;
    cards.push({
      id: `grok:${id}`,
      label: String(row.nick || id).slice(0, 40),
      kind: "grok-seat",
      authorized: !!connected,
      remaining_pct: null,
      task: String(row.role || "connected grok bot").slice(0, 80),
      detail: id,
      connected: !!connected,
    });
  }
  return cards;
}

/** Map /api/ai-subscriptions + grok status into roster cards. */
export function parseAuthorizedAgents({ listing = {}, grok = {}, tasks = [], who = null } = {}) {
  const usage = listing.usage || {};
  const remaining = usage.remaining_pct == null ? null : num(usage.remaining_pct);
  const providers = Array.isArray(listing.providers) ? listing.providers : [];
  const cloud = providers.find((p) => p.id === "cloud") || {};
  const openai = providers.find((p) => p.id === "openai") || {};
  const chatgpt = listing.chatgpt || {};
  const credits = listing.credits || cloud.credits || {};
  const taskBy = {};
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const id = String(t.agent_id || t.id || "");
    if (!id) continue;
    if (!taskBy[id]) taskBy[id] = t;
  }

  const meter = {
    remaining_pct: remaining,
    used_pct: usage.used_pct == null ? null : num(usage.used_pct),
    today_usd: num(usage.spent_today_usd, 0),
    week_usd: num(usage.spent_week_usd, 0),
    today_tokens: num(usage.spent_today_tokens, 0),
    week_tokens: num(usage.spent_week_tokens, 0),
  };

  const astraOn = !!(chatgpt.signed_in || openai.connected || openai.auth_status === "signed_in");
  const cloudOn = !!(cloud.connected || (credits.balance_cents > 0 && credits.use_platform_key));
  const grokOn = !!(grok.connected || grok.enabled);
  const whoMap = who && typeof who === "object" ? (who.who || who) : {};
  const grokNick = String(whoMap["grok-bot"]?.nick || "").trim();

  const agents = [
    {
      id: "render-agent",
      label: "Render Agent",
      kind: "studio",
      authorized: true,
      remaining_pct: remaining,
      task: taskBy["render-agent"]?.title || taskBy["astra"]?.title || "Questions on Studio subscription",
      detail: cloud.plan_label || (credits.balance_cents != null ? `$${(Number(credits.balance_cents) / 100).toFixed(2)} credits` : "Studio"),
      connected: cloudOn || true,
    },
    {
      id: "gpt-astra",
      label: "GPT Astra",
      kind: "chatgpt",
      authorized: astraOn,
      remaining_pct: remaining,
      task: taskBy["gpt-astra"]?.title || taskBy["astra"]?.title || (astraOn ? "ChatGPT / Astra CAD" : "Not signed in"),
      detail: openai.plan_label || chatgpt.plan_label || chatgpt.account_email || "ChatGPT",
      connected: astraOn,
    },
    {
      id: "grok-bot",
      label: grokNick || "Grok bot",
      kind: "grok",
      authorized: grokOn,
      remaining_pct: remaining,
      task: taskBy["grok-bot"]?.title || grok.detail || (grokOn ? "Grok chat / X" : "Not connected"),
      detail: grok.model || "Grok",
      connected: grokOn,
    },
  ];
  if (grokOn) agents.push(...grokBotCards(whoMap, { connected: true }));

  return {
    token: RA_AGENTS_TOKEN,
    meter,
    agents,
  };
}

export function agentsTabMarkup(roster, { prefs = {}, catalog = [] } = {}) {
  const m = roster?.meter || {};
  const left = m.remaining_pct == null ? "n/a" : `${m.remaining_pct}% left`;
  const tone = remainingTone(m.remaining_pct);
  const cards = (roster?.agents || []).map((a) => {
    const pct = a.remaining_pct == null ? "n/a" : `${a.remaining_pct}%`;
    const on = a.authorized ? "on" : "off";
    const seatId = String(a.id || "").replace(/^grok:/, "");
    const controls = voiceControlsMarkup(seatId, prefFor(seatId, prefs), catalog);
    return `<article class="ra-agent-card ra-agent-card--${on}" data-agent-id="${esc(a.id)}">
      <header><strong>${esc(a.label)}</strong><span class="ra-agent-pct is-${remainingTone(a.remaining_pct)}">${esc(pct)}</span></header>
      <p class="ra-agent-task">${esc(a.task || "—")}</p>
      <small>${a.connected ? "authorized" : "not authorized"} · ${esc(a.detail || "")}</small>
      ${controls}
    </article>`;
  }).join("");
  return `<div class="ra-agents-tab" data-token="${RA_AGENTS_TOKEN}">
    <p class="ra-agents-meter is-${tone}">Studio week ${left} · today ${formatUsd(m.today_usd)} · week ${formatUsd(m.week_usd)}</p>
    <div class="ra-agent-grid">${cards}</div>
    <p class="ra-agents-hint">Harness: remaining % is the same CAD meter as Account → Costs. Grok quota is n/a on xAI until billed; we still show Studio % so you can compare seats. Tasks come from this roster, not a second talk bar.</p>
  </div>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** Cloud-agent / grok-bot spin monitor. Cursor $ line items stay unknown unless Usage is pasted. */
export function parseHarnessMonitor({ listing = {}, grok = {}, health = {}, stats = {}, chat = {} } = {}) {
  const roster = parseAuthorizedAgents({ listing, grok });
  const messages = Array.isArray(chat.messages) ? chat.messages : (Array.isArray(chat) ? chat : []);
  const active = new Map();
  const spinning = [];
  const prRe = /(?:PR\s*)?#(\d{1,4})\b|github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/gi;
  const branchRe = /cursor\/[a-z0-9._-]+/gi;
  for (const m of messages.slice(-100)) {
    const text = String(m.text || m.body || "");
    const agent = String(m.agent || m.sender || "unknown");
    const ts = String(m.ts || m.created_at || "");
    let hit = false;
    prRe.lastIndex = 0;
    let pr;
    while ((pr = prRe.exec(text))) {
      const n = pr[1] || pr[2];
      if (!n) continue;
      active.set(`pr-${n}`, { id: `pr-${n}`, label: `PR #${n}`, source: agent, detail: text.slice(0, 140) });
      hit = true;
    }
    const branches = text.match(branchRe) || [];
    for (const b of branches) {
      active.set(b, { id: b, label: b, source: agent, detail: text.slice(0, 140) });
      hit = true;
    }
    if (
      hit
      || /cloud agent|spinning|HARNESS_WAKE|on-demand|quota empty|CURRENT/i.test(text)
    ) {
      spinning.push({ agent, ts, text: text.slice(0, 220) });
    }
  }
  return {
    token: RA_HARNESS_TOKEN,
    meter: roster.meter,
    cursor_line_items: "unknown",
    grok: {
      up: !!(health.ok || grok.connected || grok.enabled),
      version: health.version || grok.model || "n/a",
      name: health.name || "grok-bot",
      help_requests: stats.help_requests == null ? null : Number(stats.help_requests),
      collab_files: stats.collab_files == null ? null : Number(stats.collab_files),
    },
    active: [...active.values()].slice(0, 24),
    spinning: spinning.slice(-12).reverse(),
  };
}

export function harnessMonitorMarkup(mon) {
  const m = mon?.meter || {};
  const left = m.remaining_pct == null ? "n/a" : `${m.remaining_pct}% left`;
  const tone = remainingTone(m.remaining_pct);
  const grok = mon?.grok || {};
  const grokState = grok.up ? "up" : "down";
  const active = (mon?.active || []).map((a) => (
    `<li><strong>${esc(a.label)}</strong> <small>${esc(a.source)}</small><span>${esc(a.detail)}</span></li>`
  )).join("") || "<li class='muted'>No live Cursor cloud jobs on the MCP bus. COST line items still unknown until Cursor Usage is pasted.</li>";
  const spin = (mon?.spinning || []).map((s) => (
    `<li><strong>${esc(s.agent)}</strong> <time>${esc(s.ts)}</time><span>${esc(s.text)}</span></li>`
  )).join("") || "<li class='muted'>Grok bot has not posted a spawn/wake on team-chat recently.</li>";
  return `<div class="ra-harness-tab" data-token="${RA_HARNESS_TOKEN}">
    <p class="ra-agents-meter is-${tone}">This harness · Studio ${left} · today ${formatUsd(m.today_usd)} · week ${formatUsd(m.week_usd)} · Cursor On-Demand line items: ${esc(mon?.cursor_line_items || "unknown")}</p>
    <section class="ra-harness-block">
      <h3>Active agents</h3>
      <p class="ra-harness-count">${(mon?.active || []).length} job id(s) from MCP chat (PRs / cursor/* branches)</p>
      <ul class="ra-harness-list">${active}</ul>
    </section>
    <section class="ra-harness-block">
      <h3>Grok bot spinning</h3>
      <p class="ra-harness-count">${esc(grok.name)} · ${grokState} · ${esc(grok.version)}${grok.help_requests != null ? ` · help ${grok.help_requests}` : ""}</p>
      <ul class="ra-harness-list ra-harness-spin">${spin}</ul>
    </section>
    <p class="ra-agents-hint">Not Grok team-chat dollars. Cursor cloud VMs bill On-Demand. This panel reads MCP bus + Studio meter — it does not invent a $100 split.</p>
  </div>`;
}
