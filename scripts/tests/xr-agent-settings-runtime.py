#!/usr/bin/env python3
"""Real bridge + native XR settings lifecycle with failed microphone startup."""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'backups/xr-ai-talk-20260916/settings'
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 imports=re.search(r'<script type="importmap">(.*?)</script>',(ROOT/'frontend/index.html').read_text(),re.S).group(1)
 html='<html><head><script type="importmap">'+imports+'</script></head><body style="margin:0"></body></html>'
 report={'passed':False};errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1100,'height':850});page.on('pageerror',lambda e:errors.append(str(e)))
  await page.route('**/__agent-settings-lifecycle',lambda route:route.fulfill(content_type='text/html',body=html))
  await page.route('**/api/**',lambda route:route.fulfill(content_type='application/json',body='{}'))
  try:
   await page.goto('http://127.0.0.1:8001/__agent-settings-lifecycle')
   report=await page.evaluate('''async()=>{
    const THREE=await import('three');
    const {createXrAgentAvatar}=await import('/xr/xr-agent-avatar.js?settings-lifecycle-test=1');
    const {createXrAgentBridge}=await import('/components/xr-agent-bridge.js?settings-lifecycle-test=1');
    const checks=[];window.__settingsChecks=checks;const check=(ok,text)=>{if(!ok)throw Error(text);checks.push(text);};
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(55,1100/850,.01,20);camera.position.set(0,1.6,0);scene.add(camera);
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1100,850);renderer.setClearColor('#10202d');document.body.append(renderer.domElement);
    const grip=new THREE.Group();grip.position.set(.3,1.1,-.25);scene.add(grip);
    let avatar,live=false,voiceStarts=0,mediaAttempts=0;
    const voice={getState:()=>({live,statusMessage:'Microphone permission was denied'}),setModel:()=>{},refreshSettings:()=>{},
      primeMedia:()=>{mediaAttempts++;return Promise.reject(new Error('Microphone permission was denied'));},
      start:async()=>{voiceStarts++;live=true;},stop:()=>{live=false;},getOutputStream:()=>null,setRemoteInputStream:()=>{}};
    const bridge=createXrAgentBridge({getUserId:()=>'settings-fixture',getProjectId:()=>'settings-project',getDesignContext:()=>({workspace:'cad'}),getPeers:()=>[],getToken:()=>'',isSignedIn:()=>true,isPresenting:()=>true,
      dismissAvatar:()=>avatar?.dismiss(),api:async(_path,options)=>options?.method==='PATCH'?{revision:2}:{version:1,revision:1,settings:{name:'Astra',wakeName:'Astra',volume:.8,avatar:'orb'},history:[],changes:[]}});
    bridge.bindVoice(voice);await wait(40);
    avatar=createXrAgentAvatar(THREE,{scene,camera,getState:bridge.getState,onAction:(id,payload)=>bridge.action(id,payload)});
    const update=(presenting=true)=>{avatar.update({presenting,rightGrip:grip,headCamera:camera});scene.updateMatrixWorld(true);};
    update();check(!bridge.getState().visible&&!avatar.root.visible,'inactive voice begins with the agent bubble hidden');
    const panel=avatar.root.getObjectByName('xrAgentPanel'),face=panel.children[0];
    const pointAt=(x,y)=>{
      update();const point=new THREE.Vector3((x/900-.5)*.63,(.5-y/860)*.602,0).applyMatrix4(face.matrixWorld);
      const normal=new THREE.Vector3(0,0,1).applyQuaternion(face.getWorldQuaternion(new THREE.Quaternion()));
      return avatar.pick(new THREE.Raycaster(point.clone().addScaledVector(normal,.3),normal.negate()));
    };
    avatar.action('agent:settings');update();
    check(panel.visible&&avatar.root.visible,'opening settings remains visible on the next XR frame while voice is inactive');
    check(!avatar.root.getObjectByName('xrAgentBubble').visible,'opening offline settings does not display an active voice bubble');
    check(pointAt(795,352)?.tool==='agent-ui:name','offline settings remain a real controller-ray target');
    avatar.action('name');avatar.action('key:x');
    let failure='';try{await bridge.start({greet:true});}catch(error){failure=error.message;}
    check(/permission/.test(failure)&&mediaAttempts===1&&voiceStarts===0,'real bridge rejects a failed microphone before starting a provider session');
    update();const textureVersion=face.material.map.version;for(let i=0;i<300;i++)update();
    check(!bridge.getState().visible&&panel.visible&&avatar.root.visible,'failed microphone and 300 XR frame updates cannot close settings');
    check(face.material.map.version===textureVersion,'unchanged open settings do not repaint their texture on idle frames');
    const saveHit=pointAt(565,516);check(saveHit?.tool==='agent-ui:key:done','the existing keyboard editor survives the failed voice startup');
    avatar.action(saveHit.tool.slice(9));update();
    check(bridge.getState().settings.name==='Astrax','saving after a microphone failure preserves the in-progress settings edit');
    update(false);check(!avatar.root.visible,'headset removal hides the open settings panel');
    update(true);check(panel.visible&&avatar.root.visible,'headset resume restores the same settings panel without voice');
    avatar.action('agent:close');update();check(!panel.visible&&!avatar.root.visible,'explicit Close hides offline settings');
    avatar.action('agent:history');update();check(panel.visible&&avatar.root.visible,'history also opens without requiring a live microphone');
    await bridge.stop();update();check(!panel.visible&&!avatar.root.visible,'explicit agent dismissal still closes its panels');
    avatar.action('agent:settings');update();check(panel.visible&&avatar.root.visible,'settings can be reopened after explicit dismissal');
    camera.position.set(-.04,1.45,.1);camera.lookAt(-.04,1.45,-.8);update();renderer.render(scene,camera);
    window.__settingsDispose=()=>{avatar.dispose();bridge.dispose();renderer.dispose();};
    return {passed:true,checks,count:checks.length,mediaAttempts,voiceStarts,providerRequests:0};
   }''')
   await page.screenshot(path=str(OUT/'settings.png'));assert not errors,errors
   await page.evaluate('window.__settingsDispose()')
  except Exception as error:
   report['error']=str(error);await page.screenshot(path=str(OUT/'failure.png'));raise
  finally:
   report['checks']=await page.evaluate('window.__settingsChecks||[]');report['pageErrors']=errors
   (OUT/'report.json').write_text(json.dumps(report,indent=2));await browser.close()
 print(json.dumps({'passed':report.get('passed'),'checks':len(report['checks']),'report':str(OUT/'report.json')},indent=2))
asyncio.run(main())
