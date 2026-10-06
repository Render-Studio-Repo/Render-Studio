import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commentMarkerLeftPct,
  commentMarkerModels,
  commentMarkerHtml,
  commentsDuration,
  formatCommentTimeLabel,
  playheadPlayedPct,
  seekTimeFromClientX,
  waveformBarHeights,
  waveformBarsHtml,
  amplitudePeaksFromSamples,
  placeholderAmplitudePeaks,
  waveformSampleStride,
  WAVEFORM_MAX_DECODE_BYTES,
  decodeAudioAmplitudePeaks,
} from "./share-video-waveform.js";

const here = dirname(fileURLToPath(import.meta.url));
const shareHtml = readFileSync(join(here, "../pages/share.html"), "utf8");
const shareViewer = readFileSync(join(here, "./share-viewer.js"), "utf8");
const waveform = readFileSync(join(here, "./share-video-waveform.js"), "utf8");

test("comment markers map t seconds onto left % of video duration", () => {
  assert.equal(commentMarkerLeftPct(5, 10), 50);
  assert.equal(commentMarkerLeftPct(0, 20), 0.8);
  assert.equal(commentMarkerLeftPct(20, 20), 99.2);
  assert.equal(commentMarkerLeftPct(99, 10), 99.2);
  assert.equal(commentsDuration([{ t: 3 }], 12.5), 12.5);
  assert.equal(commentsDuration([{ t: 8 }, { t: 2 }], 0), 8);
  const models = commentMarkerModels([
    { id: "a", text: "love this", t: 4, author_name: "Sam", avatar_url: "/avatars/sam.png" },
    { id: "b", text: "pin here", t: 4.05, kind: "pin", author_name: "Alex" },
    { id: "skip", text: "   " },
  ], 10);
  assert.equal(models[0].leftPct, 40);
  assert.equal(models[0].avatarUrl, "/avatars/sam.png");
  assert.equal(models.length, 1);
  assert.equal(models[0].authors.length, 2);
  assert.equal(models[0].stack, 0);
  assert.equal(models[0].kind, "pin");
  assert.equal(models[0].visibleAuthors[1].initial, "A");
  assert.equal(formatCommentTimeLabel(4), "4.0s");
  const html = commentMarkerHtml(models[0]);
  assert.match(html, /data-t="4"/);
  assert.match(html, /left:40\.00%/);
  assert.match(html, /Sam/);
  assert.match(html, /love this/);
  assert.match(html, /\/avatars\/sam\.png/);
  assert.match(html, /share-wave-faces/);
  assert.match(html, /share-wave-time/);
  assert.doesNotMatch(html, /--stack:/);
  const sameAuthor = commentMarkerModels([
    { id: "c1", text: "Face", t: 0, kind: "markup", tool: "face-mark", author_name: "Sam W", author_id: "u1" },
    { id: "c2", text: "Face", t: 0, kind: "markup", tool: "face-mark", author_name: "Sam W" },
    { id: "c3", text: "Circle", t: 0.1, kind: "markup", tool: "circle", author_name: "Sam W", author_id: "u1" },
  ], 20);
  assert.equal(sameAuthor.length, 1);
  assert.equal(sameAuthor[0].authors.length, 1);
});

test("waveform bars, playhead, and click-to-seek stay in 0–duration", () => {
  const bars = waveformBarHeights(48, 7);
  assert.equal(bars.length, 48);
  assert.ok(bars.every((h) => h >= 0.12 && h <= 1));
  assert.match(waveformBarsHtml(bars.slice(0, 2)), /style="--h:/);
  assert.equal(playheadPlayedPct(5, 10), 50);
  assert.equal(playheadPlayedPct(0, 8), 0);
  assert.equal(playheadPlayedPct(12, 10), 100);
  assert.equal(seekTimeFromClientX(150, { left: 100, width: 200 }, 10), 2.5);
  assert.equal(seekTimeFromClientX(0, { left: 0, width: 100 }, 8), 0);
  assert.equal(seekTimeFromClientX(400, { left: 0, width: 100 }, 8), 8);
});

test("amplitude peaks follow loud vs quiet PCM, not a dummy sine", async () => {
  const samples = new Float32Array(2000);
  for (let i = 1000; i < 2000; i += 1) samples[i] = i % 2 ? 0.95 : -0.95;
  const peaks = amplitudePeaksFromSamples(samples, 40);
  assert.equal(peaks.length, 40);
  const first = peaks.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  const last = peaks.slice(28).reduce((a, b) => a + b, 0) / 12;
  assert.ok(last > first + 0.35);
  const dummy = waveformBarHeights(40, 7);
  assert.notDeepEqual(peaks, dummy);
  assert.equal(placeholderAmplitudePeaks(32).length, 32);
  assert.match(waveform, /amplitudePeaksFromSamples/);
  assert.match(waveform, /decodeAudioAmplitudePeaks/);
  assert.match(waveform, /if \(signal\?\.aborted\)/);
  assert.ok(waveformSampleStride(13_000_000, 160) > 100);
  assert.equal(waveformSampleStride(1000, 40), 1);
  assert.ok(WAVEFORM_MAX_DECODE_BYTES <= 8 * 1024 * 1024);
  const huge = new Float32Array(200_000);
  for (let i = 100_000; i < 200_000; i += 1) huge[i] = 0.9;
  const hugePeaks = amplitudePeaksFromSamples(huge, 40);
  assert.equal(hugePeaks.length, 40);
  const quiet = hugePeaks.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  const loud = hugePeaks.slice(28).reduce((a, b) => a + b, 0) / 12;
  assert.ok(loud > quiet + 0.2);
  const fakeBig = { size: WAVEFORM_MAX_DECODE_BYTES + 1, arrayBuffer() { throw new Error("should not decode"); } };
  assert.equal((await decodeAudioAmplitudePeaks(fakeBig, { count: 32 })).length, 32);
});

test("share playback page puts waveform between video and comments", () => {
  assert.match(
    shareHtml,
    /id="share-video"[^]*id="share-video-waveform"[^]*id="share-comment-form"/,
  );
  assert.match(shareHtml, /id="share-waveform-markers"/);
  assert.match(shareHtml, /clipperf1/);
  assert.match(shareHtml, /share-wave-mark:hover/);
  assert.match(shareViewer, /scwave1/);
  assert.match(shareViewer, /share-video-waveform\.js\?v=20260915-scwave1-sharemarkup1-20260915-sharelive1/);
  assert.match(shareViewer, /commentMarkerModels\(shareComments/);
  assert.match(shareViewer, /seekTimeFromClientX/);
  assert.match(waveform, /commentMarkerLeftPct/);
  assert.equal(shareViewer.includes("timelineTrack.innerHTML = shareComments.map"), false);
});
