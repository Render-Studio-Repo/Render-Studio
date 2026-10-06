import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPublicProjectImporter} from './xr-public-import.js';
function setup(overrides={}) {
 const calls=[];
 const run=createPublicProjectImporter({join:async()=>({ok:true}),getProjectId:()=> 'p',getSelectedFile:()=> 'model.step',getProjects:()=>[{id:'p',name:'Robot'}],
  createShareUrl:async(pid,file)=>{calls.push(['share',pid,file]);return '/share/token';},
  api:async path=>path.includes('/share/')?{viewer_url:'/api/share/token/files/model.glb',viewer_filename:'model.glb'}:{latest_file:'other.glb'},
  spawn:async spec=>{calls.push(['spawn',spec]);},...overrides});return {run,calls};
}
test('an import waits for join, resolves a shared GLB, and spawns the same asset for the room',async()=>{
 const {run,calls}=setup();const result=await run('p');assert.equal(result.ok,true);
 assert.deepEqual(calls[0],['share','p','model.step']);assert.equal(calls[1][1].glb_url,'/api/share/token/files/model.glb');
 assert.equal(calls[1][1].filename,'model.glb');assert.equal(calls[1][1].kind,'import');
});
test('explicit part selection wins and duplicate import clicks share one operation',async()=>{
 const {run,calls}=setup();const a=run('p',{filename:'wheel.glb'}),b=run('p',{filename:'wheel.glb'});assert.equal(a,b);await a;
 assert.equal(calls.length,2);assert.equal(calls[0][2],'wheel.glb');
});
test('failed room join never creates a link or shared model',async()=>{
 const {run,calls}=setup({join:async()=>({ok:false,error:'Offline'})});await assert.rejects(run('p'),/Offline/);assert.deepEqual(calls,[]);
});
test('missing viewer geometry surfaces an error and does not spawn a placeholder as success',async()=>{
 const {run,calls}=setup({api:async()=>({})});await assert.rejects(run('p'),/no viewable/);assert.equal(calls.length,1);
});
test('loader failure propagates to the importing UI',async()=>{
 const {run}=setup({spawn:async()=>{throw Error('GLB failed');}});await assert.rejects(run('p'),/GLB failed/);
});
