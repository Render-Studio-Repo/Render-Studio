"""Exercise authenticated routes and persistence without paying for model calls."""
import json
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from backend.auth import get_current_user
from backend.routes import micro_edits as routes
from backend.services import micro_edits as service


def test_inspection_is_read_only_and_generation_requires_write_access(tmp_path, monkeypatch):
    app=FastAPI();app.include_router(routes.router)
    app.dependency_overrides[get_current_user]=lambda:{'id':'viewer'}
    def project(user, pid, read=False):
        assert user['id']=='viewer' and pid=='project'
        if not read: raise HTTPException(403,'Read only')
        return tmp_path
    monkeypatch.setattr(routes,'project',project)
    monkeypatch.setattr(service,'inspect',lambda *args:{'revision':'a'*24,'bodies':[]})
    client=TestClient(app)
    assert client.post('/api/micro-edits/inspect',json={'project_id':'project','base_filename':'part.step'}).status_code==200
    body={'project_id':'project','base_filename':'part.step','revision':'a'*24,'prompt':'Move 1 mm',
          'models':[{'model':'test','count':1}],'body_ids':['body:0']}
    assert client.post('/api/micro-edits/runs',json=body).status_code==403
    assert list(tmp_path.iterdir())==[]


def test_logs_download_and_ratings_persist_with_the_model(tmp_path, monkeypatch):
    app=FastAPI();app.include_router(routes.router)
    app.dependency_overrides[get_current_user]=lambda:{'id':'reviewer'}
    monkeypatch.setattr(routes,'project',lambda *args,**kwargs:tmp_path)
    (tmp_path/'Debug_1.glb').write_bytes(b'fixture revision for rating')
    run={'id':'b'*16,'user_id':'author','project_id':'project','status':'complete','created_at':service.now(),
         'prompt':'Enlarge hole 2 mm','results':[{'id':1,'glb_filename':'Debug_1.glb','model':'test','variant':'minimal'}]}
    service.save(tmp_path,run);client=TestClient(app)
    res=client.get('/api/micro-edits/projects/project/runs/'+'b'*16+'/log')
    assert res.status_code==200 and 'attachment' in res.headers['content-disposition']
    assert res.json()['prompt']=='Enlarge hole 2 mm'
    scores={category:4 for category in service.RATING_CATEGORIES}
    res=client.post('/api/micro-edits/projects/project/ratings',json={'filename':'Debug_1.glb','ratings':scores,'comment':'Test fixture only'})
    assert res.status_code==200
    assert service.load(tmp_path,'b'*16)['results'][0]['ratings']['reviewer']['scores']==scores
    assert client.post('/api/micro-edits/projects/project/ratings',json={'filename':'Debug_1.glb','ratings':{**scores,'overall':6}}).status_code==422
    assert client.get('/api/micro-edits/projects/project/runs/not-a-run/log').status_code==404
