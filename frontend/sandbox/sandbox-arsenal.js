/** Knowledge arsenal list — weekly bot scores for marketplace later. Token kb1. */

import { knowledgeStatus } from "./agent-knowledge.js?v=kb1-fallback1&teleop-y=20260922-poseconnect1";

export async function mountArsenal(host) {
  if (!host) return null;
  host.classList.add("sb-arsenal");
  host.innerHTML = `
    <div class="sb-crew-floor-head">
      <span class="sb-kicker">ARSENAL · knowledge lake</span>
      <button type="button" class="sb-agent-btn" data-ars-refresh>Refresh</button>
      <span class="muted small" data-ars-status>Hot catalog · 8TB when mounted</span>
    </div>
    <pre class="sb-arsenal-pre" data-ars-body>Loading…</pre>
  `;
  const paint = async () => {
    const st = await knowledgeStatus();
    const body = host.querySelector("[data-ars-body]");
    if (st.fallback) {
      const status = host.querySelector("[data-ars-status]");
      if (status) status.textContent = "Local hot files · restart Studio API to mount /api/agent-knowledge";
    }
    if (body) {
      body.textContent = JSON.stringify({
        total: st.total,
        counts: st.counts,
        need_8tb: st.need_8tb,
        hot: st.layout?.hot,
        agents: (st.layout?.agents || []).slice(0, 12),
      }, null, 2);
    }
  };
  host.querySelector("[data-ars-refresh]").addEventListener("click", () => void paint());
  await paint();
  return { refresh: paint };
}
