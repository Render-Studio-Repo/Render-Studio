import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SANDBOX4_TOKEN,
  collectDecisionVotes,
  riskRewardScript,
  overcomeSuggestions,
  buildDecisionBrief,
  voteSplitLine,
} from "./decision-brief.js";

test("decision brief collects seated votes and a spoken risk/reward", () => {
  const brief = buildDecisionBrief("Quest trigger still dead", { kind: "debug" });
  assert.equal(brief.token, SANDBOX4_TOKEN);
  assert.equal(brief.speaker, "astra");
  assert.equal(brief.votes.length, 6);
  assert.ok(brief.votes.some((v) => v.agent === "analytics"));
  assert.ok(brief.votes.some((v) => v.agent === "clip-bot"));
  assert.match(brief.script, /^Risk:/);
  assert.match(brief.script, /Reward:/);
  assert.match(brief.script, /vote/i);
  assert.match(voteSplitLine(brief), /\d+ /);
  const tips = overcomeSuggestions(brief);
  assert.equal(tips.length, 6);
  assert.equal(tips.every((t) => t.silent === true), true);
  const again = collectDecisionVotes("Quest trigger still dead", { kind: "debug" });
  assert.deepEqual(again.counts, brief.counts);
});
