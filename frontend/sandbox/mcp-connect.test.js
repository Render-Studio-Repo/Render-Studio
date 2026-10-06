import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MCPLISTEN1_TOKEN,
  MCP_CONNECT_KEY,
  mcpConnectMarkup,
  isMcpConnected,
  isMcpMuted,
  setMcpConnected,
  mcpConnectChoice,
  resetMcpListen,
  resumeMcpListen,
} from "./mcp-connect.js";
import { defaultMotionPlan, SMARTWB1_TOKEN } from "./smart-whiteboard.js";
import { SUPASQL1_TOKEN } from "./supabase-sql.js";
import { FILEIDE1_TOKEN } from "./ide.js";

const here = dirname(fileURLToPath(import.meta.url));

test("agents always listen unless protected reset muted", () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  assert.equal(MCPLISTEN1_TOKEN, "mcplisten1");
  assert.equal(mcpConnectChoice(storage), null);
  assert.equal(isMcpConnected(storage), true);
  assert.equal(isMcpMuted(storage), false);
  resetMcpListen(storage);
  assert.equal(storage.getItem(MCP_CONNECT_KEY), "0");
  assert.equal(isMcpConnected(storage), false);
  assert.equal(isMcpMuted(storage), true);
  resumeMcpListen(storage);
  assert.equal(isMcpConnected(storage), true);
  assert.match(mcpConnectMarkup(), /data-sb-mcp-reset/);
  assert.match(mcpConnectMarkup(), /Agents listening/);
  assert.doesNotMatch(mcpConnectMarkup(), /data-sb-mcp-toggle(?!-)/);
});

test("file IDE + smart whiteboard wired into Super IDE", () => {
  const pane = readFileSync(join(here, "openarm-viser-pane.js"), "utf8");
  const boot = readFileSync(join(here, "boot.js"), "utf8");
  const html = readFileSync(join(here, "index.html"), "utf8");
  const css = readFileSync(join(here, "sandbox.css"), "utf8");
  const bridge = readFileSync(join(here, "openarm-mujoco/web/analysis-bridge.js"), "utf8");
  const superIde = readFileSync(join(here, "super-ide.js"), "utf8");
  const ide = readFileSync(join(here, "ide.js"), "utf8");
  const wb = readFileSync(join(here, "smart-whiteboard.js"), "utf8");
  assert.match(pane, /mountMcpConnect/);
  assert.match(boot, /sb-mcp-toolbar/);
  assert.match(boot, /mcplisten1|supasql1|collabid1/);
  assert.match(html, /id="sb-mcp-toolbar"/);
  assert.match(html, /mcplisten1|supasql1|fileide1|collabid1/);
  assert.match(css, /\.sb-mcp-listen-pill|\.sb-file-ide|\.sb-collab-top/);
  assert.match(bridge, /v !== "0"/);
  assert.match(superIde, /mountSupabaseSql/);
  assert.match(superIde, /mountProjectFileViewer/);
  assert.match(superIde, /Supabase SQL/);
  assert.match(superIde, /FILEIDE1|fileide1|Sandbox toggle/);
  assert.equal(FILEIDE1_TOKEN, "fileide1");
  assert.equal(SMARTWB1_TOKEN, "smartwb1");
  assert.equal(SUPASQL1_TOKEN, "supasql1");
  assert.match(ide, /data-sb-ide-save/);
  assert.match(ide, /character-motion-loop/);
  assert.match(wb, /Agents scope moves|data-wb-scope/);
  const plan = defaultMotionPlan([{ id: "cursor", label: "Cursor", color: 1 }, { id: "rnd", label: "RnD", color: 2 }]);
  assert.equal(plan.length, 2);
  assert.ok(plan[0].move);
});
