#!/usr/bin/env node

/**
 * Write a fleet update receipt into sandbox-sessions/receipts/
 * and print a matching Supabase upsert sketch for operators.
 *
 * Usage:
 *   node tools/receipts/update-receipt.js --input sandbox-sessions/receipts/examples/RCPT-WORKSHOP-20260918-god-view.json
 *   node tools/receipts/update-receipt.js --input /tmp/receipt.json --latest-only
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const receiptsDir = path.join(repoRoot, "sandbox-sessions", "receipts");
const examplesDir = path.join(receiptsDir, "examples");

function usage(code = 0) {
  const text = [
    "Usage:",
    "  node tools/receipts/update-receipt.js --input <receipt.json> [--latest-only]",
    "",
    "Writes:",
    "  sandbox-sessions/receipts/<receipt_id>.json",
    "  sandbox-sessions/receipts/latest.json",
  ].join("\n");
  (code ? process.stderr : process.stdout).write(`${text}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { input: "", latestOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      out.input = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--latest-only") {
      out.latestOnly = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") usage(0);
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!out.input) throw new Error("Missing --input <receipt.json>.");
  return out;
}

function ensureReceiptShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Receipt payload must be a JSON object.");
  }
  const receiptId = String(value.receipt_id || "").trim();
  if (!/^RCPT-[A-Za-z0-9-]+$/.test(receiptId)) {
    throw new Error("receipt_id must start with RCPT-.");
  }
  return {
    receipt_id: receiptId,
    log_id: String(value.log_id || "").trim(),
    pr_url: value.pr_url ? String(value.pr_url).trim() : null,
    pr_number: Number.isFinite(Number(value.pr_number)) ? Number(value.pr_number) : null,
    color: String(value.color || "unset").trim().toLowerCase(),
    guard_note: String(value.guard_note || ""),
    mule_hop: String(value.mule_hop || ""),
    rmq: String(value.rmq || ""),
    status: String(value.status || "draft").trim().toLowerCase(),
    failure_id: value.failure_id ? String(value.failure_id).trim() : null,
    payload: value.payload && typeof value.payload === "object" && !Array.isArray(value.payload) ? value.payload : {},
    created_at: value.created_at ? String(value.created_at) : new Date().toISOString(),
  };
}

function printUpsertSketch(receipt) {
  const compact = JSON.stringify(receipt, null, 2);
  process.stdout.write([
    `Wrote receipt ${receipt.receipt_id}`,
    "",
    "Supabase JS upsert sketch:",
    "```js",
    "await supabase",
    "  .from('fleet_update_receipts')",
    "  .upsert({",
    `    receipt_id: ${JSON.stringify(receipt.receipt_id)},`,
    `    log_id: ${JSON.stringify(receipt.log_id)},`,
    `    pr_url: ${JSON.stringify(receipt.pr_url)},`,
    `    pr_number: ${receipt.pr_number === null ? "null" : receipt.pr_number},`,
    `    color: ${JSON.stringify(receipt.color)},`,
    `    guard_note: ${JSON.stringify(receipt.guard_note)},`,
    `    mule_hop: ${JSON.stringify(receipt.mule_hop)},`,
    `    rmq: ${JSON.stringify(receipt.rmq)},`,
    `    status: ${JSON.stringify(receipt.status)},`,
    `    failure_id: ${JSON.stringify(receipt.failure_id)},`,
    `    payload: ${JSON.stringify(receipt.payload)},`,
    "  }, { onConflict: 'receipt_id' });",
    "```",
    "",
    "Receipt payload:",
    "```json",
    compact,
    "```",
    "",
    `Examples live in ${path.relative(repoRoot, examplesDir)}/`,
  ].join("\n"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourcePath = path.resolve(process.cwd(), args.input);
  const raw = fs.readFileSync(sourcePath, "utf8");
  const receipt = ensureReceiptShape(JSON.parse(raw));
  fs.mkdirSync(receiptsDir, { recursive: true });
  fs.mkdirSync(examplesDir, { recursive: true });
  if (!args.latestOnly) {
    fs.writeFileSync(
      path.join(receiptsDir, `${receipt.receipt_id}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
  }
  fs.writeFileSync(path.join(receiptsDir, "latest.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  printUpsertSketch(receipt);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  usage(1);
}
