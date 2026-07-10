/**
 * Derive Three.js meshes from architect building segments.
 * Separate scene group — does not touch Design assembly.
 */

import * as THREE from "three";
import { ftToMm, vertexToModel } from "./architect-lattice.js?v=20260710-bay-lattice";

const GROUP_NAME = "architect-building-mesh";

const FEATURE_COLORS = {
  wall: 0xd8cab0,
  window: 0x7eb6ff,
  door: 0x8b6914,
};

/**
 * @param {{ scene: THREE.Scene, getMmPerModelUnit: () => number }} opts
 */
export function createArchitectMeshLayer(opts) {
  const { scene, getMmPerModelUnit } = opts;
  let group = null;
  let selectedId = null;

  function disposeObject(obj) {
    obj?.traverse?.((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
      else child.material?.dispose?.();
    });
  }

  function clear() {
    if (!group) return;
    scene.remove(group);
    disposeObject(group);
    group = null;
  }

  function rebuild(building) {
    clear();
    if (!building) return;
    const mmPer = Number(getMmPerModelUnit()) || 1;
    const level = building.levels.find((l) => l.id === building.activeLevelId) || building.levels[0];
    const elev = ftToMm(level?.elevationFt || 0) / mmPer;

    group = new THREE.Group();
    group.name = GROUP_NAME;

    const segs = (building.segments || []).filter((s) => s.levelId === building.activeLevelId);
    for (const seg of segs) {
      const mesh = buildSegmentMesh(seg, mmPer, elev);
      if (!mesh) continue;
      mesh.userData.architectSegmentId = seg.id;
      mesh.userData.architectFeature = seg.feature;
      if (seg.id === selectedId) {
        mesh.material.emissive = new THREE.Color(0x1a4a8a);
        mesh.material.emissiveIntensity = 0.35;
      }
      group.add(mesh);
    }
    scene.add(group);
  }

  function setSelected(id) {
    selectedId = id || null;
  }

  function getSelected() {
    return selectedId;
  }

  function pickSegmentId(raycaster) {
    if (!group) return null;
    const hits = raycaster.intersectObject(group, true);
    for (const hit of hits) {
      let obj = hit.object;
      while (obj && !obj.userData?.architectSegmentId && obj.parent) obj = obj.parent;
      if (obj?.userData?.architectSegmentId) return obj.userData.architectSegmentId;
    }
    return null;
  }

  return { rebuild, clear, setSelected, getSelected, pickSegmentId, dispose: clear };
}

function buildSegmentMesh(seg, mmPer, elevZ) {
  const pa = vertexToModel(seg.a, mmPer);
  const pb = vertexToModel(seg.b, mmPer);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;

  const thickness = ftToMm(seg.thicknessFt || 0.5) / mmPer;
  const height = ftToMm(seg.heightFt || 9) / mmPer;
  const feature = seg.feature || "wall";
  const color = FEATURE_COLORS[feature] || FEATURE_COLORS.wall;

  const midX = (pa.x + pb.x) / 2;
  const midY = (pa.y + pb.y) / 2;
  const angle = Math.atan2(dy, dx);

  const root = new THREE.Group();
  root.position.set(midX, midY, elevZ);
  root.rotation.z = angle;

  if (feature === "window") {
    // Solid wall bands + glass middle
    const sillH = height * 0.28;
    const headH = height * 0.18;
    const glassH = Math.max(height - sillH - headH, height * 0.4);
    addBox(root, length, thickness, sillH, 0, 0, sillH / 2, FEATURE_COLORS.wall);
    addBox(root, length * 0.92, thickness * 0.35, glassH, 0, 0, sillH + glassH / 2, color, 0.55);
    addBox(root, length, thickness, headH, 0, 0, sillH + glassH + headH / 2, FEATURE_COLORS.wall);
  } else if (feature === "door") {
    const doorH = height * 0.78;
    const headH = height - doorH;
    addBox(root, length * 0.55, thickness * 0.5, doorH, 0, thickness * 0.15, doorH / 2, color);
    if (headH > 0) addBox(root, length, thickness, headH, 0, 0, doorH + headH / 2, FEATURE_COLORS.wall);
    // side jambs
    const jamb = length * 0.12;
    addBox(root, jamb, thickness, doorH, -length / 2 + jamb / 2, 0, doorH / 2, FEATURE_COLORS.wall);
    addBox(root, jamb, thickness, doorH, length / 2 - jamb / 2, 0, doorH / 2, FEATURE_COLORS.wall);
  } else {
    addBox(root, length, thickness, height, 0, 0, height / 2, color);
  }

  return root;
}

function addBox(parent, sx, sy, sz, x, y, z, color, opacity = 1) {
  const geom = new THREE.BoxGeometry(sx, sy, sz);
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.62,
    metalness: 0.04,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
