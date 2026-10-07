/** Read container dimensions before the browser allocates a decoded VR image. */
export const XR_IMAGE_BUDGET = Object.freeze({ bytes: 2 * 1024 * 1024, pixels: 2 * 1024 * 1024, edge: 4096, textureEdge: 512 });
const fail = message => { throw new Error(message); };
const text = (bytes, at, count) => String.fromCharCode(...bytes.subarray(at, at + count));

export function inspectXrImage(input, budget = XR_IMAGE_BUDGET) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length || bytes.length > budget.bytes) fail('Use a smaller project image (under 2 MB) for VR.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at, little = false) => at + 2 <= bytes.length ? view.getUint16(at, little) : fail('Incomplete image header.');
  const u32 = (at, little = false) => at + 4 <= bytes.length ? view.getUint32(at, little) : fail('Incomplete image header.');
  const u24 = at => at + 3 <= bytes.length ? bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536 : fail('Incomplete image header.');
  let width = 0, height = 0, mimeType = '';
  if (bytes[0] === 0x89 && text(bytes, 1, 3) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
    mimeType = 'image/png';
    if (bytes.length < 33 || u32(8) !== 13 || text(bytes, 12, 4) !== 'IHDR') fail('Invalid PNG header.');
    width = u32(16); height = u32(20);
    for (let at = 8; at + 12 <= bytes.length;) {
      const size = u32(at), kind = text(bytes, at + 4, 4);
      if (size > bytes.length - at - 12) fail('Incomplete PNG data.');
      if (kind === 'IHDR' && at !== 8) fail('Invalid duplicate PNG header.');
      if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') fail('Animated images stay out of VR Draw previews. Use a still JPG or PNG.');
      at += 12 + size;
      if (kind === 'IEND') break;
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    mimeType = 'image/jpeg';
    for (let at = 2; at < bytes.length;) {
      if (bytes[at++] !== 0xff) fail('Invalid JPEG header.');
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      const length = u16(at);
      if (length < 2 || at + length > bytes.length) fail('Incomplete JPEG data.');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) fail('Invalid JPEG dimensions.');
        const nextHeight = u16(at + 3), nextWidth = u16(at + 5);
        if (width && (width !== nextWidth || height !== nextHeight)) fail('Conflicting JPEG dimensions.');
        height = nextHeight; width = nextWidth;
      }
      at += length;
    }
  } else if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') {
    mimeType = 'image/webp';
    if (u32(4, true) + 8 > bytes.length) fail('Incomplete WebP data.');
    for (let at = 12; at + 8 <= bytes.length;) {
      const kind = text(bytes, at, 4), size = u32(at + 4, true), start = at + 8;
      if (size > bytes.length - start) fail('Incomplete WebP data.');
      if (kind === 'ANIM' || kind === 'ANMF' || (kind === 'VP8X' && (bytes[start] & 2))) fail('Animated images stay out of VR Draw previews. Use a still JPG or PNG.');
      if (kind === 'VP8X') { if (size < 10) fail('Invalid WebP header.'); const w = u24(start + 4) + 1, h = u24(start + 7) + 1; if (width && (width !== w || height !== h)) fail('Conflicting WebP dimensions.'); width = w; height = h; }
      else if (kind === 'VP8 ') { if (size < 10 || text(bytes, start + 3, 3) !== '\u009d\u0001\u002a') fail('Invalid WebP frame.'); const w = u16(start + 6, true) & 0x3fff, h = u16(start + 8, true) & 0x3fff; if (width && (width !== w || height !== h)) fail('Conflicting WebP dimensions.'); width = w; height = h; }
      else if (kind === 'VP8L') { if (size < 5 || bytes[start] !== 0x2f) fail('Invalid WebP frame.'); const bits = u32(start + 1, true), w = (bits & 0x3fff) + 1, h = ((bits >>> 14) & 0x3fff) + 1; if (width && (width !== w || height !== h)) fail('Conflicting WebP dimensions.'); width = w; height = h; }
      at = start + size + (size % 2);
    }
  } else fail('VR Draw previews support still JPG, PNG and WebP images. Use a still preview for GIF, SVG or HEIC files.');
  if (!width || !height || width > budget.edge || height > budget.edge || width * height > budget.pixels) fail('This image is too large to decode safely in VR. Use a still preview of 2 megapixels or less.');
  const scale = Math.min(1, budget.textureEdge / Math.max(width, height));
  return { width, height, mimeType, resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)) };
}

export async function prepareXrImage(blob, budget = XR_IMAGE_BUDGET) {
  if (blob.size > budget.bytes) fail('Use a smaller project image (under 2 MB) for VR.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const info = inspectXrImage(bytes, budget);
  return { ...info, blob: new Blob([bytes], { type: info.mimeType }) };
}
