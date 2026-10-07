"""Viewport transform matrix + STEP sibling resolution."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from backend.services.cad_service import strip_virtual_body_filename
from backend.services.freecad_engine import (
    collect_macro_export_shapes,
    imported_step_unit_scale,
    resolve_project_step,
)
from backend.services.freecad_transform import (
    compose_transform_matrix,
    kernel_body_center,
    kernel_body_index_at_point,
    kernel_pick_edge,
    kernel_pick_face,
    kernel_pick_vertex,
    resolve_kernel_body_index,
    resolve_transform_step,
    try_apply_freecad_step_remove_body,
)


def test_imported_step_unit_scale_hardware():
    assert imported_step_unit_scale(13.0, likely_small_hardware=True) == 1.0
    assert imported_step_unit_scale(0.013, likely_small_hardware=True) == 1000.0
    assert imported_step_unit_scale(0.51, likely_small_hardware=True) == 25.4
    assert imported_step_unit_scale(0.4, likely_small_hardware=False) == 1000.0
    assert imported_step_unit_scale(0.013, likely_small_hardware=False) == 1000.0
    # 50 mm already-mm STEP vs 50 mm stored as glTF metres.
    assert imported_step_unit_scale(50.0, likely_small_hardware=False) == 1.0
    assert imported_step_unit_scale(0.05, likely_small_hardware=False) == 1000.0
    assert imported_step_unit_scale(150.0, likely_small_hardware=False) == 1.0
    assert imported_step_unit_scale(0.15, likely_small_hardware=False) == 1000.0


def test_compose_transform_matrix_translates():
    matrix = compose_transform_matrix({"translation": [10.0, -4.0, 2.5]})
    assert np.allclose(matrix[:3, 3], [10.0, -4.0, 2.5])
    assert np.allclose(matrix[:3, :3], np.eye(3))


def test_compose_transform_matrix_rotates_about_center():
    matrix = compose_transform_matrix({"rotation_deg": [0.0, 0.0, 90.0]}, center=[10.0, 0.0, 0.0])
    point = matrix @ np.array([10.0, 5.0, 0.0, 1.0])
    assert np.allclose(point[:3], [5.0, 0.0, 0.0], atol=1e-9)


def test_resolve_project_step_prefers_edited_sibling(tmp_path: Path):
    original = tmp_path / "bracket.step"
    edited = tmp_path / "bracket_edited.step"
    original.write_text("ISO-10303-21;", encoding="utf-8")
    edited.write_text("ISO-10303-21; edited", encoding="utf-8")
    found = resolve_project_step(tmp_path, "bracket_edited.glb")
    assert found == edited
    found_original = resolve_project_step(tmp_path, "bracket.glb")
    assert found_original == original


def test_resolve_project_step_falls_back_to_edited_sibling(tmp_path: Path):
    edited = tmp_path / "bracket_edited.step"
    edited.write_text("ISO-10303-21; edited", encoding="utf-8")
    found = resolve_project_step(tmp_path, "bracket.glb")
    assert found == edited


def test_freecad_kernel_translates_live_step(tmp_path: Path):
    try:
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        from OCP.IFSelect import IFSelect_ReturnStatus
        from OCP.STEPControl import STEPControl_StepModelType, STEPControl_Writer
        from backend.services.freecad_transform import (
            list_kernel_solids,
            try_apply_freecad_step_transform,
        )
    except ImportError:
        return

    box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape()
    step_path = tmp_path / "moved.step"
    writer = STEPControl_Writer()
    writer.Transfer(box, STEPControl_StepModelType.STEPControl_AsIs)
    status = writer.Write(str(step_path))
    assert status == IFSelect_ReturnStatus.IFSelect_RetDone
    before = list_kernel_solids(step_path)[0]["center"]
    out = try_apply_freecad_step_transform(
        tmp_path,
        "moved.step",
        {"translation": [20.0, 0.0, 0.0]},
        out_step=step_path,
    )
    assert out == step_path
    after = list_kernel_solids(step_path)[0]["center"]
    assert abs(after[0] - (before[0] + 20.0)) < 0.6
    assert abs(after[1] - before[1]) < 0.6
    assert abs(after[2] - before[2]) < 0.6


def test_resolve_transform_step_uses_out_stem(tmp_path: Path):
    (tmp_path / "part.step").write_text("orig", encoding="utf-8")
    (tmp_path / "part_edited.step").write_text("moved", encoding="utf-8")
    found = resolve_transform_step(tmp_path, "part_edited.step", "part.glb")
    assert found is not None
    assert found.name == "part_edited.step"


class _Shape:
    def __init__(self, solids=True, null=False):
        self.Solids = [1] if solids else []
        self._null = null

    def isNull(self):
        return self._null


class _Obj:
    def __init__(self, name, shape):
        self.Name = name
        self.Label = name
        self.Shape = shape


def test_freecad_export_prefers_result_and_skips_unplaced_inputs():
    screw = _Obj("hw_91290A115", _Shape())
    chassis_shape = _Shape()
    chassis = _Obj("Chassis", chassis_shape)
    shapes, names = collect_macro_export_shapes(
        {"Part": chassis},
        [screw, chassis],
        {"hw_91290A115"},
    )
    assert names == ["Part"]
    assert shapes == [chassis_shape]


def test_freecad_fallback_excludes_unplaced_hardware():
    screw = _Obj("hw_91290A115", _Shape())
    deck = _Obj("Deck", _Shape())
    shapes, names = collect_macro_export_shapes({}, [screw, deck], {"hw_91290A115"})
    assert names == ["Deck"]
    assert len(shapes) == 1


def test_strip_virtual_body_filename():
    assert strip_virtual_body_filename("jake/og.glb#body:2") == "jake/og.glb"
    assert strip_virtual_body_filename("og.glb") == "og.glb"


def test_kernel_body_index_picks_smallest_containing_solid():
    bodies = [
        {"index": 0, "name": "Shell", "bbox": [0.0, 0.0, 0.0, 100.0, 80.0, 40.0], "volume": 320000.0},
        {"index": 1, "name": "Insert", "bbox": [20.0, 20.0, 0.0, 30.0, 28.0, 8.0], "volume": 640.0},
    ]
    assert kernel_body_index_at_point(bodies, [25.0, 24.0, 4.0]) == 1
    assert kernel_body_center(bodies, 1) == [25.0, 24.0, 4.0]
    assert kernel_body_index_at_point(bodies, [400.0, 0.0, 0.0]) is None


def test_resolve_kernel_body_index_prefers_name():
    bodies = [
        {"index": 0, "name": "Shell"},
        {"index": 1, "name": "Insert"},
    ]
    assert resolve_kernel_body_index(bodies, 0, "Insert") == 1
    assert resolve_kernel_body_index(bodies, 0, None) == 0
    assert resolve_kernel_body_index(bodies, 1, "missing") == 1


def test_freecad_kernel_remove_body_drops_one_solid(tmp_path: Path):
    try:
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        from OCP.gp import gp_Pnt
        from backend.services.freecad_transform import list_kernel_solids
    except ImportError:
        return

    from OCP.BRep import BRep_Builder
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPControl import STEPControl_StepModelType, STEPControl_Writer
    from OCP.TopoDS import TopoDS_Compound

    box_a = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape()
    box_b = BRepPrimAPI_MakeBox(gp_Pnt(40.0, 0.0, 0.0), 6.0, 6.0, 6.0).Shape()
    builder = BRep_Builder()
    compound = TopoDS_Compound()
    builder.MakeCompound(compound)
    builder.Add(compound, box_a)
    builder.Add(compound, box_b)
    step_path = tmp_path / "two_bodies.step"
    writer = STEPControl_Writer()
    writer.Transfer(compound, STEPControl_StepModelType.STEPControl_AsIs)
    status = writer.Write(str(step_path))
    assert status == IFSelect_ReturnStatus.IFSelect_RetDone
    assert len(list_kernel_solids(step_path)) == 2

    out = try_apply_freecad_step_remove_body(
        tmp_path,
        "two_bodies.step",
        body_index=1,
        out_step=step_path,
    )
    assert out == step_path
    remaining = list_kernel_solids(step_path)
    assert len(remaining) == 1

    try:
        try_apply_freecad_step_remove_body(
            tmp_path,
            "two_bodies.step",
            body_index=0,
            out_step=step_path,
        )
        raise AssertionError("expected last-body delete to fail")
    except ValueError as exc:
        assert "single-body" in str(exc)


def test_kernel_topology_picks_box_faces_edges_vertices(tmp_path: Path):
    try:
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        from OCP.IFSelect import IFSelect_ReturnStatus
        from OCP.STEPControl import STEPControl_StepModelType, STEPControl_Writer
        from backend.services.freecad_transform import list_kernel_topology
    except ImportError:
        return

    box = BRepPrimAPI_MakeBox(40.0, 20.0, 10.0).Shape()
    step_path = tmp_path / "kernel_box.step"
    writer = STEPControl_Writer()
    writer.Transfer(box, STEPControl_StepModelType.STEPControl_AsIs)
    status = writer.Write(str(step_path))
    assert status == IFSelect_ReturnStatus.IFSelect_RetDone
    topo = list_kernel_topology(step_path)
    assert topo["kernel"] == "freecad"
    assert len(topo["bodies"]) == 1
    assert len(topo["faces"]) == 6
    assert len(topo["edges"]) == 12
    assert len(topo["vertices"]) == 8
    top = kernel_pick_face(topo["faces"], [20.0, 10.0, 10.0], [0.0, 0.0, 1.0])
    assert top is not None
    assert abs(top["center"][2] - 10.0) < 0.6
    edge = kernel_pick_edge(topo["edges"], [20.0, 0.0, 0.0], max_dist=2.0)
    assert edge is not None
    vertex = kernel_pick_vertex(topo["vertices"], [0.0, 0.0, 0.0], max_dist=1.0)
    assert vertex is not None
    assert vertex["position"][0] == 0.0


def test_apply_cad_document_transform_errors_when_kernel_fails(tmp_path, monkeypatch):
    (tmp_path / "part.step").write_text("ISO-10303-21;", encoding="utf-8")
    (tmp_path / "part.glb").write_bytes(b"glTF")
    from backend.services import freecad_transform as ft

    monkeypatch.setattr(ft, "try_apply_freecad_step_transform", lambda *a, **k: None)
    try:
        ft.apply_cad_document_transform(
            tmp_path,
            "part.glb",
            {"translation": [1.0, 0.0, 0.0]},
            out_step=tmp_path / "part.step",
            out_glb=tmp_path / "part.glb",
        )
        raise AssertionError("expected FreeCAD apply to fail")
    except RuntimeError as exc:
        assert "FreeCAD could not apply" in str(exc)


def test_apply_cad_document_remove_body_errors_when_kernel_skips(tmp_path, monkeypatch):
    (tmp_path / "part.step").write_text("ISO-10303-21;", encoding="utf-8")
    from backend.services import freecad_transform as ft

    monkeypatch.setattr(ft, "try_apply_freecad_step_remove_body", lambda *a, **k: None)
    try:
        ft.apply_cad_document_remove_body(
            tmp_path,
            "part.step",
            body_index=0,
            out_step=tmp_path / "part.step",
            out_glb=tmp_path / "part.glb",
        )
        raise AssertionError("expected FreeCAD delete to fail")
    except RuntimeError as exc:
        assert "FreeCAD could not delete" in str(exc)


def test_freecad_kernel_move_one_body_leaves_sibling(tmp_path: Path):
    try:
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        from OCP.gp import gp_Pnt
        from backend.services.freecad_transform import (
            list_kernel_solids,
            try_apply_freecad_step_transform,
        )
    except ImportError:
        return

    from OCP.BRep import BRep_Builder
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPControl import STEPControl_StepModelType, STEPControl_Writer
    from OCP.TopoDS import TopoDS_Compound

    box_a = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape()
    box_b = BRepPrimAPI_MakeBox(gp_Pnt(40.0, 0.0, 0.0), 6.0, 6.0, 6.0).Shape()
    builder = BRep_Builder()
    compound = TopoDS_Compound()
    builder.MakeCompound(compound)
    builder.Add(compound, box_a)
    builder.Add(compound, box_b)
    step_path = tmp_path / "siblings.step"
    writer = STEPControl_Writer()
    writer.Transfer(compound, STEPControl_StepModelType.STEPControl_AsIs)
    status = writer.Write(str(step_path))
    assert status == IFSelect_ReturnStatus.IFSelect_RetDone
    before = list_kernel_solids(step_path)
    assert len(before) == 2
    sibling = before[1]["center"]
    out = try_apply_freecad_step_transform(
        tmp_path,
        "siblings.step",
        {"translation": [20.0, 0.0, 0.0]},
        out_step=step_path,
        body_index=0,
    )
    assert out == step_path
    after = list_kernel_solids(step_path)
    assert len(after) == 2
    assert abs(after[0]["center"][0] - (before[0]["center"][0] + 20.0)) < 0.8
    assert abs(after[1]["center"][0] - sibling[0]) < 0.8
    assert abs(after[1]["center"][1] - sibling[1]) < 0.8
    assert abs(after[1]["center"][2] - sibling[2]) < 0.8
