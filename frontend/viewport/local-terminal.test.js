import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCAL_TERMINAL_PERMISSION_KEY,
  REMOTE_TERMINAL_MESSAGE,
  PERMISSION_PROMPT,
  TERMBRIDGE_PORT,
  TERMBRIDGE_TOKEN,
  isLocalTerminalHost,
  persistLocalTerminalPermission,
  readLocalTerminalPermission,
  persistLocalTerminalBounds,
  readLocalTerminalBounds,
  localTerminalWsUrl,
  normalizeTermBridgeHost,
  termBridgeHttpUrl,
  termBridgeWsUrl,
} from "./local-terminal.js";
import { MINI_ONLY_DEAD_CARD, scrubMiniOnlyDeadCard } from "./local-terminal-boot.js";

const here = dirname(fileURLToPath(import.meta.url));

test("local terminal is loopback-only, never cloud or LAN", () => {
  assert.equal(isLocalTerminalHost({ hostname: "localhost", protocol: "http:" }), true);
  assert.equal(isLocalTerminalHost({ hostname: "127.0.0.1", protocol: "http:" }), true);
  assert.equal(isLocalTerminalHost({ hostname: "render3d.app", protocol: "https:" }), false);
  assert.equal(isLocalTerminalHost({ hostname: "app.render3d.app", protocol: "https:" }), false);
  assert.equal(isLocalTerminalHost({ hostname: "192.168.1.83", protocol: "http:" }), false);
});

test("permission and bounds persist in localStorage", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
  assert.equal(readLocalTerminalPermission(), "");
  persistLocalTerminalPermission("allow");
  assert.equal(readLocalTerminalPermission(), "allow");
  persistLocalTerminalPermission("deny");
  assert.equal(mem.get(LOCAL_TERMINAL_PERMISSION_KEY), "deny");
  persistLocalTerminalBounds({ x: 40, y: 80, w: 480, h: 240 });
  assert.deepEqual(readLocalTerminalBounds(), { x: 40, y: 80, w: 480, h: 240 });
});

test("websocket URL stays same-origin local-pty, not Terminal.app", () => {
  const url = localTerminalWsUrl({
    protocol: "http:",
    host: "127.0.0.1:8001",
    token: "abc",
    projectId: "proj-1",
    cols: 100,
    rows: 30,
  });
  assert.match(url, /^ws:\/\/127\.0\.0\.1:8001\/api\/local-terminal\/ws\?/);
  assert.match(url, /project_id=proj-1/);
  assert.equal(url.includes("Terminal.app"), false);
});

test("term bridge discovers localhost:8765 not Mini :8001", () => {
  assert.equal(TERMBRIDGE_PORT, 8765);
  assert.equal(normalizeTermBridgeHost(""), "127.0.0.1:8765");
  assert.equal(normalizeTermBridgeHost("127.0.0.1"), "127.0.0.1:8765");
  assert.equal(termBridgeHttpUrl("127.0.0.1:8765", "/health"), "http://127.0.0.1:8765/health");
  const ws = termBridgeWsUrl({ host: "127.0.0.1:8765", id: "t1", token: TERMBRIDGE_TOKEN });
  assert.match(ws, /^ws:\/\/127\.0\.0\.1:8765\/v1\/pty\?/);
  assert.match(ws, /id=t1/);
  assert.equal(ws.includes(":8001"), false);
});

test("Mini-only dead card is gone; Connect UI is what Terminal · local opens", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const js = readFileSync(join(here, "local-terminal.js"), "utf8");
  const boot = readFileSync(join(here, "local-terminal-boot.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const ribbon = readFileSync(join(here, "../studio/ribbon.js"), "utf8");
  const dead = "Local terminal is only available when Render Studio is running on this computer.";
  assert.equal(js.includes(dead), false);
  assert.equal(js.includes("showRemoteMessage"), false);
  assert.match(js, /data-term-connect/);
  assert.match(js, /127\.0\.0\.1:8765/);
  assert.match(js, /Pick root/);
  assert.ok(js.includes(REMOTE_TERMINAL_MESSAGE));
  assert.ok(js.includes(PERMISSION_PROMPT));
  assert.match(html, /local-terminal-boot\.js\?v=termbridge1/);
  assert.match(boot, /termbridge1/);
  assert.match(app, /local-terminal\.js\?v=termbridge1/);
  assert.match(ribbon, /roboticsAction: "local-terminal"/);
  assert.equal(html.includes('id="btn-local-terminal"'), false);
  assert.equal(MINI_ONLY_DEAD_CARD, dead);
  const card = {
    classList: { contains: () => false },
    textContent: dead,
    removed: false,
    remove() { this.removed = true; },
  };
  const fake = {
    querySelectorAll() { return [card]; },
  };
  assert.equal(scrubMiniOnlyDeadCard(fake), 1);
  assert.equal(card.removed, true);
});
