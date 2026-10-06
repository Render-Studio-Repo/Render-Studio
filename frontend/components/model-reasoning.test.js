import test from "node:test";
import assert from "node:assert/strict";
import {
  loadModelReasoning,
  modelReasoningOptions,
  modelReasoningRequestField,
  modelReasoningStorageKey,
  normalizeModelReasoning,
  storeModelReasoning,
} from "./model-reasoning.js";

test("reasoning options are model-specific", () => {
  assert.deepEqual(modelReasoningOptions("openai", "gpt-6.1-sol").map((row) => row.value), ["auto", "low", "medium", "high"]);
  assert.deepEqual(modelReasoningOptions("gemini", "gemini-3.8-flash").map((row) => row.value), ["auto", "low", "medium", "high"]);
  assert.deepEqual(modelReasoningOptions("kimi", "kimi-k3").map((row) => row.value), ["auto", "low", "medium", "high"]);
  assert.deepEqual(modelReasoningOptions("anthropic", "claude-fable-5-1").map((row) => row.value), ["auto"]);
  assert.equal(normalizeModelReasoning("anthropic", "claude-fable-5-1", "high"), "auto");
});

test("saved effort cannot cross-contaminate another model", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  storeModelReasoning("openai", "gpt-6.1-sol", "high", storage);
  storeModelReasoning("openai", "gpt-5.6-luna", "low", storage);
  assert.notEqual(modelReasoningStorageKey("openai", "gpt-6.1-sol"), modelReasoningStorageKey("openai", "gpt-5.6-luna"));
  assert.equal(loadModelReasoning("openai", "gpt-6.1-sol", storage), "high");
  assert.equal(loadModelReasoning("openai", "gpt-5.6-luna", storage), "low");
  assert.equal(loadModelReasoning("anthropic", "claude-fable-5-1", storage), "auto");
  assert.deepEqual(modelReasoningRequestField("openai", "gpt-6.1-sol", storage), { reasoning_effort: "high" });
  assert.deepEqual(modelReasoningRequestField("anthropic", "claude-fable-5-1", storage), {});
});
