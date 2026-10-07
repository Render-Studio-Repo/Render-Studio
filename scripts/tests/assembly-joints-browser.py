"""No auth/provider calls: real Three and browser UI with a native-solver response fixture."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True)
  page=await b.new_page(viewport={'width':1440,'height':1000});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.route('**/joint-ui-fixture',lambda r:r.fulfill(content_type='text/html',body='''<html><head><link rel="stylesheet" href="/studio/styles.css"><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js"}}</script></head><body style="background:#10151e;color:white"><div id="browser" style="width:280px"></div><div style="padding:30px;margin-left:300px">Assembly joint controls</div></body></html>'''))
  row={'id':'hinge','type':'revolute','parent':'Base','child':'Lid','anchor':[0,0,5],'axis':[1,0,0],'limits':[0,90]}
  payload={'joints':[row],'types':['fixed','revolute','slider','cylindrical','ball','distance','parallel','perpendicular','angle','rack_pinion','screw','gears','belt'],'native':{'ok':True}}
  async def api(route):
   if route.request.method=='POST':
    native=json.loads(Path('/private/tmp/native-joint-result.json').read_text());await route.fulfill(json=native)
   else: await route.fulfill(json=payload)
  await page.route('**/api/projects/test/assembly-joints**',api)
  await page.goto('http://127.0.0.1:8001/joint-ui-fixture')
  await page.evaluate('''async()=>{
   const THREE=await import('three');const {createAssemblyMotion,createAssemblyPose}=await import('/viewport/assembly-motion.js?test=1');
   window.root=new THREE.Group();root.position.set(20,30,40);root.scale.setScalar(.001);
   for(const name of ['Base','Lid']){const mesh=new THREE.Mesh(new THREE.BoxGeometry(10,20,5),new THREE.MeshBasicMaterial());mesh.name=name;root.add(mesh);}
   root.updateMatrixWorld(true);
   window.motion=createAssemblyMotion({getProjectId:()=> 'test',getFilename:()=> 'arm.step',getRoot:()=>root,headers:()=>({})});
   const {createProjectTree}=await import('/components/project-tree.js?test=1');
   window.tree=createProjectTree({container:document.querySelector('#browser'),getProjectId:()=> 'test',onOpenJoint:()=>motion.open()});
   tree.render({joints:[{name:'Joints/arm.joints.json',display_name:'Arm joints',kind:'joints',model_filename:'arm.step'}]});
  }''')
  await page.locator('[data-section="joints"] .browser-section-toggle').click()
  await page.locator('[data-section="joints"] .browser-item').click()
  await page.get_by_label('hinge angle').fill('45')
  await page.get_by_role('button',name='Preview motion').click()
  await page.get_by_role('status').filter(has_text='constraints solved').wait_for()
  matrix=await page.evaluate('root.children[1].matrix.elements')
  assert abs(matrix[5]-.70710678118)<1e-6,matrix
  await page.get_by_text('Edit joint definitions').click()
  await page.screenshot(path='/private/tmp/assembly-joints-ui.png')
  await page.get_by_role('button',name='Reset pose').click()
  assert await page.evaluate('root.children[1].matrix.elements[5]')==1
  await page.get_by_role('button',name='Validate and save joints').click()
  await page.get_by_role('status').filter(has_text='Native FreeCAD').wait_for()
  await page.get_by_title('Close and reset preview').click()
  assert not await page.locator('.assembly-motion-panel').count()
  assert not errors,errors
  print(json.dumps({'passed':True,'folderOpen':True,'nativeMatrixApplied':True,'resetRestored':True,'editSaved':True,'pageErrors':errors}))
  await b.close()
asyncio.run(main())
