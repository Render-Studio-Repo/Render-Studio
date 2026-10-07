import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesInspectQuery } from "./workspace-inspect.js";

const here = dirname(fileURLToPath(import.meta.url));

test("workspace inspect search matches people and projects", () => {
  assert.equal(matchesInspectQuery({ display_name: "Sam W", email: "a1@x.com" }, "sam"), true);
  assert.equal(matchesInspectQuery({ name: "Mobile Robot Base", latest_file: "arm.step" }, "robot"), true);
  assert.equal(matchesInspectQuery({ name: "Vase Plant" }, "screwdriver"), false);
  assert.equal(matchesInspectQuery({ name: "Fire Pit" }, ""), true);
});

test("workspace inspect Projects heading has create-in-this-workspace", () => {
  const src = readFileSync(join(here, "workspace-inspect.js"), "utf8");
  assert.match(src, /function revokeUnlistedInspectThumbs\(keepIds\) \{ \/\/ leakfix28/);
  assert.match(src, /revokeUnlistedInspectThumbs\(visibleProjects\.map\(\(p\) => p\.id\)\); \/\/ leakfix28/);
  assert.match(src, /revokeUnlistedInspectThumbs\(\[\]\); \/\/ leakfix28/);
  assert.match(src, /let inspectMembersAbort = null; \/\/ leakfix49/);
  assert.match(src, /async function reloadMembers[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(src, /data-ws-inspect-create/);
  assert.match(src, /onCreateProject\?\.\(team\.id\)/);
  assert.match(src, /New project in this workspace/);
});
