import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  composeSuggestXText,
  composeSuggestXUrl,
  isSuggestAttachment,
  speechRecognitionCtor,
  suggestMicErrorMessage,
  SUGGEST_SENT_CLOSE_MS,
  SUGGEST_X_HANDLE,
} from "./boot-chrome.js";

const here = dirname(fileURLToPath(import.meta.url));

test("X compose tags @A1_Projects and stays within 280", () => {
  const text = composeSuggestXText("The splash overlay should stay after boot.");
  assert.match(text, /@A1_Projects/);
  assert.equal(SUGGEST_X_HANDLE, "@A1_Projects");
  assert.ok(text.length <= 280);
  const url = composeSuggestXUrl("Keep the suggestions popup.");
  assert.match(url, /^https:\/\/x\.com\/intent\/post\?/);
  assert.match(url, /A1_Projects/);
});

test("attachments allow images, txt, pdf and reject others", () => {
  assert.equal(isSuggestAttachment({ name: "shot.png", type: "image/png" }), true);
  assert.equal(isSuggestAttachment({ name: "notes.txt", type: "text/plain" }), true);
  assert.equal(isSuggestAttachment({ name: "spec.pdf", type: "application/pdf" }), true);
  assert.equal(isSuggestAttachment({ name: "payload.exe", type: "application/octet-stream" }), false);
});

test("toolbar socials are crisp SVGs with X @A1_Projects and no Studio on viewport", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(html, /data-boot-social="x"[^>]*href="https:\/\/x\.com\/A1_Projects"/);
  assert.doesNotMatch(html, /data-boot-social="slack"/);
  assert.doesNotMatch(html, /viewBox="0 0 122\.8 122\.8"/);
  assert.match(html, /M18\.244 2\.25h3\.308/);
  assert.match(html, /nav-tab-studio-home/);
  assert.match(html, /Skills Library/);
  assert.match(html, /Tips &amp; Tricks/);
  assert.match(html, /href="\/updates\.html"/);
  assert.match(html, /toolbar-nav\.js\?v=20260908-layout/);
  assert.match(html, /\/studio\/styles\.css\?v=/);
  assert.match(html, /\/studio\/styles\.css\?v=[^"']*20260914-socialdiv1/);
  assert.match(css, /body:has\(#viewport\) .toolbar-nav a\.nav-tab\[href="\/"\]/);
  assert.match(css, /background:\s*transparent/);
  assert.match(css, /shape-rendering:\s*geometricPrecision/);
  assert.match(css, /socials \| Marketplace divider/);
  assert.match(css, /\.toolbar-community \{[\s\S]*?border-right:\s*1px solid/);
});

test("suggest modal lives outside the boot splash", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const boot = html.indexOf('id="studio-boot-screen"');
  const suggest = html.indexOf('id="studio-boot-suggest"');
  const bootClose = html.indexOf("</div>\n  <div id=\"studio-boot-suggest\"");
  assert.ok(boot >= 0 && suggest > boot);
  assert.ok(bootClose > boot);
  assert.ok(html.includes('id="studio-boot-suggest-x"'));
  assert.ok(html.includes('id="studio-boot-suggest-draw"'));
  assert.ok(html.includes('id="studio-boot-suggest-files"'));
  assert.match(html, /early-boot\.js\?v=20260909-suggest-mic1/);
  assert.match(html, /BOOT_MIN_MS = headsetBoot \? 800 : 0/);
  assert.doesNotMatch(html, /BOOT_MIN_MS = headsetBoot \? 800 : 400/);
  assert.doesNotMatch(html, /BOOT_MIN_MS = headsetBoot \? 800 : 5000/);
  assert.match(html, /__studioDeferExplorerThumbs = true/);
});

test("PC boot chrome is socials only — no corner R or wordmark", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.ok(html.includes("studio-boot-pc-chrome"));
  assert.ok(!html.includes("studio-boot-pc-word"));
  assert.ok(!html.includes("studio-boot-pc-logo"));
  assert.ok(!html.includes("studio-boot-pc-brand"));
  assert.match(html, /studio-boot-pc-social[\s\S]*data-boot-social="github"/);
  assert.match(html, /studio-boot-pc-social[\s\S]*data-boot-social="discord"/);
  assert.doesNotMatch(html, /studio-boot-pc-social[\s\S]*data-boot-social="slack"/);
  assert.match(html, /studio-boot-pc-social[\s\S]*data-boot-social="x"/);
  assert.match(html, /render-vr-logo[\s\S]*render-logo-gear-still\.png\?v=20260915-logo1/);
  assert.match(html, /studio-boot-headset-live-svg[\s\S]*render-vr-animated\.svg\?v=20260908-vr-svg1/);
  assert.match(html, /studio-boot-vr-collage/);
  assert.match(html, /\/studio\/styles\.css\?v=[^"']*20260908-/);
  assert.match(html, /\/studio\/styles\.css\?v=[^"']*20260909-vp-load/);
  assert.match(html, /popup-boot-modern\.css\?v=20260909-title-energy1/);
  const pcChrome = css.slice(
    css.indexOf("html:not(.vr-headset-browser) .studio-boot-pc-chrome {"),
    css.indexOf("html.vr-headset-browser .studio-boot-pc-chrome"),
  );
  assert.match(pcChrome, /position:\s*fixed/);
  assert.match(pcChrome, /align-items:\s*(center|flex-end)/);
  assert.ok(!css.includes(".studio-boot-pc-word"));
  const chromeAt = html.indexOf('class="studio-boot-pc-chrome"');
  const cardAt = html.indexOf('class="studio-boot-card"');
  assert.ok(chromeAt >= 0 && cardAt > chromeAt);
  const popup = readFileSync(join(here, "popup-boot-modern.css"), "utf8");
  assert.ok(!popup.includes(".studio-boot-pc-word"));
  assert.ok(html.includes("A148.0 148.0"));
  assert.ok(!html.includes("M160 22l10.2 1.4 4.4 20.2"));
});

test("boot Loading Render Studio title uses clipped energy chrome, not a dark mid stripe", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const popup = readFileSync(join(here, "popup-boot-modern.css"), "utf8");
  assert.match(html, /<span class="studio-boot-title-metal">Loading Render Studio<\/span>/);
  assert.match(html, /popup-boot-modern\.css\?v=20260909-title-energy1/);
  const titleBlockStart = popup.indexOf("/* Chrome letters + clipped energy");
  const titleBlock = popup.slice(titleBlockStart, popup.indexOf("@keyframes text-chrome-sheen"));
  assert.ok(titleBlock.includes(".studio-boot-title-metal"));
  assert.match(titleBlock, /studio-boot-title-energy/);
  assert.equal(titleBlock.includes("#2a3038"), false);
  assert.equal(titleBlock.includes("#4a525c"), false);
  assert.equal(titleBlock.includes("text-chrome-sheen"), false);
  const sheenGroup = popup.slice(
    popup.indexOf("/* Brushed chrome wordmark"),
    popup.indexOf(".studio-boot-title {"),
  );
  assert.equal(sheenGroup.includes(".studio-boot-title-metal"), false);
});

test("toolbar brand-mark is a static gear still with no SMIL spin", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  const stillSvg = readFileSync(
    join(here, "../media/images/render-animations/VR-Animations/render-logo-gear-still.svg"),
    "utf8",
  );
  const toolbar = html.slice(html.indexOf('<header class="toolbar">'), html.indexOf("toolbar-community"));
  assert.match(toolbar, /brand-mark[\s\S]*render-logo-gear-still\.png\?v=20260915-logo1/);
  assert.ok(!toolbar.includes("brand-mark-elec"));
  assert.ok(!toolbar.includes("render-vr-animated"));
  assert.equal(/<(animate|animateTransform)\b/i.test(stillSvg), false);
  assert.match(html, /studio-boot-headset-live-svg[\s\S]*render-vr-animated\.svg\?v=20260908-vr-svg1/);
  assert.match(html, /\/studio\/styles\.css\?v=[^"']*20260908-/);
  assert.match(html, /\/studio\/styles\.css\?v=[^"']*20260909-vp-load/);
  assert.match(html, /\/studio\/styles\.css\?v=[^"']*20260909-logo-still/);
  assert.match(css, /\.brand-mark \.logo \{[\s\S]*background:\s*transparent/);
  assert.match(css, /\.brand-mark-elec[\s\S]*display:\s*none/);
});

test("successful suggestion send shows Sent then closes the overlay", () => {
  const js = readFileSync(join(here, "boot-chrome.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  const early = readFileSync(join(here, "early-boot.js"), "utf8");
  assert.equal(SUGGEST_SENT_CLOSE_MS, 850);
  assert.match(js, /fetch\("\/api\/site\/suggestions"/);
  assert.match(js, /setStatus\("Sent", "ok"\)/);
  assert.match(js, /sendBtn\.textContent = "Sent"/);
  assert.match(js, /closeAfterSentTimer = window\.setTimeout/);
  assert.match(js, /closeSuggest\(\)/);
  assert.match(js, /revokePreviews\(\); \/\/ leakfix31/);
  assert.match(js, /SUGGEST_SENT_CLOSE_MS/);
  assert.match(css, /\.studio-boot-suggest-send\.is-sent/);
  assert.match(early, /boot-chrome\.js\?v=20260909-suggest-mic1/);
  assert.match(html, /early-boot\.js\?v=20260909-suggest-mic1/);
});

test("suggest Transcribe uses Web Speech without waiting for Studio boot", () => {
  const js = readFileSync(join(here, "boot-chrome.js"), "utf8");
  assert.equal(js.includes("Microphone is still loading with Studio"), false);
  assert.match(js, /function warmSuggestMic/);
  const warm = js.slice(js.indexOf("async function warmSuggestMic"), js.indexOf("function startWebSpeech"));
  assert.doesNotMatch(warm, /getUserMedia/);
  assert.match(js, /function toggleSuggestDictation/);
  assert.match(js, /webkitSpeechRecognition/);
  assert.match(js, /Speech recognition is not supported in this browser/);
  assert.equal(
    suggestMicErrorMessage({ name: "NotAllowedError" }),
    "Microphone permission denied. Allow the mic for this site, then try again.",
  );
  assert.equal(suggestMicErrorMessage({ name: "NotFoundError" }), "No microphone found.");
  assert.equal(speechRecognitionCtor({ webkitSpeechRecognition: function WebkitSpeech() {} }).name, "WebkitSpeech");
});

test("CAD design ribbon tab ids include Robotics after Solid and hide Rigging Architect", () => {
  const modes = readFileSync(join(here, "../workspace/workspace-modes.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const ribbon = readFileSync(join(here, "../studio/ribbon.js"), "utf8");
  const start = modes.indexOf("export const DESIGN_RIBBON_TAB_IDS");
  const end = modes.indexOf("const DESIGN_TAB_LABELS");
  const ids = [...modes.slice(start, end).matchAll(/"([A-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["SOLID", "ROBOTICS", "CATALOG", "TEXTURE", "CANVAS", "EDITOR"]);
  assert.match(app, /workspace-modes\.js\?v=20260908-partscat1-20260914-roboticsviser1-20260914-roboticsviser3-hidrig1-20260914-canvasdrop1-hidarch1/);
  assert.match(ribbon, /function _setDesignTab\(tab\)/);
  assert.match(ribbon, /ROBOTICS_CATALOG/);
});

test("mobile chrome hides social icon clusters and fills one grid column", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const css = readFileSync(join(here, "../components/mobile-app-chrome.css"), "utf8");
  assert.match(html, /mobile-app-chrome\.css\?v=20260908-iphone4/);
  assert.match(html, /mobile-app-chrome\.js\?v=20260908-iphone4/);
  assert.match(html, /\/studio\/styles\.css\?v=[^"']*20260908-/);
  assert.match(html, /\/studio\/styles\.css\?v=[^"']*20260909-vp-load/);
  assert.match(css, /\.toolbar \.toolbar-social/);
  assert.match(css, /\.studio-boot-pc-social/);
  assert.match(css, /display:\s*none\s*!important/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
  assert.match(css, /data-right-tab="social"/);
  assert.match(css, /btn-screenshot-viewport/);
});

test("iPhone chrome drops Prompt FABs and keeps view modes on the point tool", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const css = readFileSync(join(here, "../components/mobile-app-chrome.css"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const tools = html.slice(html.indexOf('id="mobile-tools-popup"'), html.indexOf('id="mobile-select-popup"'));
  assert.equal(/mobile-prompt-fab/.test(html), false);
  assert.equal(/data-mobile-tool="ai"/.test(tools), false);
  assert.match(html, /id="mobile-point-view-tray"/);
  assert.match(html, /id="mobile-select-popup"[\s\S]*data-mobile-tool="transparent"/);
  assert.match(html, /id="mobile-select-popup"[\s\S]*data-mobile-tool="section"/);
  assert.match(html, /id="mobile-select-popup"[\s\S]*data-mobile-tool="explode"/);
  assert.match(html, /id="mobile-select-popup"[\s\S]*data-mobile-tool="wire"/);
  assert.match(html, /id="mobile-select-popup"[\s\S]*data-mobile-tool="tree"/);
  assert.match(css, /html\.mobile-app-locked \.mobile-prompt-fab/);
  assert.match(css, /html\.mobile-app-locked \.viewport-grid-bar/);
  assert.match(css, /--app-height/);
  assert.match(css, /z-index:\s*92/);
  assert.match(app, /syncMobilePointViewTray/);
  assert.match(app, /tool === "explode"/);
  assert.match(app, /restoreFullViewportAfterInteraction/);
  assert.match(css, /clip-path:\s*none/);
});

test("headset boot Enter VR reads lastProjectId and PC boot does not", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const headsetAt = html.indexOf("if (headsetBoot)");
  const lastAt = html.indexOf("render3d:lastProjectId");
  const enterAt = html.indexOf("function requestXrEnter");
  const vrBtn = html.indexOf("studio-boot-enter-vr");
  assert.ok(headsetAt >= 0 && lastAt > headsetAt);
  assert.ok(enterAt > headsetAt);
  assert.ok(vrBtn >= 0);
  assert.ok(html.includes("emptyScene: !!tour || !lastId"));
  assert.ok(html.includes("__xrBootPreferredProjectId"));
  assert.ok(html.includes("window.__xrBootPreferredProjectId = lastBootProjectId"));
  assert.ok(html.includes("xrlastproj1"));
  assert.match(html, /headsetBoot = \/OculusBrowser/);
  assert.ok(html.includes("if (headsetBoot && navigator.xr"));
  const enterFn = html.slice(enterAt, html.indexOf("function bindBootXrBtn"));
  assert.equal(/location\.hash\s*=/.test(enterFn), false);
  assert.equal(enterFn.includes("fab.click()"), false);
  assert.ok(enterFn.includes("__enterXrFromBoot"));
  assert.ok(enterFn.includes("startFromUserGesture"));
  assert.ok(enterFn.includes('requestSession(window.__bootXrSessionMode'));
  assert.equal(enterFn.includes("__whenStudioReady"), false);
  assert.equal(enterFn.includes("BOOT_MIN_MS"), false);
  assert.equal(enterFn.includes("studio-ready"), false);
  assert.equal(enterFn.includes("Studio is still loading"), false);
  assert.ok(html.includes("xrenter1"));
  assert.ok(html.includes("early-boot.js?v=20260909-suggest-mic1") && html.includes("xrenter1"));
  assert.equal(html.includes("}, 90);"), false);
  const uaAt = html.indexOf("Desktop Chrome has navigator.xr");
  const uaScript = html.slice(uaAt, uaAt + 700);
  assert.match(uaScript, /var headset = \/OculusBrowser/);
  assert.equal(uaScript.includes("navigator.xr"), true);
  assert.ok(uaScript.indexOf("must NEVER flip") < uaScript.indexOf("var headset"));
});

test("boot percent never rewinds from idle crawl or auth retries", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(html, /var target = 8;/);
  assert.match(html, /target = Math\.max\(target, next\)/);
  assert.doesNotMatch(html, /var target = 88;/);
});
