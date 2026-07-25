/**
 * Photoreal-ish texture wraps for the viewport.
 *
 * Render images are flat AI photos. This module:
 *  1. Projects them from the viewport camera onto the mesh (aligned wrap)
 *  2. Soft-de-lights baked shadows so studio lights can re-shade
 *  3. Derives normal + roughness (+ light metalness) maps from the albedo
 *  4. Builds MeshPhysicalMaterial (clearcoat / env response)
 */

import * as THREE from "three";

const _worldPos = new THREE.Vector3();
const _worldNrm = new THREE.Vector3();
const _viewDir = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _boxMin = new THREE.Vector3();
const _boxSize = new THREE.Vector3();

function configureColorMap(texture, { flipY = false, repeat = true } = {}) {
  if (!texture) return texture;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.max(Number(texture.anisotropy) || 1, 8);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.flipY = flipY;
  texture.needsUpdate = true;
  return texture;
}

function configureDataMap(texture, { flipY = false, repeat = true } = {}) {
  if (!texture) return texture;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.max(Number(texture.anisotropy) || 1, 8);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.flipY = flipY;
  texture.needsUpdate = true;
  return texture;
}

function drawImageToCanvas(image, maxSize = 1024) {
  const srcW = image.naturalWidth || image.width || 1;
  const srcH = image.naturalHeight || image.height || 1;
  const scale = Math.min(1, maxSize / Math.max(srcW, srcH));
  const w = Math.max(2, Math.round(srcW * scale));
  const h = Math.max(2, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not allocate texture canvas");
  ctx.drawImage(image, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

function boxBlurGray(src, w, h, radius = 6) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const r = Math.max(1, radius | 0);
  // Horizontal
  for (let y = 0; y < h; y += 1) {
    let sum = 0;
    const row = y * w;
    for (let x = -r; x <= r; x += 1) {
      const xx = Math.min(w - 1, Math.max(0, x));
      sum += src[row + xx];
    }
    for (let x = 0; x < w; x += 1) {
      tmp[row + x] = sum / (r * 2 + 1);
      const leave = Math.min(w - 1, Math.max(0, x - r));
      const enter = Math.min(w - 1, Math.max(0, x + r + 1));
      sum += src[row + enter] - src[row + leave];
    }
  }
  // Vertical
  for (let x = 0; x < w; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) {
      const yy = Math.min(h - 1, Math.max(0, y));
      sum += tmp[yy * w + x];
    }
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = sum / (r * 2 + 1);
      const leave = Math.min(h - 1, Math.max(0, y - r));
      const enter = Math.min(h - 1, Math.max(0, y + r + 1));
      sum += tmp[enter * w + x] - tmp[leave * w + x];
    }
  }
  return out;
}

/**
 * Soft-de-light + derive normal / roughness / metalness from a source image.
 * Returns THREE.CanvasTexture maps ready for MeshPhysicalMaterial.
 */
export function derivePbrMapsFromImage(image, {
  maxSize = 1024,
  delight = true,
  flipY = false,
  repeat = false,
} = {}) {
  const { canvas, ctx, w, h } = drawImageToCanvas(image, maxSize);
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    lum[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  }
  const blur = delight ? boxBlurGray(lum, w, h, Math.max(4, Math.round(Math.min(w, h) / 48))) : lum;
  const mid = 0.55;

  const albedo = ctx.createImageData(w, h);
  const normal = ctx.createImageData(w, h);
  const rough = ctx.createImageData(w, h);
  const metal = ctx.createImageData(w, h);

  const sampleLum = (x, y) => {
    const xx = Math.min(w - 1, Math.max(0, x));
    const yy = Math.min(h - 1, Math.max(0, y));
    return lum[yy * w + xx];
  };

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      const i = p * 4;
      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;
      if (delight) {
        const denom = Math.max(0.12, blur[p]);
        const gain = mid / denom;
        // Keep some baked lighting so it doesn't go flat/chalky.
        const mix = 0.62;
        r = r * ((1 - mix) + mix * gain);
        g = g * ((1 - mix) + mix * gain);
        b = b * ((1 - mix) + mix * gain);
      }
      albedo.data[i] = Math.min(255, Math.max(0, Math.round(r * 255)));
      albedo.data[i + 1] = Math.min(255, Math.max(0, Math.round(g * 255)));
      albedo.data[i + 2] = Math.min(255, Math.max(0, Math.round(b * 255)));
      albedo.data[i + 3] = 255;

      // Sobel normal from luminance (in texture space).
      const dx = (
        -sampleLum(x - 1, y - 1) - 2 * sampleLum(x - 1, y) - sampleLum(x - 1, y + 1)
        + sampleLum(x + 1, y - 1) + 2 * sampleLum(x + 1, y) + sampleLum(x + 1, y + 1)
      );
      const dy = (
        -sampleLum(x - 1, y - 1) - 2 * sampleLum(x, y - 1) - sampleLum(x + 1, y - 1)
        + sampleLum(x - 1, y + 1) + 2 * sampleLum(x, y + 1) + sampleLum(x + 1, y + 1)
      );
      const strength = 2.4;
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      normal.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      normal.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal.data[i + 3] = 255;

      const edge = Math.min(1, Math.hypot(dx, dy) * 4);
      // Smooth painted surfaces → lower roughness; busy detail → higher.
      const roughV = 0.28 + edge * 0.55 + (1 - lum[p]) * 0.12;
      const rv = Math.min(255, Math.max(0, Math.round(roughV * 255)));
      rough.data[i] = rv;
      rough.data[i + 1] = rv;
      rough.data[i + 2] = rv;
      rough.data[i + 3] = 255;

      const maxc = Math.max(r, g, b);
      const minc = Math.min(r, g, b);
      const sat = maxc > 1e-4 ? (maxc - minc) / maxc : 0;
      // Desaturated + bright → slight metal; colorful → dielectric.
      const metalV = Math.max(0, Math.min(0.55, (1 - sat) * maxc * 0.65 - 0.08));
      const mv = Math.round(metalV * 255);
      metal.data[i] = mv;
      metal.data[i + 1] = mv;
      metal.data[i + 2] = mv;
      metal.data[i + 3] = 255;
    }
  }

  const albedoCanvas = document.createElement("canvas");
  albedoCanvas.width = w;
  albedoCanvas.height = h;
  albedoCanvas.getContext("2d").putImageData(albedo, 0, 0);
  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = w;
  normalCanvas.height = h;
  normalCanvas.getContext("2d").putImageData(normal, 0, 0);
  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = w;
  roughCanvas.height = h;
  roughCanvas.getContext("2d").putImageData(rough, 0, 0);
  const metalCanvas = document.createElement("canvas");
  metalCanvas.width = w;
  metalCanvas.height = h;
  metalCanvas.getContext("2d").putImageData(metal, 0, 0);

  return {
    map: configureColorMap(new THREE.CanvasTexture(albedoCanvas), { flipY, repeat }),
    normalMap: configureDataMap(new THREE.CanvasTexture(normalCanvas), { flipY, repeat }),
    roughnessMap: configureDataMap(new THREE.CanvasTexture(roughCanvas), { flipY, repeat }),
    metalnessMap: configureDataMap(new THREE.CanvasTexture(metalCanvas), { flipY, repeat }),
    width: w,
    height: h,
  };
}

export function makePhysicalTexturedMaterial(maps, {
  clearcoat = 0.35,
  clearcoatRoughness = 0.32,
  envMapIntensity = 1.15,
  normalScale = 0.85,
} = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: maps?.map || null,
    normalMap: maps?.normalMap || null,
    roughnessMap: maps?.roughnessMap || null,
    metalnessMap: maps?.metalnessMap || null,
    roughness: 0.48,
    metalness: 0.18,
    clearcoat,
    clearcoatRoughness,
    envMapIntensity,
    side: THREE.DoubleSide,
  });
  if (mat.normalScale && Number.isFinite(normalScale)) {
    mat.normalScale.set(normalScale, normalScale);
  }
  return mat;
}

/**
 * Box / triplanar-style UVs in local space (library textures).
 */
export function applyBoxProjectionUvs(geometry, { tilesPerUnit = 0.004 } = {}) {
  if (!geometry?.attributes?.position) return geometry;
  const geom = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  geom.computeBoundingBox();
  if (!geom.attributes.normal) geom.computeVertexNormals();
  const pos = geom.attributes.position;
  const normal = geom.attributes.normal;
  const box = geom.boundingBox;
  box.getSize(_boxSize);
  _boxMin.copy(box.min);
  const sx = Math.max(_boxSize.x, 1e-6);
  const sy = Math.max(_boxSize.y, 1e-6);
  const sz = Math.max(_boxSize.z, 1e-6);
  const scale = Math.max(tilesPerUnit, 1e-5);
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(normal?.getX(i) || 0);
    const ny = Math.abs(normal?.getY(i) || 0);
    const nz = Math.abs(normal?.getZ(i) || 0);
    let u;
    let v;
    if (nx >= ny && nx >= nz) {
      u = (y - _boxMin.y) * scale;
      v = (z - _boxMin.z) * scale;
    } else if (ny >= nx && ny >= nz) {
      u = (x - _boxMin.x) * scale;
      v = (z - _boxMin.z) * scale;
    } else {
      u = (x - _boxMin.x) * scale;
      v = (y - _boxMin.y) * scale;
    }
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }
  const maxDim = Math.max(sx, sy, sz);
  if (maxDim * scale < 0.85) {
    const boost = 0.85 / Math.max(maxDim * scale, 1e-6);
    for (let i = 0; i < uvs.length; i += 1) uvs[i] *= boost;
  }
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geom;
}

/**
 * Project mesh verts through a perspective camera into UV space.
 * `crop` is normalized full-frame rect { x0,y0,x1,y1 } matching a cropped albedo
 * (y grows downward, matching canvas / flipY=false textures).
 *
 * Back-facing / off-frustum verts fall back to local box UVs so wraps don't smear.
 */
export function applyCameraProjectedUvs(geometry, mesh, camera, {
  crop = { x0: 0, y0: 0, x1: 1, y1: 1 },
  facingDot = 0.05,
  flipY = false,
} = {}) {
  if (!geometry?.attributes?.position || !mesh || !camera) {
    return applyBoxProjectionUvs(geometry);
  }
  const geom = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (!geom.attributes.normal) geom.computeVertexNormals();
  mesh.updateWorldMatrix(true, false);
  camera.updateMatrixWorld?.(true);
  camera.updateProjectionMatrix?.();

  const pos = geom.attributes.position;
  const normal = geom.attributes.normal;
  const uvs = new Float32Array(pos.count * 2);
  const x0 = Number(crop.x0) || 0;
  const y0 = Number(crop.y0) || 0;
  const x1 = Number(crop.x1) > x0 ? Number(crop.x1) : 1;
  const y1 = Number(crop.y1) > y0 ? Number(crop.y1) : 1;
  const spanX = Math.max(1e-6, x1 - x0);
  const spanY = Math.max(1e-6, y1 - y0);

  // Local box fallback
  geom.computeBoundingBox();
  const box = geom.boundingBox;
  box.getSize(_boxSize);
  _boxMin.copy(box.min);
  const sx = Math.max(_boxSize.x, 1e-6);
  const sy = Math.max(_boxSize.y, 1e-6);
  const sz = Math.max(_boxSize.z, 1e-6);

  const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);

  for (let i = 0; i < pos.count; i += 1) {
    _worldPos.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    _worldNrm.fromBufferAttribute(normal, i).transformDirection(mesh.matrixWorld).normalize();
    _viewDir.subVectors(camPos, _worldPos).normalize();
    const facing = _worldNrm.dot(_viewDir);

    _ndc.copy(_worldPos).project(camera);
    const inFrustum = Math.abs(_ndc.x) <= 1.15 && Math.abs(_ndc.y) <= 1.15 && _ndc.z >= -1 && _ndc.z <= 1;
    // flipY=false → v=0 at top of image
    let uFull = _ndc.x * 0.5 + 0.5;
    let vFull = flipY ? (_ndc.y * 0.5 + 0.5) : (0.5 - _ndc.y * 0.5);

    if (facing > facingDot && inFrustum) {
      let u = (uFull - x0) / spanX;
      let v = (vFull - y0) / spanY;
      // Soft clamp — keep a little bleed so edges don't cut hard.
      u = Math.min(1.08, Math.max(-0.08, u));
      v = Math.min(1.08, Math.max(-0.08, v));
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    } else {
      // Unseen / back: local box, remapped into a quiet corner so it doesn't
      // steal the hero projection (still better than a stretched smear).
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const nx = Math.abs(normal.getX(i));
      const ny = Math.abs(normal.getY(i));
      const nz = Math.abs(normal.getZ(i));
      let u;
      let v;
      if (nx >= ny && nx >= nz) {
        u = (y - _boxMin.y) / sy;
        v = (z - _boxMin.z) / sz;
      } else if (ny >= nx && ny >= nz) {
        u = (x - _boxMin.x) / sx;
        v = (z - _boxMin.z) / sz;
      } else {
        u = (x - _boxMin.x) / sx;
        v = (y - _boxMin.y) / sy;
      }
      uvs[i * 2] = 0.92 + u * 0.08;
      uvs[i * 2 + 1] = 0.92 + v * 0.08;
    }
  }
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geom;
}
