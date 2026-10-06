import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GROW_SOCIAL_DECK,
  MKTPRES1_TOKEN,
  pointCircleOnSlide,
  targetsInCircle,
  pointSlide,
  slidePage,
  uvToSlideStep,
} from "./marketing-slides.js";

test("marketing deck is a PDF-page slideshow from MARKETING.md", () => {
  assert.equal(GROW_SOCIAL_DECK.token, MKTPRES1_TOKEN);
  assert.equal(GROW_SOCIAL_DECK.agent, "vibe-marketing");
  assert.ok(GROW_SOCIAL_DECK.pages.length >= 4);
  assert.match(GROW_SOCIAL_DECK.source, /MARKETING.md/);
});

test("Draw-circle point selects the bullet inside the circle", () => {
  const page = slidePage(GROW_SOCIAL_DECK, 0);
  const first = page.bullets[0];
  const circle = pointCircleOnSlide(first.nx, first.ny, 0.08);
  const hits = targetsInCircle(page, circle);
  assert.equal(hits[0].id, first.id);
  const miss = targetsInCircle(page, pointCircleOnSlide(0.02, 0.02, 0.05));
  assert.equal(miss.length, 0);
  const uv = pointSlide(page, { x: first.nx, y: 1 - first.ny });
  assert.equal(uv.pointed.id, first.id);
  assert.equal(uv.token, MKTPRES1_TOKEN);
});

test("pointing the left or right third of a PDF steps the slideshow", () => {
  assert.equal(uvToSlideStep({ x: 0.1 }), -1);
  assert.equal(uvToSlideStep({ x: 0.9 }), 1);
  assert.equal(uvToSlideStep({ x: 0.5 }), 0);
  const blob = JSON.stringify(GROW_SOCIAL_DECK);
  assert.match(blob, /a1_projects/);
  assert.match(blob, /winstead_works/);
  assert.doesNotMatch(blob, /\d+\s*followers/i);
});
