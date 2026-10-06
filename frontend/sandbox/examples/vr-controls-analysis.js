/** Live VR controls analysis stub — sandbox only */
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
    issues: [],
  };
}

export async function suggestFix(analysis = {}) {
  // Cursor / Investigator extend this while Debugger VR is live.
  return { ok: true, analysis, patch: null };
}


export const LAST_LIVE = {
  "rev": 6,
  "headset": "quest3",
  "session": {
    "selectstart": "ui-then-poll",
    "grab": "squeeze-or-trigger",
    "dimos": "ui-beats-overlay",
    "windows": "near-head"
  },
  "at": "2026-09-17T14:09:29.063Z"
};
