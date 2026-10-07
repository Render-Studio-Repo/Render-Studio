import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  authorizedRow,
  grokBotDetail,
  mcpJsonSnippet,
  wiringMarkup,
  wiringSteps,
} from "./authorized-grok-bot.js";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "styles.css"), "utf8");
const appsSetup = readFileSync(join(here, "authorized-app-setup.js"), "utf8");

test("Grok bot authorized row has connect status", () => {
  const row = authorizedRow({ connected: false, detail: "Paste Consumer Key in Settings" });
  assert.equal(row.key, "grok_bot");
  assert.equal(row.label, "Grok bot");
  assert.equal(row.connected, false);
  assert.equal(row.action, "connect-grok-bot");
  const on = authorizedRow({ connected: true, detail: "Grok chat ready" });
  assert.equal(on.action, "unlink-grok-bot");
  assert.equal(on.cta, "Disconnect");
});

test("wiring copy never includes a consumer secret value", () => {
  const markup = wiringMarkup({
    connected: false,
    wiring: { steps: wiringSteps(), diagram: "Cursor --stdio--> grok-bot" },
  });
  assert.match(markup, /How to wire Grok bot/);
  assert.doesNotMatch(markup, /super-secret/);
  assert.match(mcpJsonSnippet(), /mcp\/grok-bot\/server\.py/);
  assert.match(mcpJsonSnippet(), /"X_CONSUMER_SECRET": ""/);
  assert.match(wiringMarkup({ connected: false }), /name="bot_token"/);
  assert.equal(grokBotDetail({}), "Paste Consumer Key in Settings, optional xAI key for Grok chat");
});

test("wiring includes DIMOS IP connect controls", () => {
  const markup = wiringMarkup({ connected: true, dimos: { linked: false, host: "" } });
  assert.match(markup, /Connect Grok bot to DIMOS/);
  assert.match(markup, /data-grok-dimos-connect/);
  assert.match(markup, /data-grok-dimos-host/);
  assert.match(markup, /\/api\/integrations\/grok-bot\/dimos/);
});

test("Preferences Authorized apps hydrates Grok bot", () => {
  assert.match(app, /authorized-app-setup\.js\?v=/);
  assert.match(app, /apps\.hydrateAuthorizedAppList/);
  assert.match(appsSetup, /\/api\/integrations\/grok-bot\/status/);
  assert.match(appsSetup, /\/api\/integrations\/grok-bot\/connect/);
  assert.match(html, /grokmcp-20260916-2-xwebhook1|grokmcp=20260916-2-xwebhook1/);
  assert.match(css, /authorized-app-row--grok_bot/);
  assert.match(css, /grok-bot-wiring/);
  assert.match(css, /grok-dimos-link/);
});
