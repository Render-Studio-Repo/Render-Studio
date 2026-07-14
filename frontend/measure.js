import * as THREE from "three";
import { pickMeasureEntity, updateMeasureHover } from "./picking.js";
import { formatLength, formatArea, getUnits, onUnitsChanged, UNIT_OPTIONS } from "./units.js?v=20260714-units-ft-m";

export function detectModelUnitScale(meshRoot) {
  if (!meshRoot) return { toMm: 1 };
  const box = new THREE.Box3().setFromObject(meshRoot);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  return maxDim <= 2.5 ? { toMm: 1000 } : { toMm: 1 };
}

function nativeToMm(value, unitScale) {
  return value * (unitScale?.toMm ?? 1);
}

export function formatMeasureLength(mm) {
  return formatLength(mm);
}

function formatAngle(deg) {
  return `${deg.toFixed(2)}°`;
}

function makeTextSprite(text, color = "#e6edf3", bg = "rgba(13, 17, 23, 0.9)") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 42px system-ui, -apple-system, Segoe UI, sans-serif";
    const w = Math.min(480, ctx.measureText(text).width + 48);
    ctx.fillStyle = bg;
    const x = (512 - w) / 2;
    const y = 24;
    const h = 80;
    const r = 16;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(88, 166, 255, 0.95)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 1005;
  return sprite;
}

function modelToWorld(meshRoot, modelPos) {
  const v = modelPos.clone();
  meshRoot.localToWorld(v);
  return v;
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children[0];
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
    else child.material?.dispose();
    group.remove(child);
  }
}

function parallelFaceDistance(a, b, unitScale) {
  const n1 = a.face?.normal;
  const n2 = b.face?.normal;
  if (!n1 || !n2) return null;
  const dot = Math.abs(n1.clone().normalize().dot(n2.clone().normalize()));
  if (dot < 0.985) return null;
  const sign = n1.dot(n2) >= 0 ? 1 : -1;
  const delta = b.face.centroid.clone().sub(a.face.centroid);
  return Math.abs(delta.dot(n1.clone().normalize().multiplyScalar(sign)));
}

function edgeAngleDeg(a, b) {
  const d1 = a.edge?.direction?.clone().normalize();
  const d2 = b.edge?.direction?.clone().normalize();
  if (!d1 || !d2) return null;
  const dot = Math.max(-1, Math.min(1, Math.abs(d1.dot(d2))));
  return (Math.acos(dot) * 180) / Math.PI;
}

function pointToEdgeDistance(point, edge, unitScale) {
  if (!edge?.start || !edge?.end) return null;
  const line = new THREE.Line3(edge.start, edge.end);
  const closest = new THREE.Vector3();
  line.closestPointToPoint(point, true, closest);
  return point.distanceTo(closest);
}

function computeMeasurement(a, b, unitScale) {
  const rows = [];
  if (!b) {
    if (a.type === "edge" && a.edge) {
      const len = nativeToMm(a.edge.length, unitScale);
      rows.push({ label: "Edge length", value: len, kind: "length" });
    } else if (a.type === "face" && a.face) {
      const linear = unitScale.toMm;
      const area = a.face.area * linear * linear;
      rows.push({ label: "Face area", value: area, kind: "area" });
      const n = a.face.normal;
      rows.push({
        label: "Normal",
        value: `(${n.x.toFixed(3)}, ${n.y.toFixed(3)}, ${n.z.toFixed(3)})`,
        kind: "text",
      });
    } else if (a.type === "vertex" && a.vertex) {
      const p = a.vertex;
      rows.push({
        label: "Position",
        value: `X ${nativeToMm(p.x, unitScale).toFixed(3)}, Y ${nativeToMm(p.y, unitScale).toFixed(3)}, Z ${nativeToMm(p.z, unitScale).toFixed(3)}`,
        kind: "text",
      });
    }
    return { title: `${capitalize(a.type)}`, rows };
  }

  if (a.type === "face" && b.type === "face") {
    const dist = parallelFaceDistance(a, b, unitScale);
    if (dist != null) {
      rows.push({ label: "Face distance", value: nativeToMm(dist, unitScale), kind: "length" });
    } else {
      rows.push({ label: "Faces not parallel", value: "Pick parallel faces or use points/edges", kind: "text" });
    }
  }

  if (a.type === "edge" && b.type === "edge") {
    const ang = edgeAngleDeg(a, b);
    if (ang != null) {
      rows.push({ label: "Angle", value: ang, kind: "angle" });
      rows.push({ label: "Supplement", value: 180 - ang, kind: "angle" });
    }
  }

  const p1 = a.position;
  const p2 = b.position;
  const dist = p1.distanceTo(p2);
  const mm = nativeToMm(dist, unitScale);
  rows.unshift({ label: "Distance", value: mm, kind: "length" });
  const dx = nativeToMm(Math.abs(p2.x - p1.x), unitScale);
  const dy = nativeToMm(Math.abs(p2.y - p1.y), unitScale);
  const dz = nativeToMm(Math.abs(p2.z - p1.z), unitScale);
  rows.push({ label: "ΔX", value: dx, kind: "length" });
  rows.push({ label: "ΔY", value: dy, kind: "length" });
  rows.push({ label: "ΔZ", value: dz, kind: "length" });

  if (a.type === "edge" && b.type === "vertex") {
    const d = pointToEdgeDistance(b.position, a.edge, unitScale);
    if (d != null) rows.push({ label: "Point to edge", value: nativeToMm(d, unitScale), kind: "length" });
  }
  if (b.type === "edge" && a.type === "vertex") {
    const d = pointToEdgeDistance(a.position, b.edge, unitScale);
    if (d != null) rows.push({ label: "Point to edge", value: nativeToMm(d, unitScale), kind: "length" });
  }

  return { title: `${capitalize(a.type)} → ${capitalize(b.type)}`, rows };
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function renderRows(rows) {
  return rows
    .map((row) => {
      let text = row.value;
      if (row.kind === "length") text = formatMeasureLength(row.value);
      else if (row.kind === "area") text = formatArea(row.value);
      else if (row.kind === "angle") text = formatAngle(row.value);
      return `<div class="measure-row"><span class="measure-k">${row.label}</span><span class="measure-v">${text}</span></div>`;
    })
    .join("");
}

export function createMeasureTool({
  scene,
  getMeshRoot,
  getMeshCenterOffset,
  getUnitScale,
  camera,
  domElement,
}) {
  const overlayGroup = new THREE.Group();
  overlayGroup.name = "measure-overlays";
  scene.add(overlayGroup);

  let active = false;
  let selections = [];
  let panelEl = null;
  let resultsEl = null;
  let unitsEl = null;

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement("section");
    panelEl.id = "measure-panel";
    panelEl.className = "measure-panel hidden";
    panelEl.innerHTML = `
      <div class="measure-panel-head">
        <h2>Measure</h2>
        <select id="measure-units" class="measure-units unit-select" data-unit-select aria-label="Display units">
          ${UNIT_OPTIONS.map((u) => `<option value="${u.id}">${u.label}</option>`).join("")}
        </select>
      </div>
      <p class="muted small measure-hint">Click vertices, edges, or faces. Two picks show distance, angle, or face separation — like Fusion 360.</p>
      <div id="measure-results" class="measure-results"></div>
      <div class="measure-actions">
        <button type="button" id="btn-measure-clear" class="btn secondary btn-compact">Clear</button>
      </div>`;
    const right = document.querySelector(".sidebar.right");
    const editPanel = document.getElementById("edit-panel");
    if (right && editPanel) right.insertBefore(panelEl, editPanel);
    else document.body.appendChild(panelEl);

    resultsEl = panelEl.querySelector("#measure-results");
    unitsEl = panelEl.querySelector("#measure-units");
    unitsEl.value = getUnits();
    unitsEl.addEventListener("change", () => {
      // Document units are owned by units.js; initUnitSwitcher also syncs these selects.
      refreshPanel();
      redrawOverlay();
    });
    onUnitsChanged(() => {
      if (unitsEl) unitsEl.value = getUnits();
      refreshPanel();
      redrawOverlay();
    });
    panelEl.querySelector("#btn-measure-clear")?.addEventListener("click", () => clear());
    return panelEl;
  }

  function refreshPanel() {
    ensurePanel();
    if (!resultsEl) return;
    if (!selections.length) {
      resultsEl.innerHTML = `<p class="muted small">Click the model to measure.</p>`;
      return;
    }
    const unitScale = getUnitScale?.() || { toMm: 1 };
    const blocks = [];
    selections.forEach((sel, idx) => {
      const m = computeMeasurement(sel, null, unitScale);
      blocks.push(`<div class="measure-block"><h3>Selection ${idx + 1} · ${m.title}</h3>${renderRows(m.rows)}</div>`);
    });
    if (selections.length >= 2) {
      const pair = computeMeasurement(selections[0], selections[1], unitScale);
      blocks.push(`<div class="measure-block measure-block-primary"><h3>${pair.title}</h3>${renderRows(pair.rows)}</div>`);
    }
    resultsEl.innerHTML = blocks.join("");
  }

  function redrawOverlay() {
    clearGroup(overlayGroup);
    const meshRoot = getMeshRoot?.();
    if (!meshRoot || !selections.length) return;
    const unitScale = getUnitScale?.() || { toMm: 1 };
    const scale = Math.max(new THREE.Box3().setFromObject(meshRoot).getSize(new THREE.Vector3()).length() * 0.012, 0.003);

    selections.forEach((sel, idx) => {
      const color = idx === 0 ? 0x58a6ff : 0xffa657;
      const world = modelToWorld(meshRoot, sel.position);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(scale * 0.55, 12, 12),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      dot.renderOrder = 1003;
      dot.position.copy(world);
      overlayGroup.add(dot);

      if (sel.type === "edge" && sel.edge) {
        const pts = [modelToWorld(meshRoot, sel.edge.start), modelToWorld(meshRoot, sel.edge.end)];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({ color: 0xffa657, depthTest: false }),
        );
        line.renderOrder = 1003;
        overlayGroup.add(line);
      }
    });

    if (selections.length >= 2) {
      const a = selections[0].position;
      const b = selections[1].position;
      const w1 = modelToWorld(meshRoot, a);
      const w2 = modelToWorld(meshRoot, b);
      const pts = [w1, w2];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(
        geo,
        new THREE.LineDashedMaterial({ color: 0x79c0ff, depthTest: false, dashSize: scale * 0.8, gapSize: scale * 0.4 }),
      );
      line.computeLineDistances();
      line.renderOrder = 1004;
      overlayGroup.add(line);

      const mid = w1.clone().add(w2).multiplyScalar(0.5);
      const mm = nativeToMm(a.distanceTo(b), unitScale);
      const sprite = makeTextSprite(formatMeasureLength(mm));
      sprite.scale.set(scale * 14, scale * 3.5, 1);
      sprite.position.copy(mid);
      overlayGroup.add(sprite);
    } else if (selections.length === 1 && selections[0].type === "edge" && selections[0].edge) {
      const len = nativeToMm(selections[0].edge.length, unitScale);
      const mid = modelToWorld(meshRoot, selections[0].edge.start.clone().add(selections[0].edge.end).multiplyScalar(0.5));
      const sprite = makeTextSprite(formatMeasureLength(len));
      sprite.scale.set(scale * 14, scale * 3.5, 1);
      sprite.position.copy(mid);
      overlayGroup.add(sprite);
    }
  }

  function clear() {
    selections = [];
    clearGroup(overlayGroup);
    refreshPanel();
  }

  function setActive(on) {
    active = on;
    ensurePanel();
    panelEl.classList.toggle("hidden", !on);
    if (!on) clear();
  }

  function isActive() {
    return active;
  }

  function onPointerMove(event) {
    if (!active) return;
    updateMeasureHover(event, {
      camera,
      domElement,
      meshRoot: getMeshRoot?.(),
      meshCenterOffset: getMeshCenterOffset?.(),
    });
  }

  function onClick(event) {
    if (!active || !getMeshRoot?.()) return;
    const entity = pickMeasureEntity(event, {
      camera,
      domElement,
      meshRoot: getMeshRoot(),
      meshCenterOffset: getMeshCenterOffset?.(),
    });
    if (!entity) return;
    selections.push(entity);
    if (selections.length > 2) selections = selections.slice(-2);
    refreshPanel();
    redrawOverlay();
  }

  return {
    setActive,
    isActive,
    clear,
    onPointerMove,
    onClick,
    getUnits,
    setUnits: () => {
      refreshPanel();
      redrawOverlay();
    },
  };
}
