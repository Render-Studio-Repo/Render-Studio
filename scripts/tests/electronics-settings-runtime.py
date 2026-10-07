"""Real gear markup/settings switches plus full Studio boot. No generation calls."""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2];OUT=Path('/private/tmp/electronics-settings-runtime');OUT.mkdir(exist_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']);page=await browser.new_page(viewport={'width':1000,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)+' '+(e.stack or '')))
  html='<html><head><link rel="stylesheet" href="/studio/styles.css"><link rel="stylesheet" href="/studio/electronics-build-settings.css"><style>body{background:#101923;padding:20px}.hidden{display:none!important}#prompt-ai-gear-popup{display:block!important;position:relative!important;left:0!important;top:0!important;width:min(340px,calc(100vw - 40px))!important;max-height:800px!important}</style></head><body></body></html>'
  await page.route('**/__electronics-settings',lambda r:r.fulfill(content_type='text/html',body=html));await page.goto('http://127.0.0.1:8001/__electronics-settings')
  await page.evaluate("html=>{const doc=new DOMParser().parseFromString(html,'text/html');document.head.append(...doc.querySelectorAll('link[rel=stylesheet]'));document.body.append(doc.querySelector('#prompt-ai-gear'),doc.querySelector('#prompt-ai-gear-popup'));}",(ROOT/'frontend/index.html').read_text())
  await page.evaluate('''async()=>{window.pid='test-a';const {mountElectronicsBuildSettings,automaticWiringEnabled}=await import('/studio/electronics-build-settings.js');window.enabled=automaticWiringEnabled;mountElectronicsBuildSettings(()=>pid);document.querySelector('#prompt-electronics-wrap').classList.remove('hidden');document.querySelector('#prompt-mcmaster-parts-wrap').hidden=false;const {mountMicroEdits}=await import('/studio/micro-edits.js');window.micro=mountMicroEdits({getProjectId:()=>pid,isCad:()=>true,setEditMode:()=>{window.edited=true;}});document.addEventListener('render:open-parts',e=>window.partsEvent=e.detail);document.querySelector('#prompt-cad-tools').classList.remove('hidden');}''')
  assert await page.locator('#prompt-auto-wiring').is_checked();await page.uncheck('#prompt-auto-wiring');assert not await page.evaluate("enabled('test-a')")
  await page.evaluate("pid='test-b';document.querySelector('#prompt-ai-gear').click()");assert await page.locator('#prompt-auto-wiring').is_checked()
  await page.evaluate("pid='test-a';document.querySelector('#prompt-ai-gear').click()");assert not await page.locator('#prompt-auto-wiring').is_checked()
  await page.click('#prompt-parts-list');assert await page.evaluate('partsEvent.tab')=='electronics'
  assert await page.locator('#prompt-ai-gear-popup #prompt-mcmaster-parts-wrap').count()==1
  await page.check('.micro-edit-toggle input');assert await page.evaluate('edited')
  assert await page.locator('dialog[open]').count()==0
  await page.hover('.micro-edit-toggle');assert await page.locator('#micro-edit-help').is_visible()
  await page.mouse.move(600,600);await page.evaluate("document.activeElement?.blur()");await page.screenshot(path=str(OUT/'gear-settings.png'));await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/'gear-mobile.png'))
  fixture_errors=list(errors);errors.clear();await page.set_viewport_size({'width':1440,'height':900})
  response=await page.goto('http://127.0.0.1:8001/',wait_until='domcontentloaded');await page.wait_for_timeout(3500);await page.screenshot(path=str(OUT/'studio-boot.png'))
  assert response.status==200 and not errors and not fixture_errors,errors
  docs=await page.goto('http://127.0.0.1:8001/docs.html',wait_until='domcontentloaded');assert docs.status==200
  result={'checks':['Project-specific auto wiring default and saved switches','Parts moved into gear with Electronics action','Micro edits switch and hover help without modal','Studio boots without JS exceptions','Docs unaffected'],'errors':errors};(OUT/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));await browser.close()
asyncio.run(main())
