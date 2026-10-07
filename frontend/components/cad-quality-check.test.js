import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeCadQuality, cadQualityWatchdogPacket, CADQ1_TOKEN } from "./cad-quality-check.js";

test("clamp-like prompt with one sliver body fails useful + constraints and yields repair edit", () => {
  const r = analyzeCadQuality({
    prompt: "desk C-clamp phone trough holder",
    bodies: [{ name: "clamp", bbox: [0, 0, 0, 80, 0.2, 40], volume: 640 }],
    constraints: 0,
    joints: [],
    kind: "cad",
  });
  assert.equal(r.token, CADQ1_TOKEN);
  assert.equal(r.ok, false);
  assert.ok(r.score < 60);
  assert.equal(r.prompt_working, false);
  assert.ok(r.checks.some((c) => c.id === "constraints" && c.ok === false));
  assert.match(r.repair_edit, /Repair edit/);
  assert.match(r.repair_edit, /C-frame|coaxial|Thicken/i);
  const pkt = cadQualityWatchdogPacket(r, { log_id: "abc" });
  assert.ok(pkt.to.includes("cursor-engineer"));
  assert.ok(pkt.to.includes("cad-bot"));
  assert.equal(pkt.log_id, "abc");
});

test("purse open/shut + fat pin + leftover clamp is a CAD-bot fail", () => {
  const r = analyzeCadQuality({
    prompt: "will the purse open and shut, will the clamps click, enough tolerance",
    kind: "rigging",
    bodies: [
      { name: "shell_base", size_mm: [229.62, 192, 46], center_mm: [0, 87.5, -14.5] },
      { name: "shell_lid", size_mm: [229.62, 188.15, 43], center_mm: [0.01, 88.58, 16] },
      { name: "retained_pin", size_mm: [55.4, 8.6, 8.6], center_mm: [-0.1, 0, 0] },
      { name: "90576A119", size_mm: [19, 21.94, 12], center_mm: [0, 0, 0] },
    ],
    joints: [{ type: "revolute", child: "shell_lid", axis: [1, 0, 0], lower: 0, upper: 1.91986 }],
    spec: { pin_diameter_mm: 4, pin_clearance_mm: 0.2, snap_clearance_mm: 0.28, open_stop_deg: 110 },
    files: ["vibecad/Shell_Clutch_Purse_3D_printed_PETG_Matching_Both__part_02_shell_lid.glb"],
    urdfText: `<robot><link name="shell_lid"></link></robot>`,
    constraints: 1,
  });
  assert.equal(r.ok, false);
  assert.equal(r.mechanism.will_open, true);
  assert.equal(r.mechanism.will_shut, true);
  assert.equal(r.mechanism.pin_fits, false);
  assert.match(r.mechanism.summary, /OPEN\/SHUT: yes/i);
  assert.match(r.mechanism.summary, /too fat/i);
  assert.ok(r.cad_bot_lines.some((row) => row.agent_id === "cad-bot"));
});

test("constrained printable body with no motion prompt passes", () => {
  const r = analyzeCadQuality({
    prompt: "40mm mounting plate with 10mm hole",
    bodies: [{ name: "plate", bbox: [0, 0, 0, 40, 40, 4], volume: 6400 }],
    constraints: 4,
    joints: [],
    kind: "cad",
  });
  assert.equal(r.ok, true);
  assert.equal(r.prompt_working, true);
});
