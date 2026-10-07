/** Pad mirror — copied from office-editor.js, sandbox host ids only. */
const TRACE = "/docs/media/office-model-trace.sh";

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function mountPad(host) {
  if (!host || host.dataset.ready === "1") return;
  host.dataset.ready = "1";
  host.innerHTML = `
    <p class="muted small">Sandbox pad view. Contribute with CODE @pad on <a href="/team-chat.html">/team-chat.html</a>.</p>
    <div id="sb-pad-profiles" class="muted small"></div>
    <textarea id="sb-pad-src" readonly spellcheck="false" style="width:100%;min-height:180px;background:#0d1117;color:#c9d1d9;border:1px solid #30363d"></textarea>
  `;
  const ta = host.querySelector("#sb-pad-src");
  const prof = host.querySelector("#sb-pad-profiles");
  async function paint() {
    const res = await fetch("/mcp/collab-pad?t=" + Date.now()).catch(() => null);
    const data = res && res.ok ? await res.json() : { pad: {} };
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
  }
  paint();
  setInterval(paint, 5000);
}
