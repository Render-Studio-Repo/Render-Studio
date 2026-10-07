import asyncio
import json
import re
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('/private/tmp/render-draw-recordings')

async def main():
    OUT.mkdir(exist_ok=True)
    index = (ROOT / 'frontend/index.html').read_text()
    imports = re.search(r'<script type="importmap">(.*?)</script>', index, re.S).group(1)
    html = '<html><head><script type="importmap">'+imports+'</script></head><body style="margin:0;background:#101820"><div id="viewport"></div></body></html>'
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        page = await browser.new_page(viewport={'width':1440,'height':960})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.route('**/__draw-test', lambda r: r.fulfill(status=200,content_type='text/html',body=html))
        await page.goto('http://127.0.0.1:8001/__draw-test')
        result = await page.evaluate('''async () => {
          const THREE = await import('three');
          const {createXrAiDrawWorkspace} = await import('/xr/xr-ai-draw-workspace.js');
          const {compactXrAgentContext} = await import('/components/xr-agent-context.js');
          const {boundedVoiceContext} = await import('/components/voice-agent-protocol.js');
          const scene = new THREE.Scene(); scene.background = new THREE.Color('#101820');
          const camera = new THREE.PerspectiveCamera(75,1440/960,.01,100); camera.position.set(0,1.6,0);camera.updateMatrixWorld(true);
          const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setSize(1440,960); document.body.append(renderer.domElement);
          let saved, generated=0, talked=0; const statuses=[];
          const board = createXrAiDrawWorkspace({THREE,scene,camera,getProjectId:()=> 'canvas-test',
            getPromptDraft:()=> '', onStatus:text=>statuses.push(text),
            onGenerate:snapshot=>{if(!snapshot.prompt.trim())throw Error('Empty sketch prompt');generated++;return {ok:true}}, onTalk:()=>{talked++;return {ok:true}},
            api:async(path,options)=>{if(options?.method==='PUT'){saved=JSON.parse(options.body);return {storage_revision:'r1'}}
              throw Object.assign(new Error('404 canvas board not found'),{status:404});}});
          await board.open(); await board.action('canvas');
          const pose=board.board.getState().canvas.pose;
          if(!pose || !board.view.canvasPlane.isEnabled())throw Error('Canvas was not enabled');
          await board.action('tool','pen');
          const controller=new THREE.Object3D();controller.position.set(.15,1.6,0);controller.updateMatrixWorld(true);
          board.sample(1,controller,true);await new Promise(r=>setTimeout(r,40));
          controller.position.x=.45;controller.updateMatrixWorld(true);board.sample(1,controller,true);board.sample(1,controller,false);
          const stroke=Object.values(board.board.getState().drawings)[0];
          if(!stroke||stroke.points.length!==2||Math.abs(stroke.points[0][2]+1.998)>.01)throw Error('Laser did not draw on the canvas plane');
          board.board.dispatch({type:'note.add',note:{id:'design-text',text:'Mount here. Keep the outer edge rounded.',position:[.7,1.75,-1.99],expanded:true}});
          board.board.dispatch({type:'link.add',link:{fromId:stroke.id,toId:'design-text',caption:'Mounting edge'}});
          board.board.dispatch({type:'drawing.add',drawing:{id:'disconnected',points:[[-.4,1.4,-1.998],[-.1,1.7,-1.998]]}});
          await board.action('talk');await board.action('save');
          if(generated!==0||talked!==1)throw Error('Talk generated a model without confirmation');
          if(!saved?.state?.spatial_board?.canvas?.enabled)throw Error('Save omitted canvas state');
          const context=boundedVoiceContext(compactXrAgentContext({projectId:'canvas-test',spatialBoard:board.getVoiceContext(),canvas:{elements:[{id:'desktop-text',text:'Blue finish'}]},drawings3d:{objects:[{vertices:[[1,2,3]]}]}}));
          if(!context.spatialBoard.evidence.drawings.some(r=>r.id==='disconnected'))throw Error('Voice lost disconnected drawings');
          if(context.spatialBoard.evidence.drawings[0].points[0].length!==3)throw Error('Voice lost nested coordinates');
          if(context.drawings3d.objects[0].vertices[0][2]!==3)throw Error('Voice lost scene vertices');
          await board.action('generate');if(generated!==1)throw Error('Confirmed generation did not submit');
          board.view.update();renderer.render(scene,camera);
          window.testBoard=board;window.testRenderer=renderer;window.testScene=scene;window.testCamera=camera;
          return {laserPoints:stroke.points,saved:true,wholeSceneVoice:true,confirmedGeneration:generated};
        }''')
        await page.screenshot(path=str(OUT/'canvas.png'))
        await page.evaluate('''async()=>{const m=await import('/studio/robotics-data-explorer.js');m.openRoboticsDataExplorer({
          listEntries:async()=>[{path:'openarm-mujoco/episodes/episode-example.json'}],
          readFile:async()=>JSON.stringify({episode_id:'example',data_source:'mujoco',capture_kind:'simulation_snapshots',training_ready:false,missing_fields:['applied actions','synchronized camera frames']},null,2)});}''')
        await page.get_by_role('button',name='episode-example.json',exact=True).click()
        await page.get_by_text('Recording preview loaded.', exact=False).wait_for()
        await page.screenshot(path=str(OUT/'recordings.png'))
        await page.get_by_role('button',name='Close',exact=True).click()
        await page.evaluate("async()=>{(await import('/studio/robotics-learning-guide.js')).openRobotLearningGuide();}")
        await page.get_by_role('heading',name='Record, inspect and train a robot').wait_for()
        await page.screenshot(path=str(OUT/'learning.png'))
        assert not errors, errors
        result['browserErrors']=errors
        (OUT/'report.json').write_text(json.dumps(result,indent=2))
        print(json.dumps(result))
        await browser.close()

asyncio.run(main())
