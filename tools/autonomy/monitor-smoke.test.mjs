import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureMonitorLayout,
  ingestFail,
  resolvePaths,
  setEnabled,
  setFreeReign,
  tripKill,
} from "./monitor-lib.mjs";

function makeRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "autonomy-monitor-"));
  ensureMonitorLayout(rootDir);
  return { rootDir, paths: resolvePaths(rootDir) };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("free_reign=false writes FAIL event + FIX candidate and never drafts work", () => {
  const { rootDir, paths } = makeRoot();
  setEnabled(rootDir, true);
  const result = ingestFail(rootDir, {
    area: "workshop",
    slug: "synthetic-observe-only",
    symptom: "Synthetic bug blocks workshop queue.",
    root_cause: "Synthetic queue status desync.",
    fix: "Candidate only - inspect frontend/workshop-mode.js and backend/services/workshop_service.py.",
    verify: "node --test tools/autonomy/monitor-smoke.test.mjs",
  });

  assert.equal(result.noop, false);
  assert.equal(result.mode, "observe-only");
  assert.equal(result.draft_instruction_path, null);

  const event = readJson(path.join(rootDir, result.event_path));
  const receipt = readJson(path.join(rootDir, result.receipt_path));
  const index = readJson(paths.indexPath);

  assert.equal(event.fail_id, result.fail_id);
  assert.equal(event.action, "observe-only");
  assert.equal(receipt.fix_id, result.fix_id);
  assert.equal(receipt.status, "candidate");
  assert.equal(receipt.auto_eligible, false);
  assert.equal(index.receipts.length, 1);
  assert.equal(index.receipts[0].fix_id, result.fix_id);
});

test("KILL present forces a no-op", () => {
  const { rootDir, paths } = makeRoot();
  setEnabled(rootDir, true);
  tripKill(rootDir, "smoke test");

  const result = ingestFail(rootDir, {
    area: "workshop",
    slug: "synthetic-killed",
    symptom: "Synthetic bug should be ignored.",
    root_cause: "Synthetic root cause.",
  });

  assert.equal(result.noop, true);
  assert.equal(result.reason, "kill-switch");
  assert.equal(fs.readdirSync(paths.eventsDir).length, 0);
  assert.equal(fs.readdirSync(paths.receiptsDir).length, 0);
});

test("free_reign=true emits a draft instruction only and never a merge action", () => {
  const { rootDir } = makeRoot();
  setEnabled(rootDir, true);
  setFreeReign(rootDir, true);

  const result = ingestFail(rootDir, {
    area: "cad",
    slug: "synthetic-draft-only",
    symptom: "Synthetic bug in CAD flow.",
    root_cause: "Synthetic guardrail failure.",
    fix: "Would stage a narrow candidate change in backend/services/example.py.",
    verify: "Manual review green.",
    verify_green: true,
  });

  assert.equal(result.noop, false);
  assert.equal(result.mode, "draft-only");
  assert.ok(result.draft_instruction_path);

  const draft = readJson(path.join(rootDir, result.draft_instruction_path));
  const receipt = readJson(path.join(rootDir, result.receipt_path));

  assert.equal(draft.kind, "draft_pr_instruction");
  assert.equal(draft.merge, false);
  assert.equal(draft.apply_patch, false);
  assert.equal(draft.pr.draft, true);
  assert.equal(receipt.status, "candidate");
  assert.equal(receipt.auto_eligible, true);
});
