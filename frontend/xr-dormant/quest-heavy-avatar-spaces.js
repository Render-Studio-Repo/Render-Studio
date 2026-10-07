/**
 * DORMANT — Quest / native app only.
 * Extracted from viewport-xr.js.bak-heavy-20260805-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1-20260915-xragent3 (Aug 5 heavy shell).
 * NOT imported by the live web Quest Browser build (crashes Meta Browser).
 * Re-enable when shipping a native Quest app / SideQuest APK with more GPU headroom.
 *
 * Contains: full-body avatar meshes, studio/warehouse spaces, blocks grid,
 * and dense social presence markers.
 * Live web XR uses controllers + low-poly head stubs instead (see viewport-xr.js).-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1-20260915-xragent3
 */

import * as THREE from "three";

// --- pasted helpers (need host getHeadPose / scene / renderer wiring when revived) ---

// ===== buildStudioSpace =====
function buildStudioSpace() {

  clearSpaceEnvironment();

  const root = ensureSpaceRoot();

  const floor = new THREE.Mesh(

    new THREE.PlaneGeometry(12, 12),

    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.92, metalness: 0.05 }),

  );

  floor.rotation.x = -Math.PI / 2;

  floor.position.y = -0.01;

  floor.receiveShadow = false;

  root.add(floor);

  const grid = new THREE.GridHelper(12, 24, 0x94a3b8, 0xcbd5e1);

  grid.position.y = 0.001;

  root.add(grid);

  root.visible = true;

}


// ===== buildWarehouseSpace =====
function buildWarehouseSpace() {

  clearSpaceEnvironment();

  const root = ensureSpaceRoot();

  const floor = new THREE.Mesh(

    new THREE.PlaneGeometry(28, 40),

    new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85, metalness: 0.15 }),

  );

  floor.rotation.x = -Math.PI / 2;

  floor.position.y = -0.02;

  root.add(floor);

  const lane = new THREE.Mesh(

    new THREE.PlaneGeometry(2.2, 36),

    new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.7, metalness: 0.05 }),

  );

  lane.rotation.x = -Math.PI / 2;

  lane.position.set(0, 0.002, 0);

  root.add(lane);

  for (let side of [-1, 1]) {

    for (let z = -14; z <= 14; z += 4) {

      const rack = new THREE.Mesh(

        new THREE.BoxGeometry(1.6, 2.4, 0.6),

        new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.55, metalness: 0.65 }),

      );

      rack.position.set(side * 4.2, 1.2, z);

      root.add(rack);

      for (let y = 0.5; y <= 2.0; y += 0.7) {

        const shelf = new THREE.Mesh(

          new THREE.BoxGeometry(1.5, 0.06, 0.55),

          new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6, metalness: 0.35 }),

        );

        shelf.position.set(side * 4.2, y, z);

        root.add(shelf);

      }

    }

  }

  // Overhead truss line for "assembly aisle" feel

  const beam = new THREE.Mesh(

    new THREE.BoxGeometry(10, 0.12, 0.2),

    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5, metalness: 0.4 }),

  );

  beam.position.set(0, 3.2, 0);

  root.add(beam);

  root.visible = true;

}


// ===== applySpace =====
function applySpace(id) {

  activeSpaceId = id || "passthrough";

  if (activeSpaceId === "studio") {

    buildStudioSpace();

    if (sessionIsPassthrough) {

      scene.background = new THREE.Color(0xf8fafc);

      renderer.setClearColor(0xf8fafc, 1);

    }

  } else if (activeSpaceId === "warehouse") {

    buildWarehouseSpace();

    scene.background = new THREE.Color(0x1e293b);

    renderer.setClearColor(0x1e293b, 1);

  } else {

    clearSpaceEnvironment();

    if (sessionIsPassthrough) {

      scene.background = null;

      renderer.setClearColor(0x000000, 0);

      renderer.setClearAlpha(0);

    } else {

      scene.background = new THREE.Color(0x1c1c1e);

      renderer.setClearColor(0x1c1c1e, 1);

    }

  }

  menuFooterHint = `Space · ${SPACE_PRESETS.find((s) => s.id === activeSpaceId)?.label || activeSpaceId}`;

}


// ===== ensureSpaceRoot =====
function ensureSpaceRoot() {

  if (spaceRoot) return spaceRoot;

  spaceRoot = new THREE.Group();

  spaceRoot.name = "xrSpaceEnvironment";

  spaceRoot.visible = false;

  scene.add(spaceRoot);

  return spaceRoot;

}


// ===== clearSpaceEnvironment =====
function clearSpaceEnvironment() {

  const root = ensureSpaceRoot();

  while (root.children.length) {

    const child = root.children.pop();

    child.traverse?.((o) => {

      o.geometry?.dispose?.();

      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());

      else o.material?.dispose?.();

    });

    root.remove(child);

  }

  root.visible = false;

}


// ===== ensureAvatarRoot =====
function ensureAvatarRoot() {

  if (avatarRoot) return avatarRoot;

  avatarRoot = new THREE.Group();

  avatarRoot.name = "xrAvatar";

  avatarRoot.visible = false;

  scene.add(avatarRoot);

  return avatarRoot;

}


// ===== clearAvatar =====
function clearAvatar() {

  const root = ensureAvatarRoot();

  while (root.children.length) {

    const child = root.children.pop();

    child.traverse?.((o) => {

      o.geometry?.dispose?.();

      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());

      else o.material?.dispose?.();

    });

    root.remove(child);

  }

  root.visible = false;

}


// ===== buildAvatar =====
function buildAvatar(kind) {

  clearAvatar();

  if (kind === "off") {

    activeAvatarId = "off";

    return;

  }

  const root = ensureAvatarRoot();

  const mat = new THREE.MeshStandardMaterial({

    color: kind === "operator" ? 0x38bdf8 : 0xcbd5e1,

    roughness: 0.65,

    metalness: 0.08,

    transparent: true,

    opacity: 0.88,

  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.7, 16), mat);

  body.position.y = 0.95;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), mat);

  head.position.y = 1.42;

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.18), mat);

  hips.position.y = 0.55;

  root.add(body, head, hips);

  if (kind === "operator") {

    const hardhat = new THREE.Mesh(

      new THREE.SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),

      new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.45, metalness: 0.2 }),

    );

    hardhat.position.y = 1.48;

    root.add(hardhat);

  }

  getHeadPose();

  const fwd = headForwardFlat();

  root.position.copy(_headPos).addScaledVector(fwd, 1.1);

  root.position.y = 0;

  root.visible = true;

  activeAvatarId = kind;

  menuFooterHint = `Avatar · ${AVATAR_PRESETS.find((a) => a.id === kind)?.label || kind}`;

}


// ===== ensureBlocksGrid =====
function ensureBlocksGrid() {

  if (blocksGridHelper) return blocksGridHelper;

  const size = 1.2;

  const divs = 24;

  const helper = new THREE.GridHelper(size, divs, 0xd4af37, 0x3a3a40);

  helper.name = "xrBlocksGrid";

  helper.frustumCulled = false;

  helper.renderOrder = 5;

  helper.material.transparent = true;

  helper.material.opacity = 0.55;

  helper.visible = false;

  scene.add(helper);

  blocksGridHelper = helper;

  return helper;

}


// ===== ensureBlocksRoot =====
function ensureBlocksRoot() {

  if (blocksRoot) return blocksRoot;

  blocksRoot = new THREE.Group();

  blocksRoot.name = "xrBlocksRoot";

  scene.add(blocksRoot);

  return blocksRoot;

}


// ===== syncSocialPresenceMarkers =====
function syncSocialPresenceMarkers() {

  if (!presenting) return;

  if (!socialPresenceGroup) {

    socialPresenceGroup = new THREE.Group();

    socialPresenceGroup.name = "xr-social-presence";

    scene.add(socialPresenceGroup);

  }

  while (socialPresenceGroup.children.length) {

    const c = socialPresenceGroup.children.pop();

    c.geometry?.dispose?.();

    c.material?.dispose?.();

  }

  let state = {};

  try { state = (typeof getSocialState === "function" && getSocialState()) || {}; } catch { state = {}; }

  const users = Array.isArray(state.users) ? state.users : [];

  const root = (typeof getMeshRoot === "function" && getMeshRoot()) || null;

  const box = new THREE.Box3();

  if (root) box.setFromObject(root);

  const center = box.isEmpty()

    ? new THREE.Vector3(0, 40, 0)

    : box.getCenter(new THREE.Vector3());

  users.slice(0, 8).forEach((u, i) => {

    const color = new THREE.Color(u.color || "#58a6ff");

    const head = new THREE.Mesh(

      new THREE.SphereGeometry(8, 16, 12),

      new THREE.MeshBasicMaterial({ color }),

    );

    const angle = (i / Math.max(users.length, 1)) * Math.PI * 2;

    const r = Math.max(60, box.getSize(new THREE.Vector3()).length() * 0.35 || 60);

    head.position.set(center.x + Math.cos(angle) * r, center.y + 50, center.z + Math.sin(angle) * r);

    head.userData.xrSocialUser = u.id;

    socialPresenceGroup.add(head);

    // simple controller stubs

    for (const side of [-1, 1]) {

      const ctrl = new THREE.Mesh(

        new THREE.BoxGeometry(4, 4, 14),

        new THREE.MeshBasicMaterial({ color }),

      );

      ctrl.position.copy(head.position).add(new THREE.Vector3(side * 12, -18, 8));

      socialPresenceGroup.add(ctrl);

    }

  });

  (state.rendering || []).forEach((r, i) => {

    const badge = new THREE.Mesh(

      new THREE.SphereGeometry(6, 12, 10),

      new THREE.MeshBasicMaterial({ color: 0xa371f7 }),

    );

    badge.position.set(center.x + i * 16, center.y + 90, center.z);

    socialPresenceGroup.add(badge);

  });

}


// ===== showBlocksGrid =====
function showBlocksGrid(on = true) {

  const helper = refreshBlocksGridVisual();

  helper.visible = !!on;

}


// ===== setBlocksGridSize =====
function setBlocksGridSize(meters, { announce = true } = {}) {

  blocksGridSizeM = THREE.MathUtils.clamp(Number(meters) || 0.025, 0.005, 0.25);

  refreshBlocksGridVisual();

  if (announce) {

    menuFooterHint = `Blocks grid · ${Math.round(blocksGridSizeM * 1000)} mm — grip-stretch both controllers to refine`;

  }

  if (modelPanel?.group?.visible) refreshListPanel(modelPanel);

  if (cadPanel?.group?.visible) refreshListPanel(cadPanel);

}


// ===== refreshBlocksGridVisual =====
function refreshBlocksGridVisual() {

  const helper = ensureBlocksGrid();

  // Rebuild divisions so cell size matches blocksGridSizeM

  const extent = Math.max(0.4, Math.min(2.4, blocksGridSizeM * 24));

  const divisions = Math.max(4, Math.round(extent / Math.max(0.005, blocksGridSizeM)));

  const old = blocksGridHelper;

  const next = new THREE.GridHelper(extent, divisions, 0xd4af37, 0x3a3a40);

  next.name = "xrBlocksGrid";

  next.frustumCulled = false;

  next.renderOrder = 5;

  if (Array.isArray(next.material)) {

    next.material.forEach((m) => { m.transparent = true; m.opacity = 0.55; });

  } else if (next.material) {

    next.material.transparent = true;

    next.material.opacity = 0.55;

  }

  next.visible = !!old?.visible;

  if (old) {

    next.position.copy(old.position);

    next.quaternion.copy(old.quaternion);

    scene.remove(old);

    old.geometry?.dispose?.();

    old.material?.dispose?.();

  } else {

    getHeadPose();

    const fwd = headForwardFlat();

    next.position.copy(_headPos).addScaledVector(fwd, 0.55);

    next.position.y = Math.max(0.02, _headPos.y - 0.35);

  }

  scene.add(next);

  blocksGridHelper = next;

  return next;

}


