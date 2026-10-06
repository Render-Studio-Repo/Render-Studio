import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_SETUP, buildAuthorizedAppRows, buildSetupInstructions, loadAuthorizedAppStatuses, resolveAppAction } from "./authorized-app-setup.js";

test("authorized app hydrate aborts the previous status fan-out", () => {
  const src = readFileSync(new URL("./authorized-app-setup.js", import.meta.url), "utf8");
  assert.match(src, /let authorizedAppsAbort = null; \/\/ leakfix57/);
  assert.match(src, /loadAuthorizedAppStatuses\(api, ctl\.signal\)/);
});

test("a failed provider status cannot remove other providers or any setup guide", async () => {
  const statuses = await loadAuthorizedAppStatuses(async (path) => {
    if (path === "/api/marketplace/seller") throw new Error("Stripe unavailable");
    if (path === "/api/integrations/github/status") return { configured: true, connected: true, account: { login: "fixture" } };
    return {};
  });
  assert.equal(statuses.seller.error, "Stripe unavailable");
  const rows = buildAuthorizedAppRows(statuses);
  assert.equal(rows.length, 15);
  assert.equal(rows.find((row) => row.key === "github").connected, true);
  assert.equal(rows.find((row) => row.key === "stripe").error, "Stripe unavailable");
  assert.equal(rows.filter((row) => row.group === "stream").length, 3);
});

test("incomplete Stripe onboarding connects and never disconnects", () => {
  const stripe = buildAuthorizedAppRows({ seller: { stripe_account_id: "acct_fixture", stripe_ready: false }, receive: { stripe_configured: true } }).find((row) => row.key === "stripe");
  assert.equal(stripe.cta, "Finish setup");
  assert.equal(stripe.action, "connect-stripe");
  assert.deepEqual(resolveAppAction(stripe.key, stripe.action), { kind: "connect", endpoint: "/api/marketplace/seller/connect", method: "POST" });
});

test("demo Stripe is not presented as real connected payments", () => {
  const stripe = buildAuthorizedAppRows({ seller: { stripe_account_id: "acct_demo_fixture", stripe_ready: true }, receive: { stripe_configured: false } }).find((row) => row.key === "stripe");
  assert.equal(stripe.connected, false);
  assert.equal(stripe.ready, false);
  assert.equal(stripe.demo, true);
  assert.equal(stripe.action, "connect-stripe");
});

test("missing provider configuration stays actionable as setup, never disabled", () => {
  const rows = buildAuthorizedAppRows({ discord: { configured: false }, receive: { paypal_oauth_configured: false }, drive: { configured: false }, twitter: { configured: false } });
  for (const key of ["discord", "paypal", "google-drive", "twitter"]) {
    const row = rows.find((item) => item.key === key);
    assert.equal(row.configured, false);
    assert.equal(row.disabled, undefined);
    assert.ok(APP_SETUP[key].developer.length > 25);
  }
});

test("stream destinations do not claim verified authorization or dispatch fake connect", () => {
  const rows = buildAuthorizedAppRows({ streams: { providers: [{ id: "twitch", configured: true, connected: true }] } });
  const twitch = rows.find((row) => row.key === "stream-twitch");
  assert.equal(twitch.destinationOnly, true);
  assert.equal(twitch.configured, false);
  assert.deepEqual(resolveAppAction("stream-kick", "connect-stream-kick"), { kind: "setup" });
  assert.equal(resolveAppAction("stream-twitch", twitch.action).method, "DELETE");
});

test("all guides copy only placeholders and deployment origin, never credentials or state", () => {
  for (const key of Object.keys(APP_SETUP)) {
    const text = buildSetupInstructions(key, { origin: "https://user:private@example.org/private?code=secret-state#token" });
    assert.match(text, /existing provider service\/routes/);
    assert.doesNotMatch(text, /user:private|secret-state|\/private|#token|\/Users\/sam/);
    assert.ok(text.includes(APP_SETUP[key].docs));
  }
});

test("callback templates match actual calendar and Drive routes", () => {
  assert.match(buildSetupInstructions("outlook"), /https:\/\/render3d.app\/oauth\/calendar\/callback/);
  assert.match(buildSetupInstructions("google-drive"), /https:\/\/render3d.app\/oauth\/drive\/callback/);
  assert.match(buildSetupInstructions("github"), /GITHUB_REDIRECT_URI=https:\/\/render3d.app\/oauth\/github\/callback/);
});

test("Stripe keys stay server-side and the documented onboarding return is the existing route", () => {
  const text = buildSetupInstructions("stripe");
  assert.match(text, /STRIPE_SECRET_KEY=<set securely>/);
  assert.match(text, /marketplace.html\?seller=connected#payments-readme/);
  assert.match(text, /demo account path/);
});
