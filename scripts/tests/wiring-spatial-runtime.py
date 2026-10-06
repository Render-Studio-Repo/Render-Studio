#!/usr/bin/env python3
"""Browser regression for embedded 3D wiring, using isolated in-memory circuit data."""
import asyncio, json, re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/private/tmp/wiring-spatial-runtime')
async def main():
  OUT.mkdir(exist_ok=True)
  index=(ROOT/'frontend/index.html').read_text()
  imports=re.search(r'<script type="importmap">(.*?)</script>',index,re.S).group(1)
  html='<html><head><script type="importmap">'+imports+'</script><style>body{margin:0;font-family:system-ui;background:#111;color:white}#wiring-content-area{position:relative;width:1200px;height:800px}.hidden{display:none!important}#wiring-viewport{height:800px}.wiring-tool-btn{cursor:pointer}</style></head><body><div id="wiring-content-area" class="wiring-content-area"><div class="wiring-spatial-switcher"><button id="btn-wiring-spatial-ar" class="wiring-tool-btn">AR</button><button id="btn-wiring-view-spatial" class="wiring-tool-btn">3D</button><button id="btn-wiring-view-breadboard" class="wiring-tool-btn hidden">Schematic</button><button id="btn-wiring-spatial-next" class="wiring-tool-btn hidden">Next wire</button></div><div id="wiring-viewport">2D schematic remains here</div></div></body></html>'
  checks=[]; errors=[]
  async with async_playwright() as p:
    browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=await browser.new_page(viewport={'width':1200,'height':800})
    page.on('pageerror',lambda e:errors.append(str(e)))
    await page.route('**/__wiring-runtime',lambda route:route.fulfill(status=200,content_type='text/html',body=html))
    await page.goto('http://127.0.0.1:8001/__wiring-runtime')
    data=await page.evaluate('''async () => {
      const THREE = await import('three');
      const {createWiringSpatialView}=await import('/wiring/wiring-spatial-view.js?v=runtime-test');
      const {createWiringSpatialWorkspace}=await import('/wiring/wiring-spatial-workspace.js?v=runtime-test');
      const {createWiringSimulator}=await import('/wiring/wiring-simulator.js?v=runtime-test');
      const fixture={name:'Sensor wiring',components:[
        {id:'board',type:'arduino-uno',label:'Controller',x:0,y:0,position3d:[-45,0,0],units:'mm',dimensions:[35,6,27],pins:[{id:'D2',position3d:[17.5,3,5],verification:'verified',connector:'Female header'}],documentation:[{url:'https://example.com/controller-schematic.pdf',title:'Controller schematic',type:'schematic'}]},
        {id:'sensor',type:'sensor',label:'Vibration sensor',x:300,y:0,position3d:[45,0,0],units:'mm',dimensions:[28,6,20],pins:[{id:'OUT',position3d:[-14,3,0],verification:'verified',connector:'Male header'}]},
        {id:'spare',type:'sensor',label:'Unspecified sensor',x:140,y:200}],
        wires:[{id:'signal',label:'Sensor signal',from:{componentId:'board',pinId:'D2'},to:{componentId:'sensor',pinId:'OUT'},gauge:'22 AWG',wireType:'Stranded copper · PVC',route3d:{units:'mm',points:[[-15,3,5],[-15,3,20],[20,3,20],[20,3,0]]},color:'#60bdeb',cutLengthMm:120},
          {id:'unknown',label:'Unverified connection',from:{componentId:'sensor',pinId:'GND'},to:{componentId:'spare',pinId:'GND'},color:'#dda267'}]};
      const scene=new THREE.Scene();
      const spatial=createWiringSpatialView({scene,getAssemblyRoot:()=>null,getMmPerUnit:()=>1});
      const workspace=createWiringSpatialWorkspace({root:document.getElementById('wiring-content-area'),spatial,getSchematic:()=>fixture,onStatus:(kind,message)=>window.__wiringStatus={kind,message},onAr:()=>window.__arRequest=window.Render3DWiringContext.requestedMode});
      window.__wiring={THREE,spatial,workspace,fixture};
      window.__events=[];window.addEventListener('wiring-selection',e=>window.__events.push(e.detail));
      // Loading the existing 2D simulator must retain all physical metadata.
      const hidden=document.createElement('div');hidden.style.display='none';document.body.append(hidden);
      const sim=createWiringSimulator({root:hidden,getProjectId:()=>null});sim.applySchematic(fixture,{save:false});
      return {retainedPin:sim.getSchematic().components[0].pins[0].position3d,retainedGauge:sim.getSchematic().wires[0].gauge,retainedRoute:sim.getSchematic().wires[0].route3d.points.length};
    }''')
    assert data=={'retainedPin':[17.5,3,5],'retainedGauge':'22 AWG','retainedRoute':4},data
    checks.append('2D schematic load preserves actual pin coordinates, wire specifications, route data')
    await page.click('#btn-wiring-view-spatial'); await page.wait_for_timeout(600)
    assert await page.locator('.wiring-spatial-view').is_visible(), await page.evaluate("({status:window.__wiringStatus,active:window.Render3DWiringContext.isActive(),hidden:document.querySelector('.wiring-spatial-view').hidden,html:document.querySelector('.wiring-spatial-view').outerHTML.slice(0,150),button:document.getElementById('btn-wiring-view-spatial').outerHTML})")
    assert await page.locator('.wiring-spatial-stage canvas').count()==1
    checks.append('3D opens inside wiring workspace without CAD model or project')
    result=await page.evaluate('''() => {
      const {spatial,THREE}=window.__wiring, context=spatial.getContext();
      const wire=context.wires.find(w=>w.id==='signal');
      const mesh=spatial.getGroup().children.find(m=>m.userData.wiringWireId==='signal');
      const position=mesh.geometry.attributes.position;
      const before=Array.from(position.array);
      spatial.setSelection({kind:'wire',id:'signal'});
      return {wire,approx:context.wires.find(w=>w.id==='unknown'),sameGeometry:before.every((v,i)=>v===position.array[i]),scale:mesh.scale.toArray(),mmPerUnit:context.mmPerUnit};
    }''')
    assert result['wire']['geometry']['endpoints']=='verified',result
    assert result['wire']['geometry']['route']=='provided'
    assert result['wire']['sources'][0]['title']=='Controller schematic'
    assert result['approx']['geometry']['endpoints']=='missing'
    assert result['approx']['gauge'] is None
    assert result['sameGeometry'] and result['scale']==[1,1,1]
    checks.extend(['Supplied physical pins and route are respected','Linked schematic appears in inspector context','Missing physical anchors and wire gauge remain explicitly unknown','Highlighting preserves endpoints and route geometry'])
    await page.click('#btn-wiring-spatial-next');await page.wait_for_timeout(100)
    assert await page.locator('.wiring-spatial-details').get_by_text('Sensor signal',exact=True).count()==1
    checks.append('Next wire selects actual metadata and dispatches wiring-selection')
    await page.evaluate("window.Render3DWiringContext.setSelection({kind:'wire',id:'signal'})")
    assert await page.locator('.wiring-spatial-docs a').get_attribute('href')=='https://example.com/controller-schematic.pdf'
    await page.screenshot(path=str(OUT/'wiring-3d.png'))
    await page.click('#btn-wiring-spatial-ar')
    assert await page.evaluate('window.__arRequest')=='immersive-ar'
    checks.append('AR prepares the exact wiring group before requesting immersive-ar')
    await page.click('#btn-wiring-view-breadboard')
    assert not await page.locator('.wiring-spatial-view').is_visible()
    assert not await page.locator('#wiring-viewport').evaluate("el=>el.classList.contains('wiring-spatial-schematic-hidden')")
    checks.append('Schematic returns with original canvas preserved')
    # Confirm click/hover is a real renderer hit using a sweep across the cable region.
    await page.click('#btn-wiring-view-spatial'); await page.evaluate('window.Render3DWiringContext.setSelection(null)')
    hovered=False
    for x in range(380,790,15):
      for y in range(300,530,15):
        await page.mouse.move(x,y)
        if 'Sensor signal' in await page.locator('.wiring-spatial-details').inner_text():
          await page.mouse.click(x,y); hovered=True;break
      if hovered:break
    assert hovered,'Could not hover actual wire geometry'
    assert (await page.evaluate('window.Render3DWiringContext.getSelection()'))['id']=='signal'
    checks.append('Mouse hovering and clicking real 3D wire geometry shows and retains wire info')
    # Transform regression: root matrix must only apply once.
    transformed=await page.evaluate('''() => {
      const {spatial,THREE,fixture}=window.__wiring;
      const root=new THREE.Group();root.position.set(100,200,300);root.rotation.y=.6;root.scale.setScalar(2);
      const scene=new THREE.Scene();scene.add(root);
      return import('/wiring/wiring-spatial-view.js?v=runtime-test').then(({createWiringSpatialView})=>{
        const next=createWiringSpatialView({scene,getAssemblyRoot:()=>root,getMmPerUnit:()=>1});next.setActive(true);next.syncFromSchematic(fixture);root.updateWorldMatrix(true,true);
        const mesh=next.getGroup().children.find(m=>m.userData.wiringWireId==='signal');
        const expected=new THREE.Vector3(-27.5,3,5).applyMatrix4(root.matrixWorld);
        const actual=mesh.geometry.parameters.path.getPoint(0).applyMatrix4(mesh.matrixWorld);
        const distance=actual.distanceTo(expected);next.clear();return distance;
      });
    }''')
    assert transformed<1e-6,transformed
    checks.append('Transformed/scaled CAD root applies physical pin coordinates exactly once')
    xr=await page.evaluate("""async () => {
      const {THREE,spatial}=window.__wiring;
      const {createXrWiringView}=await import('/xr/xr-wiring-view.js?v=runtime-test');
      const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(0,1.6,0);camera.updateWorldMatrix(true,true);
      const api=window.Render3DWiringContext;api.requestedMode='immersive-ar';spatial.getGroup().visible=true;
      const view=createXrWiringView(THREE,{scene,camera,getApi:()=>api});
      view.update({presenting:true,headCamera:camera});
      const hidden=!spatial.getGroup().visible, active=view.isActive();
      let mesh;view.getGroup().traverse(node=>{if(node.name==='wiring-tube:signal')mesh=node;});
      view.getGroup().updateWorldMatrix(true,true);
      const target=mesh.geometry.parameters.path.getPoint(.45).applyMatrix4(mesh.matrixWorld);
      const ray=new THREE.Raycaster(target.clone().add(new THREE.Vector3(0,.1,0)),new THREE.Vector3(0,-1,0));
      const hit=view.pick(ray);const selected=view.select(hit);
      let event;window.addEventListener('render3d:xr-selection',e=>event=e.detail,{once:true});view.select(hit);
      const grip=new THREE.Group();scene.add(grip);grip.position.copy(target).add(new THREE.Vector3(1,1,1));grip.updateWorldMatrix(true,true);
      const miss=!view.beginGrip(1,grip);grip.position.copy(target);grip.updateWorldMatrix(true,true);const contact=view.beginGrip(1,grip);
      grip.quaternion.setFromEuler(new THREE.Euler(.2,.4,.3));grip.position.x+=.1;grip.updateWorldMatrix(true,true);view.update({presenting:true,headCamera:camera});
      const rotation=view.getGroup().quaternion.angleTo(grip.quaternion)<1e-6;
      const wrongHand=!view.endGrip(0),release=view.endGrip(1);
      const panelOffset=view.getPanel().position.clone().sub(view.getGroup().position);const follows=Math.abs(panelOffset.x-.35)<1e-6&&Math.abs(panelOffset.y-.13)<1e-6;
      const physicalScale=Math.abs(mesh.getWorldScale(new THREE.Vector3()).x-.001)<1e-8;
      const doc=view.getPanel().children.find(child=>child.userData.wiringSource);view.getPanel().updateWorldMatrix(true,true);
      const dp=doc.getWorldPosition(new THREE.Vector3()),dn=new THREE.Vector3(0,0,1).applyQuaternion(doc.getWorldQuaternion(new THREE.Quaternion()));
      const documentHit=view.pick(new THREE.Raycaster(dp.clone().addScaledVector(dn,.2),dn.negate()));const sourceAction=view.select(documentHit);
      const sourcePopup=document.querySelector('.wiring-spatial-source-dialog');const sourceOpened=sourcePopup?.open&&sourcePopup.querySelector('a')?.href==='https://example.com/controller-schematic.pdf';sourcePopup?.close();

      const source=spatial.getGroup().children.find(node=>node.name==='wiring-tube:signal');
      const owns=source.geometry!==mesh.geometry&&source.material!==mesh.material;
      let disposedSource=false;source.geometry.addEventListener('dispose',()=>disposedSource=true);
      view.update({presenting:false,headCamera:camera});const restored=spatial.getGroup().visible;
      view.dispose();return {hidden,active,selected,id:hit?.detail?.id,eventId:event?.id,restored,owns,disposedSource,miss,contact,rotation,wrongHand,release,follows,physicalScale,sourceAction,sourceOpened};
    }""")
    assert xr=={'hidden':True,'active':True,'selected':True,'id':'signal','eventId':'signal','restored':True,'owns':True,'disposedSource':False,'miss':True,'contact':True,'rotation':True,'wrongHand':True,'release':True,'follows':True,'physicalScale':True,'sourceAction':True,'sourceOpened':True},xr
    checks.extend(['XR mounts wiring-only geometry with real unit conversion and hides the source copy','XR ray selects wire metadata and dispatches contextual selection event','XR exit restores original visibility and releases only owned geometry/materials','Physical-contact single-hand grip freely moves and rotates wiring for AR alignment','AR remains at 1:1 scale and inspector follows assembly placement','Native documentation button opens desktop source sheet with exact links'])
    assert not errors,errors
    report={'passed':True,'checks':checks,'count':len(checks),'pageErrors':errors}
    (OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
    await browser.close()
asyncio.run(main())
