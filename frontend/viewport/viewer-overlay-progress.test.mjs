import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatMeterCounter, formatElapsedClock, pctFromChecklist, formatOverlayHarnessLine, formatOverlayHarnessChip, generationUsedCanvas, canvasGenerateChip, CANVAS_GENERATE_CHIP, CANVAS_MESH_GENERATE_CHIP } from "./viewer-overlay.js";

const here = dirname(fileURLToPath(import.meta.url));
const overlaySrc = readFileSync(join(here, "viewer-overlay.js"), "utf8");
const spinnerCss = readFileSync(join(here, "../studio/styles.css"), "utf8");
const genLoaderCss = readFileSync(join(here, "viewport-gen-loader.css"), "utf8");
const appSrc = readFileSync(join(here, "../studio/app.js"), "utf8");
const htmlSrc = readFileSync(join(here, "../index.html"), "utf8");

const step3of8 = { current: 3, total: 8, label: "Author build123d / FreeCAD source" };

assert.equal(pctFromChecklist(step3of8, 70), 70, "HUD bar must match sidebar CAD 70% even on step 3/8");
assert.equal(pctFromChecklist(step3of8, 37), 37);
assert.equal(pctFromChecklist({ current: 8, total: 8 }, 96), 96);
assert.equal(pctFromChecklist({ current: 8, total: 8 }, 100), 100);
assert.equal(pctFromChecklist(step3of8, "nope") >= 0, true);

assert.equal(
  formatMeterCounter(step3of8, { label: "VibeCAD · agent turn 52/200…" }),
  "Turn 52/200",
);
assert.equal(
  formatMeterCounter(step3of8, { counter: "Turn 52/200", label: "ignored" }),
  "Turn 52/200",
);
assert.equal(formatMeterCounter(step3of8, { repair: true }), "Revising");
assert.equal(formatMeterCounter(step3of8, {}), "Author build123d / FreeCAD…");

assert.equal(formatElapsedClock(0), "0s");
assert.equal(formatElapsedClock(12_000), "12s");
assert.equal(formatElapsedClock(72_000), "1m 12s");
assert.equal(formatElapsedClock(3_780_000), "1h 03m");

assert.equal(
  formatOverlayHarnessLine({
    kind: "prompt",
    mode: "ai",
    message: "Codex finished: Concrete_Printer_Electronics_Enclosure.py → Enclosure.step",
    checklist: [
      { id: "brief", label: "Jake brief" },
      { id: "ai_source", label: "Write / edit build123d source" },
      { id: "step", label: "Run scripts/step (STEP / GLB)" },
    ],
  }),
  "Harness: Jake · Codex",
);
assert.equal(formatOverlayHarnessLine({ promptMode: "v2", harness: "jake" }), "Harness: Jake");
assert.equal(formatOverlayHarnessChip({ promptMode: "v2", harness: "jake" }), "Jake");
assert.equal(formatOverlayHarnessChip({ canvas: true }), "CAD 🎨");
assert.equal(formatOverlayHarnessLine({ canvas: true }), "CAD 🎨");
assert.equal(formatOverlayHarnessChip({ canvas: true, promptMode: "mesh" }), "MESH 🎨");
assert.equal(canvasGenerateChip({ promptMode: "v2" }), CANVAS_GENERATE_CHIP);
assert.equal(canvasGenerateChip({ promptMode: "mesh" }), CANVAS_MESH_GENERATE_CHIP);
assert.equal(formatOverlayHarnessLine({ canvas: true, promptMode: "mesh" }), "MESH 🎨");
assert.equal(generationUsedCanvas({ canvas: true }), true);
assert.equal(generationUsedCanvas({ usedCanvas: true }), true);
assert.equal(generationUsedCanvas({ from_canvas: true }), true);
assert.equal(generationUsedCanvas({ request_body: { from_canvas: true } }), true);
assert.equal(generationUsedCanvas({ images: [{ role: "canvas", name: "board.png" }] }), true);
assert.equal(generationUsedCanvas({ prompt: "make a flange" }), false);
assert.equal(formatOverlayHarnessLine({ promptMode: "vibecad" }), "Harness: VibeCAD");
assert.equal(formatOverlayHarnessChip({ promptMode: "vibecad" }), "VibeCAD");
assert.equal(
  formatOverlayHarnessLine({ promptMode: "mesh", wand_version: "2.0.0" }),
  "Mesh wand: img2threejs 2.0.0",
);
assert.equal(formatOverlayHarnessChip({ promptMode: "mesh", wand_version: "2.0.0" }), "Mesh img2threejs 2.0.0");
assert.equal(formatOverlayHarnessLine({ kind: "render", promptMode: "render" }), "");

assert.match(
  overlaySrc,
  /harnessEl\.hidden = !\(expanded \? line : chip\)/,
  "compact generate pill shows harness name next to live cost",
);
assert.match(
  spinnerCss,
  /\.viewport-spinner:not\(\.viewport-spinner--expanded\) \.viewport-spinner-harness/,
);
assert.match(
  genLoaderCss,
  /\.viewport-spinner:not\(\.viewport-spinner--expanded\) \.viewport-spinner-harness/,
);
assert.match(
  overlaySrc,
  /function absorbLiveUsage/,
  "McMaster progress ticks must absorb live AI cost instead of replacing it",
);
assert.ok(appSrc.includes("viewer-overlay.js?v=20260909-sharefast1-hudcard1"));
assert.ok(htmlSrc.includes("styles.css?v="));
assert.ok(htmlSrc.includes("/studio/app.js?v="));
assert.ok(htmlSrc.includes("projopen2-hudcard1"), "keep projopen2 and cache-bust HUD card restore");
assert.ok(htmlSrc.includes("projvp1"), "cache-bust project viewport reveal");
assert.ok(htmlSrc.includes("selbanner1"), "keep select-object banner cache");
assert.ok(htmlSrc.includes("20260915-pickhud1"), "cache-bust compact pick-mode HUD");
assert.ok(htmlSrc.includes("20260915-pickesc1"), "cache-bust pick banner Esc line");
assert.ok(htmlSrc.includes("selbanner2"), "cache-bust 3s pick banner auto-hide");
assert.ok(htmlSrc.includes("gridpref1"), "keep grid preference cache");
assert.ok(htmlSrc.includes("gridauto1"), "cache-bust grid dropdown default");
assert.ok(htmlSrc.includes("collabpill1"), "cache-bust collaborator generating pill");
assert.match(appSrc, /collaboratorGeneratingPeople/);
assert.match(appSrc, /viewport-generation-user--stack/);
assert.ok(overlaySrc.includes("viewport-gen-loader.css?v=20260909-sharefast1-gencost2-canvasload1-mcmcad1-partelect1"));
assert.match(overlaySrc, /function canvasGenerateHost/);
assert.match(overlaySrc, /function mountOverlayRoot/);
assert.match(overlaySrc, /viewport-overlay-root--canvas/);
assert.match(overlaySrc, /CANVAS_GENERATE_CHIP/);
assert.match(overlaySrc, /viewport-spinner--used-canvas/);
assert.match(appSrc, /currentGenerateUsedCanvas/);
assert.match(appSrc, /usedCanvas/);
assert.match(spinnerCss, /timeline-step-icon--canvas/);
assert.match(spinnerCss, /timeline-canvas-paint/);
assert.match(overlaySrc, /syncHost/);
assert.match(appSrc, /viewerOverlay\.syncHost/);
assert.match(appSrc, /canvasload1/);
assert.match(spinnerCss, /viewport-overlay-root--canvas \.viewport-spinner:not\(\.hidden\)/);
assert.match(genLoaderCss, /viewport-overlay-root--canvas \.viewport-spinner:not\(\.hidden\)/);
assert.match(htmlSrc, /canvasload1/);
assert.match(
  spinnerCss,
  /\.viewport-spinner:not\(\.viewport-spinner--expanded\) \.viewport-spinner-who-pct/,
);
assert.match(overlaySrc, /whoPctEl\.hidden = true/);
assert.match(
  overlaySrc,
  /userCollapsedDetails = false;\s*setDetailsOpen\(false\)/,
  "running generation starts as the compact cost pill so the 3D viewport stays visible",
);
assert.match(overlaySrc, /viewport-progress-cost-chip/, "collapsed pill shows live token cost");
assert.match(overlaySrc, /viewport-agent-costing/, "expanded card shows costing amount");
assert.match(overlaySrc, /generating \? 0 : null/, "usage meter stays at $0.00 until the first billed tokens");
assert.match(
  overlaySrc,
  /setDetailsOpen\(!detailsOpen, \{ user: true \}\)/,
  "pill / Hide still toggles collapse",
);
assert.match(overlaySrc, /if \(opts\.focusedJobId\) focusedJobId = String\(opts\.focusedJobId\)/);
assert.match(appSrc, /function markAdditionalGenerationPending/);
assert.match(appSrc, /pendingBaselineCount/);

console.log("viewer-overlay progress percent ok");
