import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  VR_CONTROLS_DOCS_HREF,
  VR_CONTROL_DOCS_HEADSETS,
  vrControlsDocsIntroHtml,
  vrHeadsetInstructions,
  persistDocsVrHeadset,
  readDocsVrHeadset,
  VR_CONTROLS_GUIDES,
} from "./vr-controls-docs.js";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..");

const TAB_PAGES = [
  "pages/docs.html",
  "pages/getting-started.html",
  "pages/database.html",
  "pages/updates.html",
  "pages/credibility.html",
];

test("docs headset switcher is present and persists", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
  const html = vrControlsDocsIntroHtml("quest3");
  assert.match(html, /data-vr-headset-select/);
  assert.match(html, /Quest 3/);
  assert.match(html, /Quest 3S/);
  assert.match(html, /Pico/);
  assert.match(html, /not a Meta Store app/);
  persistDocsVrHeadset("quest3s");
  assert.equal(readDocsVrHeadset(), "quest3s");
  const pico = vrHeadsetInstructions("pico");
  assert.match(pico.browser, /Pico Browser/);
  assert.ok(VR_CONTROL_DOCS_HEADSETS.some((h) => h.id === "vision"));
  assert.equal(VR_CONTROLS_DOCS_HREF, "/getting-started.html#vr-controls");
  assert.ok(VR_CONTROLS_GUIDES.some((g) => g.id === "vr-restart"));
});

test("docs chrome has a VR Controls tab", () => {
  for (const rel of TAB_PAGES) {
    const html = readFileSync(join(frontend, rel), "utf8");
    assert.match(html, /getting-started\.html#vr-controls">VR Controls</, `${rel} missing VR Controls tab`);
  }
  const gs = readFileSync(join(frontend, "site/getting-started.js"), "utf8");
  assert.match(gs, /vr-controls/);
  assert.match(gs, /vrControlsDocsIntroHtml|bindVrControlsDocs/);
});
