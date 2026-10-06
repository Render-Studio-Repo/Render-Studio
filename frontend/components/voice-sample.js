/** Short Realtime-voice previews. Never starts a live agent, CAD job, or robot motion. */
import { normalizeRealtimeVoice, voiceSampleLine } from "./realtime-voices.js?voicesample=20260916-1";

export const VOICE_PREVIEW_PATH = "/api/voice-mold/preview";

function clampedVolume(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.8;
}

/**
 * createVoiceSamplePlayer({getToken,getVolume,getProjectId,fetchPreview,createAudio,speakLocal,speechSynthesis})
 * play(voice) speaks one sample and stops any previous sample.
 */
export function createVoiceSamplePlayer(options = {}) {
  let seq = 0;
  let current = "";
  let audio = null;
  let objectUrl = "";
  let utterance = null;
  const listeners = new Set();

  function notify() {
    for (const listener of listeners) {
      try { listener(current); } catch { /* isolate UI */ }
    }
  }

  function stopAudio() {
    if (audio) {
      try { audio.pause(); } catch { /* ignore */ }
      try { audio.removeAttribute("src"); audio.load?.(); } catch { /* ignore */ }
      audio = null;
    }
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
      objectUrl = "";
    }
    if (utterance) {
      try { utterance.onend = utterance.onerror = null; } catch { /* ignore */ }
      utterance = null;
    }
    try { (options.speechSynthesis || globalThis.speechSynthesis)?.cancel?.(); } catch { /* ignore */ }
  }

  function stop() {
    seq += 1;
    current = "";
    stopAudio();
    notify();
  }

  async function fetchPreview(voice, text) {
    if (typeof options.fetchPreview === "function") return options.fetchPreview(voice, text);
    const token = await options.getToken?.();
    if (!token) return null;
    const projectId = options.getProjectId?.() || "";
    const response = await fetch(VOICE_PREVIEW_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ voice, text, ...(projectId ? { project_id: projectId } : {}) }),
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob?.size ? blob : null;
  }

  async function play(voice) {
    const id = normalizeRealtimeVoice(voice);
    if (current === id) {
      stop();
      return { playing: false, voice: id };
    }
    stop();
    const token = seq;
    current = id;
    notify();
    const volume = clampedVolume(options.getVolume?.());
    if (volume <= 0) {
      stop();
      return { playing: false, voice: id, muted: true };
    }
    const line = voiceSampleLine(id);
    try {
      const blob = await fetchPreview(id, line);
      if (token !== seq) return { playing: false, voice: id };
      if (blob) {
        const CreateAudio = options.createAudio || globalThis.Audio;
        objectUrl = URL.createObjectURL(blob);
        audio = typeof CreateAudio === "function" ? new CreateAudio(objectUrl) : null;
        if (!audio) throw new Error("This browser cannot play a voice sample.");
        audio.volume = volume;
        audio.onended = audio.onerror = () => { if (token === seq) stop(); };
        await audio.play();
        if (token !== seq) return { playing: false, voice: id };
        return { playing: true, voice: id, source: "tts" };
      }
      throw new Error("The selected voice sample is unavailable. Sign in and check your OpenAI API key.");
    } catch (error) {
      if (token !== seq) return { playing: false, voice: id };
      stop();
      throw error instanceof Error ? error : new Error("This voice sample could not play.");
    }
  }

  return {
    play,
    stop,
    playing: () => current,
    isPlaying: (voice) => current === normalizeRealtimeVoice(voice),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
