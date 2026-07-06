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
from typing import Any

from backend.kernel import build_program
from backend.kernel.export import combined_trimesh, export_all
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
) -> dict[str, Any]:
    """Build a Feature Program and export all formats into ``project_path``.

    Returns a dict describing the generated artifacts. Raises
    :class:`backend.kernel.KernelBuildError` / ``ValueError`` on bad programs so
    callers (the AI self-repair loop) can react.
    """
    if isinstance(program, dict):
        program = FeatureProgram.model_validate(program)

    result = build_program(program)
    base = _slug(basename or program.name)
    files = export_all(result, project_path, base)

    # Physics: SI mass properties, joints, and engine-import files.
    sim: dict[str, Any] | None = None
    try:
        from backend.physics.sim import write_sim_artifacts

        sim, sim_files = write_sim_artifacts(result, project_path, base)
        files.update(sim_files)
    except ImportError:
        logger.debug("physics layer not yet available")
    except Exception as exc:  # pragma: no cover - keep export resilient
        logger.warning("sim metadata failed: %s", exc)

    dfm: dict[str, Any] | None = None
    try:
        from backend.dfm.checks import run_dfm_checks

        dfm = run_dfm_checks(result, combined_trimesh(result))
    except ImportError:
        logger.debug("dfm layer not yet available")
    except Exception as exc:  # pragma: no cover
        logger.warning("dfm checks failed: %s", exc)

    # Persist the program for full reproducibility / editing.
    (project_path / f"{base}.program.json").write_text(
        json.dumps(program.model_dump(mode="json"), indent=2)
    )

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
