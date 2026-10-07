from __future__ import annotations

import tempfile
import unittest
import json
from pathlib import Path

from backend.services import project_store


class ProjectPromptNamingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.project = Path(self.tmp.name) / "bcef5f16"
        self.project.mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_first_prompt_replaces_stale_user_flag_on_automatic_copy_name(self) -> None:
        project_store.save_meta(
            self.project,
            {
                "id": "bcef5f16",
                "name": "Project 66873394 (copy)",
                "name_user_set": True,
                "copied_from_project_id": "66873394",
            },
        )

        result = project_store.apply_prompt_project_name(
            self.project,
            "Create a compact rotating base assembly",
        )

        self.assertEqual(result["name"], "Compact Rotating Base")
        self.assertEqual(result["_renamed_from"], "Project 66873394 (copy)")

    def test_first_prompt_preserves_genuinely_user_named_copy(self) -> None:
        project_store.save_meta(
            self.project,
            {
                "id": "bcef5f16",
                "name": "OpenArm Rotating Base (copy)",
                "name_user_set": True,
                "copied_from_project_id": "66873394",
            },
        )

        result = project_store.apply_prompt_project_name(
            self.project,
            "Create a compact rotating base assembly",
        )

        self.assertEqual(result["name"], "OpenArm Rotating Base (copy)")
        self.assertNotIn("_renamed", result)

    def test_harness_prefix_is_not_used_as_the_project_name(self) -> None:
        self.assertEqual(
            project_store.title_from_prompt(
                "Create a NEW compact VibeCAD prototype - Rotating Base OpenArm 2"
            ),
            "Rotating Base OpenArm 2",
        )

    def test_harness_names_are_metadata_not_product_words(self) -> None:
        prompts = {
            "Jake CAD prototype: Adjustable Camera Bracket": "Adjustable Camera Bracket",
            "MAC workflow - Planetary Gearbox Housing": "Planetary Gearbox Housing",
            "Codex text-to-CAD model of a Bench Vise": "Bench Vise",
            "Create a cable guide using VibeCAD": "Cable Guide",
        }
        for prompt, expected in prompts.items():
            with self.subTest(prompt=prompt):
                title = project_store.title_from_prompt(prompt)
                self.assertEqual(title, expected)
                self.assertNotRegex(title.lower(), r"vibecad|jake|codex|\bmac\b")

    def test_project_copy_keeps_chat_but_not_generation_ownership(self) -> None:
        source = Path(self.tmp.name) / "source"
        destination = Path(self.tmp.name) / "copy"
        source.mkdir()
        (source / "prompt_history.json").write_text(
            json.dumps({"entries": [{"id": "prompt-1", "prompt": "Make a bracket"}]}),
            encoding="utf-8",
        )
        (source / "generation.json").write_text(
            json.dumps({"status": "running", "trace_id": "trace-1", "worker_pid": 123}),
            encoding="utf-8",
        )
        (source / ".generation.lock").write_text("", encoding="utf-8")
        (source / ".generation_flags").mkdir()
        (source / ".generation_flags" / "trace-1").write_text("1", encoding="utf-8")
        (source / ".generation_jobs").mkdir()
        (source / ".generation_jobs" / "trace-1.json").write_text("{}", encoding="utf-8")
        (source / "mesh").mkdir()
        (source / "mesh" / "Bracket.generation-live.glb").write_bytes(b"draft")
        (source / "mesh" / "Bracket.glb").write_bytes(b"finished")

        project_store.copy_project_snapshot(source, destination)

        self.assertTrue((destination / "prompt_history.json").is_file())
        self.assertTrue((destination / "mesh" / "Bracket.glb").is_file())
        self.assertFalse((destination / "generation.json").exists())
        self.assertFalse((destination / ".generation.lock").exists())
        self.assertFalse((destination / ".generation_flags").exists())
        self.assertFalse((destination / ".generation_jobs").exists())
        self.assertFalse((destination / "mesh" / "Bracket.generation-live.glb").exists())


if __name__ == "__main__":
    unittest.main()
