/** Bot bench panel. */

import { benchAgents, pushBestSet, BOTBENCH1_TOKEN } from "./agent-bench-board.js?v=20260923-draw-recordings1";
import { crewSnapshot } from "./agent-score-rubrics.js?v=crewscore1";

export function mountBenchBoard(host) {
  if (!host) return null;
  host.classList.add("sb-bench");
  host.innerHTML = `
    <div class="sb-crew-floor-head">
      <span class="sb-kicker">BOT BENCH · ${BOTBENCH1_TOKEN}</span>
      <label>Runs <input type="number" min="1" max="8" value="3" data-bench-runs /></label>
      <button type="button" class="sb-agent-btn" data-bench-run>Run bench</button>
      <button type="button" class="sb-agent-btn" data-bench-push>Push best set</button>
      <button type="button" class="sb-agent-btn" data-bench-daily>Daily ping</button>
      <span class="muted small" data-bench-avg></span>
    </div>
    <ol class="sb-bench-list" data-bench-list></ol>
  `;
  let last = null;
  const list = host.querySelector("[data-bench-list]");
  const avgEl = host.querySelector("[data-bench-avg]");
  const snap = () => crewSnapshot(host.ownerDocument || globalThis.document);
  const paint = (bench) => {
    last = bench;
    if (avgEl) avgEl.textContent = `avg ${bench.avg} · best ${bench.best_set.join(", ")}`;
    if (list) {
      const rows = bench.table || bench.rows || [];
      list.innerHTML = rows.map((r) => {
        const d = r.delta == null ? "" : ` Δ${r.delta >= 0 ? "+" : ""}${r.delta}`;
        return `<li><strong>${r.name}</strong> ${r.score}${d} ${r.label} — ${r.change || r.detail || ""}</li>`;
      }).join("");
    }
  };
  host.querySelector("[data-bench-run]").addEventListener("click", () => {
    const runs = Number(host.querySelector("[data-bench-runs]").value || 3);
    paint(benchAgents({ runs, snapshot: snap() }));
  });
  host.querySelector("[data-bench-push]").addEventListener("click", async () => {
    const source = last?.rows ? last : last?.table ? { ...last, rows: last.table } : null;
    const bench = source || benchAgents({
      runs: Number(host.querySelector("[data-bench-runs]").value || 3),
      snapshot: snap(),
    });
    paint(bench);
    const out = await pushBestSet(bench);
    if (avgEl) avgEl.textContent = `${avgEl.textContent} · ${out.ok ? "pushed" : "push failed"}`;
  });
  host.querySelector("[data-bench-daily]").addEventListener("click", async () => {
    const { maybePingDailyCrew } = await import("./render-agent-crew-score.js?v=20260923-draw-recordings1");
    const out = await maybePingDailyCrew({
      announce: () => {
        if (avgEl) avgEl.textContent = "Render Agent ping queued";
      },
      force: true,
      root: host.ownerDocument,
    });
    paint(out);
    const n = out.distributed?.tasks?.length || 0;
    if (avgEl) {
      avgEl.textContent = `daily ${out.day} avg ${out.avg} Δ${out.avg_delta >= 0 ? "+" : ""}${out.avg_delta} · ${n} tasks`;
    }
  });
  paint(benchAgents({ runs: 3, snapshot: snap() }));
  return { run: () => paint(benchAgents({ runs: 3, snapshot: snap() })) };
}
