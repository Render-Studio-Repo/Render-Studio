import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { liveControlHighlights, paintDebuggerHud, debuggerLayoutPads, debuggerActionFromCanvasPx } from "./xr-debugger-hud.js";
import { formatXrDebuggerLogText, compactXrDebuggerJsonl, recentXrDebuggerLogs, xrDebuggerPopupHtml, xrDebuggerLogIsManual, debuggerLogTag } from "./xr-debugger-popup.js";

test("live highlights show trigger squeeze stick click and extra buttons", () => {
  const lit = liveControlHighlights({
    l: { tr: 1, sq: 0, a: 0, b: 0, ax: [0, 0, 0, 0] },
    r: { tr: 0, sq: 1, a: 1, b: 0, st: 1, ax: [0, 0, 0, 0], x: [2], on: ["rightSqueeze", "rightA", "rightStickClick"] },
  });
  assert.equal(lit.l.tr, true);
  assert.equal(lit.r.sq, true);
  assert.equal(lit.r.a, true);
  assert.equal(lit.r.stick, true);
  assert.deepEqual(lit.r.extra, [2]);
  assert.equal(debuggerLayoutPads("vision").kind, "pinch");
  assert.equal(debuggerLayoutPads("quest3").kind, "touch");
  assert.equal(debuggerLayoutPads("openxr").kind, "touch");
  const move = liveControlHighlights({
    r: { tr: 0, sq: 0, a: 0, b: 0, st: 0, move: 1, ax: [0.8, 0, 0, 0], on: ["rightAxes"] },
  });
  assert.equal(move.r.stick, false);
  assert.equal(move.r.stickMove, true);
});

test("debugger popup lists last 5 ctl logs", () => {
  const html = xrDebuggerPopupHtml({
    name: "20260915-0001-xr-ctl.jsonl",
    text: '{"ev":"dbg"}',
    recent: [
      { name: "20260915-0001-xr-ctl.jsonl", timestamp: "2026-09-15T01:00:00Z" },
      { name: "20260915-0002-xr-perf.jsonl", timestamp: "2026-09-15T01:01:00Z" },
    ],
  });
  assert.match(html, /data-xr-dbg-download/);
  assert.match(html, /data-xr-dbg-load/);
  assert.match(html, /data-xr-dbg-copy/);
  assert.match(html, /data-xr-dbg-file/);
  assert.match(html, />Load</);
  assert.match(html, />Copy</);
  assert.match(html, /Last 5 logs/);
  assert.match(html, /xr-dbg-recent-row/);
  assert.match(html, /xr-dbg-recent-meta/);
  assert.match(html, /20260915-0001-xr-ctl/);
  assert.match(html, /dbg-log-tag--normal/);
  assert.equal(debuggerLogTag({ hitchCount: 3, spikes: [{ where: "xr-frame" }] }), "spike");
  const spikeHtml = xrDebuggerPopupHtml({
    name: "20260915-0001-xr-ctl.jsonl",
    text: "{}",
    payload: { hitchCount: 1, spikes: [{ t: 8, dt: 28, where: "rightTrigger", stack: "tick | xr" }] },
    recent: [{ name: "20260915-0001-xr-ctl.jsonl", description: "XR debugger session", hitchCount: 1, spikeTrace: "8ms dt=28 rightTrigger" }],
  });
  assert.match(spikeHtml, /dbg-log-tag--spike/);
  assert.match(spikeHtml, /rightTrigger/);
  const recent = recentXrDebuggerLogs([
    { name: "a-xr-ctl.jsonl", description: "XR debugger session" },
    { name: "b-xr-perf.jsonl", description: "XR session enter (auto perf + controls)" },
    { name: "c-xr-ctl.jsonl", auto: true },
  ], 5);
  assert.equal(recent.length, 1);
  assert.equal(xrDebuggerLogIsManual({ name: "x-xr-ctl.jsonl", description: "XR debugger session" }), true);
  assert.equal(xrDebuggerLogIsManual({ name: "x-xr-perf.jsonl", description: "XR session enter (auto perf + controls)" }), false);
  assert.match(formatXrDebuggerLogText({ ev: [{ ev: "dbg" }], rows: [{ tr: 1 }] }), /dbg/);
  assert.match(formatXrDebuggerLogText({ hitchCount: 2, framebufferScale: 0.85, spikes: [{ dt: 28 }] }), /hitchCount/);
  const compact = compactXrDebuggerJsonl({ v: 3, kind: "xr-perf", samples: [{ t: 1, fps: 72 }] });
  assert.equal(compact.includes("\n"), false);
  assert.match(compact, /"kind":"xr-perf"/);
  assert.equal(compactXrDebuggerJsonl('{"v":3}\n{"ev":"dbg"}'), '{"v":3}\n{"ev":"dbg"}');
});

test("paint debugger hud does not throw", () => {
  const calls = [];
  const ctx = {
    clearRect() {},
    fillRect() {},
    beginPath() {},
    arc() {},
    ellipse() {},
    rect() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    translate() {},
    fillText(text) { calls.push(String(text)); },
    roundRect() {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
  };
  paintDebuggerHud(ctx, { headset: "quest3", hands: { l: { tr: 1, ax: [], on: ["leftTrigger"] } } });
  assert.ok(calls.some((t) => /Debugger|left trigger|Waiting|Quest/i.test(t)));
  assert.deepEqual(debuggerActionFromCanvasPx(672, 32), { kind: "debugger-action", id: "send-log" });
  assert.equal(debuggerActionFromCanvasPx(400, 32), null);
  assert.ok(calls.includes("Send log"));
});

test("viewport dispatches the debugger Send log action while controls are armed", () => {
  const source = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");
  assert.match(source, /debuggerActionFromCanvasPx/);
  assert.match(source, /"debugger-action"/);
  assert.match(source, /hit\.kind === "debugger-action"/);
  assert.match(source, /sendXrDebugLogToPc\(\)/);
});
