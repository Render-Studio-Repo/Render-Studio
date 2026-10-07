import json
from backend.services import wiring_models as m


def test_import_binds_exact_product_and_reuses_download(tmp_path,monkeypatch):
    parts=[{'name':'Regulator','category':'electronics','url':'https://vendor.example/product/1','step_url':'https://vendor.example/board.step'}]
    calls=[]
    monkeypatch.setattr(m.parts_workspace,'get_workspace',lambda root:{'parts':parts})
    monkeypatch.setattr(m,'_download',lambda url,path:(calls.append(url),path.write_bytes(b'ISO-10303-21;\nEND-ISO-10303-21;')))
    monkeypatch.setattr(m.cad_service,'schedule_tessellate_step_to_glb',lambda path:False)
    one=m.import_models(tmp_path);two=m.import_models(tmp_path)
    assert len(calls)==1 and one==two
    schematic={'components':[{'id':'a','source_url':parts[0]['url']},{'id':'b','source_url':'https://vendor.example/product/2'}]}
    m.bind_models(tmp_path,schematic)
    assert schematic['components'][0]['sourceFile'].endswith('.step')
    assert 'sourceFile' not in schematic['components'][1]
    assert not m.model_index(tmp_path)['models'][0]['ready']


def test_html_instead_of_step_is_not_imported(tmp_path,monkeypatch):
    monkeypatch.setattr(m.parts_workspace,'get_workspace',lambda root:{'parts':[{'name':'Board','category':'electronics','url':'https://vendor.example/a','step_url':'https://vendor.example/model.step'}]})
    monkeypatch.setattr(m,'_download',lambda url,path:path.write_text('<html>Login</html>'))
    result=m.import_models(tmp_path)
    assert result['failures'] and not result['models']
    assert not list((tmp_path/'electronics-cad').glob('*.step'))


def test_private_download_rejected(tmp_path,monkeypatch):
    import pytest
    monkeypatch.setattr(m,'_is_blocked_host',lambda host:True)
    with pytest.raises(ValueError,match='public HTTPS'):
        m._download('https://127.0.0.1/file.step',tmp_path/'test')
