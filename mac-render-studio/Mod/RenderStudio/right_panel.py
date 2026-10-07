# SPDX-License-Identifier: LGPL-2.1-or-later
"""Right-side tabs — VibeScript | Wiring (Wiring opens full sim workspace)."""

from __future__ import annotations

import FreeCAD as App
import FreeCADGui as Gui

try:
    from qt_compat import QtCore, QtWidgets
except ImportError:
    from RenderStudio.qt_compat import QtCore, QtWidgets  # type: ignore

try:
    from vibescript_panel import VibeScriptPanel
    from wiring_workspace_dock import show_wiring_workspace
except ImportError:
    from RenderStudio.vibescript_panel import VibeScriptPanel  # type: ignore
    from RenderStudio.wiring_workspace_dock import show_wiring_workspace  # type: ignore


_DOCK = None


class WiringTabStub(QtWidgets.QWidget):
    """Right-rail stub — full Wiring UI lives in the workspace dock (like the site)."""

    focusRequested = QtCore.Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(10, 12, 10, 10)
        title = QtWidgets.QLabel("Wiring")
        title.setStyleSheet("font-size: 15px; font-weight: 700; color: #e6edf3;")
        layout.addWidget(title)
        body = QtWidgets.QLabel(
            "The Wiring Simulator is open in the main workspace:\n\n"
            "• Left — component palette\n"
            "• Center — schematic canvas\n"
            "• Right — Wiring AI compose (prompt, demos, Generate)\n\n"
            "Same layout as Wiring mode on render3d.app."
        )
        body.setWordWrap(True)
        body.setStyleSheet("color: #94a3b8; font-size: 12px;")
        layout.addWidget(body)
        btn = QtWidgets.QPushButton("Focus Wiring Simulator")
        btn.setStyleSheet(
            "font-weight: 700; background: #238636; color: white; "
            "border: 1px solid #2ea043; border-radius: 8px; padding: 8px;"
        )
        btn.clicked.connect(self.focusRequested.emit)
        layout.addWidget(btn)
        layout.addStretch(1)


class RightPanelDock(QtWidgets.QDockWidget):
    tabChanged = QtCore.Signal(str)

    def __init__(self, config: dict, parent=None):
        super().__init__("Render Studio", parent)
        self.config = dict(config)
        self.setObjectName("RenderStudioRightPanel")

        w = QtWidgets.QWidget()
        outer = QtWidgets.QVBoxLayout(w)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        self.tab_bar = QtWidgets.QTabBar()
        self.tab_bar.addTab("VibeScript")
        self.tab_bar.addTab("Wiring")
        self.tab_bar.setExpanding(False)
        self.tab_bar.setStyleSheet(
            """
            QTabBar::tab {
              background: #1e293b;
              color: #94a3b8;
              padding: 6px 14px;
              border: 1px solid #334155;
              margin-right: 2px;
            }
            QTabBar::tab:selected {
              background: #0f172a;
              color: #e2e8f0;
              font-weight: 600;
            }
            """
        )
        outer.addWidget(self.tab_bar)

        self.stack = QtWidgets.QStackedWidget()
        self.vibescript_panel = VibeScriptPanel(config)
        self.wiring_stub = WiringTabStub()
        self.stack.addWidget(self.vibescript_panel)
        self.stack.addWidget(self.wiring_stub)
        outer.addWidget(self.stack, 1)

        self.setWidget(w)
        self.tab_bar.currentChanged.connect(self._on_tab)
        self.wiring_stub.focusRequested.connect(self._focus_wiring)

        # Mount unified wiring workspace (hidden until Wiring tab)
        self._workspace = show_wiring_workspace(visible=False, config=config)
        if self._workspace:
            self._workspace.set_save_callback(self._save_schematic)
            self._workspace.set_run_callback(self._run_schematic)

        # Back-compat aliases used by layout_shell
        self.wiring_panel = self._workspace.compose if self._workspace else None

    def _focus_wiring(self) -> None:
        show_wiring_workspace(visible=True, config=self.config)
        if self._workspace:
            self._workspace.raise_()

    def _save_schematic(self, schematic: dict) -> None:
        if self._workspace and self._workspace.compose:
            self._workspace.compose.save_project_wiring(schematic)
            self._workspace.compose.update_inspector(schematic)

    def _run_schematic(self, schematic: dict) -> None:
        if self._workspace and self._workspace.compose:
            self._workspace.compose.validate_schematic(schematic)
            self._workspace.compose.tabs.setCurrentIndex(2)

    def _on_tab(self, index: int) -> None:
        try:
            key = "vibescript" if index == 0 else "wiring"
            self.stack.setCurrentIndex(index)
            self.tabChanged.emit(key)
            if key == "wiring":
                show_wiring_workspace(visible=True, config=self.config, fullscreen=True)
                App.Console.PrintMessage(
                    "[RenderStudio] Wiring tab — full-screen breadboard · palette · Wiring AI\n"
                )
            else:
                show_wiring_workspace(visible=False)
                # Do NOT auto-open composer here — that crashed on tab click.
                App.Console.PrintMessage("[RenderStudio] VibeScript tab\n")
        except Exception as exc:  # noqa: BLE001
            import traceback

            App.Console.PrintError(f"[RenderStudio] tab change failed: {exc}\n")
            App.Console.PrintError(traceback.format_exc())


def show_right_panel(config: dict) -> RightPanelDock:
    global _DOCK
    mw = Gui.getMainWindow()
    if _DOCK is None:
        _DOCK = RightPanelDock(config, mw)
        mw.addDockWidget(QtCore.Qt.RightDockWidgetArea, _DOCK)
    else:
        _DOCK.config = dict(config)
        if _DOCK._workspace:
            _DOCK._workspace.config = dict(config)
            if _DOCK._workspace.compose:
                _DOCK._workspace.compose.config = dict(config)
    _DOCK.show()
    _DOCK.raise_()
    return _DOCK
