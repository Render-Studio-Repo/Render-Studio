# SPDX-License-Identifier: LGPL-2.1-or-later
"""Projects browser dock — lists Render Studio projects/ folders."""

from __future__ import annotations

import json
from pathlib import Path

import FreeCAD as App
import FreeCADGui as Gui

try:
    from qt_compat import QtCore, QtWidgets
except ImportError:
    from RenderStudio.qt_compat import QtCore, QtWidgets  # type: ignore


_DOCK = None


def _project_label(project_dir: Path) -> str:
    meta = project_dir / "project.json"
    if meta.is_file():
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            name = data.get("name") or data.get("title")
            if isinstance(name, str) and name.strip():
                return name.strip()
        except Exception:
            pass
    return project_dir.name


def _scan_projects(projects_dir: Path) -> list[tuple[str, Path]]:
    if not projects_dir.is_dir():
        return []
    rows: list[tuple[str, Path]] = []
    for child in sorted(projects_dir.iterdir()):
        if not child.is_dir():
            continue
        if child.name.startswith("."):
            continue
        rows.append((_project_label(child), child))
    return rows


class ProjectsDock(QtWidgets.QDockWidget):
    def __init__(self, projects_dir: str, api_base: str, parent=None):
        super().__init__("Projects", parent)
        self.projects_dir = Path(projects_dir).expanduser()
        self.api_base = api_base.rstrip("/")

        w = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(w)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(6)

        head = QtWidgets.QLabel("Projects")
        head.setStyleSheet("font-weight: 600; font-size: 13px;")
        layout.addWidget(head)

        hint = QtWidgets.QLabel("Local projects/ tree · double-click to import STEP")
        hint.setWordWrap(True)
        hint.setStyleSheet("color: #94a3b8; font-size: 11px;")
        layout.addWidget(hint)

        self.search = QtWidgets.QLineEdit()
        self.search.setPlaceholderText("Filter projects…")
        layout.addWidget(self.search)

        self.list = QtWidgets.QListWidget()
        self.list.setAlternatingRowColors(True)
        layout.addWidget(self.list, 1)

        btn_row = QtWidgets.QHBoxLayout()
        self.btn_refresh = QtWidgets.QPushButton("Refresh")
        self.btn_import = QtWidgets.QPushButton("Import STEP")
        btn_row.addWidget(self.btn_refresh)
        btn_row.addWidget(self.btn_import)
        layout.addLayout(btn_row)

        self.status = QtWidgets.QLabel("")
        self.status.setWordWrap(True)
        self.status.setStyleSheet("color: #64748b; font-size: 11px;")
        layout.addWidget(self.status)

        self.setWidget(w)
        self.search.textChanged.connect(self._filter)
        self.btn_refresh.clicked.connect(self.reload)
        self.btn_import.clicked.connect(self.import_selected)
        self.list.itemDoubleClicked.connect(lambda _item: self.import_selected())

        self.reload()

    def reload(self) -> None:
        self.list.clear()
        rows = _scan_projects(self.projects_dir)
        for label, path in rows:
            item = QtWidgets.QListWidgetItem(label)
            item.setData(QtCore.Qt.UserRole, str(path))
            item.setToolTip(str(path))
            self.list.addItem(item)
        self.status.setText(f"{len(rows)} project(s) in {self.projects_dir}")
        self._filter(self.search.text())

    def _filter(self, text: str) -> None:
        needle = text.strip().lower()
        for i in range(self.list.count()):
            item = self.list.item(i)
            item.setHidden(bool(needle) and needle not in item.text().lower())

    def _selected_path(self):
        item = self.list.currentItem()
        if not item:
            return None
        raw = item.data(QtCore.Qt.UserRole)
        return Path(raw) if raw else None

    def import_selected(self) -> None:
        path = self._selected_path()
        if not path:
            self.status.setText("Select a project first.")
            return
        try:
            import project_import
        except ImportError:
            from RenderStudio import project_import  # type: ignore

        doc = App.ActiveDocument or App.newDocument(path.name[:40])
        n = project_import.import_projects_tree(path, doc=doc, limit=30)
        self.status.setText(f"Imported {n} STEP file(s) from {path.name}")
        App.Console.PrintMessage(f"[RenderStudio] Imported {n} from {path}\n")
        try:
            Gui.SendMsgToActiveView("ViewFit")
        except Exception:
            pass


def show_projects_dock(projects_dir: str, api_base: str) -> None:
    global _DOCK
    mw = Gui.getMainWindow()
    if _DOCK is None:
        _DOCK = ProjectsDock(projects_dir, api_base, mw)
        mw.addDockWidget(QtCore.Qt.LeftDockWidgetArea, _DOCK)
    else:
        _DOCK.projects_dir = Path(projects_dir).expanduser()
        _DOCK.api_base = api_base.rstrip("/")
        _DOCK.reload()
    _DOCK.show()
    _DOCK.raise_()
