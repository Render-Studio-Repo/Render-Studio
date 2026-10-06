/** Multi-component project assembly — Fusion-style browser + viewport. */

import * as THREE from "three";
import { loadedGeometryBounds } from "../viewport/loaded-mesh-resources.js?v=20260915-load-resources2";
import { disposeStyledModel } from "../viewport/scene-style.js?v=20260907-iphone-view2-20260915-cadcolor2-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2&xrtalk=20260916-1&astra=20260916-5";
import { dominantClusterBox, explodedOverviewBox, isJakeStepPreviewName, isUsableFrameBox } from "../viewport/viewport-frame.js?v=20260908-cadframe2-projvp1&explfit1";
import { isInternalModelArtifactName } from "../viewport/project-mesh-load.js?v=20260908-loadstall2-shareskip1-projswap1-20260910-project-load1-jakeglb1";

/** Drop a catalog object even when TransformControls reparented it under CadTransformPivot. */
export function detachSceneObject(obj) {
  if (!obj) return;
  try {
    if (typeof obj.removeFromParent === "function") {
      obj.removeFromParent();
      return;
    }
  } catch (_) {}
  try { obj.parent?.remove?.(obj); } catch (_) {}
}

export function createProjectAssembly(scene) {
  const root = new THREE.Group();
  root.name = "ProjectAssembly";
  root.userData.isProjectAssembly = true;
  scene.add(root);

  /** @type {Map<string, THREE.Object3D>} */
  const components = new Map();
  /** Detached GPU trees waiting for a safe (non-XR) dispose. */
  const deferredDispose = [];

  function enqueueDispose(obj, { soft = false } = {}) {
    if (!obj) return;
    if (soft) {
      deferredDispose.push(obj);
      return;
    }
    try { disposeStyledModel(obj); } catch (_) {}
  }

  function flushDeferredDispose() {
    while (deferredDispose.length) {
      const obj = deferredDispose.pop();
      try { disposeStyledModel(obj); } catch (_) {}
    }
  }

  function clear({ soft = false } = {}) {
    for (const obj of components.values()) {
      detachSceneObject(obj);
      enqueueDispose(obj, { soft });
    }
    components.clear();
    const leftovers = [...root.children];
    for (const obj of leftovers) {
      detachSceneObject(obj);
      enqueueDispose(obj, { soft });
    }
    invalidateBounds();
    if (!soft) flushDeferredDispose();
  }

  let detached = false;
  let boundsCache = null;

  function invalidateBounds() {
    boundsCache = null;
  }

  function detachFromScene() {
    if (detached) return;
    if (root.parent === scene) scene.remove(root);
    else if (root.parent) root.parent.remove(root);
    detached = true;
  }

  function attachToScene() {
    if (!detached && root.parent === scene) return;
    if (root.parent && root.parent !== scene) root.parent.remove(root);
    if (root.parent !== scene) scene.add(root);
    detached = false;
    invalidateBounds();
  }

  function isDetached() {
    return detached || root.parent !== scene;
  }

  /** Safe XR idle pose — tiny + hidden so Quest never sees desktop-scale CAD. */
  function resetXrSafeTransform() {
    root.visible = false;
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.setScalar(1e-6);
    root.updateMatrixWorld(true);
    invalidateBounds();
  }

  /**
   * Desktop CAD pose. beginProjectSwap parks the root at 1e-6 for Quest;
   * that must never leak into the PC viewport or every project is a speck.
   */
  function restoreDesktopTransform({ unbakeChildren = true } = {}) {
    root.visible = true;
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    if (unbakeChildren) {
      for (const obj of components.values()) {
        if (!obj?.scale) continue;
        const sx = Math.abs(Number(obj.scale.x) || 0);
        if (sx > 0 && sx < 0.05) {
          obj.scale.set(1, 1, 1);
          continue;
        }
        if (sx > 0 && sx < 0.95) {
          try {
            obj.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(obj);
            if (box.isEmpty()) continue;
            const worldMax = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 0);
            const localMax = worldMax / sx;
            // XR handheld bake: world ~12cm but source is CAD-sized.
            if (worldMax < 0.35 && localMax > 0.4) obj.scale.set(1, 1, 1);
          } catch (_) { /* keep authored scale */ }
        }
      }
    }
    root.updateMatrixWorld(true);
    invalidateBounds();
  }

  function has(name) {
    return components.has(name);
  }

  function count() {
    return components.size;
  }

  function get(name) {
    return components.get(name) || null;
  }

  function getRoot() {
    return root;
  }

  function componentStem(name = "") {
    // Only collapse explicit edit/copy suffixes. Do not strip __part_01_ / __0_
    // prefixes — those are distinct bodies, and matching them would delete
    // sibling models when one part is transformed.
    return String(name || "")
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/_edited(?:_\d+)?$/i, "")
      .replace(/_cleaned(?:_\d+)?$/i, "")
      .replace(/_copy\d*$/i, "");
  }

  function objectMatchesStem(obj, targetStem) {
    if (!targetStem) return false;
    const values = [
      obj?.name,
      obj?.userData?.catalogFilename,
      obj?.userData?.name,
      obj?.userData?.filename,
    ].filter(Boolean).map(String);
    return values.some((value) => componentStem(value) === targetStem);
  }

  function add(catalogName, object3d, { soft = false } = {}) {
    const key = String(catalogName || "");
    if (!key || !object3d) return null;
    const targetStem = componentStem(key);
    // Never keep two catalogs for the same part (e.g. .step + _edited.glb, or jake + paint).
    for (const [name] of [...components.entries()]) {
      if (name === key) continue;
      if (componentStem(name) === targetStem) {
        detachSceneObject(components.get(name));
        enqueueDispose(components.get(name), { soft });
        components.delete(name);
      }
    }
    if (components.has(key)) {
      detachSceneObject(components.get(key));
      enqueueDispose(components.get(key), { soft });
    }
    object3d.userData.catalogFilename = key;
    object3d.traverse((child) => {
      if (!child.userData.catalogFilename) child.userData.catalogFilename = key;
    });
    object3d.name = key.replace(/\.[^.]+$/, "") || key;
    root.add(object3d);
    components.set(key, object3d);
    invalidateBounds();
    return object3d;
  }

  function remove(catalogName, { soft = false } = {}) {
    const obj = components.get(catalogName);
    if (!obj) return;
    detachSceneObject(obj);
    enqueueDispose(obj, { soft });
    components.delete(catalogName);
    invalidateBounds();
  }

  function setVisible(catalogName, visible) {
    const key = String(catalogName || "");
    const targetStem = componentStem(key);
    let changed = false;
    for (const [name, obj] of components) {
      const objStem = componentStem(name);
      const catalogStem = componentStem(obj?.userData?.catalogFilename || "");
      const topLevelMatch = name === key || obj?.userData?.catalogFilename === key || objStem === targetStem || catalogStem === targetStem;
      if (topLevelMatch) {
        obj.visible = visible;
        obj.traverse?.((child) => {
          if (child !== obj) child.visible = visible;
        });
        changed = true;
        continue;
      }
      obj.traverse?.((child) => {
        if (!objectMatchesStem(child, targetStem)) return;
        child.visible = visible;
        child.traverse?.((nested) => {
          nested.visible = visible;
        });
        changed = true;
      });
    }
    if (changed) invalidateBounds();
    return changed;
  }

  function list() {
    return [...components.entries()];
  }

  function isWorldVisible(obj) {
    let node = obj;
    while (node) {
      if (node.visible === false) return false;
      node = node.parent;
    }
    return true;
  }

  function hasFitHelperAncestor(obj) {
    let node = obj;
    while (node) {
      const u = node.userData || {};
      // Skip LCS / URDF dummy spheres / origin helpers. Do not treat isUrdfRobot
      // as a helper — real CAD meshes sit under that root.
      if (u.jointOverlay || u.excludeFromFit || u.urdfPlaceholder || u.isOriginHelper || u.isAxisGuide) {
        return true;
      }
      node = node.parent;
    }
    return false;
  }

  function collectVisibleMeshBoxes(obj, into) {
    const size = new THREE.Vector3();
    obj?.traverse?.((child) => {
      if (!child?.isMesh || !child.geometry) return;
      if (!isWorldVisible(child)) return;
      if (child.userData?.isSilhouette || child.userData?.isEdge) return;
      if (hasFitHelperAncestor(child)) return;
      if (child.userData?.isUrdfRobot) return;
      if (child.isLine || child.isLineSegments2 || child.isPoints) return;
      const pos = child.geometry.getAttribute?.("position");
      if (!pos || pos.count < 3) return;
      child.updateWorldMatrix(false, false);
      const local = loadedGeometryBounds(child.geometry);
      if (!local || local.isEmpty()) return;
      const world = local.clone().applyMatrix4(child.matrixWorld);
      if (!isUsableFrameBox(world)) return;
      const span = world.getSize(size).length();
      if (!(span > 1e-8) || !Number.isFinite(span)) return;
      into.push({
        min: { x: world.min.x, y: world.min.y, z: world.min.z },
        max: { x: world.max.x, y: world.max.y, z: world.max.z },
      });
    });
  }

  function threeBoxFromPlain(plain) {
    if (!plain || !isUsableFrameBox(plain)) return null;
    return new THREE.Box3(
      new THREE.Vector3(plain.min.x, plain.min.y, plain.min.z),
      new THREE.Vector3(plain.max.x, plain.max.y, plain.max.z),
    );
  }

  function visibleClusterBox(objects) {
    const parts = [];
    for (const obj of objects) {
      if (!obj || obj.visible === false) continue;
      collectVisibleMeshBoxes(obj, parts);
    }
    return threeBoxFromPlain(dominantClusterBox(parts));
  }

  function boundingBox({ force = false, union = false } = {}) {
    if (!components.size) {
      boundsCache = null;
      return null;
    }
    // union=true (explfit1 exploded overview) must not reuse the clustered cache.
    if (!union && !force && boundsCache) return boundsCache.clone();
    // XR park / leftover handheld bake makes world AABB a speck — do not frame that.
    const sx = Math.abs(Number(root.scale?.x) || 0);
    if (sx > 0 && sx < 0.05) {
      boundsCache = null;
      return null;
    }
    root.updateMatrixWorld(true);
    const parts = [];
    for (const obj of components.values()) {
      if (!obj || obj.visible === false) continue;
      collectVisibleMeshBoxes(obj, parts);
    }
    const box = union
      ? threeBoxFromPlain(explodedOverviewBox(parts))
      : threeBoxFromPlain(dominantClusterBox(parts));
    if (!union) boundsCache = box ? box.clone() : null;
    return box;
  }

  function boundingBoxFor(name) {
    const obj = components.get(name);
    if (!obj || obj.visible === false) return null;
    const sx = Math.abs(Number(root.scale?.x) || 0);
    if (sx > 0 && sx < 0.05) return null;
    root.updateMatrixWorld(true);
    return visibleClusterBox([obj]);
  }

  return {
    clear,
    flushDeferredDispose,
    has,
    count,
    get,
    getRoot,
    add,
    remove,
    setVisible,
    list,
    boundingBox,
    boundingBoxFor,
    invalidateBounds,
    detachFromScene,
    attachToScene,
    isDetached,
    resetXrSafeTransform,
    restoreDesktopTransform,
  };
}

export { isJakeStepPreviewName };

export function isViewportMeshName(name = "") {
  const lower = String(name || "").toLowerCase();
  if (!lower) return false;
  if (isJakeStepPreviewName(name)) return true;
  if (/\.(step|stp)$/i.test(lower)) return false;
  return /\.(glb|gltf|stl|obj|ply|off)$/i.test(lower);
}

export function filesToBrowserComponents(files = []) {
  const byStem = new Map();
  const preferred = [".glb", ".gltf", ".step", ".stp", ".3mf", ".obj", ".ply", ".off"];
  const baseStem = (name = "") => name.replace(/\.[^.]+$/, "").replace(/_edited(?:_\d+)?$/i, "");
  const isInternalModelArtifact = isInternalModelArtifactName;
  const parentExists = (stem) => {
    const lower = String(stem || "").toLowerCase();
    return [...byStem.keys()].some((key) => String(key).toLowerCase() === lower);
  };
  const promotedPartParent = (stem = "") => {
    const detailed = String(stem).match(/^(.+)__part_\d+_/i);
    if (detailed && parentExists(detailed[1])) return detailed[1];
    const compact = String(stem).match(/^(.+)_part\d+(?:_\d+)?$/i);
    if (compact && parentExists(compact[1])) return compact[1];
    return null;
  };
  for (const f of files) {
    if (!f?.name) continue;
    if (isInternalModelArtifact(f.name)) continue;
    const stem = baseStem(f.name);
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(f);
  }
  const components = [];
  const partBuckets = new Map();
  for (const [stem, group] of byStem) {
    const parentStem = promotedPartParent(stem);
    if (parentStem) {
      if (!partBuckets.has(parentStem)) partBuckets.set(parentStem, []);
      partBuckets.get(parentStem).push({ stem, group });
      continue;
    }
    let canonical = group[0];
    const edited = group
      .filter((g) => /_edited(?:_\d+)?\.glb$/i.test(String(g.name || "")))
      .sort((a, b) => String(b.name).localeCompare(String(a.name)))[0];
    if (edited) canonical = edited;
    for (const ext of preferred) {
      if (edited) break;
      const match = group.find((g) => String(g.name || "").toLowerCase().endsWith(ext));
      if (match) {
        canonical = match;
        break;
      }
    }
    const canonicalName = String(canonical.name || "");
    const suffix = canonicalName.slice(canonicalName.lastIndexOf(".")).toLowerCase();
    const glbSibling = group.find((g) => String(g.name || "").toLowerCase().endsWith(".glb"))?.name;
    const recoveredViewer = String(canonical.viewer_filename || "").trim();
    const viewer =
      recoveredViewer && (isJakeStepPreviewName(recoveredViewer) || recoveredViewer !== canonicalName)
        ? recoveredViewer
        : [".step", ".stp", ".3mf", ".stl"].includes(suffix)
        ? glbSibling || canonicalName
        : canonicalName;
    const catalogHardware = /^[0-9]{3,6}[A-Za-z][0-9A-Za-z]{1,8}$/.test(stem);
    const entry = {
      id: stem,
      name: canonicalName,
      stem,
      format: suffix.replace(".", ""),
      viewer_filename: viewer,
      size: canonical.size,
      catalog_hardware: catalogHardware,
    };
    if (catalogHardware) entry.auto_load = false;
    components.push(entry);
  }

  const byComponentStem = new Map(components.map((entry) => [entry.stem, entry]));
  for (const [parentStem, parts] of partBuckets) {
    const parent = byComponentStem.get(parentStem);
    if (!parent) continue;
    const ranked = parts
      .map(({ stem }) => {
        const compact = stem.match(/_part(\d+)(?:_(\d+))?$/i);
        if (compact) {
          return {
            num: Number(compact[1]),
            rev: Number(compact[2] || 0),
            label: `Body ${Number(compact[1])}`,
            stem,
          };
        }
        const detailed = stem.match(/__part_(\d+)_(.+)$/i);
        if (detailed) {
          return {
            num: Number(detailed[1]),
            rev: 0,
            label: String(detailed[2] || "").replace(/_+/g, " ").trim() || `Body ${Number(detailed[1])}`,
            stem,
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => (a.num - b.num) || (a.rev - b.rev));
    const best = new Map();
    for (const row of ranked) {
      const prev = best.get(row.num);
      if (!prev || row.rev >= prev.rev) best.set(row.num, row);
    }
    const children = [...best.values()].map((row, idx) => ({
      id: `${parent.stem}#body:${idx + 1}`,
      name: `${parent.name}#body:${idx + 1}`,
      filename: parent.name,
      stem: `${parent.stem}_body_${String(idx + 1).padStart(2, "0")}`,
      label: row.label,
      format: "body",
      viewer_filename: parent.viewer_filename,
      source_filename: parent.name,
      parent_filename: parent.name,
      body_index: idx,
      body_name: row.label,
      virtual_body: true,
    }));
    if (children.length > 1) {
      parent.children_label = "Bodies";
      parent.children = children;
    }
  }

  return components.sort((a, b) => a.name.localeCompare(b.name));
}

const _MCMASTER_PN_RE = /^[0-9]{3,6}[A-Za-z][0-9A-Za-z]{1,8}$/;

function isMcMasterHardwareEntry(entry) {
  if (!entry || entry.virtual_folder || entry.catalog_hardware_folder || entry.virtual_body) return false;
  if (entry.catalog_hardware === true) return true;
  const stem = String(entry.stem || "")
    .split(/[/\\]/)
    .pop()
    || String(entry.name || "").replace(/\.[^.]+$/, "");
  const root = String(stem || "").replace(/_edited(?:_\d+)?$/i, "");
  return _MCMASTER_PN_RE.test(root);
}

function mcmasterPartsFolder(hardware = []) {
  return {
    id: "mcmaster-parts",
    name: "McMaster Parts",
    label: "McMaster Parts",
    stem: "mcmaster-parts",
    virtual_folder: true,
    catalog_hardware_folder: true,
    children_label: "McMaster Parts",
    children: hardware,
  };
}

/** Fusion-style: assembled models stay Components; catalog PNs go under Bodies → McMaster Parts. */
export function nestMcMasterHardwareInBrowser(browser = {}) {
  const components = Array.isArray(browser.components) ? [...browser.components] : [];
  const existingBodies = Array.isArray(browser.bodies) ? [...browser.bodies] : [];
  const alreadyNested =
    components.some((entry) => Array.isArray(entry?.hardware) && entry.hardware.length)
    || existingBodies.some((entry) => entry?.catalog_hardware_folder || entry?.virtual_folder);
  const designed = [];
  const hardware = [];
  for (const entry of components) {
    if (!entry) continue;
    if (isMcMasterHardwareEntry(entry)) {
      hardware.push({ ...entry, catalog_hardware: true, auto_load: false, primary: false });
    } else {
      designed.push(entry);
    }
  }
  if (alreadyNested) {
    return { ...browser, components: designed, bodies: existingBodies };
  }
  if (!hardware.length) {
    return { ...browser, components: designed, bodies: existingBodies };
  }
  const parent = designed.find((entry) => entry.primary) || designed[0];
  if (parent) {
    parent.hardware = hardware;
    parent.hardware_label = "McMaster Parts";
    return { ...browser, components: designed, bodies: [] };
  }
  return { ...browser, components: [], bodies: [mcmasterPartsFolder(hardware)] };
}
