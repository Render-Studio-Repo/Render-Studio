# SPDX-License-Identifier: LGPL-2.1-or-later
"""AI assistant panel — bridges to local Render Studio API."""

from __future__ import annotations

import json
import urllib.request

import FreeCAD as App

try:
    from qt_compat import QtCore, QtWidgets
except ImportError:
    from RenderStudio.qt_compat import QtCore, QtWidgets  # type: ignore


class AIAssistantWidget(QtWidgets.QWidget):
    def __init__(self, api_base: str, parent=None):
        super().__init__(parent)
        self.api_base = api_base.rstrip("/")
        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)

        self.status = QtWidgets.QLabel("Talks to local Render Studio when running.")
        self.status.setWordWrap(True)
        layout.addWidget(self.status)

        self.prompt = QtWidgets.QPlainTextEdit()
        self.prompt.setPlaceholderText("Describe the part to create or modify…")
        self.prompt.setMinimumHeight(120)
        layout.addWidget(self.prompt)

        row = QtWidgets.QHBoxLayout()
        self.btn_health = QtWidgets.QPushButton("Check API")
        self.btn_send = QtWidgets.QPushButton("Send (stub)")
        row.addWidget(self.btn_health)
        row.addWidget(self.btn_send)
        layout.addLayout(row)

        self.log = QtWidgets.QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setMaximumHeight(140)
        layout.addWidget(self.log)

        self.btn_health.clicked.connect(self.check_health)
        self.btn_send.clicked.connect(self.send_stub)

    def _append(self, text: str) -> None:
        self.log.appendPlainText(text)

    def check_health(self) -> None:
        url = f"{self.api_base}/api/health"
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            self.status.setText(f"API OK — {url}")
            self._append(body[:500])
        except Exception as exc:  # noqa: BLE001
            self.status.setText("API unreachable — start web Render Studio on :8001")
            self._append(str(exc))

    def send_stub(self) -> None:
        text = self.prompt.toPlainText().strip()
        if not text:
            self._append("Enter a prompt first.")
            return
        payload = {
            "prompt": text,
            "note": "Wire to Mode 2.0 / vibecad generate endpoint in a later phase.",
            "api_base": self.api_base,
        }
        self._append(json.dumps(payload, indent=2))
        App.Console.PrintMessage(
            "[RenderStudio] AI send is stubbed — connect to /api generate next.\n"
        )


# Back-compat standalone dock
_DOCK = None


class AIDock(QtWidgets.QDockWidget):
    def __init__(self, api_base: str, parent=None):
        super().__init__("Render Studio AI", parent)
        self.panel = AIAssistantWidget(api_base, self)
        self.setWidget(self.panel)
        self.api_base = api_base.rstrip("/")


def show_ai_dock(api_base: str) -> None:
    global _DOCK
    import FreeCADGui as Gui

    mw = Gui.getMainWindow()
    if _DOCK is None:
        _DOCK = AIDock(api_base, mw)
        mw.addDockWidget(QtCore.Qt.RightDockWidgetArea, _DOCK)
    else:
        _DOCK.api_base = api_base.rstrip("/")
        _DOCK.panel.api_base = api_base.rstrip("/")
    _DOCK.show()
    _DOCK.raise_()
