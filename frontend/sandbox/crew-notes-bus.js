/**
 * Shared crew knowledge — they "hear" each other as written notes, not TTS.
 * Sam talks via forceOneSpeaker. Token notesbus1.
 */

export const NOTESBUS1_TOKEN = "notesbus1";
export const NOTES_PATH = "sandbox-sessions/crew-notes.json";
export const HEAR_DEFAULTS = Object.freeze({
  hear_sam: true,
  hear_crew_notes: true,
  hear_crew_tts: false,
});

const LS = "render3d.sandbox.crewNotes";
const HEAR_LS = "render3d.sandbox.crewHear";

function nowIso() {
  return new Date().toISOString();
}

export function loadNotes(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadHearMap(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(HEAR_LS);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function hearFlagsFor(agentId, storage = globalThis.localStorage) {
  const map = loadHearMap(storage);
  const row = map[agentId] || {};
  return {
    ...HEAR_DEFAULTS,
    hear_sam: row.hear_sam !== false,
    hear_crew_notes: row.hear_crew_notes !== false,
    hear_crew_tts: false,
  };
}

export function setHearFlags(agentId, partial = {}, storage = globalThis.localStorage) {
  const map = loadHearMap(storage);
  map[agentId] = { ...hearFlagsFor(agentId, storage), ...partial, hear_crew_tts: false };
  try { storage?.setItem?.(HEAR_LS, JSON.stringify(map)); } catch { /* optional */ }
  return map[agentId];
}

export function postCrewNote({
  from = "astra",
  to = "crew",
  kind = "note",
  text = "",
  storage = globalThis.localStorage,
} = {}) {
  const note = {
    id: `n_${Date.now().toString(16)}`,
    token: NOTESBUS1_TOKEN,
    from: String(from).slice(0, 40),
    to: String(to).slice(0, 40),
    kind: String(kind).slice(0, 32),
    text: String(text || "").slice(0, 400),
    at: nowIso(),
    tts: false,
  };
  const next = [...loadNotes(storage), note].slice(-80);
  try { storage?.setItem?.(LS, JSON.stringify(next)); } catch { /* optional */ }
  try {
    globalThis.window?.dispatchEvent?.(new CustomEvent("render3d-sandbox-crew-note", {
      detail: { note, token: NOTESBUS1_TOKEN },
    }));
  } catch { /* optional */ }
  return note;
}

export function notesForSeat(agentId, notes = loadNotes()) {
  const flags = hearFlagsFor(agentId);
  if (!flags.hear_crew_notes) return [];
  return (notes || []).filter((n) => n.to === "crew" || n.to === agentId || n.from === agentId).slice(-12);
}

export function samCanAddress(agentId) {
  return hearFlagsFor(agentId).hear_sam;
}

export async function persistNotes(notes = loadNotes()) {
  const payload = { kind: "crew_notes_bus", token: NOTESBUS1_TOKEN, at: nowIso(), notes: notes.slice(-80) };
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", agent: "comms", path: NOTES_PATH, text: JSON.stringify(payload, null, 2) }),
  }).catch(() => null);
  return { ok: !!(res && res.ok), path: NOTES_PATH, token: NOTESBUS1_TOKEN };
}
