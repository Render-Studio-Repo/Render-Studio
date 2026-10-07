"""Preview GLBs in glTF metres bake to millimetres; ChatGPT subscription has chat_json."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import trimesh

from backend.services.cad_service import (
    _bake_gltf_metres_to_millimetres,
    _match_glb_scale_to_step,
    _scene_extent,
    workspace_unit_scale,
)
from backend.services.chatgpt_subscription_ai import ChatgptSubscriptionAI


class PreviewGlbMillimetreTests(unittest.TestCase):
    def test_metre_machine_scales_to_mm(self) -> None:
        mesh = trimesh.creation.box(extents=[0.356, 0.360, 0.125])
        path = Path(tempfile.mkdtemp()) / "chassis.glb"
        mesh.export(str(path))
        self.assertTrue(_bake_gltf_metres_to_millimetres(path))
        scene = trimesh.load(str(path), force="scene")
        self.assertGreater(_scene_extent(scene), 300.0)
        self.assertLess(_scene_extent(scene), 500.0)

    def test_already_mm_chassis_is_left_alone(self) -> None:
        mesh = trimesh.creation.box(extents=[356.0, 360.0, 125.0])
        path = Path(tempfile.mkdtemp()) / "chassis_mm.glb"
        mesh.export(str(path))
        self.assertFalse(_bake_gltf_metres_to_millimetres(path))
        scene = trimesh.load(str(path), force="scene")
        self.assertGreater(_scene_extent(scene), 300.0)
        self.assertLess(_scene_extent(scene), 500.0)

    def test_small_mm_hardware_is_left_alone(self) -> None:
        mesh = trimesh.creation.box(extents=[6.0, 6.0, 8.0])
        path = Path(tempfile.mkdtemp()) / "screw.glb"
        mesh.export(str(path))
        self.assertFalse(_bake_gltf_metres_to_millimetres(path))

    def test_50mm_part_is_not_treated_as_metres_or_microns(self) -> None:
        self.assertEqual(workspace_unit_scale(50.0), 1.0)
        self.assertEqual(workspace_unit_scale(0.05), 1000.0)
        mesh = trimesh.creation.box(extents=[50.0, 40.0, 12.0])
        path = Path(tempfile.mkdtemp()) / "bracket_mm.glb"
        mesh.export(str(path))
        self.assertFalse(_bake_gltf_metres_to_millimetres(path))
        scene = trimesh.load(str(path), force="scene")
        self.assertGreater(_scene_extent(scene), 40.0)
        self.assertLess(_scene_extent(scene), 80.0)

    def test_50mm_metre_glb_bakes_to_millimetres(self) -> None:
        mesh = trimesh.creation.box(extents=[0.05, 0.04, 0.012])
        path = Path(tempfile.mkdtemp()) / "bracket_m.glb"
        mesh.export(str(path))
        self.assertTrue(_bake_gltf_metres_to_millimetres(path))
        scene = trimesh.load(str(path), force="scene")
        self.assertGreater(_scene_extent(scene), 40.0)
        self.assertLess(_scene_extent(scene), 80.0)

    def test_match_glb_scales_metre_preview_to_mm_step(self) -> None:
        glb = Path(tempfile.mkdtemp()) / "part.glb"
        trimesh.creation.box(extents=[0.05, 0.04, 0.01]).export(str(glb))
        step = Path(tempfile.mkdtemp()) / "part.step"
        step.write_text("ISO-10303-21;", encoding="utf-8")
        fake_step = trimesh.creation.box(extents=[50.0, 40.0, 10.0])
        with patch("backend.services.cad_service.import_step_mesh", return_value=fake_step):
            _match_glb_scale_to_step(step, glb)
        scene = trimesh.load(str(glb), force="scene")
        self.assertGreater(_scene_extent(scene), 40.0)
        self.assertLess(_scene_extent(scene), 80.0)


class ChatgptSubscriptionChatJsonTests(unittest.TestCase):
    def test_chat_json_parses_object(self) -> None:
        ai = ChatgptSubscriptionAI("user-1", model="gpt-5.6-terra")
        with patch.object(
            ai,
            "_call_model",
            return_value=('{"pass": true, "repair_note": "", "issues": []}', {"ok": True}),
        ):
            parsed, trace = ai.chat_json("sys", "user", retry_on_truncation=False, pro_floor=None)
        self.assertTrue(parsed["pass"])
        self.assertTrue(trace.get("parsed_ok"))


if __name__ == "__main__":
    unittest.main()
