/**
 * Architect camera helpers — plan-first view + horizon leash.
 * Only mutates camera while Architect mode is active; host restores free look on exit.
 */

import * as THREE from "three";
import { segmentLengthModel } from "./architect-lattice.js?v=20260714-erase-grid";

/**
 * Elevated three-quarter view looking down at the plan origin.
 */
export function applyArchitectDefaultView(camera, controls, mmPerModelUnit = 1) {
  const step = segmentLengthModel(mmPerModelUnit);
  const dist = Math.max(step * 8, 12);
  controls.target.set(0, 0, 0);
  camera.position.set(dist * 0.85, -dist * 0.95, dist * 0.7);
  camera.up.set(0, 0, 1);
  camera.lookAt(controls.target);
  controls._eye?.subVectors(camera.position, controls.target);
  controls.update?.();
}

/**
 * Keep the camera above the floor plane so you cannot look from under the slab.
 * Call once per frame while Architect is active (TrackballControls has no polar clamp).
 */
export function clampArchitectHorizon(camera, controls, mmPerModelUnit = 1) {
  if (!camera || !controls) return;
  const step = segmentLengthModel(mmPerModelUnit);
  const minHeight = Math.max(step * 0.35, 0.5);
  const target = controls.target;
  if (camera.position.z < target.z + minHeight) {
    camera.position.z = target.z + minHeight;
    controls._eye?.subVectors(camera.position, controls.target);
  }
  // Soft cap: don't flip past nearly horizontal looking upward from below
  const offset = new THREE.Vector3().subVectors(camera.position, target);
  const horiz = Math.hypot(offset.x, offset.y);
  if (horiz < 1e-6) return;
  const maxPitchFromHorizon = 0.08; // radians below horizontal still ok; block going under
  // If z component is negative relative to looking "up" through the floor...
  if (offset.z < minHeight * 0.5) {
    offset.z = minHeight;
    offset.setLength(Math.max(horiz, minHeight * 2));
    camera.position.copy(target).add(offset);
    controls._eye?.subVectors(camera.position, controls.target);
  }
}
