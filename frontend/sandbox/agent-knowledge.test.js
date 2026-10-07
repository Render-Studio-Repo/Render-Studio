import { test } from "node:test";
import assert from "node:assert/strict";
import { KB1_TOKEN } from "./agent-knowledge.js";
import { buildReceipt, RCPT1_TOKEN } from "./update-receipt.js";

test("knowledge lake token and receipts stay paired", () => {
  assert.equal(KB1_TOKEN, "kb1");
  const r = buildReceipt({ log_id: "da6e44bf-006", summary: "knowledge lake" });
  assert.equal(r.token, RCPT1_TOKEN);
  assert.equal(r.log_id, "da6e44bf-006");
});
