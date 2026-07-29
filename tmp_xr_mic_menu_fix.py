#!/usr/bin/env python3
"""Fix XR mic (MediaRecorder+Whisper), menu hits/laser, panel pose persistence."""
from pathlib import Path
import re

# ── app.js: MediaRecorder-first dictation ──────────────────────────────────
app = Path("/home/ubuntu/frontend/app.js")
a = app.read_text()

old = '''const promptDictation = {
  rec: null,
  btn: null,
  stream: null,
  targetId: "prompt-input",
  committed: "",
  liveText: "",
  lastError: "",
};

function isPromptDictationActive() {
  return !!promptDictation.rec;
}

function writePromptMicTranscript(textarea, text) {
  if (!textarea) return;
  textarea.value = text;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function stopPromptDictation() {
  const rec = promptDictation.rec;
  promptDictation.rec = null;
  if (rec) {
    try { rec.onresult = null; } catch (_) {}
    try { rec.onerror = null; } catch (_) {}
    try { rec.onend = null; } catch (_) {}
    try { rec.stop(); } catch (_) {}
    try { rec.abort(); } catch (_) {}
  }
  if (promptDictation.stream) {
    try { promptDictation.stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
    promptDictation.stream = null;
  }
  if (promptDictation.btn) {
    promptDictation.btn.classList.remove("mic-active");
    promptDictation.btn.title = "Dictate prompt (click to start/stop)";
    promptDictation.btn = null;
  }
  document.querySelectorAll(".prompt-mic-btn.mic-active").forEach((b) => {
    b.classList.remove("mic-active");
    b.title = "Dictate prompt (click to start/stop)";
  });
}

/**
 * Toggle speech-to-text into a prompt textarea.
 * @returns {{ ok: boolean, listening?: boolean, error?: string }}
 */
async function togglePromptDictation(targetId = "prompt-input", btn = null) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const textarea = document.getElementById(targetId);
  if (!textarea) return { ok: false, error: "Prompt field missing" };

  if (isPromptDictationActive() && (!btn || btn === promptDictation.btn || targetId === promptDictation.targetId)) {
    const committed = promptDictation.committed;
    stopPromptDictation();
    if (committed) writePromptMicTranscript(textarea, committed);
    return { ok: true, listening: false };
  }

  if (!SpeechRecognition) {
    promptDictation.lastError = "Speech not supported in this browser";
    return { ok: false, error: promptDictation.lastError };
  }

  stopPromptDictation();

  // Keep the mic stream open for the whole dictation (Quest often fails if we
  // release the track before SpeechRecognition starts).
  try {
    if (navigator.mediaDevices?.getUserMedia) {
      promptDictation.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    }
  } catch (err) {
    promptDictation.lastError = "Mic permission blocked — allow microphone for this site";
    console.warn("[mic] getUserMedia", err);
    return { ok: false, error: promptDictation.lastError };
  }

  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  try { rec.maxAlternatives = 1; } catch (_) {}

  const base = textarea.value || "";
  let committed = base;
  promptDictation.committed = committed;
  promptDictation.targetId = targetId;
  promptDictation.lastError = "";
  promptDictation.liveText = base;

  rec.onresult = (e) => {
    let interim = "";
    let finals = base;
    for (const r of e.results) {
      if (r.isFinal) finals += (finals && !finals.endsWith(" ") ? " " : "") + r[0].transcript;
      else interim += r[0].transcript;
    }
    committed = finals;
    promptDictation.committed = finals;
    const live = finals + (interim ? ` ${interim}` : "");
    promptDictation.liveText = live;
    writePromptMicTranscript(textarea, live);
    try {
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    } catch (_) {}
  };

  rec.onerror = (e) => {
    const code = e?.error || "error";
    if (code === "aborted") return;
    promptDictation.lastError =
      code === "not-allowed" ? "Mic permission blocked"
      : code === "no-speech" ? "No speech heard — try again"
      : code === "network" ? "Speech network error"
      : `Mic error: ${code}`;
    console.warn("[mic] recognition error", code);
    stopPromptDictation();
  };

  rec.onend = () => {
    if (promptDictation.rec === rec) {
      writePromptMicTranscript(textarea, committed);
      stopPromptDictation();
    }
  };

  try {
    rec.start();
  } catch (err) {
    promptDictation.lastError = err?.message || "Could not start mic";
    console.warn("[mic] start failed", err);
    stopPromptDictation();
    return { ok: false, error: promptDictation.lastError };
  }

  promptDictation.rec = rec;
  promptDictation.btn = btn;
  if (btn) {
    btn.classList.add("mic-active");
    btn.title = "Recording… click to stop";
  } else {
    // Mark primary prompt mic so XR isTranscribing() polls correctly
    document.querySelector('.prompt-mic-btn[data-mic-target="prompt-input"]')
      ?.classList.add("mic-active");
  }
  return { ok: true, listening: true };
}'''

# Find from const promptDictation through end of togglePromptDictation before initPromptMicButtons
start = a.find("const promptDictation = {")
end = a.find("(function initPromptMicButtons()")
assert start > 0 and end > start, f"dictation block markers {start} {end}"

new_block = r'''const promptDictation = {
  rec: null,
  recorder: null,
  chunks: [],
  btn: null,
  stream: null,
  targetId: "prompt-input",
  committed: "",
  liveText: "",
  lastError: "",
  mode: "", // "speech" | "recorder"
};

function isPromptDictationActive() {
  return !!(promptDictation.rec || (promptDictation.recorder && promptDictation.recorder.state === "recording"));
}

function preferMediaRecorderDictation() {
  const ua = navigator.userAgent || "";
  if (/OculusBrowser|Quest|Mobile VR|FBAN|FB_IAB/i.test(ua)) return true;
  if (document.body.classList.contains("xr-presenting")) return true;
  if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) return true;
  return false;
}

function writePromptMicTranscript(textarea, text) {
  if (!textarea) return;
  textarea.value = text;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function setPromptMicActiveUi(on, btn = null) {
  const target = btn || document.querySelector('.prompt-mic-btn[data-mic-target="prompt-input"]');
  document.querySelectorAll(".prompt-mic-btn.mic-active").forEach((b) => {
    b.classList.remove("mic-active");
    b.title = "Dictate prompt (click to start/stop)";
  });
  if (on && target) {
    target.classList.add("mic-active");
    target.title = "Recording… click to stop";
  }
}

function stopPromptDictationStreamOnly() {
  if (promptDictation.stream) {
    try { promptDictation.stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
    promptDictation.stream = null;
  }
}

function stopPromptDictation() {
  const rec = promptDictation.rec;
  promptDictation.rec = null;
  if (rec) {
    try { rec.onresult = null; } catch (_) {}
    try { rec.onerror = null; } catch (_) {}
    try { rec.onend = null; } catch (_) {}
    try { rec.stop(); } catch (_) {}
    try { rec.abort(); } catch (_) {}
  }
  const recorder = promptDictation.recorder;
  promptDictation.recorder = null;
  if (recorder && recorder.state === "recording") {
    try { recorder.onstop = null; } catch (_) {}
    try { recorder.stop(); } catch (_) {}
  }
  promptDictation.chunks = [];
  promptDictation.mode = "";
  stopPromptDictationStreamOnly();
  promptDictation.btn = null;
  setPromptMicActiveUi(false);
}

async function transcribeAudioBlob(blob) {
  const fd = new FormData();
  const type = blob.type || "audio/webm";
  const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
  fd.append("file", blob, `speech.${ext}`);
  const headers = { ...(authHeaders?.() || {}) };
  // Let browser set multipart boundary — do not force Content-Type
  delete headers["Content-Type"];
  const res = await fetch("/api/transcribe", { method: "POST", headers, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error || `Transcribe failed (${res.status})`);
  return String(data?.text || "").trim();
}

async function stopMediaRecorderDictation(textarea) {
  const recorder = promptDictation.recorder;
  if (!recorder) {
    stopPromptDictation();
    return { ok: true, listening: false };
  }
  promptDictation.liveText = (textarea?.value || promptDictation.committed || "") + (textarea?.value ? "" : "") ;
  promptDictation.liveText = (textarea?.value || "") || "Transcribing…";
  if (textarea && !textarea.value) writePromptMicTranscript(textarea, "Transcribing…");

  const blob = await new Promise((resolve) => {
    const chunks = promptDictation.chunks.slice();
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
    try { recorder.stop(); } catch (_) { resolve(null); }
  });
  promptDictation.recorder = null;
  promptDictation.chunks = [];
  stopPromptDictationStreamOnly();
  setPromptMicActiveUi(false);
  promptDictation.mode = "";

  if (!blob || blob.size < 64) {
    promptDictation.lastError = "No audio captured — try again";
    if (textarea) writePromptMicTranscript(textarea, promptDictation.committed || textarea.value || "");
    return { ok: false, error: promptDictation.lastError, listening: false };
  }

  try {
    const text = await transcribeAudioBlob(blob);
    const base = promptDictation.committed || "";
    const next = text
      ? (base ? `${base.replace(/\s*$/, "")} ${text}` : text)
      : base;
    promptDictation.committed = next;
    promptDictation.liveText = next;
    if (textarea) writePromptMicTranscript(textarea, next);
    if (!text) {
      promptDictation.lastError = "No speech detected";
      return { ok: false, error: promptDictation.lastError, listening: false };
    }
    return { ok: true, listening: false, text };
  } catch (err) {
    promptDictation.lastError = err?.message || "Transcription failed";
    console.warn("[mic] transcribe", err);
    if (textarea) writePromptMicTranscript(textarea, promptDictation.committed || textarea.value || "");
    return { ok: false, error: promptDictation.lastError, listening: false };
  }
}

async function startMediaRecorderDictation(textarea, targetId, btn) {
  stopPromptDictation();
  try {
    promptDictation.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    promptDictation.lastError = "Mic permission blocked — allow microphone for this site";
    return { ok: false, error: promptDictation.lastError };
  }

  const mimeCandidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  const mime = mimeCandidates.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
  let recorder;
  try {
    recorder = mime
      ? new MediaRecorder(promptDictation.stream, { mimeType: mime })
      : new MediaRecorder(promptDictation.stream);
  } catch (err) {
    stopPromptDictationStreamOnly();
    promptDictation.lastError = "Recording not supported in this browser";
    return { ok: false, error: promptDictation.lastError };
  }

  promptDictation.chunks = [];
  promptDictation.recorder = recorder;
  promptDictation.mode = "recorder";
  promptDictation.targetId = targetId;
  promptDictation.committed = textarea.value || "";
  promptDictation.liveText = "Recording… tap mic again to stop";
  promptDictation.lastError = "";
  promptDictation.btn = btn;
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) promptDictation.chunks.push(e.data);
  };
  recorder.start(250);
  setPromptMicActiveUi(true, btn);
  return { ok: true, listening: true };
}

/**
 * Toggle speech-to-text into a prompt textarea.
 * Quest XR: MediaRecorder + Whisper (click to record / click to stop).
 * Desktop: Web Speech when available, otherwise same recorder path.
 * @returns {{ ok: boolean, listening?: boolean, error?: string, text?: string }}
 */
async function togglePromptDictation(targetId = "prompt-input", btn = null) {
  const textarea = document.getElementById(targetId);
  if (!textarea) return { ok: false, error: "Prompt field missing" };

  // Click again → stop
  if (isPromptDictationActive() && (!btn || btn === promptDictation.btn || targetId === promptDictation.targetId)) {
    if (promptDictation.mode === "recorder" || promptDictation.recorder) {
      return stopMediaRecorderDictation(textarea);
    }
    const committed = promptDictation.committed;
    stopPromptDictation();
    if (committed) writePromptMicTranscript(textarea, committed);
    return { ok: true, listening: false };
  }

  // Quest / XR / no Web Speech → MediaRecorder + server Whisper
  if (preferMediaRecorderDictation() || !window.MediaRecorder === false) {
    if (preferMediaRecorderDictation() || !(window.SpeechRecognition || window.webkitSpeechRecognition)) {
      if (!window.MediaRecorder) {
        promptDictation.lastError = "Recording not supported in this browser";
        return { ok: false, error: promptDictation.lastError };
      }
      return startMediaRecorderDictation(textarea, targetId, btn);
    }
  }

  // Desktop Web Speech path
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (window.MediaRecorder) return startMediaRecorderDictation(textarea, targetId, btn);
    promptDictation.lastError = "Speech not supported in this browser";
    return { ok: false, error: promptDictation.lastError };
  }

  stopPromptDictation();
  try {
    promptDictation.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    // Fall back to recorder if getUserMedia works later — but permission blocked
    promptDictation.lastError = "Mic permission blocked — allow microphone for this site";
    return { ok: false, error: promptDictation.lastError };
  }

  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  const base = textarea.value || "";
  let committed = base;
  promptDictation.committed = committed;
  promptDictation.targetId = targetId;
  promptDictation.lastError = "";
  promptDictation.liveText = base;
  promptDictation.mode = "speech";
  promptDictation.btn = btn;

  rec.onresult = (e) => {
    let interim = "";
    let finals = base;
    for (const r of e.results) {
      if (r.isFinal) finals += (finals && !finals.endsWith(" ") ? " " : "") + r[0].transcript;
      else interim += r[0].transcript;
    }
    committed = finals;
    promptDictation.committed = finals;
    const live = finals + (interim ? ` ${interim}` : "");
    promptDictation.liveText = live;
    writePromptMicTranscript(textarea, live);
  };

  rec.onerror = (e) => {
    const code = e?.error || "error";
    if (code === "aborted") return;
    // Auto-fallback to MediaRecorder when browser blocks Web Speech (Quest)
    console.warn("[mic] speech error, falling back to recorder", code);
    try { rec.stop(); } catch (_) {}
    promptDictation.rec = null;
    void startMediaRecorderDictation(textarea, targetId, btn).then(() => {
      try { viewportXR?.refreshAiPromptPanel?.(); } catch (_) {}
    });
  };

  rec.onend = () => {
    if (promptDictation.rec === rec) {
      writePromptMicTranscript(textarea, committed);
      stopPromptDictation();
    }
  };

  try {
    rec.start();
  } catch (err) {
    console.warn("[mic] speech start failed, using recorder", err);
    return startMediaRecorderDictation(textarea, targetId, btn);
  }

  promptDictation.rec = rec;
  setPromptMicActiveUi(true, btn);
  return { ok: true, listening: true };
}

'''

a = a[:start] + new_block + a[end:]

# cache bust
a2, n = re.subn(
    r'import \{ createViewportXR \} from "\./viewport-xr\.js\?v=[^"]+";',
    'import { createViewportXR } from "./viewport-xr.js?v=20260729-xr-mic-menu";',
    a,
    count=1,
)
assert n == 1
app.write_text(a2)
print("app.js dictation rewritten")

html = Path("/home/ubuntu/frontend/index.html")
h = html.read_text()
h2, n2 = re.subn(r'app\.js\?v=[^"]+', "app.js?v=20260729-xr-mic-menu", h, count=1)
assert n2 == 1
html.write_text(h2)
print("index cache bust")
PY
