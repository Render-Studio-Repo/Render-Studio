/** VibeCAD / FreeCAD Assembly joint overlays for the CAD viewport.

When Joints is toggled on (next to Gizmo), draw the same LCS the Assembly
workbench uses: filled XY disk + RGB XYZ triad at each joint, plus a motion
hint (revolute shaft + limit arc, slider range, cylindrical shaft, ball sphere).
*/

import * as THREE from "three";
import { parseHarnessJoints } from "./joint-data.js?v=1";
export { parseHarnessJoints } from "./joint-data.js?v=1";

export const JOINTS_LS = "render3d:jointsOverlay:v2";

const TYPE_COLOR = {
  fixed: 0x8b949e,
  revolute: 0x58a6ff,
  prismatic: 0x3fb950,
  slider: 0x3fb950,
  cylindrical: 0xa371f7,
  ball: 0xf85149,
  continuous: 0x39d0d8,
};


function markOverlayNode(obj) {
  if (!obj) return obj;
  obj.userData.jointOverlay = true;
  obj.userData.excludeFromFit = true;
  obj.userData.isOriginHelper = true;
  return obj;
}

function addAxisLine(group, from, to, color, width = 1.5) {
  const geom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...from),
    new THREE.Vector3(...to),
  ]);
  const line = new THREE.Line(geom, new THREE.LineBasicMaterial({
    color,
    linewidth: width,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  }));
  line.renderOrder = 10;
  markOverlayNode(line);
  group.add(line);
  return line;
}

function basisFromAxis(axis) {
  const z = new THREE.Vector3(...axis).normalize();
  const tmp = Math.abs(z.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(tmp, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return { x, y, z };
}

function addLcs(group, size, axisVec, { opacity = 0.22, axisScale = 1 } = {}) {
  const { x, y, z } = basisFromAxis(axisVec);
  const L = size * axisScale;
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(L * 0.28, 32),
    new THREE.MeshBasicMaterial({
      color: 0x58a6ff,
      transparent: true,
      opacity: Math.min(opacity, 0.16),
      side: THREE.DoubleSide,
      depthTest: false,
    }),
  );
  disk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), z);
  disk.renderOrder = 9;
  markOverlayNode(disk);
  group.add(disk);
  addAxisLine(group, [0, 0, 0], x.clone().multiplyScalar(L).toArray(), 0xff4d4f);
  addAxisLine(group, [0, 0, 0], y.clone().multiplyScalar(L).toArray(), 0x3fb950);
  addAxisLine(group, [0, 0, 0], z.clone().multiplyScalar(L).toArray(), 0x58a6ff);
  return { x, y, z, L };
}

function buildJointMarker(joint, size) {
  const group = new THREE.Group();
  group.name = `JointOverlay:${joint.id}`;
  markOverlayNode(group);
  const origin = new THREE.Vector3(...joint.anchor);
  group.position.copy(origin);
  const color = TYPE_COLOR[joint.type] || TYPE_COLOR.fixed;
  const { z, L } = addLcs(group, size, joint.axis);

  if (joint.type === "revolute" || joint.type === "continuous" || joint.type === "cylindrical") {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(L * 0.045, L * 0.045, L * 1.6, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false }),
    );
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), z);
    shaft.renderOrder = 10;
    markOverlayNode(shaft);
    group.add(shaft);
  }

  if (joint.type === "revolute" && joint.limits) {
    const [lo, hi] = joint.limits;
    const span = ((hi - lo) * Math.PI) / 180;
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(L * 0.42, L * 0.52, 24, 1, 0, Math.max(0.05, span)),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    arc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), z);
    arc.renderOrder = 11;
    markOverlayNode(arc);
    group.add(arc);
  }

  if (joint.type === "prismatic" || joint.type === "slider" || joint.type === "cylindrical") {
    const travel = joint.limits ? Math.max(8, Math.abs(joint.limits[1] - joint.limits[0])) : L * 2;
    addAxisLine(
      group,
      z.clone().multiplyScalar(-travel / 2).toArray(),
      z.clone().multiplyScalar(travel / 2).toArray(),
      color,
      2,
    );
  }

  if (joint.type === "ball") {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(L * 0.16, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: false }),
    );
    ball.renderOrder = 10;
    markOverlayNode(ball);
    group.add(ball);
  }

  const childAnchor = joint.childAnchor;
  if (childAnchor && Math.hypot(
    childAnchor[0] - joint.anchor[0],
    childAnchor[1] - joint.anchor[1],
    childAnchor[2] - joint.anchor[2],
  ) > 0.4) {
    const childGroup = new THREE.Group();
    childGroup.position.set(
      childAnchor[0] - joint.anchor[0],
      childAnchor[1] - joint.anchor[1],
      childAnchor[2] - joint.anchor[2],
    );
    markOverlayNode(childGroup);
    addLcs(childGroup, size * 0.72, joint.axis, { opacity: 0.14, axisScale: 0.85 });
    group.add(childGroup);
    addAxisLine(
      group,
      [0, 0, 0],
      childGroup.position.toArray(),
      0x8b949e,
      1,
    );
  }

  // Joint names stay in the floating Joints panel — never a viewport billboard.
  return group;
}

export function createJointOverlay({ scene, getRoot } = {}) {
  const root = new THREE.Group();
  root.name = "JointOverlayRoot";
  root.visible = false;
  scene?.add(root);

  let joints = [];
  let enabled = false;

  function clear() {
    while (root.children.length) {
      const child = root.children.pop();
      child.traverse?.((obj) => {
        obj.geometry?.dispose?.();
        if (obj.material) {
          obj.material.map?.dispose?.();
          obj.material.dispose?.();
        }
      });
    }
  }

  function rebuild() {
    clear();
    if (!enabled || !joints.length) return;
    const host = getRoot?.() || null;
    let size = 18;
    if (host) {
      const box = new THREE.Box3().setFromObject(host);
      if (!box.isEmpty()) size = Math.max(4, Math.min(14, box.getSize(new THREE.Vector3()).length() * 0.028));
    }
    for (const joint of joints) {
      root.add(buildJointMarker(joint, size));
    }
  }

  function setJoints(next) {
    joints = parseHarnessJoints(next);
    rebuild();
    return joints;
  }

  function setEnabled(on) {
    enabled = !!on;
    root.visible = enabled && joints.length > 0;
    rebuild();
    try {
      localStorage.setItem(JOINTS_LS, enabled ? "1" : "0");
    } catch {
      /* ignore */
    }
    return enabled;
  }

  function isEnabled() {
    return enabled;
  }

  function toggle() {
    return setEnabled(!enabled);
  }

  function dispose() {
    clear();
    root.parent?.remove(root);
  }

  try {
    enabled = localStorage.getItem(JOINTS_LS) === "1";
  } catch {
    enabled = false;
  }
  root.visible = false;

  return {
    root,
    setJoints,
    setEnabled,
    isEnabled,
    toggle,
    rebuild,
    dispose,
    count: () => joints.length,
    list: () => joints.slice(),
  };
}
