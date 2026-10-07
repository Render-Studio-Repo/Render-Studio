import asyncio, io, json, re, sys, tempfile, zipfile
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from playwright.async_api import async_playwright
from backend.routers.project_code import create_project_code_router
from backend.services import project_code_files as files
OUT=ROOT/'backups/code-workspace-20260915/verification';OUT.mkdir(exist_ok=True)
WIRING={'name':'Arduino LED bench','components':[{'id':'uno','type':'arduino-uno','label':'Arduino Uno','x':60,'y':80},{'id':'led1','type':'led','label':'Status LED','x':290,'y':80},{'id':'r1','type':'resistor','label':'220 Ω','x':195,'y':80}], 'wires':[{'id':'w1','from':{'componentId':'uno','pinId':'d13'},'to':{'componentId':'r1','pinId':'a'},'color':'#efaa51'},{'id':'w2','from':{'componentId':'r1','pinId':'b'},'to':{'componentId':'led1','pinId':'anode'},'color':'#52c796'}]}
class AI:
 def _json_payload(self,s):return s
 def _call_model(self,*args,**kwargs):return json.dumps({'compatible':True,'summary':'Blink LED on pin 13 every 500 ms. Test provider.','repeat':True,'actions':[{'component_id':'led1','action':'led','value':1,'duration_ms':500},{'component_id':'led1','action':'led','value':0,'duration_ms':500}]}),{}
def sample_pdf():
 content=b'BT /F1 22 Tf 40 345 Td (Arduino LED wiring) Tj ET 0.15 0.35 0.55 RG 2 w 40 120 150 160 re S 330 165 80 40 re S 530 150 50 70 re S 190 185 m 330 185 l S 410 185 m 530 185 l S BT /F1 15 Tf 60 245 Td (Arduino Uno) Tj ET BT /F1 13 Tf 333 230 Td (220 ohm) Tj ET BT /F1 13 Tf 535 240 Td (LED) Tj ET'
 objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',b'<< /Length '+str(len(content)).encode()+b' >>\nstream\n'+content+b'\nendstream',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
 output=b'%PDF-1.4\n';offsets=[0]
 for i,obj in enumerate(objects,1):offsets.append(len(output));output+=str(i).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
 xref=len(output);output+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(f'{n:010d} 00000 n \n'.encode() for n in offsets[1:])+b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(xref).encode()+b'\n%%EOF\n'
 return output
async def main():
 with tempfile.TemporaryDirectory() as temp:
  project=Path(temp)/'p1';ref=project/'references/Project Code/Robot';ref.mkdir(parents=True)
  (ref/'src').mkdir();(ref/'assets').mkdir();(ref/'docs').mkdir()
  (ref/'src/main.ino').write_text('const int LED_PIN = 13;\n\nvoid setup() { pinMode(LED_PIN, OUTPUT); }\nvoid loop() {\n  digitalWrite(LED_PIN, HIGH);\n  delay(500);\n  digitalWrite(LED_PIN, LOW);\n  delay(500);\n}\n')
  (ref/'config.json').write_text(json.dumps({'board':'Arduino Uno','pins':{'status_led':13,'sensor':2},'timing':{'interval_ms':500},'enabled':True},indent=2))
  (ref/'data.csv').write_text('component,pin,note\nLED,13,"Status, green"\nButton,2,Input\n')
  (ref/'assets/logo.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#143448"/><text x="60" y="110" fill="#6dd9b5" font-size="38">ROBOT</text></svg>')
  (ref/'docs/readme.md').write_text('# Arduino LED bench\nConnect the LED through a 220 ohm resistor.\n')
  (ref/'docs/drawing.pdf').write_bytes(sample_pdf())
  (project/'wiring.json').write_text(json.dumps(WIRING))
  ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  with zipfile.ZipFile(ref/'parts.xlsx','w',zipfile.ZIP_DEFLATED) as z:
   z.writestr('xl/workbook.xml',f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Parts" r:id="r1"/><sheet name="Pins" r:id="r2"/></sheets></workbook>')
   z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>')
   for i in (1,2):z.writestr(f'xl/worksheets/sheet{i}.xml',f'<worksheet xmlns="{ns}"><sheetData><row><c r="A1" t="inlineStr"><is><t>{"Part" if i==1 else "Pin"}</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>LED</t></is></c><c r="B2"><v>13</v></c></row></sheetData></worksheet>')
  app=FastAPI()
  def read(user,pid):
   if pid!='p1':raise HTTPException(403,'No access')
   return project
  app.include_router(create_project_code_router(lambda:{'id':'test'},read,read,lambda p:None,lambda *a,**k:AI(),lambda u:{'projects':[{'id':'p1','name':'Arduino LED bench'}]}))
  @app.get('/api/projects/p1/wiring')
  def wiring():return WIRING
  client=TestClient(app)
  importmap=re.search(r'<script type="importmap">([\s\S]*?)</script>',(ROOT/'frontend/index.html').read_text()).group(1)
  html=f'''<!doctype html><html><head><script type="importmap">{importmap}</script><style>html,body{{margin:0;height:100%;background:#101922}}.main-column{{position:absolute;inset:0}}.hidden{{display:none!important}}#doc-tab-bar{{height:36px;background:#26384a;color:white;position:absolute;top:0;left:0;right:0;z-index:300;display:flex}}.dxf-tab{{background:#20394e;color:white;border:1px solid #425a6e;padding:5px 12px}}.dxf-tab.active{{background:#345e7b}}.dxf-tab-label{{margin-left:8px}}.dxf-tab-close{{margin-left:12px}}</style></head><body><div class="main-column"><div id="doc-tab-bar"></div><div id="viewport"></div></div><script type="module">
  import {{createDocumentTabBar}} from '/studio/document-tabs.js';
  import {{createProjectCodeEditor}} from '/code/project-code-editor.js?v=20260915-code-workspace1';
  const docTabs=createDocumentTabBar({{tabBarEl:document.querySelector('#doc-tab-bar'),mainColumnEl:document.querySelector('.main-column')}});
  const api=async(path,opts)=>{{const r=await fetch(path,opts);const d=await r.json();if(!r.ok)throw new Error(d.detail||r.statusText);return d;}};
  window.editor=createProjectCodeEditor({{host:document.querySelector('.main-column'),docTabs,api,rawFetch:fetch,getProjectId:()=> 'p1'}});
  docTabs.onActivate(t=>t?.kind==='code-project'?editor.activate():editor.hide());docTabs.onClose(t=>editor.close());
  await editor.open({{projectId:'p1',folder:'references/Project Code/Robot',filename:'references/Project Code/Robot/config.json'}});window.ready=true;
  </script></body></html>'''
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--enable-unsafe-swiftshader'])
   page=await browser.new_page(viewport={'width':1440,'height':980});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.route('**/__code_workspace_test',lambda r:r.fulfill(status=200,content_type='text/html',body=html))
   async def api_route(route):
    request=route.request;url=urlparse(request.url)
    res=client.request(request.method,url.path+('?' + url.query if url.query else ''),content=request.post_data_buffer,headers={'content-type':request.headers.get('content-type','application/json')})
    await route.fulfill(status=res.status_code,headers=dict(res.headers),body=res.content)
   await page.route('**/api/**',api_route)
   await page.goto('http://127.0.0.1:8001/__code_workspace_test',wait_until='domcontentloaded',timeout=30000)
   await page.wait_for_function('window.ready===true',timeout=30000)
   await page.get_by_role('button',name='Raw code',exact=True).click()
   await page.locator('[data-code-search]').fill('interval_ms')
   assert '1 / 1' in await page.locator('[data-match-count]').inner_text()
   await page.get_by_role('button',name='Tree',exact=True).click()
   assert await page.locator('.code-json-leaf').count()>0
   await page.locator('[data-code-search]').fill('')
   await page.screenshot(path=str(OUT/'json-tree.png'))
   await page.locator('.code-explorer summary',has_text='src').click()
   await page.locator('[data-code-file$="main.ino"]').click()
   code=page.locator('.code-input');await code.wait_for();await code.fill('const int LED_PIN = 13;\nvoid setup() {}\nvoid loop() { digitalWrite(LED_PIN, HIGH); delay(500); }\n')
   await page.get_by_role('button',name='Save',exact=True).click();await page.wait_for_function("document.querySelector('[data-status]').textContent.startsWith('Saved')")
   assert 'digitalWrite' in (ref/'src/main.ino').read_text()
   await page.locator('[data-code-file$="data.csv"]').click();await page.wait_for_function("document.querySelectorAll('.code-document td').length===9")
   await page.locator('[data-code-file$="parts.xlsx"]').click();await page.get_by_label('Worksheet').wait_for();await page.get_by_label('Worksheet').select_option('1');await page.wait_for_function("document.querySelector('.code-document td')?.textContent==='Pin'")
   await page.locator('.code-explorer summary',has_text='assets').click();await page.locator('[data-code-file$="logo.svg"]').click();await page.locator('.code-image').wait_for();await page.wait_for_function("document.querySelector('.code-image')?.naturalWidth>0")
   await page.locator('.code-explorer summary',has_text='docs').click();await page.locator('[data-code-file$="drawing.pdf"]').click();await page.locator('.code-pdf-pages canvas[data-rendered="true"]').wait_for(timeout=30000)
   await page.screenshot(path=str(OUT/'pdf-tab.png'))
   await page.locator('[data-code-file$="main.ino"]').click();assert 'Spreadsheet' not in await page.locator('[data-status]').inner_text();await page.screenshot(path=str(OUT/'code-editor.png'))
   await page.locator('[data-wiring-select]').select_option('p1');await page.wait_for_selector('[data-sim-canvas] canvas',timeout=20000)
   await page.locator('[data-run]').click();await page.wait_for_function("document.querySelector('[data-sim-instructions]').textContent.includes('Blink LED')")
   await page.screenshot(path=str(OUT/'wiring-simulation.png'));await page.locator('[data-stop]').click()
   await page.locator('[data-code-file$="main.ino"]').click();await page.locator('.code-input').fill('#include <Servo.h>\nServo arm;')
   await page.locator('[data-run]').click();await page.get_by_role('dialog').wait_for();assert 'Servo.h' in await page.get_by_role('dialog').inner_text()
   await page.screenshot(path=str(OUT/'hardware-mismatch.png'));await page.get_by_role('button',name='Back to editor').click()
   await page.get_by_role('tab',name='3D Viewport').click();assert not await page.locator('.project-code').is_visible()
   await page.get_by_role('tab',name=re.compile('Project Code')).click();assert await page.locator('.project-code').is_visible();assert 'Servo.h' in await page.locator('.code-input').input_value()
   await page.evaluate("editor.clear()")
   await page.evaluate("editor.open({projectId:'p1',folder:'references/Project Code/Robot',filename:'references/Project Code/Robot/config.json'})")
   await page.get_by_role('button',name='Raw code',exact=True).click();await page.locator('.code-input').fill('{\"draft\":true}')
   await page.evaluate("editor.clear()")
   await page.evaluate("editor.open({projectId:'p1',folder:'references/Project Code/Robot',filename:'references/Project Code/Robot/src/main.ino'})")
   assert 'Servo.h' in await page.locator('.code-input').input_value()
   await page.locator('[data-code-file$="config.json"]').click();await page.get_by_role('button',name='Raw code',exact=True).click();assert 'draft' in await page.locator('.code-input').input_value()
   studio=await browser.new_page(viewport={'width':1600,'height':1050})
   studio_errors=[];studio.on('pageerror',lambda e:studio_errors.append(str(e)))
   async def app_hook(route):
    response=await route.fetch();source=await response.text();await route.fulfill(response=response,body=source+'\nwindow.__openCodeEditorTest = openProjectCodeEditor;\n')
   await studio.route('**/studio/app.js?*',app_hook)
   await studio.route('**/api/projects/p1/code/**',api_route)
   await studio.goto('http://127.0.0.1:8001/',wait_until='domcontentloaded',timeout=45000)
   await studio.wait_for_function('typeof window.__openCodeEditorTest === "function"',timeout=45000)
   await studio.wait_for_selector('#viewport canvas')
   await studio.wait_for_timeout(6000)
   await studio.keyboard.press('Escape')
   await studio.evaluate("__openCodeEditorTest({projectId:'p1',folder:'references/Project Code/Robot',filename:'references/Project Code/Robot/config.json'})")
   await studio.get_by_role('button',name='Raw code',exact=True).click();await studio.locator('.code-input').wait_for()
   await studio.screenshot(path=str(OUT/'studio-code-editor.png'))
   assert await studio.locator('.project-code').is_visible()
   await studio.get_by_role('tab',name='3D Viewport').click();assert not await studio.locator('.project-code').is_visible()
   assert not [e for e in studio_errors if not e.startswith('Not authenticated')],studio_errors
   print(json.dumps({'browser_checks':'passed','screenshots':str(OUT),'page_errors':errors}),flush=True)
   assert not errors
   await browser.close()
asyncio.run(main())
