import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  suggestMcMasterParts,
  normalizeSuggestQuery,
  familySelection,
  QUICK_FAMILIES,
  MCMASTER_THUMB,
} from "./mcmaster-suggest.js";

const here = dirname(fileURLToPath(import.meta.url));

test("mcmtype1: typo 4 mm scrw suggests M4 McMaster PNs", () => {
  assert.equal(normalizeSuggestQuery("4 mm scrw"), "4 mm screw");
  const hits = suggestMcMasterParts("4 mm scrw");
  assert.ok(hits.length >= 2, "should return several M4 screws");
  assert.ok(hits.every((h) => h.number && h.title));
  assert.ok(hits.some((h) => /91251A14/.test(h.number)));
  assert.ok(hits.some((h) => /M4|4 mm/i.test(h.subtitle)));
});

test("mcmtype1: prefix PN match ranks first", () => {
  const hits = suggestMcMasterParts("91251A15");
  assert.equal(hits[0].number, "91251A152");
});

test("mcmtype1: quick family M4 16 mm maps to catalog PN", () => {
  const screws = QUICK_FAMILIES.find((f) => f.id === "screws");
  const sel = familySelection(screws, "m4", "16");
  assert.equal(sel.number, "91251A152");
  assert.equal(MCMASTER_THUMB(sel.number), "https://images.mcmaster.com/91251A152.png");
});

test("mcmaster suggest aborts the previous suggest GET", () => {
  const src = readFileSync(join(here, "mcmaster-insert.js"), "utf8");
  assert.match(src, /let mcmasterSuggestAbort = null; \/\/ leakfix65/);
  assert.match(src, /async function refreshSuggest\(query\)[\s\S]{0,900}onSuggestParts\(q, \{ signal: ctl\.signal \}\)/);
});

test("mcmtype1: insert module ships typeahead + no tab-bucket", () => {
  const src = readFileSync(join(here, "mcmaster-insert.js"), "utf8");
  assert.match(src, /mcmtype1/);
  assert.match(src, /suggestMcMasterParts/);
  assert.match(src, /fetchServerPart\(pn/);
  assert.doesNotMatch(src, /tab-bucket|Tab bucket|folder-watch|Start watch/i);
  assert.match(src, /images\.mcmaster\.com/);
  assert.match(src, /data-mcmaster-dest/);
});
