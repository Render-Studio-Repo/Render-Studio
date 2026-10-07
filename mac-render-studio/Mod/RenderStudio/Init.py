# SPDX-License-Identifier: LGPL-2.1-or-later
"""Render Studio FreeCAD module — App side (no GUI)."""

import FreeCAD as App

__title__ = "Render Studio"
__author__ = "Render3D"
__url__ = "https://render3d.app"


def _log(msg: str) -> None:
    # Keep this off stdout — agents sometimes capture freecadcmd output into $HOME.
    App.Console.PrintMessage(f"[RenderStudio] {msg}\n")


_log("Mod loaded (App)")
try:
    from pathlib import Path

    Path("/tmp/renderstudio-boot.log").write_text("Init.py loaded\n", encoding="utf-8")
except Exception:
    pass