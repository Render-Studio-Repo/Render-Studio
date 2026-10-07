import json
from backend.services import electronics_build as build, parts_workspace as parts, generation_service as jobs, prompt_history_service as history


def manifest(root):
    (root/'electronics_parts.json').write_text(json.dumps({'parts':[{'id':'board','name':'Board','category':'electronics','qty':1,'url':'https://vendor.example/board','docs':[{'label':'Pinout','url':'https://vendor.example/board.pdf'}]}]}))


def parent():
    return {'trace_id':'cad-1','kind':'prompt','status':'running','mode':'vibecad','by_user_id':'user','request_body':{'prompt':'Build a robot with a controller','mode':'vibecad','automatic_wiring':True,'model_electronics':False,'model':'gpt-6-astra'}}


def test_context_includes_all_links_and_origin_after_long_cad_prompt(tmp_path):
    manifest(tmp_path); p=parent(); p['request_body']['prompt']='robot '+('Detailed frame. '*1000)
    request=build.wiring_request(tmp_path,p,{'filename':'base.step'},parts.get_workspace(tmp_path))
    assert len(request['prompt'])<=8000
    assert request['model']=='gpt-6-astra'
    assert request['automation']['parent_trace_id']=='cad-1'
    context=json.loads((tmp_path/request['references'][0]['filename']).read_text())
    assert context['electronics'][0]['docs'][0]['url']=='https://vendor.example/board.pdf'
    assert 'https://vendor.example/board.pdf' in request['driver_links']
    assert context['artifact']=='base.step'


def test_disabled_and_nonelectrical_do_not_run_ai(tmp_path,monkeypatch):
    p=parent();p['request_body']['automatic_wiring']=False
    assert build.after_cad_complete(tmp_path,p,{}) is None
    p['request_body']['prompt']='Make a ceramic cup';p['request_body']['automatic_wiring']=True
    assert build.after_cad_complete(tmp_path,p,{}) is None
    for kind in ('wiring','render','imagine'):
        p['kind']=kind
        assert build.after_cad_complete(tmp_path,p,{}) is None


def test_one_child_preserves_author_model_and_running_history(tmp_path,monkeypatch):
    from backend import main,auth
    from backend.services import generation_process
    manifest(tmp_path);calls=[]
    monkeypatch.setattr(auth,'get_user_by_id',lambda uid:{'id':uid,'display_name':'Person'})
    monkeypatch.setattr(main,'_require_project_write',lambda *a:tmp_path)
    monkeypatch.setattr(generation_process,'spawn_detached',lambda target,args,**kw:calls.append((target,args,kw)))
    trace=build.after_cad_complete(tmp_path,parent(),{'filename':'base.step'})
    assert trace==build.after_cad_complete(tmp_path,parent(),{'filename':'base.step'})
    assert len(calls)==1 and calls[0][1][-1]=='user'
    entry=history.load(tmp_path)['entries'][0]
    assert entry['automation']['kind']=='cad-electronics' and entry['status']=='running'
    assert entry['user_name']=='Person' and entry['model']=='gpt-6-astra'
    assert jobs.get_job_by_trace(tmp_path,trace)['kind']=='wiring'


def test_later_cad_followup_does_not_regenerate_existing_wiring(tmp_path, monkeypatch):
    from backend import main, auth
    from backend.services import generation_process
    manifest(tmp_path)
    (tmp_path / 'wiring.json').write_text(json.dumps({'components': [{'id': 'board'}], 'wires': []}))
    calls = []
    monkeypatch.setattr(auth, 'get_user_by_id', lambda uid: {'id': uid, 'display_name': 'Person'})
    monkeypatch.setattr(main, '_require_project_write', lambda *a: tmp_path)
    monkeypatch.setattr(generation_process, 'spawn_detached', lambda *args, **kwargs: calls.append((args, kwargs)))
    followup = parent()
    followup['trace_id'] = 'cad-2'
    followup['request_body']['prompt'] = 'Make the robot base 20 mm wider'

    assert build.after_cad_complete(tmp_path, followup, {'filename': 'base-v2.step'}) is None
    assert calls == []
    assert history.load(tmp_path)['entries'] == []


def test_explicit_electronics_followup_regenerates_existing_wiring(tmp_path, monkeypatch):
    from backend import main, auth
    from backend.services import generation_process
    manifest(tmp_path)
    (tmp_path / 'wiring.json').write_text(json.dumps({'components': [{'id': 'board'}], 'wires': []}))
    calls = []
    monkeypatch.setattr(auth, 'get_user_by_id', lambda uid: {'id': uid, 'display_name': 'Person'})
    monkeypatch.setattr(main, '_require_project_write', lambda *a: tmp_path)
    monkeypatch.setattr(generation_process, 'spawn_detached', lambda target, args, **kwargs: calls.append((target, args, kwargs)))
    followup = parent()
    followup['trace_id'] = 'cad-3'
    followup['request_body']['prompt'] = 'Add a second limit switch and update the wiring schematic'

    trace = build.after_cad_complete(tmp_path, followup, {'filename': 'base-v3.step'})
    assert trace and trace.startswith('ew-')
    assert len(calls) == 1


def test_history_upsert_keeps_ai_tag_and_usage(tmp_path):
    history.append_entry(tmp_path,prompt='Wire',success=False,status='running',trace_id='w1',kind='wiring',user_id='u',automation={'kind':'cad-electronics','parent_trace_id':'cad1'})
    row=history.append_entry(tmp_path,prompt='Wire',success=True,status='complete',trace_id='w1',kind='wiring',user_id='u',usage={'input_tokens':10},ai_calls=1)
    assert row['automation']['parent_trace_id']=='cad1'
    assert row['usage']['input_tokens']==10 and len(history.load(tmp_path)['entries'])==1


def test_wiring_quantity_aggregates_motors_without_doubling_bom(tmp_path):
    (tmp_path/'electronics_parts.json').write_text(json.dumps({'parts':[{'id':'motor','name':'Motor','category':'electronics','qty':4,'url':'https://vendor.example/motor'}]}))
    (tmp_path/'wiring.json').write_text(json.dumps({'components':[{'id':f'm{i}','label':'Motor','source_url':'https://vendor.example/motor','docs':[{'label':'Pinout','url':'https://vendor.example/pins.pdf'}]} for i in range(4)]}))
    result=parts.get_workspace(tmp_path)
    assert len(result['parts'])==1 and result['parts'][0]['qty']==4
    assert result['parts'][0]['docs'][0]['url'].endswith('pins.pdf')
    assert parts.get_workspace(tmp_path)['parts'][0]['qty']==4
    assert len(json.loads((tmp_path/'Parts List/Electronics/parts.json').read_text())['parts'])==1


def test_import_switch_does_not_disable_parts_or_wiring_contract():
    rules=build.authoring_rules(False)
    assert 'import is OFF' in rules and 'electronics_parts.json' in rules
    assert 'manufacturer CAD first' in build.authoring_rules(True)


def test_electronics_parts_progress_counts_grabbed_parts(tmp_path):
    manifest(tmp_path)
    hud = build.electronics_parts_progress(tmp_path)
    assert hud["electronics_count"] == 1
    assert hud["electronics_parts"][0]["name"] == "Board"


def test_explicit_generated_document_is_not_truncated_before_parts(tmp_path):
    from backend import main
    d=tmp_path/'cad-electronics-test.json';d.write_text('a'*7000+'https://vendor.example/last-board.pdf')
    content=main._load_wiring_reference_documents(tmp_path,[{'filename':d.name}])
    assert 'last-board.pdf' in content
