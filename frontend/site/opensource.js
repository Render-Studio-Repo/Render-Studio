/** Reference-files dashboard for /opensource. */
const INDEX = "/docs/media/PERFORMANCE-20260916.json";

const FILES = [
  { path: "/docs/media/PERFORMANCE-20260916.json", label: "Performance vote JSON", kind: "stats" },
  { path: "/docs/media/CREW-REPORT-20260916.pdf", label: "Crew report PDF", kind: "report" },
  { path: "/docs/media/WHITE-PAPER-AGENT-BUS.pdf", label: "Agent-bus white paper PDF", kind: "paper" },
  { path: "/white-paper.html#performance", label: "White paper · Performance tab", kind: "ui" },
  { path: "/Getting-Started/agents/KEY-INDEX.md", label: "Key index (names only)", kind: "ops" },
  { path: "https://docs.google.com/document/d/1eGPrYnHZCFU9aIyzCho58TvATI3x87I76gpgPHR9V_4/edit", label: "RnD experiment log (Drive)", kind: "rnd" },
  { path: "https://docs.google.com/document/d/1XP0_1CJ_OBjiiq-L9F25uOGS53-xWZcryhCKKHr-kog/edit", label: "RnD research — best next agent", kind: "rnd" },
];

function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  });
  kids.forEach((c) => n.append(c));
  return n;
}

async function boot() {
  const list = document.getElementById("os-files");
  const stats = document.getElementById("os-stats");
  if (list) {
    FILES.forEach((f) => {
      list.append(
        el("li", {}, [
          el("a", { href: f.path, text: f.label }),
          el("span", { class: "muted small", text: ` ${f.kind}` }),
        ]),
      );
    });
  }
  if (!stats) return;
  try {
    const res = await fetch(INDEX, { credentials: "same-origin" });
    const data = await res.json();
    stats.innerHTML = "";
    const failN = Object.keys(data.failures || {}).length;
    const okN = Object.keys(data.original_success || {}).length;
    stats.append(
      el("p", { text: `Success fields ${okN} · failure fields ${failN} · live tweets ${data.failures?.live_tweets ?? "?"}` }),
      el("p", { class: "muted small", text: `This chat: ${data.model?.this_chat}. Grok bot specialists: ${data.model?.grok_bot_default}.` }),
    );
    const table = el("table");
    table.innerHTML = "<thead><tr><th>Who</th><th>%</th><th>Why</th></tr></thead>";
    const body = el("tbody");
    (data.rank || []).forEach((r) => {
      const tr = el("tr");
      tr.append(el("td", { text: r.who }), el("td", { text: String(r.value) }), el("td", { text: r.why }));
      body.append(tr);
    });
    table.append(body);
    stats.append(table);
    try {
      const live = await fetch("/mcp/sandbox/tasks", { credentials: "same-origin" });
      if (live.ok) {
        const feed = await live.json();
        const pre = el("pre", { class: "sb1-code", text: JSON.stringify({
          token: feed.token || "rnddemo1",
          keep: feed.keep,
          live: true,
          tasks: (feed.tasks || []).slice(-12),
          byAgent: feed.byAgent || {},
        }, null, 2) });
        stats.append(el("p", { class: "muted small", text: "Live data feed · agent tasks (rnddemo1)" }), pre);
      }
    } catch {
      /* sandbox MCP optional on /opensource */
    }
  } catch (err) {
    stats.textContent = "Could not load performance JSON.";
  }
}

boot();
