import test from "node:test";
import assert from "node:assert/strict";
import {auditFeature, gitDiffArgs, impactedFeatures, pathMatchesFeature, readFeatureMap, uniqueChecks, unmappedPaths} from "./feature-map.mjs";

test("changed paths resolve every overlapping locked feature", () => {
  const map = readFeatureMap();
  const ids = impactedFeatures(map, ["frontend/studio/document-tabs.js"]).map((feature) => feature.id);
  assert.deepEqual(ids.sort(), ["viewport.layouts", "viewport.one-webgl"].sort());
  assert.equal(pathMatchesFeature("frontend/viewport/foo.js", map.features.find((feature) => feature.id === "viewport.one-webgl")), true);
});

test("feature-map implementation is covered by its own lock", () => {
  const map = readFeatureMap();
  const ids = impactedFeatures(map, ["scripts/feature-map.mjs"]).map((feature) => feature.id);
  assert.deepEqual(ids, ["regression.feature-map"]);
});

test("push verification derives bounded git diffs for existing and new branches", () => {
  assert.deepEqual(gitDiffArgs("abc123", "def456"), ["diff", "--name-only", "-z", "abc123", "def456"]);
  assert.deepEqual(gitDiffArgs("0000000000000000000000000000000000000000", "def456"), [
    "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", "def456",
  ]);
});

test("a mapped file cannot hide an unmapped file in the same update", () => {
  const map = readFeatureMap();
  assert.deepEqual(unmappedPaths(map, [
    "frontend/studio/document-tabs.js",
    "frontend/components/new-unowned-button.js",
  ]), ["frontend/components/new-unowned-button.js"]);
});

test("every locked feature has a durable receipt and mandatory check", () => {
  const map = readFeatureMap();
  for (const feature of map.features.filter((row) => row.lock === "on")) {
    assert.deepEqual(auditFeature(feature), [], feature.id);
  }
  assert.ok(uniqueChecks(map.features).length >= 4);
});

test("interaction contracts must point to owned executable behavior tests", () => {
  const base = {
    id: "buttons.example",
    lock: "on",
    receipt_ids: ["RCPT-20260923-FEATURE-MAP"],
    paths: ["frontend/example.test.js"],
    checks: [{mandatory: true, argv: ["node", "--test", "frontend/example.test.js"]}],
    interaction_checks: [{
      id: "close-popup",
      selector: "[data-close]",
      event: "pointerdown",
      expected: "popup is removed",
      test: "frontend/example.test.js",
    }],
  };
  assert.deepEqual(auditFeature(base), []);
  const broken = structuredClone(base);
  broken.checks[0].argv.pop();
  assert.match(auditFeature(broken).join("\n"), /not in a mandatory check/);
});
