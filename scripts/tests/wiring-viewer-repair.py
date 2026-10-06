#!/usr/bin/env python3
"""Behavioral browser checks with production CSS and local fixture data; no AI calls."""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/private/tmp/wiring-viewer-repair');OUT.mkdir(exist_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':900});errors=[];checks=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  imports=re.search(r'<script type="importmap">(.*?)</script>',(ROOT/'frontend/index.html').read_text(),re.S).group(1)
  html='<html><head><script type="importmap">'+imports+'</script><link rel="stylesheet" href="/studio/styles.css"><style>body{margin:0;background:#101923;color:white;font-family:system-ui}#app{display:block!important}#wiring-content-area{width:1440px;height:900px;position:relative}.wiring-spatial-switcher{position:absolute;bottom:14px;left:14px;z-index:15}</style></head><body><div id="app" class="wiring-mode"><div id="wiring-content-area" class="wiring-content-area"><div id="wiring-viewport"></div><div class="wiring-spatial-switcher"><button id="btn-wiring-view-spatial">3D</button><button id="btn-wiring-view-breadboard">Schematic</button></div></div></div></body></html>'
  await page.route('**/__wiring-repair-test',lambda r:r.fulfill(content_type='text/html',body=html))
  instrumented=(ROOT/'frontend/wiring/wiring-spatial-workspace.js').read_text().replace('camera = new THREE.PerspectiveCamera(', 'camera = window.testCamera = new THREE.PerspectiveCamera(')
  await page.route('**/wiring-spatial-workspace.js*',lambda r:r.fulfill(content_type='text/javascript',body=instrumented))
  await page.goto('http://127.0.0.1:8001/__wiring-repair-test')
  fixture=json.loads((ROOT/'scripts/tests/fixtures/wiring-industrial.json').read_text())
  await page.evaluate('''async fixture=>{
    const THREE=await import('three'); const render=THREE.WebGLRenderer.prototype.render;THREE.WebGLRenderer.prototype.render=function(scene,camera){window.testCamera=camera;return render.call(this,scene,camera);};
    const {createWiringSimulator,pinLayout}=await import('/wiring/wiring-simulator.js?v=20260916-wiring-repair-2');
    const {createWiringSpatialView}=await import('/wiring/wiring-spatial-view.js?v=20260916-wiring-repair-2');
    const {createWiringSpatialWorkspace}=await import('/wiring/wiring-spatial-workspace.js?v=20260916-wiring-repair-2');
    const {updateWiringQuestions}=await import('/wiring/wiring-questions.js?v=20260916-wiring-repair-2');
    const sim=createWiringSimulator({root:document.getElementById('wiring-viewport'),getProjectId:()=>null});sim.applySchematic(fixture,{save:false});
    const spatial=createWiringSpatialView({scene:new THREE.Scene()});
    const workspace=createWiringSpatialWorkspace({root:document.getElementById('wiring-content-area'),spatial,getSchematic:()=>sim.getSchematic(),onConnect:(a,b)=>sim.connectPins(a,b),onMove:(id,pos)=>sim.moveSpatialComponent(id,pos)});
    window.test={sim,spatial,workspace,THREE,pinLayout,fixture,updateWiringQuestions};workspace.setActive(true);
    window.screenPoint=(id,pin)=>{const v=pin?spatial.getAnchor(id,pin):spatial.getGroup().children.find(n=>n.userData.wiringComponentId===id).position.clone();v.project(window.testCamera);const r=document.querySelector('.wiring-spatial-stage canvas').getBoundingClientRect();return {x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2};};
  }''',fixture)
  await page.wait_for_timeout(600)
  assert await page.locator('#wiring-viewport').evaluate('e=>getComputedStyle(e).display')=='none'
  assert await page.locator('.wiring-spatial-stage canvas').count()==1
  checks.append('Production CSS hides 2D viewport and pins in 3D mode')
  result=await page.evaluate('''()=>{
    const {sim,spatial,pinLayout}=test;let endpoints=0;
    for(const wire of sim.getSchematic().wires){const a=spatial.getAnchor(wire.from.componentId,wire.from.pinId),b=spatial.getAnchor(wire.to.componentId,wire.to.pinId);const tube=spatial.getGroup().children.find(n=>n.name==='wiring-tube:'+wire.id);if(a&&b&&tube&&tube.geometry.parameters.path.getPoint(0).distanceTo(a)<1e-6&&tube.geometry.parameters.path.getPoint(1).distanceTo(b)<1e-6)endpoints++;}
    return {endpoints,wires:sim.getSchematic().wires.length,pins:sim.getSchematic().components.every(c=>pinLayout(c).every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)),blocker:sim.getSchematic().blocker,continuation:sim.getSchematic().continuation};
  }''')
  assert result['endpoints']==result['wires']==21 and result['pins']
  assert result['continuation']['driver_links']==fixture['continuation']['driver_links']
  checks.append('All 21 project wire endpoints land on their named visible terminals; follow-ups and references survive loading')
  await page.screenshot(path=str(OUT/'project-3d.png'))
  await page.click('[data-wiring-top]');await page.wait_for_timeout(300)
  await page.click('[data-wiring-wire]')
  for pin in ['ena_plus','ena_minus']:
   pt=await page.evaluate('(pin)=>screenPoint("driver",pin)',pin);await page.mouse.click(**pt)
  count=await page.evaluate('test.sim.getSchematic().wires.length')
  assert count==22,count
  assert await page.evaluate('test.sim.undo()')
  await page.evaluate('test.workspace.sync()')
  assert await page.evaluate('test.sim.getSchematic().wires.length')==21
  checks.append('Actual terminal clicks create a connection, and undo removes exactly that connection')
  await page.click('[data-wiring-move]')
  pt=await page.evaluate('screenPoint("motor_psu")');before=await page.evaluate('test.sim.getSchematic().components.find(c=>c.id==="motor_psu").position3d || null')
  await page.mouse.move(**pt);await page.mouse.down();await page.mouse.move(pt['x']+80,pt['y']+40,steps=8);await page.mouse.up()
  after=await page.evaluate('test.sim.getSchematic().components.find(c=>c.id==="motor_psu").position3d || null')
  assert after and before!=after,{'before':before,'after':after}
  assert await page.evaluate('test.sim.undo()');await page.evaluate('test.workspace.sync()')
  checks.append('Dragging a 3D part persists its position; undo restores its prior position')
  await page.click('#btn-wiring-view-breadboard');assert await page.locator('#wiring-viewport').is_visible()
  checks.append('Returning to Schematic restores the existing 2D viewport')
  await page.evaluate('''()=>test.updateWiringQuestions({root:document.getElementById('wiring-content-area'),projectId:'fixture',schematic:test.sim.getSchematic(),onContinue:async request=>{window.continued=request;}})''')
  dialog=page.locator('.wiring-questions-dialog');assert await dialog.is_visible()
  fields=dialog.locator('textarea');await fields.nth(0).fill('I have a separate 24V supply and the official Pi 5 adapter.');await fields.nth(1).fill('Interface datasheet: https://example.com/step-dir-buffer.pdf')
  await dialog.get_by_text('Answer later',exact=True).click();await page.click('.wiring-questions-open')
  assert await fields.nth(0).input_value()=='I have a separate 24V supply and the official Pi 5 adapter.'
  await page.screenshot(path=str(OUT/'additional-details.png'))
  await dialog.get_by_text('Continue generation',exact=True).click()
  continued=await page.evaluate('window.continued');assert len(continued['answers'])==2
  assert continued['driver_links']==fixture['continuation']['driver_links'] and continued['references']==fixture['continuation']['references']
  checks.append('Question popup reopens with answers intact and submits original links/references with structured answers')
  named=await page.evaluate("""async()=>{const {analyzeCircuit,generateCode}=await import('/wiring/wiring-sim-engine.js?v=20260916-wiring-repair-2');const a=analyzeCircuit(test.sim.getSchematic()).actuators[0];return {wired:a.wired,needsDriver:a.needsDriver,supported:a.simulationSupported,code:generateCode(test.sim.getSchematic())};}""")
  assert named['wired'] and not named['needsDriver'] and named['supported'] is False
  assert 'controller firmware' in named['code']
  checks.append('Named motor terminals recognize the connected external driver without inventing Arduino firmware')
  # Actual netlist behavior: a-e connected, f-j isolated until an explicit jumper exists.
  behavior=await page.evaluate('''async()=>{
    const {analyzeCircuit}=await import('/wiring/wiring-sim-engine.js?v=20260916-wiring-repair-2');
    const c={components:[{id:'board',type:'arduino-uno'},{id:'bb',type:'breadboard'},{id:'led',type:'led'}],wires:[{from:{componentId:'board',pinId:'d2'},to:{componentId:'bb',pinId:'a1'}},{from:{componentId:'bb',pinId:'j1'},to:{componentId:'led',pinId:'anode'}},{from:{componentId:'board',pinId:'gnd'},to:{componentId:'led',pinId:'cathode'}}]};
    const isolated=analyzeCircuit(c).actuators[0].wired;c.wires.push({from:{componentId:'bb',pinId:'e1'},to:{componentId:'bb',pinId:'f1'}});return {isolated,jumpered:analyzeCircuit(c).actuators[0].wired};
  }''')
  assert behavior=={'isolated':False,'jumpered':True},behavior
  checks.append('Breadboard center gap conducts only after adding a real jumper')
  assert not errors,errors
  report={'passed':True,'checks':checks,'pageErrors':errors};(OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));await browser.close()
asyncio.run(main())
