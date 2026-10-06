"""NEW CAD generates should mate to a selected/dropped STEP, not rebuild it."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from backend.services.cad_harness import format_context_packet
from backend.services.vibecad_service import (
    _auto_input_objects,
    _missing_required_project_references,
)


def test_auto_input_objects_new_uses_reference_object(tmp_path: Path):
    (tmp_path / "8020-1020.step").write_text("ISO-10303-21;", encoding="utf-8")
    mapping = _auto_input_objects(
        tmp_path,
        {
            "target_mode": "new",
            "cad_files": [{"filename": "8020-1020.glb", "step": "8020-1020.step"}],
            "refs": [
                {
                    "type": "component",
                    "token": "@selected-object",
                    "filename": "8020-1020.glb",
                    "mate_target": True,
                }
            ],
        },
    )
    assert mapping.get("reference_object") == "8020-1020.step"
    assert "selected_object" not in mapping


def test_auto_input_objects_edit_keeps_selected_object(tmp_path: Path):
    (tmp_path / "bracket.step").write_text("ISO-10303-21;", encoding="utf-8")
    mapping = _auto_input_objects(
        tmp_path,
        {
            "target_mode": "edit",
            "base_filename": "bracket.glb",
            "refs": [{"type": "component", "filename": "bracket.glb", "token": "@selected-object"}],
        },
    )
    assert mapping.get("selected_object") == "bracket.step"
    assert "reference_object" not in mapping


def test_auto_input_objects_matches_verified_project_step_to_prompt(tmp_path: Path):
    official = tmp_path / "references" / "openarm2_official" / "OpenArm_2.0.STEP"
    official.parent.mkdir(parents=True)
    official.write_text("ISO-10303-21;", encoding="utf-8")

    mapping = _auto_input_objects(
        tmp_path,
        {"target_mode": "new"},
        prompt="Build a rotating base for the complete OpenArm 2.0 robot",
    )

    assert mapping["project_ref_openarm_2_0"] == (
        "references/openarm2_official/OpenArm_2.0.STEP"
    )


def test_auto_input_objects_does_not_stage_unrelated_project_step(tmp_path: Path):
    unrelated = tmp_path / "references" / "lathe" / "Spindle_Assembly.step"
    unrelated.parent.mkdir(parents=True)
    unrelated.write_text("ISO-10303-21;", encoding="utf-8")

    mapping = _auto_input_objects(
        tmp_path,
        {"target_mode": "new"},
        prompt="Build an OpenArm 2.0 rotating base",
    )

    assert "project_ref_spindle_assembly" not in mapping


def test_required_project_reference_rejects_primitive_standin():
    inputs = {"project_ref_openarm_2_0": "references/openarm/OpenArm_2.0.STEP"}

    assert _missing_required_project_references("result = {'arm': Box(1, 1, 1)}", inputs) == [
        "project_ref_openarm_2_0"
    ]
    assert not _missing_required_project_references(
        "official = inputs['project_ref_openarm_2_0']\nresult = {'arm': official}", inputs
    )


def test_format_packet_includes_mate_guidance():
    text = format_context_packet(
        {
            "cad_mate_guidance": "NEW part must be modeled TO rail.step.",
            "cad_files": [
                {
                    "filename": "rail.glb",
                    "step": "rail.step",
                    "size_mm": [20, 20, 900],
                    "design_guidance": "Mate to this STEP.",
                }
            ],
        },
        Path("/tmp"),
        prompt="make a mount",
    )
    assert "Model-to-CAD guidance" in text
    assert "rail.step" in text
    assert "size_mm" in text


def test_cad_mate_guidance_new_only():
    from backend.main import _cad_mate_guidance

    new_body = SimpleNamespace(target_mode="new")
    edit_body = SimpleNamespace(target_mode="edit")
    cad = [{"filename": "8020.glb", "step": "8020.step"}]
    assert "8020.step" in (_cad_mate_guidance(new_body, cad, []) or "")
    assert _cad_mate_guidance(edit_body, cad, []) is None
    selected = _cad_mate_guidance(
        new_body,
        [],
        [{"token": "@selected-object", "filename": "8020.glb", "mate_target": True}],
    )
    assert selected and "8020.glb" in selected
