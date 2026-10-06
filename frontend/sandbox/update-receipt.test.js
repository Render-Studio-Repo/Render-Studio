import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {buildReceipt, writeUpdateReceipt, setBotVerdict} from './update-receipt.js';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
function harness({databaseFail=false, malformed=false, current=null}={}) {
 const writes=[]; const ingests=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('/mcp/sandbox/file'))return {ok:true,json:async()=>({ok:true,text:JSON.stringify(current)})};
  const body=JSON.parse(options.body);
  if(url==='/api/agent-knowledge/ingest'){
   ingests.push(body);
   return {ok:!databaseFail,json:async()=>malformed ? {} : ({ok:true,record:{id:body.score.id,kind:'receipt',receipt_id:body.receipt.receipt_id}})};
  }
  writes.push(body);return {ok:true,json:async()=>({ok:true})};
 };
 return {writes,ingests};
}
test('unknown checks stay unknown and revisions are unique',()=>{
 const a=buildReceipt(),b=buildReceipt();assert.equal(a.status,'unverified');assert.equal(a.locks_ok.one_webgl_viewport,null);assert.notEqual(a.revision_id,b.revision_id);
});
test('receipts identify their protected features and feature-map version',()=>{
 const receipt=buildReceipt({feature_ids:['viewport.layouts','viewport.layouts'],feature_map_version:1});
 assert.deepEqual(receipt.feature_ids,['viewport.layouts']);assert.equal(receipt.feature_map_version,1);
});
test('history revisions and catalog IDs are distinct for same receipt',async()=>{
 const h=harness();await writeUpdateReceipt({receipt_id:'same'});await writeUpdateReceipt({receipt_id:'same'});
 const history=h.writes.filter(x=>x.path.includes('/receipts/')&&!x.path.endsWith('/latest.json'));
 assert.equal(history.length,2);assert.notEqual(history[0].path,history[1].path);
 assert.notEqual(h.ingests[0].score.id,h.ingests[1].score.id);
});
for(const opts of [{databaseFail:true},{malformed:true}])test('database failure or malformed success cannot publish latest '+JSON.stringify(opts),async()=>{
 const h=harness(opts);await assert.rejects(writeUpdateReceipt({receipt_id:'test'}),/database record failed/);
 assert.equal(h.writes.some(x=>x.path.endsWith('/receipts/latest.json')),false);
});
test('review targets a revision and never overwrites a newer global pointer',async()=>{
 const current=buildReceipt({receipt_id:'review'});const h=harness({current});
 await assert.rejects(setBotVerdict('green',[],current.receipt_id,'stale'),/Receipt changed/);
 const reviewed=await setBotVerdict('yellow',[],current.receipt_id,current.revision_id);
 assert.notEqual(reviewed.revision_id,current.revision_id);assert.equal(reviewed.bot_verdict,'yellow');
 assert.equal(h.writes.some(x=>x.path.endsWith('/receipts/latest.json')),false);
});
test('history response must explicitly confirm persistence',async()=>{
 globalThis.fetch=async()=>({ok:true,json:async()=>{throw new Error('malformed');}});
 await assert.rejects(writeUpdateReceipt(),/history could not be saved/);
});
