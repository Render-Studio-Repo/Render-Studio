/**
 * Local IDE terminal popup: Cursor/VS Code bridge on this computer
 * (wrist-cam style — publisher on the browser Mac, not Mini :8001 PTY).
 */

import { createFloatingPanelBehavior } from "../studio/floating-panel.js?v=20260611-hud-drag";
import { isLoopbackHost, isCloudStudioOrigin } from "../xr/xr-dimos-lan.js?v=20260909-dimosui1-20260914-lanpc1";

export const LOCAL_TERMINAL_PERMISSION_KEY = "render3d:localTerminalPermission:v1";
export const LOCAL_TERMINAL_BOUNDS_KEY = "render3d:localTerminalBounds:v1";
export const TERMBRIDGE_HOST_KEY = "render3d:termBridgeHost:v1";
export const TERMBRIDGE_PORT = 8765;
export const TERMBRIDGE_TOKEN = "termbridge1";
export const REMOTE_TERMINAL_MESSAGE =
  "Connect Cursor / VS Code at 127.0.0.1:8765 (Install the Terminal Bridge extension on this Mac, then Connect).";
export const PERMISSION_PROMPT =
  "Allow Render Studio to talk to the local Cursor/VS Code terminal bridge on this computer?";

const XTERM_CSS = "https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css";
const XTERM_JS = "https://cdn.jsdelivr.net/npm/xterm@5.3.0/+esm";
const XTERM_FIT = "https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/+esm";
const DEFAULT_BOUNDS = { x: 28, y: 48, w: 780, h: 440 };
const MIN_W = 420;
const MIN_H = 240;

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function isLocalTerminalHost(loc = typeof location !== "undefined" ? location : null) {
  if (!loc) return false;
  if (isCloudStudioOrigin(loc)) return false;
  let host = "";
  try { host = String(loc.hostname || "").toLowerCase(); } catch { host = ""; }
  return isLoopbackHost(host);
}

export function readLocalTerminalPermission() {
  try {
    const raw = storage()?.getItem(LOCAL_TERMINAL_PERMISSION_KEY);
    if (raw === "allow" || raw === "deny") return raw;
  } catch { /* ignore */ }
  return "";
}

export function persistLocalTerminalPermission(value) {
  const next = value === "allow" || value === "deny" ? value : "";
  try {
    const ls = storage();
    if (!ls) return next;
    if (!next) ls.removeItem(LOCAL_TERMINAL_PERMISSION_KEY);
    else ls.setItem(LOCAL_TERMINAL_PERMISSION_KEY, next);
  } catch { /* ignore */ }
  return next;
}

export function readTermBridgeHost() {
  try {
    const raw = String(storage()?.getItem(TERMBRIDGE_HOST_KEY) || "").trim();
    if (raw) return raw;
  } catch { /* ignore */ }
  return `127.0.0.1:${TERMBRIDGE_PORT}`;
}

export function persistTermBridgeHost(value) {
  const next = String(value || "").trim() || `127.0.0.1:${TERMBRIDGE_PORT}`;
  try { storage()?.setItem(TERMBRIDGE_HOST_KEY, next); } catch { /* ignore */ }
  return next;
}

export function normalizeTermBridgeHost(raw) {
  let s = String(raw || "").trim();
  if (!s) return `127.0.0.1:${TERMBRIDGE_PORT}`;
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/\/.*$/, "");
  if (!s.includes(":")) s = `${s}:${TERMBRIDGE_PORT}`;
  return s;
}

export function termBridgeHttpUrl(host, pathname = "/health") {
  const h = normalizeTermBridgeHost(host);
  return `http://${h}${pathname}`;
}

export function termBridgeWsUrl({ host, id, token } = {}) {
  const h = normalizeTermBridgeHost(host);
  const q = new URLSearchParams();
  q.set("token", String(token || TERMBRIDGE_TOKEN));
  q.set("id", String(id || ""));
  return `ws://${h}/v1/pty?${q.toString()}`;
}

export function readLocalTerminalBounds() {
  try {
    const parsed = JSON.parse(storage()?.getItem(LOCAL_TERMINAL_BOUNDS_KEY) || "null");
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    const w = Number(parsed?.w);
    const h = Number(parsed?.h);
    if (![x, y, w, h].every(Number.isFinite)) return { ...DEFAULT_BOUNDS };
    return {
      x,
      y,
      w: Math.max(MIN_W, w),
      h: Math.max(MIN_H, h),
    };
  } catch {
    return { ...DEFAULT_BOUNDS };
  }
}

export function persistLocalTerminalBounds(bounds) {
  const next = {
    x: Number(bounds?.x) || 0,
    y: Number(bounds?.y) || 0,
    w: Math.max(MIN_W, Number(bounds?.w) || DEFAULT_BOUNDS.w),
    h: Math.max(MIN_H, Number(bounds?.h) || DEFAULT_BOUNDS.h),
  };
  try { storage()?.setItem(LOCAL_TERMINAL_BOUNDS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function localTerminalWsUrl({ protocol, host, token, projectId, cols, rows } = {}) {
  const proto = protocol === "https:" ? "wss:" : "ws:";
  const q = new URLSearchParams();
  q.set("token", String(token || ""));
  if (projectId) q.set("project_id", String(projectId));
  q.set("cols", String(Math.max(10, Math.min(Number(cols) || 80, 400))));
  q.set("rows", String(Math.max(4, Math.min(Number(rows) || 24, 200))));
  return `${proto}//${host}/api/local-terminal/ws?${q.toString()}`;
}

function ensureXtermCss() {
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[data-local-xterm-css]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = XTERM_CSS;
  link.dataset.localXtermCss = "1";
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

function clampBounds(viewport, bounds) {
  const rect = viewport.getBoundingClientRect();
  const w = Math.max(MIN_W, Math.min(bounds.w, Math.max(MIN_W, rect.width - 16)));
  const h = Math.max(MIN_H, Math.min(bounds.h, Math.max(MIN_H, rect.height - 16)));
  const x = Math.min(Math.max(bounds.x, 8), Math.max(8, rect.width - w - 8));
  const y = Math.min(Math.max(bounds.y, 8), Math.max(8, rect.height - h - 8));
  return { x, y, w, h };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function mountLocalTerminal(opts = {}) {
  const viewport = opts.viewport || (typeof document !== "undefined" ? document.getElementById("viewport") : null);
  const button = opts.button || null;
  if (!viewport) return null;

  let panel = null;
  let permit = null;
  let floatApi = null;
  let term = null;
  let fitAddon = null;
  let socket = null;
  let fallbackInput = null;
  let panelOpen = false;
  let pollTimer = null;
  let bridgeHost = readTermBridgeHost();
  let connected = false;
  let statusText = "Not connected";
  let rootPath = "";
  let terminals = [];
  let treeEntries = [];
  let treePath = "";
  let activeTermId = "";
  let usingStudioPty = false;

  function presenting() {
    try { return !!opts.isXrPresenting?.(); } catch { return false; }
  }

  function ribbonTerminalBtn() {
    try {
      return document.querySelector('.ribbon-btn[data-id="local_terminal"]');
    } catch {
      return null;
    }
  }

  function setPressed(on) {
    panelOpen = !!on;
    const btn = button || ribbonTerminalBtn();
    if (!btn) return;
    btn.classList.toggle("active", panelOpen);
    btn.classList.toggle("ribbon-btn--active", panelOpen);
    btn.setAttribute("aria-pressed", panelOpen ? "true" : "false");
  }

  function removePermit() {
    permit?.remove();
    permit = null;
  }

  function currentBounds() {
    if (!panel) return readLocalTerminalBounds();
    return {
      x: parseFloat(panel.style.left) || 0,
      y: parseFloat(panel.style.top) || 0,
      w: panel.offsetWidth || DEFAULT_BOUNDS.w,
      h: panel.offsetHeight || DEFAULT_BOUNDS.h,
    };
  }

  function saveBounds() {
    persistLocalTerminalBounds(clampBounds(viewport, currentBounds()));
  }

  function killSession() {
    const sock = socket;
    socket = null;
    if (sock) {
      try { sock.close(); } catch { /* ignore */ }
    }
    try { term?.dispose?.(); } catch { /* ignore */ }
    term = null;
    fitAddon = null;
    fallbackInput = null;
    usingStudioPty = false;
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function closePanel() {
    saveBounds();
    stopPoll();
    killSession();
    panel?.remove();
    panel = null;
    floatApi = null;
    setPressed(false);
  }

  function showCard({ title, body, actions }) {
    removePermit();
    const card = document.createElement("div");
    card.className = "local-terminal-permit";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", title);
    card.innerHTML = `
      <div class="local-terminal-permit-head">
        <strong>${title}</strong>
        <button type="button" class="object-iteration-close" data-term-dismiss aria-label="Close">✕</button>
      </div>
      <p>${body}</p>
      <div class="local-terminal-permit-actions"></div>`;
    const row = card.querySelector(".local-terminal-permit-actions");
    for (const action of actions || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = action.accent ? "btn accent btn-compact" : "btn secondary btn-compact";
      btn.textContent = action.label;
      btn.addEventListener("click", () => action.onClick?.());
      row.appendChild(btn);
    }
    card.querySelector("[data-term-dismiss]")?.addEventListener("click", removePermit);
    viewport.appendChild(card);
    permit = card;
    return card;
  }

  function showPermission({ denied = false } = {}) {
    persistLocalTerminalPermission("allow");
    removePermit();
    void openPanel();
    void denied;
  }

  function bindResize(el) {
    const handle = el.querySelector("[data-term-resize]");
    if (!handle) return;
    let drag = null;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      drag = {
        id: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        w: el.offsetWidth,
        h: el.offsetHeight,
      };
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const next = clampBounds(viewport, {
        x: parseFloat(el.style.left) || 0,
        y: parseFloat(el.style.top) || 0,
        w: drag.w + (e.clientX - drag.sx),
        h: drag.h + (e.clientY - drag.sy),
      });
      el.style.width = `${next.w}px`;
      el.style.height = `${next.h}px`;
      floatApi?.setPosition(next.x, next.y, { manual: true });
      try { fitAddon?.fit?.(); } catch { /* ignore */ }
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      handle.releasePointerCapture?.(e.pointerId);
      drag = null;
      saveBounds();
      try { fitAddon?.fit?.(); } catch { /* ignore */ }
      sendResize();
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function sendResize() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const cols = term?.cols || 80;
    const rows = term?.rows || 24;
    try {
      socket.send(JSON.stringify({ type: "resize", cols, rows }));
    } catch { /* ignore */ }
  }

  function headers() {
    return { "X-Term-Bridge": TERMBRIDGE_TOKEN, "Content-Type": "application/json" };
  }

  async function bridgeFetch(pathname, init = {}) {
    const url = termBridgeHttpUrl(bridgeHost, pathname);
    const res = await fetch(url, {
      ...init,
      headers: { ...headers(), ...(init.headers || {}) },
    });
    return res.json();
  }

  function attachFallback(screen) {
    screen.innerHTML = "";
    const pre = document.createElement("pre");
    pre.className = "local-terminal-fallback";
    const input = document.createElement("textarea");
    input.className = "local-terminal-fallback-input";
    input.rows = 2;
    input.spellcheck = false;
    input.placeholder = "Type and press Return";
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      const text = input.value;
      input.value = "";
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data: `${text}\r` }));
      }
    });
    screen.appendChild(pre);
    screen.appendChild(input);
    fallbackInput = { pre, input };
    return {
      write(data) {
        pre.textContent += data;
        pre.scrollTop = pre.scrollHeight;
      },
      focus() { input.focus(); },
      cols: 80,
      rows: 24,
    };
  }

  async function attachXterm(screen) {
    screen.innerHTML = "";
    const loaded = await loadXterm();
    term = new loaded.Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "rgba(88, 166, 255, 0.28)",
      },
      allowProposedApi: false,
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
    term.focus();
    return term;
  }

  function wireSocket(ws, writer) {
    socket = ws;
    ws.addEventListener("message", (ev) => {
      let msg = null;
      try { msg = JSON.parse(String(ev.data || "")); } catch { return; }
      if (msg?.type === "output" && msg.data != null) {
        if (term) term.write(String(msg.data));
        else writer.write?.(String(msg.data));
      } else if (msg?.type === "error") {
        const text = `\r\n${msg.message || "Terminal error"}\r\n`;
        if (term) term.write(text);
        else writer.write?.(text);
      } else if (msg?.type === "exit") {
        const text = "\r\n[shell closed]\r\n";
        if (term) term.write(text);
        else writer.write?.(text);
      }
    });
    ws.addEventListener("close", () => {
      if (socket === ws) socket = null;
    });
    ws.addEventListener("open", () => {
      sendResize();
      writer.focus?.();
      term?.focus?.();
    });
  }

  async function connectPty(screen) {
    usingStudioPty = true;
    const token = String(opts.getToken?.() || "");
    if (!token) {
      screen.innerHTML = `<p class="muted small local-terminal-status">Sign in to open a Studio loopback shell.</p>`;
      return;
    }
    let writer;
    try {
      writer = await attachXterm(screen);
    } catch {
      writer = attachFallback(screen);
    }
    const cols = writer.cols || 80;
    const rows = writer.rows || 24;
    const url = localTerminalWsUrl({
      protocol: location.protocol,
      host: location.host,
      token,
      projectId: opts.getProjectId?.() || "",
      cols,
      rows,
    });
    wireSocket(new WebSocket(url), writer);
  }

  async function connectBridgeTerm(id) {
    const screen = panel?.querySelector("[data-term-screen]");
    if (!screen || !id) return;
    killSession();
    activeTermId = id;
    renderLists();
    let writer;
    try {
      writer = await attachXterm(screen);
    } catch {
      writer = attachFallback(screen);
    }
    const url = termBridgeWsUrl({ host: bridgeHost, id, token: TERMBRIDGE_TOKEN });
    wireSocket(new WebSocket(url), writer);
  }

  function renderLists() {
    if (!panel) return;
    const statusEl = panel.querySelector("[data-term-status]");
    if (statusEl) statusEl.textContent = statusText;
    const rootEl = panel.querySelector("[data-term-root]");
    if (rootEl) rootEl.textContent = rootPath || "No root yet";
    const treeEl = panel.querySelector("[data-term-tree]");
    if (treeEl) {
      const up = treePath ? `<button type="button" class="local-terminal-tree-item" data-tree-up>.. (up)</button>` : "";
      const rows = (treeEntries || []).map((e) => (
        `<button type="button" class="local-terminal-tree-item" data-tree-path="${escapeHtml(e.path)}" data-tree-dir="${e.dir ? "1" : "0"}">${e.dir ? "▸ " : ""}${escapeHtml(e.name)}</button>`
      )).join("");
      treeEl.innerHTML = up + (rows || `<span class="muted small">Pick a root to browse</span>`);
    }
    const listEl = panel.querySelector("[data-term-list]");
    if (listEl) {
      listEl.innerHTML = (terminals || []).map((t) => (
        `<button type="button" class="local-terminal-term-item${t.id === activeTermId ? " is-active" : ""}" data-term-id="${escapeHtml(t.id)}">`
        + `<strong>${escapeHtml(t.name)}</strong>`
        + `<span>${escapeHtml(t.cwd || "")}</span></button>`
      )).join("") || `<span class="muted small">No Cursor terminals yet</span>`;
    }
  }

  async function refreshTree(dir) {
    const q = dir ? `?path=${encodeURIComponent(dir)}` : "";
    const data = await bridgeFetch(`/v1/tree${q}`);
    if (data?.error) {
      statusText = data.error;
      renderLists();
      return;
    }
    treePath = data.path || dir || "";
    treeEntries = data.entries || [];
    renderLists();
  }

  async function refreshStatus() {
    try {
      const data = await bridgeFetch("/v1/status");
      if (!data?.ok) throw new Error(data?.error || "bridge refused");
      connected = true;
      statusText = `${data.editor || "Cursor"} · connected`;
      rootPath = data.root || "";
      terminals = data.terminals || [];
      if (!treePath) await refreshTree(rootPath);
      else renderLists();
    } catch {
      connected = false;
      statusText = "Bridge offline — install Cursor extension on this Mac";
      renderLists();
    }
  }

  async function connectBridge() {
    const input = panel?.querySelector("[data-term-host]");
    bridgeHost = persistTermBridgeHost(normalizeTermBridgeHost(input?.value || bridgeHost));
    if (input) input.value = bridgeHost;
    try {
      const health = await fetch(termBridgeHttpUrl(bridgeHost, "/health"));
      const data = await health.json();
      if (!data?.ok) throw new Error("not a bridge");
      statusText = "Handshake…";
      renderLists();
      await refreshStatus();
      stopPoll();
      pollTimer = setInterval(() => { void refreshStatus(); }, 2500);
    } catch {
      connected = false;
      statusText = "No listener at that host. Reload Cursor after installing the bridge.";
      renderLists();
    }
  }

  async function pickRoot() {
    try {
      const data = await bridgeFetch("/v1/pick-root", { method: "POST", body: "{}" });
      if (data?.root) {
        rootPath = data.root;
        await refreshTree(rootPath);
      }
      await refreshStatus();
    } catch {
      statusText = "Pick root needs the Cursor window (folder dialog).";
      renderLists();
    }
  }

  async function newTerminal() {
    try {
      const data = await bridgeFetch("/v1/terminals", {
        method: "POST",
        body: JSON.stringify({ name: "Render Studio", cwd: rootPath || treePath }),
      });
      if (data?.id) {
        await refreshStatus();
        await connectBridgeTerm(data.id);
      }
    } catch {
      statusText = "Could not create a Cursor terminal.";
      renderLists();
    }
  }

  async function useAsRoot(dir) {
    try {
      const data = await bridgeFetch("/v1/root", {
        method: "POST",
        body: JSON.stringify({ path: dir }),
      });
      if (data?.root) {
        rootPath = data.root;
        await refreshTree(rootPath);
      }
      await refreshStatus();
    } catch {
      statusText = "Could not set root.";
      renderLists();
    }
  }

  async function openPanel() {
    if (presenting()) return;
    if (panel) return;
    removePermit();
    const bounds = clampBounds(viewport, readLocalTerminalBounds());
    panel = document.createElement("div");
    panel.className = "local-terminal-panel floating-panel local-terminal-panel--bridge";
    panel.id = "local-terminal-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Terminal · local");
    panel.style.width = `${bounds.w}px`;
    panel.style.height = `${bounds.h}px`;
    panel.innerHTML = `
      <header class="local-terminal-head">
        <button type="button" class="floating-panel-grip" title="Drag to move" aria-label="Drag terminal">⠿</button>
        <strong>Terminal · local</strong>
        <span class="muted small" data-term-status>Not connected</span>
        <button type="button" class="object-iteration-close" data-term-close aria-label="Close terminal">✕</button>
      </header>
      <div class="local-terminal-body">
        <aside class="local-terminal-side">
          <label class="local-terminal-host-label">Bridge host
            <input type="text" class="local-terminal-host" data-term-host spellcheck="false" />
          </label>
          <div class="local-terminal-side-actions">
            <button type="button" class="btn accent btn-compact" data-term-connect>Connect</button>
            <button type="button" class="btn secondary btn-compact" data-term-pick>Pick root</button>
          </div>
          <p class="muted small local-terminal-root" data-term-root>No root yet</p>
          <p class="muted small local-terminal-side-kicker">Project explorer</p>
          <div class="local-terminal-tree" data-term-tree></div>
          <div class="local-terminal-side-actions">
            <button type="button" class="btn secondary btn-compact" data-term-setroot>Use folder as root</button>
            <button type="button" class="btn accent btn-compact" data-term-new>New terminal</button>
          </div>
          ${isLocalTerminalHost() ? `<button type="button" class="btn secondary btn-compact" data-term-studio-pty>Studio loopback PTY</button>` : ""}
          <p class="muted small local-terminal-side-kicker">Running in Cursor / VS Code</p>
          <div class="local-terminal-term-list" data-term-list></div>
        </aside>
        <div class="local-terminal-screen" data-term-screen>
          <p class="muted small local-terminal-status">${escapeHtml(REMOTE_TERMINAL_MESSAGE)}</p>
        </div>
      </div>
      <button type="button" class="local-terminal-resize" data-term-resize aria-label="Resize terminal"></button>`;
    viewport.appendChild(panel);
    floatApi = createFloatingPanelBehavior(viewport, panel);
    floatApi.bindDrag();
    floatApi.setPosition(bounds.x, bounds.y, { manual: true });
    bindResize(panel);
    panel.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    panel.querySelector("[data-term-close]")?.addEventListener("click", () => closePanel());
    panel.querySelector(".floating-panel-grip")?.addEventListener("pointerup", () => saveBounds());
    const hostInput = panel.querySelector("[data-term-host]");
    if (hostInput) hostInput.value = normalizeTermBridgeHost(bridgeHost);
    panel.querySelector("[data-term-connect]")?.addEventListener("click", () => { void connectBridge(); });
    panel.querySelector("[data-term-pick]")?.addEventListener("click", () => { void pickRoot(); });
    panel.querySelector("[data-term-new]")?.addEventListener("click", () => { void newTerminal(); });
    panel.querySelector("[data-term-studio-pty]")?.addEventListener("click", () => {
      const screen = panel.querySelector("[data-term-screen]");
      void connectPty(screen);
    });
    let markedPath = "";
    panel.querySelector("[data-term-tree]")?.addEventListener("click", (e) => {
      const up = e.target.closest("[data-tree-up]");
      if (up) {
        const parent = treePath.replace(/\/[^/]+\/?$/, "") || treePath;
        void refreshTree(parent);
        return;
      }
      const item = e.target.closest("[data-tree-path]");
      if (!item) return;
      const p = item.getAttribute("data-tree-path") || "";
      const dir = item.getAttribute("data-tree-dir") === "1";
      markedPath = p;
      if (dir) void refreshTree(p);
    });
    panel.querySelector("[data-term-setroot]")?.addEventListener("click", () => {
      void useAsRoot(markedPath || treePath || rootPath);
    });
    panel.querySelector("[data-term-list]")?.addEventListener("click", (e) => {
      const item = e.target.closest("[data-term-id]");
      if (!item) return;
      void connectBridgeTerm(item.getAttribute("data-term-id") || "");
    });
    setPressed(true);
    renderLists();
    void connectBridge();
  }

  function openBridge() {
    persistLocalTerminalPermission("allow");
    removePermit();
    void openPanel();
  }

  function toggle() {
    if (presenting()) return;
    if (panelOpen) {
      closePanel();
      return;
    }
    openBridge();
  }

  button?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });

  return {
    toggle,
    open: openBridge,
    close: closePanel,
    isOpen: () => panelOpen,
  };
}
