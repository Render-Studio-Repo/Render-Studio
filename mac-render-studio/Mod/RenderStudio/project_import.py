# SPDX-License-Identifier: LGPL-2.1-or-later
"""Import Render Studio project STEP/STP files into a FreeCAD document."""

from __future__ import annotations

from pathlib import Path

import FreeCAD as App
import Import


STEP_GLOBS = ("*.step", "*.stp", "*.STEP", "*.STP")


def _iter_step_files(projects_dir: Path, limit: int = 200):
    if not projects_dir.is_dir():
        App.Console.PrintError(f"[RenderStudio] projects dir missing: {projects_dir}\n")
        return
    count = 0
    for path in sorted(projects_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".step", ".stp"}:
            continue
        # Skip history backups / noisy paths
        if "/history/" in str(path).replace("\\", "/"):
            continue
        yield path
        count += 1
        if count >= limit:
            App.Console.PrintWarning(
                f"[RenderStudio] Import capped at {limit} STEP files (raise limit in project_import.py)\n"
            )
            return


def import_projects_tree(projects_dir, doc=None, limit: int = 50) -> int:
    """Import up to ``limit`` STEP files from the projects tree.

    Returns number of successful imports.
    """
    root = Path(projects_dir).expanduser()
    doc = doc or App.ActiveDocument or App.newDocument("RenderStudioImport")
    imported = 0
    for step in _iter_step_files(root, limit=limit):
        try:
            # Prefer Insert into active doc
            Import.insert(str(step), doc.Name)
            imported += 1
            App.Console.PrintMessage(f"[RenderStudio] + {step.relative_to(root)}\n")
        except Exception as exc:  # noqa: BLE001
            App.Console.PrintWarning(f"[RenderStudio] skip {step.name}: {exc}\n")
    try:
        doc.recompute()
    except Exception:
        pass
    return imported
