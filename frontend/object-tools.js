/**
 * Fusion-style object selection, split bodies, and delete tools.
 */

import * as THREE from "three";
import { pickObject } from "./picking.js?v=20260715-sharp-labels";

function listSelectableMeshes(root) {
  if (!root) return [];
  const meshes = [];
  root.traverse((c) => {
    if (!c.isMesh || !c.geometry) return;
    if (c.userData.isEdge || c.userData.isSilhouette) return;
    meshes.push(c);
  });
  return meshes;
}

export function createObjectTools({
  scene,
  getMeshRoot,
  getModelInfo,
  api,
  onApplied,
  onStatus,
  transformControls,
}) {
  let selected = null;
  let highlights = [];
  let bodyInfo = null;
  let bodyInfoFilename = null;
  let multiTransformGroup = null;
  let multiTransformItems = [];

  function setStatus(kind, text) {
    onStatus?.(kind, text);
  }

  function removeHighlight() {
    clearPartTint();
    for (const h of highlights) {
      scene.remove(h);
      h.geometry?.dispose?.();
      h.material?.dispose?.();
    }
    highlights = [];
  }

  function clearMultiTransformGroup() {
    if (!multiTransformGroup) return;
    const items = [...multiTransformItems];
    for (const item of items) {
      if (!item?.object || !item.originalParent) continue;
      try {
        item.originalParent.attach(item.object);
      } catch {
        item.originalParent.add(item.object);
      }
    }
    scene.remove(multiTransformGroup);
    multiTransformGroup = null;
    multiTransformItems = [];
  }

  function createMultiTransformGroup(items = []) {
    clearMultiTransformGroup();
    const objects = [];
    const seen = new Set();
    for (const item of items) {
      const object = item.root || item.mesh;
      if (!object || seen.has(object)) continue;
      seen.add(object);
      objects.push(object);
    }
    if (objects.length < 2) return objects[0] || null;
    const box = new THREE.Box3();
    objects.forEach((obj) => {
      obj.updateMatrixWorld?.(true);
      box.union(new THREE.Box3().setFromObject(obj));
    });
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    multiTransformGroup = new THREE.Group();
    multiTransformGroup.name = "Render3D multi-selection transform";
    multiTransformGroup.userData.isMultiSelectionTransform = true;
    multiTransformGroup.position.copy(center);
    scene.add(multiTransformGroup);
    multiTransformItems = objects.map((object) => ({
      object,
      originalParent: object.parent,
    }));
    for (const object of objects) {
      multiTransformGroup.attach(object);
    }
    return multiTransformGroup;
  }

  function clearSelection({ detachGizmo = true } = {}) {
    clearMultiTransformGroup();
    selected = null;
    removeHighlight();
    if (detachGizmo && transformControls?.object) {
      transformControls.detach();
    }
    window.dispatchEvent(new CustomEvent("render3d:object-selection-changed", { detail: { selected: null } }));
  }

  function bodyIndexForFace(faceIndex) {
    if (faceIndex == null || !bodyInfo?.face_offsets?.length) return 0;
    const offsets = bodyInfo.face_offsets;
    for (let i = offsets.length - 1; i >= 0; i--) {
      if (faceIndex >= offsets[i]) return i;
    }
    return 0;
  }

  function meshLabel(mesh, root, bodyIndex) {
    const meshes = listSelectableMeshes(root);
    if (bodyInfo?.count > 1) {
      const safe = Math.max(0, Math.min(Number(bodyIndex) || 0, (bodyInfo.count || 1) - 1));
      return bodyInfo.body_names?.[safe] || `Body ${safe + 1}`;
    }
    if (meshes.length > 1) {
      const idx = meshes.indexOf(mesh);
      return mesh.name?.trim() || `Object ${idx + 1}`;
    }
    return mesh.name?.trim() || root?.name?.trim() || "Component";
  }

  function faceCount(mesh) {
    const geom = mesh?.geometry;
    if (!geom?.attributes?.position) return 0;
    return geom.index ? Math.floor(geom.index.count / 3) : Math.floor(geom.attributes.position.count / 3);
  }

  function bodyFaceRange(bodyIndex) {
    const start = bodyInfo?.face_offsets?.[bodyIndex] ?? 0;
    const end = bodyInfo?.face_offsets?.[bodyIndex + 1] ?? null;
    return { start, end };
  }

  function bodyBounds(mesh, bodyIndex) {
    if (!mesh?.isMesh || !mesh.geometry || !bodyInfo?.face_offsets?.length) {
      return new THREE.Box3().setFromObject(mesh);
    }
    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    const index = geom.index;
    const count = faceCount(mesh);
    const { start, end } = bodyFaceRange(bodyIndex);
    const stop = Math.min(end ?? count, count);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let fi = Math.max(0, start); fi < stop; fi += 1) {
      for (let j = 0; j < 3; j += 1) {
        const vi = index ? index.getX(fi * 3 + j) : fi * 3 + j;
        v.fromBufferAttribute(pos, vi);
        mesh.localToWorld(v);
        box.expandByPoint(v);
      }
    }
    return box.isEmpty() ? new THREE.Box3().setFromObject(mesh) : box;
  }

  function clearPartTint() {
    for (const h of highlights) {
      const tinted = h.userData?.tintedMeshes;
      if (!Array.isArray(tinted)) continue;
      for (const entry of tinted) {
        const mat = entry.mesh?.material;
        if (!mat || !entry.backup) continue;
        const mats = Array.isArray(mat) ? mat : [mat];
        mats.forEach((m, i) => {
          const b = entry.backup[i];
          if (!m || !b) return;
          if (m.emissive && b.emissive) m.emissive.copy(b.emissive);
          if (b.emissiveIntensity != null) m.emissiveIntensity = b.emissiveIntensity;
          m.needsUpdate = true;
        });
      }
    }
  }

  function tintPartMesh(mesh, colorHex = 0x3d8bfd) {
    if (!mesh?.isMesh || !mesh.material) return null;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const backup = mats.map((m) => ({
      emissive: m.emissive?.clone?.() || null,
      emissiveIntensity: m.emissiveIntensity,
    }));
    for (const m of mats) {
      if (!m) continue;
      if (!m.emissive) m.emissive = new THREE.Color(0x000000);
      m.emissive.setHex(colorHex);
      m.emissiveIntensity = Math.max(Number(m.emissiveIntensity) || 0, 0.45);
      m.needsUpdate = true;
    }
    return { mesh, backup };
  }

  function addSelectionHighlight(item, { partLevel = false } = {}) {
    const color = partLevel ? 0xffb020 : 0x58a6ff;
    let h = null;
    if (partLevel && (item.bodyCount || 1) > 1 && Number.isInteger(item.bodyIndex)) {
      h = new THREE.Box3Helper(bodyBounds(item.mesh, item.bodyIndex), color);
    } else if (partLevel && item.mesh?.isMesh) {
      h = new THREE.BoxHelper(item.mesh, color);
    } else {
      h = new THREE.BoxHelper(item.root || item.mesh, color);
    }
    h.userData.isObjectHighlight = true;
    h.userData.partLevel = !!partLevel;
    if (h.material) {
      h.material.depthTest = false;
      h.material.transparent = true;
      h.material.opacity = 0.95;
      h.material.linewidth = 2;
    }
    h.renderOrder = 1002;
    // Keep authored CAD colors intact; the outline communicates part selection.
    h.userData.tintedMeshes = [];
    scene.add(h);
    highlights.push(h);
  }

  function selectObject({
    mesh,
    root,
    faceIndex = null,
    bodyIndex = null,
    catalogName = null,
    wholeModel = false,
    partLevel = false,
    isRoot: isRootOverride = null,
  } = {}) {
    if (!mesh || !root) return;
    clearMultiTransformGroup();
    const meshes = listSelectableMeshes(root);
    const resolvedCatalog = catalogName || root.userData?.catalogFilename || null;
    const hasMatchingBodyInfo =
      !resolvedCatalog || !bodyInfoFilename || String(bodyInfoFilename) === String(resolvedCatalog);
    const activeBodyCount = hasMatchingBodyInfo ? Math.max(1, Number(bodyInfo?.count) || 1) : 1;
    const selectWhole = wholeModel || (!partLevel && isRootOverride !== false);
    const candidateBody = Number.isInteger(bodyIndex) ? bodyIndex : bodyIndexForFace(faceIndex);
    const resolvedBody = selectWhole
      ? 0
      : activeBodyCount > 1
        ? Math.max(0, Math.min(candidateBody, activeBodyCount - 1))
        : Math.max(0, meshes.indexOf(mesh));
    const attachMesh = selectWhole ? root : (meshes[resolvedBody] || mesh);
    const isRoot =
      isRootOverride != null
        ? !!isRootOverride
        : selectWhole || (attachMesh === root && meshes.length <= 1 && !(partLevel && activeBodyCount > 1));
    const bodyNames = hasMatchingBodyInfo ? bodyInfo?.body_names : null;
    const wholeLabel = resolvedCatalog
      ? resolvedCatalog.replace(/\.[^.]+$/, "")
      : root?.name?.trim() || "Model";
    const partLabel =
      activeBodyCount > 1
        ? bodyNames?.[resolvedBody] || meshLabel(attachMesh, root, resolvedBody)
        : meshLabel(attachMesh, root, resolvedBody);
    selected = {
      mesh: attachMesh,
      root,
      bodyIndex: selectWhole ? 0 : resolvedBody,
      faceIndex: selectWhole ? null : faceIndex,
      label: selectWhole ? wholeLabel : partLabel,
      isRoot,
      partLevel: !selectWhole && !!partLevel,
      meshCount: meshes.length,
      bodyCount: activeBodyCount,
      catalogName: resolvedCatalog,
    };
    selected.selections = [
      {
        mesh: attachMesh,
        root,
        bodyIndex: selected.bodyIndex,
        bodyCount: activeBodyCount,
        catalogName: resolvedCatalog,
        label: selected.label,
        partLevel: selected.partLevel,
      },
    ];
    clearPartTint();
    removeHighlight();
    addSelectionHighlight(selected.selections[0], { partLevel: selected.partLevel });
    transformControls?.attach?.(attachMesh);
    setStatus(
      "ok",
      selected.partLevel
        ? `Selected part ${selected.label} · drag to move · click another part to switch · double-click for whole model · Cmd+Z to undo`
        : `Selected ${selected.label} · drag to move whole model · click a part to select it · Cmd+Z to undo`,
    );
    window.dispatchEvent(new CustomEvent("render3d:object-selection-changed", { detail: { selected } }));
  }

  function selectMany(items = []) {
    const normalized = items.filter((item) => item?.mesh && item?.root);
    if (!normalized.length) return false;
    const first = normalized[0];
    const resolvedCatalog = first.catalogName || first.root.userData?.catalogFilename || null;
    const label = normalized.length === 1
      ? (first.label || meshLabel(first.mesh, first.root, first.bodyIndex || 0))
      : `${normalized.length} bodies/objects`;
    selected = {
      mesh: first.mesh,
      root: first.root,
      bodyIndex: first.bodyIndex ?? 0,
      faceIndex: first.faceIndex ?? null,
      label,
      isRoot: normalized.every((item) => item.wholeModel || item.isRoot),
      meshCount: normalized.length,
      bodyCount: bodyInfo?.count || 1,
      catalogName: resolvedCatalog,
      selections: normalized.map((item) => ({
        ...item,
        bodyIndex: item.bodyIndex ?? 0,
        bodyCount: item.bodyCount ?? 1,
        catalogName: item.catalogName || item.root.userData?.catalogFilename || null,
        label: item.label || meshLabel(item.mesh, item.root, item.bodyIndex || 0),
        isRoot: item.isRoot ?? item.wholeModel ?? false,
        wholeModel: item.wholeModel ?? item.isRoot ?? false,
      })),
    };
    removeHighlight();
    selected.selections.forEach(addSelectionHighlight);
    const groupTarget = createMultiTransformGroup(selected.selections);
    if (groupTarget) transformControls?.attach?.(groupTarget);
    else transformControls?.detach?.();
    setStatus("ok", `Selected ${label} · drag the gizmo to move/rotate together · Delete / Backspace / X to delete`);
    window.dispatchEvent(new CustomEvent("render3d:object-selection-changed", { detail: { selected } }));
    return true;
  }

  function selectRoot(root) {
    if (!root) return;
    const meshes = listSelectableMeshes(root);
    selectObject({
      mesh: meshes[0] || root,
      root,
      bodyIndex: 0,
      wholeModel: true,
      catalogName: root.userData?.catalogFilename || null,
    });
  }

  async function refreshBodyInfo(filenameOverride = null) {
    const { projectId, filename: modelFilename } = getModelInfo?.() || {};
    const filename = filenameOverride || modelFilename;
    if (!projectId || !filename) {
      bodyInfo = null;
      bodyInfoFilename = null;
      return null;
    }
    try {
      bodyInfo = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/bodies`);
      bodyInfoFilename = filename;
    } catch {
      bodyInfo = null;
      bodyInfoFilename = null;
    }
    return bodyInfo;
  }

  async function onModelLoaded(root) {
    await refreshBodyInfo();
    clearSelection();
  }

  function pickFromEvent(event, ctx) {
    const root = getMeshRoot?.();
    if (!root) return false;
    const hit = pickObject(event, ctx);
    if (!hit?.mesh) {
      clearSelection();
      setStatus("", "");
      return true;
    }
    if (selected?.mesh === hit.mesh) {
      selectObject({ mesh: hit.mesh, root, faceIndex: hit.faceIndex });
      return true;
    }
    selectObject({ mesh: hit.mesh, root, faceIndex: hit.faceIndex });
    return true;
  }

  function getSelection() {
    return selected ? { ...selected } : null;
  }

  function getBodyInfo() {
    return bodyInfo ? { ...bodyInfo } : null;
  }

  async function splitBodies() {
    const { projectId, filename } = getModelInfo?.() || {};
    if (!projectId || !filename) {
      setStatus("error", "Load a model file first.");
      return;
    }
    if (bodyInfo && !bodyInfo.can_split) {
      setStatus("error", "This mesh has only one body — nothing to split.");
      return;
    }
    setStatus("loading", "Splitting bodies…");
    try {
      const data = await api(
        `/api/projects/${projectId}/files/${encodeURIComponent(filename)}/split-bodies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keep_original: true }),
        }
      );
      setStatus("ok", `Split into ${data.count} separate file${data.count === 1 ? "" : "s"}.`);
      clearSelection();
      onApplied?.(data);
    } catch (err) {
      setStatus("error", err.message || "Split failed.");
    }
  }

  async function deleteSelected() {
    const { projectId, filename: activeFilename } = getModelInfo?.() || {};
    if (!projectId || !activeFilename || !selected) {
      setStatus("error", "Select an object first (V).");
      return false;
    }

    const selections = selected.selections?.length ? selected.selections : [selected];
    const label = selected.label;
    const targetFile = selected.catalogName || activeFilename;
    if (bodyInfoFilename !== targetFile) {
      await refreshBodyInfo(targetFile);
    }
    const multiBody = (bodyInfo?.count || 1) > 1;

    const selectedBodyIndices = [...new Set(selections.map((s) => s.bodyIndex).filter((n) => Number.isInteger(n)))]
      .sort((a, b) => b - a);

    const removeBodySelection = selections.some((s) => s.partLevel) || selected.partLevel;
    if (removeBodySelection && multiBody && selectedBodyIndices.length > 0 && selectedBodyIndices.length < (bodyInfo?.count || 1)) {
      setStatus("loading", `Removing ${label}…`);
      try {
        let data = null;
        for (const bodyIndex of selectedBodyIndices) {
          data = await api(
            `/api/projects/${projectId}/files/${encodeURIComponent(targetFile)}/remove-body`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ body_index: bodyIndex }),
            }
          );
        }
        setStatus("ok", `Removed ${label}. Press Cmd/Ctrl+Z to undo.`);
        clearSelection();
        onApplied?.(data);
        return true;
      } catch (err) {
        setStatus("error", err.message || "Could not remove body.");
        return false;
      }
    }

    setStatus("loading", `Deleting ${label}…`);
    try {
      const fileTargets = [...new Set(selections.map((s) => s.catalogName).filter(Boolean))];
      const targets = fileTargets.length ? fileTargets : [targetFile];
      const deleted = [];
      let data = null;
      for (const file of targets) {
        data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(file)}`, { method: "DELETE" });
        deleted.push(file);
      }
      setStatus("ok", `Deleted ${label}. Press Cmd/Ctrl+Z to undo.`);
      clearSelection();
      return { ...data, deletedFile: deleted[0], deleted_files: deleted };
    } catch (err) {
      setStatus("error", err.message || "Delete failed.");
      return false;
    }
  }

  function updateHighlight() {
    highlights.forEach((h) => h.update?.());
  }

  return {
    pickFromEvent,
    selectRoot,
    selectObject,
    selectMany,
    clearSelection,
    getSelection,
    getBodyInfo,
    splitBodies,
    deleteSelected,
    refreshBodyInfo,
    onModelLoaded,
    updateHighlight,
  };
}
