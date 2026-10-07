import { test } from "node:test";
import assert from "node:assert/strict";
import { isMarketplaceSearchQuestion, discoveryCardsHtml, marketplaceProductHref, safeMarketplaceImage, marketplaceSpeechRecognitionCtor } from "./marketplace-discovery.js";

test("explicit shopping intent is separate from Studio create/debug/install commands", () => {
  assert.equal(isMarketplaceSearchQuestion("Find a similar robot model in the marketplace"), true);
  assert.equal(isMarketplaceSearchQuestion("Recommend free electronics skills"), true);
  assert.equal(isMarketplaceSearchQuestion("Show me how to generate a model"), false);
  assert.equal(isMarketplaceSearchQuestion("Find and fix my model"), false);
  assert.equal(isMarketplaceSearchQuestion("How do I install a skill?"), false);
  assert.equal(isMarketplaceSearchQuestion("Help me set up my store"), false);
  assert.equal(isMarketplaceSearchQuestion("Where can I find model settings?"), false);
});

test("listing links stay on real product routes and escape unsafe markup", () => {
  const item = { id: "one", kind: "model", name: '<img onerror="attack()">', description: "<script>alert(1)</script>", href: "javascript:alert(1)", thumbnail_url: "javascript:alert(1)" };
  const html = discoveryCardsHtml({ listings: [item] });
  assert.ok(html.includes("/marketplace.html#/p/model/one"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("<script>"));
  assert.equal(marketplaceProductHref({ kind: "private", id: "x" }), "");
  assert.equal(safeMarketplaceImage("data:text/html;base64,QQ=="), "");
});

test("empty search and hidden prices are honest", () => {
  assert.match(discoveryCardsHtml({ listings: [] }), /No matching listings yet/);
  assert.match(discoveryCardsHtml({ login_required: true }), /Sign in/);
  const html = discoveryCardsHtml({ show_prices: false, listings: [{ id: "x", kind: "agent", name: "Agent", price_cents: 9900 }] });
  assert.ok(!html.includes("99.00"));
  assert.ok(html.includes("View in marketplace"));
});

test("voice search uses an available browser speech provider", () => {
  function Standard() {}
  function Webkit() {}
  assert.equal(marketplaceSpeechRecognitionCtor({ SpeechRecognition: Standard, webkitSpeechRecognition: Webkit }), Standard);
  assert.equal(marketplaceSpeechRecognitionCtor({ webkitSpeechRecognition: Webkit }), Webkit);
  assert.equal(marketplaceSpeechRecognitionCtor({}), null);
});
