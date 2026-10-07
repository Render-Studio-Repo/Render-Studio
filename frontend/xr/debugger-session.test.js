import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clickPathFromEvent,
  desktopDebuggerPayload,
  desktopPerfScope,
  setDesktopPerfScope,
  shouldStampHeapJump,
  summarizeDesktopSpikes,
} from "./debugger-session.js";
import {
  debuggerLogTag,
  debuggerSpikeTraceText,
  isDesktopDebuggerLog,
  recentManualDebuggerLogs,
  xrDebuggerPopupHtml,
} from "./xr-debugger-popup.js";

test("heap jump stamp uses the same 24 MB threshold", () => {
  assert.equal(shouldStampHeapJump(24.4, 52), true);
  assert.equal(shouldStampHeapJump(24.4, 40), false);
  assert.equal(shouldStampHeapJump(null, 52), false);
});

test("desktop spike summary tags heap and frame hitches", () => {
  const hitches = summarizeDesktopSpikes([
    { t: 10, dt: 12, fps: 80, memMb: 40 },
    { t: 20, dt: 64, fps: 16, memMb: 41, where: "video-editor-bake", stack: "bake | rAF" },
    { t: 40, dt: 14, fps: 70, memMb: 80 },
  ]);
  assert.equal(hitches.tag, "spike");
  assert.ok(hitches.hitchCount >= 2);
  assert.equal(hitches.spikes.find((row) => row.dt === 64).where, "video-editor-bake");
  assert.match(hitches.spikes.find((row) => row.dt === 64).stack, /bake/);
});

test("desktop debugger payload is a desk-dbg jsonl session", () => {
  setDesktopPerfScope("video-timeline-editor");
  assert.equal(desktopPerfScope(), "video-timeline-editor");
  const payload = desktopDebuggerPayload({
    samples: [{ t: 1, dt: 64, fps: 12, memMb: 90, where: "video-editor-bake", stack: "tick" }],
    clicks: [{ t: 2, path: "button#btn-prompt", x: 10, y: 12 }],
  });
  assert.equal(payload.kind, "desktop-perf");
  assert.match(payload.filename, /desk-dbg\.jsonl$/);
  assert.equal(payload.tag, "spike");
  assert.match(payload.spikeTrace, /video-editor-bake/);
  setDesktopPerfScope("");
});

test("click path prefers id and class", () => {
  const path = clickPathFromEvent({
    target: { tagName: "BUTTON", id: "foundry-desk-dbg-record", className: "btn accent", getAttribute() { return "Record"; } },
  });
  assert.match(path, /button#foundry-desk-dbg-record/);
});

test("popup last-5 tags spike vs normal and shows where-trace", () => {
  assert.equal(debuggerLogTag({ hitchCount: 0 }), "normal");
  assert.equal(debuggerLogTag({ hitchCount: 2, spikes: [{ dt: 28, where: "xr-frame" }] }), "spike");
  assert.match(debuggerSpikeTraceText({ spikes: [{ t: 12, dt: 28, where: "draw", stack: "tick | xr" }] }), /draw/);
  assert.equal(isDesktopDebuggerLog({ name: "20260916-1805-desk-dbg.jsonl" }), true);
  const recent = recentManualDebuggerLogs([
    { name: "a-desk-dbg.jsonl", description: "Desktop debugger session", tag: "spike", hitchCount: 1, timestamp: "2026-09-16T12:00:00Z", spikeTrace: "12ms dt=64 video-editor-bake" },
    { name: "b-xr-ctl.jsonl", description: "XR debugger session", hitchCount: 0 },
    { name: "c-xr-perf.jsonl", description: "XR session enter (auto perf + controls)", auto: true },
  ], 5);
  assert.equal(recent.length, 2);
  const html = xrDebuggerPopupHtml({
    name: "20260916-1805-desk-dbg.jsonl",
    text: "{}",
    title: "Debugger session",
    payload: { hitchCount: 1, tag: "spike", spikes: [{ t: 12, dt: 64, where: "video-editor-bake", stack: "tick" }] },
    recent,
  });
  assert.match(html, /Debugger session/);
  assert.match(html, /dbg-log-tag--spike/);
  assert.match(html, /video-editor-bake/);
  assert.match(html, /Last 5 logs/);
});
