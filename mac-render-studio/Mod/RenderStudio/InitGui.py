# SPDX-License-Identifier: LGPL-2.1-or-later
"""Render Studio VibeCAD workbench — GUI entry (FreeCAD execs this file oddly).

Keep this file tiny: import a real module and call into it. Do not define
workbench logic here — FreeCAD's InitGui exec uses split globals/locals.
"""

from pathlib import Path

try:
    with Path("/tmp/renderstudio-boot.log").open("a", encoding="utf-8") as fh:
        fh.write("InitGui.py importing\n")
except OSError:
    pass

import FreeCAD as App
import sys

# VibeCAD may scan both VibeCAD and FreeCAD user Mod trees (same symlink twice).
if getattr(sys, "_renderstudio_initgui_done", False):
    try:
        with Path("/tmp/renderstudio-boot.log").open("a", encoding="utf-8") as fh:
            fh.write("InitGui skip (already booted)\n")
    except OSError:
        pass
else:
    sys._renderstudio_initgui_done = True
    try:
        from rs_workbench import register_and_boot
    except ImportError:
        from RenderStudio.rs_workbench import register_and_boot  # type: ignore

    try:
        register_and_boot()
    except Exception as exc:  # noqa: BLE001
        import traceback

        App.Console.PrintError(f"[RenderStudio] InitGui boot failed: {exc}\n")
        App.Console.PrintError(traceback.format_exc())
        try:
            Path("/tmp/renderstudio-boot.log").write_text(
                f"InitGui boot fail: {exc}\n{traceback.format_exc()}", encoding="utf-8"
            )
        except OSError:
            pass
