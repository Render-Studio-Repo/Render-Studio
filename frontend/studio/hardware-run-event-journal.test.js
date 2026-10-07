import test from "node:test";
import assert from "node:assert/strict";
import { createHardwareRunEventJournal, hardwareRunEventJournalMarkup } from "./hardware-run-event-journal.js";

test("hardware journal keeps the newest bounded timestamped operator and Pi events", () => {
  let second = 0;
  const journal = createHardwareRunEventJournal({ now: () => new Date(`2026-09-29T12:00:${String(second++).padStart(2, "0")}.000Z`), limit: 2 });
  journal.add("button", "start", "Run loaded policy");
  journal.add("pi request", "start", "POST /robotics/kill");
  journal.add("pi response", "pass", "Motion stopped", "ok=true");
  assert.deepEqual(journal.snapshot(), [
    { at: "2026-09-29T12:00:01.000Z", category: "pi request", outcome: "START", message: "POST /robotics/kill", details: "" },
    { at: "2026-09-29T12:00:02.000Z", category: "pi response", outcome: "PASS", message: "Motion stopped", details: "ok=true" },
  ]);
  assert.match(journal.text(), /event_count=2/);
  journal.clear();
  assert.equal(journal.text(), "schema=render3d.hardware-run-events/v1\nevent_count=0");
});

test("Step 4 debug UI is explicitly observational and copyable", () => {
  const html = hardwareRunEventJournalMarkup();
  assert.match(html, /Step 4 debug logs/);
  assert.match(html, /cannot send robot commands/);
  assert.match(html, /data-step4-debug-copy/);
  assert.match(html, /data-step4-debug-clear/);
});
