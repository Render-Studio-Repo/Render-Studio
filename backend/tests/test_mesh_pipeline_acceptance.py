import json

import pytest
import trimesh
from PIL import Image

from backend.services import mesh_service as mesh
from backend.services import cad_host_runtime, chatgpt_codex_llm

SOURCE = "export default function createModel(THREE) { return new THREE.Group(); }"


@pytest.fixture
def pipeline(monkeypatch):
    monkeypatch.setattr(mesh, "MESH_PASSES", (("blockout", "Block out"), ("structural-pass", "Structure")))
    monkeypatch.setattr(mesh, "_bootstrap_forge_spec", lambda work, **kw: ({}, work / ".img2threejs/spec.json"))
    monkeypatch.setattr(mesh, "_generate_pass_skeleton", lambda *a: {})
    monkeypatch.setattr(mesh, "_append_pass_review", lambda *a, **kw: None)
    def export(source, glb, **kw):
        glb.write_bytes(trimesh.creation.box().export(file_type="glb"))
        return {"ok": True, "bytes": glb.stat().st_size, "meta": {"runtime": {"node": "test", "three": "test"}}}
    monkeypatch.setattr(mesh, "_run_export", export)
    captures = []
    def snapshot(work, glb, base, **kw):
        assert glb.suffix == ".glb"
        captures.append(glb)
        files = {}
        for view in ("iso", "top", "front"):
            Image.new("RGB", (8, 8), "red").save(work / f"{view}.png")
            files[view] = f"{view}.png"
        return {"files": files, "up_axis": "z"}
    monkeypatch.setattr(mesh, "_run_glb_snapshot", snapshot)
    class AI:
        def __init__(self):
            self.reviews = 0
            self.generations = 0
            self.pass_review = True
        def _call_model(self, *args, **kwargs):
            if kwargs.get("json_response"):
                self.reviews += 1
                assert len(kwargs["images"]) == 3
                assert all("base64," in p["data_url"] for p in kwargs["images"])
                return json.dumps({"pass": self.pass_review, "repair_brief": "fix shape"}), {}
            self.generations += 1
            return SOURCE, {}
    ai = AI()
    def codex(**kwargs):
        ai.generations += 1
        return SOURCE, {}
    monkeypatch.setattr(chatgpt_codex_llm, "exec_in_workspace", codex)
    return ai, captures


@pytest.mark.parametrize("runtime", ["codex_host", "http"])
def test_both_providers_require_review_before_publication(tmp_path, monkeypatch, pipeline, runtime):
    ai, captures = pipeline
    monkeypatch.setattr(cad_host_runtime, "choose_mesh_runtime", lambda *a: runtime)
    result = mesh.run_mesh_img2threejs("box", tmp_path, {}, ai, max_repairs=0)
    assert ai.reviews == (1 if runtime == "codex_host" else 2)
    assert len(captures) == ai.reviews
    assert result["result"]["acceptance"]["review_passed"] is True
    assert (tmp_path / result["primary"]).exists()


@pytest.mark.parametrize("runtime", ["codex_host", "http"])
def test_rejected_review_honors_zero_repair_budget(tmp_path, monkeypatch, pipeline, runtime):
    ai, _ = pipeline
    ai.pass_review = False
    monkeypatch.setattr(cad_host_runtime, "choose_mesh_runtime", lambda *a: runtime)
    with pytest.raises(RuntimeError, match="fix shape"):
        mesh.run_mesh_img2threejs("box", tmp_path, {}, ai, max_repairs=0)
    assert ai.generations == 1
    assert ai.reviews == 1
    assert not list((tmp_path / "mesh").glob("*.glb"))


@pytest.mark.parametrize("runtime", ["codex_host", "http"])
def test_capture_failure_fails_closed(tmp_path, monkeypatch, pipeline, runtime):
    ai, _ = pipeline
    monkeypatch.setattr(cad_host_runtime, "choose_mesh_runtime", lambda *a: runtime)
    monkeypatch.setattr(mesh, "_run_glb_snapshot", lambda *a, **kw: None)
    with pytest.raises(RuntimeError, match="capture failed"):
        mesh.run_mesh_img2threejs("box", tmp_path, {}, ai, max_repairs=0)
    assert ai.reviews == 0
    assert not list((tmp_path / "mesh").glob("*.glb"))
