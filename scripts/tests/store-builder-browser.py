import asyncio,json,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from playwright.async_api import async_playwright
from fastapi import FastAPI,Body
from fastapi.testclient import TestClient
from backend.database import init_db
from backend.services import marketplace_storefront_service as service
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'backups/marketplace-20260915/store-builder';OUT.mkdir(parents=True,exist_ok=True)
ITEMS=[{'id':'robot','name':'Robot arm assembly','kind':'model','category':'robots','tagline':'An editable desktop robot assembly','price_cents':2490,'thumbnail_url':'/test-thumb/robot.svg'}, {'id':'gear','name':'Parametric gear toolkit','kind':'model','category':'parts','tagline':'Connected project and source files','price_cents':1200,'thumbnail_url':'/test-thumb/gear.svg'}, {'id':'skill','name':'CAD automation skill','kind':'knowledge','category':'knowledge','tagline':'A documented workflow for repeatable parts','price_cents':0,'thumbnail_url':'/test-thumb/skill.svg'}]
HTML='''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:20px;background:#f4f6f8}</style></head><body><div id="root"></div><script type="module">import {mountStorefrontBuilder} from '/marketplace/storefront-builder.js?v=20260915-store-builder1';const api=async(path,options={})=>{const r=await fetch(path,{...options,headers:{'content-type':'application/json'}});const d=await r.json();if(!r.ok)throw Error(d.detail);return d;};window.builder=mountStorefrontBuilder(document.querySelector('#root'),await api('/api/test-store'),{api,initialEdit:true});</script></body></html>'''
async def main():
 with tempfile.TemporaryDirectory() as temp,patch('backend.database.DB_PATH',Path(temp)/'test.db'):
  init_db();profile={'is_self':True,'display_name':'Northline Studio','handle':'northline','store':{'store_title':'Northline Workshop','store_tagline':'Thoughtful tools for curious makers.'}};layout=[{'id':'featured','type':'featured_models','label':'Featured projects','visible':True},{'id':'catalog','type':'models','label':'All products','visible':True},{'id':'about','type':'about','label':'About','visible':True}];service.save_layout('test',layout)
  app=FastAPI()
  @app.get('/api/marketplace/store/northline')
  @app.get('/api/test-store')
  def store():return {'profile':profile,'layout':service.get_layout('test'),'listings':ITEMS,'cover':{},'slug':'northline'}
  @app.put('/api/marketplace/store/layout')
  def save(body:dict=Body(...)):return service.save_layout('test',body['layout'])
  @app.patch('/api/users/me/store-settings')
  def settings(body:dict=Body(...)):profile['store'].update(body);return {'settings':profile['store']}
  @app.post('/api/marketplace/store/layout/suggest')
  def ai_layout(body:dict=Body(...)):return {'layout':[{'id':'story','type':'about','label':'Our story','title':'Small parts, big ideas','body':'Test AI layout preview.'},{'id':'catalog','type':'models','label':'All products'}],'summary':'An editorial layout draft.'}
  @app.post('/api/marketplace/store/product-description')
  def ai_copy(body:dict=Body(...)):return {'description':'An editable robot arm assembly with connected project source.','notes':'Confirm dimensions before publishing.'}
  client=TestClient(app)
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
   page=await browser.new_page(viewport={'width':1480,'height':1000});errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
   async def route(req):
    path=req.request.url.split('127.0.0.1:8001')[-1]
    if path.startswith('/s/northline'):return await req.fulfill(status=200,body=(ROOT/'frontend/pages/storefront.html').read_text(),content_type='text/html')
    if path.startswith('/__store_test'):return await req.fulfill(status=200,body=HTML,content_type='text/html')
    if path.startswith('/test-thumb/'):
     name=path.split('/')[-1].replace('.svg','');svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="500"><rect width="720" height="500" fill="{dict(robot="#dbe9eb",gear="#e7e4dc",skill="#dbe3ef")[name]}"/><g fill="none" stroke="#497483" stroke-width="15"><path d="M240 375 L270 230 L420 180 L490 90"/><circle cx="270" cy="230" r="38"/><circle cx="420" cy="180" r="34"/><rect x="180" y="375" width="180" height="40" rx="9"/></g><text x="35" y="465" font-size="25" font-family="sans-serif" fill="#497483">{name.upper()}</text></svg>';return await req.fulfill(status=200,body=svg,content_type='image/svg+xml')
    if path.startswith('/api/'):
     r=client.request(req.request.method,path,content=req.request.post_data or None,headers={'content-type':'application/json'});return await req.fulfill(status=r.status_code,body=r.content,content_type='application/json')
    return await req.continue_()
   await page.route('**/*',route)
   await page.goto('http://127.0.0.1:8001/__store_test',wait_until='networkidle');await page.locator('[data-sf-save]').wait_for()
   assert await page.locator('.sf-product').count()==6
   await page.click('[data-template="showcase"]');await page.locator('[data-sf-slideshow]').wait_for();assert await page.locator('.sf-slide:not([hidden])').count()==1
   await page.click('[data-slide-next]');assert await page.locator('[data-slide-count]').inner_text()=='2 / 3'
   await page.click('[data-sf-save]');await page.wait_for_function("document.querySelector('[data-sf-status]').textContent.includes('Store saved')")
   assert not await page.locator('[data-ai-layout]').is_disabled()
   await page.reload(wait_until='networkidle');assert await page.locator('[data-sf-slideshow]').count()==1
   assert await page.locator('[data-section-id]').evaluate_all('(els)=>els.map(e=>e.dataset.sectionId)')==['slideshow','gallery','about','models']
   # Drag by the visible section handle, and validate persisted order.
   await page.locator('.sf-store-preview [data-select-section="gallery"]').drag_to(page.locator('[data-section-id="slideshow"]'),target_position={'x':20,'y':10})
   assert (await page.locator('[data-section-id]').evaluate_all('(els)=>els.map(e=>e.dataset.sectionId)'))[0]=='gallery'
   await page.fill('[data-section-field="title"]','Made in the workshop');assert await page.locator('[data-section-id="gallery"] h2').inner_text()=='Made in the workshop'
   await page.click('[data-sf-save]');await page.wait_for_function("document.querySelector('[data-sf-status]').textContent.includes('Store saved')")
   await page.screenshot(path=str(OUT/'seller-editor.png'),full_page=True)
   await page.click('[data-sf-preview]');assert await page.locator('.sf-editor-sidebar').count()==0;assert await page.locator('.sf-section-tools').count()==0
   await page.screenshot(path=str(OUT/'storefront-preview.png'),full_page=True)
   await page.click('[data-sf-preview]');await page.fill('[data-ai-prompt]','Create a minimal story and products layout');await page.click('[data-ai-layout]');await page.wait_for_function("document.querySelector('[data-sf-status]').textContent.includes('editorial')")
   assert await page.locator('[data-section-id="story"] h2').inner_text()=='Small parts, big ideas'
   assert await page.locator('[data-dirty]').inner_text()=='Unsaved changes'
   # Draft is not persisted by generating.
   assert service.get_layout('test')[0]['id']=='gallery'
   await page.locator('summary').filter(has_text='Write product copy').click();await page.click('[data-ai-copy]');await page.locator('[data-description-draft]').wait_for();assert 'editable robot' in await page.input_value('[data-description-draft]')
   await page.fill('[data-sf-search]','nonexistent');assert await page.locator('.sf-product').count()==0
   await page.fill('[data-sf-search]','');await page.click('[data-sf-save]');await page.wait_for_function("document.querySelector('[data-sf-status]').textContent.includes('Store saved')")
   await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/'seller-mobile.png'),full_page=True)
   assert await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'), 'Mobile horizontal overflow'
   assert not errors,errors
   await page.set_viewport_size({'width':1480,'height':1000})
   await page.goto('http://127.0.0.1:8001/s/northline?edit=1',wait_until='networkidle')
   await page.locator('[data-sf-save]').wait_for()
   assert await page.locator('header.toolbar').count()==1
   assert await page.locator('body').evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgb(244, 246, 248)'
   assert await page.locator('.sf-section h2').first.evaluate('(e)=>getComputedStyle(e).textTransform')=='none'
   assert await page.locator('html').evaluate('(e)=>getComputedStyle(e).overflowY')=='auto'
   await page.screenshot(path=str(OUT/'full-storefront-editor.png'),full_page=True)
   assert not errors,errors
   await browser.close();print(json.dumps({'checks':'passed','page_errors':errors,'screenshots':str(OUT)}))
asyncio.run(main())
