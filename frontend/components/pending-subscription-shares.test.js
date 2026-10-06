import test from "node:test";
import assert from "node:assert/strict";
import { pendingSubscriptionShares, pendingSubscriptionShareMarkup } from "./pending-subscription-shares.js";

const share = { id: "grant", owner_name: "Sam", granted: true, owner_signed_in: false, kind: "personal" };

test("pending notices recognize Billing and prompt-key payloads for each provider", () => {
  for (const [id, key, label] of [["openai", "chatgpt", "ChatGPT"], ["claude", "claude", "Claude"]]) {
    for (const status of [{ [`${key}_shares`]: { personal_received: [share] } }, { [key]: { signed_in: false, shares: { received: [share] } } }]) {
      assert.deepEqual(pendingSubscriptionShares(status), [{ id, label, ownerNames: ["Sam"] }]);
    }
  }
});

test("ungranted, signed-in owner, and usable subscription never show unavailable notices", () => {
  for (const row of [{ ...share, granted: false }, { ...share, granted: undefined }, { ...share, owner_signed_in: true }]) {
    assert.deepEqual(pendingSubscriptionShares({ chatgpt: { shares: { personal_received: [row] } } }), []);
  }
  assert.deepEqual(pendingSubscriptionShares({ chatgpt: { signed_in: true, shares: { personal_received: [share] } } }), []);
});

test("pending popup row is informational, escaped, and contains no credential selection or model controls", () => {
  const markup = pendingSubscriptionShareMarkup({ chatgpt: { shares: { personal_received: [{ ...share, owner_name: '<img src=x onerror="bad()">' }] } } });
  assert.match(markup, /aria-disabled="true"/);
  assert.match(markup, /owner needs to reconnect/);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(markup, /data-action=|<select|<button|<img/);
});
