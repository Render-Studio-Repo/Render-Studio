/**
 * Architect Mode — 3 ft bay lattice overlay (Three.js).
 *
 * Only visible while Architect Mode is active. Does not replace or mutate the
 * Design-mode GridHelper; it is a separate scene group that is hidden on exit.
 */

import * as THREE from "three";
import {
  SEGMENT_FT,
  enumerateBaysInBounds,
  segmentLengthModel,
  vertexToModel,
} from "./architect-lattice.js?v=20260714-erase-grid";

const GROUP_NAME = "architect-bay-lattice";

/**
 * @param {{
 *   THREE?: typeof THREE,
 *   scene: THREE.Scene,
 *   getMmPerModelUnit: () => number,
 *   getExtentModel?: () => number,
 * }} opts
 */
export function createArchitectBayGrid(opts) {
  const scene = opts.scene;
  const getMmPerModelUnit = opts.getMmPerModelUnit;
  const getExtentModel = opts.getExtentModel || (() => segmentLengthModel(getMmPerModelUnit()) * 80);

  let group = null;
  let active = false;

  function disposeObject(obj) {
    obj?.traverse?.((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
      else child.material?.dispose?.();
    });
  }

  function clearGroup() {
    if (!group) return;
    scene.remove(group);
    disposeObject(group);
    group = null;
  }

  function rebuild() {
    clearGroup();
    if (!active) return;

    const mmPer = Number(getMmPerModelUnit()) || 1;
    const step = segmentLengthModel(mmPer);
    if (!(step > 0)) return;

    const extent = Math.max(Number(getExtentModel()) || step * 80, step * 60);
    const halfCells = Math.max(40, Math.ceil(extent / step / 2));
    const bounds = {
      iMin: -halfCells,
      iMax: halfCells,
      jMin: -halfCells,
      jMax: halfCells,
    };

    group = new THREE.Group();
    group.name = GROUP_NAME;
    group.renderOrder = -8;

    const bays = enumerateBaysInBounds(bounds);
    const positions = [];
    for (const bay of bays) {
      const pa = vertexToModel(bay.a, mmPer);
      const pb = vertexToModel(bay.b, mmPer);
      positions.push(pa.x, pa.y, -0.0012, pb.x, pb.y, -0.0012);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x5b8def,
      transparent: true,
      opacity: 0.62,
      depthTest: true,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.name = "architect-bay-lines";
    group.add(lines);

    // Origin crosshair (one bay arms) — orientation cue without CAD clutter
    const originGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-step, 0, -0.001),
      new THREE.Vector3(step, 0, -0.001),
      new THREE.Vector3(0, -step, -0.001),
      new THREE.Vector3(0, step, -0.001),
    ]);
    const originMat = new THREE.LineBasicMaterial({
      color: 0x9ec1ff,
      transparent: true,
      opacity: 0.75,
      depthTest: true,
      depthWrite: false,
    });
    const origin = new THREE.LineSegments(originGeo, originMat);
    origin.name = "architect-bay-origin";
    group.add(origin);

    group.visible = true;
    scene.add(group);
  }

  function setActive(next) {
    const was = active;
    active = !!next;
    if (!active) {
      clearGroup();
      return;
    }
    if (!was || !group) rebuild();
    else if (group) group.visible = true;
  }

  function syncFromScene() {
    if (!active) return;
    rebuild();
  }

  function isActive() {
    return active;
  }

  function getSegmentFt() {
    return SEGMENT_FT;
  }

  return {
    setActive,
    syncFromScene,
    isActive,
    getSegmentFt,
    dispose: clearGroup,
  };
}
