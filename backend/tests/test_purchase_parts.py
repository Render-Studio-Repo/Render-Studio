import json

import pytest

from backend.services import parts_workspace as parts
from backend.services.purchase_parts import purchase_url


def write_parts(root, rows):
    (root / 'parts_list.json').write_text(json.dumps({'parts': rows}))


def test_tracking_and_product_aliases_keep_variants_separate():
    assert purchase_url('https://smile.amazon.com/battery/gp/product/B0B6FZM9FK/ref=abc?tag=x') == purchase_url('https://www.amazon.com/dp/B0B6FZM9FK?th=1')
    assert purchase_url('https://mcmaster.com/92000a330?utm_source=chat') == 'https://www.mcmaster.com/92000A330/'
    assert purchase_url('https://www.vendor.com/board/?utm_source=chat&variant=2') == 'https://vendor.com/board?variant=2'
    assert purchase_url('https://vendor.com/board?variant=2') != purchase_url('https://vendor.com/board?variant=3')


@pytest.mark.parametrize('url', ['', 'javascript:alert(1)', 'https://vendor.com', 'https://vendor.com/products/',
    'https://vendor.com/spec.pdf', 'https://docs.vendor.com/board', 'https://vendor.com/search?q=board',
    'https://github.com/vendor/robot', 'https://vendor.com:invalid/part'])
def test_non_purchase_sources_are_excluded(url):
    assert purchase_url(url) == ''


def test_existing_cart_and_every_import_deduplicate_without_inflating_quantity(tmp_path):
    url = 'https://www.mcmaster.com/92000A330/'
    saved = parts.clean_part({'id': 'hardware-total', 'name': 'M5 screw', 'qty': 16, 'url': url,
                             'category': 'mcmaster', 'mounting': {'edit_target': {'model_filename': 'robot.step'}}})
    legacy = tmp_path / 'Parts List'; legacy.mkdir()
    (legacy / 'index.json').write_text(json.dumps({'parts': [saved, {'id': 'junk', 'url': ''}],
        'proposals': [], 'changes': [], 'questions': [], 'revision': 1}))
    write_parts(tmp_path, [{'id': f'screw-{i}', 'qty': 1, 'url': url} for i in range(16)] +
        [{'id': 'board', 'url': 'https://vendor.com/board?utm_source=prompt', 'docs': [
            {'url': 'https://vendor.com/spec.pdf'}, {'url': 'https://vendor.com/board'}]}])
    (tmp_path / 'wiring.json').write_text(json.dumps({'components': [{'id': 'board-wire', 'source_url': 'https://www.vendor.com/board/'}],
        'wires': [{'id': 'wire1', 'from': 'board.1', 'to': 'motor.1'}]}))
    data = parts.get_workspace(tmp_path)
    assert len(data['parts']) == 2
    assert data['parts'][0]['id'] == 'hardware-total'
    assert data['parts'][0]['qty'] == 16  # Not 32 (aggregate + each mesh).
    assert len(data['parts'][0]['source_ids']) == 17
    assert data['parts'][0]['mounting']['edit_target']['model_filename'] == 'robot.step'
    assert data['parts'][1]['docs'][0]['url'].endswith('spec.pdf')
    assert len(data['parts'][1]['docs']) == 1  # Don't repeat the buy link as "Source".
    assert parts.get_workspace(tmp_path)['revision'] == data['revision']
    assert json.loads((legacy / 'summary.json').read_text())['total'] == 2


def test_replacement_does_not_resurrect_duplicate_aliases_or_new_manifest_ids(tmp_path):
    old = 'https://vendor.com/old'
    write_parts(tmp_path, [{'id': 'board', 'url': old}, {'id': 'board-pcb', 'url': old}])
    data = parts.store_proposals(tmp_path, [{'name': 'New board', 'url': 'https://vendor.com/new', 'replaces': 'board'}])
    parts.decide(tmp_path, data['proposals'][0]['id'], True)
    write_parts(tmp_path, [{'id': 'newly-renamed-old-board', 'url': old + '?utm_source=regeneration'}])
    assert [p['url'] for p in parts.get_workspace(tmp_path)['parts']] == ['https://vendor.com/new']


def test_repeat_add_and_approved_addition_cannot_duplicate_product(tmp_path):
    assert parts.add_link(tmp_path, {'name': 'Board', 'url': 'https://vendor.com/board'})['added']
    assert not parts.add_link(tmp_path, {'name': 'Board', 'url': 'https://www.vendor.com/board/?utm_source=chat'})['added']
    data = parts.store_proposals(tmp_path, [{'name': 'Board again', 'url': 'https://vendor.com/board'}])
    assert len(parts.decide(tmp_path, data['proposals'][0]['id'], True)['parts']) == 1
    assert len(parts.store_proposals(tmp_path, [{'name': 'Unsourced'}])['proposals']) == 1
    with pytest.raises(ValueError):
        parts.add_link(tmp_path, {'url': 'https://vendor.com/spec.pdf'})


def test_reference_assembly_exclusion_survives_reimport_and_keeps_questions(tmp_path):
    url = 'https://vendor.com/reference-robot'
    write_parts(tmp_path, [{'id': 'wheel', 'url': url}, {'id': 'sensor', 'url': 'https://vendor.com/sensor'},
                           {'id': 'custom', 'category': 'custom_metal', 'url': 'https://vendor.com/plate'}])
    data = parts.get_workspace(tmp_path)
    data['excluded_purchase_urls'] = [url]
    data['questions'] = [{'id': 'source-wheels', 'question': 'Source wheel products?', 'answer': 'Keep existing design'}]
    parts._save(tmp_path, data)
    refreshed = parts.get_workspace(tmp_path)
    assert [p['id'] for p in refreshed['parts']] == ['sensor']
    assert refreshed['questions'][0]['answer'] == 'Keep existing design'
    with pytest.raises(ValueError, match='reference'):
        parts.add_link(tmp_path, {'url': url})
    assert parts.store_proposals(tmp_path, [{'url': url}])['proposals'] == []


def test_catalog_import_reuses_existing_purchase_model(tmp_path, monkeypatch):
    from backend.services import parts_sourcing as sourcing
    model = tmp_path / 'already.step'; model.write_text('ISO-10303-21;')
    parts.add_link(tmp_path, {'id': 'user-board', 'url': 'https://vendor.com/board', 'model_filename': model.name})
    monkeypatch.setattr(sourcing, 'search', lambda query: {'sources': [
        {'id': 'catalog-board', 'url': 'https://www.vendor.com/board/', 'step_url': 'https://catalog.com/board.step'}]})
    monkeypatch.setattr(sourcing.catalog, 'download_asset', lambda *a, **k: pytest.fail('must reuse existing STEP'))
    result = sourcing.import_for_agent(tmp_path, 'board', 'catalog-board')
    assert result['cached'] and result['filename'] == model.name
    assert len(parts.get_workspace(tmp_path)['parts']) == 1
