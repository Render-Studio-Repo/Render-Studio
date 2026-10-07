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
from typing import Any, Callable, Optional

import numpy as np
import trimesh
from build123d import Compound, export_step, export_stl

from backend.kernel.builder import BuildResult
from backend.services.cad_service import _parse_color, export_scene_3mf  # reuse color parsing / 3MF writer
from backend.services.live_preview import preview_payload, should_publish_part_preview

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


def _exterior_shell(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Keep the main outer shell when boolean cuts create separate cavity meshes."""
    parts = mesh.split()
    if len(parts) <= 1:
        return mesh
    return max(parts, key=lambda m: abs(float(m.volume)))


_TESSELLATION_LEVELS = (
    (LINEAR_DEFLECTION, ANGULAR_DEFLECTION),
    (0.2, 0.5),
    (0.5, 0.8),
    (1.0, 1.0),
)


def _mesh_from_tessellation(body: Any, linear: float, angular: float) -> trimesh.Trimesh:
    verts, faces = body.tessellate(linear, angular)
    v = np.array([[p.X, p.Y, p.Z] for p in verts], dtype=float)
    f = np.array(faces, dtype=np.int64)
    mesh = trimesh.Trimesh(vertices=v, faces=f, process=True)
    mesh.merge_vertices()
    return _exterior_shell(mesh)


def body_to_trimesh(body: Any, color: Any = None) -> trimesh.Trimesh:
    """Tessellate a build123d body into a colored, welded :class:`trimesh.Trimesh`.

    OCCT tessellation emits per-face triangle fans with duplicated vertices on
    shared edges; we weld coincident vertices so the mesh is watertight (needed
    for ``contains``, volume, and DFM checks) and the viewer GLB is clean.
    """
    last_exc: Exception | None = None
    mesh: trimesh.Trimesh | None = None
    for linear, angular in _TESSELLATION_LEVELS:
        try:
            mesh = _mesh_from_tessellation(body, linear, angular)
            if linear != LINEAR_DEFLECTION:
                logger.warning(
                    "Tessellation succeeded with coarser quality (linear=%s, angular=%s)",
                    linear,
                    angular,
                )
            break
        except Exception as exc:
            last_exc = exc
            logger.warning("Tessellation failed at linear=%s: %s", linear, exc)
    if mesh is None:
        raise ValueError(f"Could not tessellate model for export: {last_exc}") from last_exc
    rgba = _parse_color(color) if color is not None else np.array([224, 224, 224, 255], dtype=np.uint8)
    mesh.visual.vertex_colors = np.tile(rgba, (len(mesh.vertices), 1))
    return mesh


def export_step_file(result: BuildResult, path: Path) -> Path:
    export_step(_assembly_compound(result), str(path))
    return path


def export_stl_file(result: BuildResult, path: Path) -> Path:
    export_stl(_assembly_compound(result), str(path), tolerance=LINEAR_DEFLECTION, angular_tolerance=ANGULAR_DEFLECTION)
    return path


def export_glb_file(result: BuildResult, path: Path, progress: Optional[Callable[[dict[str, Any]], None]] = None) -> Path:
    """Build a glTF scene with one named node per part."""
    scene = trimesh.Scene()
    colors = {p.id: p.color for p in result.program.parts}
    items = list(result.parts.items())
    total = max(1, len(items))
    for idx, (part_id, body) in enumerate(items):
        if progress:
            progress(
                {
                    "stage": "export_glb",
                    "part": part_id,
                    "index": idx + 1,
                    "total": total,
                    "label": f"Tessellating {part_id.replace('_', ' ')} for viewer ({idx + 1}/{total})…",
                }
            )
        mesh = body_to_trimesh(body, colors.get(part_id))
        scene.add_geometry(mesh, geom_name=part_id, node_name=part_id)
        if progress and should_publish_part_preview(idx + 1, total) and scene.geometry:
            tmp = path.with_name(path.name + ".tmp")
            try:
                scene.export(str(tmp), file_type="glb")
                tmp.replace(path)
            except Exception:
                try:
                    if tmp.is_file():
                        tmp.unlink()
                except OSError:
                    pass
                try:
                    scene.export(str(path), file_type="glb")
                except Exception:
                    pass
            extra = preview_payload(path, part_index=idx + 1, part_count=total, append=False) or {}
            if extra:
                progress(
                    {
                        "stage": "export_glb",
                        "part": part_id,
                        "index": idx + 1,
                        "total": total,
                        "label": f"Drawing {part_id.replace('_', ' ')} in viewport ({idx + 1}/{total})…",
                        **extra,
                    }
                )
    if not scene.geometry:
        raise ValueError("no geometry to export to GLB")
    scene.export(str(path), file_type="glb")
    return path


def export_3mf_file(result: BuildResult, path: Path, progress: Optional[Callable[[dict[str, Any]], None]] = None) -> Path:
    """Export a multi-object 3MF print bundle (one object per part)."""
    scene = trimesh.Scene()
    colors = {p.id: p.color for p in result.program.parts}
    items = list(result.parts.items())
    total = max(1, len(items))
    for idx, (part_id, body) in enumerate(items):
        if progress:
            progress(
                {
                    "stage": "export_3mf",
                    "part": part_id,
                    "index": idx + 1,
                    "total": total,
                    "label": f"Packaging {part_id.replace('_', ' ')} for 3MF ({idx + 1}/{total})…",
                }
            )
        mesh = body_to_trimesh(body, colors.get(part_id))
        mesh.metadata["name"] = part_id
        mesh.metadata["node"] = part_id
        scene.add_geometry(mesh, geom_name=part_id, node_name=part_id)
    if not scene.geometry:
        raise ValueError("no geometry to export to 3MF")
    export_scene_3mf(scene, path)
    return path


def export_all(
    result: BuildResult,
    out_dir: Path,
    basename: str,
    progress: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Path]:
    """Write STEP + GLB for a build result. STL is a user download, not live-draw.

    Returns a mapping of format -> path. GLB is always produced (viewer needs
    it); STEP failures are logged but do not abort the GLB export.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, Path] = {}

    glb_path = out_dir / f"{basename}.glb"
    if progress:
        progress({"stage": "export_glb", "label": "Exporting viewer model…"})
    outputs["glb"] = export_glb_file(result, glb_path, progress=progress)

    try:
        if progress:
            progress({"stage": "export_step", "label": "Exporting STEP master…"})
        outputs["step"] = export_step_file(result, out_dir / f"{basename}.step")
    except Exception as exc:  # pragma: no cover - format edge cases
        logger.warning("STEP export failed for %s: %s", basename, exc)

    try:
        if progress:
            progress({"stage": "export_3mf", "label": "Exporting 3MF package…"})
        outputs["3mf"] = export_3mf_file(result, out_dir / f"{basename}.3mf")
    except Exception as exc:  # pragma: no cover
        logger.warning("3MF export failed for %s: %s", basename, exc)

    return outputs


def combined_trimesh(result: BuildResult) -> trimesh.Trimesh:
    """A single concatenated mesh of all parts (for DFM / watertight checks)."""
    meshes = [body_to_trimesh(body) for body in result.parts.values()]
    if len(meshes) == 1:
        return meshes[0]
    return trimesh.util.concatenate(meshes)
