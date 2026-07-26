import * as THREE from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  applyLookdevMobileFallback,
  isConstrainedWebGLViewport,
  softenAuthoredEnvMaps,
} from "./mobile-viewport-lighting.js?v=20260725-mobile-lit";

/**
 * Fusion / Onshape-style dark workspace theme.
 *
 * Goals: clear part separation, readable hard edges, matte CAD plastic shading
 * (not washed-out white). Edge / silhouette colours are derived per mesh body.
 *
 * Mesh / img2threejs models use a separate look-dev rig (RoomEnvironment IBL +
 * cinematic key/rim) so they match the online showcase — Mode 2.0 stays on CAD lights.
 */
export const FUSION = {
  canvas: 0x0d1117,
  lookdevCanvas: 0x12141c,

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
  lookdevShadowOpacity: 0.18,
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
  // OCC/STEP face dumps often land as ~80–200 meshes with tens of tris each
  // (Arduino-class boards). Treat those as fragmented so we skip edges/silhouettes
  // that cause mesh clipping / z-fighting in the share viewer.
  return (
    tinyRatio >= 0.55
    || (meshes.length >= 200 && avgTris <= 4)
    || (meshes.length >= 80 && avgTris <= 40)
  );
}


/** Bright CAD palette for dark canvas — avoid black / charcoal / dull aluminium. */
const CAD_PART_PALETTE = [
  new THREE.Color("#78aee8"), // sky blue
  new THREE.Color("#8fd17f"), // mint
  new THREE.Color("#f0c15a"), // amber
  new THREE.Color("#e88974"), // coral
  new THREE.Color("#b79be8"), // violet
  new THREE.Color("#6bc7c6"), // teal
  new THREE.Color("#e8d6a8"), // sand
  new THREE.Color("#d6dee8"), // cool light grey
];

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

function _rememberCadColor(mesh, mat, color) {
  if (!mesh || !mat || !color) return;
  const hex = `#${color.getHexString()}`;
  mesh.userData = mesh.userData || {};
  mat.userData = mat.userData || {};
  mesh.userData.render3dCadColorHex = hex;
  mat.userData.render3dCadColorHex = hex;
}

function _restoreCadColorIfNeutral(mesh, mat) {
  if (!mat?.color) return;
  const hex = mat.userData?.render3dCadColorHex || mesh?.userData?.render3dCadColorHex;
  if (!hex) return;
  const intended = new THREE.Color(hex);
  if (_isNeutralOrWashed(mat.color) || _colorDistance(mat.color, intended) > 0.42) {
    mat.color.copy(intended);
    mat.needsUpdate = true;
  }
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

function _isColorfulAuthored(info) {
  if (!info?.hasColor || info.washed || info.tooDark) return false;
  return _chroma(info.color) >= 0.08 && _luminance(info.color) >= 0.18;
}

function _useGeneratedPalette(meshInfos) {
  if (!meshInfos.length) return false;
  const missingCount = meshInfos.filter((m) => !m.info.hasColor).length;
  const washedCount = meshInfos.filter((m) => m.info.washed || !m.info.hasColor).length;
  const vertexCount = meshInfos.filter((m) => m.info.source === "vertex").length;
  const materialCount = meshInfos.filter((m) => m.info.source === "material").length;
  const colorfulCount = meshInfos.filter((m) => _isColorfulAuthored(m.info)).length;
  const colors = meshInfos.map((m) => m.info.color);
  let maxDist = 0;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      maxDist = Math.max(maxDist, _colorDistance(colors[i], colors[j]));
    }
  }

  // Preserve authored GLB/STEP appearance colors even when every body shares one
  // real color (for example a fully orange model). Only generate CAD palette
  // colors when the source is missing, neutral/washed, or too dark to read.
  if (missingCount === 0 && washedCount === 0 && (materialCount > 0 || vertexCount > 0)) {
    return false;
  }

  // Robot / multi-body assemblies often mix colorful shells with dark motors,
  // bearings, and cable tubes. Rainbow-painting those dark internals causes
  // bright blue/green streaks through orange shells (z-fighting). Keep authored
  // shell colors and leave dark parts dark (they may also be hidden below).
  if (colorfulCount >= 1 && colorfulCount >= Math.max(1, Math.ceil(meshInfos.length * 0.12))) {
    return false;
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

function _meshWorldBox(mesh) {
  mesh.updateWorldMatrix?.(true, false);
  const geo = mesh.geometry;
  if (!geo) return new THREE.Box3();
  if (!geo.boundingBox) geo.computeBoundingBox();
  const box = geo.boundingBox.clone();
  box.applyMatrix4(mesh.matrixWorld);
  return box;
}

function _boxVolume(box) {
  if (!box || box.isEmpty()) return 0;
  const size = box.getSize(new THREE.Vector3());
  return Math.max(0, size.x) * Math.max(0, size.y) * Math.max(0, size.z);
}

function _boxOverlapRatio(a, b) {
  const inter = a.clone().intersect(b);
  if (inter.isEmpty()) return 0;
  const interVol = _boxVolume(inter);
  const denom = Math.min(_boxVolume(a), _boxVolume(b));
  return denom > 1e-12 ? interVol / denom : 0;
}

function _boxContainedRatio(inner, outer) {
  const inter = inner.clone().intersect(outer);
  if (inter.isEmpty()) return 0;
  const innerVol = _boxVolume(inner);
  return innerVol > 1e-12 ? _boxVolume(inter) / innerVol : 0;
}

/**
 * Detect nested / coplanar assembly solids that cause orange↔blue z-fighting
 * (motors, bearings, joint datums, cable sleeves stuffed inside link shells).
 */
function _classifyOverlappingInternals(meshInfos) {
  const hide = new Set();
  const shellBias = new Set();
  if (meshInfos.length < 2 || meshInfos.length > 400) return { hide, shellBias };

  const rows = meshInfos.map(({ mesh, info }, index) => {
    const box = _meshWorldBox(mesh);
    return {
      index,
      mesh,
      info,
      box,
      vol: _boxVolume(box),
      colorful: _isColorfulAuthored(info),
      darkish: !!(info.tooDark || info.washed || _luminance(info.color) < 0.28),
    };
  });

  for (const candidate of rows) {
    if (hide.has(candidate.index)) continue;
    for (const shell of rows) {
      if (shell.index === candidate.index) continue;
      if (shell.vol < candidate.vol * 1.08) continue;
      const contained = _boxContainedRatio(candidate.box, shell.box);
      const overlap = _boxOverlapRatio(candidate.box, shell.box);

      // Dark / washed solid mostly inside a colorful shell → hide (review geometry).
      if (
        shell.colorful
        && candidate.darkish
        && !candidate.colorful
        && (contained >= 0.68 || (overlap >= 0.55 && contained >= 0.4))
      ) {
        hide.add(candidate.index);
        shellBias.add(shell.index);
        break;
      }

      // Near-duplicate tubes / sleeves sharing volume with a larger shell.
      if (
        shell.colorful
        && overlap >= 0.7
        && candidate.vol < shell.vol * 0.9
        && (candidate.darkish || !candidate.colorful)
      ) {
        hide.add(candidate.index);
        shellBias.add(shell.index);
        break;
      }
    }
  }

  return { hide, shellBias };
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
let _litScene = null;
let _litRenderer = null;
let _cadLightGroup = null;
let _lookdevLightGroup = null;
let _roomEnvTexture = null;
let _lookdevBgTexture = null;
/** @type {"cad" | "lookdev"} */
export let viewportShadingMode = "cad";

function _makeLookdevGradientBackground() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(
    size * 0.5,
    size * 0.42,
    size * 0.05,
    size * 0.5,
    size * 0.5,
    size * 0.72,
  );
  g.addColorStop(0, "#2a3140");
  g.addColorStop(1, "#0c0e14");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function _ensureRoomEnvironment(scene, renderer) {
  if (_roomEnvTexture || !renderer || !scene) return _roomEnvTexture;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader?.();
    _roomEnvTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  } catch (err) {
    console.warn("RoomEnvironment IBL unavailable", err);
    _roomEnvTexture = null;
  }
  return _roomEnvTexture;
}

function _collectGroupLights(group) {
  const lights = [];
  group?.traverse?.((child) => {
    if (child.isLight) lights.push(child);
  });
  return lights;
}

/**
 * Active lights for the viewport brightness slider (CAD or Mesh look-dev).
 */
export function getActiveViewportLights() {
  const group = viewportShadingMode === "lookdev" ? _lookdevLightGroup : _cadLightGroup;
  return _collectGroupLights(group);
}

/**
 * Switch between CAD studio lighting (Mode 2.0) and Mesh look-dev
 * (RoomEnvironment IBL + cinematic key/rim like img2threejs showcase).
 */
export function setViewportShadingMode(mode, { scene = _litScene, renderer = _litRenderer } = {}) {
  const next = (mode === "lookdev" || mode === "mesh" || mode === "shaded" || mode === "authored" || mode === "pbr")
    ? "lookdev"
    : "cad";
  if (!scene) return next;
  _litScene = scene;
  if (renderer) _litRenderer = renderer;

  viewportShadingMode = next;
  if (_cadLightGroup) _cadLightGroup.visible = next === "cad";
  if (_lookdevLightGroup) _lookdevLightGroup.visible = next === "lookdev";

  if (next === "lookdev") {
    const env = _ensureRoomEnvironment(scene, renderer || _litRenderer);
    if (env) {
      scene.environment = env;
      if ("environmentIntensity" in scene) scene.environmentIntensity = 1.05;
    } else {
      scene.environment = null;
    }
    if (!_lookdevBgTexture) _lookdevBgTexture = _makeLookdevGradientBackground();
    scene.background = _lookdevBgTexture || new THREE.Color(FUSION.lookdevCanvas);
    if (_litRenderer) {
      _litRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      _litRenderer.toneMappingExposure = isConstrainedWebGLViewport() ? 1.15 : 1.0;
    }
    if (shadowFloor?.material) {
      shadowFloor.material.opacity = FUSION.lookdevShadowOpacity;
      shadowFloor.material.needsUpdate = true;
    }
    // Mobile / missing IBL: raise fill lights so metal PBR isn't pure black.
    applyLookdevMobileFallback({
      scene,
      lookdevGroup: _lookdevLightGroup,
      hasEnv: !!env,
    });
  } else {
    scene.environment = null;
    if ("environmentIntensity" in scene) scene.environmentIntensity = 1;
    scene.background = new THREE.Color(FUSION.canvas);
    if (_litRenderer) {
      _litRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      _litRenderer.toneMappingExposure = 1.1;
    }
    if (shadowFloor?.material) {
      shadowFloor.material.opacity = FUSION.shadowOpacity;
      shadowFloor.material.needsUpdate = true;
    }
  }
  return next;
}

export function setupSceneLighting(scene, renderer = null) {
  _litScene = scene;
  _litRenderer = renderer;
  scene.background = new THREE.Color(FUSION.canvas);

  _cadLightGroup = new THREE.Group();
  _cadLightGroup.name = "CadStudioLights";

  // Balanced CAD lighting: soft form shading + readable undersides/cavities.
  const hemi = new THREE.HemisphereLight(0xf4f7fb, 0x556274, 0.88);
  _cadLightGroup.add(hemi);

  const ambient = new THREE.AmbientLight(0xe6eef6, 0.48);
  _cadLightGroup.add(ambient);

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
  _cadLightGroup.add(key);

  const fill = new THREE.DirectionalLight(0xd9e7ff, 0.74);
  fill.position.set(-6, 5, 5);
  _cadLightGroup.add(fill);

  const rim = new THREE.DirectionalLight(0xc5d6ea, 0.52);
  rim.position.set(1, 8, -7);
  _cadLightGroup.add(rim);

  const front = new THREE.DirectionalLight(0xf4f8fc, 0.44);
  front.position.set(0, 0, 12);
  _cadLightGroup.add(front);

  const under = new THREE.DirectionalLight(0xe4eef8, 0.58);
  under.position.set(0, 0, -9);
  _cadLightGroup.add(under);

  const underLeft = new THREE.DirectionalLight(0xd5e4f6, 0.40);
  underLeft.position.set(-6, 4, -5);
  _cadLightGroup.add(underLeft);

  const underRight = new THREE.DirectionalLight(0xffefe3, 0.40);
  underRight.position.set(6, -4, -5);
  _cadLightGroup.add(underRight);

  const cavity = new THREE.DirectionalLight(0xffffff, 0.46);
  cavity.position.set(3, -3, 3);
  _cadLightGroup.add(cavity);

  scene.add(_cadLightGroup);

  // Mesh / img2threejs look-dev — mirrors showcase default studio + cinematic rim.
  // Positions are Z-up (Render3D), converted from the showcase's Y-up rig.
  _lookdevLightGroup = new THREE.Group();
  _lookdevLightGroup.name = "MeshLookdevLights";
  _lookdevLightGroup.visible = false;

  const ldHemi = new THREE.HemisphereLight(0xbfe6ff, 0x1a2030, 0.32);
  _lookdevLightGroup.add(ldHemi);

  const ldAmb = new THREE.AmbientLight(0xffffff, 0.05);
  _lookdevLightGroup.add(ldAmb);

  const ldKey = new THREE.DirectionalLight(0xfff2d6, 2.15);
  ldKey.position.set(-2.8, 2.6, 3.4);
  ldKey.castShadow = true;
  ldKey.shadow.mapSize.set(2048, 2048);
  ldKey.shadow.camera.near = 0.4;
  ldKey.shadow.camera.far = 40;
  ldKey.shadow.camera.left = -14;
  ldKey.shadow.camera.right = 14;
  ldKey.shadow.camera.top = 14;
  ldKey.shadow.camera.bottom = -14;
  ldKey.shadow.bias = -0.00035;
  ldKey.shadow.normalBias = 0.02;
  ldKey.shadow.radius = 2.5;
  _lookdevLightGroup.add(ldKey);

  const ldFill = new THREE.DirectionalLight(0x9fb4ff, 0.34);
  ldFill.position.set(3.2, 1.8, 1.2);
  _lookdevLightGroup.add(ldFill);

  const ldRim = new THREE.DirectionalLight(0x38e0d0, 0.85);
  ldRim.position.set(5.5, -4.5, 2.8);
  _lookdevLightGroup.add(ldRim);

  const ldAccent = new THREE.PointLight(0xffc294, 10, 16, 2);
  ldAccent.position.set(0, -3.2, 2.0);
  _lookdevLightGroup.add(ldAccent);

  const ldUnder = new THREE.PointLight(0x4ecdc4, 2.4, 10, 2);
  ldUnder.position.set(-1.4, 1.2, 0.35);
  _lookdevLightGroup.add(ldUnder);

  scene.add(_lookdevLightGroup);

  if (renderer) _ensureRoomEnvironment(scene, renderer);

  return {
    key,
    fill,
    rim,
    hemi,
    ambient,
    front,
    under,
    underLeft,
    underRight,
    cavity,
    cadGroup: _cadLightGroup,
    lookdevGroup: _lookdevLightGroup,
  };
}

export function setupRenderer(renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  _litRenderer = renderer;
}

function _materialHasTextureMaps(mat) {
  if (!mat) return false;
  return !!(
    mat.map
    || mat.normalMap
    || mat.roughnessMap
    || mat.metalnessMap
    || mat.aoMap
    || mat.emissiveMap
    || mat.bumpMap
  );
}

function _meshHasTextureMaps(mesh) {
  if (!mesh?.isMesh) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.some(_materialHasTextureMaps);
}

/**
 * True when this tree was authored as a shaded Three.js / img2threejs model
 * (keep PBR colors) rather than a CAD STEP→GLB preview.
 *
 * Do NOT infer from color/metalness heuristics — that wrongly flipped Mode 2.0
 * CAD parts into authored shading (black / unlit plastic). Explicit signals only:
 * Mesh markers, texture-library exports, or materials that already carry maps.
 */
export function prefersAuthoredShading(object3d, filename = "") {
  if (!object3d) return false;
  const name = String(filename || object3d.name || "").toLowerCase();
  if (name.includes(".mesh.") || /\.mesh\.mjs$/i.test(name) || /\.mesh\.glb$/i.test(name)) {
    return true;
  }
  let flagged = false;
  object3d.traverse((child) => {
    if (flagged) return;
    const ud = child.userData || {};
    const extras = ud.extras || {};
    const style = String(ud.render3dStyle || extras.render3dStyle || "").toLowerCase();
    const pipeline = String(ud.render3dPipeline || extras.render3dPipeline || "").toLowerCase();
    if (style === "shaded" || style === "authored" || style === "pbr") flagged = true;
    if (
      pipeline === "img2threejs"
      || pipeline === "mesh"
      || pipeline === "texture"
      || pipeline === "texture_library"
    ) {
      flagged = true;
    }
    // Library / render wraps bake maps into the GLB — keep them (Mode 2.0 CAD
    // STEP dumps almost never ship texture maps).
    if (_meshHasTextureMaps(child)) flagged = true;
  });
  return flagged;
}

/**
 * Keep authored Three.js / GLB materials (img2threejs). Do not rewrite to CAD plastic.
 */
export function applyAuthoredStyle(object3d) {
  if (!object3d) return object3d;
  object3d.userData.render3dStyle = object3d.userData.render3dStyle || "shaded";
  object3d.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    if (child.userData.isSilhouette || child.userData.isEdge || child.userData.isFloor) return;
    // Drop CAD helper overlays if a prior pass added them.
    if (child.children?.length) {
      const toRemove = [];
      for (const c of child.children) {
        if (c.userData?.isEdge || c.userData?.isSilhouette) toRemove.push(c);
      }
      for (const c of toRemove) {
        child.remove(c);
        c.geometry?.dispose?.();
        if (Array.isArray(c.material)) c.material.forEach((m) => m?.dispose?.());
        else c.material?.dispose?.();
      }
    }
    child.castShadow = true;
    child.receiveShadow = true;
    child.visible = true;
    delete child.userData.cadInternalHidden;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat) continue;
      // Preserve color / metalness / roughness / maps — boost IBL response for look-dev.
      if ("envMapIntensity" in mat) {
        const cur = Number(mat.envMapIntensity);
        mat.envMapIntensity = Number.isFinite(cur) ? Math.max(cur, 1.05) : 1.15;
      }
      if ("flatShading" in mat) mat.flatShading = false;
      // Mild clearcoat on plastics/metals when the material supports it.
      if ("clearcoat" in mat && !(Number(mat.clearcoat) > 0)) {
        const metal = Number(mat.metalness);
        const rough = Number(mat.roughness);
        if (Number.isFinite(metal) && metal >= 0.35) {
          mat.clearcoat = 0.22;
          if ("clearcoatRoughness" in mat) mat.clearcoatRoughness = 0.28;
        } else if (Number.isFinite(rough) && rough <= 0.45) {
          mat.clearcoat = 0.18;
          if ("clearcoatRoughness" in mat) mat.clearcoatRoughness = 0.35;
        }
      }
      if (mat.polygonOffset && mat.userData?.render3dCadColorHex) {
        mat.polygonOffset = false;
      }
      mat.needsUpdate = true;
    }
  });
  return object3d;
}

/**
 * Apply the right viewport look: CAD plastic for STEP-ish previews, authored PBR for Mesh.
 * Pass `syncViewportLights: true` from the main studio so Mesh gets look-dev IBL
 * without flipping share/mini-viewer scenes.
 */
export function applyViewportStyle(object3d, { filename = "", styleMode = "auto", syncViewportLights = false } = {}) {
  const mode = String(styleMode || "auto").toLowerCase();
  const useAuthored = mode === "shaded" || mode === "authored" || mode === "pbr"
    || (mode === "auto" && prefersAuthoredShading(object3d, filename));
  if (useAuthored) {
    applyAuthoredStyle(object3d);
    if (syncViewportLights) {
      setViewportShadingMode("lookdev");
      softenAuthoredEnvMaps(object3d, { hasEnv: !!_litScene?.environment });
    }
    return object3d;
  }
  applyCadStyle(object3d);
  if (syncViewportLights) setViewportShadingMode("cad");
  return object3d;
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
  const hasTextureMaps = meshes.some(_meshHasTextureMaps);
  // Textured library wraps must keep maps — shared face plastic would wipe them.
  if (hasTextureMaps) {
    return applyAuthoredStyle(object3d);
  }
  const highFragmentModel = faceFragmented || meshes.length > HIGH_FRAGMENT_MESH_COUNT;
  // Per-mesh palette only for real multi-body assemblies, not triangle dumps.
  const usePalette = !faceFragmented && _useGeneratedPalette(meshInfos);
  const { hide: hideInternals, shellBias } = faceFragmented
    ? { hide: new Set(), shellBias: new Set() }
    : _classifyOverlappingInternals(meshInfos);

  // One shared material for face dumps — identical colour + less z-fighting churn.
  let sharedFaceMaterial = null;
  let sharedFaceBodyColor = null;
  if (faceFragmented && !preserveFragmentColors) {
    sharedFaceBodyColor = CAD_PART_PALETTE[0].clone();
    const emissive = sharedFaceBodyColor.clone().multiplyScalar(0.18);
    emissive.r = Math.min(emissive.r, 0.16);
    emissive.g = Math.min(emissive.g, 0.16);
    emissive.b = Math.min(emissive.b, 0.18);
    sharedFaceMaterial = new THREE.MeshStandardMaterial({
      color: sharedFaceBodyColor,
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
    sharedFaceMaterial.userData.render3dCadColorHex = `#${sharedFaceBodyColor.getHexString()}`;
  }

  meshInfos.forEach(({ mesh: child, info }, index) => {
    // Nested motors / bearings / cable sleeves that share surfaces with colorful
    // shells — hide so they cannot z-fight (blue streaks through orange links).
    if (hideInternals.has(index)) {
      child.visible = false;
      child.userData.cadInternalHidden = true;
      child.castShadow = false;
      child.receiveShadow = false;
      return;
    }
    if (child.userData.cadInternalHidden) {
      child.visible = true;
      delete child.userData.cadInternalHidden;
    }

    child.castShadow = !highFragmentModel;
    child.receiveShadow = false;
    const preferShell = shellBias.has(index) || _isColorfulAuthored(info);
    child.renderOrder = preferShell ? 3 : 2;
    smoothDisplayGeometry(child);

    if (faceFragmented && sharedFaceMaterial) {
      child.material = sharedFaceMaterial;
      _rememberCadColor(child, child.material, sharedFaceBodyColor);
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
    // Never rewrite materials that already carry texture maps (library wrap / PBR).
    if (existingMats.some(_materialHasTextureMaps)) {
      child.castShadow = true;
      child.receiveShadow = true;
      for (const mat of existingMats) {
        if (!mat) continue;
        if ("envMapIntensity" in mat) {
          const cur = Number(mat.envMapIntensity);
          mat.envMapIntensity = Number.isFinite(cur) ? Math.max(cur, 0.55) : 0.85;
        }
        if ("flatShading" in mat) mat.flatShading = false;
        mat.needsUpdate = true;
      }
      return;
    }
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

    // Shells pull slightly forward in the depth buffer; remaining dark overlaps
    // push back so coplanar assembly solids stop flickering when orbiting.
    const polygonOffsetFactor = preferShell ? -1 : (info.tooDark || info.washed ? 4 : 1);
    const polygonOffsetUnits = preferShell ? -1 : (info.tooDark || info.washed ? 4 : 1);

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
      polygonOffsetFactor,
      polygonOffsetUnits,
      envMapIntensity: 0.28,
    });
    _rememberCadColor(child, child.material, bodyColor);

    if (!highFragmentModel) {
      addVisibleEdges(child);
    }
  });

  return object3d;
}

export function disposeStyledModel(object3d) {
  if (!object3d) return;
  const geometries = new Set();
  const materials = new Set();
  object3d.traverse((c) => {
    if (c.geometry && !geometries.has(c.geometry)) {
      geometries.add(c.geometry);
      c.geometry.dispose();
    }
    if (c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach((m) => {
        if (!m || materials.has(m)) return;
        materials.add(m);
        m.dispose();
      });
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
      if (child.parent?.userData?.cadInternalHidden) {
        child.visible = false;
        return;
      }
      child.visible = viewMode !== "wireframe";
      return;
    }
    if (child.userData?.cadInternalHidden) {
      child.visible = false;
      return;
    }
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      _restoreCadColorIfNeutral(child, mat);
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
    }
  });
}

export function reapplyViewMode(object3d) {
  setViewMode(viewMode, object3d);
}

// ─── click-to-transparent (viewport + share preview) ──────────────────────────

const TRANSPARENT_SURFACE_OPACITY = 0.26;
const materialBaseState = new WeakMap();
const edgeBaseState = new WeakMap();

function meshMaterials(mesh) {
  if (!mesh?.material) return [];
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function ensureMaterialBase(mat) {
  if (!mat || materialBaseState.has(mat)) return;
  materialBaseState.set(mat, {
    opacity: mat.opacity ?? 1,
    transparent: !!mat.transparent,
    depthWrite: mat.depthWrite !== false,
    wireframe: !!mat.wireframe,
  });
}

function ensureEdgeBase(edge) {
  const mat = edge?.material;
  if (!mat || edgeBaseState.has(mat)) return;
  edgeBaseState.set(mat, {
    opacity: mat.opacity ?? 0.92,
    depthTest: mat.depthTest !== false,
    color: mat.color ? mat.color.clone() : new THREE.Color(0x0a121c),
    linewidth: mat.linewidth ?? 1,
  });
}

function objectSurfaceMeshes(object3d) {
  const meshes = [];
  object3d?.traverse?.((child) => {
    if (!child.isMesh || child.userData?.isEdge || child.userData?.isSilhouette) return;
    if (child.userData?.cadInternalHidden) return;
    meshes.push(child);
  });
  return meshes;
}

function applyTransparentSurface(mat, transparentOn, { wireframe = false } = {}) {
  if (!mat) return;
  ensureMaterialBase(mat);
  const base = materialBaseState.get(mat) || {};
  mat.wireframe = wireframe || !!base.wireframe;
  if (transparentOn) {
    mat.transparent = true;
    mat.opacity = TRANSPARENT_SURFACE_OPACITY;
    mat.depthWrite = false;
  } else {
    // Prefer stored solid base; if base was captured after ghosting, force solid.
    const restoreOpacity = Number.isFinite(base.opacity) && base.opacity > TRANSPARENT_SURFACE_OPACITY + 0.05
      ? base.opacity
      : 1;
    mat.opacity = restoreOpacity;
    mat.transparent = restoreOpacity < 0.999;
    mat.depthWrite = base.depthWrite !== false;
  }
  mat.needsUpdate = true;
}

function applyTransparentEdges(mesh, transparentOn) {
  if (!mesh) return;
  for (const child of mesh.children || []) {
    if (child.userData?.isSilhouette) {
      // Silhouette shells block the see-through view of inner creases.
      child.visible = !transparentOn && viewMode !== "wireframe";
      continue;
    }
    if (!child.userData?.isEdge || !child.material) continue;
    ensureEdgeBase(child);
    const mat = child.material;
    const base = edgeBaseState.get(mat) || {};
    if (transparentOn) {
      // Brighter, always-on-top creases so internals read clearly through glass bodies.
      mat.transparent = true;
      mat.opacity = 1;
      mat.depthTest = false;
      mat.depthWrite = false;
      if (mat.color) {
        const lift = (base.color || mat.color).clone();
        // Pull dark CAD edges toward a crisp light steel so they pop on dark canvas.
        if (_luminance(lift) < 0.45) lift.lerp(new THREE.Color(0xd7e4f5), 0.72);
        else lift.lerp(new THREE.Color(0xf4f8fc), 0.35);
        mat.color.copy(lift);
      }
      child.renderOrder = 12;
      child.visible = viewMode !== "wireframe";
    } else {
      mat.transparent = true;
      mat.opacity = base.opacity ?? 0.92;
      mat.depthTest = base.depthTest !== false;
      mat.depthWrite = false;
      if (mat.color && base.color) mat.color.copy(base.color);
      child.renderOrder = 3;
      child.visible = viewMode !== "wireframe";
    }
    mat.needsUpdate = true;
  }
}

/**
 * Make a node (component / body) see-through with stronger crease edges.
 * Used by the main viewport Transparent tool and the share preview.
 */
export function setObjectTransparent(object3d, transparentOn, { wireframe = false } = {}) {
  if (!object3d) return;
  object3d.userData = object3d.userData || {};
  object3d.userData.render3dTransparent = !!transparentOn;
  for (const mesh of objectSurfaceMeshes(object3d)) {
    for (const mat of meshMaterials(mesh)) {
      _restoreCadColorIfNeutral(mesh, mat);
      applyTransparentSurface(mat, transparentOn, { wireframe });
    }
    applyTransparentEdges(mesh, transparentOn);
  }
}

/** Re-sync surface + edge styling for nodes already marked transparent. */
export function syncTransparentObject(object3d, { wireframe = false } = {}) {
  if (!object3d) return;
  setObjectTransparent(object3d, !!object3d.userData?.render3dTransparent, { wireframe });
}
