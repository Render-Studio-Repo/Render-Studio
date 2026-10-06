import numpy as np
import pytest
import trimesh

from backend.services.print_support_analysis import analyze_mesh_support


def _on_bed(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    result = mesh.copy()
    result.apply_translation([0.0, 0.0, -result.bounds[0, 2]])
    return result


def test_seated_box_does_not_need_support():
    result = analyze_mesh_support(_on_bed(trimesh.creation.box(extents=[20, 20, 10])))

    assert result.needs_support is False
    assert result.projected_overhang_area_mm2 == pytest.approx(0.0)
    assert result.face_count == 12


def test_elevated_downward_surface_needs_support():
    mesh = trimesh.creation.box(extents=[20, 20, 10])
    mesh.apply_translation([0, 0, 15])

    result = analyze_mesh_support(mesh, bed_z_mm=0.0)

    assert result.needs_support is True
    assert result.projected_overhang_area_mm2 == pytest.approx(400.0)
    assert result.overhang_area_mm2 == pytest.approx(400.0)
    assert result.overhang_ratio > 0.0


def test_cantilever_is_detected_after_model_is_seated():
    post = trimesh.creation.box(extents=[4, 4, 10])
    post.apply_translation([0, 0, 5])
    slab = trimesh.creation.box(extents=[20, 8, 2])
    slab.apply_translation([6, 0, 11])
    mesh = trimesh.util.concatenate([post, slab])

    result = analyze_mesh_support(mesh, bed_z_mm=0.0)

    assert result.needs_support is True
    assert result.projected_overhang_area_mm2 >= 160.0


def test_small_overhang_can_be_ignored_by_area_floor():
    mesh = trimesh.creation.box(extents=[0.5, 0.5, 1.0])
    mesh.apply_translation([0, 0, 2])

    result = analyze_mesh_support(
        mesh,
        bed_z_mm=0.0,
        min_projected_overhang_area_mm2=1.0,
    )

    assert result.needs_support is False
    assert result.projected_overhang_area_mm2 == pytest.approx(0.25)


def test_threshold_uses_bambu_slope_above_horizontal_convention():
    def downward_triangle(slope_deg: float) -> trimesh.Trimesh:
        rise = 10.0 * np.tan(np.deg2rad(slope_deg))
        return trimesh.Trimesh(
            vertices=[[0, 0, 10], [0, 10, 10], [10, 0, 10 + rise]],
            faces=[[0, 1, 2]],
            process=False,
        )

    shallow = analyze_mesh_support(
        downward_triangle(20), bed_z_mm=0, min_projected_overhang_area_mm2=0
    )
    steep = analyze_mesh_support(
        downward_triangle(40), bed_z_mm=0, min_projected_overhang_area_mm2=0
    )

    assert shallow.sampled_candidate_face_count == 1
    assert shallow.needs_support is True
    assert steep.sampled_candidate_face_count == 0
    assert steep.needs_support is False


def test_dense_mesh_analysis_is_bounded_and_deterministic():
    mesh = _on_bed(trimesh.creation.icosphere(subdivisions=3, radius=10))

    first = analyze_mesh_support(mesh, max_faces=101)
    second = analyze_mesh_support(mesh, max_faces=101)

    assert first == second
    assert first.was_sampled is True
    assert first.sampled_face_count == 101
    assert first.face_count > first.sampled_face_count


@pytest.mark.parametrize(
    "kwargs",
    [
        {"support_threshold_angle_deg": 0},
        {"support_threshold_angle_deg": 91},
        {"bed_tolerance_mm": -0.1},
        {"min_projected_overhang_area_mm2": -1},
        {"max_faces": 2},
    ],
)
def test_rejects_invalid_analysis_limits(kwargs):
    with pytest.raises(ValueError):
        analyze_mesh_support(trimesh.creation.box(), **kwargs)


def test_rejects_non_finite_geometry():
    mesh = trimesh.creation.box()
    mesh.vertices[0] = [np.nan, 0, 0]

    with pytest.raises(ValueError, match="finite"):
        analyze_mesh_support(mesh)
