/** Sandbox meshes in the existing XR scene. Toggle hides them; production CAD stays. Token sandbox4. */
export const SANDBOX4_TOKEN = "sandbox4";
export const SANDBOX_SHAPE_EVENT = "render3d-sandbox-toggle";

export function tagSandboxShape(obj) {
  if (!obj) return obj;
  obj.userData = obj.userData || {};
  obj.userData.sandboxShape = true;
  return obj;
}

export function setSandboxShapesVisible(root, on) {
  if (!root) return { visible: false, token: SANDBOX4_TOKEN };
  const next = !!on;
  root.visible = next;
  root.traverse((node) => {
    if (node === root || node.userData?.sandboxShape) node.visible = next;
  });
  return { visible: next, hidden: !next, destroyed: false, token: SANDBOX4_TOKEN };
}

export function createSandboxViewportShapes(THREE, scene) {
  const root = new THREE.Group();
  root.name = "sandbox-shapes";
  tagSandboxShape(root);
  root.visible = false;
  root.position.set(0, 0, -1.85);
  root.scale.setScalar(0.14);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 28),
    new THREE.MeshBasicMaterial({ color: 0x161b22, transparent: true, opacity: 0.55 }),
  );
  floor.rotation.x = -Math.PI / 2;
  tagSandboxShape(floor);
  root.add(floor);

  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 2.1, 0.22, 20),
    new THREE.MeshBasicMaterial({ color: 0x30363d }),
  );
  table.position.y = 0.7;
  tagSandboxShape(table);
  root.add(table);

  const colors = [0x58a6ff, 0x3fb950, 0xf0883e, 0x79c0ff, 0xe3b341, 0xbc8cff];
  colors.forEach((color, i) => {
    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 1.2, 1.05),
      new THREE.MeshBasicMaterial({ color }),
    );
    const ang = (i / colors.length) * Math.PI * 2;
    desk.position.set(Math.cos(ang) * 5.0, 0.8, Math.sin(ang) * 5.0);
    tagSandboxShape(desk);
    root.add(desk);
  });

  scene?.add?.(root);

  const api = {
    root,
    token: SANDBOX4_TOKEN,
    isVisible: () => root.visible,
    setVisible(on) {
      return setSandboxShapesVisible(root, on);
    },
  };
  try { globalThis.Render3DSandboxShapes = api; } catch { /* optional */ }
  return api;
}

export function bindSandboxShapeVisibility(api) {
  if (!api) return api;
  const apply = (on) => api.setVisible(!!on);
  const onEvt = (ev) => apply(ev?.detail?.open);
  try {
    window.addEventListener(SANDBOX_SHAPE_EVENT, onEvt);
    const pressed = document.getElementById("sb1-window")?.classList.contains("is-open") === true;
    apply(pressed);
  } catch { /* node tests */ }
  return api;
}
