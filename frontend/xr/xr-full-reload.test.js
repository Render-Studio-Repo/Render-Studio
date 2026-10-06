import test from "node:test";
import assert from "node:assert/strict";
import { endXrSessionThenNavigate } from "./xr-full-reload.js";

test("full XR reload ends the active session before navigating", async () => {
  const events = [];
  let finishEnd;
  const session = {
    end() {
      events.push("end:start");
      return new Promise((resolve) => { finishEnd = () => { events.push("end:done"); resolve(); }; });
    },
  };
  const pending = endXrSessionThenNavigate({
    session,
    href: "/?xrsr=123",
    navigate: (href) => events.push(`navigate:${href}`),
  });
  await Promise.resolve();
  assert.deepEqual(events, ["end:start"]);
  finishEnd();
  assert.equal(await pending, true);
  assert.deepEqual(events, ["end:start", "end:done", "navigate:/?xrsr=123"]);
});

test("full XR reload still navigates when session teardown rejects", async () => {
  const events = [];
  const ok = await endXrSessionThenNavigate({
    session: { end: async () => { throw new Error("already ended"); } },
    href: "/?xrsr=456",
    navigate: (href) => events.push(href),
  });
  assert.equal(ok, true);
  assert.deepEqual(events, ["/?xrsr=456"]);
});

test("full XR reload cannot hang forever on a stuck session", async () => {
  const events = [];
  const ok = await endXrSessionThenNavigate({
    session: { end: () => new Promise(() => {}) },
    href: "/?xrsr=789",
    timeoutMs: 5,
    navigate: (href) => events.push(href),
  });
  assert.equal(ok, true);
  assert.deepEqual(events, ["/?xrsr=789"]);
});
