import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const js = readFileSync(join(here, "receive-payments.js"), "utf8");
const css = readFileSync(join(here, "receive-payments.css"), "utf8");

test("receive-payments remount aborts the previous status GET", () => {
  assert.match(js, /let receivePaymentsAbort = null; \/\/ leakfix74/);
  assert.match(js, /const render = async \(\) => \{[\s\S]{0,700}loadReceiveStatus\(ctl\.signal\)/);
});

test("receive-money Show toggles persist immediately via PATCH", () => {
  assert.match(js, /data-recv-toggle/);
  assert.match(js, /function togglePatch/);
  assert.match(js, /show_receive_button/);
  assert.match(js, /stripe_enabled/);
  assert.match(js, /paypal_enabled/);
  assert.match(js, /x_enabled/);
  assert.match(js, /wallets: \{ eth: \{ enabled: on \} \}/);
  assert.match(js, /await patchReceive\(body\)/);
  assert.match(js, /ASSET = "20260909-proftabs1"/);
});

test("receive-money rows keep label, hint, Show, and connect on one row", () => {
  assert.match(js, /function methodRow/);
  assert.match(js, /recv-pay-copy/);
  assert.match(css, /\.recv-pay-row \{/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /\.recv-pay-toggle/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});
