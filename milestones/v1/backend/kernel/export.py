"""Export kernel solids to manufacturing + visualization formats.

* STEP  - true B-rep, the manufacturing/CAD interchange master.
* STL   - tessellated, for 3D printing / mesh validation.
* GLB   - tessellated glTF scene with one named node per part (viewer).

GLB tessellation goes through trimesh so we reuse the existing viewer pipeline
and mesh-validation utilities. Colors are written as per-vertex colors to avoid
the scipy-backed face->vertex bake path noted in
:mod:`backend.services.cad_service`.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import numpy as np
import trimesh
from build123d import Compound, export_step, export_stl

from backend.kernel.builder import BuildResult
from backend.services.cad_service import _parse_color  # reuse color parsing

logger = logging.getLogger(__name__)

# Tessellation quality (mm linear deflection, rad angular deflection).
LINEAR_DEFLECTION = 0.08
ANGULAR_DEFLECTION = 0.3


def _assembly_compound(result: BuildResult) -> Compound:
    parts = result.part_list
    if len(parts) == 1:
        # Wrap so export is uniform; keep the label for traceability.
        return Compound(label=result.program.name, children=[parts[0]])
    return Compound(label=result.program.name, children=list(parts))


def body_to_trimesh(body: Any, color: Any = None) -> trimesh.Trimesh:
    """Tessellate a build123d body into a colored, welded :class:`trimesh.Trimesh`.

    OCCT tessellation emits per-face triangle fans with duplicated vertices on
    shared edges; we weld coincident vertices so the mesh is watertight (needed
    for ``contains``, volume, and DFM checks) and the viewer GLB is clean.
    """
    verts, faces = body.tessellate(LINEAR_DEFLECTION, ANGULAR_DEFLECTION)
    v = np.array([[p.X, p.Y, p.Z] for p in verts], dtype=float)
    f = np.array(faces, dtype=np.int64)
    # process=True welds duplicate vertices and drops degenerate faces.
    mesh = trimesh.Trimesh(vertices=v, faces=f, process=True)
    mesh.merge_vertices()
    rgba = _parse_color(color) if color is not None else np.array([224, 224, 224, 255], dtype=np.uint8)
    mesh.visual.vertex_colors = np.tile(rgba, (len(mesh.vertices), 1))
    return mesh


def export_step_file(result: BuildResult, path: Path) -> Path:
    export_step(_assembly_compound(result), str(path))
    return path


def export_stl_file(result: BuildResult, path: Path) -> Path:
    export_stl(_assembly_compound(result), str(path), tolerance=LINEAR_DEFLECTION, angular_tolerance=ANGULAR_DEFLECTION)
    return path


def export_glb_file(result: BuildResult, path: Path) -> Path:
    """Build a glTF scene with one named node per part."""
    scene = trimesh.Scene()
    colors = {p.id: p.color for p in result.program.parts}
    for part_id, body in result.parts.items():
        mesh = body_to_trimesh(body, colors.get(part_id))
        scene.add_geometry(mesh, geom_name=part_id, node_name=part_id)
    if not scene.geometry:
        raise ValueError("no geometry to export to GLB")
    scene.export(str(path), file_type="glb")
    return path


def export_all(result: BuildResult, out_dir: Path, basename: str) -> dict[str, Path]:
    """Write STEP + STL + GLB for a build result.

    Returns a mapping of format -> path. GLB is always produced (viewer needs
    it); STEP/STL failures are logged but do not abort the GLB export.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, Path] = {}

    glb_path = out_dir / f"{basename}.glb"
    outputs["glb"] = export_glb_file(result, glb_path)

    try:
        outputs["step"] = export_step_file(result, out_dir / f"{basename}.step")
    except Exception as exc:  # pragma: no cover - format edge cases
        logger.warning("STEP export failed for %s: %s", basename, exc)

    try:
        outputs["stl"] = export_stl_file(result, out_dir / f"{basename}.stl")
    except Exception as exc:  # pragma: no cover
        logger.warning("STL export failed for %s: %s", basename, exc)

    return outputs


def combined_trimesh(result: BuildResult) -> trimesh.Trimesh:
    """A single concatenated mesh of all parts (for DFM / watertight checks)."""
    meshes = [body_to_trimesh(body) for body in result.parts.values()]
    if len(meshes) == 1:
        return meshes[0]
    return trimesh.util.concatenate(meshes)
