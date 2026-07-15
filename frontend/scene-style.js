import * as THREE from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

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
  body: 0xd5dee8,
  bodyMetalness: 0.01,
  bodyRoughness: 0.62,
  // Soft unlit lift so cavity walls / undersides stay readable in dark studio.
  bodyEmissive: 0x1a2433,
  bodyEmissiveIntensity: 0.22,

  // How sharp a dihedral angle must be to draw a crease edge (degrees).
  // Lower than before so imported STEP models read like Onshape, with crisp
  // feature boundaries around holes, pockets, pads, and sharp outside edges.
  edgeThresholdDeg: 16,

  // Back-face silhouette: scale the mesh by this amount
  silhouetteScale: 1.005,

  gridMajor: 0x40516a,
  gridMinor: 0x2a3445,
  shadowOpacity: 0.08,
};

const HIGH_FRAGMENT_MESH_COUNT = 1200;

const CAD_PART_PALETTE = [
  0x78aee8, // Onshape-like blue
  0x8fd17f, // green
  0xf0c15a, // warm yellow
  0xe88974, // coral
  0xb79be8, // purple
  0x6bc7c6, // teal
  0xd7a06b, // tan/orange
  0xc7d0d9, // light neutral
  0x9fb6d8, // steel blue
  0xd6dbe2, // pale grey
].map((c) => new THREE.Color(c));

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute a crease-edge colour that contrasts with `bodyColor`.
 *  • Bright body  → deep shadow-toned line (darkened + slightly blue-shifted)
 *  • Dark  body   → light cool-grey line so it reads on the dark canvas
 */
function _edgeColorFor(bodyColor) {
  const body = bodyColor || new THREE.Color(FUSION.body);
  return _luminance(body) > 0.42 ? new THREE.Color(0x071018) : new THREE.Color(0xdbeafe);
}

/**
 * Compute silhouette-shell colour: always a tiny step darker than canvas so
 * the outline reads clearly but doesn't make the object look pitch-black.
 * Uses a dark-navy tint rather than pure black.
 */
function _silhouetteColorFor(bodyColor) {
  return new THREE.Color(0x05090f);
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

function _luminance(color) {
  return color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
}

function _colorDistance(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function _sampleVertexColor(geometry) {
  const attr = geometry?.attributes?.color;
  if (!attr?.count) return null;
  const step = Math.max(1, Math.floor(attr.count / 24));
  const c = new THREE.Color(0, 0, 0);
  let samples = 0;
  for (let i = 0; i < attr.count; i += step) {
    c.r += attr.getX(i);
    c.g += attr.getY(i);
    c.b += attr.getZ(i);
    samples++;
  }
  if (!samples) return null;
  c.multiplyScalar(1 / samples);
  return c;
}

function _meshColorInfo(mesh) {
  const vertex = _sampleVertexColor(mesh.geometry);
  if (vertex) {
    return {
      color: vertex,
      hasColor: true,
      source: "vertex",
      tooDark: _luminance(vertex) < 0.34,
    };
  }
  const existing = _extractExistingColor(mesh);
  if (existing) {
    return {
      color: existing,
      hasColor: true,
      source: "material",
      tooDark: _luminance(existing) < 0.30,
    };
  }
  return {
    color: new THREE.Color(FUSION.body),
    hasColor: false,
    source: "fallback",
    tooDark: true,
  };
}

function _useGeneratedPalette(meshInfos) {
  if (!meshInfos.length) return false;
  const missingCount = meshInfos.filter((m) => !m.info.hasColor).length;
  const vertexCount = meshInfos.filter((m) => m.info.source === "vertex").length;
  const materialCount = meshInfos.filter((m) => m.info.source === "material").length;
  const colors = meshInfos.map((m) => m.info.color);
  let maxDist = 0;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      maxDist = Math.max(maxDist, _colorDistance(colors[i], colors[j]));
    }
  }

  // Jake CAD Viewer / hero assemblies use distinct per-part colours. Uniform
  // cadpy DEFAULT_MATERIAL grey (or any monochrome multi-body GLB) should get
  // the generated part palette — not stay one flat grey.
  const monochromeAssembly = meshInfos.length > 1 && maxDist < 0.18;
  if (monochromeAssembly) return true;

  if (materialCount > 0 && missingCount === 0) return false;

  // Generated models often arrive as many dark vertex-coloured bodies. Imports
  // with meaningful Onshape appearances usually have brighter, varied colours.
  return (
    missingCount > 0 ||
    (meshInfos.length > 1 && vertexCount === meshInfos.length && maxDist < 0.18)
  );
}

// ─── lighting ─────────────────────────────────────────────────────────────────

let shadowFloor = null;

export function setupSceneLighting(scene) {
  scene.background = new THREE.Color(FUSION.canvas);

  // Hemisphere: bright sky + lifted ground so open shells / pockets stay readable.
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd7e4f4, 2.05);
  scene.add(hemi);

  // Strong ambient — CAD viewers prioritize part readability over cinematic contrast.
  const ambient = new THREE.AmbientLight(0xffffff, 0.92);
  scene.add(ambient);

  // Key light: upper-left front (Z-up). Softer than before so self-shadows
  // (disabled on bodies anyway) don't dominate if re-enabled later.
  const key = new THREE.DirectionalLight(0xfff8f0, 1.55);
  key.position.set(5, 6, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 60;
  key.shadow.camera.left  = -12;
  key.shadow.camera.right =  12;
  key.shadow.camera.top   =  12;
  key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  // Right fill: cool-white to balance the warm key
  const fill = new THREE.DirectionalLight(0xe8f3ff, 1.55);
  fill.position.set(-5, -3, 6);
  scene.add(fill);

  // Rim / back light: gives depth and separates parts from background
  const rim = new THREE.DirectionalLight(0xc5daf0, 0.95);
  rim.position.set(0, -8, 7);
  scene.add(rim);

  // Camera-facing soft fill: prevents the front face from going flat-dark
  const front = new THREE.DirectionalLight(0xffffff, 1.15);
  front.position.set(0, 12, 5);
  scene.add(front);

  // Under-fill: floor-bounce style lights from multiple lower angles so the
  // bottom and side walls do not collapse into one dark face.
  const under = new THREE.DirectionalLight(0xfff4df, 1.65);
  under.position.set(0, 0, -6);
  scene.add(under);

  const underLeft = new THREE.DirectionalLight(0xeaf5ff, 1.15);
  underLeft.position.set(-5, 4, -4);
  scene.add(underLeft);

  const underRight = new THREE.DirectionalLight(0xfff8ec, 1.15);
  underRight.position.set(5, -4, -4);
  scene.add(underRight);

  // Extra inward fill for hollow assemblies (boxes, housings, battery trays).
  const cavity = new THREE.DirectionalLight(0xffffff, 0.85);
  cavity.position.set(2, -2, 4);
  scene.add(cavity);

  return { key, fill, rim, hemi, ambient, front, under, underLeft, underRight, cavity };
}

export function setupRenderer(renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Lift midtones so enclosure interiors and side walls stay visible.
  renderer.toneMappingExposure = 1.48;
}

// ─── shadow floor ─────────────────────────────────────────────────────────────

export function ensureShadowFloor(scene) {
  if (shadowFloor) return shadowFloor;
  const geo = new THREE.PlaneGeometry(40, 40);
  const mat = new THREE.ShadowMaterial({ opacity: FUSION.shadowOpacity });
  shadowFloor = new THREE.Mesh(geo, mat);
  shadowFloor.receiveShadow = true;
  shadowFloor.userData.isFloor = true;
  scene.add(shadowFloor);
  return shadowFloor;
}

export function positionShadowFloor(scene, meshRoot) {
  const floor = ensureShadowFloor(scene);
  floor.rotation.x = 0;
  floor.position.set(0, 0, 0.001);
}

// ─── edge / silhouette helpers ────────────────────────────────────────────────

function geometryHasVertexColors(geometry) {
  const attr = geometry?.attributes?.color;
  return attr && attr.count > 0;
}

function smoothDisplayGeometry(mesh) {
  const geo = mesh.geometry;
  if (!geo) return;

  // text-to-cad bakes correct per-vertex normals into the GLB: planar CAD faces
  // get flat normals and curved faces get smooth ones. Preserve them so the
  // model renders exactly like the upstream cad-viewer. Re-creasing here would
  // discard those baked normals and re-facet smooth surfaces (the "warped" look).
  if (geo.attributes?.normal?.count) return;

  // Only meshes WITHOUT baked normals (e.g. raw STL) need synthesized display
  // normals. Rebuild them from face angles so coplanar triangles shade flat,
  // shallow curves stay smooth, and hard edges split.
  if (geo.userData?.render3dCreasedNormals) return;
  const creased = toCreasedNormals(geo, THREE.MathUtils.degToRad(28));
  creased.userData = { ...(geo.userData || {}), render3dCreasedNormals: true };
  mesh.geometry = creased;
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
  const edgeGeo = new THREE.EdgesGeometry(geo, FUSION.edgeThresholdDeg);
  const crease = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({
      color: edgeColor,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 1,
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
  // Inflate the shell about the geometry's centroid, not the mesh local origin.
  // Scaling about the origin shifts the shell off-center for any body whose
  // local origin isn't its centroid (placed/multi-body parts), producing a
  // one-sided dark halo that reads as distortion. world = pos + s·p_local, so
  // setting pos = c·(1−s) makes the scale pivot at the centroid c.
  const s = FUSION.silhouetteScale;
  shell.scale.setScalar(s);
  if (!geo.boundingBox) geo.computeBoundingBox();
  if (geo.boundingBox) {
    const c = geo.boundingBox.getCenter(new THREE.Vector3());
    shell.position.copy(c).multiplyScalar(1 - s);
  }
  shell.userData.isSilhouette = true;
  shell.renderOrder = 1;
  mesh.add(shell);
}

// ─── public CAD-style apply ───────────────────────────────────────────────────

/**
 * Return the dominant colour of an existing mesh material.
 * Handles single materials and material arrays (multi-group meshes).
 * Returns null if nothing useful is found.
 */
function _extractExistingColor(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (!m?.color) continue;
    const c = m.color;
    // Skip THREE defaults (black 0,0,0) and our own FUSION grey
    if (c.r === 0 && c.g === 0 && c.b === 0) continue;
    const fusionR = ((FUSION.body >> 16) & 0xff) / 255;
    const fusionG = ((FUSION.body >>  8) & 0xff) / 255;
    const fusionB = ( FUSION.body        & 0xff) / 255;
    const dist = Math.abs(c.r - fusionR) + Math.abs(c.g - fusionG) + Math.abs(c.b - fusionB);
    if (dist <= 0.06) continue;
    // Skip cadpy DEFAULT_MATERIAL / neutral greys (~0.72) — Jake hero parts are
    // distinctly coloured; flat grey is not a meaningful appearance.
    const chroma = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    const avg = (c.r + c.g + c.b) / 3;
    if (chroma < 0.04 && avg > 0.55 && avg < 0.85) continue;
    return c.clone(); // real, non-default colour
  }
  return null;
}

/**
 * Apply Onshape-style CAD rendering to every mesh in the tree.
 *
 * Priority order for body colour:
 *  1. Vertex colours already baked in (parametric generator output)
 *  2. Existing material colour from a GLB/STEP import (preserves Onshape colours)
 *  3. FUSION default grey (fallback for plain meshes)
 */
export function applyCadStyle(object3d) {
  const meshes = [];
  object3d.traverse((child) => {
    if (!child.isMesh || !child.geometry || child.userData.isSilhouette) return;
    meshes.push(child);
  });

  const meshInfos = meshes.map((mesh) => ({ mesh, info: _meshColorInfo(mesh) }));
  const usePalette = _useGeneratedPalette(meshInfos);
  const highFragmentModel = meshes.length > HIGH_FRAGMENT_MESH_COUNT;

  meshInfos.forEach(({ mesh: child, info }, index) => {
    const paletteColor = CAD_PART_PALETTE[index % CAD_PART_PALETTE.length].clone();
    const shouldPaletteColor = usePalette && (!info.hasColor || info.tooDark || info.source === "vertex");

    // Cast onto the floor only — body receiveShadow makes hollow shells / pockets
    // collapse to black (self-shadow), which hides interior detail.
    child.castShadow = !highFragmentModel;
    child.receiveShadow = false;
    child.renderOrder = 2;
    smoothDisplayGeometry(child);

    const vertexColors = geometryHasVertexColors(child.geometry);

    // Preserve original GLB/STEP part colours so imported Onshape models
    // look exactly as they do in Onshape.
    const existingMats = Array.isArray(child.material) ? child.material : [child.material];
    const origColor    = !vertexColors ? info.color : null;
    const origMap      = existingMats[0]?.map ?? null;
    const origMetal    = existingMats[0]?.metalness ?? FUSION.bodyMetalness;
    const origRough    = existingMats[0]?.roughness  ?? FUSION.bodyRoughness;
    const metalness = shouldPaletteColor
      ? FUSION.bodyMetalness
      : Math.min(Number(origMetal) || 0, 0.18);
    const roughness = shouldPaletteColor
      ? FUSION.bodyRoughness
      : Math.max(Number(origRough) || FUSION.bodyRoughness, 0.45);

    child.material = new THREE.MeshStandardMaterial({
      color:       shouldPaletteColor ? paletteColor
                 : vertexColors       ? 0xffffff
                 : origColor          ? origColor
                 :                      FUSION.body,
      map:         shouldPaletteColor ? null : origMap,
      vertexColors: shouldPaletteColor ? false : vertexColors,
      metalness,
      roughness,
      emissive: new THREE.Color(FUSION.bodyEmissive),
      emissiveIntensity: FUSION.bodyEmissiveIntensity,
      flatShading: false,
      polygonOffset:       true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits:  1,
      envMapIntensity: shouldPaletteColor ? 0.55 : 0.4,
    });

    if (!highFragmentModel) {
      addVisibleEdges(child);
    }
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
