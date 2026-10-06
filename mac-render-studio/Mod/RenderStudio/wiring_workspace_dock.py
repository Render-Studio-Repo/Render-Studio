# SPDX-License-Identifier: LGPL-2.1-or-later
"""Wiring Simulator workspace — palette + canvas + compose (web-parity layout)."""

from __future__ import annotations

import FreeCAD as App
import FreeCADGui as Gui

try:
    from qt_compat import QtCore, QtWidgets
except ImportError:
    from RenderStudio.qt_compat import QtCore, QtWidgets  # type: ignore

try:
    from wiring_canvas_qt import WiringCanvasView, WiringPalette
    from wiring_panel import WiringPanel
except ImportError:
    from RenderStudio.wiring_canvas_qt import WiringCanvasView, WiringPalette  # type: ignore
    from RenderStudio.wiring_panel import WiringPanel  # type: ignore


_DOCK = None
_PREV_FLOATING = False
_PREV_GEOMETRY = None

_WORKSPACE_QSS = """
#RenderStudioWiringRoot {
  background: #0b1220;
}
#RenderStudioWiringToolbelt {
  background: #0f172a;
  border-bottom: 1px solid #1e293b;
}
QPushButton#WiringGenerateBtn {
  background: #238636;
  color: #fff;
  border: 1px solid #2ea043;
  border-radius: 8px;
  font-weight: 700;
  padding: 6px 12px;
}
QPushButton#WiringGenerateBtn:hover { background: #2ea043; }
QPushButton#WiringExitBtn {
  background: #21262d;
  color: #e6edf3;
  border: 1px solid #30363d;
  border-radius: 8px;
  font-weight: 600;
  padding: 6px 12px;
}
QLabel#WiringComposeTitle {
  font-size: 14px;
  font-weight: 700;
  color: #e6edf3;
}
"""


class WiringWorkspaceDock(QtWidgets.QDockWidget):
    """Full Wiring tab: toolbelt + [palette | canvas | Wiring AI compose]."""

    def __init__(self, config: dict | None = None, parent=None):
        super().__init__("Wiring Simulator", parent)
        self.setObjectName("RenderStudioWiringWorkspace")
        self.setAllowedAreas(
            QtCore.Qt.BottomDockWidgetArea
            | QtCore.Qt.TopDockWidgetArea
            | QtCore.Qt.LeftDockWidgetArea
            | QtCore.Qt.RightDockWidgetArea
        )
        self.config = dict(config or {})

        root = QtWidgets.QWidget()
        root.setObjectName("RenderStudioWiringRoot")
        root.setStyleSheet(_WORKSPACE_QSS)
        layout = QtWidgets.QVBoxLayout(root)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # --- Toolbelt (web wiring-toolbelt) ---
        toolbelt = QtWidgets.QWidget()
        toolbelt.setObjectName("RenderStudioWiringToolbelt")
        tb = QtWidgets.QHBoxLayout(toolbelt)
        tb.setContentsMargins(8, 6, 8, 6)
        tb.setSpacing(6)

        self.btn_run = QtWidgets.QPushButton("▶ Run schematic")
        self.btn_save = QtWidgets.QPushButton("💾 Save")
        self.btn_fit = QtWidgets.QPushButton("Fit view")
        self.btn_demo_blink = QtWidgets.QPushButton("Demo: Blink")
        self.btn_demo_motor = QtWidgets.QPushButton("Demo: Pi→Motor")
        self.btn_demo_stepper = QtWidgets.QPushButton("Demo: Stepper")
        self.btn_exit = QtWidgets.QPushButton("← Design")
        self.btn_exit.setObjectName("WiringExitBtn")
        self.btn_exit.setToolTip("Leave full-screen Wiring Simulator")
        for b in (
            self.btn_exit,
            self.btn_run,
            self.btn_save,
            self.btn_fit,
            self.btn_demo_blink,
            self.btn_demo_motor,
            self.btn_demo_stepper,
        ):
            tb.addWidget(b)
        tb.addStretch(1)
        self.tool_status = QtWidgets.QLabel(
            "Breadboard layout · palette · Wiring AI — same zones as render3d.app"
        )
        self.tool_status.setStyleSheet("color: #64748b; font-size: 11px;")
        tb.addWidget(self.tool_status)
        layout.addWidget(toolbelt)

        # --- Main split: palette | canvas | compose ---
        split = QtWidgets.QSplitter(QtCore.Qt.Horizontal)
        split.setChildrenCollapsible(False)

        self.palette = WiringPalette()
        self.palette.setMinimumWidth(160)
        self.palette.setMaximumWidth(200)
        split.addWidget(self.palette)

        self.canvas = WiringCanvasView()
        split.addWidget(self.canvas)

        # Compose column (web right Wiring AI panel)
        compose_wrap = QtWidgets.QWidget()
        compose_wrap.setMinimumWidth(300)
        compose_wrap.setMaximumWidth(420)
        cw = QtWidgets.QVBoxLayout(compose_wrap)
        cw.setContentsMargins(6, 6, 6, 6)
        cw.setSpacing(6)
        title = QtWidgets.QLabel("Wiring AI")
        title.setObjectName("WiringComposeTitle")
        cw.addWidget(title)
        self.compose = WiringPanel(self.config)
        # Hide nested tab chrome — we're already the Wiring workspace
        if hasattr(self.compose, "tabs"):
            # Keep Compose / Inspect / Simulate but tighten
            pass
        cw.addWidget(self.compose, 1)
        split.addWidget(compose_wrap)

        split.setStretchFactor(0, 0)
        split.setStretchFactor(1, 1)
        split.setStretchFactor(2, 0)
        split.setSizes([150, 700, 340])
        layout.addWidget(split, 1)

        self.setWidget(root)
        self._save_callback = None
        self._run_callback = None

        self.palette.componentRequested.connect(self.canvas.add_palette_component)
        self.btn_fit.clicked.connect(self._fit_view)
        self.btn_save.clicked.connect(self._on_save)
        self.btn_run.clicked.connect(self._on_run)
        self.btn_exit.clicked.connect(lambda: show_wiring_workspace(visible=False))
        self.canvas.schematicChanged.connect(self._on_schematic_changed)
        self.compose.schematicLoaded.connect(self.load_schematic)
        self.compose.set_external_save(self._on_save)

        self.btn_demo_blink.clicked.connect(lambda: self._trigger_demo("blink-led-breadboard.json"))
        self.btn_demo_motor.clicked.connect(lambda: self._trigger_demo("raspberry-pi-button-motor.json"))
        self.btn_demo_stepper.clicked.connect(lambda: self._trigger_demo("arduino-stepper.json"))
        # Auto-load blink breadboard demo once so the board layout is visible
        QtCore.QTimer.singleShot(400, lambda: self._ensure_demo_loaded())

    def _trigger_demo(self, fname: str) -> None:
        for btn in getattr(self.compose, "_demo_buttons", []):
            if btn.property("demo_file") == fname:
                btn.click()
                return
        App.Console.PrintWarning(f"[RenderStudio] Demo not found: {fname}\n")

    def _ensure_demo_loaded(self) -> None:
        comps = self.canvas.schematic.get("components") or []
        if comps:
            return
        self._trigger_demo("blink-led-breadboard.json")

    def enter_fullscreen(self) -> None:
        """Cover the main window like web wiring-mode."""
        global _PREV_FLOATING, _PREV_GEOMETRY
        mw = Gui.getMainWindow()
        if mw is None:
            return
        try:
            _PREV_FLOATING = bool(self.isFloating())
            _PREV_GEOMETRY = self.geometry()
        except Exception:
            _PREV_FLOATING = False
            _PREV_GEOMETRY = None
        self.setFloating(True)
        try:
            # Match main window client area
            top_left = mw.mapToGlobal(QtCore.QPoint(0, 0))
            self.setGeometry(QtCore.QRect(top_left, mw.size()))
        except Exception:
            try:
                self.showMaximized()
            except Exception:
                pass
        self.show()
        self.raise_()
        self.activateWindow()

    def exit_fullscreen(self) -> None:
        global _PREV_FLOATING, _PREV_GEOMETRY
        try:
            if _PREV_GEOMETRY is not None and _PREV_FLOATING:
                self.setFloating(True)
                self.setGeometry(_PREV_GEOMETRY)
            else:
                self.setFloating(False)
                mw = Gui.getMainWindow()
                if mw is not None:
                    mw.addDockWidget(QtCore.Qt.BottomDockWidgetArea, self)
        except Exception:
            self.setFloating(False)
        _PREV_GEOMETRY = None

    def _fit_view(self) -> None:
        rect = self.canvas.scene().itemsBoundingRect()
        if rect.isValid():
            self.canvas.fitInView(rect.adjusted(-40, -40, 40, 40), QtCore.Qt.KeepAspectRatio)

    def _on_save(self) -> None:
        schematic = self.canvas.get_schematic()
        if self._save_callback:
            self._save_callback(schematic)
        else:
            self.compose.save_project_wiring(schematic)
        self.compose.update_inspector(schematic)

    def _on_run(self) -> None:
        schematic = self.canvas.get_schematic()
        self.compose.validate_schematic(schematic)
        if hasattr(self.compose, "tabs"):
            self.compose.tabs.setCurrentIndex(2)
        if self._run_callback:
            self._run_callback(schematic)

    def _on_schematic_changed(self) -> None:
        n_c = len(self.canvas.schematic.get("components") or [])
        n_w = len(self.canvas.schematic.get("wires") or [])
        self.tool_status.setText(f"{n_c} components · {n_w} wires")
        self.compose.update_inspector(self.canvas.get_schematic())

    def load_schematic(self, schematic: dict) -> None:
        self.canvas.load_schematic(schematic)
        self._on_schematic_changed()

    def get_schematic(self) -> dict:
        return self.canvas.get_schematic()

    def set_save_callback(self, cb) -> None:
        self._save_callback = cb

    def set_run_callback(self, cb) -> None:
        self._run_callback = cb


def show_wiring_workspace(
    visible: bool = True,
    config: dict | None = None,
    *,
    fullscreen: bool = False,
) -> WiringWorkspaceDock | None:
    global _DOCK
    mw = Gui.getMainWindow()
    if mw is None:
        return None
    if _DOCK is None:
        _DOCK = WiringWorkspaceDock(config or {}, mw)
        mw.addDockWidget(QtCore.Qt.BottomDockWidgetArea, _DOCK)
        _DOCK.setMinimumHeight(420)
        try:
            mw.resizeDocks([_DOCK], [520], QtCore.Qt.Vertical)
        except Exception:
            pass
    elif config:
        _DOCK.config = dict(config)
        _DOCK.compose.config = dict(config)
    if visible:
        if fullscreen:
            _DOCK.enter_fullscreen()
        else:
            _DOCK.show()
            _DOCK.raise_()
            _DOCK.setFloating(False)
        App.Console.PrintMessage(
            "[RenderStudio] Wiring Simulator open"
            + (" (full screen)" if fullscreen else "")
            + " — breadboard · palette · Wiring AI\n"
        )
    else:
        try:
            _DOCK.exit_fullscreen()
        except Exception:
            pass
        _DOCK.hide()
        # Sync mode bar back to Design if present
        try:
            from layout_shell import sync_mode_design
        except ImportError:
            try:
                from RenderStudio.layout_shell import sync_mode_design  # type: ignore
            except ImportError:
                sync_mode_design = None
        if sync_mode_design:
            sync_mode_design()
    return _DOCK
