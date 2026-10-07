import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { refreshedVoiceSubscriptionAccess, shouldAutoOpenSubscriptionPopup, voiceSubscriptionAccess } from "./hey-ai-subscription-access.js";

const app = readFileSync(new URL("../studio/app.js", import.meta.url), "utf8");

function functionSource(name, nextDeclaration) {
  const start = app.indexOf(`async function ${name}(`);
  const end = app.indexOf(`\n${nextDeclaration}`, start);
  assert.ok(start >= 0, `${name} should exist`);
  assert.ok(end > start, `${name} should have a bounded source section`);
  return app.slice(start, end);
}

test("Hey AI rejects users without a voice-capable subscription", () => {
  assert.deepEqual(voiceSubscriptionAccess({}, "gpt-6-astra"), {
    allowed: false,
    provider: "",
    model: "",
    reason: "Connect a ChatGPT or Claude subscription that supports buffered Hey AI voice.",
  });
});

test("ChatGPT keeps Astra and converts Realtime selection to buffered Astra", () => {
  const status = { chatgpt_signed_in: true };
  assert.deepEqual(voiceSubscriptionAccess(status, "gpt-6-astra-pro"), {
    allowed: true,
    provider: "chatgpt",
    model: "gpt-6-astra-pro",
    reason: "",
  });
  assert.equal(voiceSubscriptionAccess(status, "gpt-realtime-1.5").model, "gpt-6-astra");
});

test("Claude keeps Claude voice and supplies it when it is the only capable subscription", () => {
  const status = { providers: [{ id: "claude", auth_status: "signed_in" }] };
  assert.deepEqual(voiceSubscriptionAccess(status, "claude-opus-4-8"), {
    allowed: true,
    provider: "claude",
    model: "claude-opus-4-8",
    reason: "",
  });
  assert.equal(voiceSubscriptionAccess(status, "gpt-6-astra").model, "claude-opus-4-8");
});

test("deferred AI status hydration includes connected subscriptions", () => {
  const hydrate = functionSource("hydrateAiKeysFromServer", "async function refreshPromptAiKeysFromServer(");
  const refresh = functionSource("refreshPromptAiKeysFromServer", "function chatgptSubscriptionModelReady(");

  assert.match(hydrate, /api\("\/api\/user\/ai-keys\?full=true"\)/);
  assert.match(refresh, /api\("\/api\/user\/ai-keys\?full=true"\)/);
});

test("voice activation preserves the synchronous user-gesture gate", () => {
  assert.match(app, /return voiceStartGate\(async \(\) =>/);
  assert.match(app, /await refreshPromptAiKeysFromServer\(\)/);
  const activation = app.slice(
    app.indexOf("function activateStudioVoiceAgent(options = {})"),
    app.indexOf("async function activateStudioVoiceAgentNow"),
  );
  assert.ok(
    activation.indexOf("syncVoiceOrderControls(true)") < activation.indexOf("await refreshedVoiceSubscriptionAccess"),
    "the visible Listening state should precede account refresh and socket startup",
  );
});

test("Hey AI onboarding never auto-opens the subscription popup on mobile", () => {
  assert.equal(shouldAutoOpenSubscriptionPopup(390), false);
  assert.equal(shouldAutoOpenSubscriptionPopup(720), false);
  assert.equal(shouldAutoOpenSubscriptionPopup(721), true);
});

test("Hey AI refreshes stale subscription state before rejecting the click", async () => {
  let refreshes = 0;
  const access = await refreshedVoiceSubscriptionAccess({
    status: {},
    requestedModel: "gpt-6-astra",
    refresh: async () => {
      refreshes += 1;
      return { chatgpt_signed_in: true };
    },
  });
  assert.equal(refreshes, 1);
  assert.deepEqual(access, {
    allowed: true,
    provider: "chatgpt",
    model: "gpt-6-astra",
    reason: "",
  });
});

test("CAD generation refreshes subscription state before opening the setup popup", () => {
  const start = app.indexOf("async function handlePromptGenerateClick(");
  const gate = app.indexOf('if (!aiStatus?.ai_ready && lockedPromptMode !== "render")', start);
  const refresh = app.lastIndexOf("await refreshPromptAiKeysFromServer();", gate);
  const popup = app.indexOf("aiKeyUi?.openRequired();", gate);
  assert.ok(start >= 0 && refresh > start, "generation should refresh full account state");
  assert.ok(refresh < gate, "refresh must happen before the cached AI-ready gate");
  assert.ok(gate < popup, "the setup popup remains behind the refreshed readiness check");
});
