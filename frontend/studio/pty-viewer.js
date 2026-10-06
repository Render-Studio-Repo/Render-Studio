/**
 * Robotics tab: attach one local PTY via sidecar + authenticated Studio proxy.
 */

export const PTY_DEFAULT_HOST = "127.0.0.1";
export const PTY_DEFAULT_PORT = 8765;
export const PTY_START_CMD = "python3 scripts/cursor-pty-bridge";
export const PTY_TOKEN_HINT = "~/.render-studio/pty-bridge.token";
export const PTY_STORAGE_KEY = "render3d:ptySidecar:v1";

const XTERM_CSS = "https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css";
const XTERM_JS = "https://cdn.jsdelivr.net/npm/xterm@5.3.0/+esm";
const XTERM_FIT = "https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/+esm";

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function normalizePtyHost(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return PTY_DEFAULT_HOST;
  if (s === "localhost" || s === "::1") return "127.0.0.1";
  if (s === "0.0.0.0" || s === "::") return PTY_DEFAULT_HOST;
  return s;
}

export function normalizePtyPort(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return PTY_DEFAULT_PORT;
  return Math.floor(n);
}

export function ptyProxyPath(host, port) {
  const h = encodeURIComponent(normalizePtyHost(host));
  return `/api/pty/p/${h}/${normalizePtyPort(port)}/`;
}

export function ptyWsUrl({ protocol, pageHost, sidecarHost, sidecarPort } = {}) {
  const proto = protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${pageHost}${ptyProxyPath(sidecarHost, sidecarPort)}`;
}

export function shouldUseStudioProxy(loc = typeof location !== "undefined" ? location : null) {
  if (!loc) return true;
  return String(loc.protocol || "") === "https:";
}

export function readPtyPrefs() {
  try {
    const parsed = JSON.parse(storage()?.getItem(PTY_STORAGE_KEY) || "null");
    return {
      host: normalizePtyHost(parsed?.host),
      port: normalizePtyPort(parsed?.port),
    };
  } catch {
    return { host: PTY_DEFAULT_HOST, port: PTY_DEFAULT_PORT };
  }
}

export function persistPtyPrefs(next) {
  const row = {
    host: normalizePtyHost(next?.host),
    port: normalizePtyPort(next?.port),
  };
  try {
    storage()?.setItem(PTY_STORAGE_KEY, JSON.stringify(row));
  } catch { /* ignore */ }
  return row;
}

function ensureXtermCss() {
  if (typeof document === "undefined") return;
  if (document.querySelector("link[data-pty-xterm-css]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = XTERM_CSS;
  link.dataset.ptyXtermCss = "1";
  document.head.appendChild(link);
}

async function loadXterm() {
  ensureXtermCss();
  const [mod, fitMod] = await Promise.all([
    import(/* @vite-ignore */ XTERM_JS),
    import(/* @vite-ignore */ XTERM_FIT),
  ]);
  return { Terminal: mod.Terminal, FitAddon: fitMod.FitAddon };
}

export function createPtyViewer({ root, apiFn } = {}) {
  const el = root || (typeof document !== "undefined" ? document.getElementById("robotics-pty") : null);
  if (!el) return null;

  const hostInput = el.querySelector("[data-pty-host]");
  const portInput = el.querySelector("[data-pty-port]");
  const tokenInput = el.querySelector("[data-pty-token]");
  const statusEl = el.querySelector("[data-pty-status]");
  const screen = el.querySelector("[data-pty-screen]");
  const emptyEl = el.querySelector("[data-pty-empty]");
  const prefs = readPtyPrefs();
  if (hostInput && !hostInput.value) hostInput.value = prefs.host;
  if (portInput && !portInput.value) portInput.value = String(prefs.port);

  let socket = null;
  let term = null;
  let fitAddon = null;
  let connected = false;
  let observer = null;

  function setStatus(text, tone = "") {
    if (!statusEl) return;
    statusEl.textContent = text || "sidecar not running";
    statusEl.classList.toggle("is-error", tone === "error");
    statusEl.classList.toggle("is-ok", tone === "ok");
  }

  function currentHost() {
    return normalizePtyHost(hostInput?.value || PTY_DEFAULT_HOST);
  }

  function currentPort() {
    return normalizePtyPort(portInput?.value || PTY_DEFAULT_PORT);
  }

  function sendResize() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify({
        type: "resize",
        cols: term?.cols || 80,
        rows: term?.rows || 24,
      }));
    } catch { /* ignore */ }
  }

  function kill() {
    const sock = socket;
    socket = null;
    connected = false;
    if (sock) {
      try { sock.close(); } catch { /* ignore */ }
    }
    try { observer?.disconnect?.(); } catch { /* ignore */ }
    observer = null;
    try { term?.dispose?.(); } catch { /* ignore */ }
    term = null;
    fitAddon = null;
    if (screen) screen.innerHTML = "";
    setStatus("sidecar not running");
  }

  async function attachTerm() {
    if (!screen) return null;
    screen.innerHTML = "";
    const loaded = await loadXterm();
    term = new loaded.Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "rgba(88, 166, 255, 0.28)",
      },
    });
    fitAddon = new loaded.FitAddon();
    term.loadAddon(fitAddon);
    term.open(screen);
    try { fitAddon.fit(); } catch { /* ignore */ }
    term.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });
    term.attachCustomKeyEventHandler((ev) => {
      const meta = ev.metaKey || ev.ctrlKey;
      if (meta && ev.key === "c" && term.hasSelection?.()) {
        try { navigator.clipboard?.writeText?.(term.getSelection()); } catch { /* ignore */ }
        return false;
      }
      if (meta && ev.key === "v") {
        ev.preventDefault();
        navigator.clipboard?.readText?.().then((text) => {
          if (socket?.readyState === WebSocket.OPEN && text) {
            socket.send(JSON.stringify({ type: "input", data: text }));
          }
        }).catch(() => {});
        return false;
      }
      return true;
    });
    observer = new ResizeObserver(() => {
      try { fitAddon?.fit?.(); } catch { /* ignore */ }
      sendResize();
    });
    observer.observe(screen);
    term.focus();
    return term;
  }

  async function connect() {
    const host = currentHost();
    const port = currentPort();
    const token = String(tokenInput?.value || "").trim();
    persistPtyPrefs({ host, port });
    if (!token) {
      setStatus("sidecar token required", "error");
      return;
    }
    kill();
    setStatus("connecting…");
    if (hostInput) hostInput.value = host;
    if (portInput) portInput.value = String(port);
    let payload = null;
    try {
      payload = await apiFn?.("/api/pty/open", {
        method: "POST",
        body: JSON.stringify({ host, port, token }),
      });
    } catch (err) {
      setStatus(String(err?.message || err || "Could not open PTY proxy"), "error");
      return;
    }
    if (!payload?.ws) {
      setStatus(payload?.error || "Could not open PTY proxy", "error");
      return;
    }
    try {
      await attachTerm();
    } catch {
      setStatus("Could not load terminal widget", "error");
      return;
    }
    const proto = typeof location !== "undefined" ? location.protocol : "https:";
    const pageHost = typeof location !== "undefined" ? location.host : "render3d.app";
    const url = ptyWsUrl({
      protocol: proto,
      pageHost,
      sidecarHost: payload.host || host,
      sidecarPort: payload.port || port,
    });
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener("open", () => {
      connected = true;
      setStatus("connected", "ok");
      sendResize();
      term?.focus?.();
    });
    ws.addEventListener("message", (ev) => {
      let msg = null;
      try { msg = JSON.parse(String(ev.data || "")); } catch { return; }
      if (msg?.type === "output" && msg.data != null) {
        term?.write?.(String(msg.data));
      } else if (msg?.type === "error") {
        term?.write?.(`\r\n${msg.message || "PTY error"}\r\n`);
      } else if (msg?.type === "exit") {
        term?.write?.("\r\n[shell closed]\r\n");
        setStatus("sidecar not running");
      }
    });
    ws.addEventListener("close", () => {
      if (socket === ws) {
        socket = null;
        connected = false;
        setStatus("sidecar not running");
      }
    });
    ws.addEventListener("error", () => {
      if (!payload?.ok) setStatus(payload?.error || "sidecar not running", "error");
    });
  }

  el.querySelector("[data-pty-connect]")?.addEventListener("click", () => {
    void connect();
  });
  el.querySelector("[data-pty-disconnect]")?.addEventListener("click", () => {
    kill();
  });
  hostInput?.addEventListener("change", () => persistPtyPrefs({ host: currentHost(), port: currentPort() }));
  portInput?.addEventListener("change", () => persistPtyPrefs({ host: currentHost(), port: currentPort() }));

  if (emptyEl && !emptyEl.textContent?.includes(PTY_START_CMD)) {
    emptyEl.innerHTML = `Off until you start it. One attached shell (not every Terminal.app tab). On the Mini: <code>${PTY_START_CMD}</code>`;
  }
  setStatus("sidecar not running");

  return {
    connect,
    disconnect: kill,
    isConnected: () => connected,
  };
}
