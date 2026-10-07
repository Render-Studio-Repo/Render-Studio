import { brushStyle, styleStrokeMaterial, strokeCrossSection } from "./xr-tool-appearance.js?v=20260915-toolcontext1";
/** 3D voice-draw sketches for AI prompts — air strokes + model point-ats. */

import {
  downsampleStrokePoints,
  liveInkInstanceFromSegment,
  liveInkPoolCapacity,
  nextStrokeEvictIndex,
  shouldRebuildTubeWhileDrawing,
  XR_COMMIT_STROKE_MAX_POINTS,
  XR_LIVE_STROKE_MAX_POINTS,
  XR_NETWORK_STROKE_MAX_POINTS,
} from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5";

const MAX_POINTS = XR_LIVE_STROKE_MAX_POINTS;
const MIN_STEP = 0.008;
const TUBE_RADIUS = 0.009;
const MAX_CLIPS = 4;

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function hexColor(n, fallback = "#67e8f9") {
  if (n == null || !Number.isFinite(Number(n))) return fallback;
  return `#${(Number(n) >>> 0).toString(16).padStart(6, "0")}`;
}

export function createXrVoiceDraw({ THREE, scene } = {}) {
  const group = new THREE.Group();
  group.name = "xrVoiceDraw";
  group.visible = true;
  group.frustumCulled = false;
  group.renderOrder = 2570;
  try { scene?.add(group); } catch { /* ignore */ }

  /** @type {{ points: THREE.Vector3[], onModel: boolean, part: string, line: THREE.Line, tube: THREE.Mesh|null }[]} */
  const strokes = [];
  /** @type {{ point: THREE.Vector3, part: string, mesh: THREE.Mesh }[]} */
  const anchors = [];
  /** @type {{ id: string, imageDataUrl: string, promptAugment: string, strokeCount: number, pointedOnModel: boolean, strokes: any[], anchors: any[] }[]} */
  const clips = [];
  let live = null;
  let lineMat = null;
  let tubeMat = null;
  let anchorMat = null;
  let tipMat = null;
  let clipSeq = 0;
  let strokeSeq = 0;
  let strokeColor = 0x22d3ee;
  let strokeRadius = TUBE_RADIUS;
  let strokeBrush = "pen";
  let eraserOn = false;
  let inkMesh = null;
  const _inkMat = new THREE.Matrix4();
  const _inkPos = new THREE.Vector3();
  const _inkScl = new THREE.Vector3();
  const _inkQuat = new THREE.Quaternion();

  function nextDrawId() {
    strokeSeq += 1;
    return `stroke-${strokeSeq}-${Date.now().toString(36)}`;
  }

  function tagDrawable(mesh, rec = {}) {
    if (!mesh) return;
    mesh.userData.xrDrawable = true;
    mesh.userData.xrDrawId = rec.drawId || mesh.userData.xrDrawId || "";
    mesh.userData.xrAuthorId = rec.authorId || mesh.userData.xrAuthorId || "";
    mesh.userData.xrAuthorName = rec.authorName || mesh.userData.xrAuthorName || "";
    const at = Number(rec.createdAt || rec.created_at || rec.authorAt || Date.now()) || Date.now();
    mesh.userData.xrAuthorAt = at;
    mesh.userData.createdAt = at;
    mesh.userData.createdBy = mesh.userData.xrAuthorId;
    mesh.userData.xrAuthor = {
      id: mesh.userData.xrAuthorId,
      name: mesh.userData.xrAuthorName,
      at,
    };
  }

  function materials() {
    if (!lineMat) {
      lineMat = new THREE.LineBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: true,
      });
    }
    if (!tubeMat) {
      tubeMat = new THREE.MeshBasicMaterial({
        color: 0x67e8f9,
        transparent: false,
        opacity: 1,
        depthTest: true,
        depthWrite: true,
        toneMapped: false,
      });
    }
    if (!anchorMat) {
      anchorMat = new THREE.MeshBasicMaterial({
        color: 0xf472b6,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: true,
      });
    }
    if (!tipMat) {
      tipMat = new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: true,
      });
    }
  }

  function disposeObj(obj) {
    if (!obj) return;
    try { group.remove(obj); } catch { /* ignore */ }
    try { obj.geometry?.dispose?.(); } catch { /* ignore */ }
  }

  function setColor(color) {
    const n = typeof color === "number" ? color : parseInt(String(color).replace("#", ""), 16);
    if (Number.isFinite(n)) strokeColor = n;
    materials();
    try {
      lineMat.color.setHex(strokeColor);
      tubeMat.color.setHex(strokeColor);
    } catch { /* ignore */ }
    if (live?.line?.material?.color) live.line.material.color.setHex(strokeColor);
    if (live?.tube?.material?.color) live.tube.material.color.setHex(strokeColor);
    if (live?.tip?.material?.color) live.tip.material.color.setHex(strokeColor);
    if (inkMesh?.material?.color) inkMesh.material.color.setHex(strokeColor);
  }

  function setBrush(kind) {
    strokeBrush = brushStyle(kind).kind;
    return strokeBrush;
  }

  function setRadius(r) {
    const n = Number(r);
    if (!Number.isFinite(n) || n <= 0) return strokeRadius;
    strokeRadius = Math.min(0.04, Math.max(0.003, n));
    return strokeRadius;
  }

  function setEraser(on) {
    eraserOn = !!on;
    return eraserOn;
  }

  function eraseNear(point, radius = 0.045) {
    if (!point) return false;
    const r = Math.max(radius, strokeRadius * 3);
    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      const rec = strokes[i];
      const hit = (rec.points || []).some((p) => p.distanceTo(point) <= r);
      if (!hit) continue;
      disposeObj(rec.line);
      disposeObj(rec.tube);
      strokes.splice(i, 1);
      return true;
    }
    return false;
  }

  function makeLiveLine() {
    materials();
    const mat = lineMat.clone();
    mat.color.setHex(strokeColor);
    const positions = new Float32Array(MAX_POINTS * 3);
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(positions, 3);
    try { attr.setUsage?.(THREE.DynamicDrawUsage); } catch { /* older three */ }
    geo.setAttribute("position", attr);
    geo.setDrawRange(0, 1);
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 2575;
    line.visible = false;
    group.add(line);
    return line;
  }

  function resetInkPool() {
    if (!inkMesh) return;
    inkMesh.count = 0;
    inkMesh.instanceMatrix.needsUpdate = true;
  }

  function ensureInkPool(color = strokeColor) {
    materials();
    if (!inkMesh) {
      const cap = liveInkPoolCapacity(MAX_POINTS);
      const geo = new THREE.CylinderGeometry(1, 1, 1, 6);
      const mat = tubeMat.clone();
      mat.color.setHex(color);
      inkMesh = new THREE.InstancedMesh(geo, mat, cap);
      inkMesh.count = 0;
      inkMesh.frustumCulled = false;
      inkMesh.renderOrder = 2577;
      inkMesh.userData.xrLiveInk = true;
      try { inkMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage); } catch { /* older three */ }
      group.add(inkMesh);
    } else if (inkMesh.material?.color) {
      inkMesh.material.color.setHex(color);
    }
    styleStrokeMaterial(inkMesh.material, strokeBrush);
    return inkMesh;
  }

  function writeInkInstance(index, a, b, radius, brush = "pen") {
    const pose = liveInkInstanceFromSegment(a.x, a.y, a.z, b.x, b.y, b.z, radius);
    if (!pose || !inkMesh) return false;
    _inkPos.set(pose.px, pose.py, pose.pz);
    const section = strokeCrossSection(brush, index, index + 6);
    _inkScl.set(pose.sx * section.width, pose.sy, pose.sz * section.depth);
    _inkQuat.set(pose.qx, pose.qy, pose.qz, pose.qw);
    _inkMat.compose(_inkPos, _inkQuat, _inkScl);
    inkMesh.setMatrixAt(index, _inkMat);
    inkMesh.count = index + 1;
    inkMesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  function makeGrabHull(points, rec = {}) {
    if (!points || points.length < 2) return null;
    const box = new THREE.Box3().setFromPoints(points);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(0.028, size.x + 0.018),
        Math.max(0.028, size.y + 0.018),
        Math.max(0.028, size.z + 0.018),
      ),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: false,
        depthWrite: false,
        colorWrite: false,
        toneMapped: false,
      }),
    );
    mesh.position.copy(center);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2574;
    tagDrawable(mesh, rec);
    mesh.userData.xrGrabHull = true;
    group.add(mesh);
    return mesh;
  }

  function writeLivePoint(line, index, point) {
    if (!line || !point) return;
    const attr = line.geometry?.getAttribute?.("position");
    if (!attr) return;
    attr.setXYZ(index, point.x, point.y, point.z);
    attr.needsUpdate = true;
    line.geometry.setDrawRange(0, index + 1);
    if (index % 4 === 0) line.geometry.computeBoundingSphere();
  }

  function makeTube(points, color = strokeColor, radius = strokeRadius, brush = "pen") {
    if (!points || points.length < 2) return null;
    materials();
    try {
      const slim = downsampleStrokePoints(points, XR_COMMIT_STROKE_MAX_POINTS).map((p) => (
        p?.isVector3 ? p : new THREE.Vector3(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2])
      ));
      if (slim.length < 2) return null;
      const n = slim.length - 1;
      const geo = new THREE.CylinderGeometry(1, 1, 1, 6);
      const mat = tubeMat.clone();
      mat.color.setHex(color);
      styleStrokeMaterial(mat, brush);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2576;
      mesh.userData.xrStrokeTube = true;
      mesh.raycast = () => {};
      let count = 0;
      for (let i = 0; i < n; i += 1) {
        const a = slim[i];
        const b = slim[i + 1];
        const pose = liveInkInstanceFromSegment(a.x, a.y, a.z, b.x, b.y, b.z, radius);
        if (!pose) continue;
        _inkPos.set(pose.px, pose.py, pose.pz);
        const section = strokeCrossSection(brush, i, n);
        _inkScl.set(pose.sx * section.width, pose.sy, pose.sz * section.depth);
        _inkQuat.set(pose.qx, pose.qy, pose.qz, pose.qw);
        _inkMat.compose(_inkPos, _inkQuat, _inkScl);
        mesh.setMatrixAt(count, _inkMat);
        count += 1;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (count < 1) {
        try { mesh.geometry?.dispose?.(); } catch { /* ignore */ }
        try { mesh.material?.dispose?.(); } catch { /* ignore */ }
        return null;
      }
      tagDrawable(mesh);
      group.add(mesh);
      return mesh;
    } catch {
      return null;
    }
  }

  function refreshLiveTube() {
    if (shouldRebuildTubeWhileDrawing()) {
      if (!live || live.points.length < 2) return;
      disposeObj(live.tube);
      live.tube = makeTube(live.points, live.color, live.radius, live.brush);
      if (live.tube && live.line) live.line.visible = false;
    }
  }

  function ensureTip(point) {
    if (!live || !point) return;
    materials();
    if (!live.tip) {
      live.tip = new THREE.Mesh(new THREE.SphereGeometry(strokeRadius * 1.8, 12, 10), tipMat.clone());
      live.tip.frustumCulled = false;
      live.tip.renderOrder = 2579;
      group.add(live.tip);
    }
    live.tip.position.copy(point);
    live.tip.visible = true;
  }

  function addAnchor(point, part = "") {
    if (!point) return;
    materials();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), anchorMat);
    mesh.position.copy(point);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2578;
    group.add(mesh);
    anchors.push({ point: point.clone(), part: String(part || ""), mesh });
    if (anchors.length > 16) {
      const old = anchors.shift();
      disposeObj(old.mesh);
    }
  }

  function begin(point, { onModel = false, part = "", authorId = "", authorName = "", drawId = "" } = {}) {
    if (!point) return false;
    if (eraserOn) {
      end();
      return eraseNear(point);
    }
    end();
    while (true) {
      const idx = nextStrokeEvictIndex(strokes, false);
      if (idx < 0) break;
      const old = strokes.splice(idx, 1)[0];
      disposeObj(old?.line);
      disposeObj(old?.tube);
      disposeObj(old?.grab);
    }
    const p = point.clone();
    const line = makeLiveLine();
    writeLivePoint(line, 0, p);
    ensureInkPool(strokeColor);
    resetInkPool();
    live = {
      points: [p],
      onModel: !!onModel,
      part: String(part || ""),
      color: strokeColor,
      radius: strokeRadius,
      brush: strokeBrush,
      drawId: drawId || nextDrawId(),
      authorId: String(authorId || ""),
      authorName: String(authorName || ""),
      createdAt: Date.now(),
      line,
      segs: [],
      tube: null,
      tip: null,
      lastAt: performance.now(),
    };
    ensureTip(p);
    if (onModel) addAnchor(p, part);
    return true;
  }

  function append(point) {
    if (eraserOn) return eraseNear(point);
    if (!live || !point) return false;
    const last = live.points[live.points.length - 1];
    if (last && last.distanceTo(point) < MIN_STEP) {
      ensureTip(point);
      return false;
    }
    if (live.points.length >= MAX_POINTS) return false;
    live.points.push(point.clone());
    writeLivePoint(live.line, live.points.length - 1, point);
    const prev = live.points[live.points.length - 2];
    writeInkInstance(live.points.length - 2, prev, point, live.radius, live.brush);
    ensureTip(point);
    return true;
  }

  function end() {
    if (!live) return false;
    const rec = live;
    live = null;
    disposeObj(rec.tip);
    resetInkPool();
    rec.segs = [];
    if (rec.points.length < 2) {
      disposeObj(rec.line);
      disposeObj(rec.tube);
      return false;
    }
    rec.line?.geometry?.computeBoundingSphere?.();
    refreshLiveTubeFor(rec);
    if (rec.tube) {
      disposeObj(rec.line);
      rec.line = null;
      tagDrawable(rec.tube, rec);
    }
    const kept = {
      points: rec.points,
      onModel: rec.onModel,
      part: rec.part,
      color: rec.color,
      radius: rec.radius,
      brush: rec.brush,
      drawId: rec.drawId,
      authorId: rec.authorId,
      authorName: rec.authorName,
      createdAt: rec.createdAt || Date.now(),
      line: rec.line,
      tube: rec.tube,
      grab: makeGrabHull(rec.points, rec),
    };
    strokes.push(kept);
    return true;
  }

  function refreshLiveTubeFor(rec) {
    if (!rec || rec.points.length < 2) return;
    disposeObj(rec.tube);
    rec.tube = makeTube(rec.points, rec.color, rec.radius, rec.brush);
  }

  function dimRec(rec, opacity = 0.42) {
    try {
      if (rec?.tube?.material) rec.tube.material.opacity = opacity;
      if (rec?.line?.material) rec.line.material.opacity = opacity;
    } catch { /* ignore */ }
  }

  function setStrokeParked(rec, parked) {
    if (!rec) return;
    for (const o of [rec.line, rec.tube, rec.grab]) {
      if (!o) continue;
      const u = o.userData || (o.userData = {});
      if (parked) {
        if (u.xrParkPrevVisible == null) u.xrParkPrevVisible = o.visible !== false;
        if (u.xrParkPrevDrawable == null) u.xrParkPrevDrawable = !!u.xrDrawable;
        o.visible = false;
        u.xrParked = true;
        u.xrDrawable = false;
      } else {
        o.visible = u.xrParkPrevVisible !== false;
        u.xrDrawable = u.xrParkPrevDrawable !== false;
        u.xrParked = false;
      }
    }
  }

  function lastStroke() {
    return strokes[strokes.length - 1] || null;
  }

  function undo() {
    end();
    const rec = strokes.pop();
    if (!rec) {
      const clip = clips[clips.length - 1];
      if (clip?.strokes?.length) {
        const last = clip.strokes.pop();
        disposeObj(last?.line);
        disposeObj(last?.tube);
        if (!clip.strokes.length) clips.pop();
        return true;
      }
      const anc = anchors.pop();
      if (anc) {
        disposeObj(anc.mesh);
        return true;
      }
      return false;
    }
    setStrokeParked(rec, true);
    return rec;
  }

  function redoStroke(rec) {
    if (!rec) return false;
    setStrokeParked(rec, false);
    strokes.push(rec);
    return true;
  }

  function disposeStrokeList(list) {
    while (list?.length) {
      const rec = list.pop();
      disposeObj(rec?.line);
      disposeObj(rec?.tube);
      disposeObj(rec?.grab);
    }
  }

  function clear() {
    live = null;
    resetInkPool();
    disposeStrokeList(strokes);
    while (anchors.length) disposeObj(anchors.pop().mesh);
    while (clips.length) {
      const clip = clips.pop();
      disposeStrokeList(clip.strokes);
      while (clip.anchors?.length) disposeObj(clip.anchors.pop().mesh);
    }
  }

  function liveStrokeCount() {
    return strokes.length + (live ? 1 : 0);
  }

  function strokeCount() {
    return clips.reduce((n, c) => n + (c.strokeCount || 0), 0) + liveStrokeCount();
  }

  function hasStrokes() {
    return strokeCount() > 0;
  }

  function hasLiveStrokes() {
    return liveStrokeCount() > 0;
  }

  function bounds() {
    const box = new THREE.Box3();
    const all = [];
    for (const clip of clips) {
      for (const s of clip.strokes || []) all.push(...(s.points || []));
    }
    for (const s of strokes) all.push(...s.points);
    if (live) all.push(...live.points);
    if (!all.length) return null;
    box.setFromPoints(all);
    return box.isEmpty() ? null : box;
  }

  function sketchFrom(strokeList, anchorList, { title = "Voice-draw 3D sketch" } = {}) {
    const pts = [];
    for (const s of strokeList || []) pts.push(...(s.points || []));
    if (!pts.length) return "";
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 768;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, 768, 768);
    const box = new THREE.Box3().setFromPoints(pts);
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 0.04);
    const pad = span * 0.12;
    const cx = (box.min.x + box.max.x) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    const map = (p) => {
      const x = ((p.x - cx) / (span + pad) + 0.5) * 700 + 34;
      const y = (0.5 - (p.y - cy) / (span + pad)) * 700 + 34;
      return [x, y];
    };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const drawStroke = (points, color, width) => {
      if (points.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      const [x0, y0] = map(points[0]);
      ctx.moveTo(x0, y0);
      for (let i = 1; i < points.length; i += 1) {
        const [x, y] = map(points[i]);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    for (const s of strokeList || []) {
      const color = hexColor(s.color, s.onModel ? "#f9a8d4" : "#67e8f9");
      drawStroke(s.points, color, s.onModel ? 10 : 9);
    }
    ctx.fillStyle = "#f472b6";
    for (const a of anchorList || []) {
      const [x, y] = map(a.point);
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 22px Arial,sans-serif";
    ctx.fillText(title, 28, 36);
    return canvas.toDataURL("image/png");
  }

  function toSketchDataUrl() {
    const liveList = live ? [...strokes, live] : strokes;
    return sketchFrom(liveList, anchors, { title: `Sketch ${clips.length + 1}` });
  }

  function augmentFrom(strokeList, anchorList, { formatLength, measureMm, modelName = "", index = 1 } = {}) {
    if (!strokeList?.length) return "";
    const lines = [
      `Voice-draw sketch ${index}:`,
      "I sketched intent in 3D (attached thumbnail). Use those strokes as the shape, path, and placement I want.",
    ];
    const model = String(modelName || "").trim();
    const onExisting = !!(model && (anchorList?.length || strokeList.some((s) => s.onModel)));
    if (onExisting) {
      lines.push(`Relate this to the existing model "${model}". Point-ats are where I want features on/near that part.`);
    } else {
      lines.push("Build this from scratch from the 3D sketch (no existing part required).");
    }
    const desc = [];
    strokeList.forEach((s, i) => {
      if (!s.points?.length) return;
      const a = s.points[0];
      const b = s.points[s.points.length - 1];
      let len = "";
      try {
        const mm = typeof measureMm === "function" ? measureMm(a, b) : a.distanceTo(b) * 1000;
        len = typeof formatLength === "function" ? formatLength(mm) : `${Math.round(mm)} mm`;
      } catch {
        len = `${round3(a.distanceTo(b) * 1000)} mm`;
      }
      desc.push(
        `Stroke ${i + 1}: ${s.onModel ? "on/near the model" : "in air"}`
        + (s.part ? ` (${s.part})` : "")
        + `, color ${hexColor(s.color)}`
        + `, ~${len}, ${s.points.length} points`
        + ` from (${round3(a.x)},${round3(a.y)},${round3(a.z)}) to (${round3(b.x)},${round3(b.y)},${round3(b.z)}).`,
      );
    });
    if (anchorList?.length) {
      lines.push(`Pointed at ${anchorList.length} spot(s) on the model${model ? ` (${model})` : ""}.`);
    }
    if (desc.length) lines.push(...desc);
    lines.push("Match the drawn 3D geometry: proportions, where it sits relative to the current model, and what I said in the voice prompt.");
    return lines.join("\n");
  }

  function toPromptAugment(opts = {}) {
    const liveList = live ? [...strokes, live] : strokes;
    return augmentFrom(liveList, anchors, { ...opts, index: clips.length + 1 });
  }

  function snapLive(opts = {}) {
    if (!liveStrokeCount()) return null;
    end();
    if (!strokes.length) return null;
    return {
      id: `voice-draw-live-${Date.now()}`,
      imageDataUrl: sketchFrom(strokes, anchors, { title: `Sketch ${clips.length + 1}` }),
      promptAugment: augmentFrom(strokes, anchors, { ...opts, index: clips.length + 1 }),
      strokeCount: strokes.length,
      pointedOnModel: anchors.length > 0 || strokes.some((s) => s.onModel),
    };
  }

  function commitClip(opts = {}) {
    const snap = snapLive(opts);
    if (!snap) return null;
    if (clips.length >= MAX_CLIPS) {
      const old = clips.shift();
      disposeStrokeList(old.strokes);
      while (old.anchors?.length) disposeObj(old.anchors.pop().mesh);
    }
    clipSeq += 1;
    const rec = {
      ...snap,
      id: `voice-draw-clip-${clipSeq}`,
      strokes: strokes.splice(0),
      anchors: anchors.splice(0),
    };
    rec.strokes.forEach((s) => dimRec(s));
    rec.anchors.forEach((a) => {
      try { if (a?.mesh?.material) a.mesh.material.opacity = 0.4; } catch { /* ignore */ }
    });
    clips.push(rec);
    return {
      id: rec.id,
      imageDataUrl: rec.imageDataUrl,
      promptAugment: rec.promptAugment,
      strokeCount: rec.strokeCount,
      pointedOnModel: rec.pointedOnModel,
    };
  }

  function removeClip(idOrIndex) {
    let idx = -1;
    if (typeof idOrIndex === "number") idx = idOrIndex;
    else idx = clips.findIndex((c) => c.id === idOrIndex);
    if (idx < 0 || idx >= clips.length) return false;
    const clip = clips.splice(idx, 1)[0];
    disposeStrokeList(clip.strokes);
    while (clip.anchors?.length) disposeObj(clip.anchors.pop().mesh);
    return true;
  }

  function listClips() {
    return clips.map((c) => ({
      id: c.id,
      imageDataUrl: c.imageDataUrl,
      promptAugment: c.promptAugment,
      strokeCount: c.strokeCount,
      pointedOnModel: c.pointedOnModel,
    }));
  }

  function snapshot({ formatLength, measureMm, modelName = "" } = {}) {
    const liveSnap = snapLive({ formatLength, measureMm, modelName });
    const all = [
      ...clips.map((c) => ({
        id: c.id,
        imageDataUrl: c.imageDataUrl,
        promptAugment: c.promptAugment,
        strokeCount: c.strokeCount,
        pointedOnModel: c.pointedOnModel,
      })),
    ];
    if (liveSnap) all.push(liveSnap);
    if (!all.length) return null;
    return {
      id: liveSnap?.id || all[all.length - 1]?.id,
      imageDataUrl: liveSnap?.imageDataUrl || all[all.length - 1]?.imageDataUrl || "",
      promptAugment: all.map((c) => c.promptAugment).filter(Boolean).join("\n\n"),
      strokeCount: all.reduce((n, c) => n + (c.strokeCount || 0), 0),
      pointedOnModel: all.some((c) => c.pointedOnModel),
      clips: all,
    };
  }

  function dispose() {
    clear();
    disposeObj(inkMesh);
    inkMesh = null;
    try { scene?.remove(group); } catch { /* ignore */ }
    try { lineMat?.dispose?.(); } catch { /* ignore */ }
    try { tubeMat?.dispose?.(); } catch { /* ignore */ }
    try { anchorMat?.dispose?.(); } catch { /* ignore */ }
    try { tipMat?.dispose?.(); } catch { /* ignore */ }
    lineMat = tubeMat = anchorMat = tipMat = null;
  }

  function lastStrokes(n = 2) {
    return strokes.slice(-Math.max(1, n)).map((s) => ({
      points: (s.points || []).map((p) => p.clone()),
      color: s.color,
      radius: s.radius,
      brush: s.brush || "pen",
      onModel: s.onModel,
    }));
  }

  function applyRemoteStroke(userId, stroke) {
    const pts = (stroke?.points || []).map((p) => {
      if (p?.isVector3) return p.clone();
      return new THREE.Vector3(Number(p.x ?? p[0]), Number(p.y ?? p[1]), Number(p.z ?? p[2]));
    }).filter((p) => Number.isFinite(p.x));
    if (pts.length < 2) return false;
    const slim = downsampleStrokePoints(pts, XR_COMMIT_STROKE_MAX_POINTS);
    const tube = makeTube(slim, stroke.color ?? strokeColor, stroke.radius || TUBE_RADIUS, stroke.brush || "pen");
    if (!tube) return false;
    while (true) {
      const idx = nextStrokeEvictIndex(strokes, true);
      if (idx < 0) break;
      const old = strokes.splice(idx, 1)[0];
      disposeObj(old?.line);
      disposeObj(old?.tube);
    }
    const rec = {
      points: slim,
      onModel: !!stroke.onModel,
      part: String(stroke.part || ""),
      color: stroke.color ?? strokeColor,
      radius: stroke.radius || TUBE_RADIUS,
      brush: brushStyle(stroke.brush).kind,
      drawId: stroke.drawId || stroke.draw_id || nextDrawId(),
      authorId: String(stroke.authorId || stroke.author_id || userId || ""),
      authorName: String(stroke.authorName || stroke.author_name || ""),
      createdAt: Number(stroke.createdAt || stroke.created_at || Date.now()) || Date.now(),
      line: null,
      tube,
      remote: true,
      userId,
    };
    tagDrawable(tube, rec);
    rec.grab = makeGrabHull(slim, rec);
    strokes.push(rec);
    return true;
  }

  function serializeStroke(rec) {
    const src = rec || live || strokes[strokes.length - 1];
    if (!src?.points?.length) return null;
    return {
      points: downsampleStrokePoints(src.points, XR_NETWORK_STROKE_MAX_POINTS).map((p) => [round3(p.x), round3(p.y), round3(p.z)]),
      color: src.color,
      radius: src.radius,
      brush: src.brush || "pen",
      onModel: !!src.onModel,
      part: src.part || "",
      drawId: src.drawId || "",
      authorId: src.authorId || "",
      authorName: src.authorName || "",
      createdAt: src.createdAt || Date.now(),
    };
  }

  function listDrawables() {
    const out = [];
    const add = (rec) => {
      if (rec?.tube) out.push(rec.tube);
      if (rec?.grab) out.push(rec.grab);
      for (const seg of rec?.segs || []) if (seg) out.push(seg);
    };
    for (const rec of strokes) add(rec);
    for (const clip of clips) {
      for (const s of clip.strokes || []) add(s);
    }
    if (live) add(live);
    if (live && inkMesh && inkMesh.count > 0) out.push(inkMesh);
    return out;
  }

  function findDrawable(drawId) {
    const id = String(drawId || "");
    if (!id) return null;
    return listDrawables().find((m) => m.userData?.xrDrawId === id) || null;
  }

  return {
    begin,
    append,
    end,
    undo,
    redoStroke,
    lastStroke,
    clear,
    setColor,
    setRadius,
    setBrush,
    getRadius: () => strokeRadius,
    setEraser,
    isEraser: () => eraserOn,
    eraseNear,
    listDrawables,
    findDrawable,
    hasStrokes,
    hasLiveStrokes,
    strokeCount,
    liveStrokeCount,
    clipCount: () => clips.length,
    bounds,
    snapshot,
    commitClip,
    removeClip,
    listClips,
    toSketchDataUrl,
    toPromptAugment,
    dispose,
    isDrawing: () => !!live,
    getGroup: () => group,
    lastStrokes,
    applyRemoteStroke,
    serializeStroke,
    liveInkCount: () => inkMesh?.count || 0,
  };
}
