import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeWorkshopConfig,
  readWorkshopConfig,
  saveWorkshopConfig,
} from "./workshop-config.js";
import { addAssetToScene, activeSceneSpawn, exportableScenePackage, publishSceneToMarketplace } from "./scene-manifest.js";
import { shouldReloadViewportProject } from "./document-tabs.js";

test("scene manifest keeps a project GLB life-size and fits avatar-safe bounds", () => {
  const manifest = addAssetToScene(null, {
    projectId: "0a12e415",
    filename: "mesh/Optimized Realistic Industrial Robotics.glb",
    label: "Industrial Robotics Workshop",
    dimensionsMeters: [8, 3.5, 10],
  });
  assert.deepEqual(manifest.assets[0].transform.scale, [1, 1, 1]);
  assert.equal(manifest.assets[0].metersPerUnit, 1);
  assert.equal(manifest.bounds.width, 13.25);
  assert.equal(manifest.bounds.depth, 15.25);
  manifest.spawnPoints.push({ id: "robot", label: "Robot", position: [2, 1.7, -3], yaw: 1.57 });
  manifest.activeSpawnId = "robot";
  assert.deepEqual(activeSceneSpawn(manifest).position, [2, 1.7, -3]);
  const pkg = exportableScenePackage(manifest);
  assert.equal(pkg.install.action, "install_scene_manifest");
  assert.equal(pkg.publication.state, "exported");
});

test("Viewport reloads only when an open project has no assembly", () => {
  assert.equal(shouldReloadViewportProject({ projectId: "0a12e415", assemblyCount: 0, loading: false }), true);
  assert.equal(shouldReloadViewportProject({ projectId: "0a12e415", assemblyCount: 1, loading: false }), false);
  assert.equal(shouldReloadViewportProject({ projectId: "0a12e415", assemblyCount: 0, loading: true }), false);
});

test("scene publish creates a downloadable marketplace listing and pins it to the profile", async () => {
  const calls = [];
  const manifest = addAssetToScene(null, { projectId: "0a12e415", filename: "mesh/workshop.glb" });
  const listing = await publishSceneToMarketplace(async (path, options) => {
    calls.push([path, JSON.parse(options.body)]);
    return { listing: { id: "scene-listing", status: "approved" } };
  }, manifest, { pinToProfile: async (row) => calls.push(["pin", row.id]) });
  assert.equal(listing.id, "scene-listing");
  assert.equal(calls[0][0], "/api/model-listings");
  assert.equal(calls[0][1].category, "workshop-scenes");
  assert.equal(calls[0][1].files[0].product_type, "render-studio-scene/v1");
  assert.deepEqual(calls[1], ["pin", "scene-listing"]);
});

test("canonical Workshop migration preserves preferences and clears procedural world pieces", () => {
  const config = normalizeWorkshopConfig({
    scene: { name: "My Lab", walkSpeed: 99, background: "#112233", spawn: { x: 2, y: 1.8, z: -4 } },
    monitors: { editor: "screen_generated_files", files: "not-a-screen" },
    world: { pieces: [{ id: "lamp-a", kind: "lamp", x: 3, z: -1 }] },
  }, "project-a");
  assert.deepEqual({
    projectId: config.projectId,
    name: config.scene.name,
    speed: config.scene.walkSpeed,
    editor: config.monitors.editor,
    files: config.monitors.files,
    pieces: config.world.pieces,
  }, {
    projectId: "project-a",
    name: "My Lab",
    speed: 4,
    editor: "screen_generated_files",
    files: "screen_generated_files",
    pieces: [],
  });
});

test("Workshop config is personal and shared when projects change", () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    key: (index) => [...values.keys()][index] || null,
    get length() { return values.size; },
  };
  const config = normalizeWorkshopConfig({ scene: { name: "My Workshop" } }, "alpha");
  config.manifest = addAssetToScene(config.manifest, {
    projectId: "0a12e415",
    filename: "mesh/Optimized Realistic Industrial Robotics.glb",
  });
  saveWorkshopConfig(config, "alpha");
  const fromAnotherProject = readWorkshopConfig("beta");
  assert.equal(fromAnotherProject.scene.name, "My Workshop");
  assert.equal(fromAnotherProject.manifest.assets[0].projectId, "0a12e415");
  assert.equal(fromAnotherProject.manifest.assets[0].filename, "mesh/Optimized Realistic Industrial Robotics.glb");
});

test("Workshop assets and viewport are lazy behind the pinned tab activation", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const xr = readFileSync(new URL("../xr/viewport-xr.js", import.meta.url), "utf8");
  assert.match(app, /import\("\.\/workshop-editor\.js\?v=[^"]+"\)/);
  assert.doesNotMatch(app, /^import .*workshop-editor/m);
  assert.match(app, /tab\.kind === "workshop"[\s\S]{0,500}openWorkshopEditor\(\)/);
  assert.doesNotMatch(xr, /0a12e415|Optimized Realistic Industrial Robotics\.glb/);
  assert.match(xr, /let xrWorkshopRoom = null/);
  assert.match(xr, /function enterWorkshop\(config = \{\}\)/);
  assert.match(xr, /fetchWorkshopAsset\(asset\)/);
  assert.match(xr, /xrGltfLoader\.loadAsync\(url\)/);
  assert.match(xr, /root\.position\.y -= roomBounds\.min\.y/);
  assert.match(xr, /function moveWorkshopPlayer\(delta\)/);
  assert.match(xr, /workshopViewMode === "first" \? "third" : "first"/);
  assert.match(xr, /agentJoin\.openMenu\(\)/);
});
