import { createWakeFallback } from './voice-wake-fallback.js?v=20260916-macmic1';
/**
 * Local wake + Order click → Voice Mold session.
 * Server transcription still gates replies after the socket is live.
 *
 * Chrome / macOS SpeechRecognition start()+onend restart grabs a new capture
 * each cycle and flashes the system mic indicator. Wake listening therefore
 * only meters an already-live shared stream — it never getUserMedia()s, never
 * constructs webkitSpeechRecognition, and never polls.
 */
import { voiceWakePhraseHits } from "./voice-agent-protocol.js?v=20260923-draw-recordings1&hey-ai-single=20260929-1";

export function speechRecognitionCtor(win = typeof window !== "undefined" ? window : globalThis) {
  return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}

export function isVoiceOrderControl(node) {
  if (!node || typeof node.closest !== "function") return false;
  try {
    return !!node.closest("#btn-voice-order, .prompt-voice-order, [data-voice-order='1']");
  } catch {
    return false;
  }
}

export function createVoiceWake(opts = {}) {
  const {
    getWakeName,
    onWake,
    isSessionLive,
  } = opts;

  let wanted = false, waking = false;
  const fallback = createWakeFallback({
    getStream: opts.getMicStream,
    transcribe: opts.transcribe,
    Recorder: opts.Recorder,
    Audio: opts.Audio,
    onText: handleText,
    onStatus: message => {
      wanted = false;
      opts.onStatus?.(message);
    },
  });

  function live() {
    try { return !!isSessionLive?.(); } catch { return false; }
  }

  function handleText(text, { finalOnly = false } = {}) {
    const line = String(text || "").trim();
    if (!line || live() || waking) return false;
    if (!voiceWakePhraseHits(line, getWakeName?.())) return false;
    stop();
    waking = true;
    try {
      const result = onWake?.({ text: line, source: "wake" });
      void Promise.resolve(result).catch(error => opts.onStatus?.(error.message)).finally(() => { waking = false; if (wanted) sync(); });
    } catch (error) { waking = false; opts.onStatus?.(error.message); }
    return true;
  }

  function start() {
    if (live() || waking || fallback.running) return fallback.running;
    // AnalyserNode / MediaRecorder on the existing headset stream only.
    return fallback.start();
  }

  function stop() {
    fallback.stop();
  }

  function sync() {
    if (wanted && !live() && !waking) return start();
    stop();
    return false;
  }

  return {
    handleText,
    start,
    stop,
    enable() {
      wanted = true;
      return sync();
    },
    disable() {
      wanted = false;
      stop();
    },
    sync,
    get wanted() { return wanted; },
    get running() { return fallback.running; },
  };
}
