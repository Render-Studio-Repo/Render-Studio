import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLayout, createTemplate, safeImage, imageFor, itemsForSection, productCard } from './storefront-layout.js';
const items=[{id:'one',name:'First',kind:'model',thumbnail_url:'/assets/first.png'},{id:'two',name:'Second',kind:'knowledge',thumbnail_url:'https://example.com/second.jpg'}];
test('templates use real thumbnails and preserve a catalog',()=>{for(const id of ['curated','catalog','showcase','developer']){const layout=createTemplate(id,items);assert.ok(layout.some(x=>x.type==='models'));assert.deepEqual(layout.find(x=>x.listing_ids)?.listing_ids,['one','two']);}});
test('normalization strips active markup fields and bounds sections',()=>{const result=normalizeLayout([{id:'x!',type:'about',html:'<script>',style:'fixed',columns:99,tone:'dark',body:'Hi'},{id:'iframe',type:'iframe'}]);assert.equal(result.length,1);assert.equal(result[0].id,'x');assert.equal(result[0].columns,4);assert.equal(result[0].html,undefined);assert.equal(result[0].style,undefined);});
test('selection follows explicit order and cannot reference absent products',()=>assert.deepEqual(itemsForSection({listing_ids:['two','foreign','one']},items).map(x=>x.id),['two','one']));
test('unsafe images blocked and listing titles escaped',()=>{assert.equal(safeImage('javascript:alert(1)'), '');assert.equal(safeImage('//evil/x'),'');assert.equal(safeImage('data:image/svg+xml,<svg onload=alert(1)>'),'');const html=productCard({id:'a',name:'<script>x</script>',thumbnail_url:'javascript:alert(1)'});assert.ok(!html.includes('<script>'));assert.ok(!html.includes('javascript:'));});

test('first approved gallery image fills a missing thumbnail',()=>assert.equal(imageFor({gallery:[{url:'/assets/gallery.jpg'}]}),'/assets/gallery.jpg'));
