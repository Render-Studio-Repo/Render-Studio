import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from '../../backend/skills/img2threejs/scripts/vendor/three/build/three.module.js';
import { brushStyle, strokeCrossSection, styleStrokeMaterial, createXrToolTip, SHAPE_TOOLS } from "./xr-tool-appearance.js";

test("tool silhouettes have one visible variant and never become raycast targets", () => {
  const tip = createXrToolTip(THREE);
  for (const tool of ["draw", ...SHAPE_TOOLS.map((row) => row.id)]) {
    tip.update({ tool, color: 0xff0000 });
    assert.equal(tip.group.children.filter((node) => node.visible).length, 1);
    tip.group.visible = true;
    tip.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, .1), new THREE.Vector3(0, 0, -1));
    assert.equal(ray.intersectObject(tip.group, true).length, 0);
    const bounds = new THREE.Box3().setFromObject(tip.group);
    assert.ok(bounds.getSize(new THREE.Vector3()).length() < .08);
  }
});

test("pen, brush and highlighter use distinct cross sections and opacity", () => {
  const pen = strokeCrossSection("pen", 4, 10);
  const brush = strokeCrossSection("brush", 4, 10);
  const marker = strokeCrossSection("highlighter", 4, 10);
  assert.equal(pen.width, pen.depth);
  assert.ok(brush.depth < brush.width && marker.depth < brush.depth);
  assert.ok(strokeCrossSection("brush", 0, 10).width < brush.width);
  assert.ok(strokeCrossSection("brush", 9, 10).width < brush.width);
  const material = new THREE.MeshBasicMaterial();
  styleStrokeMaterial(material, "highlighter");
  assert.equal(material.opacity, .35);
  assert.equal(material.depthWrite, false);
  styleStrokeMaterial(material, "pen");
  assert.equal(material.opacity, 1);
  assert.equal(material.transparent, false);
  assert.equal(brushStyle("unknown").kind, "pen");
});

test("changing tip width preserves the working point along the controller ray", () => {
  const { group, update } = createXrToolTip(THREE);
  for (const size of ["draw_size_s", "draw_size_m", "draw_size_l"]) {
    update({ tool: "draw", brush: "pen", size });
    const variant = group.children.find((node) => node.visible);
    variant.updateMatrixWorld(true);
    const nib = variant.children[1];
    const point = nib.localToWorld(new THREE.Vector3(0, .006, 0));
    assert.ok(point.distanceTo(new THREE.Vector3(0, 0, -.018)) < 1e-6);
  }
});
