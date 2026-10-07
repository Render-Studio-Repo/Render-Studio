import { createVoiceMold } from "../components/voice-mold.js?v=20260930-one-voice-owner1";
import { authHeaders, getToken } from "../studio/auth.js?v=aska1";

let active = null;

/** Capture on the browser's device; the server is only an authenticated relay. */
export function mountAstraVoice(root, { getProjectId, setReply, getContext } = {}) {
  const button = root.querySelector("[data-sb-ask-voice]");
  const select = root.querySelector("[data-sb-ask-mic]");
  let destroyed = false;
  const update = () => {
    const state = voice.getState();
    const on = state.live || state.connecting;
    root.dataset.voiceState = state.live ? "live" : state.connecting ? "connecting" : "off";
    root.dataset.voiceModel = state.sessionModel || state.modelId;
    const modelLabel = root.querySelector("[data-sb-voice-model]");
    if (modelLabel) modelLabel.textContent = on ? `Voice: ${root.dataset.voiceModel} (${root.dataset.voiceState})` : "Voice: off";
    button.textContent = state.connecting ? "Cancel voice" : state.live ? "Stop voice" : "Voice";
    button.setAttribute("aria-pressed", String(on));
    select.disabled = on;
    if (state.live) setReply(`Astra listening on this device: ${state.microphoneLabel || select.selectedOptions[0]?.textContent || "default microphone"}`);
  };
  const voice = createVoiceMold({
    bindDesktop: false,
    api: async (path, options = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(path, { ...options, credentials: "same-origin", signal: controller.signal,
          headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }) });
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Voice request failed (HTTP ${res.status})`);
        return data;
      } finally { clearTimeout(timer); }
    },
    getToken,
    getProjectId,
    getMicConstraints: () => ({ echoCancellation: true, noiseSuppression: true, channelCount: 1,
      ...(select.value ? { deviceId: { exact: select.value } } : {}) }),
    getDesignContext: () => ({ source: "sandbox-ask-astra", ...getContext?.() }),
    getAgentSettings: () => ({ name: "Astra", voiceModel: "gpt-realtime", voice: "marin", includeVisualContext: false,
      prompt: "You are Astra in Sandbox. Help diagnose buttons, VR and editor failures. This microphone belongs to the user's browser device, not the server. Report observations separately from guesses. Unknown checks are not passes. Propose fixes with reproduction steps; never claim a queued task is an executed repair. Do not execute CAD or robot changes." }),
    onChangeProposal: () => setReply("Astra suggested a change. Review it in chat before applying anything."),
    onStatus: (kind, message) => { setReply(kind === "loading" ? "Allow this browser to use your local microphone..." : message); },
    onLiveChange: () => update(),
    onTranscript: ({ role, text }) => setReply(`${role === "user" ? "You" : "Astra"}: ${text}`),
  });
  voice.setModel("gpt-realtime");
  const devices = async () => {
    try {
      const keep = select.value;
      const microphones = (await navigator.mediaDevices?.enumerateDevices?.() || []).filter(d => d.kind === "audioinput");
      if (destroyed) return;
      select.replaceChildren(new Option("This device: default microphone", ""));
      microphones.forEach((d, i) => select.add(new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
      if ([...select.options].some(o => o.value === keep)) select.value = keep;
    } catch { /* Default microphone remains available when labels are permission-gated. */ }
  };
  const stop = () => { voice.stop(); if (active === api) active = null; update(); };
  const click = async () => {
    if (voice.getState().live || voice.getState().connecting) { stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setReply("Microphone access requires HTTPS or localhost in a browser on your device."); return; }
    active?.stop(); active = api;
    // start() primes output and requests local media within the original click.
    const starting = voice.start();
    update();
    await starting;
    if (!destroyed) { update(); await devices(); }
  };
  const api = { stop, destroy() {
    destroyed = true; stop(); button.removeEventListener("click", click);
    window.removeEventListener("pagehide", stop);
    navigator.mediaDevices?.removeEventListener?.("devicechange", devices);
  } };
  button.addEventListener("click", click);
  window.addEventListener("pagehide", stop);
  navigator.mediaDevices?.addEventListener?.("devicechange", devices);
  void devices();
  return api;
}
