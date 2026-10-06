import json
from pathlib import Path

import pytest
import trimesh

from backend.services.mesh_acceptance import candidate_manifest
from backend.services.mesh_artifact_transaction import run_isolated


def accepted(prompt, work, context, ai, **kwargs):
    (work / "mesh").mkdir()
    source, glb = work / "mesh/part.mesh.mjs", work / "mesh/part.glb"
    source.write_text("new source")
    glb.write_bytes(trimesh.creation.box().export(file_type="glb"))
    manifest = candidate_manifest(source, glb, run_id=work.name, runtime={})
    manifest["review_passed"] = True
    (work / "mesh-acceptance.json").write_text(json.dumps(manifest))
    return {"result": {"files": {"source": "mesh/part.mesh.mjs", "glb": "mesh/part.glb"}}}


@pytest.mark.parametrize("failure", ["reject", "cancel", "mutation"])
def test_failure_keeps_accepted_source_and_glb(tmp_path, failure):
    (tmp_path / "mesh").mkdir()
    source, glb = tmp_path / "mesh/part.mesh.mjs", tmp_path / "mesh/part.glb"
    source.write_text("accepted source")
    glb.write_bytes(b"accepted glb")
    def generate(*args, **kwargs):
        result = accepted(*args, **kwargs)
        work = args[1]
        if failure == "reject":
            raise RuntimeError("review rejected")
        if failure == "mutation":
            (work / "mesh/part.mesh.mjs").write_text("mutated")
        return result
    with pytest.raises((RuntimeError, ValueError)):
        run_isolated(generate, "box", tmp_path, {}, None, cancel_check=lambda: failure == "cancel")
    assert source.read_text() == "accepted source"
    assert glb.read_bytes() == b"accepted glb"
    assert list((tmp_path / ".mesh-runs").glob("run-*")) == []


def test_source_and_glb_roll_back_if_second_promotion_fails(tmp_path, monkeypatch):
    import backend.services.mesh_artifact_transaction as transaction
    (tmp_path / "mesh").mkdir()
    source, glb = tmp_path / "mesh/part.mesh.mjs", tmp_path / "mesh/part.glb"
    source.write_text("accepted source")
    glb.write_bytes(b"accepted glb")
    replace = transaction.os.replace
    def fail_second(src, dst):
        if Path(src).name == "promotion-1":
            raise OSError("disk full")
        replace(src, dst)
    monkeypatch.setattr(transaction.os, "replace", fail_second)
    with pytest.raises(OSError):
        run_isolated(accepted, "box", tmp_path, {}, None)
    assert source.read_text() == "accepted source"
    assert glb.read_bytes() == b"accepted glb"


def test_success_promotes_matching_pair_and_manifest(tmp_path):
    result = run_isolated(accepted, "box", tmp_path, {}, None)
    assert (tmp_path / result["result"]["source"]).read_text() == "new source"
    assert (tmp_path / result["primary"]).is_file()
    assert (tmp_path / "mesh/part.glb.acceptance.json").is_file()


def test_live_draft_is_separate_and_removed_after_failure(tmp_path):
    events = []
    def progress(event):
        events.append(event)
        if event.get("preview_filename"):
            assert (tmp_path / event["preview_filename"]).read_bytes() == b"draft"
    def generate(prompt, work, context, ai, **kwargs):
        (work / "mesh").mkdir()
        (work / "mesh/part.glb").write_bytes(b"draft")
        kwargs["progress_callback"]({"preview_filename": "mesh/part.glb"})
        kwargs["progress_callback"]({"stage": "done"})
        raise RuntimeError("rejected")
    with pytest.raises(RuntimeError):
        run_isolated(generate, "box", tmp_path, {}, None, progress_callback=progress)
    assert len(events) == 1
    assert ".generation-live.glb" in events[0]["preview_filename"]
    assert not list((tmp_path / "mesh").glob("*.glb"))


def test_concurrent_edit_is_not_overwritten(tmp_path):
    (tmp_path / "mesh").mkdir()
    source = tmp_path / "mesh/part.mesh.mjs"
    source.write_text("original")
    def generate(*args, **kwargs):
        result = accepted(*args, **kwargs)
        source.write_text("concurrent user edit")
        return result
    with pytest.raises(RuntimeError, match="changed during generation"):
        run_isolated(generate, "box", tmp_path, {}, None)
    assert source.read_text() == "concurrent user edit"


def test_legacy_root_edit_preserves_output_location(tmp_path):
    (tmp_path / "part.mesh.mjs").write_text("old")
    result = run_isolated(accepted, "box", tmp_path, {"base_filename": "part.glb"}, None,
                          previous_source_name="part.mesh.mjs")
    assert result["primary"] == "part.glb"
    assert (tmp_path / "part.mesh.mjs").read_text() == "new source"
