from pathlib import Path

import pytest

from backend.services import mesh_service


def test_regular_mesh_requires_core_but_not_character_plugin(tmp_path, monkeypatch):
    skill = tmp_path / "img2threejs"
    home = tmp_path / ".img2"
    (skill / "scripts").mkdir(parents=True)
    (home / "harness").mkdir(parents=True)
    (skill / "SKILL.md").write_text("version: 2.0.0\n")
    (skill / "scripts" / "export_glb.mjs").write_text("// fixture\n")
    (home / "harness" / "package.json").write_text('{"version":"0.2.3"}')
    monkeypatch.setattr(mesh_service, "SKILL_DIR", skill)
    monkeypatch.setattr(mesh_service, "IMG2_HOME", home)
    monkeypatch.setattr(mesh_service, "EXPORT_SCRIPT", skill / "scripts" / "export_glb.mjs")

    result = mesh_service.assert_img2threejs_runtime(mesh_beta=False)
    assert set(result) == {"img2threejs", "exporter", "harness"}


def test_beta_mesh_fails_before_generation_when_plugin_source_is_missing(tmp_path, monkeypatch):
    skill = tmp_path / "img2threejs"
    home = tmp_path / ".img2"
    (skill / "scripts").mkdir(parents=True)
    (home / "harness").mkdir(parents=True)
    (skill / "SKILL.md").write_text("version: 2.0.0\n")
    (skill / "scripts" / "export_glb.mjs").write_text("// fixture\n")
    (home / "harness" / "package.json").write_text('{"version":"0.2.3"}')
    monkeypatch.setattr(mesh_service, "SKILL_DIR", skill)
    monkeypatch.setattr(mesh_service, "IMG2_HOME", home)
    monkeypatch.setattr(mesh_service, "EXPORT_SCRIPT", skill / "scripts" / "export_glb.mjs")

    with pytest.raises(RuntimeError, match="Mesh Beta runtime is incomplete.*character plugin"):
        mesh_service.assert_img2threejs_runtime(mesh_beta=True)


def test_live_regular_and_beta_runtime_are_complete():
    regular = mesh_service.assert_img2threejs_runtime(mesh_beta=False)
    beta = mesh_service.assert_img2threejs_runtime(mesh_beta=True)
    assert Path(regular["img2threejs"]).is_file()
    assert Path(beta["character plugin"]).is_file()
