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
  /** @type {Map<string, { id: string, display_name: string, color: string, picks: object[] }>} */
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

  function labelOffset(meshRoot) {
    if (!meshRoot) return 0.02;
    return Math.max(new THREE.Box3().setFromObject(meshRoot).getSize(new THREE.Vector3()).length() * 0.04, 0.012);
  }

  function createNameLabel(displayName, color) {
    const div = document.createElement("div");
    div.className = "remote-pick-label";
    div.textContent = displayName;
    div.style.borderColor = color || "#58a6ff";
    div.style.color = color || "#58a6ff";
    const label = new CSS2DObject(div);
    label.renderOrder = 1002;
    return label;
  }

  function attachNameLabel(group, worldPos, displayName, color, lift = 0) {
    const label = createNameLabel(displayName, color);
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

  function renderRemoteLasso(group, meshRoot, ref, displayName, color, lift) {
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
    attachNameLabel(group, center, displayName, color, lift);
    return true;
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

  function renderRemotePicks(userId, displayName, color, picks, meshRoot) {
    clearRemoteUser(userId);
    remoteUsers.set(userId, { id: userId, display_name: displayName, color, picks: picks || [] });
    if (!picks?.length) {
      updatePresenceLabel();
      return;
    }

    const g = new THREE.Group();
    g.name = `remote-${userId}`;
    const threeColor = new THREE.Color(color || "#58a6ff");

    const lift = labelOffset(meshRoot);

    for (const ref of picks) {
      if (!["face", "edge", "corner", "lasso", "object"].includes(ref.type)) continue;
      const meshObj = resolvePickMesh(meshRoot, ref);
      if (ref.type === "lasso" && renderRemoteLasso(g, meshRoot, ref, displayName, color, lift)) {
        continue;
      }
      if (ref.type === "face" && ref.face_indices?.length && meshObj) {
        const highlight = buildFaceHighlightMesh(meshObj, ref.face_indices, threeColor, 0.42);
        if (highlight) {
          highlight.renderOrder = 1001;
          g.add(highlight);
          attachNameLabel(g, meshWorldCenter(highlight), displayName, color, lift);
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
      attachNameLabel(g, world, displayName, color, lift);
    }

    remoteGroup.add(g);
    remoteMarkers.set(userId, g);
    updatePresenceLabel();
  }

  function refreshAllRemote(meshRoot) {
    remoteUsers.forEach((u) => {
      renderRemotePicks(u.id, u.display_name, u.color, u.picks, meshRoot);
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
        remoteUsers.clear();
        msg.users?.forEach((u) => {
          renderRemotePicks(u.id, u.display_name, u.color, u.picks, meshRoot);
        });
      } else if (msg.type === "presence.join") {
        handlers.onPresence?.();
      } else if (msg.type === "presence.leave") {
        remoteUsers.delete(msg.user_id);
        clearRemoteUser(msg.user_id);
        updatePresenceLabel();
      } else if (msg.type === "pick.update") {
        renderRemotePicks(msg.user_id, msg.display_name, msg.color, msg.picks, meshRoot);
      } else if (msg.type === "pick.clear") {
        remoteUsers.delete(msg.user_id);
        clearRemoteUser(msg.user_id);
        updatePresenceLabel();
      } else if (msg.type === "model.reload") {
        if (msg.by_user_id && msg.by_user_id === localUserId) return;
        handlers.onModelReload?.(msg);
      } else if (msg.type === "project.meta") {
        handlers.onProjectMeta?.(msg);
      } else if (msg.type === "timeline.updated" || msg.timeline_entry) {
        handlers.onTimeline?.(msg);
      } else if (msg.type === "project.history") {
        handlers.onProjectHistory?.(msg);
      } else if (msg.type === "workspace.updated") {
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
  };
}
