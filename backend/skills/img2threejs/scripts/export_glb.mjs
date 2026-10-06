#!/usr/bin/env node
/**
 * Headless Three.js → GLB exporter for Render3D Mesh mode (img2threejs).
 *
 * Factories are authored in Three.js Y-up. Render3D's viewport is Z-up, so we
 * convert (+Y → +Z) before seating the model on the floor and writing GLB.
 *
 * Usage:
 *   node export_glb.mjs <factory.mjs> <out.glb>
 */
import "./node_shims.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function usage() {
  console.error("Usage: node export_glb.mjs <factory.mjs> <out.glb>");
  process.exit(2);
}

const factoryPath = path.resolve(process.argv[2] || "");
const outPath = path.resolve(process.argv[3] || "");
if (!factoryPath || !outPath) usage();
if (!fs.existsSync(factoryPath)) {
  console.error(`Factory not found: ${factoryPath}`);
  process.exit(1);
}

const THREE = await import("three");
const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
const { bakeMeshAnimationClips } = await import("./bake_mesh_animation.mjs");

const mod = await import(pathToFileURL(factoryPath).href);
const factory =
  (typeof mod.default === "function" && mod.default) ||
  (typeof mod.createModel === "function" && mod.createModel) ||
  (typeof mod.createObjectModel === "function" && mod.createObjectModel) ||
  (typeof mod.build === "function" && mod.build);

if (typeof factory !== "function") {
  console.error(
    "Factory must export default/createModel/createObjectModel/build as a function(THREE) → Object3D"
  );
  process.exit(1);
}

let root;
try {
  root = factory(THREE);
} catch (err) {
  console.error(`Factory threw: ${err?.stack || err}`);
  process.exit(1);
}

if (!root || !root.isObject3D) {
  console.error("Factory did not return a THREE.Object3D / Group / Mesh");
  process.exit(1);
}

// Tag for the Render3D viewport: keep authored PBR (do not apply CAD plastic style).
root.userData.render3dStyle = "shaded";
root.userData.render3dPipeline = "img2threejs";
root.name = root.name || "MeshModel";
if (root.userData.animation) {
  root.userData.render3dMeshBeta = true;
}

root.updateMatrixWorld(true);
let visibleTriangles = 0;
root.traverseVisible((object) => {
  if (!object.isMesh) return;
  const position = object.geometry?.getAttribute('position');
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  if (!materials.some((material) => material && material.visible !== false && (!material.transparent || material.opacity > 0))) return;
  if (!position || position.count < 3) throw new Error('Visible mesh has no triangle vertices');
  if (![...object.matrixWorld.elements, ...position.array].every(Number.isFinite)) {
    throw new Error('Mesh contains nonfinite coordinates or transforms');
  }
  visibleTriangles += Math.floor((object.geometry.index?.count ?? position.count) / 3);
});
if (!visibleTriangles) throw new Error('Factory produced no visible triangle geometry');
let box = new THREE.Box3().setFromObject(root);
if (box.isEmpty()) {
  console.error("Factory produced an empty bounding box");
  process.exit(1);
}

// Factories are always Three.js Y-up. Always rotate into Render Studio Z-up.
// A bbox heuristic skipped plates/cars (Y not taller than Z) and left them
// standing on edge in the viewport.
root.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
root.updateMatrixWorld(true);
const converted = true;
root.userData.render3dZUp = true;
box = new THREE.Box3().setFromObject(root);

const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());
root.position.x -= center.x;
root.position.y -= center.y;
root.position.z -= box.min.z;
root.updateMatrixWorld(true);

if (size.length() < 1e-6) {
  console.error("Factory produced an empty / degenerate bounding box");
  process.exit(1);
}

const scene = new THREE.Scene();
scene.name = "Render3DMeshScene";
scene.userData.render3dStyle = "shaded";
scene.userData.render3dPipeline = "img2threejs";
if (root.userData.animation) {
  scene.userData.animation = root.userData.animation;
  scene.userData.render3dMeshBeta = true;
}
scene.add(root);

function writeGlbAtomic(dest, buffer) {
  const tmp = `${dest}.tmp`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(tmp, Buffer.from(buffer));
  fs.renameSync(tmp, dest);
}

function exportBinary(object, clips = []) {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      object,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error("Expected binary GLB ArrayBuffer from GLTFExporter"));
      },
      (err) => reject(err || new Error("GLTFExporter failed")),
      {
        binary: true,
        onlyVisible: true,
        animations: clips,
        // TRS required so keyed quaternion tracks bind correctly in Blender.
        trs: clips.length > 0,
      }
    );
  });
}

const livePath = outPath.replace(/\.glb$/i, ".generation-live.glb");
let staticBuf = null;
try {
  staticBuf = await exportBinary(scene, []);
  if (staticBuf.byteLength >= 80 && staticBuf.byteLength <= 48 * 1024 * 1024) {
    writeGlbAtomic(livePath, staticBuf);
  }
} catch (err) {
  console.error(`Live preview export skipped: ${err?.message || err}`);
}

// Bake procedural userData.animation into real glTF AnimationClips so Blender
// (and other DCCs) can import mesh motion, not just static geometry + extras.
const animationClips = bakeMeshAnimationClips(THREE, scene);
if (animationClips.length) {
  scene.animations = animationClips;
}

let arrayBuffer = staticBuf;
if (animationClips.length || !arrayBuffer) {
  arrayBuffer = await exportBinary(scene, animationClips);
}
writeGlbAtomic(outPath, arrayBuffer);
const bytes = arrayBuffer.byteLength;
const finalBox = new THREE.Box3().setFromObject(root);
const finalSize = finalBox.getSize(new THREE.Vector3());
console.log(
  JSON.stringify({
    ok: true,
    out: outPath,
    bytes,
    size: [finalSize.x, finalSize.y, finalSize.z],
    y_up_converted: converted,
    has_animation: !!root.userData.animation,
    animation_clips: animationClips.map((c) => c.name),
    visible_triangles: visibleTriangles,
    runtime: { node: process.version, three: THREE.REVISION, exporter: 'GLTFExporter', up_axis: 'z' },
  })
);
