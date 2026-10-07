"""Render Improve + scene-render prompts lock viewport pose and object-only wrap."""

from __future__ import annotations

import unittest

from backend.main import IMPROVE_RENDER_PROMPT_SYSTEM, _scene_render_prompt


class SceneRenderPromptTests(unittest.TestCase):
    def test_scene_render_locks_viewport_model_and_facing(self) -> None:
        prompt = _scene_render_prompt(
            "put it on a kitchen counter in morning light",
            "Gripper",
            "gripper.glb",
        )
        lower = prompt.lower()
        self.assertIn("exact 3d model", lower)
        self.assertIn("viewport", lower)
        self.assertIn("facing", lower)
        self.assertIn("do not yaw", lower)
        self.assertIn("gripper.glb", prompt)
        self.assertIn("kitchen counter", lower)

    def test_scene_render_materials_wrap_object_not_scene(self) -> None:
        prompt = _scene_render_prompt("oak table, studio lighting", None, None)
        lower = prompt.lower()
        self.assertIn("only on the cad subject", lower)
        self.assertIn("around the model", lower)
        self.assertIn("do not wallpaper the scene onto the product", lower)
        self.assertIn("camera-projected", lower)

    def test_improve_render_system_covers_align_and_texture_wrap(self) -> None:
        text = IMPROVE_RENDER_PROMPT_SYSTEM.lower()
        self.assertIn("exact 3d model", text)
        self.assertIn("facing", text)
        self.assertIn("do not yaw", text)
        self.assertIn("texture wrap", text)
        self.assertIn("on the cad subject", text)
        self.assertIn("never as a wallpaper", text)
        self.assertIn("viewport", text)
        self.assertIn("any language", text)


if __name__ == "__main__":
    unittest.main()
