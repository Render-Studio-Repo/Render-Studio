import asyncio
import json
from pathlib import Path
import pytest
import httpx
from backend.services import robotics_profile as service

PROFILE = json.loads((Path(__file__).parents[2] / 'frontend/xr/robotics-default-profile.json').read_text())

def test_profile_roundtrip_preserves_controls_and_single_client():
    p = service.validate_profile_selection({'profile': PROFILE, 'configUrl': PROFILE['paste_url']})
    assert p['profile']['controllers']['single_client'] is True
    assert p['profile']['controllers']['buttons']['left']['Y']['hold_ms'] == 3000
    assert service.validate_profile_selection({'mode': 'studio'}) == {'mode': 'studio'}

@pytest.mark.parametrize('url', ['http://8.8.8.8/config', 'http://169.254.169.254/config', 'http://user:pass@192.168.1.77/config', 'http://192.168.1.77/teleop/y', 'file:///config', 'http://example.com/config'])
def test_discovery_rejects_non_lan_and_action_endpoints(url):
    with pytest.raises(ValueError): asyncio.run(service.discover_profile(url))

def test_discovery_reads_json_without_controls_or_redirects(monkeypatch):
    seen = []
    def handler(request):
        seen.append((request.method, str(request.url)))
        return httpx.Response(200, json=PROFILE)
    original = httpx.AsyncClient
    monkeypatch.setattr(service.httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    p = asyncio.run(service.discover_profile(PROFILE['paste_url']))
    assert p['profile'] == PROFILE
    assert seen == [('GET', PROFILE['paste_url'])]


def test_profile_size_is_bounded():
    with pytest.raises(ValueError): service.validate_profile_selection({'profile':{**PROFILE,'huge':'x'*65536}})


def test_saved_profile_survives_robotics_preferences_updates():
    from backend.services.robotics_prefs import _sanitize
    selection = {'mode':'integrated','version':2,'profile':PROFILE,'configUrl':PROFILE['paste_url']}
    user = {'id':'robotics-test','email':'a1projects@protonmail.com'}
    first = _sanitize({'roboticsProfile':selection,'camMode':'detach'}, user)
    second = _sanitize({**first, 'cameraTitles':{'left':'Gripper left','right':'Gripper right'}}, user)
    assert second['roboticsProfile'] == selection
    assert second['camMode'] == 'detach'


def test_discovery_route_requires_sign_in(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routers.robotics_studio import router
    from backend.auth import get_current_user
    app=FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        assert client.post('/api/robotics/config/discover',json={'url':PROFILE['paste_url']}).status_code == 401
        app.dependency_overrides[get_current_user] = lambda: {'id':'robotics-test'}
        async def discover(url): return {'mode':'external','profile':PROFILE,'configUrl':url}
        monkeypatch.setattr(service,'discover_profile',discover)
        response=client.post('/api/robotics/config/discover',json={'url':PROFILE['paste_url']},headers={'host':'localhost'})
        assert response.status_code == 200
        assert response.json()['profile'] == PROFILE

