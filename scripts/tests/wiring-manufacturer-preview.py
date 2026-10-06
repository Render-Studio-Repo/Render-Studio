"""Render the sourced robot-base circuit using actual manufacturer GLB previews, with local read-only API fixtures."""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2];PROJECT=ROOT/'projects/5bf8e783';OUT=Path('/private/tmp/wiring-harness-runtime')
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']);page=await browser.new_page(viewport={'width':1500,'height':950});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  imports=re.search(r'<script type="importmap">(.*?)</script>',(ROOT/'frontend/index.html').read_text(),re.S).group(1)
  html='<html><head><script type="importmap">'+imports+'</script><link rel="stylesheet" href="/studio/styles.css"><style>body{margin:0;background:#101923;color:white;font-family:system-ui}#app{display:block!important}#wiring-content-area{width:100vw;height:100vh;position:relative}</style></head><body><div id="app" class="wiring-mode"><div id="wiring-content-area" class="wiring-content-area"><div id="wiring-viewport"></div></div></div></body></html>'
  models=list(json.loads((PROJECT/'wiring-models.json').read_text()).values())
  await page.route('**/__manufacturer-test',lambda r:r.fulfill(content_type='text/html',body=html))
  await page.route('**/api/projects/5bf8e783/wiring/models',lambda r:r.fulfill(content_type='application/json',body=json.dumps({'models':models})))
  for model in models:
   file=model['sourceFile'].rsplit('.',1)[0]+'.glb'
   await page.route('**/files/'+file,lambda r,request,f=file:r.fulfill(content_type='model/gltf-binary',body=(PROJECT/f).read_bytes()))
  await page.goto('http://127.0.0.1:8001/__manufacturer-test')
  await page.evaluate('''async schematic=>{
   const THREE=await import('three');const {createWiringCadModels}=await import('/wiring/wiring-cad-models.js');const {createWiringSpatialView}=await import('/wiring/wiring-spatial-view.js');const {createWiringSpatialWorkspace}=await import('/wiring/wiring-spatial-workspace.js');let workspace;
   const cache=createWiringCadModels({getProjectId:()=> '5bf8e783',onReady:()=>workspace?.sync(),headers:()=>({})});const spatial=createWiringSpatialView({scene:new THREE.Scene(),getCadModel:c=>cache.get(c)});workspace=createWiringSpatialWorkspace({root:document.querySelector('#wiring-content-area'),spatial,getSchematic:()=>schematic,getProjectId:()=> '5bf8e783'});workspace.setActive(true);window.preview={cache,workspace,spatial};
  }''',json.loads((PROJECT/'wiring.json').read_text()))
  await page.wait_for_function("preview.spatial.getContext().components.filter(c=>c.geometry.dimensions==='CAD linked').length===5")
  await page.click('[data-wiring-fit]');await page.wait_for_timeout(500)
  await page.evaluate("preview.spatial.focusNextWire()");await page.screenshot(path=str(OUT/'robot-base-manufacturer-cad.png'))
  assert not errors,errors;print(json.dumps({'manufacturer_instances':5,'errors':errors}));await browser.close()
asyncio.run(main())
