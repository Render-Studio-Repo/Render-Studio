import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  convertHeicFileToPng,
  convertHeicIngestFiles,
  ensurePngImageFile,
  heicPngFilename,
  isHeicFile,
  isHeicImageFile,
} from "./heic-to-png.js";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const canvas = readFileSync(join(here, "../viewport/canvas-mode.js"), "utf8");
const refs = readFileSync(join(here, "../components/reference-files.js"), "utf8");
const imagine = readFileSync(join(here, "../studio/imagine.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");

function fakePngCanvas() {
  return {
    width: 0,
    height: 0,
    getContext() { return { drawImage() {} }; },
    toBlob(cb) { cb(new Blob(["png"], { type: "image/png" })); },
  };
}

test("detects HEIC/HEIF by MIME or extension, including empty type", () => {
  assert.equal(isHeicImageFile({ name: "IMG_1234.HEIC", type: "image/heic" }), true);
  assert.equal(isHeicImageFile({ name: "scan.heif", type: "image/heif" }), true);
  assert.equal(isHeicImageFile({ name: "photo.heic", type: "" }), true);
  assert.equal(isHeicImageFile({ name: "photo.HEIF", type: "application/octet-stream" }), true);
  assert.equal(isHeicFile({ name: "IMG_0098.heic", type: "" }), true);
  assert.equal(isHeicImageFile({ name: "shot.png", type: "image/png" }), false);
  assert.equal(isHeicImageFile({ name: "notes.txt", type: "" }), false);
  assert.equal(isHeicImageFile({ name: "photo.jpg", type: "image/jpeg" }), false);
});

test("HEIC uploads are stored as .png", () => {
  assert.equal(heicPngFilename("IMG_0098.HEIC"), "IMG_0098.png");
  assert.equal(heicPngFilename("scan.heif"), "scan.png");
  assert.equal(heicPngFilename(""), "photo.png");
});

test("ensurePngImageFile leaves ordinary images alone and converts HEIC via the helper", async () => {
  const png = { name: "box.png", type: "image/png" };
  assert.equal(await ensurePngImageFile(png), png);
  const jpeg = { name: "shot.jpg", type: "image/jpeg" };
  assert.equal(await convertHeicFileToPng(jpeg), jpeg);
  const heic = { name: "phone.heic", type: "image/heic" };
  const out = await convertHeicFileToPng(heic, {
    createImageBitmap: async () => ({ width: 2, height: 2, close() {} }),
    createCanvas: fakePngCanvas,
  });
  assert.equal(out.name, "phone.png");
  assert.equal(out.type, "image/png");
});

test("convertHeicIngestFiles converts HEIC in a mixed drop and leaves JPEG/PNG", async () => {
  const png = { name: "box.png", type: "image/png" };
  const jpeg = { name: "shot.jpg", type: "image/jpeg" };
  const heic = { name: "IMG_1234.HEIC", type: "image/heic" };
  const out = await convertHeicIngestFiles([png, jpeg, heic], {
    createImageBitmap: async () => ({ width: 2, height: 2, close() {} }),
    createCanvas: fakePngCanvas,
  });
  assert.equal(out[0], png);
  assert.equal(out[1], jpeg);
  assert.equal(out[2].name, "IMG_1234.png");
  assert.equal(out[2].type, "image/png");
});

test("failed HEIC conversion throws a named error instead of dropping the file", async () => {
  const heic = new File([new Uint8Array([1, 2, 3])], "IMG_1.HEIC", { type: "image/heic" });
  await assert.rejects(
    () => convertHeicFileToPng(heic, {
      createImageBitmap: async () => { throw new Error("no bitmap"); },
      Image: class {
        set src(_value) { queueMicrotask(() => this.onerror?.(new Error("decode"))); }
      },
      heic2any: async () => { throw new Error("wasm failed"); },
    }),
    /Could not convert IMG_1\.HEIC to PNG/,
  );
});

test("canvas, viewport, and browser ingest paths call the HEIC converter", () => {
  assert.match(canvas, /from "\.\.\/media\/heic-to-png\.js\?v=heicpng1"/);
  assert.match(canvas, /async function addDroppedImageFiles[\s\S]{0,400}convertHeicIngestFiles/);
  assert.match(canvas, /isHeicFile\(file\)/);

  assert.match(app, /async function handleCanvasImageDrop[\s\S]{0,800}ensurePngImageFile/);
  assert.match(app, /async function handleCanvasImageDrop[\s\S]{0,400}heic\|heif/);
  assert.match(app, /async function uploadReferenceProjectFile[\s\S]{0,2500}ensurePngImageFile/);
  assert.match(app, /async function uploadProjectFiles[\s\S]{0,400}convertHeicIngestFiles/);
  assert.match(app, /async function importDroppedCadFiles[\s\S]{0,400}convertHeicIngestFiles/);
  assert.match(app, /convertHeicFileToPng\(file\)/);
  assert.match(imagine, /convertHeicFileToPng/);
  assert.match(refs, /heic\|heif/);
  assert.match(html, /heicpng1/);
  assert.match(html, /\.heic,\.heif/);
});
