"""Fritzing / custom wiring skins cover every electronics type."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from backend.services.wiring_service import (
    COMMON_DRIVER_PROFILES,
    WIRING_SYSTEM_PROMPT,
    validate_and_repair_schematic,
)

ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / "frontend" / "wiring-parts" / "catalog.json"


def resolve_skin(component: dict, catalog: dict) -> str | None:
    label = str(component.get("label") or "")
    ctype = str(component.get("type") or "")
    for skin in catalog["skins"]:
        label_re = skin.get("labelRe")
        type_name = skin.get("type")
        type_ok = True if not type_name else type_name == ctype
        label_ok = True if not label_re else bool(re.search(label_re, label, re.I))
        if type_ok and label_ok and (label_re or type_name):
            return skin["id"]
    return None


class WiringPartCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalog = json.loads(CATALOG_PATH.read_text())

    def test_every_catalog_file_exists(self) -> None:
        root = CATALOG_PATH.parent
        self.assertTrue(self.catalog["skins"])
        for skin in self.catalog["skins"]:
            path = root / skin["src"]
            self.assertTrue(path.is_file(), f"missing {skin['id']}: {path}")
            self.assertGreater(path.stat().st_size, 200, skin["id"])

    def test_mks_is_not_arduino_mega_skin(self) -> None:
        self.assertEqual(
            resolve_skin({"type": "arduino-mega", "label": "MKS Gen L V1.0 · USB powered"}, self.catalog),
            "mks-gen-l",
        )
        self.assertEqual(
            resolve_skin({"type": "arduino-mega", "label": "Arduino Mega 2560"}, self.catalog),
            "mega",
        )

    def test_cl86t_is_not_tb6600_skin(self) -> None:
        self.assertEqual(
            resolve_skin({"type": "motor-driver", "label": "CL86T V4.1 · 5V inputs"}, self.catalog),
            "cl86t",
        )
        self.assertEqual(
            resolve_skin({"type": "motor-driver", "label": "TB6600"}, self.catalog),
            "tb6600",
        )

    def test_every_simulator_type_has_a_skin(self) -> None:
        types = {
            "raspberry-pi",
            "arduino-uno",
            "arduino-mega",
            "breadboard",
            "servo-motor",
            "stepper",
            "motor-driver",
            "motor",
            "led",
            "resistor",
            "transistor",
            "diode",
            "button",
            "sensor",
            "power-supply",
        }
        for wiring_type in types:
            skin = resolve_skin({"type": wiring_type, "label": wiring_type}, self.catalog)
            self.assertTrue(skin, f"no skin for {wiring_type}")

    def test_prompt_keeps_product_names(self) -> None:
        self.assertIn("MKS Gen L", WIRING_SYSTEM_PROMPT)
        self.assertIn("CL86T", WIRING_SYSTEM_PROMPT)
        self.assertIn("Do not relabel CL86T as TB6600", WIRING_SYSTEM_PROMPT)
        self.assertIn("include a raspberry-pi component", WIRING_SYSTEM_PROMPT)
        self.assertIn("SCHEMATIC SANITY-CHECK", WIRING_SYSTEM_PROMPT)
        self.assertIn("cross-check", WIRING_SYSTEM_PROMPT.lower())
        self.assertIn("do not crawl the web", WIRING_SYSTEM_PROMPT.lower())

    def test_cl86t_profile_is_distinct(self) -> None:
        self.assertEqual(COMMON_DRIVER_PROFILES["cl86t"]["simulator_label"], "CL86T")
        self.assertNotEqual(COMMON_DRIVER_PROFILES["cl86t"]["simulator_label"], "TB6600")

    def test_cl86t_schematic_keeps_pul_dir_and_label(self) -> None:
        schematic = {
            "name": "CL86T",
            "components": [
                {
                    "id": "mks",
                    "type": "arduino-mega",
                    "label": "MKS Gen L V1.0",
                    "x": 32,
                    "y": 80,
                    "w": 190,
                    "h": 120,
                },
                {
                    "id": "drv",
                    "type": "motor-driver",
                    "label": "CL86T V4.1",
                    "x": 420,
                    "y": 80,
                    "w": 176,
                    "h": 132,
                },
            ],
            "wires": [
                {
                    "id": "w_pul",
                    "from": {"componentId": "mks", "pinId": "a0"},
                    "to": {"componentId": "drv", "pinId": "in1"},
                    "label": "PUL+",
                },
                {
                    "id": "w_dir",
                    "from": {"componentId": "mks", "pinId": "a1"},
                    "to": {"componentId": "drv", "pinId": "in2"},
                    "label": "DIR+",
                },
            ],
        }
        repaired, notes = validate_and_repair_schematic(schematic)
        driver = next(c for c in repaired["components"] if c["id"] == "drv")
        self.assertEqual(driver["label"], "CL86T V4.1")
        self.assertEqual(driver["pin_labels"]["in1"], "PUL+")
        self.assertEqual(driver["pin_labels"]["in2"], "DIR+")
        self.assertFalse(any("dir_g" in str(note).lower() for note in notes))


if __name__ == "__main__":
    unittest.main()
