/** VR Bambu plate preview math. Same scene as XR (`renderer.xr.enabled`). Token bambu1. */

export const BAMBU1_CACHE = "bambu1";
export const SLICER_BED_MM = 256;
export const SLICER_MM_TO_M = 0.001;

export const DESKTOP_IN_VR = {
  supported: false,
  reason: "Bambu Studio is a native GPU app. Quest Browser WebXR cannot embed it without a local window-capture bridge. Use this plate preview plus bambustudio:// on the PC.",
};

export function encodeProjectFilePath(filename) {
  return String(filename || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

export function parsePlateUtterance(text) {
  const raw = String(text || "");
  const plate = raw.match(/\bplate\s+(\d{1,2})\b/i);
  const orient = /flip|upside.?down/i.test(raw) ? "flip"
    : /\b180\b/.test(raw) ? "yaw180"
    : /rotate|90|turn/i.test(raw) ? "yaw90"
    : /flat|lay|bed|orient/i.test(raw) ? "flat"
    : "";
  const organize = /plate\s+\d|move (?:them|these|it) to plate|reorganize|other plate/i.test(raw);
  const confirm = /looks? (?:good|correct)|oriented|confirm plate|send (?:it )?over|cede|harness|debug log/i.test(raw);
  const cede = /send (?:it )?over|harness|cede|grok\/harness|debug solution/i.test(raw);
  return {
    plate_id: plate ? Number(plate[1]) : null,
    orientation: orient || (organize ? "" : "flat"),
    action: cede ? "cede_harness" : confirm ? "confirm_oriented" : organize ? "assign_plate" : orient ? "reorient" : "",
  };
}

export function partsInCircle(parts, circle, plates = []) {
  const cx = Number(circle?.x);
  const cz = Number(circle?.z ?? circle?.y);
  const r = Math.max(0.01, Number(circle?.r) || 0.08);
  if (![cx, cz].every(Number.isFinite)) return [];
  const originOf = (plateId) => {
    const plate = (plates || []).find((p) => Number(p.id) === Number(plateId));
    const o = plate?.origin_mm;
    return Array.isArray(o) ? o : [0, 0];
  };
  const hits = [];
  for (const part of parts || []) {
    const [ox, oy] = originOf(part.plate_id);
    const c = part.center_mm || [0, 0, 0];
    const wx = (ox + Number(c[0] || 0)) * SLICER_MM_TO_M;
    const wz = (oy + Number(c[1] || 0)) * SLICER_MM_TO_M;
    if ((wx - cx) ** 2 + (wz - cz) ** 2 <= r * r) hits.push(String(part.id));
  }
  return hits;
}

export function lassoToCircle(points = []) {
  const pts = (points || []).map((p) => ({
    x: Number(p.x ?? p[0]),
    z: Number(p.z ?? p.y ?? p[1]),
  })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
  if (pts.length < 3) return null;
  let sx = 0, sz = 0;
  for (const p of pts) { sx += p.x; sz += p.z; }
  const x = sx / pts.length;
  const z = sz / pts.length;
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p.x - x, p.z - z));
  return { x, z, r: Math.max(0.04, r) };
}

export function slicerVoiceContext(layout, extras = {}) {
  if (!layout?.parts) return null;
  return {
    active: true,
    token: BAMBU1_CACHE,
    filename: layout.filename || "",
    plates: (layout.plates || []).map((p) => ({ id: p.id, name: p.name, part_ids: p.part_ids || [] })),
    parts: (layout.parts || []).slice(0, 36).map((p) => ({
      id: p.id, name: p.name, plate_id: p.plate_id, oriented: !!p.oriented,
      size_mm: p.size_mm, rotation_deg: p.rotation_deg,
    })),
    profile: layout.profile || {},
    pointed_ids: extras.pointed_ids || layout.pointed_ids || [],
    draw_selected_ids: extras.draw_selected_ids || layout.draw_selected_ids || [],
    desktop_in_vr: DESKTOP_IN_VR,
  };
}

export function worldPoseForPart(part, plates, rootPos = { x: 0, y: 0.85, z: -0.55 }) {
  const plate = (plates || []).find((p) => Number(p.id) === Number(part.plate_id));
  const ox = Number(plate?.origin_mm?.[0] || 0) * SLICER_MM_TO_M;
  const oz = Number(plate?.origin_mm?.[1] || 0) * SLICER_MM_TO_M;
  const c = part.center_mm || [128, 128, 5];
  const size = part.size_mm || [20, 20, 10];
  return {
    x: rootPos.x + ox + Number(c[0]) * SLICER_MM_TO_M,
    y: rootPos.y + Number(c[2] || size[2] / 2) * SLICER_MM_TO_M,
    z: rootPos.z + oz + Number(c[1]) * SLICER_MM_TO_M,
    sx: Math.max(0.008, Number(size[0]) * SLICER_MM_TO_M),
    sy: Math.max(0.006, Number(size[2]) * SLICER_MM_TO_M),
    sz: Math.max(0.008, Number(size[1]) * SLICER_MM_TO_M),
  };
}

export function movePartOnPlate(part, worldDelta, plates) {
  const next = { ...part, center_mm: [...(part.center_mm || [128, 128, 5])] };
  const dx = Number(worldDelta?.x) / SLICER_MM_TO_M;
  const dy = Number(worldDelta?.z) / SLICER_MM_TO_M;
  next.center_mm[0] = Math.max(8, Math.min(SLICER_BED_MM - 8, Number(next.center_mm[0]) + dx));
  next.center_mm[1] = Math.max(8, Math.min(SLICER_BED_MM - 8, Number(next.center_mm[1]) + dy));
  return next;
}

export function slicerPlateVoiceTools() {
  return [{
    type: "function",
    name: "slicer_plate_command",
    description: "Reorient, move, or re-plate parts on the VR Bambu preview. Use pointed_ids or Draw lasso selection. confirm_oriented writes a debug log. cede_harness queues grok/harness without a production reset. Does not embed Bambu Studio.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["reorient", "move", "assign_plate", "set_profile", "confirm_oriented", "ping_group", "cede_harness"] },
        part_ids: { type: "array", items: { type: "string" } },
        pointed_ids: { type: "array", items: { type: "string" } },
        draw_selected_ids: { type: "array", items: { type: "string" } },
        plate_id: { type: "integer" },
        orientation: { type: "string", enum: ["flat", "flip", "yaw90", "yaw180"] },
        dx_mm: { type: "number" },
        dy_mm: { type: "number" },
        filament: { type: "string" },
        supports_enabled: { type: "boolean" },
        infill_pct: { type: "number" },
        ping_group: { type: "boolean" },
        cede_harness: { type: "boolean" },
        bug_id: { type: "string" },
        text: { type: "string" },
        description: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  }];
}

export const SLICER_PLATE_VOICE_INSTRUCTIONS = `When slicerPlates.active is true, the user is arranging print plates in VR (token bambu1). Numbered plates match the Export-to-Bambu 3MF layout. Pointing at a part or drawing a Draw-tool circle around mis-oriented objects selects them. "Hey on plate 8" sets plate_id. Call slicer_plate_command to reorient (flat/flip/yaw), assign_plate, or confirm_oriented (writes ai-context/debugger *-bambu-plate.jsonl and can ping the team board). If they ask to send it over to grok/harness for a debug solution to cede back, call cede_harness — that queues rm_queue and never production-resets. Do not claim Bambu Studio is open inside the headset.`;

export function createXrSlicerPlatePreview({ THREE, scene, camera } = {}) {
  const root = new THREE.Group();
  root.name = "xrSlicerPlates";
  root.visible = false;
  root.userData.xrSlicerRoot = true;
  try { scene?.add(root); } catch { /* ignore */ }
  let layout = null;
  const partMeshes = new Map();
  const plateMeshes = [];
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const plateMat = new THREE.MeshBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.55 });
  const partMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const selectedMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });

  function clear() {
    for (const mesh of partMeshes.values()) {
      root.remove(mesh);
      mesh.geometry?.dispose?.();
    }
    partMeshes.clear();
    for (const mesh of plateMeshes) {
      root.remove(mesh);
      mesh.geometry?.dispose?.();
    }
    plateMeshes.length = 0;
    while (root.children.length) root.remove(root.children[0]);
  }

  function placeRoot() {
    const cam = camera;
    if (!cam) {
      root.position.set(0, 0.85, -0.7);
      return;
    }
    cam.updateMatrixWorld?.(true);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    root.position.copy(cam.position).addScaledVector(dir, 0.7);
    root.position.y = Math.max(0.55, (cam.position.y || 1.5) - 0.7);
    root.lookAt(cam.position.x, root.position.y, cam.position.z);
  }

  function syncMeshes() {
    if (!layout) return;
    const origin = { x: 0, y: 0, z: 0 };
    for (const plate of layout.plates || []) {
      let mesh = plateMeshes.find((m) => m.userData.plateId === plate.id);
      if (!mesh) {
        mesh = new THREE.Mesh(geo, plateMat.clone());
        mesh.userData.xrSlicerPlate = true;
        mesh.userData.plateId = plate.id;
        mesh.userData.xrGrab = true;
        root.add(mesh);
        plateMeshes.push(mesh);
        const label = makeNumberSprite(THREE, plate.id);
        label.position.y = 0.04;
        mesh.add(label);
      }
      const ox = Number(plate.origin_mm?.[0] || 0) * SLICER_MM_TO_M;
      const oz = Number(plate.origin_mm?.[1] || 0) * SLICER_MM_TO_M;
      mesh.scale.set(SLICER_BED_MM * SLICER_MM_TO_M, 0.004, SLICER_BED_MM * SLICER_MM_TO_M);
      mesh.position.set(origin.x + ox + 0.128, origin.y, origin.z + oz + 0.128);
    }
    const seen = new Set();
    for (const part of layout.parts || []) {
      seen.add(part.id);
      let mesh = partMeshes.get(part.id);
      if (!mesh) {
        mesh = new THREE.Mesh(geo, partMat.clone());
        mesh.userData.xrSlicerPart = part.id;
        mesh.userData.xrGrab = true;
        root.add(mesh);
        partMeshes.set(part.id, mesh);
      }
      const pose = worldPoseForPart(part, layout.plates, origin);
      mesh.position.set(pose.x, pose.y, pose.z);
      mesh.scale.set(pose.sx, pose.sy, pose.sz);
      const selected = (layout.pointed_ids || []).includes(part.id) || (layout.draw_selected_ids || []).includes(part.id);
      mesh.material = selected ? selectedMat : (part.oriented ? new THREE.MeshBasicMaterial({ color: 0x4ade80 }) : partMat);
    }
    for (const [id, mesh] of partMeshes) {
      if (!seen.has(id)) {
        root.remove(mesh);
        partMeshes.delete(id);
      }
    }
  }

  function setLayout(next) {
    layout = next;
    if (!next) {
      root.visible = false;
      clear();
      return layout;
    }
    root.visible = true;
    placeRoot();
    syncMeshes();
    return layout;
  }

  function grabCandidates() {
    return [...partMeshes.values()];
  }

  function partIdFromObject(obj) {
    let o = obj;
    while (o) {
      if (o.userData?.xrSlicerPart) return String(o.userData.xrSlicerPart);
      o = o.parent;
    }
    return "";
  }

  function applyGrabDelta(partId, delta) {
    if (!layout) return null;
    const parts = (layout.parts || []).map((p) => (p.id === partId ? movePartOnPlate(p, delta, layout.plates) : p));
    layout = { ...layout, parts };
    syncMeshes();
    return layout;
  }

  function setPointed(ids) {
    if (!layout) return null;
    layout = { ...layout, pointed_ids: (ids || []).map(String).slice(0, 12) };
    syncMeshes();
    return layout;
  }

  function setDrawSelected(ids) {
    if (!layout) return null;
    layout = { ...layout, draw_selected_ids: (ids || []).map(String).slice(0, 24) };
    syncMeshes();
    return layout;
  }

  return {
    root,
    getLayout: () => layout,
    setLayout,
    grabCandidates,
    partIdFromObject,
    applyGrabDelta,
    setPointed,
    setDrawSelected,
    placeRoot,
    hide() { root.visible = false; },
    show() { if (layout) root.visible = true; },
    dispose() { clear(); try { scene?.remove(root); } catch { /* ignore */ } },
  };
}

function makeNumberSprite(THREE, n) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 42px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), 64, 34);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.08, 0.04, 1);
  sprite.userData.xrSlicerLabel = true;
  return sprite;
}
