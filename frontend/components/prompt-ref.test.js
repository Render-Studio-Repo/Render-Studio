import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cadFamilySkillsUsed,
  formatHistoryStatus,
  formatHistoryDuration,
  formatHistoryElapsedClock,
  historyElapsedMs,
  formatPromptModeLabel,
  formatModelLabel,
  formatPromptRef,
  historyModeChipClass,
  isCadPromptModeLabel,
  stripOuterPromptQuotes,
} from "./prompt-ref.js";

test("GPT-6.1 Sol has a stable display label", () => {
  assert.equal(formatModelLabel("gpt-6.1-sol"), "GPT-6.1 Sol");
});

test("cad / v2 / jake mode maps to Jake (text-to-cad)", () => {
  assert.equal(formatPromptModeLabel("cad"), "Jake");
  assert.equal(formatPromptModeLabel("v2"), "Jake");
  assert.equal(formatPromptModeLabel("2.0"), "Jake");
  assert.equal(formatPromptModeLabel("jake"), "Jake");
  assert.equal(formatPromptModeLabel("text to cad"), "Jake");
  assert.equal(formatPromptModeLabel("v2", ["cad"]), "Jake");
});

test("Jake + extra CAD-family skills stays Jake, not multi cad / MAC", () => {
  assert.equal(formatPromptModeLabel("v2", ["cad", "dxf"]), "Jake");
  assert.equal(formatPromptModeLabel("cad", ["cad", "dxf", "blueprint-vision"]), "Jake");
  assert.equal(formatPromptModeLabel("v2", ["cad", "cad-viewer"]), "Jake");
  assert.equal(formatPromptModeLabel("v2", [{ id: "cad" }, { id: "DXF" }]), "Jake");
  assert.notEqual(formatPromptModeLabel("v2", ["cad", "dxf"]), "multi cad");
  assert.notEqual(formatPromptModeLabel("v2", ["cad", "dxf"]), "MAC");
});

test("only dxf stays dxf when the mode is not Jake; vision extras do not rename Jake", () => {
  assert.equal(formatPromptModeLabel("dxf", ["dxf"]), "dxf");
  assert.equal(formatPromptModeLabel("", ["dxf"]), "dxf");
  assert.equal(formatPromptModeLabel("v2", ["dxf"]), "Jake");
  assert.equal(formatPromptModeLabel("cad", ["cad", "blueprint-vision"]), "Jake");
});

test("non-CAD modes keep their product labels", () => {
  assert.equal(formatPromptModeLabel("vibecad", ["cad", "dxf"]), "VibeCAD");
  assert.equal(formatPromptModeLabel("render"), "render");
  assert.equal(formatPromptModeLabel("mesh"), "mesh");
  assert.equal(formatPromptModeLabel("mac"), "MAC");
  assert.equal(formatPromptModeLabel("multi_agent_cad"), "MAC");
  assert.equal(formatPromptModeLabel(""), null);
});

test("copied @prompt: mode field uses Jake vs MAC vs VibeCAD", () => {
  const cad = formatPromptRef({
    promptId: "01f6809ef9af",
    projectId: "d2d551ea",
    promptMode: "v2",
    skills: ["cad"],
    model: "gpt-6-astra",
    traceId: "27d86c26",
  });
  assert.match(cad, /mode:Jake/);
  assert.doesNotMatch(cad, /mode:CAD\b/);
  assert.doesNotMatch(cad, /mode:multi cad/);
  assert.doesNotMatch(cad, /mode:text to cad/);

  const jakeWithDxf = formatPromptRef({
    promptId: "01f6809ef9af",
    projectId: "d2d551ea",
    promptMode: "v2",
    skills: ["cad", "dxf"],
    model: "gpt-6-astra",
    traceId: "27d86c26",
  });
  assert.match(jakeWithDxf, /mode:Jake/);
  assert.doesNotMatch(jakeWithDxf, /mode:multi cad/);
  assert.doesNotMatch(jakeWithDxf, /mode:MAC/);
});

test("cadFamilySkillsUsed keeps internal ids", () => {
  assert.deepEqual(cadFamilySkillsUsed(["cad", "dxf", "blueprint-vision", "cad"]), ["cad", "dxf"]);
});

test("isCadPromptModeLabel covers engine chips", () => {
  assert.equal(isCadPromptModeLabel("Jake"), true);
  assert.equal(isCadPromptModeLabel("MAC"), true);
  assert.equal(isCadPromptModeLabel("VibeCAD"), true);
  assert.equal(isCadPromptModeLabel("render"), false);
  assert.equal(isCadPromptModeLabel("mesh"), false);
});

test("history mode chip is purple for mesh, yellow for CAD", () => {
  assert.equal(historyModeChipClass("mesh"), "ph-mode ph-mode--mesh");
  assert.equal(historyModeChipClass("mesh_beta"), "ph-mode ph-mode--mesh");
  assert.equal(historyModeChipClass(formatPromptModeLabel("img2threejs")), "ph-mode ph-mode--mesh");
  assert.equal(historyModeChipClass(formatPromptModeLabel("fusion")), "ph-mode ph-mode--mesh");
  assert.equal(historyModeChipClass("Jake"), "ph-mode");
  assert.equal(historyModeChipClass("MAC"), "ph-mode");
  assert.equal(historyModeChipClass("render"), "ph-mode");
});

test("history status shows Aborted for stopped/canceled, not Generating or Failed", () => {
  assert.deepEqual(formatHistoryStatus({ status: "running", success: false }), {
    state: "pending",
    label: "Generating",
  });
  assert.deepEqual(formatHistoryStatus({ status: "stopped", success: false }), {
    state: "aborted",
    label: "Aborted",
  });
  assert.deepEqual(formatHistoryStatus({ status: "canceled", success: false }), {
    state: "aborted",
    label: "Aborted",
  });
  assert.deepEqual(formatHistoryStatus({ status: "cancelled", success: false }), {
    state: "aborted",
    label: "Aborted",
  });
  assert.deepEqual(formatHistoryStatus({ status: "aborted", success: false }), {
    state: "aborted",
    label: "Aborted",
  });
  assert.deepEqual(
    formatHistoryStatus({ success: false, error: "Stopped by user." }),
    { state: "aborted", label: "Aborted" },
  );
  assert.deepEqual(formatHistoryStatus({ success: false, error: "Design failed" }), {
    state: "err",
    label: "Failed",
  });
  assert.deepEqual(formatHistoryStatus({ success: true }), {
    state: "ok",
    label: "OK",
  });
});

test("history duration uses HUD clock and real timestamps only", () => {
  assert.equal(formatHistoryElapsedClock(0), "0s");
  assert.equal(formatHistoryElapsedClock(12_000), "12s");
  assert.equal(formatHistoryElapsedClock(134_000), "2m 14s");
  assert.equal(formatHistoryElapsedClock(3_780_000), "1h 03m");

  assert.equal(
    formatHistoryDuration({ elapsed_ms: 134_000, success: true }),
    "2m 14s",
  );
  assert.equal(
    formatHistoryDuration({
      started_at: "2026-09-08T12:00:00.000Z",
      finished_at: "2026-09-08T13:03:00.000Z",
      success: true,
    }),
    "1h 03m",
  );
  assert.equal(
    formatHistoryDuration({
      created_at: "2026-09-08T12:00:00.000Z",
      completed_at: "2026-09-08T12:00:12.000Z",
      success: true,
    }),
    "12s",
  );
  assert.equal(
    formatHistoryDuration({ created_at: "2026-09-08T12:00:00.000Z", success: true }),
    null,
  );
  assert.equal(
    historyElapsedMs(
      { status: "running", started_at: "2026-09-08T12:00:00.000Z" },
      Date.parse("2026-09-08T12:02:14.000Z"),
    ),
    134_000,
  );
  assert.equal(
    formatHistoryDuration(
      { status: "running", created_at: "2026-09-08T12:00:00.000Z" },
      Date.parse("2026-09-08T12:02:14.000Z"),
    ),
    "2m 14s",
  );
  assert.equal(
    formatHistoryDuration({ status: "stopped", elapsed_ms: 45_000, success: false }),
    "45s",
  );
});

test("completed mesh job 69794ca88ccb maps to purple mesh + OK (not aborted)", () => {
  const modeLabel = formatPromptModeLabel("mesh", [
    "architect",
    "urdf",
    "dxf",
    "img2threejs",
    "cad",
  ]);
  assert.equal(modeLabel, "mesh");
  assert.equal(historyModeChipClass(modeLabel), "ph-mode ph-mode--mesh");
  assert.deepEqual(
    formatHistoryStatus({
      id: "69794ca88ccb",
      success: true,
      prompt_mode: "mesh",
      error: null,
    }),
    { state: "ok", label: "OK" },
  );
});

test("stripOuterPromptQuotes removes wrapping quotes only", () => {
  assert.equal(stripOuterPromptQuotes(""), "");
  assert.equal(stripOuterPromptQuotes(null), "");
  assert.equal(stripOuterPromptQuotes("  add a 4 mm fillet  "), "add a 4 mm fillet");
  assert.equal(stripOuterPromptQuotes('"add a 4 mm fillet"'), "add a 4 mm fillet");
  assert.equal(stripOuterPromptQuotes("'keep the M3 holes'"), "keep the M3 holes");
  assert.equal(stripOuterPromptQuotes("\u201Ckeep the 2\" holes\u201D"), 'keep the 2" holes');
  assert.equal(stripOuterPromptQuotes("\"keep the 2\" holes\""), 'keep the 2" holes');
  assert.equal(stripOuterPromptQuotes("\u201Cadd a 4 mm fillet\u201D"), "add a 4 mm fillet");
  assert.equal(stripOuterPromptQuotes("\"\u201Cnested wrap\u201D\""), "nested wrap");
  assert.equal(stripOuterPromptQuotes('it is 2" long'), 'it is 2" long');
});
