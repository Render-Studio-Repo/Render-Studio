import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  VOICE_BENCH_DECK,
  RNDDEMO1_TOKEN,
  RNDDEMO1_KEEP,
  VOICE_BENCH_PDF,
  isSamSuggestionVoice,
  walkthroughScript,
} from "./rnd-voice-bench.js";
import { pointSlide, slidePage } from "./marketing-slides.js";

test("voice bench deck is four PDF pages with rnddemo1 keep list", () => {
  assert.equal(VOICE_BENCH_DECK.token, RNDDEMO1_TOKEN);
  assert.equal(VOICE_BENCH_DECK.agent, "vibe-rnd");
  assert.equal(VOICE_BENCH_DECK.pages.length, 4);
  assert.deepEqual([...RNDDEMO1_KEEP], ["mktpres1", "rndbench1"]);
  const here = dirname(fileURLToPath(import.meta.url));
  assert.equal(existsSync(join(here, VOICE_BENCH_PDF)), true);
});

test("laser point on a Voice Bench bullet matches Draw-circle marketing slides", () => {
  const page = slidePage(VOICE_BENCH_DECK, 0);
  const first = page.bullets[0];
  const hit = pointSlide(page, { x: first.nx, y: 1 - first.ny });
  assert.equal(hit.pointed.id, first.id);
});

test("Sam suggestion phrases interrupt; walkthrough is Rick pages", () => {
  assert.equal(isSamSuggestionVoice("hold on, suggestion: skip to scorecard"), true);
  assert.equal(isSamSuggestionVoice("wait rick try this instead"), true);
  assert.equal(isSamSuggestionVoice("move the table here"), false);
  const turns = walkthroughScript();
  assert.ok(turns.length >= 8);
  assert.equal(turns.every((t) => t.id === "vibe-rnd"), true);
});

test("sandbox PDF tab and live stats mention the Voice Bench token", () => {
  const superIde = readFileSync(new URL("./super-ide.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(superIde, /rnddemo1|RNDDEMO1_TOKEN|Voice bench/);
  assert.match(html, /os-stats/);
});
