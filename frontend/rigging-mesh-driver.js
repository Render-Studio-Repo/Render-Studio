/** Apply rigging joint rotations to named CAD part meshes (gear trains, etc.). */

import * as THREE from "three";

const PART_ALIASES = {
  base_link: "base_plate",
  gear_1_link: "gear_input",
  gear_2_link: "gear_output",
  gear_1: "gear_input",
  gear_2: "gear_output",
  link_1: "gear_input",
  link_2: "gear_output",
};

const BONE_ID_ALIASES = {
  bone_gear1: "gear_input",
  bone_gear2: "gear_output",
  bone_gear_1: "gear_input",
  bone_gear_2: "gear_output",
};

const MESH_ALIASES = {
  gear_input: ["gear_input", "gear_1_link", "gear_1"],
  gear_output: ["gear_output", "gear_2_link", "gear_2"],
};

const ROTATING_PARTS = new Set(["gear_input", "gear_output"]);

export function partIdForBone(bone) {
  const id = String(bone?.id || "").toLowerCase();
  if (BONE_ID_ALIASES[id]) return BONE_ID_ALIASES[id];
  const name = String(bone?.name || "").toLowerCase();
  if (PART_ALIASES[name]) return PART_ALIASES[name];
  if (name.endsWith("_link")) {
    const stem = name.slice(0, -5);
    if (stem.includes("gear") && stem.includes("1")) return "gear_input";
    if (stem.includes("gear") && stem.includes("2")) return "gear_output";
    return stem;
  }
  if (name === "gear_input" || name === "gear_output") return name;
  return name || null;
}

function isDecorMesh(obj) {
  return !!(obj?.userData?.isSilhouette || obj?.userData?.isEdge);
}

export function findPartMesh(root, canonicalId) {
  if (!root || !canonicalId) return null;
  const names = MESH_ALIASES[canonicalId] || [canonicalId];
  for (const name of names) {
    let found = null;
    root.traverse((obj) => {
      if (found || !obj?.isMesh || isDecorMesh(obj)) return;
      if (String(obj.name) === name) found = obj;
    });
    if (found) return found;
  }
  return null;
}

export function findGearTrainRoot(getCatalogObjects) {
  const catalogs = getCatalogObjects?.() || [];
  for (const obj of catalogs) {
    if (!obj) continue;
    let world = null;
    obj.traverse((o) => {
      if (o.name === "world") world = o;
    });
    const root = world || obj;
    if (findPartMesh(root, "gear_input") && findPartMesh(root, "gear_output")) return root;
  }
  return null;
}

function jointForPart(sim, partId) {
  const aliases = MESH_ALIASES[partId] || [partId];
  for (const joint of sim?.joints || []) {
    if (aliases.includes(joint.child) || joint.child === partId) return joint;
  }
  return null;
}

function eulerZ(rotation) {
  return Number(rotation?.[2]) || 0;
}

export function createRiggingMeshDriver({ getPartRoot, getSim }) {
  /** @type {Map<string, { mesh: THREE.Object3D, restPos: THREE.Vector3, restQuat: THREE.Quaternion, axisIdx: number }>} */
  let bindings = new Map();

  function resetBinding(binding) {
    binding.mesh.position.copy(binding.restPos);
    binding.mesh.quaternion.copy(binding.restQuat);
    binding.mesh.updateMatrixWorld(true);
  }

  function clear() {
    for (const binding of bindings.values()) resetBinding(binding);
    bindings.clear();
  }

  function rebind() {
    clear();
    const root = getPartRoot?.();
    if (!root) return 0;

    const sim = getSim?.();
    let bound = 0;
    for (const partId of ROTATING_PARTS) {
      const mesh = findPartMesh(root, partId);
      if (!mesh) continue;
      const joint = sim ? jointForPart(sim, partId) : null;
      if (joint?.type === "fixed") continue;
      mesh.updateMatrixWorld(true);
      bindings.set(partId, {
        mesh,
        restPos: mesh.position.clone(),
        restQuat: mesh.quaternion.clone(),
        axisIdx: 2,
      });
      bound += 1;
    }
    return bound;
  }

  function applyBoneRotations(bones, poses) {
    if (!bindings.size) rebind();
    if (!bindings.size || !poses) return false;

    let moved = false;
    for (const bone of bones || []) {
      const partId = partIdForBone(bone);
      if (!partId || !ROTATING_PARTS.has(partId)) continue;
      const binding = bindings.get(partId);
      if (!binding) continue;
      const pose = poses[bone.id];
      if (!pose) continue;

      const angle = eulerZ(pose.rotation);
      const { mesh, restPos, restQuat } = binding;
      mesh.position.copy(restPos);
      mesh.quaternion.copy(restQuat);
      mesh.rotateZ(angle);
      mesh.updateMatrixWorld(true);
      moved = true;
    }
    return moved;
  }

  function resetMeshes() {
    for (const binding of bindings.values()) resetBinding(binding);
  }

  function isMeshDriven() {
    return bindings.size >= 2;
  }

  return {
    rebind,
    clear,
    applyBoneRotations,
    resetMeshes,
    getBindingCount: () => bindings.size,
    isMeshDriven,
  };
}
