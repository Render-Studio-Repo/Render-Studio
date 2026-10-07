import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHARMOVE1_TOKEN,
  BASIC_MOVES,
  SELF_LEARN_AFTER,
  MOVES_PATH,
  recordTaughtBasic,
  proposeSelfLearnedMoves,
  selfLearnReady,
  buildMovesPayload,
  planCharacterMoves,
} from "./character-moves.js";

test("teach basics then self-learn after three", () => {
  assert.equal(CHARMOVE1_TOKEN, "charmove1");
  assert.ok(BASIC_MOVES.includes("approach_desk"));
  assert.ok(BASIC_MOVES.includes("speak_pose"));
  assert.equal(recordTaughtBasic({ move: "fly" }).ok, false);
  const a = recordTaughtBasic({ move: "idle", trainee: "astra" });
  const b = recordTaughtBasic({ move: "approach_desk" });
  const c = recordTaughtBasic({ move: "speak_pose" });
  assert.equal(selfLearnReady([a, b]), false);
  assert.equal(selfLearnReady([a, b, c]), true);
  const learned = proposeSelfLearnedMoves([a, b, c]);
  assert.ok(learned.length >= 1);
  assert.equal(learned[0].quiet, true);
  const book = buildMovesPayload([a, b, c], learned);
  assert.equal(book.path, MOVES_PATH);
  assert.equal(book.workshop, "any workshop");
  assert.equal(book.ready, true);
  const plan = planCharacterMoves([{ id: "cursor-engineer" }, { id: "vibe-marketing" }]);
  assert.equal(plan[0].workshop, "any workshop");
  assert.equal(SELF_LEARN_AFTER, 3);
});

test("teaching panel and collab host character-move teach", () => {
  const teach = readFileSync(new URL("./sandbox-teaching-record.js", import.meta.url), "utf8");
  const collab = readFileSync(new URL("./collaborate-id.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(teach, /character-moves\.js|data-sb-teach-charmove/);
  assert.match(collab, /characterMoveMarkup|data-collab-charmove/);
  const moves = readFileSync(new URL("./character-moves.js", import.meta.url), "utf8");
  assert.match(moves, /onTeachOne|crew-harness/);
  assert.match(html, /id="sb-collab-top"/);
  assert.match(html, /id="sb-collab-ide"/);
});
