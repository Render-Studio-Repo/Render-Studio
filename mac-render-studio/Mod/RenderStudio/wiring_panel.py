# SPDX-License-Identifier: LGPL-2.1-or-later
"""Wiring Simulator tab — compose, canvas, local project I/O."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

import FreeCAD as App

try:
    from qt_compat import QtCore, QtWidgets
except ImportError:
    from RenderStudio.qt_compat import QtCore, QtWidgets  # type: ignore

try:
    from wiring_canvas_qt import WiringCanvasView, WiringPalette, load_json_path, PALETTE
except ImportError:
    from RenderStudio.wiring_canvas_qt import WiringCanvasView, WiringPalette, load_json_path, PALETTE  # type: ignore


class WiringPanel(QtWidgets.QWidget):
    """Right-panel Wiring tab: compose controls + hooks to workspace canvas."""

    statusChanged = QtCore.Signal(str)
    schematicLoaded = QtCore.Signal(dict)
    projectChanged = QtCore.Signal(str)

    def __init__(self, config: dict, parent=None):
        super().__init__(parent)
        self.config = dict(config)
        self.api_base = str(config.get("api_base", "http://127.0.0.1:8001")).rstrip("/")
        self.projects_dir = Path(config.get("projects_dir", "")).expanduser()
        self.examples_dir = Path(config.get("wiring_examples_dir", "")).expanduser()
        if not self.examples_dir.is_dir():
            self.examples_dir = self.projects_dir.parent / "frontend" / "wiring-examples"
        self._project_id = ""

        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setSpacing(8)

        head = QtWidgets.QLabel("Wiring AI")
        head.setStyleSheet("font-weight: 600; font-size: 14px;")
        layout.addWidget(head)

        hint = QtWidgets.QLabel(
            "Compose schematics, load demos, or open the canvas dock below the viewport."
        )
        hint.setWordWrap(True)
        hint.setStyleSheet("color: #94a3b8; font-size: 11px;")
        layout.addWidget(hint)

        proj_row = QtWidgets.QHBoxLayout()
        proj_row.addWidget(QtWidgets.QLabel("Project"))
        self.project_combo = QtWidgets.QComboBox()
        self.project_combo.setMinimumWidth(160)
        proj_row.addWidget(self.project_combo, 1)
        self.btn_reload_projects = QtWidgets.QPushButton("↻")
        self.btn_reload_projects.setFixedWidth(28)
        proj_row.addWidget(self.btn_reload_projects)
        layout.addLayout(proj_row)

        self.tabs = QtWidgets.QTabWidget()
        layout.addWidget(self.tabs, 1)

        compose = QtWidgets.QWidget()
        c_layout = QtWidgets.QVBoxLayout(compose)
        self.prompt = QtWidgets.QPlainTextEdit()
        self.prompt.setPlaceholderText(
            "e.g. Wire Raspberry Pi GPIO17 to a push button; GPIO18 drives a motor through a driver…"
        )
        self.prompt.setMinimumHeight(100)
        c_layout.addWidget(self.prompt)

        gen_row = QtWidgets.QHBoxLayout()
        self.btn_generate = QtWidgets.QPushButton("Generate")
        self.btn_generate.setStyleSheet("font-weight: 600;")
        self.btn_load = QtWidgets.QPushButton("Load wiring.json")
        self.btn_save = QtWidgets.QPushButton("Save")
        gen_row.addWidget(self.btn_generate)
        gen_row.addWidget(self.btn_load)
        gen_row.addWidget(self.btn_save)
        c_layout.addLayout(gen_row)

        demo_label = QtWidgets.QLabel("Demos")
        demo_label.setStyleSheet("color: #94a3b8; font-size: 11px;")
        c_layout.addWidget(demo_label)
        demo_row = QtWidgets.QHBoxLayout()
        self._demo_buttons = []
        for label, fname in (
            ("Blink LED", "blink-led-breadboard.json"),
            ("Pi → Servo", "raspberry-pi-servo.json"),
            ("Pi → Motor", "raspberry-pi-button-motor.json"),
            ("Stepper", "arduino-stepper.json"),
        ):
            btn = QtWidgets.QPushButton(label)
            btn.setProperty("demo_file", fname)
            demo_row.addWidget(btn)
            self._demo_buttons.append(btn)
        c_layout.addLayout(demo_row)

        self.btn_browser = QtWidgets.QPushButton("Open full simulator in browser")
        c_layout.addWidget(self.btn_browser)

        self.status = QtWidgets.QLabel("")
        self.status.setWordWrap(True)
        self.status.setStyleSheet("color: #64748b; font-size: 11px;")
        c_layout.addWidget(self.status)

        self.tabs.addTab(compose, "Compose")

        inspect = QtWidgets.QWidget()
        i_layout = QtWidgets.QVBoxLayout(inspect)
        i_layout.addWidget(QtWidgets.QLabel("Components"))
        self.comp_list = QtWidgets.QListWidget()
        i_layout.addWidget(self.comp_list)
        i_layout.addWidget(QtWidgets.QLabel("Wires"))
        self.wire_list = QtWidgets.QListWidget()
        i_layout.addWidget(self.wire_list)
        self.tabs.addTab(inspect, "Inspect")

        sim = QtWidgets.QWidget()
        s_layout = QtWidgets.QVBoxLayout(sim)
        s_layout.addWidget(
            QtWidgets.QLabel("Behavioural sim + Arduino codegen live in the web Wiring Simulator for now.")
        )
        self.btn_validate = QtWidgets.QPushButton("Validate schematic")
        self.btn_run_browser = QtWidgets.QPushButton("Run schematic in browser")
        s_layout.addWidget(self.btn_validate)
        s_layout.addWidget(self.btn_run_browser)
        self.sim_log = QtWidgets.QPlainTextEdit()
        self.sim_log.setReadOnly(True)
        s_layout.addWidget(self.sim_log, 1)
        self.tabs.addTab(sim, "Simulate")

        self.project_combo.currentIndexChanged.connect(self._on_project_changed)
        self.btn_reload_projects.clicked.connect(self.reload_projects)
        self.btn_generate.clicked.connect(self.generate_schematic)
        self.btn_load.clicked.connect(self.load_project_wiring)
        self.btn_save.clicked.connect(lambda: self._save_from_panel())
        self.btn_browser.clicked.connect(self.open_in_browser)
        self.btn_run_browser.clicked.connect(self.open_in_browser)
        self.btn_validate.clicked.connect(lambda: self.validate_schematic(None))
        self.btn_run_browser.clicked.connect(self.open_in_browser)
        # validate_schematic must not receive the clicked(bool) arg as schematic
        for btn in self._demo_buttons:
            btn.clicked.connect(self._load_demo_clicked)

        self.reload_projects()

    def reload_projects(self) -> None:
        self.project_combo.blockSignals(True)
        self.project_combo.clear()
        self.project_combo.addItem("(select project)", "")
        if self.projects_dir.is_dir():
            for child in sorted(self.projects_dir.iterdir()):
                if child.is_dir() and not child.name.startswith("."):
                    self.project_combo.addItem(child.name, child.name)
        self.project_combo.blockSignals(False)

    def _on_project_changed(self) -> None:
        pid = self.project_combo.currentData() or ""
        self._project_id = str(pid)
        self.projectChanged.emit(self._project_id)
        if pid:
            self.set_status(f"Project: {pid}")

    def current_project_id(self) -> str:
        return self._project_id

    def set_status(self, text: str, kind: str = "") -> None:
        color = {"ok": "#3fb950", "err": "#f85149"}.get(kind, "#64748b")
        self.status.setStyleSheet(f"color: {color}; font-size: 11px;")
        self.status.setText(text)
        self.statusChanged.emit(text)

    def update_inspector(self, schematic: dict) -> None:
        self.comp_list.clear()
        for comp in schematic.get("components") or []:
            self.comp_list.addItem(
                f"{comp.get('label') or comp.get('type')}  ({comp.get('id')})"
            )
        self.wire_list.clear()
        for wire in schematic.get("wires") or []:
            src = wire.get("from") or {}
            dst = wire.get("to") or {}
            label = wire.get("label") or ""
            self.wire_list.addItem(
                f"{src.get('pinId')} → {dst.get('pinId')}  {label}".strip()
            )

    def _load_demo_clicked(self) -> None:
        btn = self.sender()
        fname = btn.property("demo_file") if btn else ""
        path = self.examples_dir / str(fname)
        if not path.is_file():
            self.set_status(f"Demo not found: {path}", "err")
            return
        schematic = load_json_path(path)
        self.schematicLoaded.emit(schematic)
        self.update_inspector(schematic)
        self.set_status(f"Loaded demo: {schematic.get('name') or fname}", "ok")

    def load_project_wiring(self) -> None:
        if not self._project_id:
            self.set_status("Select a project first.", "err")
            return
        path = self.projects_dir / self._project_id / "wiring.json"
        if not path.is_file():
            self.set_status("No wiring.json in this project.", "err")
            return
        schematic = load_json_path(path)
        self.schematicLoaded.emit(schematic)
        self.update_inspector(schematic)
        self.set_status(f"Loaded {path.name}", "ok")

    def _save_from_panel(self) -> None:
        cb = getattr(self, "_external_save", None)
        if cb:
            cb()
        else:
            self.set_status("Use Save on the wiring canvas toolbelt.", "err")

    def set_external_save(self, cb) -> None:
        self._external_save = cb

    def save_project_wiring(self, schematic=None) -> None:
        if schematic is None:
            self.set_status("Nothing to save — load or create a schematic first.", "err")
            return
        if not self._project_id:
            self.set_status("Select a project to save wiring.json.", "err")
            return
        path = self.projects_dir / self._project_id / "wiring.json"
        path.write_text(json.dumps(schematic, indent=2), encoding="utf-8")
        self.set_status(f"Saved {path}", "ok")
        App.Console.PrintMessage(f"[RenderStudio] Saved wiring to {path}\n")

    def generate_schematic(self) -> None:
        text = self.prompt.toPlainText().strip()
        if not text:
            self.set_status("Enter a wiring prompt first.", "err")
            return
        if not self._project_id:
            self.set_status("Select a project — generation saves to its wiring.json.", "err")
            return
        url = f"{self.api_base}/api/projects/{self._project_id}/wiring/prompt"
        payload = json.dumps({"prompt": text, "speed": "fast"}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            self.set_status(f"API error {exc.code} — sign in on web or check server. {detail}", "err")
            return
        except Exception as exc:  # noqa: BLE001
            self.set_status(f"API unreachable — start Render Studio on :8001. {exc}", "err")
            return
        schematic = body.get("schematic") or body
        if isinstance(schematic, dict) and schematic.get("components"):
            self.schematicLoaded.emit(schematic)
            self.update_inspector(schematic)
            self.set_status(body.get("message") or "Schematic generated.", "ok")
        else:
            self.set_status("Generation started — poll project or use web UI if async.", "ok")

    def validate_schematic(self, schematic: dict | None = None) -> None:
        if not schematic or not schematic.get("components"):
            self.sim_log.setPlainText("Load a schematic first.")
            return
        issues = []
        comps = schematic.get("components") or []
        wires = schematic.get("wires") or []
        has_controller = any(c.get("type") in ("raspberry-pi", "arduino-uno", "arduino-mega") for c in comps)
        has_driver = any(c.get("type") == "motor-driver" for c in comps)
        has_motor = any(c.get("type") in ("motor", "stepper", "servo-motor") for c in comps)
        if has_motor and has_controller and not has_driver:
            issues.append("Motor/stepper present but no motor-driver — add ULN2003/L298N/A4988.")
        if not wires:
            issues.append("No wires — schematic is empty.")
        if not comps:
            issues.append("No components.")
        lines = [
            f"Components: {len(comps)}",
            f"Wires: {len(wires)}",
            "",
        ]
        if issues:
            lines.append("Issues:")
            lines.extend(f"  • {i}" for i in issues)
        else:
            lines.append("Basic checks passed. Run full sim in browser for codegen + animation.")
        notes = schematic.get("notes") or []
        if notes:
            lines.extend(["", "Notes:"])
            lines.extend(f"  • {n}" for n in notes[:6])
        self.sim_log.setPlainText("\n".join(lines))

    def open_in_browser(self) -> None:
        import webbrowser

        pid = self._project_id or ""
        url = f"{self.api_base}/"
        if pid:
            url = f"{self.api_base}/?project={pid}#wiring"
        webbrowser.open(url)
        self.set_status("Opened web Wiring Simulator — switch to Wiring mode in the right tabs.", "ok")
