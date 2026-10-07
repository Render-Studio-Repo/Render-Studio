import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  CTXLINK_CACHE,
  fileNameOf,
  formatCopyPaths,
  isWikiPath,
  relatedStatus,
  renderWikiMarkdown,
  resolveWikiPath,
  selectionHasIssue,
} from "./context-wiki-links.js";

const here = dirname(fileURLToPath(import.meta.url));

test("cache token is ctxlink1", () => {
  assert.equal(CTXLINK_CACHE, "ctxlink1");
});

test("render3d.service and repo paths are wiki files", () => {
  assert.equal(isWikiPath("render3d.service"), true);
  assert.equal(isWikiPath("frontend/studio/app.js"), true);
  assert.equal(isWikiPath("ai-context/START-HERE.md"), true);
  assert.equal(resolveWikiPath("ai-context/START-HERE.md", "render3d.service"), "deploy/render3d.service");
  assert.equal(resolveWikiPath("ai-context/START-HERE.md", "./workspace-map.md"), "ai-context/workspace-map.md");
  assert.equal(isWikiPath(".env"), false);
  assert.equal(isWikiPath("not working"), false);
  assert.equal(isWikiPath("ai-context/"), false);
  assert.equal(isWikiPath("frontend/"), false);
});

test("copy path lists every highlighted name and full path", () => {
  const text = formatCopyPaths([
    { name: "render3d.service", path: "deploy/render3d.service" },
    { name: "app.js", path: "frontend/studio/app.js" },
  ]);
  assert.equal(text, "render3d.service — deploy/render3d.service\napp.js — frontend/studio/app.js");
  assert.equal(fileNameOf("backend/skills/cad/SKILL.md"), "SKILL.md");
});

test("related status distinguishes same-area vs mixed trees", () => {
  const related = relatedStatus(["backend/skills/cad/SKILL.md", "backend/skills/wiring/SKILL.md"]);
  assert.equal(related.related, true);
  const mixed = relatedStatus(["frontend/studio/app.js", "backend/skills/cad/SKILL.md"]);
  assert.equal(mixed.related, false);
  assert.equal(relatedStatus(["deploy/render3d.service"]).related, true);
});

test("issue language is detected from Sam's prompt", () => {
  assert.equal(selectionHasIssue("viewport is not working after the gizmo move"), true);
  assert.equal(selectionHasIssue("404 on getting started"), true);
  assert.equal(selectionHasIssue("this looks fine"), false);
});

test("START-HERE style markdown becomes blue wiki links", () => {
  const html = renderWikiMarkdown(
    "Read [`ai-context/START-HERE.md`](./START-HERE.md) and `render3d.service` plus [[workspace-map.md]].",
    { fromPath: "ai-context/START-HERE.md" },
  );
  assert.match(html, /ctx-wiki-link/);
  assert.match(html, /data-ctx-path="ai-context\/START-HERE.md"/);
  assert.match(html, /data-ctx-path="deploy\/render3d.service"/);
  assert.match(html, /data-ctx-path="ai-context\/workspace-map.md"/);
});

test("Getting Started and Foundry wire the viewer", () => {
  const gs = readFileSync(join(here, "../pages/getting-started.html"), "utf8");
  const foundry = readFileSync(join(here, "../pages/foundry.html"), "utf8");
  const admin = readFileSync(join(here, "../pages/admin-dashboard.html"), "utf8");
  const server = readFileSync(join(here, "../admin/admin-server-settings.js"), "utf8");
  assert.match(gs, /#ai-context/);
  assert.match(gs, /context-wiki-links.css\?v=ctxlink1/);
  assert.match(gs, /getting-started\.js\?v=.*ctxlink1/);
  assert.match(foundry, /ctxlink1/);
  assert.match(admin, /ctxlink1/);
  assert.match(server, /renderWikiMarkdown/);
  assert.match(server, /bindWikiLinks/);
});
