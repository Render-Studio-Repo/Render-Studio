"""Counts real GPU contexts used by multiple mini viewers and wiring thumbnails."""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/private/tmp/studio-webgl-crash-20260916/contexts');OUT.mkdir(parents=True,exist_ok=True)
imports=json.loads(re.search(r'<script type="importmap">\s*(.*?)\s*</script>',(ROOT/'frontend/index.html').read_text(),re.S).group(1))
async def main():
 results=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  page=await browser.new_page(viewport={'width':1240,'height':920});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  html='<html><head><script type="importmap">'+json.dumps(imports)+'</script></head><body style="background:#111a24;color:white;font:16px system-ui"><h1>Shared model previews</h1><main style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px"></main></body></html>'
  await page.route('**/__graphics-context-qa',lambda route:route.fulfill(content_type='text/html',body=html))
  await page.add_init_script('''(()=>{const original=HTMLCanvasElement.prototype.getContext;window.glAudit=[];HTMLCanvasElement.prototype.getContext=function(type,attrs){const result=original.call(this,type,attrs);if(result&&/^webgl/.test(type)&&!glAudit.includes(result))glAudit.push(result);return result;};})();''')
  await page.goto('http://127.0.0.1:8001/__graphics-context-qa')
  urls=[]
  for source in ['admin/admin-dashboard.js','components/context-lab.js','studio/app.js']:
   url=re.search(r'\.\./viewport/mini-viewer\.js\?[^"\']+',(ROOT/'frontend'/source).read_text()).group()
   urls.append('/viewport/'+url.split('/viewport/')[1])
  assert len(set(urls))==1,urls
  result=await page.evaluate('''async urls=>{
   const THREE=await import('three');const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
   const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x77b8fa})));
   const bytes=await new GLTFExporter().parseAsync(scene,{binary:true});const url=URL.createObjectURL(new Blob([bytes]));
   const modules=await Promise.all(urls.map(url=>import(url)));window.qaViews=[];
   for(let i=0;i<12;i++){const host=document.createElement('div');host.style.height='240px';document.querySelector('main').append(host);const view=modules[i%3].createMiniViewer(host);qaViews.push(view);await view.load(url);}
   URL.revokeObjectURL(url);await new Promise(r=>setTimeout(r,300));
   return {active:glAudit.filter(gl=>!gl.isContextLost()).length,models:qaViews.length,images:[...document.querySelectorAll('main canvas')].map(c=>c.toDataURL().length)};
  }''',urls)
  assert result['active']==1,result
  assert all(size>2000 for size in result['images']),result
  await page.screenshot(path=str(OUT/'twelve-previews.png'))
  await page.evaluate('qaViews.forEach(v=>v.dispose())')
  await page.wait_for_timeout(120)
  assert await page.evaluate('glAudit.filter(gl=>!gl.isContextLost()).length')==0
  results.append({'check':'12 loaded model previews from all 3 consumers share 1 GPU context; closing all releases it',**result})
  reopened=await page.evaluate('''async url=>{const {createMiniViewer}=await import(url);const host=document.querySelector('main').firstChild;const v=createMiniViewer(host);const count=glAudit.filter(gl=>!gl.isContextLost()).length;v.dispose();return count}''',urls[0])
  assert reopened==1
  await page.wait_for_timeout(120)
  assert await page.evaluate('glAudit.filter(gl=>!gl.isContextLost()).length')==0
  results.append({'check':'Reopening acquires 1 fresh context and closing releases it'})
  thumbnails=await page.evaluate('''async()=>{const THREE=await import('three');const top=await import('/wiring/wiring-top-view.js?contexts-qa=1');const mesh=new THREE.Mesh(new THREE.BoxGeometry(10,20,5),new THREE.MeshStandardMaterial({color:0x38b98e}));let disposed=0;mesh.geometry.addEventListener('dispose',()=>disposed++);mesh.material.addEventListener('dispose',()=>disposed++);const images=[];for(let i=0;i<12;i++)images.push(top.captureTopDownDataUrl(mesh,{size:128+i}));const during=glAudit.filter(gl=>!gl.isContextLost()).length;await new Promise(r=>setTimeout(r,1150));const after=glAudit.filter(gl=>!gl.isContextLost()).length;const again=top.captureTopDownDataUrl(mesh,{size:256});const reacquired=glAudit.filter(gl=>!gl.isContextLost()).length;top.clearTopDownCache();await new Promise(r=>setTimeout(r,50));return {during,after,reacquired,cleared:glAudit.filter(gl=>!gl.isContextLost()).length,valid:images.every(x=>x?.startsWith('data:image/png')&&x.length>1000)&&!!again,sharedGeometryDisposed:disposed};}''')
  assert thumbnails=={'during':1,'after':0,'reacquired':1,'cleared':0,'valid':True,'sharedGeometryDisposed':0},thumbnails
  results.append({'check':'Wiring thumbnails use 1 context per batch, release it after idle, reacquire on demand and keep source geometry',**thumbnails})
  assert not errors,errors
  await browser.close()
 (OUT/'report.json').write_text(json.dumps({'checks':results,'pageErrors':errors},indent=2));print(json.dumps(results,indent=2))
asyncio.run(main())
