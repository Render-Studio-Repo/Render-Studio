"""Full Studio boot with real GPU allocation and injected transient/permanent failures."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path('/private/tmp/webgl-studio-startup');OUT.mkdir(exist_ok=True)
async def main():
 results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  for name,blocks in [('normal',0),('transient',7),('unavailable',99999)]:
   print('Starting '+name,flush=True)
   page=await browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.add_init_script('''(()=>{const original=HTMLCanvasElement.prototype.getContext;window.gpuTest={calls:[],remaining:sessionStorage.getItem('render3d:webgl-compatible-retry:v1')==='1'?0:BLOCKS};HTMLCanvasElement.prototype.getContext=function(type,attrs){if(type.startsWith('webgl')||type==='experimental-webgl'){gpuTest.calls.push(type);if(gpuTest.remaining-->0){this.dispatchEvent(new WebGLContextEvent('webglcontextcreationerror',{statusMessage:'Injected GPU startup refusal'}));return null;}}return original.call(this,type,attrs);};})();'''.replace('BLOCKS',str(blocks)))
   response=await page.goto('http://127.0.0.1:8001/',wait_until='domcontentloaded',timeout=60000)
   if name=='unavailable':
    await page.wait_for_selector('.webgl-retry-button',state='attached',timeout=30000)
    await page.evaluate("document.querySelector('.webgl-fallback-message').style.position='fixed';document.querySelector('#app')?.style.setProperty('display','flex');document.querySelector('#viewport')?.style.setProperty('display','block')")
    panel=page.locator('.webgl-fallback-message');await page.evaluate("document.body.append(document.querySelector('.webgl-fallback-message'));document.querySelector('.webgl-fallback-message').style.zIndex='999999';document.querySelector('.webgl-fallback-message details').open=true")
    assert 'Injected GPU startup refusal' in await panel.text_content(),await panel.text_content()
    await page.evaluate("document.querySelector('.webgl-retry-button').click()")
    await page.wait_for_function("document.querySelector('.webgl-retry-button').disabled===false")
    assert 'still could not start' in await panel.inner_text()
    await panel.screenshot(path=str(OUT/'unavailable.png'))
    failed_calls=await page.evaluate('gpuTest.calls')
    assert any(kind in ('webgl','experimental-webgl') for kind in failed_calls),failed_calls
    await page.evaluate('gpuTest.remaining=0')
    async with page.expect_navigation(wait_until='domcontentloaded'):
     await page.evaluate("document.querySelector('.webgl-retry-button').click()")
    await page.wait_for_selector('#viewport canvas[data-engine]',state='attached',timeout=30000)
    attributes=await page.evaluate("document.querySelector('#viewport canvas[data-engine]').getContext('webgl2').getContextAttributes()")
    assert attributes['antialias'] is False and attributes['preserveDrawingBuffer'] is False,attributes
    assert await page.evaluate("sessionStorage.getItem('render3d:webgl-compatible-retry:v1')") is None
    assert await page.locator('.webgl-fallback-message').count()==0
   else:
    try:
     await page.wait_for_selector('#viewport canvas[data-engine]',state='attached',timeout=30000)
    except Exception:
     print(json.dumps({'scenario':name,'errors':errors,'graphics':await page.evaluate('gpuTest')}),flush=True)
     await page.screenshot(path=str(OUT/(name+'-failure.png')))
     raise
    await page.wait_for_timeout(1500)
    assert await page.locator('.webgl-fallback-message').count()==0
    healthy=await page.evaluate("(()=>{const gl=document.querySelector('#viewport canvas[data-engine]').getContext('webgl2');return !!gl&&!gl.isContextLost()})()")
    assert healthy
    await page.screenshot(path=str(OUT/(name+'.png')))
   calls=await page.evaluate('gpuTest.calls');assert not errors,errors
   results.append({'scenario':name,'status':response.status,'webgl2Calls':len(calls),'pageErrors':errors});await page.close()
  await browser.close()
 (OUT/'report.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
asyncio.run(main())
