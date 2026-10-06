import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopCanvasEvidence, generateDrawReferenceImage, saveRecordedDesign } from './draw-design-context.js';
test('canvas context preserves image links without copying image bytes', () => {
  const c = desktopCanvasEvidence({elements:[{id:'a',type:'image',dataUrl:'bytes'},{id:'b',text:'Bracket'},{id:'l',fromId:'a',toId:'b'}]});
  assert.equal(c.elements[2].toId,'b');assert.equal(c.elements[0].dataUrl,undefined);assert.equal(c.omitted,0);
});
test('image generation uses the project endpoint and returns a saved image', async () => {
  let request;
  const asset = await generateDrawReferenceImage({projectId:'p',prompt:'Bracket',api:async(path,opts)=>{request={path,body:JSON.parse(opts.body)};return {files:[{name:'imagine/blue bracket.png'}]}}});
  assert.equal(request.path,'/api/projects/p/imagine');assert.equal(request.body.count,1);
  assert.equal(asset.source.url,'/api/projects/p/files/imagine/blue%20bracket.png');
});
test('recorded design saves geometry and propagates storage failure', async () => {
  let stored;
  const args={projectId:'p',draft:'Bracket',canvas:{elements:[]},viewport:{exportSceneDrawingDocument:()=>({geometries:[{positions:[1,2,3]}]})},api:async(_,opts)=>{stored=JSON.parse(opts.body)}};
  await saveRecordedDesign(args);assert.deepEqual(stored.state.recorded_design.drawings.geometries[0].positions,[1,2,3]);assert.equal(stored.state.recorded_design.robotTrainingEpisode,false);
  await assert.rejects(saveRecordedDesign({...args,api:async()=>{throw Error('Disk full')}}),/Disk full/);
});
