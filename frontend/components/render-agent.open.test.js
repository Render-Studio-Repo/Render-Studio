import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const agent = readFileSync(join(here, "render-agent.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");

test("render-agent refreshThreads aborts the previous threads GET", () => {
  assert.match(agent, /let renderAgentThreadsAbort = null; \/\/ leakfix67/);
  assert.match(agent, /async function refreshThreads\(\)[\s\S]{0,900}signal: ctl\.signal/);
});

test("render-agent refreshTeamMembers aborts the previous invite-candidates GET", () => {
  assert.match(agent, /let renderAgentMembersAbort = null; \/\/ leakfix69/);
  assert.match(agent, /async function refreshTeamMembers\(\)[\s\S]{0,900}signal: ctl\.signal/);
});

test("Render Agent opens only from explicit Agent controls", () => {
  assert.match(agent, /function bindExplicitAgentOpeners/);
  assert.match(agent, /shouldOpenRenderAgentFromEvent\(event\)/);
  assert.match(agent, /open\(\{ fromLauncher: true \}\)/);
  assert.match(agent, /Never inject a fixed FAB over Improve/);
  assert.match(agent, /stack\.some\(isPromptInteractiveNotAgent\)/);
  assert.match(agent, /document\.addEventListener\("pointerup", mark, true\)/);
  assert.equal((html.match(/id="btn-render-agent"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="btn-prompt-render-agent"/);
  assert.match(html, /workspace-feedback-btn--agent/);
  const chatAt = html.indexOf('id="btn-project-chat"');
  const agentAt = html.indexOf('id="btn-render-agent"');
  const socialAt = html.indexOf('id="btn-social-network"');
  assert.ok(agentAt >= 0 && chatAt > agentAt && socialAt > chatAt);
});

test("key-ready toasts and announce do not pop the Agent panel", () => {
  assert.match(agent, /function announce\(preview, \{ openPanel = false/);
  assert.match(app, /renderAgentUi\?\.announce\?\.\(text, \{ openPanel: false/);
  assert.match(app, /openFromAlert\?\.\(\{ preview: text, open_agent: false/);
  assert.match(agent, /openFromAlert/);
  assert.match(agent, /openPanel: false/);
});

test("prompt chrome clicks and T shortcuts stay out of Agent", () => {
  assert.match(app, /\.prompt-panel/);
  assert.match(app, /#prompt-spice/);
  assert.match(agent, /#prompt-cad-debug/);
  assert.match(agent, /#prompt-cad-debug-wrap/);
  assert.match(agent, /#prompt-ai-gear/);
  assert.match(agent, /#prompt-ai-gear-popup/);
  assert.match(app, /function shouldHandleTransparentShortcut/);
  assert.match(app, /isAiPromptShortcutTarget/);
  const trans = app.slice(
    app.indexOf("function shouldHandleTransparentShortcut"),
    app.indexOf("function activateObjectTransformShortcut"),
  );
  assert.match(trans, /isAiPromptShortcutTarget\(e\.target\)\) return false/);
});

test("Render Agent Q&A defaults to cheap Luna and can swap models", () => {
  assert.match(agent, /CHEAP_CHAT_MODEL/);
  assert.match(agent, /let renderAgentModel = CHEAP_CHAT_MODEL/);
  assert.match(agent, /render-agent-source-select/);
  assert.match(agent, /id="render-agent-model"/);
  assert.match(agent, /Guest: cheap Luna/);
  assert.match(agent, /Uses your ChatGPT subscription/);
  assert.match(agent, /model: renderAgentModel/);
  assert.doesNotMatch(agent, /Sam's gpt-4o-mini/);
  assert.doesNotMatch(html, /gpt-4o-mini/);
});

test("cache-bust 20260914-agentpop1 is on studio assets", () => {
  assert.match(html, /app\.js\?v=.*20260914-agentpop1/);
  assert.match(html, /styles\.css\?v=.*20260914-agentpop1/);
  assert.match(app, /render-agent\.js\?v=.*20260914-agentpop1/);
  assert.match(html, /imagine3/);
  assert.match(html, /imagine4/);
  assert.match(html, /imagine5/);
});

test("cache-bust 20260914-agentlock1 is on studio assets", () => {
  assert.match(html, /app\.js\?v=.*20260914-agentlock1/);
  assert.match(app, /render-agent\.js\?v=.*20260914-agentlock1/);
  assert.match(agent, /redactSecretShaped/);
});

test("cache-bust 20260914-agentbtn1 is on studio assets", () => {
  assert.match(html, /app\.js\?v=.*20260914-agentbtn1/);
  assert.match(html, /styles\.css\?v=.*20260914-agentbtn1/);
  assert.match(app, /render-agent\.js\?v=.*20260914-agentbtn1/);
});

test("cache-bust 20260916-voicewake1 is on studio assets", () => {
  assert.match(html, /app\.js\?v=.*20260916-voicewake1/);
  assert.match(html, /styles\.css\?v=.*20260916-voicewake1/);
  assert.match(app, /render-agent\.js\?v=.*20260916-voicewake1/);
  assert.match(agent, /#btn-voice-order/);
  assert.match(agent, /prompt-voice-order/);
});

test("Render Agent composer has viewport @ mention menu", () => {
  assert.match(html, /id="render-agent-mention-menu"/);
  assert.match(html, /class="render-agent-composer"/);
  assert.match(agent, /function renderMentionMenu/);
  assert.match(agent, /function insertMentionHandle/);
  assert.match(agent, /AT_ROSTER/);
  assert.match(agent, /prompt-mention-label/);
});

test("Render Agent docs cards keep live guide hashes", () => {
  assert.match(agent, /getting-started\.html\$\{guideId \? `#\$\{esc\(guideId\)\}` : ""\}/);
  assert.doesNotMatch(agent, /guideId-20260915-xrdispatch4/);
  assert.doesNotMatch(agent, /\$\{guideId-\d/);
});

test("Parts List reuses the Docs Render Agent fab without wiping Improve/webgl/dlprog tokens", () => {
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(agent, /function isPartsListAgentFab/);
  assert.match(agent, /render-agent-fab--parts/);
  assert.match(agent, /Never inject a fixed FAB over Improve/);
  assert.match(agent, /syncPartsListFab/);
  assert.match(agent, /render-agent-panel--parts/);
  assert.match(app, /openRenderAgent: \(opts\) => renderAgentUi\?\.open\?/);
  assert.match(app, /webgl1/);
  assert.match(html, /ragicon1/);
  assert.match(app, /ragicon1/);
  assert.match(css, /render-agent-fab:not\(\.render-agent-fab--parts\)/);
  assert.match(css, /\.render-agent-panel--parts\.render-agent-panel--sticky/);
});

test("Render Agent has Agents tab and fenced code, no Round Table in form", () => {
  assert.match(agent, /ensureAgentsUi/);
  assert.match(agent, /data-ra-tab="agents"/);
  assert.match(agent, /parseAuthorizedAgents/);
  assert.match(agent, /fenceOpen/);
  assert.match(agent, /render-agent-rich-pre/);
  const form = html.match(/id="render-agent-form"[\s\S]*?<\/form>/)?.[0] || "";
  assert.doesNotMatch(form, /Round Table/);
  assert.match(form, />Ask</);
});
