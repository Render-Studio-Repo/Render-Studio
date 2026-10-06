/** One-at-a-time Hey AI voice discovery and selection. Token singlevoice2. */
import { REALTIME_VOICES } from "../components/realtime-voices.js?singlevoice2";

export const VOICE1_CACHE = "singlevoice2";
export const VOICE_EXAMPLES = Object.freeze([...REALTIME_VOICES]);

function normalized(text = "") {
  return String(text || "").toLowerCase().replace(/[.!?]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isVoiceExampleVoice(text = "") {
  const value = normalized(text);
  if (!value || /\b(don'?t|do not|never)\b.{0,18}\bvoices?\b/.test(value)) return false;
  return /\b(sample|preview|play|show|hear|try)\b.{0,30}\b(other )?voices?\b/.test(value)
    || /\bwhat (other )?voices (are there|can i hear|do you have)\b/.test(value);
}

export function parseVoiceSelection(text = "") {
  const value = normalized(text);
  if (!/\b(use|choose|select|set|switch|change)\b/.test(value)) return null;
  const voice = REALTIME_VOICES.find((id) => new RegExp(`\\b${id}\\b`, "i").test(value));
  return voice ? { voice, token: VOICE1_CACHE } : null;
}

export function isVoiceSwapVoice(text = "") {
  return !!parseVoiceSelection(text);
}

function agentBridge() {
  return typeof window !== "undefined" ? window.Render3DXrAgent : null;
}

let sampleIndex = 0;

/** One explicit request plays one preview; asking again advances to the next. */
export async function playVoiceExamples({ action } = {}) {
  const invoke = action || ((id, payload) => agentBridge()?.action?.(id, payload));
  const voice = VOICE_EXAMPLES[sampleIndex % VOICE_EXAMPLES.length];
  sampleIndex = (sampleIndex + 1) % VOICE_EXAMPLES.length;
  const result = await invoke("voice:sample", { voice });
  return { ok: true, voice, playing: !!result?.playing, available: VOICE_EXAMPLES, kind: "example", token: VOICE1_CACHE };
}

export async function selectHeyAiVoice(voice, { action } = {}) {
  const id = String(voice || "").toLowerCase();
  if (!REALTIME_VOICES.includes(id)) return { ok: false, error: "Unknown voice.", token: VOICE1_CACHE };
  const invoke = action || ((name, payload) => agentBridge()?.action?.(name, payload));
  const settings = await invoke("agent:setting", { voice: id });
  await invoke("voice:sample", { voice: id });
  return { ok: true, voice: id, settings, kind: "selection", token: VOICE1_CACHE };
}

export async function applyVoiceCommand(text, options = {}) {
  const selection = parseVoiceSelection(text);
  if (selection) return selectHeyAiVoice(selection.voice, options);
  if (isVoiceExampleVoice(text)) return playVoiceExamples(options);
  return { ok: false, token: VOICE1_CACHE };
}

// Compatibility hook: the account-backed XR store is the sole persistence source.
export async function hydrateVoiceSelect() {
  return { ok: true, active: {}, token: VOICE1_CACHE };
}
