import * as THREE from "three";
import { roboticsIntegratedProfile } from "./robotics-profile.js?v=roboticsworkspace3&dimos-viser-local1";

const labelsByGrip = new WeakMap();
/** Locked Sam profile. Y owns motion; A records/saves and B discards. */
const samYBindings = {
  left: [["X", "Data Sets", "x-button"], ["Y", "Activate / Reset", "y-button"]],
  right: [["A", "Record / Save", "a-button"], ["B", "Discard", "b-button"]],
};

export function teleopButtonBindings(profile = roboticsIntegratedProfile()) {
  if (!profile) return samYBindings;
  const actions = profile.controlDefinition?.actions || {};
  return {
    left: [["X", actions.emote_picker?.label || "Data Sets", "x-button"], ["Y", "Activate / Reset", "y-button"]],
    right: [["A", "Record / Save", "a-button"], ["B", "Discard", "b-button"]],
  };
}

function createLabels(grip, hand, bindings) {
  const group = new THREE.Group();
  group.name = "teleopButtonLabels";
  const entries = bindings[hand].map(([button, action, component], index) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#101719";
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = button === "B" ? "#ff7777" : "#7ee4ca";
    ctx.font = "bold 46px sans-serif";
    ctx.fillText(button, 18, 64);
    ctx.fillStyle = "#ffffff";
    ctx.font = "34px sans-serif";
    ctx.fillText(action, 80, 61);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, depthTest: false, depthWrite: false,
    }));
    sprite.scale.set(0.145, 0.0272, 1);
    sprite.renderOrder = 50010;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x7ee4ca, depthTest: false, depthWrite: false }),
    );
    line.renderOrder = 50009;
    line.frustumCulled = false;
    group.add(sprite, line);
    return { sprite, line, component, index, anchor: new THREE.Vector3() };
  });
  grip.add(group);
  const state = { group, entries, hand, key: JSON.stringify(bindings[hand]) };
  labelsByGrip.set(grip, state);
  return state;
}

export function updateTeleopLabels(grips, active) {
  const bindings = teleopButtonBindings();
  for (const grip of grips) {
    const hand = grip.userData.handedness;
    const source = grip.userData.inputSource;
    const visible = active && grip.visible && !!source?.gamepad && !!bindings[hand];
    let state = labelsByGrip.get(grip);
    if (!visible) {
      if (state) state.group.visible = false;
      continue;
    }
    if (state && (state.hand !== hand || state.key !== JSON.stringify(bindings[hand]))) {
      grip.remove(state.group);
      state.group.traverse((node) => {
        node.geometry?.dispose();
        node.material?.map?.dispose();
        node.material?.dispose();
      });
      state = null;
    }
    state ||= createLabels(grip, hand, bindings);
    state.group.visible = true;
    const model = grip.children.find((child) => child.motionController);
    for (const entry of state.entries) {
      const component = model?.motionController?.components?.[entry.component];
      const response = Object.values(component?.visualResponses || {}).find((r) => r.valueNode);
      const node = response?.valueNode;
      // Use the loaded controller's button location; fall back while its GLB loads.
      if (node) {
        node.getWorldPosition(entry.anchor);
        grip.worldToLocal(entry.anchor);
      } else {
        entry.anchor.set(hand === "left" ? -0.018 : 0.018, 0.012, -0.025 - entry.index * 0.025);
      }
      entry.sprite.position.copy(entry.anchor);
      entry.sprite.position.x += hand === "left" ? -0.095 : 0.095;
      entry.sprite.position.y += 0.065 + entry.index * 0.045;
      const positions = entry.line.geometry.attributes.position;
      positions.setXYZ(0, entry.anchor.x, entry.anchor.y, entry.anchor.z);
      positions.setXYZ(1, entry.sprite.position.x, entry.sprite.position.y, entry.sprite.position.z);
      positions.needsUpdate = true;
    }
  }
}
