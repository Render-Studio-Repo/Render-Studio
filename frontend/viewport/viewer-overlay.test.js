import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("project load HUD is not the McMaster generate pill", () => {
  const overlay = readFileSync(join(here, "viewer-overlay.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(overlay, /function isLoadOverlay/);
  assert.match(overlay, /kind === "project_load" \|\| mode === "load"/);
  assert.match(overlay, /function isCadHarnessOverlay/);
  assert.match(overlay, /function hidesMcmasterHud\(opts = \{\}\) \{\s*\n\s*return !isCadHarnessOverlay\(opts\);/);
  assert.match(overlay, /if \(isLoadOverlay\(overlayOpts\)\) \{\s*\n\s*renderProgress\(\);\s*\n\s*return;/);
  assert.match(overlay, /fetchLogs && !isLoadOverlay\(opts\)/);
  assert.match(app, /kind: "project_load"/);
  assert.match(app, /Do not start the generate HUD here/);
  assert.match(app, /openedGeneration = data\?\.generation/);
  assert.match(app, /resumeGenerationIfNeeded\(id, liveGen\)/);
  assert.match(css, /viewport-spinner--load \.viewport-spinner-mcmaster/);
  assert.match(css, /viewport-spinner--load \.viewport-spinner-electronics/);
  assert.match(css, /viewport-spinner--load \.viewport-progress-cost-chip/);
  assert.match(overlay, /viewport-spinner-electronics/);
  assert.match(overlay, /isRiggingOverlay\(opts\)/);
});

test("expanded generation snapshot controls fit without clipped progress fragments", () => {
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  const overlay = readFileSync(join(here, "viewer-overlay.js"), "utf8");
  assert.match(
    css,
    /\.viewport-spinner--expanded \.viewport-progress-meta\s*\{[^}]*margin-left:\s*0;[^}]*width:\s*100%;/s,
  );
  assert.match(css, /\.viewport-spinner--expanded \.viewport-progress-step,[\s\S]*\.viewport-spinner--expanded \.viewport-progress-pct\s*\{[^}]*display:\s*none\s*!important;/s);
  assert.match(css, /\.viewport-spinner--expanded \.viewport-spinner-head-status\s*\{[^}]*display:\s*inline-flex;/s);
  assert.match(overlay, /viewport-spinner-head-pct/);
  assert.match(overlay, /viewport-spinner-head-elapsed/);
  assert.match(overlay, /headProgressPct\.textContent = `\$\{pct\}%`/);
  assert.match(overlay, /headElapsed\.textContent = clock/);
});
