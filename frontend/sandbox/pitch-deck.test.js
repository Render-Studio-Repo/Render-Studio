import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MKTPITCH1_TOKEN,
  SOCIAL_HANDLES,
  SOCIAL_GROWTH_PITCH,
  uvToSlideDelta,
  stepPitchIndex,
  splitMarkdownSlides,
  pitchOutline,
  parseSlideUtterance,
} from "./pitch-deck.js";

test("social growth pitch names real handles and no follower counts", () => {
  assert.equal(SOCIAL_GROWTH_PITCH.token, MKTPITCH1_TOKEN);
  assert.deepEqual([...SOCIAL_HANDLES], ["a1_projects", "winstead_works"]);
  const blob = JSON.stringify(SOCIAL_GROWTH_PITCH);
  assert.match(blob, /a1_projects/);
  assert.match(blob, /winstead_works/);
  assert.doesNotMatch(blob, /\d+\s*(k|followers)/i);
  assert.ok(SOCIAL_GROWTH_PITCH.pages.length >= 5);
});

test("pointing left/right of the PDF steps slides like Bambu plate point", () => {
  assert.equal(uvToSlideDelta({ x: 0.1, y: 0.5 }), -1);
  assert.equal(uvToSlideDelta({ x: 0.9, y: 0.5 }), 1);
  assert.equal(uvToSlideDelta({ x: 0.5, y: 0.5 }), 0);
  assert.equal(stepPitchIndex(0, -1, 5), 4);
  assert.equal(stepPitchIndex(4, 1, 5), 0);
  assert.equal(parseSlideUtterance("next slide").action, "next");
  assert.equal(parseSlideUtterance("hey slide 3").index, 2);
});

test("markdown --- splits become pitch pages", () => {
  const pages = splitMarkdownSlides("# A\n- one\n\n---\n# B\n- two\n");
  assert.equal(pages.length, 2);
  assert.equal(pages[0].title, "A");
  assert.match(pitchOutline(), /mktpitch1/);
});
