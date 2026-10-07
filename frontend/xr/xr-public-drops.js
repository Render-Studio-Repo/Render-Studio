/** Shared public-room project drops — GLB instances both headsets can grab. */

// Room membership bounds the lifetime; never silently evict a visible model.
export const XR_PUBLIC_DROP_MAX = Infinity;
export const HANDHELD_DROP_M = 0.12;

const XR_TEXTURE_MAP_KEYS = [
  "map", "lightMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap",
  "bumpMap", "displacementMap", "alphaMap", "envMap", "specularMap", "clearcoatMap",
  "clearcoatNormalMap", "clearcoatRoughnessMap", "sheenColorMap",
  "specularColorMap", "specularIntensityMap", "transmissionMap", "thicknessMap",
];
const XR_CAD_COLORS = [0xc4c9d4, 0xb8bec9, 0x9aa3b2, 0xd0d4dc];

export function isTextureAssetUrl(url) {
  return /\.(png|jpe?g|webp|gif|ktx2|basis|bmp)(\?|#|$)/i.test(String(url || ""));
}

/** Headset-only: CAD plastic, no albedo/normal/roughness maps. */
export function applyXrCadColoring(root, THREE) {
  if (!root || !THREE) return root;
  let i = 0;
  root.traverse((o) => {
    if (!o?.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      for (const key of XR_TEXTURE_MAP_KEYS) {
        if (!m[key]) continue;
        try { m[key].dispose?.(); } catch { /* ignore */ }
        m[key] = null;
      }
    }
    const keep = mats[0]?.color?.clone?.() || new THREE.Color(XR_CAD_COLORS[i++ % XR_CAD_COLORS.length]);
    const next = new THREE.MeshStandardMaterial({
      color: keep,
      metalness: 0.08,
      roughness: 0.62,
      envMapIntensity: 0.22,
    });
    o.material = Array.isArray(o.material) ? mats.map(() => next.clone()) : next;
  });
  return root;
}

/** Do not register on the controller GLTF loader — only the public-drop loader. */
export function attachGltfTextureSkip(loader) {
  if (!loader || loader.userData?.xrSkipTextures) return loader;
  loader.userData = { ...(loader.userData || {}), xrSkipTextures: true };
  try {
    loader.register(() => ({
      name: "render3dXrSkipTextures",
      loadTexture() {
        return Promise.resolve(null);
      },
    }));
  } catch { /* older three */ }
  return loader;
}

export function shareTokenFromUrl(url) {
  const m = String(url || "").match(/\/share\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : "";
}

export function glbUrlFromShareMeta(meta, token = "") {
  const direct = String(meta?.viewer_url || "").trim();
  if (direct) return direct;
  const tok = token || shareTokenFromUrl(meta?.share_url) || String(meta?.token || "");
  const name = String(meta?.viewer_filename || meta?.filename || "").trim();
  if (!tok || !name) return "";
  return `/api/share/${encodeURIComponent(tok)}/files/${encodeURIComponent(name)}`;
}

export function newDropObjectId() {
  try {
    if (globalThis.crypto?.randomUUID) return `drop-${crypto.randomUUID()}`;
  } catch { /* fall through */ }
  return `drop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function packObjectPose(obj, THREE) {
  if (!obj) return null;
  try {
    obj.updateMatrixWorld?.(true);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    obj.matrixWorld.decompose(p, q, s);
    if (!Number.isFinite(p.x)) return null;
    const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
    return {
      p: [r3(p.x), r3(p.y), r3(p.z)],
      q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)],
      s: [r3(s.x), r3(s.y), r3(s.z)],
    };
  } catch {
    return null;
  }
}

export function applyObjectPose(obj, pose, THREE, lerp = 1) {
  if (!obj || !pose) return;
  const p = pose.p || pose.position;
  const q = pose.q || pose.quaternion;
  const s = pose.s || pose.scale;
  if (!Array.isArray(p) || p.length !== 3) return;
  if (obj.parent && obj.userData?.xrDropAdopted) {
    obj.parent.updateWorldMatrix(true, false);
    const world = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(p),
      new THREE.Quaternion().fromArray(q || [0,0,0,1]), new THREE.Vector3().fromArray(s || [1,1,1]));
    new THREE.Matrix4().copy(obj.parent.matrixWorld).invert().multiply(world).decompose(obj.position,obj.quaternion,obj.scale);
    obj.updateMatrixWorld(true); return;
  }
  const pos = new THREE.Vector3(Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0);
  if (lerp >= 1) obj.position.copy(pos);
  else obj.position.lerp(pos, lerp);
  if (Array.isArray(q) && q.length === 4) {
    const quat = new THREE.Quaternion(
      Number(q[0]) || 0,
      Number(q[1]) || 0,
      Number(q[2]) || 0,
      Number.isFinite(Number(q[3])) ? Number(q[3]) : 1,
    );
    if (lerp >= 1) obj.quaternion.copy(quat);
    else obj.quaternion.slerp(quat, lerp);
  }
  if (Array.isArray(s) && s.length >= 3) {
    const scl = new THREE.Vector3(
      Number(s[0]) || 1,
      Number(s[1]) || 1,
      Number(s[2]) || 1,
    );
    if (lerp >= 1) obj.scale.copy(scl);
    else obj.scale.lerp(scl, lerp);
  }
}

function fitHandheld(root, THREE, targetM = HANDHELD_DROP_M) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z, 1e-4);
  root.scale.multiplyScalar(Math.min(targetM / max, 8));
  root.updateMatrixWorld(true);
  // CAD origins can be far from the visible geometry. The shared pose is its center.
  const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  root.position.sub(center);
  root.updateMatrixWorld(true);
}

export function createXrPublicDrops({ THREE, scene, loader = null, onStatus = null, getUserId = () => '', onGrabLost = null } = {}) {
  const group = new THREE.Group();
  group.name = "xr-public-drops";
  group.visible = false;
  scene?.add(group);

  /** @type {Map<string, { id: string, root: object, spec: object, glbUrl: string, loading: boolean }>} */
  const items = new Map();
  const _hit = new THREE.Vector3();
  let localGrabId = "";

  function setLocalGrabId(id) {
    if (id && !canGrab(id)) return false;
    localGrabId = String(id || "");
    return true;
  }

  function canGrab(id) {
    const row = items.get(String(id || ''));
    if (row?.loading) return false;
    return !row?.spec.grabbing || row.spec.grabber_id === getUserId() || Date.now() - (row.lastGrabAt || 0) > 2000;
  }

  function placeholder(colorHex = 0x58a6ff) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    );
    mesh.name = "xr-drop-placeholder";
    mesh.userData.xrDrop = true;
    return mesh;
  }

  function disposeNode(node) {
    node?.traverse?.((o) => {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach((m) => m?.dispose?.());
      else o.material?.dispose?.();
      o.material?.map?.dispose?.();
    });
  }

  function clearRoot(root) {
    while (root.children.length) {
      const child = root.children[0];
      root.remove(child);
      disposeNode(child);
    }
  }

  function stampDrop(node, id) {
    node.userData.xrDropId = id;
    node.userData.xrDrop = true;
    node.traverse?.((o) => {
      o.userData.xrDropId = id;
      o.userData.xrDrop = true;
    });
  }

  function loadGlb(row, url) {
    if (!loader?.load || !url) return;
    row.loading = true;
    row.ready = new Promise(resolve => { row.resolveReady = resolve; });
    try { onStatus?.("ok", "Loading shared project…"); } catch { /* ignore */ }
    loader.load(
      url,
      (gltf) => {
        if (items.get(row.id) !== row) { disposeNode(gltf?.scene); row.resolveReady?.(false); return; }
        row.loading = false;
        const src = gltf?.scene || gltf?.scenes?.[0];
        if (!src) { row.resolveReady?.(false); return; }
        clearRoot(row.root);
        src.position.set(0, 0, 0);
        src.quaternion.identity();
        src.scale.set(1, 1, 1);
        applyXrCadColoring(src, THREE);
        if (row.spec?.fit !== "world" && row.spec?.kind !== "scene") {
          fitHandheld(src, THREE);
        }
        stampDrop(src, row.id);
        row.root.add(src);
        if (row.spec?.pose && row.id !== localGrabId) applyObjectPose(row.root, row.spec.pose, THREE, 1);
        stampDrop(row.root, row.id);
        row.resolveReady?.(true);
      },
      undefined,
      (err) => {
        row.loading = false;
        row.error = err?.message || 'Could not load shared model';
        row.resolveReady?.(false);
        try { onStatus?.("error", err?.message || "Could not load dropped project"); } catch { /* ignore */ }
        if (!row.root.children.length) {
          row.root.add(placeholder());
          stampDrop(row.root, row.id);
        }
      },
    );
  }

  function upsert(spec) {
    const id = String(spec?.object_id || "").slice(0, 80);
    if (!id) return null;
    let row = items.get(id);
    if (!row) {
      const root = new THREE.Group();
      root.name = `xr-drop-${id}`;
      stampDrop(root, id);
      group.add(root);
      row = { id, root, spec: {}, glbUrl: "", loading: false };
      items.set(id, row);
    }
    row.spec = { ...row.spec, ...spec, object_id: id };
    if (spec.pose && id !== localGrabId) applyObjectPose(row.root, spec.pose, THREE, spec.lerp ?? 1);
    const url = String(spec.glb_url || spec.viewer_url || "").trim();
    if (row.adopted) { row.glbUrl = url || row.glbUrl; return row; }
    if (url && url !== row.glbUrl) {
      row.glbUrl = url;
      if (!row.root.children.length) {
        row.root.add(placeholder());
        stampDrop(row.root, id);
      }
      loadGlb(row, url);
    } else if (!row.root.children.length) {
      row.root.add(placeholder());
      stampDrop(row.root, id);
    }
    return row;
  }

  function applyObject(msg) {
    const id = String(msg?.object_id || "").slice(0, 80);
    if (!id) return;
    if (id === localGrabId && msg.user_id && msg.user_id !== getUserId()) {
      if (!msg.grabbing || String(getUserId()) < String(msg.user_id)) return;
      // Simultaneous claims converge on the same user rather than fighting every frame.
      localGrabId = '';
      onGrabLost?.(id);
    }
    const row = items.get(id) || upsert({ object_id: id, pose: msg.pose });
    if (!row) return;
    row.spec = {
      ...row.spec,
      grabbing: !!msg.grabbing,
      grabber_id: msg.grabbing ? msg.user_id : "",
    };
    row.lastGrabAt = Date.now();
    if (msg.pose && id !== localGrabId) {
      row.spec.pose = msg.pose;
      // A release is the final packet: partial lerp would leave the two copies apart.
      applyObjectPose(row.root, msg.pose, THREE, 1);
    }
  }

  function unstamp(node) {
    if (!node) return;
    delete node.userData.xrDropAdopted;
    delete node.userData.xrDropId;
    delete node.userData.xrDrop;
    node.traverse?.((o) => {
      if (!o?.userData) return;
      delete o.userData.xrDropId;
      delete o.userData.xrDrop;
    });
  }

  function adopt(id, root, spec = {}) {
    const oid = String(id || spec.object_id || "").slice(0, 80);
    if (!oid || !root) return null;
    const prev = items.get(oid);
    if (prev && prev.root !== root && !prev.adopted) remove(oid);
    stampDrop(root, oid);
    root.userData.xrDropAdopted = true;
    const row = {
      id: oid,
      root,
      spec: { ...(prev?.spec || {}), ...spec, object_id: oid },
      glbUrl: String(spec.glb_url || spec.viewer_url || prev?.glbUrl || "").trim(),
      loading: false,
      adopted: true,
    };
    items.set(oid, row);
    if (spec.pose) applyObjectPose(root, spec.pose, THREE, spec.lerp ?? 1);
    return row;
  }

  function remove(id) {
    const row = items.get(String(id || ""));
    if (!row) return;
    if (row.adopted) {
      unstamp(row.root);
      items.delete(row.id);
      row.resolveReady?.(false);
      return;
    }
    group.remove(row.root);
    disposeNode(row.root);
    items.delete(row.id);
    row.resolveReady?.(false);
  }

  function syncList(list = [], { merge = false } = {}) {
    const keep = new Set();
    for (const spec of list || []) {
      const id = String(spec?.object_id || "");
      if (!id) continue;
      keep.add(id);
      upsert({ ...spec, lerp: 1 });
    }
    for (const id of [...items.keys()]) {
      if (!merge && !keep.has(id)) remove(id);
    }
  }

  function pick(raycaster) {
    const roots = [...items.values()].map((r) => r.root);
    if (!roots.length || !raycaster) return null;
    const hits = raycaster.intersectObjects(roots, true).filter((h) => h.object?.isMesh);
    const hit = hits[0];
    if (!hit) return null;
    const id = hit.object?.userData?.xrDropId;
    const row = items.get(id);
    if (!row) return null;
    return {
      kind: "drop",
      objectId: id,
      root: row.root,
      point: hit.point.clone(),
      distance: hit.distance,
    };
  }

  function nearest(worldPoint, maxDist = 0.38) {
    if (!worldPoint) return null;
    let best = null;
    for (const row of items.values()) {
      try {
        row.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(row.root);
        if (box.isEmpty()) continue;
        const closest = box.clampPoint(worldPoint, _hit);
        const d = worldPoint.distanceTo(closest);
        if (d > maxDist) continue;
        if (!best || d < best.distance) best = { kind: "drop", objectId: row.id, root: row.root, distance: d };
      } catch { /* ignore */ }
    }
    return best;
  }

  function get(id) {
    return items.get(String(id || "")) || null;
  }

  function latest() {
    let last = null;
    for (const row of items.values()) last = row;
    return last;
  }

  function clear() {
    for (const id of [...items.keys()]) remove(id);
  }

  function setVisible(on) {
    group.visible = !!on;
  }

  return {
    group,
    items,
    upsert,
    adopt,
    applyObject,
    remove,
    syncList,
    pick,
    nearest,
    get,
    latest,
    clear,
    setVisible,
    setLocalGrabId,
    canGrab,
    packPose: (obj) => packObjectPose(obj, THREE),
  };
}
