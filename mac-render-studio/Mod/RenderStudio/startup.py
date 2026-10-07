# SPDX-License-Identifier: LGPL-2.1-or-later
"""Deferred GUI startup — activate Render Studio workbench and mount panels."""

from __future__ import annotations

import traceback
from pathlib import Path

import FreeCAD as App
import FreeCADGui as Gui

try:
    from qt_compat import QtCore
except ImportError:
    from RenderStudio.qt_compat import QtCore  # type: ignore

_SCHEDULED = False
_BOOT_LOG = Path("/tmp/renderstudio-boot.log")


def _blog(msg: str) -> None:
    try:
        with _BOOT_LOG.open("a", encoding="utf-8") as fh:
            fh.write(msg.rstrip() + "\n")
    except OSError:
        pass
    try:
        App.Console.PrintMessage(f"[RenderStudio] {msg}\n")
    except Exception:
        pass


def schedule_startup(config: dict) -> None:
    global _SCHEDULED
    if _SCHEDULED:
        return
    _SCHEDULED = True
    try:
        _BOOT_LOG.write_text("RenderStudio boot scheduled\n", encoding="utf-8")
    except OSError:
        pass

    def _boot() -> None:
        _blog("boot timer fired")
        # Prefer PartDesign so FreeCAD Create/Modify toolbars stay visible.
        # Render Studio is an additive layer (banner + docks), not a replacement shell.
        try:
            Gui.activateWorkbench("PartDesignWorkbench")
            _blog("PartDesign workbench activated (FreeCAD tools kept)")
        except Exception as exc:  # noqa: BLE001
            _blog(f"PartDesign fail: {exc} — trying RenderStudioWorkbench")
            try:
                Gui.activateWorkbench("RenderStudioWorkbench")
                _blog("RenderStudio workbench activated (fallback)")
            except Exception as exc2:  # noqa: BLE001
                _blog(f"workbench fail: {exc2}")
                App.Console.PrintWarning(f"[RenderStudio] workbench: {exc2}\n")
        try:
            try:
                from env_loader import apply_env
            except ImportError:
                from RenderStudio.env_loader import apply_env  # type: ignore
            path = apply_env(config)
            _blog(f"env applied: {path}")
        except Exception as exc:  # noqa: BLE001
            _blog(f"env fail: {exc}\n{traceback.format_exc()}")
            App.Console.PrintWarning(f"[RenderStudio] env: {exc}\n")
        try:
            try:
                import layout_shell
            except ImportError:
                from RenderStudio import layout_shell  # type: ignore
            layout_shell.apply_layout(config)
            _blog("layout applied OK (additive)")
        except Exception as exc:  # noqa: BLE001
            tb = traceback.format_exc()
            _blog(f"layout fail: {exc}\n{tb}")
            App.Console.PrintError(f"[RenderStudio] layout failed: {exc}\n")
            App.Console.PrintError(tb)

    # Delay until main window + QApplication are fully up
    QtCore.QTimer.singleShot(1500, _boot)
