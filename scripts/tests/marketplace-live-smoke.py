#!/usr/bin/env python3
"""Read-only live marketplace, Studio and docs smoke; no user mutations."""
import asyncio,json
from pathlib import Path
from urllib.parse import quote
from playwright.async_api import async_playwright
OUT=Path(__file__).resolve().parents[2]/'backups/marketplace-20260915/verification';BASE='http://127.0.0.1:8001'
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':1000});errors=[];assets=[];report={}
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('response',lambda r:assets.append((r.status,r.url.split('?')[0])) if r.status>=400 and '/api/' not in r.url else None)
  for path,status in [('/api/health',200),('/api/marketplace/discover?q=robot',200),('/api/marketplace/messages',401),('/api/marketplace/profile-showcase/me',401),('/api/marketplace/store/me',401)]:
   r=await page.request.get(BASE+path);assert r.status==status,(path,r.status);report[path]=r.status
  r=await page.request.get(BASE+'/api/marketplace/catalog');assert r.status==200;catalog=await r.json();listings=catalog.get('listings',[]);report['catalog_count']=len(listings);report['restored_thumbnails']=0
  for item in listings:
   if str(item.get('thumbnail_url') or '').endswith('/thumbnail'):
    thumb=await page.request.get(BASE+item['thumbnail_url']);assert thumb.status==200;assert 'sandbox' in thumb.headers.get('content-security-policy','');report['restored_thumbnails']+=1
   assert 'members' not in item and 'email' not in (item.get('owner') or {})
   assert all('data_url' not in f and 'ref' not in f for f in item.get('files',[]))
  if listings:
   item=listings[0];r=await page.request.get(BASE+'/api/marketplace/product/'+quote(item['kind'])+'/'+quote(item['id'])+'/presentation');assert r.status==200;report['presentation']=200;presentation=await r.json()
   if item['kind']!='agent' and not any(f.get('download_available') for f in item.get('files',[])):
    assert presentation['has_downloads'] is False and presentation['preview_url'] is None
  r=await page.request.get('https://render3d.app/marketplace.html');assert r.status==200;assert '20260915-marketplace3' in await r.text();report['public_release']=200;print('Live API and public release checks passed',flush=True)
  await page.goto(BASE+'/marketplace.html',wait_until='domcontentloaded');await page.locator('[data-shop-agent]').wait_for();await page.wait_for_function("[...document.querySelectorAll('.shop-hero-art img')].every(i=>i.complete&&i.naturalWidth>0)");await page.screenshot(path=str(OUT/'marketplace-live-desktop.png'),full_page=True)
  assert await page.locator('.mkt-topbar-actions').count()==1
  await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/'marketplace-live-mobile.png'),full_page=True)
  assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  await page.set_viewport_size({'width':1440,'height':1000})
  if listings:
   await page.goto(BASE+'/marketplace.html#/p/'+quote(item['kind'])+'/'+quote(item['id']),wait_until='domcontentloaded');await page.locator('.shop-product-page').wait_for();await page.screenshot(path=str(OUT/'marketplace-live-product.png'),full_page=True)
   handle=(item.get('owner') or {}).get('handle') or item.get('owner_handle')
   if handle:
    r=await page.request.get(BASE+'/api/marketplace/profile/'+quote(handle)+'/showcase');assert r.status==200;report['public_profile']=200
    await page.goto(BASE+'/u/'+quote(handle),wait_until='domcontentloaded');await page.locator('.profile-showcase').wait_for(timeout=15000);await page.screenshot(path=str(OUT/'marketplace-live-profile.png'),full_page=True)
  await page.goto(BASE+'/',wait_until='domcontentloaded',timeout=45000);await page.locator('#viewport canvas').wait_for(timeout=45000);await page.wait_for_timeout(6000);await page.keyboard.press('Escape');await page.screenshot(path=str(OUT/'release-studio.png'))
  for path in ('/docs.html','/getting-started.html'):
   r=await page.goto(BASE+path,wait_until='domcontentloaded');assert r.status==200;await page.wait_for_timeout(2000)
  await page.screenshot(path=str(OUT/'release-docs.png'))
  report.update(page_errors=errors,failed_assets=assets,studio_canvas=True,docs=True)
  (OUT/'release-smoke.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
  assert not [e for e in errors if not e.startswith('Not authenticated')],errors
  assert not assets,assets
  await browser.close()
asyncio.run(main())
