import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VIEWPORT_SHELL,
  VIEWPORT_TAB_ID,
  WIRING_TAB_ID,
  CANVAS_TAB_ID,
  ROBOTICS_HOME_TAB_ID,
  buildShellTabStrip,
  createDocumentTabBar,
  kindBadge,
  shouldHideViewportForShell,
  shouldShowViewportChip,
  shellKindFromTab,
  revealViewportEl,
  isWiringDiagramReference,
  splitDocIdForTab,
  isOrthogonalSplit,
} from "./document-tabs.js";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "styles.css"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "app.js"), "utf8");

const docs = [
  { id: "shot.png", label: "shot", kind: "image" },
  { id: "spec.pdf", label: "spec", kind: "pdf" },
  { id: "mcmaster:catalog", label: "McMaster-Carr", kind: "mcmaster" },
];

test("Viewport chip is hidden while the 3D shell is active", () => {
  assert.equal(shouldShowViewportChip(null), false);
  assert.equal(shellKindFromTab(null), VIEWPORT_SHELL);
  const strip = buildShellTabStrip(docs, null);
  assert.equal(strip[0].id, VIEWPORT_TAB_ID);
  assert.deepEqual(strip.slice(0, 4).map((t) => t.kind), ["viewport", "robotics-home", "workshop", "approvals"]);
  assert.equal(strip[0].active, true);
});

test("Viewport chip appears only after swapping to a document tab", () => {
  assert.equal(shouldShowViewportChip("spec.pdf"), true);
  const strip = buildShellTabStrip(docs, "spec.pdf");
  assert.equal(strip[0].id, VIEWPORT_TAB_ID);
  assert.equal(strip[0].kind, VIEWPORT_SHELL);
  assert.equal(strip[0].closable, false);
  assert.equal(strip[0].active, false);
  assert.equal(strip.find((t) => t.id === "spec.pdf")?.active, true);
  assert.equal(kindBadge("image"), "IMG");
  assert.equal(kindBadge("pdf"), "PDF");
  assert.equal(kindBadge("mcmaster"), "MC");
  assert.equal(kindBadge("wiring"), "WIRE");
  assert.equal(kindBadge("json"), "JSON");
  assert.equal(kindBadge("code"), "CODE");
  assert.equal(kindBadge("code-project"), "CODE");
  assert.equal(kindBadge("spreadsheet"), "XLS");
  assert.equal(kindBadge("audio"), "AUD");
  assert.equal(kindBadge("simulation"), "SIM");
  assert.equal(shellKindFromTab({ kind: "pdf" }), "pdf");
});

test("imported viewport layouts are closable and pinned layout tabs hide their x", () => {
  const viewport = buildShellTabStrip([], null, { viewportLayoutActive: true });
  assert.equal(viewport[0].closable, true);
  const strip = buildShellTabStrip([
    { id: "viewport-layout:a", label: "Pinned plan", kind: "viewport-layout", pinned: true },
    { id: "viewport-layout:b", label: "Draft plan", kind: "viewport-layout", pinned: false },
  ], "viewport-layout:a");
  assert.equal(strip.find((tab) => tab.id === "viewport-layout:a")?.closable, false);
  assert.equal(strip.find((tab) => tab.id === "viewport-layout:b")?.closable, true);
  assert.equal(shouldHideViewportForShell("viewport-layout"), false);
});

test("studio tab strip sits above viewers and shifts the browser", () => {
  assert.match(css, /\.dxf-tab-bar\s*\{[^}]*z-index:\s*48/);
  assert.match(css, /\.main-column\.doc-tabs-open \.viewport-browser-panel/);
  assert.match(css, /#viewport \.dxf-tab-bar/);
  assert.match(css, /\.main-column\[data-shell-tab="viewport"\] #viewport/);
  assert.match(html, /id="doc-tab-bar"/);
  assert.match(html, /aria-label="Studio views"/);
  assert.match(html, /data-shell-tab="viewport"/);
  assert.match(html, /20260909-viewtabs/);
  assert.match(html, /20260909-vp-load/);
  assert.match(app, /document-tabs\.js\?v=20260909-viewtabs-20260909-vp-load-20260914-roboticsviser3/);
  assert.match(app, /shouldRevealViewportShellAfterBoot/);
  assert.match(app, /function revealDesktopProjectViewport/);
  assert.match(app, /if \(mode !== "wiring"\) revealDesktopProjectViewport|if \(!xrLiveOpen && mode !== "wiring"\) revealDesktopProjectViewport/);
});

test("viewport tabs can be renamed, pinned, and split from a right-click menu", () => {
  const src = readFileSync(join(here, "document-tabs.js"), "utf8");
  assert.match(src, /contextmenu/);
  assert.match(src, /Pin to viewport/);
  assert.match(src, /Unpin from viewport/);
  assert.match(src, /Split Up/);
  assert.match(src, /Split Left/);
  assert.match(src, /Split Down/);
  assert.match(src, /Split Right/);
  assert.match(src, /Unsplit/);
  assert.match(src, /beginRename/);
  assert.match(src, /dxf-tab-context-menu/);
  assert.match(src, /restorePinnedTabs/);
  assert.match(css, /\.dxf-tab--pinned/);
  assert.match(css, /\.dxf-tab-context-menu/);
  assert.match(css, /\.main-column\.viewport-doc-split\[data-split-dir="right"\]/);
  assert.match(css, /#viewport-doc-split-gutter/);
  assert.match(css, /wiresplit=20260916-1/);
  assert.match(html, /wiresplit=20260916-1/);
  assert.match(app, /wiresplit=20260916-1/);
  assert.match(app, /mcmtab1/);
  assert.match(app, /mcmtype1/);
  assert.match(app, /mcmui2/);
  assert.match(css, /mcmtab1/);
  assert.match(css, /mcmtype1/);
  assert.match(css, /cansplit=20260916-1/);
  assert.match(html, /cansplit=20260916-1/);
  assert.match(app, /cansplit=20260916-1/);
  assert.match(app, /syncSplitPanelRetract/);
  assert.match(app, /openWiringDiagramTab/);
  assert.match(app, /isWiringDiagramReference/);
  const strip = buildShellTabStrip(
    [{ id: "board", label: "Canvas", kind: "canvas", pinned: true, customLabel: "My board" }],
    "board",
  );
  assert.equal(strip.find((t) => t.id === "board")?.pinned, true);
  assert.equal(strip.find((t) => t.id === "board")?.closable, false);
  assert.equal(strip.find((t) => t.id === "board")?.label, "My board");
  assert.equal(strip[0].id, VIEWPORT_TAB_ID);
});

test("canvas save hint popup uses a valid UTF-8 studio asset route", () => {
  const svg = readFileSync(join(here, "../assets/studio/canvas-save-hint.svg"), "utf8");
  assert.match(html, /src="\/assets\/studio\/canvas-save-hint\.svg\?v=20260914-canvashint2-20260915-canvasperf1"/);
  assert.match(svg, /Reference Files/);
  assert.match(svg, /references\/Canvas\/My board\//);
});

test("record done hint popup uses a labeled timeline studio asset", () => {
  const svg = readFileSync(join(here, "../assets/studio/record-done-hint.svg"), "utf8");
  const gif = readFileSync(join(here, "../assets/studio/record-done-hint.gif"));
  assert.match(html, /src="\/assets\/studio\/record-done-hint\.gif\?v=20260915-gifbtn1/);
  assert.equal(svg.includes("\u0000") || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(svg), false);
  assert.match(svg, />Share</);
  assert.match(svg, />GIF</);
  assert.match(svg, /AI film edit/);
  assert.equal(gif.subarray(0, 6).toString("ascii"), "GIF89a");
  const gifW = gif.readUInt16LE(6);
  const gifH = gif.readUInt16LE(8);
  assert.equal(gifW, 720);
  assert.ok(gifH >= 160, `hint GIF height ${gifH}`);
});

test("viewport hide is only for an active document shell", () => {
  assert.equal(shouldHideViewportForShell(VIEWPORT_SHELL), false);
  assert.equal(shouldHideViewportForShell(null), false);
  assert.equal(shouldHideViewportForShell("pdf"), true);
  assert.equal(shouldHideViewportForShell("clip"), true);
  assert.equal(shouldHideViewportForShell("wiring"), true);
  assert.equal(shouldHideViewportForShell("wiring", { viewportSplit: true }), false);
  assert.equal(shouldHideViewportForShell("pdf", { presenting: true }), false);
  assert.equal(shouldHideViewportForShell("viser", { layout: "split" }), false);
  assert.equal(shouldHideViewportForShell("viser", { layout: "cad" }), false);
  assert.equal(shouldHideViewportForShell("viser", { layout: "viser" }), true);
});

test("wiring schematic reference files open the wiring diagram tab", () => {
  assert.equal(isWiringDiagramReference({ format: "wiring", name: "Circuit layout" }), true);
  assert.equal(isWiringDiagramReference({ name: "wiring.json" }), true);
  assert.equal(isWiringDiagramReference({ filename: "schematic.json" }), true);
  assert.equal(isWiringDiagramReference({ name: "pi-wiring.json", folder: "Electronics wiring" }), true);
  assert.equal(isWiringDiagramReference({ name: "notes.md", folder: "Electronics wiring" }), false);
  assert.equal(isWiringDiagramReference({ name: "shot.png" }), false);
  assert.equal(WIRING_TAB_ID, "__wiring__");
  assert.equal(splitDocIdForTab("__viewport__", { activeId: "__wiring__", tabIds: ["__wiring__"] }), "__wiring__");
  assert.equal(splitDocIdForTab("__wiring__", { activeId: null, tabIds: ["__wiring__"] }), "__wiring__");
  assert.equal(splitDocIdForTab("__viewport__", { activeId: null, tabIds: [] }), null);
});

test("boot tab bar sets data-shell-tab=viewport and does not hide #viewport", () => {
  const flags = {};
  const viewport = {
    classList: {
      toggle(name, on) { flags[name] = !!on; },
      remove(...names) { for (const n of names) flags[n] = false; },
    },
    style: { visibility: "" },
    hidden: false,
  };
  const attrs = {};
  const main = {
    classList: { toggle() {}, contains() { return false; } },
    setAttribute(k, v) { attrs[k] = v; },
  };
  const bar = { classList: { toggle() {} }, innerHTML: "", addEventListener() {} };
  const prev = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === "viewport" ? viewport : null),
    body: { classList: { contains: () => false } },
  };
  try {
    const tabs = createDocumentTabBar({ tabBarEl: bar, mainColumnEl: main });
    assert.equal(attrs["data-shell-tab"], VIEWPORT_SHELL);
    assert.equal(flags["doc-viewer-active"], false);
    tabs.upsert({ id: "shot.png", label: "shot", kind: "image" });
    assert.equal(attrs["data-shell-tab"], VIEWPORT_SHELL);
    assert.equal(flags["doc-viewer-active"], false);
    tabs.setActive("shot.png", { notify: false });
    assert.equal(attrs["data-shell-tab"], "image");
    assert.equal(flags["doc-viewer-active"], true);
    tabs.deactivate({ notify: false });
    assert.equal(attrs["data-shell-tab"], VIEWPORT_SHELL);
    assert.equal(flags["doc-viewer-active"], false);
  } finally {
    globalThis.document = prev;
  }
});

test("returning to Viewport hides editor overlays and restores the 3D canvas", () => {
  const viewport = {
    classList: { names: new Set(["doc-viewer-active", "hidden"]), remove(...names) { for (const n of names) this.names.delete(n); } },
    style: { visibility: "hidden", display: "none" },
    hidden: true,
    removeAttribute(name) { if (name === "hidden") this.hidden = false; },
  };
  revealViewportEl(viewport);
  assert.equal(viewport.hidden, false);
  assert.equal(viewport.style.visibility, "");
  assert.equal(viewport.style.display, "");
  assert.equal(viewport.classList.names.has("doc-viewer-active"), false);
  assert.match(css, /\.main-column\[data-shell-tab="viewport"\] #canvas-workspace/);
  assert.match(css, /\.main-column\[data-shell-tab="viewport"\] #viewport-video-share-modal/);
  assert.match(css, /\.main-column\[data-shell-tab="viewport"\] > \.project-code/);
  assert.match(app, /function restoreStudioViewportAfterEditor/);
  assert.match(app, /restoreStudioViewportAfterEditor\(\)/);
  assert.match(app, /shouldReloadViewportProject/);
  assert.match(app, /recoverDesktopMeshesAfterWebgl\(\{ reload: true \}\)/);
  assert.match(app, /vpwhite1/);
});

test("Viewport chip notifies restore even when already on the 3D shell", () => {
  let n = 0;
  const viewport = {
    classList: { toggle() {}, remove() {} },
    style: { visibility: "" },
    hidden: false,
  };
  const main = {
    classList: { toggle() {}, contains() { return false; } },
    setAttribute() {},
  };
  const bar = { classList: { toggle() {} }, innerHTML: "", addEventListener() {} };
  const prev = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === "viewport" ? viewport : null),
    body: { classList: { contains: () => false } },
  };
  try {
    const tabs = createDocumentTabBar({ tabBarEl: bar, mainColumnEl: main });
    tabs.onActivate((tab) => { if (!tab) n += 1; });
    tabs.deactivate({ notify: true });
    tabs.deactivate({ notify: true });
    assert.equal(n, 2);
  } finally {
    globalThis.document = prev;
  }
});

test("right-click split docks a document beside the 3D viewport", () => {
  const attrs = {};
  const classes = new Set();
  const viewport = {
    classList: { toggle() {}, remove() {} },
    style: { visibility: "" },
    hidden: false,
  };
  const pane = { classList: { names: new Set(), add(n) { this.names.add(n); }, remove(n) { this.names.delete(n); } } };
  const main = {
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
      remove(name) { classes.delete(name); },
    },
    style: { setProperty() {} },
    setAttribute(k, v) { attrs[k] = v; },
    removeAttribute(k) { delete attrs[k]; },
  };
  const bar = { classList: { toggle() {} }, innerHTML: "", addEventListener() {} };
  const prev = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === "viewport" ? viewport : null),
    querySelectorAll: () => [],
    body: { classList: { contains: () => false, add() {}, remove() {} } },
  };
  try {
    const tabs = createDocumentTabBar({
      tabBarEl: bar,
      mainColumnEl: main,
      resolveSplitPane: () => pane,
    });
    tabs.upsert({ id: WIRING_TAB_ID, label: "Wiring", kind: "wiring" });
    assert.equal(tabs.split("right", WIRING_TAB_ID), true);
    assert.deepEqual(tabs.getSplit(), { direction: "right", docId: WIRING_TAB_ID, ratio: tabs.getSplit().ratio });
    assert.equal(attrs["data-split-dir"], "right");
    assert.equal(attrs["data-split-kind"], "wiring");
    assert.equal(classes.has("viewport-doc-split"), true);
    assert.equal(pane.classList.names.has("vp-split-doc"), true);
    assert.equal(tabs.split("nope", WIRING_TAB_ID), false);
    assert.equal(tabs.unsplit(), true);
    assert.equal(tabs.getSplit(), null);
    assert.equal(classes.has("viewport-doc-split"), false);
  } finally {
    globalThis.document = prev;
  }
});

test("splitting Robotics Home keeps the viewport shell instead of opening Robotics Home full screen", () => {
  const attrs = {};
  const classes = new Set();
  const viewport = { classList: { toggle() {}, remove() {} }, style: { visibility: "" }, hidden: false };
  const home = { classList: { add() {}, remove() {} } };
  const main = {
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
      remove(name) { classes.delete(name); },
    },
    style: { setProperty() {} },
    setAttribute(key, value) { attrs[key] = value; },
    removeAttribute(key) { delete attrs[key]; },
  };
  const bar = { classList: { toggle() {} }, innerHTML: "", addEventListener() {} };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => id === "viewport" ? viewport : null,
    querySelectorAll: () => [],
    body: { classList: { contains: () => false, add() {}, remove() {} } },
  };
  try {
    const tabs = createDocumentTabBar({
      tabBarEl: bar,
      mainColumnEl: main,
      resolveSplitPane: (tab) => tab.kind === "robotics-home" ? home : null,
    });
    let activated = null;
    tabs.onActivate((tab) => { activated = tab; });
    tabs.setActive(ROBOTICS_HOME_TAB_ID);
    assert.equal(attrs["data-shell-tab"], "robotics-home");
    assert.equal(tabs.split("left", ROBOTICS_HOME_TAB_ID), true);
    assert.equal(activated?.kind, "robotics-home");
    assert.equal(attrs["data-shell-tab"], VIEWPORT_SHELL);
    assert.equal(attrs["data-split-dir"], "left");
    assert.equal(tabs.getSplit()?.docId, ROBOTICS_HOME_TAB_ID);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("split left then split down becomes a quad with McMaster/parts panes", () => {
  assert.equal(isOrthogonalSplit("left", "down"), true);
  const attrs = {};
  const classes = new Set();
  const panes = {
    wire: { classList: { names: new Set(), add(...n) { n.forEach((x) => this.names.add(x)); }, remove(...n) { n.forEach((x) => this.names.delete(x)); } } },
    canvas: { classList: { names: new Set(), add(...n) { n.forEach((x) => this.names.add(x)); }, remove(...n) { n.forEach((x) => this.names.delete(x)); } } },
    parts: { classList: { names: new Set(), add(...n) { n.forEach((x) => this.names.add(x)); }, remove(...n) { n.forEach((x) => this.names.delete(x)); } } },
    mc: { classList: { names: new Set(), add(...n) { n.forEach((x) => this.names.add(x)); }, remove(...n) { n.forEach((x) => this.names.delete(x)); } } },
    home: { classList: { names: new Set(), add(...n) { n.forEach((x) => this.names.add(x)); }, remove(...n) { n.forEach((x) => this.names.delete(x)); } } },
  };
  const main = {
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
      remove(name) { classes.delete(name); },
    },
    style: { setProperty() {} },
    setAttribute(k, v) { attrs[k] = v; },
    removeAttribute(k) { delete attrs[k]; },
    appendChild() {},
  };
  const bar = { classList: { toggle() {} }, innerHTML: "", addEventListener() {} };
  const prev = globalThis.document;
  const viewport = { classList: { add() {}, toggle() {}, remove() {} }, style: { visibility: "" }, hidden: false };
  globalThis.document = {
    getElementById: (id) => (id === "viewport" ? viewport : null),
    querySelectorAll: () => [],
    body: { classList: { contains: () => false, add() {}, remove() {} } },
    createElement: () => ({ className: "", dataset: {}, setAttribute() {}, addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} }, innerHTML: "" }),
  };
  try {
    const tabs = createDocumentTabBar({
      tabBarEl: bar,
      mainColumnEl: main,
      resolveSplitPane: (tab) => {
        if (tab.kind === "wiring") return panes.wire;
        if (tab.kind === "canvas") return panes.canvas;
        if (tab.kind === "parts") return panes.parts;
        if (tab.kind === "mcmaster") return panes.mc;
        if (tab.kind === "robotics-home") return panes.home;
        return panes.wire;
      },
    });
    tabs.upsert({ id: CANVAS_TAB_ID, label: "Canvas", kind: "canvas" });
    tabs.upsert({ id: WIRING_TAB_ID, label: "Wiring", kind: "wiring" });
    tabs.upsert({ id: "__parts_list__", label: "Parts List", kind: "parts" });
    tabs.upsert({ id: "mcmaster", label: "McMaster-Carr", kind: "mcmaster" });
    assert.equal(tabs.split("left", CANVAS_TAB_ID), true);
    assert.equal(tabs.split("down", WIRING_TAB_ID), true);
    const live = tabs.getSplit();
    assert.equal(live.direction, "left");
    assert.equal(live.cross.direction, "down");
    assert.equal(live.cross.docId, WIRING_TAB_ID);
    assert.equal(attrs["data-split-quad"], "1");
    assert.equal(classes.has("viewport-doc-quad"), true);
    assert.ok(tabs.splitDocIds().includes(CANVAS_TAB_ID));
    assert.ok(tabs.splitDocIds().includes(WIRING_TAB_ID));

    tabs.unsplit();
    assert.equal(tabs.split("left", CANVAS_TAB_ID), true);
    assert.equal(tabs.split("down", "__parts_list__", { extraId: WIRING_TAB_ID }), true);
    const restored = tabs.getSplit();
    assert.equal(restored.cross.docId, "__parts_list__");
    assert.equal(restored.cross.extraId, WIRING_TAB_ID);

    tabs.unsplit();
    assert.equal(tabs.split("right", ROBOTICS_HOME_TAB_ID), true);
    assert.equal(tabs.split("down", WIRING_TAB_ID), true);
    assert.equal(tabs.getSplit().docId, ROBOTICS_HOME_TAB_ID);
    assert.equal(panes.home.classList.names.has("vp-split-doc"), true);
  } finally {
    globalThis.document = prev;
  }
});
