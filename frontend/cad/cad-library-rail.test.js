import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAD_LIBRARIES,
  defaultCadDockState,
  readCadDockState,
  writeCadDockState,
  persistableCadDockState,
  collapseCadDockState,
  applyCadDockToggle,
  shouldIgnoreCadDockToggle,
  CAD_DOCK_TOGGLE_GUARD_MS,
  LS_CAD_DOCK,
  isCadDockPointerTarget,
  snapCadDockToBorder,
  nudgeCadDockOrder,
  setCadDockEdge,
  nextFreeDockAlong,
  layoutCadDockTabs,
  rangesOverlap,
  clampCadContextMenu,
  fitCadDockInView,
  cadExplorerLayout,
  applyCadExplorerChrome,
  fallbackHudSlots,
  rectsToEdgeSlots,
  BROWSER_TAB_FALLBACK,
  CAD_DOCK_TAB_SIZE,
  CAD_DOCK_EXPLORER_PREFERRED_WIDTH,
  CAD_DOCK_EXPLORER_TWO_PANE_MIN,
  CAD_EXPLORER_TWO_PANE_CLASS,
  CAD_EXPLORER_MODELS_PANE_DISPLAY,
  resolveCadLibraryId,
  cadDockMenuActions,
  armCadLibraryMove,
  shouldArmCadDockDrag,
  CAD_DOCK_MENU_Z,
} from "./cad-library-rail.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.html"), "utf8");

test("CAD rail has Onshape and Fusion chips", () => {
  assert.deepEqual(CAD_LIBRARIES.map((c) => c.id), ["onshape", "fusion"]);
  assert.ok(CAD_LIBRARIES.every((c) => c.sectionId && c.logo && c.openEvent));
  const chips = [...html.matchAll(/class="cad-library-chip"[^>]*data-cad="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(chips, ["onshape", "fusion"]);
  assert.equal(html.includes('data-cad="solidworks"'), false);
  assert.equal(html.includes("btn-solidworks-connect"), false);
  assert.equal(html.includes("solidworks-library-section"), false);
  assert.equal(html.includes("SolidWorks Library"), false);
});

test("dock state defaults to detached left tab under Browser", () => {
  const row = defaultCadDockState();
  assert.equal(row.attached, false);
  assert.equal(row.expanded, false);
  assert.equal(row.edge, "left");
  assert.equal(row.y, 96);
});

test("dock persistence round-trips attached edge", () => {
  const mem = {};
  const origGet = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => mem[k] ?? null,
    setItem: (k, v) => {
      mem[k] = String(v);
    },
  };
  try {
    writeCadDockState({
      fusion: { ...defaultCadDockState(), attached: true, edge: "right", y: 160 },
    });
    assert.ok(mem[LS_CAD_DOCK]);
    const next = readCadDockState();
    assert.equal(next.fusion.attached, true);
    assert.equal(next.fusion.edge, "right");
    assert.equal(next.fusion.y, 160);
    assert.equal(next.fusion.expanded, false);
    assert.equal(next.onshape.attached, false);
    assert.equal(next.solidworks, undefined);
  } finally {
    globalThis.localStorage = origGet;
  }
});

test("CAD dock chrome is recognized so the viewport wheel can skip it", () => {
  const tab = { nodeType: 1, closest: (sel) => (String(sel).includes(".cad-library-dock-tab") ? tab : null) };
  const mesh = { nodeType: 1, closest: () => null };
  assert.equal(isCadDockPointerTarget(tab), true);
  assert.equal(isCadDockPointerTarget(mesh), false);
});

test("Move tab snaps to the nearest viewport border", () => {
  const rect = { left: 0, top: 0, width: 800, height: 400 };
  assert.equal(snapCadDockToBorder(rect, 10, 200).edge, "left");
  assert.equal(snapCadDockToBorder(rect, 790, 200).edge, "right");
  assert.equal(snapCadDockToBorder(rect, 400, 8).edge, "top");
  assert.equal(snapCadDockToBorder(rect, 400, 390).edge, "bottom");
});

test("CAD tabs skip the Browser slot and never share a pixel stack", () => {
  const reserved = [BROWSER_TAB_FALLBACK];
  const first = nextFreeDockAlong({ preferred: 14, reserved });
  assert.ok(first >= BROWSER_TAB_FALLBACK.start + BROWSER_TAB_FALLBACK.size);
  assert.equal(rangesOverlap(first, CAD_DOCK_TAB_SIZE, BROWSER_TAB_FALLBACK.start, BROWSER_TAB_FALLBACK.size), false);
  const state = {
    fusion: { ...defaultCadDockState(), attached: true, edge: "left", y: 14 },
    onshape: { ...defaultCadDockState(), attached: true, edge: "left", y: 20 },
  };
  layoutCadDockTabs(state, { reserved });
  const ys = [state.fusion.y, state.onshape.y].sort((a, b) => a - b);
  assert.equal(rangesOverlap(ys[0], CAD_DOCK_TAB_SIZE, BROWSER_TAB_FALLBACK.start, BROWSER_TAB_FALLBACK.size), false);
  assert.equal(rangesOverlap(ys[0], CAD_DOCK_TAB_SIZE, ys[1], CAD_DOCK_TAB_SIZE), false);
});

test("CAD tabs skip bottom HUD and context menu flips into the window", () => {
  const hud = fallbackHudSlots(400, 800);
  assert.ok(hud.some((row) => row.edge === "bottom" && row.id === "hud-view-bar"));
  const slots = rectsToEdgeSlots(
    { left: 10, top: 360, width: 180, height: 36 },
    { left: 0, top: 0, width: 800, height: 400 },
    "camera",
  );
  assert.ok(slots.some((row) => row.edge === "bottom" || row.edge === "left"));
  const flipped = clampCadContextMenu(790, 390, { width: 220, height: 80, view: { width: 800, height: 400 } });
  assert.ok(flipped.left + 220 <= 800);
  assert.ok(flipped.top + 80 <= 400);
  assert.ok(flipped.left >= 8);
  assert.ok(flipped.top >= 8);
});

test("HUD fallback reserves AR/camera and ribbon so Fusion cannot sit on them", () => {
  const hud = fallbackHudSlots(400, 800);
  assert.ok(hud.some((row) => row.id === "hud-ar-camera" && row.edge === "left"));
  assert.ok(hud.some((row) => row.id === "hud-view-bar" && row.edge === "bottom"));
  const state = {
    fusion: { ...defaultCadDockState(), attached: true, edge: "left", y: 320 },
    onshape: { ...defaultCadDockState(), attached: false },
  };
  layoutCadDockTabs(state, { reserved: hud, span: 400, spanX: 800 });
  const along = state.fusion.edge === "top" || state.fusion.edge === "bottom"
    ? state.fusion.x
    : state.fusion.y;
  for (const row of hud.filter((slot) => slot.edge === state.fusion.edge)) {
    assert.equal(rangesOverlap(along, CAD_DOCK_TAB_SIZE, row.start, row.size), false);
  }
  assert.notEqual(state.fusion.edge === "left" && along >= 268, true);
});

test("right-click CAD menu flips into the visible window", () => {
  const low = clampCadContextMenu(20, 780, { width: 220, height: 88, view: { width: 400, height: 800, left: 0, top: 0 } });
  assert.ok(low.top + 88 <= 800);
  assert.ok(low.top >= 8);
  const right = clampCadContextMenu(390, 40, { width: 220, height: 88, view: { width: 400, height: 800, left: 0, top: 0 } });
  assert.ok(right.left + 220 <= 400);
});

test("desktop CAD explorer is wide enough for a two-pane models gallery", () => {
  assert.ok(CAD_DOCK_EXPLORER_PREFERRED_WIDTH >= 720);
  assert.ok(CAD_DOCK_EXPLORER_TWO_PANE_MIN >= 520);
  const desktop = cadExplorerLayout(1280);
  assert.equal(desktop.twoPane, true);
  assert.ok(desktop.width >= CAD_DOCK_EXPLORER_TWO_PANE_MIN);
  assert.equal(desktop.width, CAD_DOCK_EXPLORER_PREFERRED_WIDTH);
  assert.equal(desktop.modelsPaneHidden, false);
  assert.equal(desktop.modelsPaneDisplay, CAD_EXPLORER_MODELS_PANE_DISPLAY);
  assert.notEqual(desktop.modelsPaneDisplay, "none");
  const names = new Set();
  const el = {
    classList: {
      toggle(name, on) {
        if (on) names.add(name);
        else names.delete(name);
      },
    },
    style: {},
  };
  applyCadExplorerChrome(el, 1280);
  assert.equal(names.has(CAD_EXPLORER_TWO_PANE_CLASS), true);
  assert.equal(el.style.width, `${CAD_DOCK_EXPLORER_PREFERRED_WIDTH}px`);
});

test("narrow CAD explorer stacks panes but does not hide the models list", () => {
  const narrow = cadExplorerLayout(400);
  assert.equal(narrow.twoPane, false);
  assert.ok(narrow.width + 24 <= 400);
  assert.equal(narrow.modelsPaneHidden, false);
  assert.notEqual(narrow.modelsPaneDisplay, "none");
  const fitted = fitCadDockInView(
    { left: 8, top: 40, width: narrow.width, height: 360 },
    { view: { width: 400, height: 500 } },
  );
  assert.ok(fitted.left >= 8);
  assert.ok(fitted.left + narrow.width + 8 <= 400);
});

test("low Fusion tab opens menu and dock explorer above the tab", () => {
  const menu = clampCadContextMenu(24, 760, {
    width: 220,
    height: 200,
    view: { width: 400, height: 800, left: 0, top: 0 },
    anchor: { left: 8, top: 740, right: 52, bottom: 784 },
  });
  assert.ok(menu.top + 200 <= 800);
  assert.ok(menu.top < 740);
  const dock = fitCadDockInView(
    { left: 8, top: 720, width: 300, height: 360 },
    { view: { width: 720, height: 800 }, tab: { top: 740, bottom: 784 } },
  );
  assert.ok(dock.top + 360 <= 800);
  assert.ok(dock.top < 740);
});

test("CAD dock toggle opens once then closes; same-gesture click is ignored", () => {
  const state = {
    fusion: { ...defaultCadDockState(), attached: true, expanded: false },
    onshape: { ...defaultCadDockState(), attached: true, expanded: false },
  };
  applyCadDockToggle(state, "fusion");
  assert.equal(state.fusion.expanded, true);
  assert.equal(state.onshape.expanded, false);
  applyCadDockToggle(state, "fusion");
  assert.equal(state.fusion.expanded, false);
  applyCadDockToggle(state, "onshape");
  assert.equal(state.onshape.expanded, true);
  assert.equal(state.fusion.expanded, false);
  assert.equal(shouldIgnoreCadDockToggle(1016, 1000, CAD_DOCK_TOGGLE_GUARD_MS), true);
  assert.equal(shouldIgnoreCadDockToggle(1200, 1000, CAD_DOCK_TOGGLE_GUARD_MS), false);
  assert.equal(shouldIgnoreCadDockToggle(10, 0), false);
});

test("CAD dock persistence never restores an open explorer after refresh", () => {
  const mem = {};
  const origGet = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => mem[k] ?? null,
    setItem: (k, v) => {
      mem[k] = String(v);
    },
  };
  try {
    writeCadDockState({
      fusion: { ...defaultCadDockState(), attached: true, expanded: true },
      onshape: { ...defaultCadDockState(), attached: true, expanded: true },
    });
    const stored = JSON.parse(mem[LS_CAD_DOCK]);
    assert.equal(stored.fusion.expanded, false);
    assert.equal(stored.onshape.expanded, false);
    const next = readCadDockState();
    assert.equal(next.fusion.expanded, false);
    assert.equal(next.onshape.expanded, false);
    const leftover = persistableCadDockState({
      fusion: { ...defaultCadDockState(), attached: true, expanded: true },
      solidworks: { ...defaultCadDockState(), attached: true, expanded: true },
    });
    assert.equal(leftover.fusion.expanded, false);
    assert.equal(leftover.solidworks, undefined);
    const live = {
      fusion: { ...defaultCadDockState(), attached: true, expanded: true },
      onshape: { ...defaultCadDockState(), attached: true, expanded: true },
    };
    collapseCadDockState(live);
    assert.equal(live.fusion.expanded, false);
    assert.equal(live.onshape.expanded, false);
  } finally {
    globalThis.localStorage = origGet;
  }
});

test("expanded Fusion tab keeps its slot so the icon does not relocate", () => {
  const reserved = [BROWSER_TAB_FALLBACK];
  const collapsed = {
    fusion: { ...defaultCadDockState(), attached: true, expanded: false, edge: "left", y: 200, x: 12 },
    onshape: { ...defaultCadDockState(), attached: true, expanded: false, edge: "left", y: 260 },
  };
  const expanded = {
    fusion: { ...defaultCadDockState(), attached: true, expanded: true, edge: "left", y: 200, x: 12 },
    onshape: { ...defaultCadDockState(), attached: true, expanded: false, edge: "left", y: 260 },
  };
  layoutCadDockTabs(collapsed, { reserved, span: 720, spanX: 1100 });
  layoutCadDockTabs(expanded, { reserved, span: 720, spanX: 1100 });
  assert.equal(expanded.fusion.edge, collapsed.fusion.edge);
  assert.equal(expanded.fusion.y, collapsed.fusion.y);
  assert.equal(rangesOverlap(expanded.fusion.y, CAD_DOCK_TAB_SIZE, expanded.onshape.y, CAD_DOCK_TAB_SIZE), false);
});

test("nudgeCadDockOrder and setCadDockEdge keep attached tabs on an edge", () => {
  const state = {
    onshape: { ...defaultCadDockState(), attached: true, edge: "left", order: 1 },
    fusion: { ...defaultCadDockState(), attached: true, edge: "left", order: 2 },
  };
  nudgeCadDockOrder(state, "fusion", -1);
  assert.equal(state.fusion.order, 1);
  assert.equal(state.onshape.order, 2);
  setCadDockEdge(state, "fusion", "top");
  assert.equal(state.fusion.edge, "top");
  assert.equal(state.onshape.edge, "left");
});

test("Onshape and Fusion share the same Move tab menu path", () => {
  assert.deepEqual(cadDockMenuActions(true).map((row) => row.id), ["move", "detach"]);
  assert.deepEqual(cadDockMenuActions(false).map((row) => row.id), ["attach"]);
  assert.equal(resolveCadLibraryId("Onshape"), "onshape");
  assert.equal(resolveCadLibraryId("fusion"), "fusion");
  assert.equal(resolveCadLibraryId("solidworks"), "");
  assert.ok(CAD_DOCK_MENU_Z > 10050);
  for (const id of ["onshape", "fusion"]) {
    const next = armCadLibraryMove(persistableCadDockState(), id);
    assert.equal(next.movingCadId, id);
    assert.equal(next.state[id].attached, true);
    assert.equal(shouldArmCadDockDrag(next.movingCadId, id, 0), true);
    assert.equal(shouldArmCadDockDrag(next.movingCadId, id, 2), false);
    assert.equal(shouldArmCadDockDrag("", id, 0), false);
  }
  assert.equal(armCadLibraryMove(persistableCadDockState(), "nope").movingCadId, "");
});

test("Onshape explorer copies Fusion two-pane chrome and thumbnail grid", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../studio/styles.css"), "utf8");
  assert.match(html, /id="onshape-library-section"/);
  assert.match(html, /data-onshape-panel="browse"/);
  assert.match(html, /class="onshape-library-controls"/);
  assert.match(html, /class="onshape-doc-list"/);
  assert.match(html, /id="btn-onshape-connect"/);
  assert.equal(html.includes('data-cad="solidworks"'), false);
  assert.match(css, /cad-library-explorer--two-pane #onshape-library-section/);
  assert.match(css, /minmax\(240px, 300px\) minmax\(0, 1fr\)/);
  assert.match(css, /data-onshape-panel="browse"/);
  assert.match(css, /#onshape-library-section \.onshape-doc-list/);
  assert.match(css, /grid-row: 1 \/ span 16/);
  assert.equal(CAD_DOCK_EXPLORER_PREFERRED_WIDTH, 780);
});

test("leftover expanded Fusion dock does not walk hubs during boot", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cad-library-rail.js"), "utf8");
  const init = src.slice(src.lastIndexOf("bindDockDrag();"));
  assert.match(init, /renderDock\(\{ persistExpanded: false \}\)/);
  assert.match(init, /render3d:studio-ready/);
  assert.match(init, /notifyExpandedAfterBoot/);
});
