"""Sidecar QC for wheel-drive rigging. Token rigqc1."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.services.rig_qc import qc_rig_fix, inspect_project, wheel_fix_packet, TOKEN, urdf_has_dummy_spheres
from backend.services.rigging_service import infer_rig_kind, rig_from_cad_joints, rig_to_urdf


class RigQcTests(unittest.TestCase):
    def test_infer_wheels(self) -> None:
        self.assertEqual(infer_rig_kind("properly make the wheels drive"), "wheels")
        self.assertEqual(infer_rig_kind("Holonomic base caster wheels"), "wheels")

    def test_dummy_sphere_fail(self) -> None:
        xml = '<robot><link><visual><geometry><sphere radius="0.05"/></geometry></visual></link></robot>'
        self.assertTrue(urdf_has_dummy_spheres(xml))
        result = qc_rig_fix(
            prompt="make the wheels drive",
            filename="holonomic.glb",
            joints=[{"id": "wheel_l", "type": "fixed", "child": "wheel_left"}],
            urdf_text=xml,
        )
        self.assertFalse(result["pass"])
        self.assertFalse(result["auto_apply"])
        self.assertEqual(result["token"], TOKEN)

    def test_wheel_drive_pass(self) -> None:
        result = qc_rig_fix(
            prompt="make the wheels drive",
            filename="holonomic.glb",
            files=["holonomic.rigs.json", "holonomic.urdf"],
            sidecar={
                "rigs": [{"id": "wheels", "name": "Drive", "kind": "wheels", "animationId": "anim_drive"}],
                "animations": [{"id": "anim_drive", "keyframes": [{"time": 0}, {"time": 1}]}],
            },
            joints=[{"id": "wheel_l", "type": "continuous", "child": "wheel_left"}],
            urdf_text="<robot name='base'><link name='wheel_left'></link></robot>",
        )
        self.assertTrue(result["pass"])

    def test_inspect_empty_project_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            result = inspect_project(Path(tmp), filename="missing.glb", prompt="make the wheels drive")
            self.assertFalse(result["pass"])

    def test_rig_to_urdf_still_omits_dummy_spheres(self) -> None:
        doc = {
            "joints": [
                {"type": "continuous", "parent": "base", "child": "wheel_left", "anchor": [0, 0, 0], "axis": [0, 1, 0]},
            ]
        }
        rig = rig_from_cad_joints(doc, name="Wheels")
        xml = rig_to_urdf(rig)
        self.assertNotIn("sphere", xml)
        self.assertIn('type="continuous"', xml)

    def test_wheel_packet_example_project(self) -> None:
        packet = wheel_fix_packet(filenames=["base.glb"], project_id="5bf8e783")
        self.assertEqual(packet["example_project"], "5bf8e783")
        self.assertEqual(packet["round_table"], "roundtbl1")


if __name__ == "__main__":
    unittest.main()
