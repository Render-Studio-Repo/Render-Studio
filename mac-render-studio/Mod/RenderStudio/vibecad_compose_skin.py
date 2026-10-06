# SPDX-License-Identifier: LGPL-2.1-or-later
"""Render Studio compose chrome on the native VibeCAD / VibeScript assistant."""

from __future__ import annotations

import FreeCAD as App
import FreeCADGui as Gui

try:
    from qt_compat import QtCore, QtWidgets
except ImportError:
    from RenderStudio.qt_compat import QtCore, QtWidgets  # type: ignore

try:
    from env_loader import provider_status
except ImportError:
    from RenderStudio.env_loader import provider_status  # type: ignore

DOCK_NAME = "VibeCADAssistantPanel"
_SKIN_APPLIED = False

COMPOSE_QSS = """
#RenderStudioComposeToolbar {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(48, 54, 61, 0.75);
  border-radius: 10px;
  padding: 4px;
}
#RenderStudioComposeTitle {
  font-size: 14px;
  font-weight: 700;
  color: #e6edf3;
}
#RenderStudioKeyPill {
  border: 1px solid rgba(48, 54, 61, 0.9);
  border-radius: 8px;
  background: rgba(13, 17, 23, 0.85);
  color: #c9d1d9;
  padding: 4px 8px;
  font-size: 11px;
}
#RenderStudioModePill {
  border: 1px solid rgba(212, 160, 23, 0.45);
  border-radius: 999px;
  background: rgba(240, 192, 64, 0.12);
  color: #f0c040;
  padding: 4px 10px;
  font-weight: 700;
  font-size: 11px;
}
#RenderStudioEnginePill {
  border: 1px solid rgba(48, 54, 61, 0.9);
  border-radius: 999px;
  background: #0d1117;
  color: #8b949e;
  padding: 4px 10px;
  font-weight: 700;
  font-size: 11px;
}
#VibePrompt {
  background: #0d1117;
  color: #e6edf3;
  border: 1px solid rgba(48, 54, 61, 0.95);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.45;
  selection-background-color: #264f78;
}
#VibePrompt:focus {
  border-color: rgba(88, 166, 255, 0.55);
}
#VibeComposer {
  background: transparent;
}
#VibeConversation {
  background: #0b1220;
  color: #c9d1d9;
  border: 1px solid rgba(48, 54, 61, 0.55);
  border-radius: 8px;
  padding: 6px;
}
#VibeThinking {
  background: #0f172a;
  color: #94a3b8;
  border: 1px solid rgba(48, 54, 61, 0.45);
  border-radius: 8px;
  padding: 4px 6px;
  font-size: 11px;
}
#VibeSend {
  background: #238636;
  color: #ffffff;
  border: 1px solid #2ea043;
  border-radius: 8px;
  font-weight: 700;
  padding: 6px 14px;
}
#VibeSend:hover {
  background: #2ea043;
}
#VibeStop {
  background: #da3633;
  color: #ffffff;
  border: 1px solid #f85149;
  border-radius: 8px;
  font-weight: 700;
  padding: 6px 12px;
}
#VibePanelRoot {
  background: #0b1220;
}
QComboBox#VibeInteractionMode,
QComboBox#RenderStudioSpeedSelect {
  background: #161b22;
  color: #e6edf3;
  border: 1px solid rgba(48, 54, 61, 0.9);
  border-radius: 8px;
  padding: 4px 8px;
  min-height: 24px;
}
"""


class ComposeToolbar(QtWidgets.QWidget):
    def __init__(self, config: dict | None = None, parent=None):
        super().__init__(parent)
        self.setObjectName("RenderStudioComposeToolbar")
        self.config = dict(config or {})
        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 6)
        layout.setSpacing(6)

        head = QtWidgets.QHBoxLayout()
        title = QtWidgets.QLabel("VibeScript")
        title.setObjectName("RenderStudioComposeTitle")
        head.addWidget(title)
        head.addStretch(1)

        self.key_pill = QtWidgets.QLabel("")
        self.key_pill.setObjectName("RenderStudioKeyPill")
        head.addWidget(self.key_pill)
        layout.addLayout(head)

        mode_row = QtWidgets.QHBoxLayout()
        mode_20 = QtWidgets.QLabel("2.0")
        mode_20.setObjectName("RenderStudioModePill")
        engine = QtWidgets.QLabel("VibeCAD")
        engine.setObjectName("RenderStudioEnginePill")
        mode_row.addWidget(mode_20)
        mode_row.addWidget(engine)
        mode_row.addSpacing(8)
        mode_row.addWidget(QtWidgets.QLabel("Speed"))
        self.speed = QtWidgets.QComboBox()
        self.speed.setObjectName("RenderStudioSpeedSelect")
        for label, value in (
            ("Fast", "low"),
            ("Balanced", "medium"),
            ("Quality", "high"),
        ):
            self.speed.addItem(label, value)
        mode_row.addWidget(self.speed)
        mode_row.addStretch(1)
        layout.addLayout(mode_row)

        hint = QtWidgets.QLabel(
            "Describe parts in natural language — VibeScript builds parametric CAD in-document."
        )
        hint.setWordWrap(True)
        hint.setStyleSheet("color: #64748b; font-size: 11px;")
        layout.addWidget(hint)

        self._refresh_keys()
        self.speed.currentIndexChanged.connect(self._on_speed_changed)
        self._sync_speed_from_prefs()

    def _sync_speed_from_prefs(self) -> None:
        try:
            from VibeCADPreferences import load_settings

            effort = load_settings().reasoning_effort
            idx = max(0, self.speed.findData(effort))
            self.speed.blockSignals(True)
            self.speed.setCurrentIndex(idx)
            self.speed.blockSignals(False)
        except Exception:
            pass

    def _refresh_keys(self) -> None:
        status = provider_status(self.config)
        parts = []
        if status.get("openai"):
            parts.append("OpenAI ✓")
        if status.get("anthropic"):
            parts.append("Anthropic ✓")
        if status.get("kimi"):
            parts.append("Kimi ✓")
        if status.get("xai"):
            parts.append("xAI ✓")
        self.key_pill.setText(" · ".join(parts) if parts else "No API keys in .env")

    def _on_speed_changed(self) -> None:
        effort = self.speed.currentData() or "medium"
        try:
            from dataclasses import replace

            from VibeCADPreferences import load_settings, save_settings

            current = load_settings()
            save_settings(replace(current, reasoning_effort=str(effort)))
        except Exception:
            pass


def _find_dock():
    mw = Gui.getMainWindow()
    if mw is None:
        return None
    for dock in mw.findChildren(QtWidgets.QDockWidget):
        name = dock.objectName() or ""
        title = dock.windowTitle() or ""
        if name == DOCK_NAME or DOCK_NAME in title:
            return dock
        if "Assistant" in title and ("VibeCAD" in title or "VibeScript" in title):
            return dock
    return None


def _find_child(widget, name: str, cls=QtWidgets.QWidget):
    if widget is None:
        return None
    found = widget.findChild(cls, name)
    return found


def apply_compose_skin(config: dict | None = None) -> bool:
    global _SKIN_APPLIED
    dock = _find_dock()
    if dock is None:
        return False

    root = dock.widget()
    if root is None:
        return False

    prompt = _find_child(root, "VibePrompt", QtWidgets.QPlainTextEdit)
    if prompt is None:
        return False

    dock.setWindowTitle("Render Studio · VibeScript")
    root.setStyleSheet(COMPOSE_QSS)

    composer = _find_child(root, "VibeComposer")
    if composer is not None and composer.findChild(QtWidgets.QWidget, "RenderStudioComposeToolbar") is None:
        toolbar = ComposeToolbar(config, composer)
        layout = composer.layout()
        if layout is not None:
            layout.insertWidget(0, toolbar)

    prompt.setPlaceholderText(
        "Describe the part to create or change… e.g. NEMA17 motor mount, 80×60 mm, "
        "four M3 holes on a 50 mm bolt circle."
    )
    prompt.setMinimumHeight(120)

    send = _find_child(root, "VibeSend", QtWidgets.QPushButton)
    if send is not None:
        send.setText("Generate")

    if not _SKIN_APPLIED:
        App.Console.PrintMessage("[RenderStudio] VibeScript compose skin applied\n")
        _SKIN_APPLIED = True
    return True


def show_vibescript_assistant() -> None:
    try:
        from VibeCADGui import show_assistant_for_active_workbench

        show_assistant_for_active_workbench()
    except ImportError:
        dock = _find_dock()
        if dock is not None:
            dock.show()
            dock.raise_()


def schedule_compose_skin(config: dict | None = None, attempts: int = 24) -> None:
    """Retry until VibeCAD assistant panel is built, then skin it."""

    def _try(remaining: int) -> None:
        if apply_compose_skin(config):
            show_vibescript_assistant()
            return
        if remaining <= 0:
            App.Console.PrintWarning(
                "[RenderStudio] VibeScript panel not ready — use Render Studio → VibeScript\n"
            )
            return
        QtCore.QTimer.singleShot(500, lambda: _try(remaining - 1))

    _try(attempts)
