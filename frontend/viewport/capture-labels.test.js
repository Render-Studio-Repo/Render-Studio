import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureFileBaseName,
  captureRecordingFamilyKey,
  duplicateCaptureNames,
  formatRecordingClockName,
  friendlyCaptureDisplayName,
  uniqueRecordingClockName,
} from "./capture-labels.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const labels = readFileSync(join(here, "./capture-labels.js"), "utf8");

test("formatRecordingClockName uses local 12-hour AM/PM and MM.DD.YY", () => {
  const pm = new Date(2026, 11, 21, 15, 30, 0);
  assert.equal(formatRecordingClockName(pm), "recording 3:30 PM 12.21.26");
  const am = new Date(2026, 0, 5, 0, 5, 0);
  assert.equal(formatRecordingClockName(am), "recording 12:05 AM 01.05.26");
  const noon = new Date(2026, 8, 15, 12, 0, 0);
  assert.equal(formatRecordingClockName(noon), "recording 12:00 PM 09.15.26");
  assert.equal(formatRecordingClockName(pm).includes("UTC"), false);
  assert.match(labels, /when\.getHours\(\)/);
  assert.equal(labels.includes("getUTCHours"), false);
});

test("captureFileBaseName videos use the clock name; screenshots stay pretty", () => {
  const date = new Date(2026, 11, 21, 15, 30, 0);
  assert.equal(captureFileBaseName({ kind: "video", date }), "recording 3:30 PM 12.21.26");
  assert.equal(
    captureFileBaseName({ kind: "video", fullscreen: true, date }),
    "recording 3:30 PM 12.21.26",
  );
  assert.equal(
    captureFileBaseName({ kind: "video", page: true, date }),
    "recording 3:30 PM 12.21.26",
  );
  assert.equal(captureFileBaseName({ kind: "screenshot", fullscreen: true }), "Fullscreen-screenshot");
});

test("uniqueRecordingClockName suffixes same-minute collisions", () => {
  const base = "recording 3:30 PM 12.21.26";
  assert.equal(uniqueRecordingClockName(base, []), base);
  assert.equal(uniqueRecordingClockName(`${base}.webm`, []), base);
  assert.equal(uniqueRecordingClockName(base, [`${base}.webm`]), `${base} (2)`);
  assert.equal(
    uniqueRecordingClockName(base, [`${base}.webm`, `${base} (2).webm`]),
    `${base} (3)`,
  );
  assert.equal(
    captureFileBaseName({
      kind: "video",
      date: new Date(2026, 11, 21, 15, 30, 0),
      existingNames: ["recording 3:30 PM 12.21.26.webm"],
    }),
    "recording 3:30 PM 12.21.26 (2)",
  );
});

test("Reference Files tree keeps the AM/PM clock name", () => {
  assert.equal(
    friendlyCaptureDisplayName({
      name: "recording 3:30 PM 12.21.26.webm",
      folder: "Screen Recordings",
    }),
    "recording 3:30 PM 12.21.26",
  );
  assert.equal(
    friendlyCaptureDisplayName({
      name: "recording 3:30 PM 12.21.26 (2).webm",
      folder: "Screen Recordings",
    }),
    "recording 3:30 PM 12.21.26 (2)",
  );
  assert.equal(
    friendlyCaptureDisplayName({
      name: "Fullscreen-recording.webm",
      folder: "Screen Recordings",
    }),
    "Fullscreen recording",
  );
});

test("cache-bust recclock1 is on index.html and capture-labels imports", () => {
  assert.match(html, /app\.js\?v=.*20260915-recclock1/);
  assert.match(html, /styles\.css\?v=.*20260915-recclock1/);
  assert.match(app, /capture-labels\.js\?v=.*20260915-recclock1/);
  assert.match(app, /viewport-video-record\.js\?v=.*20260915-recclock1/);
});

test("duplicate Fullscreen-recording copies keep the open tab and drop siblings", () => {
  assert.equal(captureRecordingFamilyKey("Fullscreen-recording_3.webm"), "fullscreen-recording");
  assert.equal(captureRecordingFamilyKey("Fullscreen-recording_3-edited_12.webm"), "fullscreen-recording");
  assert.equal(captureRecordingFamilyKey("Viewport-recording.webm"), "viewport-recording");
  const extras = duplicateCaptureNames([
    { name: "Fullscreen-recording.webm", mtime: 1 },
    { name: "Fullscreen-recording_2.webm", mtime: 2 },
    { name: "Fullscreen-recording_3.webm", mtime: 3 },
    { name: "Fullscreen-recording_3-edited.webm", mtime: 4 },
    { name: "Viewport-recording.webm", mtime: 9 },
  ], { keepName: "Fullscreen-recording_3.webm" });
  assert.deepEqual(extras.sort(), [
    "Fullscreen-recording.webm",
    "Fullscreen-recording_2.webm",
    "Fullscreen-recording_3-edited.webm",
  ]);
  assert.equal(extras.includes("Viewport-recording.webm"), false);
  const edited = duplicateCaptureNames([
    { name: "Fullscreen-recording_3.webm", mtime: 3 },
    { name: "Fullscreen-recording_3-edited.webm", mtime: 4 },
    { name: "Fullscreen-recording_3-edited_2.webm", mtime: 5 },
  ]);
  assert.ok(edited.includes("Fullscreen-recording_3-edited.webm"));
  assert.ok(edited.includes("Fullscreen-recording_3-edited_2.webm"));
  assert.equal(edited.includes("Fullscreen-recording_3.webm"), false);
  assert.match(app, /removeDuplicateCaptureRecordings/);
  assert.match(app, /recdedupe1/);
  assert.match(html, /recdedupe1/);
});
