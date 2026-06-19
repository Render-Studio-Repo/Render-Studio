"""Bridge between the API/AI layer and the parametric kernel.

This is the compatibility shim that lets the existing ``/prompt`` route and
timeline keep working while we migrate off the legacy trimesh `actions` engine.
Given a Feature Program (dict or model), it builds exact solids, runs the
physics + DFM passes, and writes STEP/STL/GLB plus a ``*.sim.json`` sidecar into
the project directory. The primary returned file is the GLB the viewer loads.

The legacy path ([backend/services/cad_service.py]) remains untouched and is
still used for raw `actions` and uploaded-mesh edits.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable

from backend.kernel.schema import FeatureProgram

logger = logging.getLogger(__name__)


def _slug(name: str) -> str:
    keep = "".join(c if (c.isalnum() or c in "-_") else "_" for c in name.strip().lower())
    return (keep.strip("_") or "model")[:60]


def build_and_export(
    program: FeatureProgram | dict[str, Any],
    project_path: Path,
    *,
    basename: str | None = None,
    progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Build a Feature Program and export all formats into ``project_path``.

    Returns a dict describing the generated artifacts. Raises
    :class:`backend.kernel.KernelBuildError` / ``ValueError`` on bad programs so
    callers (the AI self-repair loop) can react.
    """
    if isinstance(program, dict):
        program = FeatureProgram.model_validate(program)

    total_parts = max(1, len(program.parts))

    def emit(stage: str, pct: float, label: str, *, part: str | None = None, detail: str | None = None) -> None:
        if progress:
            progress({"stage": stage, "pct": pct, "label": label, "part": part, "detail": detail})

    def build_progress(info: dict[str, Any]) -> None:
        idx = int(info.get("index") or 1)
        pct = 22 + (min(idx, total_parts) - 1) * (30 / total_parts)
        emit("build", pct, str(info.get("label") or "Building CAD bodies…"), part=info.get("part"))

    def export_progress(info: dict[str, Any]) -> None:
        stage = str(info.get("stage") or "export")
        base_pct = {
            "export_glb": 58,
            "export_step": 74,
            "export_stl": 82,
            "export_3mf": 88,
        }.get(stage, 70)
        idx = int(info.get("index") or 0)
        total = int(info.get("total") or total_parts)
        pct = base_pct
        if idx and total:
            pct += min(8, (idx / max(1, total)) * 8)
        emit(stage, pct, str(info.get("label") or "Exporting CAD artifacts…"), part=info.get("part"))

    from backend.kernel.builder import build_program
    from backend.kernel.export import combined_trimesh, export_all

    emit("build", 20, "Building parametric CAD bodies…")
    result = build_program(program, progress=build_progress)
    base = _slug(basename or program.name)
    logger.info("Exporting program %r (%d part(s)) → %s", program.name, len(result.parts), base)
    files = export_all(result, project_path, base, progress=export_progress)
    logger.info("Export complete → %s", files.get("glb"))

    # Physics: SI mass properties, joints, and engine-import files.
    sim: dict[str, Any] | None = None
    try:
        from backend.physics.sim import write_sim_artifacts

        emit("simulation", 92, "Writing simulation metadata…")
        sim, sim_files = write_sim_artifacts(result, project_path, base)
        files.update(sim_files)
    except ImportError:
        logger.debug("physics layer not yet available")
    except Exception as exc:  # pragma: no cover - keep export resilient
        logger.warning("sim metadata failed: %s", exc)

    dfm: dict[str, Any] | None = None
    try:
        from backend.dfm.checks import run_dfm_checks

        emit("dfm", 95, "Running manufacturability checks…")
        from backend.kernel.export import combined_trimesh
        dfm = run_dfm_checks(result, combined_trimesh(result))
    except ImportError:
        logger.debug("dfm layer not yet available")
    except Exception as exc:  # pragma: no cover
        logger.warning("dfm checks failed: %s", exc)

    # Persist the program for full reproducibility / editing.
    (project_path / f"{base}.program.json").write_text(
        json.dumps(program.model_dump(mode="json"), indent=2)
    )
    emit("finalize", 98, "Finalizing model files…")

    primary = files["glb"].name
    return {
        "program": program.model_dump(mode="json"),
        "primary": primary,
        "basename": base,
        "files": {k: v.name for k, v in files.items()},
        "parts": program.part_ids(),
        "sim": sim,
        "dfm": dfm,
        "warnings": result.warnings,
    }
