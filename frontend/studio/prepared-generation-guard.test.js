import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
const start = source.indexOf("function preparedGenerationConflict(");
const end = source.indexOf("\nasync function handlePromptGenerateClick", start);
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.guard = preparedGenerationConflict;`, context);
const guard = context.guard;

test("Design Chat prepared prompts do not require an active Draw board", () => {
  assert.equal(guard({
    preparedPrompt: "Build the approved electronics enclosure",
    source: "design-chat",
    currentProjectId: "bcef5f16",
    preparedProjectId: "bcef5f16",
    drawActive: false,
  }), "");
});

test("Hey AI prepared prompts do not require an active Draw board", () => {
  assert.equal(guard({
    preparedPrompt: "Build the discussed part",
    source: "voice-mold",
    currentProjectId: "bcef5f16",
    preparedProjectId: "bcef5f16",
    drawActive: false,
  }), "");
});

test("XR Draw still rejects a closed board and every source rejects a project switch", () => {
  assert.match(guard({
    preparedPrompt: "Build this board",
    source: "xr",
    currentProjectId: "bcef5f16",
    preparedProjectId: "bcef5f16",
    drawActive: false,
  }), /Draw board changed/);
  assert.match(guard({
    preparedPrompt: "Build this proposal",
    source: "design-chat",
    currentProjectId: "other-project",
    preparedProjectId: "bcef5f16",
    drawActive: true,
  }), /project changed/);
});
