import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOKSTAT1_TOKEN, tokenCaption, tokenBars } from "./token-status.js";
import { forceOneSpeaker, getTalkMode, setTalkMode, enqueueSpeak } from "./tts-mutex.js";

const here = dirname(fileURLToPath(import.meta.url));

test("token status helpers flag high usage", () => {
  assert.equal(TOKSTAT1_TOKEN, "tokstat1");
  const cap = tokenCaption({
    ok: true,
    lookback: 60,
    tokens_total: 50000,
    tokens_peak: 2000,
    high: true,
    threshold_high: 48000,
    by_result: { continued: 50 },
  });
  assert.match(cap, /HIGH/);
  assert.match(cap, /48000|throttle/i);
  const bars = tokenBars({ series: [{ log_id: "abc123456", tokens: 10, result: "continued" }] });
  assert.equal(bars.length, 1);
  assert.equal(bars[0].n, 10);
});

test("forceOneSpeaker locks talk mode to one", () => {
  setTalkMode("both");
  const out = forceOneSpeaker("test");
  assert.equal(getTalkMode(), "one");
  assert.equal(out.turnTaking, true);
});

test("charts and live-feed wire token lookback", () => {
  const charts = readFileSync(join(here, "charts.js"), "utf8");
  const feed = readFileSync(join(here, "live-feed.js"), "utf8");
  const boot = readFileSync(join(here, "boot.js"), "utf8");
  assert.match(charts, /fetchTokenStatus|token-status/);
  assert.match(charts, /tok Σ|tokens_total/);
  assert.match(feed, /fetchTokenStatus|tokenStatusHtml/);
  assert.match(feed, /promptTail|DEEPER LOG/);
  assert.match(boot, /forceOneSpeaker/);
  assert.doesNotMatch(boot, /setItem\("render3d\.tts\.talkMode", "both"\)/);
});

test("tts one-mode cancels overlap", () => {
  const src = readFileSync(join(here, "tts-mutex.js"), "utf8");
  assert.match(src, /talkMode === "one"/);
  assert.match(src, /speechSynthesis\?\.cancel/);
  assert.match(src, /whoever/);
  assert.equal(typeof enqueueSpeak, "function");
});
