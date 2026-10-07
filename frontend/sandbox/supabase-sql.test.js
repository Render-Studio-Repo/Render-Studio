import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SUPASQL1_TOKEN,
  FINDINGS_PATH,
  parseSafeSql,
  runSafeSql,
  scoreDocHit,
  saveLocalFindings,
  loadLocalFindings,
} from "./supabase-sql.js";

test("supabase SQL token and safe parser", () => {
  assert.equal(SUPASQL1_TOKEN, "supasql1");
  assert.equal(FINDINGS_PATH, "sandbox-sessions/supabase-sql-findings.json");
  assert.equal(parseSafeSql("SELECT * FROM findings").ok, true);
  assert.equal(parseSafeSql("DELETE FROM findings").ok, false);
  assert.equal(runSafeSql("SELECT * FROM mystery").reason, "unknown_table");
  assert.match(parseSafeSql("select * from findings; service_role").reason || "", /blocked|shape/);
  const ran = runSafeSql("SELECT * FROM findings WHERE q='lock'", {
    findings: [{ id: "1", text: "sam-y-engage-v2 lock" }],
    docs: [],
    crew: [],
  });
  assert.equal(ran.ok, true);
  assert.equal(ran.stub, true);
  assert.equal(ran.rows.length, 1);
});

test("doc search scores sandbox teaching notes", () => {
  assert.ok(scoreDocHit("teach basic character moves in any workshop", "character moves") >= 2);
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  saveLocalFindings([{ id: "a" }], storage);
  assert.equal(loadLocalFindings(storage)[0].id, "a");
});

test("Super IDE and workshop wire the SQL tab without a new WebGL canvas", () => {
  const ide = readFileSync(new URL("./super-ide.js", import.meta.url), "utf8");
  const replica = readFileSync(new URL("./studio-viewport-replica.js", import.meta.url), "utf8");
  assert.match(ide, /Supabase SQL|supasql1|SUPASQL1/);
  assert.match(ide, /mountSupabaseSql/);
  assert.doesNotMatch(ide, /WebGLRenderer/);
  assert.match(replica, /data-sbvp-mode="sql"/);
  assert.doesNotMatch(replica, /data-sbvp-mode="whiteboard"/);
});
