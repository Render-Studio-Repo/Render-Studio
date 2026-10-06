import * as THREE from "three";
import { ownMeshMaterials } from "./loaded-mesh-resources.js?v=20260930-normal-recovery1";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  applyLookdevMobileFallback,
  isConstrainedWebGLViewport,
  softenAuthoredEnvMaps,
} from "./mobile-viewport-lighting.js?v=20260725-mobile-lit";
import {
  disposeParkedWrapGpuFromObject,
  reviveXrParkedMaterials,
  shouldCloneXrPbrMaterials,
  shouldRestyleCadMaterialsOnXrEnter,
  shouldSyncCadEdgesWhilePresenting,
} from "../xr/xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5";
import { pruneShortEdgeSegments, weldColinearEdgePositions } from "./cad-edge-weld.js?v=20260909-cadedgeaa1";

/**
 * Fusion / Onshape-style workspace theme.
 *
 * Goals: clear part separation, readable hard edges, matte CAD plastic shading
 * (not washed-out white). Feature edges are black ink on the body.
 * Dark scene canvas is the charcoal studio (`#0d1117`) — not an Onshape mid-gray wash.
 *
 * Mesh / img2threejs GLBs keep look-dev shading without triangle wireframe.
 * CAD / STEP previews get Fusion-style feature edges (not tessellation meridians).
 */
export const FUSION = {
  canvas: 0x0d1117,
  lookdevCanvas: 0x0d1117,

  // Default single-body plastic. Stay neutral (not the selection-blue wash);
  // the browser/viewport selection outline is what should read as highlighted.
  body: 0xc4c4c4,
  bodyMetalness: 0.04,
  bodyRoughness: 0.52,
  bodyEmissive: 0x000000,
  bodyEmissiveIntensity: 0,

  // Crease edges around holes / pads (Onshape-like feature edges).
  // Stay above typical cylinder tessellation dihedrals (~20–40°) so we do
  // not draw GLB triangle meridians — only BRep-like feature breaks.
  edgeThresholdDeg: 52,

  // Feature / crease outlines — Onshape-like ink, slightly thicker than 1 CSS px
  // so Line2 + MSAA/A2C can filter dense T-slot runs (log-depth writes kill 1px AA).
  edge: 0x0c0c0e,
  // LineMaterial.resolution is CSS pixels (renderer.setSize).
  edgeWidth: 1.7,
  xrEdgeWidth: 1.5,

  silhouetteScale: 1.0032,

  gridMajor: 0x6f7782,
  gridMinor: 0x3c424a,
  shadowOpacity: 0.08,
  lookdevShadowOpacity: 0.18,
};

const HIGH_FRAGMENT_MESH_COUNT = 1200;
/** Models with many 1–2 triangle meshes (OpenCascade face dumps) — one solid colour. */
const FACE_FRAGMENT_MESH_COUNT = 48;
/** Skip crease edges / silhouettes above this — dense gears/worms turn into a dark wireframe and z-fight. */
const HIGH_TRIANGLE_EDGE_SKIP = 24000;

function _triangleCount(mesh) {
  const geo = mesh?.geometry;
  if (!geo) return 0;
  if (geo.index?.count) return Math.max(1, Math.round(geo.index.count / 3));
  const pos = geo.attributes?.position?.count || 0;
  return Math.max(1, Math.round(pos / 3));
}

function _totalTriangleCount(meshes) {
  let total = 0;
  for (const mesh of meshes) total += _triangleCount(mesh);
  return total;
}

/**
 * True when the GLB is a face/triangle dump (common for STEP→mesh “faceted”
 * previews): hundreds of tiny meshes instead of one mesh per solid body.
 */
function _isFaceFragmentedModel(meshes) {
  if (meshes.length < FACE_FRAGMENT_MESH_COUNT) return false;
  const sample = meshes.slice(0, Math.min(120, meshes.length));
  let tiny = 0;
  let trisTotal = 0;
  for (const mesh of sample) {
    const tris = _triangleCount(mesh);
    trisTotal += tris;
    if (tris <= 2) tiny += 1;
  }
  const tinyRatio = tiny / sample.length;
  const avgTris = trisTotal / sample.length;
  // OCC/STEP face dumps often land as ~80–400 meshes with tens of tris each
  // (revolved solids, Arduino boards). Treat those as fragmented so we skip
  // edges/silhouettes and rainbow-per-face banding that looks like wire contours.
  return (
    tinyRatio >= 0.55
    || (meshes.length >= 200 && avgTris <= 4)
    || (meshes.length >= 80 && avgTris <= 40)
  );
}

/**
 * Context-aware solid body colour from filename / prompt hint.
 * Chess pieces → ivory or near-black; otherwise null (use CAD palette).
 */
function _contextBodyColor(hint = "") {
  const text = String(hint || "").toLowerCase().replace(/[_\-./]+/g, " ");
  if (!text.trim()) return null;
  const isChess = /\b(chess|pawn|rook|knight|bishop|queen|king|staunton|checker|draught)\b/.test(text);
  if (isChess) {
    if (/\b(black|dark|ebony|noir)\b/.test(text)) return new THREE.Color("#2a2a2e");
    if (/\b(white|light|ivory|cream)\b/.test(text)) return new THREE.Color("#e8e0d4");
    // Default chess set look: polished ivory plastic (reads on dark canvas).
    return new THREE.Color("#e4d9c8");
  }
  if (/\b(dice|die|domino)\b/.test(text)) return new THREE.Color("#f2f0ea");
  if (/\b(golf\s*tee|billiard|pool\s*ball)\b/.test(text)) return new THREE.Color("#f0ebe3");
  return null;
}


function shopColorForPart(name = "") {
  const text = String(name).toLowerCase().replace(/[_\-./]+/g, " ");
  if (/\b(rubber|gasket|seal|tire|belt)\b/.test(text)) return new THREE.Color("#303438");
  if (/\b(brass|bronze)\b/.test(text)) return new THREE.Color("#c4a574");
  if (/\b(copper)\b/.test(text)) return new THREE.Color("#b87333");
  if (/\b(steel|bolt|screw|nut|washer|bearing)\b/.test(text)) return new THREE.Color("#8a939d");
  if (/\b(pom|nylon|plastic)\b/.test(text)) return new THREE.Color("#d9d3c7");
  return new THREE.Color("#c0c6cc");
}

/** CAD Viewer workbench fills (`themeSettings.js` WORKBENCH_FILL_COLORS). */
const CAD_PART_PALETTE = [
  new THREE.Color("#c4c4c4"),
  new THREE.Color("#f4a7a7"),
  new THREE.Color("#f8c77e"),
  new THREE.Color("#f7e38d"),
  new THREE.Color("#b9e88f"),
  new THREE.Color("#8fe3c0"),
  new THREE.Color("#92d7f5"),
  new THREE.Color("#a9b8ff"),
  new THREE.Color("#c7a8ff"),
  new THREE.Color("#f2a7d9"),
];

/** When true, never build CAD edge/silhouette extras (VR / Quest path). */
let _xrSkipCadExtras = false;

// ─── helpers ──────────────────────────────────────────────────────────────────

function _edgeColorFor(_bodyColor) {
  return new THREE.Color(FUSION.edge);
}

function _paintCadEdgeMaterial(mat) {
  if (!mat?.color) return;
  mat.color.set(FUSION.edge);
  mat.needsUpdate = true;
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
  // glTF / OCC default white — not an authored shop finish.
  if (avg > 0.88 && chroma < 0.06) return true;
  // Flat exporter greys (cadpy 0.72, vertex AO). Do NOT use chroma<0.08:
  // aluminum #c0c6cc / steel #8a939d / black oxide sit in that band and must stay.
  if (chroma < 0.02 && avg >= 0.38 && avg <= 0.82) return true;
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
  // Face dumps used to require 12% saturated faces, then paint the rest one
  // CAD grey — that wiped every project's authored Onshape / Fusion colors.
  return meshInfos.some(({ info }) => (
    info.hasColor
    && info.source !== "fallback"
    && !info.washed
    && _luminance(info.color) >= 0.12
  ));
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

/**
 * Studio look presets. Default `neutral` keeps look-dev contrast (warm key,
 * cool fill) but drops the teal/cyan rim+under lights that tinted every
 * metal green. `jake` matches text-to-cad workbench-dark (#181f28) + white
 * / slate workbench lights from themeSettings.js.
 */
export const VIEWPORT_LOOK_PRESETS = Object.freeze({
  jake: {
    id: "jake",
    label: "Jake CAD",
    hint: "text-to-cad workbench-dark canvas and slate studio lights.",
    canvas: 0x181f28,
    hemiSky: 0xffffff,
    hemiGround: 0x333d4b,
    ambient: 0xdfe7f0,
    key: 0xffffff,
    fill: 0xc5ced8,
    rim: 0xd7dee6,
    accent: 0xffe2ba,
    under: 0xc8d2dc,
    envIntensity: 0.95,
    swatch: "#d7dee6",
  },
  neutral: {
    id: "neutral",
    label: "Neutral studio",
    hint: "Same look-dev character, no teal wash.",
    canvas: 0x0d1117,
    hemiSky: 0xf2f4f7,
    hemiGround: 0x1a2030,
    ambient: 0xffffff,
    key: 0xfff2d6,
    fill: 0xd5dae3,
    rim: 0xe4e8ee,
    accent: 0xffc294,
    under: 0xcdd3db,
    envIntensity: 1.05,
    swatch: "#e4e8ee",
  },
  warm: {
    id: "warm",
    label: "Warm key",
    hint: "Amber key and bounce, still no cyan rim.",
    canvas: 0x100e0c,
    hemiSky: 0xfff4e8,
    hemiGround: 0x2a221c,
    ambient: 0xfff6ee,
    key: 0xffe4c4,
    fill: 0xe8d8c8,
    rim: 0xf0e6dc,
    accent: 0xffc294,
    under: 0xe0d0c0,
    envIntensity: 1.0,
    swatch: "#ffe4c4",
  },
  cool: {
    id: "cool",
    label: "Cool slate",
    hint: "Desaturated blue-slate, not teal.",
    canvas: 0x0c1016,
    hemiSky: 0xe8eef4,
    hemiGround: 0x1a222c,
    ambient: 0xe8eef4,
    key: 0xf4f7fb,
    fill: 0xc8d2de,
    rim: 0xd4dce6,
    accent: 0xd8c4b0,
    under: 0xc0cad4,
    envIntensity: 1.0,
    swatch: "#c8d2de",
  },
});

export const DEFAULT_VIEWPORT_LOOK_ID = "jake";
let _viewportLook = { ...VIEWPORT_LOOK_PRESETS[DEFAULT_VIEWPORT_LOOK_ID] };

export function getViewportLook() {
  return { ..._viewportLook };
}

function _lookCanvasHex() {
  return Number(_viewportLook.canvas) || FUSION.lookdevCanvas;
}

export function syncViewportLookBackground(scene = _litScene) {
  const target = scene || _litScene;
  if (!target) return;
  // Cheap clear color only — no gradient texture, extra mesh, or extra pass.
  if (_lookdevBgTexture) {
    _lookdevBgTexture.dispose?.();
    _lookdevBgTexture = null;
  }
  const hex = _lookCanvasHex();
  if (target.background?.isColor && typeof target.background.setHex === "function") {
    target.background.setHex(hex);
  } else {
    target.background = new THREE.Color(hex);
  }
  if (_litRenderer?.setClearColor) _litRenderer.setClearColor(hex, 1);
}

function _ensureRoomEnvironment(scene, renderer) {
  if (_roomEnvTexture) return _roomEnvTexture;
  if (!renderer || !scene) return null;
  // PMREM IBL OOMs Quest / constrained WebGL. Desktop look-dev needs it or
  // MeshStandardMaterial metals/plastics shade charcoal with no albedo.
  if (_xrSkipCadExtras || isConstrainedWebGLViewport()) return null;
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
export function setViewportShadingMode(mode, { scene = _litScene, renderer = _litRenderer, force = false } = {}) {
  const next = (mode === "lookdev" || mode === "mesh" || mode === "shaded" || mode === "authored" || mode === "pbr")
    ? "lookdev"
    : "cad";
  if (!scene) return next;
  _litScene = scene;
  if (renderer) _litRenderer = renderer;

  const alreadyOn = viewportShadingMode === next
    && !!_cadLightGroup
    && !!_lookdevLightGroup
    && _cadLightGroup.visible === (next === "cad")
    && _lookdevLightGroup.visible === (next === "lookdev");
  // Re-entering the same mode used to reset look-dev intensities / IBL on every
  // CAD·Imagine·stylelet load, which looked like the models were refreshing.
  if (alreadyOn && !force) return next;

  viewportShadingMode = next;
  if (_cadLightGroup) _cadLightGroup.visible = next === "cad";
  if (_lookdevLightGroup) _lookdevLightGroup.visible = next === "lookdev";

  if (next === "lookdev") {
    const env = _ensureRoomEnvironment(scene, renderer || _litRenderer);
    scene.environment = env || null;
    if ("environmentIntensity" in scene) {
      scene.environmentIntensity = env ? (Number(_viewportLook.envIntensity) || 1.05) : 1;
    }
    syncViewportLookBackground(scene);
    if (_litRenderer) {
      _litRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      _litRenderer.toneMappingExposure = isConstrainedWebGLViewport() ? 1.15 : 1.0;
    }
    if (shadowFloor?.material) {
      shadowFloor.material.opacity = FUSION.lookdevShadowOpacity;
      shadowFloor.material.needsUpdate = true;
    }
    applyLookdevMobileFallback({
      scene,
      lookdevGroup: _lookdevLightGroup,
      hasEnv: !!env,
    });
  } else {
    scene.environment = null;
    if ("environmentIntensity" in scene) scene.environmentIntensity = 1;
    // Canvas color is owned by the Grid ▾ scene look (dark / light) in app.js.-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1-20260915-xragent3
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
  hemi.userData.cadOrbitKeep = true;
  hemi.userData.lookRole = "hemi";
  _cadLightGroup.add(hemi);

  const ambient = new THREE.AmbientLight(0xe6eef6, 0.48);
  ambient.userData.cadOrbitKeep = true;
  ambient.userData.lookRole = "ambient";
  _cadLightGroup.add(ambient);

  const key = new THREE.DirectionalLight(0xfff5ec, 1.12);
  key.position.set(5, -5, 9);
  key.userData.cadOrbitKeep = true;
  key.userData.lookRole = "key";
  key.castShadow = false;
  _cadLightGroup.add(key);

  const fill = new THREE.DirectionalLight(0xd5dae3, 0.74);
  fill.position.set(-6, 5, 5);
  fill.userData.lookRole = "fill";
  _cadLightGroup.add(fill);

  const rim = new THREE.DirectionalLight(0xe4e8ee, 0.52);
  rim.position.set(1, 8, -7);
  rim.userData.lookRole = "rim";
  _cadLightGroup.add(rim);

  const front = new THREE.DirectionalLight(0xf4f8fc, 0.44);
  front.position.set(0, 0, 12);
  front.userData.lookRole = "front";
  _cadLightGroup.add(front);

  const under = new THREE.DirectionalLight(0xe4e8ee, 0.58);
  under.position.set(0, 0, -9);
  under.userData.lookRole = "under";
  _cadLightGroup.add(under);

  const underLeft = new THREE.DirectionalLight(0xd5dae3, 0.40);
  underLeft.position.set(-6, 4, -5);
  underLeft.userData.lookRole = "fill";
  _cadLightGroup.add(underLeft);

  const underRight = new THREE.DirectionalLight(0xffefe3, 0.40);
  underRight.position.set(6, -4, -5);
  underRight.userData.lookRole = "accent";
  _cadLightGroup.add(underRight);

  const cavity = new THREE.DirectionalLight(0xffffff, 0.46);
  cavity.position.set(3, -3, 3);
  cavity.userData.lookRole = "key";
  _cadLightGroup.add(cavity);

  scene.add(_cadLightGroup);

  // Mesh / img2threejs look-dev — mirrors showcase default studio + cinematic rim.
  // Positions are Z-up (Render Studio), converted from the showcase's Y-up rig.
  _lookdevLightGroup = new THREE.Group();
  _lookdevLightGroup.name = "MeshLookdevLights";
  _lookdevLightGroup.visible = false;

  const ldHemi = new THREE.HemisphereLight(0xf2f4f7, 0x1a2030, 0.32);
  ldHemi.userData.cadOrbitKeep = true;
  ldHemi.userData.lookRole = "hemi";
  _lookdevLightGroup.add(ldHemi);

  const ldAmb = new THREE.AmbientLight(0xffffff, 0.05);
  ldAmb.userData.cadOrbitKeep = true;
  ldAmb.userData.lookRole = "ambient";
  _lookdevLightGroup.add(ldAmb);

  const ldKey = new THREE.DirectionalLight(0xfff2d6, 2.15);
  ldKey.position.set(-2.8, 2.6, 3.4);
  ldKey.userData.cadOrbitKeep = true;
  ldKey.userData.lookRole = "key";
  ldKey.castShadow = false;
  _lookdevLightGroup.add(ldKey);

  const ldFill = new THREE.DirectionalLight(0xd5dae3, 0.34);
  ldFill.position.set(3.2, 1.8, 1.2);
  ldFill.userData.lookRole = "fill";
  _lookdevLightGroup.add(ldFill);

  const ldRim = new THREE.DirectionalLight(0xe4e8ee, 0.85);
  ldRim.position.set(5.5, -4.5, 2.8);
  ldRim.userData.lookRole = "rim";
  _lookdevLightGroup.add(ldRim);

  const ldAccent = new THREE.PointLight(0xffc294, 10, 16, 2);
  ldAccent.position.set(0, -3.2, 2.0);
  ldAccent.userData.lookRole = "accent";
  _lookdevLightGroup.add(ldAccent);

  const ldUnder = new THREE.PointLight(0xcdd3db, 2.4, 10, 2);
  ldUnder.position.set(-1.4, 1.2, 0.35);
  ldUnder.userData.lookRole = "under";
  _lookdevLightGroup.add(ldUnder);

  scene.add(_lookdevLightGroup);

  if (renderer && !_xrSkipCadExtras && !isConstrainedWebGLViewport()) {
    _ensureRoomEnvironment(scene, renderer);
  }

  applyViewportLook(_viewportLook, { scene, persist: false });

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

function _parseLookColor(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (/^#?[0-9a-f]{6}$/i.test(text)) {
    return parseInt(text.replace("#", ""), 16);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _paintLookLights(group, look) {
  if (!group) return;
  group.traverse((child) => {
    if (!child?.isLight || !child.color) return;
    const role = String(child.userData?.lookRole || "");
    let hex = null;
    if (role === "hemi") {
      hex = look.hemiSky;
      if (child.groundColor && look.hemiGround != null) child.groundColor.setHex(look.hemiGround);
    } else if (role === "ambient") hex = look.ambient;
    else if (role === "key" || role === "front") hex = look.key;
    else if (role === "fill") hex = look.fill;
    else if (role === "rim") hex = look.rim;
    else if (role === "accent") hex = look.accent;
    else if (role === "under") hex = look.under;
    if (hex != null) child.color.setHex(hex);
  });
}

/**
 * Apply a named studio look (or custom light/background hexes) to CAD +
 * look-dev lights, IBL intensity, and the clear color. Does not restyle
 * authored materials (cadcolor2).
 */
export function applyViewportLook(next = {}, { scene = _litScene, renderer = _litRenderer, persist = false } = {}) {
  const presetId = String(next.id || next.preset || DEFAULT_VIEWPORT_LOOK_ID).toLowerCase();
  const base = VIEWPORT_LOOK_PRESETS[presetId] || VIEWPORT_LOOK_PRESETS[DEFAULT_VIEWPORT_LOOK_ID];
  _viewportLook = {
    ...base,
    id: base.id,
    canvas: _parseLookColor(next.canvas ?? next.bgHex ?? next.background, base.canvas),
    hemiSky: _parseLookColor(next.hemiSky ?? next.lightHex, base.hemiSky),
    hemiGround: _parseLookColor(next.hemiGround, base.hemiGround),
    ambient: _parseLookColor(next.ambient ?? next.lightHex, base.ambient),
    key: _parseLookColor(next.key, base.key),
    fill: _parseLookColor(next.fill ?? next.lightHex, base.fill),
    rim: _parseLookColor(next.rim ?? next.lightHex, base.rim),
    accent: _parseLookColor(next.accent, base.accent),
    under: _parseLookColor(next.under ?? next.lightHex, base.under),
    envIntensity: Number.isFinite(Number(next.envIntensity)) ? Number(next.envIntensity) : base.envIntensity,
  };
  if (next.lightHex) {
    const tint = _parseLookColor(next.lightHex, _viewportLook.fill);
    _viewportLook.lightHex = tint;
    _viewportLook.fill = tint;
    _viewportLook.rim = tint;
    _viewportLook.under = tint;
    _viewportLook.hemiSky = tint;
  } else {
    _viewportLook.lightHex = _viewportLook.fill;
  }
  FUSION.lookdevCanvas = _viewportLook.canvas;
  _paintLookLights(_cadLightGroup, _viewportLook);
  _paintLookLights(_lookdevLightGroup, _viewportLook);
  const target = scene || _litScene;
  if (target) {
    syncViewportLookBackground(target);
    if (viewportShadingMode === "lookdev" && "environmentIntensity" in target) {
      target.environmentIntensity = target.environment
        ? (Number(_viewportLook.envIntensity) || 1.05)
        : 1;
    }
  }
  if (renderer) _litRenderer = renderer;
  return getViewportLook();
}

const _cadEdgeMaterials = new Set();
const _cadEdgeResolution = new THREE.Vector2(1, 1);
const _cadEdgeSynced = new THREE.Vector2(-1, -1);
let _cadEdgeSyncedWidth = NaN;
let _cadOrbitLite = false;

function _cadEdgeLineWidth() {
  return _xrSkipCadExtras ? FUSION.xrEdgeWidth : FUSION.edgeWidth;
}

function _copyCadEdgeResolution(renderer, target) {
  if (!renderer || !target) return false;
  renderer.getSize(target);
  if (target.x < 2 || target.y < 2) return false;
  return true;
}

export function syncCadEdgeResolution(renderer, { force = false } = {}) {
  if (!renderer || !_cadEdgeMaterials.size) return;
  if (!_copyCadEdgeResolution(renderer, _cadEdgeResolution)) return;
  const width = _cadEdgeLineWidth();
  if (
    !force
    && _cadEdgeSynced.x === _cadEdgeResolution.x
    && _cadEdgeSynced.y === _cadEdgeResolution.y
    && _cadEdgeSyncedWidth === width
  ) return;
  _cadEdgeSynced.copy(_cadEdgeResolution);
  _cadEdgeSyncedWidth = width;
  for (const mat of _cadEdgeMaterials) {
    if (!mat?.resolution) continue;
    mat.resolution.set(_cadEdgeResolution.x, _cadEdgeResolution.y);
    if ("linewidth" in mat) mat.linewidth = width;
  }
}

/**
 * Trackball rotate used to hide fill/rim/cavity lights (and the contact shadow)
 * for a cheaper frame. That made the whole model go darker the moment you
 * clicked to turn. Keep full CAD / look-dev lighting; shadows stay off.
 */
export function setCadOrbitLite(on, { renderer = _litRenderer } = {}) {
  const next = !!on;
  if (renderer?.shadowMap) {
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.autoUpdate = false;
  }
  _cadOrbitLite = next;
  const restore = (group) => {
    if (!group) return;
    for (const child of group.children) {
      if (!child?.isLight) continue;
      child.visible = true;
    }
  };
  restore(_cadLightGroup);
  restore(_lookdevLightGroup);
  return _cadOrbitLite;
}

export function setupRenderer(renderer) {
  if (!renderer) return renderer;
  // PCFSoft 2048 recast every Trackball frame hitch CAD orbit. Lights-only studio.
  // Never throw — a missing shadowMap used to abort WebGL init and blank the viewport.
  try {
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      if (THREE.PCFSoftShadowMap != null) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
  } catch (err) {
    console.warn("setupRenderer", err);
  }
  _litRenderer = renderer;
  return renderer;
}

function _materialHasTextureMaps(mat) {
  if (!mat) return false;
  return !!(
    mat.map
    || mat.lightMap
    || mat.normalMap
    || mat.roughnessMap
    || mat.metalnessMap
    || mat.aoMap
    || mat.emissiveMap
    || mat.bumpMap
    || mat.envMap
    || mat.specularMap
  );
}

function _meshHasTextureMaps(mesh) {
  if (!mesh?.isMesh) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.some(_materialHasTextureMaps);
}

/**
 * True when the GLB authored a real surface colour — vertex COLOR_0 or a
 * non-default-white baseColor. Default glTF / OCC white is not authored.
 */
function _meshHasAuthoredSurfaceColor(mesh) {
  if (!mesh?.isMesh) return false;
  if (geometryHasVertexColors(mesh.geometry)) {
    const vertex = _sampleVertexColor(mesh.geometry);
    return !!(vertex && !_isNeutralOrWashed(vertex));
  }
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const mat of mats) {
    if (!mat?.color) continue;
    const c = mat.color;
    if (c.r === 0 && c.g === 0 && c.b === 0) continue;
    if (_isNeutralOrWashed(c)) continue;
    return true;
  }
  return false;
}

const TEXTURE_MAP_KEYS = [
  "map", "lightMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap",
  "emissiveMap", "bumpMap", "displacementMap", "alphaMap", "envMap",
  "specularMap",
];

/**
 * XR: keep wrap/PBR on `_xrMatBak` for desktop restore, bind CAD plastic now.
 * Maps stay unbound; Texture objects are not dispose()'d (Quest context).
 */
export function parkWrapMaterialsForXr(object3d) {
  if (!object3d) return object3d;
  // XR: re-bind parked desktop materials. Never dispose maps (Quest context).
  if (!shouldCloneXrPbrMaterials({ presenting: true })) {
    reviveXrParkedMaterials(object3d);
    return object3d;
  }
  object3d.traverse((child) => {
    if (!child?.isMesh || !child.material || child.userData?.xrDrop) return;
    if (child.userData.isSilhouette || child.userData.isEdge || child.userData.isFloor) return;
    if (!child.userData._xrMatBak) child.userData._xrMatBak = child.material;
    const src = Array.isArray(child.userData._xrMatBak)
      ? child.userData._xrMatBak[0]
      : child.userData._xrMatBak;
    const live = Array.isArray(child.material) ? child.material : [child.material];
    const liveHasMaps = live.some(_materialHasTextureMaps);
    const liveIsBak = child.material === child.userData._xrMatBak;
    if (!liveHasMaps && !liveIsBak) return;
    const keep = src?.color?.clone?.() || new THREE.Color(0xc4c9d4);
    const cad = new THREE.MeshStandardMaterial({
      color: keep,
      metalness: 0.08,
      roughness: 0.62,
      envMapIntensity: 0.22,
    });
    child.material = Array.isArray(child.material) ? live.map(() => cad.clone()) : cad;
  });
  disposeParkedWrapGpuFromObject(object3d);
  return object3d;
}

/** Drop pictured / PBR texture maps — keep solid material colors only (XR lite). */
export function stripTextureMaps(object3d) {
  if (!object3d) return object3d;
  object3d.traverse((child) => {
    if (!child?.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const key of TEXTURE_MAP_KEYS) {
        if (!mat[key]) continue;
        // Never dispose shared scene/PMREM envMap — null the slot only.
        if (key === "envMap") {
          mat[key] = null;
          continue;
        }
        try { mat[key].dispose?.(); } catch { /* ignore */ }
        mat[key] = null;
      }
      if ("envMapIntensity" in mat) mat.envMapIntensity = 0.28;
      mat.needsUpdate = true;
    }
  });
  return object3d;
}

/**
 * True when this tree should keep look-dev shading (RoomEnvironment IBL +
 * authored albedo) rather than Fusion CAD clay.
 *
 * Signals: Mesh / img2threejs filenames, texture-library maps, explicit
 * pipeline flags, vertex colors, or non-default-white baseColor. Default
 * glTF white still uses CAD plastic — look-dev without IBL used to shade
 * those charcoal/black, so uncolored STEP dumps stay on the CAD light rig.
 */
export function filenameLooksAuthored(filename = "") {
  let name = String(filename || "");
  try {
    name = decodeURIComponent(name.replace(/\+/g, " "));
  } catch {
    // keep raw
  }
  const lower = name.toLowerCase().replace(/\\/g, "/");
  if (lower.includes(".mesh.") || /\.mesh\.(mjs|js|glb)$/i.test(lower)) return true;
  // Mesh engine folder (img2threejs), including share URLs like /files/mesh/foo.glb
  if (/(?:^|\/)mesh\//.test(lower)) return true;
  return false;
}

export function prefersAuthoredShading(object3d, filename = "") {
  if (filenameLooksAuthored(filename) || filenameLooksAuthored(object3d?.name)) {
    return true;
  }
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
    // Shop-finish / Jake colourize writes baseColor or COLOR_0 — keep those
    // relative colours. CAD clay used to replace them with white / Fusion fill.
    if (_meshHasAuthoredSurfaceColor(child)) flagged = true;
  });
  return flagged;
}

/**
 * Keep authored Three.js / GLB materials (img2threejs). Do not rewrite to CAD plastic.
 */
export function applyAuthoredStyle(object3d) {
  if (!object3d) return object3d;
  object3d.userData.render3dStyle = "shaded";
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
        const edgeMats = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of edgeMats) {
          if (m) _cadEdgeMaterials.delete(m);
        }
        c.geometry?.dispose?.();
        edgeMats.forEach((m) => m?.dispose?.());
      }
    }
    child.castShadow = true;
    child.receiveShadow = true;
    child.visible = true;
    delete child.userData.cadInternalHidden;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const keepVertexColors = geometryHasVertexColors(child.geometry);
    for (const mat of mats) {
      if (!mat) continue;
      if (keepVertexColors && "vertexColors" in mat) {
        mat.vertexColors = true;
        if (mat.color && _isNeutralOrWashed(mat.color)) {
          mat.color.setHex(0xffffff);
        }
      }
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
      if (mat.userData?.render3dCadColorHex) {
        delete mat.userData.render3dCadColorHex;
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
export function applyViewportStyle(object3d, { filename = "", styleMode = "auto", syncViewportLights = false, skipCadExtras = false, skipEdges = false } = {}) {
  const mode = String(styleMode || "auto").toLowerCase();
  const presentingDom = typeof document !== "undefined"
    && !!document.body?.classList?.contains("xr-presenting");
  const xrLite = !!(skipCadExtras || _xrSkipCadExtras || presentingDom);
  // XR: rebind parked wrap / albedo — never dispose maps or upload new 2048s.
  // Do not walk/replace materials on the XR enter hot path.
  if (xrLite) {
    if (shouldRestyleCadMaterialsOnXrEnter()) {
      applyCadStyle(object3d, { filename, skipCadExtras: true, skipEdges: true });
      if (syncViewportLights) setViewportShadingMode("cad");
    }
    return object3d;
  }
  // "clay" is the only opt-in Fusion fill. Coloured GLBs keep look-dev even
  // when the caller asked for CAD — stacked CAD lights washed shop greys white.
  const forceClay = mode === "clay";
  const useAuthored = !forceClay && (
    mode === "shaded" || mode === "authored" || mode === "pbr"
    || prefersAuthoredShading(object3d, filename)
  );
  if (useAuthored) {
    applyAuthoredStyle(object3d);
    if (syncViewportLights) {
      setViewportShadingMode("lookdev");
      softenAuthoredEnvMaps(object3d, { hasEnv: !!_litScene?.environment });
    }
    return object3d;
  }
  // CAD / STEP keep feature edges in VR. Mesh/authored path above does not add them.
  applyCadStyle(object3d, { filename, skipCadExtras: xrLite, skipEdges });
  if (syncViewportLights) setViewportShadingMode("cad");
  return object3d;
}

// ─── shadow floor ─────────────────────────────────────────────────────────────

export function ensureShadowFloor(scene) {
  if (shadowFloor) return shadowFloor;
  const geo = new THREE.PlaneGeometry(40, 40);
  const mat = new THREE.ShadowMaterial({
    opacity: FUSION.shadowOpacity,
    depthWrite: false,
    depthTest: true,
    transparent: true,
  });
  shadowFloor = new THREE.Mesh(geo, mat);
  shadowFloor.receiveShadow = true;
  shadowFloor.castShadow = false;
  shadowFloor.renderOrder = -12;
  shadowFloor.userData.isFloor = true;
  shadowFloor.userData.isShadowFloor = true;
  shadowFloor.userData.xrDesktopChrome = true;
  scene.add(shadowFloor);
  return shadowFloor;
}

export function positionShadowFloor(scene, meshRoot) {
  const floor = ensureShadowFloor(scene);
  floor.rotation.x = 0;
  // Sit below the grid (z ≈ -0.002) so a shadowed quad cannot punch a hole in it.
  floor.position.set(0, 0, -0.006);
}

// ─── edge / silhouette helpers ────────────────────────────────────────────────

/** VR: turn off CAD edge + silhouette extras. */
export function setXrSkipCadExtras(on) {
  _xrSkipCadExtras = !!on;
  trimViewportLightsForXr(!!on);
}

/** Neutral XR lights: keep hemi/ambient/key, hide look-dev + extra CAD fills. */
export function trimViewportLightsForXr(presenting) {
  const on = !!presenting;
  if (_lookdevLightGroup) {
    if (on) _lookdevLightGroup.visible = false;
    else _lookdevLightGroup.visible = viewportShadingMode === "lookdev";
  }
  if (_cadLightGroup) {
    _cadLightGroup.visible = on ? true : viewportShadingMode === "cad";
    _cadLightGroup.traverse((child) => {
      if (!child?.isLight) return;
      const role = String(child.userData?.lookRole || "");
      const keep = !on
        || child.userData?.cadOrbitKeep === true
        || role === "hemi"
        || role === "ambient"
        || role === "key";
      child.visible = keep;
    });
  }
}

export function getXrSkipCadExtras() {
  return _xrSkipCadExtras;
}

/** Hide Fusion crease edges + silhouettes (do not dispose mid-frame — crashes Quest). */
export function stripCadExtras(object3d, { edges = true, silhouettes = true } = {}) {
  if (!object3d) return object3d;
  object3d.traverse((c) => {
    if ((silhouettes && c?.userData?.isSilhouette) || (edges && c?.userData?.isEdge)) {
      try { c.visible = false; } catch { /* ignore */ }
    }
  });
  return object3d;
}

function geometryHasVertexColors(geometry) {
  const attr = geometry?.attributes?.color;
  return attr && attr.count > 0;
}

/** Silhouette shells duplicate every mesh (~2–3× GPU RAM) and OOM Chromium/Quest.
 *  Crease LineSegments stay on — engineers need them on GLB in CAD, Render, and VR. */
const SKIP_CAD_SILHOUETTES = true;
const MAX_EDGE_VERTICES = 160000;

function smoothDisplayGeometry(mesh) {
  const geo = mesh.geometry;
  if (!geo) return;
  if (geo.userData?.render3dCreasedNormals) return;
  // Keep exported CAD normals (per-face OCC / VibeCAD Coin3D style).
  // computeVertexNormals() averages across sharp rims and looks melted.
  if (geo.attributes?.normal?.count) {
    geo.userData = { ...(geo.userData || {}), render3dCreasedNormals: true };
    return;
  }
  if (_xrSkipCadExtras) {
    try { geo.computeVertexNormals(); } catch { /* ignore */ }
    geo.userData = { ...(geo.userData || {}), render3dCreasedNormals: true };
    return;
  }
  const creased = toCreasedNormals(geo, THREE.MathUtils.degToRad(FUSION.edgeThresholdDeg));
  creased.userData = { ...(geo.userData || {}), render3dCreasedNormals: true };
  mesh.geometry = creased;
  if (creased !== geo) {
    try { geo.dispose(); } catch { /* ignore */ }
  }
}

function addVisibleEdges(mesh) {
  if (!shouldSyncCadEdgesWhilePresenting({ presenting: _xrSkipCadExtras })) return;
  if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh) return;
  const geo = mesh.geometry;
  if (!geo || mesh.userData.isFloor || mesh.userData.isSilhouette || mesh.userData.isEdge) return;
  if (mesh.children?.some((c) => c?.userData?.isEdge)) return;

  const tris = _triangleCount(mesh);
  const triCap = _xrSkipCadExtras ? 80000 : 180000;
  if (tris < 2 || tris >= triCap) return;

  let edgeGeo;
  try {
    edgeGeo = new THREE.EdgesGeometry(geo, FUSION.edgeThresholdDeg);
  } catch {
    return;
  }
  const rawPos = edgeGeo.attributes?.position?.array;
  const verts = edgeGeo.attributes?.position?.count || 0;
  if (verts < 4 || verts > MAX_EDGE_VERTICES || !rawPos) {
    try { edgeGeo.dispose(); } catch { /* ignore */ }
    return;
  }

  let edgePos = weldColinearEdgePositions(rawPos);
  try {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const diag = bb ? bb.min.distanceTo(bb.max) : 0;
    if (diag > 0) edgePos = pruneShortEdgeSegments(edgePos, diag * 2e-4);
  } catch { /* keep welded */ }
  const weldedVerts = (edgePos?.length || 0) / 3;
  if (weldedVerts < 4) {
    try { edgeGeo.dispose(); } catch { /* ignore */ }
    return;
  }

  const bodyColor = _bodyColorOf(mesh);
  const edgeColor = _edgeColorFor(bodyColor);
  const lineWidth = _cadEdgeLineWidth();
  let crease = null;
  try {
    const fatGeo = new LineSegmentsGeometry();
    fatGeo.setPositions(edgePos);
    const mat = new LineMaterial({
      color: edgeColor,
      linewidth: lineWidth,
      transparent: false,
      depthTest: true,
      depthWrite: false,
      worldUnits: false,
      alphaToCoverage: true,
    });
    if (_litRenderer && _copyCadEdgeResolution(_litRenderer, _cadEdgeResolution)) {
      mat.resolution.set(_cadEdgeResolution.x, _cadEdgeResolution.y);
    } else {
      mat.resolution.set(window.innerWidth || 1280, window.innerHeight || 720);
    }
    _cadEdgeMaterials.add(mat);
    crease = new LineSegments2(fatGeo, mat);
    try { edgeGeo.dispose(); } catch { /* ignore */ }
  } catch {
    try {
      edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
    } catch { /* keep tessellated EdgesGeometry */ }
    crease = new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({
        color: edgeColor,
        depthTest: true,
        depthWrite: false,
        transparent: false,
        opacity: 1,
      }),
    );
  }
  crease.userData.isEdge = true;
  crease.renderOrder = 8;
  crease.raycast = () => {};
  crease.visible = true;
  mesh.add(crease);

  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const mat of mats) {
    if (!mat) continue;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = Math.max(Number(mat.polygonOffsetFactor) || 0, 2);
    mat.polygonOffsetUnits = Math.max(Number(mat.polygonOffsetUnits) || 0, 2);
    mat.needsUpdate = true;
  }

  if (SKIP_CAD_SILHOUETTES || _xrSkipCadExtras) return;

  const silColor = _silhouetteColorFor(bodyColor);
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
    // Aluminum / Fusion-fill-adjacent shop greys are authored — do not skip
    // them just because they sit near FUSION.body (that painted CAD clay).
    if (_isNeutralOrWashed(c)) continue;
    return c.clone();
  }
  return null;
}

/**
 * Apply Fusion/Onshape-style CAD rendering to every mesh in the tree.
 *
 * Colour is assigned per solid body / object — never per triangle. Face-dumped
 * STEP→GLB previews (one mesh per BRep face) get a single plastic colour.
 * Optional `filename` / prompt hint picks context colours (e.g. chess → ivory).
 */
export function applyCadStyle(object3d, { filename = "", skipCadExtras = false, skipEdges = false } = {}) {
  object3d.userData.render3dStyle = "cad";
  const presentingDom = typeof document !== "undefined"
    && !!document.body?.classList?.contains("xr-presenting");
  const xrLite = !!(skipCadExtras || _xrSkipCadExtras || presentingDom);
  // VR / Quest: never restyle every mesh on enter — that hitch/OOMs large CAD.
  // Edges are parked by viewport-xr progressive unhide, not a full-tree walk here.
  if (xrLite) {
    if (!shouldRestyleCadMaterialsOnXrEnter()) return object3d;
    stripCadExtras(object3d, { edges: true, silhouettes: true });
    parkWrapMaterialsForXr(object3d);
    return object3d;
  }
  const meshes = [];
  object3d.traverse((child) => {
    if (!child.isMesh || !child.geometry || child.userData.isSilhouette) return;
    if (child.userData.isEdge || child.isLineSegments2) return;
    meshes.push(child);
  });

  const meshInfos = meshes.map((mesh) => ({ mesh, info: _meshColorInfo(mesh) }));
  const faceFragmented = _isFaceFragmentedModel(meshes);
  const preserveFragmentColors = faceFragmented && _hasPreservableFragmentColors(meshInfos);
  const hasTextureMaps = meshes.some(_meshHasTextureMaps);
  if (hasTextureMaps) {
    return applyAuthoredStyle(object3d);
  }
  // Keep relative shop / vertex colours + look-dev IBL. Replacing with CAD
  // clay (or Fusion fill) is what made coloured GLBs read all-white.
  if (meshes.some(_meshHasAuthoredSurfaceColor)) {
    return applyAuthoredStyle(object3d);
  }
  const highFragmentModel = faceFragmented || meshes.length > HIGH_FRAGMENT_MESH_COUNT;
  const denseTriModel = !faceFragmented && _totalTriangleCount(meshes) >= HIGH_TRIANGLE_EDGE_SKIP;
  // Per-mesh palette only for real multi-body assemblies, not triangle/face dumps.
  const usePalette = !faceFragmented && !denseTriModel && _useGeneratedPalette(meshInfos);
  const contextHint = [
    filename,
    object3d?.name,
    object3d?.userData?.label,
    object3d?.userData?.prompt,
    object3d?.userData?.catalogName,
  ].filter(Boolean).join(" ");
  const contextColor = _contextBodyColor(contextHint);
  const forceSolid = faceFragmented || !!contextColor;
  const { hide: hideInternals, shellBias } = faceFragmented
    ? { hide: new Set(), shellBias: new Set() }
    : _classifyOverlappingInternals(meshInfos);

  // One shared material for face dumps / context solids — identical colour.
  let sharedFaceMaterial = null;
  let sharedFaceBodyColor = null;
  if (forceSolid && !preserveFragmentColors) {
    sharedFaceBodyColor = (contextColor || CAD_PART_PALETTE[0]).clone();
    sharedFaceMaterial = new THREE.MeshStandardMaterial({
      color: sharedFaceBodyColor,
      metalness: FUSION.bodyMetalness,
      roughness: FUSION.bodyRoughness,
      emissive: new THREE.Color(FUSION.bodyEmissive),
      emissiveIntensity: FUSION.bodyEmissiveIntensity,
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
    // Dense CAD tessellations: keep crease / exported normals. Recomputing
    // vertex normals here is what made VibeCAD/Jake parts look melted.

    if (forceSolid && sharedFaceMaterial) {
      child.material = sharedFaceMaterial;
      _rememberCadColor(child, child.material, sharedFaceBodyColor);
      if (!skipEdges && meshes.length <= 600) addVisibleEdges(child);
      return;
    }

    const paletteColor = (contextColor || shopColorForPart(child.name)).clone();
    const vertexColors = geometryHasVertexColors(child.geometry);
    const shouldPaletteColor = (usePalette || !!contextColor) && (
      !info.hasColor || info.tooDark || info.washed || info.source === "fallback"
      || (info.source === "vertex" && info.washed)
      || !!contextColor
    );

    // Strip baked monochrome vertex tints — they fight MeshStandard lighting.
    const keepVertexColors = !shouldPaletteColor && vertexColors && !info.washed && info.source === "vertex";

    const existingMats = Array.isArray(child.material) ? child.material : [child.material];
    // Desktop: keep textured wraps. XR lite already stripped maps above.
    if (existingMats.some(_materialHasTextureMaps) && !(skipCadExtras || _xrSkipCadExtras)) {
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

    const bodyColor = contextColor
      ? contextColor.clone()
      : shouldPaletteColor
      ? paletteColor
      : keepVertexColors
        ? new THREE.Color(0xffffff)
        : (origColor && !info.washed)
          ? origColor
          : new THREE.Color(FUSION.body);

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
      emissive: new THREE.Color(FUSION.bodyEmissive),
      emissiveIntensity: FUSION.bodyEmissiveIntensity,
      flatShading: false,
      side: denseTriModel ? THREE.DoubleSide : THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor,
      polygonOffsetUnits,
      envMapIntensity: denseTriModel ? 0.42 : 0.28,
    });
    _rememberCadColor(child, child.material, bodyColor);

    if (!skipEdges && meshes.length <= 600) addVisibleEdges(child);
  });

  reapplyViewMode(object3d);
  return object3d;
}

/** First-paint skip: add Fusion crease edges after the mesh is on screen. No-op in XR. */
export function ensureCadEdges(object3d) {
  if (!object3d) return object3d;
  const presentingDom = typeof document !== "undefined"
    && !!document.body?.classList?.contains("xr-presenting");
  if (_xrSkipCadExtras || presentingDom) return object3d;
  const meshes = [];
  object3d.traverse((child) => {
    if (!child.isMesh || !child.geometry || child.userData.isSilhouette) return;
    if (child.userData.isEdge || child.isLineSegments2) return;
    meshes.push(child);
  });
  if (meshes.length > 600) return object3d;
  for (const mesh of meshes) addVisibleEdges(mesh);
  return object3d;
}

export function disposeStyledModel(object3d) {
  if (!object3d) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  object3d.traverse((c) => {
    if (c.geometry && !geometries.has(c.geometry)) {
      geometries.add(c.geometry);
      try { c.geometry.dispose(); } catch { /* ignore */ }
    }
    if (c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach((m) => {
        if (!m || materials.has(m)) return;
        materials.add(m);
        _cadEdgeMaterials.delete(m);
        for (const key of TEXTURE_MAP_KEYS) {
          // Skip envMap — often a shared scene/PMREM IBL, not owned by this mesh.
          if (key === "envMap") continue;
          const tex = m[key];
          if (!tex || textures.has(tex)) continue;
          textures.add(tex);
          try { tex.dispose(); } catch { /* ignore */ }
          m[key] = null;
        }
        try { m.dispose(); } catch { /* ignore */ }
      });
    }
  });
}

// ─── wireframe toggle ─────────────────────────────────────────────────────────

/** @type {'solid' | 'wireframe'} */
export let viewMode = "solid";

function meshHasFeatureEdges(mesh) {
  return !!mesh?.children?.some((c) => c?.userData?.isEdge);
}

export function setViewMode(mode, object3d) {
  viewMode = mode === "wireframe" ? "wireframe" : "solid";
  if (!object3d) return;
  if (viewMode === "wireframe") ensureCadEdges(object3d);
  object3d.traverse((child) => {
    if (child.userData.isEdge) {
      if (child.parent?.userData?.cadInternalHidden) {
        child.visible = false;
        return;
      }
      _paintCadEdgeMaterial(child.material);
      child.visible = true;
      return;
    }
    if (child.userData.isSilhouette) {
      if (child.parent?.userData?.cadInternalHidden) {
        child.visible = false;
        return;
      }
      child.visible = viewMode === "solid";
      return;
    }
    if (child.userData?.cadInternalHidden) {
      child.visible = false;
      return;
    }
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const hasFeatureEdges = meshHasFeatureEdges(child);
    for (const mat of mats) {
      _restoreCadColorIfNeutral(child, mat);
      if (hasFeatureEdges) {
        // Wire mode uses the welded CAD crease layer, never GLB triangle edges.
        mat.wireframe = false;
        if (viewMode === "wireframe") {
          mat.transparent = true;
          mat.opacity = 0.38;
          mat.depthWrite = false;
        } else {
          mat.transparent = false;
          mat.opacity = 1;
          mat.depthWrite = true;
        }
      } else if (viewMode === "wireframe") {
        // Skinned, instanced, or oversized meshes may not support feature-edge
        // extraction. Keep their surface readable instead of showing triangles.
        mat.wireframe = false;
        mat.transparent = false;
        mat.opacity = 1;
        mat.depthWrite = true;
      } else {
        mat.wireframe = false;
        mat.transparent = false;
        mat.opacity = 1;
        mat.depthWrite = true;
      }
      mat.needsUpdate = true;
    }
  });
}

export function reapplyViewMode(object3d) {
  setViewMode(viewMode, object3d);
}

// ─── click-to-transparent (viewport + share preview) ──────────────────────────

// High enough to keep overlapping solids readable at joints; low enough to see through.
const TRANSPARENT_SURFACE_OPACITY = 0.58;
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
    color: mat.color ? mat.color.clone() : new THREE.Color(FUSION.edge),
    linewidth: mat.linewidth ?? 1,
  });
}

function objectSurfaceMeshes(object3d) {
  const meshes = [];
  object3d?.traverse?.((child) => {
    if (!child.isMesh || child.userData?.isEdge || child.userData?.isSilhouette) return;
    if (child.isLineSegments2 || child.userData?.cadInternalHidden) return;
    meshes.push(child);
  });
  return meshes;
}

function applyTransparentSurface(mat, transparentOn, { wireframe = false } = {}) {
  if (!mat) return;
  ensureMaterialBase(mat);
  const base = materialBaseState.get(mat) || {};
  // CAD ghost+crease path keeps triangle wireframe off via the caller. Dense Mesh
  // / CAD-without-edges still needs mat.wireframe so Wireframe is visible.
  mat.wireframe = !!(wireframe || base.wireframe);
  if (transparentOn) {
    mat.transparent = true;
    mat.opacity = TRANSPARENT_SURFACE_OPACITY;
    // Don't write depth — overlapping triangles in one body turn into black creases.
    mat.depthWrite = false;
    mat.depthTest = true;
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
      // Back-face shells fill the interior and hide how two parts mate.
      child.visible = !transparentOn && viewMode !== "wireframe";
      continue;
    }
    if (!child.userData?.isEdge || !child.material) continue;
    ensureEdgeBase(child);
    const mat = child.material;
    const base = edgeBaseState.get(mat) || {};
    if (transparentOn) {
      // Dense crease ink (finger joints, internals) reads as a black scribble.
      // Hide it while ghosted so mating faces stay visible through the glass.
      child.visible = false;
    } else {
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthTest = base.depthTest !== false;
      mat.depthWrite = false;
      _paintCadEdgeMaterial(mat);
      child.renderOrder = 8;
      child.visible = true;
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
    ownMeshMaterials(mesh);
    const cadGhost = viewMode === "wireframe" && meshHasFeatureEdges(mesh);
    for (const mat of meshMaterials(mesh)) {
      _restoreCadColorIfNeutral(mesh, mat);
      applyTransparentSurface(mat, transparentOn, {
        wireframe: !!wireframe && !cadGhost,
      });
    }
    applyTransparentEdges(mesh, transparentOn);
  }
  object3d.traverse?.((child) => {
    if (child.userData?.isSection) return;
    if (child.userData?.isSilhouette) {
      child.visible = !transparentOn && viewMode !== "wireframe";
      return;
    }
    if (child.userData?.isEdge) child.visible = !transparentOn;
  });
}

/** Re-sync surface + edge styling for nodes already marked transparent. */
export function syncTransparentObject(object3d, { wireframe = false } = {}) {
  if (!object3d) return;
  setObjectTransparent(object3d, !!object3d.userData?.render3dTransparent, { wireframe });
}
