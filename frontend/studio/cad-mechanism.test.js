import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreLinkMatch, analyzeMechanismFit, cadBotMechanismLines, CAD_MECH_TOKEN } from "./cad-mechanism.js";

test("part GLB names match URDF lid links", () => {
  assert.ok(scoreLinkMatch("vibecad/foo__part_02_shell_lid.glb", "shell_lid") >= 90);
  assert.equal(scoreLinkMatch("Shell_Clutch_Purse_3D_printed_PETG_Matching_Both.glb", "shell_lid"), 0);
});

test("CAD bot says purse will open/shut, pin binds, leftover clamp is not the clasp", () => {
  const r = analyzeMechanismFit({
    prompt: "open shut clamps click tolerance",
    kind: "rigging",
    bodies: [
      { name: "shell_base", size_mm: [229.62, 192, 46] },
      { name: "shell_lid", size_mm: [229.62, 188.15, 43] },
      { name: "retained_pin", size_mm: [55.4, 8.6, 8.6] },
      { name: "90576A119", size_mm: [19, 21.94, 12] },
    ],
    joints: [{ type: "revolute", child: "shell_lid", lower: 0, upper: 1.91986 }],
    spec: { pin_diameter_mm: 4, pin_clearance_mm: 0.2, snap_clearance_mm: 0.28 },
    files: ["part_02_shell_lid.glb"],
    urdfText: `<link name="shell_lid"></link>`,
  });
  assert.equal(r.token, CAD_MECH_TOKEN);
  assert.equal(r.will_open, true);
  assert.equal(r.will_shut, true);
  assert.equal(r.pin_fits, false);
  assert.equal(r.snap_click_spec, true);
  assert.match(r.summary, /McMaster clamp/i);
  const lines = cadBotMechanismLines(r);
  assert.ok(lines.some((row) => row.agent_id === "cad-bot" && /CAD bot/.test(row.text)));
});
