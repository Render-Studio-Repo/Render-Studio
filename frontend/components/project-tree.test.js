import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tree = readFileSync(join(here, "project-tree.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");

test("Browser chrome is recognized so the viewport wheel can skip it", () => {
  assert.match(tree, /export function isViewportBrowserPointerTarget/);
  assert.match(tree, /#viewport-browser-panel/);
  assert.match(tree, /#btn-viewport-browser-expand/);
  assert.match(tree, /\.design-browser-root/);
  assert.match(tree, /\.browser-context-menu/);
  assert.match(app, /isViewportBrowserPointerTarget/);
  assert.match(app, /function shouldSkipViewportMarkingMenu/);
  assert.match(app, /isCadDockPointerTarget\(target\)[\s\S]{0,80}isViewportBrowserPointerTarget\(target\)/);
});

test("viewport marking-menu capture listeners skip Browser before openMarkingMenu", () => {
  const start = app.indexOf("function shouldSkipViewportMarkingMenu");
  const end = app.indexOf("const featureEditor", start);
  assert.ok(start >= 0 && end > start, "marking-menu skip block missing");
  const block = app.slice(start, end);
  assert.match(block, /viewport\.addEventListener\("pointerdown"/);
  assert.match(block, /viewport\.addEventListener\("pointerup"/);
  assert.match(block, /viewport\.addEventListener\("contextmenu"/);
  assert.equal((block.match(/shouldSkipViewportMarkingMenu\(e\.target\)/g) || []).length, 4);
  const up = block.slice(block.indexOf('viewport.addEventListener("pointerup"'));
  const openAt = up.indexOf("openMarkingMenu");
  const skipAt = up.indexOf("shouldSkipViewportMarkingMenu");
  assert.ok(skipAt >= 0 && skipAt < openAt, "Browser skip must run before the wheel opens");
});

test("Browser tree rows bind contextmenu with preventDefault and the project object menu", () => {
  assert.match(tree, /function bindBrowserRightClick/);
  assert.match(tree, /function swallowBrowserWheelGesture/);
  assert.match(tree, /ev\.preventDefault\(\)/);
  assert.match(tree, /ev\.stopPropagation\(\)/);
  assert.match(tree, /Do not preventDefault — Chromium cancels contextmenu if we do/);
  assert.match(tree, /function showItemContextMenu/);
  assert.match(tree, /Show object/);
  assert.match(tree, /Hide object/);
  assert.match(tree, /Send to AI prompt/);
  assert.match(tree, /Delete component/);
  assert.match(tree, /Export component/);
  assert.match(tree, /bindBrowserRightClick\(li, \(ev\) => \{/);
  assert.match(tree, /showItemContextMenu\(ev, entry, sectionId/);
  assert.match(tree, /bindBrowserRightClick\(btn, \(ev\) => \{/);
  assert.equal(tree.includes("openMarkingMenu"), false);
});

test("cache-bust browserrmb2 is on app.js and project-tree import", () => {
  assert.match(html, /app\.js\?v=[^"']*browserrmb2/);
  assert.match(app, /project-tree\.js\?v=20260908-.*browserrmb2/);
  assert.match(app, /onAttachWiring:/);
});

test("cache-bust treedl1 is on app.js, project-tree, and styles", () => {
  assert.match(html, /app\.js\?v=[^"']*treedl1/);
  assert.match(html, /styles\.css\?v=[^"']*treedl1/);
  assert.match(app, /project-tree\.js\?v=20260908-.*treedl1/);
  assert.match(html, /app\.js\?v=[^"']*profclick1/);
  assert.match(html, /styles\.css\?v=[^"']*rowhover1/);
  assert.match(html, /app\.js\?v=[^"']*rowhover1/);
  assert.match(app, /project-tree\.js\?v=20260908-.*rowhover1/);
});

test("cache-bust browui1 merges without dropping keep tokens", () => {
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(html, /styles\.css\?v=[^"']*browui1/);
  assert.match(html, /app\.js\?v=[^"']*browui1/);
  assert.match(html, /styles\.css\?v=[^"']*browserui1/);
  assert.match(html, /app\.js\?v=[^"']*browserui1/);
  assert.match(html, /styles\.css\?v=[^"']*treekebab1/);
  assert.match(html, /styles\.css\?v=[^"']*20260915-browserdots1/);
  assert.match(html, /styles\.css\?v=[^"']*20260915-treecount1/);
  assert.match(html, /styles\.css\?v=[^"']*canvaskebab1/);
  assert.match(html, /styles\.css\?v=[^"']*canvasopen1/);
  assert.match(html, /styles\.css\?v=[^"']*foldcode1/);
  assert.match(html, /app\.js\?v=[^"']*veditorhub1/);
  assert.match(html, /app\.js\?v=[^"']*clipui1/);
  assert.match(html, /app\.js\?v=[^"']*refsharex1/);
  assert.match(html, /app\.js\?v=[^"']*vidopen1/);
  assert.match(html, /app\.js\?v=[^"']*treesel1/);
  assert.match(html, /app\.js\?v=[^"']*mp3c1/);
  assert.match(html, /app\.js\?v=[^"']*imged1/);
  assert.match(app, /project-tree\.js\?v=[^"']*browui1/);
  assert.match(app, /project-tree\.js\?v=[^"']*browserui1/);
  assert.match(app, /project-tree\.js\?v=[^"']*treekebab1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*browui1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*browserui1/);
  assert.match(css, /\.viewport-browser-sub \{[\s\S]*?display:\s*none/);
  assert.match(css, /margin-right:\s*20px/);
  assert.match(app, /sub\.hidden = true/);
  assert.equal(app.includes("Project ${shortId}"), false);
});

test("VR Creations starts collapsed and persist remembers expand after the user opens it", () => {
  assert.match(tree, /vr_creations:\s*false/);
  assert.match(tree, /TREE_EXPAND_KEY = "render3d:browser-expand:v1"/);
  assert.match(tree, /SECTION_DEFAULTS_REV = 3/);
  assert.match(tree, /defaultsRev: SECTION_DEFAULTS_REV/);
  assert.match(tree, /expanded\.vr_creations = false/);
  assert.match(html, /vrcollapse1/);
  assert.match(app, /project-tree\.js\?v=20260908-.*vrcollapse1/);
});

test("Browser folders start collapsed; the Browser pane stays open", () => {
  assert.match(tree, /components:\s*false/);
  assert.match(tree, /references:\s*false/);
  assert.match(tree, /SECTION_DEFAULTS_REV = 3/);
  assert.match(tree, /expanded\.components = false/);
  assert.match(tree, /function markExpandDirty/);
  assert.match(tree, /if \(!pid \|\| !expandDirty\) return/);
  assert.match(tree, /savedRev >= SECTION_DEFAULTS_REV && Array\.isArray\(saved\?\.childGroups\)/);
  assert.equal(tree.includes("captureFolder || parentEntry.catalog_hardware_folder"), false);
  assert.match(tree, /Folders stay collapsed until the user expands them/);
  assert.match(app, /let viewportBrowserCollapsed = false/);
  assert.match(app, /viewportBrowserCollapsed = localStorage\.getItem\("render3d:viewportBrowserHidden"\) === "1"/);
});

test("cache-bust browcol1 merges without dropping keep tokens", () => {
  assert.match(html, /styles\.css\?v=[^"']*browcol1/);
  assert.match(html, /app\.js\?v=[^"']*browcol1/);
  assert.match(html, /styles\.css\?v=[^"']*browui1/);
  assert.match(html, /app\.js\?v=[^"']*browui1/);
  assert.match(html, /app\.js\?v=[^"']*xcap1/);
  assert.match(app, /project-tree\.js\?v=[^"']*browcol1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*browcol1/);
  assert.match(app, /reference-files\.js\?v=[^"']*browcol1/);
  assert.match(app, /project-tree\.js\?v=[^"']*browui1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*browui1/);
});

test("Reference Files expands Screen Recordings after a capture save", () => {
  assert.match(tree, /revealReferenceFolder\(folderName\)/);
  assert.match(tree, /expanded\.references = true/);
  assert.match(app, /revealSavedReferenceFolder/);
  assert.match(html, /refrec1/);
  assert.match(app, /project-tree\.js\?v=.*refrec1/);
});

test("Shift-select highlights a visible range and right-click can delete the set", () => {
  assert.match(tree, /export function keysInVisibleRange/);
  assert.match(tree, /function applyRangeBrowserSelection/);
  assert.match(tree, /function applyBrowserPointerSelection/);
  assert.match(tree, /e\?\.shiftKey && \(selectionAnchorKey \|\| selectedBrowserKeys\.size\)/);
  assert.match(tree, /onDeleteMany/);
  assert.match(tree, /Delete \$\{deleteCount\} items/);
  assert.match(app, /onDeleteMany:/);
  assert.match(app, /function deleteProjectFiles/);
  assert.match(html, /vrbodies1/);
  assert.match(html, /treesel1/);
  assert.match(app, /project-tree\.js\?v=.*vrbodies1/);
  assert.match(app, /project-tree\.js\?v=.*treesel1/);
  assert.match(app, /workspace-browser\.js\?v=.*treesel1/);
});

test("browser search and view controls live in the panel header", () => {
  const wb = readFileSync(join(here, "../workspace/workspace-browser.js"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(html, /btn-viewport-browser-search/);
  assert.match(html, /viewport-browser-panel-tools/);
  assert.equal(html.includes("btn-viewport-browser-view-grid"), false);
  assert.equal(html.includes("btn-viewport-browser-view-list"), false);
  assert.match(tree, /btn-viewport-browser-search/);
  assert.match(tree, /bindHeaderSearch/);
  assert.match(tree, /TREE_VIEW_KEY/);
  assert.equal(tree.includes("Search ${section.label} by file name"), false);
  assert.equal(tree.includes("data-section-search"), false);
  assert.equal(wb.includes("Search ${section.label} by file name"), false);
  assert.match(tree, /browser-think-overlay/);
  assert.match(css, /\.viewport-browser-panel-tools/);
  assert.match(html, /browserui1/);
  assert.match(html, /styles\.css\?v=[^"']*browserui1/);
  assert.match(app, /project-tree\.js\?v=.*browserui1/);
  assert.match(app, /workspace-browser\.js\?v=.*browserui1/);
});

test("browser row actions sit behind a hover kebab menu", () => {
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(tree, /browser-item-kebab/);
  assert.match(tree, /browser-item-more/);
  assert.match(tree, /attachBrowserRowKebab/);
  assert.match(tree, /More actions/);
  assert.match(tree, /ICON_KEBAB/);
  assert.match(tree, /explorer-action-strip/);
  assert.match(tree, /document\.body\.appendChild\(panel\)/);
  assert.match(html, /treekebab1/);
  assert.match(html, /20260915-browserdots1/);
  assert.match(html, /canvaskebab1/);
  assert.match(app, /project-tree\.js\?v=.*treekebab1/);
  assert.match(app, /project-tree\.js\?v=.*20260915-browserdots1/);
  assert.match(app, /project-tree\.js\?v=.*canvaskebab1/);
  assert.match(app, /project-tree\.js\?v=.*canvasopen1/);
  assert.match(html, /styles\.css\?v=[^"']*treekebab1/);
  assert.match(html, /styles\.css\?v=[^"']*20260915-browserdots1/);
  assert.match(html, /styles\.css\?v=[^"']*canvaskebab1/);
  assert.match(html, /styles\.css\?v=[^"']*canvasopen1/);
  assert.match(css, /\.browser-child-group > \.browser-item-more/);
  assert.match(css, /browser-item-kebab svg/);
  assert.match(css, /\.browser-item-kebab \{[\s\S]*?opacity:\s*0;/);
  assert.match(css, /\.browser-item-more\.is-open \.browser-item-kebab/);
  assert.match(html, /foldcode1/);
  assert.match(html, /styles\.css\?v=[^"']*foldcode1/);
  assert.match(tree, /parentEntry\.virtual_folder && \(sectionId === "references"/);
  assert.match(tree, /browser-open-canvas/);
  assert.match(tree, /onOpenCanvasBoard/);
});

test("Browser rows support CAD export and reference download", () => {
  assert.match(tree, /export function isBrowserDirectDownloadEntry/);
  assert.match(tree, /export function isBrowserCadExportEntry/);
  assert.match(tree, /export function browserDiskFilename/);
  assert.match(tree, /Export body\.\.\./);
  assert.match(tree, /browser-action-download/);
  assert.match(tree, /label: "Download"/);
  assert.match(tree, /onDownload/);
  assert.match(tree, /Add to public profile\/store/);
  assert.match(tree, /onStoreListing/);
  assert.match(app, /function exportOrDownloadBrowserEntry/);
  assert.match(app, /encodeProjectFilePath\(filename\)/);
  assert.match(app, /getVisibleBodyIndices: isSingleBody/);
});

test("Reference Files recording row opens the caption popup on Share to X", () => {
  assert.match(tree, /ICON_SHARE_X/);
  assert.match(tree, /browser-action-share-x/);
  assert.match(tree, /title: "Share to X"/);
  assert.match(tree, /onReferenceShareAction\(entry, sectionId, "share-x"\)/);
  assert.equal(tree.includes("skipCaption: true"), false);
  assert.match(tree, /browserEntryIsVideo\(entry\) && typeof onReferenceShareAction === "function"/);
  const editorAt = tree.indexOf('ed.className = "browser-action-btn browser-action-editor"');
  const shareAt = tree.indexOf("browser-action-share-x");
  assert.ok(shareAt >= 0 && editorAt > shareAt, "Share to X sits before Editor on the hover row");
  assert.match(html, /refsharex1/);
  assert.match(app, /project-tree\.js\?v=.*refsharex1/);
});

test("Video Editor label opens a chooser popup; arrow still expands", () => {
  assert.match(tree, /function showVideoEditorHub/);
  assert.match(tree, /data-browser-folder-arrow/);
  assert.match(tree, /data-browser-folder-label/);
  assert.match(tree, /isVideoHub && onLabel/);
  assert.match(tree, /data-hub-open/);
  assert.match(tree, /data-hub-x/);
  assert.match(tree, /data-hub-download/);
  assert.match(tree, /function hubClipMeta/);
  assert.match(tree, /video-editor-hub-icon/);
  assert.equal(tree.includes("data-hub-discord"), false);
  assert.equal(/data-hub-discord/.test(tree), false);
  assert.match(tree, /onOpenVideoEditor\?\.\(entry\)/);
  assert.match(tree, /onReferenceShareAction\?\.\(entry, "references", "share-x"/);
  assert.match(tree, /onReferenceShareAction\?\.\(entry, "references", "download"\)/);
  assert.match(html, /veditorhub1/);
  assert.match(app, /veditorhub1/);
  assert.match(html, /clipui1/);
  assert.match(app, /clipui1/);
  assert.match(tree, /Open in video editor/);
  assert.match(tree, /folderOpensInCodeEditor/);
  assert.match(html, /vidopen1/);
  assert.match(app, /vidopen1/);
});

test("cache-bust browfold1 merges without dropping keep tokens", () => {
  assert.match(html, /styles\.css\?v=[^"']*browfold1/);
  assert.match(html, /app\.js\?v=[^"']*browfold1/);
  assert.match(html, /styles\.css\?v=[^"']*browcol1/);
  assert.match(html, /app\.js\?v=[^"']*browcol1/);
  assert.match(html, /app\.js\?v=[^"']*browui1/);
  assert.match(app, /project-tree\.js\?v=[^"']*browfold1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*browfold1/);
  assert.match(app, /project-tree\.js\?v=[^"']*browcol1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*browcol1/);
});

test("viewport Browser nests Imagine under Renders and Sketches under Reference Files", () => {
  const wb = readFileSync(join(here, "../workspace/workspace-browser.js"), "utf8");
  const start = tree.indexOf("const SECTIONS = [");
  const end = tree.indexOf("];", start);
  assert.ok(start >= 0 && end > start, "SECTIONS missing");
  const sections = tree.slice(start, end);
  assert.equal(sections.includes('id: "joints"'), false);
  assert.equal(sections.includes('id: "imagine"'), false);
  assert.equal(sections.includes('id: "sketches"'), false);
  assert.match(sections, /id: "renders"/);
  assert.match(sections, /id: "references"/);
  assert.match(tree, /pinnedBrowserFolder\("imagine", "Imagine"/);
  assert.match(tree, /pinnedBrowserFolder\("sketches", "Sketches"/);
  assert.match(tree, /nestRobotsWithUrdfFolder/);
  assert.match(tree, /pinnedBrowserFolder\("robots-urdf", "URDF \/ SRDF"/);
  assert.match(tree, /isRobotUrdfFolder/);
  assert.match(tree, /browser-vis-btn browser-robot-eye/);
  assert.doesNotMatch(tree, /Robots \(URDF \/ SRDF\)/);
  assert.match(sections, /id: "robots", label: "Robots"/);
  assert.match(tree, /isRobotBrowserSection/);
  assert.match(tree, /Hide this robot file in the viewport/);
  assert.doesNotMatch(tree, /sectionId === "robots" \|\| sectionId === "renders" \|\| sectionId === "imagine"/);
  assert.match(tree, /joints: data\.joints \|\| \[\]/);
  assert.match(tree, /browser_section/);
  assert.match(tree, /pinned_folder: true/);
  assert.match(wb, /nestRendersWithImagine\(browser\.renders/);
  assert.match(wb, /nestReferencesWithSketches\(/);
  assert.equal(wb.includes('{ id: "imagine", label: "Imagine", items: browser.imagine'), false);
  assert.equal(wb.includes('{ id: "sketches", label: "Sketches", items: browser.sketches'), false);
});

test("Browser CAD kebab can send Fix wheels and QC rig to agents", () => {
  assert.match(tree, /onFixWheels/);
  assert.match(tree, /browser-action-fix-wheels/);
  assert.match(tree, /Fix wheels/);
  assert.match(tree, /browser-action-qc-rig/);
  assert.match(tree, /QC rig/);
  assert.match(app, /sendSelectedModelsToWheelFix/);
  assert.match(app, /runRigQc/);
  assert.match(app, /\/api\/projects\/\$\{projectId\}\/rigging\/qc/);
});
