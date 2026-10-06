import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DOC_CATEGORIES, DOC_FEATURES } from "./docs-features.js";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..");

const TAB_PAGES = [
  "pages/docs.html",
  "pages/getting-started.html",
  "pages/database.html",
  "pages/updates.html",
  "pages/credibility.html",
];

test("Full Documentation landing is a category grid and Agent Store is a catalog category", () => {
  const html = readFileSync(join(frontend, "pages/docs.html"), "utf8");
  const catalog = readFileSync(join(frontend, "site/docs-catalog.js"), "utf8");
  const completeAt = html.indexOf('id="complete-docs"');
  assert.ok(completeAt > 0);
  const beforeCatalog = html.slice(0, completeAt);
  assert.equal(beforeCatalog.includes('id="agent-store-docs"'), false);
  assert.equal(beforeCatalog.includes("Agent Store documentation"), false);
  assert.match(html, /id="docs-catalog"/);
  assert.doesNotMatch(html, /id="docs-catalog-nav"/);
  assert.match(html, /docs-catalog\.js\?v=20260916-gifs40/);
  assert.match(catalog, /docs-category-grid/);
  assert.match(catalog, /id="docs-category-grid"/);
  assert.match(catalog, /data-docs-cat/);
  assert.match(catalog, /export function catalogViewFromHash/);
  assert.match(catalog, /raw === "complete-docs"\) return \{ mode: "grid" \}/);
  assert.match(catalog, /raw === "agent-store-docs"/);
  assert.match(catalog, /id: "agent-store"/);
  assert.match(catalog, /#cat-\$\{esc\(row\.id\)\}/);

  const agentCat = DOC_CATEGORIES.find((row) => row.id === "agent-store");
  assert.ok(agentCat, "Agent Store is a DOC_CATEGORIES entry");
  assert.equal(agentCat.title, "Agent Store");
  assert.equal(agentCat.kind, "listing");
  assert.ok(DOC_FEATURES.some((row) => row.category === "agent-store"));
  assert.ok(DOC_FEATURES.filter((row) => row.category === "help").every((row) => !String(row.id).startsWith("agent-store")));
});

test("robotics docs include connecting wrist cameras without a personal LAN IP", () => {
  const cameras = DOC_FEATURES.find((row) => row.id === "robotics-wrist-cameras");
  assert.ok(cameras, "Connecting wrist cameras is a robotics doc");
  assert.equal(cameras.category, "robotics");
  assert.equal(cameras.title, "Connecting wrist cameras");
  assert.ok(cameras.steps.some((step) => /Wrist Cam/i.test(step)));
  assert.ok(cameras.steps.some((step) => /Allow camera/i.test(step)));
  assert.ok(cameras.steps.some((step) => /left\.jpg/.test(step) && /right\.jpg/.test(step)));
  const blob = JSON.stringify(cameras);
  assert.equal(blob.includes("192.168.1.83"), false);
  assert.equal(blob.includes("192.168."), false);
});

test("docs category tabs include Roadmap on existing docs chrome", () => {
  for (const rel of TAB_PAGES) {
    const html = readFileSync(join(frontend, rel), "utf8");
    assert.match(html, /class="docs-category-tabs/, `${rel} has docs category tabs`);
    assert.match(html, /href="\/roadmap\.html">Roadmap</, `${rel} is missing Roadmap tab`);
    assert.match(html, /href="\/white-paper\.html#crew-report">Crew report</, `${rel} is missing Crew report tab`);
    assert.match(html, /href="\/white-paper\.html">White paper</, `${rel} is missing White paper tab`);
  }
});

test("Sept 2026 features have docs entries and GIF files", () => {
  const ids = [
    "viewport-finder",
    "pin-projects",
    "clip-video-editor",
    "imagine-panel",
    "prompt-persist",
    "reference-folders",
    "wiring-compose",
    "viewport-split-layouts",
    "public-pin",
    "film-edit",
    "native-joints",
    "code-workspace",
    "settings-search",
    "freecad-kernel",
    "document-tabs",
    "dimos-enable",
    "send-to-wiring",
    "edit-selected",
  ];
  const gifs = [
    "viewport-finder.gif",
    "pin-projects.gif",
    "clip-video-editor.gif",
    "canvas-workspace.gif",
    "imagine-panel.gif",
    "parts-catalog.gif",
    "reference-folders.gif",
    "wiring-compose.gif",
    "prompt-persist.gif",
    "viewport-split-layouts.gif",
    "public-pin.gif",
    "film-edit.gif",
    "native-joints.gif",
    "code-workspace.gif",
    "wrist-cameras.gif",
    "settings-search.gif",
    "mobile-studio.gif",
    "share-remix.gif",
    "freecad-kernel.gif",
    "vr-menu.gif",
    "public-room.gif",
    "document-tabs.gif",
    "remix-workspace.gif",
    "dimos-enable.gif",
    "workspace-invite.gif",
    "context-lab.gif",
    "improve-lab.gif",
    "calendar-meetings.gif",
    "receive-money.gif",
    "suggestions.gif",
    "exploded-view.gif",
    "kernel-measure.gif",
    "vr-spatial-draw.gif",
    "dxf-convert.gif",
    "send-to-wiring.gif",
    "wiring-3d-ar.gif",
    "vr-voice-companion.gif",
    "plus-new-project.gif",
    "public-projects-live.gif",
    "chatgpt-team-share.gif",
    "capture-fullscreen.gif",
    "texture-to-model.gif",
    "share-to-x.gif",
    "recording-hud.gif",
    "edit-selected.gif",
    "database-setup.gif",
    "agent-tabs.gif",
    "marketplace-layouts.gif",
    "solidworks-import.gif",
    "fritzing-skins.gif",
    "cad-mode-chips.gif",
  ];
  for (const id of ids) {
    const feature = DOC_FEATURES.find((row) => row.id === id);
    assert.ok(feature, `missing DOC_FEATURES ${id}`);
    assert.ok(feature.gif, `${id} needs a gif`);
    assert.ok(feature.steps?.length, `${id} needs steps`);
  }
  const canvas = DOC_FEATURES.find((row) => row.id === "canvas");
  assert.match(canvas.gif, /canvas-workspace\.gif/);
  const wrist = DOC_FEATURES.find((row) => row.id === "robotics-wrist-cameras");
  assert.match(wrist.gif, /wrist-cameras\.gif/);
  const draw = DOC_FEATURES.find((row) => row.id === "vr-ai-draw");
  assert.match(draw.gif, /vr-spatial-draw\.gif/);
  for (const name of gifs) {
    const path = join(frontend, "docs/media", name);
    assert.ok(readFileSync(path).length > 1000, `${name} missing or tiny`);
  }
});
