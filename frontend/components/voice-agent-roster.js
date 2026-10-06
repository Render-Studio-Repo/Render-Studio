/** Saved voice / avatar choices and one-cloud room speech. */

export const VOICE_AGENT_PREF_KEY = "render3d:voice-agents";

const OPENAI_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
const ELEVEN_VOICES = [
  { id: "rachel", label: "Rachel" },
  { id: "drew", label: "Drew" },
  { id: "clyde", label: "Clyde" },
  { id: "sarah", label: "Sarah" },
  { id: "antoni", label: "Antoni" },
];

export function voiceCatalog({ openai = true, elevenlabs = false } = {}) {
  const rows = [];
  if (openai) {
    for (const id of OPENAI_VOICES) rows.push({ provider: "openai", id, label: id });
  }
  if (elevenlabs) {
    for (const row of ELEVEN_VOICES) rows.push({ provider: "elevenlabs", id: row.id, label: row.label });
  }
  return rows;
}

function storeOf(storage) {
  return storage || globalThis.localStorage;
}

export function loadVoiceAgentPrefs(storage) {
  try {
    const raw = storeOf(storage)?.getItem?.(VOICE_AGENT_PREF_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveVoiceAgentPref(id, patch = {}, storage) {
  const key = String(id || "").slice(0, 64);
  const all = loadVoiceAgentPrefs(storage);
  if (!key) return all;
  const prev = all[key] && typeof all[key] === "object" ? all[key] : {};
  const next = { ...prev };
  if (patch.voice != null) next.voice = String(patch.voice).slice(0, 40);
  if (patch.provider) next.provider = patch.provider === "elevenlabs" ? "elevenlabs" : "openai";
  if (patch.form) next.form = patch.form === "avatar" ? "avatar" : "voice";
  all[key] = next;
  try { storeOf(storage)?.setItem?.(VOICE_AGENT_PREF_KEY, JSON.stringify(all)); } catch { /* private mode */ }
  return all;
}

export function prefFor(id, prefs = null) {
  const all = prefs || loadVoiceAgentPrefs();
  const row = all[String(id || "")] || {};
  return {
    voice: String(row.voice || ""),
    provider: row.provider === "elevenlabs" ? "elevenlabs" : "openai",
    form: row.form === "avatar" ? "avatar" : "voice",
  };
}

function escapeName(name) {
  return String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function agentMentioned(text, agent = {}) {
  const hay = String(text || "").toLowerCase().replace(/[-_]/g, " ");
  const names = [agent.name, agent.nick, agent.label, agent.id]
    .map((n) => String(n || "").toLowerCase().replace(/[-_]/g, " ").trim())
    .filter((n) => n.length >= 3);
  return names.some((name) => new RegExp(`\\b${escapeName(name)}\\b`, "i").test(hay));
}

/** One addressee. A named agent wins. Otherwise the focused seat. Never both. */
export function pickAddressedAgent(text, roster = [], focused = "") {
  const hits = (roster || []).filter((agent) => agentMentioned(text, agent));
  hits.sort((a, b) => String(b.name || b.id || "").length - String(a.name || a.id || "").length);
  if (hits.length) return { id: String(hits[0].id), reason: "name" };
  if (focused) return { id: String(focused), reason: "focus" };
  return { id: "", reason: "unaddressed" };
}

/**
 * One cloud job. Named or focused agent speaks; the others stay quiet.
 * With no name, every line is queued on that one job and tagged for its listener.
 */
export function cloudSpeechSplit(lines = [], { utterance = "", roster = [], focused = "" } = {}) {
  const who = pickAddressedAgent(utterance, roster, focused);
  const speak = [];
  const hold = [];
  for (const line of lines || []) {
    const id = String(line.agentId || line.agent_id || "");
    const item = { ...line, agentId: id, listener: id, cloud: "one", queue: true };
    const named = !!who.id;
    if (named) {
      if (id === who.id && !speak.length) speak.push(item);
      else hold.push({ ...item, silent: true });
    } else {
      speak.push(item);
    }
  }
  return { cloud: "one", addressed: who.id, reason: who.reason, speak, hold };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function voiceControlsMarkup(agentId, pref, catalog = []) {
  const id = esc(agentId);
  const voice = `${pref?.provider || "openai"}:${pref?.voice || ""}`;
  const options = [`<option value="">Default</option>`].concat((catalog || []).map((row) => {
    const value = `${row.provider}:${row.id}`;
    const label = row.provider === "elevenlabs" ? `ElevenLabs · ${row.label}` : row.label;
    return `<option value="${esc(value)}"${value === voice ? " selected" : ""}>${esc(label)}</option>`;
  }));
  const form = pref?.form === "avatar" ? "avatar" : "voice";
  return `<div class="ra-voice-row" data-va-agent="${id}">
    <label>Voice <select data-va-voice>${options.join("")}</select></label>
    <button type="button" data-va-form="voice" class="${form === "voice" ? "is-on" : ""}">Voice</button>
    <button type="button" data-va-form="avatar" class="${form === "avatar" ? "is-on" : ""}">Avatar</button>
  </div>`;
}

export function bindVoiceAgentControls(root, { onSave } = {}) {
  if (!root || root.dataset.vaBound === "1") return;
  root.dataset.vaBound = "1";
  root.addEventListener("change", (event) => {
    const select = event.target?.closest?.("[data-va-voice]");
    if (!select) return;
    const row = select.closest("[data-va-agent]");
    const id = row?.getAttribute("data-va-agent") || "";
    const [provider, voice] = String(select.value || "").split(":");
    const prefs = saveVoiceAgentPref(id, { provider: provider || "openai", voice: voice || "" });
    onSave?.(id, prefs[id]);
  });
  root.addEventListener("click", (event) => {
    const btn = event.target?.closest?.("[data-va-form]");
    if (!btn) return;
    const row = btn.closest("[data-va-agent]");
    const id = row?.getAttribute("data-va-agent") || "";
    const form = btn.getAttribute("data-va-form") === "avatar" ? "avatar" : "voice";
    saveVoiceAgentPref(id, { form });
    row.querySelectorAll("[data-va-form]").forEach((el) => {
      el.classList.toggle("is-on", el.getAttribute("data-va-form") === form);
    });
    onSave?.(id, prefFor(id));
  });
}
