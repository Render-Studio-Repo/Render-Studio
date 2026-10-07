import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':1000});errors=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  await page.goto('http://127.0.0.1:8001/',wait_until='domcontentloaded',timeout=60000)
  await page.wait_for_function('!!window.Render3DViewportXR && !!window.Render3DXrAgent',timeout=60000)
  await page.wait_for_timeout(1500);await page.keyboard.press('Escape')
  await page.evaluate('window.Render3DXrAgent.openSettings()')
  await page.get_by_role('searchbox',name='Search agent settings and history').fill('room')
  await page.screenshot(path='/private/tmp/xr-agent-final-settings.png')
  assert not await page.locator('.xrag-pane-changes').is_visible()
  settings=await page.locator('.xrag-settings-overlay').inner_text()
  assert 'Let the room hear my agent' in settings
  await page.get_by_role('button',name='Close agent settings',exact=True).click()
  await page.locator('#workspace-mode-btn').click()
  menu=await page.locator('#workspace-mode-menu').inner_text()
  await page.locator('#workspace-mode-menu').get_by_text('Wiring',exact=False).first.click()
  await page.locator('#btn-wiring-view-spatial').click()
  await page.wait_for_timeout(1000)
  assert await page.locator('.wiring-spatial-view').is_visible()
  assert not await page.locator('#viewport-browser-panel').is_visible()
  assert not await page.locator('.wiring-requirements').is_visible()
  ar=await page.locator('#btn-wiring-spatial-ar').bounding_box();three=await page.locator('#btn-wiring-view-spatial').bounding_box()
  assert ar['x']<three['x'] and ar['y']>500
  await page.screenshot(path='/private/tmp/xr-agent-final-wiring.png')
  await page.locator('#btn-wiring-view-breadboard').click()
  assert not await page.locator('.wiring-spatial-view').is_visible()
  assert not [e for e in errors if 'Not authenticated' not in e],errors
  await page.goto('http://127.0.0.1:8001/docs.html',wait_until='domcontentloaded')
  report={'passed':True,'app':'XR and agent initialized','settingsSearch':True,'wiring3D':True,'arBefore3DAtBottom':True,'schematicReturn':True,'docs':await page.title(),'pageErrors':errors}
  Path('/private/tmp/xr-agent-final-browser.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));await browser.close()
asyncio.run(main())
