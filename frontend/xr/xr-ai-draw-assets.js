/** Cheap project metadata and opt-in lightweight model presentation for VR Draw. */
export const XR_DRAW_MODEL_TRIANGLES = 8000;
export const XR_DRAW_MODEL_MESHES = 12;
export const XR_DRAW_MODEL_PRESENTATION_METRES = 0.28;
const IMAGE = /\.(?:png|jpe?g|webp|gif|bmp|svg|tiff?|heic)$/i;
const MODEL = /\.(?:glb|gltf|stl|obj|ply|3mf|step|stp|iges|igs|brep|f3d|usd[az]?)$/i;
const AUDIO = /\.(?:webm|mp3|m4a|wav|ogg|aac|flac|opus)$/i;
const text = (v, n = 500) => typeof v === "string" ? v.slice(0, n) : "";
const sourceUrl = (projectId, filename) => `/api/projects/${encodeURIComponent(projectId)}/files/${filename.split("/").map(encodeURIComponent).join("/")}`;
const safeUrl = (url) => /^(?:https?:\/\/|\/(?!\/))/.test(url || "") ? String(url).slice(0, 1200) : "";
function hash(value) { let result = 2166136261; for (let i = 0; i < value.length; i += 1) { result ^= value.charCodeAt(i); result = Math.imul(result, 16777619); } return (result >>> 0).toString(36); }

export function normalizeDrawAssets(raw, projectId = "") {
  const out = [], seen = new Set(), visited = new Set();
  function walk(value, folder = "", depth = 0) {
    if (!value || depth > 12 || out.length >= 300) return;
    if (Array.isArray(value)) { value.slice(0, 500).forEach((row) => walk(row, folder, depth + 1)); return; }
    if (typeof value === "string") value = { filename: value };
    if (typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (value.virtual_folder) {
      walk(value.children, text(value.folder || value.name || folder), depth + 1);
      return;
    }
    // A project-browser envelope may contain several independent file families.
    for (const key of ["files", "references", "components", "bodies", "children", "hardware"]) if (value[key]) walk(value[key], folder, depth + 1);
    let linkedFilename = "";
    const fileMatch = String(value.url || "").match(/^\/api\/projects\/[^/]+\/files\/([^?#]+)/);
    if (fileMatch) { try { linkedFilename = decodeURIComponent(fileMatch[1]); } catch { /* use entry metadata */ } }
    let filename = text(value.source_filename || value.filename || linkedFilename || value.viewer_filename || value.name || value.id).replace(/\\/g, "/");
    if (!filename || filename.includes("..") || /^(?:data:|blob:|javascript:)/i.test(filename)) return;
    const parentFolder = text(value.folder || value.parent_folder || folder);
    if (parentFolder && !filename.includes("/") && !/^(?:https?:|\/api\/)/.test(filename)) filename = `${parentFolder.replace(/\/$/, "")}/${filename}`;
    if (value.reference === true || (parentFolder && !/^(?:references|components|bodies|meshes)\//.test(filename))) {
      if (!filename.startsWith("references/")) filename = `references/${filename}`;
    }
    const kind = IMAGE.test(filename) ? "image" : MODEL.test(filename) ? "model" : AUDIO.test(filename) && !/^video\//.test(value.media_type || value.mime_type || "") ? "memo" : "";
    if (!kind) return;
    const pid = text(value.projectId || projectId, 128), key = `${pid}:${filename}`;
    if (seen.has(key)) return;
    seen.add(key);
    const url = safeUrl(value.url || value.preview_url) || (pid ? sourceUrl(pid, filename) : "");
    const revision = text(String(value.revision || value.content_hash || value.sha256 || value.etag || value.generation_id || `${value.mtime || value.updated_at || ""}:${value.size || value.bytes || ""}`), 200);
    const thumbnailUrl = safeUrl(value.thumbnail_url || value.thumbnailUrl || value.preview_url || (kind === "image" ? url : ""));
    out.push({ id: `asset-${hash(key)}`, name: text(value.label || value.display_name || filename.split("/").pop(), 160), kind,
      source: { projectId: pid, filename, revision, url, thumbnailUrl, units: text(value.units, 40),
        dimensions: Array.isArray(value.dimensions) ? value.dimensions.slice(0, 3).map(Number) : null,
        mediaType: text(value.media_type || value.mime_type, 100) },
      thumbnailUrl, transcript: text(value.transcript || value.text_content, 8000), audioUrl: kind === "memo" ? url : "" });
  }
  walk(raw);
  return out;
}

function ignored(object) {
  const u = object.userData || {};
  return object.visible === false || object.isLine || object.isPoints || object.isSprite || object.isLight || object.isCamera
    || /(?:Helper|Axes|Grid|Outline)/.test(object.type || "")
    || u.xrDrawable || u.xrUi || u.xrHelper || u.isHelper || u.helper || u.pickProxy;
}

/** Returns an unscaled, centred Group. Apply presentationScale to its board parent
 * once; never change the shared source geometry or original CAD dimensions.
 */
export function prepareDrawModel(THREE, root) {
  if (!THREE?.Group || !root?.isObject3D) throw new Error("Open this model in the viewport before adding it to VR Draw.");
  let triangles = 0, meshes = 0;
  const included = new Set();
  function inspect(object, hidden = false) {
    if (hidden || ignored(object)) return;
    if (object.isMesh) {
      if (object.isSkinnedMesh || object.isInstancedMesh) throw new Error("Animated or instanced models are deferred in VR Draw. Use a lightweight static mesh to protect headset frame rate.");
      const count = object.geometry?.index?.count ?? object.geometry?.attributes?.position?.count ?? 0;
      if (count <= 0) return;
      triangles += Math.floor(count / 3); meshes += 1; included.add(object);
      if (triangles > XR_DRAW_MODEL_TRIANGLES || meshes > XR_DRAW_MODEL_MESHES) throw new Error(`This model exceeds the VR Draw preview budget (${XR_DRAW_MODEL_TRIANGLES.toLocaleString()} triangles / ${XR_DRAW_MODEL_MESHES} meshes). Use a lighter preview to protect headset frame rate; the original model is unchanged.`);
    }
    for (const child of object.children || []) inspect(child);
  }
  inspect(root);
  if (!meshes) throw new Error("This model has no visible mesh to place on the Draw board.");
  root.updateWorldMatrix?.(true, true);
  const material = new THREE.MeshBasicMaterial({ color: 0xc5cdd1, side: THREE.DoubleSide, toneMapped: false });
  const wrapper = new THREE.Group(); wrapper.name = "VR Draw model preview";
  const sourcePathByMesh = new Map();
  function cloneNode(original, path = "") {
    if (ignored(original)) return null;
    const cloned = original.isMesh && included.has(original) ? new THREE.Mesh(original.geometry, material) : new THREE.Group();
    cloned.name = original.name;
    cloned.position.copy(original.position); cloned.quaternion.copy(original.quaternion); cloned.scale.copy(original.scale);
    cloned.matrixAutoUpdate = original.matrixAutoUpdate;
    if (original.matrixAutoUpdate === false) cloned.matrix.copy(original.matrix);
    cloned.userData = { xrBoardSourceMeshPath: path, xrBoardSourceMeshId: String(original.userData?.meshId || original.uuid || ""),
      ...(original.userData?.faceIds ? { faceIds: original.userData.faceIds } : {}),
      ...(original.userData?.faceId != null ? { faceId: original.userData.faceId } : {}),
      ...(original.userData?.kernel_face_index != null ? { kernel_face_index: original.userData.kernel_face_index } : {}) };
    if (cloned.isMesh) sourcePathByMesh.set(cloned.uuid, path);
    for (let i = 0; i < original.children.length; i += 1) { const child = cloneNode(original.children[i], `${path}/${i}`); if (child) cloned.add(child); }
    return cloned;
  }
  try {
    const cloned = cloneNode(root, "root");
    root.matrixWorld.decompose(cloned.position, cloned.quaternion, cloned.scale);
    cloned.matrixAutoUpdate = true;
    wrapper.add(cloned); wrapper.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrapper), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(extent) || extent <= 0) throw new Error("This model has invalid bounds and cannot be presented safely in VR Draw.");
    cloned.position.sub(center); cloned.updateMatrix(); wrapper.updateMatrixWorld(true);
    return { object: wrapper, presentationScale: XR_DRAW_MODEL_PRESENTATION_METRES / extent,
      dimensions: [size.x, size.y, size.z], triangles, meshes, sourcePathByMesh,
      dispose() { wrapper.removeFromParent?.(); wrapper.clear(); material.dispose(); } };
  } catch (error) { material.dispose(); wrapper.clear(); throw error; }
}
