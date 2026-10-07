import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch()
  page=await browser.new_page(viewport={'width':1200,'height':850})
  errors=[]
  page.on('pageerror',lambda err:errors.append(str(err)))
  await page.route('**/__agent-bridge-check',lambda route:route.fulfill(content_type='text/html',body='<html><body style="background:#111827;color:#dbeafe;font:18px system-ui;padding:20px"><h1>Agent bridge verification</h1><pre id="result">Running…</pre></body></html>'))
  await page.goto('http://127.0.0.1:8001/__agent-bridge-check')
  result=await page.evaluate('''async()=>{
    const {createXrAgentBridge}=await import('/components/xr-agent-bridge.js?v=20260915-xragent1');
    const checks=[];const check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label)};const tick=()=>new Promise(r=>setTimeout(r,40));
    localStorage.setItem('render3d:xr-agent:v1',JSON.stringify({version:1,settings:{name:'LEAKED-ACCOUNT'},history:[{id:'secret',text:'OTHER USER SECRET',role:'user'}],changes:[]}));
    let headset=false,stopListening=0;let uid='alice',project='project-a',workspace='cad',live=false,frames=0,generations=0,discussContext=null,resolveDiscussion=null;
    const remote={alice:{version:1,revision:1,settings:{name:'Alice Agent'},settingsUpdatedAt:'2026-09-15T00:00:00Z',history:[],changes:[]},bob:{version:1,revision:1,settings:{name:'Bob Agent'},settingsUpdatedAt:'2026-09-15T00:00:00Z',history:[],changes:[]}};
    window.Render3DWiringContext={getContext:()=>({privateWire:'should-not-enter-CAD-context'})};
    const bridge=createXrAgentBridge({getUserId:()=>uid,getProjectId:()=>project,getGenerationModel:()=>({model:'selected-cad-model',provider:'openai'}),getDesignContext:()=>({workspace,targetFile:'old.step',selected:'Old object'}),getPeers:()=>[],getToken:()=>'',isSignedIn:()=>!!uid,isPresenting:()=>headset,onStopListening:()=>stopListening++,api:async(path,opt)=>{if(path.endsWith('/state')){if(opt?.method==='PATCH'){remote[uid]={...JSON.parse(opt.body),revision:remote[uid].revision+1};return {revision:remote[uid].revision}}return remote[uid]}return {id:'pc1'}},generate:async()=>{generations++;if(generations===2)throw new Error('Second change failed');return {ok:true,message:'Generated'}},discuss:async(question,ctx)=>{discussContext=ctx;if(question==='wait')return await new Promise(r=>resolveDiscussion=r);return {answer:'Discussion only',proposals:[]}},getSceneImage:()=>document.createElement('canvas').toDataURL('image/png')});
    const voice={getState:()=>({live}),setModel:()=>{},refreshSettings:()=>{},start:async()=>{live=true},stop:()=>{live=false},sendText:()=>{},sendContext:async()=>{frames++},getOutputStream:()=>null,setRemoteInputStream:()=>{}};
    bridge.bindVoice(voice);await tick();await bridge.start();
    check(bridge.getState().settings.name==='Alice Agent','Authenticated server settings load into memory-only store');
    check(!JSON.stringify(bridge.getState()).includes('OTHER USER SECRET'),'Global browser history is never merged into account state');
    check(!JSON.stringify(bridge.getContext()).includes('privateWire'),'CAD context excludes inactive wiring workspace');
    window.dispatchEvent(new CustomEvent('render3d:xr-selection',{detail:{name:'Pointed bracket',targetFile:'bracket.step',projectId:project}}));
    check(bridge.getContext().targetFile==='bracket.step','Pointed CAD catalog filename replaces older desktop selection');
    let copies=0;const originalGet=bridge.store.getState;bridge.store.getState=()=>{copies++;return originalGet()};for(let i=0;i<1000;i++)bridge.getState();check(copies===0&&Object.isFrozen(bridge.getState().settings),'Headset frame reads reuse an immutable cached snapshot');
    workspace='wiring';window.dispatchEvent(new CustomEvent('wiring-selection',{detail:{wireId:'WireNow',projectId:project}}));check(bridge.getContext().selection.wireId==='WireNow','Native wiring-selection event immediately reaches voice context');workspace='cad';bridge.getContext();window.dispatchEvent(new CustomEvent('render3d:xr-selection',{detail:{name:'Pointed bracket',targetFile:'bracket.step',projectId:project}}));
    const queue=bridge.voiceOptions.onChangeProposal;
    const one=queue({instruction:'Move bracket 2mm',targetIds:['bracket']});const dup=queue({instruction:'  Move   bracket 2mm ',targetIds:['bracket']});
    check(one.changeId===dup.changeId,'Repeated model proposal is deduplicated by prompt and target');
    queue({instruction:'Round bracket corner'});queue({instruction:'Add cable clip'});
    await bridge.action('agent:generate-all');const changes=bridge.getState().changes;
    check(changes[0].status==='succeeded'&&changes[1].status==='failed'&&changes[2].status==='pending','Batch failure preserves completed edits and leaves unstarted work pending');
    const correction=await bridge.action('agent:correction',{id:changes[0].id,text:'Move only 1mm instead'});
    check(correction.parentId===changes[0].id&&correction.status==='pending','VR correction creates a linked proposal requiring review');
    check(generations===2,'Correction does not execute CAD until approval');
    project='project-b';await bridge.generate({changes:[changes[2]],mode:'one'});
    check(generations===2,'Changes from another project cannot generate in the current one');
    const pending=bridge.voiceOptions.askSelectedModel('wait',bridge.getContext());await tick();project='project-c';resolveDiscussion({answer:'Old project',proposals:[{prompt:'Wrong project edit'}]});let stale=false;try{await pending}catch{stale=true}
    check(stale&&!bridge.getState().changes.some(c=>c.prompt==='Wrong project edit'),'Late discussion from an old project cannot create new proposals');
    bridge.store.updateSettings({includeSelectionMetadata:false});await bridge.voiceOptions.askSelectedModel('hello',bridge.getContext());
    check(!discussContext.targetFile&&!discussContext.selected,'Disabled metadata is not re-added by selected-model delegation');
    const before=frames;await new Promise(r=>setTimeout(r,5200));check(frames>before,'Live visible agent refreshes viewport context on a five-second timer');
    uid='bob';const cleared=bridge.getState();check(cleared.changes.length===0&&!live,'Account transition stops voice and clears earlier account work');
    bridge.bindVoice(voice);await tick();check(bridge.getState().settings.name==='Bob Agent','New account loads only its own server preferences');
    headset=true;await bridge.start();check(live,'VR activation starts local voice');headset=false;await new Promise(r=>setTimeout(r,350));check(!live&&stopListening>0,'Leaving VR stops its owned voice session and disables wake listening');
    document.querySelector('#result').textContent=checks.map(x=>'✓ '+x).join('\\n');bridge.dispose();return {checks,paidRequests:0};
  }''')
  if errors:raise RuntimeError(errors)
  Path('/private/tmp/xr-agent-bridge-browser.json').write_text(json.dumps(result,indent=2))
  await page.screenshot(path='/private/tmp/xr-agent-bridge-browser.png')
  await browser.close()
  print(json.dumps(result,indent=2))
asyncio.run(main())
