import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_LAYOUT_KEY,
  CATALOG_MENU_IDS,
  defaultCatalogLayout,
  parseCatalogLayout,
  loadCatalogLayout,
  saveCatalogLayout,
  supplierSearchUrl,
  loadPartsSearchHistory,
  savePartsSearchHistory,
} from "./catalog-panel.js";

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, "catalog-panel.js"), "utf8");
const assist = readFileSync(join(here, "../studio/design-assistance.js"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");

test("catalog search aborts the previous catalog GET", () => {
  assert.match(panel, /let catalogSearchAbort = null; \/\/ leakfix64/);
  assert.match(panel, /async function search\(\{ query, category, heading \} = \{\}\)[\s\S]{0,1200}signal: ctl\.signal/);
});

test("parts list open aborts the previous parts GET", () => {
  assert.match(assist, /let partsListAbort = null; \/\/ leakfix84/);
  assert.match(assist, /async function openParts\(initialTab, host = null\)[\s\S]{0,1600}signal: ctl\.signal/);
  assert.match(app, /leakfix84/);
});

test("catalog tabs include My Parts List plus existing browse and McMaster", () => {
  assert.deepEqual(CATALOG_MENU_IDS, ["parts", "mcmaster", "list"]);
  assert.match(panel, /data-catalog-menu="parts">Browse parts/);
  assert.match(panel, /data-catalog-menu="mcmaster">McMaster-Carr/);
  assert.match(panel, /data-catalog-menu="list">My Parts List/);
});

test("catalog split toggle sits on the tab bar and uses a drag gutter", () => {
  assert.match(panel, /class="catalog-menu-tab catalog-split-toggle"/);
  assert.match(panel, /Show My Parts List beside another catalog tab/);
  assert.match(panel, /catalog-split-gutter/);
  assert.match(panel, /function setSplit/);
  assert.match(css, /\.catalog-panel--split/);
  assert.match(css, /\.catalog-split-gutter/);
  assert.match(css, /--catalog-split-left/);
});

test("catalog parts list reuses the BOM renderer instead of cloning markup", () => {
  assert.match(panel, /render:open-parts/);
  assert.match(panel, /detail: \{ tab: "home", host: partsHost \}/);
  assert.match(assist, /e\.detail\?\.host \|\| null/);
  assert.match(assist, /async function openParts\(initialTab, host = null\)/);
  assert.match(assist, /Home.*Electronics.*McMaster.*Mechanical.*Follow-up questions/s);
  assert.match(assist, /partImageUrl|thumbnail_url/);
  assert.doesNotMatch(panel, /Follow-up questions/);
});

test("catalog layout split preference persists", () => {
  assert.equal(CATALOG_LAYOUT_KEY, "render3d:catalog-layout:v1");
  assert.deepEqual(defaultCatalogLayout(), { split: false, ratio: 0.5, catalogTab: "parts" });
  assert.equal(parseCatalogLayout({ split: true, ratio: 0.4, catalogTab: "mcmaster" }).split, true);
  assert.equal(parseCatalogLayout({ split: true, ratio: 0.4, catalogTab: "mcmaster" }).catalogTab, "mcmaster");
  assert.equal(parseCatalogLayout({ split: true, ratio: 0.05 }).ratio, 0.28);
  assert.equal(parseCatalogLayout("nope").split, false);
  const storage = new Map();
  const fake = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const saved = saveCatalogLayout({ split: true, ratio: 0.6, catalogTab: "mcmaster" }, fake);
  assert.equal(saved.split, true);
  assert.deepEqual(loadCatalogLayout(fake), saved);
});

test("catlists cache token stays with existing bust tokens", () => {
  assert.match(app, /catlists=20260916-1/);
  assert.match(html, /catlists=20260916-1/);
  assert.match(app, /vidclose2=20260916-1/);
  assert.match(html, /vidclose2=20260916-1/);
  assert.match(app, /stopshare=20260916-1/);
  assert.match(html, /stopshare=20260916-1/);
  assert.match(html, /noswipe=20260916-1/);
  assert.match(html, /sharex=20260916-1/);
  assert.match(assist, /partthumb=20260916-1/);
  assert.match(assist, /mcmthumb1/);
  assert.match(assist, /amazon1/);
});

test("supplier searches encode exact queries and history can be managed", () => {
  assert.equal(supplierSearchUrl("walmart", "M3 × 12 screw"), "https://www.walmart.com/search?q=M3%20%C3%97%2012%20screw");
  assert.match(supplierSearchUrl("mcmaster", "91251A194"), /91251A194$/);
  assert.equal(supplierSearchUrl("unknown", "bolt"), "");
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  assert.deepEqual(savePartsSearchHistory(["bolt", "nut", "bolt"], storage), ["bolt", "nut"]);
  assert.deepEqual(loadPartsSearchHistory(storage), ["bolt", "nut"]);
  assert.deepEqual(loadPartsSearchHistory({ getItem: () => "broken" }), []);
});
