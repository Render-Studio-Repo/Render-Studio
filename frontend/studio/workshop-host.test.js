import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WORKSHOP_MODULES, WORKSHOP_TAB_ID } from "./workshop-modules.js";
import { APPROVALS_TAB_ID, summarizeApprovals } from "./approvals-debug.js";
import { VIEWPORT_TAB_ID, buildShellTabStrip } from "./document-tabs.js";

test("viewport strip is Viewport, Robotics Home, Workshop, Approvals", () => {
  const strip = buildShellTabStrip([], null);
  assert.deepEqual(strip.map((t) => t.label), ["Viewport", "Robotics Home", "Workshop", "Approvals"]);
  assert.equal(strip[0].id, VIEWPORT_TAB_ID);
  assert.equal(strip[2].id, WORKSHOP_TAB_ID);
  assert.equal(strip[3].id, APPROVALS_TAB_ID);
  assert.ok(strip.every((t) => t.compact));
});

test("workshop modules are importable and approvals summarize the debug queue", () => {
  assert.ok(WORKSHOP_MODULES.some((m) => m.id === "board"));
  assert.ok(WORKSHOP_MODULES.some((m) => m.id === "world"));
  const sum = summarizeApprovals({
    pending: { pending_watchdogs: [{ id: "w1" }], pending_cli: [], pending_skills: [{ id: "s1", approval_count: 1 }] },
  });
  assert.equal(sum.total, 2);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const tabs = readFileSync(new URL("./document-tabs.js", import.meta.url), "utf8");
  assert.match(html, /id="workshop-host"/);
  assert.match(html, /id="approvals-debug"/);
  assert.match(tabs, /WORKSHOP_TAB_ID/);
  assert.match(tabs, /APPROVALS_TAB_ID/);
});
