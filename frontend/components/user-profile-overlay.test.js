import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "user-profile.css"), "utf8");
const js = readFileSync(join(here, "user-profile.js"), "utf8");
const shareHtml = readFileSync(join(here, "../pages/share.html"), "utf8");
const shareViewer = readFileSync(join(here, "../viewport/share-viewer.js"), "utf8");

test("user-profile open aborts the previous profile GET", () => {
  assert.match(js, /let userProfileAbort = null; \/\/ leakfix75/);
  assert.match(js, /export async function openUserProfile[\s\S]{0,1600}signal: ctl\.signal/);
});

test("hidden profile overlay cannot keep display:grid on the share page", () => {
  assert.match(css, /\.user-profile-overlay\.hidden/);
  assert.match(css, /\.user-profile-overlay\[hidden\]/);
  assert.match(css, /display:\s*none\s*!important/);
  assert.match(js, /function setOverlayVisible\(on\)/);
  assert.match(js, /overlayEl\.hidden = true/);
  assert.match(js, /setOverlayVisible\(false\)/);
  assert.match(js, /setOverlayVisible\(true\)/);
  assert.doesNotMatch(js, /ensureOverlay\(\);\s*\n\s*const tick/);
});

test("share page hides .hidden and never leaves an empty load pill", () => {
  assert.match(shareHtml, /\.hidden\s*\{\s*display:\s*none\s*!important/);
  assert.match(shareHtml, /#share-measure-readout\.hidden/);
  assert.match(shareHtml, /id="share-status-copy"/);
  assert.match(shareHtml, /share-load-track/);
  assert.match(shareHtml, /share-load-track" hidden/);
  assert.match(shareHtml, /user-profile\.css\?v=20260909-.*shareov1/);
  assert.match(shareHtml, /share-viewer\.js\?v=20260908-.*shareov1/);
});

test("self profile settings do not dump receive-money; Payments opens Preferences", () => {
  assert.match(js, /data-profile-open-payments/);
  assert.match(js, /onOpenPreferences\?\.\(\{ tab: "payments" \}\)/);
  assert.equal(js.includes("user-profile-receive-payments"), false);
  assert.equal(js.includes("mountReceivePaymentsSettings"), false);
});

test("share viewer dismisses load HUD on success, error, and stall timeout", () => {
  assert.match(shareViewer, /SHARE_LOAD_STALL_MS/);
  assert.match(shareViewer, /Still preparing preview/);
  assert.match(shareViewer, /setStatus\(`Loading model… \$\{pct\}%`, \{ pct \}\)/);
  assert.match(shareViewer, /setStatus\(""\)/);
  assert.match(shareViewer, /Could not load the 3D model/);
  assert.match(shareViewer, /user-profile\.js\?v=20260909-.*shareov1/);
});

test("share history author avatars open the public profile popup", () => {
  assert.match(js, /onNeedAuth/);
  assert.match(js, /data-profile-friend/);
  assert.match(js, /data-profile-message/);
  assert.match(shareViewer, /share-history-authors\.js\?v=20260915-histprof1/);
  assert.match(shareViewer, /openMarketplaceMessages/);
  assert.match(shareHtml, /20260915-histprof1/);
});
