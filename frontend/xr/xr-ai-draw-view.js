import { prepareXrImage } from './xr-image-budget.js?v=20260915-spatial-draw4';
import { createDrawCanvasPlane } from './xr-draw-canvas-plane.js?v=20260923-canvas1';
import { createXrNotePages } from './xr-note-pages.js?v=20260915-spatial-draw4';
/** One scene, bounded geometry and textures. No painting or allocation on idle update. */
export const DRAW_VIEW_LIMITS = Object.freeze({ nodes: 12, images: 6, triangles: 8000, meshes: 12, imageBytes: 2097152, textureEdge: 512 });
export function createXrAiDrawView({ THREE, scene, camera, gridGeometry, getToken, getPreviewBudget, onStatus = () => {} }) {
  const root = new THREE.Group(); root.name = 'XR AI Draw board'; root.visible = false; scene.add(root);
  const canvasPlane = createDrawCanvasPlane({ THREE, root, camera });
  // Reuse the existing workspace grid geometry; a small static fallback serves isolated previews.
  const fallbackGrid = gridGeometry ? null : new THREE.GridHelper(.8, 16);
  const gridGeo = gridGeometry || fallbackGrid.geometry;
  fallbackGrid?.material?.dispose();
  const gridMat = new THREE.LineBasicMaterial({ color: '#66848e', transparent: true, opacity: .34 });
  const spatialGrid = new THREE.LineSegments(gridGeo, gridMat); spatialGrid.name = 'AI Draw reference grid'; spatialGrid.raycast = () => {};
  if (!gridGeo.boundingBox) gridGeo.computeBoundingBox();
  const gridWidth = gridGeo.boundingBox.max.x - gridGeo.boundingBox.min.x;
  spatialGrid.scale.setScalar(.8 / Math.max(.01, gridWidth)); root.add(spatialGrid);
  const objects = new Map(), owned = new Set(), pickables = [], centers = new Map();
  let modelUsage = Object.freeze({ triangles: 0, meshes: 0 });
  function updateModelUsage() {
    let triangles = 0, meshes = 0;
    for (const entry of objects.values()) { triangles += entry.triangles || 0; meshes += entry.meshes || 0; }
    modelUsage = Object.freeze({ triangles, meshes });
  }
  const ray = new THREE.Raycaster(), origin = new THREE.Vector3(), dir = new THREE.Vector3(), temp = new THREE.Vector3(), normal = new THREE.Vector3();
  const meshNormalMatrix = new THREE.Matrix3(), nodeNormalMatrix = new THREE.Matrix3();
  const arrowSide = new THREE.Vector3(), arrowView = new THREE.Vector3();
  const boundsSphere = new THREE.Sphere(), boundsHit = new THREE.Vector3(), closestBoundsHit = new THREE.Vector3();
  const lines = new Float32Array(60000), livePositions = new Float32Array(128 * 3);
  const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(lines, 3)); lineGeo.setDrawRange(0, 0);
  const lineMat = new THREE.LineBasicMaterial({ color: '#8bbfc8', depthTest: true });
  const ink = new THREE.LineSegments(lineGeo, lineMat); ink.frustumCulled = false; root.add(ink);
  const liveGeo = new THREE.BufferGeometry(); liveGeo.setAttribute('position', new THREE.BufferAttribute(livePositions, 3)); liveGeo.setDrawRange(0, 0);
  const liveMat = new THREE.LineBasicMaterial({ color: '#e2cf93' }); const live = new THREE.Line(liveGeo, liveMat); live.frustumCulled = false; root.add(live);
  const cardGeo = new THREE.PlaneGeometry(.24, .18), cardMat = new THREE.MeshBasicMaterial({ color: '#345464', side: THREE.DoubleSide });
  function makePanel(name, width, height, meters) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.dataset.xrAiDraw = name;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    // Keep opaque-looking UI in the transparent pass so its high render order
    // applies after the translucent grid, which would otherwise cross the text.
    const geo = new THREE.PlaneGeometry(meters, meters * height / width), material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 1 });
    const plane = new THREE.Mesh(geo, material); plane.renderOrder = 30; root.add(plane);
    return { canvas, texture, plane, geo, material, hits: [] };
  }
  const panel = makePanel('controls', 1024, 1024, .48), notePanel = makePanel('note', 768, 512, .33); notePanel.plane.visible = false;
  const textCards = new Map();
  let state = null, dirty = false, disposed = false, sequence = 0, hovered = '', noteKey = '', notePage = 0, lineOverflow = false;
  let noteContentKey = '', notePages = null;
  const loading = new Map();
  let imageDecodeQueue = Promise.resolve();
  function pointRay(controller) {
    if (!controller) return false;
    const aim = controller.userData?.handAim;
    if (aim?.origin && aim?.direction) { origin.copy(aim.origin); dir.copy(aim.direction).normalize(); }
    else { controller.updateWorldMatrix?.(true, false); origin.setFromMatrixPosition(controller.matrixWorld); dir.set(0, 0, -1).transformDirection(controller.matrixWorld); }
    ray.set(origin, dir); return true;
  }
  function poseAhead(object, x = 0, y = -.05, z = -.5) {
    camera.updateWorldMatrix?.(true, false); camera.getWorldQuaternion(object.quaternion);
    object.position.set(x, y, z).applyQuaternion(object.quaternion).add(camera.getWorldPosition(temp));
  }
  function frontTransform(index = 0) {
    if (canvasPlane.isEnabled()) return canvasPlane.frontTransform(index);
    const g = new THREE.Object3D(); poseAhead(g, .06 + (index % 3) * .11, -.08 - Math.floor(index / 3) * .09, -.48);
    return { position: g.position.toArray(), quaternion: g.quaternion.toArray(), scale: [1, 1, 1] };
  }
  function applyTransform(group, transform) { group.position.fromArray(transform.position); group.quaternion.fromArray(transform.quaternion); group.scale.fromArray(transform.scale); group.updateMatrixWorld(true); }
  function removeNode(id) {
    const entry = objects.get(id); if (!entry) return;
    entry.imageAbort?.abort(); entry.group.removeFromParent(); entry.cleanup?.(); entry.texture?.dispose(); entry.bitmap?.close?.(); entry.material?.dispose(); objects.delete(id); loading.delete(id); updateModelUsage();
  }
  async function imageFor(entry, node) {
    const url = node.thumbnailUrl || node.source.thumbnailUrl || node.source.url; if (!url) return;
    const ticket = ++sequence; loading.set(node.id, ticket);
    const abort = new AbortController(); entry.imageAbort = abort;
    const current = () => !disposed && root.visible && !abort.signal.aborted && loading.get(node.id) === ticket && objects.get(node.id) === entry;
    try {
      const u = new URL(url, location.href); if (u.origin !== location.origin || u.username || u.password) throw new Error('Use a project image for a VR preview.');
      const token = getToken?.(); const response = await fetch(u.href, { signal: abort.signal, redirect: 'error', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error('Image preview unavailable.');
      const len = Number(response.headers.get('content-length')); if (len > DRAW_VIEW_LIMITS.imageBytes) { await response.body?.cancel(); throw new Error('This image needs a smaller preview (under 2 MB) for VR.'); }
      const reader = response.body?.getReader(); let blob;
      if (reader) { let size = 0; const chunks = []; for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > DRAW_VIEW_LIMITS.imageBytes) { await reader.cancel(); throw new Error('This image needs a smaller preview (under 2 MB) for VR.'); } chunks.push(part.value); } blob = new Blob(chunks); }
      else { blob = await response.blob(); if (blob.size > DRAW_VIEW_LIMITS.imageBytes) throw new Error('Image exceeds the VR preview budget.'); }
      if (!current()) return;
      // Header preflight precedes any pixel decode. Decode one bounded image at a time.
      const decode = imageDecodeQueue.catch(() => {}).then(async () => {
        if (!current()) return;
        const image = await prepareXrImage(blob);
        if (!current()) return;
        // WebGL ignores Texture.flipY for ImageBitmap; orient the one bounded
        // decoded bitmap here and compensate only the canvas picker below.
        const bitmap = await createImageBitmap(image.blob, { resizeWidth: image.resizeWidth, resizeHeight: image.resizeHeight, resizeQuality: 'low', imageOrientation: 'flipY' });
        if (!current()) { bitmap.close(); return; }
        const texture = new THREE.Texture(bitmap); texture.needsUpdate = true; texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
        entry.material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }); entry.card.material = entry.material; entry.bitmap = bitmap; entry.texture = texture;
        const fit = Math.min(.24 / image.width, .18 / image.height); entry.card.scale.set(image.width * fit / .24, image.height * fit / .18, 1);
      });
      imageDecodeQueue = decode.catch(() => {});
      await decode;
    } catch (error) { if (!abort.signal.aborted && !disposed && objects.get(node.id) === entry) { entry.imageFailedUrl = url; onStatus(error.message); } }
    finally { if (loading.get(node.id) === ticket) loading.delete(node.id); if (entry.imageAbort === abort) entry.imageAbort = null; }
  }
  function loadImages() {
    if (!root.visible || disposed || !state) return;
    let count = 0;
    for (const [id, entry] of objects) {
      const node = state.nodes[id]; if (node?.kind !== 'image' || ++count > DRAW_VIEW_LIMITS.images) continue;
      const url = node.thumbnailUrl || node.source.thumbnailUrl || node.source.url;
      if (!entry.bitmap && !loading.has(id) && entry.imageFailedUrl !== url) void imageFor(entry, node);
    }
  }
  function assertModelBudget(prepared, replacingId = '') {
    const entry = objects.get(replacingId);
    const triangles = prepared.triangles + modelUsage.triangles - (entry?.triangles || 0);
    const meshes = prepared.meshes + modelUsage.meshes - (entry?.meshes || 0);
    // Budget excludes board previews: the caller reserves the displayed CAD's
    // share once on scene/model changes. This check never traverses that scene.
    let remaining = DRAW_VIEW_LIMITS;
    try { if (getPreviewBudget) remaining = getPreviewBudget() || {}; }
    catch { throw new Error('The current scene preview budget is unavailable. Try reopening AI Draw.'); }
    const cap = (value, max) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Number(value))) : 0;
    const maxTriangles = cap(remaining.triangles, DRAW_VIEW_LIMITS.triangles);
    const maxMeshes = cap(remaining.meshes, DRAW_VIEW_LIMITS.meshes);
    if (!Number.isFinite(triangles) || !Number.isFinite(meshes) || triangles > maxTriangles || meshes > maxMeshes) {
      throw new Error('The current VR scene has no room for this model preview within its frame-rate budget. Remove another model or use a lighter preview; the source file is unchanged.');
    }
    return true;
  }
  function attachModel(id, prepared) {
    const entry = objects.get(id); if (!entry) { prepared.dispose?.(); return false; }
    try { assertModelBudget(prepared, id); } catch (error) { prepared.dispose?.(); throw error; }
    entry.cleanup?.(); entry.card.visible = false; entry.group.add(prepared.object); entry.cleanup = () => { prepared.object.removeFromParent(); prepared.dispose?.(); };
    entry.triangles = prepared.triangles; entry.meshes = prepared.meshes; entry.model = prepared.object; dirty = true; updateModelUsage(); rebuildPickables(); return true;
  }
  function detachModel(id) {
    const entry = objects.get(id); if (!entry) return false;
    entry.cleanup?.(); entry.cleanup = null; entry.model = null;
    entry.triangles = 0; entry.meshes = 0; entry.card.visible = true;
    dirty = true; updateModelUsage(); rebuildPickables(); return true;
  }
  function rebuildPickables() {
    pickables.length = 0;
    for (const [id, entry] of objects) entry.group.traverse(object => { if (object.isMesh && object.visible) { object.userData.drawBoardNode = id; pickables.push(object); } });
  }
  function sync(next) {
    state = next; dirty = true;
    if (next.canvas?.pose) canvasPlane.restorePose(next.canvas.pose);
    canvasPlane.setEnabled(next.canvas?.enabled === true);
    spatialGrid.visible = next.canvas?.enabled !== true;
    const notes = Object.values(next.notes || {}).filter(note => !note.nodeId && !note.regionId).slice(0, 24);
    const noteIds = new Set(notes.map(note => note.id));
    for (const [id, card] of textCards) if (!noteIds.has(id)) {
      card.plane.removeFromParent(); card.texture.dispose(); card.geo.dispose(); card.material.dispose(); textCards.delete(id);
    }
    for (const note of notes) {
      let card = textCards.get(note.id);
      if (!card) { card = makePanel('text', 512, 256, .5); textCards.set(note.id, card); }
      card.plane.position.fromArray(note.position);
      if (next.canvas?.pose) card.plane.quaternion.fromArray(next.canvas.pose.quaternion);
      else camera.getWorldQuaternion(card.plane.quaternion);
      if (card.text !== note.text) {
        const ctx = card.canvas.getContext('2d'); ctx.fillStyle = '#233746'; ctx.fillRect(0, 0, 512, 256);
        ctx.fillStyle = '#f2f7ff'; ctx.font = '28px sans-serif'; wrap(ctx, note.text, 18, 40, 476, 36, 6);
        card.text = note.text; card.texture.needsUpdate = true;
      }
    }
    const visibleNodes = Object.values(next.nodes).slice(0, DRAW_VIEW_LIMITS.nodes);
    const visibleIds = new Set(visibleNodes.map(node => node.id));
    for (const id of objects.keys()) if (!visibleIds.has(id)) removeNode(id);
    for (const node of visibleNodes) {
      let entry = objects.get(node.id);
      if (!entry) {
        const group = new THREE.Group(); group.name = node.name; root.add(group); const card = new THREE.Mesh(cardGeo, cardMat); group.add(card);
        entry = { group, card, kind: node.kind }; objects.set(node.id, entry);
      }
      applyTransform(entry.group, node.transform);
    }
    rebuildPickables(); loadImages();
  }
  function worldPoint(record, point, out = new THREE.Vector3()) {
    out.fromArray(point || record.position || [0, 0, 0]);
    if (record.anchor && !record.anchor.needsReattach) { const group = objects.get(record.anchor.nodeId)?.group; if (group) group.localToWorld(out); }
    return out;
  }
  function center(id, out = new THREE.Vector3(), visiting = new Set()) {
    if (visiting.has(id)) return out.set(0, 0, 0); visiting.add(id);
    const entry = objects.get(id); if (entry) return entry.group.getWorldPosition(out);
    const r = state?.regions[id] || state?.drawings[id];
    if (r) { const pts = r.anchor?.localPoints?.length ? r.anchor.localPoints : r.points; out.set(0, 0, 0); if (pts?.length) { for (const p of pts) out.add(temp.fromArray(p)); out.multiplyScalar(1 / pts.length); return worldPoint(r, out.toArray(), out); } return worldPoint(r, r.position, out); }
    const n = state?.notes[id]; if (n) return n.regionId || n.nodeId ? center(n.regionId || n.nodeId, out, visiting) : out.fromArray(n.position);
    const l = state?.links[id]; if (l) { const a = center(l.fromId, out, visiting).clone(); return center(l.toId, out, visiting).add(a).multiplyScalar(.5); }
    return out.set(0, 0, 0);
  }
  function rebuildLines() {
    dirty = false; centers.clear(); let cursor = 0, overflow = false;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    function segment(p, q, dotted = false) {
      const length = p.distanceTo(q), count = dotted ? Math.min(48, Math.max(1, Math.ceil(length / .014))) : 1;
      if (cursor + count * 6 > lines.length) overflow = true;
      for (let i = 0; i < count && cursor + 6 <= lines.length; i++) {
        const start = i / count, end = dotted ? (i + .48) / count : 1;
        lines[cursor++] = p.x + (q.x - p.x) * start; lines[cursor++] = p.y + (q.y - p.y) * start; lines[cursor++] = p.z + (q.z - p.z) * start;
        lines[cursor++] = p.x + (q.x - p.x) * end; lines[cursor++] = p.y + (q.y - p.y) * end; lines[cursor++] = p.z + (q.z - p.z) * end;
      }
    }
    for (const r of [...Object.values(state?.regions || {}), ...Object.values(state?.drawings || {})]) {
      if (r.anchor?.needsReattach) continue;
      const pts = r.anchor?.localPoints?.length ? r.anchor.localPoints : r.points;
      for (let i = 1; i < (pts?.length || 0); i++) segment(worldPoint(r, pts[i-1], a), worldPoint(r, pts[i], b), r.kind === 'lasso' || r.kind === 'face' || r.kind === 'edge');
      if (r.kind === 'lasso' && pts.length > 2) segment(worldPoint(r, pts.at(-1), a), worldPoint(r, pts[0], b), true);
      if (r.tool === 'arrow' && pts.length > 1) { worldPoint(r, pts.at(-1), a); worldPoint(r, pts.at(-2), b); dir.subVectors(b, a).normalize().multiplyScalar(.015); camera.getWorldDirection(arrowView); arrowSide.crossVectors(dir, arrowView); if (arrowSide.lengthSq() < 1e-8) arrowSide.set(1, 0, 0).cross(dir); arrowSide.normalize().multiplyScalar(.009); b.copy(a).add(dir).add(arrowSide); segment(a, b); b.addScaledVector(arrowSide, -2); segment(a, b); }
      centers.set(r.id, center(r.id));
    }
    for (const l of Object.values(state?.links || {})) { segment(center(l.fromId, a), center(l.toId, b), true); centers.set(l.id, center(l.id)); }
    for (const n of Object.values(state?.notes || {})) centers.set(n.id, center(n.id));
    lineGeo.attributes.position.needsUpdate = true; lineGeo.setDrawRange(0, cursor / 3);
    const newlyFull = overflow && !lineOverflow; lineOverflow = overflow;
    if (newlyFull) onStatus('This board exceeds the VR ink preview budget. Some lines are held back. Remove or simplify strokes before Generate.');
    updateNote();
  }
  function wrap(ctx, text, x, y, width, lineHeight, maxLines = 10) {
    const words = String(text || '').split(/\s+/); let line = '', row = 0;
    for (const word of words) { const trial = `${line} ${word}`.trim(); if (ctx.measureText(trial).width > width && line) { ctx.fillText(line, x, y + row++ * lineHeight); line = word; if (row >= maxLines) return; } else line = trial; } if (row < maxLines) ctx.fillText(line, x, y + row * lineHeight);
  }
  function updateNote() {
    const target = hovered || state?.selectedIds?.[0]; const region = state?.regions[target];
    const notes = state?.notes[target] ? [state.notes[target]] : Object.values(state?.notes || {}).filter(n => n.regionId === target || n.nodeId === target);
    const expanded = notes.filter(note => note.expanded);
    const content = [region?.anchor?.needsReattach ? 'Surface changed — reattach this region.' : '', ...(expanded.length ? expanded.map(n => `${n.name}: ${n.text}`) : notes.length ? [`${notes.length} notes · open Region notes → Expand to read.`] : [])].filter(Boolean).join('\n');
    if (!content) { notePanel.plane.visible = false; noteKey = ''; return; }
    notePanel.plane.visible = root.visible; center(target, notePanel.plane.position); notePanel.plane.position.x += .22; notePanel.plane.position.y += .10; camera.getWorldQuaternion(notePanel.plane.quaternion);
    const ctx = notePanel.canvas.getContext('2d'); ctx.font = '26px sans-serif';
    const contentKey = `${target}:${content}`;
    if (contentKey !== noteContentKey) {
      noteContentKey = contentKey; notePage = 0; noteKey = '';
      notePages = createXrNotePages({ text: content, measure: text => ctx.measureText(text).width });
    }
    const page = notePages.page(notePage); notePage = page.index; const key = `${contentKey}:${notePage}`;
    if (key === noteKey) return; noteKey = key;
    ctx.fillStyle = '#13202a'; ctx.fillRect(0, 0, 768, 512); ctx.fillStyle = '#e4eef1'; ctx.font = '28px sans-serif';
    ctx.fillText(`Notes · ${notePage + 1}/${page.total || '…'} · tap to turn page`, 24, 45); ctx.font = '26px sans-serif';
    page.lines.forEach((line, index) => ctx.fillText(line, 24, 90 + index * 36)); notePanel.texture.needsUpdate = true;
  }
  function paint({ title = 'AI Draw', subtitle = '', lines: textLines = [], buttons = [], keyboard = null }) {
    const ctx = panel.canvas.getContext('2d'); ctx.fillStyle = '#101c25'; ctx.fillRect(0, 0, 1024, 1024); ctx.strokeStyle = '#29414b'; ctx.strokeRect(2, 2, 1020, 1020);
    ctx.fillStyle = '#edf4f5'; ctx.font = 'bold 38px sans-serif'; ctx.fillText(title.slice(0, 45), 32, 58); ctx.font = '24px sans-serif'; ctx.fillStyle = '#a9c3cc'; wrap(ctx, subtitle, 32, 102, 960, 32, 2);
    ctx.fillStyle = '#e2ecef'; textLines.slice(0, 8).forEach((line, i) => ctx.fillText(String(line).slice(0, 74), 32, 182 + i * 34));
    panel.hits = []; const start = keyboard ? 460 : Math.max(255, Math.min(455, 210 + textLines.length * 34));
    buttons.forEach((button, i) => { const col = i % 3, row = Math.floor(i / 3), x = 24 + col * 330, y = start + row * 72; if (y + 64 > (keyboard ? 605 : 1020)) return; const box = { ...button, x, y, w: 318, h: 62 }; panel.hits.push(box); ctx.fillStyle = button.active ? '#345e6b' : '#243740'; ctx.fillRect(x, y, box.w, box.h); ctx.fillStyle = '#edf4f5'; ctx.font = '24px sans-serif';
      const referenceId = String(button.id || '').replace(/^mention:/, '');
      const bitmap = objects.get(referenceId)?.bitmap;
      if (bitmap) { const ratio = Math.min(44 / bitmap.width, 44 / bitmap.height), w = bitmap.width * ratio, h = bitmap.height * ratio; ctx.save(); ctx.translate(x + 8, y + 8 + h); ctx.scale(1, -1); ctx.drawImage(bitmap, 0, 0, w, h); ctx.restore(); }
      ctx.fillText(String(button.label).slice(0, bitmap ? 19 : 24), x + (bitmap ? 64 : 12), y + 40); });
    if (keyboard) { ctx.font = '23px sans-serif'; for (const key of keyboard.keys) { const box = { ...key, y: key.y + 605 }; panel.hits.push(box); ctx.fillStyle = '#29414b'; ctx.fillRect(box.x, box.y, box.w, box.h); ctx.fillStyle = '#edf4f5'; ctx.fillText(key.label, box.x + 8, box.y + box.h * .65); } }
    panel.texture.needsUpdate = true;
  }
  function pickUI(controller) {
    if (!root.visible || !pointRay(controller)) return null;
    const hits = ray.intersectObjects([panel.plane, ...(notePanel.plane.visible ? [notePanel.plane] : [])], false);
    if (!hits.length) return null; const hit = hits[0];
    if (hit.object === notePanel.plane) return { kind: 'ai-action', id: 'board:note_page', distance: hit.distance, point: hit.point };
    const x = hit.uv.x * 1024, y = (1 - hit.uv.y) * 1024; const button = panel.hits.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return { kind: 'ai-action', id: `board:${button?.id || 'chrome'}`, distance: hit.distance, point: hit.point };
  }
  function pick(controller, { surface = false } = {}) {
    if (!root.visible || !pointRay(controller)) return null;
    const hits = ray.intersectObjects(pickables, false); let result = null;
    if (!surface) for (const [id, card] of textCards) {
      const hit = ray.intersectObject(card.plane, false)[0];
      if (hit && (!result || hit.distance < result.distance)) result = { id, point: hit.point, distance: hit.distance };
    }
    if (hits.length) { const hit = hits[0], nodeId = hit.object.userData.drawBoardNode, node = state.nodes[nodeId], entry = objects.get(nodeId); result = { id: nodeId, nodeId, point: hit.point, distance: hit.distance };
      if (node?.kind === 'model' && entry.model && hit.face) {
        const localPoint = entry.group.worldToLocal(hit.point.clone()), metadata = hit.object.userData;
        normal.copy(hit.face.normal).applyMatrix3(meshNormalMatrix.getNormalMatrix(hit.object.matrixWorld));
        normal.applyMatrix3(nodeNormalMatrix.setFromMatrix4(entry.group.matrixWorld).transpose()).normalize();
        const faceValue = metadata.faceIds?.[hit.faceIndex] ?? metadata.faceId ?? metadata.kernel_face_index;
        const faceId = typeof faceValue === 'string' || Number.isInteger(faceValue) ? String(faceValue) : '';
        result.anchor = { nodeId, instanceId: node.instanceId, sourceRevision: node.source.revision,
          sourceFilename: node.source.filename, faceId, meshId: metadata.xrBoardSourceMeshId || hit.object.uuid,
          meshPath: metadata.xrBoardSourceMeshPath || '', triangleIndex: hit.faceIndex,
          sourceLocalPoint: hit.object.worldToLocal(hit.point.clone()).toArray(),
          localPoints: [localPoint.toArray()], localNormal: normal.toArray() };
        if (surface && hit.object.geometry?.attributes?.position) {
          result.anchor.boardToSourceMatrix = hit.object.matrixWorld.clone().invert().multiply(entry.group.matrixWorld).toArray();
          const positions = hit.object.geometry.attributes.position;
          result.trianglePoints = [hit.face.a, hit.face.b, hit.face.c].map(index => {
            const point = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(hit.object.matrixWorld);
            return entry.group.worldToLocal(point).toArray();
          });
        }
      }
    }
    if (!surface) for (const [id, c] of centers) { const distance = ray.ray.origin.distanceTo(c); if (ray.ray.distanceSqToPoint(c) < .025 ** 2 && (!result || distance < result.distance + .04)) result = { id, point: c.clone(), distance }; }
    return result;
  }
  function pickBounds(controller) {
    if (!root.visible || !pointRay(controller)) return null;
    let distance = Infinity, object = null, pickedId = '';
    function consider(id, target, radius, candidate) {
      boundsSphere.center.copy(target); boundsSphere.radius = radius;
      if (!ray.ray.intersectSphere(boundsSphere, boundsHit)) return;
      const hitDistance = origin.distanceTo(boundsHit);
      if (hitDistance < distance) { distance = hitDistance; object = candidate; pickedId = id; closestBoundsHit.copy(boundsHit); }
    }
    for (const [id, entry] of objects) {
      if (!entry.group.visible) continue;
      const node = state?.nodes[id]; if (!node) continue;
      const scale = Math.abs(entry.group.scale.x);
      const radius = node.kind === 'model' ? .15 * scale / Math.max(.000001, node.presentationScale || 1) : .16 * scale;
      consider(id, entry.group.getWorldPosition(temp), radius, entry.group);
    }
    for (const [id, point] of centers) {
      const item = state?.regions[id] || state?.notes[id] || state?.links[id] || state?.drawings[id];
      const parent = objects.get(item?.nodeId || item?.anchor?.nodeId)?.group || root;
      consider(id, point, .025, parent);
    }
    return object ? { kind: 'mesh', object, distance, point: closestBoundsHit.clone(), boardId: pickedId } : null;
  }
  function drawingPoint(controller, anchor) {
    if (!pointRay(controller)) return null;
    if (canvasPlane.isEnabled()) return canvasPlane.drawingPoint(origin, dir);
    if (anchor) { const group = objects.get(anchor.nodeId)?.group; if (!group) return null; const localOrigin = group.worldToLocal(origin.clone()), localEnd = group.worldToLocal(origin.clone().add(dir)); const localDir = localEnd.sub(localOrigin).normalize(); const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(temp.fromArray(anchor.localNormal), new THREE.Vector3().fromArray(anchor.localPoints[0])); return new THREE.Ray(localOrigin, localDir).intersectPlane(plane, new THREE.Vector3()); }
    return origin.clone().addScaledVector(dir, .035);
  }
  return { root, panel, objects, canvasPlane, lineGeo, liveGeo, sync, paint, pickUI, pick, pickBounds, attachModel, detachModel, assertModelBudget, getModelUsage: () => modelUsage, isLineBudgetExceeded: () => lineOverflow, frontTransform,
    setVisible(value) {
      root.visible = value;
      if (value) {
        let deferred = 0;
        for (const [id, entry] of [...objects].reverse()) {
          if (!entry.model) continue;
          try { assertModelBudget({ triangles: entry.triangles, meshes: entry.meshes }, id); }
          catch { detachModel(id); deferred++; }
        }
        if (deferred) onStatus('Some model previews are held until the current VR scene has more frame-rate budget. Their source files and annotations are unchanged.');
        poseAhead(panel.plane, -.43, .03, -.72); poseAhead(spatialGrid, .12, -.10, -.77); spatialGrid.rotateX(Math.PI / 2); updateNote(); loadImages();
      } else { for (const entry of objects.values()) entry.imageAbort?.abort(); loading.clear(); }
    },
    live(points, anchor) { let i = 0; for (const p of points.slice(-128)) { worldPoint({ anchor }, p, temp); temp.toArray(livePositions, i++ * 3); } liveGeo.attributes.position.needsUpdate = true; liveGeo.setDrawRange(0, i); },
    drawingPoint, worldPoint, center, getObject: id => objects.get(id)?.group,
    setTransform(id, transform) { const entry = objects.get(id); if (entry) { applyTransform(entry.group, transform); dirty = true; } },
    hover(id) { if (hovered !== id) { hovered = id; notePage = 0; updateNote(); } },
    notePage() { notePage++; noteKey = ''; updateNote(); },
    collapseNotes() { hovered = ''; notePanel.plane.visible = false; },
    update() { if (root.visible && dirty) rebuildLines(); },
    dispose() { disposed = true; canvasPlane.dispose(); for (const id of objects.keys()) removeNode(id); root.removeFromParent(); gridMat.dispose(); if (fallbackGrid) gridGeo.dispose(); for (const p of [panel, notePanel, ...textCards.values()]) { p.texture.dispose(); p.material.dispose(); p.geo.dispose(); } textCards.clear(); for (const v of [lineGeo, lineMat, liveGeo, liveMat, cardGeo, cardMat]) v.dispose(); loading.clear(); owned.clear(); }
  };
}
