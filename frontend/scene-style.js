import * as THREE from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Fusion / Onshape-style dark workspace theme.
 *
 * Goals: clear part separation, readable hard edges, matte CAD plastic shading
 * (not washed-out white). Edge / silhouette colours are derived per mesh body.
 */
export const FUSION = {
  canvas: 0x0d1117,

  // Default single-body plastic — vivid enough to read on dark canvas.
  body: 0x5aa2e0,
  bodyMetalness: 0.04,
  bodyRoughness: 0.52,
  // Soft body-tinted lift so undersides / pockets stay visible.
  bodyEmissive: 0x142033,
  bodyEmissiveIntensity: 0.11,

  // Crease edges around holes / pads (Onshape-like feature edges).
  edgeThresholdDeg: 14,

  silhouetteScale: 1.0032,

  gridMajor: 0x40516a,
  gridMinor: 0x2a3445,
  shadowOpacity: 0.08,
};

const HIGH_FRAGMENT_MESH_COUNT = 1200;
/** Models with many 1–2 triangle meshes (OpenCascade face dumps) — one solid colour. */
const FACE_FRAGMENT_MESH_COUNT = 48;

function _triangleCount(mesh) {
  const geo = mesh?.geometry;
  if (!geo) return 0;
  if (geo.index?.count) return Math.max(1, Math.round(geo.index.count / 3));
  const pos = geo.attributes?.position?.count || 0;
  return Math.max(1, Math.round(pos / 3));
}

/**
 * True when the GLB is a face/triangle dump (common for STEP→mesh “faceted”
 * previews): hundreds of tiny meshes instead of one mesh per solid body.
 */
function _isFaceFragmentedModel(meshes) {
  if (meshes.length < FACE_FRAGMENT_MESH_COUNT) return false;
  const sample = meshes.slice(0, Math.min(80, meshes.length));
  let tiny = 0;
  let trisTotal = 0;
  for (const mesh of sample) {
    const tris = _triangleCount(mesh);
    trisTotal += tris;
    if (tris <= 2) tiny += 1;
  }
  const tinyRatio = tiny / sample.length;
  const avgTris = trisTotal / sample.length;
  return tinyRatio >= 0.55 || (meshes.length >= 200 && avgTris <= 4);
}


/** Bright Onshape-like part appearances — saturated midtones for dark UI. */
const CAD_PART_PALETTE = [
  0x4f9cf0, // sky blue
  0x62c45a, // green
  0xff9f43, // orange
  0xffd166, // gold
  0xb388ff, // purple
  0x2ec4b6, // teal
  0xff6b6b, // coral
  0x6c8cff, // periwinkle
  0x8fd694, // mint
  0xffb4a2, // peach
].map((c) => new THREE.Color(c));

// ─── helpers ──────────────────────────────────────────────────────────────────

function _edgeColorFor(bodyColor) {
  const body = bodyColor || new THREE.Color(FUSION.body);
  // Dark crisp edges on light plastics; light edges only on very dark bodies.
  return _luminance(body) > 0.28 ? new THREE.Color(0x0a121c) : new THREE.Color(0xc9d7e8);
}

function _silhouetteColorFor(_bodyColor) {
  return new THREE.Color(0x05090f);
}

function _bodyColorOf(mesh) {
  const mat = mesh.material;
  if (!mat) return new THREE.Color(FUSION.body);
  if (mat.vertexColors && mesh.geometry?.attributes?.color) {
    const attr = mesh.geometry.attributes.color;
    return new THREE.Color(attr.getX(0), attr.getY(0), attr.getZ(0));
  }
  return mat.color ? mat.color.clone() : new THREE.Color(FUSION.body);
}

function _luminance(color) {
  return color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
}

function _chroma(color) {
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
}

function _colorDistance(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function _isNeutralOrWashed(color) {
  if (!color) return true;
  const chroma = _chroma(color);
  const avg = (color.r + color.g + color.b) / 3;
  // Monochrome greys / baked AO vertex tints are not real Onshape appearances.
  if (chroma < 0.08) return true;
  // Near-white washout.
  if (avg > 0.85) return true;
  return false;
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
      washed: _isNeutralOrWashed(vertex),
    };
  }
  const existing = _extractExistingColor(mesh);
  if (existing) {
    return {
      color: existing,
      hasColor: true,
      source: "material",
      tooDark: _luminance(existing) < 0.30,
      washed: _isNeutralOrWashed(existing),
    };
  }
  return {
    color: new THREE.Color(FUSION.body),
    hasColor: false,
    source: "fallback",
    tooDark: false,
    washed: true,
  };
}

function _useGeneratedPalette(meshInfos) {
  if (!meshInfos.length) return false;
  const missingCount = meshInfos.filter((m) => !m.info.hasColor).length;
  const washedCount = meshInfos.filter((m) => m.info.washed || !m.info.hasColor).length;
  const vertexCount = meshInfos.filter((m) => m.info.source === "vertex").length;
  const materialCount = meshInfos.filter((m) => m.info.source === "material").length;
  const colors = meshInfos.map((m) => m.info.color);
  let maxDist = 0;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      maxDist = Math.max(maxDist, _colorDistance(colors[i], colors[j]));
    }
  }

  // Multi-body assemblies that are monochrome / washed → distinct part colours.
  const monochromeAssembly = meshInfos.length > 1 && maxDist < 0.28;
  if (monochromeAssembly) return true;
  if (meshInfos.length > 1 && washedCount >= Math.ceil(meshInfos.length * 0.6)) return true;

  // Preserve real varied Onshape appearances only when they are colourful.
  if (materialCount > 0 && missingCount === 0 && washedCount === 0 && maxDist >= 0.28) {
    return false;
  }

  // Washed / missing / flat vertex-coloured bodies get the generated palette
  // (single body → first palette colour; multi-body → distinct colours).
  return missingCount > 0 || washedCount > 0
    || (meshInfos.length > 1 && vertexCount === meshInfos.length && maxDist < 0.28);
}

function _hasPreservableFragmentColors(meshInfos) {
  if (!meshInfos.length) return false;
  const colorful = meshInfos.filter(({ info }) => (
    info.hasColor
    && !info.washed
    && _luminance(info.color) >= 0.18
    && _chroma(info.color) >= 0.08
  ));
  if (!colorful.length) return false;
  // If a STEP/GLB arrives as many tiny face meshes but those faces carry real
  // authored colors, keep them. Only fall back to generated CAD plastic when
  // the source colors are neutral, missing, or washed out.
  return colorful.length >= Math.max(1, Math.ceil(meshInfos.length * 0.12));
}

// ─── lighting ─────────────────────────────────────────────────────────────────

let shadowFloor = null;

export function setupSceneLighting(scene) {
  scene.background = new THREE.Color(FUSION.canvas);

  // Balanced CAD lighting: soft form shading + readable undersides/cavities.
  // Keep ambient below key/fill so faces aren't cel-flat, but high enough that
  // no orbit angle goes black.
  const hemi = new THREE.HemisphereLight(0xf4f7fb, 0x556274, 0.88);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xe6eef6, 0.48);
  scene.add(ambient);

  // Key — warm upper-front (defines form).
  const key = new THREE.DirectionalLight(0xfff5ec, 1.12);
  key.position.set(5, -5, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 60;
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  // Cool fill — ~65% of key so side faces stay coloured, not crushed.
  const fill = new THREE.DirectionalLight(0xd9e7ff, 0.74);
  fill.position.set(-6, 5, 5);
  scene.add(fill);

  // Rim / back — separates parts from the canvas.
  const rim = new THREE.DirectionalLight(0xc5d6ea, 0.52);
  rim.position.set(1, 8, -7);
  scene.add(rim);

  // Top fill — evening upper faces without bleaching.
  const front = new THREE.DirectionalLight(0xf4f8fc, 0.44);
  front.position.set(0, 0, 12);
  scene.add(front);

  // Under-fills — bottom walls and pockets stay viewable when orbiting.
  const under = new THREE.DirectionalLight(0xe4eef8, 0.58);
  under.position.set(0, 0, -9);
  scene.add(under);

  const underLeft = new THREE.DirectionalLight(0xd5e4f6, 0.40);
  underLeft.position.set(-6, 4, -5);
  scene.add(underLeft);

  const underRight = new THREE.DirectionalLight(0xffefe3, 0.40);
  underRight.position.set(6, -4, -5);
  scene.add(underRight);

  // Inward cavity fill for hollow housings / trays.
  const cavity = new THREE.DirectionalLight(0xffffff, 0.46);
  cavity.position.set(3, -3, 3);
  scene.add(cavity);

  return { key, fill, rim, hemi, ambient, front, under, underLeft, underRight, cavity };
}

export function setupRenderer(renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
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
  if (geo.attributes?.normal?.count) return;
  if (geo.userData?.render3dCreasedNormals) return;
  const creased = toCreasedNormals(geo, THREE.MathUtils.degToRad(28));
  creased.userData = { ...(geo.userData || {}), render3dCreasedNormals: true };
  mesh.geometry = creased;
}

function addVisibleEdges(mesh) {
  const geo = mesh.geometry;
  if (!geo) return;

  const bodyColor = _bodyColorOf(mesh);
  const edgeColor = _edgeColorFor(bodyColor);
  const silColor = _silhouetteColorFor(bodyColor);

  const edgeGeo = new THREE.EdgesGeometry(geo, FUSION.edgeThresholdDeg);
  const crease = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({
      color: edgeColor,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.92,
    }),
  );
  crease.userData.isEdge = true;
  crease.renderOrder = 3;
  mesh.add(crease);

  const shell = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: silColor,
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: true,
    }),
  );
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

function _extractExistingColor(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (!m?.color) continue;
    const c = m.color;
    if (c.r === 0 && c.g === 0 && c.b === 0) continue;
    const fusionR = ((FUSION.body >> 16) & 0xff) / 255;
    const fusionG = ((FUSION.body >> 8) & 0xff) / 255;
    const fusionB = (FUSION.body & 0xff) / 255;
    const dist = Math.abs(c.r - fusionR) + Math.abs(c.g - fusionG) + Math.abs(c.b - fusionB);
    if (dist <= 0.06) continue;
    if (_isNeutralOrWashed(c)) continue;
    return c.clone();
  }
  return null;
}

/**
 * Apply Fusion/Onshape-style CAD rendering to every mesh in the tree.
 *
 * Colour is assigned per solid body / object — never per triangle. Face-dumped
 * STEP→GLB previews (one mesh per triangle) get a single plastic colour.
 */
export function applyCadStyle(object3d) {
  const meshes = [];
  object3d.traverse((child) => {
    if (!child.isMesh || !child.geometry || child.userData.isSilhouette) return;
    if (child.userData.isEdge) return;
    meshes.push(child);
  });

  const meshInfos = meshes.map((mesh) => ({ mesh, info: _meshColorInfo(mesh) }));
  const faceFragmented = _isFaceFragmentedModel(meshes);
  const preserveFragmentColors = faceFragmented && _hasPreservableFragmentColors(meshInfos);
  const highFragmentModel = faceFragmented || meshes.length > HIGH_FRAGMENT_MESH_COUNT;
  // Per-mesh palette only for real multi-body assemblies, not triangle dumps.
  const usePalette = !faceFragmented && _useGeneratedPalette(meshInfos);

  // One shared material for face dumps — identical colour + less z-fighting churn.
  let sharedFaceMaterial = null;
  if (faceFragmented && !preserveFragmentColors) {
    const bodyColor = CAD_PART_PALETTE[0].clone();
    const emissive = bodyColor.clone().multiplyScalar(0.18);
    emissive.r = Math.min(emissive.r, 0.16);
    emissive.g = Math.min(emissive.g, 0.16);
    emissive.b = Math.min(emissive.b, 0.18);
    sharedFaceMaterial = new THREE.MeshStandardMaterial({
      color: bodyColor,
      metalness: FUSION.bodyMetalness,
      roughness: FUSION.bodyRoughness,
      emissive,
      emissiveIntensity: 0.14,
      flatShading: false,
      // Strong offset so coplanar OCC face dumps don't flicker / clip.
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
      envMapIntensity: 0.28,
      depthWrite: true,
    });
  }

  meshInfos.forEach(({ mesh: child, info }, index) => {
    child.castShadow = !highFragmentModel;
    child.receiveShadow = false;
    child.renderOrder = 2;
    smoothDisplayGeometry(child);

    if (faceFragmented && sharedFaceMaterial) {
      child.material = sharedFaceMaterial;
      // No per-face edges/silhouettes — they cause severe clipping on OCC dumps.
      return;
    }

    const paletteColor = CAD_PART_PALETTE[index % CAD_PART_PALETTE.length].clone();
    const vertexColors = geometryHasVertexColors(child.geometry);
    const shouldPaletteColor = usePalette && (
      !info.hasColor || info.tooDark || info.washed || info.source === "fallback"
      || (info.source === "vertex" && info.washed)
    );

    // Strip baked monochrome vertex tints — they fight MeshStandard lighting.
    const keepVertexColors = !shouldPaletteColor && vertexColors && !info.washed && info.source === "vertex";

    const existingMats = Array.isArray(child.material) ? child.material : [child.material];
    const origColor = !vertexColors ? info.color : null;
    const origMap = existingMats[0]?.map ?? null;
    const origMetal = existingMats[0]?.metalness ?? FUSION.bodyMetalness;
    const origRough = existingMats[0]?.roughness ?? FUSION.bodyRoughness;
    const metalness = shouldPaletteColor
      ? FUSION.bodyMetalness
      : Math.min(Number(origMetal) || 0, 0.22);
    const roughness = shouldPaletteColor
      ? FUSION.bodyRoughness
      : Math.min(Math.max(Number(origRough) || FUSION.bodyRoughness, 0.42), 0.72);

    const bodyColor = shouldPaletteColor
      ? paletteColor
      : keepVertexColors
        ? new THREE.Color(0xffffff)
        : (origColor && !info.washed)
          ? origColor
          : new THREE.Color(FUSION.body);

    const emissive = bodyColor.clone().multiplyScalar(0.18);
    emissive.r = Math.min(emissive.r, 0.16);
    emissive.g = Math.min(emissive.g, 0.16);
    emissive.b = Math.min(emissive.b, 0.18);

    child.material = new THREE.MeshStandardMaterial({
      color: bodyColor,
      map: shouldPaletteColor ? null : origMap,
      vertexColors: keepVertexColors,
      metalness,
      roughness,
      emissive,
      emissiveIntensity: shouldPaletteColor ? 0.14 : FUSION.bodyEmissiveIntensity,
      flatShading: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      envMapIntensity: 0.28,
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
