/** Extra debugger overlay vs prod Office. */
import { debugState, onDebug, getJson, bump } from "./bus.js";
import { probeSpeech, refreshVoices } from "./voice.js";

export function mountDebugger(host) {
  if (!host || host.dataset.ready === "1") return;
  host.dataset.ready = "1";
  probeSpeech();
  function paint(st) {
    const fail = !st.synthOk || !st.recOk || !!st.lastFetchError;
    host.className = "sb-debug" + (fail ? " fail" : "");
    const chips = (st.logIds || []).map((id) => `<button type="button" class="sb-chip" data-copy="${id}">${id}</button>`).join("");
    host.innerHTML = `
      <h3>Sandbox debugger</h3>
      <div class="row"><span class="k">instance_public_factor</span> = ${st.factor} (banner: no other developer instances)</div>
      <div class="row"><span class="k">TOTP</span> never stored · never shown</div>
      <div class="row"><span class="k">SpeechSynthesis</span> ${st.synthOk ? "ok" : "<span class=\"err\">FAIL missing</span>"}</div>
      <div class="row"><span class="k">SpeechRecognition</span> ${st.recOk ? "ok" : "<span class=\"err\">FAIL missing</span>"}</div>
      <div class="row"><span class="k">COMM-MISS</span> ${st.commMiss ?? "—"} · REPORT n=${st.reportsN ?? "?"} avg=${st.reportsAvg ?? "?"}</div>
      <div class="row"><span class="k">last STT</span> ${st.lastStt || "—"}</div>
      <div class="row"><span class="k">last TTS</span> ${st.lastTts || "—"}</div>
      <div class="row ${st.lastFetchError ? "err" : ""}"><span class="k">last fetch error</span> ${st.lastFetchError || "—"}</div>
      <div class="sb-chips">${chips || "<span class='k'>no log_id yet</span>"}</div>
      <div class="row"><span class="k">REPORT retrieval</span> GET /mcp/reports</div>
      <div class="row">
        <button type="button" class="sb-chip" data-rig-act="fix_wheels">Fix wheels</button>
        <button type="button" class="sb-chip" data-rig-act="qc_rig">QC rig</button>
        <span class="k">rigqc1 · clip-bot seat · auto_apply=0</span>
      </div>
      <ul class="sb-log">${(st.lastReports || []).map((r) => `<li>${r.ping || ""} ${r.agent || ""} score=${r.result_score ?? "?"} ${r.log_id || ""}</li>`).join("") || "<li>no REPORT rows yet</li>"}</ul>
      <div class="sb-voices">${(st.voices || []).join("\n") || "voices: (empty until voiceschanged)"}</div>
    `;
    host.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.onclick = () => navigator.clipboard?.writeText(btn.getAttribute("data-copy") || "");
    });
    host.querySelectorAll("[data-rig-act]").forEach((btn) => {
      btn.onclick = async () => {
        const action = btn.getAttribute("data-rig-act") || "qc_rig";
        try { window.dispatchEvent(new CustomEvent(action === "fix_wheels" ? "render-studio:fix-wheels" : "render-studio:qc-rig", { detail: {} })); } catch { /* studio */ }
        await fetch("/api/xr/round-table", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action, auto_apply: false, token: "rigqc1" }),
        }).catch(() => null);
      };
    });
  }
  onDebug(paint);
  if (window.speechSynthesis) window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
  async function pollReports() {
    const stats = await getJson("/mcp/stats?t=" + Date.now());
    const reports = await getJson("/mcp/reports?t=" + Date.now());
    bump({
      commMiss: stats?.repair_loop?.comm_miss_mentions ?? null,
      reportsN: stats?.reports?.n ?? null,
      reportsAvg: stats?.reports?.avg_score ?? null,
      lastReports: (reports?.reports || []).slice(-6),
    });
  }
  pollReports();
  setInterval(pollReports, 5000);
}
