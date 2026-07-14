/**
 * Derive Three.js meshes from architect building segments.
 * Separate scene group — does not touch Design assembly.
 *
 * Segment size: 3 ft wide (bay length) × 9 ft tall (wall height).
 */

import * as THREE from "three";
import { ftToMm, vertexToModel } from "./architect-lattice.js?v=20260714-erase-grid";

const GROUP_NAME = "architect-building-mesh";
const DEFAULT_HEIGHT_FT = 9;
const DEFAULT_THICKNESS_FT = 0.5;

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
  /** @type {Set<string>} */
  let pendingDeleteIds = new Set();

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

  function applyHighlight(root, { selected = false, pendingDelete = false } = {}) {
    if (!root) return;
    root.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mat = child.material;
      if (!mat.emissive) return;
      if (pendingDelete) {
        mat.emissive = new THREE.Color(0xb42318);
        mat.emissiveIntensity = 0.55;
        mat.color = new THREE.Color(0xf97066);
      } else if (selected) {
        mat.emissive = new THREE.Color(0x1a4a8a);
        mat.emissiveIntensity = 0.35;
      } else {
        mat.emissive = new THREE.Color(0x000000);
        mat.emissiveIntensity = 0;
      }
    });
  }

  function rebuild(building) {
    clear();
    if (!building) return;
    const mmPer = Number(getMmPerModelUnit()) || 1;
    const level = building.levels.find((l) => l.id === building.activeLevelId) || building.levels[0];
    const elev = ftToMm(level?.elevationFt || 0) / mmPer;

    const next = new THREE.Group();
    next.name = GROUP_NAME;

    const segs = (building.segments || []).filter((s) => s.levelId === building.activeLevelId);
    for (const seg of segs) {
      const mesh = buildSegmentMesh(seg, mmPer, elev);
      if (!mesh) continue;
      mesh.userData.architectSegmentId = seg.id;
      mesh.userData.architectFeature = seg.feature;
      applyHighlight(mesh, {
        selected: seg.id === selectedId,
        pendingDelete: pendingDeleteIds.has(seg.id),
      });
      next.add(mesh);
    }
    group = next;
    scene.add(group);
  }

  function setSelected(id) {
    selectedId = id || null;
  }

  function setPendingDeleteIds(ids) {
    pendingDeleteIds = new Set(ids || []);
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

  return {
    rebuild,
    clear,
    setSelected,
    setPendingDeleteIds,
    getSelected,
    pickSegmentId,
    dispose: clear,
  };
}

function buildSegmentMesh(seg, mmPer, elevZ) {
  const pa = vertexToModel(seg.a, mmPer);
  const pb = vertexToModel(seg.b, mmPer);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;

  const thickness = ftToMm(seg.thicknessFt || DEFAULT_THICKNESS_FT) / mmPer;
  const height = ftToMm(seg.heightFt || DEFAULT_HEIGHT_FT) / mmPer;
  const feature = seg.feature || "wall";
  const color = FEATURE_COLORS[feature] || FEATURE_COLORS.wall;

  const midX = (pa.x + pb.x) / 2;
  const midY = (pa.y + pb.y) / 2;
  const angle = Math.atan2(dy, dx);

  const root = new THREE.Group();
  root.position.set(midX, midY, elevZ);
  root.rotation.z = angle;

  if (feature === "window") {
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
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.02,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
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
