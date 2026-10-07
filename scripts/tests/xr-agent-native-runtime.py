#!/usr/bin/env python3
"""Real Three.js tests for the native agent bubble, review keyboard and room controls."""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/private/tmp/xr-agent-native-runtime')
async def main():
 OUT.mkdir(exist_ok=True)
 index=(ROOT/'frontend/index.html').read_text();imports=re.search(r'<script type="importmap">(.*?)</script>',index,re.S).group(1)
 html='<html><head><script type="importmap">'+imports+'</script></head><body style="margin:0;background:#111"></body></html>'
 errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1100,'height':850})
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.route('**/__agent-native',lambda route:route.fulfill(status=200,content_type='text/html',body=html))
  await page.goto('http://127.0.0.1:8001/__agent-native')
  result=await page.evaluate('''async () => {
   const THREE=await import('three');const {createXrAgentAvatar}=await import('/xr/xr-agent-avatar.js?v=native-test');const {createXrAgentPeers}=await import('/xr/xr-agent-peers.js?v=native-test');
   const checks=[];const check=(condition,label)=>{if(!condition)throw Error(label);checks.push(label);};
   const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(55,1100/850,.01,50);camera.position.set(0,1.6,0);camera.updateWorldMatrix(true,true);
   const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1100,850);renderer.setClearColor('#10202d');document.body.append(renderer.domElement);
   const rightGrip=new THREE.Group();rightGrip.position.set(.23,1.2,-.35);scene.add(rightGrip);rightGrip.updateWorldMatrix(true,true);
   const state={visible:true,settings:{name:'Astra',wakeName:'Astra',volume:.8,avatar:'orb'},changes:[{id:'c1',title:'Move controller mount 10 mm',status:'succeeded',prompt:'Move controller mount 10 mm'}],history:[{role:'user',text:'Move controller to leave cable clearance.'}]};const actions=[];
   const avatar=createXrAgentAvatar(THREE,{scene,camera,getState:()=>state,onAction:(id,payload)=>{actions.push({id,payload});if(id==='agent:setting')Object.assign(state.settings,payload);if(id==='agent:throw'||id==='agent:off')state.visible=false;}});
   const tick=()=>{avatar.update({presenting:true,rightGrip,headCamera:camera,level:.5});scene.updateMatrixWorld(true);renderer.render(scene,camera);};tick();
   const rayTo=(target,normal=new THREE.Vector3(0,0,1))=>new THREE.Raycaster(target.clone().addScaledVector(normal,.4),normal.clone().negate());
   const ai=avatar.buttons.find(b=>b.userData.xrTool==='agent:toggle');
   const mute=avatar.buttons.find(b=>b.userData.xrTool==='agent:mic');
   const facing=mesh=>new THREE.Vector3(0,0,1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
   const {createXrToolHand}=await import('/xr/xr-tool-hand.js?v=native-test');const toolHand=createXrToolHand({THREE});toolHand.attachTo(rightGrip,{dockHand:'left'});toolHand.setTool('draw');toolHand.setVisible(true);scene.updateMatrixWorld(true);
   const aiCenter=ai.getWorldPosition(new THREE.Vector3());let nearestWrist=Infinity;
   for(const button of toolHand.buttons){let visible=true;for(let parent=button;parent;parent=parent.parent)if(!parent.visible)visible=false;if(visible)nearestWrist=Math.min(nearestWrist,aiCenter.distanceTo(button.getWorldPosition(new THREE.Vector3())));}
   check(nearestWrist>.033,`Voice wrist icon clears drawing controls (${Math.round(nearestWrist*1000)} mm center distance)`);toolHand.dispose();
   const aiLocal=rightGrip.worldToLocal(ai.getWorldPosition(new THREE.Vector3()));
   check(aiLocal.x < -0.02, `AI button sits on the inner controller side (x=${aiLocal.x.toFixed(3)})`);
   check(aiLocal.y > 0.02, `AI button sits at analog-stick height (y=${aiLocal.y.toFixed(3)})`);
   check(!!mute,'Controller mic mute button exists beside AI');
   avatar.setMicLive(false);avatar.setMicLive(true);

   check(avatar.pick(rayTo(ai.getWorldPosition(new THREE.Vector3()), facing(ai)))?.tool==='agent-ui:agent:toggle','Right-controller AI button is a real controller-ray target');
   check(avatar.pick(rayTo(mute.getWorldPosition(new THREE.Vector3()), facing(mute)))?.tool==='agent-ui:agent:mic','Controller mic mute is a real controller-ray target');
   const orb=avatar.root.children[0].children[0];const bubbleHit=avatar.pick(rayTo(orb.getWorldPosition(new THREE.Vector3())));check(bubbleHit?.tool==='agent-ui:agent:toggle','Pointing at bubble targets its voice toggle and reveals native controls');tick();
   const gear=avatar.buttons.find(b=>b.userData.xrTool==='agent:settings');const gearHit=avatar.pick(rayTo(gear.getWorldPosition(new THREE.Vector3())));check(gearHit?.tool==='agent-ui:agent:settings','Gear is selectable by its visible native icon');avatar.action(gearHit.tool.slice(9));tick();
   state.live=true;state.listening=true;tick();
   const stop=avatar.buttons.find(b=>b.userData.xrTool==='agent:stop-listening');
   check(stop.visible&&avatar.pick(rayTo(stop.getWorldPosition(new THREE.Vector3()),facing(stop)))?.tool==='agent-ui:agent:stop-listening','Stop Listening is always visible and directly clickable while live');
   avatar.action('showToRoom');check(state.settings.showToRoom===true,'VR settings separately enable agent visibility to other people');
   const beforePulse=orb.scale.x;await new Promise(r=>setTimeout(r,90));tick();check(orb.scale.x!==beforePulse,'Listening visibly pulses without rebuilding textures');
   avatar.action('agent:stop-listening');check(actions.some(a=>a.id==='agent:stop-listening'),'Stop Listening dispatches voice shutdown');
   const panel=avatar.root.children.find(node=>node.name==='xrAgentPanel'),face=panel.children[0];
   const panelPick=(x,y)=>{tick();const point=new THREE.Vector3((x/900-.5)*.63,(.5-y/860)*.602,0).applyMatrix4(face.matrixWorld),normal=new THREE.Vector3(0,0,1).applyQuaternion(face.getWorldQuaternion(new THREE.Quaternion()));return avatar.pick(rayTo(point,normal));};
   let hit=panelPick(795,352);check(hit?.tool==='agent-ui:name','Native settings panel maps visible name row to exact action');avatar.action(hit.tool.slice(9));
   for(let i=0;i<5;i++)avatar.action('key:back');for(const c of 'nova')avatar.action('key:'+c);avatar.action('key:done');tick();check(state.settings.name==='nova','Headset keyboard saves agent name without desktop input');
   hit=panelPick(200,95);avatar.action(hit.tool.slice(9));for(const c of 'volume')avatar.action('key:'+c);avatar.action('key:done');tick();
   hit=panelPick(810,172);check(hit?.tool==='agent-ui:volume:+','Search filters native settings to matching actionable row');avatar.action(hit.tool.slice(9));check(Math.abs(state.settings.volume-.9)<1e-8,'Native volume control updates listener volume');
   avatar.openReview();tick();hit=panelPick(800,172);check(hit?.tool==='agent-ui:agent:reject:c1','Review opens independently of previous settings search');avatar.action(hit.tool.slice(9));tick();
   for(const c of 'move 10 mm')avatar.action(c===' '?'key:space':'key:'+c);avatar.action('key:done');tick();check(actions.some(a=>a.id==='agent:correction'&&a.payload.id==='c1'&&a.payload.text==='move 10 mm'),'Adjust opens native correction keyboard and emits change ID plus correction text');
   avatar.action('agent:reject:c1');avatar.action('key:done');check(actions.filter(a=>a.id==='agent:correction').length===1,'Empty correction is not submitted');avatar.action('key:cancel');
   const other=new THREE.Group(),hand=new THREE.Group();scene.add(other,hand);hand.position.copy(avatar.root.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0,0,.3));hand.updateWorldMatrix(true,true);
   check(!avatar.beginGrip(1,hand),'Gripping empty space cannot move or dismiss agent');hand.position.copy(avatar.root.getWorldPosition(new THREE.Vector3()));hand.updateWorldMatrix(true,true);check(avatar.beginGrip(1,hand),'One contacting hand can grab agent');check(!avatar.beginGrip(0,other)&&!avatar.endGrip(0),'Second hand cannot steal or release held agent');
   const oldNow=performance.now.bind(performance);let now=1000;Object.defineProperty(performance,'now',{configurable:true,value:()=>now});tick();now=1100;hand.position.x+=.2;hand.updateWorldMatrix(true,true);tick();avatar.endGrip(1);Object.defineProperty(performance,'now',{configurable:true,value:oldNow});tick();
   check(actions.some(a=>a.id==='agent:throw')&&!avatar.root.visible,'Fast one-hand release dismisses bubble and emits throw-sound action');check(avatar.wrist.visible,'Voice wrist icon remains available after bubble dismissal');
   const remoteState={remoteAgents:[{id:'peer1',name:'Remote agent',visible:true,live:true,shareWithRoom:true,pose:{position:[-.25,1.4,-.65],quaternion:[0,0,0,1]},volume:.7,allowOtherUsersTrigger:true},{id:'malformed',visible:true,live:true,shareWithRoom:true,pose:{position:'bad'}}]};
   const peers=createXrAgentPeers(THREE,{scene,getState:()=>remoteState});peers.update({presenting:true});scene.updateMatrixWorld(true);let remoteHit=peers.pick(rayTo(new THREE.Vector3(-.25,1.4,-.65)));check(remoteHit?.tool==='agent-remote:hover:peer1','Shared live peer agent has native hover target; malformed pose skipped');peers.update({presenting:true});
   const peerPanelPoint=(x,y)=>new THREE.Vector3(-.25+(x-.5)*.38,1.4-.14+(.5-y)*.114,-.65);
   check(peers.pick(rayTo(peerPanelPoint(.8,.45)))?.tool==='agent-remote:mute:peer1','Peer panel exposes per-listener mute');check(peers.pick(rayTo(peerPanelPoint(.55,.78)))?.tool==='agent-remote:invoke:peer1','Peer voice invocation exposed only when owner enables it');
   remoteState.remoteAgents[0].shareWithRoom=false;remoteState.remoteAgents[0].avatar='gem';peers.update({presenting:true});check(peers.pick(rayTo(new THREE.Vector3(-.25,1.4,-.65)))?.tool==='agent-remote:hover:peer1','Private-audio agent remains visible when owner permits room invocation');
   remoteState.remoteAgents[0].allowOtherUsersTrigger=false;peers.update({presenting:true});check(peers.pick(rayTo(peerPanelPoint(.55,.78)))?.tool!=='agent-remote:invoke:peer1','Owner disabling invocation removes peer talk action');
   remoteState.remoteAgents[0].shareWithRoom=false;peers.update({presenting:true});check(!peers.pick(rayTo(new THREE.Vector3(-.25,1.4,-.65))),'Stopping sharing removes remote bubble');
   state.visible=true;avatar.openReview();tick();window.__agentScreenshot=()=>{avatar.action('agent:settings');tick();};
   const resources={geometry:false,texture:false};ai.geometry.addEventListener('dispose',()=>resources.geometry=true);ai.material.map.addEventListener('dispose',()=>resources.texture=true);
   remoteState.remoteAgents=[{id:'visual',name:'Visible only',visible:true,live:true,showToRoom:true,shareWithRoom:false,allowOtherUsersTrigger:false,pose:{position:[-.25,1.4,-.65],quaternion:[0,0,0,1]}}];peers.update({presenting:true});scene.updateMatrixWorld(true);
   check(peers.pick(rayTo(new THREE.Vector3(-.25,1.4,-.65)))?.tool==='agent-remote:hover:visual','Visual-only shared Astra is rendered without audio or guest-mic permission');
   window.__agentDispose=()=>{avatar.dispose();peers.dispose();return resources;};
   return {checks,count:checks.length};
  }''')
  await page.screenshot(path=str(OUT/'review.png'))
  await page.evaluate('window.__agentScreenshot()');await page.screenshot(path=str(OUT/'settings.png'))
  disposed=await page.evaluate('window.__agentDispose()');assert disposed=={'geometry':True,'texture':True},disposed
  result['checks'].append('Disposal releases the separately parented wrist icon geometry and texture');result['count']+=1
  assert not errors,errors
  result.update(passed=True,pageErrors=errors);(OUT/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));await browser.close()
asyncio.run(main())
