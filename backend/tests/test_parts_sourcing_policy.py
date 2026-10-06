"""CAD sourcing order and metadata survive real harness tool dispatch."""
import json
from pathlib import Path
from unittest.mock import patch

from backend.services import parts_sourcing as sourcing, parts_workspace as parts
from backend.services.parts_sourcing_policy import PARTS_SOURCING_RULES


def test_policy_is_in_shared_packet_and_improve_without_network(tmp_path):
    from backend.services.cad_harness import format_context_packet
    from backend.services.vibecad_service import _context_brief
    with patch.object(sourcing, 'search') as lookup:
        for text in (format_context_packet({}, tmp_path, prompt='motor mount'),
                     _context_brief({}, tmp_path, prompt='motor mount'),
                     sourcing.improve_context('Mount a Raspberry Pi 5')):
            assert PARTS_SOURCING_RULES in text
            assert text.index('official STEP') < text.index('SECOND')
        lookup.assert_not_called()


def test_jake_catalog_tools_execute_in_assigned_project(tmp_path):
    from backend.services.jake_tool_agent import JakeToolAgent, AGENT_TOOLS
    agent = JakeToolAgent.__new__(JakeToolAgent)
    agent.project_path = tmp_path
    agent._raise_if_canceled = lambda: None
    names = {t['function']['name'] for t in AGENT_TOOLS}
    assert {'search_parts_catalog', 'import_catalog_part'} <= names
    with patch.object(sourcing, 'search', return_value={'sources': [{'id': 'board'}]}) as lookup:
        assert json.loads(agent._exec_tool('search_parts_catalog', {'query': 'board'}))['sources'][0]['id'] == 'board'
        lookup.assert_called_once_with('board', fallback=False)
    with patch.object(sourcing, 'import_for_agent', return_value={'filename': 'board.step'}) as download:
        assert json.loads(agent._exec_tool('import_catalog_part', {'query': 'board', 'source_id': 'board'}))['filename'] == 'board.step'
        download.assert_called_once_with(tmp_path, 'board', 'board')


def test_existing_purchase_keeps_docs_quantity_and_mounts(tmp_path, monkeypatch):
    row = {'id': 'board', 'name': 'Board', 'url': 'https://vendor.com/board',
           'step_url': 'https://step.parts/board.step', 'catalog_url': 'https://step.parts/board',
           'docs': [{'label': 'Datasheet', 'url': 'https://vendor.com/board.pdf'}]}
    parts.add_link(tmp_path, {'id': 'mine', 'url': row['url'], 'qty': 4,
                             'mounting': {'units': 'mm'}, 'model_filename': 'board.step'})
    (tmp_path/'board.step').write_text('ISO-10303-21;')
    monkeypatch.setattr(sourcing, 'search', lambda q: {'sources': [row]})
    with patch.object(sourcing.catalog, 'download_asset') as download:
        result = sourcing.import_for_agent(tmp_path, 'board', 'board')
        download.assert_not_called()
    saved = parts.get_workspace(tmp_path)['parts']
    assert result['cached'] and len(saved) == 1
    assert saved[0]['id'] == 'mine' and saved[0]['qty'] == 4
    assert saved[0]['mounting'] == {'units': 'mm'}
    assert saved[0]['docs'] == row['docs']


def test_document_aliases_are_preserved_and_deduplicated():
    docs = sourcing.source_documents({'datasheet_url': 'https://vendor.com/data.pdf',
        'attributes': {'schematicUrl': 'https://vendor.com/schematic.pdf'},
        'docs': [{'label': 'Data', 'url': 'https://vendor.com/data.pdf'}]})
    assert len(docs) == 2
    assert {d['label'] for d in docs} == {'Datasheet', 'Schematic'}
    assert sourcing.source_documents({'pageUrl': 'https://step.parts/board'}) == []


def test_cad_only_import_keeps_profile_without_inventing_purchase(tmp_path, monkeypatch):
    from backend.services import cad_service
    row = {'id':'cad-only', 'name':'Board', 'url':'https://step.parts/board', 'purchase_url':'',
           'catalog_url':'https://step.parts/board', 'step_url':'https://step.parts/board.step',
           'docs':[{'label':'Datasheet','url':'https://vendor.com/board.pdf'}]}
    monkeypatch.setattr(sourcing, 'search', lambda q: {'sources':[row]})
    monkeypatch.setattr(cad_service, 'schedule_tessellate_step_to_glb', lambda *args: None)
    with patch.object(sourcing.catalog, 'download_asset', side_effect=lambda url, dest, **kw: dest.write_text('ISO-10303-21;')) as download:
        result = sourcing.import_for_agent(tmp_path, 'board', 'cad-only')
        assert sourcing.import_for_agent(tmp_path, 'board', 'cad-only')['cached']
        download.assert_called_once()
    profile = sourcing.catalog.load_all(tmp_path)[Path(result['filename']).stem]
    assert profile['source']['docs'] == row['docs']
    assert parts.get_workspace(tmp_path)['parts'] == []
    assert parts.get_workspace(tmp_path)['questions']
