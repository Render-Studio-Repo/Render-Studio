import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASKA1_TOKEN, askAstraMarkup, askAstra } from "./ask-astra.js";
import { SBXR1_TOKEN, VR_BOT_SEATS } from "./sandbox-xr-enter.js";

const here = dirname(fileURLToPath(import.meta.url));

test("Ask Astra markup shows ChatGPT VR Grok marks and real ask controls", () => {
  assert.equal(ASKA1_TOKEN, "aska1");
  const html = askAstraMarkup();
  assert.match(html, /Ask Astra/);
  assert.match(html, /openai\.svg/);
  assert.match(html, /grok\.svg/);
  assert.match(html, /render-logo-gear-still/);
  assert.match(html, /data-sb-ask-send/);
  assert.match(html, /data-sb-ask-voice/);
});

test("ask-astra module posts to discuss and grok chat", () => {
  const js = readFileSync(join(here, "ask-astra.js"), "utf8");
  assert.match(js, /\/api\/xr-agent\/discuss/);
  assert.match(js, /\/api\/integrations\/grok-bot\/chat/);
  assert.match(js, /\/api\/voice-mold\/session/);
  assert.doesNotMatch(js, /btn-voice-order.*click/);
});

test("agent bar Ask Astra + Enter VR wired", () => {
  const bar = readFileSync(join(here, "sandbox-agent-bar.js"), "utf8");
  assert.match(bar, /Ask Astra/);
  assert.match(bar, /data-sb-enter-vr/);
  assert.match(bar, /Enter VR with bots/);
  assert.match(bar, /enterSandboxVr/);
  assert.match(bar, /withBots:\s*true/);
  assert.match(bar, /askAstra|mountAskAstra/);
  assert.match(bar, /render3d-sandbox-open-astra/);
  assert.doesNotMatch(bar, /btn-voice-order/);
});

test("task board and query dashboard do not mount a second Ask Astra", () => {
  const tasks = readFileSync(join(here, "agent-tasks.js"), "utf8");
  const query = readFileSync(join(here, "query-dashboard.js"), "utf8");
  assert.doesNotMatch(tasks, /mountAskAstra\(/);
  assert.match(tasks, /openPageAstra/);
  assert.doesNotMatch(query, /mountAskAstra\(/);
  assert.match(query, /openPageAstra/);
});

test("debugger VR enter calls sandbox XR", () => {
  assert.equal(SBXR1_TOKEN, "sbxr1");
  assert.ok(VR_BOT_SEATS.some((b) => b.id === "astra"));
  const dbg = readFileSync(join(here, "debugger-vr.js"), "utf8");
  const xr = readFileSync(join(here, "sandbox-xr-enter.js"), "utf8");
  assert.match(dbg, /Enter VR with bots/);
  assert.match(dbg, /Live controls/);
  assert.match(dbg, /Analysis draft/);
  assert.match(dbg, /Save analysis/);
  assert.match(dbg, /Route → Repair/);
  assert.match(dbg, /enterSandboxVr/);
  assert.match(dbg, /withBots:\s*true/);
  assert.match(dbg, /data-dbg-doc/);
  assert.match(dbg, /data-dbg-editor/);
  assert.doesNotMatch(xr, /requestSession/);
  assert.doesNotMatch(xr, /WebGLRenderer/);
  assert.match(xr, /mode: "mirror"/);
});

test("openai brand mark present", () => {
  const svg = readFileSync(join(here, "../assets/brands/preferences/openai.svg"), "utf8");
  assert.match(svg, /<svg/);
  assert.match(svg, /OpenAI|openai/i);
});

test("Astra sends the question to the selected project and reports the returned model", async (t) => {
  const storage = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => key === "render3d:lastProjectId" ? "project-1" : null };
  t.after(() => { globalThis.localStorage = storage; });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    const body = JSON.parse(options.body);
    assert.equal(body.question, "Check my controls");
    assert.equal(body.project_id, "project-1");
    assert.equal(body.mode, "v2");
    assert.ok(options.signal);
    return Response.json({ answer: "Controls checked.", model: "selected-provider-model" });
  });
  const out = await askAstra("Check my controls");
  assert.equal(out.answer, "Controls checked.");
  assert.equal(out.model, "selected-provider-model");
  assert.deepEqual(calls, ["/api/xr-agent/discuss"]);
});

test("project authorization failure excludes project context from fallback", async (t) => {
  const storage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => "project-1" };
  t.after(() => { globalThis.localStorage = storage; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    if (calls === 2) assert.equal(JSON.parse(options.body).prompt, "Check my controls");
    return Response.json({}, { status: 403 });
  });
  await assert.rejects(askAstra("Check my controls", { context: { projectEvidence: "private" } }), /project access denied/);
  assert.equal(calls, 2);
});

test("no saved project does not submit a fake sandbox project ID", async (t) => {
  const storage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null };
  t.after(() => { globalThis.localStorage = storage; });
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => { calls.push(url); return Response.json({ detail: "Not configured" }, { status: 503 }); });
  await assert.rejects(askAstra("Check my controls"), /Open a Studio project.*Grok fallback/);
  assert.deepEqual(calls, ["/api/integrations/grok-bot/chat"]);
});
