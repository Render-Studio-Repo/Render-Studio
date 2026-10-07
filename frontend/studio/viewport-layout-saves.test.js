import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureCurrentLayout,
  importLayoutIntoStore,
  layoutDiagramBoxes,
  layoutDiagramHtml,
  layoutSavesButtonHtml,
  layoutSavesPopupHtml,
  layoutImportDestinationHtml,
  mergeImportedLayout,
  parseViewportLayoutShareUrl,
  POPULAR_LAYOUT_TEMPLATES,
  serializeSplitTree,
  shortPaneLabel,
  sortLayoutsNewestFirst,
  splitStateFromTree,
  isQuadLayoutTree,
} from "./viewport-layout-saves.js";
import { createDocumentTabBar } from "./document-tabs.js";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "styles.css"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "app.js"), "utf8");
const tabsSrc = readFileSync(join(here, "document-tabs.js"), "utf8");
const shareViewer = readFileSync(join(here, "../viewport/share-viewer.js"), "utf8");
const shareHtml = readFileSync(join(here, "../pages/share.html"), "utf8");
const shop = readFileSync(join(here, "../marketplace/shopping-view.js"), "utf8");

test("serialize split tree maps left/right/up/down into diagram boxes", () => {
  const tabs = [
    { id: "__wiring__", kind: "wiring", label: "ViewPort Wiring" },
    { id: "__parts_list__", kind: "parts", label: "BOM Parts List" },
  ];
  const tree = serializeSplitTree({
    split: { direction: "right", docId: "__wiring__", ratio: 0.45 },
    tabs,
    viewportLabel: "Viewport",
  });
  assert.equal(tree.type, "split");
  assert.equal(tree.direction, "right");
  const boxes = layoutDiagramBoxes(tree);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].label, "Viewport");
  assert.equal(boxes[1].label, "Wiring");
  assert.ok(boxes[0].x < boxes[1].x);

  const up = layoutDiagramBoxes(serializeSplitTree({
    split: { direction: "up", docId: "__parts_list__", ratio: 0.4 },
    tabs,
  }));
  assert.equal(up[0].label, "Parts List");
  assert.equal(up[1].label, "Viewport");
  assert.ok(up[0].y < boxes[0].y + 0.01 || up[0].y <= up[1].y);
  assert.ok(up[0].y < up[1].y);

  const htmlThumb = layoutDiagramHtml(tree);
  assert.match(htmlThumb, /Viewport/);
  assert.match(htmlThumb, /Wiring/);
  assert.match(htmlThumb, /vp-layout-cell/);
});

test("import writes general settings without a space picker", async () => {
  const memory = { v: 1, layouts: [], extraLinks: [], lastId: "" };
  const api = async (path, options = {}) => {
    if (String(path).includes("/api/me/viewport-layouts") && options.method === "PUT") {
      Object.assign(memory, JSON.parse(options.body));
      return memory;
    }
    return memory;
  };
  const layout = {
    name: "Wiring + 3D",
    description: "Schematic beside the viewport",
    tree: serializeSplitTree({
      split: { direction: "left", docId: "board.json", ratio: 0.5 },
      tabs: [{ id: "board.json", kind: "wiring", label: "ViewPort Wiring" }],
    }),
    tabs: [{ id: "board.json", kind: "wiring", label: "ViewPort Wiring" }],
  };
  const saved = await importLayoutIntoStore(api, layout);
  assert.equal(saved.layouts.length, 1);
  assert.equal(saved.layouts[0].name, "Wiring + 3D");
  assert.equal(saved.layouts[0].tree.direction, "left");
  assert.equal(saved.lastId, saved.layouts[0].id);
  const merged = mergeImportedLayout(saved, saved.layouts[0]);
  assert.equal(merged.layouts.length, 1);
});

test("tab-strip layout button is always the last child", () => {
  const bar = { classList: { toggle() {} }, innerHTML: "", addEventListener() {}, querySelector() { return null; }, insertAdjacentHTML() {}, appendChild() {}, children: [] };
  const calls = [];
  bar.insertAdjacentHTML = (where, markup) => {
    calls.push({ where, markup });
    bar.innerHTML += markup;
  };
  const attrs = {};
  const main = { classList: { toggle() {}, contains() { return false; } }, setAttribute() {}, removeAttribute() {}, style: { setProperty() {} } };
  const prev = globalThis.document;
  globalThis.document = {
    getElementById: () => null,
    body: { classList: { contains: () => false } },
    addEventListener() {},
    querySelectorAll: () => [],
    createElement: () => ({ classList: { toggle() {} }, setAttribute() {}, addEventListener() {} }),
  };
  try {
    const tabs = createDocumentTabBar({ tabBarEl: bar, mainColumnEl: main });
    tabs.upsert({ id: "a", label: "3D Viewport", kind: "image" });
    tabs.upsert({ id: "__parts_list__", label: "BOM Parts List", kind: "parts" });
    assert.match(bar.innerHTML, /data-vp-layout-saves/);
    const buttonIndex = bar.innerHTML.lastIndexOf("data-vp-layout-saves");
    const lastTab = bar.innerHTML.lastIndexOf("data-doc-tab");
    assert.ok(buttonIndex > lastTab, "layout button must follow tab buttons");
    assert.match(tabsSrc, /data-vp-layout-saves/);
    assert.match(layoutSavesButtonHtml(), /Split view saves/);
  } finally {
    globalThis.document = prev;
  }
});

test("share URL shape is /share/{token} and cache-bust is wired", () => {
  assert.equal(parseViewportLayoutShareUrl("https://render3d.app/share/abc_TOKEN-1"), "abc_TOKEN-1");
  assert.equal(parseViewportLayoutShareUrl("/share/layoutTok"), "layoutTok");
  assert.match(app, /vplayout=20260916-1/);
  assert.match(html, /vplayout=20260916-1/);
  assert.match(css, /vplayout=20260916-1/);
  assert.match(app, /viewport-layout-saves\.js\?v=vplayout=20260916-1/);
  assert.match(app, /document-tabs\.js\?v=.*vplayout=20260916-1/);
  assert.match(app, /layui1/);
  assert.match(html, /layui1/);
  assert.match(css, /layui1/);
  assert.match(shareViewer, /viewport_layout/);
  assert.match(shareHtml, /share-layout-stage/);
  assert.match(shop, /viewport-layouts/);
  assert.match(app, /import_viewport_layout/);
  assert.equal(shortPaneLabel({ kind: "wiring", label: "ViewPort Wiring wahtever" }), "Wiring");
  const restored = splitStateFromTree(serializeSplitTree({
    split: { direction: "down", docId: "bom", ratio: 0.33 },
    tabs: [{ id: "bom", kind: "parts", label: "BOM" }],
  }));
  assert.equal(restored.direction, "down");
  assert.equal(restored.docId, "bom");
});

test("captureCurrentLayout reads live getSplit from the tab bar", () => {
  const fakeTabs = {
    list: () => [{ id: "wire", kind: "wiring", label: "ViewPort Wiring" }],
    getSplit: () => ({ direction: "left", docId: "wire", ratio: 0.4 }),
    getActive: () => ({ id: "wire", kind: "wiring" }),
  };
  const shot = captureCurrentLayout({ docTabs: fakeTabs, viewportLabel: "3D Viewport" });
  assert.equal(shot.tree.direction, "left");
  assert.equal(shot.tree.a.label, "Wiring");
  assert.equal(shot.tree.b.label, "Viewport");
});

test("layout browser stays compact and exposes saved, starter, store, import, and close actions", () => {
  const html = layoutSavesPopupHtml({
    name: "Mine",
    tree: serializeSplitTree({
      split: { direction: "right", docId: "__wiring__", ratio: 0.5 },
      tabs: [{ id: "__wiring__", kind: "wiring" }],
    }),
    layouts: [{ id: "old", name: "Older", createdAt: "2026-01-01T00:00:00Z" }, { id: "new", name: "Newer", createdAt: "2026-09-16T00:00:00Z" }],
  });
  assert.match(html, /vp-layout-logo/);
  assert.match(html, /Browse layouts/);
  assert.match(html, /vp-layout-browser/);
  assert.doesNotMatch(html, /vp-layout-gif/);
  assert.match(html, /data-vp-layout-search/);
  assert.match(html, /data-vp-layout-view="grid"/);
  assert.match(html, /My layouts/);
  assert.match(html, /Starter layouts/);
  assert.match(html, /data-vp-layout-reset/);
  assert.match(html, /Sam's Store/);
  assert.match(html, /Layout Store/);
  assert.match(html, /data-vp-layout-import-go/);
  assert.match(html, /\/share\/vpl-mcmaster-right/);
  assert.match(html, /\/share\/vpl-quad-left-down/);
  const sorted = sortLayoutsNewestFirst([
    { id: "a", updatedAt: "2026-01-01" },
    { id: "b", updatedAt: "2026-09-16" },
  ]);
  assert.equal(sorted[0].id, "b");
  assert.equal(shortPaneLabel({ kind: "mcmaster" }), "McMaster");
  assert.ok(POPULAR_LAYOUT_TEMPLATES.some((row) => row.token === "vpl-mcmaster-right"));
  assert.ok(POPULAR_LAYOUT_TEMPLATES.some((row) => row.token === "vpl-quad-left-down"));
});

test("import destination asks for Viewport or a named, optionally pinned project tab", () => {
  const html = layoutImportDestinationHtml({ id: "layout-a", name: "Robot inspection" });
  assert.match(html, /value="viewport" checked/);
  assert.match(html, /value="tab"/);
  assert.match(html, /data-vp-import-tab-name value="Robot inspection"/);
  assert.match(html, /data-vp-import-pin/);
  assert.match(html, /Use its × to return to the default/);
});

test("left + down serialize as a saveable quad tree", () => {
  const tree = serializeSplitTree({
    split: {
      direction: "left",
      docId: "__canvas__",
      ratio: 0.5,
      cross: { direction: "down", docId: "__wiring__", extraId: "__parts_list__", ratio: 0.5 },
    },
    tabs: [
      { id: "__canvas__", kind: "canvas", label: "Canvas" },
      { id: "__wiring__", kind: "wiring", label: "Wiring" },
      { id: "__parts_list__", kind: "parts", label: "Parts List" },
    ],
  });
  assert.equal(isQuadLayoutTree(tree), true);
  const boxes = layoutDiagramBoxes(tree);
  assert.equal(boxes.length, 4);
  const labels = boxes.map((box) => box.label).sort();
  assert.deepEqual(labels, ["Canvas", "Parts List", "Viewport", "Wiring"].sort());
  const state = splitStateFromTree(tree);
  assert.equal(state.direction, "left");
  assert.ok(state.cross?.direction);
  assert.equal(state.docId, "__canvas__");
  assert.equal(state.cross?.docId, "__wiring__");
  assert.equal(state.cross?.extraId, "__parts_list__");
  assert.equal(state.activeId, "__canvas__");

  const buildDesk = splitStateFromTree(
    POPULAR_LAYOUT_TEMPLATES.find((row) => row.token === "vpl-quad-left-down").tree,
  );
  assert.equal(buildDesk.docId, "__canvas__");
  assert.equal(buildDesk.cross?.docId, "__parts_list__");
  assert.equal(buildDesk.cross?.extraId, "__wiring__");
});

test("layout browser exposes reset, Sam's store, and supported quad presets", () => {
  const html = layoutSavesPopupHtml({ tree: POPULAR_LAYOUT_TEMPLATES[0].tree });
  assert.match(html, /data-vp-layout-reset/);
  assert.match(html, /Sam's Store/);
  assert.match(html, /My layouts/);
  assert.ok(POPULAR_LAYOUT_TEMPLATES.some((row) => row.token === "vpl-robot-ops-quad"));
  assert.ok(POPULAR_LAYOUT_TEMPLATES.some((row) => row.token === "vpl-cad-sourcing-quad"));
});
