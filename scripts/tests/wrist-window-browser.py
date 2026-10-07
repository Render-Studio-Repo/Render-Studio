import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  page=await browser.new_page(viewport={'width':1920,'height':1080})
  await page.route('**/wrist-fixture',lambda r:r.fulfill(content_type='text/html',body='<html><head><link rel="stylesheet" href="/studio/styles.css"></head><body style="background:#111"><div id="viser-viewer" style="position:absolute;inset:140px 100px 40px"><div class="viser-stage" style="position:relative;width:100%;height:100%;background:#202a32"><h3>Viser camera window check</h3></div></div><main id="viewport"></main></body></html>'))
  async def stream(route):
   await asyncio.sleep(8)
   try: await route.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#256358"/><text x="50" y="95" fill="white">Camera test frame</text></svg>')
   except: pass
  await page.route('**/*mjpeg*',stream)
  await page.goto('http://127.0.0.1:8001/wrist-fixture')
  await page.evaluate('''async()=>{
   const {createWristCamPopups}=await import('/viewport/wrist-cam-popups.js?test=windowfix');
   window.camera=createWristCamPopups({viewport:document.querySelector('#viewport'),document,storage:localStorage,fetchFn:async(url)=>({ok:true,headers:{get:()=> '1'},json:async()=>({publish:true,wristCount:2,devices:[]}),blob:async()=>new Blob(['x'.repeat(100)],{type:'image/jpeg'})})});
   window.sources=[];new MutationObserver(ms=>ms.forEach(m=>{if(m.attributeName==='src')sources.push(m.target.src)})).observe(document.body,{subtree:true,attributes:true,attributeFilter:['src']});
   await camera.show();window.original=document.querySelector('[data-wrist-side="left"] [data-wrist-lan]');
  }''')
  await page.wait_for_timeout(600)
  before=await page.evaluate('sources.length')
  assert before==2,await page.evaluate('sources')
  title=page.locator('[data-wrist-side="left"] [data-wrist-titlebar]')
  box=await title.bounding_box()
  await page.mouse.move(box['x']+35,box['y']+15);await page.mouse.down();await page.mouse.move(1640,850,steps=25);await page.mouse.up()
  rect=await page.evaluate('camera.getLayout().left')
  assert rect['x']>1200 and rect['y']>700,rect
  saved=await page.evaluate('JSON.parse(localStorage.getItem("render3d:wristCamPopups:v3")).left')
  assert saved==rect,(saved,rect)
  await page.locator('[data-wrist-minimize="left"]').click()
  assert await page.locator('#viser-viewer [data-wrist-restore="left"]').is_visible()
  assert await page.evaluate('original.isConnected')
  await page.screenshot(path='/private/tmp/wrist-minimized.png')
  await page.locator('[data-wrist-restore="left"]').click()
  assert await page.evaluate('camera.getLayout().left')==rect
  assert await page.evaluate('original===document.querySelector("[data-wrist-side=left] [data-wrist-lan]")')
  assert await page.evaluate('sources.length')==before
  await page.wait_for_timeout(8500)
  assert await page.evaluate('sources.length')==before
  assert await page.evaluate('original.naturalWidth')==320
  await page.screenshot(path='/private/tmp/wrist-restored.png')
  await page.evaluate('camera.hide()')
  assert await page.locator('[data-wrist-restore]').count()==0
  print(json.dumps({'passed':True,'sourceAssignments':before,'savedRect':rect,'retainedMediaNode':True,'delayedStreamLoaded':True}))
  await browser.close()
asyncio.run(main())
