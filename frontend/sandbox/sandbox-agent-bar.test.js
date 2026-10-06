import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTXLOG1_TOKEN } from "./sandbox-context-log.js";

test("context log token and API path exist", () => {
  assert.equal(CTXLOG1_TOKEN, "ctxlog1");
  const js = readFileSync(new URL("./sandbox-context-log.js", import.meta.url), "utf8");
  assert.match(js, /\/api\/sandbox\/context-log/);
  assert.match(js, /sandbox\.ui\.click/);
  assert.doesNotMatch(js, /prompt_text|raw.?frame|quaternion/);
});

test("sandbox page mounts agent bar between IDE and teleop", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const boot = readFileSync(new URL("./boot.js", import.meta.url), "utf8");
  const canvas = html.match(/sb-workspace-canvas[\s\S]*?<\/section>/)?.[0] || "";
  const htmlAll = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(htmlAll, /id="sb-collab-top"/);
  assert.ok(htmlAll.indexOf('id="sb-collab-top"') < htmlAll.indexOf('id="sb-super-ide"'));
  assert.match(canvas, /id="sb-agent-bar"/);
  assert.ok(canvas.indexOf('id="sb-super-ide"') < canvas.indexOf('id="sb-agent-bar"'));
  assert.ok(canvas.indexOf('id="sb-agent-bar"') < canvas.indexOf('id="sb-teleop"'));
  assert.match(boot, /mountSandboxAgentBar/);
});

test("supabase migration defines sandbox_context_events", () => {
  const sql = readFileSync(new URL("../../integrations/supabase/migrations/011_sandbox_context_log.sql", import.meta.url), "utf8");
  assert.match(sql, /sandbox_context_events/);
  assert.match(sql, /service_role/);
  assert.match(sql, /REVOKE ALL/);
});
