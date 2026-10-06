import test from "node:test";
import assert from "node:assert/strict";
import { checkConfigOverlap } from "./config-overlap.js";

test("config overlap flags talkMode both and extra talk bars", () => {
  const ok = checkConfigOverlap({ talkMode: "one", floor: "" });
  assert.equal(ok.ok, true);
  const both = checkConfigOverlap({ talkMode: "both", floor: "cursor" });
  assert.equal(both.ok, false);
  assert.match(both.label, /overlap/);
});

function fixture({ widgets = 1, shortcuts = 4, voice = 1, bars = 0, crew = 0 } = {}) {
  const counts = {
    ".sb-talk-mode": bars,
    "[data-sb-ask-astra]": widgets,
    "[data-sb-astra], [data-collab-astra], [data-office-open], [data-astra-open]": shortcuts,
    "[data-sb-ask-voice], #sb-talk": voice,
    "#sb-crew": crew,
  };
  return { querySelectorAll: selector => Array(counts[selector] || 0).fill({}) };
}

test("four shortcuts to one chat are not duplicate sessions", () => {
  const result = checkConfigOverlap({ root: fixture(), talkMode: "one" });
  assert.equal(result.askButtons, 4);
  assert.equal(result.askWidgets, 1);
  assert.equal(result.ok, true);
  assert.equal(result.label, "overlap OK");
});

test("duplicate chat mounts are still reported, including hidden mounts", () => {
  const result = checkConfigOverlap({ root: fixture({ widgets: 2 }) });
  assert.equal(result.ok, false);
  assert.match(result.label, /2 Ask Astra widgets/);
});

test("a second independent voice control is reported", () => {
  const result = checkConfigOverlap({ root: fixture({ voice: 2 }) });
  assert.equal(result.ok, false);
  assert.match(result.label, /2 Voice \/ Talk starts/);
});

test("legacy talk groups and crew talk remain conflicts", () => {
  const result = checkConfigOverlap({ root: fixture({ bars: 1, crew: 1 }) });
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 2);
});
