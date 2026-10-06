"""Read-only boot/docs/module verification of the running Render Studio server."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'backups/xr-ai-draw-20260915/verification/live'
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':1000});errors=[];failed=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('response',lambda r:failed.append({'status':r.status,'url':r.url}) if r.status>=400 and '/api/' not in r.url else None)
  health=await page.request.get('http://127.0.0.1:8001/api/health');assert health.status==200
  await page.goto('http://127.0.0.1:8001/',wait_until='domcontentloaded',timeout=60000)
  await page.locator('#viewport canvas').wait_for(timeout=60000)
  await page.wait_for_timeout(4000);await page.keyboard.press('Escape')
  await page.screenshot(path=str(OUT/'studio.png'))
  modules=await page.evaluate('''async()=>{const modules=['xr-ai-board-state','xr-ai-board-graph','xr-ai-board-persistence','xr-ai-draw-assets','xr-ai-draw-view','xr-ai-draw-workspace','xr-ai-draw-prompt','xr-draw-voice'];for(const name of modules)await import('/xr/'+name+'.js?v=20260915-spatial-draw4');return modules;}''')
  await page.goto('http://127.0.0.1:8001/docs.html#doc-vr-ai-draw',wait_until='domcontentloaded',timeout=60000)
  await page.get_by_role('heading',name='Spatial AI Draw with live voice',exact=True).wait_for(timeout=15000)
  await page.get_by_role('heading',name='Spatial AI Draw with live voice',exact=True).scroll_into_view_if_needed()
  await page.screenshot(path=str(OUT/'workflow-docs.png'))
  public=await page.request.get('https://render3d.app/');assert public.status==200
  assert 'vrboard=20260915-spatial-draw4' in await public.text()
  expected_auth=[error for error in errors if error.startswith('Not authenticated [trace #')]
  errors=[error for error in errors if error not in expected_auth]
  result={'expectedSignedOutAuth':expected_auth,'studioCanvas':True,'modules':modules,'docsWorkflow':True,'publicRelease':public.status,'pageErrors':errors,'failedAssets':failed}
  (OUT/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
  await browser.close()
  assert not errors,errors
  assert not failed,failed
asyncio.run(main())
