# SPDX-License-Identifier: LGPL-2.1-or-later
"""Render Studio desktop layout — additive banner + docks (never strip FreeCAD UI)."""

from __future__ import annotations

import traceback

import FreeCAD as App
import FreeCADGui as Gui

try:
    from qt_compat import QtCore, QtGui, QtWidgets
except ImportError:
    from RenderStudio.qt_compat import QtCore, QtGui, QtWidgets  # type: ignore

try:
    from pathlib import Path

    def _logo_path():
        for mod_name in ("InitGui", "RenderStudio.InitGui"):
            try:
                parts = mod_name.split(".")
                m = __import__(mod_name, fromlist=[parts[-1]])
                mod_dir = Path(m.MOD_DIR)
                candidate = mod_dir / "Resources" / "render3d-logo.png"
                if candidate.is_file():
                    return candidate
            except Exception:
                continue
        fallback = Path(__file__).resolve().parent / "Resources" / "render3d-logo.png"
        return fallback if fallback.is_file() else None
except Exception:
    def _logo_path():
        return None


def _apply_window_icon(mw) -> None:
    path = _logo_path()
    if path and mw is not None:
        icon = QtGui.QIcon(str(path))
        if not icon.isNull():
            mw.setWindowIcon(icon)


_APPLIED = False
_MODE_BAR = None
_BANNER_TB = None
_RIGHT_PANEL = None

# Scoped only to our banner — never apply to QMainWindow (breaks FreeCAD tabs/toolbars).
_BANNER_QSS = """
QWidget#RenderStudioModeBar {
  background: #0b1220;
  border-bottom: 1px solid #1e293b;
}
QWidget#RenderStudioModeBar QPushButton {
  background: #1e293b;
  color: #e2e8f0;
  border: 1px solid #475569;
  border-radius: 4px;
  padding: 4px 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
QWidget#RenderStudioModeBar QPushButton:checked {
  background: #334155;
  border-color: #58a6ff;
  color: #f8fafc;
}
QWidget#RenderStudioModeBar QPushButton:hover {
  background: #334155;
}
QWidget#RenderStudioModeBar QLabel {
  color: #94a3b8;
}
"""


class ModeBar(QtWidgets.QWidget):
    """Additive top strip — does not replace FreeCAD menus or toolbars."""

    modeChanged = QtCore.Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("RenderStudioModeBar")
        self._mode = "design"
        self.setStyleSheet(_BANNER_QSS)
        row = QtWidgets.QHBoxLayout(self)
        row.setContentsMargins(8, 4, 8, 4)
        row.setSpacing(8)

        self.btn_design = QtWidgets.QPushButton("◧ DESIGN")
        self.btn_wiring = QtWidgets.QPushButton("⚡ WIRING")
        self.btn_wiring.setToolTip("Open Wiring Simulator full screen (breadboard · palette · Wiring AI)")
        for btn in (self.btn_design, self.btn_wiring):
            btn.setCheckable(True)
        self.btn_design.setChecked(True)
        row.addWidget(self.btn_design)
        row.addWidget(self.btn_wiring)

        # Ribbon-style tabs strip (additive — FreeCAD workbench tabs stay elsewhere)
        self.ribbon_tabs = QtWidgets.QWidget()
        rt = QtWidgets.QHBoxLayout(self.ribbon_tabs)
        rt.setContentsMargins(12, 0, 0, 0)
        rt.setSpacing(4)
        self.btn_tab_create = QtWidgets.QPushButton("Create")
        self.btn_tab_wiring = QtWidgets.QPushButton("Wiring")
        self.btn_tab_wiring.setToolTip("Full-screen Wiring Simulator")
        for b in (self.btn_tab_create, self.btn_tab_wiring):
            b.setFlat(True)
            b.setCursor(QtCore.Qt.PointingHandCursor)
            b.setStyleSheet(
                "QPushButton { color: #94a3b8; padding: 4px 10px; border: none; font-weight: 600; }"
                "QPushButton:hover { color: #e2e8f0; }"
                "QPushButton:checked { color: #58a6ff; border-bottom: 2px solid #58a6ff; }"
            )
            b.setCheckable(True)
            rt.addWidget(b)
        self.btn_tab_create.setChecked(True)
        row.addWidget(self.ribbon_tabs)

        self.tabs = QtWidgets.QLabel("· FreeCAD tools stay above")
        row.addWidget(self.tabs)
        row.addStretch(1)

        logo_path = _logo_path()
        if logo_path:
            pix = QtGui.QPixmap(str(logo_path))
            if not pix.isNull():
                logo = QtWidgets.QLabel()
                logo.setPixmap(
                    pix.scaled(22, 22, QtCore.Qt.KeepAspectRatio, QtCore.Qt.SmoothTransformation)
                )
                logo.setToolTip("Render Studio")
                row.addWidget(logo)
        else:
            brand = QtWidgets.QLabel("Render Studio")
            brand.setStyleSheet("color: #64748b; font-size: 11px;")
            row.addWidget(brand)

        self.setFixedHeight(36)
        self.btn_design.clicked.connect(lambda: self.set_mode("design"))
        self.btn_wiring.clicked.connect(lambda: self.set_mode("wiring"))
        self.btn_tab_create.clicked.connect(lambda: self.set_mode("design"))
        self.btn_tab_wiring.clicked.connect(lambda: self.set_mode("wiring"))

    def set_mode(self, mode: str, *, emit: bool = True) -> None:
        same = self._mode == mode
        self._mode = mode
        self.btn_design.setChecked(mode == "design")
        self.btn_wiring.setChecked(mode == "wiring")
        self.btn_tab_create.setChecked(mode == "design")
        self.btn_tab_wiring.setChecked(mode == "wiring")
        self.tabs.setText(
            "· full-screen Wiring Simulator"
            if mode == "wiring"
            else "· FreeCAD tools stay above"
        )
        if same or not emit:
            return
        self.modeChanged.emit(mode)


def sync_mode_design() -> None:
    """Called when Wiring fullscreen closes — snap banner back to Design."""
    global _MODE_BAR
    if _MODE_BAR is not None:
        _MODE_BAR.set_mode("design", emit=False)


def _restore_freecad_menu_bar(mw) -> None:
    """Undo a previous setMenuWidget theft — FreeCAD menus/toolbars come back."""
    try:
        stolen = mw.menuWidget()
        if stolen is not None and (
            stolen.objectName() == "RenderStudioModeBar"
            or stolen.findChild(QtWidgets.QWidget, "RenderStudioModeBar") is not None
        ):
            mw.setMenuWidget(None)
            App.Console.PrintMessage(
                "[RenderStudio] Restored FreeCAD menu bar (removed prior menuWidget override)\n"
            )
    except Exception as exc:  # noqa: BLE001
        App.Console.PrintWarning(f"[RenderStudio] menu restore: {exc}\n")
    try:
        mb = mw.menuBar()
        if mb is not None:
            mb.setVisible(True)
            mb.show()
    except Exception:
        pass


def _attach_banner_toolbar(mw, mode_bar: ModeBar):
    """Add ModeBar as a normal toolbar — additive, movable, does not replace menus."""
    global _BANNER_TB
    if _BANNER_TB is not None:
        try:
            if _BANNER_TB.parent() is not None:
                return _BANNER_TB
        except Exception:
            _BANNER_TB = None

    tb = mw.addToolBar("Render Studio Banner")
    tb.setObjectName("RenderStudioBannerToolbar")
    tb.setMovable(True)
    tb.setFloatable(False)
    try:
        tb.setToolButtonStyle(QtCore.Qt.ToolButtonTextOnly)
    except Exception:
        pass
    # Stretch the banner across the toolbar
    mode_bar.setParent(tb)
    tb.addWidget(mode_bar)
    try:
        tb.setMinimumHeight(40)
    except Exception:
        pass
    _BANNER_TB = tb
    return tb


def apply_layout(config: dict) -> None:
    """Mount Render Studio docks + banner. Never strip FreeCAD chrome."""
    global _APPLIED, _MODE_BAR, _RIGHT_PANEL

    try:
        from env_loader import apply_env
    except ImportError:
        from RenderStudio.env_loader import apply_env  # type: ignore

    try:
        from vibecad_compose_skin import schedule_compose_skin
    except ImportError:
        from RenderStudio.vibecad_compose_skin import schedule_compose_skin  # type: ignore

    apply_env(config)
    try:
        from projects_dock import show_projects_dock
    except ImportError:
        from RenderStudio.projects_dock import show_projects_dock  # type: ignore

    try:
        from right_panel import show_right_panel
    except ImportError:
        from RenderStudio.right_panel import show_right_panel  # type: ignore

    try:
        from wiring_workspace_dock import show_wiring_workspace
    except ImportError:
        from RenderStudio.wiring_workspace_dock import show_wiring_workspace  # type: ignore

    mw = Gui.getMainWindow()
    if mw is None:
        return

    # Soft title prefix — do not fight FreeCAD window chrome hard
    try:
        title = mw.windowTitle() or ""
        if "Render Studio" not in title:
            mw.setWindowTitle(f"Render Studio — {title}" if title else "Render Studio")
    except Exception:
        pass
    _apply_window_icon(mw)

    # CRITICAL: never use setMenuWidget — that deleted FreeCAD's File/Edit/… menus.
    _restore_freecad_menu_bar(mw)
    # CRITICAL: never mw.setStyleSheet(...) — breaks FreeCAD workbench tabs/toolbars.

    if _MODE_BAR is None:
        _MODE_BAR = ModeBar(None)
    _attach_banner_toolbar(mw, _MODE_BAR)

    show_projects_dock(config.get("projects_dir", ""), config.get("api_base", "http://127.0.0.1:8001"))
    _RIGHT_PANEL = show_right_panel(config)
    if _RIGHT_PANEL is not None:
        try:
            _RIGHT_PANEL.setMinimumWidth(300)
        except Exception:
            pass

    if not _APPLIED:
        def _on_mode(mode: str) -> None:
            try:
                if mode == "wiring":
                    if _RIGHT_PANEL:
                        _RIGHT_PANEL.tab_bar.blockSignals(True)
                        _RIGHT_PANEL.tab_bar.setCurrentIndex(1)
                        _RIGHT_PANEL.stack.setCurrentIndex(1)
                        _RIGHT_PANEL.tab_bar.blockSignals(False)
                    show_wiring_workspace(
                        visible=True,
                        config=_RIGHT_PANEL.config if _RIGHT_PANEL else {},
                        fullscreen=True,
                    )
                else:
                    show_wiring_workspace(visible=False)
                    if _RIGHT_PANEL:
                        _RIGHT_PANEL.tab_bar.blockSignals(True)
                        _RIGHT_PANEL.tab_bar.setCurrentIndex(0)
                        _RIGHT_PANEL.stack.setCurrentIndex(0)
                        _RIGHT_PANEL.tab_bar.blockSignals(False)
                        _RIGHT_PANEL._on_tab(0)
            except Exception as exc:  # noqa: BLE001
                App.Console.PrintError(f"[RenderStudio] mode switch failed: {exc}\n")
                App.Console.PrintError(traceback.format_exc())

        if _MODE_BAR:
            _MODE_BAR.modeChanged.connect(_on_mode)

        if _RIGHT_PANEL:
            def _on_tab(key: str) -> None:
                try:
                    if _MODE_BAR:
                        if key == "wiring":
                            _MODE_BAR.set_mode("wiring", emit=False)
                        elif key == "vibescript":
                            _MODE_BAR.set_mode("design", emit=False)
                except Exception as exc:  # noqa: BLE001
                    App.Console.PrintError(f"[RenderStudio] tab sync failed: {exc}\n")

            _RIGHT_PANEL.tabChanged.connect(_on_tab)

        App.Console.PrintMessage(
            "[RenderStudio] Additive layer ready — FreeCAD menus/toolbars kept; "
            "Projects (left), VibeScript|Wiring (right), banner toolbar\n"
        )
        _APPLIED = True
        try:
            schedule_compose_skin(config)
        except Exception as exc:  # noqa: BLE001
            App.Console.PrintWarning(f"[RenderStudio] compose skin: {exc}\n")
