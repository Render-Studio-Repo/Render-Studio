import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chunkText, contentHash, REMIX1_TOKEN } from "./sandbox-remix.js";

test("remix chunk index hashes windows for compare", () => {
  assert.equal(REMIX1_TOKEN, "remix1");
  const a = chunkText("hello world ".repeat(80), { path: "tree.json", size: 40, overlap: 8 });
  assert.ok(a.length >= 2);
  assert.equal(a[0].content_hash.length, 8);
  assert.equal(contentHash("same"), contentHash("same"));
  assert.notEqual(contentHash("same"), contentHash("other"));
});

test("sandbox wires remix import, exit blueprint, OpenArm Viser NW", () => {
  const boot = readFileSync(new URL("./boot.js", import.meta.url), "utf8");
  const bar = readFileSync(new URL("./sandbox-agent-bar.js", import.meta.url), "utf8");
  const studio = readFileSync(new URL("./studio-window.js", import.meta.url), "utf8");
  const pane = readFileSync(new URL("./openarm-viser-pane.js", import.meta.url), "utf8");
  assert.match(boot, /mountOpenArmViserPane/);
  assert.match(bar, /data-sb-remix/);
  assert.match(bar, /pickAndImportRemix/);
  assert.match(studio, /exitSandboxSaveRemix/);
  assert.match(pane, /export const MUJOCO_LAB = LEGACY_MUJOCO_LAB|LEGACY_MUJOCO_LAB/);
  assert.match(pane, /data-nw-mode="openarm"/);
  assert.match(pane, /Studio viewport|data-sb-live-slot="viewport"/);
  assert.match(pane, /sbvp1/);
});

test("chat timestamps format AM/PM then M-D-Y", () => {
  const js = readFileSync(new URL("../site/group-chat.js", import.meta.url), "utf8");
  assert.match(js, /formatChatTs/);
  assert.match(js, /PM|AM/);
});

test("supabase migration defines sandbox_remix_blueprints", () => {
  const sql = readFileSync(new URL("../../integrations/supabase/migrations/012_sandbox_remix_blueprints.sql", import.meta.url), "utf8");
  assert.match(sql, /sandbox_remix_blueprints/);
  assert.match(sql, /safe_to_merge/);
});
