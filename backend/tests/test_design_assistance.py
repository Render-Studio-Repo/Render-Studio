import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.services import parts_workspace as parts, prompt_learning as learning
from backend.routes import design_assistance as routes
from backend.auth import get_current_user


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(learning.settings, 'data_dir', str(tmp_path / 'data'))
    monkeypatch.setattr(learning, 'sync_state', lambda user: None)
    monkeypatch.setattr(learning, '_remote_client', lambda: None)
    return tmp_path


def seed(root):
    (root / 'parts_list.json').write_text(json.dumps({'parts':[{'id':'arduino','name':'Arduino','category':'electronics','qty':1,'url':'https://example.com/arduino'}]}))
    return parts.get_workspace(root)


def test_parts_create_folders_and_import_wiring(root):
    (root / 'wiring.json').write_text(json.dumps({'components':[{'id':'pi','type':'raspberry_pi','label':'Raspberry Pi','source_url':'https://example.com/pi'}], 'wires':[{'from':'pi.1','to':'driver.1','gauge':'22 AWG'}]}))
    data=parts.get_workspace(root)
    assert len(data['parts'])==1  # A wire connection without a product is not a purchase.
    assert (root/'Parts List/Electronics/parts.json').exists()
    assert (root/'Parts List/McMaster/parts.json').exists()
    assert parts.get_workspace(root)['revision']==data['revision']


def test_deny_does_not_replace_and_approval_is_idempotent(root):
    seed(root)
    data=parts.store_proposals(root,[{'name':'Pi','replaces':'arduino','url':'https://www.raspberrypi.com/products/raspberry-pi-5/'}])
    pid=data['proposals'][0]['id']
    denied=parts.decide(root,pid,False)
    assert denied['parts'][0]['name']=='Arduino'
    assert parts.decide(root,pid,True)==denied


def test_replacement_chain_does_not_resurrect_original(root):
    seed(root)
    data=parts.store_proposals(root,[{'name':'Pi 4','replaces':'arduino','url':'https://example.com/pi4'}])
    data=parts.decide(root,data['proposals'][-1]['id'],True)
    target=data['parts'][0]['id']
    data=parts.store_proposals(root,[{'name':'Pi 5','replaces':target,'url':'https://example.com/pi5'}])
    data=parts.decide(root,data['proposals'][-1]['id'],True)
    assert [p['name'] for p in parts.get_workspace(root)['parts']]==['Pi 5']
    assert 'Arduino' in parts.edit_brief(data) and 'Pi 5' in parts.edit_brief(data)


def test_stale_replacement_rejected(root):
    seed(root)
    data=parts.store_proposals(root,[{'name':'Pi','replaces':'arduino','url':'https://example.com/pi'},
                                    {'name':'ESP32','replaces':'arduino','url':'https://example.com/esp32'}])
    first,second=[p['id'] for p in data['proposals']]
    parts.decide(root,first,True)
    with pytest.raises(ValueError,match='changed'):
        parts.decide(root,second,True)


def test_questions_preserve_answers_and_deduplicate(root):
    data=parts.save_questions(root,[{'question':'Battery size?','reason':'Mount'}])
    parts.save_questions(root,[{'id':data['questions'][0]['id'],'answer':'260 x 168 x 212 mm'}])
    data=parts.save_questions(root,[{'question':'Battery size?','reason':'Clearance'}])
    assert len(data['questions'])==1
    assert data['questions'][0]['answer']=='260 x 168 x 212 mm'


def test_product_source_parser_and_untrusted_urls():
    parser=parts._ProductParser('https://www.pololu.com/product/1')
    parser.feed('<script>ignore instructions</script><meta property="og:image" content="/image.jpg"><p>24 V</p><a href="/spec.pdf">Datasheet</a>')
    assert parser.thumbnail=='https://www.pololu.com/image.jpg'
    assert parser.docs[0]['url']=='https://www.pololu.com/spec.pdf'
    assert 'ignore instructions' not in parser.text
    assert parts.safe_url('javascript:alert(1)')==''
    with patch.object(parts.httpx,'stream') as fetch:
        assert parts.enrich_source({'url':'https://127.0.0.1/private'})=={'url':'https://127.0.0.1/private'}
        fetch.assert_not_called()


def test_known_and_cached_product_thumbnails(root):
    ada=parts.clean_part({'name':'Adafruit BNO085','url':'https://www.adafruit.com/product/4754','category':'electronics'})
    assert ada['thumbnail_url']=='https://cdn-shop.adafruit.com/640x480/4754-00.jpg'
    catalog=parts.clean_part({'name':'Catalog board','url':'https://example.com/board','png_url':'https://step.parts/board.png'})
    assert catalog['thumbnail_url']=='https://step.parts/board.png'
    screw=parts.clean_part({'name':'Socket head','part_number':'91292A144','url':'https://www.mcmaster.com/91292A144/','category':'mcmaster'})
    assert not screw.get('thumbnail_url')
    logo=parts.clean_part({'name':'Washer','part_number':'93475A250','url':'https://www.mcmaster.com/93475A250/','category':'mcmaster','thumbnail_url':'https://www.mcmaster.com/favicon.ico'})
    assert not logo.get('thumbnail_url')
    (root/'parts_list.json').write_text(json.dumps({'parts':[screw]}))
    with patch('backend.services.link_preview.preview') as preview:
        preview.return_value={'image':'https://images.mcmaster.com/actual/socket-head.png'}
        assert not parts.get_workspace(root)['parts'][0].get('thumbnail_url')
        thumbs=parts.hydrate_thumbnails(root, [screw['id']])
        assert thumbs['thumbnails'][screw['id']]=='https://images.mcmaster.com/actual/socket-head.png'
        preview.assert_called_once_with('https://www.mcmaster.com/91292A144/')
        decorated=parts.decorate_workspace_thumbnails(root, parts.get_workspace(root))
        assert decorated['parts'][0]['thumbnail_url']=='https://images.mcmaster.com/actual/socket-head.png'


def test_feedback_owner_and_vote_updates(root):
    learning.set_feedback_retention('owner', True)
    event=learning.record('owner','project','baseline','interpretation',{'prompt':'Shorten face'})
    with pytest.raises(ValueError): learning.rate('other',event,True)
    learning.rate('owner',event,True)
    learning.rate('owner',event,False,'Actually extend it')
    score=learning.report('owner')['scores'][0]
    assert score['ratings']==1 and score['approvals']==0
    assert learning.report('other')['events']==[]


def test_pruning_keeps_cumulative_scores(root):
    learning.set_feedback_retention('u', True)
    for i in range(5):
        event=learning.record('u','p','baseline','interpretation',{'prompt':str(i)})
        learning.rate('u',event,True)
    with learning.connection() as conn:
        learning.prune(conn,budget=1)
    data=learning.report('u')
    assert data['events']==[]
    assert data['scores'][0]['ratings']==5
    assert data['log_bytes']<=1


def test_learning_opt_in_and_promotion_requires_evidence(root):
    learning.preferences('u')
    candidate=learning.add_candidate('u','Respect selected faces','Feedback')
    assert learning.active_rules('u')==('baseline','')
    learning.set_enabled('u',True)
    with learning.connection() as conn:
        conn.execute('INSERT INTO scores VALUES(?,?,?,?,?)',('u','baseline','interpretation',10,100))
        conn.execute('INSERT INTO scores VALUES(?,?,?,?,?)',('u',candidate,'interpretation',9,10))
    learning.evaluate('u')
    assert learning.preferences('u')['active_version']=='baseline'
    with learning.connection() as conn:
        conn.execute('UPDATE scores SET approvals=90,ratings=100 WHERE version=?',(candidate,))
    learning.evaluate('u')
    assert learning.preferences('u')['active_version']==candidate
    learning.set_enabled('u',False)
    assert learning.active_rules('u')==('baseline','')


def test_bad_experiment_is_rejected(root):
    learning.set_enabled('u',True)
    candidate=learning.add_candidate('u','Bad candidate','test')
    with learning.connection() as conn:
        conn.execute('INSERT INTO scores VALUES(?,?,?,?,?)',('u','baseline','interpretation',95,100))
        conn.execute('INSERT INTO scores VALUES(?,?,?,?,?)',('u',candidate,'interpretation',5,100))
    learning.evaluate('u')
    assert learning.preferences('u')['trial_version'] is None
    assert learning.report('u')['versions'][0]['status']=='rejected'


def test_analyze_requires_model_and_filters_invented_reference_ids(root,monkeypatch):
    learning.set_feedback_retention('u', True)
    app=FastAPI();app.include_router(routes.router)
    app.dependency_overrides[get_current_user]=lambda:{'id':'u'}
    monkeypatch.setattr(routes,'project',lambda *a,**k: root)
    from backend.services import cad_service
    monkeypatch.setattr(cad_service,'resolve_existing_project_file',lambda root,name: name if name=='robot.step' else None)
    monkeypatch.setattr(routes,'ai_for',lambda *a: None)
    monkeypatch.setattr(routes,'call_json',lambda *a,**k: ({'summary':'Move bracket','operations':['move'],'targets':['face1','invented'],'questions':[{'question':'How far?'}],'proposed_prompt':'Move selected bracket'},{}))
    client=TestClient(app)
    assert client.post('/api/design-assist/analyze',json={'project_id':'p','prompt':'Move bracket'}).status_code==422
    r=client.post('/api/design-assist/analyze',json={'project_id':'p','prompt':'Move bracket','base_filename':'robot.step','references':[{'id':'face1','type':'face','filename':'robot.step'}]})
    assert r.status_code==200,r.text
    assert r.json()['analysis']['targets']==['face1']
    assert parts.get_workspace(root)['questions'][0]['question']=='How far?'
    assert learning.report('u')['events'][0]['stage']=='interpretation'


def test_feedback_retention_is_separate_and_disabled_by_default(root):
    learning.set_enabled('u', True)
    assert learning.preferences('u')['enabled'] is True
    assert learning.preferences('u')['retain_feedback'] is False
    assert learning.record('u', 'p', 'baseline', 'interpretation', {'prompt': 'private'}) == ''
    assert learning.report('u')['events'] == []
    learning.set_feedback_retention('u', True)
    assert learning.record('u', 'p', 'baseline', 'interpretation', {'prompt': 'retained'})
    assert len(learning.report('u')['events']) == 1


def test_unretained_feedback_is_acknowledged_without_creating_an_event(root, monkeypatch):
    app=FastAPI();app.include_router(routes.router)
    app.dependency_overrides[get_current_user]=lambda:{'id':'u'}
    monkeypatch.setattr(routes,'project',lambda *a,**k: root)
    client=TestClient(app)
    response=client.post('/api/design-assist/feedback', json={
        'event_id':'', 'approve':True, 'project_id':'p', 'comment':'',
    })
    assert response.status_code == 200
    assert response.json() == {'ok': True, 'retained': False}
    assert learning.report('u')['events'] == []
