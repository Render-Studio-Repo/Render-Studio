"""Headset → DIMOS blueprint map. Vision/Vive fall back to teleop-quest-openarm."""

from __future__ import annotations

import unittest

from backend.services.dimos_headset import (
    DEFAULT_BLUEPRINT,
    FALLBACK_NOTES,
    HEADSET_BLUEPRINTS,
    headset_map_payload,
    normalize_headset,
    resolve_headset_blueprint,
)


class DimosHeadsetMapTests(unittest.TestCase):
    def test_quest_vision_vive_all_openarm_quest_pipe(self) -> None:
        self.assertEqual(HEADSET_BLUEPRINTS["quest"], "teleop-quest-openarm")
        self.assertEqual(HEADSET_BLUEPRINTS["vision"], "teleop-quest-openarm")
        self.assertEqual(HEADSET_BLUEPRINTS["vive"], "teleop-quest-openarm")
        self.assertEqual(resolve_headset_blueprint("quest")[1], DEFAULT_BLUEPRINT)
        self.assertEqual(resolve_headset_blueprint("vision")[1], "teleop-quest-openarm")
        self.assertEqual(resolve_headset_blueprint("vive")[1], "teleop-quest-openarm")

    def test_unknown_headset_is_quest_and_rejects_arbitrary_blueprint(self) -> None:
        self.assertEqual(normalize_headset("AppleVisionPro"), "quest")
        self.assertEqual(normalize_headset(None), "quest")
        hid, bp, note = resolve_headset_blueprint("vision", "teleop-vision-openarm")
        self.assertEqual(hid, "vision")
        self.assertEqual(bp, "teleop-quest-openarm")
        self.assertIn("no teleop-vision", note)
        hid2, bp2, _ = resolve_headset_blueprint("quest", "rm -rf /")
        self.assertEqual(bp2, "teleop-quest-openarm")
        self.assertEqual(hid2, "quest")

    def test_allowlisted_override_and_payload(self) -> None:
        hid, bp, note = resolve_headset_blueprint("vive", "teleop-quest-openarm")
        self.assertEqual(hid, "vive")
        self.assertEqual(bp, "teleop-quest-openarm")
        self.assertIn("no teleop-vive", note)
        payload = headset_map_payload()
        self.assertEqual(payload["fallback"], DEFAULT_BLUEPRINT)
        self.assertEqual(payload["notes"], FALLBACK_NOTES)
