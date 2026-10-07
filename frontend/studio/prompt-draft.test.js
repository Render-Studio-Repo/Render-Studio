import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEAKED_GLOBAL_COMPOSE_KEYS,
  pickComposeRestorePrompt,
  shouldPersistComposeSnapshot,
  shouldWipeComposeUiOnProjectOpen,
} from "./prompt-draft.js";

test("restore prefers stored prompt; live only when allowLiveFallback", () => {
  assert.equal(pickComposeRestorePrompt({ stored: "bike fork", live: "old" }), "bike fork");
  assert.equal(pickComposeRestorePrompt({ stored: "  ", live: "typed draft" }), "");
  assert.equal(pickComposeRestorePrompt({ stored: "", live: "typed draft" }), "");
  assert.equal(pickComposeRestorePrompt({ stored: "", live: "" }), "");
  assert.equal(
    pickComposeRestorePrompt({ stored: "", live: "typed draft", allowLiveFallback: true }),
    "typed draft",
  );
  assert.equal(
    pickComposeRestorePrompt({ stored: "  ", live: "typed draft", allowLiveFallback: true }),
    "typed draft",
  );
  assert.equal(
    pickComposeRestorePrompt({ stored: "saved", live: "typed draft", allowLiveFallback: true }),
    "saved",
  );
});

test("empty snapshots do not overwrite a saved draft when protectExisting is set", () => {
  const existing = { prompt: "keep me" };
  assert.equal(shouldPersistComposeSnapshot({ prompt: "" }, existing), true);
  assert.equal(shouldPersistComposeSnapshot({ prompt: "" }, existing, { protectExisting: true }), false);
  assert.equal(shouldPersistComposeSnapshot({ prompt: "" }, existing, { forceEmpty: true }), true);
  assert.equal(shouldPersistComposeSnapshot({ prompt: "next" }, existing), true);
});

test("project switch always wipes, even when incoming has no draft", () => {
  assert.equal(shouldWipeComposeUiOnProjectOpen({
    prevProjectId: "",
    nextProjectId: "p1",
  }), true);
  assert.equal(shouldWipeComposeUiOnProjectOpen({
    prevProjectId: "p1",
    nextProjectId: "p1",
  }), false);
  assert.equal(shouldWipeComposeUiOnProjectOpen({
    prevProjectId: "p1",
    nextProjectId: "p2",
  }), true);
  assert.equal(shouldWipeComposeUiOnProjectOpen({
    prevProjectId: "p1",
    nextProjectId: "p2",
    incomingStoredPrompt: "",
  }), true);
  assert.equal(shouldWipeComposeUiOnProjectOpen({
    prevProjectId: "p1",
    nextProjectId: "p2",
    incomingStoredPrompt: "last generate",
  }), true);
  assert.equal(shouldWipeComposeUiOnProjectOpen({
    prevProjectId: "p1",
    nextProjectId: "",
  }), false);
});

test("leaked global compose keys are listed for localStorage cleanup", () => {
  assert.ok(LEAKED_GLOBAL_COMPOSE_KEYS.includes("render3d:aiComposeDraft:v1"));
  assert.ok(LEAKED_GLOBAL_COMPOSE_KEYS.includes("render3d:lastPrompt"));
  assert.ok(LEAKED_GLOBAL_COMPOSE_KEYS.includes("promptDraft"));
  assert.ok(LEAKED_GLOBAL_COMPOSE_KEYS.includes("render3d:promptDraft"));
});
