import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const functions = ["chatgptTrialRemaining", "chatgptPickerLabel", "claudePickerLabel", "claudeSubscriptionReady"]
  .map((name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join("\n");
const context = vm.createContext({ aiStatus: {} });
vm.runInContext(functions, context);

test("OpenAI subscription labels distinguish the key source from ChatGPT", () => {
  assert.equal(context.chatgptPickerLabel({ chatgpt: { source: "trial", renders_remaining: 2 } }), "OpenAI Sub · 2 left");
  const status = { chatgpt: { source: "personal", owner_name: "Sam" }, credits: { trial: { kind: "chatgpt_renders", renders_remaining: 3 } } };
  assert.equal(context.chatgptPickerLabel(status), "OpenAI Sub · Sam");
  assert.equal(context.chatgptPickerLabel({}), "OpenAI Sub");
});

test("personal and workspace Claude shares show the owner", () => {
  for (const source of ["personal", "team"]) {
    assert.equal(context.claudePickerLabel({ claude: { source, owner_name: "Sam" } }), "Claude · Sam");
  }
});

test("historical connected metadata never enables Claude models", () => {
  assert.equal(context.claudeSubscriptionReady({ claude: { connected: true, signed_in: false } }), false);
  assert.equal(context.claudeSubscriptionReady({ claude: { source: "personal", signed_in: true } }), true);
});
