"""TB6600 / PUL-DIR boxes are not DRV8825 shields."""

from __future__ import annotations

import unittest

from backend.services.wiring_service import validate_and_repair_schematic


def _tb6600_schematic() -> dict:
    return {
        "name": "TB6600 stepper",
        "components": [
            {
                "id": "pi",
                "type": "raspberry-pi",
                "label": "Raspberry Pi",
                "x": 40,
                "y": 80,
                "w": 148,
                "h": 188,
            },
            {
                "id": "drv",
                "type": "motor-driver",
                "label": "TB6600",
                "x": 420,
                "y": 80,
                "w": 104,
                "h": 92,
            },
        ],
        "wires": [
            {
                "id": "w_pul",
                "from": {"componentId": "pi", "pinId": "gpio18"},
                "to": {"componentId": "drv", "pinId": "in1"},
                "label": "PUL+",
            },
            {
                "id": "w_dir",
                "from": {"componentId": "pi", "pinId": "gpio17"},
                "to": {"componentId": "drv", "pinId": "in2"},
                "label": "DIR+",
            },
        ],
    }


class PulseDirBoxTests(unittest.TestCase):
    def test_tb6600_keeps_pul_dir_tags_and_pin_names(self) -> None:
        repaired, notes = validate_and_repair_schematic(_tb6600_schematic())
        driver = next(c for c in repaired["components"] if c["id"] == "drv")
        self.assertEqual(driver["pin_labels"]["in1"], "PUL+")
        self.assertEqual(driver["pin_labels"]["in2"], "DIR+")
        self.assertEqual(driver["pin_labels"]["out1"], "A+")
        labels = {w["id"]: w.get("label") for w in repaired["wires"]}
        self.assertEqual(labels["w_pul"], "PUL+")
        self.assertEqual(labels["w_dir"], "DIR+")
        self.assertFalse(any("dir_g" in str(note).lower() for note in notes))
        self.assertFalse(
            any(
                (w.get("from") or {}).get("pinId") == "dir_g"
                or (w.get("to") or {}).get("pinId") == "dir_g"
                for w in repaired["wires"]
            )
        )

    def test_drv8825_still_gets_shield_jumpers(self) -> None:
        schematic = {
            "name": "DRV8825",
            "components": [
                {
                    "id": "drv",
                    "type": "motor-driver",
                    "label": "DRV8825 Shield",
                    "x": 40,
                    "y": 40,
                    "w": 340,
                    "h": 230,
                }
            ],
            "wires": [],
        }
        repaired, notes = validate_and_repair_schematic(schematic)
        driver = repaired["components"][0]
        self.assertEqual(driver["pin_labels"]["in1"], "S")
        jumper_pins = {
            (w.get("from") or {}).get("pinId")
            for w in repaired["wires"]
        } | {
            (w.get("to") or {}).get("pinId")
            for w in repaired["wires"]
        }
        self.assertIn("dir_g", jumper_pins)
        self.assertTrue(any("jumper" in note.lower() for note in notes))


if __name__ == "__main__":
    unittest.main()
