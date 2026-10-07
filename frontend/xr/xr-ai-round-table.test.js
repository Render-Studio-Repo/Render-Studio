import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROUNDTBL1_CACHE,
  ROUND_TABLE_REQUEST_ID,
  ROUND_TABLE_LAST3,
  roundTableRoster,
  tableSeatLayout,
  nextIdeaTurn,
  ideaTossLoop,
  calloutEndpoints,
  approachTargetFromUser,
  harnessCedePayload,
  mergeVoiceChatDebugPacket,
  shouldPassLiveLogs,
  collectAiChatLines,
  debuggerFixSuggestions,
  wireToScenePayload,
  isMoveTableVoice,
  laserTablePose,
  isEnableSandboxVoice,
  isSamCorrectionVoice,
  topPromptSlotMode,
  syncTopPromptSlot,
} from "./xr-ai-round-table.js";

test("round table roster seats Astra plus team agents", () => {
  const roster = roundTableRoster();
  assert.equal(roster[0].id, "astra");
  assert.ok(roster.some((r) => r.id === "vibe-rnd"));
  assert.ok(!roster.some((r) => r.id === "sam"));
  const voices = roster.map((r) => r.voice);
  assert.equal(new Set(voices).size, 1);
  assert.equal(voices[0], "marin");
  const seats = tableSeatLayout({ count: roster.length });
  assert.equal(seats.length, roster.length);
  const keys = new Set(seats.map((s) => `${s.p[0].toFixed(3)},${s.p[2].toFixed(3)}`));
  assert.equal(keys.size, seats.length);
});

test("idea toss is a reply loop, not one-shot", () => {
  const loop = ideaTossLoop("Quest trigger still dead", { rounds: 2 });
  assert.equal(loop.loop, true);
  assert.ok(loop.turns.length >= 4);
  assert.equal(loop.turns[0].reply_to, "");
  assert.ok(loop.turns[1].reply_to);
  assert.equal(loop.turns.every((t) => t.one_shot === false), true);
  const second = nextIdeaTurn(loop.turns.slice(0, 1), roundTableRoster(), "windows");
  assert.match(second.text, /to /);
});

test("harness cede never auto-applies", () => {
  const payload = harnessCedePayload({ filename: "fix.js", code: "export const n=1;" });
  assert.equal(payload.apply, false);
  assert.equal(payload.auto_apply, false);
  assert.equal(payload.status, "pending_approval");
  assert.equal(payload.token, ROUNDTBL1_CACHE);
  assert.equal(payload.request_id, ROUND_TABLE_REQUEST_ID);
});

test("round table hosts marketing PDF slides and point targets", () => {
  const src = readFileSync(new URL("./xr-ai-round-table.js", import.meta.url), "utf8");
  assert.match(src, /round-table:slides/);
  assert.match(src, /pointAtSlide/);
  assert.match(src, /mktpres1|MKTPRES1_TOKEN/);
  assert.match(src, /mktpitch1|MKTPITCH1_TOKEN|uvToSlideStep/);
  assert.match(src, /rnddemo1|RNDDEMO1_TOKEN|pointAtBench/);
  assert.match(src, /round-table:fix-wheels/);
  assert.match(src, /round-table:qc-rig/);
});

test("invited agents walk from the seat toward the user", () => {
  const home = [0.9, 0.78, 0];
  const dest = approachTargetFromUser({ x: 0, y: 1.6, z: 0.2 }, home, 0.55);
  assert.ok(Math.hypot(dest.p[0], dest.p[2]) < Math.hypot(home[0], home[2]));
  assert.ok(dest.p[1] >= 0.02);
});

test("dotted callout has a leader from the seat", () => {
  const ends = calloutEndpoints([0.9, 0.78, 0], [0, 0.78, 0]);
  assert.ok(ends.to[1] > ends.from[1]);
  assert.ok(Math.abs(ends.from[0] - 0.9) < 0.001);
});

test("VR speech and AI chat merge into one live debug packet", () => {
  const packet = mergeVoiceChatDebugPacket({
    voice: "trigger still dead on the right hand",
    draft: "fix the Quest selectstart miss",
    chat: [{ who: "astra", text: "DimOS poll continue" }, { who: "vibe-rnd", text: "check instances" }],
    feed: { allowTr: 0, dimos: 1 },
  });
  assert.equal(packet.live, true);
  assert.equal(packet.wait_for_end, false);
  assert.match(packet.merged, /trigger still dead/);
  assert.match(packet.merged, /DimOS/);
  assert.equal(packet.last3, ROUND_TABLE_LAST3);
  assert.equal(shouldPassLiveLogs({ tableVisible: true, talking: true, newVoice: true }), true);
  assert.equal(shouldPassLiveLogs({ tableVisible: true, talking: true, newVoice: false, newChat: false }), false);
  assert.equal(shouldPassLiveLogs({ tableVisible: false, talking: true, newVoice: true }), false);
  const lines = collectAiChatLines({
    mold: { chat: [{ role: "user", text: "hey the trigger" }] },
    draft: "AI prompt draft",
    tableChat: [{ agent_id: "vibe-rnd", text: "looking at instances" }],
  });
  assert.ok(lines.some((r) => r.text.includes("trigger")));
  assert.ok(lines.some((r) => r.who === "prompt"));
});

test("AI prompt hosts Sandbox + Repair in VR only; Round Table removed from compose and Render Agent", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./xr-round-table-btn.css", import.meta.url), "utf8");
  const compose = html.match(/id="prompt-pane-compose"[\s\S]*?id="prompt-pane-history"/)?.[0] || "";
  const agentForm = html.match(/id="render-agent-form"[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(html, /id="btn-sandbox"/);
  assert.match(html, /id="btn-repair-table"/);
  assert.equal(/id="btn-round-table"/.test(compose), false);
  assert.equal(/id="btn-round-table-gen"/.test(compose), false);
  assert.equal(/id="btn-round-table-agent"/.test(agentForm), false);
  assert.match(css, /body:not\(\.xr-presenting\) #prompt-pane-compose #btn-sandbox/);
  assert.match(css, /body\.xr-presenting #prompt-pane-compose #btn-sandbox/);
  assert.match(css, /display: none !important/);
});

test("laser move stays reachable and voice phrase matches", () => {
  assert.equal(isMoveTableVoice("move table here"), true);
  assert.equal(isMoveTableVoice("put the round table there"), true);
  assert.equal(isMoveTableVoice("generate a chair"), false);
  const far = laserTablePose({
    hit: { x: 40, y: 0, z: -40, kind: "floor" },
    head: { x: 0, y: 1.6, z: 0 },
    floorY: 0,
    maxM: 2.4,
  });
  assert.ok(far);
  assert.ok(Math.hypot(far.x, far.z) <= 2.41);
  assert.equal(far.token, "roundtbl2");
});

test("debugger mode suggestions and wire-to-scene stay queued", () => {
  const rows = debuggerFixSuggestions([
    { feature: "trigger", ok: true, attempt: "poll buttons[0]" },
    { feature: "windows", ok: false, attempt: "far spawn" },
  ]);
  assert.ok(rows.some((r) => /poll/.test(r.text)));
  const wire = wireToScenePayload({ trigger: 0 });
  assert.equal(wire.apply, false);
  assert.equal(wire.auto_apply, false);
  assert.equal(wire.status, "pending_approval");
  assert.equal(wire.privilege, "xr.controls.wire_scene");
  const xr = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");
  assert.match(xr, /action === "debugger"/);
  assert.match(xr, /wire_scene/);
  assert.match(xr, /\/mcp\/sandbox\/controls|xr-control-live/);
});

test("round table on keeps desktop prompt as Round Table; VR window + voice open sandbox", () => {
  assert.equal(topPromptSlotMode({ tableOn: false }), "round_table");
  assert.equal(topPromptSlotMode({ tableOn: true }), "sandbox");
  const slot = syncTopPromptSlot({ tableOn: true, sandboxOn: true });
  assert.equal(slot.mode, "round_table");
  assert.equal(isEnableSandboxVoice("enable sandbox"), true);
  assert.equal(isEnableSandboxVoice("open the sandbox"), true);
  assert.equal(isEnableSandboxVoice("close sandbox"), false);
  assert.equal(isSamCorrectionVoice("That's wrong, change the title"), true);
  assert.equal(isSamCorrectionVoice("enable sandbox"), false);
  const xr = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");
  assert.match(xr, /tableOn \? "Sandbox" : "Round Table"/);
  assert.match(xr, /id === "sandbox"/);
  assert.match(xr, /enable_sandbox/);
  assert.match(xr, /voice_examples/);
  assert.match(xr, /voice-select\.js/);
});
