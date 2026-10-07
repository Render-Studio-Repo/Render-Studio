"""CAD joints become an open/close rig when Astra returns no bones."""

from __future__ import annotations

import unittest

from backend.services.rigging_service import infer_rig_kind, rig_from_cad_joints


class RiggingJointsTests(unittest.TestCase):
    def test_infer_open_close_for_purse(self) -> None:
        self.assertEqual(
            infer_rig_kind('Add a new named rig, "Purse_Open_Close", hinge the lid'),
            "open_close",
        )

    def test_rig_from_clutch_joints(self) -> None:
        doc = {
            "units": {"length": "mm", "angle": "deg"},
            "joints": [
                {"id": "ground_base", "type": "fixed", "parent": "world", "child": "shell_base", "anchor": [0, 0, 0], "axis": [1, 0, 0]},
                {
                    "id": "lid_hinge",
                    "type": "revolute",
                    "parent": "shell_base",
                    "child": "shell_lid",
                    "anchor": [0, 0, 0],
                    "axis": [1, 0, 0],
                    "limits": [0.0, 110.0],
                },
                {"id": "pin_retention", "type": "fixed", "parent": "shell_base", "child": "retained_pin", "anchor": [0, 0, 0], "axis": [1, 0, 0]},
            ],
        }
        rig = rig_from_cad_joints(doc, name="Purse_Open_Close")
        self.assertIsNotNone(rig)
        names = [b["name"] for b in rig["bones"]]
        self.assertEqual(names, ["shell_base", "shell_lid", "retained_pin"])
        lid = next(b for b in rig["bones"] if b["name"] == "shell_lid")
        self.assertEqual(lid["jointType"], "revolute")
        self.assertAlmostEqual(lid["limits"]["upper"], 110.0 * 3.141592653589793 / 180.0, places=5)
        self.assertEqual(len(rig["animations"][0]["keyframes"]), 3)

    def test_rig_to_urdf_omits_dummy_spheres(self) -> None:
        from backend.services.rigging_service import rig_from_cad_joints, rig_to_urdf

        doc = {
            "joints": [
                {"type": "revolute", "parent": "shell_base", "child": "shell_lid", "anchor": [0, 0, 0], "axis": [1, 0, 0], "limits": [0, 90]},
            ]
        }
        rig = rig_from_cad_joints(doc, name="Purse_Open_Close")
        xml = rig_to_urdf(rig)
        self.assertNotIn("sphere", xml)
        self.assertNotIn("<visual>", xml)
        import xml.etree.ElementTree as ET
        self.assertIsNotNone(ET.fromstring(xml).find("link[@name='shell_lid']"))
        self.assertIn('type="revolute"', xml)


if __name__ == "__main__":
    unittest.main()
