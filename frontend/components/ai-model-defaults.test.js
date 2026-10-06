import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_AI_MODEL, CHEAP_CHAT_MODEL, ASTRA_MODEL_OPTIONS, defaultTextModel } from "./ai-model-defaults.js";

test("text defaults and primary option agree on Astra", () => {
  assert.equal(DEFAULT_AI_MODEL, "gpt-6-astra");
  assert.equal(CHEAP_CHAT_MODEL, "gpt-5.6-luna");
  assert.equal(ASTRA_MODEL_OPTIONS[0].value, DEFAULT_AI_MODEL);
  assert.equal(defaultTextModel(), DEFAULT_AI_MODEL);
  assert.equal(defaultTextModel([{value:"gpt-5.6-luna"}, ...ASTRA_MODEL_OPTIONS]), DEFAULT_AI_MODEL);
});

test("GPT-6.1 Sol is selectable without changing the default", () => {
  assert.deepEqual(ASTRA_MODEL_OPTIONS[1], { value: "gpt-6.1-sol", label: "GPT-6.1 Sol · $2/$10" });
  assert.equal(DEFAULT_AI_MODEL, "gpt-6-astra");
});

test("restricted provider options never receive an unavailable model", () => {
  const choices = [{value:"claude-fable-5-1"}, {value:"claude-sonnet-4-5"}];
  assert.equal(defaultTextModel(choices, "claude-sonnet-4-5"), "claude-sonnet-4-5");
  assert.equal(defaultTextModel(choices), "claude-fable-5-1");
});

test("main authoring, wiring, assistant and Sandbox consume the shared default", () => {
  for (const file of ["../studio/app.js", "./ai-key-ui.js", "./render-agent.js", "../sandbox/office-agents.js", "../sandbox/agent-tasks.js"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /import \{[^}]*DEFAULT_AI_MODEL[^}]*\} from ["'][^"']*ai-model-defaults\.js/);
    assert.doesNotMatch(source, /(?:selected|newModel|RENDER_AGENT_MODEL_ID) = "gpt-5\.6-(sol|luna)"/);
  }
});
