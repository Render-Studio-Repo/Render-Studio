# SPDX-License-Identifier: LGPL-2.1-or-later
"""VibeScript tab — opens styled VibeCAD assistant (Render Studio compose)."""

from __future__ import annotations

import FreeCAD as App

try:
    from qt_compat import QtCore, QtWidgets
except ImportError:
    from RenderStudio.qt_compat import QtCore, QtWidgets  # type: ignore

try:
    from env_loader import provider_status, resolve_env_path
    from vibecad_compose_skin import (
        apply_compose_skin,
        schedule_compose_skin,
        show_vibescript_assistant,
    )
except ImportError:
    from RenderStudio.env_loader import provider_status, resolve_env_path  # type: ignore
    from RenderStudio.vibecad_compose_skin import (  # type: ignore
        apply_compose_skin,
        schedule_compose_skin,
        show_vibescript_assistant,
    )


class VibeScriptPanel(QtWidgets.QWidget):
    def __init__(self, config: dict | None = None, parent=None):
        super().__init__(parent)
        self.config = dict(config or {})
        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(10)

        card = QtWidgets.QFrame()
        card.setObjectName("RenderStudioVibeScriptCard")
        card.setStyleSheet(
            """
            QFrame#RenderStudioVibeScriptCard {
              background: rgba(255,255,255,0.03);
              border: 1px solid rgba(48,54,61,0.75);
              border-radius: 10px;
            }
            """
        )
        card_layout = QtWidgets.QVBoxLayout(card)
        card_layout.setContentsMargins(10, 10, 10, 10)

        title = QtWidgets.QLabel("VibeScript CAD")
        title.setStyleSheet("font-size: 15px; font-weight: 700; color: #e6edf3;")
        card_layout.addWidget(title)

        env_path = resolve_env_path(self.config)
        env_label = env_path if env_path else "No .env"
        self.env_status = QtWidgets.QLabel(f"Keys: {self._keys_label()}\n{env_label}")
        self.env_status.setWordWrap(True)
        self.env_status.setStyleSheet("color: #94a3b8; font-size: 11px;")
        card_layout.addWidget(self.env_status)

        self.btn_open = QtWidgets.QPushButton("Open VibeScript composer")
        self.btn_open.setStyleSheet(
            "font-weight: 700; background: #238636; border: 1px solid #2ea043; "
            "border-radius: 8px; padding: 8px 12px; color: white;"
        )
        self.btn_refresh = QtWidgets.QPushButton("Refresh keys")
        row = QtWidgets.QHBoxLayout()
        row.addWidget(self.btn_open, 1)
        row.addWidget(self.btn_refresh)
        card_layout.addLayout(row)

        hint = QtWidgets.QLabel(
            "The composer dock opens beside this panel with Render Studio styling — "
            "same 2.0 / VibeCAD flow as the web app."
        )
        hint.setWordWrap(True)
        hint.setStyleSheet("color: #64748b; font-size: 11px;")
        card_layout.addWidget(hint)
        layout.addWidget(card)
        layout.addStretch(1)

        self.btn_open.clicked.connect(self.open_composer)
        self.btn_refresh.clicked.connect(self.refresh_env)

    def _keys_label(self) -> str:
        status = provider_status(self.config)
        parts = [name for name, ok in status.items() if ok]
        return ", ".join(parts) if parts else "none configured"

    def refresh_env(self) -> None:
        try:
            from env_loader import apply_env
        except ImportError:
            from RenderStudio.env_loader import apply_env  # type: ignore
        apply_env(self.config)
        env_path = resolve_env_path(self.config)
        self.env_status.setText(f"Keys: {self._keys_label()}\n{env_path or 'No .env'}")
        apply_compose_skin(self.config)

    def open_composer(self) -> None:
        self.refresh_env()
        show_vibescript_assistant()
        schedule_compose_skin(self.config, attempts=8)
        App.Console.PrintMessage("[RenderStudio] VibeScript composer opened\n")
