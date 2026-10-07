import asyncio
import json
import re
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]


async def main():
    index = (ROOT / 'frontend/index.html').read_text()
    imports = re.search(r'<script type="importmap">(.*?)</script>', index, re.S).group(1)
    html = '<html><head><script type="importmap">' + imports + '</script></head><body></body></html>'
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.route('**/__placement-test', lambda r: r.fulfill(status=200, content_type='text/html', body=html))
        await page.goto('http://127.0.0.1:8001/__placement-test')
        result = await page.evaluate('''async () => {
          const THREE = await import('three');
          const {applyGenerationPlacement,generationSurfaceFromHit,usesWorkshopGenerationPlacement} = await import('/studio/generation-placement-three.js');
          const {createXrWorkshopStage} = await import('/xr/xr-white-room.js');
          const assert = (v,m) => {if(!v)throw Error(m)};
          const near = (a,b) => Math.abs(a-b)<1e-6;
          const parent = new THREE.Group();parent.position.set(4,.3,-2);parent.rotation.y=.7;parent.scale.set(2,1.5,.8);
          const model = new THREE.Mesh(new THREE.BoxGeometry(200,350,100),new THREE.MeshBasicMaterial());
          model.rotation.set(.2,.5,.1);model.position.set(9,2,6);parent.add(model);
          const sibling = new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());parent.add(sibling);
          const siblingBefore=sibling.position.clone();const rotation=model.quaternion.clone();
          const options={sceneBounds:{width:12,height:5,depth:12}};
          assert(applyGenerationPlacement(THREE,model,options),'placement failed');
          const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
          assert(near(center.x,0)&&near(center.z,-1.8)&&near(box.min.y,.835),'parent transform produced wrong world placement');
          assert(near(Math.max(size.x,size.y,size.z),.6),'wrong preview size');
          assert(model.quaternion.equals(rotation),'model orientation changed');
          assert(sibling.position.equals(siblingBefore),'sibling moved');
          const before=model.position.clone();assert(applyGenerationPlacement(THREE,model,options),'repeat failed');
          assert(model.position.distanceTo(before)<1e-6,'repeated placement drift');
          assert(usesWorkshopGenerationPlacement({presenting:false,workspaceJoin:true,sceneKind:'workshop'}),'desktop Workshop bypassed');
          assert(!usesWorkshopGenerationPlacement({presenting:false,workspaceJoin:false,sceneKind:'workshop'}),'desktop CAD captured');
          const stage=createXrWorkshopStage();stage.visible=true;stage.rotation.z=.3;stage.updateMatrixWorld(true);
          const plate=stage.getObjectByName('Middle desk generation plate');
          assert(plate?.userData.generationSurface,'pickable plate missing');
          const normal=new THREE.Vector3(0,1,0).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(plate.matrixWorld));
          const point=plate.localToWorld(new THREE.Vector3(0,.002,0));
          const ray=new THREE.Raycaster(point.clone().addScaledVector(normal,1),normal.clone().negate());const hits=[];
          THREE.Mesh.prototype.raycast.call(plate,ray,hits);
          const surface=generationSurfaceFromHit(THREE,hits[0]);
          assert(surface&&new THREE.Vector3(...surface.normal).distanceTo(normal)<1e-6,'surface normal not world transformed');
          assert(new THREE.Vector3(...surface.position).distanceTo(point)<1e-6,'face world point incorrect');
          return {parentTransform:true,uprightPreserved:true,siblingsUnchanged:true,repeatStable:true,desktopWorkshop:true,plateRaycast:true,worldFaceNormal:surface.normal};
        }''')
        print(json.dumps(result))
        await browser.close()


asyncio.run(main())
