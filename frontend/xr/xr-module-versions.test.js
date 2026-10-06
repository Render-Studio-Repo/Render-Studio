import {test} from 'node:test';import assert from 'node:assert/strict';import {readdirSync,readFileSync} from 'node:fs';import {join} from 'node:path';
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()&&!e.name.includes('node_modules')?files(join(dir,e.name)):e.name.endsWith('.js')&&!e.name.endsWith('.test.js')?[join(dir,e.name)]:[]);}
test('XR camera, controller and profile imports share one state module revision',()=>{
 const sources=files(new URL('..',import.meta.url).pathname).map(p=>readFileSync(p,'utf8')).join('\n');
 for(const name of ['xr-dimos-viewer','xr-dimos-teleop','robotics-profile','xr-hand-cams','xr-hot-path']){
  const re=new RegExp(`(?:from\\s*|import\\s*\\()(["'])([^"']*/${name}\\.js(?:\\?[^"']*)?)\\1`,'g');
  const versions=new Set([...sources.matchAll(re)].map(m=>m[2].split('?')[1]||''));
  assert.deepEqual([...versions],['v=roboticsworkspace3'],name+' must not create duplicate runtime state');
 }
});
