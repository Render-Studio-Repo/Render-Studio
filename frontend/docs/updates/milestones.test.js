import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { listMilestones } from "./milestones.js";

const here = dirname(fileURLToPath(import.meta.url));

const TWO_WEEK_IDS = [
  "github-oauth-supabase",
  "viewport-finder",
  "pin-projects",
  "clip-video-editor",
  "viser-lan-cloud",
  "reference-folders-captures",
  "imagine-panel",
  "vr-robot-dimos-gated",
  "admin-control-center",
  "prompt-persist-faster-boot",
  "freecad-kernel-edit",
  "parts-catalog-mcmaster",
  "viewport-split-layouts",
  "public-pin",
  "film-edit",
  "native-joints",
  "code-workspace",
];

test("last two weeks of big updates are on the Recent Updates list", () => {
  const rows = listMilestones();
  const ids = new Set(rows.map((row) => row.id));
  for (const id of TWO_WEEK_IDS) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
  const newest = rows.slice(0, 16).map((row) => row.id);
  assert.ok(ids.has("viewport-finder"));
  assert.ok(ids.has("pin-projects"));
  assert.ok(ids.has("clip-video-editor"));
  assert.ok(ids.has("viewport-split-layouts"));
  assert.ok(newest.includes("viewport-split-layouts"));
});

test("listed new-feature cards use distinct walkthrough GIFs", () => {
  const rows = listMilestones();
  const expect = {
    "robotics-wrist-cameras": /wrist-cameras\.gif/,
    "freecad-kernel-edit": /freecad-kernel\.gif/,
    "vr-robot-dimos-gated": /dimos-enable\.gif/,
    "self-host": /database-setup\.gif/,
  };
  const visuals = [];
  for (const [id, pattern] of Object.entries(expect)) {
    const row = rows.find((item) => item.id === id);
    assert.ok(row, `missing ${id}`);
    assert.match(String(row.visual || ""), pattern);
    visuals.push(row.visual);
  }
  assert.equal(new Set(visuals).size, visuals.length);
});

test("shipped.json registry includes the same ids", () => {
  const shipped = JSON.parse(readFileSync(join(here, "shipped.json"), "utf8"));
  const ids = new Set((shipped.items || []).map((row) => row.id));
  for (const id of TWO_WEEK_IDS) {
    assert.ok(ids.has(id), `shipped.json missing ${id}`);
  }
});
