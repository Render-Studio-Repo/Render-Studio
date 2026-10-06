/** GPT / Hey voice step log for sandbox repair loop. Token voicemap1. */

import {
  isSessionActive,
  logVoiceStep,
  recordMappedWrite,
  addReferencePoint,
} from "./change-map.js?v=map1";
import { applySamSandboxCorrection, isSamCorrectionVoice } from "./sam-correct.js?v=harness1";

export const VOICEMAP1_TOKEN = "voicemap1";

export function isSandboxVoiceLogPhrase(text = "") {
  const s = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return false;
  return (
    /\b(log (this )?step|mark (a )?checkpoint|remember this|reference point|backtrack)\b/.test(s)
    || /\b(checkpoint|save (this )?progress)\b/.test(s)
  );
}

export function isRepairRouteVoice(text = "") {
  const s = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  return /\b(repair|fix (the )?(controls?|trigger|squeeze|dimos)|why can'?t|blocked|broken)\b/.test(s)
    || /\b(run repair|open repair|repair loop)\b/.test(s);
}

export function isGenerateRouteVoice(text = "") {
  const s = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  return /\b(generate|write (the )?code|live gen|analysis (for|of) controls?)\b/.test(s)
    || /\b(improve (this |the )?project)\b/.test(s);
}

export async function handleSandboxVoiceInput(text = "") {
  const raw = String(text || "").replace(/^VOICE:\s*/i, "").trim();
  if (!raw) {
    return { ok: false, handled: false, token: VOICEMAP1_TOKEN };
  }

  // Voice can open repair even before sandbox session — routes complete generation tasks.
  if (isRepairRouteVoice(raw)) {
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
        const report = await runRepairLoop(raw.slice(0, 160));
        paintRepairPanel(panel, report);
      }
      document.querySelector("[data-sb-repair]")?.setAttribute("aria-pressed", "true");
      document.querySelector('[data-sb-tab="se"][data-tab="dbgvr"]')?.click?.();
    } catch { /* optional */ }
    const step = isSessionActive() ? logVoiceStep(raw, { kind: "repair_route" }) : null;
    return {
      ok: true,
      handled: true,
      repair: true,
      step,
      token: VOICEMAP1_TOKEN,
      speak: "Routing to Repair. Debugger VR and repair agents will take the controls issue.",
    };
  }

  if (isGenerateRouteVoice(raw)) {
    try {
      document.querySelector('[data-sb-tab="se"][data-tab="dbgvr"]')?.click?.();
      document.querySelector("[data-dbg-gen]")?.click?.();
    } catch { /* optional */ }
    const step = isSessionActive() ? logVoiceStep(raw, { kind: "generate_route" }) : null;
    return {
      ok: true,
      handled: true,
      generate: true,
      step,
      token: VOICEMAP1_TOKEN,
      speak: "Generating live analysis in Debugger VR. Point a reference if you need one.",
    };
  }

  if (!isSessionActive()) {
    return { ok: false, handled: false, token: VOICEMAP1_TOKEN };
  }

  if (isSamCorrectionVoice(raw)) {
    const step = logVoiceStep(raw, { kind: "corrective", corrective: true });
    const applied = await applySamSandboxCorrection(raw);
    if (applied?.ok && applied?.path) {
      await recordMappedWrite(applied.path || applied.parsed?.path, {
        afterText: applied.parsed?.change || raw,
        source: "voice_corrective",
        voiceStepId: step?.step_id,
      });
    }
    return {
      ok: true,
      handled: true,
      corrective: true,
      step,
      applied,
      token: VOICEMAP1_TOKEN,
      speak: "Correction logged. Sandbox map updated. Production waits for Approve.",
    };
  }

  if (isSandboxVoiceLogPhrase(raw)) {
    const step = logVoiceStep(raw, { kind: "checkpoint" });
    const ref = addReferencePoint({
      kind: "checkpoint",
      label: raw.slice(0, 80),
      note: "Voice checkpoint for faster backtrack",
    });
    return {
      ok: true,
      handled: true,
      checkpoint: true,
      step,
      ref,
      token: VOICEMAP1_TOKEN,
      speak: `Checkpoint ${ref?.ref_id || "saved"} for OpenArm 2.0 backtrack.`,
    };
  }

  const step = logVoiceStep(raw, { kind: "step" });
  return {
    ok: true,
    handled: true,
    step,
    token: VOICEMAP1_TOKEN,
    speak: null,
  };
}

/** Bridge for Studio Hey / mic transcripts while sandbox session is active. */
export function installSandboxVoiceBridge() {
  if (typeof window === "undefined") return;
  if (window.Render3DSandboxVoice?.token === VOICEMAP1_TOKEN) return;
  window.Render3DSandboxVoice = {
    token: VOICEMAP1_TOKEN,
    handle: handleSandboxVoiceInput,
    isActive: isSessionActive,
  };
  window.addEventListener("render3d-sandbox-voice-step", (ev) => {
    const text = ev?.detail?.text || "";
    void handleSandboxVoiceInput(text);
  });
}
