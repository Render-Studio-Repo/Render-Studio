/** In-office IDE: mirrors Team chat pad + agent profiles. Write on /team-chat.html. */
const TRACE = "/docs/media/office-model-trace.sh";

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadPad() {
  const res = await fetch("/mcp/collab-pad?t=" + Date.now()).catch(() => null);
  if (res && res.ok) return res.json();
  return { pad: {} };
}

async function mount() {
  const host = document.getElementById("office-editor");
  if (!host || host.dataset.ready === "1") return;
  host.dataset.ready = "1";
  host.innerHTML = `
    <p class="muted small">Office IDE · same pad as Team chat. Click a desk for who. Contribute on <a href="/team-chat.html">/team-chat.html</a> with CODE @pad. Index writes: grok_collab_index / GET /mcp/collab-index.</p>
    <div id="office-ide-profiles" class="muted small"></div>
    <div id="office-collab-ticker" class="muted small"></div>
    <div class="prompt-editor-wrap is-focused">
      <textarea class="prompt-editor" id="office-trace-src" spellcheck="false" readonly></textarea>
    </div>
  `;
  const ta = host.querySelector("#office-trace-src");
  const prof = host.querySelector("#office-ide-profiles");
  const ticker = host.querySelector("#office-collab-ticker");
  async function paint() {
    const data = await loadPad();
    const pad = data.pad || {};
    if (pad.body) ta.value = pad.body;
    else if (!ta.value) {
      try { ta.value = await (await fetch(TRACE, { credentials: "same-origin" })).text(); }
      catch { ta.value = "# pad empty — CODE @pad on team-chat"; }
    }
    const profiles = pad.profiles || {};
    const keys = Object.keys(profiles);
    prof.innerHTML = keys.length
      ? "profiles: " + keys.map((k) => `${esc(k)} rev ${esc(profiles[k].last_rev)}`).join(" · ")
      : (pad.log || []).map((r) => `rev ${esc(r.rev)} ${esc(r.agent)}`).join(" · ") || "no pad revs yet";
    if (ticker) {
      const idxRes = await fetch("/mcp/collab-index?t=" + Date.now()).catch(() => null);
      if (idxRes && idxRes.ok) {
        const idx = await idxRes.json();
        const files = (idx.index || idx).files || [];
        ticker.textContent = `collab-index ${files.length} files · ` + files.slice(-4).map((f) => `${esc(f.path)} (${esc(f.agent)})`).join(" · ");
      } else {
        ticker.textContent = "collab-index not reachable (404 ⇒ Sam recycle grok-bot).";
      }
    }
  }
  await paint();
  setInterval(paint, 5000);
}

mount();
