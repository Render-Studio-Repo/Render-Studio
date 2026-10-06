import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectXrImage, prepareXrImage } from './xr-image-budget.js';
const png = (width, height, animated = false) => {
  const out = new Uint8Array(animated ? 65 : 45), view = new DataView(out.buffer);
  out.set([137,80,78,71,13,10,26,10]); view.setUint32(8,13); out.set([73,72,68,82],12); view.setUint32(16,width); view.setUint32(20,height); out[24]=8; out[25]=6;
  if (animated) { view.setUint32(33,8); out.set([97,99,84,76],37); out.set([73,69,78,68],57); }
  else out.set([73,69,78,68],37);
  return out;
};
const jpeg = (width, height) => new Uint8Array([255,216,255,224,0,4,0,0,255,192,0,11,8,height>>8,height&255,width>>8,width&255,1,1,17,0,255,217]);
const webp = (width, height, animated = false) => {
  const out = new Uint8Array(30), view = new DataView(out.buffer); out.set([...Buffer.from('RIFF')]); view.setUint32(4,22,true); out.set([...Buffer.from('WEBPVP8X')],8); view.setUint32(16,10,true); out[20]=animated?2:0;
  out[24]=(width-1)&255;out[25]=((width-1)>>8)&255;out[26]=((width-1)>>16)&255;out[27]=(height-1)&255;out[28]=((height-1)>>8)&255;out[29]=((height-1)>>16)&255;return out;
};

test('container preflight preserves aspect ratio and limits GPU dimensions', () => {
  for (const [buffer,mime] of [[png(1200,600),'image/png'],[jpeg(1200,600),'image/jpeg'],[webp(1200,600),'image/webp']]) {
    const result=inspectXrImage(buffer);assert.equal(result.width,1200);assert.equal(result.height,600);assert.equal(result.resizeWidth,512);assert.equal(result.resizeHeight,256);assert.equal(result.mimeType,mime);
  }
});
test('tiny compressed containers cannot trigger huge pixel decodes', () => {
  for (const buffer of [png(30000,30000),jpeg(20000,20000),webp(8192,8192),png(0,50),png(2000,2000)]) assert.throws(()=>inspectXrImage(buffer),/too large/);
});
test('animated and active/unsupported formats are blocked before decoding', () => {
  for (const buffer of [png(20,20,true),webp(20,20,true)]) assert.throws(()=>inspectXrImage(buffer),/Animated/);
  for (const input of ['GIF89a','<svg><script>bad()</script></svg>','HEIC']) assert.throws(()=>inspectXrImage(new TextEncoder().encode(input)),/still JPG/);
});
test('truncated and oversized byte payloads are rejected', () => {
  assert.throws(()=>inspectXrImage(jpeg(100,100).subarray(0,15)),/Incomplete/);
  assert.throws(()=>inspectXrImage(webp(10,10).subarray(0,22)),/Incomplete/);
  assert.throws(()=>inspectXrImage(new Uint8Array(2097153)),/under 2 MB/);
});
test('Blob preflight uses verified MIME and rejects dimensions before bitmap API is needed', async () => {
  const safe=await prepareXrImage(new Blob([png(100,100)],{type:'text/html'}));assert.equal(safe.blob.type,'image/png');
  await assert.rejects(prepareXrImage(new Blob([png(32000,32000)])),/too large/);
});
