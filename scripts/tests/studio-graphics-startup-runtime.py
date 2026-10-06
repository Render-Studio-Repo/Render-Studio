"""Actual Studio boot/recovery with isolated account/API fixtures and real Three/WebGL2."""
import asyncio,json
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
OUT=Path('/private/tmp/studio-webgl-crash-20260916/runtime');OUT.mkdir(parents=True,exist_ok=True)

async def main():
 results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  for scenario,count in [('normal',0),('transient',4),('blocked',10000),('disabled',10000)]:
   page=await browser.new_page(viewport={'width':1440,'height':1000});errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   user={'id':'gpu-qa','email':'gpu@example.test','display_name':'Graphics test','handle':'gpuqa','role':'user'}
   await page.add_init_script('localStorage.setItem("render3d:token","qa-only");localStorage.setItem("render3d:user",'+json.dumps(json.dumps(user))+');')
   await page.add_init_script('''(()=>{const original=HTMLCanvasElement.prototype.getContext;
    window.glTest={remaining:sessionStorage.getItem('render3d:webgl-compatible-retry:v1')==='1'?0:COUNT,requests:0};
    HTMLCanvasElement.prototype.getContext=function(type,attrs){if(/^webgl|experimental-webgl/.test(type)){glTest.requests++;if(glTest.remaining-->0){this.dispatchEvent(new WebGLContextEvent('webglcontextcreationerror',{statusMessage:REASON}));return null;}}return original.call(this,type,attrs);};})();'''.replace('COUNT',str(count)).replace('REASON',json.dumps('GL_VENDOR = Disabled, GL_RENDERER = Disabled' if scenario=='disabled' else 'Injected browser graphics startup refusal')))
   async def api(route):
    path=urlparse(route.request.url).path
    await route.fulfill(json={'user':user} if path.endswith('/auth/me') else {'projects':[]} if path=='/api/projects' else {})
   await page.route('**/api/**',api)
   async def instrument(route):
    response=await route.fetch()
    source=await response.text()
    source+='\nwindow.__graphicsQA={renderer,camera,controls,objectTools,seed(){const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1.3,.8),new THREE.MeshStandardMaterial({color:0x77b8fa}));projectAssembly.add("graphics-qa.glb",mesh);currentMesh=mesh;fitCamera();return true;}};\n'
    await route.fulfill(response=response,body=source)
   await page.route('**/studio/app.js?*',instrument)
   response=await page.goto('http://127.0.0.1:8001/',wait_until='domcontentloaded')
   await page.wait_for_function("typeof globalThis.__studioMainWebGlReady==='boolean'",timeout=30000)
   await page.wait_for_timeout(3500)
   for selector in ['#ai-setup-intro-modal button[data-ai-setup-close]','#welcome-modal button[data-welcome-close]']:
    if await page.locator(selector).is_visible(): await page.locator(selector).click()
   if scenario in ['normal','transient']:
    assert await page.evaluate('globalThis.__studioMainWebGlReady')
    canvas=page.locator('#viewport canvas[data-engine]')
    await canvas.wait_for(state='visible')
    assert await canvas.evaluate("c=>{const gl=c.getContext('webgl2');return !!gl&&!gl.isContextLost()&&gl.drawingBufferWidth>0&&gl.drawingBufferHeight>0}")
    assert not await page.locator('.studio-graphics-recovery').count()
    if scenario=='transient':
     assert await canvas.evaluate("c=>c.getContext('webgl2').getContextAttributes().antialias===false")
     assert await page.evaluate('glTest.requests')>=5
    if scenario=='normal':
     await page.wait_for_function('!!window.__graphicsQA')
     await page.evaluate('window.__graphicsQA.seed()')
     await page.wait_for_timeout(200)
     bounds=await canvas.bounding_box();cx=bounds['x']+bounds['width']/2;cy=bounds['y']+bounds['height']/2
     await page.locator('#btn-pick-object').click()
     await page.mouse.click(cx,cy)
     await page.wait_for_function('!!window.__graphicsQA.objectTools.getSelection()')
     await page.locator('#btn-pick-orbit').click()
     before=await page.evaluate('__graphicsQA.camera.position.toArray()')
     await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+85,cy+45,steps=10);await page.mouse.up()
     await page.wait_for_timeout(150)
     assert await page.evaluate('__graphicsQA.camera.position.toArray()')!=before
     assert await page.evaluate('__graphicsQA.renderer.info.render.calls')>0
     assert await page.evaluate('!__graphicsQA.renderer.xr.isFallbackStub&&typeof __graphicsQA.renderer.xr.setSession===\"function\"')
     await page.locator('#workspace-mode-btn').click()
     await page.locator('.workspace-mode-option').filter(has_text='Wiring Simulator').click()
     await page.locator('#workspace-mode-btn').click()
     await page.locator('.workspace-mode-option').filter(has_text='Design').click()
     assert await canvas.is_visible()
     assert await page.locator('#prompt-input').count()==1
    await page.screenshot(path=str(OUT/(scenario+'.png')))
   else:
    assert not await page.evaluate('globalThis.__studioMainWebGlReady')
    panel=page.locator('.studio-graphics-recovery')
    await panel.wait_for(state='visible')
    assert await page.locator('.webgl-retry-button').is_enabled()
    assert not await page.locator('#viewport canvas[data-engine]').count()
    await panel.locator('details').evaluate('el=>el.open=true')
    assert ('GL_VENDOR = Disabled' if scenario=='disabled' else 'Injected browser graphics startup refusal') in await panel.inner_text()
    diagnostics=json.loads(await panel.locator('pre').inner_text())
    assert len(diagnostics['attempts'])==4
    assert await page.evaluate('glTest.requests') <= 16
    await page.screenshot(path=str(OUT/(scenario+'.png')))
    if scenario=='blocked':
     await page.locator('.webgl-retry-button').click()
     await page.wait_for_function("document.querySelector('.webgl-retry-button').disabled===false")
     assert 'still could not start' in await panel.inner_text()
     assert await page.evaluate("sessionStorage.getItem('render3d:webgl-compatible-retry:v1')") is None
     await page.evaluate('glTest.remaining=0')
     async with page.expect_navigation(wait_until='domcontentloaded'):
      await page.locator('.webgl-retry-button').click()
     await page.wait_for_function('globalThis.__studioMainWebGlReady===true',timeout=30000)
     canvas=page.locator('#viewport canvas[data-engine]')
     await canvas.wait_for(state='attached')
     attrs=await canvas.evaluate("c=>c.getContext('webgl2').getContextAttributes()")
     assert attrs['antialias'] is False and attrs['preserveDrawingBuffer'] is False
     assert await page.evaluate("sessionStorage.getItem('render3d:webgl-compatible-retry:v1')") is None
     assert not await page.locator('.studio-graphics-recovery').count()
   await page.evaluate("window.dispatchEvent(new CustomEvent('render3d:open-preferences-tab',{detail:{tab:'general'}}))")
   await page.wait_for_selector('#profile-preferences-panel:not(.hidden)')
   assert not errors,errors
   results.append({'scenario':scenario,'http':response.status,'pageErrors':errors,'preferencesReachable':True,'mainGraphicsReady':await page.evaluate('globalThis.__studioMainWebGlReady')})
   print(json.dumps(results[-1]),flush=True)
   if scenario=='normal':
    docs=await page.goto('http://127.0.0.1:8001/docs.html',wait_until='domcontentloaded')
    assert docs.status==200
   await page.close()
  await browser.close()
 (OUT/'report.json').write_text(json.dumps(results,indent=2))
asyncio.run(main())
