"""Lightweight clip-edit prompt mapping."""

from __future__ import annotations

import unittest

from backend.services.video_edit_prompt import (
    local_improve_prompt,
    local_plan,
    plan_from_model_text,
    timeline_plan,
)


class VideoEditPromptTests(unittest.TestCase):
    def test_warm_and_mute(self) -> None:
        plan = local_plan("make it warm and hide audio")
        self.assertEqual(plan["grade"], "warm")
        self.assertEqual(plan["keepAudio"], False)
        self.assertIn("warm grade", plan["summary"])

    def test_music_enable(self) -> None:
        plan = local_plan("add music")
        self.assertEqual(plan["music"], "enable")

    def test_model_json_overrides_heuristics(self) -> None:
        plan = plan_from_model_text(
            '{"grade": "noir", "keepAudio": false, "summary": ["noir"]}',
            "whatever",
        )
        self.assertEqual(plan["grade"], "noir")
        self.assertEqual(plan["keepAudio"], False)

    def test_timeline_transition_in(self) -> None:
        plan = timeline_plan("make it transition in")
        self.assertEqual(plan["transition"], "fade")

    def test_improve_prompt_keeps_intent(self) -> None:
        improved = local_improve_prompt("take these videos and make a single clip with zooms")
        self.assertIn("take these videos", improved)
        self.assertIn("film edit", improved.lower())
        self.assertNotIn("shop-hex", improved.lower())
