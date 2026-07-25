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

root.updateMatrixWorld(true);
let box = new THREE.Box3().setFromObject(root);
if (box.isEmpty()) {
  console.error("Factory produced an empty bounding box");
  process.exit(1);
}

const size0 = box.getSize(new THREE.Vector3());
// Three.js factories are Y-up. If height lives mainly on Y, rotate into Render3D Z-up.
const looksYUp = size0.y >= size0.z * 1.05;
let converted = false;
if (looksYUp) {
  // +Y → +Z (wheels/ground stay "down" after rotation).
  root.rotateX(Math.PI / 2);
  root.updateMatrixWorld(true);
  converted = true;
  box = new THREE.Box3().setFromObject(root);
}

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
scene.add(root);

const exporter = new GLTFExporter();
const arrayBuffer = await new Promise((resolve, reject) => {
  exporter.parse(
    scene,
    (result) => {
      if (result instanceof ArrayBuffer) resolve(result);
      else reject(new Error("Expected binary GLB ArrayBuffer from GLTFExporter"));
    },
    (err) => reject(err || new Error("GLTFExporter failed")),
    { binary: true, onlyVisible: true }
  );
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
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
  })
);
