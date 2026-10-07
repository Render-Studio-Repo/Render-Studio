from pathlib import Path

import numpy as np
import pytest
import trimesh

from backend.services import cad_service
from backend.services.cad_preview_parity import StepPreviewFacts, measure_preview_parity


def instanced_boxes(path: Path) -> None:
    scene = trimesh.Scene()
    positive = np.eye(4)
    positive[0, 3] = 100
    negative = np.eye(4)
    negative[0, 3] = -100
    scene.add_geometry(trimesh.creation.box(extents=[10, 20, 30]), geom_name="shared", node_name="positive", transform=positive)
    scene.graph.update(frame_to="negative", matrix=negative, geometry="shared")
    scene.export(path)


def test_polish_keeps_repeated_instances_and_world_transforms(tmp_path):
    path = tmp_path / "instances.glb"
    instanced_boxes(path)
    assert cad_service.polish_generated_cad_glb(path)
    scene = trimesh.load(path, force="scene")
    assert len(scene.graph.nodes_geometry) == 2
    assert len(scene.geometry) == 1
    assert scene.bounds == pytest.approx(np.array([[-105, -10, -15], [105, 10, 15]]))
    assert sorted(scene.graph[node][0][0, 3] for node in scene.graph.nodes_geometry) == [-100, 100]


def test_step_facts_prevent_small_mm_part_rescaling(tmp_path, monkeypatch):
    path = tmp_path / "tiny.glb"
    mesh = trimesh.creation.box(extents=[2, 1, 1])
    mesh.export(path)
    monkeypatch.setattr(cad_service, "import_step_mesh", lambda _: mesh)
    cad_service._match_glb_scale_to_step(tmp_path / "tiny.step", path)
    assert trimesh.load(path, force="scene").extents == pytest.approx([2, 1, 1])


def test_step_preview_rejects_collapsed_candidate_without_replacing_last_good(tmp_path, monkeypatch):
    step = tmp_path / "assembly.step"
    step.write_text("STEP")
    preview = tmp_path / "assembly.glb"
    trimesh.creation.box(extents=[40, 30, 20]).export(preview)
    original = preview.read_bytes()

    def write_flat(_step, destination):
        trimesh.creation.box(extents=[40, 30, 0]).export(destination)

    monkeypatch.setattr(cad_service, "_step_to_glb_xcaf", write_flat)
    monkeypatch.setattr(cad_service, "import_step_mesh", lambda _: trimesh.creation.box(extents=[40, 30, 0]))
    with pytest.raises(ValueError, match="collapsed"):
        cad_service.tessellate_step_to_glb(step, preview, force=True)
    assert preview.read_bytes() == original
    assert not list(tmp_path.glob("*.candidate.glb"))


def test_preview_fingerprint_hashes_middle_content(tmp_path):
    first = tmp_path / "first.step"
    second = tmp_path / "second.step"
    content = bytearray(b"A" * (2 * 1024 * 1024))
    first.write_bytes(content)
    content[1200000] = ord("B")
    second.write_bytes(content)
    assert cad_service._preview_glb_fingerprint(first) != cad_service._preview_glb_fingerprint(second)
    second.write_bytes(first.read_bytes())
    assert cad_service._preview_glb_fingerprint(first) == cad_service._preview_glb_fingerprint(second)


def test_parity_measures_occurrences_not_unique_geometry(tmp_path):
    path = tmp_path / "instances.glb"
    instanced_boxes(path)
    facts = StepPreviewFacts((-105, -10, -15, 105, 10, 15), occurrence_count=2)
    report = measure_preview_parity(path, facts)
    assert report.ok, report.issues
    assert report.occurrence_count == 2
    assert report.bounds_delta == (0, 0, 0, 0, 0, 0)


def test_parity_detects_translation_with_identical_extents(tmp_path):
    path = tmp_path / "translated.glb"
    mesh = trimesh.creation.box(extents=[10, 20, 30])
    mesh.apply_translation([100, 0, 0])
    mesh.export(path)
    report = measure_preview_parity(path, StepPreviewFacts((-5, -10, -15, 5, 10, 15), 1))
    assert not report.ok
    assert report.bounds_delta == (100, 0, 0, 100, 0, 0)


def test_parity_reports_occurrence_mismatch(tmp_path):
    path = tmp_path / "box.glb"
    trimesh.creation.box(extents=[10, 20, 30]).export(path)
    report = measure_preview_parity(path, StepPreviewFacts((-5, -10, -15, 5, 10, 15), 2))
    assert not report.ok
    assert report.issues == ("Expected 2 mesh occurrences, received 1",)


def test_parity_applies_parent_rotation_and_translation(tmp_path):
    path = tmp_path / "nested.glb"
    scene = trimesh.Scene()
    parent = trimesh.transformations.rotation_matrix(np.pi / 2, [0, 0, 1])
    parent[:3, 3] = [100, 50, 20]
    scene.graph.update(frame_to="parent", matrix=parent)
    scene.add_geometry(trimesh.creation.box(extents=[10, 20, 30]), parent_node_name="parent")
    scene.export(path)
    report = measure_preview_parity(path, StepPreviewFacts((90, 45, 5, 110, 55, 35), 1))
    assert report.ok, report.issues
    assert report.bounds == pytest.approx((90, 45, 5, 110, 55, 35))


def test_parity_rejects_unreadable_preview(tmp_path):
    report = measure_preview_parity(tmp_path / "missing.glb", StepPreviewFacts((0, 0, 0, 1, 1, 1)))
    assert not report.ok
    assert report.bounds is None


def test_step_facts_reject_invalid_bounds():
    with pytest.raises(ValueError, match="finite, ordered"):
        StepPreviewFacts((0, 0, 0, float("inf"), 1, 1))
