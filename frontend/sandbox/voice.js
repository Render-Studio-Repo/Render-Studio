/** Sandbox Web Speech — unique voice per desk, one speaker at a time. */
import { bump, debugState, noteError } from "./bus.js";
import {
  enqueueSpeak,
  speakSequence,
  pickSynthVoice,
  uniqueVoiceForAgent,
  resolveTalkAgent,
  getTalkMode,
  setTalkMode,
  cycleTalkMode,
  talkModeLabel,
  TALK_MODES,
  ASTRA_GIRL_VOICE,
} from "./tts-mutex.js?v=20260923-singlevoice1";

function SpeechCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function probeSpeech() {
  const synthOk = typeof window.speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
  const recOk = !!SpeechCtor();
  bump({ synthOk, recOk });
  if (synthOk) refreshVoices();
  return { synthOk, recOk };
}

export function refreshVoices() {
  const list = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  bump({ voices: list.map((v) => `${v.name} (${v.lang})`) });
  return list;
}

export function speak(agentId, text, { onstart, onend } = {}) {
  const line = String(text || "").trim();
  if (!line) return Promise.resolve(false);
  if (!debugState.synthOk && !probeSpeech().synthOk) {
    bump({ lastTts: `FAIL SpeechSynthesis missing — cannot speak as ${agentId}` });
    return Promise.resolve(false);
  }
  const who = resolveTalkAgent(agentId);
  return enqueueSpeak(who, line, {
    onstart: () => {
      bump({ lastTts: `${who}/${uniqueVoiceForAgent(who)}: ${line}` });
      onstart && onstart();
    },
    onend,
  }).then((result) => !!result.spoken);
}

export {
  speakSequence,
  pickSynthVoice,
  getTalkMode,
  setTalkMode,
  cycleTalkMode,
  talkModeLabel,
  TALK_MODES,
  ASTRA_GIRL_VOICE,
};

export function listenOnce() {
  const Ctor = SpeechCtor();
  if (!Ctor) {
    bump({ lastStt: "FAIL No SpeechRecognition in this browser." });
    return Promise.reject(new Error("No SpeechRecognition"));
  }
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.onresult = (ev) => {
      const text = ev.results?.[0]?.[0]?.transcript || "";
      bump({ lastStt: text || "(empty transcript)" });
      resolve(text);
    };
    rec.onerror = (ev) => {
      const msg = `Mic error: ${ev.error || "unknown"}`;
      bump({ lastStt: msg });
      reject(new Error(msg));
    };
    rec.start();
    bump({ lastStt: "Listening…" });
  });
}

/** Prod office-voice.js: POST /mcp/group-chat as sam with VOICE: prefix. */
export async function postVoiceAsSam(text) {
  const body = { agent: "sam", text: "VOICE: " + text };
  let res = await fetch("/mcp/group-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => {
    noteError("POST /mcp/group-chat", err);
    return null;
  });
  if (!res || !res.ok) {
    noteError("POST /mcp/group-chat", new Error(res ? `HTTP ${res.status}` : "network"));
    return null;
  }
  try {
    return await res.json();
  } catch (err) {
    noteError("POST /mcp/group-chat json", err);
    return { ok: false };
  }
}

export function mountVoiceBar(host, handlers) {
  if (!host || host.dataset.voice === "1") return;
  host.dataset.voice = "1";
  const { synthOk, recOk } = probeSpeech();
  host.className = "sb-voice-bar office-voice";
  host.innerHTML = `
    <button type="button" class="btn accent" id="sb-talk" ${recOk ? "" : "disabled"}>Talk</button>
    <button type="button" class="btn" id="sb-reports">Retrieve reports</button>
    <span class="sb-status" id="sb-talk-status"></span>
  `;
  const status = host.querySelector("#sb-talk-status");
  const set = (t) => { if (status) status.textContent = t; };
  setTalkMode("one");
  if (!synthOk) set("FAIL: SpeechSynthesis missing. TTS will not run.");
  else if (!recOk) set("TTS ok. FAIL: SpeechRecognition missing — Talk disabled.");
  else set(`${talkModeLabel("one")}. One speaker · Talk posts as Sam.`);

  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    refreshVoices();
  }

  host.querySelector("#sb-talk")?.addEventListener("click", async () => {
    if (!recOk) {
      set("FAIL: No SpeechRecognition in this browser.");
      return;
    }
    try {
      const text = await listenOnce();
      if (!text) {
        set("Empty transcript.");
        return;
      }
      set("Posting…");
      const posted = await postVoiceAsSam(text);
      const lid = posted?.posted?.log_id;
      if (lid) {
        bump({ logIds: [...debugState.logIds, lid].slice(-12) });
      }
      set(posted && (posted.ok || posted.posted) ? `Posted ${lid || ""}.` : "Post failed.");
      if (handlers.onSamSpeech) await handlers.onSamSpeech(text, posted);
    } catch (err) {
      set(err.message || "Mic error.");
    }
  });
  host.querySelector("#sb-reports")?.addEventListener("click", () => handlers.onReports && handlers.onReports());
}
