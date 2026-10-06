import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assembly = readFileSync(join(here, "../components/project-assembly.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const gizmo = readFileSync(join(here, "gizmo-panel.js"), "utf8");
const xr = readFileSync(join(here, "../xr/viewport-xr.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");

test("assembly replace detaches objects that live under CadTransformPivot", () => {
  assert.ok(assembly.includes("export function detachSceneObject"));
  assert.ok(assembly.includes("obj.removeFromParent"));
  assert.ok(assembly.includes("detachSceneObject(components.get(name))"));
  assert.ok(assembly.includes("detachSceneObject(obj)"));
  assert.equal(/function remove[\s\S]{0,180}root\.remove\(obj\)/.test(assembly), false);
});

test("FreeCAD create persist releases the gizmo pivot before swapping the GLB", () => {
  const persist = app.slice(app.indexOf("async function persistCreateSolidInstant"));
  const window = persist.slice(0, persist.indexOf("async function xrCadCreatePrimitive"));
  assert.ok(window.includes("releaseCadTransformPivot()"));
  assert.ok(window.includes("transformControls.detach()"));
  const detachAt = window.indexOf("releaseCadTransformPivot()");
  const snapAt = window.indexOf("const savedPos = object.position.clone()");
  assert.ok(detachAt >= 0 && snapAt > detachAt);
  assert.ok(window.includes("replaceCatalog: localName"));
});

test("gizmo Apply does not POST /transform for .local ghosts under a pivot", () => {
  assert.ok(gizmo.includes("catalogMesh?.userData"));
  assert.ok(gizmo.includes("/\\.local$/i.test(catalogName)"));
  assert.ok(gizmo.includes("Moved local object"));
  assert.ok(gizmo.includes("liveData.architectInstance"));
  assert.equal(gizmo.includes("liveData.localOnly || liveData.architectInstance"), false);
});

test("gizmo drag-end writes FreeCAD /transform even when attached to CadTransformPivot", () => {
  assert.ok(app.includes("function resolveTransformCatalogName"));
  assert.ok(app.includes("function kernelApiFilename"));
  assert.ok(app.includes("cadSafeAttach"));
  assert.ok(app.includes("attachWithCadPivot(isolated)"));
  assert.ok(gizmo.includes("placementBaselineFromStroke"));
  assert.ok(gizmo.includes("kernelTranslation"));
  assert.ok(gizmo.includes("Select an object in the project, then move it so FreeCAD can save the pose"));
  assert.ok(gizmo.includes("useBodyTransform"));
  assert.ok(gizmo.includes("transform-body"));
  assert.match(gizmo, /bodyCount\) > 1 && !isRoot/);
});

test("cache-bust token 20260908-xf-dup is wired on gizmo/assembly", () => {
  assert.ok(app.includes("gizmo-panel.js?v=20260908-xf-dup"));
  assert.ok(app.includes("project-assembly.js?v=20260908-cadframe2-projvp1"));
  assert.match(html, /app\.js\?v=20260908-/);
  assert.match(html, /app\.js\?v=20260908-.*fcdoc1/);
  assert.match(html, /app\.js\?v=.*20260915-measure1/);
  assert.ok(app.includes("gizmo-panel.js?v=20260908-xf-dup-rscale1-keymap1-fcplace1-fcdoc1-20260914-ttrans2-20260915-measure1"));
});

test("XR grip-move does not commit a second FreeCAD solid", () => {
  const grip = xr.slice(xr.indexOf("function updateGripGrab"), xr.indexOf("function updateGrab"));
  assert.ok(grip.includes("notifyMeshMoved"));
  assert.equal(grip.includes("commitXrSolidSpec"), false);
  assert.equal(grip.includes("onCreateXrSolid"), false);
  assert.ok(app.includes("if (viewportXR?.isPresenting?.()) return;"));
});

test("detachSceneObject contract: pivot child leaves the graph", () => {
  function detachSceneObject(obj) {
    if (!obj) return;
    if (typeof obj.removeFromParent === "function") {
      obj.removeFromParent();
      return;
    }
    obj.parent?.remove?.(obj);
  }
  const pivot = {
    children: [],
    remove(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      if (child.parent === this) child.parent = null;
    },
  };
  const mesh = {
    parent: pivot,
    removeFromParent() {
      this.parent?.remove(this);
    },
  };
  pivot.children.push(mesh);
  detachSceneObject(mesh);
  assert.equal(mesh.parent, null);
  assert.equal(pivot.children.length, 0);
});
