#!/usr/bin/env python3
"""Touch interaction regression using Studio's real DOM/CSS/modules and inert app callbacks."""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]; OUT=Path('/private/tmp/render-mobile-checks');OUT.mkdir(exist_ok=True)
async def main():
 html=(ROOT/'frontend/index.html').read_text();imap=re.search(r'<script type="importmap">(.*?)</script>',html,re.S).group(0)
 html=re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S).replace('</head>',imap+'</head>')
 reports=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  for width,height,touch in [(320,568,True),(390,844,True),(430,932,True),(844,390,True),(1024,768,True),(1440,900,False)]:
   page=await browser.new_page(viewport={'width':width,'height':height},is_mobile=touch,has_touch=touch,device_scale_factor=1)
   page.set_default_timeout(5000)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.route('**/__mobile-layout',lambda r:r.fulfill(content_type='text/html',body=html))
   await page.goto('http://127.0.0.1:8001/__mobile-layout',wait_until='domcontentloaded')
   await page.evaluate('''async()=>{
     document.body.classList.add('is-signed-in');document.getElementById('app').classList.remove('hidden');
     document.querySelectorAll('.studio-boot,.studio-boot-splash,#studio-boot-screen').forEach(e=>e.remove());
     window.actions=[];window.Render3DMobileStudio={openLeftPanel:()=>actions.push('explorer'),closePanels:()=>{},openAiPanel:()=>actions.push('ai'),openRightPanel:()=>actions.push('edit-tools'),openModelPicker:()=>actions.push('models'),openDesignTab:t=>actions.push(t),triggerUpload:()=>{actions.push('upload');return true;}};
     for(const id of ['btn-new-project','btn-export-model']) {const b=document.getElementById(id);if(b){b.disabled=false;b.addEventListener('click',()=>actions.push(id));}}
     await import('/components/mobile-app-chrome.js?v=20260916-mobile-taps2');await import('/studio/toolbar-nav.js?v=20260916-mobile-taps2');
     const THREE=await import('three');const {createGizmoPanel}=await import('/viewport/gizmo-panel.js?v=mobile-test');
     const controls=new THREE.EventDispatcher();Object.assign(controls,{object:new THREE.Object3D(),mode:'translate',space:'world',getMode(){return this.mode;},setMode(m){this.mode=m;},setSpace(v){this.space=v;},setTranslationSnap(){},setRotationSnap(){},setScaleSnap(){}});
     window.gizmo=createGizmoPanel({viewport:document.getElementById('viewport'),transformControls:controls,getMesh:()=>controls.object,getModelInfo:()=>({}),getMmPerModelUnit:()=>1,api:async()=>({})});gizmo.show();
     window.hitControl=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {hit:hit?.id||hit?.className,ok:e===hit||e.contains(hit),x:r.x,y:r.y,w:r.width,h:r.height};};
   }''')
   await page.wait_for_timeout(600)
   if not touch:
    assert await page.locator('.gizmo-panel').is_visible()
    assert not await page.locator('#mobile-app-banner').is_visible()
    reports.append({'size':f'{width}x{height}','desktopTransformPreserved':True,'errors':errors});await page.close();continue
   assert not await page.locator('.gizmo-panel').is_visible(),'Transform popup visible on phone'
   controls=await page.evaluate('''()=>[...document.querySelectorAll('#mobile-app-banner > .mobile-app-banner-btn,#mobile-select-fab,#mobile-browser-fab,#btn-xr-vr,.toolbar-nav-toggle,#btn-auth')].map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.dataset.mobileBanner||e.className,x:r.x,y:r.y,w:r.width,h:r.height};})''')
   for a in controls:
    assert a['x']>=-1 and a['y']>=-1 and a['x']+a['w']<=width+1 and a['y']+a['h']<=height+1,(width,a)
    assert a['w']>=44 and a['h']>=44,(width,a)
    for b in controls:
     if a is b:continue
     overlap=min(a['x']+a['w'],b['x']+b['w'])-max(a['x'],b['x'])>1 and min(a['y']+a['h'],b['y']+b['h'])-max(a['y'],b['y'])>1
     assert not overlap,(width,a,b)
   # A real tap must leave the menu open, and the last tile must scroll into view.
   await page.locator('.toolbar-nav-toggle').tap()
   assert await page.locator('.toolbar-nav-menu').is_visible(),width
   await page.locator('[data-mobile-app="export"]').tap()
   assert await page.evaluate("actions.includes('btn-export-model')"),width
   assert not await page.locator('#toolbar-nav-backdrop').is_visible()
   await page.locator('.toolbar-nav-toggle').tap();await page.locator('[data-mobile-app="explorer"]').tap()
   assert await page.evaluate("actions.includes('explorer')")
   # Fast distinct button presses remain native clicks, including after touching the viewport.
   await page.locator('[data-mobile-banner="tools"]').tap();assert await page.locator('#mobile-tools-popup').is_visible()
   assert not await page.locator('#mobile-select-fab').is_visible()
   btn=page.locator('#mobile-tools-popup [data-mobile-tool="browser"]');await btn.scroll_into_view_if_needed()
   hit=await page.evaluate('hitControl(\'#mobile-tools-popup [data-mobile-tool="browser"]\')');assert hit['ok'],(width,hit)
   await page.locator('[data-mobile-banner="tools"]').tap();assert not await page.locator('#mobile-tools-popup').is_visible()
   await page.locator('#mobile-select-fab').tap();assert await page.locator('#mobile-select-popup').is_visible()
   await page.locator('#mobile-select-popup [data-mode="face"]').tap()
   await page.locator('[data-mobile-banner="more"]').tap()
   assert await page.locator('#mobile-more-sheet').is_visible()
   assert not await page.locator('#mobile-select-popup').is_visible()
   assert await page.locator('#mobile-more-sheet .mobile-app-banner-social-link').count()==3
   await page.locator('.mobile-more-sheet-head [data-mobile-more-close]').tap()
   await page.locator('.toolbar-nav-toggle').tap()
   await page.locator('.toolbar-nav-close').tap()
   assert not await page.locator('#toolbar-nav-backdrop').is_visible()
   await page.screenshot(path=str(OUT/f'phone-{width}x{height}.png'))
   await page.locator('.toolbar-nav-toggle').tap();await page.screenshot(path=str(OUT/f'menu-{width}x{height}.png'))
   assert not errors,errors
   reports.append({'size':f'{width}x{height}','controlsWithinScreen':True,'noControlOverlaps':True,'minimumTarget44px':True,'menuTaps':True,'flyouts':True,'transformHidden':True,'errors':errors})
   await page.close()
  await browser.close()
 (OUT/'report.json').write_text(json.dumps(reports,indent=2));print(json.dumps(reports,indent=2))
asyncio.run(main())
