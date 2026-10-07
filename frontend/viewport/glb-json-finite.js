/**
 * RFC 8259 JSON helpers for glTF/GLB payloads.
 *
 * Python `json.dumps` and some mesh exporters write a bare `Infinity` for empty
 * or overflowed bounding boxes. `JSON.parse` rejects that (`Unexpected token 'I'`).
 */

const NONFINITE_TOKEN = /-Infinity\b|\bInfinity\b|\bNaN\b/g;

export function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function finiteBbox(min, max, fallback = 0) {
  const toXyz = (values) => {
    const list = Array.isArray(values) ? values : [];
    const out = list.slice(0, 3).map((v) => finiteNumber(v, fallback));
    while (out.length < 3) out.push(fallback);
    return out;
  };
  const mn = toXyz(min);
  const mx = toXyz(max);
  for (let i = 0; i < 3; i += 1) {
    if (mx[i] < mn[i]) {
      const swap = mn[i];
      mn[i] = mx[i];
      mx[i] = swap;
    }
  }
  return { min: mn, max: mx };
}

export function parseJsonFinite(text, fallback = null) {
  const raw = String(text || "").trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    const repaired = raw.replace(NONFINITE_TOKEN, "null");
    try {
      return JSON.parse(repaired);
    } catch {
      throw err;
    }
  }
}

/**
 * GLTFLoader copies accessor min/max onto geometry.boundingBox / boundingSphere
 * and never recomputes from vertices. Replacing Infinity with 0 collapses that
 * axis, so frustum culling hides the real mesh until zoom brings the tiny box
 * into view (a larger “ghost” copy popping in and out).
 *
 * Drop invalid bounds and let the loader / BufferGeometry compute from verts.
 */
export function sanitizeGltfAccessors(gltf, _fallback = 0) {
  if (!gltf || !Array.isArray(gltf.accessors)) return false;
  let changed = false;
  for (const accessor of gltf.accessors) {
    if (!accessor || typeof accessor !== "object") continue;
    let drop = false;
    for (const key of ["min", "max"]) {
      const raw = accessor[key];
      if (!Array.isArray(raw) || !raw.length) continue;
      if (raw.some((v) => v == null || typeof v === "boolean" || !Number.isFinite(Number(v)))) drop = true;
    }
    if (!drop) continue;
    if ("min" in accessor) {
      delete accessor.min;
      changed = true;
    }
    if ("max" in accessor) {
      delete accessor.max;
      changed = true;
    }
  }
  return changed;
}

/**
 * Parse a GLB JSON chunk that may contain Infinity, then sanitize accessor bbox.
 * Returns `{ json, repaired }` or throws the original JSON.parse error.
 */
export function parseGlbJsonFinite(text) {
  const json = parseJsonFinite(text);
  const repaired = sanitizeGltfAccessors(json);
  return { json, repaired };
}

const GLB_JSON_CHUNK = 0x4e4f534a;
const MAX_GLB_JSON_BYTES = 8 * 1024 * 1024;

export function jsonTextNeedsSanitize(text) {
  return /Infinity|\bNaN\b/.test(String(text || ""));
}

/**
 * Read only the GLB JSON chunk from a Blob (never the BIN mesh).
 * Returns trimmed UTF-8 or null when the container is not a GLB.
 */
export async function readGlbJsonChunkText(blob, maxJsonBytes = MAX_GLB_JSON_BYTES) {
  if (!blob || typeof blob.slice !== "function") return null;
  const headerBuf = await blob.slice(0, 12).arrayBuffer();
  const header = new Uint8Array(headerBuf);
  if (
    header.length < 12
    || header[0] !== 0x67
    || header[1] !== 0x6c
    || header[2] !== 0x54
    || header[3] !== 0x46
  ) {
    return null;
  }
  const fileLen = new DataView(headerBuf).getUint32(8, true);
  let offset = 12;
  const limit = Math.min(fileLen || blob.size, blob.size);
  while (offset + 8 <= limit) {
    const chunkHead = await blob.slice(offset, offset + 8).arrayBuffer();
    if (chunkHead.byteLength < 8) return null;
    const cv = new DataView(chunkHead);
    const chunkLen = cv.getUint32(0, true);
    const chunkType = cv.getUint32(4, true);
    offset += 8;
    if (chunkType === GLB_JSON_CHUNK) {
      if (chunkLen <= 0 || chunkLen > maxJsonBytes) return null;
      const jsonBuf = await blob.slice(offset, offset + chunkLen).arrayBuffer();
      return new TextDecoder().decode(new Uint8Array(jsonBuf)).trim();
    }
    offset += chunkLen;
  }
  return null;
}
