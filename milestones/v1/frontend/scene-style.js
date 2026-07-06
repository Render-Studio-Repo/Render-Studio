import * as THREE from "three";

/**
 * Fusion-style dark workspace theme.
 *
 * Edge / silhouette colours are DERIVED from each mesh's body colour at
 * applyCadStyle() time, so they always contrast correctly.  These constants
 * are fallback defaults.
 */
export const FUSION = {
  canvas: 0x0d1117,

  // Default body colour (used when the mesh has no vertex colours)
  body: 0xb8bec8,
  bodyMetalness: 0.18,
  bodyRoughness: 0.52,

  // How sharp a dihedral angle must be to draw a crease edge (degrees)
  edgeThresholdDeg: 18,

  // Back-face silhouette: scale the mesh by this amount
  silhouetteScale: 1.005,

  gridMajor: 0x30363d,
  gridMinor: 0x21262d,
  shadowOpacity: 0.28,
};

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute a crease-edge colour that contrasts with `bodyColor`.
 *  • Bright body  → deep shadow-toned line (darkened + slightly blue-shifted)
 *  • Dark  body   → light cool-grey line so it reads on the dark canvas
 */
function _edgeColorFor(bodyColor) {
  const lum = bodyColor.r * 0.299 + bodyColor.g * 0.587 + bodyColor.b * 0.114;
  if (lum > 0.45) {
    // bright body: darken substantially and shift cool
    const c = bodyColor.clone().multiplyScalar(0.28);
    c.b = Math.min(1, c.b + 0.06);
    return c;
  } else {
    // dark body: light cool-blue edge visible against both dark canvas & body
    const c = bodyColor.clone().lerp(new THREE.Color(0x7090b8), 0.7);
    c.r = Math.min(1, c.r + 0.08);
    c.g = Math.min(1, c.g + 0.12);
    c.b = Math.min(1, c.b + 0.22);
    return c;
  }
}

/**
 * Compute silhouette-shell colour: always a tiny step darker than canvas so
 * the outline reads clearly but doesn't make the object look pitch-black.
 * Uses a dark-navy tint rather than pure black.
 */
function _silhouetteColorFor(bodyColor) {
  const lum = bodyColor.r * 0.299 + bodyColor.g * 0.587 + bodyColor.b * 0.114;
  if (lum > 0.35) {
    // readable dark navy outline for light bodies
    return new THREE.Color(0x0a1520);
  } else {
    // for already-dark bodies, use a subtle accent
    return new THREE.Color(0x1a3050);
  }
}

/**
 * Read the dominant colour of a mesh for edge-colour derivation.
 * Falls back gracefully if the material hasn't been applied yet.
 */
function _bodyColorOf(mesh) {
  const mat = mesh.material;
  if (!mat) return new THREE.Color(FUSION.body);
  if (mat.vertexColors && mesh.geometry?.attributes?.color) {
    // Sample first vertex colour as representative
    const attr = mesh.geometry.attributes.color;
    return new THREE.Color(attr.getX(0), attr.getY(0), attr.getZ(0));
  }
  return mat.color ? mat.color.clone() : new THREE.Color(FUSION.body);
}

// ─── lighting ─────────────────────────────────────────────────────────────────

let shadowFloor = null;

export function setupSceneLighting(scene) {
  scene.background = new THREE.Color(FUSION.canvas);

  // Warm sky / cool ground hemisphere — softer ambient bounce
  const hemi = new THREE.HemisphereLight(0xc8d8e8, 0x1e2c3c, 0.72);
  scene.add(hemi);

  // Key light: upper-left front
  const key = new THREE.DirectionalLight(0xfff5e8, 1.6);
  key.position.set(5, 10, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 50;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0002;
  scene.add(key);

  // Fill light: right-side medium
  const fill = new THREE.DirectionalLight(0xd0e8ff, 0.55);
  fill.position.set(-4, 3, -3);
  scene.add(fill);

  // Rim / back light: subtle blue coolness
  const rim = new THREE.DirectionalLight(0x90b8d8, 0.38);
  rim.position.set(0, 5, -8);
  scene.add(rim);

  // Low-angle front fill — stops the facing-camera face going dark
  const front = new THREE.DirectionalLight(0xffffff, 0.30);
  front.position.set(0, 0, 10);
  scene.add(front);

  return { key, fill, rim, hemi, front };
}

export function setupRenderer(renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Slightly higher exposure so bodies aren't crushed to black by ACES
  renderer.toneMappingExposure = 1.25;
}

// ─── shadow floor ─────────────────────────────────────────────────────────────

export function ensureShadowFloor(scene) {
  if (shadowFloor) return shadowFloor;
  const geo = new THREE.PlaneGeometry(40, 40);
  const mat = new THREE.ShadowMaterial({ opacity: FUSION.shadowOpacity });
  shadowFloor = new THREE.Mesh(geo, mat);
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = -0.001;
  shadowFloor.receiveShadow = true;
  shadowFloor.userData.isFloor = true;
  scene.add(shadowFloor);
  return shadowFloor;
}

export function positionShadowFloor(scene, meshRoot) {
  const floor = ensureShadowFloor(scene);
  if (!meshRoot) return;
  const box = new THREE.Box3().setFromObject(meshRoot);
  floor.position.y = box.min.y - 0.002;
}

// ─── edge / silhouette helpers ────────────────────────────────────────────────

function geometryHasVertexColors(geometry) {
  const attr = geometry?.attributes?.color;
  return attr && attr.count > 0;
}

/**
 * Attach crease-edge lines and a thin silhouette shell to `mesh`.
 * Colours are derived from the mesh's already-applied material so they always
 * contrast against the body.
 */
function addVisibleEdges(mesh) {
  const geo = mesh.geometry;
  if (!geo) return;

  const bodyColor = _bodyColorOf(mesh);
  const edgeColor = _edgeColorFor(bodyColor);
  const silColor  = _silhouetteColorFor(bodyColor);

  // ── crease / hard-edge lines ────────────────────────────────────────────
  const crease = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, FUSION.edgeThresholdDeg),
    new THREE.LineBasicMaterial({
      color: edgeColor,
      depthTest: true,
      depthWrite: false,
      // Slight transparency so very dense meshes don't look "wireframe-y"
      transparent: true,
      opacity: 0.82,
    })
  );
  crease.userData.isEdge = true;
  crease.renderOrder = 3;
  mesh.add(crease);

  // ── silhouette outline (back-face inflated shell) ────────────────────────
  // depthWrite: true here so the shell correctly writes depth; this prevents
  // the back faces from "bleeding through" non-watertight meshes.
  const shell = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: silColor,
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: true,
    })
  );
  shell.scale.multiplyScalar(FUSION.silhouetteScale);
  shell.userData.isSilhouette = true;
  shell.renderOrder = 1;
  mesh.add(shell);
}

// ─── public CAD-style apply ───────────────────────────────────────────────────

export function applyCadStyle(object3d) {
  object3d.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    if (child.userData.isSilhouette) return;

    child.castShadow = true;
    child.receiveShadow = true;
    child.renderOrder = 2;

    const vertexColors = geometryHasVertexColors(child.geometry);
    child.material = new THREE.MeshStandardMaterial({
      color: vertexColors ? 0xffffff : FUSION.body,
      vertexColors,
      metalness: FUSION.bodyMetalness,
      roughness: FUSION.bodyRoughness,
      flatShading: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      envMapIntensity: 0.6,
    });

    // Ensure vertex normals exist for smooth shading
    if (!child.geometry.attributes.normal) {
      child.geometry.computeVertexNormals();
    }

    addVisibleEdges(child);
  });

  return object3d;
}

export function disposeStyledModel(object3d) {
  if (!object3d) return;
  object3d.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
      else c.material.dispose();
    }
  });
}

// ─── wireframe toggle ─────────────────────────────────────────────────────────

/** @type {'solid' | 'wireframe'} */
export let viewMode = "solid";

export function setViewMode(mode, object3d) {
  viewMode = mode === "wireframe" ? "wireframe" : "solid";
  if (!object3d) return;
  object3d.traverse((child) => {
    if (child.userData.isEdge || child.userData.isSilhouette) {
      child.visible = viewMode !== "wireframe";
      return;
    }
    if (!child.isMesh || !child.material) return;
    const mat = child.material;
    if (viewMode === "wireframe") {
      mat.wireframe = true;
      mat.transparent = true;
      mat.opacity = 0.92;
      mat.depthWrite = true;
    } else {
      mat.wireframe = false;
      mat.transparent = false;
      mat.opacity = 1;
    }
    mat.needsUpdate = true;
  });
}

export function reapplyViewMode(object3d) {
  setViewMode(viewMode, object3d);
}
