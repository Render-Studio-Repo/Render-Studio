import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import {
  AUDIO_TAB_CACHE,
  audioCommentsPanelHtml,
  audioPlayerHtml,
  formatAudioClock,
  isAudioFilename,
  peaksCacheKey,
  rememberAudioPeaks,
  cachedAudioPeaks,
  sanitizeAudioPeaks,
  studioCommentAuthor,
} from "./audio-document-tab.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
const refs = readFileSync(join(here, "./reference-files.js"), "utf8");
const tabs = readFileSync(join(here, "../studio/document-tabs.js"), "utf8");

test("mp3 and wav names open as audio documents", () => {
  assert.equal(isAudioFilename("lozee 2.Mp3"), true);
  assert.equal(isAudioFilename("bed.wav"), true);
  assert.equal(isAudioFilename("clip.webm"), false);
});

test("audio player html has play, waveform bars, and comment form", () => {
  const markup = audioPlayerHtml({
    src: "blob:audio",
    peaks: [0.2, 0.9, 0.4, 0.7],
    comments: [{ id: "c1", text: "drop here", t: 2, author_name: "Sam", avatar_url: "/avatars/sam.png" }],
    duration: 10,
  });
  assert.match(markup, /data-ref-audio-play/);
  assert.match(markup, /data-ref-audio-wave/);
  assert.match(markup, /share-waveform-bars/);
  assert.match(markup, /data-ref-audio-comment-form/);
  assert.match(markup, /data-t="2"/);
  assert.match(markup, /\/avatars\/sam\.png/);
  assert.match(audioCommentsPanelHtml([{ text: "nice", t: 1.5, author_name: "Alex" }]), /nice/);
  assert.match(audioCommentsPanelHtml([{ text: "nice", t: 1.5, author_name: "Alex" }]), /Alex/);
  assert.equal(formatAudioClock(75), "1:15");
});

test("peaks cache on the file key and never invent a second decode path", () => {
  const key = peaksCacheKey({ projectId: "p1", filename: "lozee 2.Mp3", size: 12 });
  rememberAudioPeaks(key, [0.2, 0.8, 0.5]);
  assert.deepEqual(cachedAudioPeaks(key), [0.2, 0.8, 0.5]);
  const sanitized = sanitizeAudioPeaks([0, 2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], 24);
  assert.equal(sanitized.length, 8);
  assert.ok(sanitized.every((h) => h >= 0.08 && h <= 1));
});

test("comment author reuses studio profile avatar", () => {
  const author = studioCommentAuthor({ id: "u1", display_name: "Sam", avatar_url: "" });
  assert.equal(author.display_name, "Sam");
  assert.match(author.avatar_url, /\/api\/users\/u1\/avatar/);
});

test("cache-bust mp3c1 merges without dropping keep tokens", () => {
  assert.equal(AUDIO_TAB_CACHE, "mp3c1");
  assert.match(html, /styles\.css\?v=[^"']*mp3c1/);
  assert.match(html, /app\.js\?v=[^"']*mp3c1/);
  assert.match(html, /styles\.css\?v=[^"']*veditorhub1/);
  assert.match(html, /app\.js\?v=[^"']*veditorhub1/);
  assert.match(app, /reference-files\.js\?v=[^"']*mp3c1/);
  assert.match(app, /document-tabs\.js\?v=[^"']*mp3c1/);
  assert.match(refs, /audio-document-tab\.js\?v=[^"']*mp3c1/);
  assert.match(tabs, /kind === "audio"/);
  assert.match(css, /\.ref-audio-player\b/);
  assert.match(css, /\.share-waveform-bars\b/);
});
