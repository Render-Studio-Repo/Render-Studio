#!/usr/bin/env node
/** BENCH-COLLAB-01 — trip-up tests against collab-index.json. Expect FAIL until crew readjusts to the data API. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(join(here, "../../frontend/docs/media/collab-index.json"), "utf8"));
const byPath = Object.fromEntries((index.files || []).map((f) => [f.path, f.text || ""]));

const faults = [];
function check(name, ok, detail) {
  if (!ok) faults.push({ name, detail });
}

check("instance_public_factor=0", !/instance_public_factor\s*=\s*1/.test(byPath["README.md"] || ""), "README still has instance_public_factor=1 (must be 0)");
check("HOW-TO-READ-INDEX not claimed as Drive hit", !/top hit for q=HOW-TO-READ-INDEX/.test(byPath["notes/HOW-TO-READ-INDEX.md"] || ""), "notes/HOW-TO-READ-INDEX.md claims Drive hit; gold title is INDEX-T-MD-DUMP-01.md");
check("drive-search path", !/drive-searchh/.test(byPath["api/drive-search.js"] || ""), "typo /mcp/drive-searchh");
check("share_log totl", !/\btotl\b/.test(byPath["pad/share_log.py"] || ""), "planted totl bug (auditor already fixed this once on the pad)");

console.log(JSON.stringify({ ok: faults.length === 0, fail: faults.length, faults }, null, 2));
if (faults.length) process.exit(1);
