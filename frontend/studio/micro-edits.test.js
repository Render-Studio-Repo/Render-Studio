import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {trialCount,defaultMicroModel} from './micro-edits.js';
import {groupPartsList} from '../components/parts-list-tree.js';

const microSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'micro-edits.js'), 'utf8');
test('micro download uses triggerTrackedBlobDownload, not 30s revoke', () => {
  const start = microSrc.indexOf("async function download");
  const end = microSrc.indexOf("\nexport function mountMicroEdits", start);
  assert.ok(start >= 0 && end > start, "download helper missing");
  const fn = microSrc.slice(start, end);
  assert.match(microSrc, /import \{ triggerTrackedBlobDownload \}/);
  assert.match(fn, /triggerTrackedBlobDownload\(await res\.blob\(\), name, microDownloadCreated\)/);
  assert.equal(fn.includes("30000"), false);
  assert.equal(fn.includes("30_000"), false);
  assert.equal(fn.includes("createObjectURL"), false);
});

test('Micro edits opens benchmarks and no longer ships Configure edit', () => {
  assert.doesNotMatch(microSrc, /Configure edit/);
  assert.match(microSrc, /data-open-bench/);
  assert.match(microSrc, /void open\(true\)/);
  assert.match(microSrc, /prefEnabled/);
  assert.match(microSrc, /href="\/sandbox\/index\.html"/);
  assert.match(microSrc, /Open Sandbox/);
});

test('Parts List nests existing McMaster entries without moving source files',()=>{
 const old={virtual_folder:true,folder:'McMaster',children:[{name:'parts_list.md',url:'references/McMaster/parts_list.md'}]};
 const unrelated={name:'drawing.pdf'};
 const out=groupPartsList([old,unrelated],[{name:'Electronics parts list.json',parts_tab:'electronics',url:'Parts List/Electronics/parts.json'}]);
 assert.equal(out[0].parts_tab,'home');assert.equal(out[1],unrelated);
 assert.equal(out[0].children[1].children[0].url,'references/McMaster/parts_list.md');
 assert.equal(old.children.length,1);
});
test('empty projects do not show a parts shortcut',()=>assert.deepEqual(groupPartsList([{name:'photo.png'}]),[{name:'photo.png'}]));
test('micro model selection stays within the current AI source options',()=>{
 assert.equal(defaultMicroModel([{value:'only-model'}],'missing'),'only-model');
 assert.equal(defaultMicroModel([{value:'gpt-6-astra'},{value:'gpt-5.6-luna'}],'gpt-6-astra'),'gpt-6-astra');
 assert.equal(trialCount([{count:2},{count:3}]),5);
});

import {selectedGeometryPromptReferences,restoreGeometrySelections} from './prompt-edit-context.js';
test('mount face paths restore only on the matching model and valid triangles',()=>{
 const root={children:[]};const mesh={isMesh:true,parent:root,children:[],geometry:{index:{count:12}}};root.children=[mesh];
 const refs=selectedGeometryPromptReferences({mesh,root,catalogName:'mount.glb',faceIndex:2,bodyIndex:0},'project');
 assert.deepEqual(refs[0].mesh_path,[0]);
 assert.equal(restoreGeometrySelections(root,'mount.glb',refs)[0].mesh,mesh);
 assert.deepEqual(restoreGeometrySelections(root,'different.glb',refs),[]);
 assert.deepEqual(restoreGeometrySelections(root,'mount.glb',[{...refs[0],face_index:9}]),[]);
 assert.deepEqual(restoreGeometrySelections(root,'mount.glb',[{...refs[0],mesh_path:[4]}]),[]);
});
