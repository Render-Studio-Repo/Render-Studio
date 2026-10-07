const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function paint(root, data) {
  const agents = data.agents || [];
  const goals = (data.goals || []).map((g, i) => `<li>${esc(g)}</li>`).join("");
  const ask = data.question || data.suggestion || "";
  root.innerHTML = `
    <header class="info-hero">
      <p class="info-eyebrow">Pulse #${esc(data.tick)} · ${esc(data.remaining_label)} to 7pm</p>
      <h2>Team chat</h2>
      <p class="team-chat-score">${esc(data.team_score)} / 100 <span class="muted">${esc(data.team_label)}</span> <span class="team-chat-delta">${esc(data.team_delta_dir || "FLAT")} ${esc((data.team_delta > 0 ? "+" : "") + (data.team_delta ?? 0))}</span></p>
      <p class="team-chat-meta">Cursor ${esc(data.cursor_score ?? "—")} ${esc(data.cursor_delta_dir || "FLAT")} · Bender ${esc(data.bender || "—")} · Rick ${esc(data.rick || "—")} · likely Bender ${esc(data.most_likely_bender || "—")} · likely Rick ${esc(data.most_likely_rick || "—")}</p>
      <p class="team-chat-meta">${esc(data.headcount && data.headcount.label)} · messages ${esc(data.messages_sent)} · extra agent ${esc(data.extra_agent)}</p>
    </header>
    <section>
      <h3>3 goals told to the PM</h3>
      <ol class="team-chat-goals">${goals}</ol>
      <p><strong>Overall:</strong> ${esc(data.overall)}</p>
      <p><strong>PM lines:</strong> ${esc(data.pm_goals || "(waiting on project-manager)")}</p>
    </section>
    <section>
      <h3>This pulse</h3>
      <p><strong>Liked:</strong> ${esc(data.liked)}</p>
      <p><strong>Disliked:</strong> ${esc(data.disliked)}</p>
      <p><strong>Need:</strong> ${esc(ask)}</p>
      <p class="team-chat-meta">${esc(data.instructions)}</p>
    </section>
    <section class="team-chat-grid">
      ${agents.map((a) => `<article class="team-chat-row"><strong>${esc(a.agent)}</strong> ${esc(a.score)} ${esc(a.label)} · ${esc(a.vote || "—")}</article>`).join("")}
    </section>
    <p class="team-chat-meta">Source <a href="/mcp/team-chat"><code>/mcp/team-chat</code></a> · watchdog <a href="/mcp/watchdog/headcount"><code>/mcp/watchdog</code></a></p>
  `;
}

async function load() {
  const root = document.getElementById("team-chat-root");
  if (!root) return;
  try {
    const res = await fetch("/mcp/team-chat", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("team-chat " + res.status);
    paint(root, await res.json());
  } catch (err) {
    root.innerHTML = `<p class="muted">Team chat failed: ${esc(err.message)}. Recycle grok-bot.</p>`;
  }
}

load();
setInterval(load, 15000);
