/** Share-page Measure: FreeCAD kernel when STEP exists, else GLB mesh picks. */

import * as THREE from "three";
import { pickMeasureEntity, updateMeasureHover, setPickMode, getHoverGroup, clearHover, pickMeasureIdFromGroup } from "./picking.js?v=20260909-measkeep1-measui1-measux1-measux2-measchip1&editctx=20260915-1&editscale=20260915-1";
import {
  formatKernelSummary,
  glbEntityToRef,
  kernelEntityToRef,
  kernelPicksFromRefs,
  measureFromGlbRefs,
  measureFromKernelTopo,
  measureFromOccResult,
  snapPointToKernel,
  isCompleteMeasureRefs,
  createSavedMeasurement,
  measureWorldAnchor,
  measureOverlayAnchor,
} from "./kernel-measure.js?v=20260909-measkeep1-measui1-measux1-measux2";
import { createMeasureLabelOverlay, showMeasureHudToast } from "./measure-label-overlay.js?v=20260909-measkeep1-measui1-measux1-measux2";

function detectToMm(meshRoot) {
  if (!meshRoot) return 1;
  const box = new THREE.Box3().setFromObject(meshRoot);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  return maxDim <= 2.5 ? 1000 : 1;
}

function formatMm(mm, unit) {
  const value = Number(mm);
  if (!Number.isFinite(value)) return "—";
  if (unit === "in") return `${(value / 25.4).toFixed(3)} in`;
  if (unit === "ft") return `${(value / 304.8).toFixed(3)} ft`;
  return `${value.toFixed(2)} mm`;
}

function formatAreaMm2(mm2, unit) {
  const value = Number(mm2);
  if (!Number.isFinite(value)) return "—";
  if (unit === "in") return `${(value / 645.16).toFixed(3)} in²`;
  if (unit === "ft") return `${(value / 92903.04).toFixed(4)} ft²`;
  return `${value.toFixed(2)} mm²`;
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children[0];
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
    else child.material?.dispose?.();
    child.material?.map?.dispose?.();
    group.remove(child);
  }
}

function drawMeasured(overlay, measured, color = 0x58a6ff, refs = []) {
  clearGroup(overlay);
  const ends = measureOverlayAnchor(refs, measured);
  const p1 = ends.p1 || measured?.point1;
  const p2 = ends.p2 || measured?.point2;
  if (!p1) return;
  const a = new THREE.Vector3(...p1);
  if (p2) {
    const b = new THREE.Vector3(...p2);
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({
        color,
        dashSize: 0.008,
        gapSize: 0.004,
        depthTest: false,
      }),
    );
    line.computeLineDistances();
    line.renderOrder = 1002;
    overlay.add(line);
    overlay.userData.measureAnchor = [
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      (a.z + b.z) / 2,
    ];
    overlay.userData.measureP1 = [a.x, a.y, a.z];
    overlay.userData.measureP2 = [b.x, b.y, b.z];
  } else {
    overlay.userData.measureAnchor = [a.x, a.y, a.z];
  }
}

export function createShareMeasure({
  scene,
  camera,
  renderer,
  getRoot,
  shareToken,
  controls,
  setAutoRotate,
  onStatus,
  onActiveChange,
  getAuthor,
  onOpenAuthor,
}) {
  const liveOverlay = new THREE.Group();
  liveOverlay.name = "shareMeasureLive";
  const savedOverlay = new THREE.Group();
  savedOverlay.name = "shareMeasureSaved";
  scene.add(liveOverlay);
  scene.add(savedOverlay);
  scene.add(getHoverGroup());

  const readout = document.getElementById("share-measure-readout");
  const btn = document.getElementById("btn-share-measure");
  let active = false;
  let pickMode = "edge";
  let unit = "mm";
  let refs = [];
  let saved = [];
  let topo = null;
  let topoTried = false;
  let kernelOk = false;
  let refSeq = 0;
  let pointerStart = null;
  let occGen = 0;

  function modelToWorld(anchor) {
    const root = getRoot?.();
    if (!root || !Array.isArray(anchor) || anchor.length < 3) return null;
    const v = new THREE.Vector3(Number(anchor[0]), Number(anchor[1]), Number(anchor[2]));
    if (![v.x, v.y, v.z].every(Number.isFinite)) return null;
    root.updateMatrixWorld?.(true);
    root.localToWorld(v);
    return [v.x, v.y, v.z];
  }

  const labels = createMeasureLabelOverlay({
    host: document.getElementById("share-viewer") || document.body,
    camera,
    renderer,
    toWorld: modelToWorld,
    onDelete: (id) => {
      saved = saved.filter((item) => item.id !== id);
      redrawSaved();
    },
    onRename: (id) => {
      const item = saved.find((it) => it.id === id);
      if (!item) return;
      const next = window.prompt("Rename measurement", item.label || item.value || "");
      if (next == null) return;
      item.label = String(next).trim();
      redrawSaved();
    },
    onPin: (id, pinned) => {
      const item = saved.find((it) => it.id === id);
      if (item) item.pinned = Boolean(pinned);
    },
    onMove: (id, offset) => {
      const item = saved.find((it) => it.id === id);
      if (item) item.labelOffset = { x: Number(offset?.x) || 0, y: Number(offset?.y) || 0 };
    },
    pickId: (e) => pickMeasureIdFromGroup(savedOverlay, e, {
      camera,
      domElement: renderer.domElement,
      meshRoot: getRoot?.(),
    }),
    onOpenAuthor: (author, el) => onOpenAuthor?.(author, el),
  });

  function toast(message) {
    showMeasureHudToast(readout, message);
  }

  function hideShareBanner() {
    onStatus?.("");
  }

  function fmtOpts() {
    return {
      formatLength: (mm) => formatMm(mm, unit),
      formatArea: (mm2) => formatAreaMm2(mm2, unit),
    };
  }

  function measuredFromRefs(nextRefs) {
    const kernel = measureFromKernelTopo(nextRefs, topo);
    if (kernel) return kernel;
    const glb = measureFromGlbRefs(nextRefs);
    if (!glb) return null;
    const root = getRoot?.();
    const toMm = detectToMm(root);
    if (glb.kind === "area") return { ...glb, valueMm: glb.valueMm * toMm * toMm };
    return { ...glb, valueMm: Number.isFinite(glb.valueMm) ? glb.valueMm * toMm : glb.valueMm };
  }

  function syncButtons() {
    btn?.classList.toggle("active", active);
    btn?.setAttribute("aria-pressed", String(active));
    readout?.classList.toggle("hidden", !active);
    readout?.querySelectorAll("[data-share-measure-pick]").forEach((el) => {
      const on = el.dataset.shareMeasurePick === pickMode;
      el.classList.toggle("active", on);
      el.setAttribute("aria-pressed", String(on));
    });
    readout?.querySelectorAll("[data-share-measure-unit]").forEach((el) => {
      const on = el.dataset.shareMeasureUnit === unit;
      el.classList.toggle("active", on);
    });
  }

  function attachOverlays() {
    const root = getRoot?.();
    if (!root) return;
    if (liveOverlay.parent !== root) root.add(liveOverlay);
    if (savedOverlay.parent !== root) root.add(savedOverlay);
  }

  function redrawSaved() {
    attachOverlays();
    clearGroup(savedOverlay);
    for (const item of saved) {
      const group = new THREE.Group();
      group.userData.measureId = item.id;
      savedOverlay.add(group);
      drawMeasured(group, measuredFromRefs(item.refs) || { point1: item.anchor }, 0x3fb950, item.refs);
    }
    labels.setItems(saved.map((item) => {
      const measured = measuredFromRefs(item.refs);
      const summary = formatKernelSummary(measured, fmtOpts());
      const overlay = measureOverlayAnchor(item.refs, measured);
      return {
        id: item.id,
        label: item.label || "",
        value: item.value || summary.value,
        author: item.author,
        pinned: Boolean(item.pinned),
        labelOffset: item.labelOffset || { x: 0, y: 0 },
        worldSpace: true,
        anchor: modelToWorld(overlay.anchor) || overlay.anchor || item.anchor || measureWorldAnchor(item.refs, measured),
        p1: modelToWorld(overlay.p1) || overlay.p1,
        p2: modelToWorld(overlay.p2) || overlay.p2,
      };
    }));
  }

  function updateReadout(measured = measuredFromRefs(refs)) {
    const valueEl = readout?.querySelector("[data-share-measure-value]");
    const metaEl = readout?.querySelector("[data-share-measure-meta]");
    const summary = formatKernelSummary(measured, {
      ...fmtOpts(),
      fallback: {
        value: "—",
        meta: kernelOk
          ? `FreeCAD · click a ${pickMode}`
          : `Preview mesh · click a ${pickMode}`,
      },
    });
    if (valueEl) valueEl.textContent = summary.value;
    if (metaEl) {
      const source = measured?.source === "occ" || measured?.source === "freecad-topo"
        ? "FreeCAD kernel"
        : measured?.source === "glb"
          ? "GLB preview"
          : (kernelOk ? "FreeCAD kernel" : "GLB preview");
      metaEl.textContent = `${summary.meta} · ${source}`;
    }
    attachOverlays();
    drawMeasured(liveOverlay, measured, 0x58a6ff, refs);
    redrawSaved();
  }

  async function loadTopo() {
    if (topoTried || !shareToken) return;
    topoTried = true;
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(shareToken)}/kernel-topology`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.kernel === "freecad" && (data.faces?.length || data.edges?.length)) {
        topo = data;
        kernelOk = true;
      }
    } catch (_) {
      topo = null;
      kernelOk = false;
    }
  }

  async function refineOcc(nextRefs) {
    if (!kernelOk || !shareToken) return;
    const picks = kernelPicksFromRefs(nextRefs);
    if (!picks.length) return;
    const gen = ++occGen;
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(shareToken)}/kernel-measure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: picks[0], b: picks[1] || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (gen !== occGen || !res.ok) return;
      const measured = measureFromOccResult(data);
      if (measured) {
        const live = nextRefs === refs || (Array.isArray(nextRefs) && nextRefs.length && nextRefs[0] === refs[0]);
        if (refs.length && live) updateReadout(measured);
        const item = saved[saved.length - 1];
        if (item && (!refs.length || !live)) {
          const summary = formatKernelSummary(measured, fmtOpts());
          item.value = summary.value;
          item.anchor = measureWorldAnchor(item.refs, measured);
          redrawSaved();
        }
      }
    } catch (_) {
      /* keep topo/GLB readout */
    }
  }

  function commitLive({ allowSingle = false } = {}) {
    if (!refs.length) return false;
    if (!isCompleteMeasureRefs(refs, pickMode) && !(allowSingle && refs.length === 1)) return false;
    const measured = measuredFromRefs(refs);
    const summary = formatKernelSummary(measured, fmtOpts());
    saved.push(createSavedMeasurement({
      refs,
      label: "",
      value: summary.value,
      author: getAuthor?.() || null,
      measured,
    }));
    refs = [];
    occGen += 1;
    updateReadout(null);
    hideShareBanner();
    toast("Saved. Click to add another.");
    return true;
  }

  function cancelInProgress() {
    refs = [];
    occGen += 1;
    updateReadout(null);
    toast("Canceled current pick. Existing dimensions kept.");
  }

  function pickRef(event) {
    const root = getRoot?.();
    if (!root) return null;
    const entity = pickMeasureEntity(event, {
      camera,
      domElement: renderer.domElement,
      meshRoot: root,
      meshCenterOffset: new THREE.Vector3(),
      prefer: pickMode,
    });
    if (!entity) return null;
    if (pickMode === "face" && entity.type !== "face") return null;
    if (pickMode === "edge" && entity.type !== "edge") return null;
    if (pickMode === "corner" && entity.type !== "vertex") return null;
    if (kernelOk && topo) {
      root.updateMatrixWorld?.(true);
      const local = root.worldToLocal(entity.position.clone());
      const snap = snapPointToKernel(topo, local, entity.normal, pickMode);
      if (snap) {
        refSeq += 1;
        return kernelEntityToRef(snap, `${snap.kind}-${refSeq}`);
      }
    }
    refSeq += 1;
    return glbEntityToRef(entity, `${entity.type}-${refSeq}`);
  }

  function onPointerMove(event) {
    if (!active || event.buttons) return;
    const root = getRoot?.();
    if (!root) return;
    setPickMode(pickMode === "corner" ? "corner" : pickMode);
    updateMeasureHover(event, {
      camera,
      domElement: renderer.domElement,
      meshRoot: root,
      meshCenterOffset: new THREE.Vector3(),
      prefer: pickMode,
    });
  }

  function onPointerDown(event) {
    if (!active || event.target !== renderer.domElement) return;
    if (event.button != null && event.button !== 0) return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now() };
  }

  function onPointerUp(event) {
    if (!active || event.target !== renderer.domElement) return;
    const start = pointerStart;
    pointerStart = null;
    if (!start || start.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > 10 || performance.now() - start.t > 1200) return;
    const ref = pickRef(event);
    if (!ref) return;
    refs.push(ref);
    if (isCompleteMeasureRefs(refs, pickMode)) {
      const committed = refs.slice();
      commitLive();
      void refineOcc(committed);
    } else {
      updateReadout();
      void refineOcc(refs);
    }
    event.preventDefault();
  }

  function onKeyDown(event) {
    if (event.key !== "Escape" || !active) return;
    if (event.target?.closest?.("input, textarea, [contenteditable]")) return;
    event.preventDefault();
    cancelInProgress();
  }

  function setActive(next) {
    active = Boolean(next);
    if (active) {
      hideShareBanner();
      setAutoRotate?.(false);
      renderer.domElement.style.cursor = "crosshair";
      setPickMode(pickMode === "corner" ? "corner" : pickMode);
      void loadTopo().then(() => updateReadout());
    } else {
      renderer.domElement.style.cursor = "";
      refs = [];
      occGen += 1;
      clearGroup(liveOverlay);
      setPickMode("off");
      clearHover();
    }
    syncButtons();
    updateReadout();
    onActiveChange?.(active);
  }

  readout?.querySelectorAll("[data-share-measure-pick]").forEach((el) => {
    el.addEventListener("click", () => {
      const next = el.dataset.shareMeasurePick || "edge";
      if (next !== pickMode) {
        refs = [];
        occGen += 1;
      }
      pickMode = next;
      setPickMode(pickMode === "corner" ? "corner" : pickMode);
      clearHover();
      syncButtons();
      updateReadout();
    });
  });
  readout?.querySelectorAll("[data-share-measure-unit]").forEach((el) => {
    el.addEventListener("click", () => {
      unit = el.dataset.shareMeasureUnit || "mm";
      syncButtons();
      updateReadout();
    });
  });
  readout?.querySelector("[data-share-measure-clear]")?.addEventListener("click", () => {
    refs = [];
    occGen += 1;
    updateReadout();
  });
  readout?.querySelector("[data-share-measure-done]")?.addEventListener("click", () => {
    commitLive({ allowSingle: true });
    setActive(false);
  });

  btn?.addEventListener("click", () => {
    setActive(!active);
  });

  renderer.domElement.addEventListener("pointerdown", onPointerDown, true);
  renderer.domElement.addEventListener("pointerup", onPointerUp, true);
  renderer.domElement.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("keydown", onKeyDown);

  return {
    isActive: () => active,
    setActive,
    deactivate() {
      setActive(false);
    },
    cancelInProgress,
    updateLabels: () => labels.update(),
  };
}
