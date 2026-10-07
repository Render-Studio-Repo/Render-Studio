/** Convert iPhone HEIC/HEIF photos to PNG so Chrome <img> and canvas can draw them. */

const HEIC_TYPE_RE = /^image\/hei[cf](?:-sequence)?$/i;
const HEIC_NAME_RE = /\.hei[cf]$/i;

export function isHeicImageFile(file) {
  if (!file) return false;
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "");
  if (HEIC_TYPE_RE.test(type)) return true;
  if (!HEIC_NAME_RE.test(name)) return false;
  return !type || type === "application/octet-stream" || type.startsWith("image/");
}

export function heicPngFilename(name) {
  const raw = String(name || "photo.heic").trim() || "photo.heic";
  if (HEIC_NAME_RE.test(raw)) return raw.replace(HEIC_NAME_RE, ".png");
  const stem = raw.replace(/\.[^.]+$/, "") || "photo";
  return `${stem}.png`;
}

async function canvasToPngFile(source, filename, { createCanvas } = {}) {
  const w = source.naturalWidth || source.width || 0;
  const h = source.naturalHeight || source.height || 0;
  if (w < 1 || h < 1) throw new Error("Could not read that HEIC photo.");
  const canvas = typeof createCanvas === "function"
    ? createCanvas()
    : (typeof document !== "undefined" ? document.createElement("canvas") : null);
  if (!canvas?.getContext) throw new Error("Could not convert HEIC to PNG.");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx?.drawImage) throw new Error("Could not convert HEIC to PNG.");
  ctx.drawImage(source, 0, 0, w, h);
  const blob = await new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error("Could not convert HEIC to PNG."));
      return;
    }
    canvas.toBlob((out) => {
      if (out) resolve(out);
      else reject(new Error("Could not convert HEIC to PNG."));
    }, "image/png");
  });
  return new File([blob], heicPngFilename(filename), { type: "image/png" });
}

async function loadHeic2Any(loader) {
  if (typeof loader === "function") return loader;
  if (typeof globalThis.heic2any === "function") return globalThis.heic2any;
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js");
    return mod.default || mod.heic2any || globalThis.heic2any;
  } catch {
    return null;
  }
}

export async function convertHeicFileToPng(file, opts = {}) {
  if (!file || !isHeicImageFile(file)) return file;
  try {
    return await decodeHeicFileToPng(file, opts);
  } catch (err) {
    const reason = String(err?.message || err || "unknown error").replace(/^Error:\s*/i, "");
    if (/Could not convert/i.test(reason)) throw (err instanceof Error ? err : new Error(reason));
    throw new Error(`Could not convert ${file.name || "HEIC photo"} to PNG. ${reason}`);
  }
}

async function decodeHeicFileToPng(file, opts = {}) {
  if (!file || !isHeicImageFile(file)) return file;
  const ImageCtor = opts.Image || (typeof Image !== "undefined" ? Image : null);
  const bitmapFn = opts.createImageBitmap || (typeof createImageBitmap === "function" ? createImageBitmap : null);
  if (typeof bitmapFn === "function") {
    try {
      const bmp = await bitmapFn(file);
      try {
        return await canvasToPngFile(bmp, file.name, opts);
      } finally {
        bmp.close?.();
      }
    } catch {
      /* Safari / Chrome often need <img> or heic2any */
    }
  }
  if (ImageCtor && typeof URL !== "undefined" && URL.createObjectURL) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new ImageCtor();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode"));
        el.src = url;
      });
      return await canvasToPngFile(img, file.name, opts);
    } catch {
      /* fall through */
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const heic2any = await loadHeic2Any(opts.heic2any);
  if (typeof heic2any === "function") {
    const converted = await heic2any({ blob: file, toType: "image/png" });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob) throw new Error("Could not convert that iPhone HEIC photo to PNG.");
    if (ImageCtor && typeof URL !== "undefined" && URL.createObjectURL) {
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise((resolve, reject) => {
          const el = new ImageCtor();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error("decode"));
          el.src = url;
        });
        return await canvasToPngFile(img, file.name, opts);
      } catch {
        /* decoded WASM PNG is already usable */
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return new File([blob], heicPngFilename(file.name), { type: "image/png" });
  }
  throw new Error(`Could not convert ${file.name || "HEIC photo"} to PNG. Export it as JPEG and try again.`);
}

export async function ensurePngImageFile(file, opts = {}) {
  if (!isHeicImageFile(file)) return file;
  return convertHeicFileToPng(file, opts);
}

export async function convertHeicIngestFiles(files, opts = {}) {
  const list = [...(files || [])].filter(Boolean);
  const out = [];
  for (const file of list) {
    out.push(await ensurePngImageFile(file, opts));
  }
  return out;
}

export { isHeicImageFile as isHeicFile };
