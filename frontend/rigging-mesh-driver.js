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
const MOVING_JOINT_TYPES = new Set(["continuous", "revolute", "prismatic"]);
const ROOT_PREVIEW_PART = "__model_preview__";

function normName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

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
  if (name === "model_preview" || name === ROOT_PREVIEW_PART) return ROOT_PREVIEW_PART;
  return name || null;
}

function isDecorMesh(obj) {
  return !!(obj?.userData?.isSilhouette || obj?.userData?.isEdge);
}

export function findPartMesh(root, canonicalId) {
  if (!root || !canonicalId) return null;
  const names = MESH_ALIASES[canonicalId] || [canonicalId];
  const normalized = new Set(names.map(normName));
  for (const name of names) {
    let found = null;
    root.traverse((obj) => {
      if (found || !obj?.isMesh || isDecorMesh(obj)) return;
      const objName = normName(obj.name || obj.userData?.name || obj.userData?.partId);
      if (String(obj.name) === name || normalized.has(objName)) found = obj;
    });
    if (found) return found;
  }
  let fuzzy = null;
  root.traverse((obj) => {
    if (fuzzy || !obj?.isMesh || isDecorMesh(obj)) return;
    const objName = normName(obj.name || obj.userData?.name || obj.userData?.partId);
    for (const wanted of normalized) {
      if (wanted && (objName.includes(wanted) || wanted.includes(objName))) {
        fuzzy = obj;
        return;
      }
    }
  });
  if (fuzzy) return fuzzy;
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
  const normalized = new Set(aliases.map(normName));
  for (const joint of sim?.joints || []) {
    const child = normName(joint.child);
    if (aliases.includes(joint.child) || joint.child === partId || normalized.has(child)) return joint;
  }
  return null;
}

function eulerZ(rotation) {
  return Number(rotation?.[2]) || 0;
}

function axisVector(joint) {
  const axis = Array.isArray(joint?.axis) ? joint.axis : [0, 0, 1];
  const v = new THREE.Vector3(Number(axis[0]) || 0, Number(axis[1]) || 0, Number(axis[2]) || 1);
  if (v.lengthSq() < 1e-8) v.set(0, 0, 1);
  return v.normalize();
}

function dominantAxisIndex(axis) {
  const values = [Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z)];
  return values.indexOf(Math.max(...values));
}

function movablePartIds(sim) {
  const ids = [];
  for (const joint of sim?.joints || []) {
    const child = joint?.child;
    if (!child || !MOVING_JOINT_TYPES.has(String(joint.type || "").toLowerCase())) continue;
    if (!ids.includes(child)) ids.push(child);
  }
  return ids;
}

export function createRiggingMeshDriver({ getPartRoot, getSim }) {
    /** @type {Map<string, { mesh: THREE.Object3D, restPos: THREE.Vector3, restQuat: THREE.Quaternion, axis: THREE.Vector3, axisIdx: number }>} */
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

  function rebind(bones = []) {
    clear();
    const root = getPartRoot?.();
    if (!root) return 0;

    const sim = getSim?.();
    const partIds = movablePartIds(sim);
    if (!partIds.length) partIds.push(...ROTATING_PARTS);
    for (const bone of bones || []) {
      const partId = partIdForBone(bone);
      if (partId && !partIds.includes(partId)) partIds.push(partId);
      const boneName = String(bone?.name || "").trim();
      if (boneName && !partIds.includes(boneName)) partIds.push(boneName);
    }
    let bound = 0;
    for (const partId of partIds) {
      const mesh = findPartMesh(root, partId);
      if (!mesh) continue;
      const joint = sim ? jointForPart(sim, partId) : null;
      if (joint?.type === "fixed") continue;
      const axis = axisVector(joint);
      mesh.updateMatrixWorld(true);
      bindings.set(partId, {
        mesh,
        restPos: mesh.position.clone(),
        restQuat: mesh.quaternion.clone(),
        axis,
        axisIdx: dominantAxisIndex(axis),
      });
      bound += 1;
    }
    return bound;
  }

  function bindPreviewRoot() {
    clear();
    const root = getPartRoot?.();
    if (!root) return 0;
    root.updateMatrixWorld(true);
    bindings.set(ROOT_PREVIEW_PART, {
      mesh: root,
      restPos: root.position.clone(),
      restQuat: root.quaternion.clone(),
      axis: new THREE.Vector3(0, 0, 1),
      axisIdx: 2,
    });
    return 1;
  }

  function applyBoneRotations(bones, poses) {
    if (!bindings.size) rebind();
    if (!bindings.size || !poses) return false;

    let moved = false;
    for (const bone of bones || []) {
      const partId = partIdForBone(bone);
      if (!partId) continue;
      const binding = bindings.get(partId);
      if (!binding) continue;
      const pose = poses[bone.id];
      if (!pose) continue;

      const angle = Number(pose.rotation?.[binding.axisIdx]) || eulerZ(pose.rotation);
      const { mesh, restPos, restQuat, axis } = binding;
      mesh.position.copy(restPos);
      mesh.quaternion.copy(restQuat);
      mesh.rotateOnAxis(axis, angle);
      mesh.updateMatrixWorld(true);
      moved = true;
    }
    return moved;
  }

  function resetMeshes() {
    for (const binding of bindings.values()) resetBinding(binding);
  }

  function isMeshDriven() {
    return bindings.size >= 1;
  }

  return {
    rebind,
    bindPreviewRoot,
    clear,
    applyBoneRotations,
    resetMeshes,
    getBindingCount: () => bindings.size,
    isMeshDriven,
  };
}
