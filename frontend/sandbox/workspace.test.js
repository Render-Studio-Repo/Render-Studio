import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseFeature, nextProbe } from "./query-dashboard.js";
import { askAstra } from "./ask-astra.js";
import { controllerButtons } from "./vr-reference-capture.js";

test("diagnostic questions route to a specific tracked feature", () => {
  const features = ["vr.controllers.trigger", "webgl.context", "viewport.models"];
  assert.equal(chooseFeature("Why did the Quest trigger stop?", features), "vr.controllers.trigger");
  assert.equal(chooseFeature("WebGL context failed after load", features), "webgl.context");
  assert.equal(chooseFeature("viewport.models disappeared", features), "viewport.models");
});

test("diagnosis recommends different probes for runtime changes and VR input", () => {
  assert.match(nextProbe("vr.controllers.trigger", "kernel-or-runtime-change", true), /runtime or kernel/);
  assert.match(nextProbe("vr.controllers.trigger", "code-or-data-change", true), /controller press/);
  assert.match(nextProbe("viewport.models", "unknown", false), /golden snapshot/);
});

test("VR reference samples button states without poses or axes", () => {
  const state = controllerButtons([
    { handedness: "right", gamepad: { buttons: [{ pressed: true }, { pressed: false }], axes: [0.3, 0.9] }, gripSpace: { private: true } },
  ]);
  assert.deepEqual([...state], [["right.b0", true], ["right.b1", false]]);
});

test("Ask Astra falls back to Grok with smoke evidence when project access is denied", async () => {
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.localStorage = { getItem: (key) => key === "render3d:lastProjectId" ? "inaccessible-project" : null };
  globalThis.fetch = async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body) });
    const grok = path.includes("grok-bot/chat");
    return { ok: grok, status: grok ? 200 : 403, json: async () => grok ? { text: "Observe the Quest trigger next." } : { detail: "forbidden" } };
  };
  try {
    const out = await askAstra("Why is the trigger missing?", { context: { source: "sandbox-query-dashboard", smoke: { checks: { "vr.controllers.trigger": "unknown" } }, comparison: { project_id: "private-project" } } });
    assert.equal(out.provider, "grok");
    assert.equal(calls.length, 2);
    assert.match(calls[1].body.prompt, /vr.controllers.trigger/);
    assert.doesNotMatch(calls[1].body.prompt, /inaccessible-project/);
    assert.doesNotMatch(calls[1].body.prompt, /private-project/);
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.fetch = previousFetch;
  }
});
