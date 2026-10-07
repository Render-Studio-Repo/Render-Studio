import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DESIGN_RIBBON_TAB_IDS, WIRING_TABS } from "./workspace-modes.js";

const here = dirname(fileURLToPath(import.meta.url));

test("CAD design ribbon tab order omits Sketch Electronics Insert Rigging Architect", () => {
  assert.deepEqual(DESIGN_RIBBON_TAB_IDS, [
    "SOLID",
    "ROBOTICS",
    "CATALOG",
    "TEXTURE",
    "CANVAS",
    "EDITOR",
  ]);
  const src = readFileSync(join(here, "workspace-modes.js"), "utf8");
  const start = src.indexOf("export const DESIGN_RIBBON_TAB_IDS");
  const end = src.indexOf("const DESIGN_TABS");
  const block = src.slice(start, end);
  assert.ok(!block.includes("SKETCH"));
  assert.ok(!block.includes("ELECTRONICS"));
  assert.ok(!block.includes("INSERT"));
  assert.ok(!block.includes("RIGGING"));
  assert.ok(!block.includes("ARCHITECT"));
  assert.equal(DESIGN_RIBBON_TAB_IDS.indexOf("ROBOTICS"), DESIGN_RIBBON_TAB_IDS.indexOf("SOLID") + 1);
  assert.equal(DESIGN_RIBBON_TAB_IDS.indexOf("WORKSPACE"), -1);
  assert.equal(DESIGN_RIBBON_TAB_IDS.indexOf("RIGGING"), -1);
  assert.equal(DESIGN_RIBBON_TAB_IDS.indexOf("ARCHITECT"), -1);
  assert.match(src, /CATALOG: "Parts Catalog"/);
  assert.match(src, /REMOVED_DESIGN_RIBBON_TABS = new Set\(\["ELECTRONICS", "RIGGING", "ARCHITECT", "WORKSPACE"\]\)/);
  assert.match(src, /hidden: true/);
  assert.match(src, /if \(m\.hidden\) continue/);
});

test("designTab query maps removed ribbon tabs to SOLID", () => {
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(app, /\["SKETCH", "ELECTRONICS", "RIGGING", "ARCHITECT"\]\.includes\(tab\)/);
  assert.match(app, /setDesignTab\("SOLID"\)/);
  assert.match(
    app,
    /\["SOLID", "WORKSPACE", "ROBOTICS", "CANVAS", "INSERT", "CATALOG", "TEXTURE"\]\.includes\(tab\)/,
  );
});

test("Parts Catalog menu hosts McMaster load and STEP manager", () => {
  const panel = readFileSync(join(here, "../components/catalog-panel.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(panel, /aria-label="Parts Catalog"/);
  assert.match(panel, /data-catalog-menu="mcmaster"/);
  assert.match(panel, /data-catalog-menu="list"/);
  assert.match(panel, /My Parts List/);
  assert.match(panel, /catalog-split-toggle/);
  assert.match(panel, /CATALOG_LAYOUT_KEY/);
  assert.match(panel, /data-catalog-mcmaster-load/);
  assert.match(panel, /data-catalog-mcmaster-steps/);
  assert.match(panel, /Load McMaster-Carr/);
  assert.match(panel, /Manage STEP files/);
  assert.match(app, /onLoadMcMaster/);
  assert.match(app, /openStepManager/);
  assert.equal(app.includes('openMobileDesignTab("INSERT")'), false);
  assert.match(html, /Parts Catalog<small>McMaster<\/small>/);
});

test("wiring workbench replaces Texture with Parts list and keeps Parts Catalog", () => {
  assert.deepEqual(WIRING_TABS.map((tab) => tab.id), [
    "WIRING",
    "ELECTRONICS",
    "ROBOTICS",
    "CATALOG",
    "PARTS_LIST",
  ]);
  assert.equal(WIRING_TABS.some((tab) => tab.id === "TEXTURE"), false);
  assert.equal(WIRING_TABS.find((tab) => tab.id === "CATALOG")?.label, "Parts Catalog");
  assert.equal(WIRING_TABS.find((tab) => tab.id === "PARTS_LIST")?.label, "Parts list");
  assert.ok(DESIGN_RIBBON_TAB_IDS.includes("TEXTURE"));
  assert.ok(DESIGN_RIBBON_TAB_IDS.includes("CATALOG"));
});

test("design ribbon stays one row and Pick host is unchanged", () => {
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  const ribbon = readFileSync(join(here, "../studio/ribbon.css"), "utf8");
  const tabs = css.slice(css.indexOf(".workspace-tabs {"), css.indexOf(".workspace-tab {"));
  assert.match(tabs, /flex-wrap:\s*nowrap/);
  assert.match(ribbon, /#app\.solid-design-tab \.ribbon-pick-host/);
  assert.match(ribbon, /\.ribbon-pick-host/);
});

test("SOLID ribbon hides Create Modify Pattern Export and primitive strip", () => {
  const js = readFileSync(join(here, "../studio/ribbon.js"), "utf8");
  const css = readFileSync(join(here, "../studio/ribbon.css"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.match(js, /const SOLID_RIBBON_UI_CATALOG = \{\}/);
  assert.match(js, /_mountCatalog\(SOLID_RIBBON_UI_CATALOG\)/);
  assert.match(js, /_tabBtns\?\.forEach/);
  assert.match(js, /id: "box"/);
  assert.match(js, /create-primitive|viewportTool: "create_box"/);
  assert.match(css, /\.ribbon-bar--no-tool-chrome \.ribbon-tabs/);
  assert.match(css, /\.ribbon-bar--no-tool-chrome \.ribbon-body/);
  const skelStart = html.indexOf("ribbon-skeleton");
  const skelEnd = html.indexOf("</div>", html.indexOf("ribbon-tabs", skelStart));
  const skel = html.slice(skelStart, skelEnd);
  assert.ok(!/\bCreate\b/.test(skel));
  assert.ok(!/\bModify\b/.test(skel));
  assert.ok(!/\bPattern\b/.test(skel));
  assert.match(app, /ribbon\.js\?v=20260908-solidhide1/);
  assert.match(html, /ribbon\.css\?v=20260908-solidhide1/);
  assert.match(html, /app\.js\?v=[^"']*20260908-/);
});
