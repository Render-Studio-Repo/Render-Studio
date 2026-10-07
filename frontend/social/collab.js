/** Real-time collaboration: presence, remote picks, live model updates. */

import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { buildFaceHighlightMesh } from "../viewport/picking.js?editctx=20260915-1&editscale=20260915-1";

export function createCollab({
  getToken,
  getProjectId,
  getMeshOffset,
  scene,
  isLocalTransformDragging = null,
  getLocalTransformCatalog = null,
}) {
  const remoteGroup = new THREE.Group();
  remoteGroup.name = "remote-picks";
  scene.add(remoteGroup);

  let ws = null;
  let reconnectTimer = 0;
  let activeProjectId = null;
  let activeUser = null;
  let activeHandlers = {};
  let localUserId = null;
  let labelRenderer = null;
  let viewportEl = null;
  const remoteMarkers = new Map();
  const remoteTransformPreviews = new Map();
  /** @type {Map<string, { id: string, display_name: string, color: string, avatar_url?: string, picks: object[] }>} */
  const remoteUsers = new Map();

  function wsUrl(projectId) {
    const token = encodeURIComponent(getToken());
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/api/ws/projects/${projectId}?token=${token}`;
  }

  function clearRemoteUser(userId) {
    const group = remoteMarkers.get(userId);
    if (!group) return;
    group.traverse((c) => {
      if (c.element?.parentNode) c.element.parentNode.removeChild(c.element);
      c.geometry?.dispose();
      c.material?.dispose();
      if (c.material?.map) c.material.map.dispose();
    });
    remoteGroup.remove(group);
    remoteMarkers.delete(userId);
  }

  function restorePreviewEntry(entry) {
    const target = entry?.target;
    if (!target) return;
    target.position.copy(entry.position);
    target.quaternion.copy(entry.quaternion);
    target.scale.copy(entry.scale);
    target.updateMatrixWorld?.(true);
  }

  function restoreRemoteTransforms(userId = null) {
    if (userId) {
      const previews = remoteTransformPreviews.get(userId);
      previews?.forEach(restorePreviewEntry);
      remoteTransformPreviews.delete(userId);
      return;
    }
    remoteTransformPreviews.forEach((previews) => previews.forEach(restorePreviewEntry));
    remoteTransformPreviews.clear();
  }

  function labelOffset(meshRoot) {
    if (!meshRoot) return 0.02;
    return Math.max(new THREE.Box3().setFromObject(meshRoot).getSize(new THREE.Vector3()).length() * 0.04, 0.012);
  }

  function createNameLabel(displayName, color, avatarUrl = "") {
    const div = document.createElement("div");
    div.className = "remote-pick-label";
    const safeName = String(displayName || "User");
    const safeText = safeName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeUrl = String(avatarUrl || "").replace(/'/g, "%27").replace(/"/g, "%22");
    const initial = safeName.trim().charAt(0).toUpperCase() || "?";
    div.innerHTML = avatarUrl
      ? `<span class="remote-pick-avatar remote-pick-avatar--image" style="background-image:url('${safeUrl}')"></span><span>${safeText}</span>`
      : `<span class="remote-pick-avatar">${initial}</span><span>${safeText}</span>`;
    div.style.borderColor = color || "#58a6ff";
    div.style.color = color || "#58a6ff";
    const label = new CSS2DObject(div);
    label.renderOrder = 1002;
    return label;
  }

  function attachNameLabel(group, worldPos, displayName, color, lift = 0, avatarUrl = "") {
    const label = createNameLabel(displayName, color, avatarUrl);
    label.position.copy(worldPos);
    label.position.y += lift;
    group.add(label);
    return label;
  }

  function meshWorldCenter(mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    return box.getCenter(new THREE.Vector3());
  }

  function resolvePickMesh(meshRoot, ref) {
    if (!meshRoot) return null;
    let match = null;
    let first = null;
    meshRoot.traverse((c) => {
      if (!c.isMesh || !c.geometry || c.userData.isEdge || c.userData.isSilhouette) return;
      if (!first) first = c;
      if (ref.mesh_uuid && c.uuid === ref.mesh_uuid) match = c;
    });
    return match || first;
  }

  function resolveObjectTarget(meshRoot, ref) {
    if (!meshRoot) return null;
    let match = null;
    if (ref.catalog_name) {
      meshRoot.traverse((c) => {
        if (!match && c.userData?.catalogFilename === ref.catalog_name) match = c;
      });
    }
    if (!match && ref.mesh_uuid) {
      meshRoot.traverse((c) => {
        if (!match && c.uuid === ref.mesh_uuid) match = c;
      });
    }
    return match || resolvePickMesh(meshRoot, ref);
  }

  function refTransformKey(ref, target) {
    return String(ref.catalog_name || ref.mesh_uuid || ref.id || target?.uuid || "");
  }

  function hasTransformPayload(ref) {
    return (
      Array.isArray(ref.transform_position) &&
      ref.transform_position.length === 3 &&
      Array.isArray(ref.transform_quaternion) &&
      ref.transform_quaternion.length === 4 &&
      Array.isArray(ref.transform_scale) &&
      ref.transform_scale.length === 3
    );
  }

  function applyRemoteObjectTransform(userId, meshRoot, ref, target) {
    if (!target || !hasTransformPayload(ref)) return null;
    const key = refTransformKey(ref, target);
    const localCatalog = String(getLocalTransformCatalog?.() || "");
    const remoteCatalog = String(ref.catalog_name || "");
    if (isLocalTransformDragging?.() && (!localCatalog || !remoteCatalog || localCatalog === remoteCatalog)) {
      return key;
    }
    let previews = remoteTransformPreviews.get(userId);
    if (!previews) {
      previews = new Map();
      remoteTransformPreviews.set(userId, previews);
    }
    if (!previews.has(key)) {
      previews.set(key, {
        target,
        position: target.position.clone(),
        quaternion: target.quaternion.clone(),
        scale: target.scale.clone(),
      });
    }
    target.position.fromArray(ref.transform_position);
    target.quaternion.fromArray(ref.transform_quaternion);
    target.scale.fromArray(ref.transform_scale);
    target.updateMatrixWorld?.(true);
    return key;
  }

  function pickWorldPosition(meshRoot, ref) {
    if (ref.local_point?.length === 3) {
      const local = new THREE.Vector3(ref.local_point[0], ref.local_point[1], ref.local_point[2]);
      return meshRoot ? meshRoot.localToWorld(local) : local;
    }
    if (ref.position?.length === 3) {
      const model = new THREE.Vector3(ref.position[0], ref.position[1], ref.position[2]);
      if (meshRoot) {
        const offset = getMeshOffset?.() || new THREE.Vector3();
        const local = model.clone().sub(offset);
        return meshRoot.localToWorld(local);
      }
      return model;
    }
    return null;
  }

  function modelToWorld(meshRoot, point) {
    const model = new THREE.Vector3(point[0], point[1], point[2]);
    if (!meshRoot) return model;
    const offset = getMeshOffset?.() || new THREE.Vector3();
    const local = model.clone().sub(offset);
    return meshRoot.localToWorld(local);
  }

  function localToWorld(meshRoot, point) {
    const local = new THREE.Vector3(point[0], point[1], point[2]);
    return meshRoot ? meshRoot.localToWorld(local) : local;
  }

  function renderRemoteLasso(group, meshRoot, ref, displayName, color, lift, avatarUrl) {
    if (!ref.loop_points?.length) return false;
    const useLocal = Array.isArray(ref.local_loop_points) && ref.local_loop_points.length > 0;
    const points = (useLocal ? ref.local_loop_points : ref.loop_points)
      .filter((p) => Array.isArray(p) && p.length === 3)
      .map((p) => (useLocal ? localToWorld(meshRoot, p) : modelToWorld(meshRoot, p)));
    if (points.length < 3) return false;
    points.push(points[0].clone());

    const meshSize = meshRoot
      ? Math.max(new THREE.Box3().setFromObject(meshRoot).getSize(new THREE.Vector3()).length(), 0.1)
      : 1;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({
        color: new THREE.Color(color || "#58a6ff"),
        dashSize: meshSize * 0.008,
        gapSize: meshSize * 0.004,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      })
    );
    line.computeLineDistances();
    line.renderOrder = 1001;
    group.add(line);
    const center = points.slice(0, -1).reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(points.length - 1);
    attachNameLabel(group, center, displayName, color, lift, avatarUrl);
    return true;
  }

  function remoteBoxFromRef(meshRoot, ref, target) {
    if (Array.isArray(ref.local_box_min) && Array.isArray(ref.local_box_max) && ref.local_box_min.length === 3 && ref.local_box_max.length === 3) {
      const min = localToWorld(meshRoot, ref.local_box_min);
      const max = localToWorld(meshRoot, ref.local_box_max);
      return new THREE.Box3().setFromPoints([min, max]);
    }
    // Prefer the collaborator's reported center when they are actively moving —
    // do not fall back to mutating / reading our unmoved mesh pose.
    if (Array.isArray(ref.local_point) && ref.local_point.length === 3) {
      const center = localToWorld(meshRoot, ref.local_point);
      const size = target
        ? new THREE.Box3().setFromObject(target).getSize(new THREE.Vector3())
        : new THREE.Vector3(0.05, 0.05, 0.05);
      return new THREE.Box3().setFromCenterAndSize(center, size);
    }
    return target ? new THREE.Box3().setFromObject(target) : null;
  }

  function renderRemoteObject(group, meshRoot, ref, displayName, color, lift, avatarUrl, userId) {
    const target = resolveObjectTarget(meshRoot, ref);
    const transformKey = applyRemoteObjectTransform(userId, meshRoot, ref, target);
    const box = remoteBoxFromRef(meshRoot, ref, target);
    if (!box || box.isEmpty()) return false;
    const helper = new THREE.Box3Helper(box, new THREE.Color(color || "#58a6ff"));
    helper.renderOrder = 1001;
    helper.material.depthTest = false;
    helper.material.transparent = true;
    helper.material.opacity = ref.moving ? 0.98 : 0.78;
    group.add(helper);
    const center = box.getCenter(new THREE.Vector3());
    const top = center.clone();
    top.y = box.max.y;
    attachNameLabel(
      group,
      top,
      ref.moving ? `${displayName || "User"} moving ${ref.label || "object"}` : `${displayName || "User"} selected ${ref.label || "object"}`,
      color,
      lift,
      avatarUrl
    );
    return transformKey || true;
  }

  function reconcileRemoteTransformPreviews(userId, activeKeys) {
    const previews = remoteTransformPreviews.get(userId);
    if (!previews) return;
    for (const [key] of previews.entries()) {
      if (activeKeys.has(key)) continue;
      // Keep the last live pose; model.reload will replace the mesh.
      previews.delete(key);
    }
    if (!previews.size) remoteTransformPreviews.delete(userId);
  }

  function updatePresenceLabel() {
    const label = document.getElementById("collab-presence");
    if (!label) return;
    const parts = [];
    remoteUsers.forEach((u) => {
      const n = u.picks?.length || 0;
      if (n) parts.push(`${u.display_name} (${n} pick${n > 1 ? "s" : ""})`);
    });
    const online = remoteUsers.size;
    if (parts.length) {
      label.textContent = parts.join(" · ");
    } else if (online) {
      label.textContent = `${online} collaborator${online > 1 ? "s" : ""} online`;
    } else {
      label.textContent = "";
    }
    try {
      window.dispatchEvent(new CustomEvent("render3d:presence-changed"));
    } catch (_) {}
  }

  function renderRemotePicks(userId, displayName, color, picks, meshRoot, avatarUrl = "") {
    const prev = remoteUsers.get(userId);
    clearRemoteUser(userId);
    remoteUsers.set(userId, {
      id: userId,
      display_name: displayName,
      color,
      avatar_url: avatarUrl,
      picks: picks || [],
      xrPose: prev?.xrPose || null,
    });
    if (!picks?.length) {
      restoreRemoteTransforms(userId);
      updatePresenceLabel();
      return;
    }

    const g = new THREE.Group();
    g.name = `remote-${userId}`;
    const threeColor = new THREE.Color(color || "#58a6ff");

    const lift = labelOffset(meshRoot);
    const activeTransformKeys = new Set();

    for (const ref of picks) {
      if (!["face", "edge", "corner", "lasso", "object"].includes(ref.type)) continue;
      const meshObj = resolvePickMesh(meshRoot, ref);
      if (ref.type === "lasso" && renderRemoteLasso(g, meshRoot, ref, displayName, color, lift, avatarUrl)) {
        continue;
      }
      if (ref.type === "object") {
        const rendered = renderRemoteObject(g, meshRoot, ref, displayName, color, lift, avatarUrl, userId);
        if (typeof rendered === "string") activeTransformKeys.add(rendered);
        if (rendered) {
          continue;
        }
      }
      if (ref.type === "face" && ref.face_indices?.length && meshObj) {
        const highlight = buildFaceHighlightMesh(meshObj, ref.face_indices, threeColor, 0.42);
        if (highlight) {
          highlight.renderOrder = 1001;
          g.add(highlight);
          attachNameLabel(g, meshWorldCenter(highlight), displayName, color, lift, avatarUrl);
        }
        continue;
      }

      const world = pickWorldPosition(meshRoot, ref);
      if (!world) continue;
      const scale = meshRoot
        ? Math.max(new THREE.Box3().setFromObject(meshRoot).getSize(new THREE.Vector3()).length() * 0.012, 0.004)
        : 0.008;
      const s = scale;
      const geo =
        ref.type === "corner"
          ? new THREE.BoxGeometry(s * 1.4, s * 1.4, s * 1.4)
          : new THREE.SphereGeometry(s, 12, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: threeColor,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 1001;
      m.position.copy(world);
      g.add(m);
      attachNameLabel(g, world, displayName, color, lift, avatarUrl);
    }

    remoteGroup.add(g);
    remoteMarkers.set(userId, g);
    reconcileRemoteTransformPreviews(userId, activeTransformKeys);
    updatePresenceLabel();
  }

  function refreshAllRemote(meshRoot) {
    remoteUsers.forEach((u) => {
      renderRemotePicks(u.id, u.display_name, u.color, u.picks, meshRoot, u.avatar_url);
    });
  }

  function connect(projectId, user, handlers = {}) {
    disconnect({ fromReconnect: true });
    if (!projectId || !getToken()) return;
    activeProjectId = projectId;
    activeUser = user;
    activeHandlers = handlers || {};
    localUserId = user?.id;
    const socket = new WebSocket(wsUrl(projectId));
    ws = socket;

    ws.onopen = () => {
      document.getElementById("collab-status")?.classList.add("live");
    };

    ws.onclose = () => {
      document.getElementById("collab-status")?.classList.remove("live");
      if (ws !== socket) return;
      ws = null;
      if (!activeProjectId || !getToken()) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = 0;
        if (activeProjectId && getToken()) connect(activeProjectId, activeUser, activeHandlers);
      }, 2000);
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      const meshRoot = handlers.getMeshRoot?.();

      if (msg.type === "presence.sync") {
        restoreRemoteTransforms();
        remoteUsers.clear();
        msg.users?.forEach((u) => {
          renderRemotePicks(u.id, u.display_name, u.color, u.picks, meshRoot, u.avatar_url);
          if (u.xrPose) {
            const row = remoteUsers.get(u.id);
            if (row) {
              row.xrPose = u.xrPose;
              row.xr_device = u.xr_device || u.xrPose?.xr_device || row.xr_device;
              row.xr_mode = u.xr_mode || u.xrPose?.xr_mode || row.xr_mode;
              row.xr_prop = u.xr_prop || u.xrPose?.xr_prop || row.xr_prop;
            }
            handlers.onXrPose?.({
              type: "xr.pose",
              user_id: u.id,
              display_name: u.display_name,
              color: u.color,
              avatar_url: u.avatar_url,
              xr_device: u.xr_device || u.xrPose?.xr_device,
              xr_mode: u.xr_mode || u.xrPose?.xr_mode,
              xr_prop: u.xr_prop || u.xrPose?.xr_prop,
              pose: u.xrPose,
            });
          }
        });
        handlers.onPresence?.({ type: "presence.sync", users: msg.users || [] });
      } else if (msg.type === "presence.join") {
        if (msg.user?.id) {
          remoteUsers.set(msg.user.id, {
            id: msg.user.id,
            display_name: msg.user.display_name,
            color: msg.user.color,
            avatar_url: msg.user.avatar_url,
            picks: [],
          });
        }
        handlers.onPresence?.(msg);
      } else if (msg.type === "presence.leave") {
        remoteUsers.delete(msg.user_id);
        clearRemoteUser(msg.user_id);
        restoreRemoteTransforms(msg.user_id);
        updatePresenceLabel();
        handlers.onPresence?.(msg);
      } else if (msg.type === "xr.pose") {
        const existing = remoteUsers.get(msg.user_id) || {
          id: msg.user_id,
          display_name: msg.display_name,
          color: msg.color,
          avatar_url: msg.avatar_url,
          picks: [],
        };
        existing.xrPose = msg.pose || null;
        existing.display_name = msg.display_name || existing.display_name;
        existing.color = msg.color || existing.color;
        existing.xr_device = msg.xr_device || msg.pose?.xr_device || existing.xr_device;
        existing.xr_mode = msg.xr_mode || msg.pose?.xr_mode || existing.xr_mode;
        existing.xr_prop = msg.xr_prop || msg.pose?.xr_prop || existing.xr_prop;
        remoteUsers.set(msg.user_id, existing);
        handlers.onXrPose?.(msg);
      } else if (msg.type === "rtc.signal") {
        handlers.onRtcSignal?.(msg);
      } else if (msg.type === "xr.fit") {
        handlers.onXrFit?.(msg);
      } else if (msg.type === "xr.stroke") {
        handlers.onXrStroke?.(msg);
      } else if (msg.type === "xr.draw") {
        handlers.onXrDraw?.(msg);
      } else if (msg.type === "xr.file") {
        handlers.onXrFile?.(msg);
      } else if (msg.type === "xr.prompt.bridge") {
        handlers.onXrPromptBridge?.(msg);
      } else if (
        msg.type === "xr.video"
        || msg.type === "xr.board"
        || msg.type === "xr.table"
        || msg.type === "xr.seat"
        || msg.type === "xr.drop"
        || msg.type === "xr.object"
        || msg.type === "xr.printer"
        || msg.type === "xr.objects.sync"
      ) {
        handlers.onXrPublicObject?.(msg);
      } else if (msg.type === "pick.update") {
        renderRemotePicks(msg.user_id, msg.display_name, msg.color, msg.picks, meshRoot, msg.avatar_url);
      } else if (msg.type === "pick.clear") {
        remoteUsers.delete(msg.user_id);
        clearRemoteUser(msg.user_id);
        restoreRemoteTransforms(msg.user_id);
        updatePresenceLabel();
      } else if (msg.type === "model.reload") {
        remoteTransformPreviews.clear();
        handlers.onModelReload?.(msg);
      } else if (msg.type === "project.meta") {
        handlers.onProjectMeta?.(msg);
      } else if (msg.type === "timeline.updated" || msg.timeline_entry) {
        handlers.onTimeline?.(msg);
      } else if (msg.type === "project.history") {
        handlers.onProjectHistory?.(msg);
      } else if (msg.type === "video.editor") {
        handlers.onVideoEditor?.(msg);
      } else if (typeof msg.type === "string" && msg.type.startsWith("canvas.")) {
        handlers.onCanvas?.(msg);
      } else if (
        msg.type === "workspace.updated"
        || msg.type === "folder.shared"
        || msg.type === "folder.unshared"
        || msg.type === "folder.renamed"
        || msg.type === "folder.created"
        || msg.type === "folder.deleted"
      ) {
        handlers.onWorkspaceUpdated?.(msg);
      } else if (
        msg.type === "project.created" ||
        msg.type === "project.renamed" ||
        msg.type === "project.deleted" ||
        msg.type === "workspace.invite.updated" ||
        msg.type === "workspace.member.updated"
      ) {
        handlers.onWorkspaceUpdated?.(msg);
      }
    };
  }

  function disconnect({ fromReconnect = false } = {}) {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = 0;
    }
    if (!fromReconnect) {
      activeProjectId = null;
      activeUser = null;
      activeHandlers = {};
    }
    const socket = ws;
    ws = null;
    try { socket?.close(); } catch { /* ignore */ }
    restoreRemoteTransforms();
    remoteUsers.clear();
    remoteMarkers.forEach((_, uid) => clearRemoteUser(uid));
    updatePresenceLabel();
  }

  function sendPicks(picks) {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "pick.update", picks }));
  }

  function send(payload) {
    if (ws?.readyState !== WebSocket.OPEN || !payload) return;
    ws.send(JSON.stringify(payload));
  }

  function sendXrPose(pose) {
    send({ type: "xr.pose", pose });
  }

  function sendRtcSignal(payload) {
    send({ type: "rtc.signal", ...payload });
  }

  function clearPicks() {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "pick.clear" }));
  }

  function setupLabels(viewport) {
    viewportEl = viewport;
    if (labelRenderer?.domElement?.parentNode) {
      labelRenderer.domElement.parentNode.removeChild(labelRenderer.domElement);
    }
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(viewport.clientWidth, viewport.clientHeight);
    labelRenderer.domElement.className = "remote-pick-labels-layer";
    labelRenderer.domElement.style.pointerEvents = "none";
    viewport.appendChild(labelRenderer.domElement);
  }

  function resizeLabels() {
    if (!labelRenderer || !viewportEl) return;
    labelRenderer.setSize(viewportEl.clientWidth, viewportEl.clientHeight);
  }

  function renderLabels(camera) {
    if (labelRenderer && viewportEl) {
      labelRenderer.render(scene, camera);
    }
  }

  return {
    connect,
    disconnect,
    send,
    sendPicks,
    sendXrPose,
    sendRtcSignal,
    clearPicks,
    refreshAllRemote,
    setupLabels,
    resizeLabels,
    renderLabels,
    remoteGroup,
    isConnected: () => !!(ws && ws.readyState === WebSocket.OPEN),
    getOnlineUserIds: () => [...remoteUsers.keys()],
    getRemoteUsers: () => [...remoteUsers.values()].map((u) => ({
      id: u.id,
      display_name: u.display_name,
      color: u.color,
      avatar_url: u.avatar_url || null,
      pickCount: Array.isArray(u.picks) ? u.picks.length : 0,
      xrPose: u.xrPose || null,
      inXr: !!u.xrPose,
      xr_device: u.xr_device || u.xrPose?.xr_device || null,
      xr_mode: u.xr_mode || u.xrPose?.xr_mode || null,
      xr_prop: u.xr_prop || u.xrPose?.xr_prop || null,
    })),
  };
}
