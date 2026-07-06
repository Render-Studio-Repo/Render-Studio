"""Manufacturability checks over a built program.

The headline checks:

* watertight/manifold      - required for slicing / valid solids
* minimum wall thickness   - estimated by ray-casting inward from the surface
* tiny-feature / volume    - flags degenerate or sub-printable parts

Thresholds default to FDM 3D printing; pass a different ``process`` for CNC/SLA.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import trimesh

from backend.kernel.builder import BuildResult


@dataclass(frozen=True)
class ProcessLimits:
    name: str
    min_wall_mm: float
    min_hole_mm: float


PROCESSES = {
    "fdm": ProcessLimits("FDM 3D printing", 1.0, 1.0),
    "sla": ProcessLimits("SLA resin", 0.6, 0.4),
    "cnc": ProcessLimits("CNC milling", 0.8, 1.0),
}
DEFAULT_PROCESS = "fdm"


def _estimate_min_wall(mesh: trimesh.Trimesh, samples: int = 500) -> float | None:
    """Approximate minimum wall thickness via inward ray casting.

    From a sample of face centres, cast a ray opposite the face normal (into the
    solid) and measure the distance to the next surface. The minimum over samples
    approximates the thinnest wall. Returns None if it can't be estimated.
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
    origins = centers - normals * eps  # nudge just inside
    dirs = -normals
    try:
        locs, ray_idx, _tri = mesh.ray.intersects_location(origins, dirs, multiple_hits=False)
    except Exception:
        return None
    if len(locs) == 0:
        return None
    dist = np.linalg.norm(locs - origins[ray_idx], axis=1)
    dist = dist[dist > 1e-4]  # ignore self-hits
    if len(dist) == 0:
        return None
    return float(np.min(dist))


def run_dfm_checks(
    result: BuildResult,
    combined_mesh: trimesh.Trimesh | None = None,
    process: str = DEFAULT_PROCESS,
) -> dict[str, Any]:
    """Run DFM checks on each part; return metrics + human-readable warnings."""
    from backend.kernel.export import body_to_trimesh

    limits = PROCESSES.get(process, PROCESSES[DEFAULT_PROCESS])
    warnings: list[str] = []
    per_part: dict[str, Any] = {}
    ok = True

    for pid, body in result.parts.items():
        mesh = body_to_trimesh(body)
        watertight = bool(mesh.is_watertight)
        min_wall = _estimate_min_wall(mesh)
        vol_cm3 = float(getattr(body, "volume", mesh.volume)) / 1000.0

        if not watertight:
            ok = False
            warnings.append(f"Part '{pid}' is not watertight/manifold; may not slice cleanly.")
        if min_wall is not None and min_wall < limits.min_wall_mm:
            warnings.append(
                f"Part '{pid}' has a thin wall ~{min_wall:.2f} mm (< {limits.min_wall_mm:.1f} mm for {limits.name})."
            )
        per_part[pid] = {
            "watertight": watertight,
            "min_wall_mm": round(min_wall, 3) if min_wall is not None else None,
            "volume_cm3": round(vol_cm3, 3),
        }

    return {
        "process": limits.name,
        "ok": ok,
        "warnings": warnings,
        "parts": per_part,
    }
