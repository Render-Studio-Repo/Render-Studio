/** OpenAI Realtime / TTS voice ids. Keep this module import-free for XR. */
export const REALTIME_VOICES = Object.freeze([
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
]);

export function normalizeRealtimeVoice(raw) {
  const voice = String(raw || "").trim().toLowerCase();
  return REALTIME_VOICES.includes(voice) ? voice : "marin";
}

export function voiceSampleLine(voice) {
  const label = normalizeRealtimeVoice(voice);
  return `Hi, I'm ${label.charAt(0).toUpperCase()}${label.slice(1)}. This is how I sound.`;
}

export function cycleRealtimeVoice(current, delta = 1) {
  const list = REALTIME_VOICES;
  const step = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 1;
  const index = list.indexOf(normalizeRealtimeVoice(current));
  return list[(index + (step % list.length) + list.length) % list.length];
}
