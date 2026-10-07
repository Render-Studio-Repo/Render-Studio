import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const browser = readFileSync(join(here, "workspace-browser.js"), "utf8");

test("left explorer defaults to Projects on refresh, not last Reference Files tab", () => {
  assert.match(browser, /const EXPLORER_PANE_KEY = "render3d:explorer-pane"/);
  assert.match(browser, /let explorerPane = "projects"/);
  assert.doesNotMatch(browser, /localStorage\.getItem\(EXPLORER_PANE_KEY\) === "references"/);
  assert.match(html, /class="explorer-pane-tab is-active" id="explorer-tab-projects"/);
  assert.match(html, /data-explorer-pane="projects"/);
  assert.match(html, /styles\.css\?v=[^"']*projtab1/);
  assert.match(html, /app\.js\?v=[^"']*projtab1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*projtab1/);
});

test("project cards retry a missing mesh thumb instead of keeping the gear logo", () => {
  assert.match(browser, /THUMB_RETRY_MS/);
  assert.match(browser, /cache: "no-store"/);
  assert.match(browser, /err\.retry = true/);
  assert.match(html, /app\.js\?v=[^"']*thumb1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*thumb1/);
});
