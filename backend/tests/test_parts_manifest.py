import json
from pathlib import Path
from unittest.mock import patch

from backend.services import parts_workspace as parts, parts_sourcing as sourcing


def test_recovers_draft_electronics_and_wiring_once(tmp_path):
    folder=tmp_path/'vibecad';folder.mkdir()
    manifest=folder/'robot.vibecad.json'
    manifest.write_text(json.dumps({'parts_list':{'parts':[
        {'id':'controller','name':'Control board','category':'electronics','url':'https://example.com/board','model_filename':'planned.step'},
        {'id':'wire','name':'Wire','category':'wiring'}, {'id':'bracket','name':'Steel bracket','category':'custom_metal'}],
        'questions':[{'question':'Exact board model?'}]}}))
    first=parts.get_workspace(tmp_path)
    assert first['parts'][0]['provenance']['status']=='draft'
    assert first['parts'][0]['model_filename']==''
    assert [p['category'] for p in first['parts']]==['electronics']
    assert parts.get_workspace(tmp_path)['revision']==first['revision']
    assert len(parts.reference_entries(tmp_path))==3
    # Successful publication updates status without losing answered questions.
    parts.save_questions(tmp_path,[{'id':first['questions'][0]['id'],'answer':'Verified model'}])
    (folder/'robot.step').write_text('published')
    updated=parts.get_workspace(tmp_path)
    assert updated['parts'][0]['provenance']['status']=='generated'
    assert updated['questions'][0]['answer']=='Verified model'


def test_replaced_import_cannot_resurrect_on_manifest_revision(tmp_path):
    folder=tmp_path/'vibecad';folder.mkdir();manifest=folder/'robot.vibecad.json'
    payload={'parts_list':{'parts':[{'id':'old','name':'Old board','category':'electronics','url':'https://example.com/old-board'}]}}
    manifest.write_text(json.dumps(payload));parts.get_workspace(tmp_path)
    data=parts.store_proposals(tmp_path,[{'name':'New board','replaces':'old','url':'https://example.com/new-board'}])
    parts.decide(tmp_path,data['proposals'][0]['id'],True)
    payload['updated']=True;manifest.write_text(json.dumps(payload))
    assert [p['name'] for p in parts.get_workspace(tmp_path)['parts']]==['New board']


def test_catalog_first_cache_and_real_links():
    sourcing._CACHE.clear()
    class Response:
        def raise_for_status(self):pass
        def json(self):return {'items':[{'id':'board','name':'Board','pageUrl':'https://step.parts/board','stepUrl':'https://step.parts/board.step'}]}
    with patch.object(sourcing.httpx,'get',return_value=Response()) as fetch, patch.object(parts,'search_parts') as fallback:
        first=sourcing.search('Board',fallback=True)
        second=sourcing.search('Board',fallback=True)
        assert first==second;fetch.assert_called_once();fallback.assert_not_called()
        assert first['sources'][0]['step_url']=='https://step.parts/board.step'
        assert first['sources'][0]['docs'][0]['label']!='Datasheet'


def test_short_edit_does_not_trigger_catalog_retrieval():
    with patch.object(sourcing,'search') as search:
        assert sourcing.improve_context('Shorten the selected face by 2 mm')==''
        search.assert_not_called()
    assert sourcing.prompt_queries('Replace an Arduino Nano with a Raspberry Pi 5')==['Raspberry Pi 5','Arduino Nano']


def test_catalog_agent_import_is_source_bound_and_reused(tmp_path):
    from backend.services import cad_service
    row={'id':'board','name':'Board','url':'https://example.com/board','catalog_url':'https://step.parts/board',
         'step_url':'https://step.parts/board.step','docs':[{'label':'Schematic','url':'https://example.com/schematic.pdf'}]}
    def download(url, dest, **kwargs):
        assert url==row['step_url'];dest.write_text('ISO-10303-21; test fixture')
    with patch.object(sourcing,'search',return_value={'sources':[row]}), patch.object(sourcing.catalog,'download_asset',side_effect=download) as get, patch.object(cad_service,'schedule_tessellate_step_to_glb'):
        import pytest
        with pytest.raises(ValueError):sourcing.import_for_agent(tmp_path,'board','not-returned')
        result=sourcing.import_for_agent(tmp_path,'board','board')
        assert (tmp_path/result['filename']).is_file()
        assert sourcing.import_for_agent(tmp_path,'board','board')['cached']
        get.assert_called_once()
        assert parts.get_workspace(tmp_path)['parts'][0]['docs']==row['docs']
    assert sourcing.source_documents({'pageUrl':'https://example.com'})==[]
    assert sourcing.source_documents({'schematicUrl':'https://example.com/s.pdf'})[0]['label']=='Schematic'


def test_failed_generation_publishes_recoverable_list_without_model(tmp_path):
    from backend.services import generation_service as jobs
    folder=tmp_path/'vibecad';folder.mkdir()
    (folder/'failed.vibecad.json').write_text(json.dumps({'parts_list':{'parts':[{'id':'driver','name':'Motor driver','category':'electronics','url':'https://example.com/driver'}]}}))
    with patch.object(jobs,'is_canceled',return_value=False), patch.object(jobs,'_update_job',return_value={'status':'failed'}):
        assert jobs.fail(tmp_path,'kernel failed',trace_id='test')['status']=='failed'
    assert parts.reference_entries(tmp_path)
    assert parts.get_workspace(tmp_path)['parts'][0]['provenance']['status']=='draft'
    assert not (folder/'failed.glb').exists()
