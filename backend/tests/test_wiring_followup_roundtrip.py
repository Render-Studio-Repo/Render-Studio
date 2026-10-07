import json
from types import SimpleNamespace
from backend import main


def test_save_roundtrip_preserves_questions_and_original_references(tmp_path, monkeypatch):
    monkeypatch.setattr(main, '_require_project', lambda *args: tmp_path)
    monkeypatch.setattr(main, '_notify_project', lambda *args: None)
    value={'name':'Needs power','components':[],'wires':[], 'blocker':{'reason':'Need logic supply'}, 'followup_questions':[{'id':'power','question':'Which supply?'}], 'continuation':{'prompt':'Wire my motor','driver_links':['https://www.amazon.com/dp/B0C591QLNR'],'references':[{'filename':'pinout.md'}]}}
    saved=main.save_wiring('test',main.WiringSaveRequest.model_validate(value),{'display_name':'Test'})
    assert saved['followup_questions']==value['followup_questions']
    assert saved['continuation']==value['continuation']
    assert json.loads((tmp_path/'wiring.json').read_text())['blocker']==value['blocker']


def test_generation_keeps_explicit_links_first_and_partial_result_not_success(tmp_path, monkeypatch):
    from backend.services import wiring_service
    project=tmp_path/'test';project.mkdir()
    monkeypatch.setattr(main,'PROJECTS',tmp_path)
    monkeypatch.setattr(main,'_get_ai_for_wiring',lambda *a,**k:object())
    monkeypatch.setattr(main,'_load_wiring_reference_documents',lambda *a:' '.join(f'https://example.com/doc{i}' for i in range(12)))
    monkeypatch.setattr(main,'_notify_project',lambda *a,**k:None)
    monkeypatch.setattr(main,'trace_add',lambda *a,**k:None)
    calls={}
    def generate(ai,prompt,**kwargs):
        calls['prompt']=prompt;calls['links']=kwargs['driver_links']
        return {'components':[],'wires':[],'blocker':{'reason':'Need board supply'},'followup_questions':[]},{},'Need board supply'
    monkeypatch.setattr(wiring_service,'generate_wiring_schematic',generate)
    monkeypatch.setattr(main.generation_service,'is_canceled',lambda *a:False)
    completions=[];monkeypatch.setattr(main.generation_service,'complete',lambda *a,**k:completions.append(a[1]))
    def history(*a,**kwargs):calls['history']=kwargs;return {'id':'history'}
    monkeypatch.setattr(main,'_save_wiring_prompt_history',history)
    body={'prompt':'Wire the project','driver_links':['https://www.amazon.com/dp/B0C591QLNR'],'references':[{'filename':'pinout.md'}],'answers':[{'id':'supply','answer':'48V 25A'}]}
    main._background_wiring_prompt('test',body,'trace',{'display_name':'Test','id':'test'})
    assert calls['links'][0].endswith('B0C591QLNR')
    assert '48V 25A' in calls['prompt']
    assert calls['history']['success'] is False
    assert len(completions)==1 and completions[0]['needs_input']
    saved=json.loads((project/'wiring.json').read_text())
    assert saved['continuation']['references']==body['references']
