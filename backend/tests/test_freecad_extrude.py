"""FreeCAD Extrude / Pad / Pocket macros (no FreeCADCmd required)."""

from __future__ import annotations

from pathlib import Path

from backend.services.freecad_engine import (
    _pad_boolean_mode,
    build_face_pad_macro,
    build_sketch_extrude_macro,
    next_unique_stem,
    profile_points_world,
)


def test_pad_boolean_mode_join_and_cut():
    assert _pad_boolean_mode("auto", 12.0) == "join"
    assert _pad_boolean_mode("auto", -4.0) == "cut"
    assert _pad_boolean_mode("cut", 10.0) == "cut"
    assert _pad_boolean_mode("pocket", 10.0) == "cut"
    assert _pad_boolean_mode("join", -10.0) == "join"
    assert _pad_boolean_mode("new_body", 5.0) == "new_body"
    assert _pad_boolean_mode("intersect", 5.0) == "intersect"


def test_profile_points_world_xy_and_at():
    ring, direction = profile_points_world(
        [[0, 0], [10, 0], [10, 8], [0, 8]],
        plane="XY",
        at=[1.0, 2.0, 3.0],
    )
    assert direction == [0.0, 0.0, 1.0]
    assert ring[0] == [1.0, 2.0, 3.0]
    assert ring[2] == [11.0, 10.0, 3.0]


def test_profile_points_world_plane_ref():
    ring, direction = profile_points_world(
        [[0, 0], [4, 0], [4, 2]],
        plane_ref={
            "origin": [10.0, 0.0, 5.0],
            "u_axis": [1.0, 0.0, 0.0],
            "v_axis": [0.0, 1.0, 0.0],
            "normal": [0.0, 0.0, 1.0],
        },
    )
    assert direction == [0.0, 0.0, 1.0]
    assert ring[0] == [10.0, 0.0, 5.0]
    assert ring[1] == [14.0, 0.0, 5.0]
    assert ring[2] == [14.0, 2.0, 5.0]


def test_sketch_extrude_macro_new_and_cut():
    ring, direction = profile_points_world([[0, 0], [10, 0], [10, 10], [0, 10]], plane="XY")
    created = build_sketch_extrude_macro(
        ring=ring,
        direction=direction,
        height_mm=12.0,
        combine="new",
    )
    assert "mode = 'new'" in created
    assert "face.extrude" in created
    assert "step_in = ''" in created

    cut = build_sketch_extrude_macro(
        ring=ring,
        direction=direction,
        height_mm=6.0,
        combine="cut",
        step_in=Path("/tmp/box.step"),
    )
    assert "mode = 'cut'" in cut
    assert "shape.cut(prism)" in cut
    assert "/tmp/box.step" in cut


def test_face_pad_macro_through_and_new_body():
    src = Path("/tmp/part.step")
    join = build_face_pad_macro(
        step_in=src,
        distance_mm=8.0,
        center=[0, 0, 0],
        normal=[0, 0, 1],
        op="join",
    )
    assert "mode = 'join'" in join
    assert "shape.fuse(tool)" in join
    assert "through_all = False" in join

    pocket = build_face_pad_macro(
        step_in=src,
        distance_mm=8.0,
        center=[1, 2, 3],
        normal=[0, 0, -1],
        op="cut",
        through_all=True,
    )
    assert "mode = 'cut'" in pocket
    assert "shape.cut(tool)" in pocket
    assert "through_all = True" in pocket

    body = build_face_pad_macro(
        step_in=src,
        distance_mm=5.0,
        center=[0, 0, 0],
        normal=[0, 0, 1],
        op="new_body",
    )
    assert "mode = 'new_body'" in body


def test_next_unique_stem(tmp_path: Path):
    assert next_unique_stem(tmp_path, "extrude") == "extrude"
    (tmp_path / "extrude.glb").write_bytes(b"x")
    assert next_unique_stem(tmp_path, "extrude") == "extrude2"
    (tmp_path / "extrude2.step").write_text("ISO", encoding="utf-8")
    assert next_unique_stem(tmp_path, "extrude") == "extrude3"
