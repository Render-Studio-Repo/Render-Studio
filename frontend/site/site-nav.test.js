import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..");

const PUBLIC_CHROME = [
  "index.html",
  "pages/updates.html",
  "pages/getting-started.html",
  "pages/docs.html",
  "pages/database.html",
  "pages/marketplace.html",
  "pages/skills.html",
  "pages/credibility.html",
  "pages/privacy.html",
  "pages/roadmap.html",
  "pages/white-paper.html",
  "pages/suggestions.html",
  "pages/admin-dashboard.html",
  "pages/knowledge-store.html",
  "pages/agent-store.html",
  "pages/model-store.html",
];

test("public site chrome Menu includes Tips & Tricks, Updates, and Sandbox (no White paper top tab)", () => {
  for (const rel of PUBLIC_CHROME) {
    const html = readFileSync(join(frontend, rel), "utf8");
    assert.match(html, /href="\/updates\.html"/, `${rel} is missing Updates`);
    assert.match(
      html,
      /href="\/updates\.html"[^>]*>Updates<\/a>\s*<a href="\/sandbox\/index\.html" class="nav-tab"[^>]*>Sandbox<\/a>/,
      `${rel} is missing Sandbox nav-tab beside Updates`,
    );
    assert.match(html, /Tips &amp;\s*Tricks/, `${rel} is missing Tips & Tricks`);
    assert.equal(
      /href="\/white-paper\.html" class="nav-tab"/.test(html),
      false,
      `${rel} still has White paper toolbar tab`,
    );
  }
});

test("Getting Started tips chrome still links to Updates", () => {
  const html = readFileSync(join(frontend, "pages/getting-started.html"), "utf8");
  const tipsAt = html.indexOf('id="tips-library"');
  assert.ok(tipsAt > 0);
  const tips = html.slice(tipsAt, tipsAt + 2400);
  assert.match(tips, /href="\/updates\.html">Updates</);
});

test("Studio toolbar collapses when page tabs would clip Updates", () => {
  const nav = readFileSync(join(frontend, "studio/toolbar-nav.js"), "utf8");
  assert.match(nav, /overflow = totalNeeded > toolbar\.clientWidth/);
  assert.match(nav, /isVrHeadsetBrowser\(\) \|\| overflow/);
});

test("docs chrome uses the Studio gear+R mark", () => {
  const pages = [
    "pages/updates.html",
    "pages/getting-started.html",
    "pages/docs.html",
    "pages/credibility.html",
    "pages/database.html",
    "pages/marketplace.html",
    "pages/skills.html",
    "pages/roadmap.html",
    "pages/white-paper.html",
    "pages/suggestions.html",
    "pages/privacy.html",
  ];
  for (const rel of pages) {
    const html = readFileSync(join(frontend, rel), "utf8");
    const toolbar = html.slice(html.indexOf('<header class="toolbar">'), html.indexOf("toolbar-nav"));
    assert.match(toolbar, /render-logo-gear-still\.png\?v=20260915-logo1/, `${rel} toolbar logo`);
    assert.equal(toolbar.includes("render3d-logo-transparent"), false, `${rel} still has old mark`);
  }
  const heroPages = [
    "pages/updates.html",
    "pages/getting-started.html",
    "pages/docs.html",
    "pages/credibility.html",
    "pages/database.html",
  ];
  for (const rel of heroPages) {
    const html = readFileSync(join(frontend, rel), "utf8");
    assert.match(html, /class="docs-hero-gear"/, `${rel} banner gear`);
    assert.match(html, /docs-hero-gear[^>]*width="168"/, `${rel} gear is overlay-sized`);
    assert.match(html, /getting-started-hero\.css\?v=20260914-docslayout1/, `${rel} hero css`);
    assert.match(html, /href="\/database\.html">Database configuration</, `${rel} database tab`);
  }
  const css = readFileSync(join(frontend, "site/getting-started-hero.css"), "utf8");
  assert.match(css, /\.docs-hero-gear \{/);
  assert.match(css, /width: 168px;/);
  assert.match(css, /max-height: 168px;/);
  assert.doesNotMatch(css, /min-height: 248px/);
});

test("Database configuration is its own docs page with setup flow", () => {
  const gs = readFileSync(join(frontend, "pages/getting-started.html"), "utf8");
  assert.doesNotMatch(gs, /gs-install-callout/);
  assert.match(gs, /href="\/database\.html">Open database setup</);
  const db = readFileSync(join(frontend, "pages/database.html"), "utf8");
  assert.match(db, /<h2 class="gs-hero-title">Database configuration</);
  assert.match(db, /id="setup-form"/);
  assert.match(db, /id="btn-local"/);
  assert.match(db, /id="btn-copy-sql"/);
  assert.match(db, /id="btn-copy-prompt"/);
  assert.match(db, /setup-instance\.js\?v=20260914-installsb1/);
  const setup = readFileSync(join(frontend, "pages/setup.html"), "utf8");
  assert.match(setup, /id="setup-form"/);
  assert.match(setup, /setup-instance\.js\?v=20260914-installsb1/);
});
