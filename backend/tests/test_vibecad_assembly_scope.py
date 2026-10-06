import json
from pathlib import Path

import pytest

from backend.services import vibecad_service as service
from backend.services import cad_service
from backend.services.vibecad_codex import _program_from_workspace, _write_workspace_docs


def test_explicit_unpublished_assembly_is_rejected(tmp_path):
    (tmp_path / 'base.vibecad.py').write_text("result = {'tray': tray}\n")
    (tmp_path / 'base.vibecad.json').write_text(json.dumps({
        'expected_outputs': ['tray'],
        'assembly': {'variable': 'assembly', 'host_support_required': True},
        'result_scope': 'Printed parts only; host must publish the complete assembly.',
    }))
    with pytest.raises(ValueError, match='assembly is outside result'):
        _program_from_workspace(tmp_path, stem='base', source_name='base.vibecad.py', last_message='done')


def test_workspace_does_not_replace_steel_assembly_with_printed_subset(tmp_path):
    _write_workspace_docs(tmp_path, 'base.vibecad.py', 'base')
    text = (tmp_path / 'VIBECAD.md').read_text()
    assert '8–40' not in text
    assert 'independently editable **printed** parts' not in text
    assert 'metal,' in text and 'electronics' in text
    assert 'ONLY published geometry' in text


@pytest.mark.parametrize('catalog_parts', [True, False])
def test_improve_preserves_complete_assembly_after_printer_overlay(monkeypatch, catalog_parts):
    from types import SimpleNamespace
    from backend import main
    from backend.services import context_lab_service, prompt_learning
    from backend.services.cad_assembly_contract import CAD_ASSEMBLY_SCOPE_RULES

    calls = []
    class FakeAI:
        def _call_model(self, system, prompt, **kwargs):
            calls.append((system, prompt))
            # Exercise the plain-text retry as well as the primary Improve request.
            return ('{}' if len(calls) == 1 else 'Complete steel robot base with battery, four mecanum wheels, motors and electronics.'), {}

    monkeypatch.setattr(main, '_get_ai_for_user', lambda *a, **kw: FakeAI())
    monkeypatch.setattr(main, '_allow_chatgpt_subscription_for_body', lambda body: False)
    monkeypatch.setattr(prompt_learning, 'active_rules', lambda user_id: ('test', ''))
    monkeypatch.setattr(context_lab_service, 'improve_context', lambda *a, **kw: {'block': 'FDM split-to-fit plate is enabled.'})
    original = 'Complete omnidirectional robot base: steel L frame, few parts, 24V 50Ah LiFePO4 Group24 battery, OpenArm 2.0 mount and all electronics @amazon-B0B6FZM9FK-r9k8cp'
    body = main.ImprovePromptRequest(prompt=original, mode='vibecad', use_mcmaster_parts=catalog_parts)
    result = main.improve_cad_prompt(body, SimpleNamespace(state=SimpleNamespace(trace_id='assembly-regression')), {'id': 'test-user'})
    assert result['prompt'] == original
    assert len(calls) == 2
    for system, prompt in calls:
        assert CAD_ASSEMBLY_SCOPE_RULES in system
        assert original in prompt
        assert prompt.index('FDM split-to-fit') < prompt.index('Preserve the scope of the original request')
        assert 'custom solids only' not in system


def test_failed_worker_with_partial_step_remains_failed(tmp_path, monkeypatch):
    worker = tmp_path / 'fake_worker.py'
    worker.write_text('''import json, sys
from pathlib import Path
request=json.loads(Path(sys.argv[1]).read_text())
Path(request['output_directory'], '000.step').write_text('partial geometry')
Path(sys.argv[2]).write_text(json.dumps({'ok':False,'error':'second part export failed'}))
sys.exit(1)
''')
    monkeypatch.setattr(service, '_worker_path', lambda: worker)
    result = service._run_worker(project_path=tmp_path, stem='base', source='result={}', parameters={}, expected_outputs=['frame','battery'], timeout_sec=10)
    assert result['ok'] is False
    assert not result.get('recovered')


def test_missing_output_cannot_replace_existing_model(tmp_path):
    primary = tmp_path / 'vibecad' / 'base.step'
    primary.parent.mkdir(); primary.write_text('previous complete assembly')
    available = tmp_path / 'frame.step'; available.write_text('partial')
    with pytest.raises(RuntimeError, match='missing output'):
        service._publish_outputs(tmp_path, 'base', {'ok':True,'outputs':[
            {'key':'frame','step_path':str(available)},
            {'key':'battery','step_path':str(tmp_path/'missing.step')},
        ]})
    assert primary.read_text() == 'previous complete assembly'


def test_large_assembly_keeps_hardware_and_named_components(tmp_path):
    from build123d import import_step
    keys = [f'frame_member_{i}' for i in range(25)] + ['hardware_screw']
    source = "from build123d import *\nresult={}\n"
    for index, key in enumerate(keys):
        source += f"result[{key!r}]=Pos({index*3},0,0)*Box(1,1,1)\n"
    result = service._run_worker(project_path=tmp_path, stem='base', source=source, parameters={}, expected_outputs=keys, timeout_sec=45)
    assert result['ok'], result.get('error')
    assert result['outputs'][0]['source_keys'] == keys
    path = Path(result['outputs'][0]['step_path'])
    shape = import_step(str(path))
    assert len(shape.solids()) == len(keys)
    assert shape.volume == pytest.approx(26)
    assert 'hardware_screw' in path.read_text()


def test_assembly_export_failure_never_falls_back_to_first_part(tmp_path, monkeypatch):
    import build123d
    from backend.services import vibecad_publish_worker
    outputs=[]
    for index in range(2):
        path=tmp_path/f'part{index}.step'
        build123d.export_step(build123d.Pos(index*3,0,0)*build123d.Box(1,1,1), str(path))
        outputs.append({'key':f'Part_{index+1}','step_path':str(path)})
    primary=tmp_path/'vibecad'/'base.step'
    primary.parent.mkdir();primary.write_text('previous complete assembly')
    def fail(*args, **kwargs): raise RuntimeError('compound transfer failed')
    monkeypatch.setattr(build123d, 'export_step', fail)
    monkeypatch.setattr(vibecad_publish_worker, 'version', lambda name: {'build123d':'0.11.1','cadquery-ocp':'7.9.3.1.1'}[name])
    monkeypatch.setattr(vibecad_publish_worker, 'publish_with_pinned_runtime', vibecad_publish_worker.publish_geometry)
    with pytest.raises(RuntimeError, match='compound transfer failed'):
        service._publish_outputs(tmp_path, 'base', {'ok':True,'outputs':outputs})
    assert primary.read_text() == 'previous complete assembly'


def test_republishing_assembly_replaces_cached_preview(tmp_path):
    import build123d
    import trimesh

    output = tmp_path / 'compiled.step'
    build123d.export_step(build123d.Box(20, 30, 40), str(output))
    preview = tmp_path / 'vibecad' / 'base.glb'
    preview.parent.mkdir()
    trimesh.creation.box(extents=[1, 1, 1]).export(preview)
    service._publish_outputs(tmp_path, 'base', {'ok': True, 'outputs': [
        {'key': 'assembly', 'step_path': str(output)},
    ]})
    scene = trimesh.load(str(preview), force='scene')
    assert scene.extents == pytest.approx([20, 30, 40], abs=0.1)


def test_publish_accepts_overlapping_assembly_with_valid_leaf_solids(tmp_path):
    import build123d

    source = tmp_path / "overlap.step"
    assembly = build123d.Compound(
        children=[build123d.Box(10, 10, 10), build123d.Box(10, 10, 10)]
    )
    build123d.export_step(assembly, str(source))

    published = service._publish_outputs(
        tmp_path,
        "overlap",
        {
            "ok": True,
            "outputs": [
                {
                    "key": "assembly",
                    "step_path": str(source),
                    "source_keys": ["left", "right"],
                }
            ],
        },
    )

    assert (tmp_path / published["step"]).is_file()


def test_open_shell_cannot_replace_existing_assembly(tmp_path):
    from build123d import Face, Shell, export_step
    primary = tmp_path / 'vibecad' / 'base.step'
    primary.parent.mkdir()
    primary.write_text('previous complete assembly')
    source = tmp_path / 'open-shell.step'
    export_step(Shell(Face.make_rect(10, 10)), str(source))
    with pytest.raises(RuntimeError, match='STEP round-trip validation failed'):
        service._publish_outputs(tmp_path, 'base', {'ok': True, 'outputs': [
            {'key': 'base', 'step_path': str(source)},
        ]})
    assert primary.read_text() == 'previous complete assembly'
