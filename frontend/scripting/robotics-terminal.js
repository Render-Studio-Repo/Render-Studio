/**
 * Robotics overlay terminal: type commands, transcribe into the input,
 * and show a scrollable session log plus DIMOS / Studio robot status.
 */

export function speechRecognitionCtor(win = typeof window !== "undefined" ? window : globalThis) {
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function roboticsMicErrorMessage(err) {
  const name = String(err?.name || err?.error || err?.message || err || "");
  if (/NotAllowed|PermissionDenied|not-allowed|SecurityError/i.test(name)) {
    return "Microphone permission denied. Allow the mic for this site, then try again.";
  }
  if (/NotFound|DevicesNotFound|audio-capture/i.test(name)) {
    return "No microphone found.";
  }
  if (/NotSupported|service-not-allowed/i.test(name)) {
    return "Speech recognition is not supported in this browser.";
  }
  if (!name) return "Could not start the microphone.";
  return name;
}

export function parseRoboticsCommand(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const parts = text.split(/\s+/);
  const name = String(parts[0] || "").toLowerCase().replace(/^\/+/, "");
  return { name, args: parts.slice(1), raw: text };
}

export function isRobotLogEntry(entry = {}) {
  const blob = `${entry.message || ""} ${JSON.stringify(entry.data || {})} ${entry.level || ""}`.toLowerCase();
  return /dimos|teleop|open.?arm|robot|coordinator|can0|can1|:8443/.test(blob);
}

export function formatTeleopLogLine(snap = {}) {
  const status = snap.statusKey || snap.label || "off";
  const robot = snap.robotName || "Open Arm";
  const mode = snap.hardwareMode || "mock";
  const pipe = snap.connected ? "ws open" : "ws closed";
  return `${robot} · ${status} · ${mode} · ${pipe}`;
}

export function formatCoordinatorLogLine(coord = {}) {
  if (!coord || typeof coord !== "object") return "coordinator: no status";
  const up = coord.up ? "up" : "down";
  const proc = coord.process ? "process" : "no process";
  const bp = coord.blueprint || "teleop-quest-openarm";
  const pids = Array.isArray(coord.pids) && coord.pids.length ? ` pids ${coord.pids.join(",")}` : "";
  return `DIMOS :8443 ${up} · ${proc} · ${bp}${pids}`;
}

const HELP_LINES = [
  "help — this list",
  "status — DIMOS / Studio teleop snapshot",
  "enable | activate — same as Enable Robotics / Activate",
  "disable — turn teleop off",
  "connect — Connect robot PC (saved LAN host)",
  "record | stop | play | loop — clip controls",
  "refresh — poll /api/dimos/coordinator",
  "clear — clear this session log",
];

function nowClock() {
  try {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function mountRoboticsTerminal(opts = {}) {
  const overlay = document.getElementById("robotics-terminal-overlay");
  if (!overlay) return null;

  const logEl = overlay.querySelector("[data-robotics-term-log]");
  const input = overlay.querySelector("[data-robotics-term-input]");
  const form = overlay.querySelector("[data-robotics-term-form]");
  const talkBtn = overlay.querySelector("[data-robotics-term-talk]");
  const statusEl = overlay.querySelector("[data-robotics-term-status]");
  const logs = [];
  const seenApiIds = new Set();
  const dictation = { rec: null, listening: false, committed: "" };
  let lastTeleopKey = "";
  let lastCoordKey = "";
  let pollTimer = 0;
  let unsub = null;

  function setMicActive(on) {
    talkBtn?.classList.toggle("mic-active", !!on);
    talkBtn?.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function setStatus(text, tone = "") {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.classList.toggle("is-error", tone === "error");
  }

  function renderLogs() {
    if (!logEl) return;
    if (!logs.length) {
      logEl.innerHTML = `<div class="robotics-terminal-empty muted small">No lines yet. Type help, or Transcribe a command.</div>`;
      return;
    }
    logEl.innerHTML = logs
      .slice(-200)
      .map((line) => (
        `<div class="robotics-terminal-line robotics-terminal-line--${esc(line.kind || "info")}">`
        + `<span>${esc(line.time || "")}</span>${esc(line.message)}</div>`
      ))
      .join("");
    logEl.scrollTop = logEl.scrollHeight;
  }

  function appendLog(message, kind = "info") {
    const text = String(message || "").trim();
    if (!text) return;
    const last = logs[logs.length - 1];
    if (last && last.message === text && last.kind === kind) return;
    logs.push({ time: nowClock(), message: text, kind });
    if (logs.length > 240) logs.splice(0, logs.length - 200);
    renderLogs();
  }

  function stopDictation() {
    const rec = dictation.rec;
    dictation.rec = null;
    dictation.listening = false;
    if (rec) {
      try { rec.onresult = null; rec.onerror = null; rec.onend = null; } catch { /* ignore */ }
      try { rec.stop(); } catch { /* ignore */ }
      try { rec.abort(); } catch { /* ignore */ }
    }
    setMicActive(false);
  }

  function startWebSpeech() {
    const SpeechRecognition = speechRecognitionCtor();
    if (!SpeechRecognition || !input) {
      setStatus("Speech recognition is not supported in this browser.", "error");
      return;
    }
    stopDictation();
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    try { rec.lang = navigator.language || "en-US"; } catch { /* ignore */ }
    dictation.committed = input.value || "";
    dictation.listening = true;
    dictation.rec = rec;
    setMicActive(true);
    setStatus("Listening…");
    rec.onresult = (event) => {
      let interim = "";
      let committed = dictation.committed;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) committed = `${committed}${committed && !committed.endsWith(" ") ? " " : ""}${piece}`.trim();
        else interim += piece;
      }
      dictation.committed = committed;
      input.value = `${committed}${interim ? (committed ? " " : "") + interim : ""}`;
      input.setAttribute("data-transcribed", "1");
    };
    rec.onerror = (ev) => {
      setStatus(roboticsMicErrorMessage(ev), "error");
      stopDictation();
    };
    rec.onend = () => {
      if (dictation.rec === rec) {
        dictation.listening = false;
        dictation.rec = null;
        setMicActive(false);
        setStatus("");
      }
    };
    try {
      rec.start();
    } catch (err) {
      setStatus(roboticsMicErrorMessage(err), "error");
      stopDictation();
    }
  }

  async function runCommand(raw) {
    const parsed = parseRoboticsCommand(raw);
    if (!parsed) return;
    appendLog(`› ${parsed.raw}`, "cmd");
    const actions = opts.actions || {};
    try {
      if (parsed.name === "help") {
        HELP_LINES.forEach((line) => appendLog(line, "info"));
        return;
      }
      if (parsed.name === "clear") {
        logs.length = 0;
        seenApiIds.clear();
        renderLogs();
        appendLog("Session log cleared.", "ok");
        return;
      }
      if (parsed.name === "status") {
        const snap = opts.getState?.() || {};
        appendLog(formatTeleopLogLine(snap), "ok");
        if (snap.label) appendLog(String(snap.label), "info");
        if (snap.wsUrl) appendLog(`pipe ${snap.wsUrl}`, "info");
        if (snap.ensureStatus) appendLog(`ensure ${snap.ensureStatus}`, "info");
        return;
      }
      if (parsed.name === "enable" || parsed.name === "activate") {
        await actions.enable?.();
        appendLog("Enable / Activate sent.", "ok");
        return;
      }
      if (parsed.name === "disable") {
        await actions.disable?.();
        appendLog("Disable sent.", "ok");
        return;
      }
      if (parsed.name === "connect") {
        await actions.connect?.();
        appendLog("Connect robot PC sent.", "ok");
        return;
      }
      if (parsed.name === "record") {
        await actions.record?.();
        appendLog("Record started.", "ok");
        return;
      }
      if (parsed.name === "stop") {
        await actions.stop?.();
        appendLog("Stop sent.", "ok");
        return;
      }
      if (parsed.name === "play") {
        await actions.play?.();
        appendLog("Play once sent.", "ok");
        return;
      }
      if (parsed.name === "loop") {
        await actions.loop?.();
        appendLog("Loop toggled.", "ok");
        return;
      }
      if (parsed.name === "refresh") {
        const coord = await actions.refreshCoordinator?.();
        appendLog(formatCoordinatorLogLine(coord || {}), "ok");
        return;
      }
      appendLog(`Unknown command: ${parsed.name}. Type help.`, "warn");
    } catch (err) {
      appendLog(String(err?.message || err || "command failed"), "error");
    }
  }

  async function ingestStudioLogs() {
    const fetchFn = opts.fetchLogs;
    if (typeof fetchFn !== "function") return;
    try {
      const res = await fetchFn();
      const entries = Array.isArray(res?.entries) ? res.entries : [];
      entries.slice().reverse().forEach((entry) => {
        if (!entry?.id || seenApiIds.has(entry.id) || !isRobotLogEntry(entry)) return;
        seenApiIds.add(entry.id);
        appendLog(`[studio] ${entry.message}`, entry.level === "error" ? "error" : "info");
      });
    } catch {
      /* optional stream */
    }
  }

  async function ingestCoordinator() {
    try {
      const coord = await opts.actions?.refreshCoordinator?.();
      const key = formatCoordinatorLogLine(coord || {});
      if (key && key !== lastCoordKey) {
        lastCoordKey = key;
        appendLog(key, coord?.up ? "ok" : "warn");
      }
    } catch {
      /* optional */
    }
  }

  function ingestTeleop(snap) {
    const key = formatTeleopLogLine(snap || {});
    if (key && key !== lastTeleopKey) {
      lastTeleopKey = key;
      appendLog(key, snap?.statusKey === "error" ? "error" : "info");
    }
  }

  function open() {
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("robotics-terminal-open");
    if (!logs.length) {
      appendLog("Robotics terminal. Type help. Transcribe uses on-device SpeechRecognition.", "info");
      appendLog("Hey Meta cannot click Studio or :8443/teleop buttons. Use this input, Transcribe, or Quest in-app voice on the DIMOS page.", "warn");
    }
    ingestTeleop(opts.getState?.() || {});
    void ingestCoordinator();
    void ingestStudioLogs();
    if (!unsub && typeof opts.onChange === "function") {
      unsub = opts.onChange((snap) => ingestTeleop(snap));
    }
    if (!pollTimer) {
      pollTimer = window.setInterval(() => {
        void ingestCoordinator();
        void ingestStudioLogs();
      }, 4000);
    }
    try { input?.focus(); } catch { /* ignore */ }
  }

  function close() {
    stopDictation();
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("robotics-terminal-open");
    if (pollTimer) {
      try { clearInterval(pollTimer); } catch { /* ignore */ }
      pollTimer = 0;
    }
  }

  function toggle() {
    if (overlay.hidden) open();
    else close();
  }

  form?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const value = input?.value || "";
    if (input) input.value = "";
    void runCommand(value);
  });

  talkBtn?.addEventListener("click", () => {
    if (dictation.listening) {
      stopDictation();
      setStatus("");
      return;
    }
    startWebSpeech();
  });

  overlay.querySelectorAll("[data-robotics-term-close]").forEach((btn) => {
    btn.addEventListener("click", () => close());
  });

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });

  document.querySelectorAll("[data-robotics-terminal]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      toggle();
    });
  });

  window.__openRoboticsTerminal = open;
  window.__closeRoboticsTerminal = close;
  window.__toggleRoboticsTerminal = toggle;

  return { open, close, toggle, appendLog, runCommand };
}
