"""Bounded mesh preflight for deciding whether to enable slicer supports.

This is intentionally not a support generator.  It finds downward-facing surface
area above the build plate, then leaves the authoritative layer-by-layer support
calculation to Bambu Studio.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np


@dataclass(frozen=True)
class SupportAnalysis:
    needs_support: bool
    overhang_area_mm2: float
    projected_overhang_area_mm2: float
    overhang_ratio: float
    total_surface_area_mm2: float
    face_count: int
    sampled_face_count: int
    sampled_candidate_face_count: int
    was_sampled: bool
    support_threshold_angle_deg: float
    bed_z_mm: float

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _empty_result(
    *, face_count: int, threshold_deg: float, bed_z_mm: float
) -> SupportAnalysis:
    return SupportAnalysis(
        needs_support=False,
        overhang_area_mm2=0.0,
        projected_overhang_area_mm2=0.0,
        overhang_ratio=0.0,
        total_surface_area_mm2=0.0,
        face_count=face_count,
        sampled_face_count=0,
        sampled_candidate_face_count=0,
        was_sampled=False,
        support_threshold_angle_deg=threshold_deg,
        bed_z_mm=bed_z_mm,
    )


def analyze_mesh_support(
    mesh: Any,
    *,
    support_threshold_angle_deg: float = 30.0,
    bed_z_mm: float | None = None,
    bed_tolerance_mm: float = 0.05,
    min_projected_overhang_area_mm2: float = 1.0,
    max_faces: int = 200_000,
) -> SupportAnalysis:
    """Estimate whether an already oriented and seated mesh needs support.

    ``support_threshold_angle_deg`` follows Bambu Studio's convention: it is
    the surface slope above horizontal, so a downward horizontal ceiling is
    zero degrees and a vertical wall is ninety degrees.  Faces wholly within
    ``bed_tolerance_mm`` of the bed are excluded.

    For unusually dense meshes, a deterministic, evenly spaced face sample
    bounds work and the reported areas are scaled estimates.  The result is a
    conservative switch for automatic supports, not a replacement for slicing.
    """

    threshold = float(support_threshold_angle_deg)
    tolerance = float(bed_tolerance_mm)
    minimum_area = float(min_projected_overhang_area_mm2)
    if not np.isfinite([threshold, tolerance, minimum_area]).all():
        raise ValueError("analysis limits must be finite")
    if not 1.0 <= threshold <= 90.0:
        raise ValueError("support_threshold_angle_deg must be between 1 and 90")
    if tolerance < 0.0:
        raise ValueError("bed_tolerance_mm must be non-negative")
    if minimum_area < 0.0:
        raise ValueError("min_projected_overhang_area_mm2 must be non-negative")
    if int(max_faces) < 3:
        raise ValueError("max_faces must be at least 3")

    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if vertices.ndim != 2 or vertices.shape[1:] != (3,):
        raise ValueError("mesh vertices must have shape (n, 3)")
    if faces.ndim != 2 or faces.shape[1:] != (3,):
        raise ValueError("mesh faces must have shape (n, 3)")
    if not np.isfinite(vertices).all():
        raise ValueError("mesh vertices must be finite")
    if faces.size and (faces.min() < 0 or faces.max() >= len(vertices)):
        raise ValueError("mesh faces reference vertices outside the mesh")

    resolved_bed_z = (
        float(np.min(vertices[:, 2]))
        if bed_z_mm is None and len(vertices)
        else float(bed_z_mm or 0.0)
    )
    if not np.isfinite(resolved_bed_z):
        raise ValueError("bed_z_mm must be finite")
    face_count = int(len(faces))
    if face_count == 0 or len(vertices) == 0:
        return _empty_result(
            face_count=face_count,
            threshold_deg=threshold,
            bed_z_mm=resolved_bed_z,
        )

    sample_count = min(face_count, int(max_faces))
    if sample_count == face_count:
        face_indices = np.arange(face_count, dtype=np.int64)
    else:
        # One stable sample from each equal-width face-index bucket.
        face_indices = np.floor(
            (np.arange(sample_count, dtype=np.float64) + 0.5)
            * face_count
            / sample_count
        ).astype(np.int64)

    triangles = vertices[faces[face_indices]]
    cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    double_area = np.linalg.norm(cross, axis=1)
    valid = double_area > np.finfo(np.float64).eps
    area = 0.5 * double_area
    normal_z = np.zeros_like(double_area)
    normal_z[valid] = cross[valid, 2] / double_area[valid]

    # A downward face qualifies when its slope above horizontal is no greater
    # than Bambu's threshold.  Horizontal undersides have normal_z == -1.
    max_normal_z = -np.cos(np.deg2rad(threshold))
    above_bed = np.max(triangles[:, :, 2], axis=1) > resolved_bed_z + tolerance
    candidates = valid & above_bed & (normal_z <= max_normal_z)

    scale = face_count / sample_count
    total_area = float(np.sum(area) * scale)
    overhang_area = float(np.sum(area[candidates]) * scale)
    projected_area = float(
        np.sum(area[candidates] * np.abs(normal_z[candidates])) * scale
    )
    ratio = overhang_area / total_area if total_area > 0.0 else 0.0

    return SupportAnalysis(
        needs_support=projected_area > 0.0 and projected_area >= minimum_area,
        overhang_area_mm2=overhang_area,
        projected_overhang_area_mm2=projected_area,
        overhang_ratio=ratio,
        total_surface_area_mm2=total_area,
        face_count=face_count,
        sampled_face_count=sample_count,
        sampled_candidate_face_count=int(np.count_nonzero(candidates)),
        was_sampled=sample_count < face_count,
        support_threshold_angle_deg=threshold,
        bed_z_mm=resolved_bed_z,
    )
