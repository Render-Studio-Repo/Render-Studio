import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyWiringPartBucket,
  filterWiringParts,
  shiftSelectIds,
  applyListSelection,
  idsInMarquee,
  normalizeMarquee,
  parseWiringPartsFilters,
  catalogCandidateToPart,
  electronicsItemToPart,
} from "./wiring-parts-list.js";

const here = dirname(fileURLToPath(import.meta.url));

test("wiring Parts list tab replaces Texture and keeps CAD Texture plus Parts Catalog", () => {
  const modes = readFileSync(join(here, "../workspace/workspace-modes.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(modes, /id: "PARTS_LIST", label: "Parts list"/);
  assert.match(modes, /"TEXTURE"/);
  const wiringStart = modes.indexOf("export const WIRING_TABS");
  const wiringEnd = modes.indexOf("export function createWorkspaceModes");
  const wiring = modes.slice(wiringStart, wiringEnd);
  assert.match(wiring, /PARTS_LIST/);
  assert.equal(wiring.includes("TEXTURE"), false);
  assert.match(wiring, /CATALOG/);
  assert.match(app, /tab === "PARTS_LIST"/);
  assert.match(app, /openWiringPartsListTab/);
  assert.match(app, /texturePanel\?\.open\?\.\(\)/);
  assert.match(html, /id="wiring-parts-list-panel"/);
  assert.match(html, /data-wiring-parts-filter="models"/);
  assert.match(html, /data-wiring-parts-filter="mcmaster"/);
  assert.match(html, /data-wiring-parts-filter="electronics"/);
  assert.match(html, /id="wiring-parts-picker-fs"/);
  assert.match(html, /id="wiring-parts-list-fs"/);
  assert.match(html, /id="wiring-parts-picker-send"/);
  assert.match(html, /id="wiring-parts-picker-send-all"/);
  assert.match(html, /id="wiring-parts-list-send"/);
  assert.match(html, /id="wiring-parts-list-send-all"/);
  assert.match(html, /camtab1/);
  assert.match(html, /code1/);
});

test("filters classify McMaster vs electronics vs models and honor toggles", () => {
  const parts = [
    classifyRow({ id: "a.glb", label: "cylinder.glb", filename: "cylinder.glb" }, {}),
    classifyRow({ id: "91290A115.glb", label: "SHCS", filename: "91290A115.glb" }, { isMcMaster: () => true }),
    classifyRow({ id: "nano.glb", label: "Arduino Nano", filename: "nano.glb" }, { isElectronics: () => true }),
  ];
  assert.deepEqual(parts.map((p) => p.bucket), ["models", "mcmaster", "electronics"]);
  assert.equal(filterWiringParts(parts, { models: true, mcmaster: false, electronics: false }).length, 1);
  assert.equal(filterWiringParts(parts, { models: false, mcmaster: true, electronics: true }, "nano")[0].id, "nano.glb");
  assert.equal(filterWiringParts(parts, { models: false, mcmaster: false, electronics: false }).length, 0);
});

test("shift-click and marquee select ids without GPU", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(shiftSelectIds(ids, "b", "d"), ["b", "c", "d"]);
  const toggled = applyListSelection(new Set(["a"]), "c", ids, { toggle: true }, "a");
  assert.deepEqual([...toggled.selected].sort(), ["a", "c"]);
  const replaced = applyListSelection(new Set(["a", "c"]), "b", ids, { replace: true }, "c");
  assert.deepEqual([...replaced.selected], ["b"]);
  const marquee = normalizeMarquee({ x: 10, y: 10 }, { x: 80, y: 40 });
  const hits = idsInMarquee([
    { id: "a", rect: { left: 0, top: 0, right: 20, bottom: 20 } },
    { id: "b", rect: { left: 50, top: 15, right: 70, bottom: 35 } },
    { id: "c", rect: { left: 200, top: 200, right: 220, bottom: 220 } },
  ], marquee);
  assert.deepEqual(hits, ["a", "b"]);
});

test("catalog and electronics extras map to prompt-ready parts", () => {
  const catalog = catalogCandidateToPart({ name: "M3 screw", id: "91290A115", png_url: "/p.png", datasheet_url: "https://example.com" });
  assert.equal(catalog.bucket, "mcmaster");
  assert.equal(catalog.origin, "catalog");
  assert.equal(catalog.thumbUrl, "/p.png");
  const elec = electronicsItemToPart({ id: "cad:nano.glb", label: "Arduino Nano", filename: "nano.glb", kind: "Arduino", type: "arduino-uno" });
  assert.equal(elec.bucket, "electronics");
  assert.equal(elec.filename, "nano.glb");
  assert.deepEqual(parseWiringPartsFilters({ models: false }), { models: false, mcmaster: true, electronics: true });
});

function classifyRow(part, predicates) {
  return { ...part, bucket: classifyWiringPartBucket(part, predicates), id: part.id };
}
