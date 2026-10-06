import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const gizmo = readFileSync(join(here, "../viewport/gizmo-panel.js"), "utf8");

test("R rotate and S scale are not gated on last click inside #viewport", () => {
  const start = app.indexOf('window.addEventListener("keydown"');
  const end = app.indexOf("if (key === \"i\")", start);
  assert.ok(start >= 0 && end > start);
  const handler = app.slice(start, end);
  const rFn = handler.indexOf("shouldHandleObjectTransformShortcut");
  const gate = handler.indexOf("if (!inViewport) return");
  assert.ok(rFn >= 0 && gate > rFn);
  assert.match(handler, /activateObjectTransformShortcut\(key\)/);
  assert.match(app, /openTransformMode\("rotate"\)/);
  assert.match(app, /openTransformMode\("scale"\)/);
  assert.match(app, /if \(key === "r"\) openTransformMode\("rotate"\)/);
});

test("R and S activate in capture so gizmo fields and defaultPrevented cannot eat them", () => {
  assert.match(app, /shouldHandleObjectTransformShortcut\(e, capKey, capMod\)/);
  assert.match(app, /activateObjectTransformShortcut\(capKey\)/);
  assert.match(app, /isBlockingTransformShortcutTarget/);
  assert.match(app, /function resolveTransformShortcutTarget/);
  assert.match(app, /defaultPrevented && !shouldHandleObjectTransformShortcut/);
  assert.match(gizmo, /\["g", "r", "s"\]\.includes\(key\)/);
  assert.match(gizmo, /setMode\(mode\)/);
});

test("M opens Measure; G moves; T toggles transparent and is not stolen from fields or Canvas", () => {
  assert.match(app, /function shouldHandleTransparentShortcut/);
  assert.match(app, /activateTransparentShortcut\(\)/);
  assert.match(app, /btn-transparent-viewport.*click/);
  assert.match(app, /toggleTransparentPick\(\)/);
  assert.match(app, /if \(key === "g"\) openTransformMode\("translate"\)/);
  assert.equal(app.includes('if (key === "g" || key === "m") openTransformMode("translate")'), false);
  assert.equal(app.includes('if (key === "g" || key === "t") openTransformMode("translate")'), false);
  const start = app.indexOf("function shouldHandleObjectTransformShortcut");
  const transformFn = app.slice(start, start + 700);
  assert.match(transformFn, /key !== "g" && key !== "r"/);
  assert.equal(transformFn.includes('key === "m"'), false);
  assert.equal(transformFn.includes('key !== "t"'), false);
  assert.match(app, /function shouldHandleMeasureShortcut/);
  assert.match(app, /toggleMeasureShortcut\(\)/);
  assert.match(app, /handleMeasureViewportClick/);
  const trans = app.slice(app.indexOf("function shouldHandleTransparentShortcut"), app.indexOf("function activateObjectTransformShortcut"));
  assert.match(trans, /key !== "t"/);
  assert.match(trans, /e\.code !== "KeyT"/);
  assert.match(trans, /isCanvasDesignTabActive\(\)\) return false/);
  assert.match(trans, /isEditableShortcutTarget\(e\.target\)\) return false/);
  assert.match(trans, /isAiPromptShortcutTarget/);
  const activate = app.slice(app.indexOf("function activateTransparentShortcut"), app.indexOf("function activateTransparentShortcut") + 500);
  assert.match(activate, /toggleTransparentPick\(\)/);
  assert.match(activate, /transformControls\.detach\(\)/);
  assert.match(app, /stopImmediatePropagation\(\);\n    activateTransparentShortcut\(\)/);
  const capture = app.slice(app.indexOf('document.addEventListener("keydown"'), app.indexOf("window.addEventListener(\"keydown\""));
  assert.match(capture, /shouldHandleTransparentShortcut\(e, capKey, capMod\)/);
  assert.match(capture, /activateTransparentShortcut\(\)/);
  assert.match(capture, /shouldHandleMeasureShortcut\(e, capKey, capMod\)/);
  assert.match(capture, /toggleMeasureShortcut\(\)/);
  const bubble = app.slice(app.indexOf('window.addEventListener("keydown"'));
  assert.match(bubble, /shouldHandleTransparentShortcut\(e, key, mod\)/);
  assert.match(html, /Transparent mode \(T\)/);
  assert.match(html, /Move \/ Rotate \(G\)/);
  assert.match(html, /data-measure-pick="auto"/);
  assert.match(html, /20260915-measure1/);
  const canvas = readFileSync(join(here, "../viewport/canvas-mode.js"), "utf8");
  assert.match(canvas, /t: "text"/);
});

test("Orbit pick mode keeps selection so R can rotate", () => {
  const start = app.indexOf("function activatePickMode");
  const end = app.indexOf("function canUseViewportSelectGesture", start);
  const fn = app.slice(start, end > start ? end : start + 2500);
  assert.match(fn, /Orbit: hide the gizmo so left-drag rotates the camera/);
  assert.match(fn, /selected body so R \/ G \/ S can re-open/);
  assert.match(fn, /preserveGizmoMode/);
  const offIdx = fn.lastIndexOf("Orbit: hide the gizmo");
  const off = fn.slice(offIdx, offIdx + 450);
  assert.equal(off.includes("objectTools.clearSelection()"), false);
  assert.match(off, /transformControls\.detach\(\)/);
});

test("cache-bust 20260914-ttrans1 is on app.js", () => {
  assert.match(html, /app\.js\?v=20260908-.*ttrans1/);
  assert.match(app, /gizmo-panel\.js\?v=20260908-xf-dup-rscale1/);
});

test("cache-bust 20260914-ttrans2 is on app.js", () => {
  assert.match(html, /app\.js\?v=.*20260914-ttrans2/);
  assert.match(app, /gizmo-panel\.js\?v=.*20260914-ttrans2/);
});

test("Esc restores transparent CAD parts to solid then deselects", () => {
  assert.match(app, /function hasViewportTransparentSelection/);
  assert.match(app, /function exitViewportTransparentSelection/);
  assert.match(app, /function shouldRestoreViewportTransparentOnEscape/);
  assert.match(app, /function isClipEditorPointerTarget/);
  const exit = app.slice(
    app.indexOf("function exitViewportTransparentSelection"),
    app.indexOf("function entireModelTransparentTargets"),
  );
  assert.match(exit, /setTransparentPickEnabled\(false\)/);
  assert.match(exit, /clearViewportTransparent\(\)/);
  const gate = app.slice(
    app.indexOf("function shouldRestoreViewportTransparentOnEscape"),
    app.indexOf("function activateObjectTransformShortcut"),
  );
  assert.match(gate, /isAiPromptShortcutTarget/);
  assert.match(gate, /isEditableShortcutTarget/);
  assert.match(gate, /isClipEditorPointerTarget/);
  assert.match(gate, /isClipEditorTabActive/);
  assert.match(gate, /isCanvasDesignTabActive/);
  assert.match(gate, /viewportSearch\?\.isOpen/);
  const escStart = app.indexOf('if (e.key === "Escape") {\n    if (isClipEditorPointerTarget');
  assert.ok(escStart >= 0, "Esc clip-editor guard missing");
  const esc = app.slice(escStart, app.indexOf("function getVoiceMoldDesignContext"));
  const restoreAt = esc.indexOf("shouldRestoreViewportTransparentOnEscape");
  const measureAt = esc.indexOf("measureModeActive");
  const gizmoAt = esc.indexOf("transformControls.detach");
  const clearAt = esc.indexOf("objectTools.clearSelection");
  assert.ok(restoreAt >= 0 && measureAt > restoreAt, "Esc restores transparent before measure cancel");
  assert.ok(gizmoAt > restoreAt && clearAt > restoreAt, "Esc restores transparent before gizmo/deselect");
  assert.match(esc, /isClipEditorPointerTarget\(e\.target\) \|\| isClipEditorTabActive\(\)/);
  assert.match(esc, /exitViewportTransparentSelection\(\)/);
  assert.equal(esc.includes("exitViewportTransparentSelection();\n      return;"), false);
  assert.match(html, /app\.js\?v=.*esctran1/);
});

test("cache-bust 20260914-agentpop1 is on app.js", () => {
  assert.match(html, /app\.js\?v=.*20260914-agentpop1/);
});

test("cache-bust 20260914-agentlock1 is on app.js", () => {
  assert.match(html, /app\.js\?v=.*20260914-agentlock1/);
});

test("cache-bust 20260914-agentbtn1 is on app.js", () => {
  assert.match(html, /app\.js\?v=.*20260914-agentbtn1/);
});

test("cache-bust 20260916-voicewake1 is on app.js", () => {
  assert.match(html, /app\.js\?v=.*20260916-voicewake1/);
});

test("cache-bust 20260916-vrwalk1 is on app.js", () => {
  assert.match(html, /app\.js\?v=.*20260916-vrwalk1/);
});

test("toolbar Gizmo button turns gizmo on from Orbit via last selected / assembly", () => {
  const start = app.indexOf("function toggleToolbarGizmo");
  assert.ok(start >= 0, "toggleToolbarGizmo missing");
  const fn = app.slice(start, start + 900);
  assert.match(fn, /isToolbarGizmoShown/);
  assert.match(fn, /resolveTransformShortcutTarget\(\)/);
  assert.match(fn, /showObjectGizmo\(mesh\)/);
  assert.equal(fn.includes('classList.toggle("active")'), false);
  assert.equal(fn.includes("objectTools.getSelection()?.mesh"), false);
  assert.match(app, /e\.target\.closest\("#btn-joints"\)/);
  assert.match(app, /toggleJointsOverlay\(\)/);
  assert.match(app, /createJointOverlay/);
  assert.match(app, /refreshJointOverlay/);
  const click = app.slice(app.indexOf('const btn = e.target.closest("#btn-gizmo")'), app.indexOf('const btn = e.target.closest("#btn-gizmo")') + 280);
  assert.match(click, /toggleToolbarGizmo\(\)/);
  assert.equal(click.includes('classList.toggle("active")'), false);
  assert.match(app, /function syncSelectObjectHintVisibility/);
  assert.match(app, /function dismissSelectObjectHint/);
  assert.match(app, /function openDeleteProjectDialog/);
  assert.match(app, /function openDeleteConfirmDialog/);
  assert.match(app, /className = "auth-modal app-rename-modal app-delete-project-modal"/);
  assert.equal(app.includes("window.confirm(\n    `Delete project"), false);
  assert.equal(app.includes('window.confirm(`Delete "${filename}" from this project?`)'), false);
  assert.equal(app.includes('window.confirm(`Delete ${kind} "${entry.name}" from this project?`)'), false);
  const pick = app.slice(app.indexOf("function activatePickMode"), app.indexOf("function activatePickMode") + 2200);
  assert.match(pick, /showPickHintBanner\("object"\)/);
  assert.match(pick, /showPickHintBanner\(mode\)/);
});

test("pick-mode HUD is a compact blue pill with Esc to exit", () => {
  const css = readFileSync(join(here, "styles.css"), "utf8");
  assert.match(app, /face: \{ title: "Select faces to add to AI prompt", text: "" \}/);
  assert.match(app, /corner: \{ title: "Select corners to add to AI prompt", text: "" \}/);
  assert.match(app, /edge: \{ title: "Select edges to add to AI prompt", text: "" \}/);
  assert.match(app, /lasso: \{ title: "Lasso a region to add to AI prompt", text: "" \}/);
  assert.match(app, /line: \{ title: "Click points to add a path", text: "" \}/);
  assert.match(app, /object: \{ title: "Select objects to move", text: "" \}/);
  assert.match(app, /function applyPickHint/);
  assert.match(app, /function showPickHintBanner/);
  assert.match(app, /const PICK_HINT_HIDE_MS = 3000/);
  assert.match(app, /function isPickHintBannerMobile/);
  assert.match(app, /Render3DMobileChrome\?\.isMobileShell/);
  assert.match(app, /isMobileInteraction\(\)/);
  assert.equal(app.includes("Multiple faces supported"), false);
  assert.equal(app.includes("Click faces to add @face-N"), false);
  assert.match(html, /id="viewport-hint"/);
  assert.match(html, /Select faces to add to AI prompt/);
  assert.match(html, /id="pick-hint-esc"/);
  assert.match(html, />Esc to exit</);
  assert.match(html, /id="btn-transparent-viewport"/);
  assert.match(html, /20260915-pickhud1/);
  assert.match(html, /20260915-pickesc1/);
  assert.match(html, /selbanner2/);
  const hintStart = css.indexOf("\n.viewport-hint {");
  assert.ok(hintStart >= 0, "compact .viewport-hint rule missing");
  const hint = css.slice(hintStart, hintStart + 1400);
  assert.match(hint, /width: max-content;/);
  assert.match(hint, /max-width: min\(230px, calc\(100% - 320px\)\);/);
  assert.match(hint, /\.viewport-hint--pick/);
  assert.match(css, /\.viewport-hint-esc \{/);
  assert.match(css, /\.viewport-hint strong \{\s*display: block;/);
  const chrome = readFileSync(join(here, "../components/mobile-app-chrome.css"), "utf8");
  assert.match(chrome, /html\.mobile-app-locked \.viewport-hint--pick/);
});

test("Canvas tab owns Cmd+Z and Delete instead of CAD viewport shortcuts", () => {
  assert.match(app, /function isCanvasDesignTabActive/);
  assert.match(app, /isCanvasDesignTabActive\(\) && \(isUndo \|\| isRedo\)\) return/);
  const del = app.indexOf("function isCanvasDesignTabActive");
  const delFn = app.slice(del, del + 2500);
  assert.match(delFn, /if \(isCanvasDesignTabActive\(\)\) return/);
});

test("agent shortcuts.json lists T transparent and M measure", () => {
  const shortcuts = JSON.parse(readFileSync(join(here, "../docs/agent/shortcuts.json"), "utf8"));
  const viewport = shortcuts.contexts.find((c) => c.id === "viewport");
  const canvas = shortcuts.contexts.find((c) => c.id === "canvas");
  const clip = shortcuts.contexts.find((c) => c.id === "clip-editor");
  const combos = Object.fromEntries(viewport.keys.map((k) => [k.combo, k.action]));
  assert.match(combos.T, /Transparent/i);
  assert.match(combos.M, /Measure/i);
  assert.match(combos.G, /Transform|move/i);
  assert.match(canvas.keys.find((k) => k.combo === "T").action, /text/i);
  assert.ok(clip.keys.some((k) => k.combo === "Space"));
  const clipMap = Object.fromEntries(clip.keys.map((k) => [k.combo, k.action]));
  assert.match(clipMap.Space, /restart/i);
  assert.match(clipMap.T, /Trim/i);
  assert.match(clipMap.M, /Mute/i);
  assert.match(clipMap.C, /Copy/i);
  assert.match(clipMap.V, /Paste/i);
});

test("Transparent ▾ All objects ghosts every eligible part and off restores", () => {
  assert.match(html, /id="btn-transparent-options"/);
  assert.match(html, />All objects</);
  assert.match(html, /data-transparent-mode="entire"/);
  assert.match(app, /function applyEntireModelTransparent/);
  assert.match(app, /applyAllTransparentSelection/);
  assert.match(app, /restoreAllTransparentSelection/);
  const off = app.slice(
    app.indexOf("function setTransparentPickEnabled"),
    app.indexOf("function toggleTransparentPick"),
  );
  assert.match(off, /clearViewportTransparent\(\)/);
  assert.match(off, /transparentModeAfterDisable\(\)/);
});
