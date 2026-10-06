import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  XRCTRL2_CACHE,
  LIVE_CONTROLS_URL,
  sessionShouldUseLiveBindings,
  bindingsFromLiveDoc,
  createXrLiveControlClient,
} from "./xr-control-live.js";

test("sandbox simulate or listen uses live bindings without scene apply", () => {
  assert.equal(XRCTRL2_CACHE, "xrctrl2");
  assert.equal(LIVE_CONTROLS_URL, "/mcp/sandbox/controls");
  assert.equal(sessionShouldUseLiveBindings({ simulate: true }), true);
  assert.equal(sessionShouldUseLiveBindings({ listen: true }), true);
  assert.equal(sessionShouldUseLiveBindings({ simulate: false, listen: false }), false);
  const b = bindingsFromLiveDoc({
    rev: 4,
    headset: "quest3",
    profiles: { quest3: { trigger: { btn: 0 }, squeeze: { btn: 1 } } },
    session: { selectstart: "ui-then-poll", grab: "squeeze-or-trigger" },
  });
  assert.equal(b.trigger, 0);
  assert.equal(b.squeeze, 1);
  assert.match(b.selectstart, /poll/);
});

test("live client polls the sandbox controls endpoint and applies on rev change", async () => {
  const seen = [];
  let rev = 1;
  const fetchImpl = async (url) => {
    assert.match(String(url), /sandbox\/controls|control-config/);
    return {
      ok: true,
      json: async () => ({ ok: true, rev, simulate: true, listen: true, apply_scene: false, headset: "quest3", profiles: { quest3: { trigger: { btn: 0 } } } }),
    };
  };
  const client = createXrLiveControlClient({
    fetchImpl,
    applyDoc: (doc) => seen.push(doc.rev),
    intervalMs: 10000,
  });
  await client.pull();
  assert.equal(seen[0], 1);
  rev = 2;
  await client.pull();
  assert.equal(seen.at(-1), 2);
  assert.equal(client.token, "xrctrl2");
});

test("studio window hosts simulate sandbox controls", () => {
  const js = readFileSync(new URL("./studio-window.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("./sandbox.css", import.meta.url), "utf8");
  assert.match(js, /Simulate sandbox controls/);
  assert.match(js, /xrctrl2/);
  assert.match(js, /dimos-y-wiring\.md/);
  assert.match(js, /simulate: false, listen: false/);
  assert.match(js, /ensureSandboxPromptButton/);
  assert.match(js, /makeSandboxButton|btn-sandbox-gen|data-sandbox-toggle/);
  assert.match(js, /startChangeSession|endChangeSession|MAP1_TOKEN/);
  assert.match(js, /OpenArm/);
  assert.match(css, /sb1-sim-ctrl/);
});
