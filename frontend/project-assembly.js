/** Multi-component project assembly — Fusion-style browser + viewport. */

import * as THREE from "three";
import { disposeStyledModel } from "./scene-style.js?v=20260725-mobile-lit";

export function createProjectAssembly(scene) {
  const root = new THREE.Group();
  root.name = "ProjectAssembly";
  scene.add(root);

  /** @type {Map<string, THREE.Object3D>} */
  const components = new Map();

  function clear() {
    for (const obj of components.values()) {
      root.remove(obj);
      disposeStyledModel(obj);
    }
    components.clear();
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
    return String(name || "")
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/^.+?__\d+_/, "")
      .replace(/_edited(?:_\d+)?$/i, "")
      .replace(/_cleaned(?:_\d+)?$/i, "")
      .replace(/_(loops|duct|hole|extruded|pulled|mirrored)(?:_\d+)?$/i, "")
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

  function add(catalogName, object3d) {
    const key = String(catalogName || "");
    if (!key || !object3d) return null;
    const targetStem = componentStem(key);
    // Never keep two catalogs for the same part (e.g. .step + _edited.glb, or jake + paint).
    for (const [name] of [...components.entries()]) {
      if (name === key) continue;
      if (componentStem(name) === targetStem) {
        root.remove(components.get(name));
        disposeStyledModel(components.get(name));
        components.delete(name);
      }
    }
    if (components.has(key)) {
      root.remove(components.get(key));
      disposeStyledModel(components.get(key));
    }
    object3d.userData.catalogFilename = key;
    object3d.name = key.replace(/\.[^.]+$/, "") || key;
    root.add(object3d);
    components.set(key, object3d);
    return object3d;
  }

  function remove(catalogName) {
    const obj = components.get(catalogName);
    if (!obj) return;
    root.remove(obj);
    disposeStyledModel(obj);
    components.delete(catalogName);
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
    return changed;
  }

  function list() {
    return [...components.entries()];
  }

  function boundingBox() {
    if (!components.size) return null;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let hasVisible = false;
    for (const obj of components.values()) {
      if (obj?.visible === false) continue;
      const objBox = new THREE.Box3().setFromObject(obj);
      if (objBox.isEmpty()) continue;
      box.union(objBox);
      hasVisible = true;
    }
    return hasVisible ? box : null;
  }

  return {
    clear,
    has,
    count,
    get,
    getRoot,
    add,
    remove,
    setVisible,
    list,
    boundingBox,
  };
}

export function filesToBrowserComponents(files = []) {
  const byStem = new Map();
  const preferred = [".glb", ".gltf", ".step", ".stp", ".3mf", ".stl", ".obj", ".ply", ".off"];
  const baseStem = (name = "") => name.replace(/\.[^.]+$/, "").replace(/_edited(?:_\d+)?$/i, "");
  const isInternalModelArtifact = (name = "") => {
    const lower = String(name || "").toLowerCase();
    return lower.startsWith("_active_") || lower.startsWith("_export_") || (lower.startsWith(".") && lower.endsWith(".step.glb"));
  };
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
    const viewer =
      [".step", ".stp", ".3mf"].includes(suffix)
        ? group.find((g) => String(g.name || "").toLowerCase().endsWith(".glb"))?.name || canonicalName
        : canonicalName;
    components.push({
      id: stem,
      name: canonicalName,
      stem,
      format: suffix.replace(".", ""),
      viewer_filename: viewer,
      size: canonical.size,
    });
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
