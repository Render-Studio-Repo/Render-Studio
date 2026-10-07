# SPDX-License-Identifier: LGPL-2.1-or-later
"""Native Qt wiring schematic canvas — breadboard layout parity with web Wiring Simulator."""

from __future__ import annotations

import json
from pathlib import Path

try:
    from qt_compat import QtCore, QtGui, QtWidgets
except ImportError:
    from RenderStudio.qt_compat import QtCore, QtGui, QtWidgets  # type: ignore


PALETTE = [
    {"type": "raspberry-pi", "label": "Raspberry Pi", "w": 148, "h": 188, "color": "#c51a4a"},
    {"type": "arduino-uno", "label": "Arduino Uno", "w": 168, "h": 104, "color": "#00979d"},
    {"type": "arduino-mega", "label": "Arduino Mega", "w": 180, "h": 100, "color": "#008184"},
    {"type": "servo-motor", "label": "Servo motor", "w": 80, "h": 80, "color": "#3fb950"},
    {"type": "stepper", "label": "Stepper motor", "w": 78, "h": 78, "color": "#6e7681"},
    {"type": "motor-driver", "label": "Motor driver", "w": 104, "h": 92, "color": "#21262d"},
    {"type": "motor", "label": "DC Motor", "w": 56, "h": 56, "color": "#2ea043"},
    {"type": "led", "label": "LED", "w": 40, "h": 40, "color": "#e3b341"},
    {"type": "resistor", "label": "Resistor", "w": 72, "h": 24, "color": "#d4a574"},
    {"type": "transistor", "label": "Transistor", "w": 48, "h": 48, "color": "#8b949e"},
    {"type": "diode", "label": "Diode", "w": 56, "h": 24, "color": "#c9d1d9"},
    {"type": "button", "label": "Push button", "w": 44, "h": 44, "color": "#8b949e"},
    {"type": "sensor", "label": "Sensor", "w": 64, "h": 48, "color": "#58a6ff"},
    {"type": "breadboard", "label": "Breadboard", "w": 340, "h": 200, "color": "#f0f0f0"},
]

_PALETTE_BY_TYPE = {p["type"]: p for p in PALETTE}
_BB_COLS = 15
_BB_ROWS = "abcdefghij"


def pin_layout(component_or_type) -> list[dict]:
    """Match frontend/wiring-simulator.js pinLayout (esp. breadboard)."""
    if isinstance(component_or_type, dict):
        ctype = str(component_or_type.get("type") or "")
    else:
        ctype = str(component_or_type or "")

    if ctype == "breadboard":
        pins = []
        cols = _BB_COLS
        for i in range(cols):
            x = 0.06 + (i / (cols - 1)) * 0.88
            pins.append({"id": f"t+_{i}", "x": x, "y": 0.06, "label": "+", "rail": "plus"})
            pins.append({"id": f"t-_{i}", "x": x, "y": 0.94, "label": "−", "rail": "minus"})
        rows = _BB_ROWS
        for r, row in enumerate(rows):
            for c in range(1, cols + 1):
                pins.append(
                    {
                        "id": f"{row}{c}",
                        "x": 0.06 + ((c - 1) / (cols - 1)) * 0.88,
                        "y": 0.22 + (r / (len(rows) - 1)) * 0.56,
                        "hole": True,
                    }
                )
        return pins

    if ctype == "resistor":
        return [
            {"id": "a", "x": 0.08, "y": 0.5, "label": "a"},
            {"id": "b", "x": 0.92, "y": 0.5, "label": "b"},
        ]
    if ctype == "transistor":
        return [
            {"id": "base", "x": 0.5, "y": 0.92, "label": "B"},
            {"id": "collector", "x": 0.15, "y": 0.35, "label": "C"},
            {"id": "emitter", "x": 0.85, "y": 0.35, "label": "E"},
        ]
    if ctype == "diode":
        return [
            {"id": "anode", "x": 0.1, "y": 0.5, "label": "A"},
            {"id": "cathode", "x": 0.9, "y": 0.5, "label": "K"},
        ]
    if ctype in ("motor", "led", "button", "sensor"):
        return [
            {"id": "a", "x": 0.15, "y": 0.5, "label": "a"},
            {"id": "b", "x": 0.85, "y": 0.5, "label": "b"},
            {"id": "plus", "x": 0.15, "y": 0.5},
            {"id": "minus", "x": 0.85, "y": 0.5},
        ]
    if ctype == "motor-driver":
        pins = []
        for i, pid in enumerate(("in1", "in2", "in3", "in4", "vcc", "gnd", "out1", "out2"), start=1):
            pins.append({"id": pid, "x": 0.08, "y": 0.12 + i * 0.09})
        return pins
    if ctype in ("arduino-uno", "arduino-mega", "raspberry-pi"):
        return [
            {"id": "5v", "x": 0.95, "y": 0.12, "label": "5V"},
            {"id": "gnd", "x": 0.95, "y": 0.22, "label": "GND"},
            {"id": "3v3", "x": 0.95, "y": 0.32, "label": "3V3"},
            {"id": "d13", "x": 0.05, "y": 0.35, "label": "D13"},
            {"id": "d12", "x": 0.05, "y": 0.45, "label": "D12"},
            {"id": "d11", "x": 0.05, "y": 0.55, "label": "D11"},
            {"id": "gpio17", "x": 0.05, "y": 0.35},
            {"id": "gpio18", "x": 0.05, "y": 0.45},
        ]
    if ctype in ("servo-motor", "stepper"):
        return [
            {"id": "signal", "x": 0.15, "y": 0.35},
            {"id": "vcc", "x": 0.15, "y": 0.55},
            {"id": "gnd", "x": 0.15, "y": 0.75},
        ]
    return [{"id": "in", "x": 0.1, "y": 0.5}, {"id": "out", "x": 0.9, "y": 0.5}]


def pin_position(component: dict, pin_id: str) -> QtCore.QPointF:
    w = float(component.get("w") or 80)
    h = float(component.get("h") or 48)
    x0 = float(component.get("x") or 0)
    y0 = float(component.get("y") or 0)
    for pin in pin_layout(component):
        if pin["id"] == pin_id:
            return QtCore.QPointF(x0 + pin["x"] * w, y0 + pin["y"] * h)
    return QtCore.QPointF(x0 + w * 0.5, y0 + h * 0.5)


class PinHotspot(QtWidgets.QGraphicsEllipseItem):
    def __init__(self, pin: dict, parent_item, radius: float = 3.2):
        super().__init__(-radius, -radius, radius * 2, radius * 2, parent_item)
        self.pin = pin
        if pin.get("rail") == "plus":
            color = QtGui.QColor("#f85149")
        elif pin.get("rail") == "minus":
            color = QtGui.QColor("#6e7681")
        elif pin.get("hole"):
            color = QtGui.QColor("#30363d")
        else:
            color = QtGui.QColor("#e3b341")
        self.setBrush(QtGui.QBrush(color))
        self.setPen(QtGui.QPen(QtGui.QColor("#0d1117"), 0.6))
        self.setZValue(5)
        self.setToolTip(str(pin.get("id") or ""))
        self.setAcceptedMouseButtons(QtCore.Qt.NoButton)


class ComponentItem(QtWidgets.QGraphicsRectItem):
    def __init__(self, component: dict):
        w = float(component.get("w") or 80)
        h = float(component.get("h") or 48)
        super().__init__(0, 0, w, h)
        self.component = component
        self.setPos(float(component.get("x") or 0), float(component.get("y") or 0))
        self.setFlags(
            QtWidgets.QGraphicsItem.ItemIsMovable
            | QtWidgets.QGraphicsItem.ItemIsSelectable
            | QtWidgets.QGraphicsItem.ItemSendsGeometryChanges
        )
        self._paint_body()
        self._add_pins()

    def _paint_body(self) -> None:
        ctype = self.component.get("type")
        w = self.rect().width()
        h = self.rect().height()
        if ctype == "breadboard":
            self.setBrush(QtGui.QBrush(QtGui.QColor("#eceff1")))
            self.setPen(QtGui.QPen(QtGui.QColor("#90a4ae"), 1.5))
            # Power rails
            plus = QtWidgets.QGraphicsRectItem(4, 2, w - 8, h * 0.10, self)
            plus.setBrush(QtGui.QBrush(QtGui.QColor("#ffcdd2")))
            plus.setPen(QtGui.QPen(QtCore.Qt.NoPen))
            minus = QtWidgets.QGraphicsRectItem(4, h * 0.88, w - 8, h * 0.10, self)
            minus.setBrush(QtGui.QBrush(QtGui.QColor("#cfd8dc")))
            minus.setPen(QtGui.QPen(QtCore.Qt.NoPen))
            # Mid divider (gap between row e and f)
            mid = QtWidgets.QGraphicsRectItem(4, h * 0.48, w - 8, h * 0.06, self)
            mid.setBrush(QtGui.QBrush(QtGui.QColor("#cfd8dc")))
            mid.setPen(QtGui.QPen(QtCore.Qt.NoPen))
            label = QtWidgets.QGraphicsSimpleTextItem(
                self.component.get("label") or "Breadboard", self
            )
            label.setBrush(QtGui.QBrush(QtGui.QColor("#546e7a")))
            label.setPos(8, h * 0.11)
            return

        color = QtGui.QColor(self.component.get("color") or "#334155")
        self.setBrush(QtGui.QBrush(color))
        self.setPen(QtGui.QPen(QtGui.QColor("#64748b"), 1.5))
        text = QtWidgets.QGraphicsSimpleTextItem(
            (self.component.get("label") or ctype or "part")[:28], self
        )
        text.setBrush(
            QtGui.QBrush(QtGui.QColor("#0f172a" if color.lightness() > 140 else "#f8fafc"))
        )
        text.setPos(6, 6)

    def _add_pins(self) -> None:
        w = self.rect().width()
        h = self.rect().height()
        for pin in pin_layout(self.component):
            hotspot = PinHotspot(pin, self, radius=2.6 if pin.get("hole") else 3.4)
            hotspot.setPos(pin["x"] * w, pin["y"] * h)

    def itemChange(self, change, value):
        if change == QtWidgets.QGraphicsItem.ItemPositionHasChanged:
            pos = self.pos()
            self.component["x"] = float(pos.x())
            self.component["y"] = float(pos.y())
        return super().itemChange(change, value)


class WireItem(QtWidgets.QGraphicsPathItem):
    def __init__(self, wire: dict, schematic: dict):
        super().__init__()
        self.wire = wire
        self.schematic = schematic
        self.setPen(QtGui.QPen(QtGui.QColor(wire.get("color") or "#58a6ff"), 2.5))
        self.setZValue(-1)
        self.refresh()

    def refresh(self):
        by_id = {c["id"]: c for c in self.schematic.get("components") or []}
        src = self.wire.get("from") or {}
        dst = self.wire.get("to") or {}
        a = pin_position(by_id.get(src.get("componentId"), {}), src.get("pinId", ""))
        b = pin_position(by_id.get(dst.get("componentId"), {}), dst.get("pinId", ""))
        # Orthogonal-ish route (web lifts wires over breadboard)
        path = QtGui.QPainterPath(a)
        mid_y = min(a.y(), b.y()) - 18
        path.lineTo(a.x(), mid_y)
        path.lineTo(b.x(), mid_y)
        path.lineTo(b)
        self.setPath(path)


class WiringCanvasView(QtWidgets.QGraphicsView):
    schematicChanged = QtCore.Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._scene = QtWidgets.QGraphicsScene(self)
        self.setScene(self._scene)
        self.setRenderHint(QtGui.QPainter.Antialiasing)
        self.setDragMode(QtWidgets.QGraphicsView.ScrollHandDrag)
        self.setBackgroundBrush(QtGui.QBrush(QtGui.QColor("#0b1220")))
        self.setTransformationAnchor(QtWidgets.QGraphicsView.AnchorUnderMouse)
        self.schematic = {"components": [], "wires": []}
        self._comp_items = {}
        self._wire_items = []

    def wheelEvent(self, event):
        factor = 1.15 if event.angleDelta().y() > 0 else 1 / 1.15
        self.scale(factor, factor)

    def load_schematic(self, schematic: dict) -> None:
        self.schematic = {
            "name": schematic.get("name"),
            "description": schematic.get("description"),
            "components": list(schematic.get("components") or []),
            "wires": list(schematic.get("wires") or []),
            "notes": list(schematic.get("notes") or []),
        }
        self._rebuild()

    def get_schematic(self) -> dict:
        return json.loads(json.dumps(self.schematic))

    def add_palette_component(self, palette_type: str) -> None:
        spec = _PALETTE_BY_TYPE.get(palette_type)
        if not spec:
            return
        idx = len(self.schematic["components"]) + 1
        comp = {
            "id": f"c_{palette_type}_{idx}",
            "type": palette_type,
            "label": spec["label"],
            "x": 80 + (idx % 5) * 40,
            "y": 80 + (idx // 5) * 40,
            "w": spec["w"],
            "h": spec["h"],
            "color": spec["color"],
        }
        self.schematic["components"].append(comp)
        self._rebuild()
        self.schematicChanged.emit()

    def _rebuild(self) -> None:
        self._scene.clear()
        self._comp_items = {}
        self._wire_items = []
        for comp in self.schematic.get("components") or []:
            item = ComponentItem(comp)
            self._scene.addItem(item)
            self._comp_items[comp["id"]] = item
        for wire in self.schematic.get("wires") or []:
            item = WireItem(wire, self.schematic)
            self._scene.addItem(item)
            self._wire_items.append(item)
        self._scene.setSceneRect(self._scene.itemsBoundingRect().adjusted(-80, -80, 80, 80))
        if self._scene.items():
            self.fitInView(self._scene.sceneRect(), QtCore.Qt.KeepAspectRatio)

    def refresh_wires(self) -> None:
        for item in self._wire_items:
            item.refresh()

    def mouseReleaseEvent(self, event):
        super().mouseReleaseEvent(event)
        self.refresh_wires()
        self.schematicChanged.emit()


class WiringPalette(QtWidgets.QListWidget):
    componentRequested = QtCore.Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumWidth(160)
        self.setMaximumWidth(200)
        self.setStyleSheet(
            """
            QListWidget {
              background: #0f172a;
              color: #e2e8f0;
              border: 1px solid #334155;
              font-size: 12px;
            }
            QListWidget::item { padding: 6px 8px; }
            QListWidget::item:selected { background: #1e293b; }
            """
        )
        for spec in PALETTE:
            item = QtWidgets.QListWidgetItem(spec["label"])
            item.setData(QtCore.Qt.UserRole, spec["type"])
            item.setToolTip(f"Double-click to place {spec['label']}")
            self.addItem(item)
        self.itemDoubleClicked.connect(self._on_dbl)

    def _on_dbl(self, item):
        self.componentRequested.emit(item.data(QtCore.Qt.UserRole))


def load_json_path(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
