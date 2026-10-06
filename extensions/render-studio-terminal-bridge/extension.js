/* eslint-disable no-console */
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");

/** Handshake for Studio ↔ this machine. Not a cloud API key. */
const BRIDGE_TOKEN = "termbridge1";
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const ROOT_STATE = "renderStudio.terminalBridge.root";
const BUF_MAX = 64 * 1024;

let server = null;
let extContext = null;
let rootFolder = "";
/** @type {Map<string, { terminal: import('vscode').Terminal, buffer: string }>} */
const byId = new Map();
/** @type {WeakMap<import('vscode').Terminal, string>} */
const idOf = new WeakMap();
let seq = 0;
/** @type {Set<{ termId: string, send: (obj: any) => void }>} */
const sockets = new Set();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Term-Bridge");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function tokenOk(req, url) {
  const header = String(req.headers["x-term-bridge"] || "");
  const q = url.searchParams.get("token") || "";
  return header === BRIDGE_TOKEN || q === BRIDGE_TOKEN;
}

function json(res, code, body) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function homeDir() {
  try {
    return os.homedir();
  } catch {
    return "";
  }
}

function workspaceRoots() {
  const folders = vscode.workspace.workspaceFolders || [];
  return folders.map((f) => f.uri.fsPath).filter(Boolean);
}

function allowedRoots() {
  const list = [];
  const add = (p) => {
    if (!p) return;
    const resolved = path.resolve(p);
    if (!list.includes(resolved)) list.push(resolved);
  };
  add(rootFolder);
  for (const w of workspaceRoots()) add(w);
  add(homeDir());
  return list;
}

function isAllowedPath(target) {
  const resolved = path.resolve(String(target || ""));
  if (!resolved) return false;
  return allowedRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

function termId(term) {
  let id = idOf.get(term);
  if (id) return id;
  seq += 1;
  id = `t${seq}`;
  idOf.set(term, id);
  byId.set(id, { terminal: term, buffer: "" });
  return id;
}

function dropTerm(term) {
  const id = idOf.get(term);
  if (!id) return;
  byId.delete(id);
}

async function cwdOf(term) {
  try {
    const cwd = term.shellIntegration?.cwd;
    if (cwd?.fsPath) return cwd.fsPath;
  } catch {
    /* ignore */
  }
  try {
    const opts = term.creationOptions || {};
    if (opts.cwd) return String(opts.cwd);
  } catch {
    /* ignore */
  }
  return rootFolder || workspaceRoots()[0] || homeDir();
}

async function listTerminals() {
  const terms = vscode.window.terminals || [];
  const rows = [];
  for (const term of terms) {
    const id = termId(term);
    rows.push({
      id,
      name: term.name || "Terminal",
      cwd: await cwdOf(term),
    });
  }
  return rows;
}

function appendBuf(id, data) {
  const row = byId.get(id);
  if (!row) return;
  row.buffer += data;
  if (row.buffer.length > BUF_MAX) {
    row.buffer = row.buffer.slice(row.buffer.length - BUF_MAX);
  }
}

function broadcast(termIdValue, payload) {
  for (const sock of sockets) {
    if (sock.termId === termIdValue) sock.send(payload);
  }
}

function wsAccept(key) {
  return crypto.createHash("sha1").update(String(key) + GUID).digest("base64");
}

function encodeFrame(text) {
  const payload = Buffer.from(String(text), "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrames(buf, onText, onClose) {
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let i = offset + 2;
    if (len === 126) {
      if (i + 2 > buf.length) break;
      len = buf.readUInt16BE(i);
      i += 2;
    } else if (len === 127) {
      if (i + 8 > buf.length) break;
      len = Number(buf.readUInt32BE(i + 4));
      i += 8;
    }
    const mask = masked ? buf.slice(i, i + 4) : null;
    if (masked) i += 4;
    if (i + len > buf.length) break;
    let payload = buf.slice(i, i + len);
    if (mask) {
      const out = Buffer.alloc(len);
      for (let n = 0; n < len; n += 1) out[n] = payload[n] ^ mask[n % 4];
      payload = out;
    }
    offset = i + len;
    if (opcode === 0x8) {
      onClose();
      break;
    }
    if (opcode === 0x1 || opcode === 0x2) onText(payload.toString("utf8"));
  }
  return buf.slice(offset);
}

function attachSocket(req, socket, termIdValue) {
  const row = byId.get(termIdValue);
  const key = req.headers["sec-websocket-key"];
  if (!key || !row) {
    socket.destroy();
    return;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n"
      + "Upgrade: websocket\r\n"
      + "Connection: Upgrade\r\n"
      + `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n`
      + "\r\n",
  );
  const send = (obj) => {
    try {
      socket.write(encodeFrame(JSON.stringify(obj)));
    } catch {
      /* ignore */
    }
  };
  const client = { termId: termIdValue, send };
  sockets.add(client);
  if (row.buffer) send({ type: "output", data: row.buffer });
  send({ type: "hello", id: termIdValue, name: row.terminal.name });
  let rest = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    rest = Buffer.concat([rest, chunk]);
    rest = decodeFrames(
      rest,
      (text) => {
        let msg = null;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (msg?.type === "input" && msg.data != null) {
          try {
            row.terminal.sendText(String(msg.data), false);
          } catch {
            send({ type: "error", message: "Could not send to Cursor terminal" });
          }
        }
      },
      () => socket.end(),
    );
  });
  socket.on("close", () => sockets.delete(client));
  socket.on("error", () => sockets.delete(client));
}

function listDir(dirPath) {
  const resolved = path.resolve(dirPath);
  if (!isAllowedPath(resolved)) return { error: "path not in picked root / home / workspace" };
  const entries = [];
  let names = [];
  try {
    names = fs.readdirSync(resolved);
  } catch (err) {
    return { error: String(err?.message || err) };
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = path.join(resolved, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    entries.push({
      name,
      path: full,
      dir: stat.isDirectory(),
    });
    if (entries.length >= 400) break;
  }
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return { path: resolved, entries };
}

async function handle(req, res) {
  const host = req.headers.host || "127.0.0.1";
  const url = new URL(req.url || "/", `http://${host}`);
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      service: "render-studio-terminal-bridge",
      editor: vscode.env.appName,
      root: rootFolder,
      port: server?.address()?.port || null,
    });
    return;
  }
  if (!tokenOk(req, url)) {
    json(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (url.pathname === "/v1/status") {
    json(res, 200, {
      ok: true,
      editor: vscode.env.appName,
      root: rootFolder,
      workspaces: workspaceRoots(),
      home: homeDir(),
      terminals: await listTerminals(),
    });
    return;
  }
  if (url.pathname === "/v1/terminals" && req.method === "GET") {
    json(res, 200, { ok: true, terminals: await listTerminals() });
    return;
  }
  if (url.pathname === "/v1/terminals" && req.method === "POST") {
    const body = await readBody(req);
    const name = String(body.name || "Render Studio").slice(0, 80);
    const cwd = body.cwd && isAllowedPath(body.cwd) ? path.resolve(body.cwd) : (rootFolder || workspaceRoots()[0] || homeDir());
    const terminal = vscode.window.createTerminal({ name, cwd });
    terminal.show(true);
    const id = termId(terminal);
    json(res, 200, { ok: true, id, name: terminal.name, cwd });
    return;
  }
  if (url.pathname === "/v1/pick-root" && req.method === "POST") {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use as Render Studio root",
    });
    const folder = picked?.[0]?.fsPath;
    if (!folder) {
      json(res, 200, { ok: false, cancelled: true, root: rootFolder });
      return;
    }
    rootFolder = folder;
    void extContext?.globalState.update(ROOT_STATE, rootFolder);
    json(res, 200, { ok: true, root: rootFolder });
    return;
  }
  if (url.pathname === "/v1/root" && req.method === "GET") {
    json(res, 200, { ok: true, root: rootFolder, workspaces: workspaceRoots(), home: homeDir() });
    return;
  }
  if (url.pathname === "/v1/root" && req.method === "POST") {
    const body = await readBody(req);
    const next = path.resolve(String(body.path || ""));
    if (!next || !fs.existsSync(next) || !fs.statSync(next).isDirectory()) {
      json(res, 400, { ok: false, error: "not a folder" });
      return;
    }
    if (!isAllowedPath(next) && path.resolve(next) !== homeDir()) {
      /* first pick may be anywhere the native dialog already allowed; POST is confined */
      const underHome = next === homeDir() || next.startsWith(homeDir() + path.sep);
      if (!underHome) {
        json(res, 403, { ok: false, error: "choose a folder under home or workspace, or use Pick root" });
        return;
      }
    }
    rootFolder = next;
    void extContext?.globalState.update(ROOT_STATE, rootFolder);
    json(res, 200, { ok: true, root: rootFolder });
    return;
  }
  if (url.pathname === "/v1/tree" && req.method === "GET") {
    const dir = url.searchParams.get("path") || rootFolder || homeDir();
    json(res, 200, { ok: true, ...listDir(dir) });
    return;
  }
  json(res, 404, { ok: false, error: "not found" });
}

function listenPort(context) {
  const cfg = vscode.workspace.getConfiguration("renderStudio.terminalBridge");
  const port = Number(cfg.get("port")) || 8765;
  const bind = String(cfg.get("bind") || "127.0.0.1");
  rootFolder = context.globalState.get(ROOT_STATE) || workspaceRoots()[0] || homeDir();
  server = http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch(() => {
      try {
        json(res, 500, { ok: false, error: "bridge error" });
      } catch {
        /* ignore */
      }
    });
  });
  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/v1/pty" || !tokenOk(req, url)) {
      socket.destroy();
      return;
    }
    const id = url.searchParams.get("id") || "";
    attachSocket(req, socket, id);
  });
  server.listen(port, bind, () => {
    /* wrist-cam style: local publisher is up; Studio discovers localhost */
  });
  server.on("error", (err) => {
    vscode.window.showWarningMessage(`Render Studio terminal bridge: ${err.message}`);
  });
}

function subscribeWrites() {
  const api = vscode.window;
  if (typeof api.onDidWriteTerminalData === "function") {
    return api.onDidWriteTerminalData((e) => {
      const id = termId(e.terminal);
      const data = String(e.data || "");
      appendBuf(id, data);
      broadcast(id, { type: "output", data });
    });
  }
  return { dispose() {} };
}

function activate(context) {
  extContext = context;
  for (const t of vscode.window.terminals || []) termId(t);
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal((t) => termId(t)),
    vscode.window.onDidCloseTerminal((t) => dropTerm(t)),
    subscribeWrites(),
    vscode.commands.registerCommand("renderStudio.terminalBridge.status", async () => {
      const addr = server?.address();
      const port = typeof addr === "object" && addr ? addr.port : 8765;
      vscode.window.showInformationMessage(
        `Render Studio terminal bridge on http://127.0.0.1:${port} (${vscode.env.appName})`,
      );
    }),
    vscode.commands.registerCommand("renderStudio.terminalBridge.pickRoot", async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Use as Render Studio root",
      });
      if (picked?.[0]?.fsPath) {
        rootFolder = picked[0].fsPath;
        await context.globalState.update(ROOT_STATE, rootFolder);
      }
    }),
  );
  listenPort(context);
}

function deactivate() {
  try {
    server?.close();
  } catch {
    /* ignore */
  }
  server = null;
}

module.exports = { activate, deactivate, BRIDGE_TOKEN };
