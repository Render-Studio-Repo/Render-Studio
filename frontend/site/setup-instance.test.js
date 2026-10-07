import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../pages/setup.html"), "utf8");
const js = readFileSync(join(here, "setup-instance.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");

test("first-run setup offers subscriptions and user-owned API keys", () => {
  assert.match(html, /setup_ai=subscriptions/);
  assert.match(html, /setup_ai=keys/);
  assert.match(html, /private Luna subscription and cloud keys stay only on the official Render server/);
  assert.match(app, /new URLSearchParams\(window\.location\.search\)\.get\("setup_ai"\)/);
});

test("instance updates are optional and preserve runtime data", () => {
  assert.match(html, /Show update notices to instance admins/);
  assert.match(html, /projects\//);
  assert.match(html, /data\//);
  assert.match(html, /Changes to render3d\.app do not trigger this notice/);
  assert.match(html, /Any locally edited or added application source/);
  assert.match(js, /\/api\/setup\/instance-updates\/apply/);
  assert.match(js, /restart this Render instance/i);
  assert.match(js, /Downloading the latest verified GitHub release/);
  assert.match(js, /window\.location\.reload\(\)/);
  assert.match(html, /aria-live="polite"/);
});

test("instance ecosystem consent is separate from health reporting", () => {
  assert.match(html, /instance-network-ecosystem/);
  assert.match(html, /Private projects and project files are never swept or uploaded/);
  assert.match(js, /ecosystem_opt_in/);
  assert.match(js, /publishing remains approval-gated/);
});
