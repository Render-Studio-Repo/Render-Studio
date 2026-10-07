/** Shared VR scene meshes — same GLB URL + pose for everyone in the room. */

export const XR_SCENE_SHARE_KIND = "scene";
export const XR_SCENE_SHARE_FIT = "world";
export const XR_SCENE_SHARE_MAX = Infinity;

const MODEL_NAME_RE = /\.(glb|gltf|step|stp|3mf|obj|stl|fbx|usdz)$/i;

export function isShareableSceneMeshName(name = "") {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop() || "";
  return MODEL_NAME_RE.test(base);
}

export function sceneShareObjectId({ projectId = "", filename = "" } = {}) {
  const pid = String(projectId || "").trim().slice(0, 40);
  const file = String(filename || "").replace(/\\/g, "/").split("/").pop() || "model";
  const safe = file.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 48);
  return `scene-${pid || "proj"}-${safe}`.slice(0, 80);
}

export function isSceneShareId(id = "") {
  return String(id || "").startsWith("scene-");
}

export function shareModeFromRecord(share = null) {
  const mode = String(share?.share_mode || "").toLowerCase();
  if (mode === "edit" || mode === "remix" || mode === "view") return mode;
  if (share?.allow_edit) return "edit";
  if (share?.allow_remix || share?.allow_download) return "remix";
  return "view";
}

export function shouldPublishSceneMeshes({
  presenting = false,
  publicJoined = false,
  projectConnected = false,
} = {}) {
  if (!presenting) return false;
  return !!(publicJoined || projectConnected);
}

export function collectSceneShareItems({
  projectId = "",
  projectName = "",
  selectedFile = "",
  assemblyList = [],
} = {}) {
  const pid = String(projectId || "").trim();
  const seen = new Set();
  const out = [];
  const push = (filename) => {
    const name = String(filename || "").trim();
    if (!name || seen.has(name) || !isShareableSceneMeshName(name)) return;
    seen.add(name);
    out.push({
      project_id: pid,
      project_name: String(projectName || "").slice(0, 80),
      filename: name,
      object_id: sceneShareObjectId({ projectId: pid, filename: name }),
      kind: XR_SCENE_SHARE_KIND,
      fit: XR_SCENE_SHARE_FIT,
    });
  };
  for (const entry of assemblyList || []) {
    const name = Array.isArray(entry) ? entry[0] : (entry?.name || entry?.filename || entry);
    push(name);
  }
  if (selectedFile) push(selectedFile);
  return out.slice(0, XR_SCENE_SHARE_MAX);
}

export function createSceneSharePublisher({
  isSharedSession = () => false,
  shouldPublish = shouldPublishSceneMeshes,
  createShareRecord,
  api = null,
  getProjectId = () => "",
  getProjectName = () => "",
  collectItems = () => [],
  spawn,
} = {}) {
  const pending = new Map();
  const shareCache = new Map();

  async function resolveShare(pid, filename) {
    const key = `${pid}:${filename}`;
    if (shareCache.has(key)) return shareCache.get(key);
    const record = await createShareRecord(pid, filename, null, { reuse: true });
    const token = String(record?.share_url || "").match(/\/share\/([^/?#]+)/i)?.[1] || "";
    let glbUrl = String(record?.viewer_url || "").trim();
    let meta = record;
    if (!glbUrl && token && api) {
      try { meta = await api(`/api/share/${encodeURIComponent(token)}`); } catch { /* keep record */ }
      glbUrl = String(meta?.viewer_url || "").trim();
    }
    if (!glbUrl) throw new Error("The shared model has no viewable 3D asset");
    const resolved = {
      share_url: record.share_url,
      glb_url: glbUrl,
      filename: meta?.viewer_filename || record?.viewer_filename || filename,
      share_mode: shareModeFromRecord(meta || record),
    };
    shareCache.set(key, resolved);
    return resolved;
  }

  return function publishSceneMeshes(opts = {}) {
    if (!shouldPublish(opts.publishState || {}) && !isSharedSession()) {
      return Promise.resolve({ ok: true, skipped: true });
    }
    const pid = String(opts.projectId || getProjectId?.() || "").trim();
    if (!pid) return Promise.resolve({ ok: false, error: "No project" });
    const items = (opts.items || collectItems() || []).filter((row) => {
      if (opts.filenames?.length) return opts.filenames.includes(row.filename);
      return true;
    });
    if (!items.length) return Promise.resolve({ ok: true, skipped: true, count: 0 });
    const key = items.map((row) => row.object_id || row.filename).join("|");
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const spawned = [];
      for (const item of items.slice(0, XR_SCENE_SHARE_MAX)) {
        const share = await resolveShare(pid, item.filename);
        const spec = {
          ...item,
          project_id: pid,
          project_name: item.project_name || getProjectName?.() || "",
          share_url: share.share_url,
          glb_url: share.glb_url,
          filename: item.filename,
          viewer_filename: share.filename,
          share_mode: share.share_mode,
          kind: XR_SCENE_SHARE_KIND,
          fit: XR_SCENE_SHARE_FIT,
          adoptLocal: true,
        };
        await spawn(spec);
        spawned.push(spec);
      }
      return { ok: true, count: spawned.length, items: spawned };
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}
