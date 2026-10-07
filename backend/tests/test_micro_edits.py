import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from build123d import Box, Cylinder, Compound, Color, export_step

from backend.services import micro_edit_kernel as kernel, micro_edits as service


@pytest.fixture
def fixture(tmp_path):
    plate = Box(40, 30, 5) - Cylinder(2, 10)
    plate.label = "Mount"; plate.color = Color(.3, .5, .7)
    block = Box(10, 10, 10).translate((60, 0, 0)); block.label = "Preserve"
    source = tmp_path / "fixture.step"
    export_step(Compound(children=[plate, block]), source)
    return source


def hole(info):
    return next(f for f in info["bodies"][0]["faces"] if f.get("hole"))


@pytest.mark.parametrize("diameter,delta", [(6, [3,0,0]), (3, [0,0,0]), (4, [-5,2,0])])
def test_hole_edit_is_exact_and_preserves_unselected_bodies(fixture, diameter, delta):
    before = fixture.read_bytes(); info = kernel.inspect(fixture, ["body:0"])
    op = {"op":"move_hole", "body_id":"body:0", "face_id":hole(info)["id"], "diameter_mm":diameter, "translation_mm":delta}
    dest = fixture.with_name("result.step")
    result = kernel.apply(fixture, dest, {"operations":[op]}, ["body:0"])
    after = kernel.inspect(dest, ["body:0"])
    assert fixture.read_bytes() == before
    assert result["valid"] and result["unselected_bodies_preserved"]
    assert after["bodies"][1] == info["bodies"][1]
    assert after["bodies"][0]["size_mm"] == info["bodies"][0]["size_mm"]
    assert hole(after)["hole"]["diameter_mm"] == pytest.approx(diameter)
    assert hole(after)["hole"]["origin"][:2] == pytest.approx(delta[:2])
    from build123d import import_step
    assert kernel._solids(import_step(dest))[0].color.to_tuple() == pytest.approx(kernel._solids(import_step(fixture))[0].color.to_tuple())


@pytest.mark.parametrize("op", [
    {"op":"move_body", "body_id":"body:0", "translation_mm":[4,0,0]},
    {"op":"scale_body", "body_id":"body:0", "factors":[1.05,1,1]},
    {"op":"offset_face", "body_id":"body:0", "face_id":"face:5", "distance_mm":-2},
])
def test_supported_small_edits_keep_original_and_sibling(fixture, op):
    original = fixture.read_bytes(); before=kernel.inspect(fixture)
    dest=fixture.with_name("edited.step")
    kernel.apply(fixture,dest,{"operations":[op]},["body:0"])
    assert fixture.read_bytes()==original
    assert kernel.inspect(dest)["bodies"][1]==before["bodies"][1]


@pytest.mark.parametrize("op,scope,faces,error", [
    ({"op":"move_body","body_id":"body:1","translation_mm":[1,0,0]},["body:0"],[],"outside"),
    ({"op":"resize_hole","body_id":"body:0","face_id":"face:6","diameter_mm":5},["body:0"],["body:0/face:1"],"outside"),
    ({"op":"offset_face","body_id":"body:0","face_id":"face:6","distance_mm":2},["body:0"],[],"planar"),
    ({"op":"exec","body_id":"body:0","face_id":"face:6"},["body:0"],[],"Unsupported"),
    ({"op":"scale_body","body_id":"body:0","factors":[2,1,1]},["body:0"],[],"limit"),
    ({"op":"move_hole","body_id":"body:0","face_id":"face:6","translation_mm":[0,0,1]},["body:0"],[],"plane"),
])
def test_rejects_out_of_scope_and_unsupported_geometry(fixture,op,scope,faces,error):
    dest=fixture.with_name("bad.step")
    with pytest.raises(ValueError,match=error): kernel.apply(fixture,dest,{"operations":[op]},scope,faces)
    assert not dest.exists()


def test_revision_guard_and_no_model_fallback(fixture):
    _,rev=service.resolve_base(fixture.parent,fixture.name)
    request={"project_id":"p","base_filename":fixture.name,"revision":"0"*24,"body_ids":["body:0"],
             "models":[{"model":"test","count":1}],"variants":["minimal"],"prompt":"Move 1 mm"}
    with pytest.raises(ValueError,match="changed"):
        service.start(fixture.parent,{"id":"u"},request,lambda model:SimpleNamespace(model=model))
    request["revision"]=rev
    with pytest.raises(ValueError,match="resolved"):
        service.start(fixture.parent,{"id":"u"},request,lambda model:SimpleNamespace(model="different"))
    request["models"][0]["count"]=11
    with pytest.raises(ValueError,match="1–10"):
        service.start(fixture.parent,{"id":"u"},request,lambda model:SimpleNamespace(model=model))


def test_log_restart_state_and_rating_merge(tmp_path):
    run={"id":"a"*16,"status":"running","results":[{"id":1}],"created_at":service.now()}
    service.save(tmp_path,run)
    assert service.load(tmp_path,run["id"])["status"]=="interrupted"
    rated=copy.deepcopy(run); rated["results"][0]["ratings"]={"u":{"at":"2026-09-15","scores":{"overall":5}}}
    service.save(tmp_path,rated);service.save(tmp_path,run)
    assert service.load(tmp_path,run["id"])["results"][0]["ratings"]["u"]["scores"]["overall"]==5


def test_log_path_cannot_escape(tmp_path):
    with pytest.raises(ValueError):service.load(tmp_path,"../../secrets")


def test_rejects_stale_surface_after_body_transform(fixture):
    with pytest.raises(ValueError, match='anchors changed'):
        kernel.apply(fixture, fixture.with_name('bad.step'), {'operations':[
            {'op':'move_body','body_id':'body:0','translation_mm':[5,0,0]},
            {'op':'resize_hole','body_id':'body:0','face_id':'face:6','diameter_mm':6}]}, ['body:0'])


def test_repeated_benchmarks_keep_separate_billed_history_rows(fixture, tmp_path, monkeypatch):
    import shutil, threading
    from backend.services import prompt_history_service as history
    work=tmp_path/'work';work.mkdir();shutil.copyfile(fixture,work/'source.step')
    monkeypatch.setattr(service,'kernel',lambda r,**kw: kernel.inspect(r['step'],r.get('body_ids',[])) if r['action']=='inspect' else kernel.apply(r['step'],r['dest'],r['plan'],r['body_ids']))
    monkeypatch.setattr(service,'_plan',lambda *a:({'operations':[{'op':'move_body','body_id':'body:0','translation_mm':[1,0,0]}]}, {'usage':{'input_tokens':100,'output_tokens':10,'total_tokens':110},'model':'test','provider':'openai','cost_usd':.001}))
    monkeypatch.setattr(service.prompt_learning,'record',lambda *a:'test-event')
    request={'models':[{'model':'test','count':3}],'variants':['minimal'],'body_ids':['body:0'],'prompt':'Move the selected body 1 mm','ai_key_source':'personal'}
    run={'id':'d'*16,'project_id':tmp_path.name,'user_id':'u','status':'queued','created_at':service.now(),'base_filename':fixture.name,'revision':'a'*24,
         'prompt':request['prompt'],'harness':'CAD','body_ids':['body:0'],'face_ids':[],'total':3,'results':[],'skill_version':'test','debug':True}
    service._execute(tmp_path,{'id':'u'},request,run,work,lambda m:SimpleNamespace(model=m,provider='openai'),threading.Event())
    assert [r['status'] for r in run['results']]==['complete']*3
    rows=history.load(tmp_path)['entries']
    assert len(rows)==3
    assert len({r['trace_id'] for r in rows})==3
    assert sum(r['usage']['total_tokens'] for r in rows)==330
