import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
const scene = readFileSync(join(here, "scene-style.js"), "utf8");

test("grid defaults off and is not a session-global leftover", () => {
  assert.match(app, /const DEFAULT_GRID_VISIBLE = false/);
  assert.match(app, /let gridVisible = DEFAULT_GRID_VISIBLE/);
  assert.match(app, /const GRID_VISIBLE_KEY = "render3d:gridVisible:v1"/);
  assert.match(html, /id="btn-grid"[^>]*aria-pressed="false"/);
  assert.equal(/id="btn-grid"[^>]*\bactive\b/.test(html), false);
});

test("New Project uses studio pref for grid and does not persist onto the last project", () => {
  const start = app.indexOf("function beginBlankNewProject");
  const end = app.indexOf("function showEmptyProjectViewport", start);
  assert.ok(start >= 0 && end > start);
  const fn = app.slice(start, end);
  assert.match(fn, /newProjectPending = true/);
  assert.match(fn, /setGridVisible\(readNewProjectGridVisible\(\), \{ persist: false \}\)/);
  assert.match(fn, /applySavedViewportLook\(\{ persist: false \}\)/);
  assert.match(app, /const LS_NEW_PROJECT_GRID_VISIBLE = "render3d:newProjectGridVisible:v1"/);
  assert.match(app, /function readNewProjectGridVisible/);
  assert.match(app, /if \(raw === "0"\) return false/);
  assert.match(app, /if \(raw === "1"\) return true/);
  assert.match(app, /return true;/);
  assert.match(app, /id="pref-new-project-grid"/);
  assert.match(app, /id="pref-new-project-grid"[^>]*checked/);
  assert.match(app, /Grid on for new projects/);
  assert.match(html, /id="viewport-new-project-grid"/);
  assert.match(html, /id="viewport-new-project-grid"[^>]*checked/);
  assert.match(html, /Default when you create a New Project/);
  assert.match(html, /Does not toggle the grid in this viewport/);
  assert.match(css, /\.viewport-grid-menu-pref input:checked/);
  assert.match(app, /function syncNewProjectGridPrefControls/);
  assert.match(app, /function setNewProjectGridVisible/);
  assert.match(app, /for \(const id of \["pref-new-project-grid", "viewport-new-project-grid"\]\)/);
  assert.match(app, /function persistProjectGridVisible/);
  assert.match(app, /if \(!pid \|\| newProjectPending\) return/);
  assert.match(app, /function toggleGrid\(\) \{\n  setGridVisible\(!gridVisible, \{ persist: true \}\)/);
  assert.match(app, /applyProjectGridPreference\(id\)/);
  const arch = app.slice(app.indexOf("function exitArchitectMode"), app.indexOf("function syncRiggingToolbelt"));
  assert.equal(arch.includes("setGridVisible(true)"), false);
  assert.match(arch, /applyProjectGridPreference\(\)/);
});

test("dark viewport canvas is charcoal studio, not Onshape mid-gray", () => {
  assert.match(scene, /canvas: 0x0d1117/);
  assert.match(scene, /lookdevCanvas: 0x0d1117/);
  assert.match(css, /#viewport \{\n[\s\S]*?background: #0d1117;/);
  assert.equal(scene.includes("canvas: 0x4d5258"), false);
  assert.equal(scene.includes("lookdevCanvas: 0x454a50"), false);
  assert.equal(css.includes("background: #4d5258;"), false);
});

test("Wire mode uses CAD feature edges and never GLB triangle wireframe", () => {
  const start = scene.indexOf("export function setViewMode");
  const end = scene.indexOf("function isCadStyledObject", start);
  const fn = scene.slice(start, end);
  assert.match(fn, /if \(viewMode === "wireframe"\) ensureCadEdges\(object3d\)/);
  assert.match(fn, /const hasFeatureEdges = meshHasFeatureEdges\(child\)/);
  assert.doesNotMatch(fn, /mat\.wireframe = true/);
});

test("click-to-turn keeps full CAD lighting instead of dimming fill/rim lights", () => {
  const start = scene.indexOf("export function setCadOrbitLite");
  assert.ok(start >= 0);
  const fn = scene.slice(start, scene.indexOf("export function setupRenderer", start));
  assert.match(fn, /child\.visible = true/);
  assert.equal(fn.includes("child.visible = !next"), false);
  assert.equal(fn.includes("shadowFloor.visible = !next"), false);
  assert.match(app, /setCadOrbitLite\(orbitBusy/);
});

test("cache-bust gridoff1 and charcoal2 is on app.js, scene-style, and styles", () => {
  assert.match(app, /scene-style\.js\?v=20260908-xr-robotics1-gridoff1-charcoal2-cadedgeaa1-turnbright1-cadcolor1-bootedge1-20260915-cadcolor2-20260915-lightgear1/);
  assert.match(html, /app\.js\?v=20260908-.*turnbright1/);
  assert.match(html, /app\.js\?v=20260908-.*gridpref1/);
  assert.match(html, /styles\.css\?v=[^"']*gridpref1/);
  assert.match(html, /app\.js\?v=20260908-.*profopen1/);
  assert.match(html, /app\.js\?v=20260908-.*improveon1/);
  assert.match(html, /styles\.css\?v=[^"']*improveon1/);
  assert.match(html, /app\.js\?v=20260908-.*gridauto1/);
  assert.match(html, /styles\.css\?v=[^"']*gridauto1/);
  assert.match(html, /app\.js\?v=20260908-.*collabpill1/);
  assert.match(html, /app\.js\?v=20260908-.*hudcard1/);
  assert.match(html, /app\.js\?v=20260908-.*voicemold2-cadcolor1/);
});

test("Improve defaults on for new projects and keeps a saved per-project off", () => {
  assert.match(app, /const DEFAULT_SPICE_ENABLED = true/);
  assert.match(app, /const SPICE_KEY = "render3d:spice-prompt:v2"/);
  assert.match(html, /id="prompt-spice"[^>]*aria-pressed="true"/);
  assert.match(html, /class="prompt-spice-btn is-on"/);
  const start = app.indexOf("function beginBlankNewProject");
  const end = app.indexOf("function showEmptyProjectViewport", start);
  assert.ok(start >= 0 && end > start);
  const fn = app.slice(start, end);
  assert.match(fn, /setSpiceEnabled\(DEFAULT_SPICE_ENABLED, \{ persist: false \}\)/);
  assert.match(app, /function persistProjectSpiceEnabled/);
  assert.match(app, /if \(!pid \|\| newProjectPending\) return/);
  assert.match(app, /function applyProjectSpicePreference/);
  assert.match(app, /seedSpiceFromNewProject/);
  assert.match(app, /return pid \? `\$\{SPICE_KEY\}:\$\{pid\}` : null/);
});

test("CAD Debug is a session sticky toggle that injects debug prompts", () => {
  assert.match(html, /id="prompt-cad-debug"[^>]*aria-pressed="false"/);
  assert.match(html, /id="prompt-cad-debug-wrap"/);
  assert.match(app, /const CAD_DEBUG_KEY = "render3d:cad-debug:v1"/);
  assert.match(app, /const DEFAULT_CAD_DEBUG_ENABLED = false/);
  assert.match(app, /function setCadDebugEnabled/);
  assert.match(app, /function isCadDebugActive/);
  assert.match(app, /CAD DEBUG BRIEF:/);
  assert.match(app, /cad_debug: true/);
  assert.match(app, /cad_debug_brief:/);
  assert.match(app, /function persistProjectCadDebugEnabled/);
  assert.match(app, /initPromptCadDebugToggle/);
  assert.match(app, /getCadDebugBodyFields/);
  assert.doesNotMatch(app, /sessionStorage\.setItem\(CAD_DEBUG_KEY, "1"\)/);
  assert.doesNotMatch(app.slice(app.indexOf("function initPromptCadDebugToggle"), app.indexOf("function pushSpiceOverlayProgress")), /openRenderAgent|debugImprove/);
  assert.match(html, /20260915-caddebug1/);
  assert.match(html, /app\.js\?v=.*20260915-caddebug1/);
});

test("shared CAD prompt gear holds Quality Improve Debug Micro edits", () => {
  assert.match(html, /id="prompt-ai-gear"/);
  assert.match(html, /id="prompt-ai-gear-popup"/);
  assert.match(html, /One setting for Jake, VibeCAD, and MAC/);
  assert.doesNotMatch(html, /id="prompt-cad-benchmarks"/);
  assert.doesNotMatch(html, /Configure edit/);
  assert.match(app, /function initPromptAiGear/);
  assert.match(app, /const DEFAULT_MICRO_EDITS_ENABLED = false/);
  assert.match(app, /const DEFAULT_MCMASTER_PARTS_ENABLED = true/);
  const start = app.indexOf("function beginBlankNewProject");
  const end = app.indexOf("function showEmptyProjectViewport", start);
  const fn = app.slice(start, end);
  assert.match(fn, /setCadDebugEnabled\(DEFAULT_CAD_DEBUG_ENABLED, \{ persist: false \}\)/);
  assert.match(fn, /setMcMasterPartsEnabled\(DEFAULT_MCMASTER_PARTS_ENABLED, \{ persist: false \}\)/);
  assert.match(fn, /DEFAULT_MICRO_EDITS_ENABLED/);
  assert.match(html, /styles\.css\?v=[^"']*aigear1/);
  assert.match(html, /app\.js\?v=[^"']*aigear1/);
  assert.match(html, /styles\.css\?v=[^"']*rig1/);
  assert.match(html, /app\.js\?v=[^"']*rig1/);
  assert.match(html, /id="prompt-ai-rig"/);
  assert.match(html, /styles\.css\?v=[^"']*dbgrow1/);
  assert.match(html, /app\.js\?v=[^"']*dbgrow1/);
  assert.match(html, /20260915-caddebug1/);
  assert.match(html, /styles\.css\?v=[^"']*rigtab1/);
  assert.match(html, /app\.js\?v=[^"']*rigtab1/);
  assert.match(html, /styles\.css\?v=[^"']*promptui1/);
  assert.match(html, /app\.js\?v=[^"']*promptui1/);
  assert.match(html, /styles\.css\?v=[^"']*mcmcad1/);
  assert.match(html, /app\.js\?v=[^"']*mcmcad1/);
  assert.match(html, /styles\.css\?v=[^"']*partelect1/);
  assert.match(html, /app\.js\?v=[^"']*partelect1/);
  assert.match(html, />Parts &amp; Electronics</);
  assert.match(html, /id="prompt-mcmaster-parts"/);
  assert.match(html, /id="prompt-electronics"/);
  assert.equal(html.includes("Import electronics models"), false);
});

test("compose mode tabs are exclusive and sit on one row with Settings in the Target corner", () => {
  const gearAt = html.indexOf('id="prompt-ai-gear"');
  const targetAt = html.indexOf('class="prompt-target-row"');
  const rigAt = html.indexOf('id="prompt-cad-rigging"');
  const meshAt = html.indexOf('data-prompt-mode="mesh"');
  assert.ok(targetAt > 0 && gearAt > targetAt, "Settings lives inside the Target panel");
  assert.ok(rigAt > 0 && meshAt > 0 && rigAt > meshAt, "Rig follows Mesh on the mode row");
  assert.match(html, /id="prompt-cad-rigging"[^>]*>Rig</);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /#prompt-pane-compose \.prompt-target-row > \.prompt-ai-gear-btn/);
  assert.match(app, /b\.classList\.toggle\("active", isMode && !cadComposeRigging\)/);
  assert.match(app, /if \(cadComposeRigging\) exitCadComposeRigging\(\)/);
});

test("grid-off clip does not union the hidden 25k floor into the frustum", () => {
  assert.match(app, /const useFloorClip = !!gridVisible && !hideGridForRecording && !isImmersiveXrActive\(\)/);
  assert.match(app, /Hidden 25k-unit floor/);
});

test("desktop look-dev keeps RoomEnvironment IBL and sRGB output", () => {
  assert.match(scene, /_roomEnvTexture = pmrem\.fromScene\(new RoomEnvironment\(\), 0\.04\)\.texture/);
  assert.match(scene, /scene\.environment = env \|\| null/);
  assert.match(scene, /renderer\.outputColorSpace = THREE\.SRGBColorSpace/);
  assert.equal(scene.includes("const env = null;"), false);
});

test("face-dumped CAD keeps authored material colors instead of one grey body", () => {
  assert.equal(scene.includes("|| meshes.length >= 150"), false);
  assert.match(scene, /Face dumps used to require 12% saturated faces/);
  assert.match(scene, /info\.source !== "fallback"/);
});

test("shop-finish CAD keeps relative colors and look-dev instead of white clay", () => {
  assert.match(scene, /function _meshHasAuthoredSurfaceColor/);
  assert.match(scene, /if \(_meshHasAuthoredSurfaceColor\(child\)\) flagged = true/);
  assert.match(scene, /if \(meshes\.some\(_meshHasAuthoredSurfaceColor\)\)/);
  assert.match(scene, /return applyAuthoredStyle\(object3d\)/);
  assert.match(scene, /const forceClay = mode === "clay"/);
  assert.match(scene, /mat\.vertexColors = true/);
  assert.equal(scene.includes("Do NOT infer from color/metalness heuristics"), false);
  assert.match(html, /app\.js\?v=20260908-.*20260915-cadcolor2/);
  assert.match(app, /20260915-cadcolor2/);
});

test("look-dev default drops teal rim/under lights and offers Jake CAD preset", () => {
  assert.equal(scene.includes("0x38e0d0"), false);
  assert.equal(scene.includes("0x4ecdc4"), false);
  assert.equal(scene.includes("0xbfe6ff"), false);
  assert.match(scene, /VIEWPORT_LOOK_PRESETS/);
  assert.match(scene, /id: "jake"/);
  assert.match(scene, /canvas: 0x181f28/);
  assert.match(scene, /export function applyViewportLook/);
  assert.match(scene, /ldRim = new THREE\.DirectionalLight\(0xe4e8ee/);
  assert.match(html, /id="btn-viewport-prefs"/);
  assert.match(html, /id="btn-grid"[\s\S]*id="btn-viewport-prefs"/);
  assert.match(app, /\["viewport", "Viewport"\]/);
  assert.match(app, /pref-look-palette/);
  assert.match(app, /pref-preferred-ai-key/);
  assert.match(app, /pref-share-default/);
  assert.match(app, /pref-grid-visible/);
  assert.match(html, /20260915-lightgear1/);
  assert.match(css, /\.viewport-view-btn--gear/);
  assert.match(html, /id="btn-viewport-look"/);
  assert.match(html, /id="viewport-look-overlay"/);
  assert.match(html, /id="btn-viewport-look-reset"/);
  assert.match(html, /id="btn-viewport-look-new-projects"/);
  assert.match(html, /Use as default for new projects/);
  assert.equal(html.includes("viewport-look-dynamic"), false);
  assert.match(html, /vplit1/);
  assert.match(html, /vplit2/);
  assert.match(html, /vplit3/);
  assert.match(html, /looknew1/);
  assert.match(html, /20260915-lookhud1/);
  assert.match(app, /function commitViewportLook/);
  assert.match(app, /function resetViewportLookDefaults/);
  assert.match(app, /function saveViewportLookAsNewProjectDefault/);
  assert.match(app, /asNewProjectDefault/);
  assert.match(app, /seedFromLive: seedSpiceFromNewProject/);
  assert.match(app, /applySavedViewportLook\(\{ persist: false \}\)/);
  assert.match(app, /id="pref-look-new-projects"/);
  assert.match(app, /syncViewportLookBackground/);
  assert.match(app, /reset to Jake CAD/);
  assert.match(app, /function schedulePersistViewportLookPref/);
  assert.match(scene, /export const DEFAULT_VIEWPORT_LOOK_ID = "jake"/);
  assert.equal(scene.includes("export export"), false);
  assert.equal(scene.includes("_makeLookdevGradientBackground"), false);
  assert.equal(scene.includes("_shiftLookHex"), false);
  assert.match(css, /\.viewport-look-overlay/);
});

test("viewport look reapply does not reload meshes or compound light baselines", () => {
  const savedStart = app.indexOf("function applySavedViewportLook");
  const savedEnd = app.indexOf("function commitViewportLook", savedStart);
  const saved = app.slice(savedStart, savedEnd);
  assert.ok(savedStart >= 0 && savedEnd > savedStart);
  assert.equal(saved.includes("rebuildSceneLightBaselines"), false);
  assert.equal(saved.includes("loadProject("), false);
  assert.equal(saved.includes("loadModel("), false);
  assert.equal(saved.includes("applyViewportStyle"), false);
  assert.equal(saved.includes("disposeStyledModel"), false);

  const commitStart = app.indexOf("function commitViewportLook");
  const commitEnd = app.indexOf("function resetViewportLookDefaults", commitStart);
  const commit = app.slice(commitStart, commitEnd);
  assert.equal(commit.includes("rebuildSceneLightBaselines"), false);
  assert.equal(commit.includes("loadProject("), false);
  assert.equal(commit.includes("clearModelContents"), false);

  const matStart = app.indexOf("function materializeObject");
  const matEnd = app.indexOf("function resolveViewportStyleMode", matStart);
  const mat = app.slice(matStart, matEnd);
  assert.match(mat, /applySavedViewportLook\(\{ persist: false \}\)/);
  assert.equal(mat.includes("loadModel("), false);
  assert.equal(mat.includes("reloadViewportFromProject"), false);

  assert.match(scene, /alreadyOn && !force/);
  assert.match(app, /vplit3/);
  assert.match(app, /looknew1/);
});
