import json
from pathlib import Path

import pytest
import trimesh
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.auth import get_current_user
from backend.routes import design_assistance as routes
from backend.services import model_followups as followups


@pytest.fixture
def root(tmp_path):
    scene=trimesh.Scene()
    scene.add_geometry(trimesh.creation.box(extents=[20,30,40]),geom_name="battery_tray")
    scene.export(tmp_path / "robot.glb")
    return tmp_path


def generate(root):
    _,revision=followups.model(root,"robot.glb")
    return followups.create(root,"robot.glb",revision,{"summary":"Review the battery tray fit", "questions":[
        {"question":"Does the battery tray need to move?","reason":"Leave connector clearance","category":"placement"},
        {"question":"Does the front bracket look too long?","category":"micro_edit"}]})


def test_answers_become_model_scoped_text_reference(root):
    data=generate(root)
    saved=followups.save(root,"robot.glb",data["model_revision"],data["revision"],{data["questions"][0]["id"]:"Move the tray 15 mm toward the rear; keep the holes."},"Shorten only the front bracket by 2 mm.")
    text=(root / saved["reference"]["filename"]).read_text()
    assert "15 mm" in text and "2 mm" in text
    assert "[not answered]" in text and "Preserve unrelated bodies" in text
    assert followups.context_text(root,"robot.glb")==text
    assert followups.context_text(root,"other.glb")==""
    assert saved["reference"]["type"]=="document"


def test_cached_questions_keep_answers_and_no_duplicate_ids(root):
    data=generate(root)
    saved=followups.save(root,"robot.glb",data["model_revision"],1,{data["questions"][0]["id"]:"Looks correct"},"")
    repeated=generate(root)
    assert repeated["revision"]==saved["revision"]
    assert repeated["questions"][0]["answer"]=="Looks correct"


def test_concurrent_answer_save_does_not_overwrite(root):
    data=generate(root)
    followups.save(root,"robot.glb",data["model_revision"],1,{},"First window")
    with pytest.raises(ValueError,match="another window"):
        followups.save(root,"robot.glb",data["model_revision"],1,{},"Second window")
    assert followups.load(root,"robot.glb")["notes"]=="First window"


def test_new_model_revision_excludes_stale_answers_and_keeps_recovery(root):
    data=generate(root)
    followups.save(root,"robot.glb",data["model_revision"],1,{},"Old bracket instruction")
    trimesh.creation.box(extents=[50,60,70]).export(root / "robot.glb")
    assert followups.context_text(root,"robot.glb")==""
    new=generate(root)
    assert new["model_revision"]!=data["model_revision"]
    assert "Old bracket instruction" not in new["reference"]["text_content"]
    assert new["previous_answers"]["notes"]=="Old bracket instruction"


def test_model_inventory_reads_generated_body(root):
    summary=followups.inspect_model(root,root / "robot.glb")
    assert summary["bodies"][0]["name"]=="battery_tray"
    assert summary["bodies"][0]["bounds"]==[[-10,-15,-20],[10,15,20]]
    assert summary["scene_units"].startswith("unspecified")


def test_generate_endpoint_requires_model_and_passes_actual_context(root,monkeypatch):
    app=FastAPI();app.include_router(routes.router)
    app.dependency_overrides[get_current_user]=lambda:{"id":"u"}
    monkeypatch.setattr(routes,"project",lambda *a,**k:root)
    monkeypatch.setattr(routes,"ai_for",lambda *a:None)
    seen=[]
    def call(ai,system,context,images=None):
        seen.append((system,json.loads(context),images))
        return {"summary":"Review your tray","questions":[{"question":"Is the tray clearance correct?","reason":"Assembly fit"}]},{}
    monkeypatch.setattr(routes,"call_json",call)
    client=TestClient(app)
    assert client.post('/api/design-assist/model-followups/generate',json={"project_id":"p"}).status_code==422
    body={"project_id":"p","base_filename":"robot.glb","prompt":"Make a base", "references":[{"id":"face-1","type":"face"}], "images":[{"name":"viewport.jpg","data_url":"data:image/jpeg;base64,AA"}]}
    first=client.post('/api/design-assist/model-followups/generate',json=body)
    assert first.status_code==200,first.text
    assert seen[0][1]["model"]["bodies"][0]["name"]=="battery_tray"
    assert seen[0][1]["selected_references"][0]["id"]=="face-1"
    assert seen[0][2][0]["name"]=="viewport.jpg"
    client.post('/api/design-assist/model-followups/generate',json=body)
    assert len(seen)==1
    data=first.json()
    saved=client.put('/api/design-assist/projects/p/model-followups',json={"filename":"robot.glb","model_revision":data["model_revision"],"revision":1,"answers":{data["questions"][0]["id"]:"Move it rearward 15 mm"},"notes":"Keep other parts"})
    assert saved.status_code==200
    reopened=client.get('/api/design-assist/projects/p/model-followups',params={"filename":"robot.glb"})
    assert reopened.json()["questions"][0]["answer"]=="Move it rearward 15 mm"


def test_non_model_files_are_rejected(root):
    (root/'secrets.txt').write_text('not a model')
    with pytest.raises(ValueError):followups.model(root,'secrets.txt')
