"""Manufacturability checks over a built program.

Headline checks (all processes):

* watertight / manifold     — required for slicing / valid solids
* minimum wall thickness    — estimated by inward ray casting
* tiny-feature / degenerate — flags sub-printable parts (< min_volume_cm3)
* surface offset guard      — detects faces closer than offset_tol_mm to
                              another surface (near-zero clearance gaps that
                              cause boolean artefacts or print fusion)
* unsupported overhang      — FDM only: faces with normals below threshold
                              angle without apparent support
* brief constraint checks   — if a DesignBrief is supplied, its per-part
                              min_wall_mm and envelope_mm assertions are
                              validated post-build

Thresholds default to FDM 3D printing; pass ``process`` for CNC/SLA.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import trimesh

from backend.kernel.builder import BuildResult

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProcessLimits:
    name: str
    min_wall_mm: float
    min_hole_mm: float
    max_overhang_deg: float = 45.0   # FDM self-supporting angle
    min_volume_cm3: float = 0.001    # below this → degenerate part


PROCESSES = {
    "fdm": ProcessLimits("FDM 3D printing", min_wall_mm=1.0, min_hole_mm=1.0, max_overhang_deg=45.0),
    "sla": ProcessLimits("SLA resin", min_wall_mm=0.6, min_hole_mm=0.4, max_overhang_deg=60.0),
    "cnc": ProcessLimits("CNC milling", min_wall_mm=0.8, min_hole_mm=1.0, max_overhang_deg=90.0),
}
DEFAULT_PROCESS = "fdm"


def _estimate_min_wall(mesh: trimesh.Trimesh, samples: int = 500) -> float | None:
    """Approximate minimum wall thickness via inward ray casting.

    From a sample of face centres, cast a ray opposite the face normal (into the
    solid) and measure the distance to the next surface. The minimum over samples
    approximates the thinnest wall. Returns None if estimation fails.
    """
    n_faces = len(mesh.faces)
    if n_faces == 0:
        return None
    idx = np.arange(n_faces)
    if n_faces > samples:
        idx = np.random.default_rng(0).choice(n_faces, samples, replace=False)
    centers = mesh.triangles_center[idx]
    normals = mesh.face_normals[idx]
    eps = 1e-3
    origins = centers - normals * eps
    dirs = -normals
    try:
        locs, ray_idx, _tri = mesh.ray.intersects_location(origins, dirs, multiple_hits=False)
    except Exception:
        return None
    if len(locs) == 0:
        return None
    dist = np.linalg.norm(locs - origins[ray_idx], axis=1)
    dist = dist[dist > 1e-4]  # drop self-hits
    if len(dist) == 0:
        return None
    return float(np.min(dist))


def _estimate_surface_offset(mesh: trimesh.Trimesh, samples: int = 300, tol_mm: float = 0.05) -> float | None:
    """Estimate minimum face-to-face clearance (surface offset guard).

    Shoots short rays from face centres outward; gaps smaller than tol_mm
    indicate nearly-touching surfaces that can cause boolean artefacts or
    fused layers. Returns the minimum clearance found, or None.
    """
    n_faces = len(mesh.faces)
    if n_faces < 4:
        return None
    idx = np.arange(n_faces)
    if n_faces > samples:
        idx = np.random.default_rng(42).choice(n_faces, samples, replace=False)
    centers = mesh.triangles_center[idx]
    normals = mesh.face_normals[idx]
    eps = 1e-4
    origins = centers + normals * eps  # nudge just outside
    dirs = normals
    try:
        locs, ray_idx, _tri = mesh.ray.intersects_location(origins, dirs, multiple_hits=False)
    except Exception:
        return None
    if len(locs) == 0:
        return None
    dist = np.linalg.norm(locs - origins[ray_idx], axis=1)
    gaps = dist[(dist > eps) & (dist < 50.0)]  # cap at 50 mm to ignore open faces
    if len(gaps) == 0:
        return None
    return float(np.min(gaps))


def _overhang_ratio(mesh: trimesh.Trimesh, max_angle_deg: float = 45.0) -> float:
    """Return fraction of faces that overhang beyond max_angle_deg from vertical (Z-up).

    0.0 = fully self-supporting; > 0.2 typically needs supports.
    """
    if len(mesh.faces) == 0:
        return 0.0
    normals = mesh.face_normals
    cos_thresh = np.cos(np.radians(90.0 - max_angle_deg))
    down_z = normals[:, 2]  # z component of face normal
    overhang_mask = down_z < -cos_thresh  # faces pointing downward beyond threshold
    return float(np.sum(overhang_mask) / len(mesh.faces))


def run_dfm_checks(
    result: BuildResult,
    combined_mesh: trimesh.Trimesh | None = None,
    process: str = DEFAULT_PROCESS,
    brief: Any | None = None,
) -> dict[str, Any]:
    """Run DFM checks on each part; return metrics + human-readable warnings.

    Parameters
    ----------
    result:
        Kernel build result (contains part solids).
    combined_mesh:
        Optional pre-merged mesh for whole-assembly checks.
    process:
        Manufacturing process key: ``"fdm"``, ``"sla"``, or ``"cnc"``.
    brief:
        Optional :class:`~backend.kernel.schema.DesignBrief`; if supplied,
        per-part wall and envelope assertions are checked post-build.
    """
    from backend.kernel.export import body_to_trimesh

    limits = PROCESSES.get(process, PROCESSES[DEFAULT_PROCESS])
    warnings: list[str] = []
    per_part: dict[str, Any] = {}
    ok = True

    # Fast manifold pre-check with manifold3d (non-blocking — falls back silently)
    try:
        from backend.dfm.manifold_check import run_manifold_checks
        manifold_results = run_manifold_checks(result).get("parts", {})
    except Exception:
        manifold_results = {}

    for pid, body in result.parts.items():
        mesh = body_to_trimesh(body)
        # Prefer manifold3d watertight result; fall back to trimesh
        mf_info = manifold_results.get(pid, {})
        watertight = (
            mf_info.get("is_manifold")
            if mf_info.get("is_manifold") is not None
            else bool(mesh.is_watertight)
        )
        min_wall = _estimate_min_wall(mesh)
        min_gap = _estimate_surface_offset(mesh)
        vol_mm3 = float(mf_info.get("volume") or getattr(body, "volume", mesh.volume))
        vol_cm3 = vol_mm3 / 1000.0

        if not watertight:
            ok = False
            genus = mf_info.get("genus", -1)
            genus_hint = f" (genus {genus})" if genus not in (-1, None) and genus > 0 else ""
            warnings.append(
                f"Part '{pid}' is not watertight/manifold{genus_hint} — may fail STEP export or slicing. "
                "Check for overlapping faces, reversed normals, or incomplete boolean operations."
            )

        # Wall thickness
        effective_min_wall = limits.min_wall_mm
        if brief:
            pc = brief.constraint_for(pid)
            if pc and pc.min_wall_mm is not None:
                effective_min_wall = max(effective_min_wall, pc.min_wall_mm)

        if min_wall is not None and min_wall < effective_min_wall:
            warnings.append(
                f"Part '{pid}' has a thin wall ~{min_wall:.2f} mm "
                f"(minimum {effective_min_wall:.1f} mm for {limits.name}). "
                "Increase wall thickness or add ribs."
            )

        # Degenerate volume
        if vol_cm3 < limits.min_volume_cm3:
            ok = False
            warnings.append(
                f"Part '{pid}' volume {vol_cm3:.4f} cm³ is essentially zero — "
                "likely a degenerate or failed solid. Check boolean operations."
            )

        # Surface offset / clearance guard
        if min_gap is not None and 0.0 < min_gap < 0.1:
            warnings.append(
                f"Part '{pid}' has faces within {min_gap:.3f} mm of each other (surface offset < 0.1 mm). "
                "Near-zero clearances cause boolean artefacts and print fusion."
            )

        # Overhang (FDM only)
        overhang_ratio: float | None = None
        if process == "fdm":
            overhang_ratio = _overhang_ratio(mesh, limits.max_overhang_deg)
            if overhang_ratio > 0.20:
                warnings.append(
                    f"Part '{pid}' has {overhang_ratio*100:.0f}% overhanging faces "
                    f"(> {limits.max_overhang_deg:.0f}° from vertical). "
                    "Consider adding supports or redesigning the geometry."
                )

        # Brief envelope check post-build
        if brief:
            pc = brief.constraint_for(pid)
            if pc and pc.envelope_mm:
                env = pc.envelope_mm
                bbox = mesh.bounding_box.extents  # [x, y, z] in mm
                for axis, (actual, limit) in enumerate(zip(bbox, env)):
                    if actual > limit * 1.05:  # 5 % tolerance
                        warnings.append(
                            f"Part '{pid}' bounding box axis {['X','Y','Z'][axis]} "
                            f"= {actual:.1f} mm exceeds brief envelope {limit:.1f} mm."
                        )

        per_part[pid] = {
            "watertight": watertight,
            "min_wall_mm": round(min_wall, 3) if min_wall is not None else None,
            "min_surface_gap_mm": round(min_gap, 4) if min_gap is not None else None,
            "volume_cm3": round(vol_cm3, 4),
            **({"overhang_ratio": round(overhang_ratio, 3)} if overhang_ratio is not None else {}),
            **({"genus": mf_info["genus"]} if mf_info.get("genus") not in (-1, None) else {}),
            **({"surface_area_cm2": round(mf_info["surface_area"] / 100.0, 3)} if mf_info.get("surface_area") else {}),
        }

    return {
        "process": limits.name,
        "ok": ok,
        "warnings": warnings,
        "parts": per_part,
    }
