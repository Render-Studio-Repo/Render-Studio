const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../..");
const composer = readFileSync(path.join(root, "frontend/components/prompt-composer.js"), "utf8");
const getReferences = composer.slice(composer.indexOf("  function getReferences() {"), composer.indexOf("  function getPromptText() {"));

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));
    await page.route("http://edit-test.local/**", route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/context.js") {
        return route.fulfill({ contentType: "text/javascript", body: readFileSync(path.join(root, "frontend/viewport/edit-reference-context.js"), "utf8") });
      }
      if (url.pathname === "/prompt-edit-context.js") return route.fulfill({ contentType: "text/javascript", body: readFileSync(path.join(root, "frontend/studio/prompt-edit-context.js"), "utf8") });
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><style>body{margin:0;background:#eee}</style><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js"}}</script>` });
    });
    await page.goto("http://edit-test.local/");
    const result = await page.evaluate(async (serializer) => {
      const THREE = await import("three");
      const { captureSourceFrames, captureMaterializedSourceFrame, surfaceEditContext, sameModelLineage, captureEditPlacement, applyEditPlacement, selectionGeometryContext, modelGeometryContext } = await import("/context.js");
      const { selectedGeometryPromptReferences } = await import("/prompt-edit-context.js");
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xeeeeee);
      const model = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshNormalMaterial());
      mesh.position.set(2, 3, 4);
      mesh.rotation.set(0.1, 0.2, 0.3);
      model.add(mesh);
      captureSourceFrames(model);
      const sourceLocal = new THREE.Vector3(1, 0.2, 0.1);
      const expected = mesh.localToWorld(sourceLocal.clone());
      const pivot = new THREE.Vector3(0.3, -0.2, 0.4);
      mesh.geometry.translate(pivot.x, pivot.y, pivot.z);
      mesh.position.set(-1, 0, 0);
      model.position.set(0.4, 0.8, 0);
      model.rotation.set(0.5, -0.3, 0.2);
      model.scale.set(0.8, 1.3, 0.6);
      scene.add(model);
      model.updateMatrixWorld(true);
      const hit = { object: mesh, point: mesh.localToWorld(sourceLocal.clone().add(pivot)), faceIndex: 2 };
      const context = surfaceEditContext(hit, model);
      captureMaterializedSourceFrame(model);
      const error = expected.distanceTo(new THREE.Vector3().fromArray(context.point_source));
      const references = [{ id: "face-1", filename: "Cradle.glb", geometry_context: context }];
      const roundtrip = new Function("references", serializer + "return getReferences();")(references);
      const autoRef = selectedGeometryPromptReferences({ mesh, root: model, faceIndex: 2, catalogName: "Cradle.glb" }, "fixture", selectionGeometryContext)[0];
      const placement = captureEditPlacement(model, scene);
      const replacement = new THREE.Group();
      const extended = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1).translate(0.5, 0, 0), new THREE.MeshNormalMaterial());
      extended.position.set(2, 3, 4);
      extended.rotation.set(0.1, 0.2, 0.3);
      replacement.add(extended);
      captureSourceFrames(replacement);
      captureMaterializedSourceFrame(replacement);
      applyEditPlacement(replacement, placement);
      scene.add(replacement);
      replacement.updateMatrixWorld(true);
      const anchorError = extended.localToWorld(sourceLocal.clone()).distanceTo(hit.point);
      const oldUnitLength = mesh.localToWorld(sourceLocal.clone().add(pivot).add(new THREE.Vector3(1, 0, 0))).distanceTo(hit.point);
      const newUnitLength = extended.localToWorld(sourceLocal.clone().add(new THREE.Vector3(1, 0, 0))).distanceTo(extended.localToWorld(sourceLocal.clone()));
      const scaleRatio = newUnitLength / oldUnitLength;
      scene.remove(model);
      // A second edit must preserve the same source placement too.
      const repeatedPlacementError = Math.max(...captureEditPlacement(replacement, scene).map((v, i) => Math.abs(v - placement[i])));
      const bounds = modelGeometryContext(replacement).source_bounds;
      // XR root presentation must not get baked into the new part a second time.
      scene.scale.setScalar(0.001);
      scene.rotation.set(0.2, 0.1, 0);
      const xrPlacementError = Math.max(...captureEditPlacement(replacement, scene).map((v, i) => Math.abs(v - placement[i])));
      scene.scale.setScalar(1);
      scene.rotation.set(0, 0, 0);
      replacement.position.x += 0.1;
      replacement.updateMatrixWorld(true);
      const movable = extended.localToWorld(sourceLocal.clone()).distanceTo(hit.point) > 0.09;
      replacement.position.x -= 0.1;
      const sibling = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.5), new THREE.MeshNormalMaterial());
      sibling.position.set(1.5, 0, 0);
      scene.add(sibling);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.07), new THREE.MeshBasicMaterial({ color: 0xde3b42 }));
      marker.position.copy(hit.point);
      scene.add(marker);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(900, 600);
      document.body.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 100);
      camera.position.set(5, 4, 8);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const pixels = new Uint8Array(900 * 600 * 4);
      gl.readPixels(0, 0, 900, 600, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.max(...pixels.slice(i, i + 3)) - Math.min(...pixels.slice(i, i + 3)) > 20) colored++;
      return {
        sourceError: error,
        anchorError, scaleRatio, repeatedPlacementError, xrPlacementError, movable,
        hasBounds: bounds.size.every(Number.isFinite),
        selectedFaceHasContext: !!autoRef.geometry_context?.point_source && !!autoRef.geometry_context?.normal_source,
        serialized: JSON.stringify(roundtrip[0].geometry_context) === JSON.stringify(context),
        unrelated: sameModelLineage("Cradle.glb", "Headset.glb"),
        related: sameModelLineage("Cradle_edited_2.glb", "Cradle.step"),
        coloredPixels: colored,
        siblingVisible: sibling.visible,
      };
    }, getReferences);
    assert.ok(result.sourceError < 1e-6, JSON.stringify(result));
    assert.ok(result.anchorError < 1e-6, JSON.stringify(result));
    assert.ok(Math.abs(result.scaleRatio - 1) < 1e-6, JSON.stringify(result));
    assert.ok(result.repeatedPlacementError < 1e-6, JSON.stringify(result));
    assert.ok(result.xrPlacementError < 1e-6, JSON.stringify(result));
    assert.equal(result.movable, true);
    assert.equal(result.hasBounds, true);
    assert.equal(result.selectedFaceHasContext, true);
    assert.equal(result.serialized, true);
    assert.equal(result.unrelated, false);
    assert.equal(result.related, true);
    assert.equal(result.siblingVisible, true);
    assert.ok(result.coloredPixels > 5000, JSON.stringify(result));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: process.env.EDIT_TEST_SCREENSHOT || "/tmp/edit-selected-context.png" });
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
