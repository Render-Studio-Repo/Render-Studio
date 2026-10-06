/** One TTS speaker at a time. Unique voice per agent. Talk mode: one (Astra girl) / other / both. */
export const SANDBOX1_TOKEN = "sandbox1";
export const TTSTURN1_CACHE = "ttsturn1";
export const VOICE1_CACHE = "voice1";
export const SHARED_MALE1_TOKEN = "sharedmale1";
export const TALKMODE1_TOKEN = "talkmode1";
/** Default shared male realtime id when “other” forces one crew voice. */
export const SHARED_MALE_VOICE = "echo";
/** Astra host — girl / female Realtime voice (OpenAI recommends marin). */
export const ASTRA_GIRL_VOICE = "marin";
export const TALK_MODES = Object.freeze(["one"]);
const TURN_LS = "render3d.tts.turnTaking";
const VOICE_LS = "render3d.tts.agentVoices";
const SHARED_MALE_LS = "render3d.tts.sharedMale";
const TALK_MODE_LS = "render3d.tts.talkMode";

export const REALTIME_VOICE_IDS = Object.freeze([
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
]);

export const AGENT_VOICE = Object.freeze({
  astra: ASTRA_GIRL_VOICE,
  "project-manager": "cedar",
  pm: "cedar",
  "cursor-engineer": "echo",
  cursor: "echo",
  "vibe-marketing": "coral",
  mkt: "coral",
  "vibe-sales": "verse",
  sales: "verse",
  "vibe-rnd": "ash",
  rnd: "ash",
  analytics: "sage",
  "clip-bot": "ballad",
  clip: "ballad",
  ledger: "shimmer",
  "instruction-auditor": "alloy",
  auditor: "alloy",
  "comms-bridge": "verse",
  comms: "verse",
});

/** Male seated voices use distinct nationalities. Astra + marketing stay distinguishable. */
export const AGENT_NATION = Object.freeze({
  astra: { nation: "US", sex: "f", langs: ["en-US"], label: "US host" },
  "vibe-marketing": { nation: "US", sex: "f", langs: ["en-US"], label: "US" },
  mkt: { nation: "US", sex: "f", langs: ["en-US"], label: "US" },
  "cursor-engineer": { nation: "US", sex: "m", langs: ["en-US"], label: "US" },
  cursor: { nation: "US", sex: "m", langs: ["en-US"], label: "US" },
  "project-manager": { nation: "UK", sex: "m", langs: ["en-GB"], label: "UK" },
  pm: { nation: "UK", sex: "m", langs: ["en-GB"], label: "UK" },
  "vibe-rnd": { nation: "AU", sex: "m", langs: ["en-AU"], label: "Australian" },
  rnd: { nation: "AU", sex: "m", langs: ["en-AU"], label: "Australian" },
  analytics: { nation: "IE", sex: "m", langs: ["en-IE", "en-GB"], label: "Irish" },
  "clip-bot": { nation: "US", sex: "m", langs: ["en-US"], label: "US" },
  clip: { nation: "US", sex: "m", langs: ["en-US"], label: "US" },
  "vibe-sales": { nation: "UK", sex: "m", langs: ["en-GB"], label: "UK" },
  sales: { nation: "UK", sex: "m", langs: ["en-GB"], label: "UK" },
});

let voiceOverrides = {};
try {
  const raw = globalThis.localStorage?.getItem?.(VOICE_LS);
  if (raw) voiceOverrides = JSON.parse(raw) || {};
} catch { voiceOverrides = {}; }

let sharedMale = false;
let talkMode = "one";
try {
  globalThis.localStorage?.setItem?.(TALK_MODE_LS, "one");
  globalThis.localStorage?.setItem?.(SHARED_MALE_LS, "0");
} catch { /* optional migration */ }

function persistVoiceOverrides() {
  try { globalThis.localStorage?.setItem?.(VOICE_LS, JSON.stringify(voiceOverrides)); } catch { /* optional */ }
}

/** Clear any stale override that stole Astra’s girl voice. */
try {
  if (voiceOverrides.astra && voiceOverrides.astra !== ASTRA_GIRL_VOICE) {
    delete voiceOverrides.astra;
    persistVoiceOverrides();
  }
} catch { /* optional */ }

export function isSharedMaleVoice() {
  return false;
}

export function setSharedMaleVoice() {
  return setTalkMode("one");
}

export function getTalkMode() {
  return talkMode;
}

export function setTalkMode() {
  talkMode = "one";
  sharedMale = false;
  try { globalThis.localStorage?.setItem?.(TALK_MODE_LS, talkMode); } catch { /* optional */ }
  try { globalThis.localStorage?.setItem?.(SHARED_MALE_LS, sharedMale ? "1" : "0"); } catch { /* optional */ }
  return {
    mode: talkMode,
    on: sharedMale,
    voice: ASTRA_GIRL_VOICE,
    token: TALKMODE1_TOKEN,
    astraVoice: ASTRA_GIRL_VOICE,
  };
}

export function cycleTalkMode() {
  return setTalkMode("one");
}

/**
 * Who should speak this line given talk mode.
 * one → Astra girl only; other → crew (no Astra); both → as requested.
 */
export function resolveTalkAgent(agentId) {
  return "astra";
}

export function talkModeLabel() {
  return `Talk · Astra only (${ASTRA_GIRL_VOICE})`;
}

/** Lock to one speaker (whoever last). Cancels overlap. */
export function forceOneSpeaker(reason = "boot") {
  setTalkMode("one");
  return bargeIn(String(reason || "one speaker"));
}

export function getAgentVoiceMap() {
  return { ...AGENT_VOICE, ...voiceOverrides, astra: ASTRA_GIRL_VOICE };
}

export function setAgentVoice(agentId, voice) {
  const id = String(agentId || "").trim();
  let v = String(voice || "").trim().toLowerCase();
  if (!id || !REALTIME_VOICE_IDS.includes(v)) return { ok: false, token: VOICE1_CACHE };
  // Astra stays girl voice.
  if (id === "astra") v = ASTRA_GIRL_VOICE;
  voiceOverrides[id] = v;
  persistVoiceOverrides();
  return { ok: true, agent: id, voice: v, token: VOICE1_CACHE };
}

export function applyVoiceOverrides(map = {}) {
  for (const [key, val] of Object.entries(map || {})) {
    const v = String(val || "").trim().toLowerCase();
    if (key && REALTIME_VOICE_IDS.includes(v)) voiceOverrides[key] = v;
  }
  persistVoiceOverrides();
  return getAgentVoiceMap();
}

export function clearVoiceOverrides() {
  voiceOverrides = {};
  persistVoiceOverrides();
  return { ok: true, token: VOICE1_CACHE };
}

let floor = "";
const queue = [];
let pumping = false;
let turnTaking = false;
try { turnTaking = globalThis.localStorage?.getItem?.(TURN_LS) === "1"; } catch { turnTaking = false; }

export const EXPERT_TOPICS = Object.freeze({
  "clip-bot": /\b(cad|print|3mf|bambu|slicer|mesh|nozzle|infill|plate|stl|generative)\b/i,
  "vibe-marketing": /\b(market|deck|slide|pitch|social|brand|grow|campaign)\b/i,
  "vibe-rnd": /\b(rnd|r&d|bench|experiment|trigger|debug|instance|quest|headset)\b/i,
  analytics: /\b(cost|spend|token|analytic|usage|price|billing)\b/i,
  "project-manager": /\b(process|ticket|pm\b|timeline|ship|standup|plan|roadmap)\b/i,
  astra: /\b(host|risk|reward|vote|decision|listen|round table)\b/i,
});

export function isTooMuchTalkVoice(text = "") {
  const s = String(text || "").toLowerCase().replace(/[.!?]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return false;
  if (/\b(don'?t|do not|never)\b.{0,20}\b(take turns|quiet)\b/.test(s)) return false;
  return (
    /\b(talking too much|too much talking|all at once)\b/.test(s)
    || /\b(talking over|talk over each other|everyone (talking|speaking))\b/.test(s)
    || /\b(one at a time|take turns|taking turns|one voice)\b/.test(s)
    || /\btoo many (people|agents|voices) talking\b/.test(s)
    || /\b(stop talking over|quiet down|shh)\b/.test(s)
  );
}

export function expertsForTopic(text = "") {
  const s = String(text || "");
  const hits = [];
  for (const [id, re] of Object.entries(EXPERT_TOPICS)) {
    if (re.test(s)) hits.push(id);
  }
  if (!hits.length) return ["astra"];
  return hits.slice(0, 2);
}

export function isTurnTaking() {
  return turnTaking === true;
}

export function setTurnTaking(on) {
  turnTaking = !!on;
  try { globalThis.localStorage?.setItem?.(TURN_LS, turnTaking ? "1" : "0"); } catch { /* persist optional */ }
  return { on: turnTaking, token: TTSTURN1_CACHE };
}

export function shouldSpeakNow(agentId, text = "", topic = "") {
  if (!turnTaking) return true;
  const id = String(agentId || "astra");
  const experts = expertsForTopic(topic || text);
  return experts.includes(id);
}

/** Stop every overlapping utterance now. Enables persisted turn-taking. */
export function bargeIn(reason = "") {
  try { globalThis.window?.speechSynthesis?.cancel?.(); } catch { /* no synth */ }
  while (queue.length) {
    const job = queue.shift();
    try { job?.resolve?.({ spoken: false, textOnly: true, barged: true, agentId: job.agentId }); } catch { /* */ }
  }
  floor = "";
  pumping = false;
  setTurnTaking(true);
  return { ok: true, turnTaking: true, token: TTSTURN1_CACHE, reason: String(reason || "").slice(0, 80) };
}

export function uniqueVoiceForAgent(agentId) {
  return ASTRA_GIRL_VOICE;
}

export function uniqueSeatVoices(roster = []) {
  return roster.map((row) => ({ ...row, voice: ASTRA_GIRL_VOICE, nation: "US" }));
}

function isMaleVoiceName(name = "") {
  return /\b(male|daniel|james|george|thomas|oliver|fred|rishi|aaron|gordon|lee|nathan|tom|david|arthur|reed|daniel)\b/i.test(String(name || ""));
}

export function floorHolder() {
  return floor;
}

export function occupyFloor(agentId) {
  floor = String(agentId || "astra");
}

export function releaseFloor(agentId) {
  if (!agentId || floor === String(agentId)) floor = "";
  pump();
}

function synthVoices() {
  try {
    return window.speechSynthesis?.getVoices?.() || [];
  } catch {
    return [];
  }
}

export function pickSynthVoice(agentId, voices = synthVoices(), explicitVoice = "") {
  const list = Array.isArray(voices) ? voices : [];
  const en = list.filter((v) => /^en/i.test(v.lang || ""));
  const feminine = (en.length ? en : list).filter((v) => !isMaleVoiceName(v.name));
  return feminine[0] || en[0] || list[0] || null;
}

export const LIVE_ASTRA_FLOOR = "astra-live";

function utter(agentId, text, { volume = 1, rate = 1.02, onstart, onend, voice: explicitVoice } = {}) {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      onend?.();
      resolve({ spoken: false, textOnly: true, agentId });
      return;
    }
    const u = new SpeechSynthesisUtterance(String(text));
    const voice = pickSynthVoice(agentId, synthVoices(), explicitVoice);
    if (voice) u.voice = voice;
    u.pitch = 1;
    u.rate = rate;
    u.volume = volume;
    u.onstart = () => onstart?.();
    u.onend = () => {
      onend?.();
      resolve({ spoken: true, textOnly: false, agentId });
    };
    u.onerror = () => {
      onend?.();
      resolve({ spoken: false, textOnly: true, agentId });
    };
    window.speechSynthesis.speak(u);
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const peek = queue[0];
      if (floor && peek && floor !== peek.agentId) {
        if (peek.ifBusy === "text-only") {
          queue.shift();
          peek.resolve({ spoken: false, textOnly: true, agentId: peek.agentId, queued: false });
          continue;
        }
        break;
      }
      const job = queue.shift();
      if (!job) break;
      occupyFloor(job.agentId);
      try {
        const result = await utter(job.agentId, job.text, job.opts || {});
        job.resolve(result);
      } catch (err) {
        job.resolve({ spoken: false, textOnly: true, agentId: job.agentId, error: String(err?.message || err) });
      } finally {
        if (floor === job.agentId) floor = "";
      }
    }
  } finally {
    pumping = false;
  }
}

/** Queue TTS. In talk mode "one", whoever speaks last wins — cancel overlap. */
export function enqueueSpeak(agentId, text, opts = {}) {
  const line = String(text || "").trim();
  const id = resolveTalkAgent(agentId);
  if (!line) return Promise.resolve({ spoken: false, textOnly: true, agentId: id });
  if (floor === LIVE_ASTRA_FLOOR) {
    return Promise.resolve({ spoken: false, textOnly: true, silent: true, agentId: id, liveVoiceOwnsOutput: true });
  }
  if (opts.force !== true && !shouldSpeakNow(id, line, opts.topic)) {
    return Promise.resolve({ spoken: false, textOnly: true, silent: true, agentId: id, token: TTSTURN1_CACHE });
  }
  if (opts.ifBusy === "text-only" && floor && floor !== id) {
    return Promise.resolve({ spoken: false, textOnly: true, agentId: id, queued: false });
  }
  if (opts.queue === true) {
    return new Promise((resolve) => {
      queue.push({ agentId: id, text: line.slice(0, 400), opts, ifBusy: opts.ifBusy, resolve });
      pump();
    });
  }
  try { globalThis.window?.speechSynthesis?.cancel?.(); } catch { /* */ }
  while (queue.length) {
    const job = queue.shift();
    try { job?.resolve?.({ spoken: false, textOnly: true, barged: true, agentId: job.agentId }); } catch { /* */ }
  }
  floor = "";
  pumping = false;
  return new Promise((resolve) => {
    queue.push({ agentId: id, text: line.slice(0, 400), opts, ifBusy: opts.ifBusy, resolve });
    pump();
  });
}

export async function speakSequence(turns, onTurn) {
  for (const turn of turns || []) {
    const mapped = { ...turn, id: resolveTalkAgent(turn.id || turn.agent_id) };
    onTurn?.(mapped);
    await enqueueSpeak(mapped.id, turn.text, {
      onstart: () => onTurn?.({ ...mapped, speaking: true }),
      onend: () => onTurn?.({ ...mapped, speaking: false }),
    });
  }
}
