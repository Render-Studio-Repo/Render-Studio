import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shareViewer = readFileSync(join(here, "share-viewer.js"), "utf8");
const shareHtml = readFileSync(join(here, "../pages/share.html"), "utf8");

test("share view video download offers mp4 webm gif and audio toggle without sign-in", () => {
  assert.match(shareViewer, /VIDEO_SHARE_FORMATS = \["mp4", "webm", "gif"\]/);
  assert.match(shareViewer, /With audio/);
  assert.match(shareViewer, /Without audio/);
  assert.match(shareViewer, /triggerDirectDownload/);
  assert.match(shareViewer, /download=1/);
  assert.match(shareViewer, /nativeMp4/);
  assert.match(shareViewer, /video_download/);
  assert.match(shareViewer, /avc1/);
  assert.doesNotMatch(shareViewer, /\/api\/share\/\$\{encodeURIComponent\(token\)\}\/video-download/);
  assert.match(shareViewer, /canDownloadShare = canRemixOrDownload \|\| isVideoShare/);
  assert.match(shareViewer, /btnDownloadMenu.classList.toggle\("hidden", !canDownloadShare\)/);
  assert.match(shareViewer, /credentials: "same-origin"/);
  assert.doesNotMatch(shareViewer, /Sign in to convert this clip/);
  assert.match(shareHtml, /body\.share-view-only\.share-video \.share-download-wrap/);
  assert.match(shareHtml, /20260915-shareviddl3/);
  assert.match(shareViewer, /downloadShareVideo/);
  assert.match(shareViewer, /GIF has no audio/);
  assert.match(shareViewer, /shareDownloadLooksPlayable/);
  assert.match(shareViewer, /placeShareDownloadMenu/);
  assert.match(shareViewer, /videoSourceUrl/);
  assert.match(shareHtml, /max-height: min\(70vh/);
});

test("downloadable model shares expose lazy 3MF and Bambu import", () => {
  assert.match(shareViewer, /PRIMARY_SHARE_FORMATS = \["glb", "stl", "step", "3mf"\]/);
  assert.match(shareViewer, /!item\.convertible && typeof item\.size === "number" && item\.size <= 0/);
  assert.match(shareViewer, /Generated when downloaded/);
  assert.match(shareViewer, /Import to Bambu/);
  assert.match(shareViewer, /openInBambuStudio/);
});

test("share History lists author avatars that open the public profile popup", () => {
  assert.match(shareViewer, /share-history-authors\.js\?v=20260915-histprof1/);
  assert.match(shareViewer, /shareHistoryWhoRowHtml/);
  assert.match(shareViewer, /shareHistoryOwnerEntry/);
  assert.match(shareViewer, /bindShareHistoryProfileClicks/);
  assert.match(shareViewer, /openMarketplaceMessages/);
  assert.match(shareViewer, /\/api\/social\/friends/);
  assert.match(shareViewer, /SHARE_HISTORY_PROFILE_KIND/);
  assert.match(shareHtml, /sv-avatar--profile/);
  assert.match(shareHtml, /20260915-histprof1/);
});

test("share preview title uses the product link-preview name", () => {
  assert.match(shareViewer, /Render Studio: All-in-one robotics collaborative workspace/);
  assert.match(shareHtml, /og:title" content="Render Studio: All-in-one robotics collaborative workspace"/);
  assert.match(shareHtml, /og:site_name" content="Render Studio: All-in-one robotics collaborative workspace"/);
  assert.match(shareHtml, /twitter:title" content="Render Studio: All-in-one robotics collaborative workspace"/);
  assert.match(shareHtml, /og:image" content="\/render-logo-gear-og\.png\?oglogo=20260916-1"/);
  assert.match(shareHtml, /twitter:image" content="\/render-logo-gear-og\.png\?oglogo=20260916-1"/);
  assert.match(shareHtml, /oglogo=20260916-1/);
  assert.doesNotMatch(shareHtml, /render3d-og-banner/);
});

test("share page uses a live Three WebGLRenderer canvas", () => {
  assert.match(shareViewer, /new THREE\.WebGLRenderer/);
  assert.doesNotMatch(shareViewer, /createStudioWebGlRenderer/);
  assert.doesNotMatch(shareViewer, /hideSharePoster/);
  assert.doesNotMatch(shareViewer, /showSharePoster/);
  assert.doesNotMatch(shareViewer, /share-poster/);
  assert.doesNotMatch(shareHtml, /id="share-poster"/);
  assert.match(shareHtml, /og:image/);
  assert.match(shareHtml, /share-viewer\.js\?v=[^"']*webglrevert2/);
});

test("share video markup is timeline-synced and fullscreen is removed on mobile", () => {
  assert.match(shareViewer, /createShareVideoMarkup/);
  assert.match(shareViewer, /share-video-markup\.js\?v=20260915-sharemarkup1-20260915-sharelive1/);
  assert.match(shareViewer, /shareFullscreenBlocked/);
  assert.match(shareViewer, /share-no-fs/);
  assert.match(shareHtml, /id="share-video-markup"/);
  assert.match(shareHtml, /id="share-markup-note"/);
  assert.match(shareHtml, /data-share-markup="pen"/);
  assert.match(shareHtml, /data-share-markup="note"/);
  assert.match(shareHtml, /20260915-sharemarkup1-20260915-sharelive1/);
  assert.match(shareHtml, /#btn-share-mobile-fullscreen[\s\S]*display:\s*none\s*!important/);
  assert.match(shareViewer, /videoDownloadMarkup/);
  assert.match(shareViewer, /dataset.shareVideoMarkup/);
  assert.match(shareViewer, /!videoDownloadMarkup && format === "mp4"/);
  assert.match(shareViewer, /shareQs.get\("format"\)/);
  assert.match(shareViewer, /shareQs.get\("audio"\)/);
  assert.match(shareViewer, /shareQs.get\("markup"\)/);
  assert.match(shareHtml, /id="btn-share-markup-view"/);
  assert.match(shareHtml, /id="share-markup-undo"/);
  assert.match(shareHtml, /id="share-link-perms"/);
  assert.match(shareHtml, /share-wave-faces/);
});

test("share Play and drag-yourself expose searchable multi-rig picker", () => {
  assert.match(shareHtml, /id="btn-share-play"/);
  assert.match(shareHtml, /id="btn-share-play-menu"/);
  assert.match(shareHtml, /id="btn-share-drag-open"/);
  assert.match(shareHtml, /id="share-rig-picker"/);
  assert.match(shareHtml, /Search rigs/);
  assert.match(shareViewer, /mergeDiscoveredRigs/);
  assert.match(shareViewer, /shareRigs/);
  assert.match(shareViewer, /setShareDrag/);
  assert.doesNotMatch(shareViewer, /prepareWebGlViewportHost/);
  assert.doesNotMatch(shareHtml, /id="share-poster"/);
});

test("share loads paused; Play starts the default rig or mesh clip and Stop pauses it", () => {
  assert.match(shareViewer, /startShareMotion/);
  assert.match(shareViewer, /stopShareMotion/);
  assert.match(shareViewer, /bindShareGltfClips/);
  assert.match(shareViewer, /new THREE.AnimationMixer/);
  assert.match(shareViewer, /updateShareMotion/);
  assert.match(shareViewer, /if \(shareDragOn\) stopShareMotion/);
  assert.match(shareViewer, /btnSharePlay.textContent = sharePlaying \? "Stop" : "Play"/);
  assert.match(shareViewer, /paused until Play/);
  assert.doesNotMatch(shareViewer, /playing on load/);
  assert.match(shareViewer, /if \(sharePlaying\) stopShareMotion\(\);/);
  assert.doesNotMatch(shareViewer, /shareProcedural\.raf = requestAnimationFrame/);
  assert.doesNotMatch(shareViewer, /prepareWebGlViewportHost/);
  assert.match(shareHtml, /shareplay2/);
  assert.match(shareHtml, /sharepause1/);
});

test("triggerBlobDownload uses triggerTrackedBlobDownload, not 60s hold", () => {
  assert.match(shareViewer, /import \{ triggerTrackedBlobDownload \}/);
  const start = shareViewer.indexOf("function triggerBlobDownload");
  const end = shareViewer.indexOf("\n  async function ", start + 1);
  assert.ok(start >= 0 && end > start, "triggerBlobDownload missing");
  const fn = shareViewer.slice(start, end);
  assert.match(fn, /triggerTrackedBlobDownload\(blob, filename \|\| "render3d-video.mp4", shareDownloadCreated\)/);
  assert.equal(fn.includes("60_000"), false);
  assert.equal(fn.includes("createObjectURL"), false);
  assert.match(shareHtml, /leakfix7/);
});
