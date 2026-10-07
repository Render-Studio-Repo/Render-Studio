const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const AVATAR = {
  sam: "/docs/media/employees/avatar-cursor-engineer.png",
  "cursor-engineer": "/docs/media/employees/avatar-cursor-engineer.png",
  "project-manager": "/docs/media/employees/avatar-project-manager.png",
  "vibe-rnd": "/docs/media/employees/avatar-vibe-rnd.png",
  "vibe-marketing": "/docs/media/employees/avatar-vibe-marketing.png",
  "vibe-sales": "/docs/media/employees/avatar-sales.png",
  "clip-bot": "/docs/media/employees/avatar-clip-bot.png",
  analytics: "/docs/media/employees/avatar-analytics.png",
  "instruction-auditor": "/docs/media/employees/avatar-auditor.png",
  "comms-bridge": "/docs/media/employees/avatar-comms.png",
  ledger: "/docs/media/employees/avatar-auditor.png",
};

function srcFor(agent) {
  return AVATAR[String(agent || "").toLowerCase()] || "";
}

function avatarHtml(agent) {
  const src = srcFor(agent);
  const letter = esc(String(agent || "?").slice(0, 1).toUpperCase());
  if (src) {
    return `<span class="render-agent-avatar render-agent-member-avatar" style="background-image:url('${esc(src)}')" title="${esc(agent)}"></span>`;
  }
  return `<span class="render-agent-avatar">${letter}</span>`;
}

function linkify(text) {
  return esc(text)
    .replace(/(^|[^A-Za-z0-9._-])@([A-Za-z0-9_-]{2,40})/g, '$1<button type="button" class="at-chip" data-at="@$2">@$2</button>')
    .replace(/\n/g, "<br>");
}

function formatChatTs(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    // Already human or partial — try YYYY-MM-DDTHH:MM:SS
    const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return String(raw);
    let hh = Number(m[4]);
    const mm = m[5];
    const ap = hh >= 12 ? "PM" : "AM";
    hh = hh % 12 || 12;
    return `${hh}:${mm} ${ap} ${Number(m[2])}-${Number(m[3])}-${m[1]}`;
  }
  let hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ap = hh >= 12 ? "PM" : "AM";
  hh = hh % 12 || 12;
  return `${hh}:${mm} ${ap} ${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
}

function bubble(r) {
  const agent = r.agent || r.from || "?";
  const mine = /^(sam|cursor-engineer)$/i.test(agent);
  const role = mine ? "user" : "assistant";
  const name = agent === "sam" ? "You" : agent;
  const lid = r.log_id || "";
  return `<article class="render-agent-message render-agent-message--${role}" data-log="${esc(lid)}">
    <header class="render-agent-message-head">
      ${avatarHtml(agent)}
      <div><strong>${esc(name)}</strong><small>${esc(formatChatTs(r.ts || ""))}</small></div>
      ${lid ? `<button type="button" class="log-chip" data-copy="${esc(lid)}" title="copy log_id">${esc(lid)}</button>` : ""}
    </header>
    <div class="render-agent-message-content">${linkify(r.text || "")}</div>
  </article>`;
}

function membersBar(rows) {
  const box = document.getElementById("render-agent-members");
  if (!box) return;
  const seen = [];
  for (const r of rows) {
    const a = r.agent || r.from;
    if (a && !seen.includes(a)) seen.push(a);
  }
  box.innerHTML = seen.slice(-16).map((a) => `<button type="button" class="at-person" data-at="@${esc(a)}" title="@${esc(a)}">${avatarHtml(a)}</button>`).join("");
  box.querySelectorAll(".at-person").forEach((btn) => {
    btn.addEventListener("click", () => {
      const at = btn.getAttribute("data-at") || "";
      const input = document.getElementById("render-agent-input");
      if (input && at) input.value = (input.value ? input.value + " " : "") + at + " ";
    });
  });
}

async function loadRows() {
  const feed = await fetch("/mcp/team-chat/feed?limit=120&t=" + Date.now()).catch(() => null);
  if (feed && feed.ok) {
    const data = await feed.json();
    if (Array.isArray(data.messages)) return data.messages;
  }
  const mcp = await fetch("/mcp/group-chat?limit=120&t=" + Date.now()).catch(() => null);
  if (mcp && mcp.ok) {
    const data = await mcp.json();
    if (data.messages) return data.messages;
  }
  const api = await fetch("/api/ops/group-chat?limit=120&t=" + Date.now()).catch(() => null);
  if (api && api.ok) {
    const data = await api.json();
    if (data.messages) return data.messages;
  }
  const res = await fetch("/docs/media/group-chat.jsonl?t=" + Date.now());
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { agent: "?", text: l }; }
  });
}

async function paint() {
  const box = document.getElementById("render-agent-messages") || document.getElementById("group-thread");
  if (!box) return;
  const rows = await loadRows();
  box.innerHTML = rows.map(bubble).join("") || `<div class="render-agent-empty"><strong>No messages yet.</strong></div>`;
  box.scrollTop = box.scrollHeight;
  membersBar(rows);
  box.querySelectorAll(".log-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-copy") || "";
      navigator.clipboard?.writeText(id);
      const input = document.getElementById("render-agent-input");
      if (input && id && !input.value.includes(id)) input.value = (input.value ? input.value + " " : "") + "@" + id + " ";
    });
  });
  box.querySelectorAll(".at-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const at = btn.getAttribute("data-at") || "";
      const input = document.getElementById("render-agent-input");
      if (input && at) input.value = (input.value ? input.value + " " : "") + at + " ";
    });
  });
}

async function postAsSam(ev) {
  ev.preventDefault();
  const input = document.getElementById("render-agent-input") || document.getElementById("sam-chat-text");
  const status = document.getElementById("render-agent-status") || document.getElementById("sam-chat-status");
  const text = (input && input.value || "").trim();
  if (!text) return;
  if (status) status.textContent = "Sending…";
  let res = await fetch("/api/ops/group-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, agent: "sam" }),
  }).catch(() => null);
  if (!res || !res.ok) {
    res = await fetch("/mcp/group-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, agent: "sam" }),
    }).catch(() => null);
  }
  if (!res || !res.ok) {
    if (status) status.textContent = "Post failed.";
    return;
  }
  if (input) input.value = "";
  if (status) status.textContent = "Posted as sam.";
  await paint();
}

const AT_ROSTER = [
  "analytics", "project-manager", "vibe-rnd", "vibe-marketing", "ledger",
  "instruction-auditor", "comms-bridge", "clip-bot", "vibe-sales",
  "cursor-engineer", "harness-mule", "pad", "code", "sam",
];

function bindAtComposer() {
  const input = document.getElementById("render-agent-input");
  const menu = document.getElementById("render-agent-mention-menu");
  if (!input || !menu) return;
  let hits = [];
  let idx = 0;
  const hide = () => menu.classList.add("hidden");
  const insert = (handle) => {
    const start = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(start);
    const next = before.replace(/@([A-Za-z0-9_-]*)$/, `@${handle} `);
    input.value = next + after;
    input.setSelectionRange(next.length, next.length);
    hide();
    input.focus();
  };
  const paintMenu = () => {
    const start = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, start);
    const match = before.match(/@([A-Za-z0-9_-]*)$/);
    if (!match) { hide(); return; }
    const q = (match[1] || "").toLowerCase();
    hits = AT_ROSTER.filter((h) => !q || h.toLowerCase().includes(q)).slice(0, 8);
    if (!hits.length) { hide(); return; }
    idx = Math.min(idx, hits.length - 1);
    menu.innerHTML = hits.map((h, i) => `<button type="button" class="prompt-mention-option${i === idx ? " is-active" : ""}" data-at="${esc(h)}"><span class="prompt-mention-option-token">@${esc(h)}</span></button>`).join("");
    menu.classList.remove("hidden");
    menu.querySelectorAll("[data-at]").forEach((btn) => {
      btn.addEventListener("mousedown", (ev) => ev.preventDefault());
      btn.addEventListener("click", () => insert(btn.getAttribute("data-at")));
    });
  };
  input.addEventListener("input", paintMenu);
  input.addEventListener("click", paintMenu);
  input.addEventListener("keydown", (ev) => {
    if (menu.classList.contains("hidden") || !hits.length) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); idx = (idx + 1) % hits.length; paintMenu(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); idx = (idx - 1 + hits.length) % hits.length; paintMenu(); }
    else if (ev.key === "Escape") { ev.preventDefault(); hide(); }
    else if (ev.key === "Enter" || ev.key === "Tab") { ev.preventDefault(); insert(hits[idx]); }
  });
}

const form = document.getElementById("render-agent-form") || document.getElementById("sam-chat-form");
if (form) form.addEventListener("submit", postAsSam);
bindAtComposer();
bindSlashMenu();

function bindSlashMenu() {
  const input = document.getElementById("render-agent-input");
  const menu = document.getElementById("render-agent-slash-menu");
  if (!input || !menu) return;
  const cmds = [
    { cmd: "/me", hint: "activate skill: crew formulates a CODE prompt for harness" },
    { cmd: "/update", hint: "breakdown of what is live" },
    { cmd: "/stats", hint: "repair-loop / reports / bench counts" },
  ];
  const paint = () => {
    const v = input.value;
    if (!v.startsWith("/")) {
      menu.classList.add("hidden");
      return;
    }
    const q = v.slice(1).toLowerCase();
    const hits = cmds.filter((c) => c.cmd.slice(1).startsWith(q) || c.cmd.includes(q));
    menu.innerHTML = hits.map((c) => `<button type="button" class="prompt-mention-option" data-slash="${esc(c.cmd)}"><span class="prompt-mention-option-token">${esc(c.cmd)}</span><span class="prompt-mention-option-kind">${esc(c.hint)}</span></button>`).join("") || `<p class="muted small">/me /update /stats</p>`;
    menu.classList.remove("hidden");
    menu.querySelectorAll("[data-slash]").forEach((btn) => {
      btn.addEventListener("mousedown", (ev) => ev.preventDefault());
      btn.addEventListener("click", () => {
        input.value = btn.getAttribute("data-slash") + " ";
        menu.classList.add("hidden");
        input.focus();
      });
    });
  };
  input.addEventListener("input", paint);
}
async function loadRequests() {
  const box = document.getElementById("team-request-list");
  if (!box) return;
  const res = await fetch("/mcp/help-requests?t=" + Date.now()).catch(() => null);
  let rows = [];
  if (res && res.ok) {
    const data = await res.json();
    rows = data.requests || [];
  } else {
    const raw = await fetch("/docs/media/help-requests.jsonl?t=" + Date.now()).catch(() => null);
    if (raw && raw.ok) {
      const text = await raw.text();
      rows = text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }
  }
  box.innerHTML = rows.slice().reverse().map((r) => `<article class="team-request-card">
    <strong>${esc(r.agent)} → ${esc(r.ask)}</strong>
    <small>${esc(r.request_id)} · ${esc(r.category_id)} · tb ${esc((r.traceback_ids || []).join(","))}</small>
    <p>${esc(r.text || "")}</p>
    <small>peer_max=${esc(r.peer_asks_max)} · ask Sam when ${esc(r.ask_sam_when)}</small>
  </article>`).join("") || `<p class="muted small">No requests yet.</p>`;
}

async function postRequest(ev) {
  ev.preventDefault();
  const input = document.getElementById("sam-request-text");
  const status = document.getElementById("sam-request-status");
  const text = (input && input.value || "").trim();
  if (!text) return;
  if (status) status.textContent = "Filing…";
  const res = await fetch("/mcp/help-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "sam", text, ask: "crew", kind: "help", category_id: "CTL" }),
  }).catch(() => null);
  if (!res || !res.ok) {
    if (status) status.textContent = "Request failed.";
    return;
  }
  if (input) input.value = "";
  if (status) status.textContent = "Request filed.";
  await loadRequests();
  await paint();
}

const reqForm = document.getElementById("sam-request-form");
if (reqForm) reqForm.addEventListener("submit", postRequest);
paint();
loadRequests();
loadVotes();
loadPad();
loadTags();
setInterval(() => { paint(); loadRequests(); loadVotes(); loadPad(); loadTags(); }, 4000);

async function loadTags() {
  const box = document.getElementById("team-tag-list");
  if (!box) return;
  const res = await fetch("/mcp/tags?t=" + Date.now()).catch(() => null);
  const data = res && res.ok ? await res.json() : { tags: [] };
  const rows = (data.tags || []).slice(-12).reverse();
  box.innerHTML = `<strong>@ thread</strong>` + (rows.map((r) => `<button type="button" class="tag-row" data-at="@${esc((r.tags || [])[0] || "")}"><small>${esc((r.tags || []).map((t) => "@" + t).join(" "))}</small> ${esc((r.text || "").slice(0, 80))}</button>`).join("") || `<p class="muted small">No @ yet</p>`);
  box.querySelectorAll(".tag-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const at = btn.getAttribute("data-at") || "";
      const input = document.getElementById("render-agent-input");
      if (input && at) input.value = (input.value ? input.value + " " : "") + at + " ";
    });
  });
}

async function loadVotes() {
  const box = document.getElementById("team-vote-board");
  if (!box) return;
  const res = await fetch("/mcp/votes?t=" + Date.now()).catch(() => null);
  const data = res && res.ok ? await res.json() : { votes: {} };
  const votes = data.votes || {};
  const ids = Object.keys(votes);
  if (!ids.length) {
    box.innerHTML = `<p class="muted small">No live vote. Open one with VOTE id=V-… q=… options=A|B|C</p>`;
    return;
  }
  box.innerHTML = ids.map((id) => {
    const v = votes[id];
    const opts = String(v.options || "A|B|C").split("|");
    const counts = v.counts || {};
    return `<article class="team-vote-card" data-vote="${esc(id)}">
      <strong>${esc(id)}</strong>
      <p>${esc(v.q || "")}</p>
      <div class="team-vote-opts">${opts.map((o) => `<button type="button" class="btn secondary btn-compact vote-btn" data-vote="${esc(id)}" data-choice="${esc(o)}">${esc(o)} · ${esc(counts[o] || 0)}</button>`).join("")}</div>
      <small>${(v.ballots || []).map((b) => `${esc(b.agent)}=${esc(b.choice)}`).join(" · ")}</small>
    </article>`;
  }).join("");
  box.querySelectorAll(".vote-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch("/mcp/votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "sam", vote_id: btn.getAttribute("data-vote"), choice: btn.getAttribute("data-choice") }),
      }).catch(() => null);
      await loadVotes();
      await paint();
    });
  });
}

async function loadPad() {
  const body = document.getElementById("team-ide-body");
  const log = document.getElementById("team-ide-log");
  if (!body) return;
  const res = await fetch("/mcp/collab-pad?t=" + Date.now()).catch(() => null);
  const data = res && res.ok ? await res.json() : { pad: {} };
  const pad = data.pad || {};
  if (document.activeElement !== body) body.value = pad.body || "";
  if (log) {
    log.innerHTML = (pad.log || []).slice().reverse().map((r) => `<div>rev ${esc(r.rev)} ${esc(r.agent)} — ${esc(r.note)}</div>`).join("") || "empty";
  }
}

const ideForm = document.getElementById("team-ide-form");
if (ideForm) {
  ideForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const body = document.getElementById("team-ide-body");
    const note = document.getElementById("team-ide-note");
    await fetch("/mcp/collab-pad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "sam", text: body && body.value, note: note && note.value }),
    }).catch(() => null);
    await loadPad();
  });
}
