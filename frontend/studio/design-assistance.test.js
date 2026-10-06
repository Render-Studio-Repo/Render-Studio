import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterParts, inferEditIntents, MOBILE_BASE_QUESTIONS, partImageUrl, imageUrl } from './design-assistance.js';

const assistSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'design-assistance.js'), 'utf8');

test('personal experiments and detailed feedback retention are separate bounded settings', () => {
  assert.match(assistSrc, /data-experiments/);
  assert.match(assistSrc, /data-retention/);
  assert.match(assistSrc, /90 days/);
  assert.match(assistSrc, /2,400 characters/);
  assert.doesNotMatch(assistSrc, /capped at 500 MB/);
});
const composeHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.html'), 'utf8');
const composeCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8');
const appSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.js'), 'utf8');

test('parts list open aborts the previous parts GET', () => {
  assert.match(assistSrc, /let partsListAbort = null; \/\/ leakfix84/);
  assert.match(assistSrc, /async function openParts\(initialTab, host = null\)[\s\S]{0,1600}signal: ctl\.signal/);
  assert.match(appSrc, /leakfix84/);
});

test('compose pane does not mount an Analyze button', () => {
  assert.doesNotMatch(assistSrc, /assist-analyze/);
  assert.doesNotMatch(assistSrc, /textContent = "Analyze"/);
  assert.doesNotMatch(composeHtml, /id="assist-analyze"|id="btn-analyze"/);
});

test('rate control sits above the prompt drop zone and generate/stop share one row', () => {
  assert.match(assistSrc, /getElementById\("prompt-image-drop"\)\?\.before\(resultFeedback\)/);
  assert.match(composeHtml, /id="btn-prompt"[\s\S]*id="btn-stop-generation"/);
  assert.doesNotMatch(composeCss, /\.prompt-generate-row\s*\{[^}]*flex-direction:\s*column/);
  assert.match(composeCss, /\.prompt-generate-row\s*\{[^}]*flex-direction:\s*row/);
});

test('Generate another queues a pending overlay job beside live CAD jobs', () => {
  assert.match(appSrc, /function markAdditionalGenerationPending/);
  assert.match(appSrc, /function cadPromptWatchIsLive/);
  assert.match(appSrc, /pendingBaselineCount/);
  assert.match(appSrc, /if \(promptClickInFlight\) \{/);
  assert.doesNotMatch(appSrc, /if \(promptClickInFlight \|\| promptSubmitInFlight\)/);
  assert.doesNotMatch(appSrc, /error: "pending"/);
});

test('parts filters and sorting preserve source list',()=>{
 const parts=[{id:'b',name:'Battery',qty:1,category:'electronics',specs:{voltage:'24 V'}},{id:'s',name:'Steel',qty:4,category:'mcmaster'}];
 assert.deepEqual(filterParts(parts,'electronics','24 v','name').map(p=>p.id),['b']);
 assert.deepEqual(filterParts(parts,'home','','quantity').map(p=>p.id),['s','b']);
 assert.equal(parts[0].id,'b');
});
test('edit hints detect several distinct operations',()=>{
 assert.deepEqual(inferEditIntents('Move the controller to make room and reroute wiring'),['move','rearrange','reroute wiring']);
 assert.deepEqual(inferEditIntents('Shorten this face'),['micro edit']);
});
test('mobile base followups retain known chemistry without inventing dimensions',()=>{
 const battery=MOBILE_BASE_QUESTIONS.find(q=>q.id==='base-battery');
 assert.match(battery.answer,/LiFePO₄/);assert.match(battery.answer,/pending/);
 assert.ok(MOBILE_BASE_QUESTIONS.some(q=>q.id==='base-pdf'));
});

test('parts list thumbs use product photos with a placeholder fallback', async () => {
  const { partImageUrl, imageUrl } = await import('./design-assistance.js');
  assert.equal(imageUrl('javascript:alert(1)'), '');
  assert.equal(partImageUrl({ thumbnail_url: 'https://cdn.example/p.png' }), 'https://cdn.example/p.png');
  assert.equal(partImageUrl({ png_url: '/catalog/bno.png' }), '/catalog/bno.png');
  assert.match(partImageUrl({ url: 'https://www.adafruit.com/product/4754' }), /cdn-shop\.adafruit\.com\/640x480\/4754-00\.jpg/);
  assert.equal(partImageUrl({ url: 'https://www.mcmaster.com/91292A144/' }), '');
  assert.equal(imageUrl('https://www.mcmaster.com/favicon.ico'), '');
  assert.match(assistSrc, /assist-part-thumb-fallback/);
  assert.match(assistSrc, /loading="lazy"/);
  assert.match(assistSrc, /\/parts\/thumbnails/);
  assert.match(assistSrc, /data-thumb-state=/);
  assert.match(assistSrc, /partthumb=20260916-1/);
  assert.match(assistSrc, /mcmthumb1/);
  assert.match(assistSrc, /amazon1/);
  assert.match(appSrc, /partthumb=20260916-1/);
  assert.match(appSrc, /mcmthumb1/);
  assert.match(appSrc, /mcmtab1/);
  assert.match(appSrc, /amazon1/);
  assert.match(appSrc, /mcmtype1/);
  assert.match(appSrc, /mcmui2/);
  assert.match(composeHtml, /partthumb=20260916-1/);
  assert.match(composeHtml, /vidclose2=20260916-1/);
  assert.match(composeHtml, /stopshare=20260916-1/);
  assert.match(composeHtml, /sharexfix=20260916-1/);
  assert.match(composeHtml, /noswipe=20260916-1/);
});

test('parts list can mount into a catalog host without cloning the BOM tab', () => {
  assert.match(assistSrc, /e\.detail\?\.host \|\| null/);
  assert.match(assistSrc, /catalog-parts-close/);
  assert.match(assistSrc, /partImageUrl|thumbnail_url/);
  assert.match(assistSrc, /Home.*Electronics.*McMaster.*Mechanical.*Follow-up questions/s);
});

test('parts list collapses Ask Render Agent to the Docs fab (ragicon1)', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'design-assistance.css'), 'utf8');
  assert.match(assistSrc, /render-agent-fab--parts/);
  assert.match(assistSrc, /function ensurePartsAgentFab/);
  assert.match(assistSrc, /Ask Agent/);
  assert.match(assistSrc, /render-logo-gear-still/);
  assert.match(assistSrc, /openRenderAgent\(\{ fromLauncher: true, partsList: true, force: true \}\)/);
  assert.doesNotMatch(assistSrc, /Ask \/ find parts/);
  assert.doesNotMatch(assistSrc, /class="assist-agent"/);
  assert.match(css, /render-agent-fab--parts/);
  assert.match(assistSrc, /ragicon1/);
});

test('unsourced electronics get Amazon search plus agent fit prompt (amazon1)', async () => {
  const { amazonSearchUrl, partShopQuery, partDescription, electronicsFitPrompt } = await import('./design-assistance.js');
  const href = amazonSearchUrl('Arduino Nano 33 IoT');
  assert.match(href, /^https:\/\/www\.amazon\.com\/s\?k=/);
  assert.match(href, /Arduino/);
  const part = { name: 'Motor driver', category: 'electronics', part_number: '' };
  assert.match(partShopQuery(part), /Motor driver/);
  assert.match(partDescription(part), /without a product URL|Search Amazon/i);
  assert.match(electronicsFitPrompt(part), /WILL WORK or WON'T WORK/);
  assert.match(electronicsFitPrompt(part), /amazon\.com/);
  assert.match(assistSrc, /data-amazon-open/);
  assert.match(assistSrc, /No link/);
  assert.match(assistSrc, /window\.open\(href, "_blank"/);
  assert.match(appSrc, /openWithQuestion/);
  assert.match(appSrc, /render-agent-panel--mini|amazon1/);
});
