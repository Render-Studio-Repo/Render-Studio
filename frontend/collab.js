/** Real-time collaboration: presence, remote picks, live model updates. */

import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { buildFaceHighlightMesh } from "./picking.js";

export function createCollab({ getToken, getProjectId, getMeshOffset, scene }) {
  const remoteGroup = new THREE.Group();
  remoteGroup.name = "remote-picks";
  scene.add(remoteGroup);

  let ws = null;
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
    if (!key) return null;
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
    } else {
      const entry = previews.get(key);
      if (entry.target !== target) {
        restorePreviewEntry(entry);
        previews.set(key, {
          target,
          position: target.position.clone(),
          quaternion: target.quaternion.clone(),
          scale: target.scale.clone(),
        });
      }
    }
    target.position.set(ref.transform_position[0], ref.transform_position[1], ref.transform_position[2]);
    target.quaternion.set(ref.transform_quaternion[0], ref.transform_quaternion[1], ref.transform_quaternion[2], ref.transform_quaternion[3]);
    target.scale.set(ref.transform_scale[0], ref.transform_scale[1], ref.transform_scale[2]);
    target.updateMatrixWorld?.(true);
    meshRoot?.updateMatrixWorld?.(true);
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
    for (const [key, entry] of previews.entries()) {
      if (activeKeys.has(key)) continue;
      restorePreviewEntry(entry);
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
  }

  function renderRemotePicks(userId, displayName, color, picks, meshRoot, avatarUrl = "") {
    clearRemoteUser(userId);
    remoteUsers.set(userId, { id: userId, display_name: displayName, color, avatar_url: avatarUrl, picks: picks || [] });
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
    disconnect();
    if (!projectId || !getToken()) return;
    localUserId = user?.id;
    ws = new WebSocket(wsUrl(projectId));

    ws.onopen = () => {
      document.getElementById("collab-status")?.classList.add("live");
    };

    ws.onclose = () => {
      document.getElementById("collab-status")?.classList.remove("live");
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
        });
      } else if (msg.type === "presence.join") {
        handlers.onPresence?.();
      } else if (msg.type === "presence.leave") {
        remoteUsers.delete(msg.user_id);
        clearRemoteUser(msg.user_id);
        restoreRemoteTransforms(msg.user_id);
        updatePresenceLabel();
      } else if (msg.type === "pick.update") {
        renderRemotePicks(msg.user_id, msg.display_name, msg.color, msg.picks, meshRoot, msg.avatar_url);
      } else if (msg.type === "pick.clear") {
        remoteUsers.delete(msg.user_id);
        clearRemoteUser(msg.user_id);
        restoreRemoteTransforms(msg.user_id);
        updatePresenceLabel();
      } else if (msg.type === "model.reload") {
        handlers.onModelReload?.(msg);
      } else if (msg.type === "project.meta") {
        handlers.onProjectMeta?.(msg);
      } else if (msg.type === "timeline.updated" || msg.timeline_entry) {
        handlers.onTimeline?.(msg);
      } else if (msg.type === "project.history") {
        handlers.onProjectHistory?.(msg);
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

  function disconnect() {
    ws?.close();
    ws = null;
    restoreRemoteTransforms();
    remoteUsers.clear();
    remoteMarkers.forEach((_, uid) => clearRemoteUser(uid));
    updatePresenceLabel();
  }

  function sendPicks(picks) {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "pick.update", picks }));
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
    sendPicks,
    clearPicks,
    refreshAllRemote,
    setupLabels,
    resizeLabels,
    renderLabels,
    remoteGroup,
    getOnlineUserIds: () => [...remoteUsers.keys()],
  };
}
