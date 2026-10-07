from __future__ import annotations

import base64
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import trimesh

from backend.services import freecad_engine, vibecad_codex, vibecad_gates, vibecad_service
from backend.services.vibecad_agent import VibeCADAgent
from backend.services.vibecad_artifact_transaction import preserve_accepted_artifacts


def test_viewport_capture_uses_studio_python_when_cad_runtime_lacks_playwright(tmp_path, monkeypatch):
    glb = tmp_path / "cart.glb"
    glb.write_bytes(b"glTF")
    cad_python = "/opt/cad/bin/python"
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        if command[:2] == [sys.executable, "-c"]:
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        if command[:2] == [cad_python, "-c"]:
            return SimpleNamespace(returncode=1, stdout="", stderr="No module named playwright")
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"ok": True, "files": {"iso": "cart_snapshot_iso.png"}}),
            stderr="",
        )

    monkeypatch.setattr("subprocess.run", run)
    monkeypatch.setattr("backend.services.skill_runner.resolve_cad_python", lambda: cad_python)

    result = vibecad_gates.capture_viewport_views(tmp_path, "cart.glb", "cart")

    assert result == {"ok": True, "files": {"iso": "cart_snapshot_iso.png"}}
    assert calls[-1][0] == sys.executable


def worker_result():
    return {
        "ok": True,
        "runtime_provenance": {"build123d_version": "0.11.1", "ocp_version": "7.9.3.1.1"},
        "outputs": [{"key": "body", "shape": {
            "valid": True, "solid_count": 1, "vertex_count": 8, "face_count": 6,
            "volume_mm3": 600,
            "bounds_mm": {"min": [-5, -10, -1.5], "max": [5, 10, 1.5]},
        }}],
    }


@pytest.mark.parametrize("verdict", [True, False])
def test_visual_gate_receives_final_preview_pixels(tmp_path, monkeypatch, verdict):
    trimesh.creation.box(extents=(10, 20, 3)).export(tmp_path / "cart.glb")
    pixels = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+1cAAAAASUVORK5CYII=")
    (tmp_path / "cart_snapshot_iso.png").write_bytes(pixels)
    monkeypatch.setattr(vibecad_gates, "capture_viewport_views", lambda *args: {
        "ok": True, "files": {"iso": "cart_snapshot_iso.png"}, "up_axis": "z",
    })
    ai = SimpleNamespace(chat_json=Mock(return_value=({"pass": verdict, "repair_note": "Make the opening larger"}, {})))
    decision = vibecad_gates.run_post_publish_visual_gate(
        ai=ai, project_path=tmp_path, prompt="Make a plate", source="result = {}",
        published={"glb": "cart.glb"}, worker_result=worker_result(),
    )
    assert decision["ok"] is verdict
    image = ai.chat_json.call_args.kwargs["images"][0]
    assert base64.b64decode(image["data_url"].split(",", 1)[1]) == pixels
    if verdict:
        assert decision["parity"]["ok"] is True
        assert decision["parity"]["expected"]["occurrence_count"] is None
    else:
        assert decision["repair_note"] == "Make the opening larger"


def test_parity_rejection_prevents_visual_review(tmp_path, monkeypatch):
    mesh = trimesh.creation.box(extents=(10, 20, 3))
    mesh.apply_translation([100, 0, 0])
    mesh.export(tmp_path / "cart.glb")
    ai = SimpleNamespace(chat_json=Mock())
    capture = Mock()
    monkeypatch.setattr(vibecad_gates, "capture_viewport_views", capture)
    decision = vibecad_gates.run_post_publish_visual_gate(
        ai=ai, project_path=tmp_path, prompt="Make a plate", source="result = {}",
        published={"glb": "cart.glb"}, worker_result=worker_result(),
    )
    assert decision["ok"] is False
    assert decision["gate"] == "preview_parity"
    capture.assert_not_called()
    ai.chat_json.assert_not_called()


def test_changed_glb_cannot_reuse_visual_approval(tmp_path, monkeypatch):
    path = tmp_path / "cart.glb"
    trimesh.creation.box(extents=(10, 20, 3)).export(path)
    (tmp_path / "view.png").write_bytes(b"captured view")
    monkeypatch.setattr(vibecad_gates, "capture_viewport_views", lambda *args: {"ok": True, "files": ["view.png"]})

    def review(*args, **kwargs):
        trimesh.creation.box(extents=(1, 1, 1)).export(path)
        return {"pass": True}, {}

    decision = vibecad_gates.run_post_publish_visual_gate(
        ai=SimpleNamespace(chat_json=review), project_path=tmp_path, prompt="Make a plate", source="",
        published={"glb": "cart.glb"}, worker_result=worker_result(),
    )
    assert decision["ok"] is False
    assert decision["error"] == "GLB changed during visual review."


def test_publication_rejects_unpinned_kernel(monkeypatch):
    from backend.services import vibecad_publish_worker

    monkeypatch.setattr(vibecad_publish_worker, "version", lambda name: "0.8.0")
    with pytest.raises(RuntimeError, match="requires build123d 0.11.1"):
        vibecad_publish_worker.publish_geometry({})


@pytest.mark.parametrize("route", ["codex", "oneshot"])
@pytest.mark.parametrize("repair_succeeds", [True, False])
def test_routes_repair_or_restore_accepted_artifacts(tmp_path, monkeypatch, route, repair_succeeds):
    folder = tmp_path / "vibecad"
    folder.mkdir()
    source_name = "vibecad/cart.vibecad.py"
    names = [source_name, "vibecad/cart.vibecad.json", "vibecad/cart.step", "vibecad/cart.glb", "vibecad/cart__part_01_body.glb"]
    originals = {name: f"accepted {name}".encode() for name in names}
    for name, contents in originals.items():
        (tmp_path / name).write_bytes(contents)
    source = "from build123d import *\nresult = {'body': Box(10, 20, 3)}\n"
    program = {"model_name": "Cart", "source": source, "parameters": {}, "expected_outputs": ["body"], "input_objects": {}}

    def author(**kwargs):
        (tmp_path / source_name).write_text(source)
        (folder / "cart.vibecad.json").write_text(json.dumps(program))
        return "Source written", {}

    def publish(*args, **kwargs):
        for name in names:
            (tmp_path / name).write_bytes(b"candidate")
        (folder / "cart__part_02_candidate.glb").write_bytes(b"candidate extra")
        return {"source": source_name, "step": "vibecad/cart.step", "glb": "vibecad/cart.glb"}

    gate = Mock(side_effect=[
        {"ok": False, "repair_note": "Missing mounting holes"},
        {"ok": repair_succeeds, "error": "Still missing mounting holes"},
    ])
    module = vibecad_codex if route == "codex" else vibecad_service
    monkeypatch.setattr(module, "_run_worker", Mock(return_value=worker_result()))
    monkeypatch.setattr(module, "_publish_outputs", publish)
    monkeypatch.setattr(module, "_context_brief", lambda *args, **kwargs: "")
    monkeypatch.setattr(module, "_auto_input_objects", lambda *args, **kwargs: {})
    monkeypatch.setattr("backend.services.project_store.apply_prompt_project_name", Mock())
    monkeypatch.setattr("backend.services.cad_harness.finalize_harness_run", Mock())
    if route == "codex":
        monkeypatch.setattr(vibecad_codex, "run_post_publish_visual_gate", gate)
        monkeypatch.setattr(vibecad_codex, "_write_workspace_docs", Mock())
        monkeypatch.setattr(vibecad_codex, "_host_prompt", lambda **kwargs: kwargs["last_error"])
        monkeypatch.setattr("backend.services.chatgpt_codex_llm.exec_in_workspace", author)
        run = vibecad_codex.run_vibecad_codex_host
    else:
        monkeypatch.setattr(vibecad_gates, "run_post_publish_visual_gate", gate)
        run = vibecad_service._run_vibecad_legacy_oneshot
    ai = SimpleNamespace(model="gpt-6-astra", billing_source="byok", _call_model=Mock(return_value=(json.dumps(program), {})))
    kwargs = dict(previous_source="old model", previous_source_name=source_name, max_repairs=2)
    if repair_succeeds:
        result = run("Make a plate", tmp_path, {"base_filename": "vibecad/cart.glb", "target_mode": "edit"}, ai, **kwargs)
        assert result["attempts"] == 2
        assert result["result"]["text_to_cad"]["visual_gate"]["ok"] is True
        assert result["result"]["text_to_cad"]["runtime_provenance"]["build123d_version"] == "0.11.1"
    else:
        with pytest.raises(RuntimeError, match="Still missing mounting holes"):
            run("Make a plate", tmp_path, {"base_filename": "vibecad/cart.glb", "target_mode": "edit"}, ai, **kwargs)
        for name, contents in originals.items():
            assert (tmp_path / name).read_bytes() == contents
        assert not (folder / "cart__part_02_candidate.glb").exists()
    assert gate.call_count == 2


def test_artifact_rollback_does_not_touch_neighboring_models(tmp_path):
    (tmp_path / "cart.glb").write_bytes(b"accepted")
    (tmp_path / "cartwheel.glb").write_bytes(b"neighbor")
    with pytest.raises(RuntimeError):
        with preserve_accepted_artifacts(tmp_path, tmp_path, "cart"):
            (tmp_path / "cart.glb").write_bytes(b"failed")
            (tmp_path / "cart__part_01.glb").write_bytes(b"failed")
            raise RuntimeError("rejected")
    assert (tmp_path / "cart.glb").read_bytes() == b"accepted"
    assert (tmp_path / "cartwheel.glb").read_bytes() == b"neighbor"
    assert not (tmp_path / "cart__part_01.glb").exists()


def _forced_agent_fixture(tmp_path: Path, engine: str):
    folder = tmp_path / "vibecad"
    folder.mkdir(exist_ok=True)
    source_name = f"vibecad/cart.{'freecad' if engine == 'freecad' else 'vibecad'}.py"
    names = [
        source_name,
        "vibecad/cart.step",
        "vibecad/cart.glb",
        "vibecad/cart.vibecad.json",
        "vibecad/cart.joints.json",
        "vibecad/cart__part_01_body.glb",
        "vibecad/cart_snapshot.png",
    ]
    originals = {name: f"accepted {name}".encode() for name in names}
    for name, contents in originals.items():
        (tmp_path / name).write_bytes(contents)
    agent = VibeCADAgent(
        project_path=tmp_path,
        prompt="Edit the cart",
        context={"base_filename": "vibecad/cart.glb", "target_mode": "edit"},
        ai=SimpleNamespace(model="gpt-6-astra"),
        previous_source="accepted source",
        previous_source_name=source_name,
    )
    return agent, originals


def _write_forced_agent_candidate(tmp_path: Path, originals: dict[str, bytes]) -> None:
    for name in originals:
        (tmp_path / name).write_bytes(b"candidate")
    (tmp_path / "vibecad/cart__part_02_candidate.glb").write_bytes(b"candidate")
    (tmp_path / "vibecad/cart_snapshot_iso.png").write_bytes(b"candidate")


def _run_forced_agent_candidate(
    tmp_path: Path,
    monkeypatch,
    engine: str,
    originals: dict[str, bytes],
    *,
    worker_ok: bool = True,
    publish_raises: bool = False,
    gate: str | None = None,
    gate_raises: bool = False,
):
    source = (
        "result = {'body': Part.makeBox(10, 20, 3)}"
        if engine == "freecad"
        else "from build123d import *\nresult = {'body': Box(10, 20, 3)}"
    )
    args = {
        "model_name": "Cart",
        "source": source,
        "parameters": {},
        "expected_outputs": ["body"],
    }
    published = {
        "source": f"vibecad/cart.{engine}.py",
        "step": "vibecad/cart.step",
        "glb": "vibecad/cart.glb",
        "parts_glb": ["vibecad/cart__part_02_candidate.glb"],
    }

    agent, _ = _forced_agent_fixture(tmp_path, engine)
    monkeypatch.setattr(vibecad_service, "_auto_input_objects", lambda *args, **kwargs: {})
    monkeypatch.setattr(vibecad_service, "_missing_required_project_references", lambda *args: [])
    monkeypatch.setattr(vibecad_service, "_resolve_worker_inputs", lambda *args: {})

    def worker(*args, **kwargs):
        _write_forced_agent_candidate(tmp_path, originals)
        if not worker_ok:
            return {"ok": False, "error": "worker rejected candidate"}
        step = tmp_path / ".candidate-worker.step"
        step.write_bytes(b"worker step")
        return {**worker_result(), "step_path": str(step), "parts": ["body"]}

    def publish(*args, **kwargs):
        _write_forced_agent_candidate(tmp_path, originals)
        if publish_raises:
            raise RuntimeError("publication rejected candidate")
        return dict(published)

    def review(*args):
        if gate_raises:
            raise RuntimeError("visual review crashed")
        if gate:
            return {"ok": False, "gate": gate, "error": f"{gate} rejected candidate"}
        return {"ok": True, "published": published}

    monkeypatch.setattr(agent, "_gate_published", review)
    if engine == "freecad":
        monkeypatch.setattr(freecad_engine, "run_freecad_macro", worker)
        monkeypatch.setattr(agent, "_publish_step", publish)
        return agent._run_freecad_create(args)
    monkeypatch.setattr(vibecad_service, "_run_worker", worker)
    monkeypatch.setattr(vibecad_service, "_publish_outputs", publish)
    return agent._run_build123d_create(args)


@pytest.mark.parametrize("engine", ["build123d", "freecad"])
def test_forced_agent_worker_rejection_restores_accepted_artifacts(tmp_path, monkeypatch, engine):
    _, originals = _forced_agent_fixture(tmp_path, engine)
    result = _run_forced_agent_candidate(
        tmp_path,
        monkeypatch,
        engine,
        originals,
        worker_ok=False,
    )
    assert result["ok"] is False
    for name, contents in originals.items():
        assert (tmp_path / name).read_bytes() == contents
    assert not (tmp_path / "vibecad/cart__part_02_candidate.glb").exists()
    assert not (tmp_path / "vibecad/cart_snapshot_iso.png").exists()


@pytest.mark.parametrize("engine", ["build123d", "freecad"])
@pytest.mark.parametrize("gate", ["motion_joints", "preview_parity", "viewport_snapshot", "visual_review"])
def test_forced_agent_gate_rejection_restores_accepted_artifacts(tmp_path, monkeypatch, engine, gate):
    _, originals = _forced_agent_fixture(tmp_path, engine)
    result = _run_forced_agent_candidate(
        tmp_path,
        monkeypatch,
        engine,
        originals,
        gate=gate,
    )
    assert result == {
        "ok": False,
        "gate": gate,
        "error": f"{gate} rejected candidate",
        "engine": engine,
    }
    for name, contents in originals.items():
        assert (tmp_path / name).read_bytes() == contents
    assert not (tmp_path / "vibecad/cart__part_02_candidate.glb").exists()
    assert not (tmp_path / "vibecad/cart_snapshot_iso.png").exists()


@pytest.mark.parametrize("engine", ["build123d", "freecad"])
def test_forced_agent_publication_exception_restores_accepted_artifacts(tmp_path, monkeypatch, engine):
    _, originals = _forced_agent_fixture(tmp_path, engine)
    with pytest.raises(RuntimeError, match="publication rejected candidate"):
        _run_forced_agent_candidate(
            tmp_path,
            monkeypatch,
            engine,
            originals,
            publish_raises=True,
        )
    for name, contents in originals.items():
        assert (tmp_path / name).read_bytes() == contents
    assert not (tmp_path / "vibecad/cart__part_02_candidate.glb").exists()
    assert not (tmp_path / "vibecad/cart_snapshot_iso.png").exists()


@pytest.mark.parametrize("engine", ["build123d", "freecad"])
def test_forced_agent_visual_exception_restores_accepted_artifacts(tmp_path, monkeypatch, engine):
    _, originals = _forced_agent_fixture(tmp_path, engine)
    with pytest.raises(RuntimeError, match="visual review crashed"):
        _run_forced_agent_candidate(
            tmp_path,
            monkeypatch,
            engine,
            originals,
            gate_raises=True,
        )
    for name, contents in originals.items():
        assert (tmp_path / name).read_bytes() == contents
    assert not (tmp_path / "vibecad/cart__part_02_candidate.glb").exists()
    assert not (tmp_path / "vibecad/cart_snapshot_iso.png").exists()


@pytest.mark.parametrize("engine", ["build123d", "freecad"])
def test_forced_agent_accepted_candidate_keeps_new_artifacts(tmp_path, monkeypatch, engine):
    _, originals = _forced_agent_fixture(tmp_path, engine)
    result = _run_forced_agent_candidate(tmp_path, monkeypatch, engine, originals)
    assert result["ok"] is True
    for name in originals:
        assert (tmp_path / name).read_bytes() == b"candidate"
    assert (tmp_path / "vibecad/cart__part_02_candidate.glb").read_bytes() == b"candidate"
    assert (tmp_path / "vibecad/cart_snapshot_iso.png").read_bytes() == b"candidate"


def test_real_worker_and_publication_use_same_pinned_kernel(tmp_path):
    source = "from build123d import *\nresult = {'ring': Torus(10,2)}\n"
    worker = vibecad_service._run_worker(
        project_path=tmp_path, stem="ring", source=source, parameters={}, expected_outputs=["ring"],
    )
    assert worker["ok"], worker.get("error")
    published = vibecad_service._publish_outputs(tmp_path, "ring", worker)
    runtime = published["publication_runtime_provenance"]
    assert runtime["build123d_version"] == worker["runtime_provenance"]["build123d_version"] == "0.11.1"
    assert runtime["ocp_version"] == worker["runtime_provenance"]["ocp_version"] == "7.9.3.1.1"
    from backend.services.cad_preview_parity import StepPreviewFacts, measure_preview_parity

    report = measure_preview_parity(tmp_path / published["glb"], StepPreviewFacts((-12, -12, -2, 12, 12, 2)))
    assert report.ok, report.issues
