import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claimRenderAgentSubmitKey } from "./render-agent-keyboard.js";

const here = dirname(fileURLToPath(import.meta.url));

test("Render Agent sends only on Cmd/Ctrl+Enter before shared page shortcuts can receive it", () => {
  const calls = [];
  const event = {
    key: "Enter",
    shiftKey: false,
    metaKey: true,
    ctrlKey: false,
    isComposing: false,
    preventDefault: () => calls.push("preventDefault"),
    stopPropagation: () => calls.push("stopPropagation"),
    stopImmediatePropagation: () => calls.push("stopImmediatePropagation"),
  };

  assert.equal(claimRenderAgentSubmitKey(event), true);
  assert.deepEqual(calls, ["preventDefault", "stopPropagation", "stopImmediatePropagation"]);
});

test("Render Agent leaves plain multiline Enter and composing keys alone", () => {
  for (const event of [
    { key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false },
    { key: "Enter", shiftKey: true, isComposing: false },
    { key: "Enter", shiftKey: false, isComposing: true },
    { key: "Escape", shiftKey: false, isComposing: false },
  ]) {
    assert.equal(claimRenderAgentSubmitKey(event), false);
  }
});

test("every Render Agent entry point loads the keyboard-isolated chat build", () => {
  const entryPoints = [
    join(here, "../studio/app.js"),
    join(here, "../site/getting-started.js"),
    join(here, "../site/docs-agent.js"),
  ];
  const imports = entryPoints.map((path) => readFileSync(path, "utf8").match(/render-agent\.js\?v=([^"']+)/)?.[1] || "");
  assert.equal(imports.every(Boolean), true, "Every entry point cache-busts the Render Agent module");
  assert.equal(new Set(imports).size, 1, "All entry points share one Render Agent module instance");
});
