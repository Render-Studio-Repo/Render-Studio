import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inferRigKind,
  mergeDiscoveredRigs,
  filterRigs,
  articulationGeneratePrefix,
  slugRigId,
  urdfMatchesModel,
  pickSidecarName,
  ensurePlayableRigs,
  hasMovableJoint,
  qcRigFix,
  pickCadModelsForAgentFix,
  wheelDriveGeneratePrefix,
  urdfHasDummySpheres,
  urdfHasEmptyLinks,
  RIGQC1_TOKEN,
} from "./cad-rigs.js";

test("inferRigKind maps assemble, vortex, open/close, urdf, and wheels", () => {
  assert.equal(inferRigKind("this purse should open and close"), "open_close");
  assert.equal(inferRigKind("assembly animation of the model assembling itself"), "assemble");
  assert.equal(inferRigKind("vortex spin around the bag"), "vortex");
  assert.equal(inferRigKind("add URDF SRDF joints"), "urdf");
  assert.equal(inferRigKind("properly make the wheels drive"), "wheels");
  assert.equal(inferRigKind("Holonomic base wheels"), "wheels");
  assert.equal(inferRigKind("wiggle the handle"), "custom");
});

test("mergeDiscoveredRigs keeps multiple named sources", () => {
  const rigs = mergeDiscoveredRigs({
    sidecar: { rigs: [{ id: "open_close", name: "Open / close", kind: "open_close" }] },
    files: ["purse.joints.json"],
    urdfFiles: ["purse.urdf"],
    srdfFiles: ["purse.srdf"],
    stepAnimations: ["assemble", "vortex"],
    stepModule: "purse.step.js",
  });
  const ids = rigs.map((r) => r.id);
  assert.ok(ids.includes("open_close"));
  assert.ok(ids.includes("assemble"));
  assert.ok(ids.includes("vortex"));
  assert.ok(rigs.some((r) => r.kind === "urdf"));
  assert.ok(rigs.some((r) => r.kind === "joints"));
});

test("filterRigs searches name and kind", () => {
  const rigs = [
    { id: "open_close", name: "Open / close", kind: "open_close", source: "" },
    { id: "vortex", name: "Vortex spin", kind: "vortex", source: "" },
  ];
  assert.equal(filterRigs(rigs, "vortex").length, 1);
  assert.equal(filterRigs(rigs, "URDF").length, 0);
  assert.equal(filterRigs(rigs, "").length, 2);
});

test("articulation prefix keeps existing rigs", () => {
  const text = articulationGeneratePrefix({
    kind: "assemble",
    existingNames: ["Open / close"],
    filename: "purse.glb",
  });
  assert.match(text, /EXISTING selected viewport model/i);
  assert.match(text, /Open \/ close/);
  assert.match(text, /assembly animation/i);
  assert.match(text, /rigs\.json/);
});

test("ensurePlayableRigs adds fallback open/close", () => {
  const rigs = ensurePlayableRigs([], { joints: [{ type: "revolute" }], filename: "purse.glb" });
  assert.ok(rigs.some((r) => r.kind === "open_close"));
});

test("urdfMatchesModel accepts named sidecar URDFs under vibecad/", () => {
  const model = "vibecad/Shell_Clutch_Purse_3D_printed_PETG_Matching_Both.glb";
  assert.equal(
    urdfMatchesModel("Shell_Clutch_Purse_3D_printed_PETG_Matching_Both.purse_open_close.urdf", model),
    true,
  );
  assert.equal(urdfMatchesModel("other_robot.urdf", model), false);
});

test("pickSidecarName matches basename when stem has a folder", () => {
  const name = pickSidecarName("vibecad/Shell_Clutch_Purse_3D_printed_PETG_Matching_Both", [
    "Shell_Clutch_Purse_3D_printed_PETG_Matching_Both.rigs.json",
  ]);
  assert.equal(name, "Shell_Clutch_Purse_3D_printed_PETG_Matching_Both.rigs.json");
});

test("mergeDiscoveredRigs treats r3d_joints.json as joints", () => {
  const rigs = mergeDiscoveredRigs({ files: ["r3d_joints.json", "rigging.json"] });
  assert.ok(rigs.some((r) => r.source === "r3d_joints.json"));
  assert.ok(rigs.some((r) => r.source === "rigging.json"));
});

test("ensurePlayableRigs adds fallback when joints are all fixed", () => {
  const joints = [{ id: "ground", type: "fixed" }, { id: "pin", type: "fixed" }];
  assert.equal(hasMovableJoint(joints), false);
  const rigs = ensurePlayableRigs([], { joints, filename: "purse.glb" });
  assert.equal(rigs[0].id, "open_close");
  assert.equal(rigs[0].source, "fallback");
});

test("ensurePlayableRigs adds fallback after Rigging with zero clips", () => {
  const rigs = ensurePlayableRigs([], { cadRigging: true, filename: "base.glb" });
  assert.equal(rigs.length, 1);
  assert.equal(rigs[0].kind, "open_close");
});

test("qcRigFix fails all-fixed dummy spheres and passes wheel drive sidecars", () => {
  assert.equal(RIGQC1_TOKEN, "rigqc1");
  assert.equal(urdfHasDummySpheres("<robot><link><visual><geometry><sphere radius=\"0.05\"/></geometry></visual></link></robot>"), true);
  const fail = qcRigFix({
    prompt: "make the wheels drive",
    filename: "holonomic.glb",
    files: [],
    joints: [{ id: "ground", type: "fixed" }, { id: "wheel_l", type: "fixed", child: "wheel_left" }],
    urdfText: "<robot><link><collision><geometry><sphere radius='0.04'/></geometry></collision></link></robot>",
  });
  assert.equal(fail.pass, false);
  assert.equal(fail.auto_apply, false);
  assert.ok(fail.checks.some((c) => c.id === "geometry" && !c.pass));
  assert.ok(fail.checks.some((c) => c.id === "movable" && !c.pass));
  const pass = qcRigFix({
    prompt: "make the wheels drive",
    filename: "holonomic.glb",
    files: ["holonomic.rigs.json", "holonomic.urdf"],
    sidecar: {
      rigs: [{ id: "wheels", name: "Drive", kind: "wheels", animationId: "anim_drive" }],
      animations: [{ id: "anim_drive", keyframes: [{ time: 0 }, { time: 1 }] }],
    },
    joints: [{ id: "wheel_l", type: "continuous", child: "wheel_left" }],
    urdfText: "<robot name='base'><link name='wheel_left'></link></robot>",
  });
  assert.equal(pass.pass, true);
  const picked = pickCadModelsForAgentFix([
    { filename: "base.glb", sectionId: "components", label: "Holonomic" },
    { filename: "notes.txt" },
  ]);
  assert.equal(picked.length, 1);
  assert.match(wheelDriveGeneratePrefix({ filename: "base.glb" }), /wheels drive/i);
});

test("empty URDF is not playable unless a lid/wheel mesh can bind", () => {
  assert.equal(urdfHasEmptyLinks(`<robot><link name="shell_lid"></link></robot>`), true);
  const fail = qcRigFix({
    prompt: "this purse should open and close",
    filename: "purse.glb",
    files: ["purse.rigs.json", "purse.urdf"],
    sidecar: { rigs: [{ id: "open", kind: "open_close", source: "purse.urdf", urdfFile: "purse.urdf" }] },
    joints: [{ type: "revolute", child: "shell_lid" }],
    urdfText: `<robot><link name="shell_base"></link><link name="shell_lid"></link></robot>`,
  });
  assert.equal(fail.pass, false);
  const passBind = qcRigFix({
    prompt: "this purse should open and close",
    filename: "purse.glb",
    files: ["purse.rigs.json", "purse.urdf", "part_02_shell_lid.glb"],
    sidecar: { rigs: [{ id: "open", kind: "open_close", source: "purse.urdf", urdfFile: "purse.urdf" }] },
    joints: [{ type: "revolute", child: "shell_lid" }],
    urdfText: `<robot><link name="shell_base"></link><link name="shell_lid"></link></robot>`,
  });
  assert.equal(passBind.pass, true);
  assert.ok(passBind.checks.some((c) => c.id === "cad_bind" && c.pass));
});
