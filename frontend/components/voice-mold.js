/**
 * Live voice-mold prototype.
 * Fast path: OpenAI Realtime WebSocket (session stays open).
 * Astra / Astra Pro: turn-based ChatGPT/Codex — humans will notice the buffer.
 */

import { VoiceAudioOutput } from "./voice-audio-output.js?v=20260930-one-voice-owner1";
import { boundedVoiceContext, voiceAgentSettings, voiceContextMessage, voiceWakeMatches, voiceRealtimeConfig } from "./voice-agent-protocol.js?v=20260923-stable-voice1&singlevoice2&hey-ai-single=20260929-1";

const LS_MODEL = "render3d:voice-mold-model";
const PCM_RATE = 24000;
export const DEFAULT_HEY_AI_INTRO = "Hi, I’m Render, your design partner. What would you like to design?";

const FALLBACK_MODELS = [
  { id: "gpt-realtime-mini", label: "Realtime Mini", latency: "lowest", transport: "realtime" },
  { id: "gpt-realtime", label: "Realtime", latency: "low", transport: "realtime" },
  { id: "gpt-realtime-1.5", label: "Realtime 1.5", latency: "low", transport: "realtime" },
  { id: "gpt-6-astra", label: "Astra", latency: "high", transport: "turn" },
  { id: "gpt-6-astra-pro", label: "Astra Pro", latency: "high", transport: "turn" },
];

function b64FromInt16(samples) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function int16FromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function downsample(float32, inRate, outRate) {
  if (inRate === outRate) return float32;
  const ratio = inRate / outRate;
  const outLen = Math.max(1, Math.round(float32.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, float32.length - 1);
    const f = pos - i0;
    out[i] = float32[i0] * (1 - f) + float32[i1] * f;
  }
  return out;
}

function floatToPcm16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function studioVoiceMoldProxyUrl({
  host,
  protocol,
  token,
  model,
  projectId = "",
  path = "/api/voice-mold/ws",
} = {}) {
  const raw = String(protocol || "ws:").replace(/:$/, "").toLowerCase();
  const proto = (raw === "https" || raw === "wss") ? "wss:" : (raw === "http" || raw === "ws") ? "ws:" : `${raw}:`;
  const params = new URLSearchParams();
  if (token) params.set("token", String(token));
  if (model) params.set("model", String(model));
  if (projectId) params.set("project_id", String(projectId));
  const q = params.toString();
  const prefix = String(path || "/api/voice-mold/ws");
  const wsPath = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return `${proto}//${host}${wsPath}${q ? `?${q}` : ""}`;
}

import { LIVE_ASTRA_FLOOR, occupyFloor, releaseFloor } from "../sandbox/tts-mutex.js?v=sandbox1&ttsturn1=1&singlevoice1";

export function usesStudioRealtimeProxy(session = {}) {
  const path = String(session?.proxy_ws_path || session?.ws_url || "");
  return path.startsWith("/api/voice-mold/ws") || path.includes("/api/voice-mold/ws");
}

export function realtimeBrowserProtocols(secret) {
  const key = String(secret || "").trim();
  if (!key) return ["realtime"];
  // GA Realtime must not opt into the retired beta protocol.
  return ["realtime", `openai-insecure-api-key.${key}`];
}

export function explicitTurnGenerationRequest(text = "") {
  const line = String(text || "").trim().toLowerCase();
  if (!line) return false;
  return /\b(generate|build|create|make|model|submit|run)\b.{0,36}\b(it|this|that|the (?:part|model|design|prompt)|what we (?:discussed|described))\b/.test(line)
    || /\b(yes|yeah|yep|correct|confirmed|go ahead|do it)\b.{0,28}\b(generate|build|create|make|model|submit|run)\b/.test(line)
    || /\b(generate|build|create|make|model|submit|run)\b.{0,28}\b(now|please|for me|go ahead)\b/.test(line);
}

export function bufferedVoiceTurnContext(scene = {}, chat = []) {
  return {
    ...(scene || {}),
    conversation: (Array.isArray(chat) ? chat : [])
      .slice(-12)
      .map((line) => ({
        role: line?.role === "assistant" ? "assistant" : "user",
        text: String(line?.text || "").trim().slice(0, 1200),
      }))
      .filter((line) => line.text),
  };
}

export function advanceAutomaticTurnVad(state = {}, level = 0, now = Date.now()) {
  const safeLevel = Number.isFinite(level) ? Math.max(0, level) : 0;
  const noiseFloor = Number.isFinite(state.noiseFloor) ? state.noiseFloor : 0.003;
  const threshold = Math.max(0.006, Math.min(0.018, noiseFloor * 2.4));
  const voiced = safeLevel >= threshold;
  const consecutiveSpeechFrames = voiced ? (state.consecutiveSpeechFrames || 0) + 1 : 0;
  const speechStarted = !state.speechSeen && consecutiveSpeechFrames >= 2;
  const speechSeen = Boolean(state.speechSeen || speechStarted);
  const lastSpeechAt = voiced && speechSeen ? now : (state.lastSpeechAt || 0);
  const nextNoiseFloor = speechSeen || voiced
    ? noiseFloor
    : Math.max(0.0015, Math.min(0.007, noiseFloor * 0.92 + safeLevel * 0.08));
  return {
    state: { noiseFloor: nextNoiseFloor, consecutiveSpeechFrames, speechSeen, lastSpeechAt },
    threshold,
    speechStarted,
    shouldSubmit: speechSeen && !voiced && now - lastSpeechAt >= 900,
  };
}

export function voiceConversationGenerationPrompt(transcript = []) {
  const lines = (Array.isArray(transcript) ? transcript : [])
    .slice(-24)
    .filter((line) => String(line?.text || "").trim())
    .filter((line, index, all) => {
      const text = String(line.text || "").trim();
      return !(index === all.length - 1 && line.role !== "assistant" && text.length < 140 && explicitTurnGenerationRequest(text));
    })
    .map((line) => `${line.role === "assistant" ? "Design partner" : "User"}: ${String(line.text).trim()}`);
  if (!lines.length) return "";
  return [
    "Create the design agreed in this Hey AI conversation. Treat the latest confirmed dimensions, features, and manufacturing constraints as authoritative.",
    "",
    ...lines,
  ].join("\n").slice(0, 12000);
}

export function createVoiceMold(opts = {}) {
  const {
    api,
    getToken,
    getProjectId,
    getDesignContext,
    applyMicroEdit,
    onStatus,
    onLiveChange,
    onTranscript,
    onAudioLevel,
    onChangeProposal,
    getSceneContext,
    getSceneImage,
    getAgentSettings,
    askSelectedModel,
    onDrawBoardCommand,
    onStudioCommand,
    onRobotCommand,
    onSlicerPlateCommand,
    onControlDebuggerFeed,
    onGeneratePrompt,
    readIndexedReference,
    getMicStream,
  } = opts;

  const reviewMode = typeof onChangeProposal === "function";
  const bindDesktop = opts.bindDesktop !== false;
  const doc = { getElementById: (id) => bindDesktop ? document.getElementById(id) : null };
  const root = doc.getElementById("voice-mold-panel");
  const modelEl = doc.getElementById("voice-mold-model");
  const startBtn = doc.getElementById("voice-mold-start");
  const holdBtn = doc.getElementById("voice-mold-hold");
  const statusEl = doc.getElementById("voice-mold-status");
  const logEl = doc.getElementById("voice-mold-log");
  const contextEl = doc.getElementById("voice-mold-context");
  const latencyEl = doc.getElementById("voice-mold-latency");

  let models = FALLBACK_MODELS.slice();
  let modelId = "";
  try { modelId = localStorage.getItem(LS_MODEL) || ""; } catch { modelId = ""; }
  let live = false;
  let connecting = false;
  let ws = null;
  let capture = null;
  let player = null;
  let turnRecorder = null;
  let turnChunks = [];
  let turnStream = null;
  let turnMonitor = null;
  let turnMonitorTimer = null;
  let turnVadState = null;
  let turnReplyDelayMs = 0;
  let turnStopAfterReply = false;
  let lastContextKey = "";
  let contextTimer = null;
  let firstAudioMs = null;
  let speechStartedAt = 0;
  let catalogHint = "";
  let intentionalClose = false;
  let sessionEpoch = 0;
  let lastImageAt = 0;
  let contextBusy = false;
  let wakeActiveUntil = 0;
  let responseActive = false;
  let responseAudioComplete = false;
  let responsePending = false;
  let stopAfterResponseRequested = false;
  let stopAfterResponseArmed = false;
  let pendingTools = 0;
  let volume = voiceAgentSettings(getAgentSettings?.()).volume;
  let audioLevel = 0;
  let activeSession = null;
  let sessionVoice = "";
  let visualState = "not-sent";
  let statusKind = "", statusMessage = "";
  let turnBusy = false;
  let remoteInputStream = null;
  let primedMic = null;
  let primedMicOwned = false;
  let primedPlayer = null;
  let primingMedia = null;
  let mediaEpoch = 0;
  const settings = () => voiceAgentSettings(getAgentSettings?.() || {});
  const outputLevel = (value) => { audioLevel = value; try { onAudioLevel?.(value); } catch { /* UI only */ } };
  const sceneContext = () => {
    const cfg = settings();
    const context = boundedVoiceContext({ ...(getDesignContext?.() || {}), ...(getSceneContext?.() || {}) });
    return reviewMode ? { ...(cfg.includeSelectionMetadata ? context : { vrPresenting:context.vrPresenting===true, note: "Selection metadata sharing disabled" }), agent_review: true, agent_settings: cfg } : context;
  };
  const handledCalls = new Set();

  function currentModel() {
    return models.find((m) => m.id === modelId) || models[0] || FALLBACK_MODELS[0];
  }

  function setStatus(kind, message) {
    const msg = String(message || "");
    statusKind = kind; statusMessage = msg;
    if (statusEl) {
      statusEl.className = `status${kind ? ` ${kind}` : ""}`;
      statusEl.textContent = msg;
    }
    try { onStatus?.(kind, msg); } catch { /* ignore */ }
  }

  const chatRing = [];
  function appendLog(who, text) {
    const line = String(text || "").trim();
    if (!line) return;
    chatRing.push({ who: who === "you" ? "you" : "agent", role: who === "you" ? "user" : "assistant", text: line.slice(0, 240), at: Date.now() });
    if (chatRing.length > 16) chatRing.splice(0, chatRing.length - 16);
    try { onTranscript?.({ role: who === "you" ? "user" : "assistant", text: line }); } catch { /* UI only */ }
    if (!logEl) return;
    const p = document.createElement("p");
    p.className = `voice-mold-line voice-mold-line--${who}`;
    p.textContent = `${who === "you" ? "You" : "Agent"}: ${line}`;
    logEl.appendChild(p);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.childElementCount > 40) logEl.removeChild(logEl.firstChild);
  }

  function paintContext() {
    const ctx = sceneContext();
    const label = ctx.selected || ctx.label || "nothing selected";
    const extra = ctx.catalog ? ` · ${ctx.catalog}` : "";
    if (contextEl) contextEl.textContent = `Pointing / selected: ${label}${extra}`;
    return ctx;
  }

  function syncModelSelect() {
    if (!modelEl) { if (!models.some(m => m.id === modelId)) modelId = models[0]?.id || ""; return; }
    const keep = modelId;
    modelEl.innerHTML = models.map((m) => {
      const tag = m.transport === "realtime" ? m.latency : "turn · slow";
      return `<option value="${m.id}">${m.label} · ${tag}</option>`;
    }).join("");
    if (keep && models.some((m) => m.id === keep)) modelEl.value = keep;
    else modelEl.value = models[0]?.id || "";
    modelId = modelEl.value;
  }

  function syncButtons() {
    const info = currentModel();
    const turn = info.transport === "turn";
    if (startBtn) {
      startBtn.textContent = live ? "Stop session" : (turn ? "Start Astra turns" : "Open live socket");
      startBtn.classList.toggle("active", live);
    }
    if (holdBtn) {
      holdBtn.disabled = !live || !turn;
      holdBtn.classList.toggle("hidden", !turn);
    }
    root?.classList.toggle("is-live", live);
    try { onLiveChange?.(getState()); } catch { /* ignore */ }
  }

  function getState() {
    const info = currentModel();
    return {
      live,
      connecting,
      microphoneLabel: (primedMic || turnStream)?.getAudioTracks?.()[0]?.label || "",
      modelId: info.id,
      sessionModel: live ? activeSession?.model || info.id : null,
      modelLabel: info.label,
      transport: info.transport,
      latencyMs: firstAudioMs,
      hint: info.hint || catalogHint,
      reviewMode, voice:activeSession?.audio?.output?.voice||settings().voice, volume, audioLevel, speaking: audioLevel > 0,
      listening: live && (info.transport === "realtime" || !!turnRecorder),
      wakeListening: live && info.transport === "realtime" && settings().wakeName ? "server-transcription" : "off",
      wakeActive: Date.now() < wakeActiveUntil,
      visualState, recording: !!turnRecorder, turnBusy,
      outputStreamAvailable: !!player?.getOutputStream(),
      requiresApiKey: true, statusKind, statusMessage,
      remoteInputEnabled: !!remoteInputStream && settings().allowOtherUsersTrigger,
      chat: chatRing.slice(-12),
    };
  }

  let voiceMoldAbort = null; // leakfix77
  function beginVoiceMoldFetch() {
    if (voiceMoldAbort) {
      try { voiceMoldAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    voiceMoldAbort = ctl;
    return ctl;
  }

  async function loadCatalog() {
    const ctl = beginVoiceMoldFetch();
    try {
      const pid = getProjectId?.() || "";
      const q = pid ? `?project_id=${encodeURIComponent(pid)}` : "";
      const data = await api(`/api/voice-mold/models${q}`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if (Array.isArray(data?.models) && data.models.length) models = data.models;
      if (reviewMode && settings().voiceModel && models.some(m => m.id === settings().voiceModel)) modelId = settings().voiceModel;
      if (!modelId) modelId = data?.default_model || models[0]?.id;
      catalogHint = data?.has_openai_key
        ? "OpenAI key ready for Realtime WebSocket"
        : (data?.chatgpt_signed_in ? "ChatGPT connected; voice transcription still needs an OpenAI API key" : "Add an OpenAI key or ChatGPT login");
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      catalogHint = err?.message || "Could not load voice models";
    } finally {
      if (voiceMoldAbort === ctl) voiceMoldAbort = null;
    }
    if (ctl.signal.aborted) return;
    syncModelSelect();
    paintContext();
    if (statusEl && !statusEl.textContent) setStatus("", catalogHint);
    syncButtons();
  }

  function sendJson(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(payload)); return true; } catch { return false; }
  }

  function requestResponse() {
    if (responseActive || pendingTools > 0) { responsePending = true; return; }
    responsePending = false;
    if (sendJson({ type: "response.create" })) {
      responseActive = true;
      responseAudioComplete = false;
      if (stopAfterResponseRequested) stopAfterResponseArmed = true;
    }
  }

  async function proposeChange(args = {}, requestReview = false) {
    const instruction = String(args.instruction || "").trim().slice(0, 4000);
    if (!instruction && !requestReview) return { ok: false, error: "instruction required" };
    const context = sceneContext();
    if (context.spatialBoard?.active) return { ok: false, applied: false, generated: false, error: "Draw planning uses board annotations. Organize the prompt, then review and press Generate in Draw AI Prompt." };
    const out = await onChangeProposal?.({
      instruction, title: String(args.title || "").slice(0, 120), reason: String(args.reason || "").slice(0, 1000),
      targetIds: Array.isArray(args.targetIds) ? args.targetIds.slice(0, 24).map(String) : [],
      requestReview, generationModel: context.generationModel || context.model || "", context,
    });
    return { ok: true, queued: !!instruction, applied: false, reviewRequired: true, ...(out || {}) };
  }

  async function handleTool(name, args, callId) {
    const epoch = sessionEpoch;
    pendingTools++;
    let result = { ok: false };
    const codeTool = name === "apply_micro_edit" || name === "propose_cad_change" || name === "review_cad_changes" || name === "generate_ai_prompt";
    try {
      if (codeTool && remoteInputStream) {
        result = { ok: false, applied: false, generated: false, error: "Other people cannot change code through this voice agent." };
      } else if (codeTool && typeof opts.canChangeCode === "function" && opts.canChangeCode() === false) {
        result = { ok: false, applied: false, generated: false, error: "Only the project owner can change code through voice." };
      } else if (reviewMode && ['get_studio_controls','set_studio_setting','run_studio_action'].includes(name)) {
        result = remoteInputStream
          ? {ok:false,error:'Studio controls require the local headset microphone. Disable room voice input before using these commands.'}
          : typeof onStudioCommand === 'function' ? await onStudioCommand(name,args || {}) : {ok:false,error:'Studio controls are unavailable.'};
      } else if (reviewMode && ['get_robotics_setup','run_robotics_action'].includes(name)) {
        result = remoteInputStream
          ? {ok:false,error:'Robot setup voice actions require the local microphone. Disable room voice input before using these commands.'}
          : typeof onRobotCommand === 'function' ? await onRobotCommand(name,args || {}) : {ok:false,error:'Robot setup controls are unavailable.'};
      } else if (reviewMode && name === "draw_board_command") {
        result = settings().includeSelectionMetadata && typeof onDrawBoardCommand === "function"
          ? await onDrawBoardCommand(args || {})
          : { ok: false, generated: false, error: "Enable selection metadata and open Draw AI Prompt to annotate the board." };
      } else if (reviewMode && name === "slicer_plate_command") {
        result = typeof onSlicerPlateCommand === "function"
          ? await onSlicerPlateCommand(args || {})
          : { ok: false, error: "Open Export to slicer in VR first." };
      } else if (reviewMode && name === "feed_control_debugger") {
        result = typeof onControlDebuggerFeed === "function"
          ? await onControlDebuggerFeed(args || {})
          : { ok: false, error: "Control debugger feed is unavailable." };
      } else if (name === "get_design_context") {
        result = { ok: true, ...sceneContext() };
      } else if (reviewMode && name === "read_indexed_reference") {
        result = typeof readIndexedReference === "function"
          ? await readIndexedReference(String(args?.reference_id || ""), sceneContext())
          : { ok: false, error: "Indexed reference reading is unavailable" };
      } else if (reviewMode && name === "ask_selected_model") {
        const question = String(args?.question || "").trim().slice(0, 6000);
        result = question && typeof askSelectedModel === "function"
          ? await askSelectedModel(question, sceneContext())
          : { ok: false, error: "Selected-model reasoning is unavailable" };
      } else if (reviewMode && name === "generate_ai_prompt") {
        result = remoteInputStream
          ? { ok: false, generated: false, error: "Voice generation requires the local microphone." }
          : typeof onGeneratePrompt === "function"
            ? await onGeneratePrompt(args || {}, sceneContext())
            : { ok: false, generated: false, error: "Voice generation is unavailable." };
      } else if (reviewMode && (name === "propose_cad_change" || name === "apply_micro_edit")) {
        result = await proposeChange(args);
      } else if (reviewMode && name === "review_cad_changes") {
        result = await proposeChange({}, true);
      } else if (name === "apply_micro_edit") {
        const instruction = String(args?.instruction || "").trim();
        const applyNow = !!args?.apply_now;
        if (!instruction) result = { ok: false, error: "instruction required" };
        else {
          const out = await applyMicroEdit?.(instruction, { applyNow });
          result = { ok: true, queued: !applyNow, ...(out || {}) };
          appendLog("agent", applyNow ? `Applying: ${instruction}` : `Queued: ${instruction}`);
        }
      } else {
        result = { ok: false, error: `unknown tool ${name}` };
      }
    } catch (err) {
      result = { ok: false, error: err?.message || "tool failed" };
    }
    if (epoch !== sessionEpoch) return;
    pendingTools=Math.max(0,pendingTools-1);
    if (!live) return;
    if (result?.stop_after_response) stopAfterResponseRequested = true;
    sendJson({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) },
    });
    requestResponse();
  }

  function onRealtimeEvent(ev) {
    const type = String(ev?.type || "");
    if (type === "response.created") {
      responseActive = true;
      responseAudioComplete = false;
    }
    if (type === "response.output_audio.done" || type === "response.audio.done") responseAudioComplete = true;
    if (type === "response.done") {
      responseActive = false;
      responseAudioComplete = false;
      if (responsePending) {
        requestResponse();
      } else if (stopAfterResponseArmed) {
        stopAfterResponseRequested = false;
        stopAfterResponseArmed = false;
        stop();
        return;
      }
    }
    if (type === "error") {
      setStatus("error", ev.error?.message || ev.message || "Realtime error");
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      speechStartedAt = performance.now();
      firstAudioMs = null;
      if (latencyEl) latencyEl.textContent = "Listening…";
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = ev.transcript || ev.item?.content?.[0]?.transcript;
      if (text) appendLog("you", text);
      try {
        if (text && globalThis.Render3DSandbox?.isOpen?.()) {
          globalThis.dispatchEvent(new CustomEvent("render3d-sandbox-voice-step", { detail: { text, source: "gpt_voice" } }));
        }
      } catch { /* sandbox map optional */ }
      if (reviewMode && text) {
        const requiredName = remoteInputStream ? (settings().wakeName || settings().name) : settings().wakeName;
        const awake = !requiredName || (!remoteInputStream && Date.now() < wakeActiveUntil) || voiceWakeMatches(text, requiredName);
        // While Astra is speaking, ambient audio and speaker echo must not tear
        // down the response. An explicit wake phrase remains a deliberate barge-in.
        const acceptTurn = awake && (!responseActive || responseAudioComplete);
        if (acceptTurn) {
          wakeActiveUntil = Date.now() + 30000;
          responsePending = false;
          player?.interrupt();
          const epoch = sessionEpoch;
          void sendContext(undefined, { image: true }).then(() => { if (live && epoch === sessionEpoch) requestResponse(); });
        } else if (ev.item_id) sendJson({ type: "conversation.item.delete", item_id: ev.item_id });
      }
    }
    if (
      type === "response.output_audio.delta"
      || type === "response.audio.delta"
      || type === "response.output_audio_transcript.delta"
      || type === "response.audio_transcript.delta"
    ) {
      if (speechStartedAt && firstAudioMs == null && type.includes("audio.delta") && !type.includes("transcript")) {
        firstAudioMs = Math.round(performance.now() - speechStartedAt);
        if (latencyEl) latencyEl.textContent = `First audio ${firstAudioMs} ms`;
      }
    }
    if ((type === "response.output_audio.delta" || type === "response.audio.delta") && ev.delta) {
      try { player?.playPcm16(int16FromB64(ev.delta)); } catch { /* ignore */ }
    }
    if (
      (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done")
      && (ev.transcript || ev.text)
    ) {
      appendLog("agent", ev.transcript || ev.text);
    }
    if (type === "response.output_audio_transcript.delta" || type === "response.audio_transcript.delta") {
      /* incremental; final line logged on done */
    }
    if (type === "response.function_call_arguments.done") {
      const callId = ev.call_id;
      if (callId && handledCalls.has(callId)) return;
      if (callId) handledCalls.add(callId);
      let args = {};
      try { args = JSON.parse(ev.arguments || "{}"); } catch { args = {}; }
      if (handledCalls.size > 256) handledCalls.delete(handledCalls.values().next().value);
      void handleTool(ev.name, args, callId);
    }
    if (type === "response.output_item.done" && ev.item?.type === "function_call" && ev.item?.call_id) {
      const callId = ev.item.call_id;
      if (handledCalls.has(callId)) return;
      handledCalls.add(callId);
      if (ev.item.arguments && ev.item.name) {
        let args = {};
        try { args = JSON.parse(ev.item.arguments || "{}"); } catch { args = {}; }
        void handleTool(ev.item.name, args, callId);
      }
    }
  }

  function liveMicStream(stream) {
    return stream?.getAudioTracks?.().some((track) => track.readyState === "live" && track.enabled !== false) ? stream : null;
  }

  function preferRealtimeModel() {
    const info = currentModel();
    if (info.transport === "realtime") return info;
    const wanted = settings().voiceModel;
    const match = models.find((m) => m.id === wanted && m.transport === "realtime")
      || models.find((m) => m.transport === "realtime");
    if (match) {
      modelId = match.id;
      if (modelEl) modelEl.value = modelId;
    }
    return currentModel();
  }

  function primeMedia({ stream } = {}) {
    // Unlock output while still inside the controller/click gesture, before mic permissions or HTTP.
    volume = settings().volume;
    if (!primedPlayer && !player) primedPlayer = new VoiceAudioOutput({ volume, onLevel: outputLevel });
    const output = primedPlayer || player;
    output.setVolume(volume);
    const resumed = output.resume();
    if (primingMedia) { void resumed.catch(() => {}); return primingMedia; }
    const epoch = mediaEpoch;
    const task = (async () => {
      // Keep the microphone already acquired for this startup. A room stream
      // appearing between bridge priming and start() must not orphan our track.
      const offered = liveMicStream(primedMic) || liveMicStream(stream) || liveMicStream(getMicStream?.());
      if (offered) {
        const owned = offered === primedMic && primedMicOwned;
        primedMic = offered; primedMicOwned = owned;
      } else {
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: opts.getMicConstraints?.() || { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
        if (epoch !== mediaEpoch) { acquired.getTracks().forEach(t => t.stop()); return false; }
        primedMic = acquired; primedMicOwned = true;
      }
      await resumed;
      return epoch === mediaEpoch;
    })();
    // Attach rejection handling immediately; another caller can await the same request.
    void resumed.catch(() => {});
    primingMedia = task;
    void task.finally(() => { if (primingMedia === task) primingMedia = null; }).catch(() => {});
    return task;
  }

  function greetNow(text) {
    if (!live || currentModel().transport !== "realtime") return false;
    const requested = String(text || "").trim();
    const line = (requested || `Introduce yourself once, briefly, using exactly this wording: "${DEFAULT_HEY_AI_INTRO}"`).slice(0, 6000);
    return sendText(line, { respond: true });
  }

  async function speakBufferedIntro(epoch, projectId) {
    if (volume <= 0) return;
    setStatus("loading", "Render is joining…");
    try {
      const audio = await api("/api/voice-mold/speech", { method: "POST", body: JSON.stringify({
        text: DEFAULT_HEY_AI_INTRO,
        voice: sessionVoice || settings().voice,
        project_id: projectId || null,
      }) }, 65000);
      if (!live || epoch !== sessionEpoch || projectId !== String(getProjectId?.() || "")) return;
      if (audio?.format !== "pcm16" || audio?.sample_rate !== PCM_RATE || !audio?.audio) return;
      if (!player) { player = primedPlayer || new VoiceAudioOutput({ volume, onLevel: outputLevel }); primedPlayer = null; }
      player.setVolume(volume);
      await player.resume();
      if (!live || epoch !== sessionEpoch) return;
      const samples = int16FromB64(audio.audio);
      turnReplyDelayMs = Math.ceil((samples.length / PCM_RATE) * 1000) + 350;
      player.playPcm16(samples);
    } catch {
      // The conversation remains usable when provider speech is unavailable.
    }
  }

  async function startMicPcm(onChunk) {
    const existing = liveMicStream(primedMic) || liveMicStream(getMicStream?.());
    const ownStream = !existing || primedMicOwned;
    const stream = existing || await navigator.mediaDevices.getUserMedia({
      audio: opts.getMicConstraints?.() || { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    if (!primedMic) { primedMic = stream; primedMicOwned = ownStream; }
    // Reuse the context resumed by primeMedia in the original click/XR gesture.
    // Creating a fresh capture context after HTTP/socket awaits can leave it
    // suspended in headset browsers even while the output context is running.
    const sharedContext = player?.ctx || primedPlayer?.ctx;
    const ctx = sharedContext || new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(proc);
    let remoteSource = null;
    proc.connect(mute);
    mute.connect(ctx.destination);
    proc.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const resampled = downsample(input, ctx.sampleRate, PCM_RATE);
      onChunk(floatToPcm16(resampled));
    };
    if (ctx.state === "suspended") await ctx.resume();
    return {
      setRemoteStream(stream) {
        try { remoteSource?.disconnect(); } catch { /* removed */ }
        remoteSource = null;
        if (stream?.getAudioTracks?.().length) {
          remoteSource = ctx.createMediaStreamSource(stream);
          remoteSource.connect(proc);
        }
      },
      stop() {
        try { remoteSource?.disconnect(); } catch { /* removed */ }
        try { proc.disconnect(); } catch { /* ignore */ }
        try { src.disconnect(); } catch { /* ignore */ }
        if (ownStream) {
          try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        }
        if (primedMic === stream) { primedMic = null; primedMicOwned = false; }
        if (!sharedContext) try { void ctx.close()?.catch?.(() => {}); } catch { /* ignore */ }
      },
    };
  }

  async function sendContext(context, { image = false, force = true } = {}) {
    const cfg = settings();
    const ctx = boundedVoiceContext(!reviewMode || cfg.includeSelectionMetadata ? (context || sceneContext()) : sceneContext());
    if (!live || currentModel().transport !== "realtime" || contextBusy) return false;
    const key = JSON.stringify(ctx);
    const captureImage = image && cfg.includeVisualContext && typeof getSceneImage === "function" && Date.now() - lastImageAt >= 5000;
    if (!force && key === lastContextKey && !captureImage) return false;
    contextBusy = true;
    const epoch = sessionEpoch;
    try {
      let snapshot = "";
      if (captureImage) {
        lastImageAt = Date.now();
        try {
          // A dropped XR frame must not block a spoken reply indefinitely.
          snapshot = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(""), 1200);
            Promise.resolve().then(() => getSceneImage()).then(resolve, () => resolve("")).finally(() => clearTimeout(timeout));
          });
        } catch { visualState = "unavailable"; }
      }
      if (!live || epoch !== sessionEpoch) return false;
      const message = voiceContextMessage(ctx, snapshot);
      if (captureImage) visualState = message.item.content.length > 1 ? "sent" : "unavailable";
      if (sendJson(message)) { lastContextKey = key; return true; }
      return false;
    } finally { contextBusy = false; }
  }

  function pushContextIfChanged(force = false) {
    paintContext();
    return sendContext(undefined, { force, image: reviewMode });
  }

  function sendText(text, { respond = true } = {}) {
    const line = String(text || "").trim().slice(0, 6000);
    if (!line || !live || currentModel().transport !== "realtime") return false;
    if (!sendJson({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: line }] } })) return false;
    appendLog("you", line);
    wakeActiveUntil = Date.now() + 30000;
    if (respond) requestResponse();
    return true;
  }

  async function connectRealtime(session, epoch) {
    const proxy = usesStudioRealtimeProxy(session);
    let url;
    let protocols;
    if (proxy) {
      url = studioVoiceMoldProxyUrl({
        host: location.host,
        protocol: location.protocol === "https:" ? "wss:" : "ws:",
        token: getToken?.() || "",
        model: session.model || currentModel().id,
        projectId: getProjectId?.() || "",
        path: session.proxy_ws_path || "/api/voice-mold/ws",
      });
      protocols = undefined;
    } else {
      url = session.ws_url || `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model)}`;
      protocols = realtimeBrowserProtocols(session.client_secret);
    }
    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => { if (!settled) { settled = true; reject(new Error("Realtime session timed out")); } }, 20000);
      try {
        ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
        return;
      }
      const socket = ws;
      ws.addEventListener("open", () => {
        if (epoch !== sessionEpoch) { socket.close(); return; }
        // The proxy's bootstrap has no project context; always apply the full config.
        activeSession = voiceRealtimeConfig(session.model || currentModel().id, { ...settings(), voice: sessionVoice }, {
          review: reviewMode, instructions: session.instructions, tools: session.tools || [], drawBoard: typeof onDrawBoardCommand === "function", studioControls: typeof onStudioCommand === 'function', roboticsControls: typeof onRobotCommand === 'function', slicerPlates: typeof onSlicerPlateCommand === 'function',
        });
        sendJson({ type: "session.update", session: activeSession });
      });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        if (!settled) reject(new Error("Could not open OpenAI Realtime WebSocket"));
      });
      ws.addEventListener("close", () => {
        clearTimeout(timeout);
        if (!settled) reject(new Error("Realtime socket closed before it opened"));
        if (epoch === sessionEpoch && live && !intentionalClose) {
          live = false;
          stopCapture();
          syncButtons();
          setStatus("error", "Realtime socket closed");
        }
      });
      ws.addEventListener("message", (evt) => {
        if (epoch !== sessionEpoch) return;
        try {
          const payload = JSON.parse(evt.data);
          if (!settled) {
            const type = String(payload?.type || "");
            if (type === "error") {
              clearTimeout(timeout);
              settled = true;
              reject(new Error(payload.error?.message || payload.message || "Realtime session error"));
              return;
            }
            if (type === "session.updated") {
              clearTimeout(timeout);
              settled = true;
              resolve();
            }
          }
          onRealtimeEvent(payload);
        } catch { /* ignore */ }
      });
    });
    if (epoch !== sessionEpoch) return;
    const nextPlayer = primedPlayer || new VoiceAudioOutput({ volume, onLevel: outputLevel });
    primedPlayer = null;
    player = nextPlayer;
    await nextPlayer.resume();
    nextPlayer.attachHeadsetElement();
    if (epoch !== sessionEpoch) { nextPlayer.close(); return; }
    const nextCapture = await startMicPcm((pcm) => {
      if (!pcm?.length || epoch !== sessionEpoch) return;
      sendJson({ type: "input_audio_buffer.append", audio: b64FromInt16(pcm) });
    });
    if (epoch !== sessionEpoch) { nextCapture.stop(); nextPlayer.close(); return; }
    capture = nextCapture;
    if (remoteInputStream && settings().allowOtherUsersTrigger) capture.setRemoteStream(remoteInputStream);
    lastContextKey = "";
    // Initial context is sent after start() marks the session live.
    contextTimer = setInterval(() => pushContextIfChanged(false), 2000);
  }

  async function startTurnSession(epoch = sessionEpoch) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: opts.getMicConstraints?.() || { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    if (epoch !== sessionEpoch) { stream.getTracks().forEach(t => t.stop()); return; }
    turnStream = stream;
  }

  async function sendTurnBlob(blob) {
    const fd = new FormData();
    fd.append("file", blob, "speech.webm");
    fd.append("model", currentModel().id);
    const turnContext = bufferedVoiceTurnContext(sceneContext(), chatRing);
    const turnProject = String(getProjectId?.() || "");
    fd.append("context", JSON.stringify(turnContext));
    setStatus("loading", "Astra turn — waiting on Codex (this will buffer)…");
    const epoch = sessionEpoch;
    const data = await api("/api/voice-mold/turn", { method: "POST", body: fd }, 180000);
    if (!live || epoch !== sessionEpoch || turnProject !== String(getProjectId?.() || "")) return;
    if (data?.transcript) appendLog("you", data.transcript);
    let spoken = data?.speak || "";
    let generationAccepted = false;
    if (reviewMode && explicitTurnGenerationRequest(data?.transcript) && typeof onGeneratePrompt === "function") {
      const generated = await onGeneratePrompt({ target_mode: "auto", reason: data.transcript }, turnContext);
      if (generated?.ok === false) spoken = generated.error || "Generation could not start.";
      else {
        generationAccepted = generated?.accepted === true || generated?.generated === true;
        if (generated?.message) spoken = generated.message;
      }
      turnStopAfterReply = generated?.stop_after_response === true;
    }
    if (reviewMode && data?.board_command && turnContext.spatialBoard?.active && typeof onDrawBoardCommand === "function" && settings().includeSelectionMetadata) {
      const boardCommand = { ...data.board_command };
      if (["add_note", "annotate_split"].includes(boardCommand.action) && !boardCommand.regionId && turnContext.spatialBoard.selectedRegionId) boardCommand.regionId = turnContext.spatialBoard.selectedRegionId;
      const result = await onDrawBoardCommand(boardCommand);
      if (result?.error) spoken = result.error;
      else if (result?.question && !spoken.includes(result.question)) spoken += ` ${result.question}`;
    }
    let speechError = "";
    if (spoken) {
      appendLog("agent", spoken);
      if (volume > 0) try {
        const audio = await api("/api/voice-mold/speech", { method: "POST", body: JSON.stringify({
          text: spoken, voice: sessionVoice || settings().voice, project_id: turnProject || null,
        }) }, 65000);
        if (!live || epoch !== sessionEpoch || turnProject !== String(getProjectId?.() || "")) return;
        if (audio?.format !== "pcm16" || audio?.sample_rate !== PCM_RATE || !audio?.audio) throw new Error("Voice audio is unavailable; the text reply is shown.");
        if (!player) { player = primedPlayer || new VoiceAudioOutput({ volume, onLevel: outputLevel }); primedPlayer = null; }
        player.setVolume(volume);
        await player.resume();
        if (!live || epoch !== sessionEpoch) return;
        const samples = int16FromB64(audio.audio);
        turnReplyDelayMs = Math.ceil((samples.length / PCM_RATE) * 1000) + 250;
        player.playPcm16(samples);
      } catch (error) {
        speechError = error?.message || "Voice audio is unavailable; the text reply is shown.";
      }
    }
    if (!live || epoch !== sessionEpoch || turnProject !== String(getProjectId?.() || "")) return;
    if (!generationAccepted && data?.edit?.instruction) {
      if (reviewMode) await proposeChange(data.edit, !!(data.request_review || data.edit.request_review));
      else await applyMicroEdit?.(data.edit.instruction, { applyNow: !!data.edit.apply_now });
    }
    if (!generationAccepted && reviewMode && (data?.request_review || data?.edit?.request_review) && !data?.edit?.instruction) await proposeChange({}, true);
    setStatus(speechError ? "error" : "ok", speechError || (data?.speak ? "Astra replied" : "Turn complete"));
  }

  async function beginHold() {
    if (!live || turnRecorder || turnBusy || currentModel().transport !== "turn") return;
    if (!turnStream) await startTurnSession();
    turnChunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    turnRecorder = new MediaRecorder(turnStream, { mimeType: mime });
    turnRecorder.ondataavailable = (ev) => {
      if (ev.data?.size) turnChunks.push(ev.data);
    };
    turnRecorder.start();
    holdBtn?.classList.add("is-holding");
    setStatus("ok", "Recording — release to send");
  }

  async function endHold() {
    holdBtn?.classList.remove("is-holding");
    const rec = turnRecorder;
    turnRecorder = null;
    if (!rec) return;
    const blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(turnChunks, { type: rec.mimeType || "audio/webm" }));
      try { rec.stop(); } catch { resolve(new Blob(turnChunks, { type: "audio/webm" })); }
    });
    if (blob.size < 64) {
      setStatus("error", "Clip too short");
      return;
    }
    try {
      turnBusy = true;
      syncButtons();
      await sendTurnBlob(blob);
    } catch (err) {
      setStatus("error", err?.message || "Astra turn failed");
    } finally {
      turnBusy = false;
      syncButtons();
      if (live && currentModel().transport === "turn" && turnStopAfterReply) {
        const delay = turnReplyDelayMs;
        turnReplyDelayMs = 0;
        turnStopAfterReply = false;
        setTimeout(() => { if (live) stop(); }, delay);
      } else if (live && currentModel().transport === "turn") {
        const delay = turnReplyDelayMs;
        turnReplyDelayMs = 0;
        setTimeout(() => { if (live && !turnBusy && !turnRecorder) void armAutomaticTurnCapture(); }, delay);
      }
    }
  }

  async function armAutomaticTurnCapture() {
    if (!live || turnBusy || turnRecorder || currentModel().transport !== "turn") return;
    await beginHold();
    if (!turnRecorder || !turnStream) return;
    turnVadState = { noiseFloor: 0.003, consecutiveSpeechFrames: 0, speechSeen: false, lastSpeechAt: 0 };
    if (!turnMonitor) {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(turnStream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      turnMonitor = { context, source, analyser, samples: new Float32Array(analyser.fftSize) };
    }
    clearInterval(turnMonitorTimer);
    turnMonitorTimer = setInterval(() => {
      if (!turnRecorder || turnBusy || !turnMonitor) return;
      turnMonitor.analyser.getFloatTimeDomainData(turnMonitor.samples);
      let sum = 0;
      for (const sample of turnMonitor.samples) sum += sample * sample;
      const level = Math.sqrt(sum / turnMonitor.samples.length);
      const vad = advanceAutomaticTurnVad(turnVadState, level, Date.now());
      turnVadState = vad.state;
      if (vad.state.speechSeen && level >= vad.threshold) {
        setStatus("ok", "Listening…");
      } else if (vad.shouldSubmit) {
        clearInterval(turnMonitorTimer);
        turnMonitorTimer = null;
        void endHold();
      }
    }, 100);
    setStatus("ok", "Listening…");
  }

  function stopCapture() {
    mediaEpoch++; primingMedia = null;
    intentionalClose = true;
    responseActive = false;
    responseAudioComplete = false;
    responsePending = false;
    stopAfterResponseRequested = false;
    stopAfterResponseArmed = false;
    outputLevel(0);
    try { capture?.stop?.(); } catch { /* ignore */ }
    capture = null;
    remoteInputStream = null;
    try { player?.close?.(); } catch { /* ignore */ }
    player = null;
    if (primedPlayer && primedPlayer !== player) {
      try { primedPlayer.close?.(); } catch { /* ignore */ }
    }
    primedPlayer = null;
    if (primedMicOwned) {
      try { primedMic?.getTracks?.().forEach((t) => t.stop()); } catch { /* ignore */ }
    }
    primedMic = null;
    primedMicOwned = false;
    try { ws?.close?.(); } catch { /* ignore */ }
    ws = null;
    try { turnRecorder?.stop?.(); } catch { /* ignore */ }
    turnRecorder = null;
    try { turnStream?.getTracks?.().forEach((t) => t.stop()); } catch { /* ignore */ }
    turnStream = null;
    clearInterval(turnMonitorTimer);
    turnMonitorTimer = null;
    if (turnMonitor) {
      try { turnMonitor.source?.disconnect?.(); } catch { /* ignore */ }
      try { void turnMonitor.context?.close?.(); } catch { /* ignore */ }
    }
    turnMonitor = null;
    if (contextTimer) {
      clearInterval(contextTimer);
      contextTimer = null;
    }
    try { window.speechSynthesis?.cancel?.(); } catch { /* ignore */ }
  }

  async function start(opts = {}) {
    const greet = opts.greet === true;
    const spoken = String(opts.text || "").trim();
    if (live) {
      if (greet) greetNow(spoken);
      return getState();
    }
    if (connecting) return getState();
    connecting = true;
    const epoch = ++sessionEpoch;
    pendingTools=0;
    const startSettings = settings();
    volume = startSettings.volume;
    sessionVoice = startSettings.voice;
    syncButtons();
    setStatus("loading", "Opening session…");
    paintContext();
    try {
      if (!await primeMedia(opts) || epoch !== sessionEpoch) return;
      await loadCatalog();
      if (epoch !== sessionEpoch) return;
      preferRealtimeModel();
      const session = await api("/api/voice-mold/session", {
        method: "POST",
        body: JSON.stringify({
          model: currentModel().id,
          project_id: getProjectId?.() || null,
          context: sceneContext(),
        }),
      });
      if (epoch !== sessionEpoch) return;
      if (session.transport === "realtime") {
        intentionalClose = false;
        handledCalls.clear();
        await connectRealtime(session, epoch);
        if (epoch !== sessionEpoch) return;
        live = true;
        occupyFloor(LIVE_ASTRA_FLOOR);
        void pushContextIfChanged(true);
        setStatus("ok", `${session.label} socket live — talk, point, mold`);
        if (latencyEl) latencyEl.textContent = "Socket open · waiting for speech";
        if (greet) greetNow(spoken);
      } else {
        await startTurnSession(epoch);
        if (epoch !== sessionEpoch) return;
        live = true;
        occupyFloor(LIVE_ASTRA_FLOOR);
        if (greet) await speakBufferedIntro(epoch, String(getProjectId?.() || ""));
        if (epoch !== sessionEpoch) return;
        const introDelay = turnReplyDelayMs;
        turnReplyDelayMs = 0;
        if (introDelay > 0) {
          setStatus("ok", "Render is speaking…");
          setTimeout(() => { if (live && epoch === sessionEpoch && !turnBusy && !turnRecorder) void armAutomaticTurnCapture(); }, introDelay);
        } else {
          void armAutomaticTurnCapture();
          setStatus("ok", "Listening…");
        }
        if (latencyEl) latencyEl.textContent = "Turn-based · Codex latency";
      }
    } catch (err) {
      if (epoch !== sessionEpoch) return;
      stopCapture();
      live = false;
      const message = err?.name === "NotFoundError"
        ? "No microphone is available. Check this device's microphone, then try again."
        : err?.name === "NotReadableError" ? "The microphone is busy or unavailable. Close other apps using it, then tap Talk again."
          : err?.name === "NotAllowedError" || err?.name === "SecurityError"
            ? "Allow microphone access for this site in your browser and device settings, then try again."
            : err?.message || "Could not start voice mold";
      setStatus("error", message);
    } finally {
      if (epoch === sessionEpoch) { connecting = false; syncButtons(); }
    }
    return getState();
  }

  function stop() {
    sessionEpoch++;
    live = false;
    connecting = false;
    sessionVoice = "";
    releaseFloor(LIVE_ASTRA_FLOOR);
    stopCapture();
    syncButtons();
    setStatus("", "Session closed");
    if (latencyEl) latencyEl.textContent = "";
  }

  async function toggle() {
    if (live || connecting) stop();
    else await start();
    return getState();
  }

  function cycleModel() {
    if (live) stop();
    const idx = Math.max(0, models.findIndex((m) => m.id === currentModel().id));
    const next = models[(idx + 1) % models.length];
    modelId = next.id;
    try { localStorage.setItem(LS_MODEL, modelId); } catch { /* ignore */ }
    if (modelEl) modelEl.value = modelId;
    syncButtons();
    setStatus("ok", `Voice model: ${next.label}`);
    return getState();
  }

  modelEl?.addEventListener("change", () => {
    if (live) stop();
    modelId = modelEl.value;
    try { localStorage.setItem(LS_MODEL, modelId); } catch { /* ignore */ }
    syncButtons();
  });
  startBtn?.addEventListener("click", () => { void toggle(); });
  modelEl?.addEventListener("focus", () => { void loadCatalog(); });
  holdBtn?.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    void beginHold();
  });
  holdBtn?.addEventListener("pointerup", () => { void endHold(); });
  holdBtn?.addEventListener("pointerleave", () => {
    if (turnRecorder) void endHold();
  });

  window.addEventListener("render3d:first-mesh", () => { void loadCatalog(); }, { once: true });
  window.addEventListener("render3d:explorer-thumbs-ready", () => { void loadCatalog(); }, { once: true });

  return {
    getState,
    sendContext,
    sendText,
    beginHold,
    endHold,
    getInputStream: () => primedMic || turnStream || null,
    getOutputStream: () => player?.getOutputStream() || null,
    setRemoteInputStream(stream) {
      remoteInputStream = settings().allowOtherUsersTrigger && stream?.getAudioTracks?.().length ? stream : null;
      capture?.setRemoteStream(remoteInputStream);
      wakeActiveUntil = 0;
      return !!remoteInputStream;
    },
    setVolume(value) { const n = Number(value); volume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.8; player?.setVolume(volume); return volume; },
    setModel(id) {
      if (!models.some(m => m.id === id)) return false;
      if (live || connecting) stop();
      modelId = id;
      try { localStorage.setItem(LS_MODEL, modelId); } catch { /* optional storage */ }
      if (modelEl) modelEl.value = id;
      syncButtons();
      return true;
    },
    refreshSettings() {
      volume = settings().volume;
      player?.setVolume(volume);
      if (!settings().allowOtherUsersTrigger) { remoteInputStream = null; capture?.setRemoteStream(null); }
      if (live && reviewMode && activeSession) {
        const next = voiceRealtimeConfig(currentModel().id, settings(), { review: true, drawBoard: typeof onDrawBoardCommand === "function", studioControls: typeof onStudioCommand === 'function', roboticsControls: typeof onRobotCommand === 'function', slicerPlates: typeof onSlicerPlateCommand === 'function' });
        // OpenAI locks voice after the first audio; the new voice applies on reconnect.
        next.audio.output.voice = activeSession.audio.output.voice;
        activeSession = next;
        sendJson({ type: "session.update", session: next });
      }
      return getState();
    },
    toggle,
    start,
    stop,
    primeMedia,
    greet: greetNow,
    cycleModel,
    refresh: loadCatalog,
    setPointedPart() { paintContext(); void sendContext(undefined, { image: true }); },
  };
}
