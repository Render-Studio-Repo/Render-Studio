import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendMentionWithTrailingSpace,
  insertMentionWithTrailingSpace,
} from "./prompt-mention-space.js";

test("completing @face3 adds a trailing space so the next word is separated", () => {
  const atEnd = appendMentionWithTrailingSpace("make ", "@face3");
  assert.equal(atEnd.value, "make @face3 ");
  assert.equal(atEnd.caret, "make @face3 ".length);

  const replacing = insertMentionWithTrailingSpace("make @fa", "@face3", 5, 8);
  assert.equal(replacing.value, "make @face3 ");
});

test("does not double-space when a space is already after the caret", () => {
  const next = insertMentionWithTrailingSpace("see  please", "@face3", 4, 4);
  assert.equal(next.value, "see @face3 please");
});

test("hash canvas tags get the same trailing space", () => {
  const next = appendMentionWithTrailingSpace("from", "#piece-example");
  assert.equal(next.value, "from #piece-example ");
});

test("empty prompt still gets a space after the tag", () => {
  assert.equal(appendMentionWithTrailingSpace("", "@face3").value, "@face3 ");
});
