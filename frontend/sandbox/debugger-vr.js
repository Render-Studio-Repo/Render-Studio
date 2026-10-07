/**
 * Debugger VR — enter with bots, live control analysis + live code gen.
 * Token dbgvr1. No extra WebGL (uses live poll + File IDE hooks).
 */

import { createXrLiveControlClient, XRCTRL2_CACHE } from "./xr-control-live.js?v=xrctrl2&sbfix=20260917-2";
import { assignTask } from "./agent-tasks.js?v=20260923-draw-recordings1";
import { enterSandboxVr, exitSandboxVr, VR_BOT_SEATS, sandboxControlObservation } from "./sandbox-xr-enter.js?v=20260923-draw-recordings1&vrrobot=20260927-2";
import { vrEnabledPanes } from "./sandbox-layout.js?v=sbdbg1";

export const DBGVR1_TOKEN = "dbgvr1";

const CONTROL_STARTER = `/** Live VR controls analysis stub — sandbox only */
export const CONTROLS_TOKEN = "xrctrl2";

export function analyzeBindings(doc = {}) {
  const hid = doc.headset || "quest3";
  const map = doc.profiles?.[hid] || doc.map || doc.bindings || {};
  return {
    token: CONTROLS_TOKEN,
    headset: hid,
    trigger: map.trigger?.btn ?? 0,
    squeeze: map.squeeze?.btn ?? 1,
    dimos: doc.session?.dimos || "ui-beats-overlay",
    rev: doc.rev || 0,
    verification: "unverified",
    issues: ["Configuration only: reproduce trigger and squeeze actions on both physical controllers"],
  };
}

export async function suggestFix(analysis = {}) {
  // Cursor / Investigator extend this while Debugger VR is live.
  return { ok: false, status: "unverified", analysis, patch: null };
}
`;

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function mcpWrite(path, text, agent = "cursor") {
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", agent, path, text: String(text ?? "").slice(0, 200_000) }),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false, detail: res ? `HTTP ${res.status}` : "network" };
  return { ok: true, ...(await res.json().catch(() => ({}))) };
}

export function mountDebuggerVr(host, { speak } = {}) {
  if (!host) return null;
  if (host.dataset.ready === "1") return host._dbgVrApi || null;
  host.dataset.ready = "1";
  host.dataset.token = DBGVR1_TOKEN;
  host.classList.add("sb-dbg-vr");

  host.innerHTML = `
    <header class="sb-dbg-vr-head">
      <div>
        <span class="sb-kicker">DEBUGGER VR · ${DBGVR1_TOKEN}</span>
        <p class="muted small">Enter VR with bots (mirrors the one Studio viewport — no second XR). Live control poll (${XRCTRL2_CACHE}) · generate analysis code for trigger/squeeze issues.</p>
      </div>
      <div class="sb-dbg-vr-actions">
        <button type="button" class="sb-agent-btn" data-dbg-enter aria-pressed="false">Enter VR with bots</button>
        <button type="button" class="sb-agent-btn" data-dbg-live aria-pressed="false">Live controls</button>
        <button type="button" class="sb-agent-btn" data-dbg-gen>Analysis draft</button>
        <button type="button" class="sb-agent-btn" data-dbg-save>Save analysis</button>
        <button type="button" class="sb-agent-btn sb-agent-btn--repair" data-dbg-repair>Route → Repair</button>
        <span class="muted small" data-dbg-status role="status">Idle</span>
      </div>
    </header>
    <pre class="sb-dbg-vr-live" data-dbg-doc>No live doc yet — hit Live controls.</pre>
    <textarea class="sb-dbg-vr-editor" data-dbg-editor spellcheck="false" placeholder="// Live-generated controls analysis…"></textarea>
  `;

  const status = host.querySelector("[data-dbg-status]");
  const docEl = host.querySelector("[data-dbg-doc]");
  const editor = host.querySelector("[data-dbg-editor]");
  const setStatus = (m) => { if (status) status.textContent = m; };

  const client = createXrLiveControlClient({
    applyDoc: (doc) => {
      if (docEl) {
        docEl.textContent = JSON.stringify({
          rev: doc.rev,
          headset: doc.headset,
          session: doc.session,
          map: doc.profiles?.[doc.headset || "quest3"] || doc.map || doc.bindings,
        }, null, 2);
      }
    },
  });

  host.querySelector("[data-dbg-enter]")?.addEventListener("click", async () => {
    const btn = host.querySelector("[data-dbg-enter]");
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) {
      client.start();
      host.querySelector("[data-dbg-live]")?.setAttribute("aria-pressed", "true");
      ["astra", "cursor-engineer", "vibe-rnd", "investigator"].forEach((id) => {
        assignTask(id, "Reproduce Sandbox button failures. Check Ask Astra, local microphone, VR entry/exit/reentry, left/right trigger and squeeze, and editor load/save. Report expected vs actual, source path, timestamp, evidence, and smallest proposed fix to the engineering queue. Config or HTTP success is not interaction proof. Keep headset-only checks unknown without physical evidence; never operate robots to test UI.", { from: "debugger-vr" });
      });
      setStatus("Entering with bots…");
      const xr = await enterSandboxVr({
        withBots: true,
        onStatus: setStatus,
        onEnd: () => {
          btn.setAttribute("aria-pressed", "false");
          client.stop();
          host.querySelector("[data-dbg-live]")?.setAttribute("aria-pressed", "false");
        },
      });
      if (xr?.ok) {
        const docks = vrEnabledPanes().map((p) => p.id).join(",");
        setStatus(xr.mirrored || xr.desktop
          ? `Desktop bots room · ${VR_BOT_SEATS.length} seated · panes ${docks}`
          : `VR live · bots seated · panes ${docks}`);
      } else if (xr?.opened) {
        setStatus("Opened Studio Enter VR — continue on Quest");
      } else {
        btn.setAttribute("aria-pressed", "false");
        client.stop();
        host.querySelector("[data-dbg-live]")?.setAttribute("aria-pressed", "false");
      }
      try {
        window.dispatchEvent(new CustomEvent("render3d-sandbox-debugger-vr", {
          detail: { open: true, token: DBGVR1_TOKEN, xr: !!xr?.ok },
        }));
      } catch { /* optional */ }
      if (typeof speak === "function") {
        await speak("astra", xr?.ok
          ? "Room open. Control review tasks are queued; they are not yet verified."
          : "VR entry needs Quest Browser or Studio Enter VR.");
      }
    } else {
      await exitSandboxVr();
      client.stop();
      host.querySelector("[data-dbg-live]")?.setAttribute("aria-pressed", "false");
      setStatus("Debugger VR closed");
      try {
        window.dispatchEvent(new CustomEvent("render3d-sandbox-debugger-vr", {
          detail: { open: false, token: DBGVR1_TOKEN },
        }));
      } catch { /* optional */ }
    }
  });

  host.querySelector("[data-dbg-live]")?.addEventListener("click", async () => {
    const btn = host.querySelector("[data-dbg-live]");
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) {
      client.start();
      const doc = await client.pull();
      setStatus(doc ? `Live rev ${doc.rev || 0}` : "Live poll started — waiting for doc");
    } else {
      client.stop();
      setStatus("Live controls stopped");
    }
  });

  host.querySelector("[data-dbg-gen]")?.addEventListener("click", async () => {
    if (editor.value && !window.confirm("Replace the current analysis draft?")) return;
    const previous = editor.value;
    setStatus("Preparing configuration snapshot...");
    const doc = client.last() || await client.pull();
    const path = "examples/vr-controls-analysis.js";
    let body = CONTROL_STARTER;
    if (doc) {
      body += `\n\nexport const LAST_LIVE = ${JSON.stringify({
        rev: doc.rev,
        headset: doc.headset,
        session: doc.session,
        at: new Date().toISOString(),
      }, null, 2)};\n`;
    }
    body += `\nexport const OBSERVED_INPUT = ${JSON.stringify(sandboxControlObservation(), null, 2)};\n`;
    if (editor.value !== previous) { setStatus("Draft changed; snapshot not applied"); return; }
    editor.value = body;
    assignTask("cursor-engineer", `Live gen → ${path} for controls issue`, { from: "debugger-vr-gen" });
    assignTask("investigator", "Discriminate trigger map vs squeeze vs DIMOS overlay", { from: "debugger-vr-gen" });
    setStatus("Analysis draft ready; not saved or executed");
  });

  host.querySelector("[data-dbg-save]").addEventListener("click", async event => {
    const button = event.currentTarget;
    if (!editor.value.trim()) { setStatus("Prepare an analysis draft first"); return; }
    button.disabled = true;
    try {
      const out = await mcpWrite("examples/vr-controls-analysis.js", editor.value, "sam");
      setStatus(out.ok ? "Analysis saved; not executed" : `Save failed: ${out.detail || out.error || "rejected"}`);
    } finally { button.disabled = false; }
  });

  host.querySelector("[data-dbg-repair]")?.addEventListener("click", async () => {
    setStatus("Routing to Repair loop…");
    try {
      const { setRepairTableOpen } = await import("./repair-table.js?v=repair1");
      const { setSandboxOpen, isSandboxOpen } = await import("./studio-window.js?v=20260923-draw-recordings1&singlevoice1&vrrobot=20260927-2");
      if (isSandboxOpen()) setSandboxOpen(false);
      setRepairTableOpen(true);
      const panel = document.querySelector("#sb-page-repair");
      if (panel) {
        panel.hidden = false;
        const { paintRepairPanel, runRepairLoop } = await import("./repair-loop.js?v=20260923-draw-recordings1&vrrobot=20260927-2");
        paintRepairPanel(panel, null);
        const report = await runRepairLoop("Debugger VR — VR controls issue analysis");
        paintRepairPanel(panel, report);
      }
      document.querySelector("[data-sb-repair]")?.setAttribute("aria-pressed", "true");
      setStatus("Repair loop running from Debugger VR");
    } catch (err) {
      setStatus(`Repair route failed · ${String(err?.message || err).slice(0, 60)}`);
    }
  });

  const api = {
    token: DBGVR1_TOKEN,
    client,
    destroy: () => client.stop(),
  };
  host._dbgVrApi = api;
  return api;
}
