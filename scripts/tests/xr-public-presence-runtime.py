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
parser.add_argument('--output', default='/tmp/xr-public-presence-runtime.json')
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

SETUP = r'''async id => {
  const THREE = await import('three');
  const {createXrPresence} = await import('/xr/xr-presence.js?v=presence1');
  const {createXrPublicLobby} = await import('/xr/xr-public-lobby.js?v=presence1');
  const NativeSocket = WebSocket; window.sockets = [];
  window.WebSocket = class extends NativeSocket { constructor(url) { super(url); sockets.push(this); } };
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x15202b);
  scene.add(new THREE.GridHelper(8, 40, 0x537285, 0x283f4e));
  const camera = new THREE.PerspectiveCamera(50, 900/700, .01, 50);
  camera.position.set(0, 1.7, .5); camera.lookAt(0, 1.25, -2);
  const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setSize(900,700);
  document.body.appendChild(renderer.domElement);
  const presence = createXrPresence({THREE, scene}); presence.setViewer(camera.position);
  const lobby = createXrPublicLobby({
    api: async path => (await fetch(path)).json(), getToken: () => id,
    getCurrentUser: () => ({id, display_name:id.slice(5)}),
    onXrPose: m => { presence.upsert({id:m.user_id, display_name:m.display_name, color:m.color}); presence.applyPose(m.user_id,m.pose); },
  });
  const x = id === 'test-alice' ? -.45 : .45;
  const pose = {head:{p:[x,1.6,-2],q:[0,1,0,0]}, left:{p:[x-.25,1.2,-1.85],q:[0,0,0,1]}, right:{p:[x+.25,1.2,-1.85],q:[0,0,0,1]},xr_device:'Quest 3',xr_mode:'ar'};
  window.fixture = {THREE,scene,presence,lobby,pose,renderer,camera};
  window.tick = () => { presence.syncUsers(lobby.getOccupants()); presence.tick(performance.now()); renderer.render(scene,camera); };
  window.timer = setInterval(tick, 30);
  // No movement or post-join pose is required to become visible.
  lobby.sendPose(pose);
  const result = await lobby.join(); if (!result.ok) throw Error(result.error);
}'''

SNAPSHOT = r'''() => {
  const {presence,lobby,renderer} = fixture; tick();
  return {joined:lobby.isJoined(), peers:lobby.getOccupants().map(u=>u.id),
    avatars:[...presence.avatars.values()].map(row=>{
      let meshes=0,triangles=0;
      for(const obj of [row.head,row.body,row.left,row.right]) obj.traverse(o=>{
        if(o.isMesh) {meshes++; triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}
      });
      return {id:row.id,head:row.head.visible,body:row.body.visible,left:row.left.visible,right:row.right.visible,
        position:row.head.position.toArray(),rotation:row.head.quaternion.toArray(),meshes,triangles};
    }),drawCalls:renderer.info.render.calls};
}'''

sock = socket.socket()
sock.bind(('127.0.0.1', 0))
base = 'http://127.0.0.1:' + str(sock.getsockname()[1])
server = uvicorn.Server(uvicorn.Config(app, log_level='error'))
thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
# Never write presence to the real database or connect to the production room.
with patch('backend.services.xr_public_room_service.touch'), patch('backend.services.xr_public_room_service.leave'):
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            if time.monotonic() > deadline:
                raise RuntimeError('Isolated test server did not start')
            time.sleep(.02)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            pages, errors = [], []
            for uid in ('test-alice', 'test-bob'):
                page = browser.new_page(viewport={'width':900,'height':700})
                page.context.grant_permissions(['local-network-access'], origin=base)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(base + '/__presence-test')
                page.evaluate(SETUP, uid)
                pages.append(page)
            alice, bob = pages
            report = {}
            for name, page in zip(('alice','bob'), pages):
                page.wait_for_function('fixture.presence.avatars.size===1 && [...fixture.presence.avatars.values()][0].body.visible && [...fixture.presence.avatars.values()][0].left.userData.questController && [...fixture.presence.avatars.values()][0].right.userData.questController')
                report[name] = page.evaluate(SNAPSHOT)
                avatar = report[name]['avatars'][0]
                assert all(avatar[k] for k in ('head','body','left','right')), report
                assert avatar['meshes'] == 5 and avatar['triangles'] < 10000, report
            # Rotation-only updates must rotate both head and body at fixed position.
            alice.evaluate('fixture.pose.head.q=[0,.70710678,0,.70710678];fixture.lobby.sendPose(fixture.pose)')
            bob.wait_for_function('Math.abs(fixture.presence.avatars.get("test-alice").head.quaternion.w-.70710678)<.001')
            assert abs(bob.evaluate('fixture.presence.avatars.get("test-alice").body.rotation.y') - 1.5707963) < .01
            report['rotationOnly'] = bob.evaluate(SNAPSHOT)
            # Desktop roster entries cannot consume the visible XR avatar slots.
            report['desktopRosterFiltering'] = bob.evaluate('''() => {
              fixture.presence.syncUsers([...Array.from({length:8},(_,i)=>({id:'desktop-'+i})),...fixture.lobby.getOccupants()]);
              return fixture.presence.avatars.has('test-alice');
            }''')
            assert report['desktopRosterFiltering']
            # Drop just the isolated transport; automatic reconnect replays the cached pose.
            alice.evaluate('fixture.lobby.sendPose(fixture.pose);sockets[0].close()')
            bob.wait_for_function('fixture.presence.avatars.size===0')
            alice.wait_for_function('sockets.length===2 && fixture.lobby.isJoined()')
            bob.wait_for_function('fixture.presence.avatars.has("test-alice") && fixture.presence.avatars.get("test-alice").body.visible')
            report['reconnected'] = bob.evaluate(SNAPSHOT)
            # Shared floor, controller navigation, real GLTF import and handoff.
            extension = Path(__file__).with_name('xr-room-floor-runtime.js').read_text()
            report['floorBefore'] = [page.evaluate(extension, uid) for page,uid in zip(pages,('test-alice','test-bob'))]
            alice.evaluate('fixture.room.actions.recenterRoomFloor();fixture.room.publishPose()')
            bob.wait_for_function('Math.abs(fixture.room.head.y-fixture.room.nativeHeight)<.001')
            report['floorAfter'] = [page.evaluate('''() => {
              const r=fixture.room;r.getHeadPose();return {head:r.head.toArray(),floor:r.board.state.loco.p[1],nativeHeight:r.nativeHeight};
            }''') for page in pages]
            for row in report['floorAfter']:
                assert row['floor'] == 0 and abs(row['head'][1]-row['nativeHeight']) < .001
            report['stableBase'] = alice.evaluate('''() => {
              const r=fixture.room,base=r.board.state.baseRefSpace;r.board.captureRefSpace(r.renderer);return r.board.state.baseRefSpace===base;
            }''')
            assert report['stableBase']
            report['teleopRecenterDeferred'] = bob.evaluate('''() => {
              const r=fixture.room,before=JSON.stringify(r.board.state.loco);r.actions.setArmed(true);
              r.actions.applyRoomFloorSeat({user_id:'test-bob',p:[3,0,3],yaw:0});r.actions.setArmed(false);
              return before===JSON.stringify(r.board.state.loco) && !!r.actions.pending();
            }''')
            assert report['teleopRecenterDeferred']
            alice.evaluate('fixture.room.importer("test-project")')
            bob.wait_for_function('fixture.room.drops.get("shared-test-model")?.loading===false')
            for page in pages:
                assert page.evaluate('fixture.room.drops.get("shared-test-model").root.children[0].name!=="xr-drop-placeholder"')
                # The actual visible CAD bounds align with the shared root even for an offset CAD origin.
                assert page.evaluate('''() => {
                  const r=fixture.room.drops.get('shared-test-model'),c=new fixture.THREE.Box3().setFromObject(r.root).getCenter(new fixture.THREE.Vector3());
                  return c.distanceTo(r.root.position)<.0001 && r.root.quaternion.w===0;
                }''')
            assert alice.evaluate('fixture.room.moveObject([.25,1.2,0],true)')
            bob.wait_for_function('fixture.room.drops.get("shared-test-model")?.spec.grabbing===true')
            assert not bob.evaluate('fixture.room.drops.canGrab("shared-test-model")')
            alice.evaluate('fixture.room.moveObject([.4,1.1,-.2],false)')
            bob.wait_for_function('fixture.room.drops.get("shared-test-model").root.position.x===.4 && !fixture.room.drops.get("shared-test-model").spec.grabbing')
            assert bob.evaluate('fixture.room.moveObject([-.3,1.35,.2],true)')
            alice.wait_for_function('fixture.room.drops.get("shared-test-model").root.position.x===-.3')
            bob.evaluate('fixture.room.moveObject([0,1.25,0],false)')
            alice.wait_for_function('fixture.room.drops.get("shared-test-model").root.position.x===0')
            report['sharedModel'] = {'realGltfLoadedBoth':True,'centeredCadOrigin':True,'halfTurnQuaternionPreserved':True,
                                     'holdingVisible':True,'heldByOtherBlocksGrab':True,'releaseExact':True,'handoffBothDirections':True}
            # Run the actual viewport grip acquire/update/release functions with a posed controller.
            assert alice.evaluate('fixture.room.grip.grab()')
            alice.wait_for_timeout(100)
            alice.evaluate('fixture.room.grip.move([.2,0,0])')
            bob.wait_for_function('fixture.room.drops.get("shared-test-model").root.position.x===.2')
            alice.evaluate('fixture.room.grip.release()')
            bob.wait_for_function('!fixture.room.drops.get("shared-test-model").spec.grabbing')
            assert bob.evaluate('fixture.room.grip.grab()')
            bob.wait_for_timeout(100)
            bob.evaluate('fixture.room.grip.move([-.2,0,0]);fixture.room.grip.release()')
            alice.wait_for_function('fixture.room.drops.get("shared-test-model").root.position.x===0')
            report['sharedModel']['actualViewportGripHandoff'] = True
            # Late/rejoining clients recover geometry and final placement from the stored room snapshot.
            bob.evaluate('fixture.lobby.leave();fixture.room.drops.clear()')
            bob.evaluate('fixture.lobby.sendPose(fixture.pose);fixture.lobby.join()')
            bob.wait_for_function('fixture.room.drops.get("shared-test-model")?.loading===false')
            assert bob.evaluate('fixture.room.drops.get("shared-test-model").root.position.y===1.25')
            report['sharedModel']['lateJoinReplay'] = True
            bob.evaluate('fixture.camera.position.set(2,2.4,3);fixture.camera.lookAt(0,1.1,0);tick()')
            bob.screenshot(path=str(output.with_suffix('.png')))
            alice.evaluate('fixture.lobby.leave()')
            bob.wait_for_function('fixture.presence.avatars.size===0')
            report['leaveRemovesAvatar'] = True
            for page in pages:
                page.evaluate('clearInterval(timer);fixture.lobby.leave();fixture.presence.clear()')
            report['pageErrors'] = errors
            assert not errors, errors
            report['scope'] = 'Two Chromium clients, real CollabHub relay and frontend modules, synthetic headset poses; isolated identities/server, no production connections or robot commands.'
            output.write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report, indent=2))
            browser.close()
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()
