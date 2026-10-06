import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const markup = readFileSync(join(here, "./screenshot-markup.js"), "utf8");
const video = readFileSync(join(here, "./viewport-video-record.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");

test("markup tools sit in one top bar with a Share control", () => {
  assert.match(markup, /class="screenshot-markup-bar"/);
  assert.match(markup, /data-shot-tool="pan"/);
  assert.match(markup, /data-shot-tool="pen"/);
  assert.match(markup, /data-shot-tool="highlight"/);
  assert.match(markup, /data-shot-tool="rect"/);
  assert.match(markup, /data-shot-tool="arrow"/);
  assert.match(markup, /data-shot-tool="text"/);
  assert.match(markup, /data-shot-tool="eraser"/);
  assert.match(markup, /data-shot-action="undo"/);
  assert.match(markup, /data-shot-action="redo"/);
  assert.match(markup, /data-shot-action="clear"/);
  assert.match(markup, /data-shot-share-run/);
  assert.match(markup, /data-shot-share-toggle/);
  assert.equal(markup.includes("ref-markup-toolbar"), false);
  assert.match(css, /\.screenshot-markup-bar\s*\{/);
  assert.match(css, /overflow-x:\s*auto/);
});

test("Share dropdown includes Slack, Discord, X, copy link, and download", () => {
  assert.match(markup, /data-shot-share-target="slack"/);
  assert.match(markup, /data-shot-share-target="discord"/);
  assert.match(markup, /data-shot-share-target="x"/);
  assert.match(markup, /data-shot-share-target="link"/);
  assert.match(markup, /data-shot-share-action="download"/);
  assert.match(markup, /shareToSlack\(X_SHARE_SITE/);
  assert.match(markup, /shareToDiscord\(X_SHARE_SITE/);
  assert.match(markup, /share-chat\.js\?v=20260909-sharechat1/);
});

test("Share button shows the last-chosen target logo and persists it", () => {
  assert.match(markup, /render3d:shotShareTarget:v1/);
  assert.match(markup, /return "slack"/);
  assert.match(markup, /data-shot-share-logo/);
  assert.match(markup, /data-shot-share-current/);
  assert.match(markup, /function syncShareButton/);
  assert.match(markup, /logo\.innerHTML = SHARE_LOGOS\[target\]/);
  assert.match(markup, /localStorage\.setItem\(SHARE_TARGET_KEY/);
});

test("screenshot Share to X matches the video compose-then-download path", () => {
  assert.match(markup, /https:\/\/x\.com\/intent\/post/);
  assert.match(markup, /params\.set\("text", caption\)/);
  assert.match(markup, /https:\/\/render3d\.app/);
  assert.equal(/if \(!win\) window\.location\.href = url/.test(markup), false);
  assert.match(markup, /async function shareViaComposeAttach/);
  assert.match(markup, /Pick X in the share sheet — the photo goes with the post/);
  assert.match(markup, /X compose is open with your caption\. Your PNG just downloaded/);
  assert.match(markup, /canAttachMediaViaShareSheet/);
  const shotAttach = markup.slice(markup.indexOf("async function shareViaComposeAttach"), markup.indexOf("async function postToX"));
  assert.ok(shotAttach.indexOf("downloadMarkedPng") < shotAttach.indexOf("openXCompose"));
  assert.match(video, /https:\/\/x\.com\/intent\/post/);
  assert.equal(/if \(!win\) window\.location\.href = url/.test(video), false);
  assert.match(video, /async function shareViaComposeAttach/);
  assert.match(markup, /Built in Render Studio/);
  assert.match(video, /Built in Render Studio/);
  assert.match(markup, /const X_SHARE_DEFAULT = `\\n\\n\$\{X_SHARE_ATTRIBUTION_LINE\}`/);
  assert.match(video, /const X_SHARE_DEFAULT = `\\n\\n\$\{X_SHARE_ATTRIBUTION_LINE\}`/);
  assert.match(markup, /X_SHARE_ATTRIBUTION_LINE = `\$\{X_SHARE_ATTRIBUTION\} \$\{X_SHARE_SITE\}`/);
  assert.match(video, /X_SHARE_ATTRIBUTION_LINE = `\$\{X_SHARE_ATTRIBUTION\} \$\{X_SHARE_SITE\}`/);
});

test("shotshare1 cache-busts screenshot markup", () => {
  assert.match(app, /screenshot-markup\.js\?v=20260909-shotshare1/);
  assert.match(html, /shotshare1/);
  assert.match(html, /styles\.css\?v=[^"]*shotshare1/);
  assert.match(app, /sharexfix=20260916-1/);
  assert.match(html, /sharexfix=20260916-1/);
  assert.match(app, /sharex=20260916-1/);
  assert.match(html, /sharex=20260916-1/);
  assert.match(app, /leakfix6/);
  assert.match(html, /leakfix6/);
});

test("triggerPngDownload uses triggerTrackedBlobDownload, not 60s revoke", () => {
  assert.match(markup, /import \{ triggerTrackedBlobDownload \}/);
  const start = markup.indexOf("function triggerPngDownload");
  const end = markup.indexOf("\n  function ", start + 1);
  assert.ok(start >= 0 && end > start, "triggerPngDownload missing");
  const fn = markup.slice(start, end);
  assert.match(fn, /triggerTrackedBlobDownload\(blob, filename, shotDownloadCreated\)/);
  assert.equal(fn.includes("60_000"), false);
  assert.equal(fn.includes("createObjectURL"), false);
});
