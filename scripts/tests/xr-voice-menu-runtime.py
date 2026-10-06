"""Authenticated editor voice/menu smoke test using synthetic microphone, poses and voice provider.
All production WebSockets are intercepted; no robot control or paid provider calls.
Run from the repository root with .venv/bin/python scripts/tests/xr-voice-menu-runtime.py.
"""
import sys,json,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from backend.auth import get_user_by_email,create_access_token
from playwright.sync_api import sync_playwright
user=get_user_by_email('a1projects@protonmail.com');token=create_access_token(user['id']);safe={k:user.get(k) for k in ['id','email','display_name','handle']}
MOCK=r'''
window.voiceProbe={mics:0,sockets:[],recognizers:[]};
class Recognition { constructor(){voiceProbe.recognizers.push(this)} start(){} stop(){} abort(){} }
window.SpeechRecognition=Recognition;
navigator.mediaDevices.getUserMedia=async()=>{voiceProbe.mics++;const ctx=new AudioContext();const dst=ctx.createMediaStreamDestination();return dst.stream;};
const NativeSocket=WebSocket;
window.WebSocket=class extends EventTarget {
 static OPEN=1;
 constructor(url,protocols){super();if(!String(url).includes('/api/voice-mold/ws'))return protocols?new NativeSocket(url,protocols):new NativeSocket(url);this.readyState=1;this.sent=[];voiceProbe.sockets.push(this);queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
 send(raw){const m=JSON.parse(raw);this.sent.push(m);if(m.type==='session.update')queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'session.updated'})})));}
 close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
};
'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];sessions=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.route_web_socket('**',lambda ws:None)
 page.route('**://192.168.1.77:*/**',lambda r:r.abort())
 page.route('**/api/xr-agent/state',lambda r:r.fulfill(json={'revision':1,'settings':{'name':'Astra','wakeName':'Astra','voiceModel':'gpt-realtime','includeVisualContext':False},'history':[],'changes':[]}))
 page.route('**/api/voice-mold/models',lambda r:r.fulfill(json={'models':[{'id':'gpt-realtime','transport':'realtime','label':'Test voice'}],'has_openai_key':True}))
 def session(r):
  sessions.append(r.request.post_data_json);r.fulfill(json={'transport':'realtime','model':'gpt-realtime','label':'Test voice','proxy_ws_path':'/api/voice-mold/ws'})
 page.route('**/api/voice-mold/session',session)
 page.add_init_script('localStorage.setItem("render3d:token",'+json.dumps(token)+');localStorage.setItem("render3d:user",'+json.dumps(json.dumps(safe))+');'+MOCK)
 page.goto('https://render3d.app/?project=2ee4d857',wait_until='domcontentloaded',timeout=60000)
 page.wait_for_function('!!window.Render3DXrAgent && !!window.__activateStudioVoiceAgent',timeout=45000)
 page.evaluate('''()=>{const b=document.getElementById('btn-voice-order');document.body.appendChild(b);b.style.cssText='position:fixed;top:20px;left:20px;display:block;z-index:2147483647;width:120px;height:60px';}''')
 page.locator('#btn-voice-order').click(force=True)
 page.wait_for_function('window.Render3DXrAgent.getState().live',timeout=15000)
 report={'orderClickLive':True,'microphoneRequestsForClick':page.evaluate('voiceProbe.mics'),'sessionsAfterClick':len(sessions)}
 assert report['microphoneRequestsForClick']==1,report
 assert len(sessions)==1,report
 page.locator('#btn-voice-order').click(force=True)
 page.wait_for_function('!window.Render3DXrAgent.getState().live')
 for phrase in ['Hey agent','Hey Astra']:
  page.wait_for_function('voiceProbe.recognizers.some(r=>typeof r.onresult==="function")')
  page.evaluate('''phrase=>{const r=voiceProbe.recognizers.findLast(r=>typeof r.onresult==='function');r.onresult({resultIndex:0,results:[Object.assign([{transcript:phrase}],{isFinal:true})]});}''',phrase)
  page.wait_for_function('window.Render3DXrAgent.getState().live',timeout=15000)
  report[phrase]=True
  page.locator('#btn-voice-order').click(force=True)
  page.wait_for_function('!window.Render3DXrAgent.getState().live')

 report['delayedSettingsChecks']=page.evaluate("""async()=>{
  const {createXrAgentBridge}=await import('/components/xr-agent-bridge.js');
  let resolve,starts=0,primes=0,live=false,reads=0;
  const waiting=new Promise(r=>resolve=r);
  const bridge=createXrAgentBridge({getUserId:()=> 'isolated-test',getProjectId:()=> 'test',getPeers:()=>[],api:()=>{reads++;return waiting;}});
  bridge.bindVoice({stop(){live=false;},refreshSettings(){},setModel(){},primeMedia(){primes++;return Promise.resolve(true);},async start(){starts++;live=true;},getState:()=>({live})});
  const first=bridge.start(),second=bridge.start();
  if(first!==second||starts||primes!==1||reads!==1)throw Error('Concurrent activation did not wait for shared settings');
  resolve({revision:1,settings:{voiceModel:'gpt-realtime',includeVisualContext:false},history:[],changes:[]});
  await first;
  const result={oneSettingsRead:reads===1,oneMicrophonePrime:primes===1,oneSessionStart:starts===1,live:bridge.getState().live};
  bridge.dispose();if(Object.values(result).some(v=>!v))throw Error(JSON.stringify(result));return result;
 }""")
 report['menuPoseChecks']=page.evaluate(r"""async () => {
  const THREE=await import('three');
  const source=await (await fetch('/xr/viewport-xr.js')).text();
  const extract=name=>{const start=source.indexOf(`  function ${name}(`),end=source.indexOf('\n  function ',start+1);if(start<0)throw Error(name);return source.slice(start,end<0?undefined:end);};
  const factory=new Function('THREE', `
    const controller=new THREE.Group(),group=new THREE.Group(),parent=new THREE.Group();
    parent.add(group);group.position.set(.1,1.1,-.6);
    let panelDrag=null,gripGrab=null,grabState=null,scaleGrab=null;
    const squeezeHandIndex=()=>1,posedControllerForHand=()=>controller,getLeftGrip=()=>null,getRightGrip=()=>controller,getLeftHand=()=>null,getRightHand=()=>null,objectIsPosed=()=>true,pinchAnchors=[];
    const _poseInv=new THREE.Matrix4(),_poseWorld=new THREE.Matrix4(),_panelNow=new THREE.Vector3(),_q=new THREE.Quaternion(),_grabNext=new THREE.Matrix4(),_grabWorld=new THREE.Matrix4(),_grabInv=new THREE.Matrix4(),_grabOne=new THREE.Vector3(1,1,1),_s=new THREE.Vector3(),_headPos=new THREE.Vector3(1,1,1),_headQuat=new THREE.Quaternion();
    ${extract('beginPanelDrag')} ${extract('updatePanelDrag')} ${extract('facePanelTowardHead')}
    const origin=group.position.clone(),rotation=group.quaternion.clone();
    beginPanelDrag(controller,group,{input:'trigger'});
    controller.position.x=.002;controller.rotation.y=.015;updatePanelDrag();
    if(group.position.distanceTo(origin)>1e-9||group.quaternion.angleTo(rotation)>1e-9)throw Error('Trigger jitter moved panel');
    controller.rotation.y=.2;updatePanelDrag();
    if(group.quaternion.angleTo(rotation)<.1)throw Error('Top bar failed to rotate');
    const held=group.quaternion.clone();facePanelTowardHead(group,group.position);
    if(group.quaternion.angleTo(held)>1e-6)throw Error('Panel repaint changed orientation');
    return {smallTriggerJitterStable:true,topBarRotation:true,repaintPreservesRotation:true};
  `);
  return factory(THREE);
 }""")
 report['sessions']=len(sessions);report['pageErrors']=errors;report['providerRequests']=0
 assert len(sessions)==3 and not errors,report
 (ROOT/'docs/verification/voice-activation-20260916.json').write_text(json.dumps(report,indent=2))
 print(json.dumps(report,indent=2));browser.close()
