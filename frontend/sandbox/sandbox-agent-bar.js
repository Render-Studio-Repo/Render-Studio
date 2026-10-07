/** Sandbox page agent bar: Record reference, Sandbox, Repair, Astra, crew. Token ctxlog1. */

import { createSandboxContextCapture, postContextEvent } from "./sandbox-context-log.js?v=ctxlog1";
import { createVrReferenceCapture } from "./vr-reference-capture.js?v=workspace3-ctxlog1";
import { REPAIR_AGENTS, toggleRepairTable, setRepairTableOpen, isRepairTableOpen } from "./repair-table.js?v=repair1";
import { paintRepairPanel, runRepairLoop } from "./repair-loop.js?v=20260923-draw-recordings1&vrrobot=20260927-2";
import { getSharedTrainingLoop } from "./openarm-training-loop.js?v=20260923-draw-recordings1&simrun=20260923-1";
import { mountAskAstra } from "./ask-astra.js?v=20260923-draw-recordings1";
import { enterSandboxVr, exitSandboxVr, VR_BOT_SEATS } from "./sandbox-xr-enter.js?v=20260923-draw-recordings1&vrrobot=20260927-2";
import { assignTask } from "./agent-tasks.js?v=20260923-draw-recordings1";

export const AGENTBAR1_TOKEN = "agentbar1";

const CREW_BTNS = [
  { id: "astra", label: "Astra", ask: "Hey Astra — log context and help repair." },
  { id: "cursor", label: "Cursor", ask: "Sandbox-only engineering." },
  { id: "rnd", label: "RnD", ask: "OpenArm 2.0 teleop experiments." },
  { id: "analytics", label: "Analytics", ask: "Pull /mcp/stats." },
  ...REPAIR_AGENTS.slice(0, 3).map((a) => ({ id: a.id, label: a.label, ask: a.ask })),
];

export function mountSandboxAgentBar(host, { speak } = {}) {
  if (!host) return null;
  host.classList.add("sb-agent-bar");
  host.innerHTML = `
    <div class="sb-agent-bar-row">
      <span class="sb-kicker">VR · AGENT CONTROLS</span>
      <button type="button" class="sb-agent-btn" data-sb-record aria-pressed="false" title="Record click/context reference">Record reference</button>
      <button type="button" class="sb-agent-btn" data-sb-remix title="Import a 3D project tree as a sandbox remix">Remix import</button>
      <button type="button" class="sb-agent-btn" data-sb-sandbox aria-pressed="false" title="Start sandbox change map">Sandbox</button>
      <button type="button" class="sb-agent-btn sb-agent-btn--repair" data-sb-repair aria-pressed="false" title="Repair Table">Repair</button>
      <button type="button" class="sb-agent-btn sb-agent-btn--astra" data-sb-astra title="Open Astra chat">Ask Astra</button>
      <button type="button" class="sb-agent-btn sb-agent-btn--astra" data-sb-enter-vr aria-pressed="false" title="Enter VR / desktop bots room with the crew">Enter VR with bots</button>
      <button type="button" class="sb-agent-btn" data-sb-train-demo aria-pressed="false" title="Record synced MuJoCo demo for imitation">Train demo</button>
      <button type="button" class="sb-agent-btn" data-sb-train-policy title="Record a policy try for holdout">Policy try</button>
      <button type="button" class="sb-agent-btn" data-sb-train-ok title="Mark episode success">✓ Success</button>
      <button type="button" class="sb-agent-btn" data-sb-train-fail title="Mark episode fail + intervene">✗ Fail</button>
      <span class="sb-agent-status" id="sb-agent-bar-status" role="status">Idle</span>
    </div>
    <div class="sb-agent-crew" role="group" aria-label="Agents">${CREW_BTNS.map((c) =>
      `<button type="button" class="sb-agent-chip" data-agent="${c.id}" title="${c.ask.replace(/"/g, "")}">${c.label}</button>`).join("")}</div>
    <div id="sb-ask-astra" class="sb-ask-astra-slot" hidden></div>
    <div id="sb-page-repair" class="sb-page-repair" hidden></div>
  `;

  const status = () => host.querySelector("#sb-agent-bar-status");
  const setStatus = (msg) => { if (status()) status().textContent = msg; };

  const askApi = mountAskAstra(host.querySelector("#sb-ask-astra"), { speak });

  const pageCapture = createSandboxContextCapture({
    source: "sandbox-page",
    onStatus: setStatus,
  });
  const xrCapture = createVrReferenceCapture({
    onStatus: setStatus,
  });

  // Dual-write VR flush into context-log as well.
  const origFlush = xrCapture.flush.bind(xrCapture);
  xrCapture.flush = async () => {
    const ok = await origFlush();
    const summary = xrCapture.summary();
    try {
      await postContextEvent({
        source: "sandbox-vr-capture",
        feature_id: "vr.reference",
        event_kind: "flush",
        target_id: "xr-batch",
        edge_summary: Object.entries(summary.edges || {}).map(([k, v]) => `${k}:${v}`).join(","),
        tool_summary: Object.entries(summary.tools || {}).map(([k, v]) => `${k}:${v}`).join(","),
        context: { samples: String(summary.samples || 0) },
      });
    } catch { /* optional */ }
    return ok;
  };

  const logClick = (targetId, kind = "click", extra = {}) => {
    void postContextEvent({
      source: "sandbox-agent-bar",
      feature_id: "sandbox.ui.click",
      event_kind: kind,
      target_id: targetId,
      context: { href: "/sandbox/", xr: "0", ...extra },
    });
  };

  host.querySelector("[data-sb-record]")?.addEventListener("click", () => {
    const btn = host.querySelector("[data-sb-record]");
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    logClick("RecordReference", on ? "record_on" : "record_off");
    if (on) {
      pageCapture.start();
      xrCapture.start();
    } else {
      pageCapture.stop();
      xrCapture.stop();
    }
  });

  host.querySelector("[data-sb-remix]")?.addEventListener("click", async () => {
    setStatus("Remix — picking project…");
    try {
      const { pickAndImportRemix } = await import("./sandbox-remix.js?v=remix1");
      const out = await pickAndImportRemix();
      if (!out?.ok) {
        setStatus(out?.reason === "cancelled" ? "Remix cancelled" : `Remix failed · ${out?.reason || "error"}`);
        return;
      }
      setStatus(`Remix ${out.remixId} · ${out.fileCount} pointers · ${out.chunkCount} chunks`);
      logClick("RemixImport", "remix_create", { remix: out.remixId });
    } catch (err) {
      setStatus(`Remix error · ${String(err?.message || err).slice(0, 80)}`);
    }
  });

  host.querySelector("[data-sb-sandbox]")?.addEventListener("click", () => {
    const api = window.Render3DSandbox;
    if (api?.toggle) {
      const out = api.toggle();
      host.querySelector("[data-sb-sandbox]")?.setAttribute("aria-pressed", out?.visible ? "true" : "false");
      if (out?.visible) {
        // Sandbox on → kill Repair until you leave.
        setRepairTableOpen(false);
        const panel = host.querySelector("#sb-page-repair");
        if (panel) panel.hidden = true;
        host.querySelector("[data-sb-repair]")?.setAttribute("aria-pressed", "false");
      }
      setStatus(out?.visible ? "Sandbox map on · Repair closed" : "Sandbox map off · reverted");
      logClick("Sandbox", out?.visible ? "sandbox_on" : "sandbox_off");
      return;
    }
    setStatus("Sandbox overlay API not loaded — open Studio for full map");
    logClick("Sandbox", "sandbox_unavailable");
  });

  host.querySelector("[data-sb-repair]")?.addEventListener("click", async () => {
    const next = toggleRepairTable();
    const panel = host.querySelector("#sb-page-repair");
    const btn = host.querySelector("[data-sb-repair]");
    btn?.setAttribute("aria-pressed", next.visible ? "true" : "false");
    logClick("Repair", next.visible ? "repair_on" : "repair_off");
    if (next.visible) {
      // Repair on → kill Sandbox until you leave.
      try {
        if (window.Render3DSandbox?.isOpen?.()) window.Render3DSandbox.close();
        host.querySelector("[data-sb-sandbox]")?.setAttribute("aria-pressed", "false");
      } catch { /* optional */ }
    }
    if (panel) {
      panel.hidden = !next.visible;
      if (next.visible) {
        paintRepairPanel(panel, null);
        const report = await runRepairLoop("Sandbox page Repair — why can't proceed");
        paintRepairPanel(panel, report);
      }
    }
  });

  const openAstraChat = (detail = {}) => {
    if (detail.question) askApi?.setQuestion?.(detail.question);
    askApi?.focus();
    setStatus("Astra chat opened");
    logClick("AskAstra", "open");
    if (detail.autoAsk && detail.question) {
      void askApi?.ask?.(detail.question, { context: detail.context });
    }
  };
  host.querySelector("[data-sb-astra]")?.addEventListener("click", () => openAstraChat());
  window.addEventListener("render3d-sandbox-open-astra", (ev) => openAstraChat(ev.detail || {}));

  host.querySelector("[data-sb-enter-vr]")?.addEventListener("click", async () => {
    const btn = host.querySelector("[data-sb-enter-vr]");
    const on = btn?.getAttribute("aria-pressed") !== "true";
    logClick("EnterVRWithBots", on ? "enter" : "exit");
    if (!on) {
      await exitSandboxVr();
      btn?.setAttribute("aria-pressed", "false");
      setStatus("Left bots room");
      return;
    }
    btn?.setAttribute("aria-pressed", "true");
    for (const bot of VR_BOT_SEATS) {
      assignTask(bot.id, "Entered bots room with Sam — stand by for VR / repair cues", { from: "enter-vr-bots" });
    }
    setStatus("Seating bots…");
    const out = await enterSandboxVr({
      withBots: true,
      onStatus: setStatus,
      onEnd: () => btn?.setAttribute("aria-pressed", "false"),
    });
    if (!out?.ok) {
      btn?.setAttribute("aria-pressed", "false");
      return;
    }
    setStatus(out.desktop
      ? `Bots room · ${VR_BOT_SEATS.length} seated (desktop)`
      : `VR live · ${VR_BOT_SEATS.length} bots seated`);
  });

  const train = getSharedTrainingLoop({ onStatus: setStatus, speak });
  try {
    window.Render3DOpenArmTrain = train;
  } catch { /* optional */ }

  host.querySelector("[data-sb-train-demo]")?.addEventListener("click", async () => {
    const btn = host.querySelector("[data-sb-train-demo]");
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    logClick("TrainDemo", on ? "demo_start" : "demo_stop");
    if (on) {
      train.setTask("Hey Astra, pick up the cube");
      await train.startDemo({ astraTask: "Hey Astra, pick up the cube" });
    } else {
      await train.markSuccess();
    }
  });

  host.querySelector("[data-sb-train-policy]")?.addEventListener("click", async () => {
    logClick("PolicyTry", "policy_start");
    await train.startPolicyTry({ astraTask: train.getState().task || "Hey Astra, pick up the cube" });
    setStatus("Policy try recording — mark ✓ Success or ✗ Fail when done");
  });

  host.querySelector("[data-sb-train-ok]")?.addEventListener("click", async () => {
    logClick("TrainSuccess", "episode_success");
    const out = await train.markSuccess();
    host.querySelector("[data-sb-train-demo]")?.setAttribute("aria-pressed", "false");
    setStatus(out?.plan ? `Success · next ${out.plan.action}` : "Success saved");
  });

  host.querySelector("[data-sb-train-fail]")?.addEventListener("click", async () => {
    logClick("TrainFail", "episode_fail");
    const out = await train.markFail("miss");
    host.querySelector("[data-sb-train-demo]")?.setAttribute("aria-pressed", "false");
    // DAgger-style: immediately open intervene recording after a fail.
    await train.startIntervene({ astraTask: train.getState().task || "Hey Astra, pick up the cube" });
    setStatus(out?.plan ? `Fail → intervene · next ${out.plan.action}` : "Fail → intervene recording");
  });

  host.querySelectorAll("[data-agent]").forEach((chip) => {
    chip.addEventListener("click", async () => {
      const id = chip.getAttribute("data-agent");
      const row = CREW_BTNS.find((c) => c.id === id);
      if (id === "astra") askApi?.focus();
      setStatus(`${row?.label || id}: ${row?.ask || ""}`);
      void postContextEvent({
        source: "sandbox-agent-bar",
        feature_id: "sandbox.agent.invoke",
        event_kind: "agent_click",
        target_id: id,
        context: { ask: String(row?.ask || "").slice(0, 120) },
      });
      // Status text only — no chip intro TTS.
    });
  });

  return {
    token: AGENTBAR1_TOKEN,
    pageCapture,
    xrCapture,
    train,
    openRepair: () => setRepairTableOpen(true),
    isRepairOpen: isRepairTableOpen,
  };
}
