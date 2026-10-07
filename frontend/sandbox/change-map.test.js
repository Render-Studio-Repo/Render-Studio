import test from "node:test";
import assert from "node:assert/strict";
import {
  startChangeSession,
  addReferencePoint,
  logVoiceStep,
  endChangeSession,
  isSessionActive,
  currentSession,
  MAP1_TOKEN,
} from "./change-map.js";

test("change session maps OpenArm 2.0 refs and voice steps", () => {
  const s = startChangeSession({ openArm: "2.0" });
  assert.equal(MAP1_TOKEN, "map1");
  assert.equal(isSessionActive(), true);
  assert.equal(s.openArm, "2.0");
  assert.ok(s.refs.some((r) => /OpenArm 2\.0/.test(r.label)));
  const ref = addReferencePoint({ kind: "checkpoint", label: "after grip demo" });
  assert.match(ref.ref_id, /^ref-/);
  const step = logVoiceStep("log this step — cube grasp ok", { kind: "checkpoint" });
  assert.match(step.step_id, /^vs-/);
  assert.equal(currentSession().voiceSteps.length >= 1, true);
});

test("ending session clears active map handle", async () => {
  if (!isSessionActive()) startChangeSession({ openArm: "2.0" });
  // Avoid network writes in unit test by stubbing fetch
  const prev = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  try {
    const out = await endChangeSession({ reverse: true, systemCheck: true });
    assert.equal(out.ok, true);
    assert.equal(isSessionActive(), false);
  } finally {
    globalThis.fetch = prev;
  }
});
