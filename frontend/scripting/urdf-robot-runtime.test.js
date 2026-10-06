import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


async function loadRuntimeHelpers() {
  const sourceUrl = new URL("./urdf-robot-runtime.js", import.meta.url);
  let source = await readFile(sourceUrl, "utf8");
  source = source
    .replace('import * as THREE from "three";', "const THREE = {};")
    .replace(
      'import { STLLoader } from "three/addons/loaders/STLLoader.js";',
      "class STLLoader {}",
    )
    .replace(
      'import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";',
      "class GLTFLoader {}",
    );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}


const runtime = await loadRuntimeHelpers();


test("mesh references remain nested and resolve relative to the URDF", () => {
  assert.equal(
    runtime.resolveUrdfMeshReference("meshes/arm.glb", "vibecad/robots/openarm.urdf"),
    "vibecad/robots/meshes/arm.glb",
  );
  assert.equal(
    runtime.resolveUrdfMeshReference("../shared/arm.glb", "vibecad/robots/openarm.urdf"),
    "vibecad/shared/arm.glb",
  );
  assert.equal(
    runtime.resolveUrdfMeshReference(
      "package://openarm_description/meshes/arm.glb",
      "vibecad/robots/openarm.urdf",
    ),
    "openarm_description/meshes/arm.glb",
  );
  assert.equal(
    runtime.resolveUrdfMeshReference("../../../../outside.glb", "vibecad/openarm.urdf"),
    "",
  );
  assert.equal(
    runtime.resolveUrdfMeshReference("https://example.invalid/arm.glb", "vibecad/openarm.urdf"),
    "",
  );
});


test("URDF origin translation is always meters, including large workcells", () => {
  const origin = [1, 0, 0, 6, 0, 1, 0, 0.002, 0, 0, 1, -0.5, 0, 0, 0, 1];
  assert.deepEqual(runtime.urdfOriginXyzMm({ origin }), [6000, 2, -500]);
});


test("prismatic CAD bindings translate in millimeters instead of rotating", () => {
  assert.deepEqual(runtime.cadBindingMotion("prismatic", [0, 2, 0], 0.025), {
    kind: "translation",
    axis: [0, 1, 0],
    translationMm: [0, 25, 0],
  });
  assert.deepEqual(runtime.cadBindingMotion("revolute", [0, 0, 3], Math.PI / 2), {
    kind: "rotation",
    axis: [0, 0, 1],
    angleRad: Math.PI / 2,
  });
});
