const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SKILLS = [
  "START-EVERY-PROMPT.md",
  "DUMP-TRACEBACK-LOOP-20260916.md",
  "BOARD-ROUND-SKILLS.md",
  "PROMPT-ledger.md",
  "PROMPT-vote.md",
  "PROMPT-group-board.md",
  "AGENT-BUS.md",
  "API-TRACKING-EXPLAINED.md",
  "REPORT-ERRORS-20260916.md",
  "PROMPT-harness-wake-THRUSTER_R.md",
  "PROMPT-project-manager.md",
  "PROMPT-vibe-rnd.md",
  "PROMPT-vibe-marketing.md",
  "PROMPT-vibe-sales.md",
  "PROMPT-clip-bot.md",
  "PROMPT-cursor-engineer.md",
  "PROMPT-pm-talk-to-cursor.md",
  "HIRE-20260916.md",
];

const LABELS = {
  hello: "Hello — crew check-ins",
  work: "Harness / Sam",
  them: "MCP bus",
  files: "Getting-Started skills",
};

let group = [];
let bus = [];
let tab = "hello";

function bubble(who, ts, text) {
  const mine = /^(sam|cursor-engineer)$/i.test(who);
  const role = mine ? "user" : "assistant";
  const name = mine && /sam/i.test(who) ? "You" : (mine ? "Render Agent" : who);
  const fmt = (() => {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts || "");
    let hh = d.getHours();
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ap = hh >= 12 ? "PM" : "AM";
    hh = hh % 12 || 12;
    return `${hh}:${mm} ${ap} ${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
  })();
  return `<article class="render-agent-message render-agent-message--${role}">
    <header class="render-agent-message-head">
      <span class="render-agent-avatar">${esc((name || "?").slice(0, 1))}</span>
      <div><strong>${esc(name)}</strong><small>${esc(who)} · ${esc(fmt)}</small></div>
    </header>
    <div class="render-agent-message-content">${esc(text).replace(/\n/g, "<br>")}</div>
  </article>`;
}

async function loadJsonl(url) {
  const res = await fetch(url + "?t=" + Date.now());
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { text: l }; }
  });
}

function paint() {
  const box = document.getElementById("hw-render-agent-messages");
  const label = document.getElementById("hw-thread-label");
  if (label) label.textContent = LABELS[tab] || tab;
  document.querySelectorAll("[data-hw-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-hw-tab") === tab);
  });
  if (!box) return;
  if (tab === "files") {
    box.innerHTML = `<div class="render-agent-empty"><strong>Skills on disk — not sent to Grok DMs</strong></div>` +
      SKILLS.map((f) =>
        `<a class="ra-file" href="/docs/media/getting-started-agents/${encodeURIComponent(f)}" target="_blank" rel="noopener">${esc(f)}</a>`
      ).join("");
    return;
  }
  let rows = [];
  if (tab === "hello") {
    rows = group.filter((r) => /hello|check-in|roll call|meeting|present/i.test(String(r.text || "")));
    if (!rows.length) rows = group.slice(-40);
  } else if (tab === "work") {
    rows = group.filter((r) => r.agent === "cursor-engineer" || r.agent === "sam");
  } else {
    rows = bus.filter((r) => r.kind === "converse" || r.kind === "rm_queue");
  }
  box.innerHTML = rows.map((r) =>
    bubble(r.agent || r.from, r.ts, r.text || r.kind)
  ).join("") || `<div class="render-agent-empty"><strong>No messages in this thread.</strong></div>`;
  box.scrollTop = box.scrollHeight;
}

async function postAsSam(ev) {
  ev.preventDefault();
  const input = document.getElementById("hw-render-agent-input");
  const status = document.getElementById("hw-render-agent-status");
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
  group = await loadJsonl("/docs/media/group-chat.jsonl");
  tab = "work";
  paint();
}

async function mount() {
  if (!document.getElementById("hello-work-panel")) return;
  document.querySelectorAll("[data-hw-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tab = btn.getAttribute("data-hw-tab") || "hello";
      paint();
    });
  });
  const input = document.getElementById("hw-render-agent-input");
  const grow = () => {
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(140, Math.max(40, input.scrollHeight))}px`;
  };
  input?.addEventListener("input", grow);
  grow();
  document.getElementById("hw-render-agent-form")?.addEventListener("submit", postAsSam);
  group = await loadJsonl("/docs/media/group-chat.jsonl");
  bus = await loadJsonl("/docs/media/bus-broadcast-20260916.jsonl");
  paint();
}

mount();
