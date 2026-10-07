import asyncio
from unittest.mock import AsyncMock

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from backend.routers import robotics_live as route
from backend.services import robotics_live as live


def test_owner_reconnect_keeps_scene_and_geometry_then_expires(monkeypatch):
    monkeypatch.setattr(live, 'OWNER_RECONNECT_SECONDS', 0.025)

    async def check():
        scene = live.LiveScene({'id': 'owner'}, 'http://127.0.0.1:8095', {})
        monkeypatch.setitem(live.SESSIONS, scene.id, scene)
        scene.assets['mesh'] = b'geometry'
        guest = AsyncMock()
        scene.clients[guest] = 'guest'
        scene.owner_disconnected()
        await asyncio.sleep(0.005)
        scene.clients['owner-socket'] = 'owner'
        scene.owner_connected()
        await asyncio.sleep(0.035)
        assert live.SESSIONS[scene.id] is scene
        assert scene.assets['mesh'] == b'geometry'
        guest.close.assert_not_awaited()
        del scene.clients['owner-socket']
        scene.owner_disconnected()
        await asyncio.sleep(0.04)
        assert scene.id not in live.SESSIONS
        guest.close.assert_awaited_once()
    asyncio.run(check())


def test_room_viewer_snapshot_assets_movement_and_owner_reconnect(monkeypatch):
    scene = live.LiveScene({'id': 'owner'}, 'http://127.0.0.1:8095', {})
    scene.status = 'live'
    scene.assets['mesh'] = b'glb-bytes'
    scene.remember({'type': 'GlbMessage', 'name': '/robot/arm', 'props': {'glb_data': {'asset': 'mesh'}}})
    scene.remember({'type': 'SetPositionMessage', 'name': '/robot/arm', 'position': [0, 0, 0.4]})
    monkeypatch.setitem(live.SESSIONS, scene.id, scene)
    monkeypatch.setattr(route, 'decode_token', lambda token: token if token in {'owner', 'guest', 'outsider'} else None)
    monkeypatch.setattr(route, 'in_room', lambda uid: uid in {'owner', 'guest'})
    app = FastAPI()
    app.include_router(route.router)

    def user(request: Request):
        return {'id': request.headers.get('x-test-user', 'owner')}
    app.dependency_overrides[route.get_current_user] = user
    url = f'/api/robotics/live/{scene.id}'
    with TestClient(app) as client:
        with client.websocket_connect(url + '/ws?token=owner') as owner:
            assert owner.receive_json()['scene']['id'] == scene.id
            response = client.post(url + '/action', json={'action': 'sharing', 'value': {'room': True}})
            assert response.status_code == 200
            assert owner.receive_json()['scene']['share'] is True
            with client.websocket_connect(url + '/ws?token=guest') as guest:
                snapshot = guest.receive_json()
                assert snapshot['messages'][0]['props']['glb_data']['asset'] == 'mesh'
                assert snapshot['messages'][1]['position'] == [0, 0, 0.4]
                assert client.get(url + '/asset/mesh?token=guest').content == b'glb-bytes'
                assert client.get(url + '/asset/mesh?token=outsider').status_code == 403
                pose = {'position': [0.5, 0.8, -1], 'quaternion': [0, 0, 0, 1], 'scale': 0.55}
                response = client.post(url + '/action', json={'action': 'pose', 'value': pose})
                assert response.status_code == 200
                assert guest.receive_json()['scene']['pose'] == pose
                owner.receive_json()
                # Sharing visualization never grants target/robot control.
                assert client.post(url + '/action', headers={'x-test-user': 'guest'},
                                   json={'action': 'transform', 'value': {}}).status_code == 403
        # The owner's socket is gone, but a reconnect and asset fetch remain valid.
        assert client.get(url + '/asset/mesh?token=owner').status_code == 200
        with client.websocket_connect(url + '/ws?token=owner') as owner:
            snapshot = owner.receive_json()
            assert snapshot['scene']['pose'] == pose
            assert snapshot['messages'][0]['type'] == 'GlbMessage'
        assert client.delete(url).status_code == 200
        assert scene.id not in live.SESSIONS
