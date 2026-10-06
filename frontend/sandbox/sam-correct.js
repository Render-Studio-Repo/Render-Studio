/** Sam real-time corrections → frontend/sandbox only. Token harness1. No extra WebGL. */

export const HARNESS1_TOKEN = "harness1";
export const LIVE_CORRECTION_PATH = "examples/live-correction.md";
export const CORRECT_PATH = "/mcp/sandbox/correct";

export function isSamCorrectionVoice(text = "") {
  const s = String(text || "")
    .replace(/^VOICE:\s*/i, "")
    .toLowerCase()
    .replace(/[.!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return false;
  if (/\b(don'?t|do not|never)\b.{0,24}\b(correct|change that)\b/.test(s)) return false;
  return (
    /\b(that'?s wrong|that is wrong|this is wrong|that'?s not right)\b/.test(s)
    || /\b(wrong[, ]+change|change that|fix that|try this instead)\b/.test(s)
    || /\bchange\b.{0,80}\bto\b/.test(s)
  );
}

export function parseSamCorrection(text = "") {
  const raw = String(text || "").replace(/^VOICE:\s*/i, "").trim();
  const pathHit = raw.match(/\b(?:in|file)\s+(?:frontend\/sandbox\/)?([\w./-]+\.(?:md|js|html|css|json|txt))\b/i);
  let change = raw;
  const labeled = raw.match(/\b(?:change|fix|use|to)\s*[:\-]?\s*(.+)$/i);
  if (labeled) change = labeled[1].trim();
  return {
    path: pathHit ? pathHit[1].replace(/^frontend\/sandbox\//, "") : LIVE_CORRECTION_PATH,
    change: change.slice(0, 4000),
    text: raw.slice(0, 4000),
    token: HARNESS1_TOKEN,
  };
}

export async function applySamSandboxCorrection(text = "", extra = {}) {
  const parsed = parseSamCorrection(text);
  const body = {
    action: "correct",
    agent: "sam",
    text: parsed.text,
    path: extra.path || parsed.path,
    token: HARNESS1_TOKEN,
    auto_apply: false,
    ...extra,
  };
  const res = await fetch(CORRECT_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  let data = {};
  let ok = false;
  if (res && res.ok) {
    ok = true;
    data = await res.json().catch(() => ({}));
  } else {
    const fallback = await fetch("/mcp/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (fallback && fallback.ok) {
      ok = true;
      data = await fallback.json().catch(() => ({}));
    }
  }
  if (ok) {
    try {
      const { recordMappedWrite, isSessionActive, logVoiceStep } = await import("./change-map.js?v=map1");
      if (isSessionActive()) {
        const step = logVoiceStep(parsed.text, { kind: "corrective", corrective: true });
        await recordMappedWrite(data.path || parsed.path, {
          afterText: parsed.change,
          source: "sam_correct",
          voiceStepId: step?.step_id,
        });
      }
    } catch { /* map optional */ }
  }
  if (!ok) return { ok: false, token: HARNESS1_TOKEN, auto_apply: false, parsed };
  return { ok: true, token: HARNESS1_TOKEN, auto_apply: false, ...data, parsed };
}
