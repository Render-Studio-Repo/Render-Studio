"""Browser checks for harness editing, CAD ownership and scoped VR guidance; no AI calls."""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2];OUT=Path('/private/tmp/wiring-harness-runtime');OUT.mkdir(exist_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  imports=re.search(r'<script type="importmap">(.*?)</script>',(ROOT/'frontend/index.html').read_text(),re.S).group(1)
  html='<html><head><script type="importmap">'+imports+'</script><link rel="stylesheet" href="/studio/styles.css"><style>body{margin:0;background:#101923;color:white;font-family:system-ui}#app{display:block!important}#wiring-content-area{width:100vw;height:100vh;position:relative}</style></head><body><div id="app" class="wiring-mode"><div id="wiring-content-area" class="wiring-content-area"><div id="wiring-viewport"></div></div></div></body></html>'
  await page.route('**/__harness-test',lambda r:r.fulfill(content_type='text/html',body=html));await page.goto('http://127.0.0.1:8001/__harness-test')
  instrumented=(ROOT/'frontend/wiring/wiring-spatial-workspace.js').read_text().replace('camera = new THREE.PerspectiveCamera(', 'camera = window.testCamera = new THREE.PerspectiveCamera(')
  await page.route('**/wiring-spatial-workspace.js*',lambda r:r.fulfill(content_type='text/javascript',body=instrumented))
  result=await page.evaluate('''async()=>{
   const checks=[],check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
   const THREE=await import('three');
   const {harnessCurve}=await import('/wiring/wiring-harness-route.js');
   const {curve,issues}=harnessCurve([[0,0,0],[20,0,0],[20,20,0]].map(p=>new THREE.Vector3(...p)),5);
   check(!issues.length&&Math.abs(curve.getLength()-(30+Math.PI*2.5))<.02,'Circular bend honors specified radius and tangent lengths');
   const arc=curve.curves[1];check(arc.getPoint(0).distanceTo(new THREE.Vector3(15,0,0))<1e-8&&arc.getPoint(1).distanceTo(new THREE.Vector3(20,5,0))<1e-8,'Rounded bend preserves exact tangency endpoints');
   check(harnessCurve([[0,0,0],[1,0,0],[1,1,0]].map(p=>new THREE.Vector3(...p)),5).issues.length===1,'Insufficient bend clearance is flagged, never shrunk silently');
   const {createWiringSimulator}=await import('/wiring/wiring-simulator.js');const {createWiringSpatialView}=await import('/wiring/wiring-spatial-view.js');const {createWiringSpatialWorkspace}=await import('/wiring/wiring-spatial-workspace.js');
   const fixture={components:[{id:'a',type:'sensor',label:'Controller J1',position3d:[-40,0,0],dimensions:[30,6,20],pin_layout_mode:'diagram',pin_layout:[{id:'SIG',label:'SIG',x:1,y:.5}],pins:[{id:'SIG',position3d:[15,3,0]}]},{id:'b',type:'sensor',label:'Driver J2',position3d:[40,0,0],dimensions:[30,6,20],pin_layout_mode:'diagram',pin_layout:[{id:'IN',label:'IN',x:0,y:.5}],pins:[{id:'IN',position3d:[-15,3,0]}]}],wires:[{id:'w',label:'Control signal',from:{componentId:'a',pinId:'SIG'},to:{componentId:'b',pinId:'IN'},gauge:'22 AWG',color:'#6cc9ff'}]};
   const sim=createWiringSimulator({root:document.querySelector('#wiring-viewport'),getProjectId:()=>null});sim.applySchematic(fixture,{save:false});
   const source=new THREE.Group();source.userData.wiringDetachedCad=true;source.add(new THREE.Mesh(new THREE.BoxGeometry(30,6,20),new THREE.MeshStandardMaterial({color:'#239d79'})));let disposed=false;source.children[0].geometry.addEventListener('dispose',()=>disposed=true);
   const spatial=createWiringSpatialView({scene:new THREE.Scene(),getCadModel:()=>source});
   const workspace=createWiringSpatialWorkspace({root:document.querySelector('#wiring-content-area'),onStatus:(kind,msg)=>{if(kind==='error')throw Error(msg);},spatial,getSchematic:()=>sim.getSchematic(),getProjectId:()=> 'fixture',onPlacePin:(...args)=>sim.setPhysicalPin(...args),onRoute:(...args)=>sim.setWireRoute(...args)});check(workspace.setActive(true),'3D workspace opens');
   check(sim.setPhysicalPin('a','SIG',[14,3,2]),'Terminal placement accepts a known pin');workspace.sync();check(spatial.getAnchor('a','SIG').distanceTo(new THREE.Vector3(-26,3,2))<1e-8,'Terminal placed on CAD drives the wire endpoint');
   sim.undo();check(sim.getSchematic().components[0].pins[0].position3d[0]===15,'Terminal placement undo restores previous physical anchor');
   check(!sim.setPhysicalPin('a','NONEXISTENT',[0,0,0]),'Unknown terminals cannot be invented by placement');
   check(sim.setWireRoute('w',[[-15,15,0],[-15,15,25],[15,15,25],[15,15,0]],5),'3D route edits persist via simulator');workspace.sync();check(spatial.getContext().wires[0].geometry.route==='provided','Saved route renders as supplied geometry');
   sim.undo();check(!sim.getSchematic().wires[0].route3d,'Route undo preserves previous wiring');sim.redo();workspace.sync();check(!disposed,'Rebuilding wiring never disposes original CAD geometry');
   const {createWiringGuide,wiringGuideRows}=await import('/wiring/wiring-guide.js');let pid='p1',wires=spatial.getContext().wires;const store=new Map();const guide=createWiringGuide({getProjectId:()=>pid,getContext:()=>({wires}),storage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},selectWire:id=>spatial.setFocusWire(id)});
   guide.start();check(spatial.getSelection().id==='w','Guided step highlights its actual wire');guide.markInstalled();check(guide.state().completed===1,'Progress is user-marked installation');const snapshot=guide.reviewSnapshot();pid='p2';check(!guide.applyReview(snapshot,{summary:'old'})&&guide.state().completed===0,'Stale camera evidence cannot cross projects');pid='p1';check(guide.state().completed===1,'Installed progress restores per project');wires=[{...wires[0],to:{...wires[0].to,pin:'OTHER'}}];check(guide.state().completed===0,'Changed endpoints invalidate prior installation state');
   check(wiringGuideRows(guide).some(r=>r.id==='ws-wiring-isolate'),'VR exposes schematic-only mode');
   const {reviewWiringStep}=await import('/wiring/wiring-guide-review.js');let posted;try{await reviewWiringStep({guide,getProjectId:()=>pid,capture:async()=> 'data:image/jpeg;base64,AA',getAiFields:()=>({}),api:async(path,opts)=>{posted=JSON.parse(opts.body);return {trace_id:'other',reused_existing:true};}});throw Error('should reject');}catch(e){check(e.message.includes('Another photo review'),'Other running photo review cannot be attributed to this wire');}check(posted.model==='gpt-6-astra','Photographed connection review uses Astra');
   const {compactXrAgentContext}=await import('/components/xr-agent-context.js');guide.start();const ctx=compactXrAgentContext({projectId:pid,workspace:'wiring',wiring:{guide:guide.state(),components:Array(100).fill({description:'large'.repeat(10000)})}});check(ctx.wiring?.guide?.guided,'Guided wire survives context limit for a large harness');
   window.test={THREE,sim,spatial,workspace,checks};window.screenPoint=(p)=>{const v=new THREE.Vector3(...p).project(window.testCamera),r=document.querySelector('canvas').getBoundingClientRect();return{x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2};};return checks;
  }''')
  await page.wait_for_timeout(500)
  # Actual click routing and keyboard-accessible height/radius fields.
  await page.click('[data-wiring-route]');await page.fill('[data-route-height]','18');await page.fill('[data-route-radius]','6')
  # Target a vertex on the existing cable using the renderer camera.
  pos=await page.evaluate('''()=>{const m=test.spatial.getGroup().children.find(n=>n.name==='wiring-tube:w');const a=m.geometry.attributes.position;return screenPoint([a.getX(80),a.getY(80),a.getZ(80)]);}''')
  await page.mouse.click(pos['x'],pos['y']);await page.mouse.click(600,500);await page.click('[data-route-finish]')
  assert await page.evaluate("test.sim.getSchematic().wires[0].minBendRadiusMm") == 6
  result.append('Pointer routing tool saves waypoint height and bend radius')
  await page.evaluate("test.spatial.setSelection({kind:'wire',id:'w'})");await page.click('[data-wiring-fit]');await page.screenshot(path=str(OUT/'harness-tools.png'))
  await page.set_viewport_size({'width':390,'height':844});await page.wait_for_timeout(200)
  assert await page.locator('[data-wiring-route]').is_visible()
  overlap=await page.evaluate('''()=>{const a=document.querySelector('.wiring-spatial-heading').getBoundingClientRect(),b=document.querySelector('.wiring-spatial-inspector').getBoundingClientRect();return b.top<a.bottom;}''');assert not overlap
  await page.screenshot(path=str(OUT/'harness-mobile.png'))
  assert not errors,errors
  (OUT/'report.json').write_text(json.dumps({'checks':result,'errors':errors},indent=2));print(json.dumps({'checks':len(result),'errors':errors}))
  await browser.close()
asyncio.run(main())
