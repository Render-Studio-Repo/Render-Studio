import { attachQuestController } from './xr-quest-controllers.js?v=roomshare2';
/** Live XR teammate avatars from collab `xr.pose` (humanoid + device prop + controllers + held CAD). */

import {
  ingestPosePart,
  makePoseTrack,
  nametagAnchorFromHead,
  nametagHitSize,
  nametagPickFromHits,
  samplePoseTrack,
  shouldTickAvatarBlink,
  shouldLoadXrAvatarMeshes,
  shouldCloneCadGhostForAvatars,
  shouldFaceNametag,
} from "./xr-hot-path.js?v=roboticsworkspace3-presence1&xrtalk=20260916-1&astra=20260916-5";
import {
  avatarSpecKey,
  buildProceduralHumanoid,
  deviceLabelFromUser,
  devicePropFromUser,
  paintHumanoid,
  parseAvatarFromPose,
  poseHumanoidToHead,
  setAvatarDeviceProp,
  tickAvatarBlink,
} from "./xr-avatar.js?v=avatar1-golden1";

export { nametagAnchorFromHead };

export function createXrPresence({ THREE, scene, enterSettled = null, avatarFxEnabled = null } = {}) {
  const group = new THREE.Group();
  group.name = "xr-social-presence";
  scene.add(group);

  /** @type {Map<string, { root: object, head: object, left: object, right: object, name: object, held: object, badge: object, silhouette: object, color: number }>} */
  const avatars = new Map();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scl = new THREE.Vector3();
  const _viewer = new THREE.Vector3();
  const _sampleP = [0, 0, 0];
  const _sampleQ = [0, 0, 0, 1];
  let ghostSource = null;
  let ghostRev = 0;
  let lastBlinkAt = 0;
  const simpleGeometries = new Map();
  const _bodyEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  function simpleGeometry(kind) {
    if (!simpleGeometries.has(kind)) {
      const geometry = kind === 'head' ? new THREE.SphereGeometry(0.105, 8, 6) : new THREE.BoxGeometry(1, 1, 1);
      geometry.userData.xrShared = true;
      simpleGeometries.set(kind, geometry);
    }
    return simpleGeometries.get(kind);
  }

  function simpleMesh(kind, color, scale = null) {
    const mesh = new THREE.Mesh(simpleGeometry(kind), new THREE.MeshBasicMaterial({ color }));
    if (scale) mesh.scale.set(...scale);
    return mesh;
  }

  function placeBody(row) {
    if (!row.body || !row.head) return;
    if (!row.body.userData.xrSimpleAvatar) return poseHumanoidToHead(row.body, row.head);
    row.body.position.copy(row.head.position);
    row.body.position.y -= 0.36;
    _bodyEuler.setFromQuaternion(row.head.quaternion, 'YXZ');
    row.body.rotation.set(0, _bodyEuler.y, 0);
    row.body.visible = row.head.visible;
  }

  function setViewer(pos) {
    if (!pos) return;
    _viewer.copy(pos);
  }

  function placeNametag(row) {
    if (!row?.name || !row.head) return;
    const hp = row.head.position;
    const [x, y, z] = nametagAnchorFromHead([hp.x, hp.y, hp.z], [_viewer.x, _viewer.y, _viewer.z]);
    row.name.position.set(x, y, z);
    try { row.name.lookAt(_viewer); } catch { /* ignore */ }
    if (row.hit) {
      row.hit.position.copy(row.name.position);
      row.hit.quaternion.copy(row.name.quaternion);
      row.hit.visible = true;
    }
  }

  function faceTags(row) {
    placeNametag(row);
  }

  function disableAvatarCollision(obj) {
    obj?.traverse?.((o) => {
      if (!o) return;
      if (o.userData?.xrNametag || o.userData?.xrUserId) return;
      o.raycast = () => {};
      o.userData.xrRaycast = false;
      o.userData.xrNoCollision = true;
    });
  }

  function applyAvatarMesh(row, spec, user = null) {
    if (!shouldLoadXrAvatarMeshes()) return;
    const next = parseAvatarFromPose(spec);
    const key = avatarSpecKey(next);
    const fxOn = typeof avatarFxEnabled === "function" ? avatarFxEnabled() === true : avatarFxEnabled === true;
    const settled = typeof enterSettled === "function" ? enterSettled() !== false : true;
    const prop = devicePropFromUser(user || spec || {});
    if (!row.body) {
      row.body = buildProceduralHumanoid(THREE, next, { prop: fxOn && settled ? prop : "none" });
      row.root.add(row.body);
      disableAvatarCollision(row.body);
    } else if (row.body.userData.avatarKey !== key) {
      paintHumanoid(row.body, next, THREE);
    }
    row.avatarKey = key;
    if (row.body && row.deviceProp !== prop) {
      if (!settled || !fxOn) {
        row.pendingProp = prop;
      } else {
        setAvatarDeviceProp(row.body, prop);
        row.deviceProp = prop;
        row.pendingProp = "";
      }
    }
  }

  function makeHead(colorHex) {
    const g = new THREE.Group();
    g.name = "xr-avatar-head-pose";
    // Disabling detailed avatars must never make a connected person invisible.
    if (!shouldLoadXrAvatarMeshes()) {
      g.add(simpleMesh('head', colorHex));
      const visor = simpleMesh('box', 0x17212b, [0.15, 0.06, 0.04]);
      visor.position.set(0, 0.015, -0.085);
      g.add(visor);
    }
    return g;
  }

  function makeController(colorHex, hand) {
    const g = new THREE.Group();
    // Rounded handle and face plate remain recognizable while the cached GLB loads.
    const material = new THREE.MeshBasicMaterial({ color: 0xe7e9ed });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(.017, .012, .085, 8), material);
    handle.rotation.x = -.35; handle.position.set(0, -.025, .018);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(.027, .023, .014, 12), material);
    plate.position.set(0, .022, -.012); g.add(handle, plate);
    g.visible = false;
    void attachQuestController(THREE, g, hand, () => !!g.parent?.parent);
    return g;
  }

  function paintCanvasLabel(canvas, text, colorHex, accent = "") {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(15,23,42,0.82)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `#${colorHex.toString(16).padStart(6, "0")}`;
    ctx.font = "600 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text || "Teammate").slice(0, 18), canvas.width / 2, accent ? 22 : 32);
    if (accent) {
      ctx.fillStyle = "#fde68a";
      ctx.font = "600 20px system-ui, sans-serif";
      ctx.fillText(String(accent).slice(0, 28), canvas.width / 2, 48);
    }
  }

  function makeLabel(text, colorHex) {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 64;
    paintCanvasLabel(canvas, text, colorHex, "");
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      depthTest: true,
      depthWrite: true,
      transparent: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const sprite = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.084), mat);
    sprite.userData.canvas = canvas;
    sprite.userData.tex = tex;
    sprite.userData.colorHex = colorHex;
    sprite.userData.title = String(text || "Teammate");
    sprite.userData.xrNametag = true;
    sprite.renderOrder = 2100;
    return sprite;
  }

  function setLabelAccent(sprite, accent) {
    if (!sprite?.userData?.canvas) return;
    const next = String(accent || "");
    if (sprite.userData.accent === next) return;
    sprite.userData.accent = next;
    paintCanvasLabel(sprite.userData.canvas, sprite.userData.title, sprite.userData.colorHex, next);
    sprite.userData.tex.needsUpdate = true;
  }

  function countTris(obj) {
    let n = 0;
    obj?.traverse?.((o) => {
      if (!o?.isMesh || !o.geometry) return;
      const idx = o.geometry.index?.count;
      const pos = o.geometry.attributes?.position?.count;
      n += idx ? idx / 3 : (pos || 0) / 3;
    });
    return n;
  }

  function tintGhost(root, colorHex) {
    const tint = new THREE.Color(colorHex);
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const next = mats.map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = 0.38;
        c.depthWrite = false;
        c.side = THREE.DoubleSide;
        if (c.color) c.color.lerp(tint, 0.45);
        if (c.emissive) {
          c.emissive.copy(tint);
          c.emissiveIntensity = 0.22;
        }
        return c;
      });
      o.material = Array.isArray(o.material) ? next : next[0];
      o.renderOrder = 1990;
      o.frustumCulled = false;
    });
  }

  function makeHolderSilhouette(colorHex) {
    const g = new THREE.Group();
    g.name = "xr-holder-silhouette";
    g.visible = false;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x0b1220,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const rim = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    const torsoGeo = THREE.CapsuleGeometry
      ? new THREE.CapsuleGeometry(0.11, 0.4, 3, 8)
      : new THREE.CylinderGeometry(0.11, 0.13, 0.52, 8);
    const torso = new THREE.Mesh(torsoGeo, mat);
    torso.position.y = 1.08;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), rim);
    halo.position.y = 1.52;
    halo.scale.set(1, 1.15, 0.85);
    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mat);
    hips.position.y = 0.8;
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.04, 0.7, 6), mat);
    legL.position.set(-0.055, 0.35, 0);
    const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.04, 0.7, 6), mat);
    legR.position.set(0.055, 0.35, 0);
    const armGeo = new THREE.CylinderGeometry(0.022, 0.028, 1, 6);
    const armL = new THREE.Mesh(armGeo, mat);
    const armR = new THREE.Mesh(armGeo, mat);
    g.add(torso, halo, hips, legL, legR, armL, armR);
    g.userData.armL = armL;
    g.userData.armR = armR;
    g.renderOrder = 1980;
    g.traverse((o) => {
      o.frustumCulled = false;
      o.renderOrder = 1980;
    });
    return g;
  }

  const _armDir = new THREE.Vector3();
  const _armFrom = new THREE.Vector3();
  const _armTo = new THREE.Vector3();
  const _yUp = new THREE.Vector3(0, 1, 0);

  function stretchArm(arm, parent, fromLocal, toWorld) {
    if (!arm || !parent) return;
    _armFrom.copy(fromLocal);
    parent.worldToLocal(_armTo.copy(toWorld));
    _armDir.copy(_armTo).sub(_armFrom);
    const len = Math.max(_armDir.length(), 0.08);
    arm.position.copy(_armFrom).add(_armTo).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(_yUp, _armDir.normalize());
    arm.scale.set(1, len, 1);
  }

  function poseHolderSilhouette(row) {
    const sil = row?.silhouette;
    if (!sil) return;
    // Full-body dock-demo NPC — never show. Real presence is head + controllers.
    sil.visible = false;
  }

  function makeHeldPlaceholder(colorHex) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    );
    mesh.name = "xr-held-placeholder";
    mesh.renderOrder = 1990;
    return mesh;
  }

  function rebuildHeld(row) {
    if (!row?.held) return;
    while (row.held.children.length) {
      const child = row.held.children[0];
      row.held.remove(child);
      child.traverse?.((o) => {
        if (o === child) return;
        o.geometry?.dispose?.();
      });
    }
    if (shouldCloneCadGhostForAvatars() && ghostSource && countTris(ghostSource) <= 2500) {
      try {
        const clone = ghostSource.clone(true);
        clone.position.set(0, 0, 0);
        clone.quaternion.identity();
        clone.scale.set(1, 1, 1);
        tintGhost(clone, row.color);
        row.held.add(clone);
        row.held.userData.rev = ghostRev;
        return;
      } catch {
        /* fall through to box */
      }
    }
    row.held.add(makeHeldPlaceholder(row.color));
    row.held.userData.rev = ghostRev;
  }

  function applySampledNode(node, track, now) {
    if (!node) return false;
    const sampled = samplePoseTrack(track, now, _sampleP, _sampleQ);
    if (!sampled) {
      node.visible = false;
      return false;
    }
    node.visible = true;
    const dx = node.position.x - _sampleP[0];
    const dy = node.position.y - _sampleP[1];
    const dz = node.position.z - _sampleP[2];
    const moved = Math.hypot(dx, dy, dz) >= 0.0005;
    // Golden path: only snap on meaningful translation — tiny quat noise was
    // hard-injecting every packet and made networked avatars fluctuate.
    if (moved || !node.userData.xrPoseSet) {
      node.position.set(_sampleP[0], _sampleP[1], _sampleP[2]);
      if (sampled.q) node.quaternion.set(_sampleQ[0], _sampleQ[1], _sampleQ[2], _sampleQ[3]);
      node.userData.xrPoseSet = true;
    }
    return moved;
  }

  function ensureTracks(row) {
    if (row.tracks) return row.tracks;
    row.tracks = {
      head: makePoseTrack(),
      left: makePoseTrack(),
      right: makePoseTrack(),
      held: makePoseTrack(),
    };
    return row.tracks;
  }

  function upsert(user) {
    const id = String(user?.id || "");
    if (!id) return null;
    let row = avatars.get(id);
    const color = new THREE.Color(user.color || "#58a6ff");
    if (!row) {
      const root = new THREE.Group();
      root.name = `xr-avatar-${id}`;
      const loadMeshes = shouldLoadXrAvatarMeshes();
      const head = makeHead(color.getHex());
      const left = makeController(color.getHex(), "left");
      const right = makeController(color.getHex(), "right");
      const name = makeLabel(user.display_name || "Teammate", color.getHex());
      const held = new THREE.Group();
      held.name = "xr-held-ghost";
      held.visible = false;
      const silhouette = loadMeshes ? makeHolderSilhouette(color.getHex()) : new THREE.Group();
      const badge = makeLabel(user.display_name || "Teammate", color.getHex());
      badge.scale.set(0.5, 0.1, 1);
      badge.position.set(0, 0.16, 0);
      held.add(badge);
      root.add(head, left, right, held, silhouette, name);
      group.add(root);
      const hitSize = nametagHitSize();
      const hit = new THREE.Mesh(
        new THREE.BoxGeometry(hitSize.w, hitSize.h, hitSize.d || 0.08),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.001,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      hit.position.copy(name.position);
      hit.userData.xrUserId = id;
      hit.userData.xrNametag = true;
      hit.renderOrder = 2099;
      hit.frustumCulled = false;
      hit.visible = true;
      root.add(hit);
      name.userData.xrUserId = id;
      name.userData.xrNametag = true;
      badge.userData.xrUserId = id;
      root.userData.xrUserId = id;
      row = {
        root, head, left, right, name, held, badge, hit, silhouette, body: null,
        color: color.getHex(), id, tracks: null, speaking: false, heldScale: null, deviceProp: "",
      };
      if (!loadMeshes) {
        row.body = simpleMesh('box', color.getHex(), [0.28, 0.4, 0.16]);
        row.body.userData.xrSimpleAvatar = true;
        row.body.visible = false;
        root.add(row.body);
      }
      if (loadMeshes) applyAvatarMesh(row, parseAvatarFromPose(user.xrPose || user), user);
      avatars.set(id, row);
      disableAvatarCollision(root);
      if (loadMeshes && shouldCloneCadGhostForAvatars()) rebuildHeld(row);
    } else if (user.display_name && row.name?.userData) {
      row.name.userData.title = String(user.display_name).slice(0, 18);
      setLabelAccent(row.name, row.name.userData.accent || "");
    }
    if (user.xrPose || user.avatar || user.source || user.xr_prop || user.xr_device) {
      applyAvatarMesh(row, parseAvatarFromPose(user.xrPose || user), user);
    }
    const device = deviceLabelFromUser(user);
    if (device && row.name && !row.name.userData.accent) {
      setLabelAccent(row.name, device);
    }
    return row;
  }

  function syncUsers(users = []) {
    const keep = new Set();
    (users || []).filter(u => u?.xrPose?.head).slice(0, 8).forEach((u) => {
      const id = String(u.id || "");
      if (!id) return;
      // Live headset pose only. Orbit stubs ("docks demo") followed the viewer
      // and felt like a shove when you walked toward them.
      if (!u.xrPose) return;
      keep.add(id);
      const row = upsert(u);
      row.root.userData.hasPose = true;
      if (!row.tracks?.head?.has) applyPose(id, u.xrPose);
      faceTags(row);
    });
    for (const [id, row] of avatars) {
      if (keep.has(id)) continue;
      group.remove(row.root);
      row.root.traverse((o) => {
        if (o.geometry && !o.geometry.userData?.xrShared) o.geometry.dispose?.();
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (m?.userData?.xrShared) continue;
          m?.map?.dispose?.(); m?.dispose?.();
        }
      });
      avatars.delete(id);
    }
  }

  function applyPose(userId, pose, at = 0) {
    const id = String(userId || "");
    if (!id || !pose) return;
    const row = avatars.get(id) || upsert({ id, display_name: pose.name, color: pose.color });
    if (!row) return;
    row.root.userData.hasPose = true;
    const tracks = ensureTracks(row);
    const t = Number(at) || (typeof performance !== "undefined" ? performance.now() : 0);
    ingestPosePart(tracks.head, pose.head, t);
    ingestPosePart(tracks.left, pose.left, t);
    ingestPosePart(tracks.right, pose.right, t);
    if (tracks.head.t0 === tracks.head.t1) {
      applySampledNode(row.head, tracks.head, t);
      applySampledNode(row.left, tracks.left, t);
      applySampledNode(row.right, tracks.right, t);
    }
    row.speaking = !!pose.speaking;
    if (row.head) row.head.scale.setScalar(row.speaking ? 1.08 : 1);
    applyAvatarMesh(row, parseAvatarFromPose(pose), {
      xrPose: pose,
      xr_device: pose.xr_device,
      xr_mode: pose.xr_mode,
      xr_prop: pose.xr_prop,
    });
    placeBody(row);
    const device = deviceLabelFromUser({ xrPose: pose, xr_device: pose.xr_device, xr_mode: pose.xr_mode });

    const gen = pose.generating;
    const genOn = !!(gen && (gen.on || gen.generating));
    const pct = Math.round(Number(gen?.pct || 0));
    const genLabel = genOn
      ? `${String(gen.label || "Generating").slice(0, 18)}${pct ? ` ${pct}%` : ""}`
      : "";
    setLabelAccent(row.name, genOn ? genLabel : (pose.held?.grabbing ? "holding" : device));

    const held = pose.held;
    poseHolderSilhouette(row, pose, held);
    if (held && Array.isArray(held.p) && held.p.length === 3 && !held.object_id) {
      if (row.held.userData.rev !== ghostRev) rebuildHeld(row);
      ingestPosePart(tracks.held, held, t);
      const s = held.s || held.scale;
      row.heldScale = Array.isArray(s) && s.length >= 3
        ? [Number(s[0]) || 1, Number(s[1]) || 1, Number(s[2]) || 1]
        : null;
      row.held.visible = true;
      if (row.badge) {
        setLabelAccent(row.badge, genOn ? genLabel : (held.grabbing ? "holding" : "their view"));
        row.badge.visible = true;
      }
    } else if (row.held) {
      tracks.held.has = false;
      row.held.visible = false;
    }
  }

  const _lastViewer = new THREE.Vector3();

  function tick(now) {
    const t = Number(now) || (typeof performance !== "undefined" ? performance.now() : 0);
    const settled = typeof enterSettled === "function" ? enterSettled() !== false : true;
    if (!settled) return;
    if (!avatars.size) return;
    const fxOn = typeof avatarFxEnabled === "function" ? avatarFxEnabled() === true : avatarFxEnabled === true;
    const doBlink = shouldTickAvatarBlink({
      avatarCount: avatars.size,
      lastBlinkAt,
      now: t,
      enterSettled: settled,
      avatarFxEnabled: fxOn,
    });
    const viewerMoved = _viewer.distanceToSquared(_lastViewer) > 4e-6;
    if (viewerMoved) _lastViewer.copy(_viewer);
    for (const row of avatars.values()) {
      const tracks = row.tracks;
      if (!tracks) continue;
      const headMoved = applySampledNode(row.head, tracks.head, t);
      applySampledNode(row.left, tracks.left, t);
      applySampledNode(row.right, tracks.right, t);
      if (row.held && tracks.held?.has) {
        applySampledNode(row.held, tracks.held, t);
        if (row.heldScale) {
          _scl.set(row.heldScale[0], row.heldScale[1], row.heldScale[2]);
          row.held.scale.copy(_scl);
        }
        row.held.visible = true;
      }
      placeBody(row);
      if (fxOn && settled && row.pendingProp && row.body) {
        try {
          setAvatarDeviceProp(row.body, row.pendingProp);
          row.deviceProp = row.pendingProp;
        } catch (_) {}
        row.pendingProp = "";
      }
      if (doBlink) tickAvatarBlink(row.body, t);
      if (shouldFaceNametag({ headMoved, viewerMoved })) faceTags(row);
    }
    if (doBlink) lastBlinkAt = t;
  }

  function pickNametag(raycaster) {
    const hits = [];
    for (const row of avatars.values()) {
      if (row.hit) {
        row.hit.visible = true;
        hits.push(row.hit);
      }
      if (row.name) hits.push(row.name);
    }
    if (!hits.length) return null;
    try { group.updateMatrixWorld(true); } catch { /* ignore */ }
    const found = raycaster.intersectObjects(hits, false);
    return nametagPickFromHits(found);
  }

  function setGhostSource(mesh) {
    if (!shouldCloneCadGhostForAvatars()) return;
    ghostSource = mesh || null;
    ghostRev += 1;
    for (const row of avatars.values()) rebuildHeld(row);
  }

  function clear() {
    syncUsers([]);
  }

  return { group, syncUsers, applyPose, tick, upsert, clear, avatars, setGhostSource, pickNametag, setViewer };
}
