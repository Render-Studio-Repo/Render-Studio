import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "mobile-app-chrome.css"), "utf8");
const js = readFileSync(join(here, "mobile-app-chrome.js"), "utf8");
const auth = readFileSync(join(here, "../studio/auth.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const social = readFileSync(join(here, "../social/social-network-ui.js"), "utf8");

test("mobile chrome cache-bust keeps landed tokens and adds mobui1", () => {
  assert.match(html, /mobile-app-chrome\.css\?v=[^"']*iphone4/);
  assert.match(html, /mobile-app-chrome\.css\?v=[^"']*mobui1/);
  assert.match(html, /mobile-app-chrome\.js\?v=[^"']*iphone4/);
  assert.match(html, /mobile-app-chrome\.js\?v=[^"']*mobui1/);
  assert.match(html, /\/studio\/styles\.css\?v=[^"']*imageref1/);
  assert.match(html, /\/studio\/styles\.css\?v=[^"']*mobui1/);
  assert.match(html, /app\.js\?v=[^"']*esctran1/);
  assert.match(html, /app\.js\?v=[^"']*imageref1/);
  assert.match(html, /app\.js\?v=[^"']*findui1/);
  assert.match(html, /app\.js\?v=[^"']*mobui1/);
});

test("phone header pills collapse into Studio sheet next to Tools", () => {
  const headerStart = html.indexOf('<header class="toolbar">');
  const header = html.slice(headerStart, html.indexOf("</header>", headerStart));
  assert.match(header, /id="btn-render-agent"/);
  assert.match(header, /id="btn-social-network"/);
  assert.match(css, /html\.mobile-app-locked \.toolbar \.toolbar-account-actions/);
  assert.match(css, /display:\s*none\s*!important/);
  assert.match(html, /id="mobile-app-banner"/);
  assert.match(html, /data-mobile-banner="tools"/);
  assert.match(html, /data-mobile-banner="more"/);
  assert.match(html, /id="mobile-more-sheet"/);
  assert.match(html, /data-mobile-more="agent"/);
  assert.match(html, /data-mobile-more="social"/);
  assert.match(html, /data-mobile-more="activity"/);
  assert.match(html, /data-mobile-more="instance-bug"/);
  assert.match(js, /"instance-bug": "btn-instance-bug"/);
  assert.match(js, /setMoreSheetOpen/);
  assert.match(js, /btn-render-agent/);
});

test("bottom banner keeps Tools Help Suggest Bug and socials above the canvas", () => {
  assert.match(html, /data-mobile-banner="help"/);
  assert.match(html, /href="\/getting-started\.html"/);
  assert.match(html, /data-mobile-banner="suggest"/);
  assert.match(html, /data-mobile-banner="bug"/);
  assert.match(html, /id="mobile-app-banner"[\s\S]*github\.com\/wprojects\/Render-Studio/);
  assert.match(html, /id="mobile-app-banner"[\s\S]*discord\.gg/);
  assert.match(html, /id="mobile-app-banner"[\s\S]*x\.com\/A1_Projects/);
  assert.match(css, /--mobile-ui-z:\s*2147483000/);
  assert.match(css, /html\.mobile-app-locked \.mobile-tools-popup:not\(\.hidden\)/);
  assert.match(css, /z-index:\s*var\(--mobile-ui-z\)/);
  assert.match(css, /html\.mobile-app-locked \.mobile-tools-fab/);
});

test("AI prompt opens a full-screen typeable composer with Imagine Mesh Render CAD", () => {
  assert.match(html, /id="btn-type-ai-prompt"/);
  assert.match(html, /id="mobile-ai-composer"/);
  assert.match(html, /id="mobile-ai-composer-input"/);
  assert.match(html, /data-mobile-ai-mode="imagine"/);
  assert.match(html, /data-mobile-ai-mode="mesh"/);
  assert.match(html, /data-mobile-ai-mode="render"/);
  assert.match(html, /data-mobile-ai-mode="cad"/);
  assert.match(html, /data-mobile-ai-tool="photo"/);
  assert.match(html, /data-mobile-ai-tool="camera"/);
  assert.match(html, /data-mobile-ai-tool="transcribe"/);
  assert.match(html, /capture="environment"/);
  assert.match(js, /function openAiComposer/);
  assert.match(js, /pointerEvents = "auto"/);
  assert.match(js, /input\.focus/);
  assert.match(js, /#mobile-ai-composer \[data-mobile-ai-mode\]/);
  assert.match(js, /openAiPanel[\s\S]*prompt-tab-imagine/);
  assert.match(app, /openAiComposer/);
  assert.match(app, /attachImagineFiles/);
  assert.match(css, /#mobile-ai-composer-input/);
});

test("logged-out phone join screen is a full layout, not the squeezed desktop modal", () => {
  assert.match(html, /id="mobile-join-screen"/);
  assert.match(html, /data-mobile-join="login"/);
  assert.match(html, /data-mobile-join="register"/);
  assert.match(html, /has-session/);
  assert.match(js, /function syncJoinScreen/);
  assert.match(css, /html\.mobile-app-locked \.mobile-join-screen/);
  assert.match(css, /html\.mobile-app-locked #auth-modal \.auth-card/);
});

test("sessions persist via localStorage JWT plus httponly cookie across restart", () => {
  assert.match(auth, /credentials:\s*"include"/);
  assert.match(auth, /\/api\/auth\/logout/);
  assert.match(auth, /fetchCurrentSessionWithRetry/);
  assert.match(app, /credentials:\s*"include"/);
  assert.match(app, /auth\.js\?v=[^"']*mobui1/);
});

test("Social opens a full phone window with an X close", () => {
  assert.match(social, /social-network-overlay--mobile-sheet/);
  assert.match(social, /function isMobileShell/);
  assert.match(html, /data-sn-close|aria-label="Close"/);
  assert.match(css, /html\.mobile-app-locked \.social-network-panel/);
});
