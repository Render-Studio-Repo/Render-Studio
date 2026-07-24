#!/usr/bin/env node
/**
 * Headless Three.js → GLB exporter for Render3D Mesh mode (img2threejs).
 *
 * Usage:
 *   node export_glb.mjs <factory.mjs> <out.glb>
 *
 * Uses dynamic imports so node_shims.js installs FileReader before Three loads.
 */
import "./node_shims.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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

// Load Three after shims (side-effect import above runs first among static deps,
// but sibling ESM imports of three would still hoist — keep three dynamic).
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

root.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(root);
if (!box.isEmpty()) {
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
}

const scene = new THREE.Scene();
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
  })
);
