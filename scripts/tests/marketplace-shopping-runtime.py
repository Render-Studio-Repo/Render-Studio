#!/usr/bin/env python3
"""Marketplace browser regression on real pages/modules, isolated APIs and temp DB.

Run with .venv/bin/python scripts/tests/marketplace-shopping-runtime.py.
All /api requests are intercepted: product presentation/assets use the real router
and a temporary SQLite database, while catalog and destination imports are fixtures.
Never sends a real message, purchase, install, or project upload.
"""
from __future__ import annotations
import asyncio
import base64
from contextlib import ExitStack
import json
from pathlib import Path
import struct
import sys
import tempfile
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from fastapi import FastAPI
from fastapi.testclient import TestClient
from playwright.async_api import async_playwright
from backend.auth import get_current_user,get_current_user_optional
from backend.database import init_db
from backend.routers.marketplace_product_page import create_marketplace_product_page_router
from backend.services.marketplace_product_page_service import public_listing

BASE='http://127.0.0.1:8001'
OUT=ROOT/'backups/marketplace-20260915/verification'

def glb_fixture():
    data=struct.pack('<9f',-1,-1,0,1,-1,0,0,1,0)
    gltf={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'Bracket_part','mesh':0}],'meshes':[{'primitives':[{'attributes':{'POSITION':0},'material':0}]}],'materials':[{'doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[.03,.5,.55,1],'metallicFactor':.2,'roughnessFactor':.6}}],'buffers':[{'byteLength':len(data)}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(data)}],'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3','min':[-1,-1,0],'max':[1,1,0]}]}
    doc=json.dumps(gltf).encode();doc+=b' '*((-len(doc))%4)
    return struct.pack('<III',0x46546c67,2,28+len(doc)+len(data))+struct.pack('<II',len(doc),0x4e4f534a)+doc+struct.pack('<II',len(data),0x004e4942)+data

GLB=glb_fixture()
USER={'id':'fixture-seller','display_name':'Fixture Creator','handle':'fixture-creator'}
OWNER={'id':USER['id'],'name':USER['display_name'],'handle':USER['handle']}
FILES=[{'name':'bracket.glb','data_url':'data:application/octet-stream;base64,'+base64.b64encode(GLB).decode(),'size':len(GLB)}, {'name':'README.md','data_url':'data:text/plain;base64,'+base64.b64encode(b'# Bracket\nTest instructions.\n').decode(),'size':29}]
CATALOG=[
 {'id':'robot','slug':'robot-bracket','name':'Precision Robot Bracket','kind':'model','category':'robots','price_cents':0,'access_mode':'free','thumbnail_url':'/assets/icons/cad/box.png','gallery':[{'url':'/assets/icons/cad/cylinder.png'}],'files':FILES},
 {'id':'housing','slug':'sensor-housing','name':'Sensor Housing Kit','kind':'model','category':'electronics','price_cents':1900,'access_mode':'paid','thumbnail_url':'/assets/icons/cad/hole.png'},
 {'id':'knowledge','slug':'wiring-guide','name':'Electronics Wiring Guide','kind':'knowledge','category':'knowledge','price_cents':900,'access_mode':'paid','thumbnail_url':'/assets/icons/cad/extrude.png'},
 {'id':'skill','slug':'circuit-skill','name':'Circuit Planning Skill','kind':'agent','category':'agents','price_cents':0,'access_mode':'free','thumbnail_url':'/assets/icons/cad/torus.png'},
 {'id':'hub','slug':'modular-architecture','name':'Modular Architecture Set','kind':'model','category':'architecture','price_cents':2900,'access_mode':'paid','thumbnail_url':'/assets/icons/cad/cone.png','from_hub':True},
]
for item in CATALOG:
 item.update(created_by=USER['id'],owner=OWNER,owner_handle=USER['handle'],download_enabled=True,currency='USD',license='CC-BY-4.0',description='A useful product with connected files and clear instructions.',tagline='Designed for your next project.',status='approved')
CFG={'enabled':True,'guest_browse_enabled':True,'show_models':True,'show_knowledge':True,'show_agents':True,'show_prices':True,'show_featured_rail':True,'featured_limit':3}

def item_for(kind,ident,**_):
 return next((i for i in CATALOG if i['kind']==kind and ident in (i['id'],i['slug'])),None)

async def check_layout(page,label):
 result=await page.evaluate('''() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,appOverflow:getComputedStyle(document.querySelector('#app')).overflow,mainOverflow:getComputedStyle(document.querySelector('.info-main')).overflow,profileRight:document.querySelector('.mkt-topbar-profile').getBoundingClientRect().right})''')
 assert result['scroll']<=result['width'],(label,result)
 assert result['appOverflow']=='visible' and result['mainOverflow']=='visible',(label,result)
 assert result['profileRight']>=result['width']-32,(label,result)
 return result

async def run(client):
 OUT.mkdir(parents=True,exist_ok=True)
 api_calls=[];uploads=[];upload_paths=[];errors=[];unexpected=[];gates={}
 def hold(method,path):
  gate={name:asyncio.Event() for name in ('started','release','finished')};gates[(method,path)]=gate;return gate
 async def started(gate):await asyncio.wait_for(gate['started'].wait(),10)
 async def finish(gate):
  gate['release'].set();await asyncio.wait_for(gate['finished'].wait(),10)
 async def settle_js(page):
  await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
  page=await browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
  page.on('pageerror',lambda err:errors.append(str(err)))
  await page.add_init_script("localStorage.setItem('render3d:token','fixture-token');localStorage.setItem('render3d:user',"+json.dumps(json.dumps(USER))+")")
  async def handle_api(route):
   request=route.request;parsed=urlparse(request.url);path=parsed.path;qs=parse_qs(parsed.query);method=request.method
   api_calls.append((method,path))
   async def answer(data,status=200):await route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
   if path.startswith('/api/marketplace/product/'):
    parts=path.split('/');kind,ident=parts[4:6];item=item_for(kind,ident)
    if len(parts)==6:
     await answer({'listing':public_listing(item),'owned':True} if item else {'detail':'Not found'},200 if item else 404)
    elif path.endswith('/presentation/suggest') and method=='POST':
     await answer({'layout':[{'id':'stale-ai','type':'about','title':'Stale AI layout','body':'This must be ignored after Cancel.','visible':True}]})
    else:
     result=client.request(method,path+('?' + parsed.query if parsed.query else ''),content=request.post_data_buffer,headers={'content-type':request.headers.get('content-type','application/json')})
     await route.fulfill(status=result.status_code,headers=dict(result.headers),body=result.content)
   elif path=='/api/marketplace/catalog':
    data=CATALOG[:]
    for field in ('kind','category','access'):
     value=qs.get(field,[''])[0];key='access_mode' if field=='access' else field
     if value and value!='all':data=[i for i in data if i.get(key)==value]
    q=qs.get('q',[''])[0].lower()
    if q:data=[i for i in data if all(t in (i['name']+' '+i['description']).lower() for t in q.split())]
    if qs.get('sort')==['price']:data.sort(key=lambda i:i['price_cents'])
    await answer({'listings':[public_listing(i) for i in data],'featured':[],'config':CFG})
   elif path=='/api/marketplace/config':await answer({'config':CFG})
   elif path=='/api/marketplace/cart':await answer({'items':[]})
   elif path=='/api/projects' and method=='GET':await answer({'projects':[{'id':'fixture-destination','name':'Build Bench','folder_name':'Test workspace'},{'id':'fixture-other','name':'Other bench','folder_name':'Test workspace'},{'id':'read-only','name':'No write access','read_only_project':True}]})
   elif path=='/api/projects/fixture-destination/upload' and method=='POST':
    uploads.append(request.post_data_buffer or b'');upload_paths.append(path);await answer({'ok':True})
   else:
    unexpected.append((method,path));await answer({'detail':'This test does not authorize this endpoint'},403)
  async def api(route):
   gate=gates.pop((route.request.method,urlparse(route.request.url).path),None)
   if gate:gate['started'].set();await gate['release'].wait()
   try:await handle_api(route)
   finally:
    if gate:gate['finished'].set()
  await page.route('**/api/**',api)
  await page.goto(BASE+'/marketplace.html',wait_until='domcontentloaded')
  await page.locator('.shop-card').first.wait_for()
  assert await page.locator('.shop-card').count()==5
  await page.locator('.shop-card-image img').first.wait_for()
  await page.wait_for_function("[...document.querySelectorAll('.shop-card-image img')].every(i=>i.complete&&i.naturalWidth>0)")
  desktop=await check_layout(page,'desktop')
  await page.screenshot(path=str(OUT/'shopping-runtime-browse-desktop.png'),full_page=True)
  # Explore is an in-page scroll, not an SPA route or network reload.
  await page.wait_for_load_state('networkidle')
  explore_hash=await page.evaluate('location.hash');explore_calls=len(api_calls)
  await page.evaluate("window.__catalogBeforeExplore=document.querySelector('#shop-catalog')")
  await page.locator('[data-explore-catalog]').click()
  await page.wait_for_function("document.querySelector('#shop-catalog').getBoundingClientRect().top<120")
  assert await page.evaluate('location.hash')==explore_hash
  assert await page.evaluate("window.__catalogBeforeExplore===document.querySelector('#shop-catalog')")
  assert len(api_calls)==explore_calls
  # A resolves during B's presentation fetch: only B may reach shared UI state.
  delayed_a=hold('GET','/api/marketplace/product/model/robot-bracket')
  delayed_b=hold('GET','/api/marketplace/product/model/sensor-housing/presentation')
  await page.evaluate("location.hash='#/p/model/robot-bracket'");await started(delayed_a)
  await page.evaluate("location.hash='#/p/model/sensor-housing'");await started(delayed_b)
  await finish(delayed_a);await settle_js(page);await finish(delayed_b)
  await page.locator('.shop-product-info h1').wait_for()
  assert await page.locator('.shop-product-info h1').text_content()=='Sensor Housing Kit'
  assert await page.locator('[data-view-3d]').count()==0
  await page.get_by_role('link',name='← Back to marketplace',exact=True).click()
  await page.wait_for_function("document.querySelectorAll('.shop-card').length===5")
  await page.wait_for_load_state('networkidle')
  await page.locator('[data-filters] select[name=kind]').select_option('model')
  await page.wait_for_function("document.querySelectorAll('.shop-card').length===3")
  await page.locator('[data-filters] select[name=access]').select_option('free')
  await page.wait_for_function("document.querySelectorAll('.shop-card').length===1")
  assert await page.locator('.shop-product-name').text_content()=='Precision Robot Bracket'
  await page.locator('[data-clear-filters]').first.click();await page.wait_for_function("document.querySelectorAll('.shop-card').length===5")
  await page.locator('[data-cat=electronics]').click();await page.wait_for_function("document.querySelectorAll('.shop-card').length===1")
  assert await page.locator('.shop-product-name').text_content()=='Sensor Housing Kit'
  await page.locator('[data-clear-filters]').first.click();await page.wait_for_function("document.querySelectorAll('.shop-card').length===5")
  await page.locator('[data-filters] select[name=source]').select_option('hub');await page.wait_for_function("document.querySelectorAll('.shop-card').length===1")
  assert await page.locator('.shop-product-name').text_content()=='Modular Architecture Set'
  await page.locator('[data-clear-filters]').first.click();await page.wait_for_function("document.querySelectorAll('.shop-card').length===5")
  await page.locator('[data-filters] select[name=sort]').select_option('price')
  await page.wait_for_load_state('networkidle')
  ordered=await page.locator('.shop-product-name').all_text_contents()
  assert ordered[-1]=='Modular Architecture Set' and ordered[2]=='Electronics Wiring Guide',ordered
  await page.locator('#mkt2-q').fill('robot');await page.locator('#mkt2-q').press('Enter');await page.wait_for_function("document.querySelectorAll('.shop-card').length===1")
  await page.locator('.shop-product-name').click();await page.locator('[data-edit-product]').wait_for()
  await page.get_by_label('View image 2',exact=True).click();assert (await page.locator('[data-gallery-main]>img').get_attribute('src')).endswith('/cylinder.png')
  await page.locator('[data-view-3d]').click();await page.wait_for_function("document.querySelector('[data-gallery-main]').dataset.modelReady==='true'")
  await page.get_by_role('button',name='Part labels',exact=True).click();await page.get_by_text('Bracket part',exact=True).wait_for()
  await page.screenshot(path=str(OUT/'shopping-runtime-product-3d.png'),full_page=True)
  await page.get_by_label('View image 1',exact=True).click();assert await page.locator('[data-gallery-main]>canvas').count()==0
  await page.locator('[data-edit-product]').click()
  await page.locator('[data-description]').fill('Edited product description verified through the temporary product-page API.')
  await page.locator('[data-add-section]').select_option('about')
  await page.locator('[data-heading]').last.fill('Verified setup guide')
  await page.locator('[data-body]').last.fill('Connect the included bracket before checking alignment.')
  await page.locator('[data-section]').last.drag_to(page.locator('[data-section]').first,source_position={'x':12,'y':12},target_position={'x':12,'y':12})
  assert await page.locator('[data-heading]').first.input_value()=='Verified setup guide'
  await page.locator('[data-page-save]').click();await page.get_by_text('Product page saved.',exact=True).wait_for()
  await page.reload();await page.locator('[data-edit-product]').wait_for()
  assert await page.locator('.shop-product-description').text_content()=='Edited product description verified through the temporary product-page API.'
  await page.get_by_role('heading',name='Verified setup guide',exact=True).wait_for()
  saved=client.get('/api/marketplace/product/model/robot/presentation').json()['page']
  assert saved['layout'][0]['title']=='Verified setup guide'
  # Cancel/reopen invalidates an AI response that is still in flight.
  await page.locator('[data-edit-product]').click()
  ai_gate=hold('POST','/api/marketplace/product/model/robot/presentation/suggest')
  await page.locator('[data-layout-prompt] input[name=prompt]').fill('Create a new technical product layout')
  await page.locator('[data-layout-prompt] button[type=submit]').click();await started(ai_gate)
  await page.locator('[data-page-cancel]').click()
  assert not await page.locator('[data-product-editor]').is_visible()
  await page.locator('[data-edit-product]').click();await finish(ai_gate);await settle_js(page)
  assert await page.locator('[data-heading]').first.input_value()=='Verified setup guide'
  assert 'Stale AI layout' not in await page.locator('[data-product-sections]').inner_text()
  # A Save already being committed cannot be undone by Cancel/toggling edit.
  save_gate=hold('PUT','/api/marketplace/product/model/robot/presentation')
  await page.locator('[data-description]').fill('Saved safely while Cancel was attempted.')
  await page.locator('[data-page-save]').click();await started(save_gate)
  await page.locator('[data-page-cancel]').click();await page.locator('[data-edit-product]').click()
  assert await page.locator('[data-product-editor]').is_visible()
  assert await page.locator('[data-description]').input_value()=='Saved safely while Cancel was attempted.'
  await finish(save_gate);await page.wait_for_function("document.querySelector('[data-product-editor]').hidden")
  assert await page.locator('.shop-product-description').text_content()=='Saved safely while Cancel was attempted.'
  assert client.get('/api/marketplace/product/model/robot/presentation').json()['page']['description']=='Saved safely while Cancel was attempted.'
  await page.locator('[data-delivery]').click();await page.locator('[data-project] option[value=fixture-destination]').wait_for(state='attached')
  assert await page.locator('[data-project] option[value=read-only]').count()==0
  async with page.expect_download() as pending:
   await page.locator('[data-file-download="1"]').click()
  download=await pending.value
  assert download.suggested_filename=='README.md'
  downloaded=await download.path();assert Path(downloaded).read_bytes()==b'# Bracket\nTest instructions.\n'
  centered=await page.locator('.shop-delivery-dialog').bounding_box()
  assert abs(centered['x']+centered['width']/2-720)<=2 and abs(centered['y']+centered['height']/2-500)<=2,centered
  upload_gate=hold('POST','/api/projects/fixture-destination/upload')
  await page.locator('[data-project]').select_option('fixture-destination');await page.locator('[data-import]').click()
  await started(upload_gate)
  assert await page.locator('[data-project]').is_disabled()
  assert await page.locator('[data-import]').is_disabled()
  assert await page.locator('[data-project]').input_value()=='fixture-destination'
  await finish(upload_gate)
  await page.get_by_text('Added to your project.',exact=False).wait_for()
  assert len(uploads)==2 and any(GLB in body for body in uploads) and any(b'Test instructions.' in body for body in uploads)
  assert upload_paths==['/api/projects/fixture-destination/upload']*2
  assert not await page.locator('[data-project]').is_disabled()
  await page.screenshot(path=str(OUT/'shopping-runtime-delivery.png'))
  await page.locator('.shop-dialog-close').click()
  await page.set_viewport_size({'width':390,'height':844});mobile=await check_layout(page,'mobile-product')
  await page.screenshot(path=str(OUT/'shopping-runtime-product-mobile.png'),full_page=True)
  await page.get_by_role('link',name='← Back to marketplace',exact=True).click();await page.locator('.shop-card').first.wait_for()
  await page.locator('[data-clear-filters]').first.click();await page.wait_for_function("document.querySelectorAll('.shop-card').length===5")
  await check_layout(page,'mobile-browse')
  await page.wait_for_load_state('networkidle')
  await page.locator('.shop-seller-banner').scroll_into_view_if_needed();await page.locator('.shop-seller-banner').get_by_role('heading').wait_for(state='visible')
  await page.screenshot(path=str(OUT/'shopping-runtime-browse-mobile.png'),full_page=True)
  assert not errors,errors
  assert not unexpected,unexpected
  assert not any('/checkout' in path or '/install' in path or '/messages' in path for _,path in api_calls)
  print(json.dumps({'checks':'passed','catalog_filter_search':'passed','explore_no_route':'passed','product_navigation_race':'passed','cancel_ai_and_save_guard':'passed','centered_delivery':'passed','destination_import_lock':'passed','owner_save_reload':'real router/temp database','downloads':'exact bytes verified','project_import':'2 intercepted uploads verified','page_errors':errors,'desktop':desktop,'mobile':mobile,'screenshots':str(OUT)}))
  await browser.close()

def main():
 with tempfile.TemporaryDirectory(prefix='render-marketplace-browser-') as tmp,ExitStack() as stack:
  stack.enter_context(patch('backend.database.DB_PATH',Path(tmp)/'test.db'));init_db()
  stack.enter_context(patch('backend.routers.marketplace_product_page.catalog.get_product',side_effect=item_for))
  app=FastAPI();app.include_router(create_marketplace_product_page_router(lambda *args:None))
  app.dependency_overrides[get_current_user]=lambda:USER
  app.dependency_overrides[get_current_user_optional]=lambda:USER
  with TestClient(app) as client:asyncio.run(run(client))

if __name__=='__main__':main()
