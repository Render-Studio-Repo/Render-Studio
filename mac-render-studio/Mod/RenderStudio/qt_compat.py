# SPDX-License-Identifier: LGPL-2.1-or-later
"""Qt bindings shim — VibeCAD ships PySide; dev machines may have PySide6."""

from __future__ import annotations


def _load():
    for name in ("PySide", "PySide2", "PySide6"):
        try:
            QtCore = __import__(f"{name}.QtCore", fromlist=["QtCore"])
            QtGui = __import__(f"{name}.QtGui", fromlist=["QtGui"])
            QtWidgets = __import__(f"{name}.QtWidgets", fromlist=["QtWidgets"])
            return QtCore, QtGui, QtWidgets
        except ImportError:
            continue
    raise ImportError("No Qt bindings (PySide / PySide2 / PySide6)")


QtCore, QtGui, QtWidgets = _load()
