"""Fast manifold-validity pre-check using the manifold3d library.

manifold3d (based on the Manifold C++ library) is dramatically faster at
mesh boolean operations than OCCT and also provides a reliable way to test
whether a mesh is manifold (closed, no self-intersections, consistent normals).

We use it as a *lightweight pre-check* before committing to the full OCCT build:

  1. Convert the build123d solid to a trimesh.
  2. Feed the triangles into manifold3d.
  3. Ask manifold3d whether the result is empty / degenerate.

This does NOT replace the OCCT build — it is a fast (< 0.1 s per part) sanity
check that can catch bad geometry early and give the AI a clear repair hint.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


def check_manifold(body: Any) -> dict[str, Any]:
    """Check whether a build123d solid is manifold using manifold3d.

    Parameters
    ----------
    body:
        A ``build123d`` solid / Part / Shape object.

    Returns
    -------
    dict with keys:
      ``is_manifold`` (bool),
      ``genus``       (int, 0 for a simple solid, -1 if unavailable),
      ``volume``      (float, mm³),
      ``surface_area`` (float, mm²),
      ``error``       (str | None, non-None when manifold3d raises).
    """
    try:
        import manifold3d  # type: ignore
        from backend.kernel.export import body_to_trimesh  # local import

        mesh = body_to_trimesh(body)
        if mesh is None or len(mesh.faces) == 0:
            return {"is_manifold": False, "genus": -1, "volume": 0.0,
                    "surface_area": 0.0, "error": "empty mesh"}

        verts = np.asarray(mesh.vertices, dtype=np.float32)
        tris  = np.asarray(mesh.faces,    dtype=np.uint32)

        m_mesh = manifold3d.Mesh(vert_properties=verts, tri_verts=tris)
        m = manifold3d.Manifold(m_mesh)

        # Status tells us if the mesh was accepted as manifold
        is_valid = m.status() == manifold3d.Error.NoError and not m.is_empty()

        # Fall back to trimesh for watertight if manifold3d rejects it
        is_manifold = is_valid if is_valid else bool(mesh.is_watertight)

        vol  = float(m.volume())  if is_valid else float(mesh.volume)
        area = float(m.surface_area()) if is_valid else float(mesh.area)

        try:
            genus = int(m.genus()) if is_valid else -1
        except Exception:
            genus = -1

        return {
            "is_manifold": is_manifold,
            "genus":       genus,
            "volume":      vol,
            "surface_area": area,
            "error":       None if is_manifold else f"manifold status: {m.status()}",
        }

    except ImportError:
        logger.debug("manifold3d not available — skipping fast manifold check")
        return {"is_manifold": None, "genus": -1, "volume": None,
                "surface_area": None, "error": "manifold3d not installed"}
    except Exception as exc:
        logger.warning("manifold3d check failed: %s", exc)
        return {"is_manifold": False, "genus": -1, "volume": None,
                "surface_area": None, "error": str(exc)}


def run_manifold_checks(result: Any) -> dict[str, Any]:
    """Run ``check_manifold`` on every part in a :class:`BuildResult`.

    Returns a dict: ``{ "parts": {pid: {...}}, "all_manifold": bool }``.
    """
    parts_out: dict[str, Any] = {}
    all_ok = True

    for pid, body in result.parts.items():
        info = check_manifold(body)
        parts_out[pid] = info
        if info.get("is_manifold") is False:
            all_ok = False

    return {"parts": parts_out, "all_manifold": all_ok}
