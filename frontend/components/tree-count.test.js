import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatTreeCount, treeCountValue } from "./tree-count.js";

const here = dirname(fileURLToPath(import.meta.url));
const tree = readFileSync(join(here, "project-tree.js"), "utf8");
const workspace = readFileSync(join(here, "../workspace/workspace-browser.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");

test("tree counts keep 0–999 full and compact from 1000", () => {
  assert.equal(treeCountValue(-3), 0);
  assert.equal(treeCountValue("x"), 0);
  assert.equal(formatTreeCount(0), "0");
  assert.equal(formatTreeCount(1), "1");
  assert.equal(formatTreeCount(150), "150");
  assert.equal(formatTreeCount(999), "999");
  assert.equal(formatTreeCount(1000), "1k");
  assert.equal(formatTreeCount(1200), "1.2k");
  assert.equal(formatTreeCount(1250), "1.3k");
  assert.equal(formatTreeCount(10100), "10k");
  assert.equal(formatTreeCount(999_499), "999k");
  assert.equal(formatTreeCount(999_500), "1M");
  assert.equal(formatTreeCount(1_000_000), "1M");
  assert.equal(formatTreeCount(1_250_000), "1.3M");
  assert.equal(formatTreeCount(12_000_000), "12M");
  assert.equal(formatTreeCount(1_000_000_000), "1B");
  assert.equal(formatTreeCount(2_200_000_000), "2.2B");
});

test("browser and workspace trees render compact counts", () => {
  assert.match(tree, /formatTreeCount/);
  assert.match(tree, /tree-count\.js\?v=20260915-treecount1/);
  assert.match(workspace, /formatTreeCount/);
  assert.match(workspace, /tree-count\.js\?v=20260915-treecount1/);
  assert.match(css, /\.browser-section-count,\s*\n\.proj-hierarchy-section-count/);
  assert.match(css, /padding:\s*1px 7px/);
  assert.match(css, /overflow:\s*visible/);
  assert.match(css, /margin-right:\s*20px/);
  assert.match(css, /flex:\s*0 0 2\.35em/);
  assert.match(css, /\.browser-section-head,\s*\n\.proj-hierarchy-section-head \{[\s\S]*?padding-right:\s*2px/);
  assert.match(html, /styles\.css\?v=[^"']*20260915-treecount1/);
  assert.match(html, /app\.js\?v=[^"']*20260915-treecount1/);
  assert.match(app, /project-tree\.js\?v=[^"']*20260915-treecount1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*20260915-treecount1/);
});
