import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canvasElementHasInk,
  collectCanvasBoardNames,
  compressCanvasImageDataUrl,
  CANVAS_AUTOSAVE_MS,
  CANVAS_DEFAULT_TOOL,
  CANVAS_DEFAULT_TOOL_KEY,
  defaultCanvasTimestampName,
  hitResizeHandle,
  hitShapeEdge,
  isCanvasPinnableTool,
  isCanvasRedoShortcut,
  isCanvasUndoShortcut,
  isGenericCanvasName,
  listCanvasBoardsByRecency,
  loadCanvasDefaultTool,
  namedCanvasStore,
  pickLastCanvasBoard,
  readLastEditedCanvasName,
  writeLastEditedCanvasName,
  pointInBounds,
  resolveCanvasTabOpen,
  resizeBounds,
  sanitizeCanvasElements,
  shouldKeepRawCanvasImageDataUrl,
  slugifyCanvasName,
  storeCanvasDefaultTool,
  canvasViewPanAfterZoom,
  canvasWheelShouldZoom,
  canvasWheelZoomFactor,
  canvasGridSpacing,
  clampCanvasMenuPosition,
  clampCanvasViewZoom,
  fillCanvasGrid,
  CANVAS_ASK_OPEN_KEY,
  CANVAS_TOOL_SHORTCUTS,
  canvasToolFromShortcutEvent,
  readCanvasAskOpenPref,
  writeCanvasAskOpenPref,
} from "./canvas-mode.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "canvas-mode.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");

const box = { x: 40, y: 50, w: 100, h: 80 };

test("corner handles hit-test at all four corners", () => {
  assert.equal(hitResizeHandle(box, { x: 40, y: 50 }), "nw");
  assert.equal(hitResizeHandle(box, { x: 140, y: 50 }), "ne");
  assert.equal(hitResizeHandle(box, { x: 40, y: 130 }), "sw");
  assert.equal(hitResizeHandle(box, { x: 140, y: 130 }), "se");
  assert.equal(hitResizeHandle(box, { x: 90, y: 90 }), null);
});

test("dragging a corner resizes from the opposite anchor", () => {
  const se = resizeBounds(box, "se", { x: 180, y: 160 });
  assert.equal(se.x, 40);
  assert.equal(se.y, 50);
  assert.equal(se.w, 140);
  assert.equal(se.h, 110);

  const nw = resizeBounds(box, "nw", { x: 10, y: 20 });
  assert.equal(nw.x, 10);
  assert.equal(nw.y, 20);
  assert.equal(nw.w, 130);
  assert.equal(nw.h, 110);
});

test("resize keeps a minimum size", () => {
  const tiny = resizeBounds(box, "se", { x: 41, y: 51 }, 16);
  assert.equal(tiny.w, 16);
  assert.equal(tiny.h, 16);
});

test("shape edge hits the stroke, not only the fill", () => {
  assert.equal(hitShapeEdge(box, { x: 40, y: 90 }), true);
  assert.equal(hitShapeEdge(box, { x: 140, y: 90 }), true);
  assert.equal(hitShapeEdge(box, { x: 90, y: 50 }), true);
  assert.equal(hitShapeEdge(box, { x: 90, y: 130 }), true);
  assert.equal(hitShapeEdge(box, { x: 38, y: 90 }, 10), true);
  assert.equal(pointInBounds(box, { x: 90, y: 90 }), true);
  assert.equal(hitShapeEdge(box, { x: 90, y: 90 }), false);
  assert.equal(pointInBounds(box, { x: 10, y: 10 }), false);
});

test("Cmd+Z / Ctrl+Z undo and Cmd+Shift+Z / Ctrl+Y redo", () => {
  assert.equal(isCanvasUndoShortcut({ key: "z", metaKey: true, shiftKey: false }), true);
  assert.equal(isCanvasUndoShortcut({ key: "z", ctrlKey: true, shiftKey: false }), true);
  assert.equal(isCanvasUndoShortcut({ key: "z", metaKey: true, shiftKey: true }), false);
  assert.equal(isCanvasRedoShortcut({ key: "z", metaKey: true, shiftKey: true }), true);
  assert.equal(isCanvasRedoShortcut({ key: "z", ctrlKey: true, shiftKey: true }), true);
  assert.equal(isCanvasRedoShortcut({ key: "y", ctrlKey: true }), true);
  assert.equal(isCanvasRedoShortcut({ key: "y", metaKey: true }), true);
});

test("canvas keydown uses capture so it wins over CAD Cmd+Z while Canvas tab is active", () => {
  assert.match(src, /addEventListener\("keydown", \(e\) => \{/);
  assert.match(src, /\}, true\);/);
  assert.match(src, /isCanvasUndoShortcut/);
  assert.match(src, /canvasToolFromShortcutEvent/);
  assert.match(src, /deleteSelected/);
  assert.match(src, /beginResize/);
  assert.match(src, /hitShapeEdge/);
  assert.match(src, /tabindex="-1"/);
  assert.match(app, /isCanvasDesignTabActive\(\) && \(isUndo \|\| isRedo\)\) return/);
  assert.match(app, /canvas-mode\.js\?v=20260908-canvas-edit1/);
  assert.equal(CANVAS_TOOL_SHORTCUTS.v, "select");
  assert.equal(CANVAS_TOOL_SHORTCUTS.t, "text");
  assert.equal(CANVAS_TOOL_SHORTCUTS.a, "arrow");
  assert.equal(canvasToolFromShortcutEvent({ key: "p" }), "pen");
  assert.equal(canvasToolFromShortcutEvent({ key: "p", metaKey: true }), "");
});

test("empty / leftover click-dots are not ink and a new canvas imports a blank board", () => {
  const same = { x: 120, y: 80 };
  const ghost = { type: "pen", color: "#58a6ff", strokeWidth: 3, points: [same, { ...same }] };
  const jitter = {
    type: "pen",
    color: "#58a6ff",
    strokeWidth: 3,
    points: [{ x: 10, y: 10 }, { x: 10.4, y: 10.2 }],
  };
  const real = {
    type: "pen",
    color: "#58a6ff",
    strokeWidth: 3,
    points: [{ x: 10, y: 10 }, { x: 40, y: 28 }],
  };
  const stubLine = { type: "line", x1: 8, y1: 8, x2: 8, y2: 9 };
  const realLine = { type: "line", x1: 8, y1: 8, x2: 80, y2: 12 };
  assert.equal(canvasElementHasInk(ghost), false);
  assert.equal(canvasElementHasInk(jitter), false);
  assert.equal(canvasElementHasInk(real), true);
  assert.equal(canvasElementHasInk(stubLine), false);
  assert.equal(canvasElementHasInk(realLine), true);
  assert.deepEqual(sanitizeCanvasElements([ghost, jitter, stubLine, real, realLine]), [real, realLine]);
  assert.match(src, /sanitizeCanvasElements\(state\.elements/);
  assert.match(src, /resetTransientDrawing/);
  assert.match(src, /preview = null/);
  assert.match(src, /connectFrom = null/);
  assert.match(src, /function show\(\) \{\n    resetTransientDrawing\(\)/);
  assert.match(src, /live = sanitizeCanvasElements\(elements\)/);
  assert.match(app, /importState\?\.\(data\?\.state \|\| \{ elements: \[\] \}\)/);
  assert.match(app, /importState\?\.\(\{ elements: \[\] \}\)/);
});

test("unnamed canvases get a local timestamped default name", () => {
  assert.equal(isGenericCanvasName(""), true);
  assert.equal(isGenericCanvasName("Canvas"), true);
  assert.equal(isGenericCanvasName("  canvas  "), true);
  assert.equal(isGenericCanvasName("Top View"), false);
  const named = defaultCanvasTimestampName(new Date(2026, 8, 15, 2, 29));
  assert.equal(named, "Canvas 2026-09-15 02.29");
  assert.equal(slugifyCanvasName(named), named);
  assert.match(app, /ensureTimestampedCanvasName/);
  assert.match(app, /defaultCanvasTimestampName/);
  assert.match(src, /id="canvas-name-input"/);
  assert.match(src, /CANVAS_NAME_DEBOUNCE_MS = 600/);
});

test("typing a canvas name persists to reference files after debounce, not every keypress", () => {
  assert.match(src, /setTimeout\(flushRename, CANVAS_NAME_DEBOUNCE_MS\)/);
  assert.match(src, /addEventListener\("blur", flushRename\)/);
  assert.match(app, /onRename: \(name\) => void renameCanvasStore\(name\)/);
  assert.match(app, /async function renameCanvasStore/);
  const renameStart = app.indexOf("async function renameCanvasStore");
  const renameEnd = app.indexOf("function maybeShowCanvasSaveHint", renameStart);
  const renameFn = app.slice(renameStart, renameEnd);
  assert.match(renameFn, /canvas-board\/rename/);
  assert.match(renameFn, /canvasStoreName = old/);
  assert.equal(renameFn.includes("persistCanvasBoard"), false);
  assert.equal(renameFn.includes("refreshFiles"), false);
});

test("load-more lists project canvases and can open in a new tab or replace", () => {
  const listed = collectCanvasBoardNames([
    { folder: "Canvas/Top View", name: "canvas.json", mtime: 20 },
    { folder: "Canvas/Front View", name: "canvas.json", mtime: 10 },
    { folder: "Canvas/Top View", name: "shot.png", mtime: 9 },
  ], "Top View");
  assert.deepEqual(listed.map((row) => row.name), ["Front View"]);
  assert.deepEqual(resolveCanvasTabOpen({ replace: true, currentTabId: "__canvas__", nextName: "Front View" }), {
    action: "replace",
    tabId: "__canvas__",
    name: "Front View",
  });
  assert.equal(resolveCanvasTabOpen({ replace: false, currentTabId: "__canvas__", nextName: "Front View" }).action, "new-tab");
  assert.match(src, /id="canvas-load-more-btn"/);
  assert.match(src, /data-canvas-mode="new-tab"/);
  assert.match(src, /data-canvas-mode="replace"/);
  assert.match(src, /data-canvas-action-toggle/);
  assert.match(src, /Replace viewer/);
  assert.match(src, /No other canvases in this project/);
  assert.match(app, /async function openProjectCanvas/);
  assert.match(app, /async function loadCanvasIntoViewer/);
  assert.match(app, /async function openCanvasBoardFromBrowser/);
  assert.match(app, /fetchProjectCanvasBoards/);
  assert.match(app, /\/api\/projects\/\$\{projectId\}\/canvas-boards/);
  assert.match(app, /skipViewportResize/);
  assert.match(app, /canvasload1/);
  const openStart = app.indexOf("async function loadCanvasIntoViewer");
  const openFn = app.slice(openStart, app.indexOf("function listProjectVideoEntries", openStart));
  assert.match(openFn, /persistCanvasBoard\(\{ refreshList: false, name: previousName \}\)/);
  assert.match(openFn, /canvasBoardSwitching/);
  assert.equal(openFn.includes("canvas-board/rename"), false);
});

test("open last uses last edited, not alphabetical or generic Canvas", () => {
  assert.equal(namedCanvasStore(""), "");
  assert.equal(namedCanvasStore("Front View"), "Front View");
  const files = [
    { folder: "Canvas/Apple Board", name: "canvas.json", mtime: 5 },
    { folder: "Canvas/Canvas", name: "canvas.json", mtime: 9 },
    { folder: "Canvas/Zebra View", name: "canvas.json", mtime: 40 },
    { folder: "Canvas/Front View", name: "canvas.json", mtime: 10 },
    { folder: "Canvas/Canvas 2026-09-15 02.29", name: "canvas.json", mtime: 30 },
  ];
  const listed = listCanvasBoardsByRecency(files);
  assert.deepEqual(listed.map((row) => row.name), [
    "Zebra View",
    "Canvas 2026-09-15 02.29",
    "Front View",
    "Canvas",
    "Apple Board",
  ]);
  assert.equal(pickLastCanvasBoard(listed, { lastEditedName: "Front View" }).name, "Front View");
  assert.equal(pickLastCanvasBoard(listed, { lastEditedName: "" }).name, "Zebra View");
  assert.equal(pickLastCanvasBoard(listed, { lastEditedName: "Canvas" }).name, "Canvas");

  const dupes = listCanvasBoardsByRecency([
    { folder: "Canvas/Front View", name: "canvas.json", mtime: 10 },
    { folder: "Canvas/Apple Board", name: "canvas.json", mtime: 50 },
    { folder: "Canvas/Front View", name: "shot.png", mtime: 80 },
  ]);
  assert.equal(dupes[0].name, "Front View");
  assert.equal(dupes[0].mtime, 80);

  const mem = new Map();
  const storage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => { mem.set(key, String(value)); },
  };
  writeLastEditedCanvasName("proj-1", "Front View", storage);
  assert.equal(readLastEditedCanvasName("proj-1", storage), "Front View");
  assert.equal(
    pickLastCanvasBoard(listed, { lastEditedName: readLastEditedCanvasName("proj-1", storage) }).name,
    "Front View",
  );

  assert.match(app, /function rememberEditedCanvasBoard/);
  assert.match(app, /function resolveOpenLastCanvasBoard/);
  assert.match(app, /pickLastCanvasBoard\(boards/);
  assert.match(app, /writeLastEditedCanvasName\(projectId/);
  const lastBtn = app.slice(
    app.indexOf('getElementById("canvas-open-last-btn")'),
    app.indexOf('getElementById("canvas-open-new-btn")'),
  );
  assert.match(lastBtn, /resolveOpenLastCanvasBoard/);
  assert.equal(lastBtn.includes("boards[0]"), false);
  const chooser = app.slice(app.indexOf("async function openCanvasWithChooser"), app.indexOf("function openCanvasDocTab"));
  assert.match(chooser, /resolveOpenLastCanvasBoard/);
  assert.equal(chooser.includes("boards[0]"), false);
  const html = readFileSync(join(here, "../index.html"), "utf8");
});

test("canvas tools default to move and can pin another tool as default", () => {
  assert.equal(CANVAS_DEFAULT_TOOL, "select");
  assert.equal(isCanvasPinnableTool("select"), true);
  assert.equal(isCanvasPinnableTool("pen"), true);
  assert.equal(isCanvasPinnableTool("link"), true);
  assert.equal(isCanvasPinnableTool("image"), false);
  const mem = new Map();
  const storage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => { mem.set(key, String(value)); },
  };
  assert.equal(loadCanvasDefaultTool(storage), "select");
  assert.equal(storeCanvasDefaultTool("pen", storage), "pen");
  assert.equal(mem.get(CANVAS_DEFAULT_TOOL_KEY), "pen");
  assert.equal(loadCanvasDefaultTool(storage), "pen");
  assert.equal(storeCanvasDefaultTool("image", storage), "select");
  assert.match(src, /let tool = loadCanvasDefaultTool\(\)/);
  assert.match(src, /addEventListener\("contextmenu"/);
  assert.match(src, /canvas-tool-pinned/);
  assert.match(src, /Right-click to pin as default/);
  assert.equal(src.includes('class="canvas-tool-btn active" data-tool="pen"'), false);
  assert.match(app, /toolpin1/);
});

test("parkCanvasOverlay and canvas close still skip refreshFiles", () => {
  const parkStart = app.indexOf("function parkCanvasOverlay()");
  const parkEnd = app.indexOf("function enterCanvasTab", parkStart);
  const parkFn = app.slice(parkStart, parkEnd);
  assert.match(parkFn, /refreshList: false/);
  assert.equal(parkFn.includes("refreshFiles"), false);
  assert.equal(parkFn.includes("dispatchEvent"), false);
  const closeStart = app.indexOf("docTabs.onClose");
  const closeFn = app.slice(closeStart, closeStart + 1400);
  assert.match(closeFn, /persistCanvasBoard\(\{ force: true, refreshList: false \}\)/);
});

test("Canvas open parks desktop WebGL, skips window.resize, and does not encode PNG on autosave", async () => {
  assert.equal(CANVAS_AUTOSAVE_MS, 1800);
  assert.match(app, /CANVAS_AUTOSAVE_MS/);
  assert.match(app, /shouldParkDesktopViewportForCanvasTab/);
  assert.match(app, /20260915-canvasperf1/);
  const enterStart = app.indexOf("function enterCanvasTab");
  const enterFn = app.slice(enterStart, app.indexOf("function exitCanvasTab", enterStart));
  assert.equal(enterFn.includes("dispatchEvent"), false);
  assert.equal(enterFn.includes("new Event(\"resize\")"), false);
  assert.match(enterFn, /hideEditorWindow/);
  const animateStart = app.indexOf("function animate() {");
  const animateFn = app.slice(animateStart, animateStart + 1400);
  assert.match(animateFn, /shouldParkDesktopViewportForCanvasTab/);
  assert.match(animateFn, /meshAnimLastFrame = now;\n    return;/);
  const persistFn = app.slice(
    app.indexOf("async function persistCanvasBoard"),
    app.indexOf("async function loadCanvasBoardIfAny"),
  );
  assert.equal(persistFn.includes("toDataURL"), false);
  assert.equal(persistFn.includes("getCanvasDataUrl"), false);
  const scheduleFn = app.slice(app.indexOf("function scheduleCanvasAutosave"), app.indexOf("async function persistCanvasBoard"));
  assert.match(scheduleFn, /CANVAS_AUTOSAVE_MS/);
  assert.match(scheduleFn, /persistCanvasBoard\(\{ refreshList: false \}\)/);
  assert.match(src, /getContext\("2d"/);
  assert.equal(src.includes("getContext(\"webgl"), false);
  assert.equal(src.includes("WebGLRenderer"), false);
  const importFn = src.slice(src.indexOf("function importState(state = {})"), src.indexOf("async function addImageFromUrl"));
  assert.equal(importFn.includes("notifyChange"), false);
  assert.equal(shouldKeepRawCanvasImageDataUrl("https://files/shot.png"), true);
  assert.equal(shouldKeepRawCanvasImageDataUrl("data:image/svg+xml,<svg/>"), true);
  assert.equal(shouldKeepRawCanvasImageDataUrl(`data:image/png;base64,${"A".repeat(200000)}`), false);
  class FakeImage {
    constructor() {
      this.naturalWidth = 4000;
      this.naturalHeight = 3000;
      this.width = 4000;
      this.height = 3000;
    }
    set src(_value) { queueMicrotask(() => this.onload?.()); }
  }
  const huge = `data:image/png;base64,${"A".repeat(200000)}`;
  const out = await compressCanvasImageDataUrl(huge, {
    Image: FakeImage,
    createCanvas: () => ({
      width: 0,
      height: 0,
      getContext() { return { drawImage() { } }; },
      toDataURL() { return "data:image/jpeg;base64,abc"; },
    }),
  });
  assert.equal(out, "data:image/jpeg;base64,abc");
});

test("Send to AI and share sit under the canvas name", () => {
  assert.match(src, /canvas-name-block/);
  assert.match(src, /Send to AI/);
  assert.match(src, /id="canvas-share-btn"/);
  assert.match(src, /Copy share link/);
  assert.match(src, /Share to Discord/);
  assert.match(src, /data-canvas-download="png"/);
  assert.match(src, /data-canvas-download="jpg"/);
  assert.match(src, /data-canvas-download="webp"/);
  assert.match(src, /data-canvas-download="json"/);
  assert.match(src, /data-share-mode="view"/);
  assert.match(src, /data-share-mode="remix"/);
  assert.match(src, /data-share-mode="edit"/);
  assert.match(src, /function bindShare/);
  assert.equal(src.includes("📎 Prompt"), false);
  assert.match(app, /async function handleCanvasShare/);
  assert.match(app, /onShare: \(payload\) => handleCanvasShare\(payload\)/);
  assert.match(app, /createShareRecord/);
  assert.match(app, /patchShareSettings/);
  assert.match(app, /shareToDiscord/);
  assert.match(app, /canvasshare1/);
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(css, /\.canvas-send-ai-btn/);
  assert.match(css, /\.canvas-share-popover/);
});

test("Send to AI sits last on the canvas toolbar and split mode does not overlap", () => {
  const palette = src.slice(src.indexOf("canvas-palette-stack"), src.indexOf("canvas-image-input"));
  const sendAt = palette.indexOf("id=\"canvas-attach-prompt-btn\"");
  const splitAt = palette.indexOf("id=\"canvas-split-btn\"");
  const toolsAt = palette.indexOf("canvas-toolbar-popup");
  const nameActions = palette.slice(palette.indexOf("canvas-name-actions"), palette.indexOf("canvas-load-popover"));
  assert.equal(nameActions.includes("canvas-attach-prompt-btn"), false);
  assert.equal(sendAt > splitAt && sendAt > toolsAt, true);
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(css, /\.canvas-send-ai-btn[\s\S]*margin-left:\s*auto/);
  assert.match(css, /cansplit=20260916-1/);
  assert.match(css, /\.canvas-split-on \.canvas-palette-stack/);
  assert.match(css, /\.canvas-split-on \.canvas-toolbar-popup/);
  assert.match(css, /flex:\s*1 1 100%/);
  assert.match(css, /min-width:\s*max-content/);
  assert.equal(css.includes(".canvas-layout-split .canvas-name-block { flex-basis: 180px; }"), false);
  assert.match(app, /function applyCanvasSplitChrome/);
  assert.match(app, /canvas-split-on/);
  assert.match(app, /function syncSplitPanelRetract/);
  assert.match(app, /function isViewportSplitStealingSpace/);
  assert.match(app, /viewport-doc-split/);
  assert.match(app, /setSidebarHidden\?\.\(true, \{ persist: false \}\)/);
  assert.match(app, /setRightPanelHidden\?\.\(true, \{ persist: false \}\)/);
  assert.match(app, /syncSplitPanelRetract/);
  assert.match(app, /cansplit=20260916-1/);
  assert.match(html, /cansplit=20260916-1/);
  assert.match(app, /wiresplit=20260916-1/);
  assert.match(app, /vplayout=20260916-1/);
  assert.match(app, /alltrans=20260916-1/);
  assert.match(app, /partthumb=20260916-1/);
  assert.match(app, /catlists=20260916-1/);
  assert.match(app, /vidclose2=20260916-1/);
  assert.match(html, /noswipe=20260916-1/);
});

test("Send to AI does not dump layout clause; Improve and dotted links carry the drawing", () => {
  assert.match(src, /data-tool="link"/);
  assert.match(src, /id="canvas-smart-desc-btn"/);
  assert.match(src, /Smart description/);
  assert.match(src, /type === "link"/);
  assert.match(src, /linkNumber/);
  assert.match(src, /openRelationEditor/);
  assert.match(src, /k: "link"/);
  assert.equal(app.includes("LAYOUT DRAWING that EXPLAINS this prompt"), false);
  assert.equal(app.includes("composer.setPromptText?.(augmentPromptForCanvasSketch"), false);
  assert.match(app, /CANVAS_IMPROVE_DIRECTIVE/);
  assert.match(app, /do not copy this block into improved_prompt/);
  assert.match(app, /LOGIC CHECK/);
  assert.match(app, /handleCanvasSmartDescribe/);
  assert.match(app, /onSmartDescribe: \(payload\) => handleCanvasSmartDescribe/);
  assert.match(app, /formatSmartDescriptionDraft/);
  assert.match(app, /attachCanvasSmartDescriptionAssets/);
  assert.match(app, /formatCanvasLayoutNotes/);
  const attachStart = app.indexOf("async function applyCanvasSketchToPrompt");
  const attachBody = app.slice(attachStart, app.indexOf("function handleCanvasSendRegion"));
  assert.equal(attachBody.includes("setPromptText"), false);
  assert.match(attachBody, /attachCanvasGoalMetadata/);
  assert.match(attachBody, /Smart description will write the prompt/);
  assert.match(app, /canvas-metadata\.json/);
  assert.match(app, /function attachCanvasGoalMetadata/);
  assert.equal(app.includes("if (canvasAttached && !String(prompt || \"\").trim())"), false);
  const smartStart = app.indexOf("async function handleCanvasSmartDescribe");
  const smartBody = app.slice(smartStart, smartStart + 2600);
  assert.equal(smartBody.includes("handlePromptGenerateClick"), false);
  assert.match(smartBody, /generated: false/);
  assert.match(src, /canvas-smart-desc-spin/);
  assert.match(src, /canvas-smart-desc-ai/);
  assert.match(src, /Does not generate/);
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(css, /\.canvas-smart-desc-btn/);
  assert.match(css, /\.canvas-smart-desc-spin/);
  assert.match(css, /@keyframes canvas-smart-desc-spin/);
  assert.match(css, /\.canvas-relation-pop/);
});

test("pinch and ctrl-wheel zoom the canvas view, not the browser page", () => {
  assert.equal(clampCanvasViewZoom(0.01), 0.25);
  assert.equal(clampCanvasViewZoom(99), 8);
  assert.equal(canvasWheelShouldZoom({ ctrlKey: true, deltaY: 20 }), true);
  assert.equal(canvasWheelShouldZoom({ metaKey: true, deltaY: 20 }), true);
  assert.equal(canvasWheelShouldZoom({ ctrlKey: false, deltaY: 20 }), false);
  const factor = canvasWheelZoomFactor({ deltaY: 100, deltaMode: 0 });
  assert.equal(factor < 1, true);
  const pan = canvasViewPanAfterZoom({
    areaX: 200, areaY: 100, panX: 0, panY: 0, zoom: 1, nextZoom: 2,
  });
  assert.equal(pan.panX, 200 - 200 * 2);
  assert.equal(pan.panY, 100 - 100 * 2);
  assert.match(src, /bindViewControls/);
  assert.match(src, /gesturestart/);
  assert.match(src, /passive: false/);
  assert.match(src, /id="canvas-view"/);
  assert.match(src, /resetCanvasView/);
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(css, /\.canvas-view/);
  assert.match(css, /overscroll-behavior: none/);
});

test("canvas grid fills the visible viewport in world space, not a finite board", () => {
  const fills = [];
  const strokes = [];
  const moves = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    fillRect(x, y, w, h) { fills.push({ x, y, w, h, fillStyle: this.fillStyle }); },
    beginPath() { },
    moveTo(x, y) { moves.push({ x, y }); },
    lineTo() { },
    stroke() { strokes.push(this.strokeStyle); },
    save() { },
    restore() { },
  };
  assert.equal(fillCanvasGrid(ctx, 40, 40), true);
  assert.equal(fills[0].w, 40);
  assert.equal(fills[0].h, 40);
  assert.equal(fills[0].fillStyle, "#0d1117");
  assert.ok(strokes.length >= 2);
  assert.ok(moves.some((m) => m.x === 0.5));
  assert.ok(moves.some((m) => m.y === 0.5));

  moves.length = 0;
  fills.length = 0;
  assert.equal(fillCanvasGrid(ctx, 80, 80, { originX: -60, originY: -40, zoom: 1 }), true);
  assert.equal(fills[0].w, 80);
  assert.equal(fills[0].h, 80);
  assert.ok(moves.some((m) => m.x === 0.5), "grid continues into the visible view after pan");
  assert.ok(moves.some((m) => m.y === 0.5));
  assert.ok(moves.some((m) => m.x === 20.5));

  assert.equal(canvasGridSpacing(1).minor, 20);
  assert.equal(canvasGridSpacing(1).major, 100);
  assert.ok(canvasGridSpacing(0.25).minor > 20);
  assert.ok(canvasGridSpacing(8).minor <= 20);
  assert.ok(canvasGridSpacing(0.25).minor * 0.25 >= 12);

  assert.match(src, /id="canvas-grid"/);
  assert.match(src, /paintViewportGrid/);
  assert.match(src, /originX: viewPanX/);
  assert.match(src, /originY: viewPanY/);
  assert.match(src, /canvasGridSpacing\(zoom\)/);
  assert.match(src, /ctx\.clearRect\(0, 0, canvas\.width, canvas\.height\)/);
  assert.equal(src.includes("fillCanvasGrid(ctx, canvas.width, canvas.height)"), false);
  assert.equal(src.includes("CSS on `.canvas-area` already paints the grid"), false);
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.equal(/\.canvas-area \{[\s\S]*?background-size: 20px 20px/.test(css), false);
  assert.equal(/\.canvas-view \{[\s\S]*?background-size: 20px 20px/.test(css), false);
  assert.match(css, /\.canvas-area \{[\s\S]*background: #0d1117/);
  assert.match(css, /\.canvas-grid \{[\s\S]*pointer-events: none/);
  assert.match(src, /beginViewPan\(e\)/);
  assert.match(src, /type: "select-box"/);
  assert.match(css, /\.canvas-toolbar-row--tools \{[\s\S]*border-bottom: 1px solid/);
  assert.match(css, /\.canvas-tool-group \{[\s\S]*gap: 0;/);
  assert.match(css, /\.canvas-tool-btn \{[\s\S]*padding: 2px 4px;/);
  assert.match(app, /canvaskit1/);
  assert.match(app, /canvasgrid1/);
});

test("canvas image drops convert HEIC to PNG before placing", () => {
  assert.match(src, /from "\.\.\/media\/heic-to-png\.js\?v=heicpng1"/);
  const addFn = src.slice(src.indexOf("async function addDroppedImageFiles"), src.indexOf("function hasDrawing"));
  assert.match(addFn, /convertHeicIngestFiles/);
  assert.match(src, /isHeicFile\(file\)/);
  assert.match(src, /heic\|heif/);
  assert.match(app, /heicpng1/);
});

test("view, face, edge, and split marks feed per-region prompt cards", () => {
  assert.match(src, /data-tool="view-mark"/);
  assert.match(src, /data-tool="face-mark"/);
  assert.match(src, /data-tool="edge-mark"/);
  assert.match(src, /data-tool="split-mark"/);
  assert.match(src, /openInterestEditor/);
  assert.match(src, /getInterests/);
  assert.match(src, /updateInterestPrompt/);
  assert.match(src, /Hover a button to see what it tells the AI/);
  assert.match(app, /renderCanvasInterestCards/);
  assert.match(app, /canvas-interest-list/);
  assert.match(app, /faces, edges, views, and splits of interest/);
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(css, /\.canvas-interest-pop/);
  assert.match(css, /\.prompt-interest-card/);
  assert.equal(canvasElementHasInk({
    type: "edge-mark", x1: 10, y1: 10, x2: 80, y2: 12,
  }), true);
});

test("canvas context menus clamp into the canvas / viewport after measuring", () => {
  const flipped = clampCanvasMenuPosition({
    pointerX: 100, pointerY: 580, menuWidth: 210, menuHeight: 360, viewWidth: 800, viewHeight: 600,
  });
  assert.equal(flipped.top < 580, true);
  assert.equal(flipped.flipped, true);
  assert.equal(flipped.top + 360 <= 600 - 8, true);

  const right = clampCanvasMenuPosition({
    pointerX: 780, pointerY: 40, menuWidth: 210, menuHeight: 200, viewWidth: 800, viewHeight: 600,
  });
  assert.equal(right.left + 210 <= 800 - 8, true);
  assert.equal(right.left >= 8, true);

  const boxed = clampCanvasMenuPosition({
    pointerX: 500, pointerY: 490, menuWidth: 210, menuHeight: 280,
    viewWidth: 400, viewHeight: 300, viewLeft: 100, viewTop: 200,
  });
  assert.equal(boxed.left >= 108, true);
  assert.equal(boxed.left + 210 <= 100 + 400 - 8, true);
  assert.equal(boxed.top >= 208, true);
  assert.equal(boxed.top + 280 <= 200 + 300 - 8, true);

  assert.match(src, /function placeCanvasContextMenu/);
  assert.match(src, /function placeCanvasLocalMenu/);
  assert.match(src, /placeCanvasContextMenu\(tagMenu, clientX, clientY\)/);
  assert.match(src, /placeCanvasContextMenu\(pop,/);
  assert.match(src, /placeCanvasLocalMenu\(pop,/);
  assert.match(src, /selectElement,/);
  assert.match(app, /onMentionActivate/);
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(css, /\.canvas-tag-menu \{[\s\S]*max-height: calc\(100vh - 16px\)/);
});

test("canvas open chooser, group-link, and move-pan stay wired", () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  assert.equal(readCanvasAskOpenPref(storage), true);
  writeCanvasAskOpenPref(false, storage);
  assert.equal(storage.getItem(CANVAS_ASK_OPEN_KEY), "0");
  assert.equal(readCanvasAskOpenPref(storage), false);
  writeCanvasAskOpenPref(true, storage);
  assert.equal(readCanvasAskOpenPref(storage), true);

  assert.match(src, /data-canvas-group-link/);
  assert.match(src, /type: "group-link"/);
  assert.match(src, /id="canvas-link-name"/);
  assert.match(src, /beginViewPan\(e\)/);
  assert.match(app, /openCanvasWithChooser/);
  assert.match(app, /pref-canvas-ask-open/);
  assert.match(app, /\["canvas", "Canvas"\]/);
  assert.match(app, /composeSmartDescriptionInterview/);
  assert.match(app, /canvas-smart-desc-fill/);
  assert.match(app, /generated: false/);
  assert.doesNotMatch(handleCanvasSmartDescribeSrc(), /generateCurrentPrompt|runGenerate\(/);
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(html, /id="canvas-open-chooser-modal"/);
  assert.match(html, /id="canvas-smart-desc-modal"/);
  assert.match(html, /Don’t show this again/);
});

test("right-click Send to AI inserts kind: @token mentions without wiping the prompt", () => {
  assert.match(src, /data-canvas-send-region/);
  assert.match(src, /function sendNodeToAi/);
  assert.match(src, /assignCanvasPromptToken/);
  assert.match(src, /onSendRegion/);
  assert.match(src, /View \/ face of interest/);
  assert.match(app, /function handleCanvasSendRegion/);
  assert.match(app, /canvasPromptMentionPhrase/);
  assert.match(app, /canvasRegionPromptReference/);
  assert.match(app, /onSendRegion: \(el, payload\) => handleCanvasSendRegion/);
  assert.match(app, /insertMention: false \}/);
  assert.match(app, /canvasmention1/);
  const sendStart = app.indexOf("function handleCanvasSendRegion");
  const sendBody = app.slice(sendStart, app.indexOf("function canvasSmartDescriptionRef"));
  assert.match(sendBody, /insertMentionWithTrailingSpace/);
  assert.match(sendBody, /composer\.addReference\(ref, \{ insertMention: false \}\)/);
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(css, /\.canvas-send-region-btn/);
});

test("canvas display src uses trackObjectUrl and revokes on destroy", () => {
  assert.match(src, /trackObjectUrl\(blob, canvasDisplayCreated\)/);
  assert.match(src, /revokeTrackedObjectUrls\(canvasDisplayCreated\)/);
  const start = src.indexOf("async function resolveDisplaySrc");
  const end = src.indexOf("\n  function loadImage", start);
  assert.ok(start >= 0 && end > start, "resolveDisplaySrc missing");
  const fn = src.slice(start, end);
  assert.equal(fn.includes("URL.createObjectURL"), false);
});

test("triggerBlobDownload uses triggerTrackedBlobDownload, not 30s revoke", () => {
  assert.match(src, /import \{ triggerTrackedBlobDownload, trackObjectUrl, revokeTrackedObjectUrls \}/);
  const start = src.indexOf("function triggerBlobDownload");
  const end = src.indexOf("\n  async function ", start + 1);
  assert.ok(start >= 0 && end > start, "triggerBlobDownload missing");
  const fn = src.slice(start, end);
  assert.match(fn, /triggerTrackedBlobDownload\(blob, filename, canvasDownloadCreated\)/);
  assert.equal(fn.includes("30_000"), false);
  assert.equal(fn.includes("30000"), false);
  assert.equal(fn.includes("createObjectURL"), false);
});

function handleCanvasSmartDescribeSrc() {
  const start = app.indexOf("async function handleCanvasSmartDescribe");
  const end = app.indexOf("async function handleCanvasShare", start);
  return app.slice(start, end > start ? end : start + 4000);
}
