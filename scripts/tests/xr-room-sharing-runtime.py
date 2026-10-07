"""Two-browser public avatar regression with real room relay, isolated from live users.

Run: .venv/bin/python scripts/tests/xr-public-presence-runtime.py
Uses synthetic headset poses; physical WebXR input still needs a headset check.
"""
import argparse
import base64
import json
import re
import socket
import struct
import sys
import threading
import time
from pathlib import Path
from unittest.mock import patch

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.ws.manager import CollabHub

parser = argparse.ArgumentParser()
parser.add_argument('--output', default='/tmp/xr-room-sharing-runtime.json')
args = parser.parse_args()
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
imports = re.search(r'<script type="importmap">(.*?)</script>',
                    (ROOT / 'frontend/index.html').read_text(), re.S).group(1)
html = '<html><script type="importmap">' + imports + '</script><body style="margin:0"></body></html>'
hub = CollabHub()
app = FastAPI()


@app.get('/__presence-test')
async def test_page():
    return HTMLResponse(html)


@app.get('/api/xr/public-room')
async def room():
    users = [hub._public_user_payload(c) for c in hub._xr_public.values()]
    return {'users': users, 'count': len(users), 'friend_ids': []}


@app.get('/api/projects/test-project')
async def test_project():
    return {'latest_file': 'cube.gltf'}


@app.get('/api/share/test-model')
async def test_share():
    return {'viewer_url': '/__shared-cube.gltf', 'viewer_filename': 'cube.gltf'}


@app.get('/__shared-cube.gltf')
async def shared_cube():
    # A recognizable test solid with a deliberately far-away CAD origin.
    positions = [99,99,99,101,99,99,101,101,99,99,101,99,99,99,101,101,99,101,101,101,101,99,101,101]
    indices = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,1,2,6,1,6,5,0,4,7,0,7,3]
    data = struct.pack('<24f', *positions) + struct.pack('<36H', *indices)
    return {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes':[0]}], 'nodes':[{'mesh':0}],
            'buffers':[{'uri':'data:application/octet-stream;base64,'+base64.b64encode(data).decode(), 'byteLength':len(data)}],
            'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':96},{'buffer':0,'byteOffset':96,'byteLength':72}],
            'accessors':[{'bufferView':0,'componentType':5126,'count':8,'type':'VEC3','min':[99,99,99],'max':[101,101,101]},
                         {'bufferView':1,'componentType':5123,'count':36,'type':'SCALAR'}],
            'meshes':[{'primitives':[{'attributes':{'POSITION':0},'indices':1,'material':0}]}],
            'materials':[{'pbrMetallicRoughness':{'baseColorFactor':[.7,.75,.8,1]},'doubleSided':True}]}


@app.websocket('/api/ws/xr/public')
async def public_ws(websocket: WebSocket, token: str):
    if token not in ('test-alice', 'test-bob'):
        await websocket.close(code=4401)
        return
    client = await hub.connect_xr_public(websocket, {'id': token, 'display_name': token[5:].title()})
    try:
        while True:
            await hub.handle_xr_public_message(token, await websocket.receive_text())
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect_xr_public(token, client.websocket)


app.mount('/', StaticFiles(directory=ROOT / 'frontend'), name='frontend')

SETUP = r'''async id=>{
  window.pcs=[];const NativeRTC=RTCPeerConnection;window.RTCPeerConnection=class extends NativeRTC {constructor(o){super(o);pcs.push(this);}};
  const THREE=await import('three');
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const {createXrPresence}=await import('/xr/xr-presence.js');
  const {createXrPublicLobby}=await import('/xr/xr-public-lobby.js');
  const {createRoomCamera,CAMERA_CHANNEL}=await import('/xr/xr-room-camera.js');
  const {createRoomCameraView}=await import('/xr/xr-room-camera-view.js');
  const {createXrPublicDrops}=await import('/xr/xr-public-drops.js');
  const {createRoomInventory,INVENTORY_CHANNEL}=await import('/xr/xr-room-inventory.js');
  const scene=new THREE.Scene();scene.background=new THREE.Color('#15202b');scene.add(new THREE.AmbientLight(0xffffff,3));
  scene.add(new THREE.GridHelper(8,40));
  const camera=new THREE.PerspectiveCamera(50,900/700,.01,50);camera.position.set(0,1.6,1);camera.lookAt(0,1.4,-1);
  const renderer=new THREE.WebGLRenderer();renderer.setSize(900,700);document.body.appendChild(renderer.domElement);
  const drops=createXrPublicDrops({THREE,scene,loader:new GLTFLoader(),getUserId:()=>id});drops.setVisible(true);
  const presence=createXrPresence({THREE,scene});presence.setViewer(camera.position);
  let videoRequests=0,frame=0,captureTrack=null;const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
  const context=canvas.getContext('2d');
  const view=createRoomCameraView({THREE,scene,getUserId:()=>id,onPose:(owner,pose)=>media.setPose(owner,pose),onStop:()=>media.stop()});
  const lobby=createXrPublicLobby({api:async path=>(await fetch(path)).json(),getToken:()=>id,getCurrentUser:()=>({id}),
    onRtcSignal:msg=>{if(msg.signal.channel===CAMERA_CHANNEL)void media.receive(msg.user_id,msg.signal).catch(e=>window.runtimeErrors.push(e.message));
      if(msg.signal.channel===INVENTORY_CHANNEL)inventory.receive(msg.user_id,msg.signal);},
    onPublicObject:msg=>{if(msg.type==='xr.drop')drops.upsert(msg);if(msg.type==='xr.object')drops.applyObject(msg);if(msg.type==='xr.objects.sync')drops.syncList(msg.objects,{merge:true});},
    onXrPose:msg=>{presence.upsert({id:msg.user_id});presence.applyPose(msg.user_id,msg.pose);}});
  const media=createRoomCamera({getPeers:()=>lobby.getOccupants(),getUserId:()=>id,isJoined:()=>lobby.isJoined(),
    sendSignal:(peer,signal)=>lobby.send({type:'rtc.signal',target_user_id:peer,signal}),getIceServers:()=>[],
    onStream:view.setStream,onPose:view.setPose,onStatus:(kind,message)=>{fixture.status={kind,message};},
    getPose:()=>({p:[0,1.4,-.4],q:[0,0,0,1],s:[1,1,1]}),
    mediaDevices:{getUserMedia:async constraints=>{videoRequests++;if(constraints.audio!==false)throw Error('unexpected microphone capture');const stream=canvas.captureStream(0);captureTrack=stream.getVideoTracks()[0];return stream;}}});
  const inventory=createRoomInventory({drops,getPeers:()=>lobby.getOccupants(),getUserId:()=>id,isJoined:()=>lobby.isJoined(),
    send:(peer,signal)=>lobby.send({type:'rtc.signal',target_user_id:peer,signal}),sendPose:msg=>lobby.send(msg)});
  window.runtimeErrors=[];
  window.fixture={THREE,id,lobby,media,view,drops,inventory,presence,renderer,scene,camera,requests:()=>videoRequests};
  window.timer=setInterval(()=>{
    frame++;context.fillStyle=frame%20<10?'#38bdf8':'#14b8a6';context.fillRect(0,0,320,240);context.fillStyle='white';context.font='28px sans-serif';context.fillText('CAMERA '+frame,24,100);captureTrack?.requestFrame();
    media.tick(performance.now());view.tick(performance.now());inventory.tick(performance.now());presence.syncUsers(lobby.getOccupants());presence.tick(performance.now());renderer.render(scene,camera);
  },50);
  lobby.sendPose({head:{p:[.5,1.6,-1],q:[0,1,0,0]},left:{p:[.25,1.2,-.8],q:[0,0,0,1]},right:{p:[.7,1.2,-.8],q:[0,0,0,1]},xr_device:'Quest 3'});
  const result=await lobby.join();if(!result.ok)throw Error(result.error);
}'''
sock=socket.socket();sock.bind(('127.0.0.1',0));base='http://127.0.0.1:'+str(sock.getsockname()[1])
server=uvicorn.Server(uvicorn.Config(app,log_level='error'))
thread=threading.Thread(target=lambda:server.run(sockets=[sock]),daemon=True)
with patch('backend.services.xr_public_room_service.touch'),patch('backend.services.xr_public_room_service.leave'):
    thread.start()
    try:
        deadline=time.monotonic()+10
        while not server.started:
            if time.monotonic()>deadline: raise RuntimeError('Test server failed')
            time.sleep(.02)
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,args=['--disable-features=WebRtcHideLocalIpsWithMdns','--allow-loopback-in-peer-connection','--disable-background-timer-throttling','--disable-renderer-backgrounding'])
            pages=[];errors=[];report={}
            for uid in ('test-alice','test-bob'):
                page=browser.new_page(viewport={'width':900,'height':700})
                page.context.grant_permissions(['local-network-access'],origin=base)
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base+'/__presence-test');page.evaluate(SETUP,uid);pages.append(page)
            alice,bob=pages
            for page in pages:
                page.wait_for_function('fixture.presence.avatars.size===1 && [...fixture.presence.avatars.values()][0].left.userData.questController==="left" && [...fixture.presence.avatars.values()][0].right.userData.questController==="right"')
                assert page.evaluate('fixture.requests()')==0
            report['questControllerAssetsBothHands']=True
            alice.evaluate('fixture.media.start()')
            try:
                bob.wait_for_function('fixture.view.windows.get("test-alice")?.video.getVideoPlaybackQuality().totalVideoFrames>5')
            except Exception:
                for page in pages: print(page.evaluate('({errors:runtimeErrors,status:fixture.status,peers:fixture.lobby.getOccupants(),windows:[...fixture.view.windows.keys()],pcs:pcs.map(p=>({state:p.connectionState,ice:p.iceConnectionState,gathering:p.iceGatheringState,local:p.localDescription?.sdp,remote:p.remoteDescription?.sdp}))})'),flush=True)
                raise
            report['videoFramesReceived']=bob.evaluate('fixture.view.windows.get("test-alice").video.getVideoPlaybackQuality().totalVideoFrames')
            assert report['videoFramesReceived']>0
            report['decodedCameraPixels']=bob.evaluate('''()=>{
                const v=fixture.view.windows.get('test-alice').video,c=document.createElement('canvas');c.width=320;c.height=240;
                const ctx=c.getContext('2d');ctx.drawImage(v,0,0,320,240);return [...ctx.getImageData(4,4,1,1).data];
            }''')
            assert sum(report['decodedCameraPixels'][:3])>100,report
            report['explicitVideoOnlyCapture']=True
            # Guest resize goes to owner and returns to all viewers.
            bob.evaluate('fixture.media.setPose("test-alice",{p:[.2,1.3,-.6],q:[0,0,0,1],s:[1.5,1.5,1.5]})')
            alice.wait_for_function('fixture.view.windows.get("test-alice").root.scale.x===1.5')
            bob.wait_for_function('fixture.view.windows.get("test-alice").root.position.x===.2')
            # Actual window grip, source movement, release; same position on publisher.
            assert bob.evaluate('''()=>{
                const {THREE,scene,view}=fixture;const grip=new THREE.Group();grip.position.set(.2,1.3,.1);scene.add(grip);grip.updateMatrixWorld(true);fixture.grip=grip;
                return view.beginGrip(0,grip);
            }''')
            bob.evaluate('fixture.grip.position.x+=.3;fixture.view.tick(performance.now());fixture.view.endGrip(0)')
            alice.wait_for_function('Math.abs(fixture.view.windows.get("test-alice").root.position.x-.5)<.001')
            report['guestGripAndResizeReplicated']=True
            # Eleven loaded room models must remain available, not evict down to eight.
            alice.evaluate('''async()=>{
                const {drops,lobby}=fixture;
                for(let i=0;i<11;i++){
                  const spec={object_id:'test-model-'+i,glb_url:'/__shared-cube.gltf',pose:{p:[i*.16-.8,.8,-1],q:[0,0,0,1],s:[1,1,1]}};
                  const row=drops.upsert(spec);await row.ready;lobby.send({type:'xr.drop',...spec});
                }
            }''')
            bob.wait_for_function('fixture.drops.items.size===11 && [...fixture.drops.items.values()].every(r=>!r.loading)')
            report['elevenModelsVisibleBoth']=True
            # Adopted geometry under a translated/scaled parent retains world placement on remote grip.
            report['adoptedParentTransform']=alice.evaluate('''()=>{
                const {THREE,scene,drops}=fixture;const parent=new THREE.Group();parent.position.set(1,2,3);parent.scale.setScalar(.5);scene.add(parent);
                const root=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());parent.add(root);
                drops.adopt('adopted-test',root,{pose:{p:[2,3,4],q:[0,0,0,1],s:[.2,.2,.2]}});
                drops.applyObject({object_id:'adopted-test',user_id:'test-bob',grabbing:true,pose:{p:[3,4,5],q:[0,0,0,1],s:[.3,.3,.3]}});
                root.updateMatrixWorld(true);const p=root.getWorldPosition(new THREE.Vector3()),s=root.getWorldScale(new THREE.Vector3());
                const valid=p.distanceTo(new THREE.Vector3(3,4,5))<1e-6&&Math.abs(s.x-.3)<1e-6;
                drops.remove('adopted-test');return valid&&root.parent===parent;
            }''')
            assert report['adoptedParentTransform']
            # Emulate an older server retaining just eight; peer inventory recovers the remainder.
            hub._xr_public_objects={k:v for k,v in list(hub._xr_public_objects.items())[-8:]}
            bob.evaluate('fixture.lobby.leave();fixture.media.reset();fixture.drops.clear()')
            alice.wait_for_function('fixture.lobby.getOccupants().length===0')
            alice.wait_for_timeout(1700)
            bob.evaluate('fixture.lobby.join()')
            bob.wait_for_function('fixture.drops.items.size===11 && [...fixture.drops.items.values()].every(r=>!r.loading)')
            bob.wait_for_function('fixture.view.windows.get("test-alice")?.video.getVideoPlaybackQuality().totalVideoFrames>5')
            report['lateJoinCameraAndFullInventory']=True
            bob.evaluate('fixture.camera.position.set(.3,1.5,1.7);fixture.camera.lookAt(.3,1.3,-.6)')
            bob.wait_for_timeout(150)
            bob.screenshot(path=str(output.with_suffix('.png')))
            alice.evaluate('fixture.media.stop()')
            bob.wait_for_function('fixture.view.windows.size===0')
            report['stopRemovesRemoteWindow']=True
            for page in pages:
                errors.extend(page.evaluate('runtimeErrors'))
                page.evaluate('fixture.media.reset();fixture.view.clear();clearInterval(timer);fixture.lobby.leave()')
            report['errors']=errors;assert not errors,errors
            report['scope']='Two isolated Chromium clients and real CollabHub relay; synthetic camera video and controller poses; no physical camera, production room, or robot commands.'
            output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));browser.close()
    finally:
        server.should_exit=True;thread.join(timeout=5);sock.close()
